/**
 * test/domain/xlsx-catalog-build.test.ts — kiểm thử THEO THUỘC TÍNH (property)
 * cho bộ dựng workbook danh mục `buildWorkbook` (không chạm DB).
 *
 * Feature: catalog-excel-export, Property 1: Bộ dựng workbook danh mục bảo toàn
 * số dòng và nội dung ô.
 *
 * Ý tưởng: sinh ngẫu nhiên một mảng CatalogRow rồi dựng workbook qua
 * `buildWorkbook`, ghi ra buffer và nạp lại bằng một `ExcelJS.Workbook` mới
 * (vòng tròn write → load). Sau khi round-trip, khẳng định:
 *  - số HÀNG DỮ LIỆU đúng bằng rows.length (rowCount === rows.length + 1 vì có
 *    hàng tiêu đề ở hàng 1);
 *  - mọi ô dữ liệu bằng đúng kết quả hàm trích của cột, đã chuẩn hóa
 *    null/undefined → chuỗi rỗng. ExcelJS đọc ô rỗng thành null nên so sánh về ''.
 *
 * Validates: Requirements 1.3
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import ExcelJS from 'exceljs';
import { buildWorkbook, type ColumnDef } from '../../src/lib/xlsx.js';

/** Dòng đơn giản đại diện cho một CatalogRow dùng trong kiểm thử thuộc tính. */
interface Row {
  code: string;
  version: string;
  reviews: number | null;
  note: string | null | undefined;
}

/**
 * Tập cột cố định: cột trả chuỗi, cột trả số, cột có thể null/undefined — bao
 * phủ các nhánh chuẩn hóa ô của bộ dựng.
 */
const COLUMNS: readonly ColumnDef<Row>[] = [
  { header: 'Số hiệu', value: (r) => r.code },
  { header: 'Phiên bản', value: (r) => r.version },
  { header: 'Số lần rà soát', value: (r) => r.reviews },
  { header: 'Ghi chú', value: (r) => r.note },
];

/** Giá trị kỳ vọng của một ô sau chuẩn hóa null/undefined → ''. */
function expectedCell(col: ColumnDef<Row>, row: Row): string | number {
  const v = col.value(row);
  return v === null || v === undefined ? '' : v;
}

/**
 * ExcelJS đọc một ô rỗng thành `null`; chuẩn hóa về '' để so sánh với giá trị
 * kỳ vọng. Giá trị khác được giữ nguyên (chuỗi hoặc số).
 */
function readCell(v: unknown): string | number {
  return v === null || v === undefined ? '' : (v as string | number);
}

const rowArb: fc.Arbitrary<Row> = fc.record({
  code: fc.string(),
  version: fc.string(),
  reviews: fc.option(fc.integer({ min: 0, max: 999 }), { nil: null }),
  // Cột ghi chú có thể là chuỗi, null hoặc undefined → bao phủ cả hai nhánh nil.
  note: fc.oneof(
    fc.string(),
    fc.constant<null>(null),
    fc.constant<undefined>(undefined),
  ),
});

test('Property 1: workbook danh mục bảo toàn số dòng và nội dung ô', async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(rowArb, { maxLength: 40 }), async (rows) => {
      const wb = buildWorkbook(COLUMNS, rows, 'Danh mục');
      const buffer = await wb.xlsx.writeBuffer();

      const wb2 = new ExcelJS.Workbook();
      await wb2.xlsx.load(buffer as ArrayBuffer);
      const ws = wb2.worksheets[0];

      // Số hàng dữ liệu = rows.length; +1 cho hàng tiêu đề (hàng 1).
      assert.equal(
        ws.rowCount,
        rows.length + 1,
        `rowCount phải bằng ${rows.length + 1} (tiêu đề + ${rows.length} dòng)`,
      );

      // Mọi ô dữ liệu khớp kết quả hàm trích đã chuẩn hóa.
      rows.forEach((row, ri) => {
        COLUMNS.forEach((col, ci) => {
          const cell = ws.getRow(ri + 2).getCell(ci + 1); // +2: bỏ qua tiêu đề
          assert.deepEqual(
            readCell(cell.value),
            expectedCell(col, row),
            `ô (hàng dữ liệu ${ri}, cột "${col.header}") không khớp`,
          );
        });
      });
    }),
    { numRuns: 100 },
  );
});
