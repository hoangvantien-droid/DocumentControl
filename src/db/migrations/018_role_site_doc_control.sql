-- 018_role_site_doc_control.sql — thêm vai DC_SITE_DOC_CONTROL (Kiểm soát tài
-- liệu site) cho mô hình receipt mới.
--
-- Vai này đại diện cho SITE nhận: chấp nhận/từ chối receipt của site mình và
-- thẩm định report của Reader trong site. Gán theo phạm vi SITE (any-of: 1-2
-- người/site). Khác hẳn vai duyệt-trước cũ (DC_DEPT_HEAD) vốn gác cổng ở nguồn.
--
-- Giữ các mã cũ trong CHECK để dữ liệu/giai đoạn chuyển đổi không vỡ; Task 9
-- dọn các vai gác cổng nguồn không còn dùng.

-- 1. Cho phép mã vai mới.
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS chk_user_role_code;
ALTER TABLE user_roles ADD CONSTRAINT chk_user_role_code CHECK (
  role_code IN (
    'DC_ADMIN', 'DC_AUTHOR', 'DC_SITE_DOC_CONTROL', 'DC_READER',
    -- mã cũ (giữ cho dữ liệu lịch sử / chuyển đổi)
    'DC_DEPT_HEAD', 'DC_SITE_QA_MANAGER', 'DC_BU_OWNER', 'DC_GROUP_OWNER'
  )
);

-- 2. Phạm vi gán vai:
--    - DC_SITE_DOC_CONTROL gán ở cấp SITE (bắt buộc có scope_site_id).
--    - DC_ADMIN / DC_AUTHOR / DC_READER ở cấp group (vai hệ thống).
--    - Giữ nhánh mã cũ để bản ghi lịch sử không vi phạm.
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS chk_user_role_scope;
ALTER TABLE user_roles ADD CONSTRAINT chk_user_role_scope CHECK (
     (role_code IN ('DC_ADMIN', 'DC_AUTHOR', 'DC_READER', 'DC_GROUP_OWNER', 'DC_DEPT_HEAD')
       AND scope_level = 'group'
       AND scope_bu_id IS NULL AND scope_site_id IS NULL AND scope_dept_id IS NULL)
  OR (role_code = 'DC_SITE_DOC_CONTROL'
       AND scope_level = 'site'
       AND scope_bu_id IS NULL AND scope_site_id IS NOT NULL AND scope_dept_id IS NULL)
  OR (role_code = 'DC_BU_OWNER'
       AND scope_level = 'bu'
       AND scope_bu_id IS NOT NULL AND scope_site_id IS NULL AND scope_dept_id IS NULL)
  OR (role_code = 'DC_SITE_QA_MANAGER'
       AND scope_level = 'site'
       AND scope_bu_id IS NULL AND scope_site_id IS NOT NULL AND scope_dept_id IS NULL)
);
