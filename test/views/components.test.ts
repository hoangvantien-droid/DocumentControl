/**
 * test/views/components.test.ts — Test render bộ 14 partial thành phần (Task 2.13).
 *
 * MỤC ĐÍCH: Bao phủ MỌI trạng thái/biến thể được ghi trong tài liệu của từng
 * partial dưới `src/views/components/`, khẳng định:
 *   1) Render KHÔNG ném lỗi và trả HTML không rỗng (assert.doesNotThrow + length>0).
 *   2) Render với PROP THIẾU/RỖNG ({}) không ném lỗi (an-toàn-prop-thiếu).
 *   3) "Màu không bao giờ là dấu hiệu duy nhất" ở mức markup: nhãn chứa chữ mô tả
 *      it.text; check-item chứa ký hiệu ✓/✕/!; alert-banner chứa prefix tiếng Việt.
 *
 * Khuôn Eta KHỚP render.test.ts / server.ts: `new Eta({ views: <src/views>,
 * cache: false })`, render THEO ĐƯỜNG DẪN FILE `eta.render('components/xxx.eta', props)`.
 * Không thêm thư viện; dùng node:test + assert 'node:assert/strict'. Không PBT
 * (đây là kết xuất UI/CSS). KHÔNG sửa render.test.ts hay các partial.
 *
 * _Requirements: 2.1, 2.2, 3.3, 4.4, 7.2 (+ bao phủ thành phần chung)._
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Eta } from 'eta';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// test/views -> ../../src/views (khớp join(__dirname,'views') trong server.ts).
const viewsRoot = join(__dirname, '..', '..', 'src', 'views');

const eta = new Eta({ views: viewsRoot, cache: false });

// Tiện ích: render một biến thể, khẳng định không ném lỗi + HTML không rỗng.
function renderOk(view: string, props: Record<string, unknown>, msg: string): string {
  let html = '';
  assert.doesNotThrow(() => {
    html = eta.render(view, props);
  }, msg);
  assert.equal(typeof html, 'string');
  assert.ok(html.length > 0, `${msg} — phải trả HTML không rỗng`);
  return html;
}

/* =========================================================================
 * status-label.eta — Nhãn trạng thái (7 mã) + Nhãn phạm vi (4 cấp).
 * _Requirements: 3.3, 2.1_
 * ========================================================================= */

const DOC_STATUS_CODES = [
  'cho_hoan_thien',
  'cho_xac_nhan',
  'tu_choi',
  'da_dang_ky',
  'hieu_luc',
  'het_hieu_luc',
  'thu_hoi',
];

for (const code of DOC_STATUS_CODES) {
  test(`status-label — kind 'doc' mã ${code} render OK + chứa chữ mô tả`, () => {
    const text = `Trạng thái ${code}`;
    const html = renderOk(
      'components/status-label.eta',
      { kind: 'doc', code, text },
      `status-label doc ${code} không được ném lỗi`,
    );
    // Màu không là dấu hiệu duy nhất: nhãn phải chứa chữ it.text.
    assert.ok(html.includes(text), `nhãn phải chứa chữ mô tả "${text}"`);
    assert.match(html, new RegExp(`status-label--${code}`), `phải gắn class trạng thái ${code}`);
  });
}

const SCOPE_LEVELS = ['group', 'bu', 'site', 'department'];
for (const level of SCOPE_LEVELS) {
  test(`status-label — kind 'scope' cấp ${level} render OK + chứa chữ mô tả`, () => {
    const text = `Phạm vi ${level}`;
    const html = renderOk(
      'components/status-label.eta',
      { kind: 'scope', level, text },
      `status-label scope ${level} không được ném lỗi`,
    );
    assert.ok(html.includes(text), `nhãn phạm vi phải chứa chữ mô tả "${text}"`);
    assert.match(html, new RegExp(`scope-label--${level}`), `phải gắn class phạm vi ${level}`);
  });
}

/* =========================================================================
 * alert-banner.eta — 4 loại; kiểm prefix tiếng Việt (color-never-sole-signal).
 * _Requirements: 4.4, 2.2_
 * ========================================================================= */

const ALERT_CASES: Array<{ type: string; prefix: string }> = [
  { type: 'error', prefix: 'Lỗi' },
  { type: 'warning', prefix: 'Cảnh báo' },
  { type: 'info', prefix: 'Thông tin' },
  { type: 'success', prefix: 'Thành công' },
];

for (const { type, prefix } of ALERT_CASES) {
  test(`alert-banner — loại ${type} render OK + chứa prefix "${prefix}"`, () => {
    const text = `Nội dung cảnh báo ${type}`;
    const html = renderOk(
      'components/alert-banner.eta',
      { type, text },
      `alert-banner ${type} không được ném lỗi`,
    );
    assert.ok(html.includes(prefix), `phải chứa prefix tiếng Việt "${prefix}"`);
    assert.ok(html.includes(text), `phải chứa chữ mô tả "${text}"`);
    assert.match(html, new RegExp(`alert-banner--${type}`), `phải gắn class loại ${type}`);
  });
}

/* =========================================================================
 * button.eta — 5 kiểu + khoá kèm lý do.
 * _Requirements: 2.5, 2.6_
 * ========================================================================= */

const BUTTON_VARIANTS = ['primary', 'secondary', 'danger', 'success', 'small'];
for (const variant of BUTTON_VARIANTS) {
  test(`button — kiểu ${variant} render OK`, () => {
    const html = renderOk(
      'components/button.eta',
      { variant, label: `Nút ${variant}` },
      `button ${variant} không được ném lỗi`,
    );
    assert.match(html, new RegExp(`btn--${variant}`), `phải gắn class kiểu ${variant}`);
    assert.ok(html.includes(`Nút ${variant}`), 'phải chứa nhãn nút');
  });
}

test('button — disabled + reason hiển thị lý do khoá cạnh nút', () => {
  const reason = 'Chưa đủ quyền phát hành';
  const html = renderOk(
    'components/button.eta',
    { variant: 'primary', label: 'Phát hành', disabled: true, reason },
    'button disabled+reason không được ném lỗi',
  );
  assert.match(html, /disabled/, 'nút phải bị disable');
  assert.ok(html.includes(reason), 'phải hiển thị lý do khoá cạnh nút');
});

/* =========================================================================
 * field.eta — 3 trạng thái nội dung (normal/error/locked); focus là CSS-only.
 * _Requirements: 6.x (bao phủ thành phần)_
 * ========================================================================= */

test('field — trạng thái Thường render OK', () => {
  renderOk(
    'components/field.eta',
    { label: 'Số hiệu', name: 'doc_id', value: 'DOC-1' },
    'field normal không được ném lỗi',
  );
});

test('field — trạng thái Lỗi render OK + có hint sửa lỗi', () => {
  const hint = 'Nhập số hiệu theo mẫu SOP-XXX';
  const html = renderOk(
    'components/field.eta',
    { label: 'Số hiệu', name: 'doc_id', state: 'error', hint },
    'field error không được ném lỗi',
  );
  assert.match(html, /field--error/, 'phải gắn class field--error');
  assert.ok(html.includes(hint), 'phải hiển thị hint nêu cách sửa');
});

test('field — trạng thái Khoá render OK + có ổ khoá kèm chữ', () => {
  const html = renderOk(
    'components/field.eta',
    { label: 'Phiên bản', name: 'version_no', value: '1.0', locked: true },
    'field locked không được ném lỗi',
  );
  assert.match(html, /field--locked/, 'phải gắn class field--locked');
  assert.match(html, /disabled/, 'input phải bị disable khi khoá');
  assert.ok(html.includes('🔒'), 'phải hiển thị ổ khoá bổ trợ');
  assert.ok(html.includes('(đã khoá)'), 'ổ khoá phải kèm chữ, không thay chữ');
});

/* =========================================================================
 * check-item.eta — 3 ký hiệu + mục tự tích + khoá.
 * _Requirements: 7.2 (ký hiệu ✓/✕/! — color-never-sole-signal)_
 * ========================================================================= */

const CHECK_MARKS: Array<{ mark: string; glyph: string }> = [
  { mark: 'ok', glyph: '✓' },
  { mark: 'fail', glyph: '✕' },
  { mark: 'warn', glyph: '!' },
];

for (const { mark, glyph } of CHECK_MARKS) {
  test(`check-item — dấu ${mark} render OK + chứa ký hiệu "${glyph}"`, () => {
    const html = renderOk(
      'components/check-item.eta',
      { mark, label: `Mục ${mark}`, no: '1' },
      `check-item ${mark} không được ném lỗi`,
    );
    assert.ok(html.includes(glyph), `phải chứa ký hiệu "${glyph}" (phân biệt không chỉ bằng màu)`);
    assert.ok(html.includes(`Mục ${mark}`), 'phải chứa nhãn mục');
    assert.match(html, new RegExp(`check-mark ${mark}`), `phải gắn class check-mark ${mark}`);
  });
}

test('check-item — mục tự tích (manual) render OK', () => {
  const html = renderOk(
    'components/check-item.eta',
    { manual: true, label: 'Đã đối chiếu nội dung', no: '10' },
    'check-item manual không được ném lỗi',
  );
  assert.match(html, /check-item--manual/, 'phải gắn class mục tự tích');
  assert.match(html, /type="checkbox"/, 'mục tự tích phải có ô tích thật');
});

test('check-item — mục tự tích khoá (manual+locked) render OK + ổ khoá kèm chữ', () => {
  const html = renderOk(
    'components/check-item.eta',
    { manual: true, locked: true, label: 'Đã xem so sánh', no: '9b' },
    'check-item manual+locked không được ném lỗi',
  );
  assert.match(html, /check-item--manual/, 'phải gắn class mục tự tích');
  assert.match(html, /disabled/, 'ô tích phải bị disable khi khoá');
  assert.ok(html.includes('🔒'), 'phải hiển thị ổ khoá');
  assert.ok(html.includes('(đã khoá)'), 'ổ khoá phải kèm chữ');
});

/* =========================================================================
 * result-card.eta — thường hiệu lực / lịch sử (superseded) / khớp cấp mục.
 * _Requirements: 9.2–9.5 (bao phủ thành phần)_
 * ========================================================================= */

test('result-card — bản còn hiệu lực (thường) render OK', () => {
  const html = renderOk(
    'components/result-card.eta',
    {
      hit: {
        version_id: 'v1',
        doc_id: 'DOC-1',
        title: 'Tài liệu 1',
        status: 'hieu_luc',
        version_no: '1.0',
        match_level: 'title',
        scope_level: 'site',
      },
    },
    'result-card effective không được ném lỗi',
  );
  assert.ok(html.includes('DOC-1'), 'phải hiển thị số hiệu');
  assert.ok(!html.includes('result-card--historical'), 'bản hiệu lực KHÔNG gắn class historical');
});

test('result-card — bản lịch sử (status != hieu_luc) có current_version_no', () => {
  const html = renderOk(
    'components/result-card.eta',
    {
      hit: {
        version_id: 'v2',
        doc_id: 'DOC-2',
        title: 'Tài liệu 2',
        status: 'het_hieu_luc',
        version_no: '2.0',
        match_level: 'title',
        current_version_no: '3.0',
      },
    },
    'result-card historical không được ném lỗi',
  );
  assert.match(html, /result-card--historical/, 'bản lịch sử phải gắn class historical');
  assert.ok(html.includes('3.0'), 'phải nêu bản đang áp dụng (current_version_no)');
});

test('result-card — khớp cấp mục (section) có snippet', () => {
  const html = renderOk(
    'components/result-card.eta',
    {
      hit: {
        version_id: 'v3',
        doc_id: 'DOC-3',
        title: 'Tài liệu 3',
        status: 'hieu_luc',
        version_no: '1.0',
        match_level: 'section',
        section_code: '5',
        section_title: 'Mục 5',
        snippet: 'đoạn trích khớp từ khoá',
      },
    },
    'result-card section không được ném lỗi',
  );
  assert.match(html, /result-card__snippet/, 'khớp cấp mục phải hiện snippet');
  assert.ok(html.includes('đoạn trích khớp từ khoá'), 'phải chứa nội dung snippet');
});

/* =========================================================================
 * progress-steps.eta — mảng steps với done(+href)/current/todo.
 * _Requirements: 11.x (bao phủ thành phần)_
 * ========================================================================= */

test('progress-steps — steps done(+href)/current/todo render OK', () => {
  const html = renderOk(
    'components/progress-steps.eta',
    {
      steps: [
        { label: 'Bước 1', state: 'done', href: '/register/step1' },
        { label: 'Bước 2', state: 'current' },
        { label: 'Bước 3', state: 'todo' },
      ],
      current: 2,
    },
    'progress-steps không được ném lỗi',
  );
  assert.match(html, /step--done/, 'phải có bước done');
  assert.match(html, /step--current/, 'phải có bước current');
  assert.match(html, /step--todo/, 'phải có bước todo');
  assert.match(html, /href="\/register\/step1"/, 'bước done phải là liên kết bấm được');
  assert.ok(html.includes('✓'), 'bước done phải có ký hiệu ✓');
});

/* =========================================================================
 * org-health.eta — có findings / rỗng (dòng xanh OK).
 * _Requirements: 12.x (bao phủ thành phần)_
 * ========================================================================= */

test('org-health — có findings render OK', () => {
  const html = renderOk(
    'components/org-health.eta',
    {
      findings: [
        { type: 'Chưa có người giữ vai trò release', target: 'BU1', consequence: 'Không thể phát hành' },
        { type: 'Thiếu người duyệt', target: 'Site ST1', consequence: 'Tài liệu treo' },
      ],
    },
    'org-health có findings không được ném lỗi',
  );
  assert.match(html, /org-health__item/, 'phải render các mục phát hiện');
  assert.ok(html.includes('BU1'), 'phải hiển thị đối tượng');
  assert.ok(!html.includes('org-health--ok'), 'khi có findings KHÔNG hiện dòng OK');
});

test('org-health — rỗng hiện dòng xanh OK', () => {
  const html = renderOk(
    'components/org-health.eta',
    { findings: [] },
    'org-health rỗng không được ném lỗi',
  );
  assert.match(html, /org-health--ok/, 'rỗng phải gắn class org-health--ok');
  assert.ok(html.includes('Không phát hiện vấn đề nào'), 'phải hiện thông điệp OK');
});

/* =========================================================================
 * toast.eta — 3 tông default/success/error.
 * _Requirements: 14.x (bao phủ thành phần)_
 * ========================================================================= */

const TOAST_TONES = ['default', 'success', 'error'];
for (const tone of TOAST_TONES) {
  test(`toast — tông ${tone} render OK`, () => {
    const html = renderOk(
      'components/toast.eta',
      { tone, text: `Thông báo ${tone}` },
      `toast ${tone} không được ném lỗi`,
    );
    assert.match(html, new RegExp(`toast--${tone}`), `phải gắn class tông ${tone}`);
    assert.ok(html.includes(`Thông báo ${tone}`), 'phải chứa nội dung thông báo');
  });
}

/* =========================================================================
 * empty-state.eta — chỉ reason / reason + action.
 * _Requirements: 15.x (bao phủ thành phần)_
 * ========================================================================= */

test('empty-state — chỉ có reason render OK', () => {
  const reason = 'Chưa có tài liệu nào thuộc phạm vi của bạn';
  const html = renderOk(
    'components/empty-state.eta',
    { reason },
    'empty-state reason-only không được ném lỗi',
  );
  assert.ok(html.includes(reason), 'phải hiện lý do cụ thể');
  assert.ok(!html.includes('empty-state__action'), 'không có action thì không render liên kết');
});

test('empty-state — reason + actionLabel + actionHref render OK', () => {
  const reason = 'Chưa có kết quả tìm kiếm';
  const html = renderOk(
    'components/empty-state.eta',
    { reason, actionLabel: 'Đăng ký tài liệu mới', actionHref: '/register' },
    'empty-state với action không được ném lỗi',
  );
  assert.match(html, /empty-state__action/, 'phải render liên kết hành động');
  assert.match(html, /href="\/register"/, 'liên kết phải trỏ đúng actionHref');
  assert.ok(html.includes('Đăng ký tài liệu mới'), 'phải hiển thị nhãn hành động');
});

/* =========================================================================
 * AN TOÀN PROP THIẾU — mọi partial render với {} không ném lỗi.
 * _Requirements: 2.1, 2.2 (partial an-toàn-prop-thiếu)_
 * ========================================================================= */

const ALL_PARTIALS = [
  'components/status-label.eta',
  'components/alert-banner.eta',
  'components/button.eta',
  'components/field.eta',
  'components/check-item.eta',
  'components/result-card.eta',
  'components/progress-steps.eta',
  'components/org-health.eta',
  'components/toast.eta',
  'components/empty-state.eta',
];

for (const partial of ALL_PARTIALS) {
  test(`an-toàn-prop-thiếu: ${partial} render với {} không ném lỗi`, () => {
    renderOk(partial, {}, `${partial} với prop rỗng không được ném lỗi`);
  });
}

/* =========================================================================
 * design.eta — Trang trưng bày thành phần (/design), Task 7.4.
 *
 * MỤC ĐÍCH: Hàng rào hồi quy MỘT-TEST cho trang tài liệu sống /design. Trang này
 * kết xuất TOÀN BỘ 14 thành phần bằng chính các partial thật dưới /components/*,
 * bọc trong layout.eta. Test khẳng định:
 *   1) Render KHÔNG ném lỗi và trả HTML không rỗng.
 *   2) Có khung layout: thẻ <html> và class="sidebar" (layout đọc it.nav, it.user).
 *   3) Chứa dấu hiệu class ĐẠI DIỆN cho cả 14 thành phần — nếu một partial vỡ
 *      hoặc bị gỡ khỏi trang trưng bày, test này bắt được ngay.
 *   4) Chứa ít nhất một nhãn tiếng Việt DÀI ('Người đăng ký ban hành') — bằng
 *      chứng trang có nhồi nhãn dài để kiểm bố cục (Yêu cầu 21/23).
 *
 * Khẳng định dùng includes/match (không phụ thuộc whitespace chính xác).
 *
 * _Requirements: 21.1, 21.2_
 * ========================================================================= */

test('design.eta — render OK với khung layout + đại diện 14 thành phần', () => {
  const html = renderOk(
    'design.eta',
    {
      user: { user_id: 'u1', email: 'admin@example.com', full_name: 'Quản trị viên' },
      nav: { isAdmin: true, canRegister: true, canRelease: true },
    },
    'design.eta không được ném lỗi khi render',
  );

  // Khung layout (layout.eta) đã ghép.
  assert.match(html, /<html/, 'phải chứa thẻ <html> từ layout.eta');
  assert.match(html, /class="sidebar"/, 'phải chứa class="sidebar" từ layout.eta');

  // Dấu hiệu class đại diện cho cả 14 thành phần.
  const COMPONENT_MARKERS = [
    'status-label',
    'alert-banner',
    'btn--primary',
    'field',
    'check-item',
    'data-table',
    'card',
    'result-card',
    'compare-grid',
    'steps',
    'org-health',
    'print-overlay',
    'toast',
    'empty-state',
  ];
  for (const marker of COMPONENT_MARKERS) {
    assert.ok(
      html.includes(marker),
      `trang trưng bày phải chứa dấu hiệu thành phần "${marker}"`,
    );
  }

  // Ít nhất một nhãn tiếng Việt dài (kiểm bố cục nhãn dài).
  assert.ok(
    html.includes('Người đăng ký ban hành'),
    'phải chứa nhãn dài "Người đăng ký ban hành"',
  );
});
