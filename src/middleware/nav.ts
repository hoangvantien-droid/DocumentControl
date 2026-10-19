/**
 * src/middleware/nav.ts — dựng cờ hiển thị thực đơn theo vai trò (T-017).
 *
 * Thực đơn ẩn hẳn mục không có quyền (DCS-7 §1.2). Cờ dựa trên vai trò đang
 * active của người dùng. isAdmin theo Ver2: role DC_ADMIN.
 */
import type { Sql } from 'postgres';
import {
  roleCodesOf, isReadOnlyUser,
  isSiteDocControl, canReportIssue, siteIdsWithDocControl,
} from '../domain/permissions.js';
import { pendingReceiptCountForSites } from '../domain/receipt.js';
import type { SessionUser } from '../domain/session.js';

export interface NavFlags {
  canRegister: boolean;
  /** MỚI: vai Kiểm soát tài liệu site — hiện hàng chờ phản hồi + hộp report. */
  isSiteDocControl: boolean;
  /** MỚI: được gửi report bất thường (Reader + các vai đọc, trừ Admin-thuần). */
  canReport: boolean;
  isAdmin: boolean;
  /** Hiện "Tài liệu của tôi" cho người có vai Biên soạn. */
  canSeeMyDocuments: boolean;
  /** Người chỉ-xem (Reader): không đăng ký, không nhận-phản hồi, không quản trị. */
  isReadOnly: boolean;
  /** Tham gia luồng tài liệu (Author / DC Site / Reader). Admin-thuần = false:
   *  Admin đứng NGOÀI luồng, chỉ quản trị + master data. */
  inDocFlow: boolean;
  /** Số receipt đang chờ site phản hồi — badge cạnh mục 'Chờ site phản hồi'. */
  pendingReceipts: number;
}

export async function buildNav(sql: Sql, user: SessionUser | null): Promise<NavFlags> {
  if (!user) {
    return {
      canRegister: false, isSiteDocControl: false, canReport: false,
      isAdmin: false, canSeeMyDocuments: false, isReadOnly: true,
      inDocFlow: false, pendingReceipts: 0,
    };
  }
  const roles = await roleCodesOf(sql, user.user_id);
  const canRegister = roles.has('DC_AUTHOR');
  const siteDocControl = isSiteDocControl(roles);
  const isAdmin = roles.has('DC_ADMIN');
  const reader = roles.has('DC_READER');
  // Badge: đếm receipt chờ phản hồi của các site người dùng phụ trách (chỉ DC Site).
  let pendingReceipts = 0;
  if (siteDocControl) {
    const siteIds = [...await siteIdsWithDocControl(sql, user.user_id)];
    pendingReceipts = await pendingReceiptCountForSites(sql, siteIds);
  }
  // Admin-thuần (chỉ DC_ADMIN, không vai nghiệp vụ) đứng ngoài luồng tài liệu.
  const inDocFlow = canRegister || siteDocControl || reader;
  return {
    canRegister,
    isSiteDocControl: siteDocControl,
    canReport: canReportIssue(roles),
    isAdmin,
    canSeeMyDocuments: canRegister,
    isReadOnly: isReadOnlyUser(roles),
    inDocFlow,
    pendingReceipts,
  };
}
