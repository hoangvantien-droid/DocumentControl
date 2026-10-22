/**
 * test/domain/export-filename.test.ts — kiểm thử THEO THUỘC TÍNH (property)
 * cho quy ước tên tệp xuất `exportFileName` (không chạm DB).
 *
 * Feature: catalog-excel-export, Property 5: Quy ước tên tệp xuất nhận diện
 * loại xuất và thời điểm.
 *
 * Ý tưởng: sinh ngẫu nhiên một Date hợp lệ (năm 1970–9999 để giữ năm 4 chữ số,
 * tránh Invalid Date) rồi khẳng định:
 *  - `exportFileName('catalog', d)` khớp mẫu {prefix}-YYYYMMDD-HHmmss.xlsx;
 *  - phần thời điểm nhúng trong tên bằng đúng YYYYMMDD-HHmmss tính thủ công từ
 *    các thành phần GIỜ MÁY CHỦ (local) của Date — khớp cách hàm tạo chuỗi;
 *  - tiền tố `catalog` khác `my-documents` (tên tệp hai loại xuất không trùng
 *    với cùng một thời điểm).
 *
 * Validates: Requirements 4.3
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { exportFileName } from '../../src/lib/xlsx.js';

/** Zero-pad về độ rộng w (mặc định 2) — khớp định dạng của exportFileName. */
function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

/**
 * Chuỗi YYYYMMDD-HHmmss kỳ vọng, tính thủ công từ các thành phần GIỜ MÁY CHỦ
 * (local) của Date — tương ứng getFullYear / getMonth+1 / getDate / getHours /
 * getMinutes / getSeconds mà hàm sử dụng.
 */
function expectedTimestamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
    + `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Date giữ năm GIỜ MÁY CHỦ (local) luôn 4 chữ số (1970–9999) và không bao giờ
 * là Invalid Date. `exportFileName` định dạng theo giờ local, nên cận trên phải
 * tính theo mốc UTC an toàn: một thời điểm UTC sát 9999-12-31 có thể rơi sang
 * năm local 10000 ở múi giờ dương (ví dụ UTC+7). Lùi cận trên về 9999-12-30
 * (biên an toàn > độ lệch múi giờ tối đa ~14h) và cận dưới về 1970-01-02 bảo
 * đảm năm local luôn nằm trong [1970, 9999], giữ đúng mẫu YYYY 4 chữ số mà
 * nhiệm vụ yêu cầu — phạm vi vẫn phủ gần như toàn bộ dải Date hợp lệ.
 */
const dateArb: fc.Arbitrary<Date> = fc.date({
  min: new Date('1970-01-02T00:00:00.000Z'),
  max: new Date('9999-12-30T00:00:00.000Z'),
  noInvalidDate: true,
});

test('Property 5: tên tệp xuất khớp mẫu và nhận diện loại xuất + thời điểm', () => {
  fc.assert(
    fc.property(dateArb, (d) => {
      const catalog = exportFileName('catalog', d);
      const myDocs = exportFileName('my-documents', d);

      // 1) Khớp mẫu {prefix}-YYYYMMDD-HHmmss.xlsx.
      assert.match(
        catalog,
        /^catalog-\d{8}-\d{6}\.xlsx$/,
        `tên tệp "${catalog}" không khớp mẫu catalog-YYYYMMDD-HHmmss.xlsx`,
      );
      assert.match(
        myDocs,
        /^my-documents-\d{8}-\d{6}\.xlsx$/,
        `tên tệp "${myDocs}" không khớp mẫu my-documents-YYYYMMDD-HHmmss.xlsx`,
      );

      // 2) Phần thời điểm nhúng bằng đúng YYYYMMDD-HHmmss tính thủ công (local).
      const ts = expectedTimestamp(d);
      assert.equal(
        catalog,
        `catalog-${ts}.xlsx`,
        `thời điểm nhúng trong "${catalog}" không khớp giờ máy chủ`,
      );
      assert.equal(
        myDocs,
        `my-documents-${ts}.xlsx`,
        `thời điểm nhúng trong "${myDocs}" không khớp giờ máy chủ`,
      );

      // 3) Hai loại xuất tạo tên tệp khác nhau với cùng thời điểm (tiền tố khác).
      assert.notEqual(
        catalog,
        myDocs,
        'tiền tố catalog và my-documents phải cho tên tệp khác nhau',
      );
    }),
    { numRuns: 200 },
  );
});
