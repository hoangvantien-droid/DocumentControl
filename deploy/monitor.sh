#!/usr/bin/env bash
# deploy/monitor.sh — theo dõi bộ nhớ/đĩa/swap trên VPS 1 GB (T-102, DCS-5 §4.3).
# Chạy qua cron mỗi 5 phút. Cảnh báo khi vượt ngưỡng (ghi ra journald/log).
set -euo pipefail

# Bộ nhớ trống (MB)
free_mb=$(free -m | awk '/^Mem:/ {print $7}')
# Swap đang dùng (MB)
swap_mb=$(free -m | awk '/^Swap:/ {print $3}')
# Đĩa dùng (%) ổ gốc
disk_pct=$(df / | awk 'NR==2 {gsub("%","",$5); print $5}')

warn() { echo "[DCS-MONITOR][WARN] $1" >&2; }

# Ngưỡng theo DCS-5 §4.3
[ "$free_mb" -lt 100 ]  && warn "Bộ nhớ trống dưới 100 MB (còn ${free_mb} MB)"
[ "$swap_mb" -gt 200 ]  && warn "Dùng swap trên 200 MB (${swap_mb} MB) — dấu hiệu cần nâng cấp"
[ "$disk_pct" -gt 80 ]  && warn "Đĩa dùng trên 80% (${disk_pct}%)"

echo "[DCS-MONITOR] mem_free=${free_mb}MB swap=${swap_mb}MB disk=${disk_pct}%"
