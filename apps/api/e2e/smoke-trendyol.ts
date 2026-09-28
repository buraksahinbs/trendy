/**
 * Gerçek Trendyol hesabıyla SALT-OKUMA duman testi. Hiçbir yazma servisi çağrılmaz
 * (stok/fiyat güncelleme, ürün yaratma vb. bu dosyada içe aktarılmaz bile).
 *
 *   TRENDYOL_SELLER_ID=… TRENDYOL_API_KEY=… TRENDYOL_API_SECRET=… \
 *     pnpm --filter @trendy/api smoke:trendyol
 *
 * Bilgiler yalnızca ortam değişkeninden okunur, ekrana yazılmaz. Kontroller:
 *  1) Kimlik doğrulama (panelin "Bağlantıyı test et" ile aynı çağrı)
 *  2) Onaylı ürünler: yanıt şemamızla okunabiliyor mu
 *  3) Onaysız ürünler (onay bekleyen / reddedilen)
 *  4) Sipariş akışı: son 3 gün; gelen alan adları (shipmentPackageId mi, id mi?) raporlanır
 */
import {
  filterApprovedProducts,
  filterApprovedProductsInventoryAndPrice,
  filterUnapprovedProducts,
  InMemoryRateLimiter,
  shipmentPackageSchema,
  TrendyolAuthError,
  TrendyolClient,
  TrendyolError,
  type ListingTier,
} from "@trendy/trendyol-client";

const env = (name: string) => {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Eksik ortam değişkeni: ${name}`);
    process.exit(2);
  }
  return v;
};

const client = new TrendyolClient({
  env: process.env.TRENDYOL_ENV === "stage" ? "stage" : "prod",
  sellerId: env("TRENDYOL_SELLER_ID"),
  apiKey: env("TRENDYOL_API_KEY"),
  apiSecret: env("TRENDYOL_API_SECRET"),
  integratorName: process.env.TRENDYOL_INTEGRATOR_NAME ?? "SelfIntegration",
  tier: (process.env.TRENDYOL_TIER as ListingTier | undefined) ?? "50k",
  limiter: new InMemoryRateLimiter(),
  maxServerRetries: 1,
  requestTimeoutMs: 20_000,
  // Yalnızca betiği sahte sunucuya karşı denemek için
  ...(process.env.TRENDYOL_BASE_URL ? { baseUrl: process.env.TRENDYOL_BASE_URL } : {}),
});

let failed = 0;
async function check(name: string, fn: () => Promise<string[]>) {
  process.stdout.write(`\n▶ ${name}\n`);
  try {
    for (const line of await fn()) console.log(`  ${line}`);
    console.log("  ✓ tamam");
  } catch (err) {
    failed++;
    if (err instanceof TrendyolError) {
      console.log(`  ✗ ${err.name} (HTTP ${err.status ?? "-"}): ${err.message}`);
      if (err.responseBody) console.log(`    yanıt: ${err.responseBody.slice(0, 500)}`);
      if (err instanceof TrendyolAuthError && err.status === 401)
        console.log(
          "    → Satıcı ID / API Key / API Secret'ı kontrol edin (canlı ve stage farklıdır).",
        );
      if (err instanceof TrendyolAuthError && err.status === 403)
        console.log("    → User-Agent veya yetki sorunu; sonucu bize iletin.");
    } else if (err && typeof err === "object" && "issues" in err) {
      // Zod: Trendyol'un yanıtı beklediğimiz şemaya uymadı
      console.log("  ✗ Yanıt beklenen şemaya uymuyor:");
      for (const i of (err as { issues: { path: unknown[]; message: string }[] }).issues.slice(
        0,
        8,
      ))
        console.log(`    - ${i.path.join(".") || "(kök)"}: ${i.message}`);
    } else {
      console.log(`  ✗ ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

const keys = (o: unknown) =>
  o && typeof o === "object"
    ? Object.keys(o as object)
        .sort()
        .join(", ")
    : String(o);

console.log(
  `Trendyol salt-okuma testi · satıcı ${client.sellerId} · ${
    process.env.TRENDYOL_BASE_URL
      ? `SAHTE SUNUCU (${process.env.TRENDYOL_BASE_URL})`
      : process.env.TRENDYOL_ENV === "stage"
        ? "STAGE"
        : "CANLI"
  } · yazma yok`,
);

await check("1) Kimlik doğrulama", async () => {
  const page = await filterApprovedProductsInventoryAndPrice(client, { page: 0, size: 1 });
  return [`Onaylı içerik sayısı: ${page.totalElements ?? "?"}`];
});

if (failed) {
  console.log("\nKimlik doğrulanamadı; diğer kontroller atlandı.");
  process.exit(1);
}

await check("2) Onaylı ürünler (ilk 5 içerik)", async () => {
  const page = await filterApprovedProducts(client, { page: 0, size: 5 });
  const content = page.content ?? [];
  const variants = content.flatMap((c) => c.variants ?? []);
  const sample = content[0];
  return [
    `Toplam: ${page.totalElements ?? "?"} içerik · bu sayfada ${content.length} içerik, ${variants.length} varyant`,
    sample
      ? `Örnek: "${sample.title}" · ${sample.brand?.name ?? "-"} · barkodlar: ${(sample.variants ?? []).map((v) => v.barcode).join(", ")}`
      : "Onaylı ürün yok",
    `Kilitli (bu sayfada): ${variants.filter((v) => v.locked).length}`,
  ];
});

await check("3) Onaysız ürünler (ilk 5)", async () => {
  const page = await filterUnapprovedProducts(client, { page: 0, size: 5 });
  const content = page.content ?? [];
  return [
    `Toplam: ${page.totalElements ?? "?"} · bu sayfada ${content.length}`,
    ...content
      .filter((c) => c.rejectReasonDetails?.length)
      .slice(0, 2)
      .map((c) => `Red: ${c.barcode} · ${c.rejectReasonDetails?.[0]?.rejectReason ?? "-"}`),
  ];
});

await check("4) Sipariş akışı (son 3 gün, en fazla 5 paket)", async () => {
  const end = Date.now();
  const start = end - 3 * 24 * 60 * 60_000;
  // Ham yanıt: alan adlarını şemaya sokmadan görmek için
  const raw = await client.request<{ content?: unknown[]; hasMore?: boolean }>({
    method: "GET",
    path: `/integration/order/sellers/${client.sellerId}/orders/stream`,
    group: "orders",
    endpoint: "getShipmentPackagesStream",
    query: { size: 5, lastModifiedStartDate: start, lastModifiedEndDate: end },
  });
  const content = raw.content ?? [];
  const lines: string[] = [`Bu sayfada ${content.length} paket · hasMore=${raw.hasMore}`];
  const first = content[0] as Record<string, unknown> | undefined;
  if (!first)
    return [
      ...lines,
      "Son 3 günde paket yok; alan adları doğrulanamadı (daha geniş aralık deneyin).",
    ];
  lines.push(`Paket alanları: ${keys(first)}`);
  const line0 = Array.isArray(first.lines) ? first.lines[0] : undefined;
  lines.push(`Satır alanları: ${keys(line0)}`);
  const hasNew = "shipmentPackageId" in first;
  const hasOld = "id" in first;
  lines.push(
    hasNew
      ? "Alan adları GÜNCEL (shipmentPackageId) → kodumuzla uyumlu"
      : hasOld
        ? "⚠ Alan adları ESKİ (id) → sipariş çekme bu hâliyle ÇALIŞMAZ, kod uyarlanmalı"
        : "⚠ Paket kimliği alanı tanınmadı",
  );
  // Kodun kullandığı şemayla okunabiliyor mu?
  for (const p of content) shipmentPackageSchema.parse(p);
  lines.push("Tüm paketler kodun şemasıyla okunabildi");
  return lines;
});

console.log(
  failed
    ? `\n${failed} kontrol başarısız. Çıktıyı (sır içermez) paylaşın.`
    : "\nTüm kontroller geçti. Panelden gerçek bağlantıya geçilebilir.",
);
process.exit(failed ? 1 : 0);
