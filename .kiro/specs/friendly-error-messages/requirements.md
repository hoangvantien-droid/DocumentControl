# Requirements Document

## Introduction

Hiện tại khi một thao tác vi phạm quy tắc nghiệp vụ (BusinessError), route trả
về một TRANG TEXT TRẮNG chỉ có dòng lỗi (reply.send(err.message)) — người dùng
bị chuyển khỏi màn đang làm, mất ngữ cảnh, phải bấm Back. Ví dụ: bấm "In bản
sao có kiểm soát" khi tài liệu chưa hiệu lực thì nhảy sang trang trắng ghi "Chỉ
in được bản đang hiệu lực".

Spec này chuẩn hóa cách hiển thị lỗi nghiệp vụ: thay vì chuyển trang, hiện
CẢNH BÁO NGAY TRÊN TRANG người dùng đang đứng (dạng dải/toast), giữ nguyên ngữ
cảnh. Áp dụng cho TOÀN BỘ các điểm trả BusinessError (20 điểm, 10 route).

Ràng buộc: chỉ đổi tầng trình bày lỗi + cách gửi (htmx fragment). KHÔNG đổi quy
tắc nghiệp vụ, mã lỗi, hay HTTP status của BusinessError.

## Glossary

- BusinessError: lỗi quy tắc nghiệp vụ có mã + thông điệp + httpStatus (lib/errors).
- Cảnh báo tại chỗ (inline alert / toast): thông báo hiện trên trang hiện tại,
  không rời trang.
- htmx: thư viện đã dùng trong dự án để gửi request và chèn fragment HTML.
- Fragment lỗi: mẩu HTML cảnh báo server trả về để htmx chèn vào vùng đích.

## Requirements

### Requirement 1: Hiển thị lỗi nghiệp vụ tại chỗ, không rời trang

**User Story:** Là người dùng, khi thao tác bị chặn bởi quy tắc nghiệp vụ, tôi
muốn thấy cảnh báo ngay trên màn đang làm, để không mất ngữ cảnh và không phải
bấm Back.

#### Acceptance Criteria
1. KHI một thao tác (form/nút) gây BusinessError, HỆ THỐNG PHẢI hiện thông điệp
   lỗi dưới dạng cảnh báo trên trang hiện tại, KHÔNG chuyển sang trang text trắng.
2. HỆ THỐNG PHẢI giữ nguyên trang và dữ liệu người dùng đang xem/nhập.
3. Cảnh báo PHẢI dùng chính err.message (tiếng Việt, đã có sẵn).
4. HỆ THỐNG PHẢI KHÔNG đổi mã lỗi hay httpStatus của BusinessError.

### Requirement 2: Cơ chế kỹ thuật qua htmx

**User Story:** Là người bảo trì, tôi muốn một cơ chế thống nhất để hiển thị
lỗi tại chỗ, tránh lặp code từng route.

#### Acceptance Criteria
1. Các nút/thao tác POST có khả năng gây BusinessError PHẢI gửi qua htmx và có
   vùng đích hiển thị cảnh báo.
2. KHI BusinessError xảy ra, route PHẢI trả một FRAGMENT cảnh báo (HTML nhỏ)
   kèm HTTP status lỗi, để htmx chèn vào vùng đích.
3. KHI thao tác thành công, HỆ THỐNG PHẢI điều hướng/cập nhật như hành vi hiện
   tại (không hồi quy luồng thành công).
4. HỆ THỐNG PHẢI có một component cảnh báo dùng chung (tái dùng alert-banner/toast).

### Requirement 3: Phạm vi áp dụng toàn bộ

**User Story:** Là người dùng, tôi muốn mọi lỗi nghiệp vụ hiển thị nhất quán.

#### Acceptance Criteria
1. HỆ THỐNG PHẢI áp cơ chế cảnh báo tại chỗ cho TẤT CẢ điểm hiện trả
   reply.send(err.message) trong các route (in, thu hồi, phản hồi receipt, báo
   bất thường, đăng ký, gói, rà soát, quản trị...).
2. NẾU một thao tác không phù hợp htmx (vd GET điều hướng), HỆ THỐNG CÓ THỂ giữ
   cách hiện tại nhưng PHẢI bọc trong trang có layout (không text trần).

### Requirement 4: Khả dụng và thân thiện

**User Story:** Là người dùng điện thoại, tôi muốn cảnh báo dễ thấy, dễ đóng.

#### Acceptance Criteria
1. Cảnh báo PHẢI nổi bật (màu + biểu tượng/chữ "Cảnh báo"), không chỉ dựa màu sắc.
2. Cảnh báo PHẢI đọc được trên mobile (không tràn, đủ tương phản).
3. NẾU là toast tự ẩn, PHẢI đủ thời gian đọc; NẾU là dải, PHẢI có cách bỏ qua
   hoặc tự biến mất khi thao tác lại.

### Requirement 5: Không hồi quy

**User Story:** Là người bảo trì, tôi muốn thay đổi hiển thị lỗi không làm hỏng luồng thành công hay che giấu lỗi hệ thống.

#### Acceptance Criteria
1. HỆ THỐNG PHẢI biên dịch (tsc) sạch và mọi .eta compile được.
2. Luồng thành công của mọi thao tác PHẢI giữ nguyên.
3. Lỗi KHÔNG phải BusinessError (lỗi hệ thống) PHẢI vẫn trả 500 như cũ (không
   che giấu lỗi thật).
