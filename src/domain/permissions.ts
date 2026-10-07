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

/** Kiểm quyền release: cờ Phê duyệt + scope Dept chính, fallback logic cũ trong giai đoạn chuyển đổi. */
export async function canRelease(
  sql: Sql,
  userId: string,
  doc: DocScope,
): Promise<boolean> {
  const roles = await roleCodesOf(sql, userId);
  if (!hasAnyReleaseRole(roles)) return false;
  // Nhóm group giữ chặt: chỉ DC_GROUP_OWNER (tránh site/dept duyệt nhầm tài liệu toàn cục).
  if (doc.scope_level === 'group') {
    const rows = await sql<{ ok: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM user_roles r
         WHERE r.user_id = ${userId} AND r.is_active
           AND r.role_code = 'DC_GROUP_OWNER' AND r.scope_level = 'group'
      ) AS ok`;
    return rows[0]?.ok ?? false;
  }
  // Scope mới từ Dept chính.
  const scope = await getUserScope(sql, userId);
  if (doc.scope_level === 'dept' && scope.dept_id && scope.dept_id === doc.scope_dept_id) return true;
  if (doc.scope_level === 'site' && scope.site_id && scope.site_id === doc.scope_site_id) return true;
  if (doc.scope_level === 'bu' && doc.scope_bu_id && scope.bu_ids.includes(doc.scope_bu_id)) return true;
  // Fallback logic cũ Ver2 để không gãy quyền đang chạy.
  const rows = await sql<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
        FROM user_roles r
       WHERE r.user_id = ${userId}
         AND r.is_active
         AND (
           (r.role_code = 'DC_BU_OWNER'
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
