/**
 * test/domain/extract.test.ts — bóc tách mục thuần văn bản (không cần DB).
 *
 * Chốt hồi quy BUG-001 (UAT 2026-09-15): trước đây extractPdf dùng
 * mergePages:true làm mất newline nên splitSections luôn trả 0 mục và mọi tài
 * liệu SOP/WI/Policy/External kẹt ở kem_tin_cay. Các test dưới bảo vệ hành vi:
 * văn bản nhiều dòng phải bóc ra đúng số mục.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { splitSections } from '../../src/domain/extract.js';

describe('BUG-001 — bóc tách mục từ văn bản nhiều dòng', () => {
  test('Văn bản GIỮ newline -> ra đủ mục', () => {
    const text = [
      '1. Muc dich',
      'Noi dung muc dich.',
      '2. Pham vi ap dung',
      'Ap dung toan nha may.',
      '3. Trach nhiem',
      'QA chiu trach nhiem.',
    ].join('\n');
    const sections = splitSections(text);
    assert.equal(sections.length, 3);
    assert.deepEqual(sections.map((s) => s.sectionCode), ['1', '2', '3']);
    assert.equal(sections[0]!.sectionTitle, 'Muc dich');
  });

  test('Văn bản MẤT newline (gộp một dòng) -> bóc tách SAI (tái hiện triệu chứng cũ)', () => {
    // Đây chính là đầu ra của mergePages:true. Cả chuỗi thành MỘT dòng nên chỉ
    // khớp được đúng một đầu mục ở đầu chuỗi, gộp toàn bộ nội dung còn lại vào
    // đó — mất hết ranh giới mục 2, 3. Kết quả sai này (1 mục thay vì 3) chính
    // là lý do parse bị coi là kem_tin_cay/không dùng được; fix phải giữ newline.
    const flat = '1. Muc dich Noi dung 2. Pham vi ap dung 3. Trach nhiem';
    const sections = splitSections(flat);
    assert.equal(sections.length, 1, 'mất newline chỉ bóc được 1 mục gộp sai');
    assert.notEqual(sections.length, 3, 'không thể ra đủ 3 mục khi mất newline');
  });

  test('Nhận đầu mục nhiều cấp 6.2.1', () => {
    const text = ['6.2.1 Tan suat lay mau', 'Hai lan moi tuan.'].join('\n');
    const sections = splitSections(text);
    assert.equal(sections.length, 1);
    assert.equal(sections[0]!.sectionCode, '6.2.1');
  });
});
