/**
 * src/domain/functional-groups.ts — nhóm chức năng (T-067, T-068).
 *
 * Thứ DUY NHẤT DCS sở hữu về con người. owner_user_id BẮT BUỘC, đích danh một
 * người (không giao cho phòng) — ràng buộc đã ép ở DB. Chỉ lưu user_id, không
 * lưu thuộc tính nhân sự.
 *
 * Phát hiện nhóm lạc hậu (v_functional_group_stale): người rời tổ chức hoặc đổi
 * bộ phận — cơ chế tự động DUY NHẤT chống nhóm âm thầm sai.
 */
import type { Sql } from 'postgres';
import { BusinessError } from '../lib/errors.js';

export interface FunctionalGroup {
  group_id: string;
  code: string;
  name: string;
  owner_user_id: string;
  review_cycle_months: number;
  member_count: number;
}

export async function listGroups(sql: Sql): Promise<FunctionalGroup[]> {
  return sql<FunctionalGroup[]>`
    SELECT fg.group_id, fg.code, fg.name, fg.owner_user_id, fg.review_cycle_months,
           (SELECT count(*)::int FROM functional_group_members m WHERE m.group_id = fg.group_id) AS member_count
      FROM functional_groups fg
     WHERE fg.is_active
     ORDER BY fg.code`;
}

export async function createGroup(
  sql: Sql,
  input: { code: string; name: string; ownerUserId: string },
): Promise<string> {
  if (!input.ownerUserId) {
    throw new BusinessError('fg.owner', 'Nhóm chức năng bắt buộc có người phụ trách đích danh');
  }
  const rows = await sql<{ group_id: string }[]>`
    INSERT INTO functional_groups (code, name, owner_user_id)
    VALUES (${input.code}, ${input.name}, ${input.ownerUserId})
    RETURNING group_id`;
  return rows[0]!.group_id;
}

export async function addMember(sql: Sql, groupId: string, userId: string, addedBy: string): Promise<void> {
  await sql`
    INSERT INTO functional_group_members (group_id, user_id, added_by)
    VALUES (${groupId}, ${userId}, ${addedBy})
    ON CONFLICT (group_id, user_id) DO NOTHING`;
}

export async function removeMember(sql: Sql, groupId: string, userId: string): Promise<void> {
  await sql`DELETE FROM functional_group_members WHERE group_id = ${groupId} AND user_id = ${userId}`;
}

export async function membersOf(sql: Sql, groupId: string) {
  return sql<{ user_id: string; full_name: string | null; email: string | null }[]>`
    SELECT m.user_id, u.full_name, u.email
      FROM functional_group_members m JOIN app_user_ref u ON u.user_id = m.user_id
     WHERE m.group_id = ${groupId}`;
}

/** Nhóm chứa người đã rời tổ chức/đổi bộ phận — hiện ngay khi mở trang (T-068). */
export async function staleMembers(sql: Sql) {
  return sql<{ group_id: string; code: string; name: string; thanh_vien_can_ra_soat: string; ly_do: string }[]>`
    SELECT group_id, code, name, thanh_vien_can_ra_soat, ly_do
      FROM v_functional_group_stale
     ORDER BY code`;
}
