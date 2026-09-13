/**
 * src/domain/org.ts — cây tổ chức tạm (BU → Site → Department), giai đoạn 1.
 *
 * Thiết kế gốc: org_* là bản đọc đồng bộ từ L1, DCS không sửa. Giai đoạn 1 chưa
 * có L1 nên phụ lục DCS-4 đã gỡ rule chặn ghi và thêm trigger ghi vết mọi thao
 * tác tổ chức. Khi L1 lên: gỡ màn hình này, khôi phục rule chặn ghi.
 *
 * Logic thuần, ghi vết đi kèm trong cùng giao dịch (DCS-8 §3.4).
 */
import { randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';

export interface Bu { bu_id: string; bu_code: string; name: string }
export interface Site { site_id: string; site_code: string; name: string; bu_id: string }
export interface Dept {
  dept_id: string; dept_code: string; name: string; site_id: string;
  manager_user_id: string | null;
}

export async function listBu(sql: Sql): Promise<Bu[]> {
  return sql<Bu[]>`SELECT bu_id, bu_code, name FROM org_bu ORDER BY bu_code`;
}
export async function listSites(sql: Sql): Promise<Site[]> {
  return sql<Site[]>`SELECT site_id, site_code, name, bu_id FROM org_site ORDER BY site_code`;
}
export async function listDepartments(sql: Sql): Promise<Dept[]> {
  return sql<Dept[]>`
    SELECT dept_id, dept_code, name, site_id, manager_user_id
      FROM org_department ORDER BY dept_code`;
}

export async function createBu(sql: Sql, code: string, name: string): Promise<string> {
  const id = randomUUID();
  // Trigger fn_log_temp_org ghi vết tự động (phụ lục DCS-4), không cần ghi tay.
  await sql`INSERT INTO org_bu (bu_id, bu_code, name) VALUES (${id}, ${code}, ${name})`;
  return id;
}

export async function createSite(
  sql: Sql, code: string, name: string, buId: string,
): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO org_site (site_id, site_code, name, bu_id)
            VALUES (${id}, ${code}, ${name}, ${buId})`;
  return id;
}

export async function createDepartment(
  sql: Sql, code: string, name: string, siteId: string,
): Promise<string> {
  const id = randomUUID();
  await sql`INSERT INTO org_department (dept_id, dept_code, name, site_id)
            VALUES (${id}, ${code}, ${name}, ${siteId})`;
  return id;
}
