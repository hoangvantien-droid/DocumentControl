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

/** Kiểm quyền release chính xác theo DCS-11 §A.4. */
export async function canRelease(
  sql: Sql,
  userId: string,
  doc: DocScope,
): Promise<boolean> {
  const rows = await sql<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
        FROM user_roles r
       WHERE r.user_id = ${userId}
         AND r.is_active
         AND (
           (r.role_code = 'DC_GROUP_OWNER'
             AND ${doc.scope_level} = 'group'
             AND r.scope_level = 'group')
           OR (r.role_code = 'DC_BU_OWNER'
             AND ${doc.scope_level} = 'bu'
             AND r.scope_bu_id = ${doc.scope_bu_id})
           OR (r.role_code = 'DC_SITE_QA_MANAGER'
             AND ${doc.scope_level} = 'site'
             AND r.scope_site_id = ${doc.scope_site_id})
           OR (r.role_code = 'DC_DEPT_HEAD'
             AND ${doc.scope_level} = 'dept'
             AND r.scope_dept_id = ${doc.scope_dept_id})
         )
    ) AS ok`;
  return rows[0]?.ok ?? false;
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

/** Người có thể xác nhận ít nhất một phạm vi tài liệu. */
export function hasAnyReleaseRole(roleCodes: Set<string>): boolean {
  return (
    roleCodes.has('DC_GROUP_OWNER') ||
    roleCodes.has('DC_BU_OWNER') ||
    roleCodes.has('DC_SITE_QA_MANAGER') ||
    roleCodes.has('DC_DEPT_HEAD')
  );
}
