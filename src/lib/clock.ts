/**
 * src/lib/clock.ts — đồng hồ "ngày hôm nay" theo múi giờ Việt Nam.
 *
 * today() cũ dùng new Date().toISOString().slice(0,10) = ngày theo UTC, lệch
 * một ngày với giờ VN vào buổi tối (UTC+7). Mọi so sánh "ngày hiệu lực" /
 * "ngày áp dụng" phải theo lịch VN, nên dùng todayVN() thay cho today().
 *
 * Tham số now cho phép test biên (nửa đêm giờ VN) mà không giả lập hệ thống.
 */
export function todayVN(now: Date = new Date()): string {
  // 'en-CA' cho định dạng YYYY-MM-DD; timeZone quy về lịch Asia/Ho_Chi_Minh.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(now);
}
