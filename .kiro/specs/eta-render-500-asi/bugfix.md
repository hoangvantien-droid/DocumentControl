# Bugfix Requirements Document

## Introduction

Nhiều trang của DCS trả về HTTP 500 khi kết xuất phía máy chủ (SSR) bằng Eta. Ba
triệu chứng đã xác nhận trên production (https://tienhv.io.vn/dcs/):

- `GET /dcs/admin/roles` → `{"statusCode":500,"message":"\")</small></td>\n...\" is not a function"}`
- `GET /dcs/functional-groups` → `{"statusCode":500,"message":"\"</td>\n      <td>\n        \" is not a function"}`
- `GET /dcs/register` → `{"statusCode":500,"message":"Cannot read properties of undefined (reading 'forEach')"}`

Điều tra bằng cách kết xuất thật các view với dữ liệu giả (không cần PostgreSQL)
cho thấy cả ba là **cùng một lỗi gốc**, chỉ khác biểu hiện. Đây KHÔNG phải lỗi dữ
liệu và KHÔNG phải mẫu `(<%= expr %>)` như phỏng đoán ban đầu — các trang có mẫu
`(<%= expr %>)` (home.eta, reviews.eta, detail.eta) kết xuất bình thường.

Lỗi gốc: Eta 3.5.0 sinh mã JavaScript **không có dấu chấm phẩy cuối câu**. Khi một
câu lệnh xuất chuỗi (`__eta.res += '...'` hoặc `__eta.res += __eta.e(expr)`) đứng
ngay trước một dòng mã bắt đầu bằng `(` hoặc `[`, cơ chế Tự động Chèn Chấm phẩy
(ASI) của JavaScript **không** chèn dấu `;`, nên hai dòng bị nối làm một câu:

- Dòng sau bắt đầu bằng `(` → chuỗi phía trước bị "gọi như hàm" → `"..." is not a function`.
- Dòng sau bắt đầu bằng `[` → chuỗi phía trước bị "truy cập chỉ mục" kèm toán tử dấu
  phẩy → trả về `undefined` → `Cannot read properties of undefined (reading 'forEach')`.

Ảnh hưởng: các trang quản trị và nghiệp vụ cốt lõi sập hoàn toàn (500), người dùng
không mở được. Phạm vi thực tế rộng hơn 3 trang đã báo (xem mục dưới và design.md).

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN một view `.eta` có một câu xuất chuỗi đứng ngay trước một scriptlet mở đầu bằng `(` (ví dụ `<% (it.rolesByUser[u.user_id] || []).forEach(... %>`) THEN Eta sinh mã bị ASI nối câu và runtime ném lỗi `"<đoạn HTML>" is not a function`, Fastify trả HTTP 500.

1.2 WHEN một view `.eta` có một câu xuất chuỗi đứng ngay trước một scriptlet mở đầu bằng `[` (ví dụ `<% ['SOP','WI',...].forEach(... %>`) THEN Eta sinh mã bị ASI nối câu, chuỗi bị truy cập chỉ mục qua toán tử dấu phẩy trả về `undefined`, runtime ném `Cannot read properties of undefined (reading 'forEach')`, Fastify trả HTTP 500.

1.3 WHEN người dùng mở `GET /dcs/admin/roles`, `GET /dcs/functional-groups`, `GET /dcs/register` (và các trang khác cùng mẫu: `GET /dcs/admin/users`, `GET /dcs/packages`) THEN trang trả HTTP 500 và không kết xuất được nội dung.

### Expected Behavior (Correct)

2.1 WHEN một view `.eta` có câu xuất chuỗi đứng ngay trước một scriptlet mở đầu bằng `(` THEN hệ thống SHALL kết xuất view thành HTML hợp lệ không ném lỗi.

2.2 WHEN một view `.eta` có câu xuất chuỗi đứng ngay trước một scriptlet mở đầu bằng `[` THEN hệ thống SHALL kết xuất view thành HTML hợp lệ không ném lỗi.

2.3 WHEN người dùng mở các trang đã sập (`/admin/roles`, `/functional-groups`, `/register`, `/admin/users`, `/packages`) với dữ liệu hợp lệ THEN hệ thống SHALL trả HTTP 200 kèm HTML đúng, hiển thị đầy đủ danh sách/biểu mẫu tương ứng.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN kết xuất các view không dính lỗi (ví dụ `home.eta`, `reviews.eta`, `detail.eta`, `login.eta`, `compare.eta`, `qa.eta`, `matrix-options.eta`) THEN hệ thống SHALL CONTINUE TO kết xuất ra cùng HTML như trước khi sửa.

3.2 WHEN một view dùng mẫu `(<%= expr %>)` (dấu ngoặc tròn bao quanh một output tag, ví dụ `(<%= it.pending.length %>)`) THEN hệ thống SHALL CONTINUE TO kết xuất dấu ngoặc như văn bản thường (không phải lỗi, không thay đổi hành vi).

3.3 WHEN áp dụng lớp `applyBasePath` để thêm tiền tố `/dcs` vào URL nội bộ THEN hệ thống SHALL CONTINUE TO viết lại URL đúng như trước.

3.4 WHEN kết xuất view có layout qua `<% layout('layout.eta', {...}) %>` và phần thân `<%~ it.body %>` THEN hệ thống SHALL CONTINUE TO ghép layout + thân đúng như trước.

3.5 WHEN các view đã dính lỗi được sửa và nhận mảng RỖNG (ví dụ `rolesByUser` không có phần tử, `packages` rỗng) THEN hệ thống SHALL CONTINUE TO kết xuất thành công (không ném lỗi, hiển thị danh sách rỗng).
