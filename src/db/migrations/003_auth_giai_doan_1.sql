-- 003_auth_giai_doan_1.sql — Bổ sung cho đăng nhập & phân quyền giai đoạn 1.
--
-- Vì sao cần: schema gốc DCS-4 đặt L1 làm nguồn định danh/phiên/vai trò, nên
-- KHÔNG có cột mật khẩu, KHÔNG có bảng phiên, KHÔNG có bảng vai trò. Giai đoạn 1
-- (L1 chưa vận hành) phải tự lo ba thứ đó. Toàn bộ ở đây CÓ HẠN SỬ DỤNG — khi L1
-- lên, chuyển sang OIDC và đồng bộ vai trò từ L1, rồi gỡ các bảng/cột này.
--
-- Giữ đúng ranh giới: đây là phần "tạm" song song với phụ lục giai đoạn 1 của
-- DCS-4, không đụng vào cấu trúc nghiệp vụ gốc.

-- ------------------------------------------------------------
-- 1. MẬT KHẨU TẠM — băm argon2id, KHÔNG BAO GIỜ lưu dạng rõ (DCS-8 §4.1)
-- ------------------------------------------------------------
ALTER TABLE app_user_ref
    ADD COLUMN IF NOT EXISTS password_hash TEXT;   -- TẠM: L1 lên thì dùng OIDC, bỏ cột này

-- ------------------------------------------------------------
-- 2. PHIÊN LÀM VIỆC — lưu trong CSDL (1 GB không đủ cho kho phiên bộ nhớ, DCS-8 §4.1)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_session (
    session_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES app_user_ref(user_id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,           -- created_at + 8 giờ
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_user    ON app_session(user_id);
CREATE INDEX IF NOT EXISTS idx_session_expires ON app_session(expires_at);

-- ------------------------------------------------------------
-- 3. GÁN VAI TRÒ THEO PHẠM VI (DCS-1 §2.6)
--
-- Giai đoạn 1 DCS tự giữ; khi L1 lên thì L1 là nguồn sự thật cho vai trò và
-- bảng này bị thay bằng lời gọi API kiểm quyền. Cùng lấp luôn lỗ hổng:
-- fn_run_escalations trong DCS-4 tham chiếu app_user_role nhưng bảng chưa được
-- định nghĩa ở đâu — tạo tại đây.
--
-- Năm vai trò ánh xạ từ đặc tả phân quyền QA, KHÔNG tạo vai trò mới:
--   DC_GROUP_OWNER (RELEASE__GROUP) · DC_BU_OWNER (RELEASE__BU)
--   DC_SITE_QA_MANAGER (RELEASE__SITE) · DC_AUTHOR · DC_READER
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_user_role (
    user_role_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES app_user_ref(user_id) ON DELETE CASCADE,
    role_code     VARCHAR(30) NOT NULL
        CHECK (role_code IN ('DC_GROUP_OWNER', 'DC_BU_OWNER',
                             'DC_SITE_QA_MANAGER', 'DC_AUTHOR', 'DC_READER')),
    -- Phạm vi của vai trò. GROUP_OWNER không cần con trỏ; các cấp khác trỏ đúng cấp.
    scope_level   VARCHAR(6) NOT NULL DEFAULT 'group'
        CHECK (scope_level IN ('group', 'bu', 'site', 'dept')),
    scope_bu_id   UUID REFERENCES org_bu(bu_id)          ON DELETE CASCADE,
    scope_site_id UUID REFERENCES org_site(site_id)      ON DELETE CASCADE,
    scope_dept_id UUID REFERENCES org_department(dept_id) ON DELETE CASCADE,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    granted_by    UUID REFERENCES app_user_ref(user_id) ON DELETE SET NULL,
    granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Con trỏ phạm vi phải khớp scope_level (giống chk_scope_ref của documents).
    CONSTRAINT chk_role_scope_ref CHECK (
        (scope_level = 'group' AND scope_bu_id IS NULL AND scope_site_id IS NULL AND scope_dept_id IS NULL)
     OR (scope_level = 'bu'    AND scope_bu_id IS NOT NULL AND scope_site_id IS NULL AND scope_dept_id IS NULL)
     OR (scope_level = 'site'  AND scope_site_id IS NOT NULL AND scope_dept_id IS NULL)
     OR (scope_level = 'dept'  AND scope_dept_id IS NOT NULL)),

    CONSTRAINT uq_user_role UNIQUE (user_id, role_code, scope_level, scope_bu_id, scope_site_id, scope_dept_id)
);

CREATE INDEX IF NOT EXISTS idx_user_role_user ON app_user_role(user_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_user_role_code ON app_user_role(role_code) WHERE is_active;
