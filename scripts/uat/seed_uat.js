import postgres from 'postgres';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Read DATABASE_URL from .env to avoid redaction
const envContent = readFileSync('/opt/dcs/.env', 'utf8');
const dbUrl = envContent.match(/^DATABASE_URL=(.+)$/m)?.[1];
if (!dbUrl) throw new Error('DATABASE_URL not found in .env');
const sql = postgres(dbUrl, { max: 1 });

try {
  // 1. Org structure — idempotent: lookup trước, chỉ insert nếu chưa tồn tại
  let BU = '11111111-1111-1111-1111-111111111111';
  let existingBu = await sql`SELECT bu_id FROM org_bu WHERE bu_code='MEAT'`;
  if (existingBu.length > 0) BU = existingBu[0].bu_id;
  else await sql`INSERT INTO org_bu (bu_id, bu_code, name) VALUES (${BU}, 'MEAT', 'MeatLife')`;

  let SITE = '';
  let existingSite = await sql`SELECT site_id FROM org_site WHERE site_code='MML'`;
  if (existingSite.length > 0) SITE = existingSite[0].site_id;
  else { SITE = randomUUID(); await sql`INSERT INTO org_site (site_id, site_code, name, legacy_primary_bu_id) VALUES (${SITE}, 'MML', 'MML Site', ${BU})`; }
  await sql`INSERT INTO org_site_bu (site_id, bu_id) VALUES (${SITE}, ${BU}) ON CONFLICT DO NOTHING`;

  let DEPT_QA = '';
  let existingDeptQA = await sql`SELECT dept_id FROM org_department WHERE dept_code='QA' AND site_id=${SITE}`;
  if (existingDeptQA.length > 0) DEPT_QA = existingDeptQA[0].dept_id;
  else { DEPT_QA = randomUUID(); await sql`INSERT INTO org_department (dept_id, dept_code, name, site_id) VALUES (${DEPT_QA}, 'QA', 'QA In-process', ${SITE})`; }

  let DEPT_PROD = '';
  let existingDeptPROD = await sql`SELECT dept_id FROM org_department WHERE dept_code='PROD' AND site_id=${SITE}`;
  if (existingDeptPROD.length > 0) DEPT_PROD = existingDeptPROD[0].dept_id;
  else { DEPT_PROD = randomUUID(); await sql`INSERT INTO org_department (dept_id, dept_code, name, site_id) VALUES (${DEPT_PROD}, 'PROD', 'Production', ${SITE})`; }

  // Site thứ hai (mô hình receipt: cần ≥2 site để kiểm "sai khác giữa site").
  let SITE2 = '';
  let existingSite2 = await sql`SELECT site_id FROM org_site WHERE site_code='HCM'`;
  if (existingSite2.length > 0) SITE2 = existingSite2[0].site_id;
  else { SITE2 = randomUUID(); await sql`INSERT INTO org_site (site_id, site_code, name, legacy_primary_bu_id) VALUES (${SITE2}, 'HCM', 'HCM Site', ${BU})`; }
  await sql`INSERT INTO org_site_bu (site_id, bu_id) VALUES (${SITE2}, ${BU}) ON CONFLICT DO NOTHING`;

  let DEPT_QA2 = '';
  let existingDeptQA2 = await sql`SELECT dept_id FROM org_department WHERE dept_code='QA2' AND site_id=${SITE2}`;
  if (existingDeptQA2.length > 0) DEPT_QA2 = existingDeptQA2[0].dept_id;
  else { DEPT_QA2 = randomUUID(); await sql`INSERT INTO org_department (dept_id, dept_code, name, site_id) VALUES (${DEPT_QA2}, 'QA2', 'QA HCM', ${SITE2})`; }

  // 2. Users — idempotent
  const adminHash = await argon2.hash('Admin#1234');
  const authorHash = await argon2.hash('Author#1234');
  const readerHash = await argon2.hash('Reader#1234');

  let USER_ADMIN = '';
  let r = await sql`SELECT user_id FROM users WHERE email='admin@mml.io'`;
  if (r.length > 0) USER_ADMIN = r[0].user_id;
  else { USER_ADMIN = randomUUID(); await sql`INSERT INTO users (user_id, email, full_name, password_hash, is_active, temp_record) VALUES (${USER_ADMIN}, 'admin@mml.io', 'Admin User', ${adminHash}, true, false)`; }

  let USER_AUTHOR = '';
  r = await sql`SELECT user_id FROM users WHERE email='author@mml.io'`;
  if (r.length > 0) USER_AUTHOR = r[0].user_id;
  else { USER_AUTHOR = randomUUID(); await sql`INSERT INTO users (user_id, email, full_name, password_hash, is_active, temp_record) VALUES (${USER_AUTHOR}, 'author@mml.io', 'Author User', ${authorHash}, true, false)`; }

  let USER_READER = '';
  r = await sql`SELECT user_id FROM users WHERE email='reader@mml.io'`;
  if (r.length > 0) USER_READER = r[0].user_id;
  else { USER_READER = randomUUID(); await sql`INSERT INTO users (user_id, email, full_name, password_hash, is_active, temp_record) VALUES (${USER_READER}, 'reader@mml.io', 'Reader User', ${readerHash}, true, false)`; }

  // Kiểm soát tài liệu site (DC Site) — một người cho mỗi site.
  const dcHash = await argon2.hash('DocCtl#1234');
  let USER_DC1 = '';
  r = await sql`SELECT user_id FROM users WHERE email='dc_mml@mml.io'`;
  if (r.length > 0) USER_DC1 = r[0].user_id;
  else { USER_DC1 = randomUUID(); await sql`INSERT INTO users (user_id, email, full_name, password_hash, is_active, temp_record) VALUES (${USER_DC1}, 'dc_mml@mml.io', 'DC Site MML', ${dcHash}, true, false)`; }

  let USER_DC2 = '';
  r = await sql`SELECT user_id FROM users WHERE email='dc_hcm@mml.io'`;
  if (r.length > 0) USER_DC2 = r[0].user_id;
  else { USER_DC2 = randomUUID(); await sql`INSERT INTO users (user_id, email, full_name, password_hash, is_active, temp_record) VALUES (${USER_DC2}, 'dc_hcm@mml.io', 'DC Site HCM', ${dcHash}, true, false)`; }

  // 3. User departments — idempotent
  await sql`INSERT INTO user_departments (user_id, dept_id) VALUES
    (${USER_ADMIN}, ${DEPT_QA}), (${USER_ADMIN}, ${DEPT_PROD}),
    (${USER_AUTHOR}, ${DEPT_QA}), (${USER_READER}, ${DEPT_PROD}),
    (${USER_DC1}, ${DEPT_QA}), (${USER_DC2}, ${DEPT_QA2}) ON CONFLICT DO NOTHING`;

  // Dept chính (primary_dept_id) — luồng report suy site của người báo từ đây.
  await sql`UPDATE users SET primary_dept_id = ${DEPT_QA}  WHERE user_id = ${USER_AUTHOR} AND primary_dept_id IS NULL`;
  await sql`UPDATE users SET primary_dept_id = ${DEPT_PROD} WHERE user_id = ${USER_READER} AND primary_dept_id IS NULL`;
  await sql`UPDATE users SET primary_dept_id = ${DEPT_QA}  WHERE user_id = ${USER_DC1} AND primary_dept_id IS NULL`;
  await sql`UPDATE users SET primary_dept_id = ${DEPT_QA2} WHERE user_id = ${USER_DC2} AND primary_dept_id IS NULL`;

  // 4. Roles (mô hình 4 vai) — idempotent.
  //    Admin/Author/Reader ở cấp group; DC Site gán theo từng site.
  await sql`INSERT INTO user_roles (user_id, role_code, scope_level) VALUES
    (${USER_ADMIN}, 'DC_ADMIN', 'group'),
    (${USER_AUTHOR}, 'DC_AUTHOR', 'group'),
    (${USER_READER}, 'DC_READER', 'group') ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO user_roles (user_id, role_code, scope_level, scope_site_id) VALUES
    (${USER_DC1}, 'DC_SITE_DOC_CONTROL', 'site', ${SITE}),
    (${USER_DC2}, 'DC_SITE_DOC_CONTROL', 'site', ${SITE2}) ON CONFLICT DO NOTHING`;

  // 5. Document + version + link
  const DOC_ID = 'MML/QA/HD-001';
  await sql`INSERT INTO documents (doc_id, doc_type, origin, scope_level, scope_site_id)
    VALUES (${DOC_ID}, 'SOP', 'noi_bo', 'site', ${SITE}) ON CONFLICT DO NOTHING`;

  let VERSION_ID = '';
  r = await sql`SELECT version_id FROM document_versions WHERE doc_id=${DOC_ID} AND version_no='1.0'`;
  if (r.length > 0) VERSION_ID = r[0].version_id;
  else {
    VERSION_ID = randomUUID();
    // Trigger trg_validate_version chặn: tắt → insert → insert link → bật lại
    await sql`ALTER TABLE document_versions DISABLE TRIGGER trg_validate_version`;
    await sql`INSERT INTO document_versions (
      version_id, doc_id, version_no, title, issued_date, effective_date,
      review_cycle_months, status, source_channel, file_path, file_hash,
      registrant_user_id, owner_department_id, admin_user_id, confirmed_at, effective_at
    ) VALUES (
      ${VERSION_ID}, ${DOC_ID}, '1.0', 'Huong dan kiem tra mau luu',
      '2026-01-01', '2026-10-01', 12, 'hieu_luc', 'thu_cong',
      '/files/hd-001.pdf', 'abc123', ${USER_AUTHOR}, ${DEPT_QA},
      ${USER_ADMIN}, '2026-10-01', '2026-10-01'
    )`;
    await sql`INSERT INTO document_links (version_id, link_type, link_code, created_by)
      VALUES (${VERSION_ID}, 'tai_lieu', ${DOC_ID + '/hd-001'}, ${USER_AUTHOR})`;
    await sql`ALTER TABLE document_versions ENABLE TRIGGER trg_validate_version`;
  }

  console.log('UAT seed data ready:');
  console.log('  BU: MEAT (' + BU + ')');
  console.log('  Sites: MML (' + SITE + '), HCM (' + SITE2 + ')');
  console.log('  Depts: QA (' + DEPT_QA + '), PROD (' + DEPT_PROD + '), QA2@HCM (' + DEPT_QA2 + ')');
  console.log('  Users: admin@mml.io, author@mml.io, reader@mml.io, dc_mml@mml.io, dc_hcm@mml.io');
  console.log('  Roles: DC_ADMIN, DC_AUTHOR, DC_READER, DC_SITE_DOC_CONTROL(MML), DC_SITE_DOC_CONTROL(HCM)');
  console.log('  Doc: ' + DOC_ID + ' v1.0 (hieu_luc, version_id=' + VERSION_ID + ')');
  console.log('Passwords: Admin#1234 / Author#1234 / Reader#1234 / DocCtl#1234 (cả hai DC Site)');
} catch (e) {
  console.error('Seed failed:', e.message);
  process.exit(1);
} finally {
  await sql.end();
}
