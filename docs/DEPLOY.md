# Kurulum Kılavuzu (VPS)

Bu kılavuz Trendy'yi tek bir Linux sunucuya (VPS) Docker ile kurar. Kurulumdan sonra panel
`https://<alan-adınız>` adresinde, otomatik yenilenen HTTPS sertifikasıyla çalışır.

## 1. Gereksinimler

| Kalem           | Öneri                                                                     |
| --------------- | ------------------------------------------------------------------------- |
| İşletim sistemi | Ubuntu 22.04/24.04 veya Debian 12 (64-bit)                                |
| Donanım         | En az 2 vCPU, 4 GB RAM, 40 GB disk (100.000+ ürün için 8 GB RAM önerilir) |
| Alan adı        | Örn. `panel.firmaniz.com`; DNS **A kaydı** sunucunun IP'sini göstermeli   |
| Açık portlar    | 22 (SSH), 80 ve 443 (HTTP/HTTPS). Başka port açmayın.                     |

> **Alan adında** `trendyol`, `dolap` veya `localhost` geçmemeli: Trendyol webhook adreslerinde bu
> kelimeleri kabul etmiyor.
>
> Alan adınız yoksa geçici olarak `<sunucu-ip>.sslip.io` kullanılabilir (ör. `203.0.113.10.sslip.io`);
> bu adres otomatik olarak sunucunuzun IP'sine çözülür ve HTTPS sertifikası alınabilir.

## 2. Sunucuyu hazırlama

SSH ile bağlanın ve aşağıdakileri çalıştırın:

```bash
# Sistem güncellemesi
sudo apt update && sudo apt -y upgrade

# Docker (resmi betik) ve git
curl -fsSL https://get.docker.com | sudo sh
sudo apt -y install git

# Güvenlik duvarı: yalnızca SSH, HTTP, HTTPS
sudo apt -y install ufw
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp
sudo ufw --force enable
```

## 3. Kodu indirme

```bash
sudo mkdir -p /opt/trendy && sudo chown "$USER" /opt/trendy
git clone https://github.com/buraksahinbs/trendy.git /opt/trendy
cd /opt/trendy
git checkout main   # veya kurulacak branch
```

Depo gizliyse GitHub'da bir "deploy key" (salt okunur SSH anahtarı) tanımlayıp
`git clone git@github.com:buraksahinbs/trendy.git /opt/trendy` kullanın.

## 4. Kurulum

```bash
sudo ./deploy/install.sh panel.firmaniz.com admin@firmaniz.com
```

Betik:

1. `deploy/.env` dosyasını oluşturur: rastgele veritabanı şifresi ve **şifreleme anahtarı**
   (`SECRETS_ENCRYPTION_KEY`) üretir.
2. İmajları derler (ilk seferde birkaç dakika sürer).
3. Servisleri başlatır: PostgreSQL, Redis, migration, API, worker, panel ve Caddy (HTTPS).

Durumu kontrol edin:

```bash
cd /opt/trendy/deploy
docker compose ps                      # tüm servisler "healthy"/"Up" olmalı
curl -s https://panel.firmaniz.com/health/ready
# {"ok":true,"checks":{"db":{"ok":true},"redis":{"ok":true},"worker":{"ok":true}}}
```

Sonra tarayıcıda `https://panel.firmaniz.com/kayit` adresinden ilk hesabı (mağaza sahibi) oluşturun.

## 5. ⚠️ `.env` dosyasını yedekleyin

`deploy/.env` içindeki `SECRETS_ENCRYPTION_KEY` kayıtlı Trendyol API bilgilerini ve tedarikçi
şifrelerini çözmek için gereklidir. **Kaybolursa bu bilgiler geri getirilemez** (yeniden girilmesi
gerekir). Dosyayı sunucu dışında güvenli bir yerde (ör. şifre yöneticisi) saklayın. Bu dosyayı
asla git'e eklemeyin.

## 6. İlk ayarlar (panelde)

1. **Ayarlar → Mağaza ve senkron:** Trendyol listeleme limiti seviyenizi seçin (Trendyol
   satıcı panelinde yazar). Emin değilseniz 50K bırakın.
2. **Ayarlar → Trendyol:** Canlı ortam için Satıcı ID, API Key ve API Secret'ı girip
   **Bağlantıyı test et**'e basın (yalnızca okuma yapar). Başarılı olursa Trendyol'daki ürünleriniz
   otomatik içe aktarılır.
3. **Tedarikçiler → Tedarikçi ekle:** XML adresini girip **Feed'i analiz et**; ürün düğümü ve kimlik
   alanını seçin.
4. **Tedarikçi → Eşleştirme:** Barkod ve stok alanlarını bağlayın, önizlemeyi kontrol edip kaydedin.
5. Fiyat da gönderilecekse fiyat kuralı tanımlanana kadar sistem **yalnızca stok** gönderir.

> İlk senkrondan önce **Ürünler** sayfasında eşleşen ürünleri ve stokları kontrol edin. Acil
> durumda **Ayarlar → Acil durdurma** tüm stok/fiyat gönderimini anında durdurur.

## 7. Sipariş webhook'u (isteğe bağlı)

Siparişler zaten 5 dakikada bir çekilir; webhook yalnızca hızlandırır. **Ayarlar → Sipariş
webhook'u** bölümünden adres ve anahtar üretin. Trendyol'a kayıt işlemi sonraki sürümde panelden
yapılacak.

## 8. Yedekleme

Günlük otomatik yedek (her gece 03:15, son 14 gün tutulur):

```bash
sudo crontab -e
# şu satırı ekleyin:
15 3 * * * /opt/trendy/deploy/backup.sh >/dev/null 2>&1
```

Yedekler `deploy/backups/` altındadır. Sunucu dışına da kopyalamanız önerilir (ör. `rclone` ile
bir nesne depolamaya).

Elle yedek: `./deploy/backup.sh` · Geri yükleme (mevcut veri silinir):
`./deploy/restore.sh deploy/backups/trendy-AAAAGGAA-SSDDSS.sql.gz`

## 9. Güncelleme

```bash
cd /opt/trendy
./deploy/update.sh
```

Önce yedek alır, yeni kodu çeker, imajları derler ve yeniden başlatır. Veritabanı migration'ları
otomatik uygulanır.

## 10. Sorun giderme

| Durum                               | Kontrol                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------- |
| Servis durumu                       | `docker compose ps`                                                     |
| Loglar                              | `docker compose logs -f api` (veya `worker`, `web`, `caddy`, `migrate`) |
| HTTPS sertifikası alınamıyor        | DNS A kaydı doğru mu, 80/443 açık mı: `docker compose logs caddy`       |
| `/health/ready` → worker `ok:false` | `docker compose logs worker`; `docker compose restart worker`           |
| Yeniden başlatma                    | `docker compose restart` · Tamamen durdurma: `docker compose down`      |

Veriler Docker volume'lerinde durur (`pgdata`, `redisdata`, `caddy_data`); `docker compose down`
verileri silmez. **`docker compose down -v` veritabanını siler, kullanmayın.**

## Mimari

```
İnternet ─► Caddy (80/443, HTTPS)
              ├─ /api/*     ─► api:3000   (Fastify)
              ├─ /hooks/*   ─► api:3000   (Trendyol sipariş webhook'u)
              └─ diğer      ─► web:3200   (Next.js panel)
            api, worker ─► postgres:5432, redis:6379   (yalnızca iç ağ)
            migrate: her başlatmada migration uygular, sonra biter
```
