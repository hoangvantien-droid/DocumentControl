# DCS — Kịch bản kiểm thử chấp nhận (UAT)

Tài liệu này dùng để **kiểm thử chấp nhận người dùng (UAT)** cho DCS trước khi phát hành.
Người kiểm thử thực hiện từng ca theo thứ tự, ghi **Đạt / Không đạt** và ghi chú.

- Đối tượng: QA nghiệp vụ, đội triển khai, người dùng đại diện.
- Môi trường khuyến nghị: **bản sao cô lập** (không phải production), đã migrate cơ sở dữ liệu.
- Kết quả kỳ vọng ghi trong từng ca; ca có gắn `[BẢO MẬT]` là kiểm soát an ninh, **bắt buộc đạt**.

---

## A. Chuẩn bị môi trường

### A.0. Dựng môi trường kiểm thử
| # | Bước | Kỳ vọng |
|---|---|---|
| A.0.1 | Có PostgreSQL, đã tạo DB, cấu hình `.env` (`DATABASE_URL`, `SESSION_SECRET` ≥ 32 ký tự, `FILE_STORAGE_PATH`). | App khởi động không lỗi cấu hình. |
| A.0.2 | Chạy `npm run migrate`. | Migration chạy xong, không lỗi. |
| A.0.3 | Chạy `npm run dev` (hoặc bản build production đã copy `views`/`public` vào `dist/`). | Server lắng nghe ở cổng cấu hình. |
| A.0.4 | Mở `GET /healthz`. | Trả JSON `{"status":"ok", ...}`. |
| A.0.5 | Tạo admin đầu tiên: `node scripts/create-admin.mjs <email> <mk> "<Họ tên>"`. | Báo tạo người dùng và cấp `DC_GROUP_OWNER`. |

### A.1. Dữ liệu nền cần có (do admin tạo)
Cần chuẩn bị để chạy các ca sau:
- Ít nhất 1 BU, 1 Site (gắn BU), 1 Department.
- Người dùng cho từng vai trò kiểm thử: một **DC_AUTHOR**, một **DC_SITE_QA_MANAGER** (đúng Site),
  một **DC_DEPT_HEAD** (đúng Department), một **DC_READER**, một **DC_ADMIN**.
- Gán người dùng vào bộ phận phù hợp.

---

## B. Đăng nhập & phiên làm việc

| # | Ca kiểm thử | Bước | Kỳ vọng |
|---|---|---|---|
| B.1 | Đăng nhập đúng | Vào `/login`, nhập email + mật khẩu hợp lệ. | Vào được trang chủ `/`. |
| B.2 `[BẢO MẬT]` | Đăng nhập sai | Nhập sai mật khẩu. | Báo lỗi chung "Email hoặc mật khẩu không đúng", không tiết lộ email có tồn tại hay không. |
| B.3 `[BẢO MẬT]` | Tài khoản bị khoá | Admin tắt hoạt động một user, user đó đăng nhập. | Báo "Tài khoản đã ngừng hoạt động". |
| B.4 `[BẢO MẬT]` | Truy cập khi chưa đăng nhập | Chưa đăng nhập, mở `/documents`. | Bị chuyển về `/login`. |
| B.5 | Đăng xuất | Bấm *Đăng xuất* / mở `/logout`. | Về `/login`; mở lại trang nội bộ phải đăng nhập lại. |
| B.6 | Thực đơn theo vai trò | Đăng nhập bằng DC_READER. | Không thấy các mục Đăng ký / Chờ xác nhận / Quản trị. |

---

## C. Quản trị tổ chức, người dùng, vai trò (DC_ADMIN)

| # | Ca kiểm thử | Bước | Kỳ vọng |
|---|---|---|---|
| C.1 `[BẢO MẬT]` | Chặn không phải admin | Đăng nhập bằng DC_AUTHOR, mở `/admin/org`. | Bị chặn (403 "Không đủ quyền quản trị hệ thống"). |
| C.2 | Tạo BU | `/admin/org` → tạo BU (mã, tên). | BU hiện trong danh sách. |
| C.3 | Tạo Site | Tạo Site (mã, tên, chọn BU). | Site hiện, gắn đúng BU. |
| C.4 | Site nhiều BU (N:N) | Thêm BU thứ hai cho Site qua form mapping. | Site hiển thị cả hai BU. |
| C.5 | Tạo Department | Tạo Department gắn Site. | Department hiện đúng Site. |
| C.6 | Tạo người dùng | `/admin/users` → tạo user (email duy nhất, mật khẩu ≥ 8). | Tạo được; email trùng thì báo lỗi; mật khẩu < 8 bị chặn. |
| C.7 | Gán bộ phận | Gán user vào Department. | Ghi nhận; user thuộc bộ phận. |
| C.8 | Cấp vai trò đúng cấp | `/admin/roles` → cấp DC_SITE_QA_MANAGER kèm Site. | Cấp thành công. |
| C.9 `[BẢO MẬT]` | Cấp vai trò sai cấp | Cấp DC_BU_OWNER nhưng không chọn BU. | Bị chặn: "DC_BU_OWNER bắt buộc có phạm vi BU". |
| C.10 `[BẢO MẬT]` | Ép cấp global đúng chỗ | Cấp DC_AUTHOR/READER/GROUP_OWNER ở cấp khác Group. | Bị chặn: chỉ được cấp ở cấp Group. |

---

## D. Đăng ký ban hành (DC_AUTHOR)

| # | Ca kiểm thử | Bước | Kỳ vọng |
|---|---|---|---|
| D.1 `[BẢO MẬT]` | Chặn không có quyền | User không có DC_AUTHOR gọi nộp `/register`. | Bị chặn 403 "Không có quyền đăng ký ban hành". |
| D.2 | Form đăng ký hiển thị | Mở `/register`. | Form 3 phần + thanh tiến độ; checklist gợi ý ở cột phải. |
| D.3 | Đếm người nhận realtime | Chọn "Bộ phận sở hữu". | Số người nhận dự kiến cập nhật ngay. |
| D.4 | Nộp hợp lệ (tài liệu nội bộ) | Điền đủ, tải PDF, khai số hồ sơ phê duyệt, ≥1 nhãn liên kết, ngày hiệu lực ≥ hôm nay. | Nộp thành công → trạng thái *Chờ xác nhận*; thấy ở `/my-documents`. |
| D.5 | Bắt buộc tệp PDF | Nộp mà không tải PDF. | Bị chặn, yêu cầu tải tệp PDF. |
| D.6 | Nội bộ thiếu số hồ sơ | Tài liệu nội bộ, bỏ trống số hồ sơ phê duyệt. | Bị chặn: "Tài liệu nội bộ bắt buộc có số hồ sơ phê duyệt". |
| D.7 | Ngoại bộ thiếu ngày pháp lý | Tài liệu ngoại bộ, bỏ trống ngày hiệu lực pháp lý. | Bị chặn. |
| D.8 | Trùng số hiệu + phiên bản | Nộp lại đúng doc_id + version_no đã có. | Bị chặn: đã tồn tại. |
| D.9 | Ngày hiệu lực quá khứ | Đặt ngày hiệu lực nhỏ hơn hôm nay. | Bị chặn: ngày hiệu lực phải từ hôm nay trở đi. |
| D.10 | Ngày hết hạn không hợp lệ | Ngày hết hạn ≤ ngày hiệu lực. | Bị chặn. |
| D.11 | Bản thay thế thiếu mức độ | Khai supersedes nhưng bỏ mức độ thay đổi. | Bị chặn: bắt buộc khai mức độ thay đổi. |
| D.12 | Thay đổi lớn thiếu tóm tắt | Mức độ = Lớn, bỏ tóm tắt. | Bị chặn: bắt buộc tóm tắt. |
| D.13 | Lưu nháp | Bấm *Lưu nháp* với dữ liệu tối thiểu. | Lưu ở *Chờ hoàn thiện*, không chạy kiểm đầy đủ. |

---

## E. Xác nhận / Release (vai trò release)

Chuẩn bị: có ít nhất một phiên bản ở *Chờ xác nhận* thuộc đúng phạm vi của người kiểm thử.

| # | Ca kiểm thử | Bước | Kỳ vọng |
|---|---|---|---|
| E.1 | Hàng đợi đúng phạm vi | DC_SITE_QA_MANAGER mở `/pending-confirmation`. | Chỉ thấy tài liệu **cấp Site** đúng Site của mình. |
| E.2 `[BẢO MẬT]` | Chặn xác nhận sai phạm vi | Người giữ Site A mở `/confirm/<id>` của tài liệu Site B. | Bị chặn 403. |
| E.3 | Màn xác nhận | Mở `/confirm/<id>` hợp lệ. | Hai cột: xem tệp trái, checklist 12 mục + nút quyết định phải; nhóm *Tự động* và *Tự đối chiếu* nhìn khác nhau. |
| E.4 `[BẢO MẬT]` | Quy tắc hai người | Người nộp tự xác nhận tài liệu mình nộp. | Bị chặn: người xác nhận không được trùng người nộp. |
| E.5 `[BẢO MẬT]` | Ngày hiệu lực đã qua | Tài liệu có ngày hiệu lực đã trôi qua trong lúc chờ, bấm Xác nhận. | **Tự động từ chối**; không cho sửa ngày; tài liệu về *Từ chối* để đăng ký lại. |
| E.6 `[BẢO MẬT]` | Khoá 9b chờ so sánh | Bản thay thế, chưa mở so sánh, cố xác nhận. | Ô 9b khoá (biểu tượng ổ khoá); bị chặn: phải mở so sánh trước. |
| E.7 | Mở khoá 9b | Bấm *Xem so sánh*, xem xong quay lại. | Ô 9b mở; tích được. |
| E.8 | Thiếu mục tự tích | Bỏ trống một trong các mục 7/8/9(/9b), bấm Xác nhận. | Bị chặn: còn mục Admin tự kiểm chưa xác nhận. |
| E.9 | Xác nhận thành công | Đủ điều kiện, tích đủ, Xác nhận. | Chuyển *Đã đăng ký*; ghi ngày đăng ký; rời hàng đợi. |
| E.10 | Từ chối bắt buộc lý do | Bấm Từ chối mà bỏ trống lý do. | Bị chặn: bắt buộc lý do. |
| E.11 | Lên hiệu lực đúng ngày | Đợi tới (hoặc đặt) ngày hiệu lực; job kích hoạt. | Bản chuyển *Hiệu lực*; bản cũ cùng số hiệu chuyển *Hết hiệu lực* (chỉ một bản Hiệu lực mỗi số hiệu). |

---

## F. Đọc & xác nhận đọc

| # | Ca kiểm thử | Bước | Kỳ vọng |
|---|---|---|---|
| F.1 `[BẢO MẬT]` | Ẩn tài liệu ngoài phạm vi | User mở trực tiếp `/documents/<id>` ngoài phạm vi. | Trả 404 "Không tìm thấy tài liệu". |
| F.2 | Xem chi tiết | Mở tài liệu trong phạm vi. | Đầu trang có nhãn trạng thái + phạm vi; nội dung trái, metadata phải. |
| F.3 | Nút xác nhận đọc | User thuộc diện phải đọc, tài liệu Hiệu lực, chưa xác nhận. | Nút "Xác nhận đã đọc" hiện. |
| F.4 | Xác nhận đọc | Bấm xác nhận. | Ghi nhận; nút chuyển thành "đã xác nhận". |
| F.5 | Kế thừa xác nhận (thay đổi nhỏ) | Ban hành bản mới **thay đổi nhỏ**. | Xác nhận cũ được kế thừa; không phải đọc lại. |
| F.6 | Đặt lại xác nhận (thay đổi lớn) | Ban hành bản mới **thay đổi lớn**. | Yêu cầu xác nhận đọc lại. |

---

## G. Tìm kiếm & so sánh

| # | Ca kiểm thử | Bước | Kỳ vọng |
|---|---|---|---|
| G.1 | Gợi ý tìm | Gõ ≥ 2 ký tự ở ô tìm. | Hiện gợi ý; khớp số hiệu lên đầu. |
| G.2 | Tìm không dấu | Gõ `mau luu`. | Ra kết quả `mẫu lưu`. |
| G.3 | Khớp một phần số hiệu | Gõ phần số hiệu (vd `HD-005`). | Ra tài liệu có số hiệu chứa chuỗi đó. |
| G.4 | Chỉ bản hiệu lực mặc định | Tìm không bật lịch sử. | Không hiện bản hết hiệu lực. |
| G.5 | Bao gồm bản lịch sử | Bật "Bao gồm bản lịch sử". | Hiện bản hết hiệu lực: nền xám, nhãn đỏ, chỉ tới bản đang áp dụng. |
| G.6 | Không có kết quả | Tìm chuỗi không tồn tại. | Hiện gợi ý bước tiếp theo, không để trắng. |
| G.7 | So sánh phiên bản | Mở `/compare?from=&to=`. | Hai cột: thêm/xoá/đổi tô màu, mục không đổi thu gọn. |

---

## H. In & tra cứu QR

| # | Ca kiểm thử | Bước | Kỳ vọng |
|---|---|---|---|
| H.1 | Chỉ in bản hiệu lực | Mở tài liệu Hiệu lực. | Có nút "In bản kiểm soát". |
| H.2 `[BẢO MẬT]` | Không in bản chưa hiệu lực | Cố in bản *Đã đăng ký*/*Hết hiệu lực*. | Bị chặn: chỉ in được bản đang hiệu lực. |
| H.3 | Lớp phủ bản in | In một bản. | Trang kết quả có số hiệu, phiên bản, mã bản in, ngày in, mã QR, dòng cảnh báo đỏ. |
| H.4 | Tra cứu QR còn hiệu lực | Mở `/verify/<mã>` của bản Hiệu lực (không đăng nhập). | Nền xanh, dấu ✓, "CÒN HIỆU LỰC". |
| H.5 | Tra cứu QR hết hiệu lực | Mở `/verify/<mã>` của bản đã bị thay thế. | Nền đỏ, dấu ✕, nêu phiên bản đang áp dụng. |
| H.6 `[BẢO MẬT]` | QR không lộ nội dung | Xem kỹ trang QR. | Chỉ hiện tình trạng; **không** hiện nội dung, nhãn, người nhận. |
| H.7 | QR không hợp lệ | Mở `/verify/<mã sai>`. | Hiện "Không tìm thấy bản in". |

---

## I. Thu hồi, phân phối, rà soát, gói

| # | Ca kiểm thử | Bước | Kỳ vọng |
|---|---|---|---|
| I.1 `[BẢO MẬT]` | Thu hồi cần quyền | User không có quyền release mở `/documents/<id>/recall`. | Bị chặn 403. |
| I.2 | Thu hồi có lý do | Người có quyền thu hồi, xem tác động, nhập lý do. | Tài liệu chuyển *Thu hồi*; bản in tra QR báo đã thu hồi. |
| I.3 `[BẢO MẬT]` | Sửa ma trận cần quyền | User thường gọi thêm/xoá ma trận. | Bị chặn 403. |
| I.4 | Thêm/xoá ma trận | Người release thêm bộ phận (± nhóm chức năng). | Ma trận cập nhật; số người nhận thay đổi theo phép giao. |
| I.5 | Rà soát — giữ nguyên | `/reviews` → verdict *Giữ nguyên*. | Đặt lại chu kỳ rà soát. |
| I.6 | Rà soát — cần sửa | Verdict *Cần sửa* (kèm ghi chú). | Chuyển *treo chờ bản mới*. |
| I.7 | Gói ban hành | DC_AUTHOR tạo gói, gắn ≤ 10 phiên bản. | Thành viên lấy ngày hiệu lực từ gói; quá 10 bị chặn. |
| I.8 | Gỡ khỏi gói | Người tạo gói gỡ thành viên (kèm lý do). | Thành viên khôi phục ngày hiệu lực; gỡ thiếu lý do bị chặn. |

---

## J. Báo cáo, ghi vết, hỏi đáp

| # | Ca kiểm thử | Bước | Kỳ vọng |
|---|---|---|---|
| J.1 `[BẢO MẬT]` | Ops chỉ admin | User thường mở `/ops/quality`, `/ops/usage`. | Bị chặn 403. |
| J.2 | Báo cáo vận hành | Admin mở `/ops/quality` và `/ops/usage`. | Hiện báo cáo chất lượng nạp và mức độ sử dụng. |
| J.3 `[BẢO MẬT]` | Ghi vết cần quyền | User không có quyền release mở `/audit`. | Bị chặn 403. |
| J.4 | Tra ghi vết | Người release mở `/audit`, lọc theo đối tượng/loại/khoảng ngày. | Hiện nhật ký đúng bộ lọc. |
| J.5 | Hỏi đáp tắt | Mở `/qa` khi chưa cấu hình embedding. | Trang báo tính năng chưa bật. |
| J.6 | Hỏi đáp có trích dẫn (nếu bật) | Đặt câu hỏi. | Trả lời kèm trích dẫn cấp mục; không đủ căn cứ thì báo không đủ thông tin. |

---

## K. Giao diện & khả năng đọc (DCS-12)

| # | Ca kiểm thử | Bước | Kỳ vọng |
|---|---|---|---|
| K.1 | Trang trưng bày | Admin mở `/design`. | Hiển thị đủ 14 thành phần ở mọi trạng thái. |
| K.2 `[BẢO MẬT]` | /design chỉ admin | User thường mở `/design`. | Bị chặn 403. |
| K.3 | 1280px không cuộn ngang | Thu cửa sổ về 1280px, duyệt các màn hình chính. | Không xuất hiện thanh cuộn ngang. |
| K.4 | Nhãn dài không vỡ | Xem các nhãn dài trên `/design` (vd "Người đăng ký ban hành"). | Nhãn xuống dòng gọn, không vỡ bố cục. |
| K.5 | Màu kèm chữ/ký hiệu | Xem nhãn trạng thái, checklist, dải cảnh báo, trang QR. | Mọi trạng thái có chữ và/hoặc ký hiệu, không chỉ dựa vào màu. |
| K.6 | In đen trắng | In thử trang danh mục / `/design`. | Vẫn phân biệt được trạng thái (viền + chữ). |
| K.7 | Zoom 150% | Phóng trình duyệt lên 150%. | Giao diện vẫn dùng được, không cắt nội dung. |
| K.8 | QR đọc cách 1m | Mở trang QR trên điện thoại, đứng cách ~1m. | Đọc được kết quả (chữ ≥ 32px, nền phủ toàn màn hình). |

---

## L. Tổng hợp kết quả UAT

| Nhóm | Số ca | Đạt | Không đạt | Ghi chú |
|---|---|---|---|---|
| A. Chuẩn bị |  |  |  |  |
| B. Đăng nhập |  |  |  |  |
| C. Quản trị |  |  |  |  |
| D. Đăng ký |  |  |  |  |
| E. Xác nhận/Release |  |  |  |  |
| F. Đọc & xác nhận đọc |  |  |  |  |
| G. Tìm & so sánh |  |  |  |  |
| H. In & QR |  |  |  |  |
| I. Thu hồi/Phân phối/Rà soát/Gói |  |  |  |  |
| J. Báo cáo/Ghi vết/Hỏi đáp |  |  |  |  |
| K. Giao diện |  |  |  |  |

**Điều kiện chấp nhận:** tất cả ca `[BẢO MẬT]` phải **Đạt**. Ca Không đạt phải mở lỗi kèm bước tái hiện.

Người kiểm thử: ____________________  Ngày: __________  Kết luận (Đạt/Không đạt): __________
