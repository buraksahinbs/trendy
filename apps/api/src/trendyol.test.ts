import { randomBytes } from "node:crypto";
import { schema, withTenant } from "@trendy/db";
import { createTestDatabase } from "@trendy/db/testing";
import { createSecretBox } from "@trendy/shared";
import { InMemoryRateLimiter } from "@trendy/trendyol-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type App, type AppDeps } from "./app.js";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("Trendyol API bilgileri uçları", () => {
  let app: App;
  let deps: AppDeps;
  let drop: () => Promise<void>;
  let owner: string;
  let ownerTenant: number;
  let staff: string;

  const cookieOf = (res: { cookies: { name: string; value: string }[] }) =>
    `trendy_session=${res.cookies.find((c) => c.name === "trendy_session")!.value}`;

  beforeAll(async () => {
    const t = await createTestDatabase(url!);
    drop = t.drop;
    deps = {
      db: t.db,
      secretBox: createSecretBox({ 1: randomBytes(32).toString("base64") }, 1),
      limiter: new InMemoryRateLimiter(),
      sessionTtlMs: 3_600_000,
      secureCookies: false,
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
});
