# Requirements Document

## Introduction

Trường `expiry_date` (ngày hết hạn tài liệu — tùy chọn khi đăng ký) hiện gần như
"trơ": chỉ có preset "Sắp hết hạn 30 ngày" (`expiring30`) và sắp xếp
`sap_het_han` ở Danh mục. KHÔNG có lối tập trung cho tài liệu ĐÃ QUÁ hạn
(`expiry_date < CURRENT_DATE`): không preset lọc, không cảnh báo ở trang chi
tiết, không tự đổi trạng thái.

Lưu ý phân biệt (hai trục riêng, GIỮ tách bạch):
- "Hết hạn" = `expiry_date` đã qua (spec này).
- "Quá hạn xem xét" = `next_review_date` đã qua (đã có: cờ `qua_han_xem_xet`,
  trang /reviews). KHÔNG gộp.

Hướng đã chốt (mặc định):
- (1a) CHỈ cảnh báo/lọc — KHÔNG tự chuyển trạng thái, KHÔNG job nền, KHÔNG đổi
  vòng đời.
- (2) Thêm preset "Đã hết hạn" ở Danh mục + banner cảnh báo ở trang chi tiết.
- (3) Mọi người xem được tài liệu đều thấy cảnh báo.
- (4) Tách bạch "hết hạn" và "quá hạn xem xét" (hai cảnh báo riêng).

Không migration, không đổi schema. Tái dùng mẫu `alert-banner` + cờ tính trong
truy vấn như `qua_han_xem_xet`.

## Requirements

### Requirement 1: Cảnh báo "đã hết hạn" trên trang chi tiết

**User Story:** Là người xem tài liệu, tôi muốn thấy cảnh báo khi tài liệu đã quá
ngày hết hạn, để không dùng nhầm tài liệu hết hiệu lực sử dụng.

#### Acceptance Criteria
1. WHEN mở trang chi tiết một tài liệu có `expiry_date` không rỗng AND
   `expiry_date < CURRENT_DATE` THEN hệ thống SHALL hiển thị banner cảnh báo
   nêu rõ tài liệu đã quá ngày hết hạn (kèm ngày hết hạn).
2. WHERE tài liệu không có `expiry_date` hoặc chưa quá hạn THE system SHALL KHÔNG
   hiển thị banner này.
3. The system SHALL hiển thị cảnh báo "đã hết hạn" ĐỘC LẬP với cảnh báo "quá hạn
   xem xét" (`qua_han_xem_xet`) — có thể cùng xuất hiện, mỗi cái một banner.
4. WHEN bất kỳ ai xem được trang chi tiết (Author/DC Site/Reader/Admin) THEN họ
   SHALL thấy banner này; KHÔNG nới quyền xem.

### Requirement 2: Preset lọc "Đã hết hạn" trong Danh mục

**User Story:** Là người dùng, tôi muốn lọc nhanh các tài liệu đã quá hạn trong
Danh mục, để rà soát/xử lý.

#### Acceptance Criteria
1. WHEN người dùng chọn preset "Đã hết hạn" (vd `expired`) THEN Danh mục SHALL
   chỉ liệt kê tài liệu có `expiry_date` không rỗng AND `expiry_date <
   CURRENT_DATE`.
2. The system SHALL thêm liên kết lọc nhanh "Đã hết hạn" vào dải preset và một
   mục trong ô chọn preset.
3. The system SHALL giữ nguyên preset `expiring30` ("Sắp hết hạn 30 ngày") và
   sắp xếp `sap_het_han` hiện có.
4. The system SHALL áp lọc TRƯỚC trong truy vấn (không lọc sau), nhất quán với
   các preset khác.

### Requirement 3: Không đổi vòng đời / không job nền

**User Story:** Là người bảo trì, tôi muốn việc hết hạn chỉ là chỉ báo, không
thay đổi trạng thái ngầm.

#### Acceptance Criteria
1. The system SHALL NOT tự chuyển trạng thái tài liệu khi quá `expiry_date`
   (không het_hieu_luc/thu_hoi tự động).
2. The system SHALL NOT thêm job nền / cron.
3. The system SHALL NOT đổi điều kiện "hiện hành" (`isCurrentlyEffective`) hay
   quyền xem — tài liệu quá hạn vẫn hiển thị như trước, chỉ thêm chỉ báo.

### Requirement 4: Không thay đổi ngoài phạm vi

**User Story:** Là người bảo trì, tôi muốn thay đổi an toàn, chỉ ở hiển thị + lọc.

#### Acceptance Criteria
1. The system SHALL NOT thêm migration / đổi schema (giữ cột `expiry_date`).
2. The system SHALL NOT đổi luồng đăng ký/sửa/thu hồi/xem xét định kỳ.
3. The system SHALL tái dùng mẫu `components/alert-banner.eta` cho banner.

## Glossary

- **Ngày hết hạn (`expiry_date`):** ngày tài liệu hết hạn sử dụng; tùy chọn; nếu
  có thì phải lớn hơn `effective_date`.
- **Đã hết hạn:** `expiry_date` không rỗng và `< CURRENT_DATE`.
- **Sắp hết hạn 30 ngày (`expiring30`):** `expiry_date` trong khoảng [hôm nay,
  hôm nay + 30 ngày] — ĐÃ CÓ, giữ nguyên.
- **Quá hạn xem xét (`qua_han_xem_xet`):** `next_review_date < CURRENT_DATE` —
  trục RIÊNG, không thuộc spec này.
