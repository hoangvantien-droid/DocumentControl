/**
 * test/domain/can-export-catalog.test.ts — kiểm thử THUẦN quyền xuất danh mục
 * Excel (không chạm DB).
 *
 * Khóa hành vi (canExportCatalog):
 *  - Author (DC_AUTHOR) -> xuất được.
 *  - DC Site (DC_SITE_DOC_CONTROL) -> xuất được.
 *  - Admin-thuần (DC_ADMIN) -> KHÔNG (đứng ngoài luồng tài liệu).
 *  - Reader (không vai / DC_READER) -> KHÔNG.
 *  - Author kiêm Admin -> xuất được (vì có DC_AUTHOR).
 *
 * Validates: Requirements 1.7, 2.7, 4.1
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { canExportCatalog } from '../../src/domain/permissions.js';

const roles = (...codes: string[]) => new Set(codes);

describe('canExportCatalog — bảng vai', () => {
  const cases: { name: string; roleCodes: Set<string>; expected: boolean }[] = [
    { name: 'Author (DC_AUTHOR) -> true', roleCodes: roles('DC_AUTHOR'), expected: true },
    { name: 'DC Site (DC_SITE_DOC_CONTROL) -> true', roleCodes: roles('DC_SITE_DOC_CONTROL'), expected: true },
    { name: 'Admin-thuần (DC_ADMIN) -> false', roleCodes: roles('DC_ADMIN'), expected: false },
    { name: 'Reader (không vai) -> false', roleCodes: roles(), expected: false },
    { name: 'Author kiêm Admin -> true', roleCodes: roles('DC_AUTHOR', 'DC_ADMIN'), expected: true },
    { name: 'Reader (DC_READER) -> false', roleCodes: roles('DC_READER'), expected: false },
  ];

  for (const c of cases) {
    test(c.name, () => {
      assert.equal(canExportCatalog(c.roleCodes), c.expected);
    });
  }
});
