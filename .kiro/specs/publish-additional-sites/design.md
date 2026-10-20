# Design Document

## Overview

Bổ sung lối vào cho Author "Phát hành thêm site" trên trang Tình trạng ban hành.
Tái dùng primitive `publishToSites` (idempotent) và `candidateSitesForScope` sẵn
có; thêm một hàm domain mới để xử lý quy tắc chặn (sai nội dung) và phát hành lại
(sai đăng ký). Không migration, không đổi schema, không nới quyền xem.

Thay đổi gồm:
1. Domain `receipt.ts`: thêm `publishAdditionalSites(...)` gói quy tắc nghiệp vụ.
2. Route `documents.ts`: GET issuance bổ sung dữ liệu site-có-thể-thêm; POST mới
   để thực hiện phát hành thêm/ lại.
3. View `issuance-status.eta`: khu "Phát hành thêm site".

## Architecture

### Luồng hiện tại

```
GET /my-documents/:id/issuance
  -> requireUser + check registrant (403 nếu không phải)
  -> listReceiptsForVersion + receiptTally
  -> tính aggregate, canEditOrRecall, canDelete, hasContentReject, hasMetaReject
  -> view issuance-status.eta  (chỉ có Sửa metadata / Thu hồi / Xóa)
```

Receipt chỉ tạo một lần ở đăng ký (`submitRegistration -> publishToSites`).
`publishToSites` KHÔNG được gọi ở đâu khác.

### Luồng sau thay đổi

```
GET /my-documents/:id/issuance
  -> (như cũ) + JOIN documents lấy scope_level/scope_*_id
  -> candidateSitesForScope(scope)  -> trừ site đã có receipt
     => addableNew   (site chưa có receipt)
     => republishable (receipt tu_choi loại sai_dang_ky)
  -> blockedByContentReject = hasContentReject   (Requirement 3)
  -> view: thêm addableNew, republishable, blocked

POST /my-documents/:id/publish-sites   (MỚI)
  -> requireUser + check registrant
  -> publishAdditionalSites(sql, { versionId, userId, siteIds })
  -> redirect về /my-documents/:id/issuance
```

## Components and Interfaces

### 1. Domain: `publishAdditionalSites` (mới, trong `src/domain/receipt.ts`)

Chữ ký:
```ts
export async function publishAdditionalSites(
  sql: Sql,
  input: { versionId: string; userId: string; siteIds: string[] },
): Promise<{ added: number; republished: number }>
```

Thuật toán (trong một transaction):
1. Nạp version (khóa dòng) + scope của documents; kiểm:
   - version tồn tại; `registrant_user_id === userId` (nếu không: 403
     BusinessError).
   - `status === 'da_ban_hanh'` (nếu không: BusinessError bad_status).
2. Tính tập site hợp lệ = `candidateSitesForScope(tx, scope)`. Loại mọi
   `siteIds` không thuộc tập này (Requirement 2.2: báo lỗi nếu có site ngoài
   scope).
3. Chặn sai nội dung (Requirement 3.1): nếu tồn tại receipt `tu_choi` +
   `sai_noi_dung` -> BusinessError, không làm gì.
4. Với mỗi siteId hợp lệ, phân loại theo receipt hiện có:
   - KHÔNG có receipt -> thêm mới (publishToSites xử lý: INSERT cho_phan_hoi).
   - receipt `tu_choi` + `sai_dang_ky` -> PHÁT HÀNH LẠI: UPDATE về
     `cho_phan_hoi`, `response_type=NULL`, `response_note=NULL`,
     `responded_by=NULL`, `responded_at=NULL`, `apply_date=NULL`,
     `updated_at=now()`.
   - receipt `tu_choi` + `sai_noi_dung` -> bỏ qua (đã chặn ở bước 3 nếu có).
   - receipt `chap_nhan` hoặc `cho_phan_hoi` -> bỏ qua (Requirement 4.4; idempotent).
5. Dùng `publishToSites(tx, { versionId, siteIds: newOnes, ... })` cho nhóm thêm
   mới (tận dụng ON CONFLICT + audit `ban_hanh`).
6. Ghi vết việc phát hành lại: audit event `ban_hanh` với
   `afterState: { action: 're_publish', site_ids, prev_reject: 'sai_dang_ky' }`
   (không thêm event enum mới -> không migration). Lý do từ chối cũ vẫn còn trong
   các bản ghi audit `tu_choi_nhan` trước đó (giữ dấu vết — Requirement 4.3).
7. Trả `{ added, republished }`.

Ghi chú: không viết SQL phát hành lại bằng cách xóa receipt rồi insert — UPDATE
tại chỗ để giữ `receipt_id` và lịch sử liên kết.

### 2. Route (`src/routes/documents.ts`)

GET `/my-documents/:id/issuance` (sửa):
- Đổi query version để JOIN `documents d` lấy `d.scope_level, d.scope_bu_id,
  d.scope_site_id, d.scope_dept_id`.
- Sau khi có `receipts`: tính
  - `existingSiteIds = new Set(receipts.map(r => r.site_id))`
  - `candidates = await candidateSitesForScope(sql, scope)`
  - `addableNew = candidates.filter(s => !existingSiteIds.has(s.site_id))`
  - `republishable = receipts.filter(r => r.status==='tu_choi' &&
     r.response_type==='sai_dang_ky')`  (kèm site_code/name)
  - `blockedByContentReject = hasContentReject`
- Truyền thêm vào view: `addableNew, republishable, blockedByContentReject`.

POST `/my-documents/:id/publish-sites` (mới):
- requireUser; đọc `site_ids` (string|string[] -> normalizeSiteIds).
- Gọi `publishAdditionalSites(sql, { versionId, userId, siteIds })`.
- try/catch BusinessError -> sendBusinessError; thành công -> redirect
  `/my-documents/:id/issuance`.
- Kiểm registrant đặt trong domain (nhất quán với edit/recall/delete).

### 3. View (`src/views/issuance-status.eta`)

Thêm một section "Phát hành thêm site" (sau khu Hành động hoặc gần ma trận):
- IF `blockedByContentReject`: hiển thị alert "Có site báo sai nội dung — phải
  thu hồi và ban hành bản mới; không phát hành thêm." KHÔNG render form.
- ELSE:
  - Nếu `addableNew.length === 0 && republishable.length === 0`: ghi "Đã phát
    hành tới mọi site trong phạm vi." (Requirement 5.2).
  - Form `POST /my-documents/:id/publish-sites`:
    - Nhóm "Thêm site mới": checkbox từ `addableNew` (site_code — name).
    - Nhóm "Phát hành lại (đã từ chối sai đăng ký)": checkbox từ `republishable`,
      ghi rõ nhãn để phân biệt (Requirement 5.4).
    - Nút "Phát hành".
- Chỉ-đọc ngoài form; không đổi các hành động hiện có (Sửa/Thu hồi/Xóa).

## Data Models

Không thay đổi schema. Dùng:
- `documents.scope_level/scope_bu_id/scope_site_id/scope_dept_id` (đọc).
- `document_receipt` (INSERT cho site mới qua publishToSites; UPDATE về
  cho_phan_hoi cho site phát hành lại). Ràng buộc `uq_receipt_version_site` đảm
  bảo không trùng.
- `audit_log` qua `writeAudit` (event `ban_hanh`, không thêm enum).

## Error Handling

- Không phải registrant -> BusinessError httpStatus 403.
- Không `da_ban_hanh` -> BusinessError (vd "Chỉ phát hành thêm khi tài liệu đang
  đã ban hành").
- Có từ chối sai nội dung -> BusinessError (chặn) kèm hướng dẫn thu hồi + bản mới.
- Site ngoài scope trong `site_ids` -> BusinessError (không tạo receipt lạc scope).
- Mọi BusinessError hiển thị qua `sendBusinessError` (toast/trang lỗi sẵn có).

## Testing Strategy

- **Unit thuần (không DB):** test `publishAdditionalSites` với fake sql ở mức khả
  thi, hoặc tách phần phân loại (classify sites -> {new, republish, skip, invalid})
  thành hàm thuần để test:
  - site ngoài scope bị loại/lỗi.
  - có sai_noi_dung -> chặn toàn bộ.
  - sai_dang_ky -> vào nhóm phát hành lại; chap_nhan/cho_phan_hoi -> bỏ qua.
- **Render test (không DB):** `issuance-status.eta`:
  - blockedByContentReject=true -> hiện alert, KHÔNG có form phát hành.
  - addableNew rỗng + republishable rỗng -> "đã phát hành tới mọi site".
  - có addableNew + republishable -> 2 nhóm checkbox, phân biệt nhãn.
- **Build + test view hiện có:** `npm run build` sạch; bộ test view pass.
- **Trên target (cần DB):** phát hành thêm một site trong scope -> site đó vào
  hàng chờ; phát hành lại site từ chối sai đăng ký -> về chờ phản hồi; thử site
  đã chấp nhận không bị reset; tài liệu có từ chối sai nội dung -> bị chặn.

## Rollout / Deploy

Chỉ sửa domain + route + view; KHÔNG migration. Trên target: pull + build +
restart. Không `npm run migrate`.

## Correctness Properties

### Property 1: Idempotent với site đã có receipt chờ/chấp nhận
**Validates: Requirements 1.3, 4.4**
Gọi phát hành thêm với một site đang `cho_phan_hoi` hoặc `chap_nhan` KHÔNG đổi
trạng thái/receipt của site đó.

### Property 2: Chỉ site trong scope
**Validates: Requirements 2.1, 2.2, 2.3**
Mọi receipt tạo/đổi bởi thao tác này đều ứng với site thuộc `candidateSitesForScope`
của scope hiện tại; không có receipt cho site ngoài scope; `documents.scope_*`
không đổi.

### Property 3: Chặn sai nội dung
**Validates: Requirements 3.1, 4.2**
Nếu tồn tại receipt `tu_choi`+`sai_noi_dung`, thao tác phát hành thêm/ lại KHÔNG
tạo/đổi bất kỳ receipt nào và trả lỗi.

### Property 4: Phát hành lại chỉ cho sai đăng ký
**Validates: Requirements 4.1, 4.2, 4.4**
Chỉ receipt `tu_choi`+`sai_dang_ky` mới được đưa về `cho_phan_hoi` (xóa loại lỗi
+ lý do); receipt `sai_noi_dung` và `chap_nhan` không bị đụng.

### Property 5: Bất biến quyền & chủ thể
**Validates: Requirements 1.4, 6.2, 6.3**
Chỉ người đăng ký thực hiện được; không nới quyền xem; các luồng đăng ký/thu hồi/
xóa/sửa metadata không đổi hành vi.

### Property 6: Không đổi schema
**Validates: Requirements 6.1**
Không thêm migration; chỉ đọc scope, INSERT/UPDATE document_receipt, ghi audit với
event enum sẵn có.
