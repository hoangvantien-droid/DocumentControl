/**
 * test/domain/receipt-permissions.test.ts — kiểm thử THUẦN quyền mô hình receipt
 * (không chạm DB).
 *
 * Khóa hành vi:
 *  - isSiteDocControl: nhận đúng vai Kiểm soát tài liệu site.
 *  - canRespondReceiptPure: DC Site chỉ phản hồi receipt ĐÚNG site của mình;
 *    Admin KHÔNG phản hồi (đứng ngoài luồng).
 *  - canReportIssue: Reader/Author/DC Site report được; Admin-thuần thì không.
 *  - isReadOnlyUser: DC Site là vai nghiệp vụ (không read-only).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSiteDocControl,
  canRespondReceiptPure,
  canReportIssue,
  isReadOnlyUser,
  isDocFlowRoles,
} from '../../src/domain/permissions.js';

const roles = (...codes: string[]) => new Set(codes);

describe('isSiteDocControl', () => {
  test('có DC_SITE_DOC_CONTROL -> true', () => {
    assert.equal(isSiteDocControl(roles('DC_SITE_DOC_CONTROL')), true);
  });
  test('không có -> false', () => {
    assert.equal(isSiteDocControl(roles('DC_AUTHOR', 'DC_READER')), false);
  });
});

describe('canRespondReceiptPure — DC Site chỉ phản hồi đúng site', () => {
  test('giữ vai ở site của receipt -> true', () => {
    assert.equal(canRespondReceiptPure(new Set(['s1', 's2']), 's1'), true);
  });
  test('không giữ vai ở site đó -> false', () => {
    assert.equal(canRespondReceiptPure(new Set(['s1']), 's2'), false);
  });
  test('không giữ vai site nào -> false', () => {
    assert.equal(canRespondReceiptPure(new Set(), 's1'), false);
  });
});

describe('canReportIssue — Admin-thuần đứng ngoài luồng', () => {
  test('Reader report được', () => {
    assert.equal(canReportIssue(roles('DC_READER')), true);
  });
  test('Author report được', () => {
    assert.equal(canReportIssue(roles('DC_AUTHOR')), true);
  });
  test('DC Site report được', () => {
    assert.equal(canReportIssue(roles('DC_SITE_DOC_CONTROL')), true);
  });
  test('Admin-thuần (chỉ DC_ADMIN) KHÔNG report', () => {
    assert.equal(canReportIssue(roles('DC_ADMIN')), false);
  });
  test('Admin kiêm Reader vẫn report được (không phải admin-thuần)', () => {
    assert.equal(canReportIssue(roles('DC_ADMIN', 'DC_READER')), true);
  });
});

describe('isDocFlowRoles — Admin-thuần đứng ngoài luồng tài liệu', () => {
  test('Admin-thuần -> KHÔNG thuộc luồng (chặn trang nghiệp vụ)', () => {
    assert.equal(isDocFlowRoles(roles('DC_ADMIN')), false);
  });
  test('Author -> thuộc luồng', () => {
    assert.equal(isDocFlowRoles(roles('DC_AUTHOR')), true);
  });
  test('DC Site -> thuộc luồng', () => {
    assert.equal(isDocFlowRoles(roles('DC_SITE_DOC_CONTROL')), true);
  });
  test('Reader -> thuộc luồng', () => {
    assert.equal(isDocFlowRoles(roles('DC_READER')), true);
  });
  test('Admin kiêm Author -> thuộc luồng (không phải admin-thuần)', () => {
    assert.equal(isDocFlowRoles(roles('DC_ADMIN', 'DC_AUTHOR')), true);
  });
  test('không vai nào -> không thuộc luồng', () => {
    assert.equal(isDocFlowRoles(roles()), false);
  });
});

describe('isReadOnlyUser — mô hình mới', () => {
  test('không vai -> read-only', () => {
    assert.equal(isReadOnlyUser(roles()), true);
  });
  test('chỉ DC_READER -> read-only', () => {
    assert.equal(isReadOnlyUser(roles('DC_READER')), true);
  });
  test('DC_SITE_DOC_CONTROL -> KHÔNG read-only (vai nghiệp vụ)', () => {
    assert.equal(isReadOnlyUser(roles('DC_SITE_DOC_CONTROL')), false);
  });
  test('DC_AUTHOR -> KHÔNG read-only', () => {
    assert.equal(isReadOnlyUser(roles('DC_AUTHOR')), false);
  });
  test('DC_ADMIN -> KHÔNG read-only', () => {
    assert.equal(isReadOnlyUser(roles('DC_ADMIN')), false);
  });
});
