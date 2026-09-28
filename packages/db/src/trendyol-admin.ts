import { and, count, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { Db, TenantTx } from "./client.js";
import {
  channelListings,
  jobLogs,
  priceReviews,
  products,
  tenants,
  tyBatches,
  variants,
} from "./schema.js";
import type { ListingStatus } from "./channel.js";

/** Panel için Trendyol senkron durumu özeti. */
export async function trendyolStatus(tx: TenantTx, tenantId: number) {
  const [settings] = await tx
    .select({ syncPaused: tenants.syncPaused, syncEnv: tenants.syncEnv })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  const lastJob = async (jobType: string) =>
    (
      await tx
        .select({
          status: jobLogs.status,
          summary: jobLogs.summary,
          error: jobLogs.error,
          startedAt: jobLogs.startedAt,
          finishedAt: jobLogs.finishedAt,
        })
        .from(jobLogs)
        .where(eq(jobLogs.jobType, jobType))
        .orderBy(desc(jobLogs.startedAt), desc(jobLogs.id))
        .limit(1)
    )[0] ?? null;
  const byStatus = await tx
    .select({ status: channelListings.tyStatus, count: count() })
    .from(channelListings)
    .groupBy(channelListings.tyStatus);
  const [errors] = await tx
    .select({ count: count() })
    .from(channelListings)
    .where(isNotNull(channelListings.lastError));
  const [managed] = await tx
    .select({ count: count() })
    .from(variants)
    .where(eq(variants.managed, true));
  const [pendingBatches] = await tx
    .select({ count: count() })
    .from(tyBatches)
    .where(eq(tyBatches.status, "pending"));
  const [pendingReviews] = await tx
    .select({ count: count() })
    .from(priceReviews)
    .where(eq(priceReviews.status, "pending"));
  return {
    syncPaused: settings?.syncPaused ?? false,
    syncEnv: settings?.syncEnv ?? "prod",
    lastSync: await lastJob("ty_sync"),
    lastImport: await lastJob("ty_import"),
    listings: Object.fromEntries(byStatus.map((r) => [r.status, r.count])) as Partial<
      Record<ListingStatus, number>
    >,
    managedVariants: managed?.count ?? 0,
    listingErrors: errors?.count ?? 0,
    pendingBatches: pendingBatches?.count ?? 0,
    pendingReviews: pendingReviews?.count ?? 0,
  };
}

export interface ListingFilter {
  status?: ListingStatus;
  hasError?: boolean;
  managed?: boolean;
  search?: string;
  limit: number;
  offset: number;
}

/** Ürünler ekranı: varyant + Trendyol kanal durumu (Faz 11). */
export async function listListings(tx: TenantTx, f: ListingFilter) {
  const conds = [
    f.status ? eq(channelListings.tyStatus, f.status) : undefined,
    f.hasError === true ? isNotNull(channelListings.lastError) : undefined,
    f.managed !== undefined ? eq(variants.managed, f.managed) : undefined,
    f.search
      ? sql`(${variants.barcode} ILIKE ${`%${f.search}%`} OR ${products.title} ILIKE ${`%${f.search}%`} OR ${products.productMainId} ILIKE ${`%${f.search}%`})`
      : undefined,
  ].filter(Boolean);
  const where = conds.length ? and(...conds) : undefined;
  const base = () =>
    tx
      .select({
        variantId: variants.id,
        barcode: variants.barcode,
        stockCode: variants.stockCode,
        managed: variants.managed,
        stock: variants.stock,
        costPrice: variants.costPrice,
        currency: variants.currency,
        productMainId: products.productMainId,
        title: products.title,
        brandName: products.brandName,
        tyStatus: channelListings.tyStatus,
        tyOnSale: channelListings.tyOnSale,
        lockReason: channelListings.lockReason,
        tyPrice: channelListings.tyPrice,
        tyListPrice: channelListings.tyListPrice,
        tyStock: channelListings.tyStock,
        lastSentStock: channelListings.lastSentStock,
        lastSentPrice: channelListings.lastSentPrice,
        lastSentAt: channelListings.lastSentAt,
        lastError: channelListings.lastError,
        rejectReasons: channelListings.rejectReasons,
      })
      .from(variants)
      .innerJoin(products, eq(products.id, variants.productId))
      .leftJoin(channelListings, eq(channelListings.variantId, variants.id));
  const [total] = await tx
    .select({ count: count() })
    .from(variants)
    .innerJoin(products, eq(products.id, variants.productId))
    .leftJoin(channelListings, eq(channelListings.variantId, variants.id))
    .where(where);
  const items = await base().where(where).orderBy(variants.id).limit(f.limit).offset(f.offset);
  return { total: total?.count ?? 0, items };
}

// ── Fiyat onay kuyruğu ──────────────────────────────────────────────────────

export function listPriceReviews(
  tx: TenantTx,
  status: "pending" | "approved" | "rejected",
  limit: number,
) {
  return tx
    .select({
      id: priceReviews.id,
      variantId: priceReviews.variantId,
      barcode: variants.barcode,
      title: products.title,
      oldPrice: priceReviews.oldPrice,
      newPrice: priceReviews.newPrice,
      newListPrice: priceReviews.newListPrice,
      changeRate: priceReviews.changeRate,
      status: priceReviews.status,
      createdAt: priceReviews.createdAt,
      decidedAt: priceReviews.decidedAt,
    })
    .from(priceReviews)
    .innerJoin(variants, eq(variants.id, priceReviews.variantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .where(eq(priceReviews.status, status))
    .orderBy(desc(priceReviews.createdAt))
    .limit(limit);
}

/**
 * Bekleyen fiyat incelemesine karar verir. Onaylanan fiyat bir sonraki senkronda guardrail'e
 * takılmadan gönderilir; reddedilen fiyat gönderilmez (hesap değişirse yeni inceleme açılır).
 */
export async function decidePriceReview(
  tx: TenantTx,
  id: number,
  decision: "approved" | "rejected",
  userId: number,
): Promise<boolean> {
  const rows = await tx
    .update(priceReviews)
    .set({ status: decision, decidedAt: sql`now()`, decidedBy: userId })
    .where(and(eq(priceReviews.id, id), eq(priceReviews.status, "pending")))
    .returning({ id: priceReviews.id });
  return rows.length > 0;
}

// ── Mağaza ayarları ─────────────────────────────────────────────────────────

export interface TenantSettings {
  name: string;
  listingLimitTier: "50k" | "75k" | "150k" | "500k" | "unlimited";
  syncPaused: boolean;
  syncEnv: "stage" | "prod";
  safetyStock: number;
  maxAutoChangeRate: number;
  fxRates: Record<string, number>;
}

const settingsColumns = {
  name: tenants.name,
  listingLimitTier: tenants.listingLimitTier,
  syncPaused: tenants.syncPaused,
  syncEnv: tenants.syncEnv,
  safetyStock: tenants.safetyStock,
  maxAutoChangeRate: tenants.maxAutoChangeRate,
  fxRates: tenants.fxRates,
};

export async function getTenantSettings(
  tx: TenantTx,
  tenantId: number,
): Promise<TenantSettings | undefined> {
  const [row] = await tx.select(settingsColumns).from(tenants).where(eq(tenants.id, tenantId));
  return row;
}

/**
 * Ayar güncelleme. `tenants` tablosunda uygulama rolünün yalnızca okuma yetkisi olduğu için
 * sistem bağlantısıyla yapılır; çağıran, kullanıcının bu tenant'ın owner'ı olduğunu doğrulamış
 * olmalıdır (API: `requireTenant(req, ["owner"])`).
 */
export async function updateTenantSettings(
  db: Db,
  tenantId: number,
  patch: Partial<TenantSettings>,
): Promise<TenantSettings | undefined> {
  if (Object.keys(patch).length === 0) {
    const [row] = await db.select(settingsColumns).from(tenants).where(eq(tenants.id, tenantId));
    return row;
  }
  const [row] = await db
    .update(tenants)
    .set(patch)
    .where(eq(tenants.id, tenantId))
    .returning(settingsColumns);
  return row;
}
