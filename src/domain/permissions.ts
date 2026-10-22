/**
 * src/domain/permissions.ts — kiểm quyền mô hình 4 vai (receipt).
 *
 * Vai: Admin (quản trị, ngoài luồng tài liệu) / Author (biên soạn) /
 * DC_SITE_DOC_CONTROL (nhận & phản hồi theo site) / Reader (đọc theo scope).
 * Vai duyệt-trước cũ (DC_DEPT_HEAD + Site QA/BU/Group owner) đã gỡ.
 * Kiểm quyền đặt ở tầng domain, không tin route (DCS-8 §4.3).
 */
import type { Sql } from 'postgres';

// Trạng thái hiện hành dùng chung nguồn duy nhất lifecycle-status.
export { CURRENT_VIEW_STATUSES } from './lifecycle-status.js';
import { CURRENT_VIEW_STATUSES } from './lifecycle-status.js';

/** Người chỉ-xem (Reader): không đăng ký, không nhận-phản hồi, không quản trị. */
export function isReadOnlyUser(roleCodes: Set<string>): boolean {
  const canRegister = roleCodes.has('DC_AUTHOR');
  const siteDocControl = roleCodes.has('DC_SITE_DOC_CONTROL');
  const isAdmin = roleCodes.has('DC_ADMIN');
  return !canRegister && !siteDocControl && !isAdmin;
}

/**
 * Tập trạng thái Reader được phép thấy. Reader -> chỉ tài liệu hiện hành;
 * vai nghiệp vụ -> null (không giới hạn, xem cả lịch sử).
 */
export function allowedStatusesForViewer(roleCodes: Set<string>): readonly string[] | null {
  return isReadOnlyUser(roleCodes) ? CURRENT_VIEW_STATUSES : null;
}

export async function canRegisterDocuments(sql: Sql, userId: string): Promise<boolean> {
  const rows = await sql<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM user_roles
       WHERE user_id = ${userId} AND is_active AND role_code = 'DC_AUTHOR'
    ) AS ok`;
  return rows[0]?.ok ?? false;
}

export async function hasSystemAdminAccess(sql: Sql, userId: string): Promise<boolean> {
  const rows = await sql<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM user_roles
       WHERE user_id = ${userId} AND role_code = 'DC_ADMIN' AND is_active
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

// ============================================================================
// Mô hình receipt: quyền "bên nhận phản hồi" (DC Site) và report.
// Admin ĐỨNG NGOÀI luồng tài liệu (không phản hồi/report thay).
// ============================================================================

/** Có phải vai Kiểm soát tài liệu site không (bất kể site nào). */
export function isSiteDocControl(roleCodes: Set<string>): boolean {
  return roleCodes.has('DC_SITE_DOC_CONTROL');
}

/** Được xuất danh mục Excel = vai Author HOẶC SiteDocControl. */
export function canExportCatalog(roleCodes: Set<string>): boolean {
  return roleCodes.has('DC_AUTHOR') || isSiteDocControl(roleCodes);
}

/** Tham gia luồng tài liệu = Author / DC Site / Reader. Admin-thuần đứng ngoài. */
export function isDocFlowRoles(roleCodes: Set<string>): boolean {
  return roleCodes.has('DC_AUTHOR')
    || roleCodes.has('DC_SITE_DOC_CONTROL')
    || roleCodes.has('DC_READER');
}

export async function isDocFlowUser(sql: Sql, userId: string): Promise<boolean> {
  return isDocFlowRoles(await roleCodesOf(sql, userId));
}

/** Tập site_id mà người dùng giữ vai DC_SITE_DOC_CONTROL (đang active). */
export async function siteIdsWithDocControl(sql: Sql, userId: string): Promise<Set<string>> {
  const rows = await sql<{ scope_site_id: string | null }[]>`
    SELECT scope_site_id FROM user_roles
     WHERE user_id = ${userId} AND is_active
       AND role_code = 'DC_SITE_DOC_CONTROL'
       AND scope_site_id IS NOT NULL`;
  return new Set(rows.map((r) => r.scope_site_id!).filter(Boolean));
}

/** Quyền phản hồi receipt của MỘT site — thuần. DC Site đúng site; Admin KHÔNG. */
export function canRespondReceiptPure(docControlSiteIds: Set<string>, receiptSiteId: string): boolean {
  return docControlSiteIds.has(receiptSiteId);
}

/** Quyền phản hồi receipt (async). */
export async function canRespondReceipt(sql: Sql, userId: string, receiptSiteId: string): Promise<boolean> {
  return canRespondReceiptPure(await siteIdsWithDocControl(sql, userId), receiptSiteId);
}

/** Quyền gửi report bất thường: mọi vai đọc được, trừ Admin-thuần. */
export function canReportIssue(roleCodes: Set<string>): boolean {
  const onlyAdmin = roleCodes.has('DC_ADMIN') && roleCodes.size === 1;
  return !onlyAdmin;
}
