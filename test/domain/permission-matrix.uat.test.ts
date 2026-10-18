/**
 * test/domain/permission-matrix.uat.test.ts — UAT TẦNG 1 (THUẦN, KHÔNG CẦN DB).
 *
 * Chuyển nhóm P (phân quyền chồng chéo) của docs/KE-HOACH-TEST-TOAN-DIEN.md
 * thành test tự động dạng DATA-DRIVEN TABLE, gọi trực tiếp các hàm quyết định
 * THUẦN trong src/domain/permissions.ts. Mỗi dòng bảng ghi rõ mã ca trong kịch
 * bản (vd 'P.2.6').
 *
 * Phần phủ ở đây là phần của nhóm P KHÔNG bắt buộc HTTP/DB — tức ma trận quyết
 * định canUserRelease / isReadOnlyUser / allowedStatusesForViewer / hasAnyRelease
 * Role. Các ca P.0 (schema), P.1.1/P.1.4 (two-person qua route), P.5.x (truy cập
 * URL), P.6.x (revoke/active) cần HTTP+DB và nằm ở TẦNG 2 (test/uat/http.uat.test.ts).
 *
 * Lưu ý chống trùng lặp: các ca cơ bản (dept khớp/lệch, group chỉ Admin, bu một
 * phần tử) đã có trong viewer-permissions.test.ts và author-release-bug.test.ts.
 * File này BỔ SUNG các ca ma trận còn thiếu: nhiều vai cùng lúc (P.1), site N:N
 * nhiều BU (P.4), scope null mọi cấp (P.3), không kế thừa chéo (P.8), và chốt
 * đầy đủ bảng 3.2 theo từng cấp tài liệu.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isReadOnlyUser,
  allowedStatusesForViewer,
  hasAnyReleaseRole,
  canUserRelease,
  CURRENT_VIEW_STATUSES,
  type DocScope,
  type UserScopeRef,
} from '../../src/domain/permissions.js';

// ---- Trợ giúp dựng dữ liệu nền (mục 2 của kịch bản) ----------------------

const roles = (...codes: string[]) => new Set(codes);

// Định danh phạm vi tượng trưng — khớp mục 2.1 của kịch bản.
const BU_A = 'bu-a';
const BU_B = 'bu-b';
const SITE_X = 'site-x';   // thuộc CẢ BU-A và BU-B (N:N)
const SITE_Y = 'site-y';   // chỉ thuộc BU-A
const DEPT_X1 = 'dept-x1'; // thuộc Site X
const DEPT_Y1 = 'dept-y1'; // thuộc Site Y
const DEPT_X2 = 'dept-x2'; // dept khác cùng Site X (dùng cho P.8.2)

/** Scope suy từ Dept chính — khớp org của mục 2.2. */
const scopeDeptHeadX: UserScopeRef = { dept_id: DEPT_X1, site_id: SITE_X, bu_ids: [BU_A, BU_B] };
const scopeDeptHeadY: UserScopeRef = { dept_id: DEPT_Y1, site_id: SITE_Y, bu_ids: [BU_A] };
const scopeNull: UserScopeRef = { dept_id: null, site_id: null, bu_ids: [] };

const doc = (over: Partial<DocScope>): DocScope => ({
  scope_level: 'group', scope_bu_id: null, scope_site_id: null, scope_dept_id: null, ...over,
});

// Tài liệu test theo cấp (mục 2.3).
const DOC_GROUP = doc({ scope_level: 'group' });
const DOC_BUA = doc({ scope_level: 'bu', scope_bu_id: BU_A });
const DOC_BUB = doc({ scope_level: 'bu', scope_bu_id: BU_B });
const DOC_SITEX = doc({ scope_level: 'site', scope_site_id: SITE_X });
const DOC_SITEY = doc({ scope_level: 'site', scope_site_id: SITE_Y });
const DOC_DEPTX1 = doc({ scope_level: 'dept', scope_dept_id: DEPT_X1 });
const DOC_DEPTY1 = doc({ scope_level: 'dept', scope_dept_id: DEPT_Y1 });
const DOC_DEPTX2 = doc({ scope_level: 'dept', scope_dept_id: DEPT_X2 });

// ==========================================================================
// Bảng dữ liệu: mỗi dòng là một ca canUserRelease với mã ca trong kịch bản.
// `expect` là kỳ vọng được/chặn của hàm THUẦN. Các ca two-person (P.1.1, P.1.4)
// không nằm ở đây vì chúng do route/domain chặn, không phải canUserRelease.
// ==========================================================================
interface ReleaseCase {
  code: string;
  desc: string;
  roles: Set<string>;
  doc: DocScope;
  userScope: UserScopeRef;
  expect: boolean;
}

const releaseMatrix: ReleaseCase[] = [
  // ---- P.1 — Nhiều vai cùng lúc (phần quyết định thuần) ----
  {
    code: 'P.1.2', desc: 'Author+DeptHead duyệt DOC-DEPTX1-01 (dept chính) do người khác nộp',
    roles: roles('DC_AUTHOR', 'DC_DEPT_HEAD'), doc: DOC_DEPTX1, userScope: scopeDeptHeadX, expect: true,
  },
  {
    code: 'P.1.3', desc: 'Author+DeptHead duyệt DOC-GROUP-01 (group) — chặn, không có Admin',
    roles: roles('DC_AUTHOR', 'DC_DEPT_HEAD'), doc: DOC_GROUP, userScope: scopeDeptHeadX, expect: false,
  },
  {
    code: 'P.1.5', desc: 'Admin+Author duyệt tài liệu cấp group — được (Admin duyệt mọi cấp)',
    roles: roles('DC_ADMIN', 'DC_AUTHOR'), doc: DOC_GROUP, userScope: scopeNull, expect: true,
  },
  {
    code: 'P.1.6', desc: 'Admin+DeptHead (Dept chính Site Y) duyệt DOC-SITEX-01 — được vì là Admin (override scope hẹp)',
    roles: roles('DC_ADMIN', 'DC_DEPT_HEAD'), doc: DOC_SITEX, userScope: scopeDeptHeadY, expect: true,
  },

  // ---- P.2 — DeptHead có Dept chính thuộc Site X ----
  {
    code: 'P.2.1', desc: 'u_dh_x duyệt DOC-DEPTX1-01 (dept khớp)',
    roles: roles('DC_DEPT_HEAD'), doc: DOC_DEPTX1, userScope: scopeDeptHeadX, expect: true,
  },
  {
    code: 'P.2.2', desc: 'u_dh_x duyệt DOC-DEPTY1 (dept lệch) — chặn',
    roles: roles('DC_DEPT_HEAD'), doc: DOC_DEPTY1, userScope: scopeDeptHeadX, expect: false,
  },
  {
    code: 'P.2.3', desc: 'u_dh_x duyệt DOC-SITEX-01 (site khớp)',
    roles: roles('DC_DEPT_HEAD'), doc: DOC_SITEX, userScope: scopeDeptHeadX, expect: true,
  },
  {
    code: 'P.2.4', desc: 'u_dh_x duyệt DOC-SITEY-01 (site lệch) — chặn',
    roles: roles('DC_DEPT_HEAD'), doc: DOC_SITEY, userScope: scopeDeptHeadX, expect: false,
  },
  {
    code: 'P.2.5', desc: 'u_dh_x duyệt DOC-BUA-01 (Site X thuộc BU-A)',
    roles: roles('DC_DEPT_HEAD'), doc: DOC_BUA, userScope: scopeDeptHeadX, expect: true,
  },
  {
    code: 'P.2.6', desc: 'u_dh_x duyệt DOC-BUB-01 (Site X cũng thuộc BU-B — ranh giới N:N)',
    roles: roles('DC_DEPT_HEAD'), doc: DOC_BUB, userScope: scopeDeptHeadX, expect: true,
  },
  {
    code: 'P.2.7', desc: 'u_dh_x duyệt DOC-GROUP-01 (group) — chặn, chỉ Admin',
    roles: roles('DC_DEPT_HEAD'), doc: DOC_GROUP, userScope: scopeDeptHeadX, expect: false,
  },

  // ---- P.3 — DeptHead KHÔNG có Dept chính (scope null) ----
  {
    code: 'P.3.1', desc: 'u_dh_null duyệt DOC-DEPTX1-01 (dept) — chặn (dept_id null)',
    roles: roles('DC_DEPT_HEAD'), doc: DOC_DEPTX1, userScope: scopeNull, expect: false,
  },
  {
    code: 'P.3.2', desc: 'u_dh_null duyệt DOC-SITEX-01 (site) — chặn (site_id null)',
    roles: roles('DC_DEPT_HEAD'), doc: DOC_SITEX, userScope: scopeNull, expect: false,
  },
  {
    code: 'P.3.3', desc: 'u_dh_null duyệt DOC-BUA-01 (bu) — chặn (bu_ids rỗng)',
    roles: roles('DC_DEPT_HEAD'), doc: DOC_BUA, userScope: scopeNull, expect: false,
  },
  {
    code: 'P.3.4', desc: 'u_dh_null duyệt DOC-GROUP-01 (group) — chặn (chỉ Admin)',
    roles: roles('DC_DEPT_HEAD'), doc: DOC_GROUP, userScope: scopeNull, expect: false,
  },

  // ---- P.4 — Site thuộc NHIỀU BU (ranh giới N:N) ----
  {
    code: 'P.4.1a', desc: 'u_dh_x (Site X ∈ {BU-A,BU-B}) duyệt tài liệu cấp BU-A',
    roles: roles('DC_DEPT_HEAD'), doc: DOC_BUA, userScope: scopeDeptHeadX, expect: true,
  },
  {
    code: 'P.4.1b', desc: 'u_dh_x (Site X ∈ {BU-A,BU-B}) duyệt tài liệu cấp BU-B — cả hai BU đều được',
    roles: roles('DC_DEPT_HEAD'), doc: DOC_BUB, userScope: scopeDeptHeadX, expect: true,
  },
  {
    code: 'P.4.2', desc: 'u_dh_y (Site Y ∈ {BU-A}) duyệt DOC-BUB-01 (BU-B) — chặn (không thuộc BU-B)',
    roles: roles('DC_DEPT_HEAD'), doc: DOC_BUB, userScope: scopeDeptHeadY, expect: false,
  },

  // ---- P.8 — Không kế thừa chéo ----
  {
    code: 'P.8.1', desc: 'u_dh_x duyệt DOC-SITEX-01 (site) — được vì site_id suy từ Dept khớp, KHÔNG do trùm từ dept',
    roles: roles('DC_DEPT_HEAD'), doc: DOC_SITEX, userScope: scopeDeptHeadX, expect: true,
  },
  {
    code: 'P.8.2', desc: 'u_dh_x duyệt tài liệu cấp dept DEPT-X2 (cùng Site X nhưng dept khác) — chặn (dept phải khớp chính xác, site không trùm dept khác)',
    roles: roles('DC_DEPT_HEAD'), doc: DOC_DEPTX2, userScope: scopeDeptHeadX, expect: false,
  },

  // ---- Bảng 3.2 — cấp group luôn chặn với DeptHead, luôn được với Admin ----
  {
    code: '3.2-group-admin', desc: 'Admin duyệt tài liệu group — được',
    roles: roles('DC_ADMIN'), doc: DOC_GROUP, userScope: scopeNull, expect: true,
  },
  {
    code: '3.2-bu-admin', desc: 'Admin duyệt tài liệu bu bất kể Dept chính — được',
    roles: roles('DC_ADMIN'), doc: DOC_BUB, userScope: scopeNull, expect: true,
  },
  {
    code: '3.2-reader-site', desc: 'Reader thuần không duyệt được tài liệu site',
    roles: roles('DC_READER'), doc: DOC_SITEX, userScope: scopeDeptHeadX, expect: false,
  },
  {
    code: '3.2-author-dept', desc: 'Author thuần không duyệt được tài liệu dept dù trùng Dept chính',
    roles: roles('DC_AUTHOR'), doc: DOC_DEPTX1, userScope: scopeDeptHeadX, expect: false,
  },
];

describe('Nhóm P — ma trận RELEASE (canUserRelease, thuần)', () => {
  for (const c of releaseMatrix) {
    test(`${c.code} — ${c.desc}`, () => {
      assert.equal(
        canUserRelease(c.roles, c.doc, c.userScope),
        c.expect,
        `${c.code}: kỳ vọng ${c.expect ? 'ĐƯỢC' : 'CHẶN'}`,
      );
    });
  }
});

// ==========================================================================
// P.1 — nhiều vai cùng lúc: hasAnyReleaseRole phải nhận cờ release từ bất kỳ
// vai nào trong tập, kể cả khi kèm vai không-release.
// ==========================================================================
describe('Nhóm P.1 — cờ release khi nhiều vai cùng lúc (hasAnyReleaseRole)', () => {
  const cases: { code: string; roles: Set<string>; expect: boolean }[] = [
    { code: 'P.1.2-flag', roles: roles('DC_AUTHOR', 'DC_DEPT_HEAD'), expect: true },
    { code: 'P.1.5-flag', roles: roles('DC_ADMIN', 'DC_AUTHOR'), expect: true },
    { code: 'P.1.6-flag', roles: roles('DC_ADMIN', 'DC_DEPT_HEAD'), expect: true },
    { code: 'P.1-author-only', roles: roles('DC_AUTHOR'), expect: false },
    { code: 'P.1-reader-only', roles: roles('DC_READER'), expect: false },
    { code: 'P.1-reader+author', roles: roles('DC_READER', 'DC_AUTHOR'), expect: false },
  ];
  for (const c of cases) {
    test(`${c.code} — hasAnyReleaseRole = ${c.expect}`, () => {
      assert.equal(hasAnyReleaseRole(c.roles), c.expect);
    });
  }
});

// ==========================================================================
// P.1 — isReadOnlyUser khi nhiều vai cùng lúc: chỉ Reader thuần (hoặc không vai)
// mới là chỉ-xem; kèm bất kỳ vai nghiệp vụ nào thì không còn chỉ-xem.
// ==========================================================================
describe('Nhóm P.1/P.9 — isReadOnlyUser khi nhiều vai cùng lúc', () => {
  const cases: { code: string; roles: Set<string>; expect: boolean }[] = [
    { code: 'P.9-reader-thuan', roles: roles('DC_READER'), expect: true },
    { code: 'P.9-khong-vai', roles: roles(), expect: true },
    { code: 'P.1-author+depthead', roles: roles('DC_AUTHOR', 'DC_DEPT_HEAD'), expect: false },
    { code: 'P.1-admin+author', roles: roles('DC_ADMIN', 'DC_AUTHOR'), expect: false },
    { code: 'P.1-admin+depthead', roles: roles('DC_ADMIN', 'DC_DEPT_HEAD'), expect: false },
    { code: 'P.1-reader+author', roles: roles('DC_READER', 'DC_AUTHOR'), expect: false },
  ];
  for (const c of cases) {
    test(`${c.code} — isReadOnlyUser = ${c.expect}`, () => {
      assert.equal(isReadOnlyUser(c.roles), c.expect);
    });
  }
});

// ==========================================================================
// P.9 — Reader chỉ xem bản hiện hành: allowedStatusesForViewer.
// ==========================================================================
describe('Nhóm P.9 — allowedStatusesForViewer (Reader chỉ bản hiện hành)', () => {
  test('P.9.1 — Reader thuần: chỉ trạng thái hiện hành (mô hình mới)', () => {
    const s = allowedStatusesForViewer(roles('DC_READER'));
    assert.deepEqual(s, CURRENT_VIEW_STATUSES);
    // Mô hình receipt mới: da_ban_hanh là hiện hành chính; giữ mã cũ cho
    // giai đoạn chuyển đổi (Task 9 dọn).
    assert.deepEqual([...(s ?? [])], ['da_ban_hanh', 'hieu_luc', 'da_dang_ky']);
  });
  test('P.9.1 — không vai nào cũng là Reader: giới hạn trạng thái', () => {
    assert.deepEqual(allowedStatusesForViewer(roles()), CURRENT_VIEW_STATUSES);
  });
  test('P.9.2 — Author/DeptHead/Admin: null (xem cả lịch sử)', () => {
    assert.equal(allowedStatusesForViewer(roles('DC_AUTHOR')), null);
    assert.equal(allowedStatusesForViewer(roles('DC_DEPT_HEAD')), null);
    assert.equal(allowedStatusesForViewer(roles('DC_ADMIN')), null);
  });
  test('P.9.2 — Reader kèm vai nghiệp vụ: null (không còn giới hạn)', () => {
    assert.equal(allowedStatusesForViewer(roles('DC_READER', 'DC_AUTHOR')), null);
    assert.equal(allowedStatusesForViewer(roles('DC_READER', 'DC_DEPT_HEAD')), null);
  });
});
