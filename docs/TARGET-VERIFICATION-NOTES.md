# Lưu ý kiểm chứng trên target

Danh sách việc cần kiểm chứng trực tiếp trên môi trường target (VPS, có
Postgres + schema đã migrate). Máy dev không có DB nên các mục dưới đây chưa
xác nhận được tại chỗ.

## 1. Lỗi "Phải chọn ít nhất một site nhận tài liệu" khi đăng ký

Trạng thái: ĐÃ PHÂN TÍCH, CHỜ KIỂM CHỨNG TRÊN TARGET.

Bối cảnh: mô hình receipt mới bắt buộc chọn ít nhất một site khi đăng ký
(submitRegistration ném BusinessError reg.no_site nếu siteIds rỗng -> HTTP 422,
render lại form kèm thông báo). Tham chiếu code:
- src/domain/registration.ts (kiểm siteIds rỗng)
- src/routes/documents.ts (đọc b.site_ids qua normalizeSiteIds)
- src/views/register.eta (checkbox name="site_ids")

Đã loại trừ (không phải nguyên nhân):
- Đường truyền site_ids KHÔNG có bug. Đã kiểm chứng @fastify/multipart mode
  keyValues: nhiều checkbox cùng tên -> mảng; một checkbox -> chuỗi. Hàm
  normalizeSiteIds xử lý đúng cả hai.

Nguyên nhân khả dĩ nhất:
- DB CHƯA KHAI SITE NÀO -> fieldset site render rỗng -> người dùng không có
  checkbox để tick -> luôn nhận lỗi sau khi nộp dù không làm sai.

Đã xử lý (phía UI):
- Thêm cảnh báo ngay trên form khi không có site: "Chưa có site nào — liên hệ
  quản trị để thêm site" (src/views/register.eta, lớp .register-no-site).

Cần kiểm chứng trên target:
1. Kiểm tra DB đã có site chưa:
   psql: SELECT site_id, site_code, name FROM org_site ORDER BY site_code;
2. Nếu trống: chạy seed hoặc thêm site qua màn Quản trị tổ chức.
   node scripts/uat/seed_uat.js   (tạo site MML + HCM, kèm DC Site mỗi site)
3. Mở lại màn Đăng ký, xác nhận có checkbox site để tick.
4. Tick >= 1 site, nộp -> đăng ký thành công, sinh receipt cho_phan_hoi/site.
5. Nếu ĐÃ CÓ site, ĐÃ tick mà vẫn lỗi: lấy log quanh request 422:
   journalctl -u dcs --since "10 min ago" | grep -i "register\|site\|422"
   rồi gửi lại để đào sâu tiếp.

Ghi nhận: nếu xác nhận nguyên nhân là DB chưa seed site, đây là vấn đề dữ liệu
môi trường (không phải bug code). Cảnh báo trên form giúp người dùng không bị
kẹt mà không hiểu vì sao.
