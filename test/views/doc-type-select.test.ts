/**
 * test/views/doc-type-select.test.ts — Task 2.4 (catalog-excel-export).
 *
 * MỤC ĐÍCH: Xác thực bộ chọn "Loại" (<select name="doc_type">) trong register.eta
 * và catalog.eta được dựng TỪ nguồn dùng chung DOC_TYPES (src/domain/doc-types.ts),
 * render đúng 5 <option> với đúng `value` = SOP, WI, Form, Policy, External.
 *
 * Cấu hình Eta khớp server (src/server.ts) và khớp cách test/views/render.test.ts
 * dựng Eta instance với thư mục `views` + trộn helper scopeLabel/docStatusLabel.
 * Không cần PostgreSQL — chỉ render template với dữ liệu giả tối thiểu.
 *
 * _Requirements: 3.2, 3.3_
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Eta } from 'eta';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { docStatusLabel, scopeLabel, roleLabel } from '../../src/views/labels.js';
import { DOC_TYPES } from '../../src/domain/doc-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// test/views -> ../../src/views (khớp join(__dirname,'views') trong server.ts).
const viewsRoot = join(__dirname, '..', '..', 'src', 'views');

const eta = new Eta({ views: viewsRoot, cache: false });

// Trộn helper nhãn tiếng Việt vào mọi lần render, khớp src/views/render.ts để
// template gọi được it.scopeLabel / it.docStatusLabel.
const _rawRender = eta.render.bind(eta);
(eta as unknown as { render: typeof _rawRender }).render = ((tpl: string, data?: Record<string, unknown>) =>
  _rawRender(tpl, { docStatusLabel, scopeLabel, roleLabel, ...(data ?? {}) })) as typeof _rawRender;

// nav/user dùng chung cho layout.eta (layout đọc it.nav, it.user, it.title).
const nav = { isAdmin: true, canRegister: true, canRelease: true };
const user = { user_id: 'u1', email: 'admin@example.com', full_name: 'Quản trị viên' };

// 5 mã doc_type kỳ vọng — nguồn sự thật là DOC_TYPES, liệt kê cứng để canh gác.
const EXPECTED_CODES = ['SOP', 'WI', 'Form', 'Policy', 'External'] as const;

// Canh gác: DOC_TYPES đúng 5 mục với đúng mã kỳ vọng (nếu lệch, mọi khẳng định
// dưới mất ý nghĩa nên chặn sớm tại đây).
test('DOC_TYPES chứa đúng 5 mã kỳ vọng', () => {
  assert.deepEqual(
    DOC_TYPES.map((t) => t.code),
    [...EXPECTED_CODES],
    'DOC_TYPES phải là SOP, WI, Form, Policy, External theo đúng thứ tự',
  );
});

/** Đếm số lần xuất hiện của `value="<code>"` trong HTML (khớp bền theo chuỗi con). */
function countOptionValue(html: string, code: string): number {
  const needle = `value="${code}"`;
  let count = 0;
  let idx = html.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = html.indexOf(needle, idx + needle.length);
  }
  return count;
}

// register.eta: bộ chọn "Loại" lặp it.docTypes → render đúng 5 option value.
// _Requirements: 3.2
test('register.eta — bộ chọn "Loại" render đúng 5 option value từ DOC_TYPES', () => {
  const data = {
    user,
    nav,
    error: null,
    values: {},
    docTypes: DOC_TYPES,
    bus: [{ bu_id: 'b1', bu_code: 'BU1' }],
    sites: [{ site_id: 's1', site_code: 'ST1', name: 'Site 1' }],
    depts: [{ dept_id: 'd1', dept_code: 'DP1' }],
    selectedSiteIds: [],
    supersedeOptions: '',
  };
  let html = '';
  assert.doesNotThrow(() => {
    html = eta.render('register.eta', data);
  }, 'register.eta không được ném lỗi khi render');

  for (const code of EXPECTED_CODES) {
    assert.ok(
      html.includes(`value="${code}"`),
      `register.eta phải chứa <option value="${code}">`,
    );
    // doc_type là bộ chọn DUY NHẤT dùng các mã này → đúng 1 lần mỗi mã.
    assert.equal(
      countOptionValue(html, code),
      1,
      `register.eta chỉ được có đúng 1 option value="${code}"`,
    );
  }
});

// catalog.eta: bộ lọc "Loại" có leading <option value=""> rồi lặp it.docTypes.
// _Requirements: 3.3
test('catalog.eta — bộ lọc "Loại" render đúng 5 option value từ DOC_TYPES', () => {
  const data = {
    user,
    nav,
    docs: [],
    docTypes: DOC_TYPES,
    filters: {},
    statusFilter: '',
    sites: [{ site_id: 's1', site_code: 'ST1', name: 'Site 1' }],
    siteOptions: '',
  };
  let html = '';
  assert.doesNotThrow(() => {
    html = eta.render('catalog.eta', data);
  }, 'catalog.eta không được ném lỗi khi render');

  for (const code of EXPECTED_CODES) {
    assert.ok(
      html.includes(`value="${code}"`),
      `catalog.eta phải chứa <option value="${code}">`,
    );
    assert.equal(
      countOptionValue(html, code),
      1,
      `catalog.eta chỉ được có đúng 1 option value="${code}"`,
    );
  }
});
