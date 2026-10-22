/**
 * test/domain/xlsx-catalog-header.test.ts — property test THUẦN cho bất biến
 * hàng tiêu đề của workbook danh mục (không chạm DB).
 *
 * Feature: catalog-excel-export, Property 2: Bất biến hàng tiêu đề danh mục và
 * loại trừ cột File PDF.
 *
 * Với MỌI tập CatalogRow (kể cả rỗng), hàng tiêu đề của workbook danh mục bằng
 * đúng chuỗi 11 tiêu đề theo thứ tự (design §5 / Column Mapping) và KHÔNG chứa
 * tiêu đề 'File PDF'.
 *
 * Ghi chú về dây nối: `CATALOG_COLUMNS` được định nghĩa trong src/routes/catalog.ts
 * (do nhiệm vụ 7.2 bổ sung). Để tránh phụ thuộc/đua tiến độ, test này KHAI BÁO
 * mảng cột cục bộ với tiêu đề đúng theo design, rồi kiểm bất biến hàng tiêu đề
 * của chính bộ dựng (`buildWorkbook`) độc lập với việc nối route.
 *
 * Validates: Requirements 1.4, 1.5
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import ExcelJS from 'exceljs';
import { buildWorkbook, type ColumnDef } from '../../src/lib/xlsx.js';

/** Dòng danh mục tối giản — chỉ các trường mà cột trích dùng tới. */
interface CatalogRowLike {
  doc_id: string;
  version_no: string;
  title: string;
  doc_type: string;
  scope_level: string;
  status: string;
  origin: string;
  issued_date: string | null;
  effective_date: string | null;
  next_review_date: string | null;
  expiry_date: string | null;
}

/** 11 tiêu đề danh mục theo đúng thứ tự (design §5 — KHÔNG có 'File PDF'). */
const EXPECTED_HEADERS = [
  'Số hiệu',
  'Phiên bản',
  'Tiêu đề',
  'Loại',
  'Phạm vi',
  'Trạng thái',
  'Nguồn',
  'Ngày ban hành',
  'Ngày hiệu lực',
  'Ngày rà soát kế tiếp',
  'Ngày hết hạn',
] as const;

/** Bộ cột cục bộ (mirror design): header đúng + hàm trích tối giản. */
const columns: ColumnDef<CatalogRowLike>[] = [
  { header: 'Số hiệu', value: (r) => r.doc_id },
  { header: 'Phiên bản', value: (r) => r.version_no },
  { header: 'Tiêu đề', value: (r) => r.title },
  { header: 'Loại', value: (r) => r.doc_type },
  { header: 'Phạm vi', value: (r) => r.scope_level },
  { header: 'Trạng thái', value: (r) => r.status },
  { header: 'Nguồn', value: (r) => r.origin },
  { header: 'Ngày ban hành', value: (r) => r.issued_date ?? '' },
  { header: 'Ngày hiệu lực', value: (r) => r.effective_date ?? '' },
  { header: 'Ngày rà soát kế tiếp', value: (r) => r.next_review_date ?? '' },
  { header: 'Ngày hết hạn', value: (r) => r.expiry_date ?? '' },
];

/** Sinh một CatalogRow ngẫu nhiên (cả null cho các ô ngày). */
const rowArb: fc.Arbitrary<CatalogRowLike> = fc.record({
  doc_id: fc.string(),
  version_no: fc.string(),
  title: fc.string(),
  doc_type: fc.string(),
  scope_level: fc.string(),
  status: fc.string(),
  origin: fc.string(),
  issued_date: fc.option(fc.string(), { nil: null }),
  effective_date: fc.option(fc.string(), { nil: null }),
  next_review_date: fc.option(fc.string(), { nil: null }),
  expiry_date: fc.option(fc.string(), { nil: null }),
});

/** Ghi workbook ra buffer rồi nạp lại, trả về giá trị hàng tiêu đề (hàng 1). */
async function readHeaderRow(wb: ExcelJS.Workbook): Promise<string[]> {
  const buf = await wb.xlsx.writeBuffer();
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(buf as Buffer);
  const ws = loaded.worksheets[0];
  const raw = ws.getRow(1).values as unknown[];
  // exceljs row.values 1-indexed: raw[0] là undefined, ô thực bắt đầu từ index 1.
  return raw.slice(1).map((v) => String(v));
}

describe('catalog-excel-export Property 2 — bất biến hàng tiêu đề danh mục', () => {
  test('mọi tập CatalogRow → hàng tiêu đề bằng đúng 11 tiêu đề theo thứ tự, không có "File PDF"', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(rowArb), async (rows) => {
        const wb = buildWorkbook(columns, rows, 'Danh mục');
        const header = await readHeaderRow(wb);
        assert.deepEqual(header, [...EXPECTED_HEADERS]);
        assert.ok(!header.includes('File PDF'));
        assert.equal(header.length, 11);
      }),
      { numRuns: 100 },
    );
  });

  test('tập rỗng → vẫn ghi đúng hàng tiêu đề 11 cột, không có "File PDF"', async () => {
    const wb = buildWorkbook(columns, [] as CatalogRowLike[], 'Danh mục');
    const header = await readHeaderRow(wb);
    assert.deepEqual(header, [...EXPECTED_HEADERS]);
    assert.ok(!header.includes('File PDF'));
    assert.equal(header.length, 11);
  });
});
