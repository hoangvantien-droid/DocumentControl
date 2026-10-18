# Design Document

## Overview

Hai trục thay đổi, đều ở tầng trình bày (view + CSS + nhãn), không chạm
domain/schema:
1. Chuẩn hóa ngôn từ ISO 9001 (ưu tiên đúng thuật ngữ, rút gọn khi quá dài).
2. Responsive mobile cho mọi màn, dùng một cơ chế chung thay vì vá lẻ.

## Architecture

### Nhãn tập trung
- src/views/labels.ts là nguồn cho nhãn trạng thái/vai trò/phạm vi. Đổi chữ ở
  đây áp cho mọi màn; không đụng mã enum.
- Chuỗi tĩnh (tiêu đề, nút, legend, thông báo) nằm rải trong .eta — chỉnh trực
  tiếp theo bảng dưới.

### Cơ chế responsive dùng chung (KHÔNG lặp CSS từng bảng)
- Thêm class dùng chung `.responsive-table` (song song với `.data-table`): ở
  @media (max-width:768px) biến thead ẩn, mỗi tr thành thẻ, mỗi td hiển thị
  "data-label: value", chống tràn bằng overflow-wrap. Tái dùng pattern đã có ở
  `.catalog-table` nhưng tổng quát hóa thành 1 class áp cho mọi bảng.
- Mọi `<td>` PHẢI có thuộc tính `data-label="Tên cột"`.
- Form/panel: quy tắc @media chung cho input/select/textarea (rộng 100%, cao
  >=44px), lưới nhiều cột -> 1 cột, nút chính full-width cao >=44px.
- Breakpoint: 768px (khớp hiện có), bổ sung tinh chỉnh 480px nếu cần.

## Components and Interfaces

Danh sách màn áp responsive-table + rà ngôn từ:
- Bảng -> thẻ: my-documents, catalog (đã có, chuẩn hóa về class chung),
  site-receipts, issue-reports (card sẵn — giữ), reviews, packages, audit,
  admin/* (users, org, roles), functional-groups, search-results,
  component site-response-matrix.
- Form/panel: register, edit-metadata, author-recall, receipt-respond,
  issuance-status, detail (panel details), login, compare.

### Bảng chuỗi ISO 9001 (cũ -> mới, đã rút gọn)
| Màn/nhãn | Cũ | Mới |
|---|---|---|
| labels trạng thái | "Chờ xác nhận" | "Chờ xác nhận" (giữ) |
| receipt | "Chấp nhận nhận tài liệu" | "Xác nhận tiếp nhận" |
| detail nút | "In bản kiểm soát" | "In bản sao có kiểm soát" |
| print-result h1 | "Đã tạo bản in kiểm soát" | "Đã tạo bản sao có kiểm soát" |
| reviews h1 + menu | "Rà soát định kỳ" | "Xem xét định kỳ" |
| issue-reports h1 | "Báo bất thường từ người đọc" | "Báo bất thường (sự không phù hợp)" |
| detail nút | "Báo bất thường" | "Báo bất thường" (giữ, gọn) |
| detail/register | "Ngày hiệu lực" | "Ngày có hiệu lực" |
| register/detail | "phạm vi" (nhãn trường) | "phạm vi áp dụng" |
| catalog/my-docs cột | "Số hiệu" | "Số hiệu tài liệu" (nơi tiêu đề chính) |
| detail panel | "Áp dụng theo site" | "Phân phối có kiểm soát theo site" |
| receipt-respond | "Từ chối tài liệu" | "Từ chối tiếp nhận" |
| menu Gói ban hành | "Gói ban hành" | "Gói ban hành" (giữ) |

Nguyên tắc: chuỗi kỹ thuật nội bộ (vd "Bóc tách nội dung") giữ nguyên; chỉ
chuẩn hóa chuỗi người dùng nghiệp vụ đọc. Danh sách trên là khung; khi thực thi
sẽ áp nhất quán và bổ sung chuỗi phát sinh cùng loại.

## Data Models

Không thay đổi. Chỉ đọc; nhãn ánh xạ từ mã enum sẵn có.

## Error Handling

- Nhãn: mã lạ -> trả chính mã (đã có trong labels.ts).
- View: mọi .eta phải compile; kiểm bằng eta.compile trước khi coi là xong.

## Testing Strategy

- Test thuần labels (labels-receipt.test.ts mở rộng): khóa nhãn ISO mới.
- Compile-check mọi .eta sửa.
- Build tsc sạch.
- Kiểm thị giác responsive: không chạy browser ở máy dev; ghi vào target notes
  để kiểm tay ở <=768px. Dùng cơ chế chung nên rủi ro thấp.
- Không hồi quy: route/quyền giữ nguyên (chỉ sửa view/css/labels).
