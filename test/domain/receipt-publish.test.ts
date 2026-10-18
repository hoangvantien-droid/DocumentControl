/**
 * test/domain/receipt-publish.test.ts — kiểm thử THUẦN logic phát hành receipt
 * có thể tách khỏi DB.
 *
 * normalizeSiteIds: chuẩn hoá tập site nhận từ form (một/nhiều checkbox), loại
 * rỗng và trùng lặp. Hành vi DB (publishToSites, submitRegistration ->
 * da_ban_hanh + sinh receipt) được phủ ở test tích hợp chạy trên máy có DB.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSiteIds } from '../../src/domain/receipt.js';

describe('normalizeSiteIds', () => {
  test('undefined/null -> rỗng', () => {
    assert.deepEqual(normalizeSiteIds(undefined), []);
    assert.deepEqual(normalizeSiteIds(null), []);
  });
  test('một chuỗi -> mảng một phần tử', () => {
    assert.deepEqual(normalizeSiteIds('s1'), ['s1']);
  });
  test('mảng giữ thứ tự, loại rỗng/khoảng trắng', () => {
    assert.deepEqual(normalizeSiteIds(['s1', '', '  ', 's2']), ['s1', 's2']);
  });
  test('loại trùng lặp', () => {
    assert.deepEqual(normalizeSiteIds(['s1', 's2', 's1']), ['s1', 's2']);
  });
  test('chuỗi rỗng -> rỗng', () => {
    assert.deepEqual(normalizeSiteIds(''), []);
  });
});
