/**
 * test/domain/future-effective.test.ts — kiểm thử THUẦN (không chạm DB) cho các
 * bất biến vòng đời mới liên quan điểm 4/6/7/8/9.
 *
 *  - isEffectiveNow (điểm 4/8/9): trạng thái hiện hành VÀ ngày hiệu lực đã tới.
 *    effective_date == hôm nay là ĐÃ hiệu lực; ngày tương lai thì CHƯA.
 *  - classifySitesForRepublish (điểm 6/7): hàm phân loại THUẦN dùng chung cho
 *    "phát hành thêm / phát hành lại" — chốt khóa theo từ chối sai nội dung,
 *    bỏ qua site đã chấp nhận/chờ, chỉ phát hành lại site từ chối sai đăng ký.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isEffectiveNow } from '../../src/domain/lifecycle-status.js';
import { classifySitesForRepublish } from '../../src/domain/receipt.js';
import { todayVN } from '../../src/lib/clock.js';

/** Ngày hôm nay dạng 'YYYY-MM-DD' theo giờ VN (cùng cách domain tính qua
 *  isEffectiveNow -> todayVN). Dùng todayVN để không lệch biên nửa đêm UTC/VN. */
function today(): string {
  return todayVN();
}
/** Dời ngày hôm nay (giờ VN) đi `days` ngày (âm = quá khứ), trả 'YYYY-MM-DD'.
 *  Lấy mốc 12:00 UTC của ngày VN để tránh nhảy ngày khi cộng/trừ. */
function shiftDays(days: number): string {
  const d = new Date(`${todayVN()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return todayVN(d);
}

describe('isEffectiveNow — hiện hành VÀ đã tới ngày hiệu lực (điểm 4/8/9)', () => {
  test('da_ban_hanh + hiệu lực = hôm nay -> ĐÃ hiệu lực', () => {
    assert.equal(isEffectiveNow('da_ban_hanh', today()), true);
  });
  test('da_ban_hanh + hiệu lực = quá khứ -> ĐÃ hiệu lực', () => {
    assert.equal(isEffectiveNow('da_ban_hanh', shiftDays(-1)), true);
    assert.equal(isEffectiveNow('da_ban_hanh', shiftDays(-365)), true);
  });
  test('da_ban_hanh + hiệu lực = tương lai -> CHƯA hiệu lực', () => {
    assert.equal(isEffectiveNow('da_ban_hanh', shiftDays(1)), false);
    assert.equal(isEffectiveNow('da_ban_hanh', '2099-01-01'), false);
  });
  test('mã cũ hieu_luc cũng áp dụng ngưỡng ngày', () => {
    assert.equal(isEffectiveNow('hieu_luc', today()), true);
    assert.equal(isEffectiveNow('hieu_luc', shiftDays(1)), false);
  });
  test('trạng thái KHÔNG hiện hành -> luôn false dù ngày đã tới', () => {
    assert.equal(isEffectiveNow('thu_hoi', today()), false);
    assert.equal(isEffectiveNow('het_hieu_luc', shiftDays(-10)), false);
    assert.equal(isEffectiveNow('cho_hoan_thien', today()), false);
  });
  test('thiếu ngày hiệu lực -> false (không coi là hiện hành)', () => {
    assert.equal(isEffectiveNow('da_ban_hanh', null), false);
    assert.equal(isEffectiveNow('da_ban_hanh', undefined), false);
  });
  test('so sánh chịu được phần giờ ISO (chỉ lấy YYYY-MM-DD)', () => {
    assert.equal(isEffectiveNow('da_ban_hanh', today() + 'T23:59:59Z'), true);
  });
});

describe('classifySitesForRepublish — khóa chấp nhận/sai nội dung (điểm 6/7)', () => {
  const S1 = 'site-1', S2 = 'site-2', S3 = 'site-3', S4 = 'site-4';
  const candidate = [S1, S2, S3, S4];

  test('site chưa có receipt -> newOnes', () => {
    const r = classifySitesForRepublish({
      candidateSiteIds: candidate, existingReceipts: [], requestedSiteIds: [S1],
    });
    assert.deepEqual(r.newOnes, [S1]);
    assert.equal(r.blockedByContentReject, false);
  });

  test('site từ chối sai đăng ký -> republish (được phát hành lại)', () => {
    const r = classifySitesForRepublish({
      candidateSiteIds: candidate,
      existingReceipts: [{ site_id: S1, status: 'tu_choi', response_type: 'sai_dang_ky' }],
      requestedSiteIds: [S1],
    });
    assert.deepEqual(r.republish, [S1]);
  });

  test('site đã chấp nhận -> skipped (không phát hành lại metadata cũ)', () => {
    const r = classifySitesForRepublish({
      candidateSiteIds: candidate,
      existingReceipts: [{ site_id: S1, status: 'chap_nhan', response_type: null }],
      requestedSiteIds: [S1],
    });
    assert.deepEqual(r.skipped, [S1]);
    assert.deepEqual(r.republish, []);
    assert.deepEqual(r.newOnes, []);
  });

  test('site đang chờ phản hồi -> skipped (idempotent)', () => {
    const r = classifySitesForRepublish({
      candidateSiteIds: candidate,
      existingReceipts: [{ site_id: S1, status: 'cho_phan_hoi', response_type: null }],
      requestedSiteIds: [S1],
    });
    assert.deepEqual(r.skipped, [S1]);
  });

  test('BẤT KỲ site từ chối sai nội dung -> blockedByContentReject (điểm 7)', () => {
    const r = classifySitesForRepublish({
      candidateSiteIds: candidate,
      existingReceipts: [{ site_id: S2, status: 'tu_choi', response_type: 'sai_noi_dung' }],
      requestedSiteIds: [S1],
    });
    assert.equal(r.blockedByContentReject, true);
  });

  test('site ngoài candidate -> invalid (ngoài phạm vi)', () => {
    const r = classifySitesForRepublish({
      candidateSiteIds: [S1], existingReceipts: [], requestedSiteIds: ['ngoai-scope'],
    });
    assert.deepEqual(r.invalid, ['ngoai-scope']);
  });

  test('yêu cầu trùng site chỉ xét một lần', () => {
    const r = classifySitesForRepublish({
      candidateSiteIds: candidate, existingReceipts: [], requestedSiteIds: [S1, S1, S1],
    });
    assert.deepEqual(r.newOnes, [S1]);
  });

  test('hỗn hợp: mới + phát hành lại + bỏ qua + ngoài phạm vi', () => {
    const r = classifySitesForRepublish({
      candidateSiteIds: candidate,
      existingReceipts: [
        { site_id: S2, status: 'tu_choi', response_type: 'sai_dang_ky' },
        { site_id: S3, status: 'chap_nhan', response_type: null },
      ],
      requestedSiteIds: [S1, S2, S3, 'ngoai'],
    });
    assert.deepEqual(r.newOnes, [S1]);
    assert.deepEqual(r.republish, [S2]);
    assert.deepEqual(r.skipped, [S3]);
    assert.deepEqual(r.invalid, ['ngoai']);
    assert.equal(r.blockedByContentReject, false);
  });
});
