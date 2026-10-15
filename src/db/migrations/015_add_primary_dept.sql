-- 015_add_primary_dept.sql — bổ sung users.primary_dept_id (Dept chính suy scope release).
--
-- getUserScope (src/domain/permissions.ts) đọc users.primary_dept_id nhưng
-- không migration nào tạo cột này (bug schema §1.5 trong KE-HOACH-TEST-TOAN-DIEN).
-- Migration này bổ sung cột + FK về org_department + index.
-- View app_user_ref (SELECT u.*) phải tạo lại để thấy cột mới vì Postgres
-- mở rộng SELECT * tại thời điểm CREATE VIEW.

ALTER TABLE users ADD COLUMN IF NOT EXISTS primary_dept_id UUID REFERENCES org_department(dept_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_primary_dept ON users(primary_dept_id);

DROP VIEW IF EXISTS app_user_ref;
CREATE VIEW app_user_ref AS
SELECT u.* FROM users u CROSS JOIN (VALUES (TRUE)) AS compatibility(read_only);
