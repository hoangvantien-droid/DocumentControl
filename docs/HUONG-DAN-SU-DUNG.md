# DCS — Hướng dẫn sử dụng

Hệ Quản lý & Phân phối Tài liệu Điện tử (DCS). Tài liệu này hướng dẫn người dùng cuối
sử dụng ứng dụng theo mô hình **"đăng ký là ban hành luôn"**: đăng nhập, tìm và đọc
tài liệu, đăng ký ban hành, tiếp nhận (chấp nhận/từ chối) tài liệu theo site, báo sai
nội dung, thu hồi, in bản kiểm soát và tra cứu QR.

Phạm vi ứng dụng là **khâu SAU phê duyệt**: soạn thảo và ký duyệt thuộc hệ thống khác.
DCS tiếp nhận tài liệu đã duyệt, ban hành, phân phối theo site, xác nhận đọc, in ấn và tra cứu.

> **Mô hình hiện hành (quan trọng).** Không còn duyệt hai lớp. Người biên soạn (Author)
> đăng ký tài liệu là **ban hành thẳng** (trạng thái *Đã ban hành*). Hệ thống sinh một
> **phiếu tiếp nhận (receipt)** cho mỗi site nhận; bộ phận Kiểm soát tài liệu của site
> **chấp nhận** hoặc **từ chối** phiếu đó. Không có bước "chờ xác nhận" / "release" tập trung.

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
- Đăng xuất: vào `/logout` (hoặc nút *Đăng xuất* ở góc phải thanh trên).

### 1.3. Thực đơn theo vai trò
Thanh điều hướng bên trái **ẩn hẳn** mục mà bạn không có quyền (xem `src/middleware/nav.ts`).
Admin-thuần (chỉ `DC_ADMIN`) đứng **ngoài** luồng tài liệu, chỉ thấy phần quản trị; Author,
Kiểm soát tài liệu site và Reader thấy phần luồng tài liệu tương ứng.

---

## 2. Vai trò và quyền

DCS hiện dùng **bốn vai trò đang hoạt động** (nguồn: `src/views/labels.ts` → `ROLE_LABELS`).
Một người có thể mang nhiều vai trò. Các vai "chủ nguồn" cũ (Group/BU/Site QA/Dept Head)
đã ngừng gán mới — chỉ còn nhãn để đọc dữ liệu lịch sử.

| Vai trò (mã) | Nhãn | Làm được gì |
|---|---|---|
| `DC_ADMIN` | Quản trị hệ thống | Quản trị tổ chức, người dùng, vai trò, báo cáo vận hành. Đứng ngoài luồng tài liệu. |
| `DC_AUTHOR` | Biên soạn tài liệu | Đăng ký = ban hành thẳng, lưu nháp, phát hành tới site, sửa/thu hồi/xóa bản chưa được chấp nhận. |
| `DC_SITE_DOC_CONTROL` | Kiểm soát tài liệu (site) | Tiếp nhận phiếu của site mình: chấp nhận / từ chối; thẩm định report của Reader. |
| `DC_READER` | Người đọc | Đọc và tìm kiếm tài liệu trong phạm vi được phép; gửi report báo sai. |

Cờ thực đơn suy ra từ vai trò (`buildNav` trong `src/middleware/nav.ts`):
- *Đăng ký / "Tài liệu của tôi"* nếu có `DC_AUTHOR`.
- *Chờ site phản hồi* + hộp report nếu có `DC_SITE_DOC_CONTROL` (kèm badge đếm phiếu chờ).
- *Quản trị viên* nếu có `DC_ADMIN`.

---

## 3. Vòng đời và trạng thái

Nguồn duy nhất về trạng thái: `src/domain/lifecycle-status.ts`; nhãn hiển thị: `src/views/labels.ts`.

### 3.1. Trạng thái phiên bản tài liệu

| Trạng thái (mã) | Nhãn | Ý nghĩa |
|---|---|---|
| `cho_hoan_thien` | Nháp chờ hoàn thiện | Bản nháp đã lưu, chưa đăng ký. |
| `da_ban_hanh` | Đã ban hành | Đăng ký xong = ban hành thẳng. Đây là trạng thái **hiện hành** chính. |
| `thu_hoi` | Đã thu hồi | Author đã thu hồi (bắt buộc lý do). Không còn hiện hành. |
| `het_hieu_luc` | Hết hiệu lực | Bị phiên bản mới thay thế. Không còn hiện hành. |

Các mã cũ (`cho_xac_nhan`, `tu_choi`, `da_dang_ky`, `hieu_luc`) chỉ còn để đọc dữ liệu
giai đoạn chuyển đổi; `da_dang_ky` và `hieu_luc` vẫn được xem là "hiện hành" cho dữ liệu cũ
(`CURRENT_VIEW_STATUSES = ['da_ban_hanh','hieu_luc','da_dang_ky']`).

Ngày hiệu lực ở tương lai: Reader **không** thấy và site **không** chấp nhận được cho tới
đúng ngày (`isEffectiveNow` trong `lifecycle-status.ts`).

### 3.2. Trạng thái phiếu tiếp nhận (receipt) theo site

Mỗi phiên bản × mỗi site = **một** phiếu (`document_receipt`, ràng buộc `uq_receipt_version_site`).

| Trạng thái (mã) | Nhãn | Ý nghĩa |
|---|---|---|
| `cho_phan_hoi` | Chờ phản hồi | Phiếu vừa phát hành, site chưa phản hồi. |
| `chap_nhan` | Đã chấp nhận | Site đã chấp nhận, ghi `apply_date` (ngày site áp dụng). |
| `tu_choi` | Đã từ chối | Site từ chối, kèm **loại** và lý do. |

Khi từ chối, site chọn **loại** (`src/views/labels.ts` → `RECEIPT_REJECT_TYPE_LABELS`):
- `sai_dang_ky` — "Sai thông tin đăng ký" (Author sửa metadata hoặc phát hành lại được).
- `sai_noi_dung` — "Sai nội dung tài liệu" (phải thu hồi + ban hành bản mới).

### 3.3. Trạng thái tổng hợp mức phiên bản (suy từ tập receipt)

`aggregateStatusOf` trong `lifecycle-status.ts` suy ra: `chua_phat_hanh` → `dang_cho` →
`mot_phan` → `toan_bo`; chỉ cần **một** phiếu từ chối là chuyển `tranh_chap` (ưu tiên hiển thị
vì cần Author xử lý). Nhãn người dùng thấy do `aggregateDisplay` quyết định, tách rõ
"Có site báo sai đăng ký" (amber) với "Có site báo sai nội dung" (đỏ).

---

## 4. Tìm và đọc tài liệu

### 4.1. Tìm kiếm
- Ô tìm ở thanh trên: gõ số hiệu, tiêu đề hoặc nội dung. Gợi ý hiện sau khi gõ từ 2 ký tự.
- Tìm **không dấu vẫn ra kết quả có dấu** (ví dụ gõ `mau luu` ra `mẫu lưu`).
- Khớp một phần số hiệu cũng ra; khớp số hiệu được ưu tiên lên đầu.
- Trang kết quả (`/search`): mặc định chỉ hiện bản **hiện hành** (đã ban hành, đã tới ngày hiệu lực).
  Có thể bật xem cả bản lịch sử (hết hiệu lực) khi cần.

### 4.2. Xem chi tiết
Mở một tài liệu (`/documents/<id>`):
- Đầu trang: số hiệu, phiên bản, tiêu đề, **nhãn trạng thái** và **nhãn phạm vi**.
- Dải cảnh báo (nếu có): *Hết hiệu lực*, *Thu hồi*, hoặc *Quá hạn rà soát*.
- Nếu đang xem bản không còn hiệu lực, có liên kết tới **bản đang áp dụng**.

### 4.3. Xác nhận đã đọc và kế thừa khi lên phiên bản
- Khi tài liệu có diện người phải đọc, hệ thống ghi nhận xác nhận kèm **bối cảnh bộ phận/nhóm
  tại thời điểm xác nhận** (không tra lại L1 về sau).
- Khi có phiên bản mới:
  - **Thay đổi nhỏ**: xác nhận cũ được **kế thừa** (sao chép bản ghi), không phải đọc lại.
  - **Thay đổi lớn**: **đặt lại**, mọi người phải xác nhận đọc lại.

### 4.4. Báo sai (report của Reader)
- Reader gửi report bất thường gắn phiên bản; site nhận report suy từ **Dept chính** của người báo
  (`createIssueReport` trong `src/domain/issue-report.ts`). Chưa gắn site thì không gửi được.
- Report **không** tự đổi trạng thái tài liệu — chỉ là tín hiệu nội bộ trong site.
- DC Site thẩm định report:
  - Chuyển thành **từ chối** phiếu của site (khi phiếu còn *chờ phản hồi*).
  - **Bác bỏ** report (bắt buộc lý do).
  - Nếu site **đã chấp nhận** rồi: không được biến report thành "từ chối sai đăng ký"
    (phải thu hồi + ra bản mới); riêng **sai nội dung sau khi đã chấp nhận** đi đường báo riêng
    (`bao_sai_noi_dung_sau_chap_nhan`), giữ nguyên phiếu *chấp nhận* và ghi audit để xử lý ở mức phiên bản.

---

## 5. Đăng ký ban hành tài liệu (vai trò DC_AUTHOR)

Vào **"Tài liệu của tôi"** (`/my-documents`) hoặc `/register`. Đăng ký là **ban hành thẳng**.

### 5.1. Điền form
Các trường chính (nguồn: `src/routes/documents.ts`, `src/domain/registration.ts`):
- **Số hiệu** (doc_id) — người đăng ký nhập, không tự sinh.
- **Loại** và **Nguồn** (Nội bộ / Ngoại bộ).
- **Cấp phạm vi** (`group` / `bu` / `site` / `dept`) và con trỏ phạm vi tương ứng.
- **Tệp PDF**: **bắt buộc** tải lên (tối đa 25 MB; hệ thống tính SHA-256).
- **Phiên bản, tiêu đề, ngày ban hành, ngày hiệu lực (DCS), chu kỳ rà soát (tháng), ngày hết hạn**.
- **Số hồ sơ phê duyệt** (bắt buộc với tài liệu **nội bộ**), **ngày hiệu lực pháp lý** (với **ngoại bộ**).
- **Bộ phận sở hữu**. Khi chọn, hệ thống hiện **số người nhận dự kiến** theo thời gian thực
  (`/register/recipient-count`).
- **Các site nhận**: tick tập site thực nhận; mỗi site được tạo một phiếu *chờ phản hồi*.
- Nếu là **phiên bản thay thế**: khai `supersedes` (bản gốc phải đang *Đã ban hành* / hoặc mã cũ
  `hieu_luc` / `da_dang_ky`), **mức độ thay đổi** (Lớn/Nhỏ) và **tóm tắt thay đổi** (bắt buộc nếu Lớn).

### 5.2. Lưu nháp và đăng ký
- **Lưu nháp** (`/register/draft`): lưu ở *Nháp chờ hoàn thiện*, không chạy kiểm đầy đủ. Mở lại sửa ở
  `/my-documents/:id/edit`.
- **Đăng ký**: tạo phiên bản *Đã ban hành* ngay và phát hành phiếu tới các site đã chọn; tự bóc tách
  nội dung PDF (best-effort). Theo dõi ở `/my-documents`.

### 5.3. Theo dõi tình trạng ban hành theo site
Mở `/my-documents/:id/issuance`: ma trận phiếu theo site + trạng thái tổng hợp, và các hành động
tùy điều kiện receipt:
- **Phát hành thêm site** / **phát hành lại** (`/publish-sites`): chỉ site trong phạm vi; phát hành lại
  được với site từ chối *sai đăng ký*; **chặn** khi có site từ chối *sai nội dung*; **tôn trọng khóa
  metadata** — đã có site chấp nhận thì không phát hành lại metadata cũ (`publishAdditionalSites`).

---

## 6. Sửa / thu hồi / xóa bản đã ban hành (vai trò DC_AUTHOR)

Điều kiện mở xét trên **toàn bộ** phiếu của phiên bản (`src/domain/receipt.ts`):

- **Sửa metadata tại chỗ** (`/my-documents/:id/edit-metadata`): chỉ khi **chưa site nào chấp nhận**
  và phiên bản đang *Đã ban hành*. Giữ nguyên `doc_id` và tệp/hash. Không được đặt ngày hiệu lực về
  quá khứ; **không nhập lại ngày hết hạn thì giữ nguyên** (chỉ xóa khi gửi rỗng cố ý).
- **Thu hồi** (`/my-documents/:id/recall`): bắt buộc lý do; mở cả khi đã có site chấp nhận
  (`recallByAuthor`). Ra bản mới đi qua luồng đăng ký với `supersedes`.
- **Xóa** (`/my-documents/:id/delete`): chỉ khi **chưa có chấp nhận nào** (xóa kèm phiếu theo cascade).

> Khóa chung "đã có site chấp nhận" áp cho cả sửa metadata và phát hành lại: một khi có ≥1 site
> chấp nhận, không ghi đè metadata cũ nữa — phải ra phiên bản mới.

---

## 7. Tiếp nhận phiếu theo site (vai trò DC_SITE_DOC_CONTROL)

Vào mục **"Chờ site phản hồi"** — hàng đợi các phiếu *chờ phản hồi* của các site bạn phụ trách
(`pendingReceiptsForSites`). Badge cạnh menu đếm số phiếu chờ, **loại trừ** phiếu của tài liệu đã
thu hồi (`pendingReceiptCountForSites` + nav badge).

- **Chấp nhận** (`acceptReceipt`): ghi `apply_date` (mặc định hôm nay). Không chấp nhận được khi tài
  liệu đã **thu hồi** hoặc **chưa tới ngày hiệu lực**; ngày áp dụng không được **sớm hơn** ngày hiệu lực.
- **Từ chối** (`rejectReceipt`): bắt buộc chọn **loại** (sai đăng ký / sai nội dung) và nhập lý do.
- Nếu người phản hồi trùng người đăng ký: hệ thống **vẫn cho** nhưng ghi **audit cảnh báo**
  (`tu_phan_hoi_canh_bao`).

Hộp **report của Reader**: thẩm định (chuyển thành từ chối / bác bỏ) theo mục 4.4.

---

## 8. In bản kiểm soát và tra cứu QR

### 8.1. In
- Ở trang chi tiết, tài liệu **hiện hành** mới có nút **"In bản kiểm soát"**.
- Bản in được đóng **lớp phủ**: số hiệu, phiên bản, mã bản in, ngày in, mã QR và dòng cảnh báo đỏ.
- Tệp gốc không bị sửa; lớp phủ chỉ đóng khi kết xuất.

### 8.2. Tra cứu QR (công khai)
- Quét QR mở `/verify/<mã>` — **không cần đăng nhập**.
- Trang chỉ trả **tình trạng** (Còn hiệu lực / Hết hiệu lực / Thu hồi / Bản in đã thu hồi / Không rõ),
  tuyệt đối không hiện nội dung, nhãn hay danh sách người nhận.

---

## 9. Rà soát định kỳ

- Bộ phận sở hữu theo dõi tài liệu tới hạn rà soát; bộ lọc **"Quá hạn xem xét"** dựa trên
  `next_review_date` của các tài liệu **hiện hành** (gồm `da_ban_hanh`).
- Tài liệu **hết hạn chỉ được cảnh báo**, hệ thống **không** tự đổi trạng thái sang "Hết hiệu lực".

---

## 10. Hỏi đáp AI (thử nghiệm)

- `/qa`: hỏi đáp có trích dẫn, **chỉ truy xuất** nội dung tài liệu hiện hành trong phạm vi của bạn.
- Luôn kèm trích dẫn cấp mục; không đủ căn cứ thì báo không đủ thông tin.
- Tính năng này **tắt** nếu hệ thống chưa cấu hình `EMBEDDING_API_URL`.

---

## 11. Màn hình quản trị (vai trò DC_ADMIN)

- **Quản trị tổ chức** (`/admin/org`): BU, Site (một Site có thể phục vụ **nhiều BU** — N:N), Department.
- **Quản trị người dùng** (`/admin/users`): tạo người dùng (mật khẩu ≥ 8 ký tự, email duy nhất),
  gán bộ phận, bật/tắt hoạt động.
- **Vai trò** (`/admin/roles`): cấp vai trò (bốn vai đang hoạt động) theo phạm vi.
- **Báo cáo vận hành**: chất lượng nạp và mức độ sử dụng.
- **Ghi vết** (`/audit`): tra cứu nhật ký.

---

## 12. Khởi tạo tài khoản quản trị đầu tiên

Sau khi migrate cơ sở dữ liệu, chạy một lần:

```bash
node scripts/create-admin.mjs <email> <mật khẩu> "<Họ tên>"
```

- Mật khẩu tối thiểu 8 ký tự.
- Để dùng các màn hình quản trị, tài khoản cần vai `DC_ADMIN` (gán qua `/admin/roles`).

---

## 13. Mẹo sử dụng

- Giao diện tối ưu cho **máy tính**; chỉ trang tra cứu QR tối ưu cho điện thoại.
- Màu **luôn đi kèm chữ/ký hiệu** — bản in đen trắng vẫn phân biệt được trạng thái.
- Nếu một nút bị khoá, hệ thống nêu **lý do ngay cạnh nút**.
- Sau khi cập nhật phiên bản ứng dụng, nếu giao diện chưa đổi, hãy tải lại cứng trình duyệt (Ctrl+F5).
