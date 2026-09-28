import { listTrendyolCredentialSummaries, saveTrendyolCredentials, withTenant } from "@trendy/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireTenant } from "../app.js";

const envParam = z.object({ env: z.enum(["stage", "prod"]) });
const credentialsBody = z.object({
  sellerId: z.string().trim().regex(/^\d+$/, "Satıcı ID yalnızca rakamlardan oluşmalı").max(20),
  apiKey: z.string().trim().min(1).max(200),
  apiSecret: z.string().trim().min(1).max(200),
});

/**
 * Trendyol API bilgileri. Yalnızca owner rolü değiştirebilir; bilgiler hiçbir yanıtta
 * geri döndürülmez.
 *
 * Kimlik doğrulama çağrısı (Faz 2, "Kimlik doğrulama testi") hangi endpoint'le yapılacağı
 * resmi dokümandan seçilince eklenecek; o zamana kadar `verifiedAt` null kalır.
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
}
