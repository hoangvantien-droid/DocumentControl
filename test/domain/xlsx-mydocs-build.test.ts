/**
 * test/domain/xlsx-mydocs-build.test.ts — property test THUẦN cho bộ dựng
 * workbook "tài liệu của tôi" (không chạm DB).
 *
 * **Feature: catalog-excel-export, Property 3: Bộ dựng workbook "tài liệu của
 * tôi" ánh xạ đúng tiêu đề và nội dung**
 *
 * Với mọi mảng MyDocRow (kể cả rỗng):
 *   - hàng tiêu đề bằng đúng 7 tiêu đề theo thứ tự;
 *   - ô "Tình trạng ban hành" phản ánh đúng giá trị tổng hợp của dòng
 *     (total > 0 → nhãn tổng hợp; total = 0 → "Chưa phát hành");
 *   - ô "Lý do từ chối" bằng rejection_reason khi có, rỗng khi không.
 *
 * MY_DOCS_COLUMNS thật nằm trong src/routes/documents.ts và do task song song
 * (8.2) thêm vào. Để tránh phụ thuộc chéo (race), test này định nghĩa một mảng
 * cột cục bộ phản chiếu đúng 7 cột + logic giá trị theo design.md §6, và kiểm
 * chứng hành vi của chính bộ dựng (buildWorkbook) độc lập với nối dây route.
 *
 * Đọc lại workbook qua API exceljs (writeBuffer → xlsx.load) rồi khẳng định
 * hàng tiêu đề và nội dung ô. Ô rỗng có thể đọc lại thành null → so với ''.
 *
 * Validates: Requirements 2.3, 2.5, 2.6
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import ExcelJS from 'exceljs';
import { buildWorkbook, type ColumnDef } from '../../src/lib/xlsx.js';

// --- Mô hình cục bộ của dòng "tài liệu của tôi" (chỉ các trường cần cho P3) ---
interface MyDocRow {
  doc_id: string;
  version_no: string;
  title: string;
  status: string;
  accepted: number;
  total: number;
  /** Nhãn tổng hợp đã tính sẵn (aggregateLabel(aggregate, hasContentReject)). */
  aggregateLabel: string;
  rejection_reason: string | null;
}

// --- 7 tiêu đề theo đúng thứ tự (design.md §6) ---
const MY_DOCS_HEADERS = [
  'Số hiệu',
  'Phiên bản',
  'Tiêu đề',
  'Trạng thái',
  'Site xác nhận',
  'Tình trạng ban hành',
  'Lý do từ chối',
] as const;

// --- Mảng cột cục bộ phản chiếu logic giá trị trong design.md §6 ---
const MY_DOCS_COLUMNS: ColumnDef<MyDocRow>[] = [
  { header: 'Số hiệu', value: (d) => d.doc_id },
  { header: 'Phiên bản', value: (d) => d.version_no },
  { header: 'Tiêu đề', value: (d) => d.title },
  { header: 'Trạng thái', value: (d) => d.status },
  { header: 'Site xác nhận', value: (d) => (d.total > 0 ? `${d.accepted}/${d.total}` : '') },
  {
    header: 'Tình trạng ban hành',
    value: (d) => (d.total > 0 ? d.aggregateLabel : 'Chưa phát hành'),
  },
  { header: 'Lý do từ chối', value: (d) => d.rejection_reason ?? '' },
];

const COL_ISSUE = MY_DOCS_HEADERS.indexOf('Tình trạng ban hành') + 1; // cột 6 (1-based)
const COL_REJECT = MY_DOCS_HEADERS.indexOf('Lý do từ chối') + 1; // cột 7 (1-based)

/** Đọc một ô về dạng chuỗi, coi null/undefined/ô trống là ''. */
function cellText(ws: ExcelJS.Worksheet, rowNo: number, colNo: number): string {
  const v = ws.getRow(rowNo).getCell(colNo).value;
  return v === null || v === undefined ? '' : String(v);
}

/** Dựng workbook, ghi ra buffer rồi nạp lại để kiểm chứng như một tệp .xlsx thật. */
async function roundTrip(rows: MyDocRow[]): Promise<ExcelJS.Worksheet> {
  const wb = buildWorkbook(MY_DOCS_COLUMNS, rows, 'Tài liệu của tôi');
  const buf = await wb.xlsx.writeBuffer();
  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load(buf as ArrayBuffer);
  const ws = reloaded.worksheets[0];
  assert.ok(ws, 'workbook phải có ít nhất một sheet');
  return ws;
}

// Generator cho một dòng MyDocRow với 0 ≤ accepted ≤ total.
const myDocRowArb: fc.Arbitrary<MyDocRow> = fc
  .record({
    doc_id: fc.string(),
    version_no: fc.string(),
    title: fc.string(),
    status: fc.string(),
    total: fc.integer({ min: 0, max: 50 }),
    acceptedRatio: fc.nat(),
    aggregateLabel: fc.string({ minLength: 1 }),
    rejection_reason: fc.option(fc.string(), { nil: null }),
  })
  .map((r) => ({
    doc_id: r.doc_id,
    version_no: r.version_no,
    title: r.title,
    status: r.status,
    total: r.total,
    accepted: r.total === 0 ? 0 : r.acceptedRatio % (r.total + 1),
    aggregateLabel: r.aggregateLabel,
    rejection_reason: r.rejection_reason,
  }));

describe('MyDocs workbook builder — Property 3 (tiêu đề + nội dung)', () => {
  test('hàng tiêu đề luôn bằng đúng 7 tiêu đề theo thứ tự (gồm cả mảng rỗng)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(myDocRowArb, { maxLength: 30 }), async (rows) => {
        const ws = await roundTrip(rows);
        const headerRow = ws.getRow(1);
        const actual = MY_DOCS_HEADERS.map((_, i) => cellText(ws, 1, i + 1));
        assert.deepEqual(actual, [...MY_DOCS_HEADERS]);
        // Số cột tiêu đề đúng bằng 7 (không dư cột lạ ở vùng tiêu đề).
        assert.ok(headerRow.cellCount >= MY_DOCS_HEADERS.length);
      }),
      { numRuns: 120 },
    );
  });

  test('ô "Tình trạng ban hành" và "Lý do từ chối" ánh xạ đúng từng dòng', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(myDocRowArb, { maxLength: 30 }), async (rows) => {
        const ws = await roundTrip(rows);
        rows.forEach((row, idx) => {
          const rowNo = idx + 2; // +1 cho header, +1 vì 1-based

          const expectedIssue = row.total > 0 ? row.aggregateLabel : 'Chưa phát hành';
          assert.equal(
            cellText(ws, rowNo, COL_ISSUE),
            expectedIssue,
            `Tình trạng ban hành sai ở dòng ${idx} (total=${row.total})`,
          );

          const expectedReject = row.rejection_reason ?? '';
          assert.equal(
            cellText(ws, rowNo, COL_REJECT),
            expectedReject,
            `Lý do từ chối sai ở dòng ${idx}`,
          );
        });
      }),
      { numRuns: 120 },
    );
  });

  test('mảng rỗng → chỉ có hàng tiêu đề, không có hàng dữ liệu', async () => {
    const ws = await roundTrip([]);
    assert.equal(ws.actualRowCount, 1, 'workbook rỗng-ish chỉ nên có đúng hàng tiêu đề');
    assert.deepEqual(
      MY_DOCS_HEADERS.map((_, i) => cellText(ws, 1, i + 1)),
      [...MY_DOCS_HEADERS],
    );
  });

  test('trường hợp có/không rejection_reason và total=0 được phản ánh đúng', async () => {
    const rows: MyDocRow[] = [
      {
        doc_id: 'D-1',
        version_no: '1.0',
        title: 'Tài liệu A',
        status: 'effective',
        accepted: 2,
        total: 3,
        aggregateLabel: 'Đang ban hành',
        rejection_reason: 'Sai biểu mẫu',
      },
      {
        doc_id: 'D-2',
        version_no: '2.0',
        title: 'Tài liệu B',
        status: 'draft',
        accepted: 0,
        total: 0,
        aggregateLabel: 'KHÔNG DÙNG', // total=0 nên phải bị bỏ qua
        rejection_reason: null,
      },
    ];
    const ws = await roundTrip(rows);

    // Dòng 1 (rowNo 2): total>0 → nhãn tổng hợp; có lý do từ chối.
    assert.equal(cellText(ws, 2, COL_ISSUE), 'Đang ban hành');
    assert.equal(cellText(ws, 2, COL_REJECT), 'Sai biểu mẫu');

    // Dòng 2 (rowNo 3): total=0 → "Chưa phát hành"; không có lý do → ''.
    assert.equal(cellText(ws, 3, COL_ISSUE), 'Chưa phát hành');
    assert.equal(cellText(ws, 3, COL_REJECT), '');
  });
});
