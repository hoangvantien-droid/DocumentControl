/**
 * scripts/seed_matrix.mjs — Khởi tạo ma trận account 3 vai DCS.
 *
 * Org: BU MEAT/COND, Site MML, Dept QA/PROD (+QC nếu chưa có).
 * 8 account: admin, author, reader, dh_qa, dh_prod, dh_null, mix_aa, mix_ad.
 * Password random riêng từng account, ghi ra file JSON chỉ đọc bởi owner.
 * Role + primary_dept_id chuẩn theo src/domain/permissions.ts.
 *
 * Chạy: node scripts/seed_matrix.mjs [--out /run/dcs_matrix_pw.json]
 */
import postgres from 'postgres';
import argon2 from 'argon2';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';

const outPath = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : '/run/dcs_matrix_pw.json';

function loadDbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync('/etc/dcs/.env', 'utf8');
  const m = env.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error('DATABASE_URL not found');
  return m[1].trim();
}

const sql = postgres(loadDbUrl(), { max: 1 });
const pw = () => randomBytes(9).toString('base64').replace(/[^A-Za-z0-9]/g, 'X').slice(0, 12);

try {
  // --- Org: đảm bảo BU MEAT, Site MML, Dept QA/PROD (+QC) ---
  let bu = await sql`SELECT bu_id FROM org_bu WHERE bu_code='MEAT'`;
  const BU = bu[0]?.bu_id ?? (() => { throw new Error('BU MEAT missing'); })();
  let st = await sql`SELECT site_id FROM org_site WHERE site_code='MML'`;
  const SITE = st[0]?.site_id ?? (() => { throw new Error('Site MML missing'); })();
  await sql`INSERT INTO org_site_bu (site_id, bu_id) VALUES (${SITE}, ${BU}) ON CONFLICT DO NOTHING`;

  const deptIds = {};
  for (const [code, name] of [['QA', 'QA In-process'], ['PROD', 'Production'], ['QC', 'QC Lab']]) {
    const ex = await sql`SELECT dept_id FROM org_department WHERE dept_code=${code} AND site_id=${SITE}`;
    if (ex.length) deptIds[code] = ex[0].dept_id;
    else {
      const id = randomUUID();
      await sql`INSERT INTO org_department (dept_id, dept_code, name, site_id) VALUES (${id}, ${code}, ${name}, ${SITE})`;
      deptIds[code] = id;
    }
  }

  // --- 8 account ma trận: email, full_name, roles[], primary_dept ---
  const MATRIX = [
    ['admin@mml.io', 'Admin User', ['DC_ADMIN'], null],
    ['author@mml.io', 'Author User', ['DC_AUTHOR'], null],
    ['reader@mml.io', 'Reader User', ['DC_READER'], null],
    ['dh_qa@mml.io', 'DeptHead QA', ['DC_DEPT_HEAD'], 'QA'],
    ['dh_prod@mml.io', 'DeptHead PROD', ['DC_DEPT_HEAD'], 'PROD'],
    ['dh_null@mml.io', 'DeptHead Null', ['DC_DEPT_HEAD'], null],
    ['mix_aa@mml.io', 'Admin+Author', ['DC_ADMIN', 'DC_AUTHOR'], null],
    ['mix_ad@mml.io', 'Author+DeptHead QA', ['DC_AUTHOR', 'DC_DEPT_HEAD'], 'QA'],
  ];

  const result = [];
  for (const [email, fullName, roles, deptCode] of MATRIX) {
    const password = pw();
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    let rows = await sql`SELECT user_id FROM users WHERE lower(email)=lower(${email})`;
    let uid;
    if (rows.length) {
      uid = rows[0].user_id;
      const primaryDept = deptCode ? deptIds[deptCode] : null;
      await sql`UPDATE users SET password_hash=${hash}, full_name=${fullName}, is_active=TRUE, primary_dept_id=${primaryDept} WHERE user_id=${uid}`;
    } else {
      uid = randomUUID();
      const primaryDept = deptCode ? deptIds[deptCode] : null;
      await sql`INSERT INTO users (user_id, email, full_name, password_hash, is_active, temp_record) VALUES (${uid}, ${email}, ${fullName}, ${hash}, TRUE, FALSE)`;
      await sql`UPDATE users SET primary_dept_id=${primaryDept} WHERE user_id=${uid}`;
    }
    // Deactivate all existing roles, then ensure matrix roles active
    await sql`UPDATE user_roles SET is_active=FALSE WHERE user_id=${uid}`;
    for (const rc of roles) {
      await sql`INSERT INTO user_roles (user_id, role_code, scope_level, is_active) VALUES (${uid}, ${rc}, 'group', TRUE)
        ON CONFLICT (user_id, role_code, scope_level, scope_bu_id, scope_site_id, scope_dept_id) DO UPDATE SET is_active=TRUE`;
    }
    // user_departments: link primary dept if any
    if (deptCode) {
      await sql`INSERT INTO user_departments (user_id, dept_id) VALUES (${uid}, ${deptIds[deptCode]}) ON CONFLICT DO NOTHING`;
    }
    result.push({ email, password, roles, scope: deptCode ? `dept ${deptCode} (Site MML)` : 'group (no primary dept)' });
  }

  writeFileSync(outPath, JSON.stringify({ generated_at: new Date().toISOString(), accounts: result }, null, 2), { mode: 0o600 });
  console.log(`Seeded ${result.length} accounts. Passwords -> ${outPath} (mode 600)`);
  for (const a of result) console.log(`  ${a.email} [${a.roles.join('+')}] scope=${a.scope}`);
} finally {
  await sql.end();
}
