/**
 * test/domain/viewer-permissions.test.ts — kiểm thử THUẦN các hàm quyết định
 * quyền theo 3 vai (không chạm DB).
 *
 * Khóa hành vi:
 *  - isReadOnlyUser: ai là người chỉ-xem.
 *  - allowedStatusesForViewer: Reader chỉ thấy tài liệu hiện hành.
 *  - canUserRelease: siết nhánh tài liệu cấp group CHỈ cho Admin (chống leo
 *    thang quyền sau migration 013), và khớp phạm vi Dept chính cho bu/site/dept.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isReadOnlyUser,
  allowedStatusesForViewer,
  canUserRelease,
  CURRENT_VIEW_STATUSES,
  type DocScope,
  type UserScopeRef,
} from '../../src/domain/permissions.js';
import { isCurrentStatus } from '../../src/domain/catalog.js';

const roles = (...codes: string[]) => new Set(codes);

const emptyScope: UserScopeRef = { dept_id: null, site_id: null, bu_ids: [] };

const doc = (over: Partial<DocScope>): DocScope => ({
  scope_level: 'group', scope_bu_id: null, scope_site_id: null, scope_dept_id: null, ...over,
});

describe('isReadOnlyUser', () => {
  test('không vai trò nào -> chỉ xem', () => {
    assert.equal(isReadOnlyUser(roles()), true);
  });
  test('chỉ DC_READER -> vẫn chỉ xem (reader không mở quyền nghiệp vụ)', () => {
    assert.equal(isReadOnlyUser(roles('DC_READER')), true);
  });
  test('Biên soạn (DC_AUTHOR) -> KHÔNG phải chỉ xem', () => {
    assert.equal(isReadOnlyUser(roles('DC_AUTHOR')), false);
  });
  test('Phê duyệt (DC_DEPT_HEAD) -> KHÔNG phải chỉ xem', () => {
    assert.equal(isReadOnlyUser(roles('DC_DEPT_HEAD')), false);
  });
  test('Admin -> KHÔNG phải chỉ xem', () => {
    assert.equal(isReadOnlyUser(roles('DC_ADMIN')), false);
  });
  test('role duyệt cũ đã gộp (DC_SITE_QA_MANAGER) không tính là release -> chỉ xem', () => {
    // Sau migration 013 các vai cũ bị is_active=false; nếu lỡ còn active thì
    // cũng không nằm trong 3 vai nên không mở cờ. Khóa hành vi này.
    assert.equal(isReadOnlyUser(roles('DC_SITE_QA_MANAGER')), true);
  });
});

describe('allowedStatusesForViewer', () => {
  test('Reader -> chỉ trạng thái hiện hành (mô hình mới: da_ban_hanh + mã cũ)', () => {
    assert.deepEqual(allowedStatusesForViewer(roles()), CURRENT_VIEW_STATUSES);
    // Mô hình receipt mới: da_ban_hanh là hiện hành chính; hieu_luc/da_dang_ky
    // giữ lại cho giai đoạn chuyển đổi (Task 9 dọn).
    assert.deepEqual([...CURRENT_VIEW_STATUSES], ['da_ban_hanh', 'hieu_luc', 'da_dang_ky']);
  });
  test('Author -> null (không giới hạn trạng thái)', () => {
    assert.equal(allowedStatusesForViewer(roles('DC_AUTHOR')), null);
  });
  test('Phê duyệt -> null', () => {
    assert.equal(allowedStatusesForViewer(roles('DC_DEPT_HEAD')), null);
  });
  test('Admin -> null', () => {
    assert.equal(allowedStatusesForViewer(roles('DC_ADMIN')), null);
  });
});

describe('canUserRelease — không có cờ Phê duyệt', () => {
  test('Reader thuần -> false mọi cấp', () => {
    assert.equal(canUserRelease(roles(), doc({ scope_level: 'group' }), emptyScope), false);
    assert.equal(canUserRelease(roles('DC_AUTHOR'), doc({ scope_level: 'dept', scope_dept_id: 'd1' }),
      { dept_id: 'd1', site_id: null, bu_ids: [] }), false);
  });
});

describe('canUserRelease — tài liệu cấp group (chống leo thang)', () => {
  test('Admin duyệt được tài liệu group', () => {
    assert.equal(canUserRelease(roles('DC_ADMIN'), doc({ scope_level: 'group' }), emptyScope), true);
  });
  test('DC_DEPT_HEAD@group KHÔNG duyệt được tài liệu group (bug B2 đã siết)', () => {
    assert.equal(canUserRelease(roles('DC_DEPT_HEAD'), doc({ scope_level: 'group' }), emptyScope), false);
  });
  test('vừa Author vừa DEPT_HEAD vẫn KHÔNG duyệt group (không có Admin)', () => {
    assert.equal(
      canUserRelease(roles('DC_AUTHOR', 'DC_DEPT_HEAD'), doc({ scope_level: 'group' }), emptyScope),
      false,
    );
  });
});

describe('canUserRelease — cấp dept/site/bu theo Dept chính', () => {
  test('dept khớp -> true', () => {
    assert.equal(
      canUserRelease(roles('DC_DEPT_HEAD'), doc({ scope_level: 'dept', scope_dept_id: 'd1' }),
        { dept_id: 'd1', site_id: 's1', bu_ids: ['b1'] }),
      true,
    );
  });
  test('dept lệch -> false', () => {
    assert.equal(
      canUserRelease(roles('DC_DEPT_HEAD'), doc({ scope_level: 'dept', scope_dept_id: 'd2' }),
        { dept_id: 'd1', site_id: 's1', bu_ids: ['b1'] }),
      false,
    );
  });
  test('site khớp -> true', () => {
    assert.equal(
      canUserRelease(roles('DC_DEPT_HEAD'), doc({ scope_level: 'site', scope_site_id: 's1' }),
        { dept_id: 'd1', site_id: 's1', bu_ids: ['b1'] }),
      true,
    );
  });
  test('bu khớp (user có nhiều bu) -> true', () => {
    assert.equal(
      canUserRelease(roles('DC_DEPT_HEAD'), doc({ scope_level: 'bu', scope_bu_id: 'b2' }),
        { dept_id: 'd1', site_id: 's1', bu_ids: ['b1', 'b2'] }),
      true,
    );
  });
  test('bu không thuộc user -> false', () => {
    assert.equal(
      canUserRelease(roles('DC_DEPT_HEAD'), doc({ scope_level: 'bu', scope_bu_id: 'bX' }),
        { dept_id: 'd1', site_id: 's1', bu_ids: ['b1'] }),
      false,
    );
  });
  test('Admin duyệt được mọi cấp bất kể Dept chính', () => {
    assert.equal(
      canUserRelease(roles('DC_ADMIN'), doc({ scope_level: 'dept', scope_dept_id: 'dX' }), emptyScope),
      true,
    );
  });
  test('scope rỗng + tài liệu dept -> false (không có Dept chính)', () => {
    assert.equal(
      canUserRelease(roles('DC_DEPT_HEAD'), doc({ scope_level: 'dept', scope_dept_id: 'd1' }), emptyScope),
      false,
    );
  });
});

describe('isCurrentStatus — Reader chỉ xem bản hiện hành', () => {
  test('hieu_luc -> hiện hành (xem được)', () => {
    assert.equal(isCurrentStatus('hieu_luc'), true);
  });
  test('da_dang_ky -> hiện hành (xem được)', () => {
    assert.equal(isCurrentStatus('da_dang_ky'), true);
  });
  test('het_hieu_luc (lỗi thời) -> KHÔNG hiện hành (Reader bị điều hướng/ẩn)', () => {
    assert.equal(isCurrentStatus('het_hieu_luc'), false);
  });
  test('thu_hoi -> KHÔNG hiện hành', () => {
    assert.equal(isCurrentStatus('thu_hoi'), false);
  });
  test('cho_xac_nhan / cho_hoan_thien / tu_choi -> KHÔNG hiện hành', () => {
    assert.equal(isCurrentStatus('cho_xac_nhan'), false);
    assert.equal(isCurrentStatus('cho_hoan_thien'), false);
    assert.equal(isCurrentStatus('tu_choi'), false);
  });
});
