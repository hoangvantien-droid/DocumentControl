/**
 * src/domain/permissions.ts — kiểm quyền theo cấp phạm vi (T-016).
 *
 * canRelease(user, doc): người có quyền xác nhận (release) tài liệu nếu có vai
 * trò release ở cấp BAO TRÙM phạm vi tài liệu (DCS-1 §2.6):
 *   DC_GROUP_OWNER      -> mọi tài liệu
 *   DC_BU_OWNER @ BU     -> tài liệu scope bu, hoặc site/dept nằm trong BU đó
 *   DC_SITE_QA_MANAGER @ Site -> tài liệu scope site, hoặc dept nằm trong Site đó
 *
 * Kiểm quyền đặt ở domain/ (không ở routes/) vì cùng hành động có thể gọi từ
 * giao diện, API, hoặc tác vụ nền — kiểm ở route sẽ bỏ sót (DCS-8 §4.3).
 */
import type { Sql } from 'postgres';

export interface DocScope {
  scope_level: 'group' | 'bu' | 'site' | 'dept';
  scope_bu_id: string | null;
  scope_site_id: string | null;
  scope_dept_id: string | null;
}

/**
 * Trả về true nếu người dùng có quyền release tài liệu có phạm vi cho trước.
 * Dùng một truy vấn SQL để kiểm bao trùm qua cây tổ chức (org_site.bu_id,
 * org_department.site_id), không tự suy trong TypeScript.
 */
export async function canRelease(
  sql: Sql,
  userId: string,
  doc: DocScope,
): Promise<boolean> {
  const rows = await sql<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
        FROM app_user_role r
        LEFT JOIN org_site  bs ON bs.site_id = ${doc.scope_site_id}
        LEFT JOIN org_department dd ON dd.dept_id = ${doc.scope_dept_id}
        LEFT JOIN org_site  ds ON ds.site_id = dd.site_id
       WHERE r.user_id = ${userId}
         AND r.is_active
         AND (
           -- Group Owner: release mọi tài liệu
           r.role_code = 'DC_GROUP_OWNER'

           -- BU Owner: tài liệu thuộc đúng BU của vai trò
           OR (r.role_code = 'DC_BU_OWNER' AND r.scope_bu_id = (
                 CASE ${doc.scope_level}
                   WHEN 'bu'   THEN ${doc.scope_bu_id}
                   WHEN 'site' THEN bs.bu_id
                   WHEN 'dept' THEN ds.bu_id
                   ELSE NULL
                 END))

           -- Site QA Manager: tài liệu thuộc đúng Site của vai trò
           OR (r.role_code = 'DC_SITE_QA_MANAGER' AND r.scope_site_id = (
                 CASE ${doc.scope_level}
                   WHEN 'site' THEN ${doc.scope_site_id}
                   WHEN 'dept' THEN dd.site_id
                   ELSE NULL
                 END))
         )
    ) AS ok`;
  return rows[0]?.ok ?? false;
}

/** Tập mã vai trò đang active của người dùng (không xét phạm vi) — cho menu. */
export async function roleCodesOf(sql: Sql, userId: string): Promise<Set<string>> {
  const rows = await sql<{ role_code: string }[]>`
    SELECT DISTINCT role_code FROM app_user_role
     WHERE user_id = ${userId} AND is_active`;
  return new Set(rows.map((r) => r.role_code));
}

/** Người có thể xác nhận (release) bất kỳ tài liệu nào không — cho menu "Chờ tôi xác nhận". */
export function hasAnyReleaseRole(roleCodes: Set<string>): boolean {
  return (
    roleCodes.has('DC_GROUP_OWNER') ||
    roleCodes.has('DC_BU_OWNER') ||
    roleCodes.has('DC_SITE_QA_MANAGER')
  );
}
