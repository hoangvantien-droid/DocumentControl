/**
 * src/middleware/nav.ts — dựng cờ hiển thị thực đơn theo vai trò (T-017).
 *
 * Thực đơn ẩn hẳn mục không có quyền (DCS-7 §1.2). Cờ dựa trên vai trò đang
 * active của người dùng. isAdmin theo Ver2: role DC_ADMIN.
 */
import type { Sql } from 'postgres';
import { roleCodesOf, hasAnyReleaseRole } from '../domain/permissions.js';
import type { SessionUser } from '../domain/session.js';

export interface NavFlags {
  canRegister: boolean;
  canRelease: boolean;
  isAdmin: boolean;
  /** Lỗi #13: user chỉ là Author (không có vai trò release) — ẩn "Chờ tôi phê duyệt". */
  isAuthorOnly: boolean;
  /** Lỗi #13: hiện "Tài liệu của tôi" cho mọi user đã đăng nhập (không chỉ DC_AUTHOR). */
  canSeeMyDocuments: boolean;
  /** Lỗi #16: hiện "Kiểm tra dữ liệu nhập" cho mọi user đã đăng nhập. */
  canSeeDataCheck: boolean;
}

export async function buildNav(sql: Sql, user: SessionUser | null): Promise<NavFlags> {
  if (!user) return { canRegister: false, canRelease: false, isAdmin: false, isAuthorOnly: false, canSeeMyDocuments: false, canSeeDataCheck: false };
  const roles = await roleCodesOf(sql, user.user_id);
  const canRelease = hasAnyReleaseRole(roles);
  return {
    canRegister: roles.has('DC_AUTHOR'),
    canRelease,
    isAdmin: roles.has('DC_ADMIN'),
    isAuthorOnly: roles.has('DC_AUTHOR') && !canRelease,
    // Lỗi #13: mọi user đã đăng nhập đều thấy "Tài liệu của tôi" (lọc theo registrant_user_id).
    canSeeMyDocuments: true,
    // Lỗi #16: mọi user đã đăng nhập đều thấy "Kiểm tra dữ liệu nhập" (read-only).
    canSeeDataCheck: true,
  };
}
