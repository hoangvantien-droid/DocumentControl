/**
 * src/domain/audit-query.ts — tra cứu ghi vết (REQ-G01/G02/G03).
 *
 * Chỉ ĐỌC audit_log (append-only, không sửa/xoá). Lọc theo đối tượng, loại sự
 * kiện, khoảng thời gian. Phục vụ trả lời "ai đã xem/tải bản nào lúc nào" và
 * chuẩn bị đánh giá.
 */
import type { Sql } from 'postgres';

export interface AuditRow {
  log_id: string;
  occurred_at: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_type: string;
  event_type: string;
  object_type: string;
  object_id: string;
}

export interface AuditFilter {
  objectId?: string;
  eventType?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

/** Danh sách loại sự kiện để lọc (từ CHECK audit_log.event_type). */
export const EVENT_TYPES = [
  'nop_dang_ky', 'rut_lai', 'sua_truoc_khi_nop',
  'xac_nhan', 'tu_choi_boi_admin', 'tu_choi_tu_dong', 'tich_checklist',
  'chuyen_hieu_luc', 'chuyen_het_hieu_luc', 'thu_hoi',
  'khai_nhan', 'sua_nhan', 'xac_nhan_nhan_chep',
  'xem', 'tai', 'in', 'tra_cuu_qr', 'xac_nhan_doc', 'hoi_ai',
  'xem_so_sanh', 'tim_kiem', 'sua_ma_tran', 'gui_thong_bao',
  'sinh_ra_soat', 'ket_luan_ra_soat', 'dong_ra_soat_theo_ban_moi',
  'tao_goi', 'gan_vao_goi', 'doi_ngay_goi', 'thao_thanh_vien',
  'giai_the_goi', 'kich_hoat_goi', 'leo_thang',
  'sua_khan_cap', 'kiem_toan_ven_tep', 'tieu_huy_ho_so', 'doi_so_hieu', 'dong_bo_l1',
] as const;

export async function queryAudit(sql: Sql, f: AuditFilter): Promise<AuditRow[]> {
  const limit = Math.min(f.limit ?? 200, 500);
  return sql<AuditRow[]>`
    SELECT a.log_id::text AS log_id,
           to_char(a.occurred_at, 'YYYY-MM-DD HH24:MI:SS') AS occurred_at,
           a.actor_user_id, u.full_name AS actor_name, a.actor_type,
           a.event_type, a.object_type, a.object_id
      FROM audit_log a
      LEFT JOIN app_user_ref u ON u.user_id = a.actor_user_id
     WHERE (${f.objectId ?? null}::text IS NULL OR a.object_id = ${f.objectId ?? null})
       AND (${f.eventType ?? null}::text IS NULL OR a.event_type = ${f.eventType ?? null})
       AND (${f.fromDate ?? null}::date IS NULL OR a.occurred_at >= ${f.fromDate ?? null}::date)
       AND (${f.toDate ?? null}::date IS NULL OR a.occurred_at < (${f.toDate ?? null}::date + 1))
     ORDER BY a.occurred_at DESC
     LIMIT ${limit}`;
}

/**
 * Truy hồi trạng thái tại một thời điểm quá khứ (REQ-G03): bản nào của một
 * doc_id đang hiệu lực vào ngày đã cho — suy từ sự kiện chuyển hiệu lực/hết hiệu lực.
 */
export async function stateAsOf(sql: Sql, docId: string, asOfDate: string) {
  return sql<{ version_no: string; effective_at: string }[]>`
    SELECT v.version_no, to_char(v.effective_at, 'YYYY-MM-DD') AS effective_at
      FROM document_versions v
     WHERE v.doc_id = ${docId}
       AND v.effective_at IS NOT NULL
       AND v.effective_at::date <= ${asOfDate}::date
     ORDER BY v.effective_at DESC
     LIMIT 1`;
}
