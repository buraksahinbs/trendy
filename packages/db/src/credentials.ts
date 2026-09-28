import type { SecretBox } from "@trendy/shared";
import { and, eq, sql } from "drizzle-orm";
import type { TenantTx } from "./client.js";
import { trendyolCredentials } from "./schema.js";

export type TrendyolEnvName = "stage" | "prod";

export interface TrendyolCredentials {
  tenantId: number;
  env: TrendyolEnvName;
  sellerId: string;
  apiKey: string;
  apiSecret: string;
  verifiedAt: Date | null;
}

/** Şifreleme bağlamı: değer yalnızca kendi tenant/ortam/alan satırında çözülebilir. */
const context = (tenantId: number, env: TrendyolEnvName, field: "api_key" | "api_secret") =>
  `tenant:${tenantId}:trendyol:${env}:${field}`;

/**
 * API bilgilerini şifreleyip kaydeder. Bilgi değişince `verified_at` sıfırlanır: yeni bilgiler
 * yeniden doğrulanmadan senkron başlamamalı.
 */
export async function saveTrendyolCredentials(
  tx: TenantTx,
  box: SecretBox,
  input: Omit<TrendyolCredentials, "verifiedAt">,
): Promise<void> {
  if (!/^\d+$/.test(input.sellerId)) throw new Error("sellerId yalnızca rakamlardan oluşmalı");
  const row = {
    tenantId: input.tenantId,
    env: input.env,
    sellerId: input.sellerId,
    apiKeyEnc: box.encrypt(input.apiKey, context(input.tenantId, input.env, "api_key")),
    apiSecretEnc: box.encrypt(input.apiSecret, context(input.tenantId, input.env, "api_secret")),
    verifiedAt: null,
    updatedAt: new Date(),
  };
  await tx
    .insert(trendyolCredentials)
    .values(row)
    .onConflictDoUpdate({
      target: [trendyolCredentials.tenantId, trendyolCredentials.env],
      set: {
        sellerId: row.sellerId,
        apiKeyEnc: row.apiKeyEnc,
        apiSecretEnc: row.apiSecretEnc,
        verifiedAt: null,
        updatedAt: sql`now()`,
      },
    });
}

export async function loadTrendyolCredentials(
  tx: TenantTx,
  box: SecretBox,
  tenantId: number,
  env: TrendyolEnvName,
): Promise<TrendyolCredentials | undefined> {
  const [row] = await tx
    .select()
    .from(trendyolCredentials)
    .where(and(eq(trendyolCredentials.tenantId, tenantId), eq(trendyolCredentials.env, env)));
  if (!row) return undefined;
  return {
    tenantId,
    env,
    sellerId: row.sellerId,
    apiKey: box.decrypt(row.apiKeyEnc, context(tenantId, env, "api_key")),
    apiSecret: box.decrypt(row.apiSecretEnc, context(tenantId, env, "api_secret")),
    verifiedAt: row.verifiedAt,
  };
}

export async function markTrendyolCredentialsVerified(
  tx: TenantTx,
  tenantId: number,
  env: TrendyolEnvName,
  at: Date = new Date(),
): Promise<void> {
  await tx
    .update(trendyolCredentials)
    .set({ verifiedAt: at })
    .where(and(eq(trendyolCredentials.tenantId, tenantId), eq(trendyolCredentials.env, env)));
}

/** Anahtar rotasyonu: eski sürümle şifrelenmiş kayıtları güncel anahtarla yeniden şifreler. */
export async function rotateTrendyolCredentials(tx: TenantTx, box: SecretBox): Promise<number> {
  const rows = await tx.select().from(trendyolCredentials);
  let rotated = 0;
  for (const row of rows) {
    if (!box.needsRotation(row.apiKeyEnc) && !box.needsRotation(row.apiSecretEnc)) continue;
    const env = row.env;
    const keyCtx = context(row.tenantId, env, "api_key");
    const secretCtx = context(row.tenantId, env, "api_secret");
    await tx
      .update(trendyolCredentials)
      .set({
        apiKeyEnc: box.encrypt(box.decrypt(row.apiKeyEnc, keyCtx), keyCtx),
        apiSecretEnc: box.encrypt(box.decrypt(row.apiSecretEnc, secretCtx), secretCtx),
      })
      .where(and(eq(trendyolCredentials.tenantId, row.tenantId), eq(trendyolCredentials.env, env)));
    rotated++;
  }
  return rotated;
}
