import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import {
  createSupplier,
  listJobLogs,
  markTrendyolCredentialsVerified,
  saveTrendyolCredentials,
  schema,
  withTenant,
  type Db,
} from "@trendy/db";
import { createTestDatabase } from "@trendy/db/testing";
import { createLogger, createSecretBox } from "@trendy/shared";
import { InMemoryRateLimiter } from "@trendy/trendyol-client";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { JobQueue, TrendyolPayload } from "@trendy/jobs";
import { scheduleTrendyolJobs } from "./trendyol-scheduler.js";
import {
  runBatchPoll,
  runTrendyolImport,
  runTrendyolSync,
  type TrendyolDeps,
} from "./trendyol-jobs.js";

const url = process.env.DATABASE_URL;
const SELLER = "555";

/** Sahte Trendyol: resmi yollar, sayfa 0 dolu, sonrası boş. */
interface TyState {
  inventory: { barcode: string; quantity: number; salePrice: number; listPrice: number }[];
  approved: { barcode: string; locked?: boolean; archived?: boolean; blacklisted?: boolean }[];
  rejected: { barcode: string; reason: string }[];
  batchResults: Map<string, unknown>;
  sent: { items: Record<string, unknown>[] }[];
  requests: string[];
}
let ty: TyState;
/** Batch kimlikleri testler boyunca benzersiz (gerçek Trendyol gibi). */
let batchSeq = 0;
let server: http.Server;
let baseUrl: string;

function handle(req: http.IncomingMessage, body: string) {
  const u = new URL(req.url!, "http://x");
  const p = u.pathname;
  const page = Number(u.searchParams.get("page") ?? 0);
  const prod = `/integration/product/sellers/${SELLER}`;
  if (p === `${prod}/products/approved/inventory-and-price`) {
    return {
      totalPages: 1,
      content:
        page === 0
          ? [
              {
                contentId: 1,
                productMainId: "TY-M",
                variants: ty.inventory.map((v) => ({ ...v, stockCode: null })),
              },
            ]
          : [],
    };
  }
  if (p === `${prod}/products/approved`) {
    return {
      totalPages: 1,
      content:
        page === 0
          ? [
              {
                contentId: 1,
                productMainId: "TY-M",
                title: "Trendyol ürünü",
                variants: ty.approved.map((v) => ({
                  onSale: true,
                  lockReason: v.locked ? "Fiyat" : null,
                  ...v,
                })),
              },
            ]
          : [],
    };
  }
  if (p === `${prod}/products/unapproved`) {
    const status = u.searchParams.get("status");
    const items =
      status === "rejected"
        ? ty.rejected.map((r) => ({
            barcode: r.barcode,
            productMainId: "REJ",
            rejectReasonDetails: [{ rejectReason: "Görsel", rejectReasonDetail: r.reason }],
          }))
        : [];
    return { totalPages: 1, content: page === 0 ? items : [] };
  }
  if (p === `/integration/inventory/sellers/${SELLER}/products/price-and-inventory`) {
    const parsed = JSON.parse(body) as { items: Record<string, unknown>[] };
    ty.sent.push(parsed);
    return { batchRequestId: `batch-${++batchSeq}` };
  }
  const m = p.match(new RegExp(`^${prod}/products/batch-requests/(.+)$`));
  if (m)
    return ty.batchResults.get(decodeURIComponent(m[1]!)) ?? { batchRequestId: m[1], items: [] };
  return undefined;
}

describe.skipIf(!url)("Trendyol içe aktarma, senkron ve batch takibi", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let tenantId: number;
  let deps: TrendyolDeps;
  let clock = new Date();
  const box = createSecretBox({ 1: randomBytes(32).toString("base64") }, 1);

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        ty.requests.push(`${req.method} ${req.url}`);
        const out = handle(req, body);
        res.writeHead(out === undefined ? 404 : 200, { "content-type": "application/json" });
        res.end(JSON.stringify(out ?? {}));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const t = await createTestDatabase(url!);
    db = t.db;
    drop = t.drop;
    const [tenant] = await db
      .insert(schema.tenants)
      .values({ name: "A" })
      .returning({ id: schema.tenants.id });
    tenantId = tenant!.id;
    await withTenant(db, tenantId, (tx) =>
      saveTrendyolCredentials(tx, box, {
        tenantId,
        env: "prod",
        sellerId: SELLER,
        apiKey: "K",
        apiSecret: "S",
      }),
    );
    deps = {
      db,
      secretBox: box,
      limiter: new InMemoryRateLimiter(),
      logger: createLogger({ level: "silent" }),
      integratorName: "SelfIntegration",
      clientOptions: { baseUrl, sleep: async () => {}, random: () => 0 },
      now: () => clock,
    };
  });
  afterAll(async () => {
    server?.close();
    await drop?.();
  });
  beforeEach(() => {
    ty = {
      inventory: [],
      approved: [],
      rejected: [],
      batchResults: new Map(),
      sent: [],
      requests: [],
    };
    clock = new Date();
  });

  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, tenantId, fn);
  const listing = async (barcode: string) =>
    (
      await run((t) =>
        t
          .select({ l: schema.channelListings, managed: schema.variants.managed })
          .from(schema.channelListings)
          .innerJoin(schema.variants, eq(schema.variants.id, schema.channelListings.variantId))
          .where(eq(schema.variants.barcode, barcode)),
      )
    )[0];
  const lastJob = async (jobType: string) =>
    (await run((t) => listJobLogs(t, { limit: 20 }))).find((j) => j.jobType === jobType)!;

  /** Feed'den gelmiş (yönetilen) varyant: tedarikçi + ham ürün + ürün + varyant. */
  async function managedVariant(barcode: string, stock: number, costPrice: number | null = null) {
    return run(async (t) => {
      const s = await createSupplier(t, box, tenantId, {
        name: "T",
        feedUrl: "https://x.example.com/f.xml",
      });
      const [sp] = await t
        .insert(schema.supplierProducts)
        .values({ tenantId, supplierId: s, externalId: barcode, raw: {}, hash: "h" })
        .returning();
      const [p] = await t
        .insert(schema.products)
        .values({ tenantId, supplierId: s, productMainId: `P-${barcode}`, title: "Ürün" })
        .onConflictDoNothing()
        .returning();
      const productId =
        p?.id ??
        (
          await t
            .select()
            .from(schema.products)
            .where(eq(schema.products.productMainId, `P-${barcode}`))
        )[0]!.id;
      await t
        .insert(schema.variants)
        .values({
          tenantId,
          productId,
          supplierProductId: sp!.id,
          barcode,
          stock,
          costPrice,
          managed: true,
        })
        .onConflictDoUpdate({
          target: [schema.variants.tenantId, schema.variants.barcode],
          set: { supplierProductId: sp!.id, stock, costPrice, managed: true, productId },
        });
      return s;
    });
  }

  it("API bilgileri doğrulanmamışsa Trendyol'a hiç istek atılmaz", async () => {
    const r = await runTrendyolImport(deps, tenantId);
    expect(r.approved).toBe(0);
    expect(ty.requests).toEqual([]);
    expect(await lastJob("ty_import")).toMatchObject({
      status: "skipped",
      summary: { reason: "not_verified" },
    });
    await runTrendyolSync(deps, tenantId);
    expect(ty.requests).toEqual([]);
  });

  describe("doğrulanmış hesap", () => {
    beforeAll(async () => {
      await run((t) => markTrendyolCredentialsVerified(t, tenantId, "prod"));
    });

    it("içe aktarma: durumlar, stok/fiyat tabanı, red sebepleri; yalnızca GET istekleri", async () => {
      await managedVariant("SYNC-1", 7);
      ty.inventory = [
        { barcode: "SYNC-1", quantity: 10, salePrice: 150, listPrice: 180 },
        { barcode: "TY-ONLY", quantity: 3, salePrice: 50, listPrice: 50 },
        { barcode: "LOCKED-1", quantity: 4, salePrice: 20, listPrice: 20 },
      ];
      ty.approved = [
        { barcode: "SYNC-1" },
        { barcode: "TY-ONLY" },
        { barcode: "LOCKED-1", locked: true },
      ];
      ty.rejected = [{ barcode: "REJ-1", reason: "Görsel yetersiz" }];

      const r = await runTrendyolImport(deps, tenantId);
      expect(r).toMatchObject({ approved: 3, unapproved: 1, created: 3 });
      expect(ty.requests.every((q) => q.startsWith("GET "))).toBe(true);

      expect(await listing("SYNC-1")).toMatchObject({
        managed: true,
        l: {
          tyStatus: "approved",
          tyStock: 10,
          tyPrice: 15000,
          lastSentStock: 10,
          lastSentPrice: 15000,
          lastSentListPrice: 18000,
        },
      });
      expect(await listing("TY-ONLY")).toMatchObject({
        managed: false,
        l: { tyStatus: "approved" },
      });
      expect(await listing("LOCKED-1")).toMatchObject({
        l: { tyStatus: "locked", lockReason: "Fiyat" },
      });
      expect(await listing("REJ-1")).toMatchObject({
        l: { tyStatus: "rejected", rejectReasons: [{ rejectReasonDetail: "Görsel yetersiz" }] },
      });
      expect(await lastJob("ty_import")).toMatchObject({ status: "success" });
    });

    it("senkron: yalnızca yönetilen + onaylı + değişen gönderilir; ikinci turda istek yok", async () => {
      const r = await runTrendyolSync(deps, tenantId);
      expect(r).toMatchObject({ sent: 1, batches: 1 });
      // Fiyat kuralı yok: yalnızca stok. TY-ONLY (yönetilmeyen) ve LOCKED-1 gönderilmez.
      expect(ty.sent).toEqual([{ items: [{ barcode: "SYNC-1", quantity: 7 }] }]);
      expect(await listing("SYNC-1")).toMatchObject({
        l: { lastSentStock: 7, lastBatchRequestId: "batch-1" },
      });
      const [batch] = await run((t) => t.select().from(schema.tyBatches));
      expect(batch).toMatchObject({
        batchRequestId: "batch-1",
        itemCount: 1,
        status: "pending",
        type: "price_inventory",
      });

      ty.sent = [];
      const again = await runTrendyolSync(deps, tenantId);
      expect(again.sent).toBe(0);
      expect(ty.sent).toHaveLength(0);
    });

    it("batch tamamlanmadıysa bekler; başarısız öğe sıfırlanır ve bir sonraki turda yeniden gönderilir", async () => {
      ty.batchResults.set("batch-1", {
        batchRequestId: "batch-1",
        itemCount: 1,
        items: [{ requestItem: { barcode: "SYNC-1", quantity: 7 }, status: "IN_PROGRESS" }],
      });
      expect(await runBatchPoll(deps)).toMatchObject({ checked: 1, completed: 0 });

      ty.batchResults.set("batch-1", {
        batchRequestId: "batch-1",
        itemCount: 1,
        failedItemCount: 1,
        batchRequestType: "ProductInventoryUpdate",
        items: [
          {
            requestItem: { barcode: "SYNC-1", quantity: 7 },
            status: "FAILED",
            failureReasons: ["Geçici hata"],
          },
        ],
      });
      expect(await runBatchPoll(deps)).toMatchObject({ completed: 1 });
      expect(await listing("SYNC-1")).toMatchObject({
        l: { lastSentStock: null, lastError: "Geçici hata" },
      });
      const [batch] = await run((t) =>
        t.select().from(schema.tyBatches).where(eq(schema.tyBatches.batchRequestId, "batch-1")),
      );
      expect(batch!.status).toBe("failed");

      // Bir sonraki tur yeniden gönderir; başarı hatayı temizler.
      await runTrendyolSync(deps, tenantId);
      expect(ty.sent).toEqual([{ items: [{ barcode: "SYNC-1", quantity: 7 }] }]);
      ty.batchResults.set("batch-2", {
        batchRequestId: "batch-2",
        itemCount: 1,
        items: [{ requestItem: { barcode: "SYNC-1" }, status: "SUCCESS", failureReasons: [] }],
      });
      await runBatchPoll(deps);
      expect(await listing("SYNC-1")).toMatchObject({ l: { lastSentStock: 7, lastError: null } });
    });

    it("4 saatte sonucu alınamayan batch süresi dolmuş sayılır ve değerler yeniden gönderilir", async () => {
      await run((t) =>
        t.update(schema.variants).set({ stock: 2 }).where(eq(schema.variants.barcode, "SYNC-1")),
      );
      await runTrendyolSync(deps, tenantId);
      expect(ty.sent[0]!.items).toEqual([{ barcode: "SYNC-1", quantity: 2 }]);
      clock = new Date(Date.now() + 4 * 3_600_000 + 60_000);
      expect(await runBatchPoll(deps)).toMatchObject({ expired: 1 });
      expect(await listing("SYNC-1")).toMatchObject({ l: { lastSentStock: null } });
    });

    it("feed'den kaybolan ürün 0 gönderilir", async () => {
      await run((t) =>
        t.update(schema.variants).set({ stock: 5 }).where(eq(schema.variants.barcode, "SYNC-1")),
      );
      await runTrendyolSync(deps, tenantId);
      const v = (
        await run((t) =>
          t.select().from(schema.variants).where(eq(schema.variants.barcode, "SYNC-1")),
        )
      )[0]!;
      await run((t) =>
        t
          .update(schema.supplierProducts)
          .set({ missingSince: new Date() })
          .where(eq(schema.supplierProducts.id, v.supplierProductId!)),
      );
      ty.sent = [];
      await runTrendyolSync(deps, tenantId);
      expect(ty.sent).toEqual([{ items: [{ barcode: "SYNC-1", quantity: 0 }] }]);
    });

    it("fiyat kuralı varsa fiyat gönderilir; büyük değişim onay kuyruğuna düşer", async () => {
      await managedVariant("PRICE-1", 4, 10000);
      ty.inventory = [{ barcode: "PRICE-1", quantity: 4, salePrice: 140, listPrice: 168 }];
      ty.approved = [{ barcode: "PRICE-1" }];
      await runTrendyolImport(deps, tenantId);
      await run((t) =>
        t.insert(schema.pricingRules).values({
          tenantId,
          scope: "general",
          multiplier: 1.5,
          listPriceRule: { kind: "multiplier", value: 1.2 },
        }),
      );
      ty.sent = [];
      await runTrendyolSync(deps, tenantId);
      expect(ty.sent.flatMap((s) => s.items)).toContainEqual({
        barcode: "PRICE-1",
        salePrice: 150,
        listPrice: 180,
      });

      // Maliyet 3 katına çıkar → %200 değişim → onay kuyruğu, fiyat gönderilmez.
      await run((t) =>
        t
          .update(schema.variants)
          .set({ costPrice: 30000 })
          .where(eq(schema.variants.barcode, "PRICE-1")),
      );
      ty.sent = [];
      const r = await runTrendyolSync(deps, tenantId);
      expect(r.reviews).toBe(1);
      expect(ty.sent.flatMap((s) => s.items).find((i) => i.barcode === "PRICE-1")).toBeUndefined();
      const [review] = await run((t) => t.select().from(schema.priceReviews));
      expect(review).toMatchObject({ status: "pending", oldPrice: 15000, newPrice: 45000 });
      await run((t) => t.delete(schema.pricingRules));
    });

    it("acil durdurma: tenant senkronu duraklatılınca hiçbir istek atılmaz", async () => {
      await db
        .update(schema.tenants)
        .set({ syncPaused: true })
        .where(eq(schema.tenants.id, tenantId));
      await run((t) =>
        t.update(schema.variants).set({ stock: 99 }).where(eq(schema.variants.managed, true)),
      );
      const r = await runTrendyolSync(deps, tenantId);
      expect(r.reason).toBe("sync_paused");
      expect(ty.requests).toEqual([]);
      expect(await lastJob("ty_sync")).toMatchObject({ status: "skipped" });
      await db
        .update(schema.tenants)
        .set({ syncPaused: false })
        .where(eq(schema.tenants.id, tenantId));
    });

    it("zamanlayıcı: içe aktarma günlük, senkron 15 dakikada bir; duraklatılmış tenant'a senkron yok", async () => {
      const added: TrendyolPayload[] = [];
      const queue: JobQueue = {
        enqueueSupplierFetch: async () => ({ queued: true }),
        enqueueTrendyol: async (p) => (added.push(p), { queued: true }),
        close: async () => {},
      };
      const at = (ms: number) => new Date(Date.now() + ms);

      await scheduleTrendyolJobs({ db, queue }, at(60_000));
      expect(added.filter((a) => a.kind !== "poll")).toEqual([]);

      added.length = 0;
      await scheduleTrendyolJobs({ db, queue }, at(20 * 60_000));
      expect(added).toContainEqual({ kind: "sync", tenantId });

      added.length = 0;
      await scheduleTrendyolJobs({ db, queue }, at(25 * 3_600_000));
      expect(added).toContainEqual({ kind: "import", tenantId });
      expect(added).not.toContainEqual({ kind: "sync", tenantId });

      await db
        .update(schema.tenants)
        .set({ syncPaused: true })
        .where(eq(schema.tenants.id, tenantId));
      added.length = 0;
      await scheduleTrendyolJobs({ db, queue }, at(20 * 60_000));
      expect(added).not.toContainEqual({ kind: "sync", tenantId });
      await db
        .update(schema.tenants)
        .set({ syncPaused: false })
        .where(eq(schema.tenants.id, tenantId));
    });

    it("tam taramada görülmeyen ürün 'unknown' olur ve senkron dışında kalır", async () => {
      ty.inventory = [];
      ty.approved = [];
      const r = await runTrendyolImport(deps, tenantId);
      expect(r.unseen).toBeGreaterThan(0);
      expect(await listing("SYNC-1")).toMatchObject({ l: { tyStatus: "unknown" } });
      ty.sent = [];
      await runTrendyolSync(deps, tenantId);
      expect(ty.sent).toEqual([]);
    });
  });
});
