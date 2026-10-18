-- UAT seed data for fresh DCS deploy
-- Run: sudo -u postgres psql -d dcs_prod -f /opt/dcs/seed_uat.sql

-- 1. Org structure
INSERT INTO org_bu (bu_id, bu_code, name) VALUES ('11111111-1111-1111-1111-111111111111', 'MEAT', 'MeatLife') ON CONFLICT DO NOTHING;
INSERT INTO org_site (site_id, site_code, name, bu_id) VALUES ('22222222-2222-2222-2222-222222222222', 'MML', 'MML Site', '11111111-1111-1111-1111-111111111111') ON CONFLICT DO NOTHING;
INSERT INTO org_department (dept_id, dept_code, name, site_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'QA', 'QA In-process', '22222222-2222-2222-2222-222222222222'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'PROD', 'Production', '22222222-2222-2222-2222-222222222222') ON CONFLICT DO NOTHING;

-- 2. Users (argon2 hashes — set via psql below)
-- 3. User departments
INSERT INTO app_user_dept (user_id, dept_id, is_active) VALUES
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true),
  ('33333333-3333-3333-3333-333333333333', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true),
  ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true),
  ('55555555-5555-5555-5555-555555555555', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true) ON CONFLICT DO NOTHING;

-- 4. Roles (3-vai model)
INSERT INTO app_user_role (user_id, role_code, scope_level) VALUES
  ('33333333-3333-3333-3333-333333333333', 'DC_ADMIN', 'group'),
  ('44444444-4444-4444-4444-444444444444', 'DC_AUTHOR', 'group'),
  ('55555555-5555-5555-5555-555555555555', 'DC_READER', 'group') ON CONFLICT DO NOTHING;

-- 5. Test document
INSERT INTO documents (doc_id, doc_type, origin, scope_level, scope_site_id, owner_department_id)
VALUES ('MML/QA/HD-001', 'SOP', 'noi_bo', 'site', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') ON CONFLICT DO NOTHING;

INSERT INTO document_versions (
  version_id, doc_id, version_no, title, issued_date, effective_date,
  review_cycle_months, status, approver_name, approval_reference,
  source_channel, file_path, file_hash, registrant_user_id, owner_department_id
) VALUES (
  gen_random_uuid(), 'MML/QA/HD-001', '1.0', 'Huong dan kiem tra mau luu',
  '2026-01-01', '2026-10-01', 12, 'hieu_luc',
  'QA tap doan', 'KD-2026-0001', 'thu_cong', '/files/hd-001.pdf', 'abc123',
  '44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
);
