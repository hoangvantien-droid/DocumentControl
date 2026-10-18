/**
 * src/domain/lifecycle-status.ts — NGUỒN DUY NHẤT về trạng thái vòng đời tài
 * liệu và khái niệm "hiện hành" (điểm 9 của kế hoạch).
 *
 * Trước đây danh sách trạng thái "hiện hành" bị lặp ở nhiều nơi
 * (permissions.CURRENT_VIEW_STATUSES, catalog.CURRENT_DOC_STATUSES/isCurrentStatus).
 * Đổi vòng đời mà sửa rải rác dễ bỏ sót. Gom về đây; các module khác re-export
 * hoặc gọi helper, KHÔNG tự liệt kê mã trạng thái.
 *
 * Mô hình mới:
 *   - da_ban_hanh  : Author đăng ký, ban hành thẳng. ĐÂY là trạng thái "hiện
 *                    hành" chính (tài liệu đang có hiệu lực để site nhận xem/
 *                    phản hồi/áp dụng).
 *   - thu_hoi      : đã thu hồi — KHÔNG hiện hành.
 *   - het_hieu_luc : bị phiên bản mới thay thế — KHÔNG hiện hành.
 *   - cho_hoan_thien: nháp — KHÔNG hiện hành.
 * Các mã cũ (hieu_luc, da_dang_ky) được coi là hiện hành trong giai đoạn chuyển
 * đổi để dữ liệu/đường dẫn cũ không vỡ; Task 9 dọn khi không còn tham chiếu.
 */

/** Trạng thái phiên bản trong mô hình mới. */
export type VersionStatus =
  | 'cho_hoan_thien'
  | 'da_ban_hanh'
  | 'thu_hoi'
  | 'het_hieu_luc'
  // Mã cũ — giữ tạm cho giai đoạn chuyển đổi (Task 9 dọn).
  | 'cho_xac_nhan'
  | 'tu_choi'
  | 'da_dang_ky'
  | 'hieu_luc';

/**
 * Tập trạng thái được coi là "hiện hành" — người chỉ-xem (Reader) được phép
 * thấy, và là tài liệu đang có hiệu lực để site nhận xử lý.
 * Thứ tự: mã mới trước, mã cũ (tương thích) sau.
 */
export const CURRENT_VIEW_STATUSES = ['da_ban_hanh', 'hieu_luc', 'da_dang_ky'] as const;

/** Trạng thái này có được coi là tài liệu hiện hành không. */
export function isCurrentlyEffective(status: string | null | undefined): boolean {
  if (!status) return false;
  return (CURRENT_VIEW_STATUSES as readonly string[]).includes(status);
}

/** Trạng thái receipt của một site đối với một phiên bản. */
export type ReceiptStatus = 'cho_phan_hoi' | 'chap_nhan' | 'tu_choi';

/** Loại từ chối của site — quyết định cách Author khắc phục. */
export type ReceiptRejectType = 'sai_dang_ky' | 'sai_noi_dung';

/** Trạng thái report bất thường của Reader. */
export type IssueReportStatus = 'moi' | 'chuyen_phan_hoi' | 'bac_bo';

/**
 * Trạng thái TỔNG HỢP ở mức phiên bản, suy từ tập receipt của nó:
 *   - chua_phat_hanh : chưa có receipt nào (chưa ban hành tới site).
 *   - dang_cho       : có receipt nhưng chưa site nào phản hồi.
 *   - mot_phan       : đã có ≥1 site chấp nhận, còn site khác chờ.
 *   - tranh_chap     : có ≥1 site từ chối (cần Author xử lý).
 *   - toan_bo        : mọi site đã chấp nhận.
 */
export type AggregateStatus =
  | 'chua_phat_hanh'
  | 'dang_cho'
  | 'mot_phan'
  | 'tranh_chap'
  | 'toan_bo';

/** Tóm tắt tập receipt để suy trạng thái tổng hợp (thuần, không chạm DB). */
export interface ReceiptTally {
  total: number;
  accepted: number;
  rejected: number;
  pending: number;
}

/**
 * Suy trạng thái tổng hợp từ số liệu receipt. Ưu tiên "tranh_chap" khi có bất
 * kỳ từ chối nào — vì đó là tín hiệu cần Author xử lý, quan trọng hơn việc một
 * phần site đã chấp nhận.
 */
export function aggregateStatusOf(t: ReceiptTally): AggregateStatus {
  if (t.total === 0) return 'chua_phat_hanh';
  if (t.rejected > 0) return 'tranh_chap';
  if (t.accepted === t.total) return 'toan_bo';
  if (t.accepted > 0) return 'mot_phan';
  return 'dang_cho';
}
