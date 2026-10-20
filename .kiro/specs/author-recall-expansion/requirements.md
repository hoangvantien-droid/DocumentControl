# Requirements Document

## Introduction

Hiện `recallByAuthor` CHẶN thu hồi khi `accepted > 0 AND rejected === 0` (mọi/một
phần site đã chấp nhận, không ai từ chối) — buộc Author đi đường "ra phiên bản
mới". Thực tế có tình huống Author thấy cần THAY THẾ tài liệu ngay cả khi các
site đã chấp nhận; khóa cứng khiến người ta lách.

Hướng đã chốt:
- MỞ quyền: Author thu hồi được ở mọi trạng thái `da_ban_hanh`, KỂ CẢ khi mọi
  site đã chấp nhận (bỏ chặn `recall.locked`).
- Có KIỂM SOÁT: bắt buộc lý do (đã có) + màn thu hồi HIỂN THỊ TÁC ĐỘNG (số site
  đã chấp nhận/đang áp dụng) + GHI VẾT ĐẬM (kèm số liệu tại thời điểm thu hồi).
- THÔNG BÁO Mức A (in-app, không hạ tầng mới): DC Site của MỌI site có receipt
  của tài liệu thấy nhắc "tài liệu đã bị thu hồi" để ngừng dùng / thu bản in.

Không dựng kênh notification mới (email/chuông). Dùng hiển thị dẫn xuất từ dữ
liệu sẵn có (version status = thu_hoi + receipt theo site).

## Requirements

### Requirement 1: Author thu hồi được kể cả khi site đã chấp nhận

**User Story:** Là Author, khi thấy cần thay thế tài liệu, tôi muốn thu hồi được
ngay cả khi các site đã chấp nhận, để không bị kẹt bởi khóa cứng.

#### Acceptance Criteria
1. WHEN Author thu hồi một tài liệu `da_ban_hanh` của mình THEN hệ thống SHALL
   cho phép bất kể số site đã chấp nhận/từ chối/chờ (BỎ chặn `recall.locked`).
2. The system SHALL vẫn bắt buộc nhập lý do thu hồi (không rỗng).
3. The system SHALL chỉ cho người ĐĂNG KÝ tài liệu thu hồi (giữ kiểm quyền 403
   như hiện tại).
4. The system SHALL chỉ cho thu hồi khi tài liệu đang `da_ban_hanh` (không áp cho
   `thu_hoi`/`het_hieu_luc`/nháp).

### Requirement 2: Màn thu hồi hiển thị tác động

**User Story:** Là Author, trước khi thu hồi tôi muốn thấy rõ tác động để cân
nhắc, tránh rút nhầm tài liệu đang được áp dụng.

#### Acceptance Criteria
1. WHEN mở màn thu hồi (`author-recall.eta`) THEN hệ thống SHALL hiển thị số site
   đã chấp nhận, số từ chối, số chờ, tổng site.
2. WHERE có ≥1 site đã chấp nhận THE system SHALL cảnh báo rõ: thu hồi sẽ làm tài
   liệu mất hiệu lực ở các site đang áp dụng; gợi ý cân nhắc ra phiên bản mới
   thay thế.
3. The system SHALL giữ liên kết/ hướng dẫn đăng ký bản mới (supersede) như hiện
   có.

### Requirement 3: Ghi vết đậm khi thu hồi

**User Story:** Là người kiểm soát, tôi muốn thu hồi được truy vết đầy đủ.

#### Acceptance Criteria
1. WHEN thu hồi thành công THEN hệ thống SHALL ghi audit (event `thu_hoi`) kèm:
   lý do, và số liệu receipt tại thời điểm thu hồi (accepted/rejected/pending/
   total) + danh sách site bị ảnh hưởng.
2. The system SHALL giữ nguyên các dữ liệu receipt (không xóa) để truy xuất lịch
   sử phản hồi của site.

### Requirement 4: Nhắc DC Site về tài liệu bị thu hồi (Mức A, mọi site)

**User Story:** Là DC Site, tôi muốn biết tài liệu đã phát hành tới site mình bị
thu hồi, để ngừng sử dụng và thu bản in.

#### Acceptance Criteria
1. WHEN một tài liệu bị thu hồi AND có receipt tới một site người dùng phụ trách
   THEN DC Site SHALL thấy tài liệu đó trong một mục nhắc "Tài liệu bị thu hồi"
   (in-app), bất kể receipt của site đó ở trạng thái nào (mọi site có receipt).
2. The system SHALL hiển thị tối thiểu: số hiệu + phiên bản, tiêu đề, lý do thu
   hồi, và trạng thái tiếp nhận trước đó của site (nếu hữu ích).
3. The system SHALL là CHỈ ĐỌC — không hành động; chỉ để site biết mà xử lý ngoài
   hệ thống (ngừng dùng, thu bản in).
4. IF không có tài liệu bị thu hồi nào ảnh hưởng site người dùng THEN mục này
   SHALL ẩn hoặc nêu rõ "không có".
5. The system SHALL dùng dữ liệu sẵn có (version status `thu_hoi` + receipt theo
   site) — KHÔNG dựng bảng/kênh notification mới, KHÔNG gửi email/push.

### Requirement 5: Không thay đổi ngoài phạm vi

**User Story:** Là người bảo trì, tôi muốn thay đổi an toàn.

#### Acceptance Criteria
1. The system SHALL NOT thêm migration / đổi schema (giữ bảng document_receipt,
   document_versions).
2. The system SHALL NOT dựng hạ tầng notification (bảng thông báo, chuông, email).
3. The system SHALL NOT đổi luồng chấp nhận/từ chối receipt, đăng ký, xem xét.
4. The system SHALL NOT nới quyền xem tài liệu của vai khác.

## Glossary

- **Thu hồi (recall):** Author chuyển version sang `thu_hoi` kèm lý do; tài liệu
  mất hiệu lực.
- **Chặn `recall.locked`:** luật cũ chặn thu hồi khi đã có chấp nhận và không có
  từ chối — spec này GỠ.
- **Tác động:** số site đã chấp nhận/từ chối/chờ tại thời điểm thu hồi.
- **Nhắc Mức A:** hiển thị in-app dẫn xuất (không kênh notification mới) cho DC
  Site của các site có receipt.
