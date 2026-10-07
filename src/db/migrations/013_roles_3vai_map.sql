-- 013_roles_3vai_map.sql — map role cũ về 3 vai, giữ audit bằng is_active=false.
-- DC_SITE_QA_MANAGER/SITE + DC_BU_OWNER/BU + DC_GROUP_OWNER/GROUP -> DC_DEPT_HEAD/GROUP (phạm vi duyệt lấy từ Dept chính).
-- DC_READER/GROUP giữ nguyên (vai đọc, không duyệt).
UPDATE user_roles SET is_active = FALSE
 WHERE is_active AND role_code IN ('DC_SITE_QA_MANAGER','DC_BU_OWNER','DC_GROUP_OWNER');
INSERT INTO user_roles (user_id, role_code, scope_level, is_active)
SELECT DISTINCT user_id, 'DC_DEPT_HEAD', 'group', TRUE FROM user_roles
 WHERE role_code IN ('DC_SITE_QA_MANAGER','DC_BU_OWNER','DC_GROUP_OWNER')
ON CONFLICT (user_id, role_code, scope_level, scope_bu_id, scope_site_id, scope_dept_id)
DO UPDATE SET is_active = TRUE;
