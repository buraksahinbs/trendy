import {
  createPricingRule,
  deletePricingRule,
  isUniqueViolation,
  listPricingRules,
  updatePricingRule,
  withTenant,
  type PricingRuleInput,
} from "@trendy/db";
import { calculatePrice, type PricingRule } from "@trendy/pricing";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError, requireTenant } from "../app.js";

const idParam = z.object({ id: z.coerce.number().int().positive() });
const kurus = z.number().int().min(1).max(100_000_000);
const rate = z.number().min(0).max(0.9);

/**
 * Fiyat kuralı (ROADMAP Faz 7). Tutarlar kuruş; oranlar 0–1. En spesifik kural kazanır:
 * marka > kategori > tedarikçi > genel. Marka ve kategori, feed'deki değerle birebir eşleşir.
 */
const ruleBody = z
  .object({
    scope: z.enum(["brand", "category", "supplier", "general"]),
    scopeKey: z.string().trim().min(1).max(200).nullable().default(null),
    multiplier: z.number().min(0.1).max(20),
    addFixed: z.number().int().min(0).max(100_000_000).default(0),
    rounding: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("none") }),
        z.object({ kind: z.literal("ending"), kurus: z.number().int().min(0).max(99) }),
      ])
      .default({ kind: "none" }),
    minMarginRate: rate.nullable().default(null),
    commissionRate: rate.nullable().default(null),
    minPrice: kurus.nullable().default(null),
    maxPrice: kurus.nullable().default(null),
    listPriceRule: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("same") }),
        z.object({ kind: z.literal("multiplier"), value: z.number().min(1).max(5) }),
      ])
      .default({ kind: "same" }),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.scope === "general" && r.scopeKey !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["scopeKey"],
        message: "Genel kuralda kapsam değeri olmaz",
      });
    }
    if (r.scope !== "general" && r.scopeKey === null) {
      ctx.addIssue({ code: "custom", path: ["scopeKey"], message: "Kapsam değeri girilmeli" });
    }
    if (r.scope === "supplier" && r.scopeKey !== null && !/^\d+$/.test(r.scopeKey)) {
      ctx.addIssue({ code: "custom", path: ["scopeKey"], message: "Tedarikçi seçilmeli" });
    }
    if (r.minPrice !== null && r.maxPrice !== null && r.maxPrice < r.minPrice) {
      ctx.addIssue({
        code: "custom",
        path: ["maxPrice"],
        message: "Azami fiyat asgari fiyattan küçük olamaz",
      });
    }
  });

const previewBody = z.object({
  rule: ruleBody,
  /** Örnek maliyet (kuruş, tedarikçi para biriminde) ve kur. */
  cost: kurus,
  fxRate: z.number().positive().max(1_000_000).default(1),
  lastSentSalePrice: kurus.optional(),
  maxAutoChangeRate: z.number().min(0.01).max(5).default(0.3),
});

/** DB biçimi → hesap motoru biçimi (null alanlar yok sayılır). */
function toEngineRule(r: PricingRuleInput): PricingRule {
  return {
    id: "preview",
    scope: r.scope,
    ...(r.scopeKey !== null ? { scopeKey: r.scopeKey } : {}),
    multiplier: r.multiplier,
    addFixed: r.addFixed,
    rounding: r.rounding,
    ...(r.minMarginRate !== null ? { minMarginRate: r.minMarginRate } : {}),
    ...(r.commissionRate !== null ? { commissionRate: r.commissionRate } : {}),
    ...(r.minPrice !== null ? { minPrice: r.minPrice } : {}),
    ...(r.maxPrice !== null ? { maxPrice: r.maxPrice } : {}),
    listPriceRule: r.listPriceRule,
  };
}

const conflict = () =>
  new HttpError(409, "duplicate_scope", "Bu kapsam için zaten bir kural var; onu düzenleyin");
const notFound = () => new HttpError(404, "not_found", "Kural bulunamadı");

export async function pricingRoutes(app: FastifyInstance) {
  const { db, queue } = app.deps;

  app.get("/", async (req) => {
    const { tenantId } = requireTenant(req);
    return withTenant(db, tenantId, (tx) => listPricingRules(tx));
  });

  // Kural değişince fiyatlar yeniden hesaplansın diye senkron kuyruğa eklenir.
  const resync = (tenantId: number) => queue.enqueueTrendyol({ kind: "sync", tenantId });

  /** Kaydetmeden örnek hesap: senkronla aynı motor (`calculatePrice`) kullanılır. */
  app.post("/preview", async (req) => {
    requireTenant(req);
    const b = previewBody.parse(req.body);
    return calculatePrice(
      {
        cost: b.cost,
        fxRate: b.fxRate,
        ...(b.lastSentSalePrice !== undefined ? { lastSentSalePrice: b.lastSentSalePrice } : {}),
      },
      toEngineRule(b.rule as PricingRuleInput),
      { maxAutoChangeRate: b.maxAutoChangeRate },
    );
  });

  app.post("/", async (req, reply) => {
    const { tenantId } = requireTenant(req, ["owner"]);
    const input = ruleBody.parse(req.body) as PricingRuleInput;
    try {
      const rule = await withTenant(db, tenantId, (tx) => createPricingRule(tx, tenantId, input));
      await resync(tenantId);
      return reply.status(201).send(rule);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict();
      throw err;
    }
  });

  app.put("/:id", async (req) => {
    const { tenantId } = requireTenant(req, ["owner"]);
    const { id } = idParam.parse(req.params);
    const input = ruleBody.parse(req.body) as PricingRuleInput;
    try {
      const rule = await withTenant(db, tenantId, (tx) => updatePricingRule(tx, id, input));
      if (!rule) throw notFound();
      await resync(tenantId);
      return rule;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict();
      throw err;
    }
  });

  app.delete("/:id", async (req, reply) => {
    const { tenantId } = requireTenant(req, ["owner"]);
    const { id } = idParam.parse(req.params);
    if (!(await withTenant(db, tenantId, (tx) => deletePricingRule(tx, id)))) throw notFound();
    await resync(tenantId);
    return reply.status(204).send();
  });
}
