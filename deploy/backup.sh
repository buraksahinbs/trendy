#!/usr/bin/env bash
# Veritabanı yedeği: deploy/backups/trendy-YYYYmmdd-HHMMSS.sql.gz, son 14 gün tutulur.
# Günlük çalıştırmak için (root crontab): 15 3 * * * /opt/trendy/deploy/backup.sh >/dev/null 2>&1
# Not: .env dosyasını (özellikle SECRETS_ENCRYPTION_KEY) ayrıca ve güvenli bir yerde saklayın.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
chmod 700 backups
file="backups/trendy-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T postgres pg_dump -U trendy -d trendy --no-owner | gzip > "$file"
chmod 600 "$file"
find backups -name 'trendy-*.sql.gz' -mtime +14 -delete
echo "Yedek: $file ($(du -h "$file" | cut -f1))"
