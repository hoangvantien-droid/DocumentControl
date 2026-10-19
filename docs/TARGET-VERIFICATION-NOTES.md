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

## 8. Việc tồn đọng (cập nhật)

ĐÃ XỬ LÝ (các đợt sau UAT):
- [x] Chặn Admin ở route trang nghiệp vụ (requireDocFlow cho /documents, /reviews).
- [x] Gỡ link /confirm cũ ở trang chủ (đổi sang dashboard receipt).
- [x] Gỡ TOÀN BỘ vai DC_DEPT_HEAD + lớp duyệt-trước cũ (xem mục 9).
- [x] 2 bug 500 (recall body rỗng, issuance thiếu receiptStatusLabel) + 22P02 uuid rỗng.

CÒN LẠI (tùy chọn, chưa chặn):
- Route guard 403 cứng cho /my-documents, /site-receipts, /issue-reports — hiện
  an toàn (lọc rỗng / trang "chưa được gán"), thêm nếu muốn nhất quán tuyệt đối.
- Tính năng rollout cũ (document_site_rollout) còn trong detail.eta — trùng vai
  trò với receipt theo site; cân nhắc gỡ ở đợt sau (nút "Thêm site" có thể 403
  với người không thuộc bộ phận soạn — là luật đúng, chỉ là UX).
- Test DB cũ (skip-domain, constraints, receipt-model.integration) cần rà/cập
  nhật khi chạy npm test trên target; nhiều ca sẽ xanh lại sau fix 22P02.

---

## 9. Gỡ vai DC_DEPT_HEAD — cần kiểm chứng trên target

Trạng thái: ĐÃ CODE (commit sau 2c59fe6), CHỜ KIỂM CHỨNG.

Thay đổi lớn: bỏ hẳn vai duyệt-trước cũ và lớp /confirm. Deploy kèm MIGRATION 021.

Bắt buộc khi deploy:
1. npm run migrate  — áp 021_deactivate_legacy_release_roles (is_active=FALSE cho
   DC_DEPT_HEAD / DC_SITE_QA_MANAGER / DC_BU_OWNER / DC_GROUP_OWNER còn sót).
2. Kiểm DB: SELECT role_code, count(*) FROM user_roles WHERE is_active GROUP BY 1;
   -> không còn 4 vai cũ ở trạng thái active.

Kiểm chứng luồng (quyền đã đổi chủ):
- Rà soát định kỳ (/reviews): giờ theo BỘ PHẬN SỞ HỮU tài liệu (owner_department_id),
  không còn theo vai release. Đăng nhập Author thuộc dept sở hữu -> thấy & kết
  luận được; người ngoài dept sở hữu -> 403.
- Thu hồi tài liệu: KHÔNG còn ở màn chi tiết (/documents/:id/recall đã xóa).
  Author thu hồi qua /my-documents/:id/recall (màn Tình trạng ban hành).
- Màn chi tiết: KHÔNG còn panel "Phân phối tới" (ma trận thủ công) và nút "Thu
  hồi" — phân phối giờ là receipt theo site.
- /confirm, /pending-confirmation: route đã xóa -> URL trực tiếp trả 404.

Kỳ vọng: không vai nào còn bị kẹt do mất quyền. Nếu một chức năng cần người cũ
(dept head) làm mà giờ không ai làm được, báo lại để gán vai phù hợp.


---

## 10. Chuẩn hóa thuật ngữ ISO 9001 + responsive mobile

Trạng thái: ĐÃ CODE (spec iso-terminology-mobile-ui), CHỜ KIỂM THỊ GIÁC.

Ngôn từ (đã đổi): "Xác nhận tiếp nhận" (thay chấp nhận nhận), "Từ chối tiếp
nhận", "In bản sao có kiểm soát", "Xem xét định kỳ" (thay rà soát), "Ngày có
hiệu lực", "Số hiệu tài liệu", "Phân phối có kiểm soát theo site", menu "Xem
xét định kỳ". Chỉ đổi chữ — không đổi enum/mã.

Responsive: thêm class dùng chung .responsive-table (bảng -> thẻ ở <=768px) +
quy tắc form/nút mobile. Áp cho my-documents, catalog, site-receipts, reviews,
audit, functional-groups, admin/users, admin/roles, site-response-matrix.

Cần kiểm tay trên target (<=768px hoặc DevTools responsive):
1. Mở các màn trên bằng điện thoại -> bảng hiện dạng thẻ "Nhãn: giá trị",
   KHÔNG cuộn ngang.
2. Form đăng ký / phản hồi / lọc danh mục: trường rộng đủ, nút cao dễ chạm.
3. Desktop: bảng vẫn hiển thị dạng bảng như cũ (không hồi quy).
4. Rà nhanh ngôn từ các màn chính đúng thuật ngữ ISO đã liệt kê.


---

## 11. Cảnh báo lỗi nghiệp vụ tại chỗ (friendly-error-messages)

Trạng thái: ĐÃ CODE, CHỜ KIỂM THỊ GIÁC.

- Thay reply.send(err.message) (trang text trắng) bằng helper sendBusinessError:
  request htmx -> toast lỗi góc màn (#toast-zone), KHÔNG rời trang; request
  thường -> trang error.eta có layout + alert-banner (không text trần).
- Nút ở-lại-trang đã gắn htmx + toast: phản hồi receipt (accept/reject), báo
  bất thường (convert/dismiss). Thành công -> HX-Redirect (sendOk).
- Nút chuyển-trang (In, đăng ký...) dùng fallback error.eta khi lỗi.

Kiểm tay trên target:
1. Mở màn phản hồi receipt -> Từ chối thiếu lý do / sai trạng thái -> TOAST
   cảnh báo hiện góc màn, KHÔNG nhảy trang trắng.
2. Chấp nhận/từ chối thành công -> điều hướng về /site-receipts.
3. Bấm In bản chưa hiệu lực -> trang thông báo có layout (không text trần).
4. Lỗi hệ thống (không phải BusinessError) vẫn trả 500 (không bị che).
