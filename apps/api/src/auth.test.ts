import { randomBytes } from "node:crypto";
import { schema, withTenant } from "@trendy/db";
import { createTestDatabase } from "@trendy/db/testing";
import { createSecretBox } from "@trendy/shared";
import { InMemoryRateLimiter } from "@trendy/trendyol-client";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type App, type AppDeps } from "./app.js";

/** Kayıt/giriş akışı (ROADMAP Faz 1 kabul kriteri). Gerçek PostgreSQL gerekir. */
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("auth API", () => {
  let app: App;
  let deps: AppDeps;
  let drop: () => Promise<void>;
  let clock = new Date("2026-09-28T10:00:00Z");

  beforeAll(async () => {
    const t = await createTestDatabase(url!);
    drop = t.drop;
    deps = {
      db: t.db,
      secretBox: createSecretBox({ 1: randomBytes(32).toString("base64") }, 1),
      limiter: new InMemoryRateLimiter(() => clock.getTime()),
      sessionTtlMs: 24 * 3_600_000,
      secureCookies: false,
      queue: { enqueueSupplierFetch: async () => ({ queued: true }), close: async () => {} },
      now: () => clock,
    };
    app = await buildApp(deps);
  });

  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  beforeEach(() => {
    // Her test farklı bir zamanda: giriş limiti pencereleri birbirini etkilemesin.
    clock = new Date(clock.getTime() + 3_600_000);
  });

  let seq = 0;
  const newEmail = () => `user${++seq}@example.com`;
  const PASSWORD = "cok-gizli-sifre-123";

  async function register(email = newEmail(), tenantName = "Mağaza") {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password: PASSWORD, tenantName },
    });
    return { res, email, cookie: sessionCookie(res) };
  }

  function sessionCookie(res: { cookies: { name: string; value: string }[] }) {
    const c = res.cookies.find((c) => c.name === "trendy_session");
    return c ? `trendy_session=${c.value}` : undefined;
  }

  it("kayıt olur, oturum açılır, /me bilgileri döner", async () => {
    const { res, email, cookie } = await register(undefined, "  Deneme Mağazası ");
    expect(res.statusCode).toBe(201);
    const raw = res.cookies.find((c) => c.name === "trendy_session")!;
    expect(raw).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });

    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      email,
      role: "owner",
      tenants: [{ tenantName: "Deneme Mağazası", role: "owner" }],
    });
  });

  it("şifre düz metin saklanmaz; oturum token'ı veritabanında yoktur", async () => {
    const { email, cookie } = await register();
    const [u] = await deps.db.select().from(schema.users).where(eq(schema.users.email, email));
    expect(u!.passwordHash).toMatch(/^\$argon2id\$/);
    const token = cookie!.split("=")[1]!;
    const rows = await deps.db.select().from(schema.sessions);
    expect(rows.some((r) => r.tokenHash === token)).toBe(false);
  });

  it("aynı e-posta (büyük/küçük harf farkıyla) ikinci kez kaydedilemez", async () => {
    const { email } = await register();
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: email.toUpperCase(), password: PASSWORD, tenantName: "X" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("email_taken");
  });

  it.each([
    [{ email: "gecersiz", password: PASSWORD, tenantName: "X" }, "email"],
    [{ email: "a@b.co", password: "kisa", tenantName: "X" }, "password"],
    [{ email: "a@b.co", password: PASSWORD, tenantName: "  " }, "tenantName"],
  ])("geçersiz kayıt isteği 400: %j", async (payload, field) => {
    const res = await app.inject({ method: "POST", url: "/auth/register", payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().issues.map((i: { path: string }) => i.path)).toContain(field);
  });

  it("doğru bilgilerle giriş yapılır; yanlış şifre ve olmayan kullanıcı aynı hatayı alır", async () => {
    const { email } = await register();
    const ok = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: `  ${email.toUpperCase()} `.trim(), password: PASSWORD },
    });
    expect(ok.statusCode).toBe(200);
    expect(sessionCookie(ok)).toBeDefined();

    const wrong = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password: "yanlis-sifre-000" },
    });
    const missing = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "yok@example.com", password: PASSWORD },
    });
    expect(wrong.statusCode).toBe(401);
    expect(missing.statusCode).toBe(401);
    expect(wrong.json()).toEqual(missing.json());
  });

  it("çok fazla hatalı giriş denemesinde 429 ve Retry-After döner", async () => {
    const { email } = await register();
    const attempt = () =>
      app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email, password: "yanlis-0000" },
      });
    // Kayıt isteği de bu e-postanın penceresinden 1 hak kullandı.
    for (let i = 0; i < 9; i++) expect((await attempt()).statusCode).toBe(401);
    const blocked = await attempt();
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("oturumsuz istek 401, çıkıştan sonra oturum geçersiz", async () => {
    expect((await app.inject({ method: "GET", url: "/auth/me" })).statusCode).toBe(401);
    const { cookie } = await register();
    const out = await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie } });
    expect(out.statusCode).toBe(204);
    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it("süresi dolan oturum geçersizdir", async () => {
    const { cookie } = await register();
    clock = new Date(clock.getTime() + deps.sessionTtlMs + 1);
    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it("uydurma cookie ile erişilemez", async () => {
    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie: "trendy_session=uydurma-token" },
    });
    expect(me.statusCode).toBe(401);
  });

  it("şifre değişince eski oturumlar kapanır, yeni şifreyle giriş yapılır", async () => {
    const { email, cookie } = await register();
    const other = sessionCookie(
      await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email, password: PASSWORD },
      }),
    );
    const wrong = await app.inject({
      method: "POST",
      url: "/auth/change-password",
      headers: { cookie },
      payload: { currentPassword: "yanlis-sifre", newPassword: "yepyeni-sifre-456" },
    });
    expect(wrong.statusCode).toBe(401);

    const res = await app.inject({
      method: "POST",
      url: "/auth/change-password",
      headers: { cookie },
      payload: { currentPassword: PASSWORD, newPassword: "yepyeni-sifre-456" },
    });
    expect(res.statusCode).toBe(204);
    const fresh = sessionCookie(res);
    expect(
      (await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: other } })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: fresh } })).statusCode,
    ).toBe(200);

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password: "yepyeni-sifre-456" },
    });
    expect(login.statusCode).toBe(200);
  });

  it("üyesi olmadığı mağazaya geçemez; üyeliği kaldırılınca erişimi kesilir", async () => {
    const a = await register();
    const b = await register();
    const meB = (
      await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: b.cookie } })
    ).json();

    const sw = await app.inject({
      method: "POST",
      url: "/auth/switch-tenant",
      headers: { cookie: a.cookie },
      payload: { tenantId: meB.activeTenantId },
    });
    expect(sw.statusCode).toBe(403);

    // B'nin üyeliği silinirse (ör. mağazadan çıkarıldı) aktif oturumu tenant'a erişemez.
    await withTenant(deps.db, meB.activeTenantId, (tx) =>
      tx.delete(schema.tenantMembers).where(eq(schema.tenantMembers.userId, meB.userId)),
    );
    const creds = await app.inject({
      method: "GET",
      url: "/trendyol/credentials",
      headers: { cookie: b.cookie },
    });
    expect(creds.statusCode).toBe(403);
    expect(creds.json().error).toBe("no_tenant");
  });

  it("bilinmeyen hata ayrıntısı yanıta sızmaz", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { "content-type": "application/json" },
      payload: "{bozuk json",
    });
    expect(res.statusCode).toBe(400);
  });
});
