/**
 * test/domain/author-release-bug.test.ts — hồi quy bug B (phân quyền duyệt).
 *
 * B1: Tài khoản chỉ có vai Biên soạn (DC_AUTHOR) KHÔNG có cờ xác nhận (release),
 *     nên không vào được hàng chờ và bị domain chặn khi POST approve/reject.
 *     Khóa bằng hasAnyReleaseRole + canUserRelease ở tầng quyết định thuần.
 * B2: Người từng là Site QA (sau migration 013 mang DC_DEPT_HEAD@group) KHÔNG
 *     được duyệt tài liệu cấp 'group' (toàn tập đoàn) — chỉ Admin mới được.
 *     Đây là siết leo thang quyền.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasAnyReleaseRole,
  canUserRelease,
  type DocScope,
  type UserScopeRef,
} from '../../src/domain/permissions.js';

const roles = (...codes: string[]) => new Set(codes);
const scope = (over: Partial<UserScopeRef> = {}): UserScopeRef => ({
  dept_id: 'd1', site_id: 's1', bu_ids: ['b1'], ...over,
});
const groupDoc: DocScope = { scope_level: 'group', scope_bu_id: null, scope_site_id: null, scope_dept_id: null };
const deptDoc: DocScope = { scope_level: 'dept', scope_bu_id: null, scope_site_id: null, scope_dept_id: 'd1' };

describe('Bug B1 — Author thuần không có quyền xác nhận', () => {
  test('DC_AUTHOR không có cờ release', () => {
    assert.equal(hasAnyReleaseRole(roles('DC_AUTHOR')), false);
  });
  test('DC_AUTHOR không duyệt được tài liệu dept dù trùng Dept chính', () => {
    assert.equal(canUserRelease(roles('DC_AUTHOR'), deptDoc, scope()), false);
  });
  test('DC_AUTHOR không duyệt được tài liệu group', () => {
    assert.equal(canUserRelease(roles('DC_AUTHOR'), groupDoc, scope()), false);
  });
});

describe('Bug B2 — chống leo thang quyền ở tài liệu cấp group', () => {
  test('Site QA cũ (nay DC_DEPT_HEAD@group) KHÔNG duyệt được tài liệu group', () => {
    assert.equal(canUserRelease(roles('DC_DEPT_HEAD'), groupDoc, scope()), false);
  });
  test('nhưng VẪN duyệt được tài liệu trong phạm vi Dept chính của mình', () => {
    assert.equal(canUserRelease(roles('DC_DEPT_HEAD'), deptDoc, scope()), true);
  });
  test('chỉ Admin mới duyệt được tài liệu group', () => {
    assert.equal(canUserRelease(roles('DC_ADMIN'), groupDoc, scope({ dept_id: null, site_id: null, bu_ids: [] })), true);
  });
});
