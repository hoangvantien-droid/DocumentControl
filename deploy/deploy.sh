#!/usr/bin/env bash
# deploy/deploy.sh — Trien khai/cap nhat DCS len VPS.
# Chay TREN VPS sau khi da dua ma nguon vao /opt/dcs (qua git pull hoac rsync).
#
#   sudo bash deploy/deploy.sh
#
# Cac buoc: cai deps -> build -> chay migration -> cai/nap lai systemd -> restart.
set -euo pipefail

APP_DIR=/opt/dcs
cd "$APP_DIR"

echo "==> [1/6] Kiem tra .env ton tai"
if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "LOI: thieu $APP_DIR/.env (sao chep tu .env.example va dien gia tri that)"
  exit 1
fi

echo "==> [2/6] Cai dependencies (chi production sau khi build)"
npm ci

echo "==> [3/6] Build TypeScript -> dist/"
npm run build
# Sao chep tai nguyen khong phai .ts ma runtime can (views .eta, public/, sql).
cp -r src/views dist/views
cp -r src/public dist/public
mkdir -p dist/db/migrations dist/db/sql
cp -r src/db/migrations/* dist/db/migrations/ 2>/dev/null || true
cp -r src/db/sql/* dist/db/sql/ 2>/dev/null || true

echo "==> [4/6] Chay migration (idempotent — bo qua file da chay)"
npm run migrate

echo "==> [5/6] Cai/nap lai unit systemd"
cp deploy/dcs.service /etc/systemd/system/dcs.service
cp deploy/dcs-jobs.service /etc/systemd/system/dcs-jobs.service
cp deploy/dcs-jobs.timer /etc/systemd/system/dcs-jobs.timer
systemctl daemon-reload
systemctl enable dcs.service dcs-jobs.timer

echo "==> [6/6] Khoi dong lai dich vu"
chown -R dcs:dcs "$APP_DIR"
systemctl restart dcs.service
sleep 2
systemctl --no-pager --lines=10 status dcs.service || true

echo ""
echo "==> XONG. Kiem tra suc khoe:"
echo "    curl -s http://127.0.0.1:3100/healthz"
