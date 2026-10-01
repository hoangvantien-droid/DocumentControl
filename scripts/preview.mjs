/**
 * scripts/preview.mjs — generate a STATIC-HTML preview of the DCS UI.
 *
 * Purpose: render selected Eta views to standalone .html files that open
 * directly from disk (no database, no server, no htmx). Preview tool only —
 * this script does NOT touch app source, routes, domain, or design-system files.
 *
 * Run:  node scripts/preview.mjs
 * Safe to delete anytime.
 */
import { Eta } from 'eta';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const viewsDir = join(root, 'src', 'views');
const outDir = join(root, 'preview');

const eta = new Eta({ views: viewsDir, cache: false });

/**
 * Ánh xạ mã -> nhãn tiếng Việt. GIỮ ĐỒNG BỘ với src/views/labels.ts (nguồn duy
 * nhất của app). Khai lại ở đây vì preview chạy trên .mjs thuần, không qua tsc.
 */
const DOC_STATUS_LABELS = {
  cho_hoan_thien: 'Nháp chờ hoàn thiện',
  cho_xac_nhan: 'Chờ phê duyệt ban hành',
  tu_choi: 'Bị trả lại',
  da_dang_ky: 'Đã duyệt, chờ hiệu lực',
  hieu_luc: 'Đang hiệu lực',
  het_hieu_luc: 'Hết hiệu lực',
  thu_hoi: 'Đã thu hồi',
};
const SCOPE_LABELS = {
  group: 'Toàn Tập đoàn',
  bu: 'Khối (BU)',
  site: 'Nhà máy / Chi nhánh',
  dept: 'Phòng/Ban',
  department: 'Phòng/Ban',
};
const docStatusLabel = (code) => (code ? (DOC_STATUS_LABELS[code] ?? code) : '');
const scopeLabel = (level) => (level ? (SCOPE_LABELS[level] ?? level) : '');

// Mock request context — same shape render.ts merges in.
const user = { user_id: 'u1', email: 'admin@example.com', full_name: 'Quản trị viên' };
const nav = { isAdmin: true, canRegister: true, canRelease: true };
const basePath = '';

/**
 * Rewrite asset links so the file works when opened straight from disk:
 *  - /static/app.css -> ../src/public/app.css (relative to preview/)
 *  - drop the htmx script tag (static preview needs no htmx)
 * Internal href="/..." links stay as-is; they simply won't navigate.
 */
function rewriteForDisk(html) {
  return html
    .replaceAll('href="/static/app.css"', 'href="../src/public/app.css"')
    .replaceAll('<script src="/static/htmx.min.js" defer></script>', '');
}

function renderPage(template, pageData) {
  const merged = { user, nav, basePath, docStatusLabel, scopeLabel, DOC_STATUS_LABELS, SCOPE_LABELS, ...pageData };
  const html = eta.render(template, merged);
  return rewriteForDisk(html);
}

function emit(fileName, template, pageData) {
  const html = renderPage(template, pageData);
  const outPath = join(outDir, fileName);
  writeFileSync(outPath, html, 'utf8');
  console.log(outPath);
}

mkdirSync(outDir, { recursive: true });

// a. Component showcase
emit('design.html', 'design.eta', {});

// b. Search results
emit('search-results.html', 'search-results.eta', {
  q: 'mẫu lưu',
  includeHistorical: false,
  hits: [
    {
      version_id: 'v1',
      doc_id: 'MML/QA/HD-005',
      title: 'Hướng dẫn kiểm tra mẫu lưu',
      status: 'hieu_luc',
      version_no: '1.0',
      match_level: 'section',
      section_code: '6.2',
      section_title: 'Tần suất lưu mẫu',
      snippet: 'bảo quản ở 4 độ C',
      scope_level: 'site',
    },
    {
      version_id: 'v0',
      doc_id: 'MML/QA/HD-004',
      title: 'Bản cũ đã hết hiệu lực',
      status: 'het_hieu_luc',
      version_no: '1.0',
      match_level: 'title',
      current_version_no: '2.0',
    },
  ],
});

// c. Document detail
emit('detail.html', 'detail.eta', {
  d: {
    doc_id: 'MML/QA/HD-005',
    version_no: '1.0',
    title: 'Hướng dẫn kiểm tra mẫu lưu',
    status: 'hieu_luc',
    doc_type: 'WI',
    origin: 'noi_bo',
    scope_level: 'site',
    issued_date: '2026-01-01',
    approver_name: 'QA tập đoàn',
    approval_reference: 'KD-2026-0001',
    effective_date: '2026-03-01',
    next_review_date: '2027-03-01',
    qua_han_xem_xet: true,
    version_id: 'v1',
  },
  sections: [
    { section_code: '1', section_title: 'Mục đích', raw_text: 'Hướng dẫn này quy định...' },
    { section_code: '6.2', section_title: 'Tần suất lưu mẫu', raw_text: 'Mẫu lưu thành phẩm được lấy...' },
  ],
  links: [{ link_type: 'dieu_khoan', link_code: 'BRC-9-5.6.2' }],
  matrix: [],
  ackState: { show: true },
  canRecall: false,
  canRecallMatrix: false,
  current: null,
});

// d. Release confirmation
emit('confirm.html', 'confirm.eta', {
  v: {
    doc_id: 'MML/QA/SOP-012',
    version_no: '2.0',
    title: 'Quy trình abc',
    version_id: 'v9',
    supersedes_version_id: 'v8',
  },
  allowed: true,
  effectivePassed: true,
  viewedDiff: false,
  checklist: [
    { no: '1', kind: 'auto', pass: true, label: 'Chưa trùng số hiệu', level: 'ok' },
    { no: '2', kind: 'auto', pass: true, label: 'Ngày hiệu lực hợp lệ', level: 'ok' },
    { no: '9a', kind: 'manual', label: 'Số hiệu khớp', level: 'warn' },
    { no: '9b', kind: 'manual', label: 'Đã đối chiếu mức độ thay đổi', level: 'warn' },
  ],
});

// e. Registration form
emit('register.html', 'register.eta', {
  values: {},
  bus: [{ bu_id: 'b1', bu_code: 'MEAT' }],
  sites: [{ site_id: 's1', site_code: 'MML' }],
  depts: [{ dept_id: 'd1', dept_code: 'QA' }],
  error: null,
});

// f. QR verify — both outcomes
emit('verify-ok.html', 'verify.eta', {
  result: { found: true, status: 'con_hieu_luc' },
});
emit('verify-bad.html', 'verify.eta', {
  result: { found: true, status: 'het_hieu_luc', currentVersionNo: '2.0' },
});

console.log('\nPreview generated. Open the .html files in a browser (no server needed).');
