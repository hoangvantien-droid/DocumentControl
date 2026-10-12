/**
 * src/domain/roles.ts — gán vai trò theo phạm vi Ver2 (T-015).
 *
 * DCS là nguồn sở hữu vai trò. Role release phải luôn mang đúng cấp phạm vi;
 * các role kỹ thuật/đăng ký/đọc là role toàn hệ thống và dùng scope group.
 */
import type { Sql } from 'postgres';
import { BusinessError } from '../lib/errors.js';

export type RoleCode =
  | 'DC_ADMIN'
  | 'DC_AUTHOR'
  | 'DC_DEPT_HEAD'
  | 'DC_SITE_QA_MANAGER'
  | 'DC_BU_OWNER'
  | 'DC_GROUP_OWNER'
  | 'DC_READER';

export type ScopeLevel = 'group' | 'bu' | 'site' | 'dept';

export interface RoleGrant {
  user_role_id: string;
  user_id: string;
  role_code: RoleCode;
  scope_level: ScopeLevel;
  scope_bu_id: string | null;
  scope_site_id: string | null;
  scope_dept_id: string | null;
  is_active: boolean;
}

export interface ScopeRef {
  level: ScopeLevel;
  buId?: string | null;
  siteId?: string | null;
  deptId?: string | null;
}

function normalizeScope(role: RoleCode, scope: ScopeRef): {
  level: ScopeLevel; bu: string | null; site: string | null; dept: string | null;
} {
  const globalRoles: RoleCode[] = ['DC_ADMIN', 'DC_AUTHOR', 'DC_READER', 'DC_GROUP_OWNER'];
  if (globalRoles.includes(role)) {
    if (scope.level !== 'group') {
      throw new BusinessError('role.scope', `${role} chỉ được gán ở cấp Group`);
    }
    return { level: 'group', bu: null, site: null, dept: null };
  }

  if (role === 'DC_BU_OWNER') {
    if (scope.level !== 'bu' || !scope.buId) {
      throw new BusinessError('role.scope', 'DC_BU_OWNER bắt buộc có phạm vi BU');
    }
    return { level: 'bu', bu: scope.buId, site: null, dept: null };
  }
  if (role === 'DC_SITE_QA_MANAGER') {
    if (scope.level !== 'site' || !scope.siteId) {
      throw new BusinessError('role.scope', 'DC_SITE_QA_MANAGER bắt buộc có phạm vi Site');
    }
    return { level: 'site', bu: null, site: scope.siteId, dept: null };
  }
  if (scope.level !== 'dept' || !scope.deptId) {
    throw new BusinessError('role.scope', 'DC_DEPT_HEAD bắt buộc có phạm vi Department');
  }
  return { level: 'dept', bu: null, site: null, dept: scope.deptId };
}

/** Gán vai trò cho người dùng ở một phạm vi. Idempotent. */
export async function grantRole(
  sql: Sql,
  input: { userId: string; role: RoleCode; scope: ScopeRef; grantedBy?: string },
): Promise<void> {
  const s = normalizeScope(input.role, input.scope);
  await sql`
    INSERT INTO user_roles
      (user_id, role_code, scope_level, scope_bu_id, scope_site_id, scope_dept_id, granted_by)
    VALUES
      (${input.userId}, ${input.role}, ${s.level}, ${s.bu}, ${s.site}, ${s.dept},
       ${input.grantedBy ?? null})
    ON CONFLICT (user_id, role_code, scope_level, scope_bu_id, scope_site_id, scope_dept_id)
    DO UPDATE SET is_active = TRUE`;
}

export async function revokeRole(sql: Sql, userRoleId: string): Promise<void> {
  await sql`UPDATE user_roles SET is_active = FALSE WHERE user_role_id = ${userRoleId}`;
}

export async function rolesOfUser(sql: Sql, userId: string): Promise<RoleGrant[]> {
  return sql<RoleGrant[]>`
    SELECT user_role_id, user_id, role_code, scope_level,
           scope_bu_id, scope_site_id, scope_dept_id, is_active
      FROM user_roles
     WHERE user_id = ${userId} AND is_active
     ORDER BY role_code`;
}
