/**
 * scripts/check-detail-dates.mjs — Render-check thuần cho src/views/detail.eta
 * (không cần DB/trình duyệt). Khẳng định các thuộc tính đúng đắn của spec
 * date-label-clarity:
 *   P2 — nhãn issued_date đúng nghĩa: "Ngày ban hành", KHÔNG "Ngày áp dụng dự kiến".
 *   P3 — apply_date chỉ cho site đã chấp nhận (chap_nhan), site khác để trống.
 *   P5 — rỗng an toàn: receipts rỗng -> render không lỗi + nêu "Chưa phát hành tới site nào.".
 *
 * Chạy:  node scripts/check-detail-dates.mjs   (từ thư mục dcs)
 */
import { Eta } from 'eta';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const eta = new Eta({ views: join(__dirname, '..', 'src', 'views'), cache: false });

// Props tối thiểu dùng chung cho layout + detail để render không vỡ.
function baseData(receipts) {
  return {
    title: 'Chi tiết — DCS',
    user: { full_name: 'A' },
    nav: { canReport: false },
    assetVersion: 'test',
    basePath: '',
    scopeLabel: (x) => x,
    receiptStatusLabel: (x) => x,
    receiptRejectTypeLabel: (x) => x,
    d: {
      doc_id: 'QT-01',
      version_no: '1.0',
      title: 'X',
      status: 'da_ban_hanh',
      scope_level: 'site',
      doc_type: 'QT',
      origin: 'noi_bo',
      issued_date: '2025-01-01',
      effective_date: '2025-01-05',
      next_review_date: '2026-01-05',
      version_id: 'v1',
    },
    sections: [],
    links: [],
    printedCopies: [],
    history: [],
    current: null,
    ackState: { show: false, done: false },
    isRegistrant: false,
    sites: [],
    receipts,
  };
}

const results = [];
function assert(name, cond) {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
}

// ── Ca A: receipts rỗng ───────────────────────────────────────────────────
console.log('\n── Ca A: receipts = [] ──');
let htmlA = '';
let errA = null;
try {
  htmlA = eta.render('detail.eta', baseData([]));
} catch (e) {
  errA = e;
}
assert('A1 (P5) render không lỗi khi receipts rỗng', errA === null);
assert('A2 (P5) chứa "Chưa phát hành tới site nào."', htmlA.includes('Chưa phát hành tới site nào.'));
assert('A3 (P2) chứa nhãn "Ngày ban hành"', htmlA.includes('Ngày ban hành'));
assert('A4 (P2) KHÔNG còn "Ngày áp dụng dự kiến"', !htmlA.includes('Ngày áp dụng dự kiến'));

// ── Ca B: chap_nhan có apply_date + cho_phan_hoi không apply_date ──────────
console.log('\n── Ca B: 1 site chap_nhan + 1 site cho_phan_hoi ──');
const receiptsB = [
  {
    site_code: 'MML',
    site_name: 'NM MML',
    status: 'chap_nhan',
    apply_date: '2025-02-01',
    responded_at: '2025-02-01T08:00',
    response_type: null,
    response_note: null,
  },
  {
    site_code: 'HCM',
    site_name: 'NM HCM',
    status: 'cho_phan_hoi',
    apply_date: null,
    responded_at: null,
    response_type: null,
    response_note: null,
  },
];
let htmlB = '';
let errB = null;
try {
  htmlB = eta.render('detail.eta', baseData(receiptsB));
} catch (e) {
  errB = e;
}
assert('B1 render không lỗi khi có receipts', errB === null);
assert('B2 (P3) chứa apply_date "2025-02-01" của site chap_nhan', htmlB.includes('2025-02-01'));
// P3: ngày áp dụng chỉ nằm ở ô "Ngày áp dụng" của dòng site đã chấp nhận.
// Kiểm trực tiếp từng ô <td data-label="Ngày áp dụng"> thay vì đếm toàn trang
// (responded_at của chính site chap_nhan cũng trùng ngày -> đếm thô sẽ sai).
const applyCells = [];
{
  const re = /<td data-label="Ngày áp dụng">([^<]*)<\/td>/g;
  let m;
  while ((m = re.exec(htmlB)) !== null) applyCells.push(m[1].trim());
}
// Đúng 2 dòng site -> 2 ô ngày áp dụng.
assert('B3a (P3) bảng site có đúng 2 ô "Ngày áp dụng"', applyCells.length === 2);
// Ô của site chap_nhan = ngày; ô của site cho_phan_hoi = rỗng.
assert('B3b (P3) site chap_nhan hiện "2025-02-01" ở cột Ngày áp dụng', applyCells.includes('2025-02-01'));
assert('B3c (P3) site cho_phan_hoi để TRỐNG cột Ngày áp dụng', applyCells.filter((c) => c === '').length === 1);
assert('B3d (P3) đúng 1 ô Ngày áp dụng có giá trị (không rò sang site chưa chấp nhận)', applyCells.filter((c) => c !== '').length === 1);
assert('B4 (P2) chứa nhãn "Ngày ban hành"', htmlB.includes('Ngày ban hành'));
assert('B5 (P2) KHÔNG còn "Ngày áp dụng dự kiến"', !htmlB.includes('Ngày áp dụng dự kiến'));

// ── Tổng kết ───────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.pass);
console.log(`\n${failed.length === 0 ? 'ALL PASS' : 'SOME FAILED'} — ${results.length - failed.length}/${results.length} assertion pass`);
if (failed.length > 0) {
  console.log('FAILED: ' + failed.map((r) => r.name).join('; '));
  process.exit(1);
}
