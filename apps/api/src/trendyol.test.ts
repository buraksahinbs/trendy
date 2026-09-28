import { randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { schema, withTenant } from "@trendy/db";
import { createTestDatabase } from "@trendy/db/testing";
import { createSecretBox } from "@trendy/shared";
import { InMemoryRateLimiter } from "@trendy/trendyol-client";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type App, type AppDeps } from "./app.js";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("Trendyol API bilgileri uçları", () => {
  let app: App;
  let deps: AppDeps;
  let drop: () => Promise<void>;
  let owner: string;
  let ownerTenant: number;
  let staff: string;
  let tyServer: http.Server;
  let tyReply: { status: number; body?: unknown } = { status: 200, body: {} };
  let tyRequests: { url: string; headers: http.IncomingHttpHeaders }[] = [];

  const cookieOf = (res: { cookies: { name: string; value: string }[] }) =>
    `trendy_session=${res.cookies.find((c) => c.name === "trendy_session")!.value}`;

  beforeAll(async () => {
    tyServer = http.createServer((req, res) => {
      tyRequests.push({ url: req.url!, headers: req.headers });
      res.writeHead(tyReply.status, { "content-type": "application/json" });
      res.end(tyReply.body === undefined ? "" : JSON.stringify(tyReply.body));
    });
    await new Promise<void>((r) => tyServer.listen(0, "127.0.0.1", r));
    const tyBase = `http://127.0.0.1:${(tyServer.address() as AddressInfo).port}`;
    const t = await createTestDatabase(url!);
    drop = t.drop;
    deps = {
      db: t.db,
      secretBox: createSecretBox({ 1: randomBytes(32).toString("base64") }, 1),
      limiter: new InMemoryRateLimiter(),
      sessionTtlMs: 3_600_000,
      secureCookies: false,
      integratorName: "SelfIntegration",
      trendyolClientOptions: { baseUrl: tyBase, sleep: async () => {} },
      queue: { enqueueSupplierFetch: async () => ({ queued: true }), close: async () => {} },
    };
    app = await buildApp(deps);

    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "owner@example.com", password: "owner-sifre-123", tenantName: "A" },
    });
    owner = cookieOf(reg);
    ownerTenant = reg.json().tenantId;

    // Personel: ayrı kayıt, sonra A mağazasına staff olarak eklenir ve oraya geçer.
    const regStaff = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "staff@example.com", password: "staff-sifre-123", tenantName: "S" },
    });
    staff = cookieOf(regStaff);
    await withTenant(deps.db, ownerTenant, (tx) =>
      tx.insert(schema.tenantMembers).values({
        tenantId: ownerTenant,
        userId: regStaff.json().userId,
        role: "staff",
      }),
    );
    await app.inject({
      method: "POST",
      url: "/auth/switch-tenant",
      headers: { cookie: staff },
      payload: { tenantId: ownerTenant },
    });
  });

  afterAll(async () => {
    tyServer?.close();
    await app?.close();
    await drop?.();
  });

  const body = { sellerId: "123456", apiKey: "ANAHTAR-abcd1234", apiSecret: "GIZLI-deger" };

  it("owner kaydeder; yanıtta gizli bilgi dönmez", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/trendyol/credentials/prod",
      headers: { cookie: owner },
      payload: body,
    });
    expect(put.statusCode).toBe(204);

    const get = await app.inject({
      method: "GET",
      url: "/trendyol/credentials",
      headers: { cookie: owner },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual([
      expect.objectContaining({
        env: "prod",
        sellerId: "123456",
        apiKeyHint: "…1234",
        verifiedAt: null,
      }),
    ]);
    expect(get.body).not.toContain("GIZLI");
    expect(get.body).not.toContain("ANAHTAR");
  });

  it("staff görebilir ama değiştiremez", async () => {
    const get = await app.inject({
      method: "GET",
      url: "/trendyol/credentials",
      headers: { cookie: staff },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toHaveLength(1);
    const put = await app.inject({
      method: "PUT",
      url: "/trendyol/credentials/prod",
      headers: { cookie: staff },
      payload: body,
    });
    expect(put.statusCode).toBe(403);
  });

  it("geçersiz ortam ve satıcı ID reddedilir", async () => {
    const badEnv = await app.inject({
      method: "PUT",
      url: "/trendyol/credentials/test",
      headers: { cookie: owner },
      payload: body,
    });
    expect(badEnv.statusCode).toBe(400);
    const badSeller = await app.inject({
      method: "PUT",
      url: "/trendyol/credentials/stage",
      headers: { cookie: owner },
      payload: { ...body, sellerId: "12-34" },
    });
    expect(badSeller.statusCode).toBe(400);
  });

  it("oturumsuz erişilemez", async () => {
    expect((await app.inject({ method: "GET", url: "/trendyol/credentials" })).statusCode).toBe(
      401,
    );
  });

  describe("bağlantı doğrulama", () => {
    const verify = (env: "prod" | "stage", cookie = owner) =>
      app.inject({
        method: "POST",
        url: `/trendyol/credentials/${env}/verify`,
        headers: { cookie },
      });

    beforeEach(async () => {
      tyRequests = [];
      await app.inject({
        method: "PUT",
        url: "/trendyol/credentials/prod",
        headers: { cookie: owner },
        payload: body,
      });
      await app.inject({
        method: "PUT",
        url: "/trendyol/credentials/stage",
        headers: { cookie: owner },
        payload: { ...body, sellerId: "777" },
      });
    });

    it("başarılı salt-okuma çağrısıyla doğrular ve verifiedAt yazar", async () => {
      tyReply = { status: 200, body: { totalElements: 42, page: 0, size: 1, content: [] } };
      const res = await verify("prod");
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ verified: true, approvedContentCount: 42 });

      // Tek bir GET; doğru yol, Basic Auth ve User-Agent.
      expect(tyRequests).toHaveLength(1);
      const r = tyRequests[0]!;
      expect(r.url).toBe(
        "/integration/product/sellers/123456/products/approved/inventory-and-price?page=0&size=1",
      );
      expect(r.headers.authorization).toBe(
        `Basic ${Buffer.from("ANAHTAR-abcd1234:GIZLI-deger").toString("base64")}`,
      );
      expect(r.headers["user-agent"]).toBe("123456 - SelfIntegration");

      const list = await app.inject({
        method: "GET",
        url: "/trendyol/credentials",
        headers: { cookie: owner },
      });
      const prod = list.json().find((c: { env: string }) => c.env === "prod");
      expect(prod.verifiedAt).not.toBeNull();
    });

    it.each([
      [401, "prod", "invalid_credentials"],
      [403, "prod", "forbidden"],
      [503, "stage", "stage_ip_not_allowed"],
      [500, "prod", "unavailable"],
      [503, "prod", "unavailable"],
    ] as const)("Trendyol %i (%s) → %s; doğrulanmış sayılmaz", async (status, env, reason) => {
      tyReply = { status, body: { exception: "x" } };
      const res = await verify(env);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ verified: false, reason });
      expect(res.json().message).toBeTruthy();
      // Sunucu hatasında kullanıcı bekletilmez: tek deneme.
      expect(tyRequests).toHaveLength(1);
      const [row] = await withTenant(deps.db, ownerTenant, (tx) =>
        tx.select().from(schema.trendyolCredentials).where(eq(schema.trendyolCredentials.env, env)),
      );
      expect(row!.verifiedAt).toBeNull();
    });

    it("personel doğrulayamaz; kayıt yoksa 404", async () => {
      expect((await verify("prod", staff)).statusCode).toBe(403);
      await withTenant(deps.db, ownerTenant, (tx) => tx.delete(schema.trendyolCredentials));
      expect((await verify("prod")).statusCode).toBe(404);
      expect(tyRequests).toHaveLength(0);
    });
  });
});
