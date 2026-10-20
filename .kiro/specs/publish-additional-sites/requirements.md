# Requirements Document

## Introduction

Hiện tại, receipt (bản ghi tiếp nhận theo site) CHỈ được tạo một lần duy nhất lúc
đăng ký tài liệu (`submitRegistration` → `publishToSites`). Sau khi đã ban hành,
KHÔNG có đường nào để phát hành thêm cho site khác: trang "Tình trạng ban hành"
của Author chỉ có Sửa metadata / Thu hồi / Xóa. Nếu Author quên chọn một site,
hoặc cần phát hành cho site mới cùng phạm vi, họ buộc phải thu hồi và làm lại.

Hạ tầng đã sẵn sàng: `publishToSites` idempotent theo `(version_id, site_id)`
(ràng buộc `uq_receipt_version_site` + `ON CONFLICT DO NOTHING`), nên thêm site
là an toàn, không nhân đôi. Spec này bổ sung LỐI VÀO cho Author để phát hành
thêm site TRONG PHẠM VI hiện tại của tài liệu.

Phạm vi (phương án A — đã chốt):
- Chỉ thêm site NẰM TRONG scope hiện tại của tài liệu (group/bu/site/dept).
- KHÔNG làm chức năng nới scope (để spec riêng). KHÔNG gửi ra ngoài scope.
- Chỉ Author (người đăng ký). Tài liệu phải đang `da_ban_hanh`.
- Chặn khi có từ chối "sai nội dung" (nội dung đang nghi sai, không phát tán thêm).
- Cho phát hành lại site đã từ chối "sai đăng ký"; site từ chối "sai nội dung"
  đi đường thu hồi + ban hành bản mới (ngoài phạm vi spec này).

Không đổi schema. Tái dùng `publishToSites`, `candidateSitesForScope`.

## Requirements

### Requirement 1: Author phát hành thêm site trong scope

**User Story:** Là người đăng ký (Author), tôi muốn phát hành tài liệu đã ban
hành tới thêm site trong phạm vi của nó, để không phải thu hồi làm lại khi bổ
sung nơi nhận.

#### Acceptance Criteria
1. WHEN Author mở trang "Tình trạng ban hành" của tài liệu `da_ban_hanh` của mình
   THEN hệ thống SHALL hiển thị danh sách site CÓ THỂ THÊM = các site thuộc scope
   của tài liệu MÀ chưa có receipt.
2. WHEN Author chọn một hoặc nhiều site có thể thêm và xác nhận THEN hệ thống
   SHALL tạo receipt trạng thái "cho_phan_hoi" cho mỗi site đó.
3. WHERE một site đã có receipt (chờ/chấp nhận) THE system SHALL KHÔNG tạo lại,
   KHÔNG đổi trạng thái receipt hiện có (idempotent qua `ON CONFLICT DO NOTHING`).
4. The system SHALL chỉ cho người ĐĂNG KÝ tài liệu thực hiện; người khác nhận
   403.
5. The system SHALL ghi vết sự kiện phát hành thêm (tái dùng event `ban_hanh`).

### Requirement 2: Chỉ site trong scope, không ra ngoài scope

**User Story:** Là người bảo trì, tôi muốn site thêm vào luôn nằm trong phạm vi
tài liệu, để không phá vỡ ranh giới phân quyền xem.

#### Acceptance Criteria
1. The system SHALL xác định tập site hợp lệ bằng `candidateSitesForScope` theo
   scope hiện tại của tài liệu (group→mọi site; bu→site thuộc BU; site→đúng site;
   dept→site chứa dept).
2. IF một `site_id` gửi lên KHÔNG thuộc tập hợp lệ THEN hệ thống SHALL từ chối
   (không tạo receipt cho site đó) và báo lỗi nghiệp vụ.
3. The system SHALL NOT sửa scope của tài liệu (`documents.scope_*`).

### Requirement 3: Chặn khi có từ chối sai nội dung

**User Story:** Là người kiểm soát chất lượng, tôi muốn ngăn phát tán thêm khi
tài liệu đang bị nghi sai nội dung, để không lan bản sai.

#### Acceptance Criteria
1. IF tài liệu có ít nhất một receipt trạng thái "tu_choi" với loại "sai_noi_dung"
   THEN hệ thống SHALL chặn mọi thao tác phát hành thêm/ phát hành lại và báo rõ
   phải thu hồi + ban hành bản mới.
2. WHERE chỉ có từ chối loại "sai_dang_ky" (không có "sai_noi_dung") THE system
   SHALL cho phép tiếp tục (vì chỉ sai metadata).

### Requirement 4: Phát hành lại site đã từ chối sai đăng ký

**User Story:** Là Author, sau khi đã sửa thông tin đăng ký, tôi muốn phát hành
lại cho site từng từ chối "sai đăng ký", để site đó tiếp nhận lại bản đã sửa.

#### Acceptance Criteria
1. WHEN Author chọn phát hành lại một site có receipt "tu_choi" loại "sai_dang_ky"
   THEN hệ thống SHALL đưa receipt đó về "cho_phan_hoi", xóa loại lỗi + lý do cũ
   trên receipt, và cập nhật mốc thời gian.
2. The system SHALL KHÔNG cho phát hành lại site có receipt "tu_choi" loại
   "sai_noi_dung" (đi đường thu hồi + bản mới) — nhất quán với Requirement 3.
3. The system SHALL ghi vết việc phát hành lại (ai, site nào, khi nào), giữ dấu
   vết lý do từ chối cũ trong nhật ký để truy xuất.
4. WHERE một site đang "chap_nhan" THE system SHALL KHÔNG đụng tới (không reset
   site đã chấp nhận).

### Requirement 5: Giao diện trên trang Tình trạng ban hành

**User Story:** Là Author, tôi muốn thao tác phát hành thêm/ lại ngay trên trang
tình trạng ban hành, để làm liền mạch cùng chỗ theo dõi receipt.

#### Acceptance Criteria
1. WHEN mở trang "Tình trạng ban hành" (`issuance-status.eta`) THEN hệ thống
   SHALL hiển thị khu "Phát hành thêm site" liệt kê site có thể thêm (nếu có).
2. IF không còn site nào trong scope để thêm THEN hệ thống SHALL ẩn khu này hoặc
   nêu rõ "đã phát hành tới mọi site trong phạm vi".
3. WHERE tài liệu bị chặn bởi Requirement 3 THE system SHALL ẩn/ vô hiệu khu phát
   hành thêm và hiển thị lý do.
4. The system SHALL hiển thị rõ site nào là "thêm mới" và site nào là "phát hành
   lại (đã từ chối sai đăng ký)".

### Requirement 6: Không thay đổi ngoài phạm vi

**User Story:** Là người bảo trì, tôi muốn thay đổi an toàn, không chạm vùng
ngoài phạm vi.

#### Acceptance Criteria
1. The system SHALL NOT thêm migration / đổi schema (bảng, cột, ràng buộc).
2. The system SHALL NOT đổi luồng đăng ký ban đầu, thu hồi, xóa, sửa metadata.
3. The system SHALL NOT nới lỏng quyền xem tài liệu của bất kỳ vai nào.

## Glossary

- **Receipt:** bản ghi (một phiên bản × một site) theo dõi tiếp nhận/từ chối của
  site với tài liệu; trạng thái cho_phan_hoi | chap_nhan | tu_choi.
- **Scope (phạm vi):** ranh giới phân phối/xem của tài liệu: group | bu | site |
  dept; lưu ở `documents.scope_*`.
- **Phát hành thêm:** tạo receipt mới cho site TRONG scope mà chưa có receipt.
- **Phát hành lại:** đưa receipt "tu_choi" loại "sai_dang_ky" của một site về
  "cho_phan_hoi" để site tiếp nhận lại bản đã sửa.
- **Từ chối sai đăng ký (`sai_dang_ky`):** site trả lại do sai metadata; sửa là đủ.
- **Từ chối sai nội dung (`sai_noi_dung`):** site trả lại do nghi sai nội dung;
  cần thu hồi + ban hành bản mới.
