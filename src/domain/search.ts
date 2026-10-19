/**
 * src/domain/search.ts — tìm kiếm thông thường (T-055, T-056) + bộ lọc đa chiều.
 *
 * Gọi fn_search_limited của CSDL. KHÔNG đọc embedding, KHÔNG đọc index_status —
 * tìm kiếm phải chạy được cả khi lớp AI ngừng (DCS-1 phần 6, REQ-K01). Lọc
 * phạm vi/hiệu lực/đa chiều là điều kiện truy vấn (nằm trong fn_search), không lọc sau.
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
  // Làm giàu thẻ kết quả (migration 023).
  scope_level: string | null;
  effective_date: string | null;
  next_review_date: string | null;
  owner_department_id: string | null;
  department_name: string | null;
  origin: string | null;
}

export interface SearchFilters {
  docTypes?: string[] | null;
  origin?: string | null;
  scopeLevel?: string | null;
  effFrom?: string | null;
  effTo?: string | null;
  matchLevels?: string[] | null;
  sort?: string | null;
  buId?: string | null;
  siteId?: string | null;
  deptId?: string | null;
}

/** Chuẩn hoá mảng filter: rỗng -> null (bỏ lọc). */
function arrOrNull(a?: string[] | null): string[] | null {
  if (!a) return null;
  const clean = a.map((x) => (x ?? '').trim()).filter(Boolean);
  return clean.length ? clean : null;
}
function strOrNull(s?: string | null): string | null {
  const v = (s ?? '').trim();
  return v || null;
}

/** Tìm kiếm đầy đủ (trang kết quả). Mặc định chỉ bản hiệu lực (REQ-K06). */
export async function search(
  sql: Sql,
  userId: string,
  q: string,
  includeHistorical = false,
  filters: SearchFilters = {},
  limit = 50,
): Promise<SearchHit[]> {
  if (!q.trim()) return [];
  const docTypes = arrOrNull(filters.docTypes);
  const matchLevels = arrOrNull(filters.matchLevels);
  const origin = strOrNull(filters.origin);
  const scopeLevel = strOrNull(filters.scopeLevel);
  const effFrom = strOrNull(filters.effFrom);
  const effTo = strOrNull(filters.effTo);
  const sort = strOrNull(filters.sort);
  const buId = strOrNull(filters.buId);
  const siteId = strOrNull(filters.siteId);
  const deptId = strOrNull(filters.deptId);
  return sql<SearchHit[]>`
    SELECT * FROM fn_search_limited(
      ${userId}, ${q}, ${includeHistorical}, ${limit},
      ${docTypes}::text[], ${origin}::text, ${scopeLevel}::text,
      ${effFrom}::date, ${effTo}::date, ${matchLevels}::text[], ${sort}::text,
      ${buId}::uuid, ${siteId}::uuid, ${deptId}::uuid)`;
}

/** Gợi ý nhanh cho ô tìm (sau 2 ký tự, tối đa 5). Khớp số hiệu lên đầu. */
export async function suggest(sql: Sql, userId: string, q: string): Promise<SearchHit[]> {
  if (q.trim().length < 2) return [];
  return sql<SearchHit[]>`
    SELECT * FROM fn_search_limited(${userId}, ${q}, FALSE, 5)`;
}
