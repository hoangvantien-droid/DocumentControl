# Thiết kế — Author sửa/thu hồi/xóa tài liệu chưa được chấp nhận

## Tổng quan

Tính năng cho phép Author khắc phục tài liệu đã ban hành trong giới hạn an toàn, dựa trên
trạng thái tập phiếu tiếp nhận (receipt) của phiên bản. Toàn bộ logic nghiệp vụ nằm ở tầng
domain thuần/DB (`src/domain/receipt.ts`), route chỉ mỏng và chuyển `BusinessError` qua
`src/lib/http-errors.ts`. Thiết kế này mô tả hiện trạng đã implement để làm chuẩn đối chiếu.

## Kiến trúc

```
Trình duyệt (HTMX)
   │  GET/POST /my-documents/:id/{issuance,edit-metadata,recall,delete,publish-sites}
   ▼
src/routes/documents.ts (requireUser, bắt BusinessError -> sendBusinessError)
   ▼
src/domain/receipt.ts
   ├─ loadOwnedVersion()           → kiểm chủ sở hữu + FOR UPDATE
   ├─ acceptedCount()              → đếm phiếu chap_nhan
   ├─ assertNotAcceptedLocked()    → khóa metadata chung (issue.locked_accepted)
   ├─ editVersionMetadata()        → sửa tại chỗ (R2)
   ├─ recallByAuthor()             → thu hồi (R3)
   ├─ deleteUnacceptedVersion()    → xóa (R4)
   └─ publishAdditionalSites()     → phát hành thêm/lại (R5) dùng classifySitesForRepublish()
   ▼
PostgreSQL: document_versions, document_receipt (uq_receipt_version_site, ON DELETE CASCADE)
+ writeAudit() (src/lib/audit.ts)
```

## Thành phần và interface

### Guard chủ sở hữu — `loadOwnedVersion(tx, versionId, userId)`
- `SELECT ... FOR UPDATE` trên `document_versions` để khóa hàng trong giao dịch.
- Không thấy → `ver.not_found`; khác `registrant_user_id` → `ver.not_owner` (403).

### Khóa metadata chung — `assertNotAcceptedLocked(tx, versionId)`
- Dùng `acceptedCount` (đếm `status = 'chap_nhan'`). >0 → ném `issue.locked_accepted`.
- Được gọi bởi `editVersionMetadata` và `publishAdditionalSites` để R6 nhất quán.

### `editVersionMetadata(sql, { versionId, userId, patch })`
- Yêu cầu `status = 'da_ban_hanh'` (`edit.bad_status`), qua khóa metadata.
- `effective_date` quá khứ → `edit.effective_past`.
- `expiry_date`: `coalesce` giữ giá trị cũ khi `undefined`; sentinel rỗng → `NULL`.
- `title/issued_date/review_cycle_months/owner_department_id` dùng `coalesce` giữ cũ khi vắng.
- Audit `sua_dang_ky`.

### `recallByAuthor(sql, { versionId, userId, reason })`
- Bắt buộc `reason` (`recall.reason`); yêu cầu `da_ban_hanh` (`recall.bad_status`).
- KHÔNG chặn theo chấp nhận (mở cho cả khi mọi site đã chấp nhận).
- Đặt `status = 'thu_hoi'`, lưu `recall_reason`; audit `thu_hoi` kèm tally + `affected_site_ids`.

### `deleteUnacceptedVersion(sql, { versionId, userId })`
- `acceptedCount > 0` → `del.locked` (gợi ý thu hồi).
- Audit `xoa_ban_hanh` trước, rồi `DELETE FROM document_versions` (phiếu cascade).

### `publishAdditionalSites(sql, { versionId, userId, siteIds })`
- Yêu cầu `da_ban_hanh` (`publish.bad_status`) + khóa metadata chung.
- Lấy scope từ `documents`, giải candidate site qua `candidateSitesForScope`.
- Phân loại bằng `classifySitesForRepublish` (hàm thuần, unit-test được):
  - `blockedByContentReject` → `publish.content_reject`.
  - `invalid` (ngoài scope) → `publish.out_of_scope`.
  - `newOnes` → `publishToSites` (tạo phiếu `cho_phan_hoi`).
  - `republish` (từ chối `sai_dang_ky`) → UPDATE phiếu về `cho_phan_hoi`, reset phản hồi.
  - không có gì hợp lệ → `publish.nothing`.
- Audit `ban_hanh` (action `re_publish`) khi phát hành lại.

### Route layer — `src/routes/documents.ts`
- `GET /my-documents/:id/issuance`: dựng ma trận phiếu + cờ `canEditOrRecall`
  (`accepted === 0 || rejected > 0`), `canDelete` (`accepted === 0`), danh sách `addableNew`,
  `republishable`, `blockedByContentReject` để view bật/tắt nút.
- `edit-metadata` POST: phân biệt "không gửi `expiry_date`" (`undefined`) với "gửi rỗng" (`''`)
  bằng `hasOwnProperty`.
- Mọi handler bắt `BusinessError` → `sendBusinessError`.

## Mô hình dữ liệu (liên quan)
- `document_versions(version_id, doc_id, status, registrant_user_id, title, issued_date,
  effective_date, review_cycle_months, expiry_date, owner_department_id, recall_reason, ...)`.
- `document_receipt(receipt_id, version_id, site_id, status, response_type, response_note,
  apply_date, responded_by, responded_at)` — `uq_receipt_version_site`, `ON DELETE CASCADE`
  theo version.
- Không thêm bảng mới; không migration mới cho tính năng này.

## Xử lý lỗi
- Mọi vi phạm là `BusinessError` với mã ổn định (xem Requirements). Domain validate TRƯỚC ràng buộc
  DB; không nuốt lỗi ràng buộc trong try/catch.
- Mã lỗi chính: `ver.not_found`, `ver.not_owner`, `edit.bad_status`, `edit.effective_past`,
  `issue.locked_accepted`, `recall.reason`, `recall.bad_status`, `del.locked`,
  `publish.bad_status`, `publish.out_of_scope`, `publish.content_reject`, `publish.nothing`.

## Chiến lược kiểm thử
- **Unit (không DB):** `classifySitesForRepublish` — các nhánh new/republish/skipped/invalid/
  blockedByContentReject; `normalizeSiteIds`.
- **Integration (Postgres):** vòng đời edit → chấp nhận → khóa; thu hồi khi đã chấp nhận; xóa bị
  chặn khi đã chấp nhận; phát hành lại site từ chối sai đăng ký; chặn khi có sai nội dung. Tự skip
  khi không có `DATABASE_URL_TEST`.

## Quyết định thiết kế
- **Một khóa metadata duy nhất** (`assertNotAcceptedLocked`) dùng chung cho sửa và phát hành lại,
  đáp ứng R6 và điểm review 6.
- **Thu hồi mở cả khi đã chấp nhận**: thu hồi là hành vi an toàn hơn xóa (giữ lịch sử + lý do), nên
  không ràng theo chấp nhận; xóa thì ngược lại, chỉ cho khi sạch.
