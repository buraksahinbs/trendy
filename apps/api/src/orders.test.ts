import { randomBytes } from "node:crypto";
import { schema, upsertOrder, withTenant } from "@trendy/db";
import { createTestDatabase } from "@trendy/db/testing";
import type { TrendyolPayload } from "@trendy/jobs";
import { createSecretBox } from "@trendy/shared";
import { InMemoryRateLimiter } from "@trendy/trendyol-client";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type App, type AppDeps } from "./app.js";

const url = process.env.DATABASE_URL;
const NOW = new Date("2026-09-28T12:00:00Z");
const DAY = 24 * 3_600_000;

const pkg = (id: number, patch: Record<string, unknown> = {}) => ({
  shipmentPackageId: id,
  orderNumber: `O-${id}`,
  status: "Created",
  lastModifiedDate: 1_700_000_000_000,
  orderDate: 1_700_000_000_000,
  packageTotalPrice: 250,
  customerFirstName: "Ayşe",
  customerLastName: "Yılmaz",
  customerEmail: "ayse@example.com",
  identityNumber: "12345678901",
  shipmentAddress: { fullAddress: "Moda Cad. No:1 Kadıköy", city: "İstanbul", phone: "5550000000" },
  lines: [{ lineId: id * 10, barcode: "BAR-1", stockCode: "S-1", quantity: 1, lineUnitPrice: 250 }],
  ...patch,
});

describe.skipIf(!url)("sipariş uçları ve webhook", () => {
  let app: App;
  let deps: AppDeps;
  let drop: () => Promise<void>;
  const enqueued: TrendyolPayload[] = [];
  const users = {} as Record<
    "owner" | "staff" | "other",
    { cookie: string; tenantId: number; userId: number }
  >;
  let orderId: number;

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
  const call = (who: keyof typeof users, method: "GET" | "POST", path: string, payload?: object) =>
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
      publicBaseUrl: "https://api.ornek.com",
      sessionTtlMs: 3_600_000,
      secureCookies: false,
      now: () => NOW,
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

    const { toOrderInput, shipmentPackageSchema } = await import("@trendy/trendyol-client");
    await withTenant(t.db, a, async (tx) => {
      await upsertOrder(tx, a, toOrderInput(shipmentPackageSchema.parse(pkg(1))));
      await upsertOrder(
        tx,
        a,
        toOrderInput(
          shipmentPackageSchema.parse(pkg(2, { status: "Shipped", orderDate: 1_700_000_500_000 })),
        ),
      );
      const [o] = await tx
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.shipmentPackageId, "1"));
      orderId = o!.id;
    });
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });
  beforeEach(() => {
    enqueued.length = 0;
  });

  it("liste: kişisel veri içermez; filtreler; başka mağazaya boş", async () => {
    const res = await call("staff", "GET", "/orders");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.items[0]).toMatchObject({
      shipmentPackageId: "2",
      status: "Shipped",
      packageTotalPrice: 25000,
      customerName: "Ayşe Yılmaz",
      lineCount: 1,
      itemCount: 1,
    });
    expect(res.body).not.toContain("Moda Cad");
    expect(res.body).not.toContain("ayse@example.com");
    expect(res.body).not.toContain("12345678901");
    expect((await call("owner", "GET", "/orders?status=Created")).json().total).toBe(1);
    expect((await call("owner", "GET", "/orders?search=BAR-1")).json().total).toBe(2);
    expect((await call("owner", "GET", "/orders?search=O-2")).json().total).toBe(1);
    expect((await call("other", "GET", "/orders")).json()).toEqual({ total: 0, items: [] });
  });

  it("detay: adres yalnızca owner'a; T.C. kimlik no hiç yok; başka mağazaya 404", async () => {
    const owner = await call("owner", "GET", `/orders/${orderId}`);
    expect(owner.statusCode).toBe(200);
    expect(owner.json()).toMatchObject({
      orderNumber: "O-1",
      shipmentAddress: { fullAddress: "Moda Cad. No:1 Kadıköy" },
      lines: [
        expect.objectContaining({
          lineId: "10",
          barcode: "BAR-1",
          quantity: 1,
          lineUnitPrice: 25000,
        }),
      ],
    });
    expect(owner.body).not.toContain("12345678901");
    const staff = await call("staff", "GET", `/orders/${orderId}`);
    expect(staff.json()).not.toHaveProperty("shipmentAddress");
    expect(staff.body).not.toContain("Moda Cad");
    expect((await call("other", "GET", `/orders/${orderId}`)).statusCode).toBe(404);
  });

  it("elle çekim ve backfill yalnızca owner; backfill aralığı doğrulanır", async () => {
    expect((await call("staff", "POST", "/orders/sync")).statusCode).toBe(403);
    expect((await call("owner", "POST", "/orders/sync")).statusCode).toBe(202);
    const from = new Date(NOW.getTime() - 20 * DAY).toISOString();
    const to = new Date(NOW.getTime() - 10 * DAY).toISOString();
    expect((await call("owner", "POST", "/orders/backfill", { from, to })).statusCode).toBe(202);
    expect(enqueued).toEqual([
      { kind: "orders", tenantId: users.owner.tenantId },
      { kind: "orders_backfill", tenantId: users.owner.tenantId, from, to },
    ]);
    const old = new Date(NOW.getTime() - 100 * DAY).toISOString();
    expect((await call("owner", "POST", "/orders/backfill", { from: old, to })).json().error).toBe(
      "too_old",
    );
    expect(
      (await call("owner", "POST", "/orders/backfill", { from: to, to: from })).statusCode,
    ).toBe(400);
    const future = new Date(NOW.getTime() + DAY).toISOString();
    expect(
      (await call("owner", "POST", "/orders/backfill", { from, to: future })).json().error,
    ).toBe("future");
  });

  describe("webhook", () => {
    let hookUrl: string;
    let apiKey: string;

    it("ayar: owner oluşturur; anahtar yalnızca bir kez gösterilir; URL'de trendyol geçmez", async () => {
      expect((await call("staff", "POST", "/settings/webhook")).statusCode).toBe(403);
      expect((await call("owner", "GET", "/settings/webhook")).json()).toEqual({
        configured: false,
      });
      const res = await call("owner", "POST", "/settings/webhook");
      expect(res.statusCode).toBe(201);
      ({ url: hookUrl, apiKey } = res.json());
      expect(hookUrl).toMatch(/^https:\/\/api\.ornek\.com\/hooks\/o\/[\w-]{32}$/);
      expect(hookUrl.toLowerCase()).not.toMatch(/trendyol|dolap|localhost/);
      const get = await call("owner", "GET", "/settings/webhook");
      expect(get.json()).toMatchObject({
        configured: true,
        url: hookUrl,
        authenticationType: "API_KEY",
        lastReceivedAt: null,
      });
      expect(get.body).not.toContain(apiKey);
    });

    const post = (path: string, body: unknown, key?: string) =>
      app.inject({
        method: "POST",
        url: path,
        payload: body as object,
        headers: key ? { "x-api-key": key } : {},
      });
    const pathOf = () => new URL(hookUrl).pathname;

    it("bilinmeyen token 404, anahtar yok/yanlış 401; hiçbir şey yazılmaz", async () => {
      expect(
        (await post("/hooks/o/bilinmeyen-token-xxxxxxxxxxxx", { content: [pkg(3)] }, apiKey))
          .statusCode,
      ).toBe(404);
      expect((await post(pathOf(), { content: [pkg(3)] })).statusCode).toBe(401);
      expect((await post(pathOf(), { content: [pkg(3)] }, "yanlis-anahtar")).statusCode).toBe(401);
      expect((await call("owner", "GET", "/orders?search=O-3")).json().total).toBe(0);
    });

    it("geçerli istek siparişi yazar (zarf ve tek paket); lastReceivedAt güncellenir", async () => {
      expect(
        (await post(pathOf(), { totalElements: 1, content: [pkg(3)] }, apiKey)).statusCode,
      ).toBe(200);
      expect((await post(pathOf(), pkg(4), apiKey)).statusCode).toBe(200);
      expect((await call("owner", "GET", "/orders")).json().total).toBe(4);
      expect(
        (await call("owner", "GET", "/settings/webhook")).json().lastReceivedAt,
      ).not.toBeNull();
      expect((await call("other", "GET", "/orders")).json().total).toBe(0);
    });

    it("gecikmiş eski webhook yeni statüyü ezmez; bozuk gövde 400", async () => {
      await post(
        pathOf(),
        pkg(3, { status: "Shipped", lastModifiedDate: 1_700_000_900_000 }),
        apiKey,
      );
      await post(
        pathOf(),
        pkg(3, { status: "Created", lastModifiedDate: 1_700_000_100_000 }),
        apiKey,
      );
      const list = (await call("owner", "GET", "/orders?search=O-3")).json();
      expect(list.items[0].status).toBe("Shipped");
      expect((await post(pathOf(), { foo: "bar" }, apiKey)).statusCode).toBe(400);
    });

    it("yeniden oluşturma eski URL'yi ve anahtarı geçersiz kılar", async () => {
      const old = pathOf();
      const oldKey = apiKey;
      const res = await call("owner", "POST", "/settings/webhook");
      expect(res.json().url).not.toBe(hookUrl);
      expect((await post(old, pkg(5), oldKey)).statusCode).toBe(404);
    });
  });
});
