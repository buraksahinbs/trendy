import { randomBytes } from "node:crypto";
import {
  createSupplier,
  finishJobLog,
  markTrendyolCredentialsVerified,
  saveTrendyolCredentials,
  schema,
  startJobLog,
  withTenant,
  type TenantTx,
} from "@trendy/db";
import { createTestDatabase } from "@trendy/db/testing";
import { createSecretBox } from "@trendy/shared";
import { InMemoryRateLimiter } from "@trendy/trendyol-client";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type App, type AppDeps } from "./app.js";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("sağlık ve uyarılar", () => {
  let app: App;
  let deps: AppDeps;
  let drop: () => Promise<void>;
  let cookie: string;
  let tenantId: number;
  let beat: string | null = null;
  const box = createSecretBox({ 1: randomBytes(32).toString("base64") }, 1);

  beforeAll(async () => {
    const t = await createTestDatabase(url!);
    drop = t.drop;
    deps = {
      db: t.db,
      secretBox: box,
      limiter: new InMemoryRateLimiter(),
      queue: {
        enqueueSupplierFetch: async () => ({ queued: true }),
        enqueueTrendyol: async () => ({ queued: true }),
        close: async () => {},
      },
      integratorName: "SelfIntegration",
      sessionTtlMs: 3_600_000,
      secureCookies: false,
      redis: { ping: async () => "PONG", get: async () => beat },
    };
    app = await buildApp(deps);
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "o@example.com", password: "guclu-sifre-123", tenantName: "A" },
    });
    cookie = `trendy_session=${res.cookies.find((c) => c.name === "trendy_session")!.value}`;
    tenantId = res.json().tenantId;
  });
  afterAll(async () => {
    await app?.close();
    await drop?.();
  });

  describe("/health/ready", () => {
    it("worker sinyali taze ise 200", async () => {
      beat = new Date().toISOString();
      const res = await app.inject({ method: "GET", url: "/health/ready" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        ok: true,
        checks: { db: { ok: true }, redis: { ok: true }, worker: { ok: true } },
      });
    });

    it("worker sinyali eski veya hiç yoksa 503", async () => {
      beat = new Date(Date.now() - 10 * 60_000).toISOString();
      let res = await app.inject({ method: "GET", url: "/health/ready" });
      expect(res.statusCode).toBe(503);
      expect(res.json().checks.worker).toEqual({ ok: false, detail: "worker yanıt vermiyor" });
      beat = null;
      res = await app.inject({ method: "GET", url: "/health/ready" });
      expect(res.json().checks.worker.detail).toBe("worker hiç başlamadı");
    });

    it("Redis erişilemezse 503, iç ayrıntı sızmaz", async () => {
      const original = deps.redis;
      deps.redis = {
        ping: async () => {
          throw new Error("ECONNREFUSED 10.0.0.5:6379");
        },
        get: async () => null,
      };
      const res = await app.inject({ method: "GET", url: "/health/ready" });
      deps.redis = original!;
      expect(res.statusCode).toBe(503);
      expect(res.body).not.toContain("10.0.0.5");
    });
  });

  describe("/alerts", () => {
    const alerts = async () =>
      (await app.inject({ method: "GET", url: "/alerts", headers: { cookie } })).json() as {
        code: string;
        level: string;
      }[];
    const run = <T>(fn: (t: TenantTx) => Promise<T>) => withTenant(deps.db, tenantId, fn);
    const job = (
      type: string,
      status: "success" | "failed" | "skipped",
      summary: Record<string, unknown> = {},
    ) =>
      run(async (t) => {
        const id = await startJobLog(t, tenantId, type, summary);
        await finishJobLog(t, id, status, summary, status === "failed" ? "hata" : undefined);
      });

    it("oturumsuz 401", async () => {
      expect((await app.inject({ method: "GET", url: "/alerts" })).statusCode).toBe(401);
    });

    it("bağlantı kurulmamışsa bilgi uyarısı", async () => {
      expect((await alerts()).map((a) => a.code)).toEqual(["credentials_unverified"]);
    });

    it("401 hatası, art arda başarısız senkron, siparişlerin gecikmesi ve 426", async () => {
      await run((t) =>
        saveTrendyolCredentials(t, box, {
          tenantId,
          env: "prod",
          sellerId: "1",
          apiKey: "K",
          apiSecret: "S",
        }),
      );
      await run((t) =>
        markTrendyolCredentialsVerified(t, tenantId, "prod", new Date(Date.now() - 3_600_000)),
      );
      for (let i = 0; i < 3; i++) await job("ty_sync", "failed", { errorCode: "server" });
      await job("ty_import", "failed", { errorCode: "auth" });
      await job("ty_orders", "failed", { errorCode: "deprecated_endpoint" });
      const codes = (await alerts()).map((a) => a.code);
      expect(codes).toEqual(
        expect.arrayContaining([
          "credentials_invalid",
          "deprecated_endpoint",
          "sync_failing",
          "orders_stale",
        ]),
      );
      // En kritik önce.
      expect((await alerts())[0]!.level).toBe("critical");
    });

    it("sorun düzelince uyarı kaybolur", async () => {
      await job("ty_import", "success");
      await job("ty_sync", "success");
      await job("ty_orders", "success");
      await run((t) =>
        t.execute(sql`DELETE FROM job_logs WHERE summary->>'errorCode' = 'deprecated_endpoint'`),
      );
      const codes = (await alerts()).map((a) => a.code);
      for (const c of [
        "credentials_invalid",
        "sync_failing",
        "orders_stale",
        "deprecated_endpoint",
      ]) {
        expect(codes).not.toContain(c);
      }
    });

    it("tedarikçi: art arda başarısız, güvenlik freni, yapılandırma ve eşleştirme eksikliği", async () => {
      const [s1, s2, s3] = await run(async (t) => [
        await createSupplier(t, box, tenantId, {
          name: "Bozuk",
          feedUrl: "https://a.example.com/f.xml",
        }),
        await createSupplier(t, box, tenantId, {
          name: "Frenli",
          feedUrl: "https://b.example.com/f.xml",
        }),
        await createSupplier(t, box, tenantId, {
          name: "Eksik",
          feedUrl: "https://c.example.com/f.xml",
        }),
      ]);
      for (let i = 0; i < 3; i++) await job("xml_fetch", "failed", { supplierId: s1 });
      await job("xml_fetch", "success", {
        supplierId: s2,
        shrinkBlocked: { reason: "large_drop", dropRate: 0.6 },
      });
      await job("xml_fetch", "skipped", { supplierId: s3, reason: "config_missing" });
      await run((t) =>
        t
          .insert(schema.supplierProducts)
          .values({ tenantId, supplierId: s2!, externalId: "1", raw: {}, hash: "h" }),
      );
      const list = await alerts();
      const bySupplier = (code: string) =>
        list.find((a) => a.code === code) as { ref?: { id: number } } | undefined;
      expect(bySupplier("supplier_failing")?.ref?.id).toBe(s1);
      expect(bySupplier("supplier_shrink_blocked")?.ref?.id).toBe(s2);
      expect(bySupplier("supplier_config_missing")?.ref?.id).toBe(s3);
      expect(bySupplier("supplier_mapping_missing")?.ref?.id).toBe(s2);
      expect(list.find((a) => a.code === "supplier_shrink_blocked")).toMatchObject({
        message: expect.stringContaining("%60"),
      });

      // Pasif tedarikçi için uyarı yok.
      await run((t) =>
        t.update(schema.suppliers).set({ active: false }).where(eq(schema.suppliers.id, s1!)),
      );
      expect((await alerts()).map((a) => a.code)).not.toContain("supplier_failing");
    });

    it("acil durdurma, fiyat onayı ve kanal hataları", async () => {
      await deps.db
        .update(schema.tenants)
        .set({ syncPaused: true })
        .where(eq(schema.tenants.id, tenantId));
      await run(async (t) => {
        const [p] = await t
          .insert(schema.products)
          .values({ tenantId, productMainId: "M", title: "T" })
          .returning();
        const [v] = await t
          .insert(schema.variants)
          .values({ tenantId, productId: p!.id, barcode: "B", managed: true })
          .returning();
        await t
          .insert(schema.channelListings)
          .values({ tenantId, variantId: v!.id, tyStatus: "approved", lastError: "x" });
        await t
          .insert(schema.priceReviews)
          .values({ tenantId, variantId: v!.id, newPrice: 1, newListPrice: 1, changeRate: 0.5 });
      });
      const codes = (await alerts()).map((a) => a.code);
      expect(codes).toEqual(
        expect.arrayContaining(["sync_paused", "listing_errors", "price_reviews_pending"]),
      );
    });
  });
});
