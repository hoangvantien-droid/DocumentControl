# Implementation Plan

## Overview

Tách nhãn/màu của trạng thái tranh_chap thành 2 mức (sai nội dung = nặng/đỏ; sai
đăng ký = nhẹ/amber) ở tầng hiển thị. Thêm helper `aggregateDisplay` dùng chung,
bổ sung cờ loại từ chối cho my-documents, cập nhật 2 view. Không migration.

## Tasks

- [x] 1. Helper `aggregateDisplay` trong labels.ts
  - Thêm `aggregateDisplay(aggregate, hasContentReject=false): { label, cls }` vào `src/views/labels.ts`.
  - tranh_chap + hasContentReject -> { 'Có site báo sai nội dung', 'status-thu_hoi' }; tranh_chap + !hasContentReject -> { 'Có site báo sai đăng ký', 'status-cho_xac_nhan' }.
  - Các trạng thái khác giữ nhãn như `aggregateStatusLabel` + lớp màu tương ứng (chua_phat_hanh/dang_cho/mot_phan -> status-da_ban_hanh; toan_bo -> status-hieu_luc).
  - GIỮ NGUYÊN `aggregateStatusLabel` cũ (tương thích ngược).
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 3.1, 3.2_
  - _Properties: 1, 2_

- [x] 2. Inject aggregateDisplay vào render layer
  - Trong `src/views/render.ts`, import + thêm `aggregateDisplay` vào object merged (cạnh aggregateStatusLabel) để mọi view gọi `it.aggregateDisplay(...)`.
  - _Requirements: 1.4_

- [x] 3. my-documents: cờ loại từ chối theo dòng
  - Trong `src/routes/documents.ts` (handler GET /my-documents), thêm vào truy vấn GROUP BY sẵn có cột: `count(r.*) FILTER (WHERE r.status = 'tu_choi' AND r.response_type = 'sai_noi_dung')::int AS content_rejected`.
  - Khi map `docs`: thêm `hasContentReject: d.content_rejected > 0`.
  - KHÔNG thêm truy vấn/vòng lặp DB mới.
  - _Requirements: 4.2, 3.5_

- [x] 4. Cập nhật 2 view dùng aggregateDisplay
  - `src/views/my-documents.eta` (ô Tình trạng ban hành): thay cách tính cls + aggregateStatusLabel bằng `var disp = it.aggregateDisplay(d.aggregate, d.hasContentReject); <span class="status <%= disp.cls %>"><%= disp.label %></span>`.
  - `src/views/issuance-status.eta` (dòng Trạng thái tổng hợp): thay bằng `var disp = it.aggregateDisplay(it.aggregate, it.hasContentReject); <span ...>`.
  - Không đổi phần còn lại; không dùng `<%# %>`.
  - _Requirements: 1.1, 1.2, 1.4, 2.2_

- [x] 5. Unit test aggregateDisplay
  - Thêm test tại `test/views/labels-receipt.test.ts` (hoặc file test labels phù hợp): tranh_chap+content -> nhãn sai nội dung + cls đỏ; tranh_chap+meta -> nhãn sai đăng ký + cls amber; toan_bo/mot_phan/dang_cho/chua_phat_hanh -> nhãn/cls cũ, bỏ qua cờ.
  - Chạy pass.
  - _Properties: 1, 2_
  - _Requirements: 1.1, 1.2, 2.1, 2.2_

- [x] 6. Render test 2 view (không DB)
  - Render my-documents.eta + issuance-status.eta cho 2 ca (content vs meta reject) -> nhãn + class đúng, nhất quán hai trang.
  - _Properties: 1, 4_
  - _Requirements: 1.4_

- [x] 7. Build, test, dọn dẹp
  - Compile .eta sạch; `npm run build` sạch; test view hiện có + test mới pass (xác nhận `aggregateStatusLabel` cũ không vỡ).
  - Xác nhận không migration, enum/aggregateStatusOf không đổi (đọc lại). Dọn file tạm.
  - _Properties: 3, 5_
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

## Task Dependency Graph

Các "wave" chạy tuần tự; task trong cùng wave có thể làm song song.

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "3"] },
    { "wave": 2, "tasks": ["2", "5"] },
    { "wave": 3, "tasks": ["4"] },
    { "wave": 4, "tasks": ["6"] },
    { "wave": 5, "tasks": ["7"] }
  ],
  "dependencies": {
    "1": [],
    "3": [],
    "2": ["1"],
    "5": ["1"],
    "4": ["2", "3"],
    "6": ["4"],
    "7": ["5", "6"]
  }
}
```

## Notes

- Không migration, không đổi enum/`aggregateStatusOf`/logic/quyền.
- Giữ `aggregateStatusLabel` cũ để không vỡ chỗ gọi khác + test.
- Tái dùng lớp CSS status sẵn có (status-thu_hoi đỏ, status-cho_xac_nhan amber,
  status-hieu_luc xanh). Chỉ thêm quy tắc CSS nếu màu chưa đạt.
- Máy dev không có Postgres: verify unit + render + build; kiểm màu trên target.
