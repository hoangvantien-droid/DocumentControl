#!/usr/bin/env bash
# deploy/setup-vps.sh — Cai dat ban dau tren VPS Ubuntu 22.04 (chay MOT LAN).
# Tham chieu: DCS-5 (ha tang), README-DEPLOY.md.
#
# Chay bang quyen root hoac sudo:  sudo bash deploy/setup-vps.sh
set -euo pipefail

echo "==> [1/8] Cap nhat he thong"
apt-get update -y

echo "==> [2/8] Cai Node 20 LTS"
if ! command -v node >/dev/null || [[ "$(node -v)" != v20* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> [3/8] Cai PostgreSQL 16 + contrib (chua pgcrypto, unaccent, pg_trgm)"
apt-get install -y postgresql-16 postgresql-contrib-16 || apt-get install -y postgresql postgresql-contrib

echo "==> [4/8] Cai pgvector (cho cot embedding — bo qua neu tam tat hoi dap AI)"
apt-get install -y postgresql-16-pgvector || echo "   (bo qua pgvector — se tat hoi dap AI)"

echo "==> [5/8] Cai nginx, tesseract, certbot"
apt-get install -y nginx tesseract-ocr tesseract-ocr-vie certbot python3-certbot-nginx

echo "==> [6/8] Tao tep hoan doi 2 GB (DigitalOcean khong bat san — DCS-5 §2.2)"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl vm.swappiness=10
  echo 'vm.swappiness=10' >> /etc/sysctl.conf
fi

echo "==> [7/8] Tao user he thong 'dcs' va thu muc /opt/dcs, /var/dcs/files"
id -u dcs >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin dcs
mkdir -p /opt/dcs /var/dcs/files
chown -R dcs:dcs /opt/dcs /var/dcs

echo "==> [8/8] Tao co so du lieu va user PostgreSQL"
sudo -u postgres psql <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dcs') THEN
    CREATE ROLE dcs LOGIN PASSWORD 'doi-mat-khau-nay';
  END IF;
END $$;
SELECT 'CREATE DATABASE dcs_prod OWNER dcs'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'dcs_prod')\gexec
SQL

# Cai extension trong dcs_prod (can quyen superuser cho CREATE EXTENSION)
sudo -u postgres psql -d dcs_prod <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
SQL

echo ""
echo "==> XONG cai dat nen. Buoc tiep theo:"
echo "    1. Doi mat khau PostgreSQL o tren va trong /opt/dcs/.env"
echo "    2. Chay deploy/deploy.sh de dua code len va khoi dong dich vu"
echo "    3. Doi ten mien trong deploy/nginx-dcs.conf roi chay certbot"
