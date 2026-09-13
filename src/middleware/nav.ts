/**
 * src/middleware/nav.ts — dựng cờ hiển thị thực đơn theo vai trò (T-017).
 *
 * Thực đơn ẩn hẳn mục không có quyền (DCS-7 §1.2). Cờ dựa trên vai trò đang
 * active của người dùng. isAdmin giai đoạn 1: người có DC_GROUP_OWNER (khi L1
 * lên sẽ ánh xạ sang Super Admin/quyền cấu hình thật).
 */
import type { Sql } from 'postgres';
import { roleCodesOf, hasAnyReleaseRole } from '../domain/permissions.js';
import type { SessionUser } from '../domain/session.js';

export interface NavFlags {
  canRegister: boolean;
  canRelease: boolean;
  isAdmin: boolean;
}

export async function buildNav(sql: Sql, user: SessionUser | null): Promise<NavFlags> {
  if (!user) return { canRegister: false, canRelease: false, isAdmin: false };
  const roles = await roleCodesOf(sql, user.user_id);
  return {
    canRegister: roles.has('DC_AUTHOR') || hasAnyReleaseRole(roles),
    canRelease: hasAnyReleaseRole(roles),
    isAdmin: roles.has('DC_GROUP_OWNER'),
  };
}
