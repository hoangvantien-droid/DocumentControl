# DCS — Hướng dẫn sử dụng

Hệ Quản lý & Phân phối Tài liệu Điện tử (DCS). Tài liệu này hướng dẫn người dùng cuối
sử dụng ứng dụng: đăng nhập, tìm và đọc tài liệu, xác nhận đã đọc, đăng ký ban hành,
xác nhận (release), in bản kiểm soát, và các màn hình quản trị.

Phạm vi ứng dụng là **khâu SAU phê duyệt**: soạn thảo và ký duyệt thuộc hệ thống khác.
DCS tiếp nhận tài liệu đã duyệt, quản lý hiệu lực, phân phối, xác nhận đọc, in ấn và tra cứu.

---

## 1. Bắt đầu

### 1.1. Truy cập
- Ứng dụng chạy trên trình duyệt máy tính (tối ưu cho màn hình từ 1280px).
- Địa chỉ tuỳ môi trường triển khai. Ví dụ khi chạy sau proxy dưới path con: `https://<tên-miền>/dcs/`.
- Riêng **trang tra cứu QR** (`/verify/<mã>`) tối ưu cho điện thoại và **không cần đăng nhập**.

### 1.2. Đăng nhập / đăng xuất
- Vào `/login`, nhập **email** và **mật khẩu**.
- Sai thông tin: hệ thống báo chung "Email hoặc mật khẩu không đúng" (không tiết lộ email nào tồn tại).
- Tài khoản bị ngừng hoạt động: báo "Tài khoản đã ngừng hoạt động".
- Phiên đăng nhập kéo dài **8 giờ**, sau đó cần đăng nhập lại.
- Đăng xuất: vào `/logout` (hoặc nút *Đăng xuất* ở góc phải thanh trên).

### 1.3. Thực đơn theo vai trò
Thanh điều hướng bên trái **ẩn hẳn** mục mà bạn không có quyền. Bạn chỉ thấy những gì mình
được phép dùng, tuỳ vai trò được cấp.

---

## 2. Vai trò và quyền

DCS có **bảy vai trò**. Một người có thể mang nhiều vai trò.

| Vai trò | Làm được gì |
|---|---|
| **DC_READER** | Đọc và tìm kiếm tài liệu trong phạm vi được phép. |
| **DC_AUTHOR** | Đăng ký/nộp phiên bản tài liệu, lưu nháp, tạo gói ban hành. |
| **DC_GROUP_OWNER** | Xác nhận (release) tài liệu **cấp Group**. |
| **DC_BU_OWNER** | Xác nhận tài liệu **cấp BU** đúng BU được giao. |
| **DC_SITE_QA_MANAGER** | Xác nhận tài liệu **cấp Site** đúng Site được giao. |
| **DC_DEPT_HEAD** | Xác nhận tài liệu **cấp Department** đúng Department được giao. |
| **DC_ADMIN** | Quản trị hệ thống: tổ chức, người dùng, vai trò, nhóm chức năng, báo cáo vận hành, trang trưng bày. |

Nguyên tắc quan trọng về quyền xác nhận (release):

- **Đúng cấp, đúng phạm vi, không bao trùm.** Người giữ quyền cấp BU **không** xác nhận
  được tài liệu cấp Site hay Department; người cấp Site **không** xác nhận được tài liệu cấp Department.
- Bốn vai trò release là: Group Owner, BU Owner, Site QA Manager, Department Head — mỗi vai trò
  chỉ xử lý đúng tài liệu thuộc phạm vi mình giữ.

Cờ thực đơn suy ra từ vai trò:
- *Đăng ký được* nếu có `DC_AUTHOR`.
- *Xác nhận được* nếu có bất kỳ vai trò release nào.
- *Quản trị viên* nếu có `DC_ADMIN`.

> Lưu ý: `DC_ADMIN` (quản trị hệ thống) và `DC_GROUP_OWNER` (release cấp Group) là **hai vai trò khác nhau**.
> Tài khoản khởi tạo ban đầu được cấp `DC_GROUP_OWNER`; để vào được các màn hình quản trị
> (`/admin/*`, `/functional-groups`, `/ops/*`, `/design`) tài khoản đó cần được cấp thêm `DC_ADMIN`.

---

## 3. Vòng đời và trạng thái tài liệu

Mỗi **phiên bản** tài liệu đi qua các trạng thái:

| Trạng thái | Ý nghĩa |
|---|---|
| **Chờ hoàn thiện** (`cho_hoan_thien`) | Bản nháp, chưa nộp, chưa kiểm đủ. |
| **Chờ xác nhận** (`cho_xac_nhan`) | Đã nộp, đang chờ người có thẩm quyền release. |
| **Từ chối** (`tu_choi`) | Bị từ chối (thủ công có lý do, hoặc tự động khi ngày hiệu lực đã trôi qua). |
| **Đã đăng ký** (`da_dang_ky`) | Đã xác nhận, chờ tới ngày hiệu lực. |
| **Hiệu lực** (`hieu_luc`) | Đang áp dụng. Mỗi số hiệu chỉ có một bản Hiệu lực tại một thời điểm. |
| **Hết hiệu lực** (`het_hieu_luc`) | Đã bị thay thế hoặc hết hạn. |
| **Thu hồi** (`thu_hoi`) | Đã thu hồi (bắt buộc lý do). |

Bốn **cấp phạm vi** tài liệu: `group`, `bu`, `site`, `dept` — quyết định ai xem được và ai xác nhận được.

---

## 4. Tìm và đọc tài liệu

### 4.1. Tìm kiếm
- Ô tìm ở thanh trên: gõ số hiệu, tiêu đề hoặc nội dung. Gợi ý hiện sau khi gõ từ 2 ký tự.
- Tìm **không dấu vẫn ra kết quả có dấu** (ví dụ gõ `mau luu` ra `mẫu lưu`).
- Khớp một phần số hiệu cũng ra (ví dụ `HD-005` ra `MML/QA/HD-005`); khớp số hiệu được ưu tiên lên đầu.
- Trang kết quả (`/search`): mặc định chỉ hiện bản **đang hiệu lực**. Bật **"Bao gồm bản lịch sử"**
  để thấy cả bản hết hiệu lực (hiển thị nền xám, nhãn đỏ, kèm dòng chỉ tới bản đang áp dụng).
- Bộ lọc nằm ở cột trái.

### 4.2. Xem chi tiết
Mở một tài liệu (`/documents/<id>`):
- Đầu trang: số hiệu, phiên bản, tiêu đề, **nhãn trạng thái** và **nhãn phạm vi**.
- Dải cảnh báo (nếu có) hiện ngay dưới đầu trang: *Hết hiệu lực*, *Thu hồi*, hoặc *Quá hạn rà soát*.
- Cột trái: nội dung tài liệu theo mục. Cột phải: hồ sơ phê duyệt, hiệu lực, nhãn liên kết, phân phối.
- Nếu đang xem bản không còn hiệu lực, có liên kết tới **bản đang áp dụng**.

### 4.3. Xác nhận đã đọc
- Nút **"Xác nhận đã đọc"** chỉ hiện khi: tài liệu đang **Hiệu lực**, bạn thuộc diện **phải đọc**,
  và bạn **chưa xác nhận**.
- Sau khi bấm, hệ thống ghi nhận xác nhận (kèm bối cảnh bộ phận/nhóm tại thời điểm đó).
- Khi có phiên bản mới:
  - **Thay đổi nhỏ**: xác nhận cũ được kế thừa, cả xưởng không phải đọc lại.
  - **Thay đổi lớn**: đồng hồ đặt lại, mọi người phải xác nhận đọc lại.

---

## 5. Đăng ký ban hành tài liệu (vai trò DC_AUTHOR)

Vào **"Tài liệu của tôi"** → hoặc `/register`.

### 5.1. Điền form
Các trường chính:
- **Số hiệu** (doc_id) — do người đăng ký nhập, không tự sinh.
- **Loại**: SOP / WI / Form / Policy / External.
- **Nguồn**: Nội bộ / Ngoại bộ.
- **Cấp phạm vi** và con trỏ phạm vi tương ứng (BU/Site/Department).
- **Tệp PDF**: **bắt buộc** tải lên (tối đa 25 MB).
- **Phiên bản, tiêu đề, ngày ban hành, người phê duyệt**.
- **Số hồ sơ phê duyệt** (bắt buộc với tài liệu **nội bộ**).
- **Ngày hiệu lực pháp lý** (bắt buộc với tài liệu **ngoại bộ**).
- **Ngày hiệu lực (DCS)**, **chu kỳ rà soát (tháng)**, **ngày hết hạn** (tuỳ chọn).
- **Bộ phận sở hữu**. Khi chọn, hệ thống hiện **số người nhận dự kiến** theo thời gian thực.
- Nếu là **phiên bản thay thế**: khai `supersedes` (bản gốc phải đang Hiệu lực hoặc Đã đăng ký),
  **mức độ thay đổi** (Lớn/Nhỏ) — bắt buộc, và **tóm tắt thay đổi** — bắt buộc nếu Lớn.
- Ít nhất **một nhãn liên kết** (điều khoản / công đoạn / điểm kiểm soát / mối nguy / tài liệu).

### 5.2. Các quy tắc kiểm khi nộp
Hệ thống chặn nộp nếu:
- Số hiệu + phiên bản đã tồn tại.
- Ngày hiệu lực nhỏ hơn hôm nay.
- Ngày hết hạn không sau ngày hiệu lực.
- Thiếu số hồ sơ phê duyệt (nội bộ) hoặc ngày hiệu lực pháp lý (ngoại bộ).
- Phiên bản thay thế thiếu mức độ thay đổi / tóm tắt.

### 5.3. Lưu nháp và nộp
- **Lưu nháp**: lưu ở trạng thái *Chờ hoàn thiện*, không chạy kiểm đầy đủ — dùng khi còn phải đi hỏi thêm.
- **Nộp đăng ký**: chuyển sang *Chờ xác nhận*, vào hàng đợi của người có quyền release.
- Sau khi nộp, theo dõi ở **"Tài liệu của tôi"** (`/my-documents`).

---

## 6. Xác nhận / Release (các vai trò release)

Vào **"Chờ tôi xác nhận"** (`/pending-confirmation`) — hàng đợi chỉ hiện tài liệu **đúng phạm vi** bạn giữ.

### 6.1. Màn hình xác nhận
Mở một mục → màn hình xác nhận (`/confirm/<id>`) có hai cột:
- Trái: vùng xem tệp.
- Phải: **checklist 12 mục** và các nút quyết định.

Checklist gồm hai nhóm, phân biệt rõ bằng hình thức:
- **Tự động** (mục 1–6, 10–12): hệ thống tự đánh dấu ✓ / ✕ / cảnh báo.
  - 1. Số hiệu và phiên bản chưa tồn tại.
  - 2. Ngày hiệu lực ≥ hôm nay.
  - 3. Người xác nhận khác người nộp.
  - 4. Tệp mở được, mã băm khớp.
  - 5. Bóc tách mục thành công (Form được miễn).
  - 6. Mã điều khoản còn hiệu lực.
  - 10–12: cảnh báo (điều khoản sắp hết hiệu lực, đã khai nhãn liên kết, đã khai ma trận phân phối).
- **Tự đối chiếu** (mục 7–9, và **9b** nếu là bản thay thế): bạn phải **tự tích** sau khi đối chiếu tệp.
  - 7. Số hiệu trên tệp khớp số hiệu đã khai.
  - 8. Ngày ban hành và người duyệt khớp chữ ký trên tệp.
  - 9. Loại tài liệu khai đúng.
  - **9b. Mức độ thay đổi khai đúng** — ô này **khoá** cho tới khi bạn bấm **"Xem so sánh"** và mở khối đối chiếu hai phiên bản.

### 6.2. Ba lớp bảo vệ khi xác nhận
- **Hai người**: người xác nhận **không được** trùng người nộp.
- **Ngày hiệu lực đã trôi qua**: nếu ngày hiệu lực đã qua trong lúc chờ, hệ thống **tự động từ chối** —
  người xác nhận **không sửa được ngày**; tài liệu trả về để người đăng ký chọn lại ngày rồi nộp lại.
- **9b**: với bản thay thế, phải **mở so sánh** trước, nếu không hệ thống chặn xác nhận.

### 6.3. Quyết định
- **Xác nhận**: nếu mọi mục chặn đạt và các mục tự tích được tích → chuyển *Đã đăng ký*
  (ghi ngày đăng ký = thời điểm xác nhận). Tài liệu sẽ tự lên *Hiệu lực* vào đúng ngày hiệu lực.
- **Từ chối / Trả về**: **bắt buộc nhập lý do**.

---

## 7. So sánh phiên bản

- Vào `/compare?from=<bản cũ>&to=<bản mới>` (thường qua nút *Xem so sánh* ở màn xác nhận).
- Hai cột song song: mục thêm (nền xanh), mục xoá (nền đỏ), nội dung đổi (đỏ bên trái / xanh bên phải),
  mục không đổi thu gọn — bấm để mở.
- Mở so sánh đúng cặp bản gốc/bản mới cũng chính là bằng chứng **mở khoá mục 9b** khi xác nhận.

---

## 8. In bản kiểm soát và tra cứu QR

### 8.1. In
- Ở trang chi tiết, chỉ tài liệu **đang Hiệu lực** mới có nút **"In bản kiểm soát"**.
- Bản in được đóng **lớp phủ**: số hiệu, phiên bản, mã bản in, ngày in, mã QR, và dòng cảnh báo đỏ:
  *"Bản in chỉ có giá trị tại thời điểm in — quét QR để kiểm tra"*.
- Tệp gốc không bị sửa; lớp phủ chỉ đóng khi kết xuất.

### 8.2. Tra cứu QR (công khai)
- Quét QR mở trang `/verify/<mã>` — **không cần đăng nhập**, đọc được cách một mét.
- Trang chỉ trả **tình trạng**, tuyệt đối không hiện nội dung tài liệu, nhãn hay danh sách người nhận:
  - **Còn hiệu lực**: nền xanh, dấu ✓.
  - **Hết hiệu lực / Thu hồi / Bản in đã thu hồi**: nền đỏ, dấu ✕; nếu hết hiệu lực có nêu phiên bản đang áp dụng.
  - **Không rõ**: không tìm thấy bản in.

---

## 9. Phân phối và ma trận

- Ở trang chi tiết, người có quyền release quản lý **ma trận phân phối**: thêm/xoá dòng theo
  **bộ phận** (và tuỳ chọn **nhóm chức năng**).
- Ma trận lấy **phép giao**: nếu chỉ khai bộ phận → mọi người thuộc bộ phận; nếu khai kèm nhóm
  → chỉ người vừa thuộc bộ phận vừa là thành viên nhóm.

---

## 10. Rà soát định kỳ (các vai trò release)

- Vào **"Rà soát định kỳ"** (`/reviews`): danh sách rà soát tới hạn thuộc phạm vi của bạn.
- Mỗi mục ghi kết luận (verdict):
  - **Giữ nguyên**: đặt lại chu kỳ rà soát.
  - **Cần sửa**: chuyển sang *treo chờ bản mới* (bắt buộc ghi chú).
  - **Huỷ bỏ**: bắt buộc ghi chú.

---

## 11. Gói ban hành (vai trò DC_AUTHOR)

- Nhiều tài liệu phụ thuộc nhau cùng lên hiệu lực một ngày.
- Vào `/packages`: tạo gói (mã, tiêu đề, **ngày hiệu lực**), rồi **gắn** các phiên bản của mình vào gói
  (tối đa **10** thành viên). Khi thuộc gói, phiên bản lấy ngày hiệu lực từ gói.
- Chỉ người tạo gói mới **dời ngày** hoặc **gỡ** thành viên (gỡ bắt buộc lý do).

---

## 12. Hỏi đáp (thử nghiệm)

- `/qa`: hỏi đáp có trích dẫn, **chỉ truy xuất** nội dung tài liệu đang hiệu lực trong phạm vi của bạn.
- Không bịa: nếu không đủ căn cứ sẽ báo không đủ thông tin, và luôn kèm trích dẫn cấp mục.
- Tính năng này **tắt** nếu hệ thống chưa cấu hình `EMBEDDING_API_URL`.

---

## 13. Màn hình quản trị (vai trò DC_ADMIN)

- **Quản trị tổ chức** (`/admin/org`): tạo BU, Site (một Site có thể phục vụ **nhiều BU** — quan hệ N:N),
  Department.
- **Quản trị người dùng** (`/admin/users`): tạo người dùng (mật khẩu ≥ 8 ký tự, email duy nhất),
  gán vào bộ phận, bật/tắt hoạt động.
- **Vai trò** (`/admin/roles`): cấp vai trò theo phạm vi. Hệ thống ép đúng cấp:
  các vai trò toàn hệ thống (ADMIN/AUTHOR/READER/GROUP_OWNER) cấp ở cấp Group; BU/Site/Department
  Owner phải kèm đúng con trỏ phạm vi.
- **Nhóm chức năng** (`/functional-groups`): tạo nhóm với **một người sở hữu**, thêm/xoá thành viên.
- **Chất lượng nạp** (`/ops/quality`) và **Mức độ sử dụng** (`/ops/usage`): báo cáo vận hành.
- **Trưng bày thành phần** (`/design`): trang tài liệu sống hiển thị toàn bộ thành phần giao diện,
  dùng để kiểm hồi quy thị giác.
- **Ghi vết** (`/audit`): tra cứu nhật ký (dành cho vai trò release).

---

## 14. Khởi tạo tài khoản quản trị đầu tiên

Hệ thống mới trống rỗng cần một tài khoản để đăng nhập và khai tổ chức. Sau khi migrate cơ sở dữ liệu,
chạy một lần:

```bash
node scripts/create-admin.mjs <email> <mật khẩu> "<Họ tên>"
```

- Mật khẩu tối thiểu 8 ký tự.
- Script tạo người dùng và cấp `DC_GROUP_OWNER`.
- Để dùng các màn hình quản trị, tài khoản này cần được cấp thêm `DC_ADMIN` (qua `/admin/roles`
  sau khi đã có một admin, hoặc theo quy trình cấp quyền của đội vận hành).

---

## 15. Mẹo sử dụng

- Giao diện tối ưu cho **máy tính**; chỉ trang tra cứu QR tối ưu cho điện thoại.
- Màu **luôn đi kèm chữ/ký hiệu** — bản in đen trắng vẫn phân biệt được trạng thái.
- Nếu một nút bị khoá, hệ thống nêu **lý do ngay cạnh nút** (ví dụ mục 9b chờ xem so sánh).
- Sau khi cập nhật phiên bản ứng dụng, nếu giao diện chưa đổi, hãy tải lại cứng trình duyệt (Ctrl+F5)
  để bỏ cache CSS.
