-- 009_dept_code_unique_per_site.sql — sửa lỗi #8 (UAT 2026-10-05, mức Chặn).
--
-- Triệu chứng: Admin tạo phòng ban mới bị 500
--   duplicate key value violates unique constraint "org_department_dept_code_key"
--   dù phòng ban KHÁC site. dept_code chỉ nên duy nhất TRONG MỘT site.
--
-- Sửa: bỏ ràng buộc UNIQUE (dept_code) đơn, thay bằng UNIQUE (dept_code, site_id).
-- KHÔNG đổi tệp 001 (schema gốc); migration này chạy SAU và ghi đè ý định.
-- Idempotent: DROP CONSTRAINT IF EXISTS + ADD, chạy lại nhiều lần vô hại.

ALTER TABLE org_department DROP CONSTRAINT IF EXISTS org_department_dept_code_key;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'org_department'::regclass
           AND conname = 'org_department_dept_code_site_key'
    ) THEN
        RAISE NOTICE 'Bỏ qua: unique (dept_code, site_id) đã tồn tại';
    ELSE
        ALTER TABLE org_department
            ADD CONSTRAINT org_department_dept_code_site_key UNIQUE (dept_code, site_id);
        RAISE NOTICE 'Đã tạo unique (dept_code, site_id) trên org_department';
    END IF;
END $$;
