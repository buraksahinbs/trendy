import { randomBytes } from "node:crypto";
import { loadSyncSettings, schema, withTenant } from "@trendy/db";
import { createTestDatabase } from "@trendy/db/testing";
import type { TrendyolPayload } from "@trendy/jobs";
import { createSecretBox } from "@trendy/shared";
import { InMemoryRateLimiter } from "@trendy/trendyol-client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type App, type AppDeps } from "./app.js";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("fiyat kuralları", () => {
  let app: App;
  let deps: AppDeps;
  let drop: () => Promise<void>;
  const enqueued: TrendyolPayload[] = [];
  const users = {} as Record<"owner" | "staff" | "other", { cookie: string; tenantId: number }>;

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
    method: "GET" | "POST" | "PUT" | "DELETE",
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
    users.staff = { cookie: staff.cookie, tenantId: a };
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });
  beforeEach(() => {
    enqueued.length = 0;
  });

  it("oluştur, listele, güncelle, sil; her değişiklik senkron tetikler; senkron ayarlarına yansır", async () => {
    const created = await call("owner", "POST", "/pricing-rules", {
      scope: "general",
      multiplier: 1.5,
      addFixed: 2500,
      rounding: { kind: "ending", kurus: 90 },
      commissionRate: 0.2,
      minMarginRate: 0.1,
      listPriceRule: { kind: "multiplier", value: 1.2 },
    });
    expect(created.statusCode).toBe(201);
    const rule = created.json();
    expect(rule).toMatchObject({
      scope: "general",
      scopeKey: null,
      multiplier: 1.5,
      minPrice: null,
    });

    const brand = await call("owner", "POST", "/pricing-rules", {
      scope: "brand",
      scopeKey: "Acme",
      multiplier: 2,
    });
    expect(brand.statusCode).toBe(201);
    expect(brand.json()).toMatchObject({
      addFixed: 0,
      rounding: { kind: "none" },
      listPriceRule: { kind: "same" },
    });

    const list = (await call("staff", "GET", "/pricing-rules")).json();
    expect(list.map((r: { scope: string }) => r.scope)).toEqual(["general", "brand"]);

    const upd = await call("owner", "PUT", `/pricing-rules/${rule.id}`, {
      scope: "general",
      multiplier: 1.4,
      minPrice: 10000,
      maxPrice: 50000,
    });
    expect(upd.statusCode).toBe(200);
    expect(upd.json()).toMatchObject({ multiplier: 1.4, minPrice: 10000, commissionRate: null });

    const settings = await withTenant(deps.db, users.owner.tenantId, (tx) =>
      loadSyncSettings(tx, users.owner.tenantId),
    );
    expect(settings!.rules).toEqual([
      expect.objectContaining({ scope: "general", multiplier: 1.4, minPrice: 10000 }),
      expect.objectContaining({ scope: "brand", scopeKey: "Acme", multiplier: 2 }),
    ]);

    expect((await call("owner", "DELETE", `/pricing-rules/${brand.json().id}`)).statusCode).toBe(
      204,
    );
    expect((await call("owner", "DELETE", `/pricing-rules/${brand.json().id}`)).statusCode).toBe(
      404,
    );
    expect(enqueued).toHaveLength(4);
    expect(enqueued.every((p) => p.kind === "sync")).toBe(true);
  });

  it("aynı kapsamda ikinci kural 409", async () => {
    const res = await call("owner", "POST", "/pricing-rules", { scope: "general", multiplier: 1 });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("duplicate_scope");
    await call("owner", "POST", "/pricing-rules", {
      scope: "category",
      scopeKey: "Ayakkabı",
      multiplier: 1,
    });
    const dup = await call("owner", "POST", "/pricing-rules", {
      scope: "category",
      scopeKey: "Ayakkabı",
      multiplier: 3,
    });
    expect(dup.statusCode).toBe(409);
  });

  it("staff değiştiremez; başka mağaza göremez ve dokunamaz", async () => {
    expect(
      (
        await call("staff", "POST", "/pricing-rules", {
          scope: "supplier",
          scopeKey: "1",
          multiplier: 1,
        })
      ).statusCode,
    ).toBe(403);
    expect((await call("other", "GET", "/pricing-rules")).json()).toEqual([]);
    const [first] = (await call("owner", "GET", "/pricing-rules")).json();
    expect(
      (
        await call("other", "PUT", `/pricing-rules/${first.id}`, {
          scope: "general",
          multiplier: 9,
        })
      ).statusCode,
    ).toBe(404);
    expect((await call("other", "DELETE", `/pricing-rules/${first.id}`)).statusCode).toBe(404);
  });

  it("önizleme senkronla aynı motoru kullanır", async () => {
    const res = await call("staff", "POST", "/pricing-rules/preview", {
      rule: {
        scope: "general",
        multiplier: 1.5,
        addFixed: 1000,
        rounding: { kind: "ending", kurus: 90 },
        listPriceRule: { kind: "multiplier", value: 1.2 },
      },
      cost: 10000,
    });
    expect(res.statusCode).toBe(200);
    // 100 TL × 1,5 + 10 TL = 160 TL → 160,90; liste 193,08
    expect(res.json()).toEqual({
      status: "ok",
      salePrice: 16090,
      listPrice: 19308,
      ruleId: "preview",
    });
    const review = await call("owner", "POST", "/pricing-rules/preview", {
      rule: { scope: "general", multiplier: 2 },
      cost: 10000,
      lastSentSalePrice: 10000,
    });
    expect(review.json()).toMatchObject({ status: "needs_review", changeRate: 1 });
    const blocked = await call("owner", "POST", "/pricing-rules/preview", {
      rule: { scope: "general", multiplier: 1, maxPrice: 5000 },
      cost: 10000,
    });
    expect(blocked.json()).toMatchObject({ status: "blocked", reason: "below_cost" });
  });

  it.each([
    [{ scope: "general", scopeKey: "x", multiplier: 1 }],
    [{ scope: "brand", multiplier: 1 }],
    [{ scope: "supplier", scopeKey: "abc", multiplier: 1 }],
    [{ scope: "general", multiplier: 0 }],
    [{ scope: "brand", scopeKey: "B", multiplier: 1, commissionRate: 1 }],
    [{ scope: "brand", scopeKey: "B", multiplier: 1, rounding: { kind: "ending", kurus: 100 } }],
    [{ scope: "brand", scopeKey: "B", multiplier: 1, minPrice: 500, maxPrice: 100 }],
    [
      {
        scope: "brand",
        scopeKey: "B",
        multiplier: 1,
        listPriceRule: { kind: "multiplier", value: 0.9 },
      },
    ],
    [{ scope: "brand", scopeKey: "B", multiplier: 1, tenantId: 5 }],
  ])("geçersiz kural 400: %j", async (body) => {
    expect((await call("owner", "POST", "/pricing-rules", body)).statusCode).toBe(400);
  });
});
