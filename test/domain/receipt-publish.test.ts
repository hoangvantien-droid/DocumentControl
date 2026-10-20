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
import { normalizeSiteIds, classifySitesForRepublish } from '../../src/domain/receipt.js';

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

describe('classifySitesForRepublish — phân loại site phát hành thêm/lại', () => {
  const rc = (site_id, status, response_type = null) => ({ site_id, status, response_type });

  test('site ngoài scope -> invalid, không tạo receipt', () => {
    const r = classifySitesForRepublish({
      candidateSiteIds: ['a', 'b'], existingReceipts: [], requestedSiteIds: ['a', 'x'],
    });
    assert.deepEqual(r.invalid, ['x']);
    assert.deepEqual(r.newOnes, ['a']);
  });

  test('có từ chối sai_noi_dung -> blockedByContentReject = true', () => {
    const r = classifySitesForRepublish({
      candidateSiteIds: ['a', 'b'],
      existingReceipts: [rc('b', 'tu_choi', 'sai_noi_dung')],
      requestedSiteIds: ['a'],
    });
    assert.equal(r.blockedByContentReject, true);
  });

  test('không có sai_noi_dung -> blockedByContentReject = false', () => {
    const r = classifySitesForRepublish({
      candidateSiteIds: ['a', 'b'],
      existingReceipts: [rc('b', 'tu_choi', 'sai_dang_ky'), rc('a', 'chap_nhan')],
      requestedSiteIds: ['a'],
    });
    assert.equal(r.blockedByContentReject, false);
  });

  test('tu_choi sai_dang_ky -> republish', () => {
    const r = classifySitesForRepublish({
      candidateSiteIds: ['a'], existingReceipts: [rc('a', 'tu_choi', 'sai_dang_ky')], requestedSiteIds: ['a'],
    });
    assert.deepEqual(r.republish, ['a']);
    assert.deepEqual(r.newOnes, []);
  });

  test('chap_nhan và cho_phan_hoi -> skipped (idempotent)', () => {
    const r = classifySitesForRepublish({
      candidateSiteIds: ['a', 'b'],
      existingReceipts: [rc('a', 'chap_nhan'), rc('b', 'cho_phan_hoi')],
      requestedSiteIds: ['a', 'b'],
    });
    assert.deepEqual(r.skipped.sort(), ['a', 'b']);
    assert.deepEqual(r.newOnes, []);
    assert.deepEqual(r.republish, []);
  });

  test('chưa có receipt -> newOnes', () => {
    const r = classifySitesForRepublish({
      candidateSiteIds: ['a', 'b'], existingReceipts: [], requestedSiteIds: ['a', 'b'],
    });
    assert.deepEqual(r.newOnes.sort(), ['a', 'b']);
  });

  test('tu_choi sai_noi_dung của site requested -> skipped (và cũng gây blocked)', () => {
    const r = classifySitesForRepublish({
      candidateSiteIds: ['a'], existingReceipts: [rc('a', 'tu_choi', 'sai_noi_dung')], requestedSiteIds: ['a'],
    });
    assert.deepEqual(r.skipped, ['a']);
    assert.deepEqual(r.republish, []);
    assert.equal(r.blockedByContentReject, true);
  });

  test('loại trùng lặp site requested', () => {
    const r = classifySitesForRepublish({
      candidateSiteIds: ['a'], existingReceipts: [], requestedSiteIds: ['a', 'a'],
    });
    assert.deepEqual(r.newOnes, ['a']);
  });
});
