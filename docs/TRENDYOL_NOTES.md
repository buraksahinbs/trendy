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

## 2026-09-28 — Resmi doküman incelemesi (developers.trendyol.com erişimi açıldı)

Kopyalar: `docs/trendyol-api/ref-*.md` (OpenAPI), `doc-*.md` (kılavuz), `changelog.md`.

**Doğrulananlar:**

- Servis limitleri roadmap §2.2 ve `limits.ts` ile birebir aynı. Sipariş paketlerini çekme 50K seviyede **30/dk** (özet dosyadaki "1000/dk" yanlıştı). Genel kural "aynı endpoint'e 10 sn'de 50 istek" Authorization sayfasında duruyor.
- `updatePriceAndInventory`: `POST /integration/inventory/sellers/{sellerId}/products/price-and-inventory`, gövde `{ items: [{ barcode, quantity?, salePrice?, listPrice? }] }`, yanıt `{ batchRequestId }`. Stok ve fiyat ayrı ayrı gönderilebilir. `quantity` satılabilir stoktur.
- `getBatchRequestResult`: `GET /integration/product/sellers/{sellerId}/products/batch-requests/{id}`. **Stok/fiyat batch'lerinde batch seviyesinde `status` dönmez**; öğe bazlı `status` (SUCCESS/FAILED, bazı örneklerde IN_PROGRESS) kontrol edilmeli. `batchRequestType = ProductInventoryUpdate`.
- Onaylı ürün filtreleri `size` ≤ 100, onaysız ≤ 1000; `page × size` ≤ 10.000, sonrası `nextPageToken`. Sayfalar 0'dan başlar.
- `getProductBase` yolu tekil: `/product/sellers/{sellerId}/product/{barcode}`.
- Kılavuz örneklerinde OpenAPI şemasında olmayan alanlar var (`stock.quantity`, `commission`, `priceSeenByCustomer`); istemci yanıtları esnek doğrular.

**Açık kalanlar:**

- ⚠️ #1 Basic Auth sırası: doküman "API Key ve API Secret" diyor, sıra açık değil. Doğrulama ucu ilk gerçek çağrıda teyit edecek.
- ⚠️ #2 Stage: "Statik IP'ler için yetkilendirme sağlanamamaktadır" ifadesi hâlâ belirsiz.
- ⚠️ #5 KDV: pazaryeri dokümanlarında `salePrice`'ın KDV dahil olduğu yazmıyor ("KDV dahil" yalnızca ayrı bir ürün olan İhracat Merkezi dokümanında geçiyor). Trendyol destekten teyit edilmeli.
- `filterApprovedProductsInventoryAndPrice` içindeki `barcodes` dizisinin sorgu dizesinde nasıl kodlanacağı belirsiz (şema dizi, kılavuz string diyor); kullanılmıyor, tüm ürünler sayfa sayfa geziliyor.
