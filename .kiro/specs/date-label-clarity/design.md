# Design Document

## Overview

Thay đổi nhỏ, chỉ tầng view + một bổ sung load dữ liệu ở route chi tiết. Hai
nhóm việc:

1. **Đổi nhãn** `issued_date`: "Ngày áp dụng dự kiến" → "Ngày ban hành" tại các
   view (`register.eta`, `detail.eta`, và bất kỳ view nào còn chuỗi này).
2. **Hiển thị ngày áp dụng theo site** trên trang chi tiết: load danh sách
   receipt của phiên bản và render bằng component ma trận sẵn có — chế độ chỉ
   đọc, cho mọi người đã mở được trang chi tiết (option a).

Không đổi schema, tên cột, route nghiệp vụ, hay điều kiện quyền.

## Architecture

### Luồng hiện tại (trang chi tiết)

```
GET /documents/:id (routes/catalog.ts)
  -> requireDocFlow + canViewVersion   (quyền xem - GIỮ NGUYÊN)
  -> loadDetail / loadSections / loadLinks
  -> reply.view('detail.eta', { d, sections, links, current, ackState, isRegistrant })
```

Hiện route KHÔNG load receipt -> trang chi tiết không có dữ liệu site áp dụng.

### Luồng sau thay đổi

```
GET /documents/:id
  -> (như cũ, quyền KHÔNG đổi)
  -> THÊM: listReceiptsForVersion(sql, versionId)   // đã có sẵn trong domain/receipt.ts
  -> reply.view('detail.eta', { ..., receipts })
```

`listReceiptsForVersion` đã trả đủ cột cần: `site_code, site_name, status,
apply_date, responded_at, response_type, response_note`. Không viết truy vấn mới.

Quyền: ai qua được `canViewVersion` cho trang chi tiết thì mới tới bước render,
nên bảng site áp dụng tự động chỉ hiện cho người có quyền xem tài liệu. Không
thêm kiểm tra quyền riêng, không nới quyền.

## Components and Interfaces

### 1. Đổi nhãn (view-only)

| File | Dòng (hiện tại) | Trước | Sau |
|---|---|---|---|
| `src/views/register.eta` | nhãn ô `name="issued_date"` | "Ngày áp dụng dự kiến" | "Ngày ban hành" |
| `src/views/detail.eta` | `<dt>` của `d.issued_date` | "Ngày áp dụng dự kiến" | "Ngày ban hành" |

Rà soát toàn bộ `src/views` để chắc không còn chuỗi "Ngày áp dụng dự kiến" (vd
dùng ripgrep). Chỉ sửa chuỗi hiển thị, giữ nguyên `name`/biến.

### 2. Route chi tiết (`src/routes/catalog.ts`)

- Import thêm `listReceiptsForVersion` từ `../domain/receipt.js`.
- Trong handler `GET /documents/:id`, sau khi có quyền xem + `detail`:
  thêm `const receipts = await listReceiptsForVersion(sql, req.params.id);`
  (gộp vào `Promise.all` cùng `loadSections/loadLinks` để không thêm round-trip
  tuần tự).
- Truyền `receipts` vào `reply.view('detail.eta', { ... , receipts })`.

### 3. Trang chi tiết (`src/views/detail.eta`)

- Thêm một panel (dạng `<details class="detail-panel">` hoặc section) tiêu đề
  "Áp dụng theo site".
- Nội dung: tái dùng `components/site-response-matrix.eta` (đã là read-only:
  cột Site / Trạng thái / Ngày áp dụng / Phản hồi lúc / Ghi chú — KHÔNG có nút).
  Truyền `receipts` + 2 hàm nhãn `receiptStatusLabel`, `receiptRejectTypeLabel`
  (đã có trong context view qua render layer; component cũng tự vệ nếu thiếu).
- Nếu `receipts.length === 0`: component đã tự hiển thị "Chưa phát hành tới site
  nào." -> thỏa Requirement 3.3. Có thể bọc điều kiện để ẩn hẳn panel khi rỗng.

### Tái dùng component ma trận

`site-response-matrix.eta` hiện dùng ở `issuance-status.eta`. Nó thuần hiển thị,
không phụ thuộc quyền, nên nhúng vào `detail.eta` là an toàn và không trùng lặp
logic (thỏa Requirement 3.5/3.6).

## Data Models

Không thay đổi. Chỉ đọc các cột đã có:
- `document_versions.issued_date`, `.effective_date` (hiển thị, đổi nhãn).
- `document_receipt.apply_date`, `.status`, `.responded_at`, `.response_type`,
  `.response_note` (qua `listReceiptsForVersion`).

## Error Handling

- Không phát sinh lỗi mới. `listReceiptsForVersion` trả mảng rỗng khi chưa có
  receipt -> component hiển thị dòng "Chưa phát hành tới site nào.".
- Không đổi mã lỗi/điều kiện 403/404 của route chi tiết.

## Testing Strategy

- **Render test (máy dev, không cần DB):** render `detail.eta` với:
  (a) `receipts` rỗng -> panel ẩn hoặc hiện "chưa phát hành";
  (b) `receipts` có site `chap_nhan` (có `apply_date`) và site `cho_phan_hoi`
      (không `apply_date`) -> bảng hiển thị đúng, ngày áp dụng đúng chỗ;
  (c) kiểm nhãn "Ngày ban hành" xuất hiện, KHÔNG còn "Ngày áp dụng dự kiến".
- **Grep kiểm chuỗi:** sau khi sửa, `rg "Ngày áp dụng dự kiến" src/views` trả 0
  kết quả.
- **Compile eta:** toàn bộ template biên dịch sạch.
- **Build + view test hiện có:** `npm run build` sạch; bộ test view pass.
- **Trên target (cần DB/trình duyệt):** mở trang chi tiết bằng Reader/DC Site ->
  thấy bảng site áp dụng; bằng Author -> giống (và trang Tình trạng ban hành
  vẫn còn các hành động như cũ).

## Rollout / Deploy

Chỉ sửa view + route; KHÔNG migration. Trên target: pull + build + restart
(cache-bust CSS sẵn có đảm bảo tải lại giao diện). Không cần `npm run migrate`.

## Correctness Properties

### Property 1: Không rò nhãn cũ
**Validates: Requirements 1.4, 4.2**

Với mọi view trong `src/views`, chuỗi "Ngày áp dụng dự kiến" KHÔNG xuất hiện sau
khi hoàn tất.

### Property 2: Nhãn issued_date đúng nghĩa
**Validates: Requirements 1.1, 1.2, 4.1**

Mọi nơi hiển thị `issued_date` đều mang nhãn "Ngày ban hành"; không nơi nào gọi
nó là ngày áp dụng.

### Property 3: apply_date chỉ cho site đã chấp nhận
**Validates: Requirements 3.1, 3.2**

Trong bảng site áp dụng, một dòng chỉ hiển thị giá trị ngày áp dụng khi receipt
của site đó ở trạng thái "Đã chấp nhận"; site khác để trống phần ngày.

### Property 4: Bất biến quyền
**Validates: Requirements 3.4, 3.5, 5.2**

Tập người xem được trang chi tiết và dữ liệu họ thấy không đổi so với trước,
ngoại trừ phần hiển thị bảng site áp dụng; không thêm nút thao tác nào trong bảng
đó.

### Property 5: Rỗng an toàn
**Validates: Requirements 3.3**

Với `receipts` rỗng, trang chi tiết render không lỗi và nêu rõ chưa phát hành
tới site nào (hoặc ẩn panel).

### Property 6: Không đổi dữ liệu
**Validates: Requirements 5.1, 5.3**

Thao tác render trang chi tiết không ghi/sửa bất kỳ bản ghi nào (chỉ đọc).
