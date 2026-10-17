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
- Người dùng cho từng vai trò kiểm thử (mô hình **3 vai** sau migration 013):
  một **DC_ADMIN**, một **DC_AUTHOR**, một **DC_DEPT_HEAD** (đúng Department —
  phạm vi duyệt suy từ bộ phận chính), một **DC_READER**.
- Gán người dùng vào bộ phận phù hợp.
- *Ghi chú:* các vai cũ `DC_SITE_QA_MANAGER`, `DC_BU_OWNER`, `DC_GROUP_OWNER`
  **không còn được cấp** (bị `domain/roles.ts` chặn tường minh). Mọi ca tham
  chiếu vai cũ đã được viết lại theo 3 vai.

### A.2. Kiểm tra cấu hình & khởi động (bổ sung)

| # | Ca kiểm thử | Bước | Kỳ vọng |
|---|---|---|---|
| A.2.1 `[BẢO MẬT]` | Thiếu extension PostgreSQL | Tạo DB thiếu một trong `pgcrypto`, `unaccent`, `pg_trgm`, `vector`, chạy `npm run migrate`. | Migration/khởi động báo lỗi rõ ràng, không chạy nửa vời (các hàm `fn_search_limited`, cột `vector`, `unaccent` phụ thuộc trực tiếp). |
| A.2.2 `[BẢO MẬT]` | SESSION_SECRET quá ngắn | Đặt `SESSION_SECRET` rỗng hoặc < 32 ký tự, khởi động. | App dừng khởi động, báo "SESSION_SECRET phải dài tối thiểu 32 ký tự" (`src/config.ts`, `ConfigError`). |
| A.2.3 | Biến cấu hình không hợp lệ | Đặt `PORT=abc` hoặc `DB_POOL_MAX=0`. | Dừng khởi động, gộp lỗi báo một lượt (`src/config.ts`). |
| A.2.4 | Chạy sau proxy path con | Đặt `BASE_PATH=/dcs`, mở `/dcs/login`, đăng nhập. | Redirect `Location` được thêm tiền tố `/dcs`; cookie phiên gắn path `/dcs` (`src/server.ts`). |

---

## B. Đăng nhập & phiên làm việc

| # | Ca kiểm thử | Bước | Kỳ vọng |
|---|---|---|---|
| B.1 | Đăng nhập đúng | Vào `/login`, nhập email + mật khẩu hợp lệ. | Vào được trang chủ `/`. |
| B.2 `[BẢO MẬT]` | Đăng nhập sai | Nhập sai mật khẩu. | Báo lỗi chung "Email hoặc mật khẩu không đúng", không tiết lộ email có tồn tại hay không. |
| B.3 `[BẢO MẬT]` | Tài khoản bị khoá | Admin tắt hoạt động một user, user đó đăng nhập. | Báo "Tài khoản đã ngừng hoạt động". |
| B.4 `[BẢO MẬT]` | Truy cập khi chưa đăng nhập | Chưa đăng nhập, mở `/documents`. | Bị chuyển về `/login`. |
| B.5 | Đăng xuất | Bấm *Đăng xuất* / mở `/logout`. | Về `/login`; mở lại trang nội bộ phải đăng nhập lại. |
| B.6 | Thực đơn theo vai trò | Đăng nhập bằng DC_READER. | Chỉ thấy các mục đọc/tra cứu (vd "Danh mục tài liệu"); không thấy "Tài liệu của tôi", "Chờ tôi xác nhận", "Rà soát định kỳ", "Gói ban hành", "Nhóm chức năng", "Quản trị …", "Ghi vết" (`layout.eta`). |
| B.7 `[BẢO MẬT]` | Cookie phiên bị sửa | Gửi `Cookie: dcs_sid=rac-khong-hop-le` tới `/documents`. | Coi như chưa đăng nhập, chuyển `/login` (chữ ký cookie, `unsignCookie`). |
| B.8 `[BẢO MẬT]` | Phiên hết hạn (8 giờ) | Để phiên quá 8 giờ (hoặc chỉnh `expires_at` trong DB), mở trang nội bộ. | Bị coi như chưa đăng nhập, về `/login` (`domain/session.ts resolveSession` lọc `expires_at > now()`). |
| B.9 `[BẢO MẬT]` | Khoá tài khoản làm mất phiên đang mở | User đang đăng nhập; Admin tắt `is_active`; user tải lại trang. | Phiên không còn phân giải (yêu cầu `u.is_active`), về `/login`. Khác B.3 (vốn chỉ test lúc đăng nhập mới). |
| B.10 | Đang đăng nhập mở `/login` | Đã đăng nhập, mở `/login`. | Chuyển về `/` (`routes/auth.ts`). |
| B.11 `[BẢO MẬT]` | Đăng xuất huỷ phiên phía máy chủ | Đăng xuất, thử tái dùng session_id cũ. | Phiên đã bị xoá khỏi `app_session` (`destroySession`), không dùng lại được. |

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
| C.8 | Cấp vai trò đúng mô hình 3 vai | `/admin/roles` → cấp `DC_DEPT_HEAD` ở cấp `group`. | Cấp thành công; phạm vi duyệt suy từ bộ phận chính của user (`roles.ts normalizeScope`, `permissions.ts`). |
| C.9 `[BẢO MẬT]` | Chặn vai trò đã loại bỏ | Cố cấp `DC_SITE_QA_MANAGER` / `DC_BU_OWNER` / `DC_GROUP_OWNER`. | Bị chặn: vai không còn được gán trong mô hình 3 vai (`roles.ts normalizeScope`). |
| C.10 `[BẢO MẬT]` | Ép cấp đúng cấp Group | Cấp `DC_AUTHOR`/`DC_READER` với `scope_level=site`. | Bị chặn: "DC_AUTHOR chỉ được gán ở cấp Group" (`roles.ts`). |
| C.11 `[BẢO MẬT]` | Chặn quản trị nhóm chức năng khi không phải Admin | User không phải Admin mở `/functional-groups`. | 403 "Không đủ quyền quản trị nhóm chức năng" (`functional-groups.ts requireSystemAdmin`). |
| C.12 | Site nhiều BU ghi đúng bảng N:N | `/admin/org` → thêm BU thứ hai cho Site (`/admin/org/site-bu`). | Site hiển thị đủ các BU; ghi vào `org_site_bu` (idempotent — `org.ts addSiteBu`). Bổ sung so với C.4. |
| C.13 `[BẢO MẬT]` | Tự xoá tài khoản đang đăng nhập | Admin bấm xoá chính mình (`/admin/users/delete` với user_id của mình). | 422 "Không thể tự xoá tài khoản đang đăng nhập" (`routes/admin.ts`). |
| C.14 | Xoá mềm người dùng (giữ audit) | Admin xoá một user (`/admin/users/delete`). | User chỉ bị `is_active=false`, vẫn còn bản ghi để giữ bằng chứng xác nhận đọc/audit (`users.ts setUserActive`). |
| C.15 | Gỡ bộ phận khỏi user (soft) | Bấm × trên chip bộ phận (`/admin/users/remove-dept`). | `user_departments.is_active=false`, không xoá cứng (`users.ts removeFromDepartment`). |

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
| D.14 `[BẢO MẬT]` | Thiếu con trỏ theo cấp phạm vi | Nộp với `scope_level=site` nhưng bỏ trống Site. | Chặn "Phạm vi cấp Nhà máy (Site) bắt buộc chọn Site" (`registration.ts normalizeDocumentScope`), không rơi xuống lỗi SQL thô. |
| D.15 | Supersedes phải trỏ bản hợp lệ | Khai supersedes trỏ một bản ở trạng thái khác (vd *Chờ xác nhận*). | Chặn "Phiên bản gốc phải đang Hiệu lực hoặc Đã đăng ký" (`registration.ts`). Bổ sung so với D.11/D.12 (chỉ test mức độ thay đổi). |
| D.16 `[BẢO MẬT]` | Chặn đăng ký ở tầng domain | Gọi thẳng `submitRegistration`/`saveDraft` với user không có DC_AUTHOR (giả lập bỏ guard route). | Domain tự ném 403 "Không có quyền đăng ký ban hành tài liệu" (phòng thủ sâu — bổ sung cho D.1 vốn chỉ test ở route). |
| D.17 | Sửa/ghi đè nháp | Lưu nháp, mở `/my-documents/:id/edit`, sửa và lưu lại. | Bản nháp cũ bị thay bằng bản mới; chỉ chủ nhân (`registrant_user_id`) và chỉ trạng thái `cho_hoan_thien` mới mở được (`routes/documents.ts`). |
| D.18 | Nháp không ép phạm vi đầy đủ | Lưu nháp khi chưa chọn cấp phạm vi/con trỏ. | Lưu được, lùi về `group`; owner_department rỗng → NULL, không lỗi SQL (`registration.ts saveDraft`). |
| D.19 | Đếm người nhận theo phép giao | `/register/recipient-count` với `owner_department_id` + nhóm chức năng (`fg`). | Số người = phần giao (thuộc bộ phận VÀ là thành viên nhóm) (`distribution.ts countRecipientsFor`). Bổ sung so với D.3 (chỉ đếm theo bộ phận). |

---

## E. Xác nhận / Release (vai trò release)

Chuẩn bị: có ít nhất một phiên bản ở *Chờ xác nhận* thuộc đúng phạm vi của người kiểm thử.

| # | Ca kiểm thử | Bước | Kỳ vọng |
|---|---|---|---|
| E.1 | Hàng đợi đúng phạm vi (3 vai) | DC_DEPT_HEAD mở `/pending-confirmation`. | Chỉ thấy tài liệu khớp phạm vi suy từ **bộ phận chính** (dept/site/bu tương ứng); tài liệu cấp `group` chỉ Admin thấy để duyệt (`permissions.ts canUserRelease`, `routes/confirmation.ts`). |
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
| E.12 | Chặn xác nhận sai trạng thái | Cố `/confirm/:id/approve` một bản *Đã đăng ký*/*Từ chối*. | Chặn "Phiên bản không ở trạng thái chờ xác nhận" (`confirmation.ts confirmRegistration`, chống đua trạng thái). |
| E.13 `[BẢO MẬT]` | Tự động từ chối có ghi vết | Bản có `effective_date < hôm nay`, bấm Xác nhận. | Tự chuyển *Từ chối*, ghi audit `tu_choi_tu_dong`, không cho sửa ngày (`confirmation.ts`). Bổ sung ghi vết cho E.5. |
| E.14 `[BẢO MẬT]` | Chặn xác nhận sai phạm vi ở domain | Gọi `confirmRegistration` cho tài liệu ngoài phạm vi (giả lập bỏ guard route). | Domain ném 403 "Không đủ thẩm quyền xác nhận" (kiểm `canRelease` trong transaction). Phòng thủ sâu cho E.2. |
| E.15 `[BẢO MẬT]` | Tài liệu cấp group chỉ Admin duyệt | DC_DEPT_HEAD mở `/confirm/:id` của tài liệu cấp `group`. | 403 (chống leo thang sau migration 013 — `permissions.ts canUserRelease`). |
| E.16 `[BẢO MẬT]` | Bằng chứng so sánh chỉ tính bản gốc trực tiếp | Mở `/compare?from=X&to=Y` với X KHÔNG phải `supersedes_version_id` của Y, rồi cố tích 9b. | Không ghi "đã xem", 9b vẫn khoá (`diff.ts recordViewedDiff` chỉ ghi khi `to.supersedes = from`). Chống lách checklist. |
| E.17 `[BẢO MẬT]` | Không có đường tắt mở 9b | Tìm cách POST trực tiếp để mở 9b mà không qua `/compare`. | Không tồn tại endpoint như vậy; chỉ `/compare` mới tạo bằng chứng (`routes/confirmation.ts`). |
| E.18 | Mục tự động chặn chưa đạt | Bản có `parse_status` lỗi (mục 5) hoặc trùng số hiệu (mục 1), bấm Xác nhận. | Chặn "Mục chặn chưa đạt: …" (`confirmation.ts buildChecklist`). Bổ sung so với E.8 (chỉ test mục Admin tự tích). |
| E.19 | Kích hoạt hiệu lực qua job nền | Tới ngày hiệu lực, chạy `jobs/scheduler.ts` (`activateDueVersions`). | Bản mới → *Hiệu lực*, bản cũ cùng số hiệu → *Hết hiệu lực*, nguyên tử trong một giao dịch (`fn_activate_due_versions`). Cụ thể hoá E.11. |

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
| F.7 `[BẢO MẬT]` | Ẩn/điều hướng bản không hiện hành | Reader mở trực tiếp `/documents/:id` của bản *Hết hiệu lực*/*Thu hồi*/nháp. | Nếu còn bản hiện hành cùng doc_id → chuyển về bản đó; nếu không → 404 (không lộ bản lỗi thời) (`catalog.ts isCurrentStatus`). Bổ sung cho F.1. |
| F.8 `[BẢO MẬT]` | Chỉ người thuộc diện phải đọc mới xác nhận | User KHÔNG thuộc ma trận phân phối gọi `/documents/:id/acknowledge`. | Chặn "Bạn không thuộc diện phải xác nhận đọc tài liệu này" (`acknowledgement.ts acknowledge`). |
| F.9 | Lưu bối cảnh tại thời điểm xác nhận | Xác nhận đọc; sau đó đổi bộ phận của user. | Bản ghi giữ `department_id`/`functional_group_id` cũ, không tra lại sau (`acknowledgement.ts`). |
| F.10 | Nút xác nhận chỉ hiện đúng điều kiện | Xem bản *Đã đăng ký* (chưa tới hiệu lực) hoặc đã xác nhận rồi. | Không hiện nút (chỉ `status='hieu_luc'` + phải đọc + chưa xác nhận — `routes/catalog.ts`). |

> F.5/F.6 (kế thừa/đặt lại theo mức độ thay đổi) do hàm DB `fn_activate_due_versions`
> xử lý — nên chạy job để quan sát thực tế, không chỉ mô tả.

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
| G.8 | Ngưỡng gợi ý ≥ 2 ký tự | Gõ 1 ký tự ở ô tìm. | Không trả gợi ý (`search.ts suggest` trả rỗng khi < 2 ký tự). |
| G.9 | Tìm kiếm ghi vết | Tìm một chuỗi có nội dung. | Ghi một bản ghi audit `tim_kiem` kèm `q`, `hits` (`routes/search.ts`). |
| G.10 `[BẢO MẬT]` | Tìm kiếm lọc theo phạm vi | Hai user khác phạm vi tìm cùng chuỗi. | Mỗi người chỉ thấy tài liệu trong phạm vi mình (lọc TRONG `fn_search_limited`, không lọc sau). |
| G.11 | So sánh — trường hợp "không đáng tin" | Mở `/compare` khi là bản đầu tiên / không có mục để so / bóc tách kém. | Hiện cảnh báo, không dựng bảng khác biệt sai (`diff.ts diffReliability`). Bổ sung so với G.7. |
| G.12 `[BẢO MẬT]` | So sánh chặn xem ngoài phạm vi | Mở `/compare?from=&to=` với version ngoài phạm vi. | 404 "Không tìm thấy tài liệu" (kiểm `canViewVersion` cả from lẫn to); thiếu `to` → 400 (`routes/diff.ts`). |

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
| H.8 `[BẢO MẬT]` | Chặn in khi không có quyền xem bản | User ngoài phạm vi POST `/documents/:id/print`. | 403 "Không có quyền in tài liệu này" (`printing.ts registerPrint` kiểm `canViewVersion`). Bổ sung cho H.2 (chỉ test trạng thái bản). |
| H.9 | In sinh QR SVG + token ngẫu nhiên | In một bản hiệu lực. | Trang kết quả có QR SVG nhúng; `verify_token` ngẫu nhiên (`gen_random_bytes`); URL tra cứu đầy đủ theo `publicUrl+basePath` (`printing.ts`). |
| H.10 | POST `/print` không body không gây 500 | POST `/documents/:id/print` không kèm body/sai content-type. | Vẫn chạy đúng luồng, không "Cannot read properties of undefined" (`routes/printing.ts` đọc body phòng thủ). |
| H.11 | QR phản ánh trạng thái theo site | Mở `/verify/:token?site_id=…` khi site đang *chưa áp dụng*/*tạm hoãn*. | Trạng thái phản ánh theo site (`printing.ts verifyToken` nhánh `siteId`). |
| H.12 | QR của bản in đã thu hồi | Thu hồi bản in (`recall_status='da_thu_hoi'`), quét QR. | Trạng thái `ban_in_thu_hoi` (`printing.ts verifyToken`). Khác H.5 (chỉ test bản bị thay thế). |
| H.13 `[BẢO MẬT]` | Tra cứu QR công khai + ghi vết | Mở `/verify/:token` khi chưa đăng nhập. | Trả trang; ghi audit `tra_cuu_qr`; là route công khai DUY NHẤT (`auditQrLookup`). Bổ sung cho H.4/H.6. |

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
| I.9 `[BẢO MẬT]` | Thu hồi kiểm quyền ở tầng domain | Gọi `recallVersion` cho tài liệu ngoài phạm vi (bỏ guard route). | Domain ném 403 (`lifecycle.ts recallVersion` tự kiểm `canRelease`). Phòng thủ sâu cho I.1. |
| I.10 | Thu hồi chỉ từ trạng thái hợp lệ + bắt buộc lý do | Thu hồi bản nháp/*Từ chối*; hoặc thu hồi bỏ trống lý do. | Chặn "Không thu hồi được từ trạng thái …" / "Thu hồi bắt buộc kèm lý do" (`lifecycle.ts`). Bổ sung so với I.2. |
| I.11 | Màn thu hồi hiện tác động trước | Mở `/documents/:id/recall`. | Hiện số dòng phân phối, bản in còn lưu hành, nhãn liên kết (`lifecycle.ts recallImpact`). |
| I.12 `[BẢO MẬT]` | Ma trận phân phối = phép GIAO | Thêm dòng ma trận bộ phận + nhóm; so người nhận. | Chỉ người thuộc bộ phận VÀ là thành viên nhóm nhận (`v_distribution_resolved`). Bổ sung cho I.4. |
| I.13 `[BẢO MẬT]` | Xoá ma trận kiểm đúng doc | Gọi `/documents/:id/matrix/remove` với `matrix_id` của doc khác. | 403 (kiểm `row.doc_id === detail.doc_id` — `routes/catalog.ts`). |
| I.14 | Rà soát verdict bắt buộc ghi chú | `/reviews/:id/verdict` verdict *Cần sửa* bỏ trống note. | Chặn "Kết luận này bắt buộc ghi giải trình" (`review.ts recordVerdict`). Bổ sung cho I.6. |
| I.15 `[BẢO MẬT]` | Kết luận rà soát kiểm quyền theo phạm vi | User ngoài phạm vi gọi verdict. | 403 "Không đủ thẩm quyền kết luận rà soát này" (`review.ts`). |
| I.16 `[BẢO MẬT]` | Gói chỉ DC_AUTHOR truy cập | User không có DC_AUTHOR mở `/packages`. | 403 "Không đủ thẩm quyền truy cập gói ban hành" (`packages.ts requireRegistrar`). |
| I.17 | Gói: chặn thành viên thứ 11 | Gắn thành viên thứ 11 vào gói. | Bị chặn (trigger DB đếm 10 — `package.ts`). Cụ thể hoá I.7. |
| I.18 `[BẢO MẬT]` | Gói: chỉ chủ sở hữu thao tác | User khác (không phải `created_by`) gọi `/packages/attach|move-date|detach`. | 403 tương ứng (`package.ts`). |
| I.19 | Gắn vào gói đổi effective_date→NULL | Gắn bản ở trạng thái sai; hoặc gắn hợp lệ rồi xem effective_date. | Chặn trạng thái sai (chỉ *Chờ xác nhận*/*Đã đăng ký*); khi gắn thì `effective_date`→NULL, thừa kế ngày từ gói (`package.ts attachToPackage`). |
| I.20 | Tháo khôi phục effective_date + bắt buộc lý do | Tháo không lý do; tháo có lý do. | Không lý do → chặn; có lý do → nhận lại `effective_date` = ngày gói (`package.ts detachMember`). Siết chặt I.8. |

---

## J. Báo cáo, ghi vết, hỏi đáp

> **CẢNH BÁO LỖI THỜI:** J.1, J.2 (`/ops/quality`, `/ops/usage`), J.5, J.6 (`/qa`)
> tham chiếu các route **KHÔNG tồn tại trong code hiện tại** (xem mục "Ca UAT đã
> lỗi thời" ở cuối). Giữ nguyên các ca này sẽ khiến UAT trượt vì 404. Tạm **loại
> khỏi điều kiện chấp nhận** cho tới khi tính năng được triển khai. Các ca còn
> hiệu lực của nhóm J là phần ghi vết (`/audit`) dưới đây.

| # | Ca kiểm thử | Bước | Kỳ vọng |
|---|---|---|---|
| J.1 ~~`[BẢO MẬT]`~~ | ~~Ops chỉ admin~~ `[LỖI THỜI]` | ~~User thường mở `/ops/quality`, `/ops/usage`~~. | Route `/ops/*` chưa tồn tại — chưa triển khai. |
| J.2 | ~~Báo cáo vận hành~~ `[LỖI THỜI]` | ~~Admin mở `/ops/quality` và `/ops/usage`~~. | Route `/ops/*` chưa tồn tại — chưa triển khai. |
| J.3 `[BẢO MẬT]` | Ghi vết cần quyền | DC_AUTHOR (không release) mở `/audit`. | 403 "Không đủ thẩm quyền xem ghi vết" (`routes/audit.ts` dựa `req.nav.canRelease`). |
| J.4 | Tra ghi vết | Người release mở `/audit`, lọc theo đối tượng/loại/khoảng ngày. | Hiện nhật ký đúng bộ lọc. |
| J.5 | ~~Hỏi đáp tắt~~ `[LỖI THỜI]` | ~~Mở `/qa` khi chưa cấu hình embedding~~. | Route `/qa` chưa tồn tại — chưa triển khai. |
| J.6 | ~~Hỏi đáp có trích dẫn~~ `[LỖI THỜI]` | ~~Đặt câu hỏi~~. | Route `/qa` chưa tồn tại — chưa triển khai. |
| J.7 | Lọc ghi vết + giới hạn 500 | `/audit?object_id=&event_type=&from=&to=`. | Trả đúng bộ lọc, tối đa 500 dòng, sắp giảm theo thời gian; biên ngày `< to+1` (`audit-query.ts queryAudit`). Bổ sung cho J.4. |
| J.8 `[BẢO MẬT]` | Audit append-only | Thử UPDATE/DELETE `audit_log` (qua ràng buộc DB). | Không sửa/xoá được (`audit-query.ts`). |

---

## K. Giao diện & khả năng đọc (DCS-12)

> **CẢNH BÁO LỖI THỜI:** K.1, K.2 tham chiếu route `/design` **KHÔNG tồn tại
> trong code hiện tại** (chỉ còn CSS khối `.design-*`). Thực hiện các kiểm tra
> giao diện trên **màn hình thật** (`/documents`, chi tiết tài liệu, `/confirm/:id`,
> `/verify/:token`...) thay vì `/design`.

| # | Ca kiểm thử | Bước | Kỳ vọng |
|---|---|---|---|
| K.1 | ~~Trang trưng bày~~ `[LỖI THỜI]` | ~~Admin mở `/design`~~. | Route `/design` chưa tồn tại — kiểm trên màn hình thật (xem K.3–K.10). |
| K.2 | ~~/design chỉ admin~~ `[LỖI THỜI]` | ~~User thường mở `/design`~~. | Route `/design` chưa tồn tại. |
| K.3 | 1280px không cuộn ngang | Thu cửa sổ về 1280px, duyệt các màn hình chính. | Không xuất hiện thanh cuộn ngang. |
| K.4 | Nhãn dài không vỡ | Xem các nhãn dài trên màn thật (vd "Người đăng ký ban hành" ở chi tiết tài liệu/màn xác nhận). | Nhãn xuống dòng gọn, không vỡ bố cục. |
| K.5 | Màu kèm chữ/ký hiệu | Xem nhãn trạng thái, checklist, dải cảnh báo, trang QR trên màn thật. | Mọi trạng thái có chữ và/hoặc ký hiệu, không chỉ dựa vào màu (`status-label.eta`, `check-item.eta`, `alert-banner.eta`). |
| K.6 | In đen trắng | In thử trang danh mục / một tài liệu hiệu lực. | Vẫn phân biệt được trạng thái (viền + chữ). |
| K.7 | Zoom 150% | Phóng trình duyệt lên 150%. | Giao diện vẫn dùng được, không cắt nội dung. |
| K.8 | QR đọc cách 1m | Mở trang QR (`/verify/:token`) trên điện thoại, đứng cách ~1m. | Đọc được kết quả (chữ ≥ 32px, nền phủ toàn màn hình). |

---

## M. Rollout áp dụng lệch pha theo Site

Tính năng cho phép mỗi Site áp dụng/tạm hoãn tài liệu theo tiến độ riêng
(`domain/rollout.ts`, `routes/catalog.ts` `/documents/:id/rollout/*`).

| # | Ca kiểm thử | Bước | Kỳ vọng |
|---|---|---|---|
| M.1 `[BẢO MẬT]` | Chỉ bộ phận soạn thảo thêm/đổi rollout | User ngoài phạm vi gọi `/documents/:id/rollout/add`. | Bị chặn 403 (`rollout.ts` kiểm quyền). |
| M.2 | Đánh dấu "đã áp dụng" bắt buộc ngày | Đặt site sang *đã áp dụng* không nhập ngày. | Bị chặn: bắt buộc ngày áp dụng. |
| M.3 | "Tạm hoãn" bắt buộc lý do | Đặt site sang *tạm hoãn* bỏ trống lý do. | Bị chặn: bắt buộc lý do. |
| M.4 | QR phản ánh trạng thái site | Quét QR với `site_id` của site *chưa áp dụng*/*tạm hoãn*. | Trạng thái QR phản ánh đúng theo site (liên kết H.11). |
| M.5 | Lọc danh mục theo site/rollout | Lọc danh mục theo `site_id`/`rollout_status`. | Danh mục hiện đúng tập theo trạng thái áp dụng từng site. |

---

## N. Tải PDF gốc

`/documents/:id/download` (`routes/catalog.ts`).

| # | Ca kiểm thử | Bước | Kỳ vọng |
|---|---|---|---|
| N.1 `[BẢO MẬT]` | Chỉ bản hợp lệ mới tải | Tải bản nháp/*Từ chối*. | Bị chặn; chỉ *Đã đăng ký*/*Hiệu lực* mới tải được. |
| N.2 `[BẢO MẬT]` | Kiểm quyền xem bản | User ngoài phạm vi gọi `/documents/:id/download`. | Bị chặn (`canViewVersion`). |
| N.3 | Tệp mất trên đĩa | Xoá tệp vật lý rồi tải. | Trả 404, không lộ lỗi hệ thống. |

---

## O. Xử lý nội dung / bóc tách / OCR

`/documents/:id/process` (`domain/content.ts`, `extract.ts`, `chunking.ts`, `ocr.ts`).

| # | Ca kiểm thử | Bước | Kỳ vọng |
|---|---|---|---|
| O.1 `[BẢO MẬT]` | Chỉ người nộp/release kích hoạt | User khác gọi `/documents/:id/process`. | Bị chặn 403. |
| O.2 | Bóc tách & phân đoạn | Nộp PDF có nội dung, chạy xử lý. | Form được bóc tách, phân đoạn không cắt ngang bảng. |
| O.3 | Tệp quét kém tin cậy chạy OCR | Nộp PDF scan (ít text). | Hệ thống chạy OCR rồi bóc tách lại; cập nhật `parse_status`. |

---

## P. Nhãn kế thừa & nạp dữ liệu cũ

`domain/labeling.ts`, `domain/migration-load.ts`.

| # | Ca kiểm thử | Bước | Kỳ vọng |
|---|---|---|---|
| P.1 | Nhãn chép hiển thị khác | Lên phiên bản mới; xem nhãn kế thừa. | Nhãn chép hiển thị khác màu tới khi xác nhận lại (`confirmed_by_user=FALSE`). |
| P.2 | Xác nhận lại nhãn chép | Xác nhận lại nhãn kế thừa. | Nhãn chuyển trạng thái đã xác nhận. |
| P.3 | Nạp bản cũ bắt buộc ngày gốc | Nạp tài liệu cũ không khai `original_effective_date`. | Bị chặn: bắt buộc ngày hiệu lực gốc. |
| P.4 | Nạp qua luồng chuẩn | Nạp bản cũ hợp lệ. | `effective_date`=ngày nạp (thoả guard); chu kỳ rà soát tính theo ngày gốc; vẫn qua luồng xác nhận (không tạo đường tắt). |

---

## Q. Tác vụ nền & leo thang tồn đọng

`domain/escalation.ts`, `jobs/scheduler.ts`.

| # | Ca kiểm thử | Bước | Kỳ vọng |
|---|---|---|---|
| Q.1 | Chạy tác vụ ngày | Chạy `runDailyJobs`. | Kích hoạt hiệu lực đến hạn, sinh rà soát tới hạn, dọn phiên hết hạn. |
| Q.2 | Leo thang mỗi bậc một lần | Để tồn đọng quá hạn, chạy job nhiều lần. | Mỗi bậc leo thang gửi đúng một lần (ràng buộc `uq_escalation`). |

> *Lưu ý:* `README.md` cảnh báo `fn_run_escalations` có thể tham chiếu bảng cũ —
> xác minh trước khi test.

---

## R. Nhóm chức năng — thành viên lạc hậu

`routes/functional-groups.ts`, `v_functional_group_stale`.

| # | Ca kiểm thử | Bước | Kỳ vọng |
|---|---|---|---|
| R.1 | Phát hiện thành viên lạc hậu | Người rời tổ chức/đổi bộ phận. | Hiện ngay trong danh sách "cần rà soát" (`staleMembers`). |
| R.2 `[BẢO MẬT]` | Nhóm bắt buộc có owner đích danh | Tạo nhóm chức năng thiếu owner. | Bị chặn: bắt buộc một người sở hữu. |

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
| J. Ghi vết (bỏ Ops/Hỏi đáp — lỗi thời) |  |  |  |  |
| K. Giao diện (kiểm trên màn thật) |  |  |  |  |
| M. Rollout theo Site |  |  |  |  |
| N. Tải PDF gốc |  |  |  |  |
| O. Xử lý nội dung/OCR |  |  |  |  |
| P. Nhãn kế thừa & nạp dữ liệu cũ |  |  |  |  |
| Q. Tác vụ nền & leo thang |  |  |  |  |
| R. Nhóm chức năng |  |  |  |  |

**Điều kiện chấp nhận:** tất cả ca `[BẢO MẬT]` phải **Đạt**. Ca Không đạt phải mở lỗi kèm bước tái hiện. Ca gắn `[LỖI THỜI]` (J.1, J.2, J.5, J.6, K.1, K.2) **tạm loại khỏi điều kiện chấp nhận** vì route chưa tồn tại — xem mục dưới.

---

## Phụ lục — Ca UAT đã lỗi thời cần quyết định

Các ca dưới đây tham chiếu route/vai trò không khớp code hiện tại (migration 013 gộp vai; chưa triển khai `/ops`, `/qa`, `/design`). Cần quyết định: **cài tính năng** rồi khôi phục ca, hoặc **gỡ hẳn** khỏi UAT.

| Ca cũ | Vấn đề | Hướng xử lý |
|---|---|---|
| A.1 (vai nền), C.9 cũ | Yêu cầu tạo/cấp `DC_SITE_QA_MANAGER`, `DC_BU_OWNER` | Đã viết lại theo 3 vai (Admin/Author/DeptHead). |
| E.1 cũ | "Chỉ thấy tài liệu cấp Site" theo vai cũ | Đã viết lại theo phạm vi suy từ bộ phận chính. |
| J.1, J.2 | `/ops/quality`, `/ops/usage` chưa tồn tại | Cài tính năng báo cáo vận hành hoặc gỡ ca. |
| J.5, J.6 | `/qa` (Hỏi đáp AI) chưa tồn tại | Pipeline nội dung có nhưng thiếu endpoint truy vấn — cài hoặc gỡ. |
| K.1, K.2 | `/design` chưa tồn tại | Kiểm giao diện trên màn thật (đã chuyển ở K.3–K.8). |

Người kiểm thử: ____________________  Ngày: __________  Kết luận (Đạt/Không đạt): __________
