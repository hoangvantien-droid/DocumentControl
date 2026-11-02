# Nhiệm vụ — Author sửa/thu hồi/xóa tài liệu chưa được chấp nhận

> Spec này mô tả tính năng **đã được implement**. Các mục dưới đánh dấu trạng thái thực tế
> trong mã nguồn; ô chưa tích là việc kiểm thử/bổ sung còn mở.

- [x] 1. Guard chủ sở hữu + khóa hàng
  - `loadOwnedVersion` với `FOR UPDATE`, mã lỗi `ver.not_found` / `ver.not_owner`.
  - _Yêu cầu: R1_

- [x] 2. Khóa metadata chung
  - `acceptedCount` + `assertNotAcceptedLocked` (mã `issue.locked_accepted`).
  - _Yêu cầu: R2.2, R6_

- [x] 3. Sửa metadata tại chỗ
  - `editVersionMetadata`: chặn `edit.bad_status`, `edit.effective_past`; giữ `expiry_date`
    khi không nhập lại; giữ `doc_id`/tệp; audit `sua_dang_ky`.
  - Route `GET/POST /my-documents/:id/edit-metadata` (phân biệt expiry vắng vs rỗng).
  - _Yêu cầu: R2_

- [x] 4. Thu hồi
  - `recallByAuthor`: bắt buộc lý do; mở cả khi đã chấp nhận; audit `thu_hoi` kèm tally.
  - Route `GET/POST /my-documents/:id/recall`.
  - _Yêu cầu: R3.1–R3.4_

- [x] 5. Xóa khi chưa có chấp nhận
  - `deleteUnacceptedVersion`: chặn `del.locked`; audit `xoa_ban_hanh`; cascade phiếu.
  - Route `POST /my-documents/:id/delete`.
  - _Yêu cầu: R4_

- [x] 6. Phát hành thêm / phát hành lại
  - `classifySitesForRepublish` (thuần) + `publishAdditionalSites`: scope, chặn sai nội dung,
    khóa metadata, phát hành lại site từ chối sai đăng ký.
  - Route `POST /my-documents/:id/publish-sites` + `GET .../issuance` dựng cờ nút.
  - _Yêu cầu: R5, R6_

- [x] 7. Loại phiếu tài liệu đã thu hồi khỏi hàng chờ + badge
  - `pendingReceiptCountForSites` / `pendingReceiptsForSites` JOIN `document_versions`
    với `v.status <> 'thu_hoi'`.
  - _Yêu cầu: R3.5_

- [ ] 8. Kiểm thử integration trên Postgres
  - Vòng đời edit→chấp nhận→khóa; thu hồi sau chấp nhận; xóa bị chặn; phát hành lại sai đăng ký;
    chặn sai nội dung. Chạy nơi có `DATABASE_URL_TEST` (tên DB chứa "test").
  - _Yêu cầu: R2–R6_

- [ ] 9. Kiểm thử unit cho phân loại site
  - Phủ các nhánh của `classifySitesForRepublish` + `normalizeSiteIds` (không cần DB).
  - _Yêu cầu: R5_
