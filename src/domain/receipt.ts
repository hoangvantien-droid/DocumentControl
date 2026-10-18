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
  },
): Promise<number> {
  let created = 0;
  for (const siteId of input.siteIds) {
    const rows = await tx<{ receipt_id: string }[]>`
      INSERT INTO document_receipt (version_id, site_id, target_dept_id, status)
      VALUES (${input.versionId}, ${siteId}, ${input.targetDeptId ?? null}, 'cho_phan_hoi')
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
           v.doc_id, v.version_no, v.title, v.registrant_user_id,
           (SELECT r2.response_type FROM document_receipt r2
             WHERE r2.version_id = r.version_id AND r2.status = 'tu_choi'
             ORDER BY CASE r2.response_type WHEN 'sai_noi_dung' THEN 0 ELSE 1 END
             LIMIT 1) AS other_reject_type
      FROM document_receipt r
      JOIN org_site s ON s.site_id = r.site_id
      JOIN document_versions v ON v.version_id = r.version_id
     WHERE r.status = 'cho_phan_hoi'
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
           r.responded_by, r.responded_at::text AS responded_at
      FROM document_receipt r
      JOIN org_site s ON s.site_id = r.site_id
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
}

async function loadReceiptForRespond(
  tx: TransactionSql,
  receiptId: string,
): Promise<ReceiptContext | null> {
  const rows = await tx<ReceiptContext[]>`
    SELECT r.receipt_id, r.version_id, r.site_id, r.status,
           v.registrant_user_id
      FROM document_receipt r
      JOIN document_versions v ON v.version_id = r.version_id
     WHERE r.receipt_id = ${receiptId}
     FOR UPDATE OF r`;
  return rows[0] ?? null;
}

/** Kiểm quyền + phát hiện tự-phản-hồi, dùng chung cho chấp nhận/từ chối. */
async function assertCanRespond(
  tx: TransactionSql,
  rc: ReceiptContext,
  userId: string,
): Promise<{ selfResponded: boolean }> {
  if (rc.status !== 'cho_phan_hoi') {
    throw new BusinessError('receipt.bad_status', 'Receipt không còn ở trạng thái chờ phản hồi');
  }
  const siteIds = await siteIdsWithDocControl(tx as unknown as Sql, userId);
  if (!siteIds.has(rc.site_id)) {
    throw new BusinessError('receipt.no_permission', 'Không đủ thẩm quyền phản hồi receipt của site này', { httpStatus: 403 });
  }
  return { selfResponded: rc.registrant_user_id === userId };
}

/** DC Site chấp nhận receipt: ghi apply_date = ngày chấp nhận (mỗi site một mốc). */
export async function acceptReceipt(
  sql: Sql,
  input: { receiptId: string; userId: string; applyDate?: string },
): Promise<void> {
  await sql.begin(async (tx) => {
    const rc = await loadReceiptForRespond(tx as TransactionSql, input.receiptId);
    if (!rc) throw new BusinessError('receipt.not_found', 'Không tìm thấy receipt');
    const { selfResponded } = await assertCanRespond(tx as TransactionSql, rc, input.userId);

    const applyDate = input.applyDate || today();
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
    const { selfResponded } = await assertCanRespond(tx as TransactionSql, rc, input.userId);

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
    if (await acceptedCount(tx as TransactionSql, input.versionId) > 0) {
      throw new BusinessError('edit.locked', 'Đã có site chấp nhận/áp dụng — không sửa trực tiếp, phải ra phiên bản mới');
    }
    const p = input.patch;
    await tx`
      UPDATE document_versions SET
        title = coalesce(${p.title ?? null}, title),
        issued_date = coalesce(${p.issuedDate ?? null}, issued_date),
        effective_date = coalesce(${p.effectiveDate ?? null}, effective_date),
        review_cycle_months = coalesce(${p.reviewCycleMonths ?? null}, review_cycle_months),
        expiry_date = ${p.expiryDate === undefined ? null : p.expiryDate},
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
    const [row] = await tx<{ accepted: number; rejected: number }[]>`
      SELECT count(*) FILTER (WHERE status = 'chap_nhan')::int AS accepted,
             count(*) FILTER (WHERE status = 'tu_choi')::int AS rejected
        FROM document_receipt WHERE version_id = ${input.versionId}`;
    const accepted = row?.accepted ?? 0;
    const rejected = row?.rejected ?? 0;
    if (accepted > 0 && rejected === 0) {
      throw new BusinessError('recall.locked', 'Đã có site chấp nhận và không có từ chối — không thuộc diện Author tự thu hồi');
    }
    await tx`
      UPDATE document_versions SET status = 'thu_hoi', recall_reason = ${input.reason.trim()}, updated_at = now()
       WHERE version_id = ${input.versionId}`;
    await writeAudit(tx as TransactionSql, {
      eventType: 'thu_hoi', actorUserId: input.userId,
      objectType: 'document_versions', objectId: input.versionId,
      afterState: { status: 'thu_hoi', reason: input.reason.trim() },
    });
  });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
