import { randomBytes } from "node:crypto";
import { schema, withTenant } from "@trendy/db";
import { createTestDatabase } from "@trendy/db/testing";
import type { TrendyolPayload } from "@trendy/jobs";
import { createSecretBox } from "@trendy/shared";
import { InMemoryRateLimiter } from "@trendy/trendyol-client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type App, type AppDeps } from "./app.js";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("Trendyol yönetim ve ayar uçları", () => {
  let app: App;
  let deps: AppDeps;
  let drop: () => Promise<void>;
  const enqueued: TrendyolPayload[] = [];
  const users = {} as Record<
    "owner" | "staff" | "other",
    { cookie: string; tenantId: number; userId: number }
  >;
  let reviewId: number;

  const cookieOf = (res: { cookies: { name: string; value: string }[] }) =>
    `trendy_session=${res.cookies.find((c) => c.name === "trendy_session")!.value}`;
  const register = async (email: string, tenantName: string) => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password: "guclu-sifre-123", tenantName },
    });
    return { cookie: cookieOf(res), ...(res.json() as { tenantId: number; userId: number }) };
  };
  const call = (
    who: keyof typeof users,
    method: "GET" | "POST" | "PATCH",
    path: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url: path,
      headers: { cookie: users[who].cookie },
      ...(payload ? { payload } : {}),
    });

  beforeAll(async () => {
    const t = await createTestDatabase(url!);
    drop = t.drop;
    deps = {
      db: t.db,
      secretBox: createSecretBox({ 1: randomBytes(32).toString("base64") }, 1),
      limiter: new InMemoryRateLimiter(),
      queue: {
        enqueueSupplierFetch: async () => ({ queued: true }),
        enqueueTrendyol: async (p) => (enqueued.push(p), { queued: true }),
        close: async () => {},
      },
      integratorName: "SelfIntegration",
      sessionTtlMs: 3_600_000,
      secureCookies: false,
    };
    app = await buildApp(deps);
    users.owner = await register("owner@example.com", "A");
    users.other = await register("other@example.com", "B");
    const staff = await register("staff@example.com", "S");
    const a = users.owner.tenantId;
    await withTenant(t.db, a, (tx) =>
      tx.insert(schema.tenantMembers).values({ tenantId: a, userId: staff.userId, role: "staff" }),
    );
    await app.inject({
      method: "POST",
      url: "/auth/switch-tenant",
      headers: { cookie: staff.cookie },
      payload: { tenantId: a },
    });
    users.staff = { ...staff, tenantId: a };

    // A mağazasının kataloğu: yönetilen+onaylı, hatalı, kilitli ve bekleyen fiyat incelemesi.
    await withTenant(t.db, a, async (tx) => {
      const [p] = await tx
        .insert(schema.products)
        .values({ tenantId: a, productMainId: "M-1", title: "Kırmızı Tişört" })
        .returning();
      const vs = await tx
        .insert(schema.variants)
        .values([
          { tenantId: a, productId: p!.id, barcode: "OK-1", stock: 5, managed: true },
          { tenantId: a, productId: p!.id, barcode: "ERR-1", stock: 1, managed: true },
          { tenantId: a, productId: p!.id, barcode: "LCK-1", stock: 0, managed: false },
        ])
        .returning();
      await tx.insert(schema.channelListings).values([
        { tenantId: a, variantId: vs[0]!.id, tyStatus: "approved", tyStock: 5 },
        { tenantId: a, variantId: vs[1]!.id, tyStatus: "approved", lastError: "Geçersiz fiyat" },
        { tenantId: a, variantId: vs[2]!.id, tyStatus: "locked", lockReason: "Kritik fiyat" },
      ]);
      const [r] = await tx
        .insert(schema.priceReviews)
        .values({
          tenantId: a,
          variantId: vs[0]!.id,
          oldPrice: 10000,
          newPrice: 15000,
          newListPrice: 18000,
          changeRate: 0.5,
        })
        .returning();
      reviewId = r!.id;
    });
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });
  beforeEach(() => {
    enqueued.length = 0;
  });

  it("durum özeti", async () => {
    const res = await call("staff", "GET", "/trendyol/status");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      syncPaused: false,
      syncEnv: "prod",
      lastSync: null,
      lastImport: null,
      listings: { approved: 2, locked: 1 },
      managedVariants: 2,
      listingErrors: 1,
      pendingReviews: 1,
    });
  });

  it("ürün/kanal listesi filtreleri; başka mağazaya boş", async () => {
    const all = (await call("owner", "GET", "/trendyol/listings")).json();
    expect(all.total).toBe(3);
    const locked = (await call("owner", "GET", "/trendyol/listings?status=locked")).json();
    expect(locked.items.map((i: { barcode: string }) => i.barcode)).toEqual(["LCK-1"]);
    expect(locked.items[0].lockReason).toBe("Kritik fiyat");
    const errs = (await call("owner", "GET", "/trendyol/listings?hasError=true")).json();
    expect(errs.items.map((i: { barcode: string }) => i.barcode)).toEqual(["ERR-1"]);
    const managed = (await call("owner", "GET", "/trendyol/listings?managed=false")).json();
    expect(managed.total).toBe(1);
    const search = (await call("owner", "GET", "/trendyol/listings?search=kırmızı")).json();
    expect(search.total).toBe(3);
    expect((await call("owner", "GET", "/trendyol/listings?status=bogus")).statusCode).toBe(400);
    expect((await call("other", "GET", "/trendyol/listings")).json()).toEqual({
      total: 0,
      items: [],
    });
  });

  it("elle senkron/içe aktarma yalnızca owner; kuyruğa eklenir", async () => {
    expect((await call("staff", "POST", "/trendyol/sync")).statusCode).toBe(403);
    expect((await call("owner", "POST", "/trendyol/sync")).statusCode).toBe(202);
    expect((await call("owner", "POST", "/trendyol/import")).statusCode).toBe(202);
    expect(enqueued).toEqual([
      { kind: "sync", tenantId: users.owner.tenantId },
      { kind: "import", tenantId: users.owner.tenantId },
    ]);
  });

  it("fiyat onayı: listelenir, staff karar veremez, onay senkronu tetikler, ikinci karar 404", async () => {
    const list = (await call("staff", "GET", "/trendyol/price-reviews")).json();
    expect(list).toEqual([
      expect.objectContaining({ id: reviewId, barcode: "OK-1", newPrice: 15000, changeRate: 0.5 }),
    ]);
    expect(
      (await call("staff", "POST", `/trendyol/price-reviews/${reviewId}/approve`)).statusCode,
    ).toBe(403);
    expect(
      (await call("other", "POST", `/trendyol/price-reviews/${reviewId}/approve`)).statusCode,
    ).toBe(404);
    expect(
      (await call("owner", "POST", `/trendyol/price-reviews/${reviewId}/approve`)).statusCode,
    ).toBe(204);
    expect(enqueued).toEqual([{ kind: "sync", tenantId: users.owner.tenantId }]);
    expect(
      (await call("owner", "POST", `/trendyol/price-reviews/${reviewId}/reject`)).statusCode,
    ).toBe(404);
    const approved = (await call("owner", "GET", "/trendyol/price-reviews?status=approved")).json();
    expect(approved[0]).toMatchObject({ id: reviewId, status: "approved" });
    expect(
      (await call("owner", "POST", `/trendyol/price-reviews/${reviewId}/maybe`)).statusCode,
    ).toBe(400);
  });

  it("ayarlar: owner günceller, staff okur ama değiştiremez, başka mağazayı etkilemez", async () => {
    const res = await call("owner", "PATCH", "/settings", {
      syncPaused: true,
      safetyStock: 2,
      maxAutoChangeRate: 0.25,
      fxRates: { USD: 41.5, EUR: 45 },
      listingLimitTier: "150k",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      syncPaused: true,
      safetyStock: 2,
      maxAutoChangeRate: 0.25,
      fxRates: { USD: 41.5 },
      listingLimitTier: "150k",
    });
    expect((await call("staff", "GET", "/settings")).json().safetyStock).toBe(2);
    expect((await call("staff", "PATCH", "/settings", { syncPaused: false })).statusCode).toBe(403);
    expect((await call("other", "GET", "/settings")).json()).toMatchObject({
      syncPaused: false,
      safetyStock: 0,
      name: "B",
    });
    expect((await call("owner", "GET", "/trendyol/status")).json().syncPaused).toBe(true);
  });

  it.each([
    [{ fxRates: { TRY: 1 } }],
    [{ fxRates: { usd: 40 } }],
    [{ fxRates: { USD: -1 } }],
    [{ safetyStock: -1 }],
    [{ maxAutoChangeRate: 0 }],
    [{ listingLimitTier: "1m" }],
    [{ plan: "enterprise" }],
  ])("geçersiz ayar 400: %j", async (body) => {
    expect((await call("owner", "PATCH", "/settings", body)).statusCode).toBe(400);
  });
});
