/**
 * src/domain/printing.ts — bản in kiểm soát + tra cứu QR (T-085, T-086).
 *
 * Mỗi lần in sinh một bản ghi printed_copies với verify_token NGẪU NHIÊN
 * (DEFAULT gen_random_bytes ở DB, không tuần tự — chống dò quét). Lớp phủ đóng
 * KHI KẾT XUẤT, không sửa tệp gốc (nguyên tắc số 2). Tra cứu QR chỉ trả TÌNH
 * TRẠNG, tuyệt đối không trả nội dung tài liệu.
 */
import type { Sql, TransactionSql } from 'postgres';
import { BusinessError } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
import { canViewVersion } from './catalog.js';
import { isCurrentlyEffective } from './lifecycle-status.js';
import QRCode from 'qrcode';

export interface PrintRecord {
  print_id: string;
  verify_token: string;
  doc_id: string;
  version_no: string;
  printed_at: string;
  /** URL tra cứu đầy đủ (public, không cần đăng nhập) để dựng QR. */
  verifyUrl: string;
  /** SVG QR inline (lỗi #14) — trước đây chỉ in text đường dẫn. */
  qrSvg: string;
}

/** Ghi nhận một lần in — sinh verify_token ngẫu nhiên (DB default). */
export async function registerPrint(
  sql: Sql,
  input: { versionId: string; printedBy: string; intendedLocation?: string | null; siteId?: string | null; basePath: string; publicUrl: string },
): Promise<PrintRecord> {
  return sql.begin(async (tx) => {
    const allowed = await canViewVersion(tx as unknown as Sql, input.printedBy, input.versionId);
    if (!allowed) {
      throw new BusinessError('print.no_permission', 'Không có quyền in tài liệu này', { httpStatus: 403 });
    }
    const v = (await tx<{ status: string; doc_id: string; version_no: string }[]>`
      SELECT status, doc_id, version_no FROM document_versions WHERE version_id = ${input.versionId}`)[0];
    if (!v) throw new BusinessError('print.no_version', 'Không tìm thấy phiên bản');
    if (v.status !== 'hieu_luc') {
      throw new BusinessError('print.not_effective', 'Chỉ in được bản đang hiệu lực');
    }
    const row = (await tx<{ print_id: string; verify_token: string; printed_at: string }[]>`
      INSERT INTO printed_copies (version_id, printed_by, intended_location, overlay_applied)
      VALUES (${input.versionId}, ${input.printedBy}, ${input.intendedLocation ?? null}, TRUE)
      RETURNING print_id, verify_token, printed_at::text AS printed_at`)[0]!;
    await writeAudit(tx as TransactionSql, {
      eventType: 'in', actorUserId: input.printedBy,
      objectType: 'document_versions', objectId: input.versionId,
      afterState: { print_id: row.print_id },
    });
    const siteQs = input.siteId ? `?site_id=${encodeURIComponent(input.siteId)}` : '';
    const verifyUrl = `${input.publicUrl}${input.basePath}/verify/${row.verify_token}${siteQs}`;
    const qrSvg = await QRCode.toString(verifyUrl, { type: 'svg', width: 120, margin: 1 });
    return {
      print_id: row.print_id, verify_token: row.verify_token,
      doc_id: v.doc_id, version_no: v.version_no, printed_at: row.printed_at,
      verifyUrl, qrSvg,
    };
  }) as Promise<PrintRecord>;
}

export interface VerifyResult {
  found: boolean;
  /** con_hieu_luc | het_hieu_luc | thu_hoi | ban_in_thu_hoi | khong_ro
   *  | chua_tiep_nhan | tu_choi_tiep_nhan (trạng thái theo site nhận) */
  status: string;
  doc_id?: string;
  version_no?: string;
  /** Phiên bản hiện hành mới nhất của số hiệu (nếu bản in đã lỗi thời). */
  currentVersionNo?: string | null;
  /** Thông tin tiếp nhận tại site (khi quét kèm ?site_id=). */
  site_code?: string | null;
  site_name?: string | null;
  /** cho_phan_hoi | chap_nhan | tu_choi — trạng thái tiếp nhận của site. */
  receipt_status?: string | null;
  apply_date?: string | null;
  reject_type?: string | null;
}

/**
 * Tra cứu QR — KHÔNG cần đăng nhập, CHỈ trả tình trạng "tờ này còn dùng được
 * không". Tuyệt đối không trả nội dung tài liệu, nhãn, danh sách người nhận.
 */
export async function verifyToken(sql: Sql, token: string, siteId?: string | null): Promise<VerifyResult> {
  const rows = await sql<{
    recall_status: string; ver_status: string; doc_id: string; version_no: string; version_id: string;
  }[]>`
    SELECT p.recall_status, v.status AS ver_status, v.doc_id, v.version_no, v.version_id
      FROM printed_copies p JOIN document_versions v ON v.version_id = p.version_id
     WHERE p.verify_token = ${token}`;
  const row = rows[0];
  if (!row) return { found: false, status: 'khong_ro' };

  // Bản sao in đã bị thu hồi tại hiện trường.
  if (row.recall_status === 'da_thu_hoi') {
    return { found: true, status: 'ban_in_thu_hoi', doc_id: row.doc_id, version_no: row.version_no };
  }

  // Phiên bản hiện hành mới nhất của số hiệu (mô hình mới: da_ban_hanh/hieu_luc).
  const current = (await sql<{ version_no: string }[]>`
    SELECT version_no FROM document_versions
     WHERE doc_id = ${row.doc_id} AND status IN ('da_ban_hanh', 'hieu_luc')
     ORDER BY version_no DESC LIMIT 1`)[0];

  let status = 'khong_ro';
  if (isCurrentlyEffective(row.ver_status)) status = 'con_hieu_luc';
  else if (row.ver_status === 'thu_hoi') status = 'thu_hoi';
  else if (row.ver_status === 'het_hieu_luc') status = 'het_hieu_luc';

  // Thông tin tiếp nhận theo site (mô hình receipt) khi quét kèm ?site_id=.
  let site_code: string | null = null, site_name: string | null = null;
  let receipt_status: string | null = null, apply_date: string | null = null, reject_type: string | null = null;
  if (siteId) {
    const rr = (await sql<{
      site_code: string; site_name: string; status: string; apply_date: string | null; response_type: string | null;
    }[]>`
      SELECT s.site_code, s.name AS site_name, r.status,
             r.apply_date::text AS apply_date, r.response_type
        FROM document_receipt r JOIN org_site s ON s.site_id = r.site_id
       WHERE r.version_id = ${row.version_id} AND r.site_id = ${siteId}`)[0];
    if (rr) {
      site_code = rr.site_code; site_name = rr.site_name;
      receipt_status = rr.status; apply_date = rr.apply_date; reject_type = rr.response_type;
      // Ghi đè trạng thái theo tình trạng tiếp nhận của site.
      if (status === 'con_hieu_luc') {
        if (rr.status === 'cho_phan_hoi') status = 'chua_tiep_nhan';
        else if (rr.status === 'tu_choi') status = 'tu_choi_tiep_nhan';
      }
    }
  }

  return {
    found: true, status, doc_id: row.doc_id, version_no: row.version_no,
    currentVersionNo: current?.version_no ?? null,
    site_code, site_name, receipt_status, apply_date, reject_type,
  };
}

/** Ghi vết một lượt tra cứu QR (không cần user). */
export async function auditQrLookup(sql: Sql, token: string): Promise<void> {
  await sql.begin(async (tx) => {
    await writeAudit(tx as TransactionSql, {
      eventType: 'tra_cuu_qr', actorType: 'he_thong',
      objectType: 'printed_copies', objectId: token.slice(0, 64),
    });
  });
}
