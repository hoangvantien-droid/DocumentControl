# Design Document

## Overview

Thay cách trả BusinessError từ "trang text trắng" sang "cảnh báo tại chỗ" bằng
một cơ chế CHUNG dựa htmx, để không phải viết lại 20 điểm rời rạc. Nguyên tắc:
- Thao tác POST có khả năng lỗi gửi qua htmx.
- Lỗi -> server trả FRAGMENT toast (HTML nhỏ) + HTTP status lỗi -> htmx chèn vào
  vùng toast toàn cục trên trang hiện tại.
- Thành công -> server báo điều hướng qua header HX-Redirect -> htmx tự chuyển.
Chỉ đổi tầng trình bày; quy tắc nghiệp vụ/mã lỗi/httpStatus giữ nguyên.

## Architecture

### Vùng toast toàn cục
- Thêm `<div id="toast-zone" class="toast-zone"></div>` vào layout.eta (cố định
  góc dưới-phải, trên mọi trang). htmx chèn fragment vào đây.

### Helper server dùng chung
- Thêm `src/lib/http-errors.ts` với 2 hàm:
  - `isHtmx(req)`: kiểm header `HX-Request: true`.
  - `sendBusinessError(req, reply, err)`: nếu htmx -> reply.code(status),
    trả fragment toast (tone error) chứa err.message; nếu KHÔNG htmx (fallback)
    -> trả trang có layout với alert-banner (không text trần).
  - `sendOk(reply, redirectTo)`: nếu htmx -> set header `HX-Redirect` +
    204; nếu không -> reply.redirect(redirectTo) như cũ.
- Các catch block hiện tại `if (isBusinessError(err)) { reply.code(...); reply.send(err.message); }`
  thay bằng `return sendBusinessError(req, reply, err);`

### Nút/form phía view
- Form POST có thể lỗi: thêm `hx-post` (hoặc giữ `method=post` + `hx-boost`),
  `hx-target="#toast-zone"`, `hx-swap="beforeend"`. Khi 2xx rỗng + HX-Redirect,
  htmx điều hướng. Khi 4xx, htmx (cấu hình) vẫn swap nội dung lỗi vào target.
- Cấu hình htmx cho phép swap khi mã lỗi: thêm
  `htmx.config.responseHandling` hoặc `hx-on::before-swap` để nhận 4xx.
  (htmx mặc định KHÔNG swap với 4xx/5xx — cần cho phép tường minh.)

## Components and Interfaces

- Tái dùng `components/toast.eta` (tone='error') làm fragment lỗi; đã tự ẩn 4s.
- `components/alert-banner.eta` dùng cho fallback trang-đầy-đủ (non-htmx).
- Route đổi: in (printing), thu hồi/receipt (receipts), report (issue-reports),
  đăng ký/sửa/xóa (documents), gói (packages), rà soát (reviews), quản trị
  (admin, functional-groups), auth. Mỗi catch -> sendBusinessError.

### Luồng "In" (ví dụ chính của người dùng)
1. Nút In POST qua htmx tới /documents/:id/print, target #toast-zone.
2. Nếu version chưa hiệu lực -> BusinessError -> fragment toast "Chỉ in được
   bản tài liệu đang hiệu lực" hiện góc màn, KHÔNG rời trang chi tiết.
3. Nếu OK -> server trả view print-result như cũ (in là thao tác CHUYỂN trang
   có chủ đích; với thao tác cần sang trang kết quả, dùng HX-Redirect tới trang
   đó, hoặc giữ submit thường + chỉ bọc lỗi bằng fallback trang có layout).

Ghi chú: thao tác mà THÀNH CÔNG cần sang trang mới (vd In -> print-result) có
hai lựa chọn: (a) htmx + HX-Redirect; (b) submit thường nhưng lỗi trả trang có
layout + alert thay vì text trần. Design ưu tiên (a) cho nút ở lại trang (thu
hồi, phản hồi, report) và chấp nhận (b) cho thao tác vốn chuyển trang.

## Data Models

Không đổi. BusinessError giữ nguyên cấu trúc (code/message/httpStatus).

## Error Handling

- BusinessError -> cảnh báo tại chỗ (htmx) hoặc trang có layout (fallback).
- Lỗi KHÔNG phải BusinessError -> vẫn ném ra, trả 500 như cũ (không che giấu).
- Fragment lỗi chỉ chứa err.message (đã tiếng Việt), không lộ stack.

## Testing Strategy

- Test thuần cho helper: isHtmx (đọc header), sendBusinessError chọn nhánh đúng
  theo header (fragment vs trang), sendOk set HX-Redirect.
- Compile mọi .eta sửa (layout + toast).
- Build tsc sạch; luồng thành công không hồi quy (kiểm bằng test route nếu có DB).
- Kiểm tay trên target: bấm In bản chưa hiệu lực -> toast hiện tại chỗ, không
  nhảy trang (ghi vào target notes).
