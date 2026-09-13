# Triển khai DCS lên VPS

Viết cho cấu hình chạy thử đã chốt (DCS-5): **VPS DigitalOcean 1 CPU / 1 GB RAM**,
Ubuntu 22.04, phạm vi BU MeatLife, ~500 tài liệu, L1 chưa có thật.

## 0. Cần mua thêm gì trên DigitalOcean (DCS-5 §2b)

| Khoản | Chi phí | Vì sao |
|---|---|---|
| Backup tự động cho Droplet | ~1,2 USD/tháng | Lớp bảo hiểm rẻ nhất |
| Tên miền | ~10–15 USD/năm | Cần cho HTTPS, đặc biệt trang tra cứu QR |
| SSL Let's Encrypt | Miễn phí | Chỉ cần có tên miền |

**Không** nên mua Managed Database ở giai đoạn này — dành cho khi roll out tập đoàn.
PostgreSQL cài thẳng trên Droplet, không tốn phí.

## 1. Cài đặt nền (chạy một lần)

Đưa mã nguồn lên `/opt/dcs` (git clone hoặc rsync), rồi:

```bash
sudo bash deploy/setup-vps.sh
```

Script này cài: Node 20, PostgreSQL 16 + contrib (pgcrypto/unaccent/pg_trgm),
pgvector, nginx, tesseract (kèm gói tiếng Việt), certbot; tạo swap 2 GB; tạo
user hệ thống `dcs`, thư mục `/opt/dcs` và `/var/dcs/files`; tạo DB `dcs_prod`
và cài 4 extension.

**Sau khi chạy: đổi mật khẩu PostgreSQL** (mặc định trong script là placeholder).

## 2. Cấu hình môi trường

```bash
sudo -u dcs cp /opt/dcs/.env.example /opt/dcs/.env
sudo -u dcs nano /opt/dcs/.env
sudo chmod 600 /opt/dcs/.env
```

Điền:
- `DATABASE_URL=postgres://dcs:MAT_KHAU_THAT@localhost:5432/dcs_prod`
- `SESSION_SECRET=` chuỗi ngẫu nhiên ≥ 32 ký tự (`openssl rand -base64 48`)
- `FILE_STORAGE_PATH=/var/dcs/files`
- `PORT=3100`
- `NODE_ENV=production`

## 3. Triển khai và khởi động dịch vụ

```bash
cd /opt/dcs
sudo bash deploy/deploy.sh
```

Script này: `npm ci` → build → copy views/public/migrations vào `dist/` →
chạy migration → cài unit systemd → khởi động `dcs.service`.

Kiểm tra:
```bash
curl -s http://127.0.0.1:3100/healthz     # {"status":"ok","phase":"foundation"}
sudo systemctl status dcs.service
```

## 4. Nginx + HTTPS

```bash
sudo cp deploy/nginx-dcs.conf /etc/nginx/sites-available/dcs.conf
sudo ln -s /etc/nginx/sites-available/dcs.conf /etc/nginx/sites-enabled/
# Đổi server_name trong file thành tên miền thật, rồi:
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d dcs.example.com    # lấy SSL miễn phí
```

## 5. Sao lưu (DCS-5 §3 — phải sao lưu CẢ tệp lẫn CSDL)

```bash
# Cơ sở dữ liệu
pg_dump -U dcs dcs_prod | gzip > /var/dcs/backup/db-$(date +%F).sql.gz
# Tệp PDF gốc (nằm NGOÀI cơ sở dữ liệu — sao lưu DB không bao gồm chúng)
tar czf /var/dcs/backup/files-$(date +%F).tar.gz /var/dcs/files
```

**Thử phục hồi ít nhất một lần trước khi chạy thật** — bản sao lưu chưa từng
phục hồi là bản sao lưu chưa biết có dùng được không (DCS-5 §3.3).

## 6. Theo dõi (DCS-5 §4.3)

Với 1 GB RAM, thứ cần canh nhất là bộ nhớ:

| Theo dõi | Ngưỡng cảnh báo |
|---|---|
| Bộ nhớ trống | dưới 100 MB |
| Dùng swap | trên 200 MB (dấu hiệu cần nâng cấp) |
| Đĩa | trên 80% |
| Thời gian tìm kiếm | trên 2 giây |

## Nâng cấp phiên bản sau này

```bash
cd /opt/dcs && sudo -u dcs git pull && sudo bash deploy/deploy.sh
```

Migration idempotent nên chạy lại an toàn — chỉ áp các file `.sql` mới.

---

## Triển khai lên tienhv.io.vn (dưới path /dcs/)

Server này chạy backend bằng systemd trên host, nginx trong Docker (container
`tienhv-web`), PostgreSQL trên host. DCS phục vụ tại `https://tienhv.io.vn/dcs/`.

Trên server (user `tao`), chạy:

```bash
cd /home/tao/webserver-tienhv/www
git clone https://github.com/hoangvantien-droid/DocumentControl.git dcs-src
cd dcs-src
bash deploy/deploy-tienhv.sh
```

Script tự: tạo DB `dcs_prod`, cài extension, build, cài `/opt/dcs`, tạo
`/etc/dcs/.env` (BASE_PATH=/dcs, SESSION_SECRET sinh ngẫu nhiên), chạy migration,
cài `dcs.service` (port 3100), thêm block `location /dcs/` vào nginx trong Docker
(`docker cp` + reload), rồi kiểm tra `/dcs/healthz`.

Tạo tài khoản quản trị đầu tiên:

```bash
node scripts/create-admin.mjs admin@tienhv.io.vn 'MatKhauManh123' 'Quản trị DCS'
```

Cập nhật phiên bản sau này:

```bash
cd /home/tao/webserver-tienhv/www/dcs-src && git pull && bash deploy/deploy-tienhv.sh
```

Hỏi đáp AI đang **tắt** (chưa cấu hình `EMBEDDING_API_URL`). Nếu server không có
pgvector, script tự bỏ cột `embedding` — mọi chức năng khác vẫn chạy.
