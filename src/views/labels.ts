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
  cho_xac_nhan: 'Chờ xác nhận',
  tu_choi: 'Bị trả lại',
  da_dang_ky: 'Đã xác nhận, chờ hiệu lực',
  hieu_luc: 'Đang hiệu lực',
  het_hieu_luc: 'Hết hiệu lực',
  thu_hoi: 'Đã thu hồi',
};

/**
 * Vai trò (mã -> nhãn 3 vai người dùng thấy). Mô hình 3 vai: Admin / Biên soạn /
 * Phê duyệt. Các mã cũ (đã gộp ở migration 013) ánh xạ về nhãn tương ứng để
 * bảng dữ liệu lịch sử vẫn đọc được, không lộ mã kỹ thuật.
 */
export const ROLE_LABELS: Record<string, string> = {
  DC_ADMIN: 'Admin — Quản trị hệ thống',
  DC_AUTHOR: 'Biên soạn — Đăng ký tài liệu',
  DC_DEPT_HEAD: 'Phê duyệt — Xác nhận theo Dept chính',
  DC_READER: 'Người đọc',
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

/** Nhãn vai trò 3 vai. Mã lạ/thiếu thì trả về chính mã. */
export function roleLabel(code: string | null | undefined): string {
  if (!code) return '';
  return ROLE_LABELS[code] ?? code;
}
