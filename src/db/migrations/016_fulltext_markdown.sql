-- 016_fulltext_markdown.sql — chỉ mục toàn văn cấp phiên bản.
--
-- Bổ sung MỘT nguồn chỉ mục tìm kiếm MỚI phủ toàn bộ thân tài liệu, vá lỗ hổng:
-- mọi dòng thân KHÔNG khớp HEADING_RE (src/domain/extract.ts) không rơi vào
-- document_sections nào nên không bao giờ xuất hiện trong v_search_index.
--
-- Chạy theo trình chạy src/db/migrate.ts: mỗi file một giao dịch, theo thứ tự số.
-- KHÔNG dùng IF NOT EXISTS vì runner đã bỏ qua file đã chạy (idempotent ở tầng runner).

-- ------------------------------------------------------------
-- 1. Hai cột mới trên document_versions (mặc định NULL để tương thích phiên bản cũ)
--    - markdown_content: Markdown_Toàn_Văn (hiển thị + sẵn sàng MCP)
--    - fulltext_tsv:     Chỉ_Mục_Toàn_Văn (tsvector). NULL với Form hoặc bản chưa xử lý lại.
-- ------------------------------------------------------------
ALTER TABLE document_versions
  ADD COLUMN markdown_content TEXT,
  ADD COLUMN fulltext_tsv     tsvector;

-- ------------------------------------------------------------
-- 2. GIN index cho tsvector toàn văn (tra cứu @@ nhanh).
-- ------------------------------------------------------------
CREATE INDEX idx_docver_fulltext_tsv
  ON document_versions USING GIN (fulltext_tsv);

-- ------------------------------------------------------------
-- 3. Thay view để thêm nguồn fulltext cấp phiên bản. GIỮ NGUYÊN hai nhánh cũ
--    (document, section) và GIỮ NGUYÊN chính xác danh sách/kiểu cột của view để
--    fn_search/fn_search_limited KHÔNG cần sửa — chúng chỉ đọc si.search_tsv,
--    si.match_level, si.snippet từ view.
--
--    CREATE OR REPLACE VIEW đòi hỏi danh sách cột đầu ra khớp hệt bản cũ (cùng
--    tên, cùng thứ tự, cùng kiểu); chỉ được thêm cột ở cuối. Ở đây không đổi cột
--    nào nên hợp lệ.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_search_index AS
-- Nhánh 1: cấp tài liệu (giữ nguyên).
SELECT v.version_id, v.doc_id, v.version_no, v.title, v.status,
       v.effective_date, v.next_review_date, v.owner_department_id,
       d.doc_type, d.scope_level, d.scope_bu_id, d.scope_site_id, d.scope_dept_id,
       NULL::VARCHAR(30)  AS section_code,
       NULL::VARCHAR(300) AS section_title,
       NULL::TEXT         AS snippet,
       'document'::TEXT   AS match_level,
       v.search_tsv
  FROM document_versions v
  JOIN documents d ON d.doc_id = v.doc_id
UNION ALL
-- Nhánh 2: cấp mục (giữ nguyên).
SELECT v.version_id, v.doc_id, v.version_no, v.title, v.status,
       v.effective_date, v.next_review_date, v.owner_department_id,
       d.doc_type, d.scope_level, d.scope_bu_id, d.scope_site_id, d.scope_dept_id,
       s.section_code, s.section_title, left(coalesce(s.raw_text,''), 200),
       'section'::TEXT,
       s.search_tsv
  FROM document_sections s
  JOIN document_versions v ON v.version_id = s.version_id
  JOIN documents d ON d.doc_id = v.doc_id
UNION ALL
-- Nhánh 3 (MỚI): chỉ mục toàn văn cấp phiên bản. Chỉ sinh hàng cho phiên bản đã
-- có fulltext_tsv (lọc IS NOT NULL) — phiên bản cũ NULL không sinh hàng ở nhánh
-- này nhưng vẫn tìm được qua hai nhánh trên (tương thích ngược, không backfill).
-- vn_tsv dùng cấu hình 'simple' + vn_unaccent nên không dấu khớp có dấu.
SELECT v.version_id, v.doc_id, v.version_no, v.title, v.status,
       v.effective_date, v.next_review_date, v.owner_department_id,
       d.doc_type, d.scope_level, d.scope_bu_id, d.scope_site_id, d.scope_dept_id,
       NULL::VARCHAR(30)  AS section_code,
       NULL::VARCHAR(300) AS section_title,
       left(coalesce(v.markdown_content,''), 200),
       'fulltext'::TEXT   AS match_level,
       v.fulltext_tsv     AS search_tsv
  FROM document_versions v
  JOIN documents d ON d.doc_id = v.doc_id
 WHERE v.fulltext_tsv IS NOT NULL;
