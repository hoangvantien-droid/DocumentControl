/**
 * src/lib/audit.ts — ghi vết append-only (DCS-3 §G, DCS-8 §3.4).
 *
 * QUY TẮC TUYỆT ĐỐI: mọi hàm domain/ làm thay đổi trạng thái phải ghi vết
 * TRONG CÙNG MỘT GIAO DỊCH với thay đổi đó. Vì vậy writeAudit BẮT BUỘC nhận
 * một transaction (tx) — không có biến thể chạy ngoài giao dịch. Nếu ghi vết
 * ở lời gọi riêng và lời gọi đó hỏng, sẽ có thay đổi không dấu vết — đúng thứ
 * nguyên tắc số 8 của DCS-1 cấm (DCS-9 bẫy số 2).
 *
 * Bảng audit_log là append-only ở tầng DB (rule chặn UPDATE/DELETE). Tầng này
 * chỉ INSERT.
 */
import type { Sql, TransactionSql } from 'postgres';

/** Loại tác nhân — khớp CHECK trên audit_log.actor_type. */
export type ActorType = 'nguoi' | 'he_thong' | 'api';

/**
 * Mã sự kiện — khớp CHECK trên audit_log.event_type (đã gộp cả bổ sung ở
 * phụ lục B của DCS-4). Giữ nguyên tiếng Việt không dấu (DCS-8 §3.2).
 */
export type EventType =
  | 'nop_dang_ky' | 'rut_lai' | 'sua_truoc_khi_nop'
  | 'xac_nhan' | 'tu_choi_boi_admin' | 'tu_choi_tu_dong' | 'tich_checklist'
  | 'chuyen_hieu_luc' | 'chuyen_het_hieu_luc' | 'thu_hoi'
  | 'khai_nhan' | 'sua_nhan' | 'xac_nhan_nhan_chep'
  | 'xem' | 'tai' | 'in' | 'tra_cuu_qr' | 'xac_nhan_doc' | 'hoi_ai'
  | 'xem_so_sanh' | 'tim_kiem'
  | 'sua_ma_tran' | 'gui_thong_bao'
  | 'sinh_ra_soat' | 'ket_luan_ra_soat' | 'dong_ra_soat_theo_ban_moi'
  | 'tao_goi' | 'gan_vao_goi' | 'doi_ngay_goi' | 'thao_thanh_vien'
  | 'giai_the_goi' | 'kich_hoat_goi' | 'leo_thang'
  | 'sua_khan_cap' | 'dong_hau_kiem_khan_cap'
  | 'kiem_toan_ven_tep' | 'tieu_huy_ho_so' | 'doi_so_hieu' | 'dong_bo_l1' | 'dang_nhap' | 'dang_xuat' | 'xoa_nhan' | 'xoa_ma_tran';

export interface AuditEntry {
  eventType: EventType;
  objectType: string;
  /** Khoá của đối tượng; audit_log.object_id giới hạn 64 ký tự. */
  objectId: string;
  actorType?: ActorType;
  /** NULL khi tác nhân là hệ thống. */
  actorUserId?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
  /** ip, thiết bị, phiên; với hoi_ai: chunk_ids_used. */
  context?: unknown;
}

/**
 * Ghi một bản ghi vết trong giao dịch `tx`. Bắt buộc truyền tx để không thể
 * vô tình ghi ngoài giao dịch của thay đổi.
 */
export async function writeAudit(
  tx: TransactionSql,
  entry: AuditEntry,
): Promise<void> {
  const objectId = entry.objectId.slice(0, 64); // an toàn với giới hạn cột
  await tx`
    INSERT INTO audit_log
      (actor_user_id, actor_type, event_type, object_type, object_id,
       before_state, after_state, context)
    VALUES
      (${entry.actorUserId ?? null},
       ${entry.actorType ?? 'nguoi'},
       ${entry.eventType},
       ${entry.objectType},
       ${objectId},
       ${entry.beforeState !== undefined ? tx.json(entry.beforeState as never) : null},
       ${entry.afterState !== undefined ? tx.json(entry.afterState as never) : null},
       ${entry.context !== undefined ? tx.json(entry.context as never) : null})`;
}

/**
 * Tiện ích: chạy một khối nghiệp vụ VÀ ghi vết trong cùng một giao dịch.
 * Khối nhận tx và trả về entry ghi vết (hoặc mảng entry). Nếu khối ném lỗi,
 * cả thay đổi lẫn ghi vết cùng rollback.
 */
export async function withAudit<T>(
  sql: Sql,
  work: (tx: TransactionSql) => Promise<{ result: T; audit: AuditEntry | AuditEntry[] }>,
): Promise<T> {
  return sql.begin(async (tx) => {
    const { result, audit } = await work(tx as TransactionSql);
    const entries = Array.isArray(audit) ? audit : [audit];
    for (const e of entries) await writeAudit(tx as TransactionSql, e);
    return result;
  }) as Promise<T>;
}
