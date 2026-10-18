# Requirements Document

## Introduction

Hệ thống DCS quản lý kiểm soát tài liệu cho khối MAKE. Spec này có hai mục tiêu:

1. Chuẩn hóa TOÀN BỘ ngôn từ hiển thị theo vốn từ kiểm soát tài liệu của ISO
   9001:2015 (điều khoản 7.5 — Thông tin dạng văn bản), giữ tiếng Việt và dùng
   thuật ngữ ISO tiếng Việt.
2. Làm MỌI màn hình thân thiện thiết bị di động: bảng -> thẻ, không tràn ngang,
   nút đủ lớn để chạm, form/panel vừa màn hẹp.

Ràng buộc xuyên suốt: CHỈ đổi chữ hiển thị. KHÔNG đổi mã enum, giá trị
name/value của form, khóa nghiệp vụ, hay schema CSDL. Mọi nhãn đi qua nguồn tập
trung (src/views/labels.ts) hoặc chuỗi tĩnh trong các tệp .eta.

## Glossary

Bảng đối chiếu định hướng (chốt từng chuỗi ở Design sau khi quét labels.ts + .eta):

- Tài liệu (document): giữ nguyên.
- Hồ sơ (record): bằng chứng thực hiện; không nhầm với "tài liệu".
- Kiểm soát tài liệu (control of documents): giữ nguyên.
- Ban hành (issue/release): giữ nguyên.
- Phê duyệt (approval): diễn ra ngoài hệ thống.
- Có hiệu lực / hiện hành (current/valid): ưu tiên "có hiệu lực".
- Ngày có hiệu lực (effective date).
- Lỗi thời (obsolete): tài liệu hết hiệu lực.
- Thu hồi (withdrawal): giữ nguyên.
- Phân phối có kiểm soát (controlled distribution).
- Bản sao có kiểm soát (controlled copy): thay cho "bản in kiểm soát".
- Phiên bản (revision/version): giữ nguyên.
- Số hiệu tài liệu (document number).
- Phạm vi áp dụng (scope of application).
- Xác nhận tiếp nhận (acknowledge receipt): thay cho "xác nhận nhận".
- Báo cáo sự không phù hợp (nonconformity report): thay cho "báo bất thường".
- Xem xét định kỳ (periodic review): thay cho "rà soát định kỳ".

## Requirements

### Requirement 1: Chuẩn hóa thuật ngữ qua nguồn nhãn tập trung

**User Story:** Là người dùng, tôi muốn mọi nhãn trạng thái/vai trò/phạm vi dùng
đúng thuật ngữ ISO 9001, để hệ thống nhất quán với hồ sơ chất lượng.

#### Acceptance Criteria
1. KHI hiển thị trạng thái/vai trò/phạm vi, HỆ THỐNG PHẢI lấy nhãn từ
   src/views/labels.ts và KHÔNG in mã enum.
2. Nhãn trong labels.ts PHẢI theo bảng đối chiếu ISO 9001 chốt ở Design.
3. KHI đổi nhãn, HỆ THỐNG PHẢI KHÔNG đổi giá trị enum/mã nghiệp vụ.
4. NẾU mã lạ hoặc thiếu, HỆ THỐNG PHẢI trả về chính mã (an toàn, lộ sớm khi test).

### Requirement 2: Chuẩn hóa chuỗi tĩnh trong mọi .eta

**User Story:** Là người dùng, tôi muốn tiêu đề, nhãn nút, nhãn trường, thông báo
trên mọi màn dùng đúng thuật ngữ ISO 9001.

#### Acceptance Criteria
1. HỆ THỐNG PHẢI rà toàn bộ chuỗi hiển thị trong mọi tệp .eta (layout, màn,
   component) và chỉnh theo bảng đối chiếu.
2. NẾU một chuỗi là tên hành động, nhãn nút và thông báo kết quả PHẢI nhất quán
   (ví dụ nút "Ban hành" -> thông báo "Đã ban hành").
3. HỆ THỐNG PHẢI giữ tiếng Việt và dùng thuật ngữ ISO tiếng Việt.

### Requirement 3: Bảng dữ liệu thân thiện mobile (thẻ)

**User Story:** Là người dùng điện thoại, tôi muốn các bảng hiển thị dạng thẻ dọc
thay vì cuộn ngang.

#### Acceptance Criteria
1. KHI chiều rộng màn <= 768px, MỌI bảng dữ liệu (my-documents, catalog,
   site-receipts, issue-reports, reviews, packages, audit, admin,
   functional-groups, search-results, ma trận site ở issuance) PHẢI hiển thị
   dạng thẻ: một dòng = một thẻ, mỗi ô = "Nhãn: giá trị".
2. HỆ THỐNG PHẢI KHÔNG gây cuộn ngang; giá trị dài PHẢI tự xuống dòng.
3. MỖI bảng dạng thẻ PHẢI dùng cơ chế chung (class + thuộc tính data-label),
   không lặp CSS riêng cho từng bảng.
4. "Tài liệu của tôi" (my-documents) PHẢI chuyển sang dạng thẻ trên mobile.

### Requirement 4: Form và panel thân thiện mobile

**User Story:** Là người dùng điện thoại, tôi muốn form và panel vừa màn hẹp.

#### Acceptance Criteria
1. KHI màn <= 768px, input/select/textarea trong form PHẢI chiếm đủ chiều rộng
   và cao tối thiểu 44px.
2. Lưới nhiều cột (chi tiết, phản hồi, issuance) PHẢI xếp một cột trên mobile.
3. Bộ lọc danh mục PHẢI xếp dọc, mỗi điều khiển đủ rộng.
4. Thanh điều hướng PHẢI dùng drawer/hamburger trên mobile (đã có — PHẢI giữ).

### Requirement 5: Nút và vùng chạm

**User Story:** Là người dùng điện thoại, tôi muốn nút đủ lớn, không chạm nhầm.

#### Acceptance Criteria
1. Nút hành động chính trên mobile PHẢI cao tối thiểu 44px.
2. Các link hành động trong cùng một ô PHẢI đủ khoảng cách để không chạm nhầm.

### Requirement 6: Không hồi quy chức năng và hiển thị desktop

**User Story:** Là người bảo trì, tôi muốn thay đổi ngôn từ/responsive không làm
hỏng chức năng hay giao diện desktop.

#### Acceptance Criteria
1. HỆ THỐNG PHẢI biên dịch (tsc) sạch và mọi tệp .eta PHẢI compile được.
2. HỆ THỐNG PHẢI giữ nguyên mọi hành vi route và phân quyền hiện có.
3. TRÊN desktop, bảng PHẢI vẫn hiển thị dạng bảng như hiện tại.

### Requirement 7: Phạm vi và giới hạn

**User Story:** Là người bảo trì, tôi muốn phạm vi rõ ràng để tránh thay đổi
ngoài ý định.

#### Acceptance Criteria
1. HỆ THỐNG PHẢI KHÔNG đổi schema, enum, hay mã nghiệp vụ.
2. HỆ THỐNG PHẢI KHÔNG thêm tính năng mới; chỉ ngôn từ và responsive.
3. HỆ THỐNG PHẢI KHÔNG dịch giao diện sang tiếng Anh.
