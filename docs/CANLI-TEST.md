# Gerçek Trendyol hesabıyla ilk test

Amaç: gerçek mağaza bilgileriyle verinin doğru çekildiğini görmek. **Bu testte Trendyol'a hiçbir
yazma yapılmaz**; stok/fiyat gönderimi acil durdurmayla kapalı tutulur. Yazma testi ayrı bir
adımdır ve açık onayla, birkaç ürünle yapılır.

Bilgiler: Trendyol satıcı paneli › Hesap Bilgilerim › Entegrasyon Bilgileri (yalnızca admin
kullanıcı görür). Canlı ve stage bilgileri farklıdır; bu test **canlı** bilgilerle yapılır.
API Key/Secret'ı sohbete, e-postaya veya bir dosyaya yazmayın.

## 1. Salt-okuma duman testi (terminal, ~10 sn)

Kendi terminalinizde (bilgiler ekrana yazılmadan sorulur, komut geçmişine düşmez):

```sh
cd ~/Desktop/trendy
read "TRENDYOL_SELLER_ID?Satıcı ID: "
read -s "TRENDYOL_API_KEY?API Key: "; echo
read -s "TRENDYOL_API_SECRET?API Secret: "; echo
export TRENDYOL_SELLER_ID TRENDYOL_API_KEY TRENDYOL_API_SECRET
pnpm --filter @trendy/api smoke:trendyol
```

Yalnızca GET çağrıları yapar ve dört şeyi kontrol eder:

| Kontrol             | Başarılıysa                     | Başarısızsa                                   |
| ------------------- | ------------------------------- | --------------------------------------------- |
| 1. Kimlik doğrulama | Onaylı içerik sayısı görünür    | 401: bilgiler hatalı · 403: bize iletin       |
| 2. Onaylı ürünler   | Örnek ürün ve barkodlar görünür | Şema hatası: çıktıyı iletin                   |
| 3. Onaysız ürünler  | Onay bekleyen/reddedilen sayısı | Şema hatası: çıktıyı iletin                   |
| 4. Sipariş akışı    | "Alan adları GÜNCEL"            | "ESKİ (id)" çıkarsa sipariş çekme uyarlanmalı |

Çıktıda sır yoktur; tamamını paylaşabilirsiniz. Son 3 günde sipariş yoksa 4. kontrol alan
adlarını doğrulayamaz; bu bir hata değildir.

## 2. Panelde okuma testi

Uygulama sahte Trendyol yerine gerçeğe bağlı çalışmalı (`TRENDYOL_BASE_URL` ve
`FEED_ALLOW_PRIVATE_NETWORK` tanımsız). Demo hesabını (`test@trendy.local`) kullanmayın.

1. Yeni hesap açın (giriş sayfasında "Ücretsiz hesap oluşturun").
2. **Önce** Ayarlar › Mağaza ve senkron › **Acil durdurma: AÇIK**. Üst çubukta kırmızı
   "Senkron durduruldu" görünmeli.
3. Ayarlar › Trendyol: Satıcı ID, API Key, API Secret › Kaydet › **Bağlantıyı test et**.
4. Ürün içe aktarma kendiliğinden başlar. Ürünler sayfası: Trendyol'daki ürünleriniz, onay/kilit/red
   durumlarıyla görünmeli. Sayıyı satıcı panelindekiyle karşılaştırın.
5. Siparişler: 5 dakika içinde veya "Şimdi çek" ile son siparişler görünmeli. Bir siparişin tutar,
   ürün ve statüsünü satıcı panelindekiyle karşılaştırın.
6. (İsteğe bağlı) Tedarikçi XML'ini ekleyin. Ürünler sayfasında barkodla eşleşen ürünler
   "Senkronda" kapsamına girer. Acil durdurma açık olduğu için hiçbir şey gönderilmez:
   zamanlanmış senkron hiç başlamaz, feed değişikliğiyle tetiklenen senkron İşlem Geçmişi'nde
   "atlandı · Acil durdurma açık" olarak görünür.

## 3. Yazma testi (ayrı adım, birlikte)

Stok/fiyat gönderimi, eşleşen **tüm** ürünler için başlar. İlk yazma testi yalnızca 1–5 ürün
içeren bir test XML'iyle yapılmalı; acil durdurma ancak o zaman kapatılır. Bu adım okuma testi
başarılı olduktan sonra planlanacak.

## Bu testle doğrulanan, önceden doğrulanamayan konular

- Basic Auth sırası (API Key : API Secret) — ROADMAP §9 #1
- Sipariş akışının güncel alan adlarıyla (`shipmentPackageId`, `lines[].lineId`) dönmesi;
  OpenAPI referansı hâlâ eski adları gösteriyor (`docs/TRENDYOL_NOTES.md`)
- Gerçek ürün verisinin yanıt şemalarımızla okunabilmesi
