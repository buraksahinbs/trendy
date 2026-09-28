#!/usr/bin/env bash
# Trendy kurulumu (Ubuntu/Debian VPS). Kullanım:
#   sudo ./deploy/install.sh panel.ornek.com admin@ornek.com
# Ayrıntı: docs/DEPLOY.md
set -euo pipefail

cd "$(dirname "$0")"
DOMAIN="${1:-}"
ACME_EMAIL="${2:-}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker kurulu değil. Kurmak için: curl -fsSL https://get.docker.com | sh" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose eklentisi bulunamadı (docker compose)." >&2
  exit 1
fi

if [ ! -f .env ]; then
  if [ -z "$DOMAIN" ] || [ -z "$ACME_EMAIL" ]; then
    echo "İlk kurulumda alan adı ve e-posta gerekli: $0 panel.ornek.com admin@ornek.com" >&2
    exit 1
  fi
  if printf '%s' "$DOMAIN" | grep -qiE 'trendyol|dolap|localhost'; then
    echo "Uyarı: alan adında trendyol/dolap/localhost geçiyor; Trendyol webhook'u bu adresi kabul etmez." >&2
  fi
  umask 077
  cat > .env <<ENV
# Oluşturuldu: $(date -u +%Y-%m-%dT%H:%M:%SZ)
# BU DOSYAYI GÜVENLİ BİR YERE YEDEKLEYİN. SECRETS_ENCRYPTION_KEY kaybolursa kayıtlı
# Trendyol ve tedarikçi şifreleri çözülemez.
DOMAIN=${DOMAIN}
ACME_EMAIL=${ACME_EMAIL}
PUBLIC_BASE_URL=https://${DOMAIN}
POSTGRES_PASSWORD=$(openssl rand -hex 24)
SECRETS_ENCRYPTION_KEY=$(openssl rand -base64 32)
SECRETS_ENCRYPTION_KEY_VERSION=1
TRENDYOL_INTEGRATOR_NAME=SelfIntegration
LOG_LEVEL=info
ENV
  echo ".env oluşturuldu (gizli anahtarlar üretildi)."
else
  echo "Mevcut .env kullanılıyor."
fi

docker compose build
docker compose up -d
echo
echo "Servisler başlatılıyor. Durum: docker compose -f $(pwd)/docker-compose.yml ps"
echo "Hazır olunca: https://$(grep '^DOMAIN=' .env | cut -d= -f2)"
