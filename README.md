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

**Giai đoạn 0 — nền móng (T-001 → T-009): hoàn tất.**
Server, cấu hình, kết nối CSDL, trình chạy migration, schema DCS-4, ghi vết,
xử lý lỗi, bộ kiểm thử ràng buộc, khung giao diện.

Các giai đoạn tiếp theo (định danh, đăng ký, xác nhận, vòng đời, nội dung, tìm
kiếm, phân phối, in/QR/hỏi đáp) theo danh sách việc DCS-9.

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
