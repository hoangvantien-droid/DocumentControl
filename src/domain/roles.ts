/**
 * src/domain/roles.ts — gán vai trò theo phạm vi (T-015).
 *
 * Năm vai trò ánh xạ từ đặc tả phân quyền QA (DCS-1 §2.6), không tạo vai trò
 * mới. Giai đoạn 1 DCS tự giữ ở app_user_role; khi L1 lên thì L1 là nguồn.
 */
import type { Sql } from 'postgres';
import { BusinessError } from '../lib/errors.js';

export type RoleCode =
  | 'DC_GROUP_OWNER'
  | 'DC_BU_OWNER'
  | 'DC_SITE_QA_MANAGER'
  | 'DC_AUTHOR'
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

function normalizeScope(scope: ScopeRef): {
  level: ScopeLevel; bu: string | null; site: string | null; dept: string | null;
} {
  switch (scope.level) {
    case 'group': return { level: 'group', bu: null, site: null, dept: null };
    case 'bu':
      if (!scope.buId) throw new BusinessError('role.scope', 'Cấp BU cần scope_bu_id');
      return { level: 'bu', bu: scope.buId, site: null, dept: null };
    case 'site':
      if (!scope.siteId) throw new BusinessError('role.scope', 'Cấp Site cần scope_site_id');
      return { level: 'site', bu: null, site: scope.siteId, dept: null };
    case 'dept':
      if (!scope.deptId) throw new BusinessError('role.scope', 'Cấp Department cần scope_dept_id');
      return { level: 'dept', bu: null, site: null, dept: scope.deptId };
  }
}

/** Gán vai trò cho người dùng ở một phạm vi. Idempotent. */
export async function grantRole(
  sql: Sql,
  input: { userId: string; role: RoleCode; scope: ScopeRef; grantedBy?: string },
): Promise<void> {
  const s = normalizeScope(input.scope);
  await sql`
    INSERT INTO app_user_role
      (user_id, role_code, scope_level, scope_bu_id, scope_site_id, scope_dept_id, granted_by)
    VALUES
      (${input.userId}, ${input.role}, ${s.level}, ${s.bu}, ${s.site}, ${s.dept},
       ${input.grantedBy ?? null})
    ON CONFLICT (user_id, role_code, scope_level, scope_bu_id, scope_site_id, scope_dept_id)
    DO UPDATE SET is_active = TRUE`;
}

export async function revokeRole(sql: Sql, userRoleId: string): Promise<void> {
  await sql`UPDATE app_user_role SET is_active = FALSE WHERE user_role_id = ${userRoleId}`;
}

export async function rolesOfUser(sql: Sql, userId: string): Promise<RoleGrant[]> {
  return sql<RoleGrant[]>`
    SELECT user_role_id, user_id, role_code, scope_level,
           scope_bu_id, scope_site_id, scope_dept_id, is_active
      FROM app_user_role
     WHERE user_id = ${userId} AND is_active
     ORDER BY role_code`;
}
