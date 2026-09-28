#!/usr/bin/env bash
# Yedekten geri yükleme (MEVCUT VERİ SİLİNİR):
#   ./deploy/restore.sh deploy/backups/trendy-20260928-031500.sql.gz
set -euo pipefail
cd "$(dirname "$0")"
file="${1:?Kullanım: $0 <yedek.sql.gz>}"
read -r -p "Veritabanı silinip '$file' yüklenecek. Emin misiniz? (evet/hayır) " ok
[ "$ok" = "evet" ] || { echo "İptal edildi."; exit 1; }
docker compose stop api worker web
docker compose exec -T postgres psql -U trendy -d postgres -c "DROP DATABASE IF EXISTS trendy WITH (FORCE);" -c "CREATE DATABASE trendy OWNER trendy;"
gunzip -c "$file" | docker compose exec -T postgres psql -U trendy -d trendy -v ON_ERROR_STOP=1 >/dev/null
docker compose up -d
echo "Geri yükleme tamamlandı."
