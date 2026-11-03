/**
 * test/domain/clock.test.ts — kiểm thử THUẦN (không chạm DB) cho todayVN():
 * "ngày hôm nay" theo giờ Việt Nam (Asia/Ho_Chi_Minh, UTC+7).
 *
 * Trọng tâm là BIÊN nửa đêm giờ VN: 23:30 UTC ngày 2024-06-09 là 06:30 VN ngày
 * HÔM SAU (2024-06-10), còn 10:00 UTC cùng ngày vẫn là 17:00 VN cùng ngày.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { todayVN } from '../../src/lib/clock.js';

describe('todayVN — ngày theo giờ VN (UTC+7)', () => {
  test('23:30 UTC -> 06:30 VN hôm sau (qua biên nửa đêm)', () => {
    assert.equal(todayVN(new Date('2024-06-09T23:30:00Z')), '2024-06-10');
  });
  test('10:00 UTC -> 17:00 VN cùng ngày', () => {
    assert.equal(todayVN(new Date('2024-06-09T10:00:00Z')), '2024-06-09');
  });
});
