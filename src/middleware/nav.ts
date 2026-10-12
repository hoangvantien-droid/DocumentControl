/**
 * src/middleware/nav.ts — dựng cờ hiển thị thực đơn theo vai trò (T-017).
 *
 * Thực đơn ẩn hẳn mục không có quyền (DCS-7 §1.2). Cờ dựa trên vai trò đang
 * active của người dùng. isAdmin theo Ver2: role DC_ADMIN.
 */
import type { Sql } from 'postgres';
import { roleCodesOf, hasAnyReleaseRole, isReadOnlyUser } from '../domain/permissions.js';
import type { SessionUser } from '../domain/session.js';

export interface NavFlags {
  canRegister: boolean;
  canRelease: boolean;
  isAdmin: boolean;
  /** Lỗi #13: user chỉ là Author (không có vai trò release) — ẩn "Chờ tôi xác nhận". */
  isAuthorOnly: boolean;
  /** Lỗi #13: hiện "Tài liệu của tôi" cho mọi user đã đăng nhập (không chỉ DC_AUTHOR). */
  canSeeMyDocuments: boolean;
  /** Người chỉ-xem (Reader): không đăng ký, không xác nhận, không quản trị. */
  isReadOnly: boolean;
}

export async function buildNav(sql: Sql, user: SessionUser | null): Promise<NavFlags> {
  if (!user) return { canRegister: false, canRelease: false, isAdmin: false, isAuthorOnly: false, canSeeMyDocuments: false, isReadOnly: true };
  const roles = await roleCodesOf(sql, user.user_id);
  const canRelease = hasAnyReleaseRole(roles);
  const canRegister = roles.has('DC_AUTHOR');
  return {
    canRegister,
    canRelease,
    isAdmin: roles.has('DC_ADMIN'),
    isAuthorOnly: canRegister && !canRelease,
    // 3 vai: Tài liệu của tôi chỉ khi có Biên soạn (có DC_AUTHOR).
    canSeeMyDocuments: canRegister,
    isReadOnly: isReadOnlyUser(roles),
  };
}
