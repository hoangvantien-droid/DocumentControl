-- 025_search_scope_ids.sql — thêm lọc theo BU / Site / Department CỤ THỂ.
--
-- 024 đã lọc theo CẤP phạm vi (p_scope_level). Nay thêm lọc theo ĐƠN VỊ cụ thể:
--   p_bu_id, p_site_id, p_dept_id (UUID, NULL = bỏ qua). Khớp với cột scope_*
--   của v_search_index. Giữ nguyên mọi tham số + cột trả về của 024 (tương thích
--   ngược: lời gọi cũ 4 tham số đầu vẫn chạy).

DROP FUNCTION IF EXISTS fn_search_limited(UUID, TEXT, BOOLEAN, INT, TEXT[], TEXT, TEXT, DATE, DATE, TEXT[], TEXT);
DROP FUNCTION IF EXISTS fn_search(UUID, TEXT, BOOLEAN, TEXT[], TEXT, TEXT, DATE, DATE, TEXT[], TEXT);

CREATE OR REPLACE FUNCTION fn_search(
    p_user UUID,
    p_q TEXT,
    p_include_historical BOOLEAN DEFAULT FALSE,
    p_doc_types TEXT[] DEFAULT NULL,
    p_origin TEXT DEFAULT NULL,
    p_scope_level TEXT DEFAULT NULL,
    p_eff_from DATE DEFAULT NULL,
    p_eff_to DATE DEFAULT NULL,
    p_match_levels TEXT[] DEFAULT NULL,
    p_sort TEXT DEFAULT NULL,
    p_bu_id UUID DEFAULT NULL,
    p_site_id UUID DEFAULT NULL,
    p_dept_id UUID DEFAULT NULL)
RETURNS TABLE (
    doc_id VARCHAR(50), version_id UUID, version_no VARCHAR(20), title VARCHAR(300),
    status VARCHAR(20), section_code VARCHAR(30), section_title VARCHAR(300),
    snippet TEXT, match_level TEXT, rank REAL,
    scope_level VARCHAR(20), effective_date DATE, next_review_date DATE,
    owner_department_id UUID, department_name VARCHAR(150), origin VARCHAR(10)
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
           END AS match_level,
           (CASE WHEN lower(si.doc_id) = lower(p_q) THEN 100.0
                 WHEN si.doc_id ILIKE '%'||p_q||'%' THEN 50.0
                 ELSE 0.0 END
            + ts_rank(si.search_tsv, plainto_tsquery('simple', q)))::REAL AS rank,
           si.scope_level, si.effective_date, si.next_review_date,
           si.owner_department_id, dp.name AS department_name, d.origin
      FROM v_search_index si
      JOIN documents d ON d.doc_id = si.doc_id
      LEFT JOIN org_department dp ON dp.dept_id = si.owner_department_id
     WHERE (p_include_historical OR si.status IN ('da_ban_hanh', 'hieu_luc'))
       AND (si.search_tsv @@ plainto_tsquery('simple', q)
            OR si.doc_id ILIKE '%'||p_q||'%')
       AND (p_doc_types IS NULL OR si.doc_type = ANY(p_doc_types))
       AND (p_origin IS NULL OR d.origin = p_origin)
       AND (p_scope_level IS NULL OR si.scope_level = p_scope_level)
       AND (p_bu_id   IS NULL OR si.scope_bu_id   = p_bu_id)
       AND (p_site_id IS NULL OR si.scope_site_id = p_site_id)
       AND (p_dept_id IS NULL OR si.scope_dept_id = p_dept_id)
       AND (p_eff_from IS NULL OR si.effective_date >= p_eff_from)
       AND (p_eff_to IS NULL OR si.effective_date <= p_eff_to)
       AND (p_match_levels IS NULL OR
            (CASE
               WHEN lower(si.doc_id) = lower(p_q) THEN 'doc_id'
               WHEN si.doc_id ILIKE '%'||p_q||'%' THEN 'doc_id_partial'
               ELSE si.match_level
             END) = ANY(p_match_levels))
       AND (si.scope_level = 'group'
            OR EXISTS (
                SELECT 1
                  FROM user_departments ud
                  JOIN org_department d2 ON d2.dept_id = ud.dept_id
                  JOIN org_site st ON st.site_id = d2.site_id
                 WHERE ud.user_id = p_user AND ud.is_active
                   AND ((si.scope_level = 'bu' AND EXISTS (
                          SELECT 1 FROM org_site_bu sb
                           WHERE sb.site_id = st.site_id AND sb.bu_id = si.scope_bu_id
                        ))
                     OR (si.scope_level = 'site' AND st.site_id = si.scope_site_id)
                     OR (si.scope_level = 'dept' AND d2.dept_id = si.scope_dept_id))))
     ORDER BY
       CASE WHEN p_sort = 'eff_new' THEN si.effective_date END DESC NULLS LAST,
       CASE WHEN p_sort = 'doc_id'  THEN si.doc_id END ASC,
       (CASE WHEN lower(si.doc_id) = lower(p_q) THEN 100.0
             WHEN si.doc_id ILIKE '%'||p_q||'%' THEN 50.0
             ELSE 0.0 END
        + ts_rank(si.search_tsv, plainto_tsquery('simple', q))) DESC;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION fn_search_limited(
    p_user UUID,
    p_q TEXT,
    p_include_historical BOOLEAN DEFAULT FALSE,
    p_limit INT DEFAULT 50,
    p_doc_types TEXT[] DEFAULT NULL,
    p_origin TEXT DEFAULT NULL,
    p_scope_level TEXT DEFAULT NULL,
    p_eff_from DATE DEFAULT NULL,
    p_eff_to DATE DEFAULT NULL,
    p_match_levels TEXT[] DEFAULT NULL,
    p_sort TEXT DEFAULT NULL,
    p_bu_id UUID DEFAULT NULL,
    p_site_id UUID DEFAULT NULL,
    p_dept_id UUID DEFAULT NULL)
RETURNS TABLE (
    doc_id VARCHAR(50), version_id UUID, version_no VARCHAR(20), title VARCHAR(300),
    status VARCHAR(20), section_code VARCHAR(30), section_title VARCHAR(300),
    snippet TEXT, match_level TEXT, rank REAL,
    scope_level VARCHAR(20), effective_date DATE, next_review_date DATE,
    owner_department_id UUID, department_name VARCHAR(150), origin VARCHAR(10)
) AS $$
    SELECT * FROM fn_search(p_user, p_q, p_include_historical,
                            p_doc_types, p_origin, p_scope_level,
                            p_eff_from, p_eff_to, p_match_levels, p_sort,
                            p_bu_id, p_site_id, p_dept_id)
     LIMIT p_limit;
$$ LANGUAGE sql STABLE;
