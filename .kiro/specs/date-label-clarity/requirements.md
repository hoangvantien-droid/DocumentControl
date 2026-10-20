# Requirements Document

## Introduction

Hệ thống có ba trường ngày với ý nghĩa khác nhau, nhưng nhãn hiển thị đang gây
nhầm lẫn — tàn dư thuật ngữ từ mô hình "rollout" cũ đã gỡ, nay chạy theo mô hình
"receipt theo site".

Thực trạng theo code:

| Trường (DB) | Thuộc | Ý nghĩa thực | Nhãn hiện tại | Nơi hiển thị |
|---|---|---|---|---|
| `issued_date` | phiên bản tài liệu | Ngày ban hành (schema ghi: "ngày ban hành") | **"Ngày áp dụng dự kiến"** (sai) | `register.eta`, `detail.eta` |
| `effective_date` | phiên bản tài liệu | Ngày tài liệu có hiệu lực (dùng chung mọi site) | "Ngày có hiệu lực" (đúng) | `register.eta`, `detail.eta` |
| `apply_date` | receipt theo **site** | Ngày site thực sự áp dụng — ghi lúc site "Xác nhận tiếp nhận" | "Ngày áp dụng" (đúng) | `site-response-matrix.eta` (chỉ ở trang Tình trạng ban hành) |

Vấn đề cốt lõi:
1. `issued_date` bị gán nhãn "Ngày áp dụng dự kiến" — sai nghĩa, dễ hiểu lầm là
   ngày áp dụng theo site. Thực chất là **ngày ban hành** của phiên bản.
2. Người xem trang chi tiết tài liệu không thấy được ngày áp dụng thực tế theo
   từng site (`apply_date`) — chỉ thấy ở trang "Tình trạng ban hành" của Author.

Phạm vi: CHỈ chỉnh nhãn hiển thị và bổ sung hiển thị ngày áp dụng theo site —
KHÔNG đổi schema, tên cột, hay nghiệp vụ.

## Requirements

### Requirement 1: Đổi nhãn `issued_date` cho đúng nghĩa

**User Story:** Là người dùng, tôi muốn nhãn của `issued_date` phản ánh đúng
rằng đây là ngày ban hành, để không nhầm với ngày áp dụng theo site.

#### Acceptance Criteria
1. WHEN hiển thị form đăng ký tài liệu (`register.eta`) THEN hệ thống SHALL đặt
   nhãn ô nhập `issued_date` là "Ngày ban hành" thay cho "Ngày áp dụng dự kiến".
2. WHEN hiển thị trang chi tiết tài liệu (`detail.eta`) THEN hệ thống SHALL đặt
   nhãn giá trị `issued_date` là "Ngày ban hành" thay cho "Ngày áp dụng dự kiến".
3. The system SHALL NOT đổi tên cột DB `issued_date`, kiểu dữ liệu, hay bất kỳ
   route/logic nào — chỉ đổi chuỗi nhãn hiển thị.
4. WHERE cụm từ "Ngày áp dụng dự kiến" còn xuất hiện ở bất kỳ view nào khác THE
   system SHALL đổi đồng bộ sang thuật ngữ đã chốt.

### Requirement 2: Giữ nguyên nhãn đã đúng

**User Story:** Là người dùng, tôi muốn các nhãn đã đúng được giữ nguyên để
tránh thay đổi không cần thiết.

#### Acceptance Criteria
1. The system SHALL giữ nhãn "Ngày có hiệu lực" cho `effective_date`.
2. The system SHALL giữ nhãn "Ngày áp dụng" cho `apply_date` trong ma trận phản
   hồi theo site.

### Requirement 3: Hiển thị ngày áp dụng theo site trên trang chi tiết

**User Story:** Là người đọc/kiểm soát tài liệu, tôi muốn thấy từng site đã áp
dụng tài liệu vào ngày nào ngay trên trang chi tiết, để biết tình trạng áp dụng
thực tế mà không phải sang trang khác.

#### Acceptance Criteria
1. WHEN mở trang chi tiết một tài liệu đã ban hành có ít nhất một receipt THEN
   trang SHALL hiển thị danh sách site kèm `apply_date` cho các site đã chấp nhận.
2. WHERE một site chưa áp dụng (chưa `chap_nhan`) THE system SHALL thể hiện rõ là
   chưa có ngày áp dụng (để trống hoặc ghi trạng thái tiếp nhận).
3. IF tài liệu chưa phát hành tới site nào THEN hệ thống SHALL ẩn phần này hoặc
   nêu rõ "chưa phát hành tới site nào".
4. WHEN bất kỳ người dùng nào MỞ ĐƯỢC trang chi tiết tài liệu (Author, DC Site,
   Reader, Admin — theo quyền xem hiện có) THEN họ SHALL thấy bảng site áp dụng
   này. Đây là mở rộng HIỂN THỊ (thông tin receipt vốn gắn với tài liệu), KHÔNG
   nới quyền xem tài liệu và KHÔNG thêm quyền thao tác.
5. The system SHALL NOT thêm bất kỳ nút/hành động nào (chấp nhận/từ chối/sửa)
   trong bảng site áp dụng ở trang chi tiết — chỉ đọc. Các hành động giữ nguyên ở
   trang Tình trạng ban hành của Author.
6. The system SHALL tái dùng thành phần ma trận phản hồi theo site đã có nếu phù
   hợp, tránh trùng lặp logic.

### Requirement 4: Nhất quán thuật ngữ

**User Story:** Là người dùng, tôi muốn thuật ngữ ngày nhất quán toàn ứng dụng
để dễ hiểu và đúng chuẩn.

#### Acceptance Criteria
1. The system SHALL dùng ba nhãn cố định, không trộn lẫn: `issued_date` → "Ngày
   ban hành"; `effective_date` → "Ngày có hiệu lực"; `apply_date` (site) → "Ngày
   áp dụng" / "Ngày site áp dụng".
2. WHEN hoàn tất THEN hệ thống SHALL không còn chuỗi "Ngày áp dụng dự kiến" ở bất
   kỳ view nào.

### Requirement 5: Không thay đổi ngoài phạm vi

**User Story:** Là người bảo trì, tôi muốn thay đổi này an toàn, không chạm vào
dữ liệu hay nghiệp vụ.

#### Acceptance Criteria
1. The system SHALL NOT đổi schema, tên cột, hoặc kiểu dữ liệu.
2. The system SHALL NOT đổi route, luồng nghiệp vụ, hoặc điều kiện quyền.
3. The system SHALL NOT thêm trường ngày mới vào DB.

## Glossary

- **Ngày ban hành (`issued_date`):** ngày phiên bản tài liệu được ban hành; do
  người đăng ký khai. Dùng chung cho mọi site.
- **Ngày có hiệu lực (`effective_date`):** ngày tài liệu bắt đầu có hiệu lực;
  dùng chung mọi site; là mốc tính `next_review_date`.
- **Ngày áp dụng (`apply_date`):** ngày một SITE cụ thể thực sự áp dụng; ghi khi
  site chuyển receipt sang "Đã chấp nhận". Mỗi site một mốc.
- **Receipt:** bản ghi (một phiên bản × một site) theo dõi tiếp nhận/từ chối của
  site đối với tài liệu.
- **Rollout (cũ):** mô hình "áp dụng lệch pha theo lịch" đã gỡ khỏi runtime; là
  nguồn gốc của nhãn "Ngày áp dụng dự kiến" còn sót.
