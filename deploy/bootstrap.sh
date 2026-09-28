#!/usr/bin/env bash
# Boş bir Ubuntu/Debian sunucuya tek komutla Trendy kurulumu (root olarak):
#
#   curl -fsSL https://raw.githubusercontent.com/buraksahinbs/trendy/main/deploy/bootstrap.sh \
#     | bash -s -- panel.ornek.com admin@ornek.com [branch]
#
# Yaptıkları: sistem paketleri, Docker, gerekirse swap, güvenlik duvarı (mevcut SSH portu
# korunur), kodu /opt/trendy'ye indirme ve deploy/install.sh. Tekrar çalıştırmak güvenlidir.
set -euo pipefail

DOMAIN="${1:-}"
ACME_EMAIL="${2:-}"
BRANCH="${3:-main}"
REPO="${TRENDY_REPO:-https://github.com/buraksahinbs/trendy.git}"
DIR=/opt/trendy

if [ "$(id -u)" -ne 0 ]; then
  echo "root olarak çalıştırın (sudo -i)." >&2
  exit 1
fi
if [ -z "$DOMAIN" ] || [ -z "$ACME_EMAIL" ]; then
  echo "Kullanım: bash -s -- <alan-adı> <e-posta> [branch]" >&2
  exit 1
fi

echo "==> Sistem paketleri"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl git openssl ufw

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Docker kuruluyor"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true

# Panel derlemesi bellek ister; 4 GB altı ve swap yoksa 2 GB swap eklenir.
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$MEM_MB" -lt 3900 ] && [ "$(swapon --show --noheadings | wc -l)" -eq 0 ]; then
  echo "==> ${MEM_MB} MB RAM: 2 GB swap ekleniyor"
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Güvenlik duvarı"
# Şu anki SSH bağlantısının portu (varsayılan 22 değilse kilitlenmemek için).
SSH_PORT=$(echo "${SSH_CONNECTION:-}" | awk '{print $4}')
if [ -z "$SSH_PORT" ]; then
  SSH_PORT=$(ss -tlnpH 2>/dev/null | awk '/sshd/ {split($4,a,":"); print a[length(a)]; exit}')
fi
SSH_PORT="${SSH_PORT:-22}"
ufw allow "${SSH_PORT}/tcp" >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null
echo "    açık portlar: SSH ${SSH_PORT}, 80, 443"

echo "==> Kod (${BRANCH})"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q origin "$BRANCH"
  git -C "$DIR" checkout -q "$BRANCH"
  git -C "$DIR" pull -q --ff-only origin "$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$DIR"
fi

echo "==> Kurulum"
"$DIR/deploy/install.sh" "$DOMAIN" "$ACME_EMAIL"

echo
echo "==> Servislerin hazır olması bekleniyor (en fazla 5 dk)"
for _ in $(seq 1 60); do
  if curl -fsS "https://${DOMAIN}/health/ready" >/dev/null 2>&1; then
    echo "HAZIR: https://${DOMAIN}/kayit adresinden ilk hesabı oluşturun."
    echo "ÖNEMLİ: ${DIR}/deploy/.env dosyasını sunucu dışında güvenli bir yere yedekleyin."
    exit 0
  fi
  sleep 5
done
echo "Henüz hazır değil. Kontrol: cd ${DIR}/deploy && docker compose ps && docker compose logs --tail 50" >&2
exit 1
