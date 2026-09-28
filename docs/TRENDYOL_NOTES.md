# Trendyol Notları

Stage/canlı testlerinde öğrenilen gerçekler buraya yazılır.

- 2026-09-28: Authorization dokümanı — kendi entegrasyonunu yazan satıcı için User-Agent `"{SatıcıId} - SelfIntegration"`, aracı firma için `"{SatıcıId} - {FirmaAdı}"` (alfanümerik, ≤30). Başvuru/kayıt şartından bahsedilmiyor.

## 2026-09-28 — `docs/trendyol-api/ozet-2026-09-28.md` incelemesi

Dosya resmi dokümanın **özeti**; OpenAPI şeması değil. Endpoint istek/yanıt alanları için esas
kaynak olarak kullanılamaz (ROADMAP §0 kural 1). Yine de şu bilgiler alınabilir:

**Roadmap'i destekleyen / netleştiren:**

- Basic Auth: `base64(apiKey:apiSecret)` — istemcideki varsayımla aynı. ⚠️ DOĞRULA #1 yine de gerçek bir çağrıyla kapatılacak.
- Product V1 kapanışı: **15 Ekim 2026** (§9 #10'daki tutarsızlıkta 15 Ekim lehine).
- Order V2 (`GET /integration/order/sellers/{sellerId}/v2/orders`) sorgu parametreleri: `status`, `startDate`, `endDate`, `orderByField=PackageLastModifiedDate`, `orderByDirection`, `size`. Tarih verilmezse en fazla 1 haftalık, verilirse en fazla 2 haftalık pencere.
- Ürün yaratma örneğinde roadmap'te olmayan alanlar: `stockCode`, `dimensionalWeight`, `cargoCompanyId`.
- Siparişte `fastDeliveryType` / `fastDeliveryOptions` alanları var (öncelik: SameDayShipping > FastDelivery > null). Üründe `fastDeliveryType` gönderilmiyor; bu sipariş tarafı.

**Roadmap ile çelişen — çözülene kadar roadmap'teki muhafazakâr değer geçerli:**

- Order V2 `getShipmentPackages` limiti: özet "dakikada 1000" diyor; roadmap §2.2 "sipariş paketlerini çekme" için 50K seviyede **30/dk** diyor. `limits.ts` 30/dk kullanmaya devam ediyor.
- Order V2 statü listesinde `AtCollectionPoint` yok; webhook listesinde `AT_COLLECTION_POINT` var. Roadmap listesi korunuyor.
- `channels` değeri: özet `LUXE` ve `LUXURY` arasında kararsız. Luxe MVP dışı.

**Özette olmayan (resmi sayfa gerekli):**

- `updatePriceAndInventory` item alanları ve yanıtı
- Batch sonucu V2 endpoint path'i ve yanıt yapısı
- Onaylı / onaysız ürün filtreleme V2 path'leri, parametreleri ve yanıtı
- Stream (`orders/stream`) yanıt yapısı, Order V2 paket yanıt yapısı
- Kategori özelliği yanıtı (`required`, `slicer`, `varianter`, `allowCustom` alan adları)
- Ürün yaratma `attributes` alan adları (⚠️ DOĞRULA #4)
