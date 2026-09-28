/**
 * Uçtan uca doğrulama: gerçek migration, API ve worker süreçleri; Trendyol ve tedarikçi feed'i
 * sahte sunuculardır. Kullanıcının panelde yapacağı akış API üzerinden baştan sona yürütülür.
 *
 *   DATABASE_URL=postgres://... REDIS_URL=redis://... pnpm e2e
 *
 * Geçici bir veritabanı oluşturur ve sonunda siler. Redis'te ayrı bir veritabanı numarası
 * (varsayılan 14) kullanır ve başta boşaltır.
 */
// Yanıtlar serbest JSON; alan kontrolleri çalışma anında yapılır.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Redis } from "ioredis";
import postgres from "postgres";
import { startFeedServer, startMockTrendyol, type MockPackage } from "./mock-trendyol.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** Süreçler kök dizinde çalışır; tsx bu paketin bağımlılığından çözülür. */
const TSX = import.meta.resolve("tsx");
const adminUrl = process.env.DATABASE_URL;
const redisBase = process.env.REDIS_URL;
if (!adminUrl || !redisBase) {
  console.error("DATABASE_URL ve REDIS_URL gerekli");
  process.exit(2);
}

// ── Küçük test çerçevesi ────────────────────────────────────────────────────

const results: { step: string; ok: boolean; detail?: string }[] = [];
let current = "";
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
async function step(name: string, fn: () => Promise<void>) {
  current = name;
  const started = Date.now();
  try {
    await fn();
    results.push({ step: name, ok: true });
    console.log(`  ✓ ${name} (${((Date.now() - started) / 1000).toFixed(1)} sn)`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ step: name, ok: false, detail });
    console.log(`  ✗ ${name}\n      ${detail}`);
  }
}
async function waitFor<T>(
  what: string,
  fn: () => Promise<T | undefined | null | false>,
  timeoutMs = 90_000,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  let last: unknown;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (err) {
      last = err;
    }
    if (Date.now() > until) {
      throw new Error(`zaman aşımı: ${what}${last ? ` (${String(last)})` : ""}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// ── Ortam ───────────────────────────────────────────────────────────────────

const SELLER = { sellerId: "987654", apiKey: "mock-key", apiSecret: "mock-secret" };
const now = Date.now();
const day = 86_400_000;

const feedXml = (items: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<Urunler>\n${items.join("\n")}\n</Urunler>`;
const item = (o: {
  id: string;
  model: string;
  barkod: string;
  stok: string;
  fiyat: string;
  pb?: string;
  marka: string;
  kategori?: string;
}) =>
  `<Urun><Kod>${o.id}</Kod><Model>${o.model}</Model><Ad>${o.model} Ürün</Ad><Marka>${o.marka}</Marka>` +
  `<Kategori>${o.kategori ?? "Giyim"}</Kategori><Barkod>${o.barkod}</Barkod><Stok>${o.stok}</Stok>` +
  `<Fiyat>${o.fiyat}</Fiyat><ParaBirimi>${o.pb ?? "TRY"}</ParaBirimi><KDV>20</KDV></Urun>`;

const FEED_ITEMS = [
  item({
    id: "1",
    model: "M1",
    barkod: "8690000000011",
    stok: "10",
    fiyat: "100,00",
    marka: "Acme",
  }),
  item({
    id: "2",
    model: "M1",
    barkod: "8690000000028",
    stok: "0",
    fiyat: "100,00",
    marka: "Acme",
  }),
  item({
    id: "3",
    model: "M2",
    barkod: "8690000000035",
    stok: "1.500",
    fiyat: "10.00",
    pb: "USD",
    marka: "Globex",
  }),
  item({ id: "4", model: "M3", barkod: "8690000000042", stok: "7", fiyat: "50", marka: "Globex" }),
  item({ id: "5", model: "M4", barkod: "8690000000059", stok: "3", fiyat: "80", marka: "Initech" }),
];

const packages: MockPackage[] = [
  {
    shipmentPackageId: 5001,
    orderNumber: "10001",
    status: "Created",
    lastModifiedDate: now - 2 * day,
    orderDate: now - 2 * day,
    packageTotalPrice: 200,
    currencyCode: "TRY",
    customerFirstName: "Ayşe",
    customerLastName: "Yılmaz",
    identityNumber: "11111111111",
    shipmentAddress: { fullName: "Ayşe Yılmaz", city: "İstanbul", fullAddress: "Test Mah. 1" },
    lines: [
      {
        lineId: 1,
        barcode: "8690000000011",
        quantity: 1,
        lineUnitPrice: 200,
        productName: "M1 Ürün",
      },
    ],
  },
  {
    shipmentPackageId: 5002,
    orderNumber: "10002",
    status: "Delivered",
    lastModifiedDate: now - 5 * day,
    orderDate: now - 6 * day,
    packageTotalPrice: 600.9,
    currencyCode: "TRY",
    customerFirstName: "Mehmet",
    customerLastName: "Demir",
    lines: [{ lineId: 2, barcode: "8690000000035", quantity: 1, lineUnitPrice: 600.9 }],
  },
];

const procs: ChildProcess[] = [];
const logs: Record<string, string[]> = { api: [], worker: [], migrate: [] };
function start(name: "api" | "worker" | "migrate", script: string, env: NodeJS.ProcessEnv) {
  const p = spawn(process.execPath, ["--import", TSX, script], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const push = (b: Buffer) => logs[name]!.push(...b.toString().split("\n").filter(Boolean));
  p.stdout!.on("data", push);
  p.stderr!.on("data", push);
  if (name !== "migrate") procs.push(p);
  return p;
}

async function main() {
  const dbName = `trendy_e2e_${randomBytes(4).toString("hex")}`;
  const admin = postgres(adminUrl!, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  const dbUrl = new URL(adminUrl!);
  dbUrl.pathname = `/${dbName}`;
  const redisUrl = new URL(redisBase!);
  redisUrl.pathname = `/${process.env.E2E_REDIS_DB ?? "14"}`;
  const redis = new Redis(redisUrl.toString());
  await redis.flushdb();

  const mock = await startMockTrendyol({
    ...SELLER,
    packages,
    products: [
      // Feed'de de var: yönetilecek
      {
        barcode: "8690000000011",
        productMainId: "M1",
        title: "M1",
        brand: "Acme",
        status: "approved",
        salePrice: 190,
        listPrice: 190,
        quantity: 4,
      },
      {
        barcode: "8690000000028",
        productMainId: "M1",
        title: "M1",
        brand: "Acme",
        status: "approved",
        salePrice: 100,
        listPrice: 100,
        quantity: 2,
      },
      {
        barcode: "8690000000035",
        productMainId: "M2",
        title: "M2",
        brand: "Globex",
        status: "approved",
        salePrice: 590,
        listPrice: 590,
        quantity: 0,
      },
      {
        barcode: "8690000000042",
        productMainId: "M3",
        title: "M3",
        brand: "Globex",
        status: "approved",
        salePrice: 60,
        listPrice: 60,
        quantity: 1,
        locked: true,
        lockReason: "Fiyat kontrolü",
      },
      // Feed'de yok: dokunulmamalı
      {
        barcode: "8690000000066",
        productMainId: "M9",
        title: "M9",
        brand: "Other",
        status: "approved",
        salePrice: 99,
        listPrice: 99,
        quantity: 9,
      },
      {
        barcode: "8690000000073",
        productMainId: "M8",
        title: "M8",
        brand: "Other",
        status: "rejected",
        salePrice: 10,
        listPrice: 10,
        quantity: 1,
      },
    ],
  });
  const feed = await startFeedServer(feedXml(FEED_ITEMS));
  const port = 3900 + Math.floor(Math.random() * 90);
  const env = {
    NODE_ENV: "development",
    LOG_LEVEL: "info",
    DATABASE_URL: dbUrl.toString(),
    REDIS_URL: redisUrl.toString(),
    SECRETS_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    TRENDYOL_INTEGRATOR_NAME: "SelfIntegration",
    API_HOST: "127.0.0.1",
    API_PORT: String(port),
    TRENDYOL_BASE_URL: mock.url,
    FEED_ALLOW_PRIVATE_NETWORK: "true",
  };
  const base = `http://127.0.0.1:${port}`;

  let cookie = "";
  const http = async (method: string, path: string, body?: unknown, extra: object = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...extra,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie?.startsWith("trendy_session=")) cookie = setCookie.split(";")[0]!;
    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }
    return { status: res.status, json };
  };
  const get = async (path: string) => {
    const r = await http("GET", path);
    check(r.status === 200, `GET ${path} → ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  };
  const jobs = async () => (await get("/jobs?limit=200")) as any[];
  const jobsOf = async (type: string) => (await jobs()).filter((j) => j.jobType === type);
  const waitJob = async (type: string, after: number, statuses = ["success"]) =>
    waitFor(`${type} işi`, async () => {
      const js = (await jobsOf(type)).filter((j) => j.id > after && j.status !== "running");
      if (js.length === 0) return undefined;
      const j = js[0];
      check(statuses.includes(j.status), `${type}: ${j.status} ${j.error ?? ""}`);
      return j;
    });
  const lastJobId = async (type: string) => (await jobsOf(type))[0]?.id ?? 0;
  const listing = async (barcode: string) =>
    ((await get(`/trendyol/listings?search=${barcode}`)).items as any[])[0];

  let supplierId = 0;

  try {
    await step("Migration'lar uygulanır (boş veritabanı)", async () => {
      const m = start("migrate", "packages/db/src/migrate-cli.ts", env);
      const code = await new Promise<number>((r) => m.on("exit", (c) => r(c ?? 1)));
      check(code === 0, `migrate çıkış kodu ${code}: ${logs.migrate!.slice(-5).join(" | ")}`);
    });

    await step("API ve worker başlar; /health/ready hazır", async () => {
      start("api", "apps/api/src/server.ts", env);
      start("worker", "apps/worker/src/main.ts", env);
      const ready = await waitFor("hazırlık", async () => {
        const r = await http("GET", "/health/ready");
        return r.status === 200 ? r.json : undefined;
      });
      check(ready.checks.db.ok && ready.checks.redis.ok && ready.checks.worker.ok, "hazır değil");
    });

    await step("Kayıt, çıkış, giriş, oturum", async () => {
      const reg = await http("POST", "/auth/register", {
        email: "sahip@ornek.com",
        password: "guclu-sifre-123",
        tenantName: "E2E Mağaza",
      });
      check(reg.status === 201, `kayıt ${reg.status}`);
      check((await get("/auth/me")).email === "sahip@ornek.com", "me");
      check((await http("POST", "/auth/logout")).status === 204, "çıkış");
      cookie = "";
      check((await http("GET", "/auth/me")).status === 401, "çıkış sonrası 401 bekleniyordu");
      const bad = await http("POST", "/auth/login", {
        email: "sahip@ornek.com",
        password: "yanlis-sifre-1",
      });
      check(bad.status === 401, `yanlış şifre ${bad.status}`);
      const login = await http("POST", "/auth/login", {
        email: "sahip@ornek.com",
        password: "guclu-sifre-123",
      });
      check(login.status === 200 && cookie, `giriş ${login.status}`);
      check((await get("/auth/me")).role === "owner", "rol owner olmalı");
    });

    await step("Trendyol bilgileri: yanlış anahtar reddedilir, doğrusu doğrulanır", async () => {
      await http("PUT", "/trendyol/credentials/prod", { ...SELLER, apiSecret: "yanlis" });
      const bad = await http("POST", "/trendyol/credentials/prod/verify");
      check(
        bad.json.verified === false && bad.json.reason === "invalid_credentials",
        "401 beklenirdi",
      );
      const put = await http("PUT", "/trendyol/credentials/prod", SELLER);
      check(put.status === 204, `kayıt ${put.status}`);
      const ok = await http("POST", "/trendyol/credentials/prod/verify");
      check(ok.json.verified === true, `doğrulama: ${JSON.stringify(ok.json)}`);
      const creds = await get("/trendyol/credentials");
      check(
        creds[0].verifiedAt && !JSON.stringify(creds).includes("mock-secret"),
        "özet sır içermemeli",
      );
    });

    await step("Trendyol içe aktarma: onaylı, kilitli, reddedilen ürünler", async () => {
      await waitJob("ty_import", 0);
      const status = await get("/trendyol/status");
      check(status.listings.approved === 4, `approved=${JSON.stringify(status.listings)}`);
      check(status.listings.locked === 1 && status.listings.rejected === 1, "locked/rejected");
      const locked = await listing("8690000000042");
      check(locked.tyStatus === "locked" && locked.lockReason === "Fiyat kontrolü", "kilit nedeni");
    });

    await step("Tedarikçi: feed analizi, ekleme, eşleştirme önizlemesi", async () => {
      const detect = await http("POST", "/suppliers/detect", { feedUrl: feed.url });
      check(detect.status === 200, `detect ${detect.status} ${JSON.stringify(detect.json)}`);
      check(detect.json.itemPath === "/Urunler/Urun", `itemPath ${detect.json.itemPath}`);
      check(detect.json.sampleCount === 5, `örnek ${detect.json.sampleCount}`);
      const created = await http("POST", "/suppliers", {
        name: "Test Tedarikçi",
        feedUrl: feed.url,
        itemPath: "/Urunler/Urun",
        externalIdPath: "Kod",
      });
      check(created.status === 201, `oluşturma ${created.status} ${JSON.stringify(created.json)}`);
      supplierId = created.json.id;
      await waitFor("ilk çekim", async () => {
        const s = await get(`/suppliers/${supplierId}`);
        return s.lastItemCount === 5;
      });
    });

    const mapping = {
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
    };

    await step("Eşleştirme önizlemesi ve kaydı; normalizasyon", async () => {
      const prev = await http("POST", `/suppliers/${supplierId}/mapping/preview`, { mapping });
      check(prev.status === 200, `önizleme ${prev.status} ${JSON.stringify(prev.json)}`);
      check(
        prev.json.valid === 5,
        `geçerli ${prev.json.valid}: ${JSON.stringify(prev.json.items[0])}`,
      );
      const usd = prev.json.items.find((i: any) => i.externalId === "3").product.variants[0];
      check(
        usd.stock === 1500 && usd.costPrice === 1000 && usd.currency === "USD",
        `USD ${JSON.stringify(usd)}`,
      );
      const before = await lastJobId("xml_fetch");
      const saved = await http("PUT", `/suppliers/${supplierId}/mapping`, mapping);
      check(saved.status === 200, `kayıt ${saved.status}`);
      await waitJob("xml_fetch", before);
      const report = await waitFor("rapor", async () => {
        const r = await get(`/suppliers/${supplierId}/report`);
        return r.variants === 5 ? r : undefined;
      });
      check(report.withErrors === 0, `hatalı: ${JSON.stringify(report.issues)}`);
    });

    await step(
      "Stok senkronu: yalnızca stok (kural yok), kilitli/listelenmemiş atlanır",
      async () => {
        await waitFor("stok gönderimi", async () => {
          const all = mock.calls.flatMap((c) => c.items);
          return all.some((i) => i.barcode === "8690000000035");
        });
        const sent = new Map(mock.calls.flatMap((c) => c.items).map((i) => [i.barcode, i]));
        check(sent.get("8690000000011")?.quantity === 10, "B1 stok 10");
        check(sent.get("8690000000028")?.quantity === 0, "B2 stok 0");
        check(sent.get("8690000000035")?.quantity === 1500, "B3 stok 1500");
        check(!sent.has("8690000000042"), "kilitli ürün gönderilmemeli");
        check(!sent.has("8690000000066"), "feed dışı ürüne dokunulmamalı");
        check(!sent.has("8690000000059"), "Trendyol'da olmayan ürün gönderilmemeli");
        check(
          [...sent.values()].every((i) => i.salePrice === undefined),
          "kural yokken fiyat gönderilmemeli",
        );
      },
    );

    await step("Batch sonucu işlenir (worker poll)", async () => {
      await waitFor(
        "batch tamamlandı",
        async () => {
          const s = await get("/trendyol/status");
          return s.pendingBatches === 0;
        },
        150_000,
      );
      const l = await listing("8690000000011");
      check(l.lastSentStock === 10 && !l.lastError, `B1: ${JSON.stringify(l)}`);
    });

    await step("Fiyat kuralları + kur: fiyat hesaplanır, büyük değişim onaya düşer", async () => {
      // Kurallar tek tek eklenirken araya giren bir senkron B1'i yalnızca genel kuralla
      // fiyatlayabilir (yarış). Kurallar eklenirken senkron durdurulur, sonra tek seferde çalışır.
      check((await http("PATCH", "/settings", { syncPaused: true })).status === 200, "durdurma");
      const bad = await http("PATCH", "/settings", { fxRates: { USD: 40 } });
      check(bad.status === 200, `kur ${bad.status}`);
      const g = await http("POST", "/pricing-rules", {
        scope: "general",
        multiplier: 1.5,
        rounding: { kind: "ending", kurus: 90 },
      });
      check(g.status === 201, `genel kural ${g.status} ${JSON.stringify(g.json)}`);
      const b = await http("POST", "/pricing-rules", {
        scope: "brand",
        scopeKey: "Acme",
        multiplier: 2,
      });
      check(b.status === 201, `marka kuralı ${b.status}`);
      check((await http("PATCH", "/settings", { syncPaused: false })).status === 200, "devam");
      await http("POST", "/trendyol/sync");
      await waitFor("fiyat gönderimi", async () =>
        mock.calls.some((c) => c.items.some((i) => i.barcode === "8690000000035" && i.salePrice)),
      );
      const priced = new Map(
        mock.calls
          .flatMap((c) => c.items)
          .filter((i) => i.salePrice)
          .map((i) => [i.barcode, i]),
      );
      check(
        priced.get("8690000000011")?.salePrice === 200,
        `B1 200 TL: ${JSON.stringify(priced.get("8690000000011"))}`,
      );
      check(
        priced.get("8690000000035")?.salePrice === 600.9,
        `B3 600,90: ${JSON.stringify(priced.get("8690000000035"))}`,
      );
      check(!priced.has("8690000000028"), "B2 (%100 artış) onaya düşmeli, gönderilmemeli");
      const reviews = await get("/trendyol/price-reviews");
      check(
        reviews.length === 1 && reviews[0].barcode === "8690000000028",
        `inceleme ${JSON.stringify(reviews)}`,
      );
      check(reviews[0].newPrice === 20000, "inceleme fiyatı");
    });

    await step("Fiyat onayı → senkron onaylanan fiyatı gönderir", async () => {
      const [r] = await get("/trendyol/price-reviews");
      check((await http("POST", `/trendyol/price-reviews/${r.id}/approve`)).status === 204, "onay");
      await waitFor("onaylı fiyat gönderimi", async () =>
        mock.calls.some((c) =>
          c.items.some((i) => i.barcode === "8690000000028" && i.salePrice === 200),
        ),
      );
    });

    await step("Başarısız batch öğesi hataya düşer ve uyarı üretir", async () => {
      mock.failNext.set("8690000000011", "Stok güncellenemedi (test)");
      feed.set(
        feedXml([
          FEED_ITEMS[0]!.replace("<Stok>10</Stok>", "<Stok>12</Stok>"),
          ...FEED_ITEMS.slice(1),
        ]),
      );
      await http("POST", `/suppliers/${supplierId}/fetch`);
      await waitFor("hata kaydı", async () => (await listing("8690000000011")).lastError, 150_000);
      const errs = await get("/trendyol/listings?hasError=true");
      check(errs.total === 1, `hatalı ${errs.total}`);
      const alerts = (await get("/alerts")) as any[];
      check(
        alerts.some((a) => a.code === "listing_errors"),
        `uyarılar: ${alerts.map((a) => a.code)}`,
      );
    });

    await step("Feed değişmediyse (ETag/304) yeniden işlenmez", async () => {
      const before = feed.stats().notModified;
      const id = await lastJobId("xml_fetch");
      await http("POST", `/suppliers/${supplierId}/fetch`);
      await waitJob("xml_fetch", id, ["success", "skipped"]);
      check(feed.stats().notModified > before, "304 bekleniyordu");
    });

    await step("Güvenlik freni: feed aniden küçülürse ürünler kaybolmuş sayılmaz", async () => {
      feed.set(feedXml([FEED_ITEMS[0]!]));
      const id = await lastJobId("xml_fetch");
      await http("POST", `/suppliers/${supplierId}/fetch`);
      const job = await waitJob("xml_fetch", id, ["success", "skipped", "failed"]);
      check(job.summary?.shrinkBlocked, `fren devreye girmeli: ${JSON.stringify(job.summary)}`);
      const products = await get(`/suppliers/${supplierId}/products?limit=50`);
      check(products.missing === 0, `kaybolan ${products.missing}`);
      const alerts = (await get("/alerts")) as any[];
      check(
        alerts.some((a) => a.code === "supplier_shrink_blocked"),
        "fren uyarısı",
      );
      feed.set(feedXml(FEED_ITEMS));
    });

    await step("Siparişler: çekilir, T.C. kimlik no saklanmaz, adres yalnızca sahibe", async () => {
      await http("POST", "/orders/sync");
      const list = await waitFor("siparişler", async () => {
        const o = await get("/orders");
        return o.total === 2 ? o : undefined;
      });
      const o = list.items.find((x: any) => x.orderNumber === "10001");
      check(
        o.status === "Created" && o.packageTotalPrice === 20000,
        `sipariş ${JSON.stringify(o)}`,
      );
      const detail = await get(`/orders/${o.id}`);
      const text = JSON.stringify(detail);
      check(!text.includes("11111111111"), "T.C. kimlik no saklanmamalı");
      check(text.includes("İstanbul"), "sahip adresi görmeli");
    });

    await step(
      "Sipariş webhook'u: anahtar kontrolü, yeni durum işlenir, eski veri ezmez",
      async () => {
        const hook = await http("POST", "/settings/webhook");
        check(hook.status === 201, `webhook ${hook.status}`);
        const path = new URL(hook.json.url, base).pathname;
        const pkg = { ...packages[0], status: "Shipped", lastModifiedDate: Date.now() };
        const saved = cookie;
        cookie = "";
        const wrong = await http("POST", path, pkg, { "x-api-key": "yanlis" });
        check(wrong.status === 401, `yanlış anahtar ${wrong.status}`);
        const ok = await http("POST", path, pkg, { "x-api-key": hook.json.apiKey });
        check(ok.status < 300, `webhook ${ok.status} ${JSON.stringify(ok.json)}`);
        const stale = { ...packages[0], status: "Picking", lastModifiedDate: now - 3 * day };
        await http("POST", path, stale, { "x-api-key": hook.json.apiKey });
        cookie = saved;
        const o = (await get("/orders?search=10001")).items[0];
        check(o.status === "Shipped", `durum ${o.status}`);
      },
    );

    await step("Acil durdurma: senkron atlanır, Trendyol'a gönderim olmaz", async () => {
      check((await http("PATCH", "/settings", { syncPaused: true })).status === 200, "durdurma");
      const calls = mock.calls.length;
      const id = await lastJobId("ty_sync");
      await http("POST", "/trendyol/sync");
      const job = await waitJob("ty_sync", id, ["skipped"]);
      check(job.summary?.reason === "sync_paused", "neden sync_paused");
      check(mock.calls.length === calls, "gönderim olmamalı");
      const alerts = (await get("/alerts")) as any[];
      check(
        alerts.some((a) => a.code === "sync_paused"),
        "durdurma uyarısı",
      );
      await http("PATCH", "/settings", { syncPaused: false });
    });

    await step("Tenant izolasyonu: ikinci mağaza hiçbir veriyi göremez", async () => {
      const saved = cookie;
      cookie = "";
      await http("POST", "/auth/register", {
        email: "baska@ornek.com",
        password: "guclu-sifre-456",
        tenantName: "Başka",
      });
      check((await get("/suppliers")).length === 0, "tedarikçi görünmemeli");
      check((await get("/orders")).total === 0, "sipariş görünmemeli");
      check((await get("/pricing-rules")).length === 0, "kural görünmemeli");
      check((await http("GET", `/suppliers/${supplierId}`)).status === 404, "tedarikçi 404");
      cookie = saved;
    });

    await step("Loglarda sır yok", async () => {
      const all = [...logs.api!, ...logs.worker!].join("\n");
      for (const secret of ["mock-secret", env.SECRETS_ENCRYPTION_KEY, "11111111111"]) {
        check(!all.includes(secret), `logda sır bulundu: ${secret.slice(0, 4)}…`);
      }
      const errors = [...logs.api!, ...logs.worker!].filter((l) => /"level":(50|60)/.test(l));
      // Test gereği oluşturulan hatalar dışında beklenmeyen hata logu olmamalı.
      const unexpected = errors.filter((l) => !/güvenlik freni|401|Stok güncellenemedi/.test(l));
      check(
        unexpected.length === 0,
        `beklenmeyen hata logu:\n${unexpected.slice(0, 3).join("\n")}`,
      );
    });

    await step("Kontrollü kapanış (SIGTERM)", async () => {
      const exits = procs.map(
        (p) => new Promise<number | null>((r) => p.on("exit", (code) => r(code))),
      );
      procs.forEach((p) => p.kill("SIGTERM"));
      const codes = await Promise.race([
        Promise.all(exits),
        new Promise<null>((r) => setTimeout(() => r(null), 60_000)),
      ]);
      check(codes && codes.every((c) => c === 0), `çıkış kodları ${JSON.stringify(codes)}`);
    });
  } finally {
    procs.forEach((p) => p.exitCode === null && p.kill("SIGKILL"));
    await mock.close();
    await feed.close();
    await redis.flushdb();
    redis.disconnect();
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} adım başarılı`);
  if (failed.length) {
    if (process.env.E2E_VERBOSE) {
      for (const n of ["api", "worker"] as const) {
        console.log(`\n── ${n} logu (son 40) ──\n${logs[n]!.slice(-40).join("\n")}`);
      }
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`beklenmeyen hata (${current}):`, err);
  procs.forEach((p) => p.kill("SIGKILL"));
  process.exit(1);
});
