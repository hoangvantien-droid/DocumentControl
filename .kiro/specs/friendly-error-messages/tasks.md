# Implementation Plan

## Overview

Chuẩn hóa hiển thị lỗi nghiệp vụ: cảnh báo tại chỗ (toast qua htmx) thay cho
trang text trắng. Task 1-2 là nền (helper + vùng toast + cấu hình htmx); Task
3-7 áp cho từng nhóm route/nút; Task 8 kiểm tổng. Chỉ đổi tầng trình bày lỗi.

## Task Dependency Graph

- Task 1 (helper http-errors) và Task 2 (toast-zone + htmx config) là nền.
- Task 3-7 phụ thuộc 1+2.
- Task 8 phụ thuộc toàn bộ.

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2"] },
    { "wave": 2, "tasks": ["3", "4", "5", "6", "7"] },
    { "wave": 3, "tasks": ["8"] }
  ]
}
```

## Tasks

- [x] 1. Helper http-errors + test
  - src/lib/http-errors.ts: isHtmx, sendBusinessError (htmx->fragment toast;
    non-htmx->trang layout+alert), sendOk (HX-Redirect). Test thuần chọn nhánh.
  - _Requirements: 1, 2, 5_

- [x] 2. Vùng toast toàn cục + cấu hình htmx nhận 4xx
  - layout.eta: #toast-zone; cho phép htmx swap với mã lỗi (hx-on::before-swap
    hoặc config). CSS toast-zone cố định, mobile-friendly.
  - _Requirements: 1, 4_

- [x] 3. In tài liệu (printing) -> cảnh báo tại chỗ
  - Nút In qua htmx target #toast-zone; lỗi "chưa hiệu lực" hiện toast; thành
    công sang print-result qua HX-Redirect.
  - _Requirements: 1, 2, 3_

- [x] 4. Thu hồi bản in + phản hồi receipt (receipts, catalog print/recall)
  - Nút thu hồi bản in, accept/reject receipt -> toast tại chỗ, ở lại trang.
  - _Requirements: 1, 2, 3_

- [x] 5. Báo bất thường + thẩm định (issue-reports)
  - report / convert / dismiss -> toast tại chỗ.
  - _Requirements: 1, 2, 3_

- [x] 6. Author: đăng ký/sửa/thu hồi/xóa (documents)
  - 6 điểm BusinessError -> sendBusinessError; giữ luồng thành công.
  - _Requirements: 1, 2, 3, 5_

- [x] 7. Gói/rà soát/quản trị/auth (packages, reviews, admin, functional-groups, auth)
  - Thay mọi reply.send(err.message) còn lại bằng sendBusinessError.
  - _Requirements: 3, 5_

- [x] 8. Kiểm tổng + chống hồi quy
  - tsc sạch; compile .eta; test helper xanh; rà không còn reply.send(err.message)
    text trần; cập nhật target notes (kiểm tay toast tại chỗ).
  - _Requirements: 5_

## Notes

- htmx mặc định KHÔNG swap với 4xx/5xx — phải bật tường minh ở Task 2.
- Thao tác thành công cần sang trang mới: dùng HX-Redirect (ưu tiên) hoặc
  fallback trang layout. Lỗi hệ thống (không phải BusinessError) vẫn trả 500.
- Kiểm thị giác toast không chạy được ở máy dev (không browser); ghi target notes.
