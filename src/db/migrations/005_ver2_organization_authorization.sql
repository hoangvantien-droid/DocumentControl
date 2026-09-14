-- 005_ver2_organization_authorization.sql
--
-- Chuyển mô hình giai đoạn 1 sang Ver2 mà không tạo lại dữ liệu:
--   * DCS sở hữu người dùng, gán bộ phận và vai trò dưới tên bảng chuẩn.
--   * Site ↔ BU là quan hệ N:N qua org_site_bu.
--   * Bảy vai trò Ver2 và quyền release đúng cấp/đúng phạm vi.
--
-- Migration này đổi tên bảng để PostgreSQL tự giữ toàn bộ UUID và foreign key
-- lịch sử. Các view app_user_* chỉ dùng tương thích đọc cho hàm SQL cũ; mã ứng
-- dụng phải dùng users/user_departments/user_roles từ migration này trở đi.
-- KHÔNG chạy trực tiếp trên production trước khi backup và rehearsal dữ liệu.

-- ============================================================
-- 1. DCS sở hữu định danh, gán bộ phận và vai trò
-- ============================================================
ALTER TABLE app_user_ref  RENAME TO users;
ALTER TABLE app_user_dept RENAME TO user_departments;
ALTER TABLE app_user_role RENAME TO user_roles;

-- Các cột đã được tạo ở migration giai đoạn 1 nay là dữ liệu thường trực của DCS.
ALTER TABLE users
    ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- users đã là dữ liệu do DCS sở hữu nên updated_at phải phản ánh các thay đổi
-- quản trị (kích hoạt/vô hiệu hóa, cập nhật hồ sơ). Không dùng fn_set_updated_at
-- của document_versions vì hàm đó còn tính lại chu kỳ rà soát tài liệu.
CREATE OR REPLACE FUNCTION fn_set_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION fn_set_users_updated_at();

-- Các rule này xuất phát từ mô hình L1 chỉ-đọc ở migration 001/002. Từ Ver2,
-- DCS sở hữu cây tổ chức, membership và role nên các thao tác quản trị không
-- được bị chặn âm thầm bởi rule cũ.
DROP RULE IF EXISTS org_bu_no_write ON org_bu;
DROP RULE IF EXISTS org_site_no_write ON org_site;
DROP RULE IF EXISTS org_dept_no_write ON org_department;
DROP RULE IF EXISTS user_dept_no_write ON user_departments;

-- ============================================================
-- 2. Site ↔ BU nhiều-nhiều
-- ============================================================
-- Giữ cột cũ với tên tường minh chỉ để đối chiếu/rehearsal; mọi truy vấn mới
-- phải đọc org_site_bu. Không xoá trong migration này để rollback dữ liệu còn
-- khả thi trước khi hoàn tất kiểm thử production.
ALTER TABLE org_site RENAME COLUMN bu_id TO legacy_primary_bu_id;
ALTER TABLE org_site ALTER COLUMN legacy_primary_bu_id DROP NOT NULL;
DROP INDEX IF EXISTS idx_site_bu;

CREATE TABLE org_site_bu (
    site_id UUID NOT NULL REFERENCES org_site(site_id) ON DELETE CASCADE,
    bu_id   UUID NOT NULL REFERENCES org_bu(bu_id) ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (site_id, bu_id)
);

INSERT INTO org_site_bu (site_id, bu_id)
SELECT site_id, legacy_primary_bu_id
  FROM org_site
 WHERE legacy_primary_bu_id IS NOT NULL;

CREATE INDEX idx_org_site_bu_bu ON org_site_bu(bu_id);

-- ============================================================
-- 3. Bảy role Ver2, với phạm vi role đúng cấp
-- ============================================================
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'user_roles'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%role_code%'
  LOOP
    EXECUTE format('ALTER TABLE user_roles DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE user_roles
    ADD CONSTRAINT chk_user_role_code CHECK (
      role_code IN (
        'DC_ADMIN', 'DC_AUTHOR', 'DC_DEPT_HEAD', 'DC_SITE_QA_MANAGER',
        'DC_BU_OWNER', 'DC_GROUP_OWNER', 'DC_READER'
      )
    ),
    ADD CONSTRAINT chk_user_role_scope CHECK (
      (role_code IN ('DC_ADMIN', 'DC_AUTHOR', 'DC_READER', 'DC_GROUP_OWNER')
        AND scope_level = 'group'
        AND scope_bu_id IS NULL AND scope_site_id IS NULL AND scope_dept_id IS NULL)
      OR (role_code = 'DC_BU_OWNER'
        AND scope_level = 'bu'
        AND scope_bu_id IS NOT NULL AND scope_site_id IS NULL AND scope_dept_id IS NULL)
      OR (role_code = 'DC_SITE_QA_MANAGER'
        AND scope_level = 'site'
        AND scope_bu_id IS NULL AND scope_site_id IS NOT NULL AND scope_dept_id IS NULL)
      OR (role_code = 'DC_DEPT_HEAD'
        AND scope_level = 'dept'
        AND scope_bu_id IS NULL AND scope_site_id IS NULL AND scope_dept_id IS NOT NULL)
    );

-- Tài khoản Group Owner hiện hữu từng là admin kỹ thuật ở phase 0. Sao chép
-- quyền quản trị để không khoá người quản trị khi nâng cấp; nhóm QA phải rà lại
-- và thay thế bằng danh sách DC_ADMIN chính thức sau rehearsal.
INSERT INTO user_roles
  (user_id, role_code, scope_level, scope_bu_id, scope_site_id, scope_dept_id, is_active, granted_by)
SELECT r.user_id, 'DC_ADMIN', 'group', NULL, NULL, NULL, r.is_active, r.granted_by
  FROM user_roles r
 WHERE r.role_code = 'DC_GROUP_OWNER'
   AND NOT EXISTS (
     SELECT 1 FROM user_roles a
      WHERE a.user_id = r.user_id AND a.role_code = 'DC_ADMIN' AND a.is_active
   );

-- Giữ các partial index đã có: đổi tên không cần build lại chỉ mục và không
-- để lại bản sao trùng lặp sau khi bảng được đổi tên.
ALTER INDEX idx_user_role_user RENAME TO idx_user_roles_active_user;
ALTER INDEX idx_user_role_code RENAME TO idx_user_roles_active_code;

-- ============================================================
-- 4. Định nghĩa lại các hàm có SQL text phụ thuộc bảng/cây cũ
-- ============================================================
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
     WHERE (p_include_historical OR si.status = 'hieu_luc')
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

CREATE OR REPLACE FUNCTION fn_run_escalations()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
    b RECORD;
    v_target UUID;
BEGIN
    FOR b IN
        SELECT bl.*, er.level, er.notify_target
          FROM v_backlog_all bl
          JOIN escalation_rules er
            ON er.backlog_type = bl.backlog_type
           AND er.is_active
           AND bl.days_overdue >= er.threshold_days
         WHERE NOT EXISTS (
               SELECT 1 FROM escalations_sent es
                WHERE es.backlog_type = bl.backlog_type
                  AND es.object_id = bl.object_id
                  AND es.level = er.level)
    LOOP
        v_target := CASE b.notify_target
            WHEN 'nguoi_giu_viec' THEN b.holder_user_id
            WHEN 'quan_ly_bo_phan' THEN (
              SELECT manager_user_id FROM org_department WHERE dept_id = b.department_id
            )
            WHEN 'dcs_admin' THEN (
              SELECT user_id FROM user_roles
               WHERE role_code = 'DC_ADMIN' AND is_active
               ORDER BY granted_at, user_id
               LIMIT 1
            )
            WHEN 'cap_tren' THEN (
              SELECT user_id FROM user_roles
               WHERE role_code = 'DC_GROUP_OWNER' AND is_active
               ORDER BY granted_at, user_id
               LIMIT 1
            )
        END;
        CONTINUE WHEN v_target IS NULL;

        INSERT INTO escalations_sent (backlog_type, object_id, level, sent_to_user_id)
        VALUES (b.backlog_type, b.object_id, b.level, v_target)
        ON CONFLICT (backlog_type, object_id, level) DO NOTHING;

        INSERT INTO audit_log (actor_type, event_type, object_type, object_id, after_state)
        VALUES ('he_thong', 'leo_thang', b.backlog_type, b.object_id,
                jsonb_build_object('level', b.level, 'sent_to', v_target,
                                   'days_overdue', b.days_overdue));
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 5. Legacy compatibility views: read-only only
-- ============================================================
-- Các view này bảo vệ các hàm/plugin cũ chưa chuyển đổi. JOIN với một quan hệ
-- hằng khiến view không auto-updatable, do đó PostgreSQL từ chối INSERT/UPDATE/
-- DELETE thay vì cho mã cũ tiếp tục ghi vào tên bảng tạm. Không dùng trong mã mới.
CREATE VIEW app_user_ref AS
SELECT u.* FROM users u CROSS JOIN (VALUES (TRUE)) AS compatibility(read_only);
CREATE VIEW app_user_dept AS
SELECT ud.* FROM user_departments ud CROSS JOIN (VALUES (TRUE)) AS compatibility(read_only);
CREATE VIEW app_user_role AS
SELECT ur.* FROM user_roles ur CROSS JOIN (VALUES (TRUE)) AS compatibility(read_only);
