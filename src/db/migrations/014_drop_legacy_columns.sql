-- 014_drop_legacy_columns.sql — dọn 2 cột lỗi thời trên document_versions.
--
-- applicable_site_ids: đã bị document_site_rollout (migration 011) thay thế.
--   Migration 011 đã backfill từ cột này sang bảng rollout; từ đó không còn code
--   nào ghi vào cột. Nguồn sự thật về site giờ là document_site_rollout.
-- required_reader_dept_ids: khái niệm "bộ phận phải đọc" song song với ma trận
--   phân phối (distribution_matrix / v_distribution_resolved) — cơ chế người-nhận
--   thực thi là ma trận, nên cột này nhân đôi khái niệm và không được dùng để
--   quyết định. Bỏ để tránh hai nguồn sự thật.
--
-- Phải DROP VIEW v_current_documents trước (view SELECT hai cột này), rồi tạo
-- lại không hai cột đó.

-- 1. Drop view phụ thuộc.
DROP VIEW IF EXISTS v_current_documents;

-- 2. Drop 2 cột lỗi thời.
ALTER TABLE document_versions DROP COLUMN IF EXISTS applicable_site_ids;
ALTER TABLE document_versions DROP COLUMN IF EXISTS required_reader_dept_ids;

-- 3. Tạo lại view không hai cột đã bỏ (giữ nguyên các cột còn lại).
CREATE VIEW v_current_documents AS
SELECT d.doc_id, d.doc_type, d.origin,
       v.version_id, v.version_no, v.title,
       v.effective_date, v.next_review_date, v.expiry_date,
       v.owner_department_id,
       (v.next_review_date < CURRENT_DATE) AS qua_han_xem_xet
  FROM documents d
  JOIN document_versions v ON v.doc_id = d.doc_id AND v.status = 'hieu_luc';
