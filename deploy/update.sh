#!/usr/bin/env bash
# Yeni sürümü çekip yeniden başlatır; migration'lar otomatik uygulanır.
#   ./deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")"
./backup.sh
git -C .. pull --ff-only
docker compose build
docker compose up -d
docker image prune -f >/dev/null
docker compose ps
