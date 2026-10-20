# Implementation Plan

## Overview

Thay đổi tầng view + một bổ sung load dữ liệu ở route chi tiết. Không migration,
không đổi schema/quyền. Thứ tự: đổi nhãn trước (độc lập), rồi load receipts vào
route, rồi thêm panel site áp dụng, cuối cùng kiểm chứng + build.

## Tasks

- [x] 1. Đổi nhãn `issued_date` → "Ngày ban hành"
  - Sửa `src/views/register.eta`: nhãn ô `name="issued_date"` từ "Ngày áp dụng dự kiến" thành "Ngày ban hành".
  - Sửa `src/views/detail.eta`: `<dt>` của `d.issued_date` từ "Ngày áp dụng dự kiến" thành "Ngày ban hành".
  - Chạy `rg "Ngày áp dụng dự kiến" src/views` tìm chỗ còn sót; đổi đồng bộ nếu có.
  - KHÔNG đổi `name`/biến/route — chỉ chuỗi hiển thị.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 4.1, 4.2, 5.1, 5.2_

- [x] 2. Load receipts vào route chi tiết
  - Trong `src/routes/catalog.ts`, handler `GET /documents/:id`: import `listReceiptsForVersion` từ `../domain/receipt.js`.
  - Gộp `listReceiptsForVersion(sql, req.params.id)` vào `Promise.all` cùng `loadSections`/`loadLinks` (sau khi đã qua kiểm quyền `canViewVersion`).
  - Truyền `receipts` vào `reply.view('detail.eta', { ..., receipts })`.
  - KHÔNG đổi điều kiện quyền, mã 403/404, hay thứ tự kiểm quyền.
  - _Requirements: 3.1, 3.4, 5.2, 5.3_

- [x] 3. Thêm panel "Áp dụng theo site" vào trang chi tiết
  - Trong `src/views/detail.eta`, thêm một `<details class="detail-panel">` tiêu đề "Áp dụng theo site".
  - Nhúng `components/site-response-matrix.eta` với `receipts` + `receiptStatusLabel` + `receiptRejectTypeLabel`.
  - Khi `receipts` rỗng: ẩn panel hoặc để component hiện "Chưa phát hành tới site nào.".
  - KHÔNG thêm nút/hành động nào trong panel (chỉ đọc).
  - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6_

- [x] 4. Kiểm chứng thuộc tính đúng đắn (render test, không cần DB)
  - Render-check `detail.eta` cho 3 ca: receipts rỗng; site chap_nhan có apply_date + site cho_phan_hoi không apply_date; xác nhận nhãn "Ngày ban hành" xuất hiện.
  - Khẳng định P3 (apply_date chỉ cho site đã chấp nhận), P5 (rỗng an toàn), P2 (nhãn đúng nghĩa).
  - _Properties: 2, 3, 5_
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 5. Rà soát chuỗi cũ + nhất quán thuật ngữ
  - `rg "Ngày áp dụng dự kiến"` trên toàn bộ view -> phải 0 kết quả.
  - Đối chiếu 3 nhãn cố định: issued_date="Ngày ban hành", effective_date="Ngày có hiệu lực", apply_date="Ngày áp dụng".
  - _Properties: 1_
  - _Requirements: 2.1, 2.2, 4.1, 4.2_

- [x] 6. Biên dịch, build, chạy test, dọn dẹp
  - Compile toàn bộ `.eta`; `npm run build` sạch; chạy bộ test view hiện có (pass).
  - Xác nhận không ghi dữ liệu khi render chi tiết (đọc lại code route).
  - Dọn file tạm nếu có.
  - _Properties: 4, 6_
  - _Requirements: 5.1, 5.2, 5.3_

## Task Dependency Graph

Các "wave" chạy tuần tự; task trong cùng wave có thể làm song song.

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2"] },
    { "wave": 2, "tasks": ["3", "5"] },
    { "wave": 3, "tasks": ["4"] },
    { "wave": 4, "tasks": ["6"] }
  ],
  "dependencies": {
    "1": [],
    "2": [],
    "3": ["2"],
    "4": ["3"],
    "5": ["1"],
    "6": ["4", "5"]
  }
}
```

## Notes

- Không migration, không đổi schema/tên cột/route nghiệp vụ/điều kiện quyền.
- `listReceiptsForVersion` và `site-response-matrix.eta` đã tồn tại — tái dùng,
  không viết query/markup mới.
- Deploy target: pull + build + restart (cache-bust CSS sẵn có). Không migrate.
- Máy dev không có Postgres/trình duyệt: chỉ verify compile + render + build +
  test thuần; kiểm thị giác trên target.
