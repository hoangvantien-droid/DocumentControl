/**
 * test/domain/lifecycle-status.test.ts — kiểm thử THUẦN nguồn trạng thái vòng
 * đời mới (không chạm DB).
 *
 * Khóa hành vi:
 *  - isCurrentlyEffective: da_ban_hanh là hiện hành; thu_hoi/het_hieu_luc/nháp
 *    KHÔNG hiện hành; mã cũ (hieu_luc/da_dang_ky) vẫn hiện hành (chuyển đổi).
 *  - aggregateStatusOf: suy trạng thái tổng hợp từ tập receipt, ưu tiên tranh chấp.
 *  - Các re-export giữ nguyên API cũ (permissions / catalog) trỏ cùng nguồn.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCurrentlyEffective,
  aggregateStatusOf,
  CURRENT_VIEW_STATUSES,
  type ReceiptTally,
} from '../../src/domain/lifecycle-status.js';
import { CURRENT_VIEW_STATUSES as PERM_CURRENT } from '../../src/domain/permissions.js';
import { isCurrentStatus, CURRENT_DOC_STATUSES } from '../../src/domain/catalog.js';

describe('isCurrentlyEffective — khái niệm hiện hành', () => {
  test('da_ban_hanh (mã mới) -> hiện hành', () => {
    assert.equal(isCurrentlyEffective('da_ban_hanh'), true);
  });
  test('thu_hoi / het_hieu_luc -> KHÔNG hiện hành', () => {
    assert.equal(isCurrentlyEffective('thu_hoi'), false);
    assert.equal(isCurrentlyEffective('het_hieu_luc'), false);
  });
  test('cho_hoan_thien (nháp) -> KHÔNG hiện hành', () => {
    assert.equal(isCurrentlyEffective('cho_hoan_thien'), false);
  });
  test('mã cũ hieu_luc / da_dang_ky vẫn hiện hành (giai đoạn chuyển đổi)', () => {
    assert.equal(isCurrentlyEffective('hieu_luc'), true);
    assert.equal(isCurrentlyEffective('da_dang_ky'), true);
  });
  test('null/undefined/mã lạ -> KHÔNG hiện hành', () => {
    assert.equal(isCurrentlyEffective(null), false);
    assert.equal(isCurrentlyEffective(undefined), false);
    assert.equal(isCurrentlyEffective('abc'), false);
  });
});

describe('Re-export giữ một nguồn duy nhất', () => {
  test('permissions.CURRENT_VIEW_STATUSES === nguồn', () => {
    assert.deepEqual([...PERM_CURRENT], [...CURRENT_VIEW_STATUSES]);
  });
  test('catalog.CURRENT_DOC_STATUSES === nguồn', () => {
    assert.deepEqual([...CURRENT_DOC_STATUSES], [...CURRENT_VIEW_STATUSES]);
  });
  test('catalog.isCurrentStatus hành xử như isCurrentlyEffective', () => {
    assert.equal(isCurrentStatus('da_ban_hanh'), true);
    assert.equal(isCurrentStatus('thu_hoi'), false);
  });
});

describe('aggregateStatusOf — trạng thái tổng hợp từ receipt', () => {
  const t = (over: Partial<ReceiptTally>): ReceiptTally =>
    ({ total: 0, accepted: 0, rejected: 0, pending: 0, ...over });

  test('không receipt -> chua_phat_hanh', () => {
    assert.equal(aggregateStatusOf(t({})), 'chua_phat_hanh');
  });
  test('có receipt, chưa ai phản hồi -> dang_cho', () => {
    assert.equal(aggregateStatusOf(t({ total: 3, pending: 3 })), 'dang_cho');
  });
  test('một phần chấp nhận, còn lại chờ -> mot_phan', () => {
    assert.equal(aggregateStatusOf(t({ total: 3, accepted: 1, pending: 2 })), 'mot_phan');
  });
  test('mọi site chấp nhận -> toan_bo', () => {
    assert.equal(aggregateStatusOf(t({ total: 3, accepted: 3 })), 'toan_bo');
  });
  test('có từ chối -> tranh_chap (ưu tiên hơn một phần chấp nhận)', () => {
    assert.equal(aggregateStatusOf(t({ total: 3, accepted: 1, rejected: 1, pending: 1 })), 'tranh_chap');
  });
  test('từ chối lấn át cả khi mọi site còn lại đã chấp nhận', () => {
    assert.equal(aggregateStatusOf(t({ total: 2, accepted: 1, rejected: 1 })), 'tranh_chap');
  });
});
