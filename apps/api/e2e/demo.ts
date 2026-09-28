/**
 * Lokal demo: arayüzü gerçekçi veriyle görmek için sahte Trendyol ve sahte tedarikçi feed'i.
 * Gerçek Trendyol'a hiçbir istek gitmez.
 *
 *   1) pnpm --filter @trendy/api demo:servers   → sahte sunucular (açık kalır)
 *   2) API ve worker'ı şu değişkenlerle başlatın:
 *        TRENDYOL_BASE_URL=http://127.0.0.1:3950  FEED_ALLOW_PRIVATE_NETWORK=true
 *   3) pnpm --filter @trendy/api demo:seed       → giriş yapıp mağazayı kurar
 *
 * Seed, DEMO_EMAIL / DEMO_PASSWORD hesabını kullanır (yoksa oluşturur).
 */
// Yanıtlar serbest JSON; alan kontrolleri çalışma anında yapılır.
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  startFeedServer,
  startMockTrendyol,
  type MockPackage,
  type MockProduct,
} from "./mock-trendyol.js";

export const DEMO = {
  trendyolPort: 3950,
  feedPort: 3951,
  seller: { sellerId: "987654", apiKey: "demo-key", apiSecret: "demo-secret" },
  api: process.env.DEMO_API_URL ?? "http://127.0.0.1:3000",
  email: process.env.DEMO_EMAIL ?? "test@trendy.local",
  password: process.env.DEMO_PASSWORD ?? "Trendy-Test-2026",
};

// ── Katalog ────────────────────────────────────────────────────────────────

interface FeedVariant {
  id: string;
  model: string;
  title: string;
  brand: string;
  category: string;
  barcode: string;
  size?: string;
  color: string;
  stock: number;
  cost: string;
  currency: "TRY" | "USD";
}

const MODELS: {
  model: string;
  title: string;
  brand: string;
  category: string;
  color: string;
  cost: number;
  currency?: "USD";
  sizes?: string[];
}[] = [
  {
    model: "MT-1001",
    title: "Basic Pamuklu Tişört",
    brand: "Moda Tekstil",
    category: "Giyim > Tişört",
    color: "Beyaz",
    cost: 149.9,
    sizes: ["S", "M", "L", "XL"],
  },
  {
    model: "MT-1002",
    title: "Oversize Baskılı Tişört",
    brand: "Moda Tekstil",
    category: "Giyim > Tişört",
    color: "Siyah",
    cost: 189.9,
    sizes: ["S", "M", "L"],
  },
  {
    model: "MT-2001",
    title: "Kapüşonlu Sweatshirt",
    brand: "Moda Tekstil",
    category: "Giyim > Sweatshirt",
    color: "Gri",
    cost: 349.9,
    sizes: ["M", "L", "XL"],
  },
  {
    model: "ED-3001",
    title: "Slim Fit Kot Pantolon",
    brand: "Ege Denim",
    category: "Giyim > Pantolon",
    color: "Lacivert",
    cost: 429.0,
    sizes: ["30", "32", "34", "36"],
  },
  {
    model: "ED-3002",
    title: "Mom Jean Yüksek Bel",
    brand: "Ege Denim",
    category: "Giyim > Pantolon",
    color: "Açık Mavi",
    cost: 459.0,
    sizes: ["26", "28", "30"],
  },
  {
    model: "KO-4001",
    title: "Su Geçirmez Outdoor Mont",
    brand: "Kuzey Outdoor",
    category: "Giyim > Mont",
    color: "Haki",
    cost: 42.5,
    currency: "USD",
    sizes: ["M", "L", "XL"],
  },
  {
    model: "KO-4002",
    title: "Polar Yelek",
    brand: "Kuzey Outdoor",
    category: "Giyim > Yelek",
    color: "Antrasit",
    cost: 18.9,
    currency: "USD",
    sizes: ["S", "M", "L"],
  },
  {
    model: "AH-5001",
    title: "Pamuk Saten Nevresim Takımı Çift Kişilik",
    brand: "Anadolu Home",
    category: "Ev > Nevresim",
    color: "Krem",
    cost: 689.0,
  },
  {
    model: "AH-5002",
    title: "Bambu Banyo Havlusu 70x140",
    brand: "Anadolu Home",
    category: "Ev > Havlu",
    color: "Beyaz",
    cost: 219.9,
  },
  {
    model: "AH-5003",
    title: "Seramik Kupa 4'lü Set",
    brand: "Anadolu Home",
    category: "Ev > Mutfak",
    color: "Mat Siyah",
    cost: 259.0,
  },
  {
    model: "AH-5004",
    title: "Keten Masa Örtüsü 150x220",
    brand: "Anadolu Home",
    category: "Ev > Mutfak",
    color: "Bej",
    cost: 309.0,
  },
  {
    model: "PA-6001",
    title: "Deri Kartlık",
    brand: "Pera Aksesuar",
    category: "Aksesuar > Cüzdan",
    color: "Taba",
    cost: 12.4,
    currency: "USD",
  },
  {
    model: "PA-6002",
    title: "Çelik Kordon Saat",
    brand: "Pera Aksesuar",
    category: "Aksesuar > Saat",
    color: "Gümüş",
    cost: 36.0,
    currency: "USD",
  },
  {
    model: "PA-6003",
    title: "Örme Bere",
    brand: "Pera Aksesuar",
    category: "Aksesuar > Şapka",
    color: "Bordo",
    cost: 99.9,
  },
];

function buildCatalog(): FeedVariant[] {
  const out: FeedVariant[] = [];
  let seq = 0;
  for (const m of MODELS) {
    for (const size of m.sizes ?? [undefined]) {
      seq++;
      out.push({
        id: String(1000 + seq),
        model: m.model,
        title: m.title,
        brand: m.brand,
        category: m.category,
        barcode: `8691234${String(seq).padStart(6, "0")}`,
        ...(size ? { size } : {}),
        color: m.color,
        // Tekrarlanabilir, çeşitli stoklar: bazıları tükenmiş
        stock: seq % 7 === 0 ? 0 : ((seq * 13) % 60) + 1,
        cost: (m.cost + (size === "XL" ? 10 : 0)).toFixed(2).replace(".", ","),
        currency: m.currency ?? "TRY",
      });
    }
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function feedXml(items: FeedVariant[]): string {
  const body = items
    .map(
      (v) =>
        `  <Urun><Kod>${v.id}</Kod><Model>${v.model}</Model><Ad>${esc(v.title)}</Ad>` +
        `<Marka>${esc(v.brand)}</Marka><Kategori>${esc(v.category)}</Kategori>` +
        `<Barkod>${v.barcode}</Barkod><Renk>${esc(v.color)}</Renk>` +
        (v.size ? `<Beden>${v.size}</Beden>` : "") +
        `<Stok>${v.stock}</Stok><Fiyat>${v.cost}</Fiyat><ParaBirimi>${v.currency}</ParaBirimi>` +
        `<KDV>20</KDV><Resim>https://picsum.photos/seed/${v.model}/1200/1800</Resim></Urun>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Urunler>\n${body}\n</Urunler>`;
}

/** Trendyol'daki durum: çoğu onaylı; birkaç kilitli, reddedilmiş, onay bekleyen ve feed dışı ürün. */
function buildTrendyolProducts(catalog: FeedVariant[]): MockProduct[] {
  const products: MockProduct[] = catalog.map((v, i) => {
    const base = Math.round(
      Number(v.cost.replace(",", ".")) * (v.currency === "USD" ? 41 : 1) * 1.6,
    );
    // Bazı ürünlerin Trendyol fiyatı hesaplanacak fiyattan çok uzak → Fiyat Onayları dolar
    const price = i % 9 === 4 ? Math.round(base * 0.55) : base;
    return {
      barcode: v.barcode,
      productMainId: v.model,
      title: v.size ? `${v.title} ${v.color} ${v.size}` : `${v.title} ${v.color}`,
      brand: v.brand,
      status: i % 17 === 5 ? "rejected" : i % 13 === 8 ? "pendingApproval" : "approved",
      salePrice: price,
      listPrice: Math.round(price * 1.2),
      quantity: (i * 7) % 25,
      ...(i % 11 === 3 ? { locked: true, lockReason: "Fiyat kontrolü" } : {}),
    };
  });
  // Trendyol'da olup feed'de olmayan ürünler: senkron bunlara dokunmaz
  products.push(
    {
      barcode: "8699999000011",
      productMainId: "ESKI-01",
      title: "Eski Sezon Gömlek",
      brand: "Moda Tekstil",
      status: "approved",
      salePrice: 399.9,
      listPrice: 499.9,
      quantity: 3,
    },
    {
      barcode: "8699999000028",
      productMainId: "ESKI-02",
      title: "Eski Sezon Etek",
      brand: "Moda Tekstil",
      status: "approved",
      salePrice: 349.9,
      listPrice: 349.9,
      quantity: 0,
    },
  );
  return products;
}

const FIRST = [
  "Ayşe",
  "Mehmet",
  "Zeynep",
  "Can",
  "Elif",
  "Burak",
  "Deniz",
  "Selin",
  "Emre",
  "Ece",
  "Mert",
  "Derya",
];
const LAST = [
  "Yılmaz",
  "Kaya",
  "Demir",
  "Şahin",
  "Çelik",
  "Aydın",
  "Öztürk",
  "Arslan",
  "Doğan",
  "Koç",
];
const CITIES = [
  "İstanbul",
  "Ankara",
  "İzmir",
  "Bursa",
  "Antalya",
  "Eskişehir",
  "Kocaeli",
  "Trabzon",
];
const STATUSES = [
  "Created",
  "Created",
  "Picking",
  "Invoiced",
  "Shipped",
  "Shipped",
  "Delivered",
  "Delivered",
  "Delivered",
  "Cancelled",
  "Returned",
  "UnDelivered",
];

function buildPackages(products: MockProduct[]): MockPackage[] {
  const now = Date.now();
  const hour = 3_600_000;
  const approved = products.filter((p) => p.status === "approved");
  const out: MockPackage[] = [];
  for (let i = 0; i < 28; i++) {
    const created = now - (i < 4 ? i * 2 * hour : i * 11 * hour);
    const lineCount = i % 5 === 0 ? 2 : 1;
    const lines = Array.from({ length: lineCount }, (_, j) => {
      const p = approved[(i * 3 + j * 5) % approved.length]!;
      const qty = (i + j) % 4 === 0 ? 2 : 1;
      return {
        lineId: 90000 + i * 10 + j,
        barcode: p.barcode,
        stockCode: p.productMainId,
        productName: p.title,
        quantity: qty,
        lineUnitPrice: p.salePrice,
        commission: 18,
        vatRate: 20,
      };
    });
    const first = FIRST[i % FIRST.length]!;
    const last = LAST[(i * 7) % LAST.length]!;
    out.push({
      shipmentPackageId: 7000100 + i,
      orderNumber: String(1080000400 + i * 17),
      status: i < 3 ? "Created" : STATUSES[i % STATUSES.length]!,
      lastModifiedDate: created + hour,
      orderDate: created,
      packageTotalPrice:
        Math.round(lines.reduce((s, l) => s + l.lineUnitPrice * l.quantity, 0) * 100) / 100,
      currencyCode: "TRY",
      customerFirstName: first,
      customerLastName: last,
      shipmentAddress: {
        fullName: `${first} ${last}`,
        city: CITIES[i % CITIES.length],
        district: "Merkez",
        fullAddress: "Demo Mah. Örnek Sok. No: 1",
      },
      lines,
    });
  }
  return out;
}

// ── Sunucular ──────────────────────────────────────────────────────────────

async function servers() {
  const catalog = buildCatalog();
  const products = buildTrendyolProducts(catalog);
  const mock = await startMockTrendyol({
    ...DEMO.seller,
    products,
    packages: buildPackages(products),
    port: DEMO.trendyolPort,
  });
  const feed = await startFeedServer(feedXml(catalog), DEMO.feedPort);
  console.log(`Sahte Trendyol: ${mock.url}`);
  console.log(`Sahte feed:     ${feed.url}  (${catalog.length} varyant)`);
  console.log("Açık kalıyor; durdurmak için Ctrl+C.");
}

// ── Seed ───────────────────────────────────────────────────────────────────

async function seed() {
  let cookie = "";
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(DEMO.api + path, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie?.startsWith("trendy_session=")) cookie = setCookie.split(";")[0]!;
    const text = await res.text();
    const json = text ? (JSON.parse(text) as any) : undefined;
    if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${text}`);
    return json;
  };
  const step = async (name: string, fn: () => Promise<unknown>) => {
    process.stdout.write(`• ${name} … `);
    await fn();
    console.log("tamam");
  };

  await step(`Giriş (${DEMO.email})`, async () => {
    try {
      await call("POST", "/auth/login", { email: DEMO.email, password: DEMO.password });
    } catch {
      await call("POST", "/auth/register", {
        email: DEMO.email,
        password: DEMO.password,
        tenantName: "Test Mağazası",
      });
    }
  });

  await step("Trendyol bilgileri (sahte) kaydedilir ve doğrulanır", async () => {
    await call("PUT", "/trendyol/credentials/prod", DEMO.seller);
    const r = await call("POST", "/trendyol/credentials/prod/verify");
    if (!r.verified) throw new Error(`doğrulanamadı: ${JSON.stringify(r)}`);
  });

  await step("Döviz kuru (USD 41)", () => call("PATCH", "/settings", { fxRates: { USD: 41 } }));

  const feedUrl = `http://127.0.0.1:${DEMO.feedPort}/feed.xml`;
  let supplierId = 0;
  await step("Tedarikçi eklenir", async () => {
    const existing = ((await call("GET", "/suppliers")) as any[]).find(
      (s) => s.feedUrl === feedUrl,
    );
    if (existing) {
      supplierId = existing.id;
      return;
    }
    const created = await call("POST", "/suppliers", {
      name: "Demo Tedarikçi A.Ş.",
      feedUrl,
      itemPath: "/Urunler/Urun",
      externalIdPath: "Kod",
    });
    supplierId = created.id;
  });

  await step("Alan eşleştirmesi kaydedilir", () =>
    call("PUT", `/suppliers/${supplierId}/mapping`, {
      version: 1,
      variantMode: "flat",
      missingPolicy: "zero_stock",
      fields: {
        productMainId: { path: "Model" },
        title: { path: "Ad" },
        brandName: { path: "Marka" },
        sourceCategory: { path: "Kategori" },
        barcode: { path: "Barkod" },
        stock: { path: "Stok" },
        costPrice: { path: "Fiyat" },
        currency: { path: "ParaBirimi" },
        vatRate: { path: "KDV" },
      },
      images: [{ path: "Resim" }],
      attributes: [
        { name: "Renk", mapping: { path: "Renk" } },
        { name: "Beden", mapping: { path: "Beden" } },
      ],
    }),
  );

  await step("Fiyat kuralları (genel ×1,6 ,90; Kuzey Outdoor ×1,8)", async () => {
    const rules = (await call("GET", "/pricing-rules")) as any[];
    if (rules.length) return;
    await call("POST", "/pricing-rules", {
      scope: "general",
      multiplier: 1.6,
      rounding: { kind: "ending", kurus: 90 },
    });
    await call("POST", "/pricing-rules", {
      scope: "brand",
      scopeKey: "Kuzey Outdoor",
      multiplier: 1.8,
      rounding: { kind: "ending", kurus: 99 },
    });
  });

  await step("Senkron ve sipariş çekimi tetiklenir", async () => {
    await call("POST", "/trendyol/sync").catch(() => {});
    await call("POST", "/orders/sync").catch(() => {});
  });

  console.log("\nHazır. İşler arka planda sürüyor; panel birkaç saniye içinde dolacak.");
}

const mode = process.argv[2];
if (mode === "servers") await servers();
else if (mode === "seed") await seed();
else {
  console.error("Kullanım: demo.ts servers | seed");
  process.exit(1);
}
