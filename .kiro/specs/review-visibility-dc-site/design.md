# Design Document

## Overview

Cho DC Site THẤY (chỉ-đọc) các bản ghi rà soát tới hạn của tài liệu đã phát hành
tới site mình, ngay trên trang `/reviews`. Thêm một hàm domain lọc backlog theo
site (tái dùng `v_review_backlog`), mở menu + route cho DC Site, và một bảng
read-only trong view. Kết luận rà soát KHÔNG đổi (chỉ bộ phận sở hữu).

Không migration, không đổi schema/enum/logic kết luận.

## Architecture

```
GET /reviews (requireDocFlow)
  user canRegister?      -> reviewBacklogForOwner(user)  -> active[] + pending[]  (có nút kết luận)
  user isSiteDocControl? -> reviewBacklogForSites(siteIds) -> siteReminders[]     (CHỈ ĐỌC)
  -> view reviews.eta: phần Author (nếu có) + phần DC Site (nếu có)
```

- Hai nhánh độc lập; người có cả hai vai thấy cả hai phần.
- `recordVerdict` + POST `/reviews/:id/verdict`: GIỮ NGUYÊN (chỉ bộ phận sở hữu;
  DC Site cố gọi vẫn 403 vì domain kiểm owner).

## Components and Interfaces

### 1. Domain: `reviewBacklogForSites` (mới, `src/domain/review.ts`)

```ts
export async function reviewBacklogForSites(sql: Sql, siteIds: string[]): Promise<ReviewRow[]>
```
- Nếu `siteIds` rỗng -> trả `[]` (không truy vấn).
- Mirror `reviewBacklogForOwner` nhưng đổi điều kiện: tài liệu có RECEIPT tới một
  trong các site:
```sql
SELECT b.review_id, b.doc_id, b.version_no, b.title, b.due_date::text AS due_date,
       b.status, b.verdict, b.verdict_note, b.department_name, b.so_ngay_qua_han,
       d.scope_level, d.scope_bu_id, d.scope_site_id, d.scope_dept_id
  FROM v_review_backlog b
  JOIN documents d ON d.doc_id = b.doc_id
  JOIN periodic_reviews p ON p.review_id = b.review_id
 WHERE EXISTS (
   SELECT 1 FROM document_receipt r
    WHERE r.version_id = p.version_id
      AND r.site_id = ANY(${siteIds}::uuid[])
 )
 ORDER BY b.so_ngay_qua_han DESC
```
- Trả cùng kiểu `ReviewRow` để view tái dùng. Dùng DISTINCT nếu cần (một version
  nhiều receipt cùng site set -> tránh nhân dòng; EXISTS đã tránh nhân, nên không
  cần DISTINCT).

### 2. Route: `GET /reviews` (`src/routes/reviews.ts`)

- Giữ `requireDocFlow`.
- Author nhánh (nếu `canRegisterDocuments(user)` hoặc đơn giản luôn tính như cũ):
  `reviewBacklogForOwner` -> `active` / `pending` như hiện tại.
- DC Site nhánh: nếu `isSiteDocControl(roles)` (hoặc kiểm qua
  `siteIdsWithDocControl(sql, user) không rỗng`): lấy `siteIds` rồi
  `reviewBacklogForSites(sql, siteIds)` -> `siteReminders`.
- Truyền thêm vào view: `siteReminders` (mảng; rỗng nếu không phải DC Site hoặc
  không có), và cờ `isSiteDocControl` để view quyết định hiển thị phần nhắc.
- Dùng `nav` sẵn có (`req.nav.isSiteDocControl`, `req.nav.canRegister`) để phân
  nhánh gọn, tránh query vai lại.

Lưu ý quyền vào trang: `/reviews` dùng `requireDocFlow` — DC Site thuộc inDocFlow
nên ĐÃ vào được; không cần nới. Chỉ cần đảm bảo view render phần DC Site.

### 3. Menu: `src/views/layout.eta`

Hiện mục "Xem xét định kỳ" chỉ khi `nav.canRegister`. Đổi điều kiện thành
`nav.canRegister || nav.isSiteDocControl` để DC Site thấy mục này.

### 4. View: `src/views/reviews.eta`

- Phần Author (các bảng kết luận hiện có): bọc trong `<% if (it.canRegister) { %>`
  … hoặc giữ như cũ nhưng chỉ render khi có dữ liệu Author. An toàn: chỉ render
  phần kết luận khi `it.canRegister` (truyền từ route / nav).
- Phần DC Site (MỚI): `<% if (it.isSiteDocControl) { %>` một bảng CHỈ-ĐỌC:
  tiêu đề "Theo dõi xem xét (site bạn phụ trách)"; cột: Số hiệu+phiên bản, Tiêu
  đề, Hạn, Quá hạn. KHÔNG có cột/nút kết luận.
  Rỗng -> "Không có tài liệu nào tới hạn xem xét ở site bạn phụ trách."
- Hai phần có tiêu đề rõ ràng (Requirement 4.2).

### 5. Nav flags

`req.nav` đã có `canRegister` và `isSiteDocControl`. Route truyền 2 cờ này (hoặc
view đọc `it.nav`) để phân nhánh. Không cần đổi `buildNav`.

## Data Models

Không đổi schema. Dùng: `v_review_backlog`, `periodic_reviews.version_id`,
`document_receipt.(version_id, site_id)`. Hàm `siteIdsWithDocControl` sẵn có.

## Error Handling

- `/reviews` GET: không phát sinh lỗi mới; DC Site không phụ trách site nào ->
  `siteReminders = []` -> view hiện thông báo rỗng.
- POST verdict: KHÔNG đổi — domain vẫn 403 nếu không thuộc bộ phận sở hữu
  (Requirement 3.2).

## Testing Strategy

- **Render test (không DB):** reviews.eta:
  - chỉ Author -> có bảng kết luận, không bảng DC Site.
  - chỉ DC Site -> có bảng nhắc chỉ-đọc (KHÔNG có form verdict), đúng cột.
  - cả hai vai -> cả hai phần, tiêu đề tách bạch.
  - siteReminders rỗng + isSiteDocControl -> thông báo rỗng.
  - Khẳng định bảng DC Site KHÔNG chứa `<form ... /verdict>`/`<button>`.
- **Build + test view hiện có:** `npm run build` sạch; test view pass.
- **Trên target (cần DB):** DC Site đăng nhập -> thấy mục menu + bảng nhắc tài
  liệu tới hạn phát hành tới site mình; không thấy nút kết luận; Author vẫn kết
  luận bình thường; DC Site POST verdict (nếu ép) -> 403.

## Rollout / Deploy

Chỉ sửa domain + route + layout + reviews.eta. KHÔNG migration. Target: pull +
build + restart.

## Correctness Properties

### Property 1: DC Site chỉ-đọc
**Validates: Requirements 2.3, 3.3**
Phần DC Site trên reviews.eta KHÔNG chứa form/nút kết luận; không có lối ghi
verdict cho DC Site qua giao diện.

### Property 2: Phạm vi theo site
**Validates: Requirements 2.1, 2.5**
`reviewBacklogForSites` chỉ trả review của tài liệu có receipt tới site người
dùng phụ trách; siteIds rỗng -> trả rỗng.

### Property 3: Kết luận bất biến
**Validates: Requirements 3.1, 3.2, 3.3, 5.2**
`recordVerdict` và POST verdict không đổi; DC Site không thuộc bộ phận sở hữu vẫn
bị 403 khi cố kết luận.

### Property 4: Hai vai không nhầm
**Validates: Requirements 4.1, 4.2**
Người có cả canRegister và isSiteDocControl thấy cả phần kết luận lẫn bảng nhắc,
tách bằng tiêu đề; mỗi phần render đúng theo cờ tương ứng.

### Property 5: Không đổi schema/luồng
**Validates: Requirements 5.1, 5.2, 5.3**
Không migration; không đổi reviewBacklogForOwner/enum/luồng Author.
