/**
 * src/domain/org.ts — cây tổ chức DCS sở hữu (BU ↔ Site → Department).
 *
 * Ver2 cho phép một Site phục vụ nhiều BU. org_site_bu là nguồn quan hệ chuẩn;
 * legacy_primary_bu_id chỉ còn là dữ liệu đối chiếu trong migration 005.
 */
import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';

export interface Bu { bu_id: string; bu_code: string; name: string }
export interface Site { site_id: string; site_code: string; name: string; bu_ids: string[] }
export interface Dept {
  dept_id: string; dept_code: string; name: string; site_id: string;
  manager_user_id: string | null;
}

export async function listBu(sql: Sql): Promise<Bu[]> {
  return sql<Bu[]>`SELECT bu_id, bu_code, name FROM org_bu ORDER BY bu_code`;
}
export async function listSites(sql: Sql): Promise<Site[]> {
  return sql<Site[]>`
    SELECT s.site_id, s.site_code, s.name,
           coalesce(array_agg(sb.bu_id ORDER BY sb.bu_id) FILTER (WHERE sb.bu_id IS NOT NULL), '{}') AS bu_ids
      FROM org_site s
      LEFT JOIN org_site_bu sb ON sb.site_id = s.site_id
     GROUP BY s.site_id, s.site_code, s.name
     ORDER BY s.site_code`;
}
export async function listDepartments(sql: Sql): Promise<Dept[]> {
  return sql<Dept[]>`
    SELECT dept_id, dept_code, name, site_id, manager_user_id
      FROM org_department ORDER BY dept_code`;
}

export async function createBu(sql: Sql, code: string, name: string): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO org_bu (bu_id, bu_code, name) VALUES (${id}, ${code}, ${name})`;
  return id;
}

/** Tạo Site và quan hệ BU đầu tiên; các BU bổ sung dùng addSiteBu. */
export async function createSite(
  sql: Sql, code: string, name: string, initialBuId: string,
): Promise<string> {
  const id = randomUUID();
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO org_site (site_id, site_code, name, legacy_primary_bu_id)
      VALUES (${id}, ${code}, ${name}, ${initialBuId})`;
    await tx`INSERT INTO org_site_bu (site_id, bu_id) VALUES (${id}, ${initialBuId})`;
  });
  return id;
}

export async function addSiteBu(sql: Sql, siteId: string, buId: string): Promise<void> {
  await sql`
    INSERT INTO org_site_bu (site_id, bu_id)
    VALUES (${siteId}, ${buId})
    ON CONFLICT (site_id, bu_id) DO NOTHING`;
}

export async function createDepartment(
  sql: Sql, code: string, name: string, siteId: string,
): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO org_department (dept_id, dept_code, name, site_id)
            VALUES (${id}, ${code}, ${name}, ${siteId})`;
  return id;
}
