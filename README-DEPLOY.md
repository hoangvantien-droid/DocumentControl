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

## Rehearsal bắt buộc cho Ver2 migration 005

> **Không chạy `npm run migrate`, `deploy/deploy.sh` hoặc `deploy/deploy-tienhv.sh`
> trên production khi `005_ver2_organization_authorization.sql` chưa được
> rehearsal và QA phê duyệt. Hai script deploy hiện tại tự chạy migration.

Migration 005 là forward migration, không được sửa migration cũ và không được
chạy thử trên dữ liệu thật. Nó đổi tên các bảng người dùng để giữ UUID/FK lịch
sử, chuyển Site–BU sang N:N, mở rộng sang bảy role Ver2 và tạo tương thích
chỉ-đọc cho tên bảng cũ.

1. **Backup và chuẩn bị bản sao cô lập.** Dừng thay đổi nghiệp vụ trong thời
   điểm lấy backup. Backup cả PostgreSQL lẫn `/var/dcs/files`, rồi khôi phục
   database vào một database rehearsal riêng (ví dụ `dcs_ver2_rehearsal`) và
   dùng một file storage bản sao. Không chia sẻ endpoint với production.
2. **Lưu bằng chứng trước migration trên bản rehearsal.** Chạy những lệnh sau
   trước khi áp 005; các file kết quả là cơ sở chứng minh UUID không đổi:

   ```bash
   psql "$REHEARSAL_DATABASE_URL" -Atc \
     "SELECT user_id FROM app_user_ref ORDER BY user_id" > before-users.txt
   psql "$REHEARSAL_DATABASE_URL" -Atc \
     "SELECT user_id || '|' || dept_id FROM app_user_dept ORDER BY 1" > before-user-departments.txt
   psql "$REHEARSAL_DATABASE_URL" -Atc \
     "SELECT user_role_id || '|' || user_id FROM app_user_role ORDER BY 1" > before-user-roles.txt
   ```

3. **Chạy migration chỉ trên bản rehearsal.** Nạp cấu hình rehearsal (bao gồm
   `SESSION_SECRET` và `FILE_STORAGE_PATH` bản sao), sau đó đặt
   `DATABASE_URL` thành URL rehearsal và chạy:

   ```bash
   DATABASE_URL="$REHEARSAL_DATABASE_URL" npm run migrate
   ```

   Xác nhận `005_ver2_organization_authorization.sql` chỉ xuất hiện một lần
   trong `schema_migrations`. Không chạy lại câu lệnh này trên production ở
   giai đoạn rehearsal.

4. **Đối chiếu dữ liệu và schema sau migration.** Tất cả các kiểm tra sau phải
   cho kết quả mong đợi (không có dòng thiếu/lệch):

   ```bash
   diff -u before-users.txt <(psql "$REHEARSAL_DATABASE_URL" -Atc \
     "SELECT user_id FROM users ORDER BY user_id")
   diff -u before-user-departments.txt <(psql "$REHEARSAL_DATABASE_URL" -Atc \
     "SELECT user_id || '|' || dept_id FROM user_departments ORDER BY 1")
   diff -u before-user-roles.txt <(psql "$REHEARSAL_DATABASE_URL" -Atc \
     "SELECT user_role_id || '|' || user_id FROM user_roles ORDER BY 1")

   psql "$REHEARSAL_DATABASE_URL" -c "
     SELECT
       (SELECT count(*) FROM org_site WHERE legacy_primary_bu_id IS NOT NULL) AS expected_mappings,
       (SELECT count(*) FROM org_site_bu) AS actual_mappings,
       (SELECT count(*) FROM org_site s
         WHERE s.legacy_primary_bu_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM org_site_bu sb
                            WHERE sb.site_id = s.site_id
                              AND sb.bu_id = s.legacy_primary_bu_id)) AS missing_mappings;"

   psql "$REHEARSAL_DATABASE_URL" -c "
     SELECT count(*) AS active_group_owners_without_admin
       FROM user_roles g
      WHERE g.role_code = 'DC_GROUP_OWNER' AND g.is_active
        AND NOT EXISTS (SELECT 1 FROM user_roles a
                         WHERE a.user_id = g.user_id
                           AND a.role_code = 'DC_ADMIN' AND a.is_active);"

   psql "$REHEARSAL_DATABASE_URL" -c "
     SELECT table_name, is_updatable
       FROM information_schema.views
      WHERE table_schema = 'public'
        AND table_name IN ('app_user_ref', 'app_user_dept', 'app_user_role')
      ORDER BY table_name;"
   ```

   `expected_mappings` phải bằng `actual_mappings`, `missing_mappings` và
   `active_group_owners_without_admin` phải là `0`, ba view compatibility phải
   có `is_updatable = NO`, và cả ba lệnh `diff` không được in khác biệt.

5. **Kiểm thử nghiệp vụ trên bản rehearsal.** QA gán danh sách chính thức cho
   `DC_ADMIN`, `DC_DEPT_HEAD`, BU/Site/Group owner (backfill từ Group Owner chỉ
   là biện pháp chống lockout), rồi xác minh release đúng phạm vi: Group chỉ
   Group, BU chỉ BU khớp, Site QA chỉ Site khớp, Department Head chỉ Department
   khớp. Kiểm tra thêm tìm kiếm và màn QA đối với Site có nhiều BU.

6. **Chạy constraint suite trên DB test rỗng, riêng biệt.** Suite này **xóa toàn
   bộ schema** và hiện chỉ dựng schema kiểm soát nền, nên không thay thế các
   đối chiếu rehearsal ở bước 4. URL phải có chữ `test` trong tên database:

   ```bash
   DATABASE_URL_TEST="$DCS_CONSTRAINTS_TEST_DATABASE_URL" npm run test:constraints
   ```

Chỉ sau khi checklist có bằng chứng, QA phê duyệt role chính thức và backup
production đã được thử phục hồi mới được lên lịch triển khai production. Giữ
backup cho tới khi smoke test production, kiểm tra quyền release và đối chiếu
số liệu hậu triển khai hoàn tất.

## Nâng cấp phiên bản sau này

```bash
cd /opt/dcs && sudo -u dcs git pull && sudo bash deploy/deploy.sh
```

Migration idempotent nên chạy lại an toàn — chỉ áp các file `.sql` mới. Với
migration 005, tuân thủ checklist rehearsal ở trên trước khi dùng lệnh deploy
trên production.

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
