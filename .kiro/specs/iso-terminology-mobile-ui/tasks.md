# Implementation Plan

## Overview

Chuẩn hóa ngôn từ ISO 9001 + responsive mobile cho mọi màn. Task 1-2 là nền
(CSS chung + nhãn tập trung); Task 3-9 áp cho từng nhóm màn; Task 10 kiểm tổng.
Chỉ sửa view/CSS/labels — không chạm domain/schema.

## Task Dependency Graph

- Task 1 (CSS chung) và Task 2 (nhãn) độc lập, làm trước.
- Task 3-9 phụ thuộc Task 1 + Task 2 (dùng class chung + nhãn mới).
- Task 10 phụ thuộc toàn bộ 1-9.

```json
{
  "waves": [
    {
      "wave": 1,
      "tasks": [
        "1",
        "2"
      ]
    },
    {
      "wave": 2,
      "tasks": [
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9"
      ]
    },
    {
      "wave": 3,
      "tasks": [
        "10"
      ]
    }
  ]
}
```

## Tasks

- [x] 1. CSS responsive-table dùng chung + quy tắc form/nút mobile
  - Thêm class `.responsive-table` (card ở <=768px) tổng quát từ `.catalog-table`;
    quy tắc chung input/select/textarea (100%, >=44px), lưới->1 cột, nút chính
    full-width; chống tràn ngang.
  - _Requirements: 3, 4, 5_

- [x] 2. Chuẩn hóa nhãn ISO trong labels.ts + test
  - Cập nhật RECEIPT/ROLE/… theo bảng chuỗi (xác nhận tiếp nhận, v.v.); mở rộng
    labels-receipt.test.ts khóa nhãn mới.
  - _Requirements: 1_

- [x] 3. my-documents -> thẻ mobile + ngôn từ
  - Áp responsive-table + data-label; chuẩn hóa tiêu đề/cột theo ISO.
  - _Requirements: 2, 3_

- [x] 4. catalog + search-results -> class chung + ngôn từ
  - Chuyển catalog-table sang responsive-table; search-results thành thẻ;
    nhãn "Số hiệu tài liệu", "phạm vi áp dụng", "Ngày có hiệu lực".
  - _Requirements: 2, 3_

- [x] 5. site-receipts + receipt-respond + issue-reports -> mobile + ngôn từ
  - Bảng/thẻ; "Xác nhận tiếp nhận", "Từ chối tiếp nhận"; form vừa màn.
  - _Requirements: 2, 3, 4_

- [x] 6. issuance-status + site-response-matrix + detail -> mobile + ngôn từ
  - Ma trận site thành thẻ; panel detail 1 cột; "In bản sao có kiểm soát",
    "Phân phối có kiểm soát theo site".
  - _Requirements: 2, 3, 4_

- [x] 7. register + edit-metadata + author-recall -> form mobile + ngôn từ
  - Form vừa màn hẹp; chuẩn hóa legend/nhãn trường/nút.
  - _Requirements: 2, 4, 5_

- [x] 8. reviews + packages + admin/* + functional-groups + audit -> mobile + ngôn từ
  - Áp responsive-table cho các bảng còn lại; "Xem xét định kỳ"; rà nhãn.
  - _Requirements: 2, 3_

- [x] 9. home + login + compare + print-result + verify + layout menu -> ngôn từ + mobile
  - Rà chuỗi còn lại; "Đã tạo bản sao có kiểm soát"; menu "Xem xét định kỳ".
  - _Requirements: 2, 4_

- [x] 10. Kiểm tổng + chống hồi quy
  - tsc sạch; compile mọi .eta sửa; test thuần xanh; cập nhật target notes mục
    kiểm thị giác responsive <=768px.
  - _Requirements: 6, 7_


## Notes

- Kiểm thị giác responsive (<=768px) không chạy được ở máy dev (không browser);
  ghi vào docs/TARGET-VERIFICATION-NOTES.md để kiểm tay trên target.
- Mỗi task: tsc build sạch + eta.compile các view sửa trước khi coi là xong.
- Không đổi enum/mã nghiệp vụ; chỉ chữ hiển thị.
