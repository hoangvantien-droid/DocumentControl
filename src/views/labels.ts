/**
 * src/views/labels.ts — Nguồn duy nhất ánh xạ mã nghiệp vụ -> nhãn tiếng Việt.
 *
 * Mọi view phải phân giải mã trạng thái tài liệu và cấp phạm vi qua đây, không
 * in thẳng mã enum ra giao diện. Trộn các hàm này vào dữ liệu kết xuất Eta
 * (render.ts + scripts/preview.mjs) để gọi trong template dạng
 * it.docStatusLabel(code) / it.scopeLabel(level).
 *
 * CHỈ đổi chữ hiển thị — KHÔNG đổi giá trị enum, name/value form hay mã nghiệp vụ.
 */

/** Trạng thái tài liệu (mã enum -> nhãn người dùng thấy). */
export const DOC_STATUS_LABELS: Record<string, string> = {
  cho_hoan_thien: 'Nháp chờ hoàn thiện',
  da_ban_hanh: 'Đã ban hành',
  het_hieu_luc: 'Hết hiệu lực',
  thu_hoi: 'Đã thu hồi',
  // --- mã cũ, giữ nhãn cho dữ liệu/giai đoạn chuyển đổi ---
  cho_xac_nhan: 'Chờ xác nhận',
  tu_choi: 'Bị trả lại',
  da_dang_ky: 'Đã xác nhận, chờ hiệu lực',
  hieu_luc: 'Đang hiệu lực',
};

/** Trạng thái receipt của site (mã -> nhãn). */
export const RECEIPT_STATUS_LABELS: Record<string, string> = {
  cho_phan_hoi: 'Chờ phản hồi',
  chap_nhan: 'Đã chấp nhận',
  tu_choi: 'Đã từ chối',
};

/** Loại từ chối của site (mã -> nhãn). */
export const RECEIPT_REJECT_TYPE_LABELS: Record<string, string> = {
  sai_dang_ky: 'Sai thông tin đăng ký',
  sai_noi_dung: 'Sai nội dung tài liệu',
};

/** Trạng thái report bất thường của Reader (mã -> nhãn). */
export const ISSUE_REPORT_STATUS_LABELS: Record<string, string> = {
  moi: 'Mới — chờ xem xét',
  chuyen_phan_hoi: 'Đã chuyển thành phản hồi',
  bac_bo: 'Đã bác bỏ',
};

/** Trạng thái tổng hợp mức phiên bản (mã -> nhãn). */
export const AGGREGATE_STATUS_LABELS: Record<string, string> = {
  chua_phat_hanh: 'Chưa phát hành',
  dang_cho: 'Đang chờ phản hồi',
  mot_phan: 'Một phần đã áp dụng',
  tranh_chap: 'Có site báo sai sót',
  toan_bo: 'Toàn bộ đã áp dụng',
};

/**
 * Vai trò (mã -> nhãn 3 vai người dùng thấy). Mô hình 3 vai: Admin / Biên soạn /
 * Phê duyệt. Các mã cũ (đã gộp ở migration 013) ánh xạ về nhãn tương ứng để
 * bảng dữ liệu lịch sử vẫn đọc được, không lộ mã kỹ thuật.
 */
export const ROLE_LABELS: Record<string, string> = {
  DC_ADMIN: 'Quản trị hệ thống',
  DC_AUTHOR: 'Biên soạn tài liệu',
  DC_SITE_DOC_CONTROL: 'Kiểm soát tài liệu (site)',
  DC_READER: 'Người đọc',
  // Vai cũ (gác cổng nguồn) — giữ nhãn cho dữ liệu lịch sử, không gán mới.
  DC_DEPT_HEAD: 'Phê duyệt (vai cũ: theo Dept chính)',
  // Vai cũ (không còn gán mới; giữ nhãn để hiển thị dữ liệu lịch sử).
  DC_SITE_QA_MANAGER: 'Phê duyệt (vai cũ: QA Site)',
  DC_BU_OWNER: 'Phê duyệt (vai cũ: Chủ BU)',
  DC_GROUP_OWNER: 'Phê duyệt (vai cũ: Chủ Group)',
};

/** Cấp phạm vi (mã enum -> nhãn người dùng thấy). */
export const SCOPE_LABELS: Record<string, string> = {
  group: 'Toàn Tập đoàn',
  bu: 'Khối (BU)',
  site: 'Nhà máy / Chi nhánh',
  dept: 'Phòng/Ban',
  department: 'Phòng/Ban',
};

/**
 * Nhãn trạng thái tài liệu. Mã lạ/thiếu thì trả về chính mã (an toàn, không vỡ
 * giao diện) để lộ ra sớm trong kiểm thử thay vì chuỗi rỗng.
 */
export function docStatusLabel(code: string | null | undefined): string {
  if (!code) return '';
  return DOC_STATUS_LABELS[code] ?? code;
}

/** Nhãn cấp phạm vi. Mã lạ/thiếu thì trả về chính mã. */
export function scopeLabel(level: string | null | undefined): string {
  if (!level) return '';
  return SCOPE_LABELS[level] ?? level;
}

/** Nhãn vai trò. Mã lạ/thiếu thì trả về chính mã. */
export function roleLabel(code: string | null | undefined): string {
  if (!code) return '';
  return ROLE_LABELS[code] ?? code;
}

/** Nhãn trạng thái receipt của site. Mã lạ/thiếu thì trả về chính mã. */
export function receiptStatusLabel(code: string | null | undefined): string {
  if (!code) return '';
  return RECEIPT_STATUS_LABELS[code] ?? code;
}

/** Nhãn loại từ chối của site. Mã lạ/thiếu thì trả về chính mã. */
export function receiptRejectTypeLabel(code: string | null | undefined): string {
  if (!code) return '';
  return RECEIPT_REJECT_TYPE_LABELS[code] ?? code;
}

/** Nhãn trạng thái report bất thường. Mã lạ/thiếu thì trả về chính mã. */
export function issueReportStatusLabel(code: string | null | undefined): string {
  if (!code) return '';
  return ISSUE_REPORT_STATUS_LABELS[code] ?? code;
}

/** Nhãn trạng thái tổng hợp mức phiên bản. Mã lạ/thiếu thì trả về chính mã. */
export function aggregateStatusLabel(code: string | null | undefined): string {
  if (!code) return '';
  return AGGREGATE_STATUS_LABELS[code] ?? code;
}
