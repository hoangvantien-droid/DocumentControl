/**
 * src/domain/search.ts — tìm kiếm thông thường (T-055, T-056).
 *
 * Gọi fn_search_limited của CSDL. KHÔNG đọc embedding, KHÔNG đọc index_status —
 * tìm kiếm phải chạy được cả khi lớp AI ngừng (DCS-1 phần 6, REQ-K01). Lọc
 * phạm vi/hiệu lực là điều kiện truy vấn (nằm trong fn_search), không lọc sau.
 */
import type { Sql } from 'postgres';

export interface SearchHit {
  doc_id: string;
  version_id: string;
  version_no: string;
  title: string;
  status: string;
  section_code: string | null;
  section_title: string | null;
  snippet: string | null;
  match_level: string;
  rank: number;
}

/** Tìm kiếm đầy đủ (trang kết quả). Mặc định chỉ bản hiệu lực (REQ-K06). */
export async function search(
  sql: Sql,
  userId: string,
  q: string,
  includeHistorical = false,
  limit = 50,
): Promise<SearchHit[]> {
  if (!q.trim()) return [];
  return sql<SearchHit[]>`
    SELECT * FROM fn_search_limited(${userId}, ${q}, ${includeHistorical}, ${limit})`;
}

/**
 * Gợi ý nhanh cho ô tìm (sau 2 ký tự, tối đa 5). Khớp số hiệu lên đầu.
 *
 * Lỗi UAT G.1: gợi ý luôn trống vì fn_search_limited(..., FALSE) chỉ thấy bản
 * Hiệu lực — môi trường ít/không có bản hiệu lực thì ô tìm chết đứng.
 * Sửa: tìm cả bản đang làm dở (nháp/chờ xác nhận/đã đăng ký) trong phạm vi của
 * user, lọc bỏ bản hết hiệu lực/thu hồi/từ chối ở tầng ứng dụng.
 */
const SUGGESTABLE_STATUSES = new Set([
  'hieu_luc', 'da_dang_ky', 'cho_xac_nhan', 'cho_hoan_thien',
]);

export async function suggest(sql: Sql, userId: string, q: string): Promise<SearchHit[]> {
  if (q.trim().length < 2) return [];
  const hits = await sql<SearchHit[]>`
    SELECT * FROM fn_search_limited(${userId}, ${q}, TRUE, 10)`;
  return hits.filter((h) => SUGGESTABLE_STATUSES.has(h.status)).slice(0, 5);
}
