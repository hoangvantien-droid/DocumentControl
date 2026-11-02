# Yêu cầu — Author sửa/thu hồi/xóa tài liệu chưa được chấp nhận

## Giới thiệu

Theo mô hình "đăng ký là ban hành luôn", người biên soạn (Author) đăng ký tài liệu là
ban hành thẳng (`da_ban_hanh`) và hệ thống sinh một phiếu tiếp nhận (receipt) cho mỗi site
nhận. Sau khi ban hành, Author vẫn cần khắc phục khi khai sai hoặc muốn gỡ bỏ — nhưng chỉ
trong giới hạn chưa làm méo dữ liệu đã được site chấp nhận.

Tài liệu này đặc tả hành vi **đã được implement** trong:
- `src/domain/receipt.ts`: `editVersionMetadata`, `recallByAuthor`, `deleteUnacceptedVersion`,
  `publishAdditionalSites` (và guard chung `assertNotAcceptedLocked`).
- `src/routes/documents.ts`: `/my-documents/:id/edit-metadata`, `/recall`, `/delete`,
  `/publish-sites`, `/issuance`.

Thuật ngữ:
- **Chấp nhận** = có ≥1 phiếu `status = 'chap_nhan'` cho phiên bản.
- **Khóa metadata** = điều kiện "đã có site chấp nhận" khiến không được ghi đè metadata cũ.

## Yêu cầu

### R1 — Chỉ chủ sở hữu thao tác
**User story:** Là Author, tôi chỉ thao tác được trên tài liệu do chính tôi đăng ký, để tránh
người khác sửa tài liệu không thuộc trách nhiệm của mình.

Tiêu chí chấp nhận (EARS):
1. KHI người dùng mở/gửi edit-metadata, recall, delete hoặc publish-sites mà
   `registrant_user_id` khác người dùng, HỆ THỐNG PHẢI trả 403 (`ver.not_owner`).
2. KHI không tìm thấy phiên bản, HỆ THỐNG PHẢI trả `ver.not_found` (404 ở route).

### R2 — Sửa metadata tại chỗ chỉ khi chưa ai chấp nhận
**User story:** Là Author, khi site báo "sai thông tin đăng ký" mà chưa site nào chấp nhận,
tôi muốn sửa metadata ngay thay vì phải ra phiên bản mới.

Tiêu chí chấp nhận:
1. KHI phiên bản không ở `da_ban_hanh`, HỆ THỐNG PHẢI từ chối (`edit.bad_status`).
2. KHI đã có ≥1 site chấp nhận, HỆ THỐNG PHẢI từ chối với mã chung `issue.locked_accepted`
   (yêu cầu ra phiên bản mới).
3. HỆ THỐNG PHẢI giữ nguyên `doc_id` và tệp/hash (chỉ sửa metadata).
4. KHI đặt `effective_date` về trước hôm nay, HỆ THỐNG PHẢI từ chối (`edit.effective_past`).
5. KHI không gửi lại `expiry_date`, HỆ THỐNG PHẢI giữ nguyên giá trị cũ; CHỈ xóa (`NULL`) khi
   client gửi sentinel rỗng có chủ ý.
6. KHI sửa thành công, HỆ THỐNG PHẢI ghi audit `sua_dang_ky` kèm patch.

### R3 — Thu hồi
**User story:** Là Author, tôi muốn thu hồi bản đã ban hành (kèm lý do) để dừng áp dụng,
kể cả khi các site đã chấp nhận.

Tiêu chí chấp nhận:
1. KHI thiếu lý do, HỆ THỐNG PHẢI từ chối (`recall.reason`).
2. KHI phiên bản không ở `da_ban_hanh`, HỆ THỐNG PHẢI từ chối (`recall.bad_status`).
3. HỆ THỐNG PHẢI cho thu hồi KỂ CẢ khi mọi site đã chấp nhận (không chặn theo chấp nhận).
4. KHI thu hồi, HỆ THỐNG PHẢI đặt `status = 'thu_hoi'`, lưu `recall_reason`, và ghi audit
   `thu_hoi` kèm tally + danh sách site bị ảnh hưởng.
5. Sau thu hồi, phiếu của tài liệu đó PHẢI bị loại khỏi hàng chờ + badge của DC Site
   (tham chiếu điểm 5 — thực thi ở `pendingReceiptCountForSites`/`pendingReceiptsForSites`).

### R4 — Xóa chỉ khi chưa có chấp nhận
**User story:** Là Author, tôi muốn xóa hẳn bản vừa ban hành nhầm khi chưa site nào chấp nhận.

Tiêu chí chấp nhận:
1. KHI đã có ≥1 site chấp nhận, HỆ THỐNG PHẢI từ chối (`del.locked`) và gợi ý thu hồi.
2. KHI xóa, HỆ THỐNG PHẢI ghi audit `xoa_ban_hanh` TRƯỚC khi xóa, rồi xóa phiên bản (phiếu
   theo `ON DELETE CASCADE`).

### R5 — Phát hành thêm / phát hành lại tôn trọng khóa metadata
**User story:** Là Author, tôi muốn phát hành thêm cho site mới hoặc phát hành lại cho site
đã từ chối "sai đăng ký", nhưng không được lách khóa metadata.

Tiêu chí chấp nhận:
1. HỆ THỐNG PHẢI chỉ nhận site **trong phạm vi** của tài liệu; site ngoài phạm vi → `publish.out_of_scope`.
2. KHI có bất kỳ phiếu từ chối `sai_noi_dung`, HỆ THỐNG PHẢI chặn (`publish.content_reject`).
3. KHI đã có site chấp nhận, HỆ THỐNG PHẢI chặn bằng cùng khóa `issue.locked_accepted`.
4. HỆ THỐNG PHẢI đưa phiếu từ chối `sai_dang_ky` về `cho_phan_hoi` khi phát hành lại; idempotent
   với site đã có phiếu chờ/chấp nhận.
5. KHI không có site hợp lệ nào để phát hành, HỆ THỐNG PHẢI trả `publish.nothing`.

### R6 — Khóa metadata thống nhất
**User story:** Là người vận hành, tôi muốn một quy tắc khóa duy nhất giữa "sửa đăng ký" và
"phát hành lại" để hành vi nhất quán.

Tiêu chí chấp nhận:
1. Sửa metadata và phát hành lại PHẢI dùng chung guard `assertNotAcceptedLocked` với cùng mã lỗi
   `issue.locked_accepted`.

## Ngoài phạm vi
- Soạn thảo/ký duyệt (thuộc hệ thống khác).
- Đường "báo sai nội dung sau khi đã chấp nhận" ở phía Reader/DC Site (thuộc issue-report, tham chiếu).
- Rotate bí mật hạ tầng (việc thủ công của người vận hành).
