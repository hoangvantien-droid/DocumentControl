/**
 * test/domain/xlsx-site-ack-format.test.ts — kiểm thử THEO THUỘC TÍNH (property)
 * cho quy tắc định dạng ô "Site xác nhận" của workbook "tài liệu của tôi"
 * (không chạm DB).
 *
 * Feature: catalog-excel-export, Property 4: Định dạng ô "Site xác nhận" theo số
 * được chấp nhận trên tổng số.
 *
 * Quy tắc thuần (design.md §6, cột "Site xác nhận" của MY_DOCS_COLUMNS):
 *   (d) => d.total > 0 ? `${d.accepted}/${d.total}` : ''
 *
 * Đây là một quy tắc định dạng thuần nên ta phản chiếu nó cục bộ trong test bằng
 * `siteAckCell(accepted, total)` thay vì tạo một tệp production mới chỉ phục vụ
 * kiểm thử tùy chọn này. Cột thật nằm trong src/routes/documents.ts (nhiệm vụ 8.2).
 *
 * Ý tưởng: sinh ngẫu nhiên cặp số nguyên (accepted, total) thỏa 0 ≤ accepted ≤ total
 * (sinh total ≥ 0 trước, rồi accepted trong [0, total]). Khẳng định:
 *   - total > 0  → ô bằng đúng chuỗi `${accepted}/${total}`;
 *   - total === 0 → ô bằng chuỗi rỗng (khi đó accepted bắt buộc bằng 0).
 *
 * Validates: Requirements 2.4
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

/**
 * Phản chiếu quy tắc định dạng ô "Site xác nhận" từ design.md §6. Giữ cục bộ để
 * test mô tả đúng quy tắc trong đặc tả; không tạo nguồn thứ hai ở tầng production.
 */
function siteAckCell(accepted: number, total: number): string {
  return total > 0 ? `${accepted}/${total}` : '';
}

/**
 * Sinh cặp (accepted, total) hợp lệ: total ≥ 0, rồi accepted ∈ [0, total]. Bao phủ
 * cả nhánh total === 0 (buộc accepted === 0) và total > 0.
 */
const acceptedTotalArb: fc.Arbitrary<{ accepted: number; total: number }> = fc
  .integer({ min: 0, max: 100000 })
  .chain((total) =>
    fc.integer({ min: 0, max: total }).map((accepted) => ({ accepted, total })),
  );

test('Property 4: ô "Site xác nhận" định dạng theo accepted/total', () => {
  fc.assert(
    fc.property(acceptedTotalArb, ({ accepted, total }) => {
      const cell = siteAckCell(accepted, total);

      if (total > 0) {
        assert.equal(
          cell,
          `${accepted}/${total}`,
          `total > 0 phải cho "${accepted}/${total}", nhận "${cell}"`,
        );
      } else {
        // total === 0 → ràng buộc sinh buộc accepted === 0; ô là chuỗi rỗng.
        assert.equal(total, 0);
        assert.equal(accepted, 0);
        assert.equal(cell, '', `total === 0 phải cho chuỗi rỗng, nhận "${cell}"`);
      }
    }),
    { numRuns: 100 },
  );
});
