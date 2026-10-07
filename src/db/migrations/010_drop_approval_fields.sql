-- 010_drop_approval_fields.sql — bỏ quản lý phê duyệt khỏi DB.
-- Drop 4 cột: approver_name, approval_reference, approval_url, approval_method.
-- Viết lại fn_validate_version + v_current_documents (bỏ cột phê duyệt).

-- 1. Drop view phụ thuộc, tạo lại sau.
DROP VIEW IF EXISTS v_current_documents;

-- 2. Bỏ NOT NULL + CHECK liên quan trước.
ALTER TABLE document_versions DROP CONSTRAINT IF EXISTS document_versions_approver_name_not_null;
ALTER TABLE document_versions DROP CONSTRAINT IF EXISTS document_versions_approval_method_not_null;
ALTER TABLE document_versions DROP CONSTRAINT IF EXISTS document_versions_approval_method_check;

-- 3. Drop cột.
ALTER TABLE document_versions DROP COLUMN IF EXISTS approver_name;
ALTER TABLE document_versions DROP COLUMN IF EXISTS approval_reference;
ALTER TABLE document_versions DROP COLUMN IF EXISTS approval_url;
ALTER TABLE document_versions DROP COLUMN IF EXISTS approval_method;

-- 4. Viết lại trigger: bỏ ép approval_reference, giữ ép nhãn liên kết.
CREATE OR REPLACE FUNCTION fn_validate_version()
RETURNS TRIGGER AS $$
DECLARE
    v_link_cnt  INTEGER;
BEGIN
    IF NEW.status IN ('da_dang_ky', 'hieu_luc')
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
        SELECT count(*) INTO v_link_cnt
          FROM document_links WHERE version_id = NEW.version_id;
        IF v_link_cnt = 0 THEN
            RAISE EXCEPTION 'Phiên bản phải có ít nhất một nhãn liên kết trước khi đăng ký';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Tạo lại view không cột phê duyệt.
CREATE VIEW v_current_documents AS
SELECT d.doc_id, d.doc_type, d.origin,
       v.version_id, v.version_no, v.title,
       v.effective_date, v.next_review_date, v.expiry_date,
       v.owner_department_id, v.applicable_site_ids, v.required_reader_dept_ids,
       (v.next_review_date < CURRENT_DATE) AS qua_han_xem_xet
  FROM documents d
  JOIN document_versions v ON v.doc_id = d.doc_id AND v.status = 'hieu_luc';
