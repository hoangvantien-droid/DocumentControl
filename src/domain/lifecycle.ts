/**
 * src/domain/lifecycle.ts — vòng đời tài liệu theo lịch (T-035).
 *
 * Chuyển hiệu lực theo lịch giao cho hàm CSDL fn_activate_due_versions. Thu hồi
 * thủ công của mô hình dept-head cũ đã gỡ: mô hình mới thu hồi do Author
 * (recallByAuthor trong domain/receipt.ts).
 */
import type { Sql } from 'postgres';

/** Chạy chuyển hiệu lực theo ngày. Trả về số phiên bản đã kích hoạt. */
export async function activateDueVersions(sql: Sql): Promise<number> {
  const rows = await sql<{ n: number }[]>`SELECT fn_activate_due_versions() AS n`;
  return rows[0]?.n ?? 0;
}

/** Sinh bản ghi rà soát cho tài liệu tới hạn. Trả về số bản ghi sinh mới. */
export async function generateDueReviews(sql: Sql): Promise<number> {
  const rows = await sql<{ n: number }[]>`SELECT fn_generate_due_reviews() AS n`;
  return rows[0]?.n ?? 0;
}
