/**
 * test/domain/doc-types.test.ts — nguồn loại tài liệu dùng chung (thuần).
 *
 * Chốt REQ-3.1: DocType_Source định nghĩa đúng tập DocType_Values
 * (SOP, WI, Form, Policy, External) tại tầng domain, và không lệch với ràng
 * buộc CHECK trong src/db/migrations/001_schema.sql
 *   (doc_type IN ('SOP','WI','Form','Policy','External')).
 * Test canh gác dưới đây giữ một hằng số kỳ vọng phản chiếu CHECK đó; nếu ai
 * sửa một nơi mà quên nơi kia thì test gãy — đó là mục đích.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DOC_TYPES, DOC_TYPE_CODES } from '../../src/domain/doc-types.js';

describe('DocType_Source — doc-types.ts', () => {
  test('DOC_TYPE_CODES bằng đúng danh sách DocType_Values theo thứ tự', () => {
    assert.deepEqual([...DOC_TYPE_CODES], ['SOP', 'WI', 'Form', 'Policy', 'External']);
  });

  test('mỗi mục có label là chuỗi không rỗng', () => {
    assert.ok(DOC_TYPES.length > 0, 'DOC_TYPES không được rỗng');
    for (const opt of DOC_TYPES) {
      assert.equal(typeof opt.label, 'string', `label của ${opt.code} phải là chuỗi`);
      assert.ok(opt.label.trim().length > 0, `label của ${opt.code} không được rỗng`);
    }
  });

  test('canh gác: DOC_TYPE_CODES khớp danh sách trong ràng buộc CHECK (001_schema.sql)', () => {
    // Phản chiếu ràng buộc CHECK (doc_type IN (...)) trong
    // src/db/migrations/001_schema.sql. Giữ như hằng số literal ngay trong test
    // để phát hiện khi hai nguồn bị lệch.
    const EXPECTED_CHECK_VALUES = ['SOP', 'WI', 'Form', 'Policy', 'External'] as const;
    assert.deepEqual([...DOC_TYPE_CODES], [...EXPECTED_CHECK_VALUES]);
    // Không trùng lặp mã.
    assert.equal(new Set(DOC_TYPE_CODES).size, DOC_TYPE_CODES.length);
  });
});
