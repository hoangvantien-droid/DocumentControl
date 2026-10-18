# DCS — Hệ Quản lý & Phân phối Tài liệu Điện tử

Ứng dụng quản lý vòng đời tài liệu chất lượng sau phê duyệt: đăng ký, xác nhận
hai lớp, phiên bản, phân phối, xác nhận đọc, dán nhãn nội dung, tìm kiếm và hỏi
đáp AI có trích dẫn. Tích hợp với QDMS và tầng định danh dùng chung L1.

Đặc tả đầy đủ: `.kiro/specs/Document control/` (DCS-1 → DCS-10).

## Ngăn xếp (DCS-8, chốt cứng)

- TypeScript trên Node 20 LTS
- Fastify 4 (web), `postgres` (porsager) — SQL thuần, **không ORM**
- Kết xuất phía máy chủ + htmx 2, khuôn mẫu Eta 3
- `node:test`, `argon2` (băm mật khẩu)
- PostgreSQL 16 + extension: `pgcrypto`, `unaccent`, `pg_trgm`, `vector`

## Trạng thái

**Toàn bộ giai đoạn 0 → 10 của DCS-9 (T-001 → T-103): đã viết code.**

| Giai đoạn | Nội dung |
|---|---|
| 0 | Nền móng: server, config, CSDL, migration, schema DCS-4, ghi vết, lỗi, khung giao diện, bộ test ràng buộc |
| 1 | Định danh & phân quyền: đăng nhập argon2id, phiên DB, getCurrentUser, quản trị tổ chức/người dùng/vai trò, canRelease, menu theo vai trò |
| 2 | Đăng ký & xác nhận: form đăng ký, checklist 12 mục, guard ngày hiệu lực, xác nhận/từ chối |
| 3 | Vòng đời: lập lịch chuyển hiệu lực, thu hồi, danh mục lọc quyền, chi tiết, trang chủ |
| 4 | Nội dung & nhãn: đọc PDF, bóc tách mục, OCR rời, phân đoạn (không cắt bảng) |
| 5 | Tìm kiếm & so sánh phiên bản |
| 6 | Phân phối & xác nhận đọc (phép giao), nhóm chức năng |
| 7 | Rà soát định kỳ, gói ban hành, leo thang |
| 8 | Bản in kiểm soát, tra cứu QR công khai, hỏi đáp AI |
| 9-10 | Nạp dữ liệu cũ, báo cáo chất lượng, chỉ số sử dụng, vận hành |

**Đã verify tại chỗ (không cần CSDL):** `tsc --noEmit` sạch, `npm run build`
thành công, server khởi động và mọi route bảo vệ đúng, `npm run test:unit` (logic
phân đoạn/bóc tách) xanh.

**Đã verify trên VPS (2026-10-18):** `npm run test:unit` 105 pass / 0 fail;
UAT final report trong `docs/DCS_UAT_Final_Report.pdf` (414 pass, 0 fail, 56 skip);
production đã chạy đủ 16 migration (001 → 016). Xem `docs/STATUS.md` để biết
trạng thái deploy và task tồn đọng.

## Chạy dưới máy phát triển

Điều kiện tiên quyết: Node 20+, PostgreSQL 16 với 4 extension ở trên.

```bash
# 1. Cài phụ thuộc
npm install

# 2. Tạo hai cơ sở dữ liệu (tên test PHẢI chứa chữ "test")
#    createdb dcs_dev ; createdb dcs_test
#    rồi cài extension trong mỗi DB:
#      CREATE EXTENSION pgcrypto; CREATE EXTENSION unaccent;
#      CREATE EXTENSION pg_trgm;  CREATE EXTENSION vector;

# 3. Cấu hình môi trường
cp .env.example .env    # sửa DATABASE_URL, DATABASE_URL_TEST, SESSION_SECRET...

# 4. Chạy migration (tạo 22 bảng + 8 view; chạy lần hai không lỗi)
npm run migrate

# 5. Khởi động
npm run dev             # mặc định cổng 3100 trong .env mẫu
```

Mở http://localhost:3100 — thấy thanh điều hướng, thực đơn bên, ô tìm kiếm.
Kiểm tra sức khoẻ: http://localhost:3100/healthz

## Kiểm thử

Bộ kiểm thử ràng buộc chạy trên **PostgreSQL thật** (không giả lập — DCS-8 §5.1).
Nó xoá sạch và dựng lại cơ sở dữ liệu test trước mỗi lần chạy.

```bash
# DATABASE_URL_TEST phải trỏ vào DB có chữ "test" trong tên (tự chặn nhầm)
npm test
```

## Cấu trúc thư mục (DCS-8 §2)

```
src/
  server.ts            khởi động Fastify
  config.ts            đọc + kiểm tra biến môi trường
  db/{client,migrate}.ts, migrations/, sql/
  domain/              logic nghiệp vụ thuần (chưa dùng HTTP)
  routes/              điểm cuối HTTP, mỏng
  views/               khuôn mẫu .eta
  jobs/                tác vụ nền
  lib/{audit,errors}.ts
  public/              CSS, htmx
test/                  constraints.test.ts + domain/
deploy/                systemd, nginx, script deploy
```

## Triển khai lên VPS

Xem `README-DEPLOY.md`.

## Ghi chú kỹ thuật cần theo dõi

- `fn_run_escalations` trong schema DCS-4 tham chiếu bảng `users` và
  `app_user_role` **chưa được định nghĩa**. PostgreSQL cho tạo hàm với bảng
  chưa tồn tại (chỉ lỗi khi gọi). Hàm này thuộc giai đoạn 7 (T-082) — cần bổ
  sung bảng vai trò (T-015) và sửa tham chiếu `users` trước khi kích hoạt leo thang.
