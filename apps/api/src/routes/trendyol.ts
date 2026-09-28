import {
  listTrendyolCredentialSummaries,
  loadTrendyolCredentials,
  markTrendyolCredentialsVerified,
  saveTrendyolCredentials,
  schema,
  withTenant,
} from "@trendy/db";
import {
  filterApprovedProductsInventoryAndPrice,
  TrendyolAuthError,
  TrendyolClient,
  TrendyolError,
} from "@trendy/trendyol-client";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError, requireTenant } from "../app.js";

const envParam = z.object({ env: z.enum(["stage", "prod"]) });
const credentialsBody = z.object({
  sellerId: z.string().trim().regex(/^\d+$/, "Satıcı ID yalnızca rakamlardan oluşmalı").max(20),
  apiKey: z.string().trim().min(1).max(200),
  apiSecret: z.string().trim().min(1).max(200),
});

export type VerifyResult =
  | { verified: true; verifiedAt: Date; approvedContentCount: number | null }
  | {
      verified: false;
      reason: "invalid_credentials" | "forbidden" | "stage_ip_not_allowed" | "unavailable";
      message: string;
    };

/**
 * Trendyol API bilgileri. Yalnızca owner rolü değiştirebilir ve doğrulayabilir; bilgiler hiçbir
 * yanıtta geri döndürülmez.
 *
 * Doğrulama (ROADMAP Faz 2 "Kimlik doğrulama testi"): tek bir salt-okuma çağrısı yapılır
 * (onaylı ürün stok/fiyat filtresi, size=1; Product Integration Read grubu). Canlı ortamda da
 * güvenlidir, hiçbir veri değiştirmez (DECISIONS: Trendyol erişim stratejisi).
 */
export async function trendyolRoutes(app: FastifyInstance) {
  const { db, secretBox } = app.deps;

  app.get("/credentials", async (req) => {
    const { tenantId } = requireTenant(req);
    return withTenant(db, tenantId, (tx) =>
      listTrendyolCredentialSummaries(tx, secretBox, tenantId),
    );
  });

  app.put("/credentials/:env", async (req, reply) => {
    const { tenantId } = requireTenant(req, ["owner"]);
    const { env } = envParam.parse(req.params);
    const body = credentialsBody.parse(req.body);
    await withTenant(db, tenantId, (tx) =>
      saveTrendyolCredentials(tx, secretBox, { tenantId, env, ...body }),
    );
    return reply.status(204).send();
  });

  app.post("/credentials/:env/verify", async (req): Promise<VerifyResult> => {
    const { tenantId } = requireTenant(req, ["owner"]);
    const { env } = envParam.parse(req.params);
    const loaded = await withTenant(db, tenantId, async (tx) => {
      const creds = await loadTrendyolCredentials(tx, secretBox, tenantId, env);
      const [tenant] = await tx
        .select({ tier: schema.tenants.listingLimitTier })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, tenantId));
      return creds && tenant ? { creds, tier: tenant.tier } : undefined;
    });
    if (!loaded) throw new HttpError(404, "not_found", "Bu ortam için API bilgisi kayıtlı değil");

    const client = new TrendyolClient({
      env,
      sellerId: loaded.creds.sellerId,
      apiKey: loaded.creds.apiKey,
      apiSecret: loaded.creds.apiSecret,
      integratorName: app.deps.integratorName,
      tier: loaded.tier,
      limiter: app.deps.limiter,
      logger: req.log,
      // Kullanıcı sonucu bekliyor: sunucu hatasında uzun tekrar denemesi yapılmaz.
      maxServerRetries: 0,
      maxRateLimitRetries: 2,
      requestTimeoutMs: 15_000,
      ...app.deps.trendyolClientOptions,
    });

    try {
      const page = await filterApprovedProductsInventoryAndPrice(client, { page: 0, size: 1 });
      const verifiedAt = app.deps.now?.() ?? new Date();
      await withTenant(db, tenantId, (tx) =>
        markTrendyolCredentialsVerified(tx, tenantId, env, verifiedAt),
      );
      return { verified: true, verifiedAt, approvedContentCount: page.totalElements ?? null };
    } catch (err) {
      if (err instanceof TrendyolAuthError) {
        return err.status === 401
          ? {
              verified: false,
              reason: "invalid_credentials",
              message: "Satıcı ID, API Key veya API Secret hatalı (401).",
            }
          : {
              verified: false,
              reason: "forbidden",
              message: "Trendyol isteği reddetti (403). Hesabın API erişim yetkisini kontrol edin.",
            };
      }
      if (err instanceof TrendyolError && env === "stage" && err.status === 503) {
        return {
          verified: false,
          reason: "stage_ip_not_allowed",
          message:
            "Test ortamı 503 döndü: sunucu IP adresi Trendyol'da yetkilendirilmemiş. IP yetkilendirmesi için Trendyol'a başvurun.",
        };
      }
      req.log.warn({ err }, "Trendyol doğrulama çağrısı başarısız");
      return {
        verified: false,
        reason: "unavailable",
        message: "Trendyol'a şu an ulaşılamadı; biraz sonra tekrar deneyin.",
      };
    }
  });
}
