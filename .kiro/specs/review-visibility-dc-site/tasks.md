# Implementation Plan

## Overview

Cho DC Site thấy bảng nhắc xem xét định kỳ (chỉ-đọc) theo site, trên trang
/reviews dùng chung. Thêm hàm domain lọc theo site, mở menu + route cho DC Site,
bảng read-only trong view. Không migration; kết luận rà soát không đổi.

## Tasks

- [x] 1. Domain `reviewBacklogForSites`
  - Trong `src/domain/review.ts`, thêm `reviewBacklogForSites(sql, siteIds: string[]): Promise<ReviewRow[]>`.
  - siteIds rỗng -> trả []. Mirror `reviewBacklogForOwner` nhưng điều kiện: EXISTS document_receipt r WHERE r.version_id = p.version_id AND r.site_id = ANY(siteIds::uuid[]).
  - Trả cùng kiểu ReviewRow.
  - _Requirements: 2.1, 2.5, 5.2_
  - _Properties: 2_

- [x] 2. Route GET /reviews: nhánh DC Site
  - Trong `src/routes/reviews.ts`, GET `/reviews`: giữ requireDocFlow + nhánh Author (reviewBacklogForOwner -> active/pending) như cũ.
  - Thêm nhánh DC Site: nếu `req.nav.isSiteDocControl` -> `siteIds = [...await siteIdsWithDocControl(sql, user.user_id)]` -> `siteReminders = await reviewBacklogForSites(sql, siteIds)`; ngược lại `siteReminders = []`.
  - Truyền vào view: `active, pending, siteReminders`, và cờ `canRegister = req.nav.canRegister`, `isSiteDocControl = req.nav.isSiteDocControl`.
  - Import `siteIdsWithDocControl` (permissions.js) + `reviewBacklogForSites`.
  - KHÔNG đổi POST verdict.
  - _Requirements: 1.2, 2.1, 2.4, 4.1_

- [x] 3. Menu: hiện "Xem xét định kỳ" cho DC Site
  - Trong `src/views/layout.eta`, đổi điều kiện mục menu từ `nav.canRegister` thành `nav.canRegister || nav.isSiteDocControl`.
  - _Requirements: 1.1_

- [x] 4. View reviews.eta: tách phần Author + bảng nhắc DC Site
  - Bọc phần kết luận hiện có (active/pending + form verdict) trong `<% if (it.canRegister) { %> ... <% } %>`.
  - Thêm phần DC Site `<% if (it.isSiteDocControl) { %>`: tiêu đề "Theo dõi xem xét (site bạn phụ trách)"; bảng CHỈ-ĐỌC cột Số hiệu+phiên bản / Tiêu đề / Hạn / Quá hạn; KHÔNG form/nút kết luận; rỗng -> thông báo.
  - Dùng `it.siteReminders || []`. Không `<%# %>`.
  - _Requirements: 2.2, 2.3, 2.4, 4.1, 4.2_
  - _Properties: 1, 4_

- [x] 5. Render test reviews.eta (không DB)
  - Render 4 ca: chỉ Author; chỉ DC Site (bảng nhắc, không form verdict); cả hai vai (2 phần, tiêu đề tách); DC Site + siteReminders rỗng -> thông báo rỗng.
  - Khẳng định phần DC Site KHÔNG chứa action "/verdict" hay `<button>`.
  - _Requirements: 2.3, 2.4, 4.1, 4.2_
  - _Properties: 1, 4_

- [x] 6. Build, test, dọn dẹp
  - Compile .eta sạch; `npm run build` sạch; test view hiện có pass.
  - Đọc lại domain/route xác nhận recordVerdict + POST verdict không đổi (DC Site vẫn 403 nếu cố kết luận); không migration.
  - Dọn file tạm.
  - _Requirements: 3.1, 3.2, 3.3, 5.1, 5.2, 5.3_
  - _Properties: 3, 5_

## Task Dependency Graph

Các "wave" chạy tuần tự; task trong cùng wave có thể làm song song.

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "3"] },
    { "wave": 2, "tasks": ["2"] },
    { "wave": 3, "tasks": ["4"] },
    { "wave": 4, "tasks": ["5"] },
    { "wave": 5, "tasks": ["6"] }
  ],
  "dependencies": {
    "1": [],
    "3": [],
    "2": ["1"],
    "4": ["2"],
    "5": ["4"],
    "6": ["5"]
  }
}
```

## Notes

- Không migration, không đổi schema/enum/recordVerdict/reviewBacklogForOwner.
- Tái dùng v_review_backlog + siteIdsWithDocControl. Quyền vào /reviews đã có
  (DC Site thuộc inDocFlow -> requireDocFlow cho vào).
- Máy dev không có Postgres: verify compile + render + build; kiểm luồng DB trên target.
