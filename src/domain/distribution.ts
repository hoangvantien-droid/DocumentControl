/**
 * src/domain/distribution.ts — ma trận phân phối, giải người nhận PHÉP GIAO (T-065, T-066).
 *
 * Ma trận gắn với SỐ HIỆU (ổn định qua phiên bản), bộ phận BẮT BUỘC, nhóm chức
 * năng tuỳ chọn. Giải người nhận = PHÉP GIAO (v_distribution_resolved):
 *   nhóm rỗng  -> mọi người thuộc bộ phận
 *   nhóm có    -> người thuộc bộ phận VÀ là thành viên nhóm
 * KHÔNG đổi thành phép hợp (DCS-9 bẫy #5): nhóm sinh ra để THU HẸP đúng người.
 */
import type { Sql, TransactionSql } from 'postgres';
import { writeAudit } from '../lib/audit.js';

/**
 * Giải danh sách người nhận cho một tài liệu — PHÉP GIAO qua v_distribution_resolved.
 * Trả về số người phải đọc (dùng cho "số người sẽ nhận" trên form đăng ký).
 */
export async function resolveRecipients(sql: Sql, docId: string): Promise<string[]> {
  const rows = await sql<{ user_id: string }[]>`
    SELECT DISTINCT user_id FROM v_distribution_resolved WHERE doc_id = ${docId}`;
  return rows.map((r) => r.user_id);
}

/** Đếm số người sẽ nhận nếu thêm một dòng ma trận (bộ phận [+ nhóm]) — phép giao. */
export async function countRecipientsFor(
  sql: Sql,
  departmentId: string,
  functionalGroupId: string | null,
): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(DISTINCT ud.user_id)::int AS n
      FROM user_departments ud
     WHERE ud.dept_id = ${departmentId} AND ud.is_active
       AND (${functionalGroupId}::uuid IS NULL
            OR EXISTS (SELECT 1 FROM functional_group_members fm
                        WHERE fm.group_id = ${functionalGroupId} AND fm.user_id = ud.user_id))`;
  return rows[0]?.n ?? 0;
}
