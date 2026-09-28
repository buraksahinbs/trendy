import { timingSafeEqual, randomBytes, createHash } from "node:crypto";
import {
  findOrderWebhookByToken,
  getOrder,
  getOrderWebhook,
  listOrders,
  saveOrderWebhook,
  touchOrderWebhook,
  upsertOrder,
  withTenant,
} from "@trendy/db";
import { ORDER_HISTORY_MS, parseWebhookPackages, toOrderInput } from "@trendy/trendyol-client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError, requireTenant } from "../app.js";

const listQuery = z.object({
  status: z.string().trim().min(1).max(40).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const idParam = z.object({ id: z.coerce.number().int().positive() });
const backfillBody = z
  .object({ from: z.coerce.date(), to: z.coerce.date() })
  .refine((b) => b.to > b.from, { message: "Bitiş başlangıçtan sonra olmalı", path: ["to"] });

const defined = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };

/** Siparişler ekranı (Faz 10/11). Liste kişisel veri içermez; adres yalnızca owner'a. */
export async function orderRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  app.get("/", async (req) => {
    const { tenantId } = requireTenant(req);
    const q = listQuery.parse(req.query);
    return withTenant(db, tenantId, (tx) =>
      listOrders(tx, { ...defined(q), limit: q.limit, offset: q.offset }),
    );
  });

  app.get("/:id", async (req) => {
    const { tenantId, role } = requireTenant(req);
    const { id } = idParam.parse(req.params);
    const o = await withTenant(db, tenantId, (tx) => getOrder(tx, id, role === "owner"));
    if (!o) throw new HttpError(404, "not_found", "Sipariş bulunamadı");
    return o;
  });

  app.post("/sync", async (req, reply) => {
    const { tenantId } = requireTenant(req, ["owner"]);
    return reply
      .status(202)
      .send(await app.deps.queue.enqueueTrendyol({ kind: "orders", tenantId }));
  });

  /** Backfill aracı: Trendyol kesinti duyurularında belirli aralık yeniden çekilir (son 3 ay). */
  app.post("/backfill", async (req, reply) => {
    const { tenantId } = requireTenant(req, ["owner"]);
    const { from, to } = backfillBody.parse(req.body);
    const now = app.deps.now?.() ?? new Date();
    if (from.getTime() < now.getTime() - ORDER_HISTORY_MS) {
      throw new HttpError(400, "too_old", "Trendyol yalnızca son 3 ayın siparişlerini veriyor");
    }
    if (to > now) throw new HttpError(400, "future", "Bitiş tarihi gelecekte olamaz");
    const r = await app.deps.queue.enqueueTrendyol({
      kind: "orders_backfill",
      tenantId,
      from: from.toISOString(),
      to: to.toISOString(),
    });
    return reply.status(202).send(r);
  });
}

const tokenHash = (v: string) => createHash("sha256").update(v).digest();
const webhookContext = (tenantId: number) => `tenant:${tenantId}:order_webhook:api_key`;

/**
 * Webhook ayarı: tenant başına tahmin edilemez URL + `x-api-key`. Anahtar yalnızca oluşturulurken
 * bir kez gösterilir. URL'de "trendyol", "dolap", "localhost" geçmemeli (Trendyol kuralı).
 */
export async function orderWebhookSettingsRoutes(app: FastifyInstance) {
  const { db, secretBox } = app.deps;
  const urlFor = (token: string) => `${app.deps.publicBaseUrl ?? ""}/hooks/o/${token}`;

  app.get("/", async (req) => {
    const { tenantId } = requireTenant(req, ["owner"]);
    const w = await withTenant(db, tenantId, (tx) => getOrderWebhook(tx));
    if (!w) return { configured: false };
    return {
      configured: true,
      url: urlFor(w.token),
      authenticationType: "API_KEY",
      lastReceivedAt: w.lastReceivedAt,
      trendyolWebhookId: w.trendyolWebhookId,
    };
  });

  /** Yeni URL ve anahtar üretir (eskisi geçersiz olur). */
  app.post("/", async (req, reply) => {
    const { tenantId } = requireTenant(req, ["owner"]);
    const token = randomBytes(24).toString("base64url");
    const apiKey = randomBytes(32).toString("base64url");
    await withTenant(db, tenantId, (tx) =>
      saveOrderWebhook(tx, tenantId, token, secretBox.encrypt(apiKey, webhookContext(tenantId))),
    );
    return reply.status(201).send({ url: urlFor(token), authenticationType: "API_KEY", apiKey });
  });
}

/**
 * Trendyol'dan gelen webhook (oturumsuz). Token ile tenant bulunur, `x-api-key` sabit zamanlı
 * karşılaştırılır, paketler polling ile aynı `upsertOrder` fonksiyonundan geçer (idempotent;
 * eski veri yeniyi ezmez). Webhook yalnızca hızlandırıcıdır; asıl güvence polling'dir.
 */
export async function orderWebhookReceiver(app: FastifyInstance) {
  const { db, secretBox } = app.deps;

  app.post("/o/:token", async (req, reply) => {
    const { token } = z.object({ token: z.string().min(16).max(64) }).parse(req.params);
    const hook = await findOrderWebhookByToken(db, token);
    if (!hook) throw new HttpError(404, "not_found", "Bulunamadı");
    const given = req.headers["x-api-key"];
    const expected = secretBox.decrypt(hook.apiKeyEnc, webhookContext(hook.tenantId));
    if (typeof given !== "string" || !timingSafeEqual(tokenHash(given), tokenHash(expected))) {
      throw new HttpError(401, "unauthorized", "Geçersiz anahtar");
    }
    let packages;
    try {
      packages = parseWebhookPackages(req.body);
    } catch (err) {
      req.log.warn({ err, tenantId: hook.tenantId }, "webhook gövdesi okunamadı");
      throw new HttpError(400, "invalid_payload", "Geçersiz sipariş verisi");
    }
    const results = await withTenant(db, hook.tenantId, async (tx) => {
      const out = { created: 0, updated: 0, stale: 0 };
      for (const p of packages) out[await upsertOrder(tx, hook.tenantId, toOrderInput(p))]++;
      await touchOrderWebhook(tx);
      return out;
    });
    req.log.info({ tenantId: hook.tenantId, ...results }, "webhook işlendi");
    return reply.status(200).send({ ok: true });
  });
}
