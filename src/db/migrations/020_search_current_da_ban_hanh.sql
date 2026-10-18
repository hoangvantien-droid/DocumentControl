-- 020_search_current_da_ban_hanh.sql — coi 'da_ban_hanh' là hiện hành trong
-- tìm kiếm/MCP và view tài liệu hiện hành.
--
-- Mô hình mới ban hành thẳng sang 'da_ban_hanh'. fn_search (Reader + MCP qua
-- fn_search_limited) trước đây chỉ coi 'hieu_luc' là hiện hành khi không tra
-- lịch sử. Mở rộng để tài liệu đã ban hành (da_ban_hanh) cũng tìm thấy mà
-- không cần include_historical. Giữ 'hieu_luc' (dữ liệu cũ).
--
-- v_current_documents: thêm nhánh da_ban_hanh để danh mục/preview hiện hành
-- bao gồm tài liệu mô hình mới.

-- 1. fn_search: điều kiện hiện hành = da_ban_hanh HOẶC hieu_luc.
CREATE OR REPLACE FUNCTION fn_search(
    p_user UUID, p_q TEXT, p_include_historical BOOLEAN DEFAULT FALSE)
RETURNS TABLE (
    doc_id VARCHAR(50), version_id UUID, version_no VARCHAR(20), title VARCHAR(300),
    status VARCHAR(20), section_code VARCHAR(30), section_title VARCHAR(300),
    snippet TEXT, match_level TEXT, rank REAL
) AS $$
DECLARE q TEXT := vn_unaccent(coalesce(p_q,''));
BEGIN
    RETURN QUERY
    SELECT si.doc_id, si.version_id, si.version_no, si.title, si.status,
           si.section_code, si.section_title, si.snippet,
           CASE
               WHEN lower(si.doc_id) = lower(p_q) THEN 'doc_id'
               WHEN si.doc_id ILIKE '%'||p_q||'%' THEN 'doc_id_partial'
               ELSE si.match_level
           END,
           (CASE WHEN lower(si.doc_id) = lower(p_q) THEN 100.0
                 WHEN si.doc_id ILIKE '%'||p_q||'%' THEN 50.0
                 ELSE 0.0 END
            + ts_rank(si.search_tsv, plainto_tsquery('simple', q)))::REAL
      FROM v_search_index si
     WHERE (p_include_historical OR si.status IN ('da_ban_hanh', 'hieu_luc'))
       AND (si.search_tsv @@ plainto_tsquery('simple', q)
            OR si.doc_id ILIKE '%'||p_q||'%')
       AND (si.scope_level = 'group'
            OR EXISTS (
                SELECT 1
                  FROM user_departments ud
                  JOIN org_department dp ON dp.dept_id = ud.dept_id
                  JOIN org_site st ON st.site_id = dp.site_id
                 WHERE ud.user_id = p_user AND ud.is_active
                   AND ((si.scope_level = 'bu' AND EXISTS (
                          SELECT 1 FROM org_site_bu sb
                           WHERE sb.site_id = st.site_id AND sb.bu_id = si.scope_bu_id
                        ))
                     OR (si.scope_level = 'site' AND st.site_id = si.scope_site_id)
                     OR (si.scope_level = 'dept' AND dp.dept_id = si.scope_dept_id))))
     ORDER BY 10 DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- 2. v_current_documents: bao gồm cả da_ban_hanh. Drop + tạo lại (có thể có
--    view phụ thuộc — không có ở đây).
DROP VIEW IF EXISTS v_current_documents;
CREATE VIEW v_current_documents AS
SELECT d.doc_id, d.doc_type, d.origin,
       v.version_id, v.version_no, v.title,
       v.effective_date, v.next_review_date, v.expiry_date,
       v.owner_department_id,
       (v.next_review_date < CURRENT_DATE) AS qua_han_xem_xet
  FROM documents d
  JOIN document_versions v ON v.doc_id = d.doc_id
 WHERE v.status IN ('da_ban_hanh', 'hieu_luc');
