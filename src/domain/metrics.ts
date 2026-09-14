/**
 * src/domain/metrics.ts — chỉ số mức độ sử dụng (T-103, DCS-9).
 *
 * Đo thứ quan trọng nhất mà ba chỉ số kiểm soát khác không đo được: hệ thống có
 * THỰC SỰ được dùng không. Lấy từ audit_log: lượt tìm kiếm, đăng nhập (phiên
 * tạo), mở tài liệu (xem) mỗi ngày. Nếu con số thấp, ba chỉ số kia vô nghĩa.
 */
import type { Sql } from 'postgres';

export interface UsageDay {
  ngay: string;
  luot_tim: number;
  luot_xem: number;
  luot_hoi_ai: number;
  luot_xac_nhan_doc: number;
}

/** Chỉ số sử dụng theo ngày, N ngày gần nhất. */
export async function usageMetrics(sql: Sql, days = 30): Promise<UsageDay[]> {
  return sql<UsageDay[]>`
    SELECT to_char(occurred_at::date, 'YYYY-MM-DD') AS ngay,
           count(*) FILTER (WHERE event_type = 'tim_kiem')::int      AS luot_tim,
           count(*) FILTER (WHERE event_type = 'xem')::int           AS luot_xem,
           count(*) FILTER (WHERE event_type = 'hoi_ai')::int        AS luot_hoi_ai,
           count(*) FILTER (WHERE event_type = 'xac_nhan_doc')::int  AS luot_xac_nhan_doc
      FROM audit_log
     WHERE occurred_at >= CURRENT_DATE - ${days}::int
     GROUP BY occurred_at::date
     ORDER BY occurred_at::date DESC`;
}

/** Tổng quan nhanh cho màn hình chỉ số. */
export async function usageSummary(sql: Sql): Promise<{
  effective_docs: number; total_users: number; acks_last_7d: number; searches_last_7d: number;
}> {
  const [row] = await sql<{
    effective_docs: number; total_users: number; acks_last_7d: number; searches_last_7d: number;
  }[]>`
    SELECT
      (SELECT count(*)::int FROM document_versions WHERE status = 'hieu_luc') AS effective_docs,
      (SELECT count(*)::int FROM users WHERE is_active)                AS total_users,
      (SELECT count(*)::int FROM audit_log WHERE event_type='xac_nhan_doc' AND occurred_at >= CURRENT_DATE - 7) AS acks_last_7d,
      (SELECT count(*)::int FROM audit_log WHERE event_type='tim_kiem' AND occurred_at >= CURRENT_DATE - 7)     AS searches_last_7d`;
  return row!;
}
