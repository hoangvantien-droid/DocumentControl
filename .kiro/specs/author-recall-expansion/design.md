# Design Document

## Overview

Mở quyền thu hồi của Author (bỏ chặn `recall.locked`) kèm kiểm soát: màn thu hồi
hiển thị tác động (số site đã chấp nhận...), ghi vết đậm, và nhắc in-app (Mức A)
cho DC Site của mọi site có receipt. Không migration, không kênh notification mới.

## Architecture

```
GET /my-documents/:id/recall  -> load tally (receiptTally) -> author-recall.eta (hiện tác động)
POST /my-documents/:id/recall -> recallByAuthor (BỎ chặn locked) + audit đậm (kèm tally + site list)

GET /site-receipts (DC Site) -> pendingReceiptsForSites (giữ)
                              + recalledDocsForSites(siteIds)  [MỚI, chỉ đọc]
   -> site-receipts.eta: mục "Tài liệu bị thu hồi" (nhắc, read-only)
```

## Components and Interfaces

### 1. Domain `recallByAuthor` — `src/domain/receipt.ts`

- BỎ khối chặn:
```ts
if (accepted > 0 && rejected === 0) {
  throw new BusinessError('recall.locked', ...);
}
```
  (giữ kiểm `status === 'da_ban_hanh'` và lý do bắt buộc.)
- Trước khi UPDATE, đã có `row` (accepted/rejected). Lấy thêm pending/total để
  ghi vết: mở rộng truy vấn đếm sẵn có thành accepted/rejected/pending/total; và
  lấy danh sách site_id có receipt (để audit + đối chiếu).
- writeAudit `thu_hoi` afterState kèm: `reason`, `tally: {accepted,rejected,
  pending,total}`, `affected_site_ids: string[]`.
- Trả về (tuỳ chọn) tally để route dùng — hoặc giữ void, route tự load trước.

### 2. Domain: hàm hiển thị tác động + nhắc DC Site

- `recallImpact(sql, versionId)` (hoặc tái dùng `receiptTally`): route recall GET
  dùng `receiptTally(sql, versionId)` (đã có) để truyền tally vào view.
- `recalledDocsForSites(sql, siteIds): Promise<RecalledDocRow[]>` (MỚI):
```sql
SELECT DISTINCT v.version_id, v.doc_id, v.version_no, v.title, v.recall_reason,
       v.updated_at::text AS recalled_at
  FROM document_versions v
  JOIN document_receipt r ON r.version_id = v.version_id
 WHERE v.status = 'thu_hoi'
   AND r.site_id = ANY(${siteIds}::uuid[])
 ORDER BY v.updated_at DESC
```
  siteIds rỗng -> []. RecalledDocRow: version_id, doc_id, version_no, title,
  recall_reason, recalled_at.
  (Chỉ-đọc, dẫn xuất; không bảng mới.)

### 3. Route `/my-documents/:id/recall` — `src/routes/documents.ts`

- GET: thêm `const tally = await receiptTally(sql, v.version_id);` và truyền vào
  view: `reply.view('author-recall.eta', { v, tally, error: null })`.
- POST: không đổi lời gọi `recallByAuthor` (quyền/lý do xử ở domain); vẫn
  try/catch BusinessError. (recallByAuthor nội bộ đã ghi audit đậm.)

### 4. Route `/site-receipts` — `src/routes/receipts.ts`

- Sau khi có `siteIds`: thêm `const recalledDocs = await recalledDocsForSites(sql,
  siteIds);` và truyền vào view: `{ rows, notControl, recalledDocs }`.
- notControl path: `recalledDocs: []`.

### 5. View `author-recall.eta`

- Thêm khối tác động trên form:
```
<p>Tác động: Chấp nhận <%= it.tally.accepted %> · Từ chối <%= it.tally.rejected %>
   · Chờ <%= it.tally.pending %> · Tổng <%= it.tally.total %> site.</p>
<% if (it.tally.accepted > 0) { %>
  <%~ include('/components/alert-banner.eta', { type: 'warning', text: 'CÓ ' + it.tally.accepted + ' SITE ĐÃ CHẤP NHẬN/ÁP DỤNG. Thu hồi sẽ làm tài liệu mất hiệu lực tại các site đó — cân nhắc ra phiên bản mới thay thế.' }) %>
<% } %>
```
- Giữ banner hướng dẫn + form lý do hiện có.

### 6. View `site-receipts.eta`

- Thêm section "Tài liệu bị thu hồi (<%= (it.recalledDocs||[]).length %>)":
  bảng CHỈ-ĐỌC cột Số hiệu+phiên bản / Tiêu đề / Lý do thu hồi / Thu hồi lúc.
  Rỗng -> "Không có tài liệu nào bị thu hồi ở site bạn phụ trách." KHÔNG nút.
- Đặt dưới hàng chờ phản hồi hiện có.

## Data Models

Không đổi schema. Dùng: `document_versions.(status, recall_reason, updated_at)`,
`document_receipt.(version_id, site_id)`, `receiptTally`. Audit qua `writeAudit`
event `thu_hoi` (enum sẵn có) với afterState giàu hơn.

## Error Handling

- Thu hồi: vẫn 403 nếu không phải registrant; BusinessError nếu thiếu lý do hoặc
  status != da_ban_hanh. Bỏ lỗi `recall.locked`.
- `/site-receipts`: recalledDocs rỗng -> view hiện thông báo rỗng; không lỗi mới.

## Testing Strategy

- **Render test (không DB):**
  - author-recall.eta: tally.accepted>0 -> banner cảnh báo; =0 -> không banner;
    luôn hiện dòng số liệu tác động.
  - site-receipts.eta: recalledDocs có phần tử -> bảng nhắc (read-only, không
    nút); rỗng -> thông báo.
- **SQL tĩnh:** recallByAuthor KHÔNG còn chuỗi `recall.locked`; `recalledDocsForSites`
  chứa `v.status = 'thu_hoi'` + `site_id = ANY`.
- **Build + test view hiện có:** `npm run build` sạch; test view pass.
- **Trên target (cần DB):** Author thu hồi tài liệu mọi-site-đã-chấp-nhận ->
  thành công (trước đây bị chặn); audit có tally + site list; DC Site mở
  /site-receipts thấy mục "Tài liệu bị thu hồi".

## Rollout / Deploy

Chỉ sửa domain + 2 route + 2 view. KHÔNG migration. Target: pull + build + restart.

## Correctness Properties

### Property 1: Thu hồi không còn bị khóa bởi chấp nhận
**Validates: Requirements 1.1**
Với tài liệu da_ban_hanh có accepted>0 và rejected=0, recallByAuthor KHÔNG ném
`recall.locked`; thu hồi thành công khi có lý do.

### Property 2: Kiểm quyền + điều kiện giữ nguyên
**Validates: Requirements 1.2, 1.3, 1.4**
Vẫn bắt buộc lý do; chỉ registrant (403 nếu không); chỉ status da_ban_hanh.

### Property 3: Ghi vết đậm
**Validates: Requirements 3.1, 3.2**
Audit thu_hoi chứa lý do + tally + affected_site_ids; receipt không bị xóa.

### Property 4: Nhắc DC Site mọi site có receipt
**Validates: Requirements 4.1, 4.5**
`recalledDocsForSites` trả tài liệu status thu_hoi có receipt tới site người dùng
phụ trách, bất kể trạng thái receipt; siteIds rỗng -> rỗng; không bảng/kênh mới.

### Property 5: Nhắc chỉ-đọc
**Validates: Requirements 4.3**
Mục "Tài liệu bị thu hồi" trên site-receipts.eta không chứa form/nút hành động.

### Property 6: Không đổi schema/luồng
**Validates: Requirements 5.1, 5.2, 5.3, 5.4**
Không migration; không hạ tầng notification; không đổi accept/reject/đăng ký/xem
xét; không nới quyền xem.
