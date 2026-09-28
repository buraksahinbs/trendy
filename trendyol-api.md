# Trendyol Marketplace API

> Güncel entegrasyon notları: 28 Eylül 2026  
> Kaynak: Trendyol resmi Marketplace API dokümantasyonu.

## 1. Kritik geçiş tarihleri

### Product API

Product V2 servisleri aktif durumdadır. Eski Product V1 servislerinin kullanım dışı bırakılması için Trendyol'un güncel dokümanlarında **15 Ekim 2026** tarihi belirtilmektedir.

Yeni entegrasyonlarda Product V2 kullanılmalıdır.

### Order API

Order V2 aktif durumdadır. Eski:

```text
GET /integration/order/sellers/{sellerId}/orders
```

endpoint'i **15 Ekim 2026** itibarıyla kullanım dışı olacaktır.

Yeni:

```text
GET /integration/order/sellers/{sellerId}/v2/orders
```

kullanılmalıdır.

Order V2 tarafında maksimum erişilebilir kayıt penceresi `10,000` shipmentPackageId ile sınırlandırılmıştır.

---

## 2. Authentication

Trendyol API istekleri Basic Authentication kullanır.

Gerekli bilgiler:

- `supplierId` / `sellerId`
- `API Key`
- `API Secret Key`

Header:

```http
Authorization: Basic <base64(apiKey:apiSecret)>
User-Agent: <sellerId> - <integrationName>
```

Örnek:

```http
User-Agent: 1234 - SelfIntegration
```

Entegratör adı alfanumerik karakterlerden oluşmalı ve maksimum 30 karakter olmalıdır.

API credentials kesinlikle repository'ye, frontend koduna veya public loglara yazılmamalıdır.

---

## 3. Rate limit

Genel Marketplace API kuralı:

```text
Aynı endpoint'e 10 saniye içinde maksimum 50 request
```

Limit aşılırsa:

```http
429 Too Many Requests
```

döner.

Bazı servislerin kendi endpoint-specific limitleri daha farklı olabilir. Endpoint dokümanındaki limit esas alınmalıdır.

Örneğin Order V2 `getShipmentPackages` servisi için dokümanda dakika başına 1000 request bilgisi bulunmaktadır.

---

# 4. Base URLs

## Production

```text
https://apigw.trendyol.com
```

## Stage

```text
https://stageapigw.trendyol.com
```

Endpoint path'leri servise göre değişir.

---

# 5. Product API V2

## 5.1 Brand List

```http
GET /integration/product/brands
```

Ortak servis:

```text
V1-V2
```

---

## 5.2 Category List

```http
GET /integration/product/product-categories
```

Ortak servis:

```text
V1-V2
```

---

## 5.3 Category Attributes

```http
GET /integration/product/categories/{categoryId}/attributes
```

V2 servisidir.

---

## 5.4 Category Attribute Values

```http
GET /integration/product/categories/{categoryId}/attributes/{attributeId}/values
```

V2 servisidir.

---

## 5.5 Create Products V2

```http
POST /integration/product/sellers/{sellerId}/v2/products
```

Önemli:

- Maksimum `1000` ürün/request.
- İşlem asynchronous'tur.
- Response içindeki `batchRequestId` ile işlem sonucu takip edilir.
- `listPrice`, `salePrice` değerinden küçük olamaz.

Örnek:

```json
{
  "items": [
    {
      "barcode": "8680000000001",
      "title": "Example Product",
      "productMainId": "EXAMPLE-001",
      "brandId": 123,
      "categoryId": 456,
      "quantity": 10,
      "stockCode": "STOCK-001",
      "dimensionalWeight": 1.0,
      "listPrice": 999.90,
      "salePrice": 899.90,
      "vatRate": 20,
      "cargoCompanyId": 10,
      "images": [
        {
          "url": "https://example.com/product.jpg"
        }
      ],
      "attributes": []
    }
  ]
}
```

> Payload içindeki alanlar kategori ve güncel Product V2 modeline göre doğrulanmalıdır. Kategori attribute'ları statik olarak hard-code edilmemelidir.

---

# 6. Product V2 batch işlemleri

Product oluşturma/güncelleme asynchronous olabileceğinden:

```text
1. Request gönder
2. batchRequestId al
3. Batch status endpoint'ini çağır
4. İşlem tamamlanana kadar polling yap
5. Başarılı/başarısız item'ları kaydet
```

Batch sonucu için V2 endpoint kullanılmalıdır:

```text
Check Batch Request Result V2
```

Uygulama tarafında `batchRequestId` transactional olarak saklanmalıdır.

Önerilen model:

```text
batch_requests
├── id
├── batch_request_id
├── operation
├── status
├── created_at
├── completed_at
└── raw_response
```

---

# 7. Product Update V2

V2 tarafında ürün güncelleme iki ana senaryoya ayrılır:

### Unapproved Product Update

Ürün henüz onaylanmamışsa:

```text
Product Update - Unapproved Product V2
```

### Approved Product Update

Onaylanmış ürünlerde varyant/content/delivery bilgileri için:

```text
Product Update - Approved Product V2
```

Endpoint'leri ve body modellerini tek bir generic V1 modeline bağlamayın.

V2'nin content-based yapısı esas alınmalıdır.

---

# 8. Product Filtering V2

İki ayrı filtreleme servisi bulunur:

```text
Unapproved Product Filtering V2
Approved Product Filtering V2
```

Bunları uygulama içinde ayrı adapter/service olarak tutmak daha güvenlidir.

Önerilen abstraction:

```text
TrendyolProductClient
├── createProducts()
├── updateUnapprovedProducts()
├── updateApprovedProducts()
├── filterUnapprovedProducts()
├── filterApprovedProducts()
├── getBatchResult()
├── getBrands()
├── getCategories()
├── getCategoryAttributes()
└── getAttributeValues()
```

---

# 9. Order API V2

## 9.1 Get Shipment Packages

Production:

```http
GET https://apigw.trendyol.com/integration/order/sellers/{sellerId}/v2/orders
```

Stage:

```http
GET https://stageapigw.trendyol.com/integration/order/sellers/{sellerId}/v2/orders
```

Önerilen kullanım:

```text
/v2/orders
  ?status=Created
  &startDate={startDate}
  &endDate={endDate}
  &orderByField=PackageLastModifiedDate
  &orderByDirection=DESC
  &size=50
```

Desteklenen status değerleri arasında:

```text
Created
Picking
Invoiced
Shipped
Cancelled
Delivered
UnDelivered
Returned
UnPacked
UnSupplied
Awaiting
Verified
```

bulunur.

Tarih aralığı kullanılmadığında servis maksimum bir haftalık sipariş penceresi döndürür.

`startDate` ve `endDate` kullanıldığında maksimum tarih aralığı iki haftadır.

---

# 10. Order pagination / large data

Normal Order API sorgusunda erişilebilir kayıt sayısı:

```text
maxQueryWindowResult = 10,000
```

Büyük veri taraması gerekiyorsa cursor-based stream servisi kullanılmalıdır:

```text
Get Shipment Packages with Cursor
```

Bu servis özellikle:

- full scan
- historical sync
- cron/polling
- export

senaryoları için uygundur.

Stream endpoint'inde klasik:

```text
totalElements
totalPages
page
```

alanlarına güvenilmemelidir.

Cursor mantığı kullanılmalıdır.

---

# 11. Order sync önerisi

Üretim entegrasyonu için önerilen yapı:

```text
                    ┌──────────────┐
                    │ Trendyol API │
                    └──────┬───────┘
                           │
              ┌────────────┴────────────┐
              │                         │
          Webhook                  Periodic Sync
              │                         │
              └────────────┬────────────┘
                           │
                     Order Upsert
                           │
                    ┌──────▼──────┐
                    │ Local Order │
                    │    Store    │
                    └─────────────┘
```

Webhook tek başına source of truth olarak kullanılmamalıdır.

Periyodik reconciliation yapılmalıdır.

---

# 12. Webhook

Webhook ile Trendyol sipariş paketlerindeki değişiklikler sizin endpoint'inize POST edilir.

Desteklenen durumlar arasında:

```text
CREATED
PICKING
INVOICED
SHIPPED
CANCELLED
DELIVERED
UNDELIVERED
RETURNED
UNSUPPLIED
AWAITING
UNPACKED
AT_COLLECTION_POINT
VERIFIED
```

bulunur.

Webhook authentication seçenekleri:

```text
BASIC_AUTHENTICATION
API_KEY
```

API key kullanılıyorsa Trendyol request'i:

```http
x-api-key: <api-key>
```

header'ı ile gönderebilir.

Basic authentication kullanılıyorsa username/password tanımlanır.

---

# 13. Webhook reliability

Webhook endpoint'i idempotent olmalıdır.

Aynı event'in birden fazla kez gelmesi durumunda duplicate order/event oluşmamalıdır.

Önerilen:

```text
Webhook request
      │
      ▼
Validate
      │
      ▼
Generate idempotency key
      │
      ├── Already processed → 200
      │
      ▼
Persist event
      │
      ▼
Queue
      │
      ▼
Process order
```

Trendyol başarısız webhook isteklerini tekrar gönderebilir.

Dokümana göre başarısız request'ler başarılı olana kadar periyodik olarak yeniden denenir.

Bu nedenle endpoint hızlı şekilde `2xx` döndürmeli ve ağır işlemleri queue üzerinden gerçekleştirmelidir.

---

# 14. Webhook limits

Bir seller için maksimum webhook sayısı:

```text
15
```

Pasife alınmış webhooklar da bu limite dahildir.

Webhook endpoint URL'sinde şu ifadeler bulunmamalıdır:

```text
Trendyol
Dolap
Localhost
```

---

# 15. Order paymentMethod

09.09.2026 tarihinde sipariş paketleri ve webhook modeline:

```text
paymentMethod
```

alanı eklenmiştir.

Olası değerler:

```text
Banka Kartı
Kredi Kartı
Alışveriş Kredisi
Cüzdan - Trendpay
Şimdi Al Sonra Öde - Trendpay
-
```

Faturalandırma mantığında bu alan dikkate alınmalıdır.

---

# 16. Trendyol Luxe

Sipariş ve iade servislerinde `channelId` kullanılabilir.

Değerler:

```text
1  = CORE
25 = TRENDYOL LUXE
```

Ürün servislerinde kanal bilgisi için `channels` alanı kullanılabilir.

Kurallar:

```json
["CORE"]
```

Sadece standart platform.

```json
["LUXE"]
```

Sadece Trendyol Luxe.

```json
["CORE", "LUXE"]
```

Her iki kanal.

Boş array:

```json
[]
```

geçersizdir.

> Not: Resmi changelog metninde bazı örneklerde `LUXURY`, bazı kurallarda `LUXE` ifadesi görülmektedir. Entegrasyonda güncel endpoint'in resmi schema/modeli esas alınmalıdır.

---

# 17. Delivery information

Yeni ürün teslimat modelinde:

```text
deliveryDuration
```

kullanılır.

Örnek:

```json
{
  "deliveryDuration": 0
}
```

Aynı gün kargo.

```json
{
  "deliveryDuration": 1
}
```

Ertesi gün kargo.

Order tarafında:

```text
fastDeliveryType
fastDeliveryOptions
```

alanları kullanılabilir.

`fastDeliveryType` önceliği:

```text
SameDayShipping
    >
FastDelivery
    >
null
```

---

# 18. Origin / menşei

Product V2 tarafında yeni:

```text
origin
```

alanı kullanılmaktadır.

Geçiş döneminde bazı kategorilerde menşei bilgisi eski `attributes` yapısından da gönderilebilmektedir.

**23 Ekim 2026** itibarıyla yeni `origin` alanının zorunlu hale gelmesi planlanmıştır.

Entegrasyon kodu `origin` alanını desteklemelidir.

---

# 19. Error handling

Temel HTTP durumları:

| Status | Anlam |
|---|---|
| 200 | Başarılı |
| 400 | Geçersiz/missing parameter |
| 401 | Authentication problemi |
| 403 | User-Agent / erişim problemi |
| 404 | Geçersiz endpoint |
| 429 | Rate limit |
| 500 | Geçici sunucu problemi |

Retry uygulanabilecek durumlar:

```text
429
500
502
503
504
```

Retry uygulanırken exponential backoff kullanılmalıdır.

Örnek:

```text
1s
2s
4s
8s
16s
```

Maximum retry sayısı belirlenmelidir.

`400` ve çoğu `401/403` hatasında blind retry yapılmamalıdır.

---

# 20. Önerilen application architecture

```text
src/
└── integrations/
    └── trendyol/
        ├── auth/
        │   └── trendyol-auth.ts
        │
        ├── client/
        │   ├── trendyol-http-client.ts
        │   └── trendyol-rate-limiter.ts
        │
        ├── product/
        │   ├── product-v2-client.ts
        │   ├── product-mapper.ts
        │   └── product-sync.ts
        │
        ├── order/
        │   ├── order-v2-client.ts
        │   ├── order-mapper.ts
        │   ├── order-sync.ts
        │   └── order-reconciliation.ts
        │
        ├── webhook/
        │   ├── webhook-handler.ts
        │   └── webhook-verifier.ts
        │
        └── types/
            ├── product.ts
            ├── order.ts
            └── webhook.ts
```

---

# 21. Sync strategy

## Products

```text
Local product
    ↓
Map to Trendyol V2
    ↓
POST create/update
    ↓
batchRequestId
    ↓
Poll batch status
    ↓
Persist result
```

## Orders

```text
Webhook
   +
Periodic incremental sync
   +
Periodic reconciliation
        ↓
   Normalize order
        ↓
     Upsert
```

## Large historical import

```text
Cursor Stream
      ↓
Read page
      ↓
Persist
      ↓
Next cursor
      ↓
Repeat
```

---

# 22. Implementation rules

1. Yeni kodda V1 endpoint kullanılmamalıdır.
2. Product V2 ve Order V2 ayrı client olarak modellenmelidir.
3. Trendyol payload modelleri domain modellerinden ayrılmalıdır.
4. API credentials yalnızca backend secret store/environment üzerinden okunmalıdır.
5. Her request için User-Agent gönderilmelidir.
6. Rate limiting merkezi HTTP client seviyesinde uygulanmalıdır.
7. `429` için retry/backoff uygulanmalıdır.
8. Asynchronous batch işlemleri DB'de takip edilmelidir.
9. Webhook handler idempotent olmalıdır.
10. Webhook + polling/reconciliation birlikte kullanılmalıdır.
11. Büyük veri için cursor-based endpoint tercih edilmelidir.
12. `10,000` kayıt sınırı dikkate alınmalıdır.
13. Product attribute'ları kategori API'sinden dinamik alınmalıdır.
14. `paymentMethod`, `channelId`, `deliveryDuration`, `origin` gibi yeni alanlar domain modelinde desteklenmelidir.
15. V1 → V2 migration için feature flag kullanılabilir.

---

# 23. Migration checklist

## Authentication

- [ ] API Key güvenli secret storage'da
- [ ] API Secret güvenli secret storage'da
- [ ] User-Agent uygulanmış
- [ ] Production / Stage credential ayrımı yapılmış

## Product

- [ ] Product V2 create
- [ ] Product V2 update
- [ ] Product V2 filtering
- [ ] Category attributes V2
- [ ] Batch result V2
- [ ] `origin` desteği
- [ ] `deliveryDuration` desteği
- [ ] Channel desteği

## Order

- [ ] Order V2 endpoint
- [ ] 10,000 record limit handling
- [ ] Cursor stream
- [ ] `paymentMethod`
- [ ] `channelId`
- [ ] `fastDeliveryType`
- [ ] `fastDeliveryOptions`

## Webhook

- [ ] Idempotency
- [ ] Authentication
- [ ] Retry-safe processing
- [ ] Queue
- [ ] Reconciliation job
- [ ] Maximum 15 webhook kontrolü

## Reliability

- [ ] 429 backoff
- [ ] 5xx retry
- [ ] Request logging
- [ ] Correlation ID
- [ ] Batch monitoring
- [ ] Dead-letter queue
- [ ] Alerting

---

# 24. Official documentation

- Trendyol Marketplace API: https://developers.trendyol.com/
- Authorization: https://developers.trendyol.com/docs/2-authorization
- Product V2 endpoints: https://developers.trendyol.com/tr/v2.0/docs/product-v2-api-endpoint
- Product Create V2: https://developers.trendyol.com/v2.0/reference/createproducts
- Order V2 / Get Shipment Packages: https://developers.trendyol.com/v2.0/docs/get-order-packages-getshipmentpackages
- Webhook Model: https://developers.trendyol.com/docs/webhook-model
- Changelog: https://developers.trendyol.com/v2.0/changelog/changelog

---

## Current status

As of **28 September 2026**:

```text
Product V2       → use
Order V2         → use
Old Product V1   → migration required
Old Order V1     → migration required
```

Critical upcoming date:

```text
15 October 2026
```

The integration should therefore be implemented against V2 rather than building new functionality on legacy V1 endpoints.
