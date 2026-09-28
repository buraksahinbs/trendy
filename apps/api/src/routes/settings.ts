import { getTenantSettings, updateTenantSettings, withTenant } from "@trendy/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError, requireTenant } from "../app.js";

const patchBody = z
  .object({
    name: z.string().trim().min(1).max(100),
    /** ⚠️ DOĞRULA #7: API'den öğrenilemiyor; satıcı Trendyol panelindeki seviyesini seçer. */
    listingLimitTier: z.enum(["50k", "75k", "150k", "500k", "unlimited"]),
    /** Acil durdurma: tüm stok/fiyat gönderimlerini durdurur. */
    syncPaused: z.boolean(),
    syncEnv: z.enum(["stage", "prod"]),
    safetyStock: z.number().int().min(0).max(1000),
    maxAutoChangeRate: z.number().min(0.01).max(5),
    fxRates: z
      .record(
        z.string().regex(/^[A-Z]{3}$/, "Para birimi 3 harfli kod olmalı (ör. USD)"),
        z.number().positive().max(1_000_000),
      )
      .refine((r) => !("TRY" in r), "TRY için kur girilmez"),
    /** KVKK: kapanmış siparişlerde kişisel verinin silineceği gün (hukuki danışmanlıkla belirlenmeli). */
    orderPiiRetentionDays: z.number().int().min(30).max(3650),
  })
  .partial()
  .strict();

/** Mağaza ayarları (Faz 11 Ayarlar). Değiştirme yalnızca owner. */
export async function settingsRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  app.get("/", async (req) => {
    const { tenantId } = requireTenant(req);
    const s = await withTenant(db, tenantId, (tx) => getTenantSettings(tx, tenantId));
    if (!s) throw new HttpError(404, "not_found", "Mağaza bulunamadı");
    return s;
  });

  app.patch("/", async (req) => {
    const { tenantId } = requireTenant(req, ["owner"]);
    const patch = patchBody.parse(req.body);
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const s = await updateTenantSettings(db, tenantId, clean);
    if (!s) throw new HttpError(404, "not_found", "Mağaza bulunamadı");
    return s;
  });
}
