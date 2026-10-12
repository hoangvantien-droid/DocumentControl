/**
 * src/domain/permissions.ts — kiểm quyền theo phạm vi Ver2 (T-016).
 *
 * Quyền release phải khớp đúng role, đúng cấp và đúng đối tượng phạm vi. Không
 * có quyền bao trùm từ BU xuống Site/Department hoặc Site xuống Department.
 */
import type { Sql } from 'postgres';

export interface DocScope {
  scope_level: 'group' | 'bu' | 'site' | 'dept';
  scope_bu_id: string | null;
  scope_site_id: string | null;
  scope_dept_id: string | null;
}

/** 3 vai đơn giản: Admin / Biên soạn / Phê duyệt. Scope lấy từ Dept chính, không kế thừa. */
export type VaiTro = 'admin' | 'biensoan' | 'pheduyet';

export interface UserScope {
  dept_id: string | null;
  site_id: string | null;
  bu_ids: string[];
}

/** Scope suy từ primary_dept_id: dept -> site -> bu (qua org_site_bu). */
export async function getUserScope(sql: Sql, userId: string): Promise<UserScope> {
  const rows = await sql<{ dept_id: string | null; site_id: string | null }[]>`
    SELECT u.primary_dept_id AS dept_id, dp.site_id AS site_id
      FROM users u LEFT JOIN org_department dp ON dp.dept_id = u.primary_dept_id
     WHERE u.user_id = ${userId}`;
  const dept_id = rows[0]?.dept_id ?? null;
  const site_id = rows[0]?.site_id ?? null;
  let bu_ids: string[] = [];
  if (site_id) {
    const br = await sql<{ bu_id: string }[]>`
      SELECT bu_id FROM org_site_bu WHERE site_id = ${site_id}`;
    bu_ids = br.map((r) => r.bu_id);
  }
  return { dept_id, site_id, bu_ids };
}

/** Có cờ Phê duyệt: 1 trong 4 role duyệt cũ. Giữ tương thích ngược. */
export async function canApproveDocs(sql: Sql, userId: string): Promise<boolean> {
  const roles = await roleCodesOf(sql, userId);
  return hasAnyReleaseRole(roles);
}

/** Kiểm quyền release 3 vai: cờ Phê duyệt (DC_DEPT_HEAD group) + scope Dept chính, không kế thừa. */
export async function canRelease(
  sql: Sql,
  userId: string,
  doc: DocScope,
): Promise<boolean> {
  const roles = await roleCodesOf(sql, userId);
  if (!hasAnyReleaseRole(roles)) return false;
  // Admin có quyền release mọi scope.
  if (roles.has('DC_ADMIN')) return true;
  // Tài liệu toàn cục: chỉ Phê duyệt group.
  if (doc.scope_level === 'group') {
    const rows = await sql<{ ok: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM user_roles r
         WHERE r.user_id = ${userId} AND r.is_active
           AND ((r.role_code = 'DC_DEPT_HEAD' AND r.scope_level = 'group')
             OR r.role_code = 'DC_ADMIN')
      ) AS ok`;
    return rows[0]?.ok ?? false;
  }
  // Scope từ user_roles: dept/site/bu, không kế thừa chéo.
  const roleScopes = await sql<{ scope_level: string; scope_dept_id: string | null; scope_site_id: string | null; scope_bu_id: string | null }[]>`
    SELECT scope_level, scope_dept_id, scope_site_id, scope_bu_id
      FROM user_roles
     WHERE user_id = ${userId} AND is_active AND role_code = 'DC_DEPT_HEAD'`;
  for (const rs of roleScopes) {
    if (doc.scope_level === 'dept' && rs.scope_dept_id === doc.scope_dept_id) return true;
    if (doc.scope_level === 'site' && rs.scope_site_id === doc.scope_site_id) return true;
    if (doc.scope_level === 'bu' && rs.scope_bu_id === doc.scope_bu_id) return true;
  }
  return false;
}

export async function canRegisterDocuments(sql: Sql, userId: string): Promise<boolean> {
  const rows = await sql<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM user_roles
       WHERE user_id = ${userId}
         AND is_active
         AND role_code = 'DC_AUTHOR'
    ) AS ok`;
  return rows[0]?.ok ?? false;
}

export async function hasSystemAdminAccess(sql: Sql, userId: string): Promise<boolean> {
  const rows = await sql<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM user_roles
       WHERE user_id = ${userId}
         AND role_code = 'DC_ADMIN'
         AND is_active
    ) AS ok`;
  return rows[0]?.ok ?? false;
}

/** Tập mã vai trò đang active của người dùng (không xét phạm vi) — cho menu. */
export async function roleCodesOf(sql: Sql, userId: string): Promise<Set<string>> {
  const rows = await sql<{ role_code: string }[]>`
    SELECT DISTINCT role_code FROM user_roles
     WHERE user_id = ${userId} AND is_active`;
  return new Set(rows.map((r) => r.role_code));
}

/** 3 vai: có cờ Phê duyệt (DC_DEPT_HEAD). Mã cũ đã map về DC_DEPT_HEAD group ở migration 013. */
export function hasAnyReleaseRole(roleCodes: Set<string>): boolean {
  return roleCodes.has('DC_DEPT_HEAD') || roleCodes.has('DC_ADMIN');
}
