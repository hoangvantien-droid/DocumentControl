# Lưu ý kiểm chứng & việc cần làm trên target

Môi trường target: VPS (systemd service "dcs"), có Postgres + schema đã migrate.
Máy dev KHÔNG có Postgres nên mọi thứ chạm DB / trình duyệt chưa xác nhận được
tại chỗ — chỉ verify bằng build (tsc) + Eta compile + test thuần.

Log trên target: journalctl -u dcs -f   (hoặc --since "10 min ago").

---

## 0. Quy trình triển khai bản mới (chạy theo thứ tự)

1. Kéo code mới:   cd /opt/dcs && git pull origin main
2. Cài đặt (nếu đổi deps):   npm ci
3. Build:   npm run build
4. Chạy migration:   npm run migrate
   (áp 017 receipt model, 018 vai DC_SITE_DOC_CONTROL, 019 audit events,
    020 fn_search/v_current_documents coi da_ban_hanh là hiện hành)
5. Seed dữ liệu thử (nếu môi trường mới):   node scripts/uat/seed_uat.js
6. Khởi động lại dịch vụ:   sudo systemctl restart dcs
7. Chạy test DB đầy đủ (tùy chọn):   npm test
   (các test tích hợp mô hình receipt sẽ chạy khi có Postgres)

Tài khoản seed (seed_uat.js) — mật khẩu:
- admin@mml.io / Admin#1234            (DC_ADMIN)
- author@mml.io / Author#1234          (DC_AUTHOR)
- reader@mml.io / Reader#1234          (DC_READER)
- dc_mml@mml.io / DocCtl#1234          (DC_SITE_DOC_CONTROL @ site MML)
- dc_hcm@mml.io / DocCtl#1234          (DC_SITE_DOC_CONTROL @ site HCM)

---

## 1. Lỗi "Phải chọn ít nhất một site nhận tài liệu" khi đăng ký

Trạng thái: ĐÃ PHÂN TÍCH, CHỜ KIỂM CHỨNG.

Đã loại trừ: đường truyền site_ids KHÔNG bug (đã kiểm @fastify/multipart
keyValues: nhiều checkbox cùng tên -> mảng; một -> chuỗi; normalizeSiteIds xử
lý đúng cả hai).

Nguyên nhân khả dĩ nhất: DB CHƯA KHAI SITE -> fieldset site rỗng -> không tick
được -> luôn lỗi. Đã thêm cảnh báo trên form khi không có site.

Kiểm chứng:
1. SELECT site_id, site_code, name FROM org_site ORDER BY site_code;
2. Nếu trống: node scripts/uat/seed_uat.js (hoặc thêm site qua Quản trị tổ chức).
3. Mở màn Đăng ký, xác nhận có checkbox site; tick >=1 site, nộp -> thành công,
   sinh receipt cho_phan_hoi cho mỗi site.
4. Nếu ĐÃ có site, ĐÃ tick mà vẫn lỗi: gửi log quanh request 422.

---

## 2. Màn chi tiết tài liệu hiển thị PDF (Hướng 1)

Trạng thái: ĐÃ CODE, CHỜ KIỂM CHỨNG TRÊN TRÌNH DUYỆT.

- Route mới /documents/:id/view trả PDF inline; /download giữ tải về.
- detail.eta: PDF iframe toàn chiều rộng (80vh) + dải thông tin ngang + các
  panel phụ dạng <details> gập xuống dưới.

Kiểm chứng:
1. Đăng nhập Author/DC Site/Reader, mở một tài liệu da_ban_hanh trong Danh mục.
2. Xác nhận PDF hiển thị full width; panel Thông tin nằm NGANG phía trên, không
   chiếm chiều ngang của PDF.
3. Thử trên cả desktop và một thiết bị mobile (một số mobile hiển thị PDF kém ->
   dùng link fallback "Mở ở tab mới" / "tải về").

---

## 3. Màn "Tài liệu của tôi" (Author)

Trạng thái: ĐÃ CODE, CHỜ KIỂM CHỨNG.

- Số hiệu là link mở trang chi tiết tài liệu (xem lại đầy đủ + PDF).
- Bỏ cột bóc tách. Cột Thao tác: Xem PDF (/view) + Tình trạng + Sửa nháp.

Kiểm chứng: đăng nhập author@mml.io -> Tài liệu của tôi -> bấm số hiệu mở được
chi tiết; "Xem PDF" mở đúng file; bản nháp hiện "Sửa nháp".

---

## 4. Phân quyền menu theo vai (phòng thủ sâu)

Trạng thái: ĐÃ CODE, CHỜ KIỂM CHỨNG BẰNG TỪNG TÀI KHOẢN.

Menu kỳ vọng:
- Admin (admin@mml.io): CHỈ Trang chủ + khu Quản trị (Nhóm chức năng, Tổ chức,
  Người dùng, Vai trò) + Ghi vết. KHÔNG thấy Danh mục/Rà soát/Gói ban hành.
- Author (author@mml.io): Trang chủ, Danh mục, Tài liệu của tôi, Rà soát, Gói
  ban hành.
- DC Site (dc_mml@mml.io): Trang chủ, Danh mục, Chờ site phản hồi, Báo bất
  thường (site). (4 mục; KHÔNG có Rà soát/Gói ban hành.)
- Reader (reader@mml.io): Trang chủ, Danh mục.

Kiểm chứng route guard (gõ URL trực tiếp):
- Admin mở /documents, /reviews -> phải nhận 403 (đứng ngoài luồng tài liệu).
- DC Site mở /packages -> phải nhận 403 (chỉ Author). Menu đã ẩn nên không còn
  đường bấm, nhưng URL trực tiếp vẫn chặn.
- Admin mở /audit -> vào được (Ghi vết thuộc quản trị).

---

## 5. Vai DC_SITE_DOC_CONTROL hoạt động đầy đủ

Trạng thái: CHỜ KIỂM CHỨNG LUỒNG.

1. Đăng nhập dc_mml@mml.io -> thấy "Chờ site phản hồi".
2. Author đăng ký một tài liệu có chọn site MML -> DC Site MML thấy nó trong
   hàng chờ.
3. DC Site mở, Chấp nhận -> receipt chuyển chap_nhan, ghi apply_date.
4. Hoặc Từ chối (sai_dang_ky / sai_noi_dung) + lý do -> aggregate chuyển
   tranh_chap; site khác cùng version thấy cảnh báo.
5. Kiểm "xác nhận hợp lệ": vào Quản trị -> Vai trò, user DC Site có chip
   "Kiểm soát tài liệu site · site". Nếu thiếu chip -> chưa gán đúng vai.

---

## 6. Luồng Author sửa/thu hồi/xóa + Reader report

Trạng thái: CHỜ KIỂM CHỨNG.

- Sửa metadata (Loại 1): chỉ khi CHƯA site nào chấp nhận; đã có -> khóa, báo
  phải ra phiên bản mới. /my-documents/:id/edit-metadata (khóa doc_id + file).
- Thu hồi (Author): khi chưa ai chấp nhận HOẶC có từ chối.
- Xóa: chỉ khi chưa có chấp nhận nào.
- Reader "Báo bất thường" ở màn chi tiết -> DC Site thấy ở "Báo bất thường
  (site)" -> chuyển thành từ chối receipt hoặc bác bỏ.
  (Reader cần có primary_dept_id để suy site; seed đã set.)

---

## 7. Danh mục / tìm kiếm / MCP coi da_ban_hanh là hiện hành

Trạng thái: CHỜ KIỂM CHỨNG (phụ thuộc migration 020).

- Reader chỉ thấy tài liệu hiện hành (da_ban_hanh/hieu_luc/da_dang_ky) theo
  scope + bộ phận.
- Tìm kiếm + MCP trả tài liệu da_ban_hanh mà không cần include_historical.

Kiểm chứng: sau migrate 020, đăng nhập Reader, tìm một tài liệu da_ban_hanh ->
phải ra kết quả.

---

## 8. Việc tồn đọng (chủ động để sau UAT, gom làm 1 lần)

- Route guard cho /my-documents, /site-receipts, /issue-reports: hiện an toàn
  với Admin (lọc rỗng / trang "chưa được gán") nhưng CHƯA trả 403 cứng cho nhất
  quán tuyệt đối. Cân nhắc thêm guard nếu muốn chặt.
- Rà soát các NÚT hành động BÊN TRONG trang (thu hồi, sửa ma trận...) — đã kiểm
  quyền ở route nhưng chưa rà đối chiếu hiển thị-vs-quyền toàn bộ như đã làm với
  menu.
- Các test DB cũ bám vòng đời cũ (skip-domain, constraints) có thể cần cập nhật
  khi chạy npm test trên target (trạng thái cũ vẫn trong CHECK nên phần lớn vẫn
  chạy; rà lại kết quả).
