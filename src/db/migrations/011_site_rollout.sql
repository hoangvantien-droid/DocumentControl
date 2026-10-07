-- 011_site_rollout.sql — áp dụng lệch pha theo site + tạm hoãn.
-- 1 version hieu_luc dùng chung, mỗi site có planned/applied riêng.
CREATE TABLE IF NOT EXISTS document_site_rollout (
  version_id uuid NOT NULL REFERENCES document_versions(version_id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES org_site(site_id) ON DELETE RESTRICT,
  planned_date date,
  applied_date date,
  status varchar(20) NOT NULL DEFAULT 'chua_ap_dung'
    CHECK (status IN ('chua_ap_dung','da_ap_dung','tam_hoan')),
  pause_reason text,
  confirmed_by uuid REFERENCES users(user_id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, site_id)
);
CREATE INDEX IF NOT EXISTS idx_rollout_site ON document_site_rollout(site_id);
CREATE INDEX IF NOT EXISTS idx_rollout_status ON document_site_rollout(status);
-- backfill từ applicable_site_ids nếu có
INSERT INTO document_site_rollout (version_id, site_id, status)
SELECT v.version_id, s, 'chua_ap_dung'
  FROM document_versions v, unnest(v.applicable_site_ids) AS s
  ON CONFLICT (version_id, site_id) DO NOTHING;
