/**
 * test/domain/chunking.test.ts — kiểm logic phân đoạn thuần (không cần DB).
 * Quy tắc quan trọng nhất: KHÔNG cắt ngang bảng (DCS-3 §E.4 quy tắc 2).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chunkSection } from '../../src/domain/chunking.js';
import { splitSections } from '../../src/domain/extract.js';

describe('Phân đoạn', () => {
  test('Mục ngắn -> một phân đoạn', () => {
    const chunks = chunkSection('6.2 Tần suất', 'Lấy mẫu hai lần mỗi tuần.');
    assert.equal(chunks.length, 1);
    assert.match(chunks[0]!.content, /Tần suất/);
    assert.equal(chunks[0]!.contentType, 'van_ban');
  });

  test('Bảng dài KHÔNG bị cắt — giữ một phân đoạn content_type=bang', () => {
    const rows = Array.from({ length: 40 }, (_, i) => `Chỉ tiêu ${i}\t| giá trị ${i} | ngưỡng ${i}`);
    const table = rows.join('\n');
    const chunks = chunkSection('7 Bảng ngưỡng', table);
    const tableChunks = chunks.filter((c) => c.contentType === 'bang');
    assert.equal(tableChunks.length, 1, 'Bảng phải nằm trong đúng một phân đoạn');
    // Toàn bộ dòng bảng phải còn nguyên trong một phân đoạn.
    for (let i = 0; i < 40; i++) {
      assert.match(tableChunks[0]!.content, new RegExp(`Chỉ tiêu ${i}\\b`));
    }
  });

  test('Văn bản dài cắt theo câu, không cắt giữa câu', () => {
    const sentence = 'Đây là một câu dài để kiểm tra việc gộp phân đoạn theo ngưỡng ký tự. ';
    const long = sentence.repeat(60); // vượt CHUNK_TARGET
    const chunks = chunkSection('3 Nội dung', long);
    assert.ok(chunks.length > 1, 'Văn bản dài phải chia nhiều phân đoạn');
    // Mỗi phân đoạn kết thúc trọn câu (kết bằng dấu chấm sau khi trim tiền tố).
    for (const c of chunks) {
      const body = c.content.replace(/^3 Nội dung\n/, '').trim();
      assert.match(body, /[.!?]$/, 'Phân đoạn không được cắt giữa câu');
    }
  });

  test('Mục rỗng -> không phân đoạn', () => {
    assert.equal(chunkSection('1 Trống', '   ').length, 0);
  });
});

describe('Bóc tách mục', () => {
  test('Nhận dòng "6.2 Tần suất lưu mẫu" làm đầu mục', () => {
    const text = [
      '6.1 Mục đích',
      'Nội dung mục đích.',
      '6.2 Tần suất lưu mẫu',
      'Hai lần mỗi tuần.',
      'Ghi chú thêm.',
    ].join('\n');
    const sections = splitSections(text);
    assert.equal(sections.length, 2);
    assert.equal(sections[0]!.sectionCode, '6.1');
    assert.equal(sections[1]!.sectionCode, '6.2');
    assert.equal(sections[1]!.sectionTitle, 'Tần suất lưu mẫu');
    assert.match(sections[1]!.rawText, /Hai lần mỗi tuần/);
  });

  test('Không nhận số trong câu làm đầu mục', () => {
    const sections = splitSections('Nhiệt độ giữ ở 4 độ C trong 2 giờ.');
    assert.equal(sections.length, 0);
  });
});
