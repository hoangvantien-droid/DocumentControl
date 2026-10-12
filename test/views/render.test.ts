/**
 * test/views/render.test.ts — Bug condition exploration → fix verification (Task 3.2).
 *
 * MỤC ĐÍCH: Sau khi áp dụng fix ASI (Task 3.1), xác thực các view có "câu-xuất-
 * trước-scriptlet-mở-đầu-`(`/`[`" giờ KHÔNG còn ném lỗi ASI ("is not a function"
 * / reading 'forEach'). Đây là các test khám phá ở Task 1 nhưng ĐẢO khẳng định
 * từ "NÉM lỗi ASI" sang "render OK / lỗi ASI đã hết", đúng theo Task 3.2.
 *
 * PHÂN TÁCH KẾT QUẢ (đã quan sát khi chạy trên code ĐÃ sửa):
 *   - functional-groups.eta, packages.eta, register.eta: render OK, trả HTML
 *     không rỗng (với cả dữ liệu đủ lẫn MẢNG RỖNG — Requirement 3.5). Lỗi ASI hết.
 *   - admin/roles.eta, admin/users.eta: lỗi ASI ("is not a function") ĐÃ HẾT,
 *     NHƯNG lộ ra một lỗi KHÁC GỐC, tồn tại từ trước: các view trong thư mục con
 *     `admin/` gọi `layout('layout.eta')` bị Eta phân giải TƯƠNG ĐỐI thành
 *     `admin/layout.eta` (không tồn tại) → EtaFileResolutionError "Could not find
 *     template". Đây KHÔNG phải bug ASI của spec này (giống hệt vấn đề đã ghi cho
 *     admin/org.eta ở Task 2) và nằm NGOÀI phạm vi fix Task 3.1. Vì vậy với 2 view
 *     này ta khẳng định: lỗi ASI đã hết (KHÔNG còn "is not a function") — bằng cách
 *     kiểm chứng thông điệp lỗi còn lại là lỗi resolve layout thư mục con, KHÔNG
 *     phải lỗi ASI. KHÔNG sửa .eta để tránh vượt phạm vi task.
 *
 * Cấu hình Eta khớp server (src/server.ts): `new Eta({ views: <src/views>,
 * cache: false })` và render THEO FILE (eta.render) — khớp cách route gọi
 * `reply.view('admin/roles.eta', …)`. Không cần PostgreSQL, dùng dữ liệu giả.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Eta } from 'eta';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { docStatusLabel, scopeLabel, roleLabel } from '../../src/views/labels.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// test/views -> ../../src/views (khớp join(__dirname,'views') trong server.ts).
const viewsRoot = join(__dirname, '..', '..', 'src', 'views');

const eta = new Eta({ views: viewsRoot, cache: false });

// Trộn nhãn tiếng Việt dùng chung (docStatusLabel/scopeLabel) vào mọi lần render,
// khớp với src/views/render.ts để template gọi it.docStatusLabel/it.scopeLabel.
const _rawRender = eta.render.bind(eta);
(eta as unknown as { render: typeof _rawRender }).render = ((tpl: string, data?: Record<string, unknown>) =>
  _rawRender(tpl, { docStatusLabel, scopeLabel, roleLabel, ...(data ?? {}) })) as typeof _rawRender;

// nav/user dùng chung cho layout.eta (layout đọc it.nav, it.user, it.title).
const nav = { isAdmin: true, canRegister: true, canRelease: true };
const user = { user_id: 'u1', email: 'admin@example.com', full_name: 'Quản trị viên' };

// admin/roles.eta: sau fix layout thư mục con (đổi 'layout.eta' -> '/layout.eta'),
// view này render OK, trả HTML không rỗng (khung layout đã ghép). Lỗi ASI cũng đã
// hết từ fix 3.1 và lỗi "Could not find template" nay không còn.
test('admin/roles.eta — render OK sau fix layout (trả HTML không rỗng)', () => {
  const data = {
    user,
    nav,
    error: null,
    users: [{ user_id: 'u1', email: 'a@ex.com', full_name: 'Người A' }],
    rolesByUser: { u1: [{ role_code: 'DC_AUTHOR', scope_level: 'site' }] },
    bus: [{ bu_id: 'b1', bu_code: 'BU1' }],
    sites: [{ site_id: 's1', site_code: 'ST1' }],
    depts: [{ dept_id: 'd1', dept_code: 'DP1' }],
  };
  let html = '';
  assert.doesNotThrow(() => {
    html = eta.render('admin/roles.eta', data);
  }, 'admin/roles.eta không được ném lỗi sau fix layout');
  assert.equal(typeof html, 'string');
  assert.ok(html.length > 0, 'phải trả HTML không rỗng');
  assert.match(html, /<html/, 'phải chứa khung layout (thẻ <html>)');
});

test('functional-groups.eta — render OK sau fix (trả HTML không rỗng)', () => {
  const data = {
    user,
    nav,
    error: null,
    stale: [],
    groups: [
      {
        group_id: 'g1',
        code: 'FG-1',
        name: 'Nhóm 1',
        owner_user_id: 'u1',
        review_cycle_months: 12,
        member_count: 1,
      },
    ],
    users: [{ user_id: 'u1', email: 'a@ex.com', full_name: 'Người A' }],
    membersByGroup: {
      g1: [{ user_id: 'u1', email: 'a@ex.com', full_name: 'Người A' }],
    },
  };
  let html = '';
  assert.doesNotThrow(() => {
    html = eta.render('functional-groups.eta', data);
  }, 'functional-groups.eta không được ném lỗi ASI sau fix');
  assert.equal(typeof html, 'string');
  assert.ok(html.length > 0, 'phải trả HTML không rỗng');
});

// Requirement 3.5: view đã sửa render với MẢNG RỖNG (membersByGroup:{} → ms=[]) không ném lỗi.
test('functional-groups.eta — mảng rỗng (membersByGroup:{}) render OK', () => {
  const data = {
    user,
    nav,
    error: null,
    stale: [],
    groups: [
      {
        group_id: 'g1',
        code: 'FG-1',
        name: 'Nhóm 1',
        owner_user_id: 'u1',
        review_cycle_months: 12,
        member_count: 0,
      },
    ],
    users: [{ user_id: 'u1', email: 'a@ex.com', full_name: 'Người A' }],
    membersByGroup: {},
  };
  let html = '';
  assert.doesNotThrow(() => {
    html = eta.render('functional-groups.eta', data);
  }, 'functional-groups.eta với mảng rỗng không được ném lỗi');
  assert.ok(html.length > 0, 'phải trả HTML không rỗng');
});

// admin/users.eta: cùng nhóm với admin/roles.eta — sau fix layout thư mục con,
// view render OK và trả HTML không rỗng (khung layout đã ghép).
test('admin/users.eta — render OK sau fix layout (trả HTML không rỗng)', () => {
  const data = {
    user,
    nav,
    error: null,
    users: [
      { user_id: 'u1', email: 'a@ex.com', full_name: 'Người A', is_active: true },
    ],
    deptsByUser: { u1: ['d1'] },
    depts: [{ dept_id: 'd1', dept_code: 'DP1' }],
  };
  let html = '';
  assert.doesNotThrow(() => {
    html = eta.render('admin/users.eta', data);
  }, 'admin/users.eta không được ném lỗi sau fix layout');
  assert.equal(typeof html, 'string');
  assert.ok(html.length > 0, 'phải trả HTML không rỗng');
  assert.match(html, /<html/, 'phải chứa khung layout (thẻ <html>)');
});

test('packages.eta — render OK sau fix (trả HTML không rỗng)', () => {
  const data = {
    user,
    nav,
    error: null,
    packages: [
      {
        package_id: 'p1',
        package_code: 'PKG-1',
        title: 'Gói 1',
        status: 'dang_mo',
        confirmed_count: 0,
        member_count: 1,
        effective_date: '2025-01-01',
      },
    ],
    membersByPkg: {
      p1: [
        {
          version_id: 'v1',
          doc_id: 'DOC-1',
          version_no: '1.0',
          title: 'Tài liệu 1',
          status: 'hieu_luc',
        },
      ],
    },
    attachable: [],
  };
  let html = '';
  assert.doesNotThrow(() => {
    html = eta.render('packages.eta', data);
  }, 'packages.eta không được ném lỗi ASI sau fix');
  assert.equal(typeof html, 'string');
  assert.ok(html.length > 0, 'phải trả HTML không rỗng');
});

// Requirement 3.5: view đã sửa render với MẢNG RỖNG (membersByPkg:{} → mm=[]) không ném lỗi.
test('packages.eta — mảng rỗng (membersByPkg:{}) render OK', () => {
  const data = {
    user,
    nav,
    error: null,
    packages: [
      {
        package_id: 'p1',
        package_code: 'PKG-1',
        title: 'Gói 1',
        status: 'dang_mo',
        confirmed_count: 0,
        member_count: 0,
        effective_date: '2025-01-01',
      },
    ],
    membersByPkg: {},
    attachable: [],
  };
  let html = '';
  assert.doesNotThrow(() => {
    html = eta.render('packages.eta', data);
  }, 'packages.eta với mảng rỗng không được ném lỗi');
  assert.ok(html.length > 0, 'phải trả HTML không rỗng');
});

// register.eta — hai vị trí ASI (mảng literal ['SOP',…] và ['group',…]) đã sửa.
// values:{} (mảng rỗng ngầm) render OK theo Requirement 3.5.
test('register.eta — render OK sau fix (values:{}, trả HTML không rỗng)', () => {
  const data = {
    user,
    nav,
    error: null,
    values: {},
    bus: [{ bu_id: 'b1', bu_code: 'BU1' }],
    sites: [{ site_id: 's1', site_code: 'ST1' }],
    depts: [{ dept_id: 'd1', dept_code: 'DP1' }],
  };
  let html = '';
  assert.doesNotThrow(() => {
    html = eta.render('register.eta', data);
  }, 'register.eta không được ném lỗi ASI sau fix');
  assert.equal(typeof html, 'string');
  assert.ok(html.length > 0, 'phải trả HTML không rỗng');
});

/* =========================================================================
 * TASK 2 — Preservation property tests (Property 2).
 *
 * MỤC ĐÍCH: Ghi cố định BASELINE cần bảo toàn TRÊN CODE CHƯA SỬA. Các view
 * KHÔNG dính lỗi ASI phải render OK (không ném lỗi, trả HTML không rỗng) và
 * HTML ổn định giữa các lần render. Đây là hàng rào chống hồi quy: sau khi sửa
 * (task 3) các test này phải VẪN xanh.
 *
 * PHƯƠNG PHÁP: PBT thu gọn / table-driven với node:test (KHÔNG thêm thư viện).
 * Mỗi view không-lỗi được cấp dữ liệu giả hợp lệ (đọc từng .eta để biết field)
 * ở hai biến thể: mảng RỖNG và mảng CÓ phần tử. Dùng CÙNG cấu hình Eta như
 * Task 1 (biến `eta`, `nav`, `user` khai báo phía trên).
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
 * ========================================================================= */

// Giá trị chứa ký tự cần escape (<, &, ") để kiểm chứng bảo toàn escape.
const XSS = '<b>&"x';
const XSS_ESCAPED = '&lt;b&gt;&amp;&quot;x'; // Eta escape: < & " (HTML entities)

/**
 * Bảng view không-lỗi (đối chứng) × biến thể dữ liệu. Mỗi mục cấp đủ trường để
 * template chạy trọn. Với view có mảng: cung cấp biến thể rỗng và có-phần-tử.
 */
type Variant = { label: string; view: string; data: Record<string, unknown> };

const variants: Variant[] = [
  // --- home.eta: pending/rejected (mảng) ---
  { label: 'home.eta (mảng rỗng)', view: 'home.eta', data: { user, nav, pending: [], rejected: [] } },
  {
    label: 'home.eta (mảng có phần tử)',
    view: 'home.eta',
    data: {
      user,
      nav,
      pending: [
        { version_id: 'v1', doc_id: 'DOC-1', version_no: '1.0', title: 'Tài liệu 1' },
        { version_id: 'v2', doc_id: 'DOC-2', version_no: '2.0', title: 'Tài liệu 2' },
      ],
      rejected: [{ doc_id: 'DOC-3', version_no: '1.0', title: 'Tài liệu 3', rejection_reason: 'Thiếu chữ ký' }],
    },
  },

  // --- reviews.eta: active/pending (mảng) ---
  { label: 'reviews.eta (mảng rỗng)', view: 'reviews.eta', data: { user, nav, active: [], pending: [] } },
  {
    label: 'reviews.eta (mảng có phần tử)',
    view: 'reviews.eta',
    data: {
      user,
      nav,
      active: [
        { review_id: 'r1', doc_id: 'DOC-1', version_no: '1.0', title: 'TL 1', due_date: '2025-06-01', so_ngay_qua_han: 3 },
      ],
      pending: [{ doc_id: 'DOC-2', version_no: '2.0', title: 'TL 2', verdict_note: 'Cần bổ sung mục 5' }],
    },
  },

  // --- detail.eta: sections/links/matrix (mảng), d (object) ---
  {
    label: 'detail.eta (mảng rỗng)',
    view: 'detail.eta',
    data: {
      user,
      nav,
      d: {
        doc_id: 'DOC-1', version_no: '1.0', title: 'TL 1', status: 'hieu_luc', origin: 'noi_bo',
        doc_type: 'SOP', scope_level: 'site', version_id: 'v1',
      },
      current: null, sections: [], links: [], matrix: [],
      ackState: null, canRecallMatrix: false, canRecall: false,
    },
  },
  {
    label: 'detail.eta (mảng có phần tử)',
    view: 'detail.eta',
    data: {
      user,
      nav,
      d: {
        doc_id: 'DOC-1', version_no: '1.0', title: 'TL 1', status: 'hieu_luc', origin: 'noi_bo',
        doc_type: 'SOP', scope_level: 'site', version_id: 'v1',
        issued_date: '2025-01-01', approver_name: 'Người duyệt', approval_reference: 'QD-1',
        effective_date: '2025-02-01', next_review_date: '2026-02-01',
      },
      current: { version_id: 'v0', version_no: '0.9' },
      sections: [{ section_code: '1', section_title: 'Mục 1', raw_text: 'Nội dung' }],
      links: [{ link_type: 'quy_dinh', link_code: 'QD-01' }],
      matrix: [{ matrix_id: 'm1', department_code: 'DP1', functional_group_name: 'Nhóm A' }],
      ackState: { show: true }, canRecallMatrix: true, canRecall: true,
    },
  },

  // --- login.eta: standalone (không layout) ---
  { label: 'login.eta (không lỗi)', view: 'login.eta', data: { error: null } },
  { label: 'login.eta (có lỗi)', view: 'login.eta', data: { error: 'Sai mật khẩu' } },

  // --- compare.eta: rows (mảng) ---
  { label: 'compare.eta (đầu tiên)', view: 'compare.eta', data: { user, nav, reliability: 'la_phien_ban_dau_tien', rows: [] } },
  {
    label: 'compare.eta (có rows)',
    view: 'compare.eta',
    data: {
      user, nav, reliability: 'dang_tin',
      rows: [
        { change_type: 'them', section_code: '2', new_title: 'Mục 2', new_text: 'Thêm' },
        { change_type: 'xoa', section_code: '3', old_title: 'Mục 3', old_text: 'Bỏ' },
        { change_type: 'doi_tieu_de', section_code: '4', old_title: 'Cũ', new_title: 'Mới' },
        { change_type: 'sua', section_code: '5', old_title: 'M5', new_title: 'M5', old_text: 'a', new_text: 'b' },
      ],
    },
  },

  // --- matrix-options.eta: depts/groups (mảng) — mảnh (không layout) ---
  { label: 'matrix-options.eta (rỗng)', view: 'matrix-options.eta', data: { id: 'v1', depts: [], groups: [] } },
  {
    label: 'matrix-options.eta (có phần tử)',
    view: 'matrix-options.eta',
    data: {
      id: 'v1',
      depts: [{ dept_id: 'd1', dept_code: 'DP1' }],
      groups: [{ group_id: 'g1', code: 'FG-1' }],
    },
  },

  // --- search-results.eta: hits (mảng) ---
  { label: 'search-results.eta (0 kết quả)', view: 'search-results.eta', data: { user, nav, q: 'abc', includeHistorical: false, hits: [] } },
  {
    label: 'search-results.eta (có hits)',
    view: 'search-results.eta',
    data: {
      user, nav, q: 'abc', includeHistorical: true,
      hits: [
        { version_id: 'v1', doc_id: 'DOC-1', title: 'TL 1', status: 'hieu_luc', version_no: '1.0', match_level: 'title' },
        { version_id: 'v2', doc_id: 'DOC-2', title: 'TL 2', status: 'het_hieu_luc', version_no: '2.0', match_level: 'section', section_code: '1', section_title: 'Mục 1', snippet: '…' },
      ],
    },
  },

  // --- search-suggest.eta: hits (mảng) — mảnh ---
  { label: 'search-suggest.eta (rỗng)', view: 'search-suggest.eta', data: { hits: [] } },
  {
    label: 'search-suggest.eta (có hits)',
    view: 'search-suggest.eta',
    data: { hits: [{ version_id: 'v1', doc_id: 'DOC-1', version_no: '1.0', title: 'TL 1', status: 'hieu_luc' }] },
  },

  // --- audit.eta: rows/eventTypes (mảng), filter (object) ---
  {
    label: 'audit.eta (rỗng)',
    view: 'audit.eta',
    data: { user, nav, filter: {}, eventTypes: [], rows: [] },
  },
  {
    label: 'audit.eta (có phần tử)',
    view: 'audit.eta',
    data: {
      user, nav,
      filter: { object_id: 'v1', event_type: 'tao_moi', from: '2025-01-01', to: '2025-12-31' },
      eventTypes: ['tao_moi', 'xac_nhan'],
      rows: [{ occurred_at: '2025-05-01', actor_name: 'Người A', actor_type: 'nguoi_dung', event_type: 'tao_moi', object_type: 'version', object_id: 'v1' }],
    },
  },

  // --- my-documents.eta: docs (mảng) ---
  { label: 'my-documents.eta (rỗng)', view: 'my-documents.eta', data: { user, nav, docs: [] } },
  {
    label: 'my-documents.eta (có phần tử)',
    view: 'my-documents.eta',
    data: {
      user, nav,
      docs: [
        { doc_id: 'DOC-1', version_no: '1.0', title: 'TL 1', status: 'hieu_luc', effective_date: '2025-02-01' },
        { doc_id: 'DOC-2', version_no: '1.0', title: 'TL 2', status: 'tu_choi', rejection_reason: 'Thiếu mục 5' },
      ],
    },
  },

  // --- pending.eta: docs (mảng) ---
  { label: 'pending.eta (rỗng)', view: 'pending.eta', data: { user, nav, docs: [] } },
  {
    label: 'pending.eta (có phần tử)',
    view: 'pending.eta',
    data: { user, nav, docs: [{ doc_id: 'DOC-1', version_no: '1.0', title: 'TL 1', version_id: 'v1', effective_date: '2025-02-01' }] },
  },

  // --- confirm.eta: checklist (mảng), v (object) ---
  {
    label: 'confirm.eta (checklist rỗng)',
    view: 'confirm.eta',
    data: {
      user, nav,
      v: { doc_id: 'DOC-1', version_no: '1.0', title: 'TL 1', version_id: 'v1', supersedes_version_id: null },
      allowed: true, effectivePassed: true, viewedDiff: false, checklist: [],
    },
  },
  {
    label: 'confirm.eta (có checklist)',
    view: 'confirm.eta',
    data: {
      user, nav,
      v: { doc_id: 'DOC-1', version_no: '1.0', title: 'TL 1', version_id: 'v1', supersedes_version_id: 'v0' },
      allowed: true, effectivePassed: true, viewedDiff: false,
      checklist: [
        { kind: 'auto', no: '1', level: 'a', pass: true, label: 'Kiểm tra tự động', note: 'OK' },
        { kind: 'manual', no: '9b', level: 'b', label: 'Đã xem so sánh' },
        { kind: 'manual', no: '10', level: 'b', label: 'Xác nhận nội dung' },
      ],
    },
  },

  // --- recall.eta: impact (object), d (object) ---
  {
    label: 'recall.eta',
    view: 'recall.eta',
    data: {
      user, nav, error: null,
      d: { doc_id: 'DOC-1', version_no: '1.0', version_id: 'v1' },
      impact: { distribution_count: 2, printed_copies_active: 1, referencing_links: 3 },
    },
  },

  // --- print-result.eta: rec (object) ---
  {
    label: 'print-result.eta',
    view: 'print-result.eta',
    data: {
      user, nav,
      rec: { doc_id: 'DOC-1', version_no: '1.0', print_id: 'PR-1', printed_at: '2025-05-01', verify_token: 'tok123' },
    },
  },

  // --- verify.eta: result (object) — standalone ---
  { label: 'verify.eta (không tìm thấy)', view: 'verify.eta', data: { result: { found: false } } },
  { label: 'verify.eta (còn hiệu lực)', view: 'verify.eta', data: { result: { found: true, status: 'con_hieu_luc' } } },
  { label: 'verify.eta (hết hiệu lực)', view: 'verify.eta', data: { result: { found: true, status: 'het_hieu_luc', currentVersionNo: '2.0' } } },

  // --- catalog.eta: docs (mảng) ---
  { label: 'catalog.eta (rỗng)', view: 'catalog.eta', data: { user, nav, docs: [] } },
  {
    label: 'catalog.eta (có phần tử)',
    view: 'catalog.eta',
    data: {
      user, nav,
      docs: [{ version_id: 'v1', doc_id: 'DOC-1', version_no: '1.0', title: 'TL 1', doc_type: 'SOP', scope_level: 'site', status: 'hieu_luc', effective_date: '2025-02-01' }],
    },
  },

  // NOTE: admin/org.eta bị BỎ khỏi bảng preservation. Nó KHÔNG dính lỗi ASI,
  // nhưng khi render bằng raw eta.render (giống server), lời gọi
  // `layout('layout.eta')` trong một view ở thư mục con `admin/` được Eta phân
  // giải TƯƠNG ĐỐI thành `admin/layout.eta` (không tồn tại) -> ném
  // "Could not find template". Đây là lỗi RESOLVE LAYOUT thư mục con, KHÁC gốc
  // với bug ASI của spec này, nên nằm ngoài phạm vi Task 2. Đã báo lại trong
  // báo cáo. (admin/roles.eta, admin/users.eta ném trước ở bug ASI nên không lộ
  // ra vấn đề này.)
];

// Property 2 (bảo toàn — render OK): mọi view không-lỗi render KHÔNG ném lỗi và
// trả chuỗi HTML không rỗng, với cả mảng rỗng lẫn mảng có phần tử.
// _Requirements: 3.1, 3.5_
for (const v of variants) {
  test(`preservation: ${v.label} — render OK, HTML không rỗng`, () => {
    let html = '';
    assert.doesNotThrow(() => {
      html = eta.render(v.view, v.data);
    }, `View "${v.view}" không được ném lỗi khi render`);
    assert.equal(typeof html, 'string');
    assert.ok(html.length > 0, `View "${v.view}" phải trả HTML không rỗng`);
  });
}

// Property 2 (ổn định): render hai lần cùng dữ liệu cho ra HTML giống hệt nhau.
// _Requirements: 3.1_
for (const v of variants) {
  test(`preservation: ${v.label} — HTML ổn định (render hai lần bằng nhau)`, () => {
    const a = eta.render(v.view, v.data);
    const b = eta.render(v.view, v.data);
    assert.equal(a, b, `View "${v.view}" phải cho HTML ổn định giữa hai lần render`);
  });
}

// Bảo toàn mẫu (<%= %>): home.eta có "(<%= it.pending.length %>)" phải cho ra
// "(<số>)" như VĂN BẢN, không phải lỗi. _Requirements: 3.2_
test('preservation: mẫu "(<%= %>)" trong home.eta cho ra "(<số>)" như văn bản', () => {
  const data = {
    user,
    nav,
    pending: [
      { version_id: 'v1', doc_id: 'DOC-1', version_no: '1.0', title: 'TL 1' },
      { version_id: 'v2', doc_id: 'DOC-2', version_no: '2.0', title: 'TL 2' },
    ],
    rejected: [{ doc_id: 'DOC-3', version_no: '1.0', title: 'TL 3', rejection_reason: 'x' }],
  };
  const html = eta.render('home.eta', data);
  // pending.length === 2, rejected.length === 1 → hiển thị "(2)" và "(1)".
  assert.match(html, /\(2\)/, 'phải chứa "(2)" từ pending.length');
  assert.match(html, /\(1\)/, 'phải chứa "(1)" từ rejected.length');
});

// Bảo toàn layout: view có layout(...) cho ra khung layout.eta (thẻ <html>,
// class sidebar). _Requirements: 3.4_
test('preservation: layout ghép đúng (view có layout -> có <html> và class sidebar)', () => {
  const html = eta.render('home.eta', { user, nav, pending: [], rejected: [] });
  assert.match(html, /<html/, 'phải chứa thẻ <html> từ layout.eta');
  assert.match(html, /class="sidebar"/, 'phải chứa class="sidebar" từ layout.eta');
  // Thân view (home) được nhúng vào layout qua <%~ it.body %>.
  assert.match(html, /class="home"/, 'phải chứa thân view home nhúng trong layout');
});

// Bảo toàn escape: giá trị chứa <, &, " được escape đúng qua __eta.e.
// _Requirements: 3.1 (giữ nguyên hành vi escape)_
test('preservation: escape "<", "&", "\\"" đúng qua output tag', () => {
  // catalog.eta xuất d.title qua <%= d.title %> → phải được escape.
  const html = eta.render('catalog.eta', {
    user,
    nav,
    docs: [{ version_id: 'v1', doc_id: 'DOC-1', version_no: '1.0', title: XSS, doc_type: 'SOP', scope_level: 'site', status: 'hieu_luc', effective_date: '' }],
  });
  assert.match(html, new RegExp(XSS_ESCAPED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'title chứa <,&," phải bị escape');
  // Không được xuất raw "<b>" chưa escape trong nội dung (dấu hiệu escape hỏng).
  assert.ok(!html.includes('<b>&"x'), 'không được lọt chuỗi chưa escape vào HTML');
});

/* =========================================================================
 * BUG FIX — layout thư mục con admin/ ('layout.eta' -> '/layout.eta').
 *
 * Các view trong src/views/admin/ gọi `layout('layout.eta', …)`; Eta 3.5.0 phân
 * giải TƯƠNG ĐỐI theo thư mục view -> tìm 'admin/layout.eta' (không tồn tại) ->
 * ném EtaFileResolutionError "Could not find template" -> GET /admin/* trả 500.
 * Fix: đổi thành đường dẫn TUYỆT ĐỐI '/layout.eta' (từ views root). Các test dưới
 * khẳng định cả 3 view admin render OK, trả HTML không rỗng chứa khung layout.
 * ========================================================================= */

test('admin/org.eta — render OK sau fix layout (trả HTML không rỗng)', () => {
  const data = {
    user,
    nav,
    error: null,
    bus: [{ bu_id: 'b1', bu_code: 'BU1', name: 'Đơn vị 1' }],
    sites: [{ site_id: 's1', site_code: 'ST1', name: 'Site 1', bu_id: 'b1' }],
    depts: [{ dept_id: 'd1', dept_code: 'DP1', name: 'Phòng 1', site_id: 's1' }],
  };
  let html = '';
  assert.doesNotThrow(() => {
    html = eta.render('admin/org.eta', data);
  }, 'admin/org.eta không được ném lỗi sau fix layout');
  assert.equal(typeof html, 'string');
  assert.ok(html.length > 0, 'phải trả HTML không rỗng');
  assert.match(html, /<html/, 'phải chứa khung layout (thẻ <html>)');
  assert.match(html, /class="sidebar"/, 'phải chứa class="sidebar" từ layout.eta');
});

test('admin/roles.eta — render OK sau fix layout (khung layout đầy đủ)', () => {
  const data = {
    user,
    nav,
    error: null,
    users: [{ user_id: 'u1', email: 'a@ex.com', full_name: 'Người A' }],
    rolesByUser: { u1: [{ role_code: 'DC_AUTHOR', scope_level: 'site' }] },
    bus: [{ bu_id: 'b1', bu_code: 'BU1' }],
    sites: [{ site_id: 's1', site_code: 'ST1' }],
    depts: [{ dept_id: 'd1', dept_code: 'DP1' }],
  };
  let html = '';
  assert.doesNotThrow(() => {
    html = eta.render('admin/roles.eta', data);
  }, 'admin/roles.eta không được ném lỗi sau fix layout');
  assert.ok(html.length > 0, 'phải trả HTML không rỗng');
  assert.match(html, /class="sidebar"/, 'phải chứa class="sidebar" từ layout.eta');
});

test('admin/users.eta — render OK sau fix layout (khung layout đầy đủ)', () => {
  const data = {
    user,
    nav,
    error: null,
    users: [{ user_id: 'u1', email: 'a@ex.com', full_name: 'Người A', is_active: true }],
    deptsByUser: { u1: ['d1'] },
    depts: [{ dept_id: 'd1', dept_code: 'DP1' }],
  };
  let html = '';
  assert.doesNotThrow(() => {
    html = eta.render('admin/users.eta', data);
  }, 'admin/users.eta không được ném lỗi sau fix layout');
  assert.ok(html.length > 0, 'phải trả HTML không rỗng');
  assert.match(html, /class="sidebar"/, 'phải chứa class="sidebar" từ layout.eta');
});
