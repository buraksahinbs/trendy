# ROADMAP — Tedarikçi XML → Trendyol Entegrasyon Platformu

> **Son doğrulama tarihi:** 28 Eylül 2026
> **Kaynak:** Trendyol resmi entegrasyon dokümantasyonu (developers.trendyol.com) ve changelog.
> **Kapsam:** Jet Stok benzeri, **sadece Trendyol** kanalını destekleyen, çok kiracılı (multi-tenant) bir SaaS.
> Tedarikçi XML'lerinden ürün çeker, Trendyol'a yükler, stok/fiyatı senkron tutar ve siparişleri toplar.

---

## 0. Bu dosya nasıl kullanılır (AI ajanı için kurallar)

Bu dosya, geliştirmeyi yürüten AI ajanının **tek doğruluk kaynağıdır**. Ajan aşağıdaki kurallara uymalıdır:

1. **Uydurma yok.** Trendyol endpoint'i, alan adı, limit veya iş kuralı hakkında bu dosyada yazmayan bir bilgiye ihtiyaç duyarsan önce resmi dokümandan oku. Tahmin ederek kod yazma.
   - Doküman indeksi (AI dostu): `https://developers.trendyol.com/llms.txt`
   - Herhangi bir doküman sayfasının sonuna `.md` eklenirse markdown sürümü gelir.
   - OpenAPI tanımları `https://developers.trendyol.com/reference/<sayfa>.md` altında bulunur.
2. **Fazları sırayla ilerlet.** Bir fazın "Kabul kriterleri" sağlanmadan sonrakine geçme.
3. **Checkbox'ları güncelle.** Tamamlanan görevi `[x]` yap. Yarım kalanı `[~]` ile işaretle ve yanına kısa not düş.
4. **Karar kaydı tut.** Mimari veya iş kuralı kararlarını `docs/DECISIONS.md` dosyasına tarih, gerekçe ve alternatiflerle yaz.
5. **"⚠️ DOĞRULA" etiketli maddeler** belirsiz veya dokümanda çelişkili bilgilerdir. Bunlara dayanan kodu yazmadan önce güncel dokümanı kontrol et. Gerekirse kullanıcıya sor.
6. **Trendyol API'si sık değişir.** Her fazın başında changelog'u kontrol et: `https://developers.trendyol.com/changelog/changelog.md`
7. **Canlı ortama asla test isteği atma.** Geliştirme sırasında mock sunucu ve stage ortamı kullan (bkz. Bölüm 6).
8. **Her dış API çağrısı** rate limiter'dan, retry politikasından ve loglamadan geçmek zorunda. Doğrudan `fetch` çağrısı yasak.
9. **Gizli bilgiler** (API key/secret) asla loglanmaz, commit'lenmez, hata mesajına yazılmaz.

---

## 1. Ürün tanımı

### 1.1 Problem

Dropshipping yapan veya tedarikçiden ürün alan Trendyol satıcıları, tedarikçinin XML'indeki binlerce ürünü Trendyol'a elle yüklemek ve stok/fiyatı güncel tutmak zorunda. Stok güncel olmadığında satıcı tükenmiş ürünü satıyor, bu da iptale ve cezaya yol açıyor.

### 1.2 Çözüm (tek cümle)

Satıcı tedarikçi XML URL'sini bağlar, alanları ve kategorileri bir kez eşleştirir, fiyat kuralını belirler. Sistem ürünleri Trendyol'a yükler, stok ve fiyatı periyodik olarak senkron tutar, siparişleri tek ekranda gösterir.

### 1.3 MVP kapsamı

| Dahil                                                      | Hariç (sonraki sürümler)                  |
| ---------------------------------------------------------- | ----------------------------------------- |
| Çok kiracılı hesap yapısı (satıcı başına ayrı veri)        | Diğer pazaryerleri                        |
| Trendyol API bilgilerini güvenli saklama ve doğrulama      | E-fatura entegratörü bağlantısı           |
| Birden fazla tedarikçi XML'i ekleme                        | Kargo firması entegrasyonu (etiket basma) |
| XML alan eşleştirme (field mapping)                        | İade yönetimi, müşteri soruları           |
| Kategori, marka ve özellik eşleştirme                      | Finans/hakediş mutabakatı, kâr raporları  |
| Fiyat kuralları (çarpan, sabit ekleme, yuvarlama, min/max) | Buybox takibi, fiyat robotu               |
| Görsel işleme (https'e taşıma, boyutlandırma)              | AI içerik üretimi (açıklama, görsel)      |
| Ürün yaratma (Product V2) ve batch sonuç takibi            | Excel/CSV ile ürün içe aktarma            |
| Periyodik stok/fiyat senkronu                              | Mobil uygulama                            |
| Sipariş çekme (polling + opsiyonel webhook) ve listeleme   |                                           |
| İşlem logu ve hata ekranı                                  |                                           |

---

## 2. Trendyol API — doğrulanmış gerçekler (28.09.2026)

> Bu bölümdeki her bilgi resmi dokümandan alınmıştır. Değişiklik ihtimaline karşı ilgili fazın başında yeniden doğrula.

### 2.1 Ortamlar ve kimlik doğrulama

- **Canlı ortam base URL:** `https://apigw.trendyol.com`. Canlıda IP yetkilendirmesi gerekmez.
- **Test (stage) ortamı base URL:** `https://stageapigw.trendyol.com`. Test paneli: `https://stagepartner.trendyol.com`.
- Stage erişimi için sunucu çıkış IP'sinin Trendyol'a bildirilmesi gerekir. Bildirim satıcı paneli veya çağrı merkezi (0850 258 58 00) üzerinden yapılır. IP tanımlı değilse stage **503** döner.
  - ⚠️ DOĞRULA: Doküman aynı zamanda "Statik IP'ler için yetkilendirme sağlanamamaktadır" diyor. Bu ifade belirsiz; stage erişimi kurulurken Trendyol destekten netleştir.
- Stage ve canlı API bilgileri **farklıdır**.
- **Auth:** Basic Authentication. Kullanıcı adı = API Key, şifre = API Secret. Satıcı ID (supplierId/sellerId) URL'de kullanılır. Bilgiler satıcı panelinde "Hesap Bilgilerim → Entegrasyon Bilgileri" sayfasındadır ve yalnızca admin (master user) rolüyle görünür.
  - ⚠️ DOĞRULA: Basic auth'ta kullanıcı adı/şifre sırası (key:secret) dokümanda açıkça yazmıyor. Faz 2'de stage ile test ederek teyit et.
- Hatalı auth durumunda **401** ve `ClientApiAuthenticationException` döner.
- **User-Agent zorunlu.** Header'da yoksa istek **403** ile reddedilir.
  - Aracı firma (bizim durumumuz) için format: `"{SatıcıId} - {EntegratörFirmaAdı}"`, örneğin `"1234 - FirmaAdimiz"`.
  - Firma adı alfanümerik ve **en fazla 30 karakter** olmalı.

### 2.2 Rate limit'ler

- **Genel kural:** Aynı endpoint'e **10 saniyede en fazla 50 istek** atılabilir. 51. istekte **429** (`too.many.requests`) döner.
- **14 Eylül 2026'dan itibaren ürün servisleri** tekil endpoint bazında değil, **grup bazında ortak** limitlenir. Limit, satıcının ürün listeleme limit seviyesine göre değişir:

| Grup                      | Kapsam                                                                                        | 50K     | 75K     | 150K    | 500K    | Limitsiz |
| ------------------------- | --------------------------------------------------------------------------------------------- | ------- | ------- | ------- | ------- | -------- |
| Product Integration Read  | Filtreleme, batch sonucu, marka/kategori/özellik listeleri, adres bilgisi, güncelleme sonucu  | 1000/dk | 1250/dk | 1500/dk | 1750/dk | 2000/dk  |
| Product Integration Write | Ürün yaratma, güncelleme, silme, arşivleme, kilit kaldırma, marka yaratma, **buybox sorgusu** | 200/dk  | 300/dk  | 400/dk  | 500/dk  | 600/dk   |
| Inventory & Price Write   | Stok ve fiyat güncelleme                                                                      | 350/dk  | 500/dk  | 1000/dk | 1500/dk | 2000/dk  |

- **Barkod bazlı fiyat limiti:** Aynı barkod için dakikada 30'dan fazla fiyat güncellemesi yapılırsa, batch sonucunda o barkod için hata döner.
- **Sipariş paketlerini çekme limiti** de seviyeye göre değişir: 50K seviyede **30/dk**, 75K'da 40/dk, 150K'da 50/dk, 500K ve limitsizde 100/dk.
- ⚠️ DOĞRULA: Satıcının hangi listeleme limit seviyesinde olduğunu API'den öğrenmenin bir yolu dokümanda görünmüyor. MVP'de en düşük seviye (50K) varsayılmalı ve satıcıya ayarlardan seçtirilmeli.

### 2.3 Ürün servisleri — **yalnızca V2 kullanılacak**

- Ürün V1 servisleri kullanımdan kaldırılıyor. **V1 ile hiçbir kod yazılmayacak.**
  - ⚠️ Not: Dokümanda kapanış tarihi olarak hem 15 Eylül 2026 hem 15 Ekim 2026 geçiyor. Hangisi doğru olursa olsun V1 kullanılmayacak.
- V2 yapısı barkod bazlı değil, **içerik (content) bazlı**dır.

| Servis                                     | Metod  | Endpoint (base: `https://apigw.trendyol.com`)                                  |
| ------------------------------------------ | ------ | ------------------------------------------------------------------------------ |
| Marka listesi                              | GET    | `/integration/product/brands`                                                  |
| Kategori ağacı                             | GET    | `/integration/product/product-categories`                                      |
| Kategori özellik listesi v2                | GET    | `/integration/product/categories/{categoryId}/attributes`                      |
| Kategori özellik değerleri v2              | GET    | `/integration/product/categories/{categoryId}/attributes/{attributeId}/values` |
| Ürün yaratma v2                            | POST   | `/integration/product/sellers/{sellerId}/v2/products`                          |
| Onaysız ürün güncelleme v2                 | POST   | `/integration/product/sellers/{sellerId}/products/unapproved-bulk-update`      |
| Onaylı ürün content güncelleme v2          | POST   | `/integration/product/sellers/{sellerId}/products/content-bulk-update`         |
| Onaylı ürün varyant güncelleme v2          | POST   | `/integration/product/sellers/{sellerId}/products/variant-bulk-update`         |
| Onaylı ürün teslimat bilgisi güncelleme v2 | POST   | `/integration/product/sellers/{sellerId}/products/delivery-info-bulk-update`   |
| Stok ve fiyat güncelleme                   | POST   | `/integration/inventory/sellers/{sellerId}/products/price-and-inventory`       |
| Ürün silme                                 | DELETE | `/integration/product/sellers/{sellerId}/products`                             |

- Diğer V2 servislerinin (batch sonucu, onaylı/onaysız filtreleme, arşivleme, adres bilgisi, kargo firması listesi, menşei listesi) tam path'lerini Faz 2'de `https://developers.trendyol.com/docs/ürün-v2-api-endpoint.md` sayfasından al.

**Ürün yaratma v2 kuralları:**

- Bir istekte **en fazla 1.000 item** gönderilir.
- İşlem **asenkron**dur: yanıtta dönen `batchRequestId` ile sonuç sorgulanmalıdır.
- Yüklemeden önce marka, kategori, kategori özellikleri ve özellik değerleri servislerinden ilgili ID'ler alınmalıdır. Kategori ID olarak **en alt seviyedeki** kategori kullanılır.
- Başarılı yükleme ürünü **onay sürecine** sokar. Onaylanmayan veya reddedilen ürün yayına çıkmaz. Durum filtreleme servisinden izlenir.
- `listPrice` (üstü çizili fiyat), `salePrice`'tan küçük olamaz.
- `vatRate` 0, 1, 10, 20 gibi değerler alır.
- Zorunlu alanlar: `barcode` (maks. 40 karakter; özel karakter olarak yalnızca `.` `-` `_`), `title` (maks. 100), `productMainId` (maks. 40, model kodu), `brandId`, `categoryId`, `quantity`, `description` (HTML, maks. 30.000), `listPrice`, `salePrice`, `images`, `vatRate`, `attributes`.
- Barkodun ortasındaki boşluk birleştirilerek kaydedilir. Stok/fiyat güncellemeleri kaydedilen barkoda göre yapılmalıdır. **Bizim sistemimiz barkodu göndermeden önce kendisi normalize etmeli.**
- **Görseller:** Yalnızca `https` URL, barkod başına **en fazla 8 görsel**. Görsellerin **1200x1800 ve 96 dpi** olması gerekir.
- **Renk** özelliği 50 karakteri geçemez.
- **Varyantlama:** Aynı ürünün varyantları (ör. L ve XL beden) **aynı `productMainId`** ile, yalnızca `attributes` farklılaştırılarak gönderilir. Kategori özelliğindeki bayraklar belirleyicidir:
  - `slicer`: Ürünü ayrı içeriklerde açar (genellikle renk). Bir kategoride birden fazla olabilir.
  - `varianter`: Aynı içerikte farklı seçenekler oluşturur (genellikle beden). Kategori başına en fazla bir tane.
  - `allowMultipleAttributeValues` true ise özellik birden fazla değer alabilir.
- **Teslimat süresi (Ağustos 2026 sonrası):** `deliveryOption.deliveryDuration` alanı kullanılır. `0` = "Bugün Kargoda", `1` = "En Geç Yarın Kargoda". `fastDeliveryType` artık işlenmiyor, **gönderilmeyecek**.
- **Menşei (`origin`):** Yeni bağımsız alan. **23 Ekim 2026'dan itibaren zorunlu.** Geçerli değerler "Menşei Değerleri Listesi" dokümanından alınır. MVP ilk günden bu alanı desteklemeli.
- **Ürün Denetim Yönetmeliği özellikleri:** Üretici Bilgisi (attributeId 1198), İthalatçı/Yetkili Temsilci (1216), Kullanım Talimatı/Uyarıları (1116), CE Uygunluk Sembolü (1210). Kategoriye göre zorunlu olabilir; kategori özellik servisinin `required` bilgisine güvenilmeli.
- **Web Color** (attributeId 348) kategori bazında zorunlu olabilir.
- ⚠️ DOĞRULA — **attribute alan isimleri:** Ürün yaratma v2 dokümanındaki örnek istekte `attributeValueId` ve `customAttributeValue` geçiyor. OpenAPI referans özeti ise `attributeValueIds` (dizi) ve `attributeValue` (metin) diyor. Faz 8'de `https://developers.trendyol.com/reference/createproducts.md` içindeki OpenAPI şemasını esas al ve stage ile doğrula.

**Stok ve fiyat güncelleme kuralları:**

- Yalnızca **onaylanmış** ürünler için kullanılır.
- Bir istekte **en fazla 1.000 item**, ürün başına **en fazla 20.000 stok**.
- **Aynı istek 15 dakika boyunca tekrar gönderilemez.** Bu nedenle yalnızca değişen kayıtlar (diff) gönderilmeli.
- Sonuç `batchRequestId` ile sorgulanır. Batch sonuçları **4 saat** boyunca sorgulanabilir.

**Ürün kilitleri:** Trendyol, düşük/yüksek fiyatlandırma, kritik fiyat hatası veya tedarik edememe gibi sebeplerle ürünün satışını durdurabilir (kilitleyebilir). Kilit kaldırma servisi mevcut. **Fiyat kuralı motorunun güvenlik sınırları (guardrails) bu yüzden kritiktir.**

**Diğer:** Menşei listesi, marka yaratma, video yükleme, garanti belgesi ve Luxe kanalı (`channels`) servisleri var. MVP'de yalnızca menşei listesi kullanılacak.

### 2.4 Sipariş servisleri

- **Eski endpoint** `GET /integration/order/sellers/{sellerId}/orders` **15 Ekim 2026'da kapanıyor**. Bu tarihe kadar günde 3 kez 10'ar dakika boyunca **426** hatası döndürüyor. **Kullanılmayacak.**
- **Kullanılacak endpoint'ler:**
  - `GET /integration/order/sellers/{sellerId}/v2/orders`: Order V2, küçük/anlık sorgular için. Erişilebilir kayıt sayısı **10.000** ile sınırlı.
  - `GET /integration/order/sellers/{sellerId}/orders/stream` (**getShipmentPackagesStream**): Periyodik senkron (polling/cron) ve toplu tarama için **önerilen** yöntem.
- **Stream servisi kuralları:**
  - Cursor tabanlı sayfalama: ilk istekte `nextCursor` gönderilmez. `hasMore=true` ise yanıttaki `nextCursor` ile devam edilir. `nextCursor` opak bir değerdir, parse edilmez veya değiştirilmez.
  - Aynı cursor ile filtre **değiştirilemez**, değiştirilirse **400** döner. Yeni filtre için yeni akış başlatılır.
  - Sonuçlar `lastModifiedDate`'e göre azalan sırada gelir.
  - **Son 3 aylık** veri erişilebilir. Tek sorguda en fazla **14 günlük** zaman aralığı verilebilir; tarih verilmezse son 2 hafta alınır.
  - Tarih parametreleri (`lastModifiedStartDate`, `lastModifiedEndDate`) **milisaniye timestamp ve GMT+3** olarak gönderilir.
  - `size` varsayılan 50, maksimum 200.
  - İstekler arasında **en az 5 saniye** bırakılması önerilir.
- **Paket statüleri:** Created, Picking, Invoiced, Shipped, Cancelled, Delivered, UnDelivered, Returned, AtCollectionPoint, UnPacked, UnSupplied, Awaiting, Verified.
- **Önemli alanlar (güncel isimler):** `shipmentPackageId`, `orderNumber`, `lines[].lineId`, `lines[].barcode`, `lines[].stockCode`, `lines[].quantity`, `lines[].lineUnitPrice`, `lines[].commission` (komisyon oranı), `lines[].vatRate`, `packageTotalPrice`, `status`, `cargoTrackingNumber`, `cargoProviderName`, `lastModifiedDate`, `createdBy` (order-creation / split / cancel / transfer), `originPackageIds`, `paymentMethod`, `channelId` (1 = standart, 25 = Luxe).
  - Eski isimler (`id`, `merchantSku`, `price`, `totalPrice` vb.) Nisan 2026'da kaldırıldı. **Eski alan adlarıyla kod yazılmayacak.**
- **Trendyol geçmişte kesintiler yaşadı** (ör. 2 ve 8 Eylül 2026) ve satıcılardan ilgili zaman aralığını yeniden çekmelerini istedi. Bu yüzden sistem **geriye dönük yeniden tarama (backfill)** yapabilmelidir.

### 2.5 Webhook

- Sipariş paketleri için webhook tanımlanabilir. Yukarıdaki statülerin tamamına tek webhook ile abone olunabilir. Gövde **tam sipariş verisi** içerir (POST, JSON).
- Yetkilendirme: `BASIC_AUTHENTICATION` veya `API_KEY`. API_KEY seçilirse header adı `x-api-key` olur.
- Başarısız istekler başarılı olana kadar **5 dakikada bir** tekrar gönderilir. Hata sürerse webhook **pasife alınır** ve satıcıya e-posta gider.
- Webhook URL'sinde "Trendyol", "Dolap" veya "Localhost" ifadeleri **bulunamaz**.
- Satıcı başına **en fazla 15 webhook** tanımlanabilir (pasifler dahil).
- Trendyol, webhook'un her zaman ulaşmayabileceğini belirtip **periyodik çekmeyi de önerir**. **Sonuç: webhook yalnızca hızlandırıcıdır, asıl güvence polling'dir.**

### 2.6 Diğer (MVP dışı, ileride gerekecek)

- **Fatura:** `sendInvoiceLink`, fatura linki silme, `uploadInvoiceFile` (PDF/JPEG/PNG). HTML formatında fatura önerilmiyor. Faturada ödeme yöntemi (`paymentMethod`) belirtilmeli.
- **İade:** `getClaims`, `approveClaimLineItems` (5/dk), `createClaimIssue` (5/dk). Red sebepleri 8 Ekim 2026'da güncelleniyor.
- **Finans:** Settlements ve Other Financials servisleri (Cari Hesap Ekstresi, 100/dk).
- **Müşteri soruları:** Çekme (1000/dk) ve cevaplama (500/dk).
- **Buybox kontrolü:** İstek başına en fazla 10 barkod. Write limit grubuna dahil.
- **API sağlık durumu sayfası:** `https://developers.trendyol.com/api-status`

---

## 3. Mimari

### 3.1 Önerilen teknoloji yığını

> Bunlar öneridir, zorunlu değildir. Sürüm numaralarını ajan kurulum anında **güncel stabil sürüm** olarak kontrol etmelidir.

| Katman             | Öneri                                               | Neden                                                                   |
| ------------------ | --------------------------------------------------- | ----------------------------------------------------------------------- |
| Dil                | TypeScript (Node.js LTS)                            | Tek dil ile API, worker ve UI yazılır                                   |
| Monorepo           | pnpm workspaces (+ opsiyonel Turborepo)             | Ortak tipler ve Trendyol client paylaşımı                               |
| API                | NestJS veya Fastify                                 | Modüler yapı, doğrulama                                                 |
| Worker / kuyruk    | BullMQ + Redis                                      | Retry, gecikme, cron job, rate limit                                    |
| Veritabanı         | PostgreSQL                                          | İlişkisel veri, JSONB ile esnek ham XML saklama                         |
| ORM                | Prisma veya Drizzle                                 | Migration yönetimi                                                      |
| Web panel          | Next.js + bir UI kit (ör. shadcn/ui)                | Hızlı panel geliştirme                                                  |
| XML ayrıştırma     | Streaming parser (ör. `sax`/`saxes`) + `iconv-lite` | Büyük dosyalar belleğe alınmaz, farklı karakter kodlamaları desteklenir |
| Görsel işleme      | `sharp`                                             | Trendyol'un 1200x1800 görsel şartı                                      |
| Nesne depolama     | S3 uyumlu (AWS S3, Cloudflare R2 vb.)               | https görsel barındırma                                                 |
| Doğrulama          | Zod                                                 | Trendyol payload'larını göndermeden önce şema kontrolü                  |
| Test               | Vitest + mock HTTP sunucusu (ör. MSW veya nock)     | Canlıya dokunmadan test                                                 |
| Gözlemlenebilirlik | Yapılandırılmış log (pino) + Sentry (veya muadili)  | Hata takibi                                                             |

### 3.2 Servis yapısı

```
apps/
  api/        → REST API (auth, tenant, mapping, ayarlar, raporlar)
  worker/     → Kuyruk işçileri (XML çekme, ürün gönderme, senkron, sipariş çekme)
  web/        → Satıcı paneli
packages/
  trendyol-client/   → Trendyol API istemcisi (TEK giriş noktası)
  xml-ingest/        → Streaming XML okuma + alan eşleştirme motoru
  pricing/           → Fiyat kuralı motoru (saf fonksiyonlar, yüksek test kapsamı)
  db/                → Şema, migration, repository'ler
  shared/            → Ortak tipler, sabitler, hata sınıfları
docs/
  DECISIONS.md
  TRENDYOL_NOTES.md  → Stage testlerinde öğrenilen gerçekler
```

### 3.3 Ana veri akışları

```
[Tedarikçi XML URL] --(cron)--> xml-fetch job --> ham ürünler (supplier_products)
        --> normalize + mapping --> kanonik ürün (products / variants)
        --> fiyat kuralı --> hedef fiyat/stok
        --> diff (son gönderilenle karşılaştır)
             ├─ yeni ürün  → create-products job (V2, ≤1000/istek) → batchRequestId → batch-poll job
             └─ değişen    → price-inventory job (≤1000/istek, sadece onaylılar) → batch-poll job

[Trendyol] --(stream polling, ≥5 sn)--> orders-sync job --> orders / order_lines
[Trendyol] --(webhook, opsiyonel)-----> /webhooks/trendyol/:tenant --> aynı upsert mantığı
```

---

## 4. Veri modeli (ilk taslak)

> Tüm tenant'a ait tablolarda `tenant_id` zorunlu ve indeksli. Uygulama seviyesinde tenant izolasyonu, mümkünse PostgreSQL Row Level Security ile desteklenmeli.

| Tablo                      | Amaç                                          | Önemli alanlar                                                                                                                                          |
| -------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenants`                  | Satıcı hesabı                                 | id, name, plan, listing_limit_tier                                                                                                                      |
| `users`                    | Panel kullanıcıları                           | id, tenant_id, email, role                                                                                                                              |
| `trendyol_credentials`     | API bilgileri                                 | tenant_id, seller_id, api_key_enc, api_secret_enc, env (stage/prod), verified_at                                                                        |
| `suppliers`                | Tedarikçi XML kaynakları                      | id, tenant_id, name, feed_url, auth (opsiyonel, şifreli), encoding, schedule_cron, active                                                               |
| `supplier_field_mappings`  | XML yolu → kanonik alan                       | supplier_id, target_field, source_path, transform (JSON)                                                                                                |
| `supplier_products`        | Ham XML kaydı                                 | supplier_id, external_id, raw (JSONB), hash, last_seen_at                                                                                               |
| `products`                 | Kanonik ana ürün (Trendyol content karşılığı) | id, tenant_id, product_main_id, title, description, brand_id_ty, category_id_ty, origin, vat_rate                                                       |
| `variants`                 | Kanonik varyant (barkod)                      | id, product_id, barcode (normalize), stock_code, cost_price, stock, attributes (JSONB), images                                                          |
| `ty_categories`            | Trendyol kategori ağacı önbelleği             | id, parent_id, name, is_leaf, fetched_at                                                                                                                |
| `ty_category_attributes`   | Özellik önbelleği                             | category_id, attribute_id, name, required, allow_custom, slicer, varianter, allow_multiple                                                              |
| `ty_attribute_values`      | Özellik değerleri önbelleği                   | attribute_id, category_id, value_id, name                                                                                                               |
| `ty_brands`                | Marka önbelleği                               | id, name, fetched_at                                                                                                                                    |
| `category_mappings`        | Tedarikçi kategorisi → Trendyol kategorisi    | tenant_id, supplier_id, source_category, ty_category_id                                                                                                 |
| `attribute_value_mappings` | Kaynak değer → Trendyol değer ID'si           | tenant_id, ty_attribute_id, source_value, ty_value_id / custom_value                                                                                    |
| `pricing_rules`            | Fiyat kuralları                               | tenant_id, scope (genel/tedarikçi/kategori/marka), multiplier, add_fixed, rounding, min_margin, min_price, max_price, list_price_rule                   |
| `channel_listings`         | Trendyol'daki durum                           | variant_id, ty_status (pending/approved/rejected/locked/archived), last_sent_price, last_sent_list_price, last_sent_stock, last_sent_at, reject_reasons |
| `ty_batches`               | Batch takibi                                  | id, tenant_id, type (create/update/price_inventory), batch_request_id, item_count, status, sent_at, result (JSONB)                                      |
| `orders`                   | Sipariş paketi                                | tenant_id, shipment_package_id (unique), order_number, status, package_total_price, last_modified_at, raw (JSONB)                                       |
| `order_lines`              | Sipariş satırı                                | order_id, line_id, barcode, stock_code, quantity, line_unit_price, commission_rate, vat_rate                                                            |
| `sync_cursors`             | Senkron durumu                                | tenant_id, kind (orders), last_synced_until                                                                                                             |
| `job_logs`                 | İşlem geçmişi (kullanıcıya gösterilir)        | tenant_id, job_type, status, summary, error, started_at, finished_at                                                                                    |

---

## 5. Fazlar

### Faz 0 — Hazırlık ve doğrulama (kod yok)

**Hedef:** Belirsizlikleri kod yazmadan önce azaltmak.

- [ ] Trendyol'da en az bir gerçek satıcı hesabına erişim sağla (kendi hesabın veya pilot müşteri). API Key/Secret/SellerId alınabildiğini doğrula.
- [ ] Stage ortam erişimi için başvur: sunucu çıkış IP'sini bildir, ortak veya özel test hesabı iste. Başvuru süreci ve IP şartını `docs/TRENDYOL_NOTES.md`'ye yaz.
- [ ] Aracı entegratör firma olarak Trendyol'a ayrıca kayıt/başvuru gerekip gerekmediğini öğren. (⚠️ DOĞRULA: Dokümanda yalnızca User-Agent formatı var, başvuru süreci belirtilmemiş.)
- [ ] En az **3 farklı gerçek tedarikçi XML örneği** topla. Yapı farklılıklarını (varyant gösterimi, kategori, görsel alanları, karakter kodlaması, dosya boyutu) belgeye yaz.
- [ ] Hukuki ön değerlendirme: KVKK kapsamında sipariş verisindeki kişisel veriler (ad, adres, telefon, T.C. kimlik no) için aydınlatma metni, veri işleyen sözleşmesi, sunucu lokasyonu ve yurt dışına aktarım konularında danışmanlık al.
- [~] `docs/DECISIONS.md` oluştur. İlk kararlar: teknoloji yığını ve barındırma yeri. _(Oluşturuldu; barındırma yeri henüz seçilmedi.)_

**Kabul kriterleri:** Stage erişim başvurusu yapılmış, 3 XML örneği repoda (`fixtures/xml/`) anonimleştirilmiş olarak duruyor, KVKK için aksiyon listesi var.

---

### Faz 1 — Proje iskeleti, kimlik doğrulama, tenant yapısı

- [x] Monorepo kurulumu, lint, format, tip kontrolü, CI (her PR'da test + tip kontrolü). _(GitHub Actions: format, lint, typecheck, test + Redis servisi.)_
- [x] Ortam değişkenleri şeması (Zod ile doğrulanan `.env`). `.env.example` dosyası. _(`@trendy/shared` → `loadEnv`.)_
- [x] PostgreSQL + Redis için docker-compose (lokal geliştirme).
- [ ] Kullanıcı kaydı/girişi (e-posta + şifre; oturum veya JWT). Şifre hash'i argon2 veya bcrypt.
- [~] Tenant oluşturma, kullanıcıyı tenant'a bağlama, rol yapısı (owner, staff). _(Şema hazır: `users` global, `tenant_members` rolü tutuyor. Kayıt akışı API ile gelecek.)_
- [x] Tenant izolasyon testleri: bir tenant'ın başka bir tenant'ın verisine erişemediğini doğrulayan otomatik testler. _(`packages/db`: RLS + bileşik FK; okuma, güncelleme, silme, başka tenant adına ekleme, kayıt taşıma ve çapraz bağlama senaryoları.)_
- [x] Gizli bilgi şifreleme yardımcı fonksiyonu (AES-256-GCM; anahtar ortam değişkeninden veya KMS'ten). Anahtar rotasyonu için sürüm alanı. _(`createSecretBox`; AAD ile tenant bağlamına bağlı.)_
- [x] Yapılandırılmış loglama. Log'larda `authorization`, `apiKey`, `apiSecret` alanlarını otomatik maskeleyen redaction. _(`createLogger`, pino.)_

**Kabul kriterleri:** Kullanıcı kayıt olup giriş yapabiliyor, CI yeşil, tenant izolasyon testleri geçiyor.

---

### Faz 2 — Trendyol API istemcisi (`packages/trendyol-client`)

**Hedef:** Trendyol'a giden **tek** kapı. Tüm limit, retry ve hata mantığı burada.

- [ ] Changelog'u kontrol et. Bölüm 2'de değişen bir şey varsa bu dosyayı güncelle.
- [x] Base URL ortama göre seçilir (stage/prod). Tenant bazında ayarlanır.
- [x] Her isteğe Basic Auth ve `User-Agent: "{sellerId} - {FIRMA_ADI}"` header'ı eklenir. Firma adı ≤30 karakter ve alfanümerik olacak şekilde doğrulanır.
- [~] _(Bellek içi ve Redis (Lua, atomik) kayan pencere uygulamaları hazır. Barkod limiti sabiti tanımlı, senkron job'unda uygulanacak.)_ **Rate limiter** (Redis tabanlı, tenant+grup anahtarlı token bucket):
  - Endpoint başına 50 istek / 10 sn.
  - Grup başına dakikalık limit (Read / Write / Inventory&Price / Orders). Değer tenant'ın `listing_limit_tier` ayarından okunur.
  - Barkod başına dakikada ≤30 fiyat güncellemesi.
- [x] **Retry politikası:**
  - 429 → üstel geri çekilme (exponential backoff) + jitter, ardından tekrar.
  - 5xx → sınırlı sayıda retry (ör. 3), sonra job hatası.
  - 426 → "kullanımdan kalkmış endpoint" alarmı (kod hatası sayılır, retry yapılmaz).
  - 400/401/403/404 → retry yok. Hata job log'a açıklamasıyla yazılır.
- [x] Hata sınıfları: `TrendyolAuthError`, `TrendyolRateLimitError`, `TrendyolValidationError`, `TrendyolDeprecatedEndpointError`, `TrendyolServerError`.
- [x] İstek/yanıt loglama (gövde kısaltılmış, gizli bilgiler maskeli), süre ölçümü.
- [ ] Endpoint fonksiyonları (tipli). Tipler **dokümandaki OpenAPI'den** türetilir, elle uydurulmaz: _(Bekliyor: geliştirme ortamı developers.trendyol.com'a erişemiyor; doküman kopyaları `docs/trendyol-api/` altına eklenecek.)_
  - [ ] `getBrands`, `getBrandsByName`
  - [ ] `getCategoryTree`
  - [ ] `getCategoryAttributesV2`, `getCategoryAttributeValuesV2`
  - [ ] `createProductsV2`
  - [ ] `updateUnapprovedProducts`, `updateApprovedContent`, `updateApprovedVariants`, `updateDeliveryInfo`
  - [ ] `updatePriceAndInventory`
  - [ ] `getBatchRequestResult`
  - [ ] `filterApprovedProducts`, `filterUnapprovedProducts`, `getProductBase`
  - [ ] `getSuppliersAddresses`, `getCargoProviders`, `getOriginValues`
  - [ ] `getShipmentPackagesStream`, `getShipmentPackagesV2`
  - [ ] Webhook: `createWebhook`, `listWebhooks`, `updateWebhook`, `deleteWebhook`, `activate`, `deactivate`
- [ ] **Kimlik doğrulama testi:** Tenant API bilgilerini girdiğinde hafif bir okuma çağrısı yapılır, 401/403 ayrıştırılır, sonuç `verified_at` alanına yazılır. Hangi endpoint'in kullanılacağı `docs/DECISIONS.md`'ye yazılır.
- [ ] Mock sunucu: Tüm endpoint'ler için örnek yanıtlar (`fixtures/trendyol/`). 429, 401, 5xx ve 426 senaryoları dahil.
- [ ] Stage ortamında en az bir gerçek okuma çağrısı yapılır, Basic Auth sırası teyit edilir ve `TRENDYOL_NOTES.md`'ye yazılır.

**Kabul kriterleri:** İstemci birim testleri mock ile geçiyor, rate limiter yük testinde limitleri aşmıyor, stage'de auth doğrulandı.

---

### Faz 3 — Trendyol referans verisi önbelleği

**Hedef:** Kategori, özellik, değer ve marka verisini yerelde tutarak hem limitleri korumak hem de eşleştirme ekranını hızlandırmak.

- [ ] Kategori ağacını çekip `ty_categories`'e yazan job. `is_leaf` alanını hesapla (yalnızca yaprak kategoriler seçilebilir).
- [ ] Özellik ve değerleri **tembel (lazy)** çeken job: bir kategori ilk kez eşleştirildiğinde çekilir, sonra periyodik yenilenir. Tüm ağaç baştan çekilmez.
- [ ] Marka listesi önbelleği + isme göre arama (Trendyol aramasının büyük/küçük harfe duyarlı olduğunu unutma; kendi aramanda normalize et).
- [ ] Yenileme politikası: Kategori ağacı günlük, özellikler haftalık veya kategori kullanıldığında (TTL). Trendyol kategori ağacının belirli aralıklarla güncellendiğini belirtiyor.
- [ ] Bir kategoride zorunlu özellik eklendiğinde veya kaldırıldığında etkilenen eşleştirmeleri "yeniden kontrol gerekli" olarak işaretle.
- [ ] Menşei değerleri listesi önbelleği.

**Kabul kriterleri:** Panelde kategori ağacı aranabilir, seçilen kategori için zorunlu özellikler `slicer`/`varianter`/`required` bayraklarıyla listelenebiliyor.

---

### Faz 4 — Tedarikçi XML alımı (`packages/xml-ingest`)

**Hedef:** Büyük ve formatı birbirinden farklı XML'leri güvenle okumak.

- [ ] Tedarikçi ekleme: ad, feed URL, opsiyonel Basic Auth veya query token, çekim sıklığı.
- [x] İndirme: zaman aşımı, maksimum boyut sınırı, gzip desteği, HTTP ETag/Last-Modified ile gereksiz indirmeyi önleme (sunucu destekliyorsa).
- [x] **Güvenlik:** SSRF koruması (özel/iç IP aralıklarına istek yasak, yalnızca http/https), XXE koruması (harici entity çözümleme kapalı), "billion laughs" türü entity patlamalarına karşı koruma.
- [x] Karakter kodlaması: XML deklarasyonundan oku. Yoksa veya hatalıysa kullanıcının seçtiği kodlamayı uygula (UTF-8, ISO-8859-9, Windows-1254 seçenekleri).
- [x] **Streaming** ayrıştırma: dosya belleğe tamamen alınmaz. Tekrarlayan "ürün düğümü" yolu (ör. `/Urunler/Urun`) kullanıcı tarafından seçilir veya otomatik önerilir.
- [~] Her ürün düğümü JSON'a çevrilip `supplier_products.raw`'a yazılır. İçerik hash'i ile değişmeyen kayıtlar atlanır. _(JSON dönüşümü ve hash hazır; DB yazımı worker ile gelecek.)_
- [ ] **Kaybolan ürünler:** Feed'de artık bulunmayan ürünler için yapılandırılabilir politika (varsayılan: stok = 0).
- [~] _(Kontrol fonksiyonu `checkFeedShrink` hazır; worker'a bağlanıp uyarı ekranı yapılacak.)_ **Güvenlik freni:** Yeni feed önceki çekime göre ürünlerin büyük bir kısmını (ör. %50'den fazlasını) kaybetmişse otomatik stok sıfırlama **durdurulur** ve kullanıcıya uyarı gösterilir. (Bozuk veya boş gelen feed tüm mağazayı kapatmasın.)
- [ ] Önizleme: İlk N ürünü ağaç görünümünde gösteren API ucu (eşleştirme ekranı için).
- [~] _(Bozuk XML ve 100.000 ürünlük sentetik test geçiyor; gerçek XML örnekleri bekleniyor.)_ Testler: Faz 0'da toplanan 3 gerçek XML + bozuk XML + çok büyük sentetik XML (ör. 100.000 ürün) ile bellek kullanımı testi.

**Kabul kriterleri:** 100.000 ürünlük XML sabit bellek kullanımıyla işleniyor, 3 gerçek feed doğru okunuyor, güvenlik testleri geçiyor.

---

### Faz 5 — Alan eşleştirme ve normalizasyon

**Hedef:** Her tedarikçinin farklı yapısını tek bir kanonik ürün modeline çevirmek.

- [ ] Kanonik alanlar: external_id, product_main_id (model kodu), barcode, stock_code, title, description, brand_name, source_category, cost_price, currency, stock, vat_rate, images[], variant özellikleri (renk, beden vb.), desi, origin.
- [ ] Eşleştirme ekranı: XML önizlemesinden alan seçip kanonik alana bağlama. Sabit değer atama (ör. "tüm ürünlerde KDV = 20").
- [ ] Dönüşümler (transform): trim, büyük/küçük harf, bul-değiştir, regex çıkarma, sayı ayrıştırma (Türkçe ondalık virgül dahil), para birimi çevirme (sabit kur veya manuel girilen kur), HTML temizleme.
- [ ] **Varyant yapısı tespiti.** Tedarikçiler genellikle iki şekilde gönderir; ikisi de desteklenmeli:
  - (a) Her varyant ayrı düğümdür, ortak bir model kodu vardır.
  - (b) Tek ürün düğümünün altında varyant listesi bulunur.
- [x] **Barkod normalizasyonu:** Boşlukları kaldır. Trendyol kuralına göre yalnızca harf, rakam, `.`, `-`, `_` kalsın. Maksimum 40 karakter. Geçersiz olanları raporla.
  - ⚠️ DOĞRULA: Barkod stratejisi (tedarikçinin EAN barkodunu mu kullanmalı, yoksa satıcıya özel ön ekli barkod mu üretmeli) Trendyol katalog eşleşmesi ve aynı barkodu satan başka satıcılar açısından sonuç doğurabilir. Karar vermeden önce Trendyol dokümanını ve destek ekibini kontrol et.
- [ ] `title` 100 karakter, `description` 30.000 karakter, renk 50 karakter sınırları için kırpma ve uyarı.
- [ ] Doğrulama raporu: Her ürün için "Trendyol'a gönderilebilir mi?" durumu ve eksik alan listesi.

**Kabul kriterleri:** 3 gerçek feed için eşleştirme yapılabiliyor, kanonik ürünler ve varyantlar doğru gruplanıyor, doğrulama raporu eksikleri doğru gösteriyor.

---

### Faz 6 — Kategori, marka ve özellik eşleştirme

**Hedef:** Projenin en zor kısmı. Kullanıcıya en az emekle doğru eşleştirme yaptırmak.

- [ ] Kategori eşleştirme ekranı: Tedarikçi kategorisi → Trendyol **yaprak** kategori. Bir kez yapılan eşleştirme o kategorideki tüm ürünlere uygulanır.
- [ ] Basit öneri motoru (MVP): Kategori adında metin benzerliği (normalize edilmiş Türkçe karakterlerle). AI tabanlı öneri sonraki sürüme bırakılır.
- [ ] Marka eşleştirme: Kaynak marka adı → Trendyol marka ID'si. Bulunamayan markalar listelenir. (Marka yaratma servisi var, ancak MVP'de kullanıcı yönlendirilir; ⚠️ DOĞRULA: marka yaratma sürecinin onay adımları.)
- [ ] Özellik eşleştirme:
  - Kategorinin zorunlu özellikleri listelenir.
  - Her özellik için kaynak alan seçilir veya sabit değer girilir.
  - Kaynak değerler (ör. "Kırmızı", "KIRMIZI", "kirmizi") Trendyol değer ID'lerine eşlenir. Bir kez yapılan değer eşleştirmesi tüm tenant'ta tekrar kullanılır.
  - Özellik serbest değer kabul ediyorsa (custom) metin gönderilebilir.
  - `allowMultipleAttributeValues` true ise birden fazla değer seçilebilir.
- [ ] Varyantlama doğrulaması: Aynı `productMainId` altındaki varyantların yalnızca `varianter`/`slicer` özelliklerinde farklılaştığını kontrol et. Aksi durumda uyarı ver.
- [ ] Yönetmelik özellikleri (1198, 1216, 1116, 1210) ve menşei (`origin`) için tenant düzeyinde varsayılan değer girişi (ör. tüm ürünler için aynı ithalatçı bilgisi).
- [ ] Teslimat süresi (`deliveryDuration`), sevkiyat ve iade adres ID'leri (`getSuppliersAddresses`), kargo firması tercihi için tenant varsayılanları.

**Kabul kriterleri:** Pilot kullanıcı bir tedarikçinin tüm ürünlerini, ürün başına işlem yapmadan, yalnızca kategori/özellik düzeyinde eşleştirerek "gönderilebilir" duruma getirebiliyor.

---

### Faz 7 — Fiyat kuralı motoru (`packages/pricing`)

**Hedef:** Doğru ve güvenli fiyat hesaplamak. Hatalı fiyat doğrudan para kaybı ve ürün kilidi demektir.

- [x] Kural kapsamları ve önceliği: marka > kategori > tedarikçi > genel. En spesifik kural kazanır.
- [x] Hesaplama adımları (sıra sabit ve test edilmiş olmalı): maliyet → döviz çevirimi → çarpan (ör. ×1,35) → sabit ekleme (ör. +25 TL kargo payı) → yuvarlama (ör. ,90 veya ,99) → min/max sınırlar.
- [ ] **KDV yaklaşımı** açıkça seçilir ve ekranda gösterilir: Tedarikçi fiyatı KDV dahil mi, hariç mi? Trendyol `salePrice` değerinin KDV dahil mi hariç mi yorumlandığını dokümandan doğrula. (⚠️ DOĞRULA)
- [x] `listPrice` kuralı: `listPrice = salePrice` veya `salePrice × katsayı`. Her durumda `listPrice ≥ salePrice` garanti edilir.
- [~] Komisyon tahmini: Kullanıcı kategori bazında beklenen komisyon oranını girer (MVP'de API'den önceden alınan bir komisyon tablosu kullanılmıyor). Motor minimum kâr marjını buna göre korur. Siparişlerdeki `commission` alanı ile gerçekleşen komisyon ileride karşılaştırılabilir. _(Motor destekliyor; kategori bazlı giriş ekranı yok.)_
- [x] **Güvenlik sınırları (guardrails):**
  - Tek seferde fiyat değişimi %X'ten (ör. %30) fazlaysa otomatik gönderme, **onay kuyruğuna** al.
  - Maliyetin altında satış asla otomatik gönderilmez.
  - Sıfır, negatif veya NaN fiyat hiçbir koşulda gönderilmez.
- [ ] Simülasyon ekranı: "Bu kural uygulanırsa 1.240 ürünün fiyatı değişir; en büyük 10 değişiklik şunlar."
- [x] Kapsamlı birim testleri (tablo tabanlı testler, sınır değerler, yuvarlama durumları).

**Kabul kriterleri:** Birim test kapsamı yüksek (paket için ≥%95 hedef), guardrail testleri geçiyor, simülasyon ekranı çalışıyor.

---

### Faz 8 — Ürünleri Trendyol'a gönderme (Product V2)

- [ ] Başlamadan önce `reference/createproducts.md` OpenAPI şemasını oku ve Bölüm 2.3'teki "attribute alan isimleri" belirsizliğini çöz. Sonucu `TRENDYOL_NOTES.md`'ye yaz.
- [ ] Payload oluşturucu: kanonik ürün + eşleştirmeler + fiyat → Trendyol V2 item. Göndermeden önce Zod ile şema doğrulaması.
- [ ] **Görsel hattı (pipeline):**
  - Tedarikçi görselini indir → 1200x1800 boyutuna getir (oranı koruyarak beyaz dolgu ile; kırpma yapma) → 96 dpi metadata → S3 uyumlu depoya https ile yükle.
  - En fazla 8 görsel.
  - Aynı görseli tekrar işlememek için içerik hash'i ile önbellek.
- [ ] Gruplama: En fazla 1.000 item/istek. Aynı `productMainId`'nin varyantları aynı istekte gönderilir.
- [ ] Gönderim job'u Write grubu rate limiter'ından geçer. `batchRequestId` `ty_batches`'e kaydedilir.
- [ ] **Batch sonuç izleme job'u:** Artan aralıklarla sorgular. Sonuç 4 saat içinde alınmalıdır. Item bazında başarı/hata `channel_listings`'e yazılır.
- [ ] **Onay takibi:** Batch başarılı olsa bile ürün onay sürecine girer. Onaysız ürün filtreleme servisi ile periyodik kontrol edilir: bekleyen / onaylı / reddedildi + red sebepleri.
- [ ] Reddedilen ürünler için panelde "sebep + düzelt + yeniden gönder" akışı. Onaysız ürünler **onaysız güncelleme** servisiyle düzeltilir.
- [ ] Onaylı ürünlerde içerik değişikliği (başlık, açıklama, görsel) için content/variant güncelleme servisleri. Attribute güncellenirken **tüm** attribute'ların gönderilmesi gerektiğini unutma (dokümanda belirtilmiş).
- [ ] Idempotency: Aynı ürün iki kez yaratılmaya çalışılmaz. Gönderim öncesi `channel_listings` durumu kontrol edilir.
- [ ] İlk kurulum için **mevcut Trendyol ürünlerini içe aktarma:** Onaylı ürün filtreleme ile satıcının Trendyol'daki mevcut ürünleri çekilir ve barkod üzerinden kanonik varyantlarla eşleştirilir. Böylece zaten var olan ürünler yeniden yaratılmaya çalışılmaz.

**Kabul kriterleri:** Stage'de en az 50 ürün (varyantlılar dahil) yaratılıp onay durumu izlenebiliyor, reddedilen ürün düzeltilip tekrar gönderilebiliyor.

---

### Faz 9 — Stok ve fiyat senkronu

- [ ] Senkron döngüsü: XML çekimi → kanonik güncelleme → hedef stok/fiyat hesaplama → **diff** (`channel_listings.last_sent_*` ile karşılaştırma).
- [ ] Yalnızca **onaylı** ürünler `updatePriceAndInventory` ile güncellenir. Onaysızlar için stok/fiyat onaysız güncelleme servisinden gider veya kuyrukta bekletilir (hangisi olacağı dokümandan doğrulanıp `DECISIONS.md`'ye yazılır).
- [ ] 1.000 item/istek, stok ≤ 20.000 (üst sınır aşılırsa 20.000 gönderilir ve not düşülür).
- [ ] 15 dakika içinde aynı isteği tekrar göndermeme kuralı: Diff yaklaşımı ve job deduplication ile garanti altına alınır.
- [ ] Barkod başına dakikada ≤30 fiyat güncellemesi kuralı rate limiter'da uygulanır.
- [ ] **Güvenlik stoğu (opsiyonel):** Tedarikçi stoğu X'in altındaysa Trendyol'a 0 gönder (tedarik edememe riskini azaltır).
- [ ] Batch sonuçları izlenir. Başarısız item'lar bir sonraki döngüde yeniden denenir.
- [ ] Senkron sıklığı tenant planına göre ayarlanabilir. Varsayılan değer rate limit hesabıyla belirlenir ve `DECISIONS.md`'ye yazılır.
- [ ] **Acil durdurma:** Tenant veya tedarikçi bazında senkronu tek tıkla durdurma düğmesi.

**Kabul kriterleri:** 10.000 varyantlık sentetik senaryoda limitler aşılmadan tam senkron tamamlanıyor, diff sayesinde değişmeyen ürün için istek gönderilmiyor.

---

### Faz 10 — Sipariş çekme

- [ ] `getShipmentPackagesStream` ile polling job'u:
  - Her tenant için `sync_cursors.last_synced_until` baz alınır. Güvenlik payı için pencere biraz geriden başlatılır (overlap, ör. 10 dakika).
  - Pencere ≤14 gün, tarih parametreleri **GMT+3 milisaniye**.
  - `hasMore`/`nextCursor` ile tüm sayfalar gezilir. Filtre aynı akış içinde değiştirilmez.
  - İstekler arası ≥5 sn. Tenant seviyesine göre dakikalık limite uyulur.
- [ ] **Upsert anahtarı:** `shipmentPackageId`. Statü değişiklikleri `lastModifiedDate` ile güncellenir. Daha eski bir veri daha yenisinin üzerine yazılmaz.
- [ ] `createdBy` = split / cancel / transfer ve `originPackageIds` alanları ile paket bölünmesi ve kısmi iptaller doğru modellenir.
- [ ] **Backfill aracı:** Admin, bir tenant için belirli bir tarih aralığını (≤ son 3 ay) yeniden çekebilir. Trendyol'un kesinti duyurularında kullanılır.
- [ ] **Webhook (opsiyonel hızlandırıcı):**
  - Tenant başına benzersiz, tahmin edilemez URL (URL'de "trendyol" kelimesi geçmemeli).
  - `x-api-key` doğrulaması (tenant başına ayrı anahtar).
  - Gelen veri polling ile aynı upsert fonksiyonundan geçer (idempotent).
  - Trendyol'un webhook'u pasife alma ihtimaline karşı panelde durum göstergesi ve "yeniden aktifleştir" aksiyonu.
  - Satıcı başına 15 webhook sınırı nedeniyle mevcut webhook'lar listelenir, kopya oluşturulmaz.
- [ ] Sipariş geldiğinde stok etkisi: Dropshipping senaryosunda asıl kaynak tedarikçi stoğudur. Yine de bir sonraki XML çekimine kadar yerel stok düşürülerek Trendyol'a güncelleme gönderilebilir (opsiyonel, tenant ayarı).
- [ ] Kişisel veri: Sipariş ham verisinde kişisel bilgiler bulunur. Saklama süresi politikası uygulanır; panelde yalnızca yetkili roller görür.

**Kabul kriterleri:** Stage'de test siparişi oluşturulup (Test Siparişi Oluşturma servisi) sistemde görünüyor, statü güncellemeleri yansıyor, aynı sipariş iki kez kaydedilmiyor.

---

### Faz 11 — Satıcı paneli (web)

- [ ] Kurulum sihirbazı (onboarding): Trendyol bilgileri → tedarikçi ekle → alan eşleştir → kategori/özellik eşleştir → fiyat kuralı → önizle → gönder.
- [ ] Ürünler ekranı: Filtreler (tedarikçi, kategori, Trendyol durumu, hata var/yok), toplu işlemler (gönder, durdur, fiyat kuralını yeniden uygula).
- [ ] Hata merkezi: Reddedilen ürünler, batch hataları, eksik eşleştirmeler. Her hata için anlaşılır Türkçe açıklama ve "nasıl düzeltilir" bağlantısı.
- [ ] Siparişler ekranı: Liste, detay, statü, satır bazında barkod/stok kodu (tedarikçiye iletilecek bilgi).
- [ ] İşlem geçmişi (job logları): Son XML çekimi, son senkron, gönderilen/başarılı/hatalı sayıları.
- [ ] Ayarlar: Trendyol bilgileri, listeleme limit seviyesi, senkron sıklığı, varsayılan menşei/yönetmelik bilgileri, güvenlik stoğu, webhook durumu.
- [ ] Erişilebilirlik ve mobil uyumlu temel düzen.

**Kabul kriterleri:** Pilot kullanıcı, dokümantasyona bakmadan sihirbazı tamamlayıp ilk ürünlerini gönderebiliyor.

---

### Faz 12 — Operasyon, izleme, güvenilirlik

- [ ] Sağlık kontrolü uçları (API, worker, Redis, DB).
- [ ] Kuyruk panosu (ör. Bull Board), yalnızca admin erişimli.
- [ ] Alarm kuralları: Tenant bazında art arda başarısız senkron, 401 (API bilgisi değişmiş olabilir), 426 (kullanımdan kalkmış endpoint), anormal 429 oranı, sipariş çekiminde uzun süreli boşluk.
- [ ] **Changelog izleyici:** Trendyol changelog sayfasını günlük çekip değişiklik olduğunda ekibe bildirim gönderen job.
- [ ] Trendyol API durum sayfası (`/api-status`) kontrolü; kesinti varsa panelde bilgi bandı.
- [ ] Veritabanı yedekleme ve geri yükleme testi.
- [ ] Gizli bilgi anahtarı rotasyonu prosedürü.

**Kabul kriterleri:** Bir sahte 426 veya 401 senaryosunda alarm tetikleniyor, yedekten geri yükleme bir kez başarıyla denenmiş.

---

### Faz 13 — Pilot ve lansman

- [ ] 3–5 pilot satıcı ile kapalı beta. Her birinin farklı tedarikçi XML yapısı olması tercih edilir.
- [ ] Pilotta ölçülecekler: Sihirbaz tamamlama süresi, ilk gönderimde onay oranı, en sık red sebepleri, senkron gecikmesi, destek talebi konuları.
- [ ] Yasal metinler: Kullanıcı sözleşmesi, KVKK aydınlatma metni, gizlilik politikası, çerez politikası (hukukçu onayıyla).
- [ ] Fiyatlandırma ve plan limitleri (ürün sayısı, tedarikçi sayısı, senkron sıklığı).
- [ ] Destek süreçleri ve temel yardım dokümanları.

---

## 6. Test stratejisi

| Seviye              | Ne test edilir                                                            | Nasıl                                                                               |
| ------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Birim               | Fiyat motoru, barkod normalizasyonu, alan dönüşümleri, payload oluşturucu | Vitest, tablo tabanlı testler                                                       |
| Entegrasyon         | Trendyol istemcisi, rate limiter, retry                                   | Mock HTTP sunucusu + gerçek Redis                                                   |
| Sözleşme (contract) | Payload'ların Trendyol şemasına uyumu                                     | OpenAPI'den türetilen Zod şemaları                                                  |
| Uçtan uca           | Sihirbaz → gönderim → onay → senkron → sipariş                            | Stage ortamı + Test Siparişi Oluşturma ve Test Siparişi Statü Güncelleme servisleri |
| Yük                 | 100K ürünlük XML, 10K varyant senkronu                                    | Sentetik veri                                                                       |
| Güvenlik            | Tenant izolasyonu, SSRF, XXE, gizli bilgi sızıntısı                       | Otomatik testler + manuel kontrol listesi                                           |

**Kural:** Canlı (prod) Trendyol ortamına yalnızca pilot kullanıcının açık onayıyla ve önce küçük bir ürün grubuyla (ör. 5 ürün) gidilir.

---

## 7. Güvenlik ve KVKK kontrol listesi

- [x] API key/secret veritabanında şifreli; uygulama belleğinde yalnızca kullanım anında çözülür.
- [ ] Log'larda gizli bilgi ve kişisel veri maskeleme.
- [x] Tenant izolasyonu (uygulama + mümkünse RLS).
- [ ] XML indirmede SSRF ve XXE korumaları.
- [ ] Webhook uç noktasında kimlik doğrulama ve gövde boyutu sınırı.
- [ ] Sipariş kişisel verileri için saklama süresi ve silme politikası.
- [ ] Rol bazlı erişim (kişisel veri görüntüleme yetkisi).
- [ ] KVKK: Aydınlatma metni, veri işleyen sözleşmesi, sunucu lokasyonu ve yurt dışına aktarım değerlendirmesi. (Hukuki danışmanlık — bu dosya hukuki tavsiye değildir.)

---

## 8. Riskler ve önlemler

| Risk                                                      | Etki                        | Önlem                                                                       |
| --------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------- |
| Trendyol API değişiklikleri ve endpoint kapanışları       | Senkron durur               | Changelog izleyici, 426 alarmı, istemcinin tek pakette olması               |
| Bozuk/boş tedarikçi XML'i                                 | Tüm ürünlerin stoğu 0'lanır | Faz 4'teki güvenlik freni                                                   |
| Hatalı fiyat kuralı                                       | Zarar, ürün kilidi          | Guardrail'ler, onay kuyruğu, simülasyon                                     |
| Rate limit aşımı                                          | 429, gecikme                | Grup bazlı token bucket, diff senkronu                                      |
| Kategori/özellik eşleştirme zorluğu                       | Kullanıcı sihirbazı bırakır | Değer eşleştirmelerinin yeniden kullanımı, iyi öneriler, net hata mesajları |
| Webhook'un pasife düşmesi                                 | Sipariş gecikmesi           | Polling asıl yöntem, webhook yalnızca hızlandırıcı                          |
| Trendyol tarafı kesintiler                                | Eksik sipariş               | Overlap'li polling + backfill aracı                                         |
| Tedarikçi görsellerinin http veya uygunsuz boyutta olması | Ürün reddi                  | Görsel hattı (https'e taşıma, boyutlandırma)                                |
| KVKK uyumsuzluğu                                          | Hukuki risk                 | Faz 0'da hukuki değerlendirme                                               |

---

## 9. Açık sorular (⚠️ DOĞRULA listesi)

1. Basic Auth'ta kullanıcı adı/şifre sırası (API Key : API Secret) — stage ile teyit.
2. Stage IP yetkilendirmesindeki "statik IP" ifadesinin anlamı.
3. Aracı entegratör olarak Trendyol'a başvuru/kayıt gerekip gerekmediği.
4. Product V2 `attributes` içindeki doğru alan isimleri (`attributeValueId(s)`, `customAttributeValue` / `attributeValue`).
5. `salePrice`/`listPrice` değerlerinin KDV dahil mi yorumlandığı.
6. Onaysız ürünlerde stok/fiyat güncellemesinin hangi servisle yapılacağı.
7. Satıcının listeleme limit seviyesinin API'den öğrenilip öğrenilemeyeceği.
8. Barkod stratejisi (tedarikçi EAN'ı mı, satıcıya özel barkod mu).
9. Marka yaratma servisinin onay süreci.
10. Ürün V1 kapanış tarihindeki tutarsızlık (15 Eylül vs 15 Ekim 2026) — V1 kullanılmayacağı için yalnızca bilgi amaçlı.

---

## 10. MVP sonrası yol haritası (öncelik sırasıyla öneri)

1. **AI içerik zenginleştirme:** Tedarikçi açıklamasını yeniden yazma, açıklamadan özellik çıkarıp Trendyol özelliklerini doldurma, görsel arka plan temizleme. (Eşleştirme zorluğunu da azaltır.)
2. **AI kategori önerisi:** Ürün başlığı ve açıklamasından Trendyol yaprak kategorisi önerme.
3. **E-fatura:** Bir özel entegratör ile bağlantı + `sendInvoiceLink` / `uploadInvoiceFile`.
4. **Sipariş → tedarikçiye iletim:** Siparişi tedarikçiye e-posta/API ile otomatik iletme (dropshipping akışı).
5. **İade ve müşteri soruları** yönetimi.
6. **Finans:** Settlements/Other Financials ile gerçekleşen komisyon ve hakediş raporları, ürün bazında net kâr.
7. **Buybox takibi** (Write limit grubunu tükettiği için dikkatli planlanmalı).
8. **İkinci kanal** (ör. Hepsiburada) — bu noktada çok kanallı stok rezervasyonu mimarisi gerekecek.

---

## 11. Referans bağlantıları

- Doküman indeksi (AI için): https://developers.trendyol.com/llms.txt
- Changelog: https://developers.trendyol.com/changelog/changelog.md
- Servis limitleri: https://developers.trendyol.com/docs/1-servis-limitleri.md
- Authorization: https://developers.trendyol.com/docs/2-authorization.md
- Canlı/Test ortam bilgileri: https://developers.trendyol.com/docs/3-canlı-test-ortam-bilgileri.md
- Ürün V2 servis listesi: https://developers.trendyol.com/docs/ürün-v2-api-endpoint.md
- Ürün yaratma v2: https://developers.trendyol.com/docs/ürün-yaratma-v2.md
- Ürün yaratma v2 OpenAPI: https://developers.trendyol.com/reference/createproducts.md
- Stok ve fiyat güncelleme: https://developers.trendyol.com/reference/updatepriceandinventory.md
- Toplu işlem kontrolü: https://developers.trendyol.com/reference/getbatchrequestresult.md
- Sipariş akış servisi (stream): https://developers.trendyol.com/docs/sipariş-paketlerini-akış-ile-çekme.md
- Webhook modeli: https://developers.trendyol.com/docs/webhook-model.md
- Menşei değerleri: https://developers.trendyol.com/docs/ürün-menşei-değerleri.md
- API durum sayfası: https://developers.trendyol.com/api-status
