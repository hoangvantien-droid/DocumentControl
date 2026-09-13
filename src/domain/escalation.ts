/**
 * src/domain/escalation.ts — leo thang tồn đọng (T-082).
 *
 * Gọi fn_run_escalations (đã sửa ở migration 004 để dùng app_user_role). Mỗi
 * bậc gửi ĐÚNG MỘT LẦN (ràng buộc uq_escalation). Chỉ thông báo, không đổi
 * trạng thái tài liệu. Chạy trong tác vụ nền hằng ngày.
 */
import type { Sql } from 'postgres';

/** Chạy leo thang. Trả về số thông báo đã gửi. */
export async function runEscalations(sql: Sql): Promise<number> {
  const rows = await sql<{ n: number }[]>`SELECT fn_run_escalations() AS n`;
  return rows[0]?.n ?? 0;
}

/** Toàn bộ tồn đọng (v_backlog_all) để hiển thị bảng theo dõi. */
export async function allBacklog(sql: Sql) {
  return sql<{
    backlog_type: string; object_id: string; department_id: string | null;
    holder_user_id: string | null; days_overdue: number;
  }[]>`
    SELECT backlog_type, object_id, department_id, holder_user_id, days_overdue
      FROM v_backlog_all ORDER BY days_overdue DESC`;
}
