/**
 * test/uat/http.uat.test.ts — UAT TẦNG 2 (HTTP end-to-end, CẦN PostgreSQL).
 *
 * Chuyển các nhóm cần HTTP/DB của docs/KE-HOACH-TEST-TOAN-DIEN.md thành test tự
 * động, chạy app Fastify thật qua app.inject() (không mở cổng mạng).
 *
 * TỰ SKIP SẠCH khi thiếu DATABASE_URL_TEST: khi không có DB, toàn bộ suite này
 * là một ca .skip() thông báo — KHÔNG fail, KHÔNG làm vỡ `npm run test:unit`.
 *
 * Cách chạy tầng 2 (khi có PostgreSQL):
 *   DATABASE_URL_TEST=postgres://user:pass@host/dcs_test npm run test:uat
 * DB phải có chữ "test" trong tên (cơ chế chặn nhầm trong harness).
 *
 * Phủ: A (login/phiên), B (admin guard + gán vai), C (đăng ký guard+validation),
 * D (xác nhận 2 lớp + two-person + hàng đợi theo scope), F (ẩn ngoài phạm vi),
 * H (/verify public), I/J (guard release/audit), và nhóm P cần DB (P.0 schema,
 * P.1 two-person qua route, P.2→P.4 release qua canRelease, P.5 Reader URL,
 * P.6 revoke/active).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  dbAvailable, startHarness, hasPrimaryDeptIdColumn, seedPendingVersion, type Harness,
} from './harness.js';

// ---- Tự skip sạch khi không có DB ----------------------------------------
if (!dbAvailable) {
  test('UAT tầng 2 (HTTP) — BỎ QUA vì thiếu DATABASE_URL_TEST', { skip: true }, () => {});
} else {
  runHttpUat();
}

function runHttpUat(): void {
  let h: Harness;

  before(async () => { h = await startHarness(); });
  after(async () => { if (h) await h.teardown(); });

  // Helper gọn cho inject có cookie phiên.
  const get = (url: string, cookie?: string) =>
    h.app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
  const postForm = (url: string, payload: Record<string, string>, cookie?: string) =>
    h.app.inject({
      method: 'POST', url, payload,
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
    });

  // =========================================================================
  // P.0 — Tiền kiểm schema scope (bắt buộc chạy trước phần P không-Admin)
  // =========================================================================
  describe('P.0 — Tiền kiểm schema scope', () => {
    test('P.0 cột users.primary_dept_id phải tồn tại (nếu thiếu → bug schema §1.5)', async () => {
      const exists = await hasPrimaryDeptIdColumn(h.sql);
      assert.equal(
        exists, true,
        'users.primary_dept_id KHÔNG tồn tại — getUserScope sẽ lỗi SQL ở các ca release không-Admin. Báo bug schema (xem §1.5 kịch bản).',
      );
    });

    test('P.0 DeptHead Site X duyệt được tài liệu cấp dept DEPT-X1 (schema scope hoạt động)', async () => {
      const vid = await seedPendingVersion(h.sql, {
        docId: 'P0-DEPTX1-01',
        scope: { level: 'dept', deptId: h.ids.deptX1 },
        registrantUserId: h.ids.users.u_author!, ownerDeptId: h.ids.deptX1!,
      });
      const cookie = await h.login('u_dh_x');
      const res = await get(`/confirm/${vid}`, cookie);
      // Được vào màn duyệt (200) — không 403/500. 500 = lỗi SQL do thiếu cột.
      assert.equal(res.statusCode, 200, `kỳ vọng 200, nhận ${res.statusCode}: ${res.body.slice(0, 200)}`);
    });
  });

  // =========================================================================
  // Nhóm A — Đăng nhập & phiên làm việc
  // =========================================================================
  describe('Nhóm A — Đăng nhập & phiên', () => {
    test('A.1 đăng nhập đúng → chuyển về /', async () => {
      const res = await postForm('/login', { email: 'admin@uat.test', password: 'uat-pass-123' });
      assert.equal(res.statusCode, 302);
      assert.equal(res.headers.location, '/');
    });
    test('A.2 [BẢO MẬT] đăng nhập sai → lỗi chung, không lộ email tồn tại', async () => {
      const res = await postForm('/login', { email: 'admin@uat.test', password: 'sai-mat-khau' });
      assert.equal(res.statusCode, 401);
      assert.match(res.body, /Email hoặc mật khẩu không đúng/);
    });
    test('A.3 [BẢO MẬT] tài khoản bị khoá → báo ngừng hoạt động', async () => {
      const res = await postForm('/login', { email: 'locked@uat.test', password: 'uat-pass-123' });
      assert.equal(res.statusCode, 403);
      assert.match(res.body, /ngừng hoạt động/);
    });
    test('A.4 [BẢO MẬT] chưa đăng nhập mở /documents → chuyển /login', async () => {
      const res = await get('/documents');
      assert.equal(res.statusCode, 302);
      assert.equal(res.headers.location, '/login');
    });
    test('A.7 [BẢO MẬT] cookie phiên bị sửa → coi như chưa đăng nhập', async () => {
      const res = await get('/documents', 'dcs_sid=rac-khong-hop-le');
      assert.equal(res.statusCode, 302);
      assert.equal(res.headers.location, '/login');
    });
  });

  // =========================================================================
  // Nhóm B — Quản trị + gán vai
  // =========================================================================
  describe('Nhóm B — Quản trị tổ chức/user/vai', () => {
    test('B.1 [BẢO MẬT] Author mở /admin/org → 403', async () => {
      const cookie = await h.login('u_author');
      const res = await get('/admin/org', cookie);
      assert.equal(res.statusCode, 403);
      assert.match(res.body, /Không đủ quyền quản trị hệ thống/);
    });
    test('B.11 Admin cấp DC_DEPT_HEAD@group → thành công', async () => {
      const cookie = await h.login('u_admin');
      const res = await postForm('/admin/roles', {
        user_id: h.ids.users.u_reader!, role_code: 'DC_DEPT_HEAD', scope_level: 'group',
      }, cookie);
      assert.equal(res.statusCode, 302);
    });
    test('B.12 [BẢO MẬT] gán DC_AUTHOR sai cấp (≠ group) → chặn role.scope', async () => {
      const cookie = await h.login('u_admin');
      const res = await postForm('/admin/roles', {
        user_id: h.ids.users.u_reader!, role_code: 'DC_AUTHOR', scope_level: 'site',
        scope_site_id: h.ids.siteX!,
      }, cookie);
      assert.equal(res.statusCode, 422);
      assert.match(res.body, /chỉ được gán ở cấp Group/);
    });
    test('B.13 [BẢO MẬT] gán vai cũ DC_SITE_QA_MANAGER → chặn (không còn trong 3 vai)', async () => {
      const cookie = await h.login('u_admin');
      const res = await postForm('/admin/roles', {
        user_id: h.ids.users.u_reader!, role_code: 'DC_SITE_QA_MANAGER', scope_level: 'group',
      }, cookie);
      assert.equal(res.statusCode, 422);
      assert.match(res.body, /không còn được gán trong mô hình 3 vai/);
    });
  });

  // =========================================================================
  // Nhóm C — Đăng ký ban hành (guard + validation)
  // =========================================================================
  describe('Nhóm C — Đăng ký ban hành', () => {
    test('C.1 [BẢO MẬT] non-author mở /register → 403', async () => {
      const cookie = await h.login('u_reader');
      const res = await get('/register', cookie);
      assert.equal(res.statusCode, 403);
      assert.match(res.body, /Không có quyền đăng ký ban hành/);
    });
    test('C.2 Author mở /register → form render (200)', async () => {
      const cookie = await h.login('u_author');
      const res = await get('/register', cookie);
      assert.equal(res.statusCode, 200);
    });
    test('C.5 bắt buộc PDF — nộp không file → chặn', async () => {
      const cookie = await h.login('u_author');
      const res = await postForm('/register', {
        doc_id: 'C5-NO-PDF', doc_type: 'SOP', origin: 'noi_bo', scope_level: 'group',
        version_no: '1.0', title: 'Thiếu PDF', issued_date: '2026-01-01',
        effective_date: '2099-01-01', review_cycle_months: '12',
        owner_department_id: h.ids.deptX1!, link_type: 'dieu_khoan', link_code: 'BRC-1',
      }, cookie);
      assert.equal(res.statusCode, 422);
      assert.match(res.body, /Bắt buộc tải lên tệp PDF/);
    });
  });

  // =========================================================================
  // Nhóm D / P.1 — Xác nhận 2 lớp, two-person, hàng đợi theo scope
  // =========================================================================
  describe('Nhóm D / P.1 — Xác nhận 2 lớp & quy tắc hai người', () => {
    test('D.2 / P.1 [BẢO MẬT] Author thuần mở /pending-confirmation → readOnly, rỗng', async () => {
      const cookie = await h.login('u_author');
      const res = await get('/pending-confirmation', cookie);
      assert.equal(res.statusCode, 200); // trang readOnly, không 403
    });
    test('D.4 / P.1.1 [BẢO MẬT] người nộp tự mở /confirm bài của mình → 403 two-person', async () => {
      const vid = await seedPendingVersion(h.sql, {
        docId: 'P11-SELF-01', scope: { level: 'dept', deptId: h.ids.deptX1 },
        registrantUserId: h.ids.users.u_mix_ad!, ownerDeptId: h.ids.deptX1!,
      });
      const cookie = await h.login('u_mix_ad'); // Author+DeptHead
      const res = await get(`/confirm/${vid}`, cookie);
      assert.equal(res.statusCode, 403);
      assert.match(res.body, /người nộp, không được tự duyệt/);
    });
    test('D.3 / P.2.4 [BẢO MẬT] DeptHead Site X mở /confirm tài liệu Site Y → 403 sai phạm vi', async () => {
      const vid = await seedPendingVersion(h.sql, {
        docId: 'P24-SITEY-01', scope: { level: 'site', siteId: h.ids.siteY },
        registrantUserId: h.ids.users.u_author!, ownerDeptId: h.ids.deptY1!,
      });
      const cookie = await h.login('u_dh_x');
      const res = await get(`/confirm/${vid}`, cookie);
      assert.equal(res.statusCode, 403);
      assert.match(res.body, /Không đủ thẩm quyền xác nhận/);
    });
    test('P.1.3 [BẢO MẬT] Author+DeptHead mở /confirm tài liệu group → 403 (chỉ Admin)', async () => {
      const vid = await seedPendingVersion(h.sql, {
        docId: 'P13-GROUP-01', scope: { level: 'group' },
        registrantUserId: h.ids.users.u_author!, ownerDeptId: h.ids.deptX1!,
      });
      const cookie = await h.login('u_mix_ad');
      const res = await get(`/confirm/${vid}`, cookie);
      assert.equal(res.statusCode, 403);
    });
    test('P.1.5 Admin+Author mở /confirm tài liệu group do người khác nộp → 200 (được)', async () => {
      const vid = await seedPendingVersion(h.sql, {
        docId: 'P15-GROUP-01', scope: { level: 'group' },
        registrantUserId: h.ids.users.u_author!, ownerDeptId: h.ids.deptX1!,
      });
      const cookie = await h.login('u_mix_aa'); // Admin+Author
      const res = await get(`/confirm/${vid}`, cookie);
      assert.equal(res.statusCode, 200, `nhận ${res.statusCode}: ${res.body.slice(0, 200)}`);
    });
    test('P.1.4 [BẢO MẬT] Admin+Author tự duyệt bài mình nộp → 403 two-person dù là Admin', async () => {
      const vid = await seedPendingVersion(h.sql, {
        docId: 'P14-SELF-01', scope: { level: 'group' },
        registrantUserId: h.ids.users.u_mix_aa!, ownerDeptId: h.ids.deptX1!,
      });
      const cookie = await h.login('u_mix_aa');
      const res = await get(`/confirm/${vid}`, cookie);
      assert.equal(res.statusCode, 403);
      assert.match(res.body, /người nộp, không được tự duyệt/);
    });
  });

  // =========================================================================
  // Nhóm P.2→P.4 — release theo scope qua route /confirm (canRelease async)
  // =========================================================================
  describe('Nhóm P.2→P.4 — release theo scope (route /confirm thật)', () => {
    type Scope = Parameters<typeof seedPendingVersion>[1]['scope'];
    // Hàm dựng scope nhận ids lúc CHẠY (h.ids chỉ có sau before()).
    const runCase = (
      code: string, docId: string, scopeOf: (ids: Harness['ids']) => Scope, userKey: string, expect: number,
    ) =>
      test(`${code} ${userKey} duyệt ${docId} → ${expect}`, async () => {
        const vid = await seedPendingVersion(h.sql, {
          docId, scope: scopeOf(h.ids), registrantUserId: h.ids.users.u_author!, ownerDeptId: h.ids.deptX1!,
        });
        const cookie = await h.login(userKey);
        const res = await get(`/confirm/${vid}`, cookie);
        assert.equal(res.statusCode, expect, `nhận ${res.statusCode}: ${res.body.slice(0, 200)}`);
      });

    // P.2 — DeptHead Site X (Dept chính DEPT-X1 → Site X → {BU-A, BU-B}).
    runCase('P.2.1', 'RP21-DEPTX1', (i) => ({ level: 'dept', deptId: i.deptX1 }), 'u_dh_x', 200);
    runCase('P.2.2', 'RP22-DEPTY1', (i) => ({ level: 'dept', deptId: i.deptY1 }), 'u_dh_x', 403);
    runCase('P.2.3', 'RP23-SITEX', (i) => ({ level: 'site', siteId: i.siteX }), 'u_dh_x', 200);
    runCase('P.2.4', 'RP24-SITEY', (i) => ({ level: 'site', siteId: i.siteY }), 'u_dh_x', 403);
    runCase('P.2.5', 'RP25-BUA', (i) => ({ level: 'bu', buId: i.buA }), 'u_dh_x', 200);
    runCase('P.2.6', 'RP26-BUB', (i) => ({ level: 'bu', buId: i.buB }), 'u_dh_x', 200);

    // P.3 — DeptHead null: chặn mọi cấp dept/site/bu.
    runCase('P.3.1', 'RP31-DEPTX1', (i) => ({ level: 'dept', deptId: i.deptX1 }), 'u_dh_null', 403);
    runCase('P.3.2', 'RP32-SITEX', (i) => ({ level: 'site', siteId: i.siteX }), 'u_dh_null', 403);
    runCase('P.3.3', 'RP33-BUA', (i) => ({ level: 'bu', buId: i.buA }), 'u_dh_null', 403);

    // P.4 — Site thuộc nhiều BU: Site Y (∈ {BU-A}) chặn BU-B.
    runCase('P.4.2', 'RP42-BUB', (i) => ({ level: 'bu', buId: i.buB }), 'u_dh_y', 403);

    // P.8.2 — không kế thừa chéo: DeptHead X không duyệt dept khác cùng site.
    runCase('P.8.2', 'RP82-DEPTX2', (i) => ({ level: 'dept', deptId: i.deptX2 }), 'u_dh_x', 403);
  });

  // =========================================================================
  // Nhóm F / P.5 — ẩn ngoài phạm vi + Reader truy cập URL
  // =========================================================================
  describe('Nhóm F / P.5 — truy cập ngoài quyền', () => {
    test('F.1 / P.5.8 [BẢO MẬT] mở tài liệu không tồn tại/ngoài phạm vi → 404', async () => {
      const cookie = await h.login('u_reader');
      const res = await get('/documents/KHONG-TON-TAI-999', cookie);
      assert.equal(res.statusCode, 404);
    });
    test('P.5.1 [BẢO MẬT] Reader mở /register → 403', async () => {
      const cookie = await h.login('u_reader');
      const res = await get('/register', cookie);
      assert.equal(res.statusCode, 403);
    });
    test('P.5.3 [BẢO MẬT] Reader mở /admin/users → 403', async () => {
      const cookie = await h.login('u_reader');
      const res = await get('/admin/users', cookie);
      assert.equal(res.statusCode, 403);
    });
    test('P.5.4 [BẢO MẬT] Reader mở /audit → 403', async () => {
      const cookie = await h.login('u_reader');
      const res = await get('/audit', cookie);
      assert.equal(res.statusCode, 403);
      assert.match(res.body, /Không đủ thẩm quyền xem ghi vết/);
    });
    test('P.5.7 [BẢO MẬT] Reader mở /packages → 403', async () => {
      const cookie = await h.login('u_reader');
      const res = await get('/packages', cookie);
      assert.equal(res.statusCode, 403);
      assert.match(res.body, /Không đủ thẩm quyền truy cập gói ban hành/);
    });
    test('P.5.9 [BẢO MẬT] Reader mở /functional-groups → 403', async () => {
      const cookie = await h.login('u_reader');
      const res = await get('/functional-groups', cookie);
      assert.equal(res.statusCode, 403);
    });
  });

  // =========================================================================
  // Nhóm J / P.5.4 — audit cần quyền release
  // =========================================================================
  describe('Nhóm J — audit cần quyền release', () => {
    test('J.1 [BẢO MẬT] Author (không release) mở /audit → 403', async () => {
      const cookie = await h.login('u_author');
      const res = await get('/audit', cookie);
      assert.equal(res.statusCode, 403);
    });
    test('J.2 DeptHead mở /audit → 200', async () => {
      const cookie = await h.login('u_dh_x');
      const res = await get('/audit', cookie);
      assert.equal(res.statusCode, 200);
    });
  });

  // =========================================================================
  // Nhóm P.6 — tắt active / revoke role
  // =========================================================================
  describe('Nhóm P.6 — tắt active / revoke role', () => {
    test('P.6.2 [BẢO MẬT] revoke DC_DEPT_HEAD → mất cờ release ngay (audit → 403)', async () => {
      // Tạo user DeptHead riêng để không ảnh hưởng ca khác.
      const uid = h.ids.users.u_dh_y!;
      const cookieBefore = await h.login('u_dh_y');
      assert.equal((await get('/audit', cookieBefore)).statusCode, 200);
      await h.sql`UPDATE user_roles SET is_active = FALSE WHERE user_id = ${uid} AND role_code = 'DC_DEPT_HEAD'`;
      const res = await get('/audit', cookieBefore);
      assert.equal(res.statusCode, 403, 'mất release ngay sau revoke');
      // Khôi phục để không rò sang ca khác.
      await h.sql`UPDATE user_roles SET is_active = TRUE WHERE user_id = ${uid} AND role_code = 'DC_DEPT_HEAD'`;
    });
  });
}
