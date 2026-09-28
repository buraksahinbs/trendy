# Trendyol API dokümanları (yerel kopya)

Geliştirme ortamı `developers.trendyol.com`'a erişemediğinde tipler ve endpoint fonksiyonları
bu klasördeki kopyalardan türetilir (ROADMAP §0 kural 1: uydurma yok).

## Nasıl indirilir

Tarayıcıda aşağıdaki adresleri aç (sonlarındaki `.md` sayfanın markdown sürümünü verir),
içeriği olduğu gibi aynı adla bu klasöre kaydet. Dosyanın başına indirme tarihini yaz:

```
<!-- indirildi: 2026-09-28 — https://developers.trendyol.com/reference/updatepriceandinventory.md -->
```

## Öncelik 1 — stok/fiyat senkronu dilimi (DECISIONS: önce senkron)

| Dosya                        | Adres                                                                   |
| ---------------------------- | ----------------------------------------------------------------------- |
| `urun-v2-api-endpoint.md`    | https://developers.trendyol.com/docs/ürün-v2-api-endpoint.md            |
| `updatepriceandinventory.md` | https://developers.trendyol.com/reference/updatepriceandinventory.md    |
| `getbatchrequestresult.md`   | https://developers.trendyol.com/reference/getbatchrequestresult.md      |
| Onaylı ürün filtreleme (V2)  | `urun-v2-api-endpoint.md` içindeki "onaylı ürün filtreleme" bağlantısı  |
| Onaysız ürün filtreleme (V2) | `urun-v2-api-endpoint.md` içindeki "onaysız ürün filtreleme" bağlantısı |
| `1-servis-limitleri.md`      | https://developers.trendyol.com/docs/1-servis-limitleri.md              |
| `2-authorization.md`         | https://developers.trendyol.com/docs/2-authorization.md                 |
| `changelog.md`               | https://developers.trendyol.com/changelog/changelog.md                  |

## Öncelik 2 — siparişler

| Dosya                                   | Adres                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `siparis-paketlerini-akis-ile-cekme.md` | https://developers.trendyol.com/docs/sipariş-paketlerini-akış-ile-çekme.md |
| `webhook-model.md`                      | https://developers.trendyol.com/docs/webhook-model.md                      |

## Öncelik 3 — ürün yaratma ve referans verisi

| Dosya                      | Adres                                                         |
| -------------------------- | ------------------------------------------------------------- |
| `urun-yaratma-v2.md`       | https://developers.trendyol.com/docs/ürün-yaratma-v2.md       |
| `createproducts.md`        | https://developers.trendyol.com/reference/createproducts.md   |
| `urun-mensei-degerleri.md` | https://developers.trendyol.com/docs/ürün-menşei-değerleri.md |
| Marka, kategori, özellik   | `urun-v2-api-endpoint.md` içindeki ilgili bağlantılar         |
