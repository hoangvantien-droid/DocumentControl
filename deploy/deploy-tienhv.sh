#!/usr/bin/env bash
# deploy/deploy-tienhv.sh — Deploy DCS lên server tienhv.io.vn dưới path /dcs/.
#
# Theo Webserver Deploy Guide: backend chạy systemd trên HOST (port 3100),
# nginx trong Docker container tienhv-web (dùng docker cp + gateway 172.17.0.1),
# PostgreSQL trên host (user dcs). Hỏi đáp AI TẮT (không cấu hình embedding).
#
# Chạy trên server, user tao (script tự dùng sudo khi cần):
#   cd /home/tao/webserver-tienhv/www/dcs-src && bash deploy/deploy-tienhv.sh
#
# Lặp lại được (git pull rồi chạy lại để cập nhật).
set -euo pipefail

# ---- Tham số cố định theo server ----
APP=dcs
PORT=3100
APP_DIR=/opt/dcs
ENV_DIR=/etc/dcs
FILE_DIR=/var/dcs/files
DB_NAME=dcs_prod
DB_USER=dcs
DB_PASS=dcs2026secure
NGINX_CONTAINER=tienhv-web
BASE_PATH=/dcs
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"   # thư mục repo đã clone

echo "==> Deploy DCS từ: $SRC_DIR"

# ---- 0. Phụ thuộc build (argon2 cần build-essential — pitfall #3) ----
echo "==> [0/8] Kiểm tra công cụ build"
if ! dpkg -s build-essential >/dev/null 2>&1; then
  echo "    Cài build-essential…"
  sudo apt-get update -y && sudo apt-get install -y build-essential python3
fi

# ---- 1. PostgreSQL: database + extension ----
echo "==> [1/8] Chuẩn bị PostgreSQL ($DB_NAME)"
# Tạo DB nếu chưa có (user dcs đã tồn tại theo hướng dẫn).
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

# Thử cài pgvector; không bắt buộc (hỏi đáp đang tắt).
PG_VER=$(sudo -u postgres psql -tAc "SHOW server_version_num;" | cut -c1-2)
HAS_VECTOR=1
echo "    PostgreSQL major version: $PG_VER"
if ! sudo -u postgres psql -d "$DB_NAME" -tAc "SELECT 1 FROM pg_available_extensions WHERE name='vector'" | grep -q 1; then
  echo "    Thử cài pgvector…"
  sudo apt-get install -y "postgresql-${PG_VER}-pgvector" 2>/dev/null || HAS_VECTOR=0
fi

# Cài extension (pgvector chỉ khi có).
sudo -u postgres psql -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
sudo -u postgres psql -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS unaccent;"
sudo -u postgres psql -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
if sudo -u postgres psql -d "$DB_NAME" -tAc "SELECT 1 FROM pg_available_extensions WHERE name='vector'" | grep -q 1; then
  sudo -u postgres psql -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS vector;"
  HAS_VECTOR=1
else
  HAS_VECTOR=0
fi
echo "    pgvector: $([ "$HAS_VECTOR" = 1 ] && echo 'có' || echo 'KHÔNG — sẽ bỏ cột embedding')"

# ---- 2. Build ----
echo "==> [2/8] npm ci + build"
cd "$SRC_DIR"
npm ci
npm run build
# Copy tài nguyên runtime (không phải .ts) vào dist.
rm -rf dist/views && cp -r src/views/. dist/views/
rm -rf dist/public && cp -r src/public/. dist/public/
mkdir -p dist/db/migrations dist/db/sql
cp -r src/db/migrations/* dist/db/migrations/ 2>/dev/null || true
cp -r src/db/sql/* dist/db/sql/ 2>/dev/null || true

# Nếu KHÔNG có pgvector: sửa BẢN COPY migration trong dist (giữ 001 gốc trong repo).
if [ "$HAS_VECTOR" = 0 ]; then
  echo "    Vô hiệu hoá cột vector trong bản migration dist (hỏi đáp tắt)…"
  sed -i 's/^CREATE EXTENSION IF NOT EXISTS vector.*/-- vector disabled (no pgvector)/' dist/db/migrations/001_schema.sql
  sed -i 's/embedding[[:space:]]*vector(1536)/embedding TEXT/' dist/db/migrations/001_schema.sql
fi

# ---- 3. Cài vào /opt/dcs ----
echo "==> [3/8] Cài vào $APP_DIR"
sudo mkdir -p "$APP_DIR"
sudo rm -rf "$APP_DIR/dist"
sudo cp -r dist "$APP_DIR/dist"
sudo cp -r node_modules "$APP_DIR/node_modules"
sudo cp package.json "$APP_DIR/package.json"
sudo mkdir -p "$FILE_DIR"
sudo chown -R tao:tao "$APP_DIR" "$FILE_DIR"

# ---- 4. Env ----
echo "==> [4/8] Tạo $ENV_DIR/.env (giữ SESSION_SECRET cũ nếu đã có)"
sudo mkdir -p "$ENV_DIR"
if [ -f "$ENV_DIR/.env" ] && grep -q '^SESSION_SECRET=' "$ENV_DIR/.env"; then
  SECRET=$(grep '^SESSION_SECRET=' "$ENV_DIR/.env" | head -1 | cut -d= -f2-)
else
  SECRET=$(openssl rand -hex 32)
fi
sudo tee "$ENV_DIR/.env" >/dev/null <<EOF
PORT=$PORT
NODE_ENV=production
BASE_PATH=$BASE_PATH
DATABASE_URL=postgres://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME
DATABASE_URL_TEST=postgres://$DB_USER:$DB_PASS@localhost:5432/${DB_NAME}_test
SESSION_SECRET=$SECRET
FILE_STORAGE_PATH=$FILE_DIR
EOF
sudo chmod 600 "$ENV_DIR/.env"
sudo chown tao:tao "$ENV_DIR/.env"

# ---- 5. Migration (verify schema thật) ----
echo "==> [5/8] Chạy migration"
cd "$APP_DIR"
set -a; . "$ENV_DIR/.env"; set +a
node dist/db/migrate.js

# ---- 6. systemd ----
echo "==> [6/8] Cài dịch vụ systemd $APP.service"
sudo tee /etc/systemd/system/$APP.service >/dev/null <<EOF
[Unit]
Description=DCS - He Quan ly & Phan phoi Tai lieu Dien tu
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=tao
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_DIR/.env
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
RestartSec=5
MemoryMax=400M
SyslogIdentifier=$APP

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable "$APP"
sudo systemctl restart "$APP"
sleep 2

# ---- 7. Nginx trong Docker (docker cp + reload) ----
echo "==> [7/8] Cấu hình nginx trong container $NGINX_CONTAINER"
HOST_IP=$(docker network inspect bridge --format "{{range .IPAM.Config}}{{.Gateway}}{{end}}")
echo "    Docker gateway: $HOST_IP"
docker exec "$NGINX_CONTAINER" cat /etc/nginx/conf.d/default.conf > /tmp/dcs-default.conf
if grep -q "location /dcs/" /tmp/dcs-default.conf; then
  echo "    Block /dcs/ đã tồn tại — cập nhật proxy_pass IP"
  # Cập nhật IP phòng khi gateway đổi.
  sed -i "s|proxy_pass http://[0-9.]*:$PORT/;|proxy_pass http://$HOST_IP:$PORT/;|" /tmp/dcs-default.conf
else
  echo "    Thêm block /dcs/"
  sed -i '/^}$/i\
    location /dcs/ {\
        proxy_pass http://'"$HOST_IP"':'"$PORT"'/;\
        proxy_set_header Host $host;\
        proxy_set_header X-Real-IP $remote_addr;\
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\
        proxy_set_header X-Forwarded-Proto $scheme;\
        proxy_http_version 1.1;\
        client_max_body_size 25m;\
    }' /tmp/dcs-default.conf
fi
docker cp /tmp/dcs-default.conf "$NGINX_CONTAINER":/etc/nginx/conf.d/default.conf
docker exec "$NGINX_CONTAINER" nginx -t
docker exec "$NGINX_CONTAINER" nginx -s reload

# ---- 8. Verify ----
echo "==> [8/8] Kiểm tra"
echo -n "    Backend trực tiếp /healthz: "; curl -s "http://127.0.0.1:$PORT/healthz" || echo "LỖI"
echo ""
echo -n "    Qua nginx /dcs/healthz: "; curl -s "http://127.0.0.1:8080/dcs/healthz" || echo "LỖI"
echo ""
echo -n "    Trạng thái dịch vụ: "; systemctl is-active "$APP"

echo ""
echo "==> XONG. https://tienhv.io.vn/dcs/"
echo "    Tạo admin đầu tiên:  cd $SRC_DIR && node scripts/create-admin.mjs <email> <mật khẩu> \"<Họ tên>\""
