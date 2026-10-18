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

// ============================================================================
// Hàm quyết định quyền THUẦN (không chạm DB) — tách để kiểm thử đơn vị và dùng
// lại trong các hàm async bên dưới. Nguồn vào là TẬP MÃ VAI TRÒ đang active và
// phạm vi (scope). 3 vai: Admin / Biên soạn (DC_AUTHOR) / Phê duyệt (DC_DEPT_HEAD).
// ============================================================================

/** Người chỉ-xem: không đăng ký, không nhận-phản hồi, không quản trị.
 * Mô hình mới: DC_SITE_DOC_CONTROL cũng là vai nghiệp vụ (không read-only).
 * Giữ DC_DEPT_HEAD trong phép kiểm cho dữ liệu lịch sử còn active. */
export function isReadOnlyUser(roleCodes: Set<string>): boolean {
  const canRegister = roleCodes.has('DC_AUTHOR');
  const isSiteDocControl = roleCodes.has('DC_SITE_DOC_CONTROL');
  const isAdmin = roleCodes.has('DC_ADMIN');
  const legacyRelease = roleCodes.has('DC_DEPT_HEAD');
  return !canRegister && !isSiteDocControl && !isAdmin && !legacyRelease;
}

/**
 * Tập trạng thái tài liệu người xem được phép thấy trong danh mục.
 * - Người chỉ-xem (Reader): CHỈ tài liệu hiện hành (đang áp dụng / đã xác nhận
 *   chờ hiệu lực). Không thấy bản lỗi thời, thu hồi, nháp, chờ.
 * - Người có vai nghiệp vụ (Biên soạn/Phê duyệt/Admin): null = không giới hạn
 *   trạng thái (để tra cứu lịch sử bản lỗi thời).
 *
 * Re-export từ lifecycle-status (nguồn duy nhất) để không lặp danh sách mã.
 */
export { CURRENT_VIEW_STATUSES } from './lifecycle-status.js';
import { CURRENT_VIEW_STATUSES } from './lifecycle-status.js';

export function allowedStatusesForViewer(roleCodes: Set<string>): readonly string[] | null {
  return isReadOnlyUser(roleCodes) ? CURRENT_VIEW_STATUSES : null;
}

/** Phạm vi suy từ Dept chính của người dùng (để kiểm quyền release không-group). */
export interface UserScopeRef {
  dept_id: string | null;
  site_id: string | null;
  bu_ids: string[];
}

/**
 * Quyết định quyền release THUẦN theo 3 vai + phạm vi, không chạm DB.
 * - Phải có cờ Phê duyệt (DC_DEPT_HEAD hoặc DC_ADMIN) mới xét tiếp.
 * - Tài liệu cấp 'group' (toàn tập đoàn): CHỈ DC_ADMIN. Siết leo thang quyền —
 *   migration 013 gộp các vai duyệt cũ (Site QA/BU/Group owner) thành
 *   DC_DEPT_HEAD@group; nếu cho DC_DEPT_HEAD duyệt group thì mọi người từng là
 *   Site QA sẽ duyệt được tài liệu toàn tập đoàn (ngoài ý muốn).
 * - Các cấp bu/site/dept: khớp đúng phạm vi suy từ Dept chính, không kế thừa chéo.
 */
export function canUserRelease(
  roleCodes: Set<string>,
  doc: DocScope,
  userScope: UserScopeRef,
): boolean {
  const isAdmin = roleCodes.has('DC_ADMIN');
  const hasReleaseFlag = roleCodes.has('DC_DEPT_HEAD') || isAdmin;
  if (!hasReleaseFlag) return false;

  // Admin duyệt được mọi phạm vi, kể cả tài liệu toàn tập đoàn.
  if (isAdmin) return true;

  if (doc.scope_level === 'group') {
    // Chỉ Admin (đã trả true ở trên). DC_DEPT_HEAD@group KHÔNG duyệt được group.
    return false;
  }
  if (doc.scope_level === 'dept') {
    return !!userScope.dept_id && userScope.dept_id === doc.scope_dept_id;
  }
  if (doc.scope_level === 'site') {
    return !!userScope.site_id && userScope.site_id === doc.scope_site_id;
  }
  if (doc.scope_level === 'bu') {
    return !!doc.scope_bu_id && userScope.bu_ids.includes(doc.scope_bu_id);
  }
  return false;
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

/**
 * Kiểm quyền release 3 vai (async): đọc role + Dept chính từ DB rồi giao cho hàm
 * thuần canUserRelease quyết định. Tài liệu cấp group CHỈ Admin (chống leo thang
 * sau migration 013); bu/site/dept khớp Dept chính, không kế thừa chéo.
 */
export async function canRelease(
  sql: Sql,
  userId: string,
  doc: DocScope,
): Promise<boolean> {
  const roles = await roleCodesOf(sql, userId);
  if (!hasAnyReleaseRole(roles)) return false;
  // Admin không cần Dept chính; tránh truy vấn thừa.
  if (roles.has('DC_ADMIN')) return true;
  const scope = await getUserScope(sql, userId);
  return canUserRelease(roles, doc, scope);
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

/** (LEGACY) cờ vai duyệt-trước cũ — còn vài route cũ gọi; Task 9 gỡ. */
export function hasAnyReleaseRole(roleCodes: Set<string>): boolean {
  return roleCodes.has('DC_DEPT_HEAD') || roleCodes.has('DC_ADMIN');
}

// ============================================================================
// MÔ HÌNH RECEIPT MỚI — kiểm quyền "bên nhận phản hồi" (DC Site) và report.
// Nguyên tắc: Admin ĐỨNG NGOÀI luồng tài liệu (không phản hồi/report thay).
// Kiểm quyền ở tầng domain, không tin route (DCS-8 §4.3).
// ============================================================================

/** Có phải vai Kiểm soát tài liệu site không (bất kể site nào). */
export function isSiteDocControl(roleCodes: Set<string>): boolean {
  return roleCodes.has('DC_SITE_DOC_CONTROL');
}

/**
 * Tập site_id mà người dùng giữ vai DC_SITE_DOC_CONTROL (đang active).
 * Dùng để lọc hàng chờ phản hồi và kiểm quyền từng receipt.
 */
export async function siteIdsWithDocControl(sql: Sql, userId: string): Promise<Set<string>> {
  const rows = await sql<{ scope_site_id: string | null }[]>`
    SELECT scope_site_id FROM user_roles
     WHERE user_id = ${userId} AND is_active
       AND role_code = 'DC_SITE_DOC_CONTROL'
       AND scope_site_id IS NOT NULL`;
  return new Set(rows.map((r) => r.scope_site_id!).filter(Boolean));
}

/**
 * Quyền phản hồi (chấp nhận/từ chối) receipt của MỘT site — hàm THUẦN.
 * - Phải giữ DC_SITE_DOC_CONTROL ở ĐÚNG site của receipt.
 * - Admin KHÔNG được (đứng ngoài luồng tài liệu).
 */
export function canRespondReceiptPure(
  docControlSiteIds: Set<string>,
  receiptSiteId: string,
): boolean {
  return docControlSiteIds.has(receiptSiteId);
}

/** Quyền phản hồi receipt của một site (async): đọc site từ DB rồi giao hàm thuần. */
export async function canRespondReceipt(
  sql: Sql,
  userId: string,
  receiptSiteId: string,
): Promise<boolean> {
  const siteIds = await siteIdsWithDocControl(sql, userId);
  return canRespondReceiptPure(siteIds, receiptSiteId);
}

/**
 * Quyền gửi report bất thường: bất kỳ người dùng đã đăng nhập có thể ĐỌC tài
 * liệu đều báo được (Reader là trường hợp chính). Admin đứng ngoài luồng nên
 * không report. Ở đây giữ đơn giản: không phải Admin-thuần là report được;
 * kiểm phạm vi đọc cụ thể để tầng route/ catalog xử lý.
 */
export function canReportIssue(roleCodes: Set<string>): boolean {
  // Admin-thuần (chỉ DC_ADMIN, không vai nghiệp vụ khác) đứng ngoài luồng.
  const onlyAdmin = roleCodes.has('DC_ADMIN') && roleCodes.size === 1;
  return !onlyAdmin;
}
