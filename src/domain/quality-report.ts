/**
 * src/domain/quality-report.ts — báo cáo chất lượng sau nạp (T-095, DCS-6 §5).
 *
 * Bốn kiểm tra chạy trước khi tuyên bố nạp xong:
 *  1. Tỷ lệ tài liệu có nhãn liên kết ở CẤP MỤC (không chỉ cấp tài liệu).
 *  2. Số điều khoản không có tài liệu nào viện dẫn (ở đây: số mã link phân bố).
 *  3. Tỷ lệ parse_status = kem_tin_cay.
 *  4. Phân bố nhãn liên kết — mã gắn vào quá nhiều tài liệu là dấu hiệu khai rộng.
 */
import type { Sql } from 'postgres';

export interface QualityReport {
  totalEffective: number;
  sectionLevelLinkRatio: number;   // % tài liệu có nhãn cấp mục
  poorParseRatio: number;          // % parse kém tin cậy
  topLinkCodes: { link_code: string; doc_count: number }[]; // phân bố nhãn
}

export async function qualityReport(sql: Sql): Promise<QualityReport> {
  const [tot] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM document_versions WHERE status = 'hieu_luc'`;
  const total = tot!.n;

  const [secLink] = await sql<{ n: number }[]>`
    SELECT count(DISTINCT v.version_id)::int AS n
      FROM document_versions v
      JOIN document_links l ON l.version_id = v.version_id AND l.section_id IS NOT NULL
     WHERE v.status = 'hieu_luc'`;

  const [poor] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM document_versions
     WHERE status = 'hieu_luc' AND parse_status = 'kem_tin_cay'`;

  const topLinkCodes = await sql<{ link_code: string; doc_count: number }[]>`
    SELECT l.link_code, count(DISTINCT v.doc_id)::int AS doc_count
      FROM document_links l JOIN document_versions v ON v.version_id = l.version_id
     WHERE l.link_type = 'dieu_khoan'
     GROUP BY l.link_code
     ORDER BY doc_count DESC
     LIMIT 10`;

  return {
    totalEffective: total,
    sectionLevelLinkRatio: total ? Math.round((secLink!.n / total) * 100) : 0,
    poorParseRatio: total ? Math.round((poor!.n / total) * 100) : 0,
    topLinkCodes,
  };
}
