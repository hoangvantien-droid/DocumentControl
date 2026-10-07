-- 012_roles_3vai.sql — 3 vai: Admin / Biên soạn / Phê duyệt gán ở cấp hệ thống.
-- Cho phép DC_DEPT_HEAD ở group (scope duyệt lấy từ Dept chính), giữ tương thích dept cũ.
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS chk_user_role_scope;
ALTER TABLE user_roles ADD CONSTRAINT chk_user_role_scope CHECK (
  (role_code IN ('DC_ADMIN','DC_AUTHOR','DC_READER','DC_GROUP_OWNER','DC_DEPT_HEAD') AND scope_level='group' AND scope_bu_id IS NULL AND scope_site_id IS NULL AND scope_dept_id IS NULL)
  OR (role_code='DC_BU_OWNER' AND scope_level='bu' AND scope_bu_id IS NOT NULL AND scope_site_id IS NULL AND scope_dept_id IS NULL)
  OR (role_code='DC_SITE_QA_MANAGER' AND scope_level='site' AND scope_bu_id IS NULL AND scope_site_id IS NOT NULL AND scope_dept_id IS NULL)
  OR (role_code='DC_DEPT_HEAD' AND scope_level='dept' AND scope_bu_id IS NULL AND scope_site_id IS NULL AND scope_dept_id IS NOT NULL)
);
