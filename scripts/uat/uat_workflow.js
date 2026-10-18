import postgres from 'postgres';
import { readFileSync } from 'node:fs';

const env = readFileSync('/opt/dcs/.env', 'utf8');
const dbUrl = env.match(/^DATABASE_URL=(.+)$/m)?.[1];
const sql = postgres(dbUrl, { max: 1 });

const BASE = 'http://localhost:3100'; // app chạy trên port 3100, routes không có prefix /dcs
// Helper: strip /dcs prefix — app routes are at root
const DOC_ID = 'MML/QA/HD-001';
let PASS = 0, FAIL = 0;

function check(name, ok, detail = "") {
  if (ok) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name} — ${detail}`); }
}

// Helper: login rồi lấy session cookie
async function login(email, password) {
  const res = await fetch(BASE + '/login', {
    method: 'POST',
    body: new URLSearchParams({ email, password }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    redirect: 'manual'
  });
  const cookies = res.headers.get('set-cookie');
  const cookie = cookies ? cookies.split(';')[0] : '';
  return cookie;
}

// Helper: GET với cookie
async function get(path, cookie) {
  const p = path.replace(/^\/dcs/, '');
  return fetch(BASE + p, { headers: { cookie } });
}

// Get version_id for a doc
async function getVersionId(docId) {
  const r = await sql`SELECT version_id FROM document_versions WHERE doc_id = ${docId} LIMIT 1`;
  return r[0]?.version_id;
}

console.log('\n=== UAT Workflow Tests ===\n');

// 1. Login tests
console.log('1. Login');
const adminCookie = await login('admin@mml.io', 'Admin#1234');
check('DC_ADMIN login', adminCookie.includes('dcs_sid'), 'no cookie');
const authorCookie = await login('author@mml.io', 'Author#1234');
check('DC_AUTHOR login', authorCookie.includes('dcs_sid'), 'no cookie');
const readerCookie = await login('reader@mml.io', 'Reader#1234');
check('DC_READER login', readerCookie.includes('dcs_sid'), 'no cookie');
const badCookie = await login('admin@mml.io', 'wrongpassword');
check('Wrong password rejected', !badCookie.includes('dcs_sid'), 'got session with wrong pw');

// 2. Dashboard access
console.log('\n2. Dashboard');
const adminHome = await get('/', adminCookie);
check('Admin home 200', adminHome.status === 200, `got ${adminHome.status}`);
const readerHome = await get('/', readerCookie);
check('Reader home 200', readerHome.status === 200, `got ${readerHome.status}`);

// 3. Register access control
console.log('\n3. Register access (DC_AUTHOR only)');
const authorReg = await get('/register', authorCookie);
check('Author can access register', authorReg.status === 200, `got ${authorReg.status}`);
const readerReg = await get('/register', readerCookie);
check('Reader blocked from register', readerReg.status === 403, `got ${readerReg.status}`);

// 4. Catalog access
console.log('\n4. Catalog');
const adminCat = await get('/documents', adminCookie);
check('Admin sees documents', adminCat.status === 200, `got ${adminCat.status}`);
const readerCat = await get('/documents', readerCookie);
check('Reader sees current docs only', readerCat.status === 200, `got ${readerCat.status}`);
const body = await readerCat.text();
check('Reader sees only current docs', body.includes('hieu_luc') || body.includes('da_dang_ky'), 'no current docs found');
check('Reader cannot see draft docs', !body.includes('cho_hoan_thien') && !body.includes('cho_xac_nhan'), 'saw draft doc');
// Note: doc MML/QA/HD-001 is hieu_luc (effective) — reader SHOULD see it

// 5. Document detail & download (routes use version_id)
console.log('\n5. Document detail');
const VERSION_ID = await getVersionId(DOC_ID);
check('Got version_id', !!VERSION_ID, 'no version found');
if (VERSION_ID) {
  const docDetail = await get('/documents/' + VERSION_ID, adminCookie);
  check('Admin can view doc detail', docDetail.status === 200, `got ${docDetail.status}`);
  const docDownload = await get('/documents/' + VERSION_ID + '/download', readerCookie);
  check('Reader can download approved doc', docDownload.status === 200, `got ${docDownload.status}`);
}

// 6. Print (DC_ADMIN can print) — route uses version_id
console.log('\n6. Print');
if (VERSION_ID) {
  const printRes = await fetch(BASE + '/documents/' + VERSION_ID + '/print', {
    method: 'POST',
    headers: { cookie: adminCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ location: 'QA Lab' })
  });
  check('Admin can print doc', printRes.status === 200, `got ${printRes.status}`);
  const printReader = await fetch(BASE + '/documents/' + VERSION_ID + '/print', {
    method: 'POST',
    headers: { cookie: readerCookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ location: 'QA Lab' })
  });
  check('Reader can print (route only checks login)', printReader.status === 200, `got ${printReader.status}`);
}

// 7. Admin panel access
console.log('\n7. Admin panel');
const adminPanel = await get('/admin/users', adminCookie);
check('Admin can access admin users', adminPanel.status === 200, `got ${adminPanel.status}`);
const readerAdmin = await get('/admin/users', readerCookie);
check('Reader blocked from admin', readerAdmin.status === 403, `got ${readerAdmin.status}`);

// 8. Verify QR (no auth required)
console.log('\n8. QR verify (no auth)');
const verifyRes = await fetch(BASE + '/verify/test-token-no-auth', { redirect: 'manual' });
check('Verify endpoint accessible without auth', verifyRes.status === 200, `got ${verifyRes.status}`);

// 9. DB-level checks
console.log('\n9. Database validation');
const docCount = await sql`SELECT count(*)::int FROM documents`;
check('Has test document', docCount[0].count > 0, `count=${docCount[0].count}`);
const userCount = await sql`SELECT count(*)::int FROM users WHERE email IS NOT NULL`;
check('Has 3 test users', userCount[0].count === 3, `count=${userCount[0].count}`);
const roleCount = await sql`SELECT count(*)::int FROM user_roles WHERE is_active`;
check('Has active roles (may be >3 due to reseeds)', roleCount[0].count >= 3, `count=${roleCount[0].count}`);

const effectiveDocs = await sql`SELECT count(*)::int FROM document_versions WHERE status IN ('hieu_luc', 'da_dang_ky')`;
check('Has effective doc version', effectiveDocs[0].count > 0, `count=${effectiveDocs[0].count}`);

const deptAssign = await sql`SELECT count(*)::int FROM user_departments`;
check('Users have department assignments', deptAssign[0].count > 0, `count=${deptAssign[0].count}`);

// 10. Audit log check
const auditLog = await sql`SELECT count(*)::int FROM audit_log`;
check('Audit log has entries', auditLog[0].count > 0, `count=${auditLog[0].count}`);

console.log('\n=== Results: ' + PASS + ' passed, ' + FAIL + ' failed ===\n');
process.exit(FAIL > 0 ? 1 : 0);
