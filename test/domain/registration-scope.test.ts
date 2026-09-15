/**
 * test/domain/registration-scope.test.ts — chuẩn hoá phạm vi tài liệu (thuần).
 *
 * Chốt hồi quy BUG-003 (UAT 2026-09-15): /register/draft trả 500 vì scope không
 * được chuẩn hoá — thiếu con trỏ -> chk_scope_ref (23514); con trỏ chuỗi rỗng ""
 * ghi vào cột uuid -> 22P02. normalizeDocumentScope là điểm duy nhất xử lý.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDocumentScope, type DocumentInput } from '../../src/domain/registration.js';
import { isBusinessError } from '../../src/lib/errors.js';

const base = (over: Partial<DocumentInput>): DocumentInput => ({
  docId: 'UAT-DRAFT-001', docType: 'Form', origin: 'noi_bo', scopeLevel: 'group', ...over,
});

describe('BUG-003 — chuẩn hoá phạm vi tài liệu', () => {
  test('group: mọi con trỏ về null', () => {
    const d = normalizeDocumentScope(base({ scopeLevel: 'group', scopeSiteId: '', scopeBuId: '' }));
    assert.equal(d.scopeLevel, 'group');
    assert.equal(d.scopeBuId, null);
    assert.equal(d.scopeSiteId, null);
    assert.equal(d.scopeDeptId, null);
  });

  test('site: chuỗi rỗng ở con trỏ khác về null, giữ site', () => {
    const d = normalizeDocumentScope(base({
      scopeLevel: 'site', scopeSiteId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      scopeBuId: '', scopeDeptId: '',
    }));
    assert.equal(d.scopeLevel, 'site');
    assert.equal(d.scopeSiteId, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    assert.equal(d.scopeBuId, null);
    assert.equal(d.scopeDeptId, null);
  });

  test('site nhưng thiếu con trỏ -> BusinessError (không rơi xuống 23514)', () => {
    try {
      normalizeDocumentScope(base({ scopeLevel: 'site', scopeSiteId: '' }));
      assert.fail('phải ném lỗi');
    } catch (e) {
      assert.ok(isBusinessError(e));
    }
  });

  test('dept giữ đúng con trỏ dept, bỏ con trỏ thừa', () => {
    const d = normalizeDocumentScope(base({
      scopeLevel: 'dept', scopeDeptId: '11111111-2222-3333-4444-555555555555',
      scopeSiteId: 'zzzz',
    }));
    assert.equal(d.scopeDeptId, '11111111-2222-3333-4444-555555555555');
    assert.equal(d.scopeSiteId, null);
  });

  test('khoảng trắng cũng coi là rỗng', () => {
    try {
      normalizeDocumentScope(base({ scopeLevel: 'bu', scopeBuId: '   ' }));
      assert.fail('phải ném lỗi');
    } catch (e) {
      assert.ok(isBusinessError(e));
    }
  });
});
