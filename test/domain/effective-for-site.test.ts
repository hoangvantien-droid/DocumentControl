/**
 * test/domain/effective-for-site.test.ts — kiểm thử THUẦN helper effectiveForSite
 * (ngày hiệu lực thực của một site = ngày khai riêng nếu có, nếu không về ngày
 * hiệu lực gốc của phiên bản). Không chạm DB.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveForSite } from '../../src/domain/receipt.js';

describe('effectiveForSite — ngày hiệu lực thực của site', () => {
  test('có ngày riêng -> dùng ngày riêng', () => {
    assert.equal(effectiveForSite('2026-02-01', '2026-01-01'), '2026-02-01');
  });
  test('không khai ngày riêng (null) -> về ngày hiệu lực gốc', () => {
    assert.equal(effectiveForSite(null, '2026-01-01'), '2026-01-01');
  });
  test('undefined ngày riêng -> về ngày gốc', () => {
    assert.equal(effectiveForSite(undefined, '2026-01-01'), '2026-01-01');
  });
  test('cả hai thiếu -> null', () => {
    assert.equal(effectiveForSite(null, null), null);
    assert.equal(effectiveForSite(undefined, undefined), null);
  });
});
