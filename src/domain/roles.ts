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
  // Mô hình 3 vai: Admin / Biên soạn (DC_AUTHOR) / Phê duyệt (DC_DEPT_HEAD) đều
  // gán ở cấp hệ thống (group). Phạm vi duyệt suy từ Dept chính của người dùng.
  // DC_READER, DC_GROUP_OWNER giữ ở group cho tương thích dữ liệu lịch sử.
  const groupRoles: RoleCode[] = ['DC_ADMIN', 'DC_AUTHOR', 'DC_DEPT_HEAD', 'DC_READER', 'DC_GROUP_OWNER'];
  if (groupRoles.includes(role)) {
    if (scope.level !== 'group') {
      throw new BusinessError('role.scope', `${role} chỉ được gán ở cấp Group`);
    }
    return { level: 'group', bu: null, site: null, dept: null };
  }

  // Các vai cũ theo phạm vi (DC_BU_OWNER, DC_SITE_QA_MANAGER) đã bị migration 013
  // gộp về DC_DEPT_HEAD@group và không còn gán mới qua UI 3 vai. Chặn tường minh.
  throw new BusinessError(
    'role.scope',
    `Vai trò ${role} không còn được gán trong mô hình 3 vai (đã gộp về Phê duyệt ở cấp Group)`,
  );
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
