/**
 * src/domain/receipt.ts — mô hình "bên nhận phản hồi" (receipt theo site).
 *
 * Author đăng ký = BAN HÀNH THẲNG: tạo receipt cho_phan_hoi cho mỗi SITE nhận.
 * Mỗi site một mốc apply_date (ghi khi chấp nhận). Một version × một site = một
 * receipt (uq_receipt_version_site). Kiểm quyền đặt ở domain (DCS-8 §4.3).
 *
 * Phản hồi (chấp nhận/từ chối) nằm ở Task 4; file này (Task 3) lo phần phát
 * hành + giải tập site ứng viên theo scope + đọc trạng thái tổng hợp.
 */
import type { Sql, TransactionSql } from 'postgres';
import { BusinessError } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
import { todayVN } from '../lib/clock.js';
import {
  aggregateStatusOf, type AggregateStatus, type ReceiptTally,
} from './lifecycle-status.js';
import { siteIdsWithDocControl } from './permissions.js';

export interface SiteOption {
  site_id: string;
  site_code: string;
  name: string;
}

/**
 * Chuẩn hoá danh sách site_id gửi từ form: checkbox cùng tên có thể là một
 * chuỗi (chọn 1) hoặc mảng (chọn nhiều); loại rỗng/khoảng trắng + trùng lặp.
 * Hàm thuần — tách khỏi route để kiểm thử không cần DB.
 */
export function normalizeSiteIds(raw: string | string[] | undefined | null): string[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const seen = new Set<string>();
  for (const s of arr) {
    const t = String(s ?? '').trim();
    if (t) seen.add(t);
  }
  return [...seen];
}

/**
 * Giải tập SITE ứng viên theo phạm vi ban hành (để Author chọn tập site nhận).
 * - group: mọi site.
 * - bu:    các site thuộc BU (qua org_site_bu).
 * - site:  chính site đó.
 * - dept:  site chủ quản của dept đó.
 * Trả danh sách để UI gợi ý; Author tick chọn tập thực nhận (không tự bung cứng).
 */
export async function candidateSitesForScope(
  sql: Sql,
  scope: {
    scope_level: 'group' | 'bu' | 'site' | 'dept';
    scope_bu_id?: string | null;
    scope_site_id?: string | null;
    scope_dept_id?: string | null;
  },
): Promise<SiteOption[]> {
  switch (scope.scope_level) {
    case 'group':
      return sql<SiteOption[]>`
        SELECT site_id, site_code, name FROM org_site ORDER BY site_code`;
    case 'bu':
      return sql<SiteOption[]>`
        SELECT s.site_id, s.site_code, s.name
          FROM org_site s JOIN org_site_bu sb ON sb.site_id = s.site_id
         WHERE sb.bu_id = ${scope.scope_bu_id ?? null}
         ORDER BY s.site_code`;
    case 'site':
      return sql<SiteOption[]>`
        SELECT site_id, site_code, name FROM org_site
         WHERE site_id = ${scope.scope_site_id ?? null}`;
    case 'dept':
      return sql<SiteOption[]>`
        SELECT s.site_id, s.site_code, s.name
          FROM org_site s JOIN org_department d ON d.site_id = s.site_id
         WHERE d.dept_id = ${scope.scope_dept_id ?? null}`;
    default:
      return [];
  }
}

/**
 * Phát hành một phiên bản tới tập site: tạo receipt cho_phan_hoi cho mỗi site.
 * Idempotent theo (version_id, site_id): gọi lại không nhân đôi (dùng khi thêm
 * site sau). targetDeptId tuỳ chọn khi ban hành hẹp tới một dept trong site.
 */
export async function publishToSites(
  tx: TransactionSql,
  input: {
    versionId: string;
    siteIds: string[];
    targetDeptId?: string | null;
    actorUserId: string;
    /** Ngày hiệu lực riêng cho từng site (site_id -> YYYY-MM-DD). Thiếu = NULL
     *  (coalesce về ngày hiệu lực gốc khi đọc). */
    siteEffectiveDates?: Record<string, string>;
  },
): Promise<number> {
  let created = 0;
  for (const siteId of input.siteIds) {
    const siteEff = input.siteEffectiveDates?.[siteId] ?? null;
    const rows = await tx<{ receipt_id: string }[]>`
      INSERT INTO document_receipt (version_id, site_id, target_dept_id, status, site_effective_date)
      VALUES (${input.versionId}, ${siteId}, ${input.targetDeptId ?? null}, 'cho_phan_hoi', ${siteEff})
      ON CONFLICT (version_id, site_id) DO NOTHING
      RETURNING receipt_id`;
    if (rows.length > 0) created += 1;
  }
  if (created > 0) {
    await writeAudit(tx, {
      eventType: 'ban_hanh', actorUserId: input.actorUserId,
      objectType: 'document_versions', objectId: input.versionId,
      afterState: { site_count: created, target_dept_id: input.targetDeptId ?? null },
    });
  }
  return created;
}

/**
 * Phân loại site cho thao tác 'phát hành thêm / phát hành lại' (Task 1).
 * THUẦN: không chạm DB, không async — để unit-test trực tiếp.
 *   - invalid: site requested KHÔNG thuộc candidate (ngoài scope).
 *   - blockedByContentReject: có BẤT KỲ receipt tu_choi + sai_noi_dung (toàn version).
 *   - newOnes: hợp lệ + chưa có receipt.
 *   - republish: hợp lệ + receipt tu_choi loại sai_dang_ky.
 *   - skipped: hợp lệ nhưng chap_nhan / cho_phan_hoi / tu_choi+sai_noi_dung.
 */
export interface SiteClassifyInput {
  candidateSiteIds: string[];
  existingReceipts: { site_id: string; status: string; response_type: string | null }[];
  requestedSiteIds: string[];
}
export interface SiteClassifyResult {
  newOnes: string[];
  republish: string[];
  skipped: string[];
  invalid: string[];
  blockedByContentReject: boolean;
}
export function classifySitesForRepublish(input: SiteClassifyInput): SiteClassifyResult {
  const candidate = new Set(input.candidateSiteIds);
  const bySite = new Map(input.existingReceipts.map((r) => [r.site_id, r]));
  const blockedByContentReject = input.existingReceipts.some(
    (r) => r.status === 'tu_choi' && r.response_type === 'sai_noi_dung',
  );
  const newOnes: string[] = [];
  const republish: string[] = [];
  const skipped: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const siteId of input.requestedSiteIds) {
    if (seen.has(siteId)) continue;
    seen.add(siteId);
    if (!candidate.has(siteId)) { invalid.push(siteId); continue; }
    const rc = bySite.get(siteId);
    if (!rc) { newOnes.push(siteId); continue; }
    if (rc.status === 'tu_choi' && rc.response_type === 'sai_dang_ky') { republish.push(siteId); continue; }
    skipped.push(siteId);
  }
  return { newOnes, republish, skipped, invalid, blockedByContentReject };
}

/** Đếm receipt theo trạng thái cho một version (để suy trạng thái tổng hợp). */
export async function receiptTally(sql: Sql, versionId: string): Promise<ReceiptTally> {
  const [row] = await sql<{ total: number; accepted: number; rejected: number; pending: number }[]>`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status = 'chap_nhan')::int AS accepted,
           count(*) FILTER (WHERE status = 'tu_choi')::int AS rejected,
           count(*) FILTER (WHERE status = 'cho_phan_hoi')::int AS pending
      FROM document_receipt WHERE version_id = ${versionId}`;
  return row ?? { total: 0, accepted: 0, rejected: 0, pending: 0 };
}

/** Trạng thái tổng hợp mức version, suy từ tập receipt. */
export async function aggregateStatus(sql: Sql, versionId: string): Promise<AggregateStatus> {
  return aggregateStatusOf(await receiptTally(sql, versionId));
}

export interface ReceiptRow {
  receipt_id: string;
  version_id: string;
  site_id: string;
  site_code: string | null;
  site_name: string | null;
  target_dept_id: string | null;
  apply_date: string | null;
  status: string;
  response_type: string | null;
  response_note: string | null;
  responded_by: string | null;
  responded_at: string | null;
  /** Ngày hiệu lực của site (đã coalesce về ngày gốc khi site không khai riêng). */
  site_effective_date: string | null;
  /** Ngày hiệu lực gốc của phiên bản. */
  effective_date: string | null;
}

export interface PendingReceiptRow extends ReceiptRow {
  doc_id: string;
  version_no: string;
  title: string;
  registrant_user_id: string;
  /** Cảnh báo: cùng version đã có site khác báo sai (loại nào). */
  other_reject_type: string | null;
}

/**
 * Hàng chờ phản hồi của một DC Site: các receipt cho_phan_hoi thuộc các site
 * người dùng phụ trách. Kèm cờ cảnh báo nếu cùng version đã có site khác từ chối.
 */
/** Một dòng tài liệu bị thu hồi có liên quan tới site (nhắc DC Site). */
export interface RecalledDocRow {
  version_id: string;
  doc_id: string;
  version_no: string;
  title: string;
  recall_reason: string | null;
  recalled_at: string | null;
}

/**
 * Tài liệu ĐÃ THU HỒI có receipt tới các site người dùng phụ trách (nhắc Mức A,
 * chỉ đọc). Mọi site có receipt — bất kể trạng thái receipt. Dẫn xuất, không bảng
 * mới, không kênh notification.
 */
export async function recalledDocsForSites(sql: Sql, siteIds: string[]): Promise<RecalledDocRow[]> {
  if (siteIds.length === 0) return [];
  return sql<RecalledDocRow[]>`
    SELECT DISTINCT v.version_id, v.doc_id, v.version_no, v.title,
           v.recall_reason, v.updated_at::text AS recalled_at
      FROM document_versions v
      JOIN document_receipt r ON r.version_id = v.version_id
     WHERE v.status = 'thu_hoi'
       AND r.site_id = ANY(${siteIds}::uuid[])
     ORDER BY recalled_at DESC`;
}

/** Đếm nhanh số receipt đang chờ phản hồi của các site (cho badge sidebar).
 * Điểm 5: loại phiếu của tài liệu đã thu hồi (JOIN document_versions). */
export async function pendingReceiptCountForSites(sql: Sql, siteIds: string[]): Promise<number> {
  if (siteIds.length === 0) return 0;
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM document_receipt r
      JOIN document_versions v ON v.version_id = r.version_id
     WHERE r.status = 'cho_phan_hoi'
       AND v.status <> 'thu_hoi'
       AND r.site_id = ANY(${siteIds}::uuid[])`;
  return rows[0]?.n ?? 0;
}

export async function pendingReceiptsForSites(
  sql: Sql,
  siteIds: string[],
): Promise<PendingReceiptRow[]> {
  if (siteIds.length === 0) return [];
  return sql<PendingReceiptRow[]>`
    SELECT r.receipt_id, r.version_id, r.site_id,
           s.site_code, s.name AS site_name,
           r.target_dept_id, r.apply_date::text AS apply_date,
           r.status, r.response_type, r.response_note,
           r.responded_by, r.responded_at::text AS responded_at,
           coalesce(r.site_effective_date, v.effective_date)::text AS site_effective_date,
           v.effective_date::text AS effective_date,
           v.doc_id, v.version_no, v.title, v.registrant_user_id,
           (SELECT r2.response_type FROM document_receipt r2
             WHERE r2.version_id = r.version_id AND r2.status = 'tu_choi'
             ORDER BY CASE r2.response_type WHEN 'sai_noi_dung' THEN 0 ELSE 1 END
             LIMIT 1) AS other_reject_type
      FROM document_receipt r
      JOIN org_site s ON s.site_id = r.site_id
      JOIN document_versions v ON v.version_id = r.version_id
     WHERE r.status = 'cho_phan_hoi'
       AND v.status <> 'thu_hoi'
       AND r.site_id = ANY(${siteIds})
     ORDER BY v.submitted_at DESC NULLS LAST, s.site_code`;
}

/** Nạp một receipt để hiển thị màn phản hồi (kèm thông tin phiên bản). */
export async function loadReceiptForView(
  sql: Sql,
  receiptId: string,
): Promise<PendingReceiptRow | null> {
  const rows = await sql<PendingReceiptRow[]>`
    SELECT r.receipt_id, r.version_id, r.site_id,
           s.site_code, s.name AS site_name,
           r.target_dept_id, r.apply_date::text AS apply_date,
           r.status, r.response_type, r.response_note,
           r.responded_by, r.responded_at::text AS responded_at,
           coalesce(r.site_effective_date, v.effective_date)::text AS site_effective_date,
           v.effective_date::text AS effective_date,
           v.doc_id, v.version_no, v.title, v.registrant_user_id,
           (SELECT r2.response_type FROM document_receipt r2
             WHERE r2.version_id = r.version_id AND r2.status = 'tu_choi' AND r2.receipt_id <> r.receipt_id
             ORDER BY CASE r2.response_type WHEN 'sai_noi_dung' THEN 0 ELSE 1 END
             LIMIT 1) AS other_reject_type
      FROM document_receipt r
      JOIN org_site s ON s.site_id = r.site_id
      JOIN document_versions v ON v.version_id = r.version_id
     WHERE r.receipt_id = ${receiptId}`;
  return rows[0] ?? null;
}

/** Liệt kê receipt của một version (ma trận phản hồi theo site). */
export async function listReceiptsForVersion(sql: Sql, versionId: string): Promise<ReceiptRow[]> {
  return sql<ReceiptRow[]>`
    SELECT r.receipt_id, r.version_id, r.site_id,
           s.site_code, s.name AS site_name,
           r.target_dept_id, r.apply_date::text AS apply_date,
           r.status, r.response_type, r.response_note,
           r.responded_by, r.responded_at::text AS responded_at,
           coalesce(r.site_effective_date, v.effective_date)::text AS site_effective_date,
           v.effective_date::text AS effective_date
      FROM document_receipt r
      JOIN org_site s ON s.site_id = r.site_id
      JOIN document_versions v ON v.version_id = r.version_id
     WHERE r.version_id = ${versionId}
     ORDER BY s.site_code`;
}

/** Kiểm "đã có ≥1 site chấp nhận" — dùng để khóa sửa trực tiếp (Task 6). */
export async function hasAnyAcceptance(sql: Sql, versionId: string): Promise<boolean> {
  const [row] = await sql<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM document_receipt
       WHERE version_id = ${versionId} AND status = 'chap_nhan'
    ) AS ok`;
  return row?.ok ?? false;
}

// ============================================================================
// PHẢN HỒI CỦA SITE (Task 4) — DC Site chấp nhận / từ chối receipt.
// Kiểm quyền ở domain: phải giữ DC_SITE_DOC_CONTROL đúng site của receipt.
// Author KHÔNG bị chặn tự phản hồi tài liệu mình (chốt: cho phép nhưng CẢNH BÁO
// + AUDIT ĐẬM), vì còn kênh Reader report làm đối trọng và quản lý ngoài.
// ============================================================================

export type RejectType = 'sai_dang_ky' | 'sai_noi_dung';

interface ReceiptContext {
  receipt_id: string;
  version_id: string;
  site_id: string;
  status: string;
  registrant_user_id: string;
  /** Trạng thái + ngày hiệu lực của phiên bản (điểm 4/5). */
  version_status: string;
  effective_date: string | null;
  /** Ngày hiệu lực riêng khai cho site này (NULL = dùng effective_date gốc). */
  site_effective_date: string | null;
}

async function loadReceiptForRespond(
  tx: TransactionSql,
  receiptId: string,
): Promise<ReceiptContext | null> {
  const rows = await tx<ReceiptContext[]>`
    SELECT r.receipt_id, r.version_id, r.site_id, r.status,
           v.registrant_user_id,
           v.status AS version_status,
           v.effective_date::text AS effective_date,
           r.site_effective_date::text AS site_effective_date
      FROM document_receipt r
      JOIN document_versions v ON v.version_id = r.version_id
     WHERE r.receipt_id = ${receiptId}
     FOR UPDATE OF r`;
  return rows[0] ?? null;
}

/**
 * Ngày hiệu lực THỰC của một site: ngày riêng khai cho site nếu có, nếu không
 * thì về ngày hiệu lực gốc của phiên bản. Hàm thuần — tách để unit-test không
 * cần DB (phương án 2a, điểm quyết định D1-D4).
 */
export function effectiveForSite(
  siteEff: string | null | undefined,
  versionEff: string | null | undefined,
): string | null {
  return (siteEff ?? versionEff) ?? null;
}

/** Kiểm quyền + phát hiện tự-phản-hồi, dùng chung cho chấp nhận/từ chối.
 * mode='accept' thêm chặn điểm 4/5: không chấp nhận tài liệu đã thu hồi hoặc
 * chưa tới ngày hiệu lực (từ chối thì vẫn cho — site cần báo sai sót). */
async function assertCanRespond(
  tx: TransactionSql,
  rc: ReceiptContext,
  userId: string,
  mode: 'accept' | 'reject' = 'accept',
): Promise<{ selfResponded: boolean }> {
  if (rc.status !== 'cho_phan_hoi') {
    throw new BusinessError('receipt.bad_status', 'Receipt không còn ở trạng thái chờ phản hồi');
  }
  // Điểm 5: phiếu của tài liệu đã thu hồi không được chấp nhận.
  if (rc.version_status === 'thu_hoi') {
    throw new BusinessError('receipt.recalled', 'Tài liệu đã bị thu hồi — không thể phản hồi phiếu này');
  }
  // Điểm 4: site không được chấp nhận trước ngày hiệu lực (riêng của site nếu
  // có khai, nếu không thì ngày hiệu lực gốc). So với "hôm nay" theo giờ VN.
  const effForSite = effectiveForSite(rc.site_effective_date, rc.effective_date);
  if (mode === 'accept' && effForSite && effForSite.slice(0, 10) > todayVN()) {
    throw new BusinessError('receipt.before_effective', 'Chưa tới ngày hiệu lực — không thể chấp nhận tài liệu này');
  }
  const siteIds = await siteIdsWithDocControl(tx as unknown as Sql, userId);
  if (!siteIds.has(rc.site_id)) {
    throw new BusinessError('receipt.no_permission', 'Không đủ thẩm quyền phản hồi receipt của site này', { httpStatus: 403 });
  }
  return { selfResponded: rc.registrant_user_id === userId };
}

/** DC Site chấp nhận receipt: apply_date = NGÀY HIỆU LỰC ĐÃ KHAI cho site đó
 *  (coalesce(site_effective_date, version.effective_date)), KHÔNG phải ngày
 *  bấm chấp nhận. Mỗi site một mốc theo ngày hiệu lực của chính site. */
export async function acceptReceipt(
  sql: Sql,
  input: { receiptId: string; userId: string },
): Promise<void> {
  await sql.begin(async (tx) => {
    const rc = await loadReceiptForRespond(tx as TransactionSql, input.receiptId);
    if (!rc) throw new BusinessError('receipt.not_found', 'Không tìm thấy receipt');
    const { selfResponded } = await assertCanRespond(tx as TransactionSql, rc, input.userId);

    // apply_date = ngày hiệu lực đã khai cho site (riêng nếu có, nếu không là
    // ngày hiệu lực gốc). KHÔNG dùng today(): mốc áp dụng gắn với ngày hiệu lực.
    const applyDate = effectiveForSite(rc.site_effective_date, rc.effective_date);
    if (!applyDate) {
      throw new BusinessError('receipt.no_effective', 'Tài liệu chưa có ngày hiệu lực để chấp nhận');
    }
    // Điểm 8: ngày site áp dụng không được sớm hơn ngày có hiệu lực gốc.
    if (rc.effective_date && applyDate.slice(0, 10) < rc.effective_date.slice(0, 10)) {
      throw new BusinessError('receipt.apply_before_effective', 'Ngày áp dụng không được sớm hơn ngày có hiệu lực của tài liệu');
    }
    await tx`
      UPDATE document_receipt
         SET status = 'chap_nhan', apply_date = ${applyDate},
             response_type = NULL, response_note = NULL,
             responded_by = ${input.userId}, responded_at = now()
       WHERE receipt_id = ${input.receiptId}`;

    if (selfResponded) {
      await writeAudit(tx as TransactionSql, {
        eventType: 'tu_phan_hoi_canh_bao', actorUserId: input.userId,
        objectType: 'document_receipt', objectId: input.receiptId,
        afterState: { action: 'chap_nhan', canh_bao: 'Người phản hồi là chính người đăng ký' },
      });
    }
    await writeAudit(tx as TransactionSql, {
      eventType: 'chap_nhan_nhan', actorUserId: input.userId,
      objectType: 'document_receipt', objectId: input.receiptId,
      afterState: { site_id: rc.site_id, apply_date: applyDate },
    });
  });
}

/** DC Site từ chối receipt: bắt buộc loại + lý do. */
export async function rejectReceipt(
  sql: Sql,
  input: { receiptId: string; userId: string; rejectType: RejectType; note: string },
): Promise<void> {
  if (!input.note.trim()) {
    throw new BusinessError('receipt.reason', 'Từ chối bắt buộc kèm lý do sai sót');
  }
  await sql.begin(async (tx) => {
    const rc = await loadReceiptForRespond(tx as TransactionSql, input.receiptId);
    if (!rc) throw new BusinessError('receipt.not_found', 'Không tìm thấy receipt');
    const { selfResponded } = await assertCanRespond(tx as TransactionSql, rc, input.userId, 'reject');

    await tx`
      UPDATE document_receipt
         SET status = 'tu_choi', response_type = ${input.rejectType},
             response_note = ${input.note.trim()}, apply_date = NULL,
             responded_by = ${input.userId}, responded_at = now()
       WHERE receipt_id = ${input.receiptId}`;

    if (selfResponded) {
      await writeAudit(tx as TransactionSql, {
        eventType: 'tu_phan_hoi_canh_bao', actorUserId: input.userId,
        objectType: 'document_receipt', objectId: input.receiptId,
        afterState: { action: 'tu_choi', canh_bao: 'Người phản hồi là chính người đăng ký' },
      });
    }
    await writeAudit(tx as TransactionSql, {
      eventType: 'tu_choi_nhan', actorUserId: input.userId,
      objectType: 'document_receipt', objectId: input.receiptId,
      afterState: { site_id: rc.site_id, response_type: input.rejectType, note: input.note.trim() },
    });
  });
}

// ============================================================================
// AUTHOR SỬA / THU HỒI / XÓA (Task 6).
// Điều kiện mở: xét TOÀN BỘ receipt của version.
//   - Sửa metadata tại chỗ (Loại 1): chỉ khi CHƯA site nào chấp nhận.
//   - Thu hồi: khi chưa ai chấp nhận HOẶC có ≥1 từ chối.
//   - Xóa: chỉ khi chưa có chấp nhận nào.
// ============================================================================

export interface MetadataPatch {
  title?: string;
  issuedDate?: string;
  effectiveDate?: string;
  reviewCycleMonths?: number;
  expiryDate?: string | null;
  ownerDepartmentId?: string | null;
}

interface VersionOwnerRow {
  version_id: string;
  status: string;
  registrant_user_id: string;
}

async function loadOwnedVersion(
  tx: TransactionSql,
  versionId: string,
  userId: string,
): Promise<VersionOwnerRow> {
  const rows = await tx<VersionOwnerRow[]>`
    SELECT version_id, status, registrant_user_id
      FROM document_versions WHERE version_id = ${versionId} FOR UPDATE`;
  const v = rows[0];
  if (!v) throw new BusinessError('ver.not_found', 'Không tìm thấy phiên bản');
  if (v.registrant_user_id !== userId) {
    throw new BusinessError('ver.not_owner', 'Chỉ người đăng ký được thao tác tài liệu này', { httpStatus: 403 });
  }
  return v;
}

async function acceptedCount(tx: TransactionSql, versionId: string): Promise<number> {
  const [row] = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM document_receipt
     WHERE version_id = ${versionId} AND status = 'chap_nhan'`;
  return row?.n ?? 0;
}

/**
 * Điểm 6 + 7: khóa "đã có site chấp nhận" dùng CHUNG cho sửa metadata và phát
 * hành lại — một khi có ≥1 site chấp nhận thì không được ghi đè metadata cũ
 * (sửa tại chỗ hay phát hành lại), phải ra phiên bản mới. Một mã lỗi thống nhất.
 */
async function assertNotAcceptedLocked(tx: TransactionSql, versionId: string): Promise<void> {
  if (await acceptedCount(tx, versionId) > 0) {
    throw new BusinessError('issue.locked_accepted', 'Đã có site chấp nhận/áp dụng — không sửa hoặc phát hành lại với metadata cũ, phải ra phiên bản mới');
  }
}

/**
 * Sửa thông tin đăng ký tại chỗ (Loại 1 — sai_dang_ky). Giữ version_no +
 * file/hash; KHÔNG đụng doc_id (khóa định danh). Chỉ cho khi chưa site nào
 * chấp nhận/áp dụng. Không tự mở lại receipt đã tu_choi — site tự bấm lại.
 */
export async function editVersionMetadata(
  sql: Sql,
  input: { versionId: string; userId: string; patch: MetadataPatch },
): Promise<void> {
  await sql.begin(async (tx) => {
    const v = await loadOwnedVersion(tx as TransactionSql, input.versionId, input.userId);
    if (v.status !== 'da_ban_hanh') {
      throw new BusinessError('edit.bad_status', 'Chỉ sửa metadata khi tài liệu đang ở trạng thái đã ban hành');
    }
    await assertNotAcceptedLocked(tx as TransactionSql, input.versionId);
    const p = input.patch;
    // Điểm 10: chặn chỉnh ngày hiệu lực về quá khứ.
    if (p.effectiveDate && p.effectiveDate.slice(0, 10) < today()) {
      throw new BusinessError('edit.effective_past', 'Không được đặt ngày hiệu lực về quá khứ');
    }
    // Điểm 10: giữ nguyên expiry_date khi không nhập lại (undefined);
    // chỉ xóa khi gửi sentinel rỗng ('' → NULL). Giá trị mới thì ghi đè.
    const expiryClear = p.expiryDate === '';
    const expiryNew = p.expiryDate != null && p.expiryDate !== '' ? p.expiryDate : null;
    await tx`
      UPDATE document_versions SET
        title = coalesce(${p.title ?? null}, title),
        issued_date = coalesce(${p.issuedDate ?? null}, issued_date),
        effective_date = coalesce(${p.effectiveDate ?? null}, effective_date),
        review_cycle_months = coalesce(${p.reviewCycleMonths ?? null}, review_cycle_months),
        expiry_date = CASE WHEN ${expiryClear} THEN NULL
                           ELSE coalesce(${expiryNew}, expiry_date) END,
        owner_department_id = coalesce(${p.ownerDepartmentId ?? null}, owner_department_id),
        updated_at = now()
      WHERE version_id = ${input.versionId}`;
    await writeAudit(tx as TransactionSql, {
      eventType: 'sua_dang_ky', actorUserId: input.userId,
      objectType: 'document_versions', objectId: input.versionId,
      afterState: { patch: p },
    });
  });
}

/** Xóa bản ban hành — chỉ khi chưa có chấp nhận nào. Xóa cả receipt (cascade). */
export async function deleteUnacceptedVersion(
  sql: Sql,
  input: { versionId: string; userId: string },
): Promise<void> {
  await sql.begin(async (tx) => {
    const v = await loadOwnedVersion(tx as TransactionSql, input.versionId, input.userId);
    if (await acceptedCount(tx as TransactionSql, input.versionId) > 0) {
      throw new BusinessError('del.locked', 'Đã có site chấp nhận — không xóa được, phải thu hồi');
    }
    await writeAudit(tx as TransactionSql, {
      eventType: 'xoa_ban_hanh', actorUserId: input.userId,
      objectType: 'document_versions', objectId: input.versionId,
      afterState: { prev_status: v.status },
    });
    // receipt có ON DELETE CASCADE theo version.
    await tx`DELETE FROM document_versions WHERE version_id = ${input.versionId}`;
  });
}

/**
 * Thu hồi (Author) — khi chưa ai chấp nhận HOẶC có ≥1 từ chối. Chuyển version
 * sang thu_hoi kèm lý do. Ban hành bản mới đi qua luồng đăng ký với supersede.
 */
export async function recallByAuthor(
  sql: Sql,
  input: { versionId: string; userId: string; reason: string },
): Promise<void> {
  if (!input.reason.trim()) throw new BusinessError('recall.reason', 'Thu hồi bắt buộc kèm lý do');
  await sql.begin(async (tx) => {
    const v = await loadOwnedVersion(tx as TransactionSql, input.versionId, input.userId);
    if (v.status !== 'da_ban_hanh') {
      throw new BusinessError('recall.bad_status', `Không thu hồi được từ trạng thái ${v.status}`);
    }
    // MỞ quyền: Author thu hồi được KỂ CẢ khi mọi site đã chấp nhận (bỏ chặn
    // recall.locked). Vẫn bắt buộc lý do + status da_ban_hanh + registrant.
    const [row] = await tx<{ accepted: number; rejected: number; pending: number; total: number }[]>`
      SELECT count(*) FILTER (WHERE status = 'chap_nhan')::int AS accepted,
             count(*) FILTER (WHERE status = 'tu_choi')::int AS rejected,
             count(*) FILTER (WHERE status = 'cho_phan_hoi')::int AS pending,
             count(*)::int AS total
        FROM document_receipt WHERE version_id = ${input.versionId}`;
    const tally = {
      accepted: row?.accepted ?? 0, rejected: row?.rejected ?? 0,
      pending: row?.pending ?? 0, total: row?.total ?? 0,
    };
    const siteRows = await tx<{ site_id: string }[]>`
      SELECT site_id FROM document_receipt WHERE version_id = ${input.versionId}`;
    const affectedSiteIds = siteRows.map((r) => r.site_id);
    await tx`
      UPDATE document_versions SET status = 'thu_hoi', recall_reason = ${input.reason.trim()}, updated_at = now()
       WHERE version_id = ${input.versionId}`;
    await writeAudit(tx as TransactionSql, {
      eventType: 'thu_hoi', actorUserId: input.userId,
      objectType: 'document_versions', objectId: input.versionId,
      afterState: { status: 'thu_hoi', reason: input.reason.trim(), tally, affected_site_ids: affectedSiteIds },
    });
  });
}

/**
 * Phát hành THÊM site (Author) cho tài liệu đã ban hành — Task publish-additional-sites.
 * Chỉ site TRONG scope; chặn khi có từ chối sai_noi_dung; phát hành lại site
 * từ chối sai_dang_ky (đưa receipt về cho_phan_hoi). Idempotent với site đã có
 * receipt chờ/chấp nhận. Không migration; tái dùng publishToSites + candidateSitesForScope.
 */
export async function publishAdditionalSites(
  sql: Sql,
  input: {
    versionId: string; userId: string; siteIds: string[];
    /** Ngày hiệu lực riêng khai khi thêm site (site_id -> YYYY-MM-DD). */
    siteEffectiveDates?: Record<string, string>;
  },
): Promise<{ added: number; republished: number }> {
  return (await sql.begin(async (tx) => {
    const v = await loadOwnedVersion(tx as TransactionSql, input.versionId, input.userId);
    if (v.status !== 'da_ban_hanh') {
      throw new BusinessError('publish.bad_status', 'Chỉ phát hành thêm khi tài liệu đang ở trạng thái đã ban hành');
    }
    // Điểm 6: tôn trọng khóa metadata — đã có site chấp nhận thì không phát hành
    // lại metadata cũ (dùng chung guard với editVersionMetadata).
    await assertNotAcceptedLocked(tx as TransactionSql, input.versionId);
    // Scope nằm ở documents; lấy để xác định site hợp lệ + dept đích (nếu scope=dept).
    // issued_date dùng để kiểm ngày hiệu lực riêng không sớm hơn ngày ban hành.
    const [doc] = await tx<{ doc_id: string; scope_level: 'group'|'bu'|'site'|'dept'; scope_bu_id: string|null; scope_site_id: string|null; scope_dept_id: string|null; issued_date: string | null }[]>`
      SELECT d.doc_id, d.scope_level, d.scope_bu_id, d.scope_site_id, d.scope_dept_id,
             ver.issued_date::text AS issued_date
        FROM document_versions ver JOIN documents d ON d.doc_id = ver.doc_id
       WHERE ver.version_id = ${input.versionId}`;
    if (!doc) throw new BusinessError('publish.not_found', 'Không tìm thấy tài liệu');

    const candidates = await candidateSitesForScope(tx as unknown as Sql, {
      scope_level: doc.scope_level, scope_bu_id: doc.scope_bu_id,
      scope_site_id: doc.scope_site_id, scope_dept_id: doc.scope_dept_id,
    });
    const existing = await tx<{ site_id: string; status: string; response_type: string | null }[]>`
      SELECT site_id, status, response_type FROM document_receipt WHERE version_id = ${input.versionId}`;

    const cls = classifySitesForRepublish({
      candidateSiteIds: candidates.map((c) => c.site_id),
      existingReceipts: existing,
      requestedSiteIds: input.siteIds,
    });

    if (cls.blockedByContentReject) {
      throw new BusinessError('publish.content_reject', 'Có site báo sai nội dung — phải thu hồi và ban hành phiên bản mới, không phát hành thêm');
    }
    if (cls.invalid.length > 0) {
      throw new BusinessError('publish.out_of_scope', 'Có site không thuộc phạm vi của tài liệu');
    }
    if (cls.newOnes.length === 0 && cls.republish.length === 0) {
      throw new BusinessError('publish.nothing', 'Không có site hợp lệ để phát hành thêm');
    }

    // Validate ngày hiệu lực riêng khai cho các site sắp phát hành/phát hành lại:
    // không về quá khứ (so với hôm nay giờ VN) và không sớm hơn ngày ban hành.
    const today = todayVN();
    const issued = doc.issued_date ? doc.issued_date.slice(0, 10) : null;
    const effDates = input.siteEffectiveDates ?? {};
    for (const siteId of [...cls.newOnes, ...cls.republish]) {
      const eff = effDates[siteId];
      if (!eff) continue;
      if (eff.slice(0, 10) < today) {
        throw new BusinessError('publish.effective_past', 'Ngày hiệu lực của site không được đặt về quá khứ');
      }
      if (issued && eff.slice(0, 10) < issued) {
        throw new BusinessError('publish.effective_before_issued', 'Ngày hiệu lực của site không được sớm hơn ngày ban hành');
      }
    }

    const targetDeptId = doc.scope_level === 'dept' ? (doc.scope_dept_id ?? null) : null;
    let added = 0;
    if (cls.newOnes.length > 0) {
      added = await publishToSites(tx as TransactionSql, {
        versionId: input.versionId, siteIds: cls.newOnes, targetDeptId, actorUserId: input.userId,
        siteEffectiveDates: input.siteEffectiveDates,
      });
    }

    let republished = 0;
    if (cls.republish.length > 0) {
      for (const siteId of cls.republish) {
        const siteEff = effDates[siteId] ?? null;
        await tx`
          UPDATE document_receipt
             SET status = 'cho_phan_hoi', response_type = NULL, response_note = NULL,
                 responded_by = NULL, responded_at = NULL, apply_date = NULL,
                 site_effective_date = ${siteEff}, updated_at = now()
           WHERE version_id = ${input.versionId} AND site_id = ${siteId}`;
      }
      republished = cls.republish.length;
      await writeAudit(tx as TransactionSql, {
        eventType: 'ban_hanh', actorUserId: input.userId,
        objectType: 'document_versions', objectId: input.versionId,
        afterState: { action: 're_publish', site_ids: cls.republish, prev_reject: 'sai_dang_ky' },
      });
    }
    return { added, republished };
  })) as { added: number; republished: number };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
