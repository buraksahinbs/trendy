import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import type { Db, TenantTx } from "./client.js";
import {
  channelListings,
  priceReviews,
  pricingRules,
  products,
  supplierProducts,
  suppliers,
  tenants,
  tyBatches,
  variants,
} from "./schema.js";

/**
 * Trendyol kanal durumu ve stok/fiyat senkronu için veri erişimi (ROADMAP Faz 8-9).
 * Tutarlar kuruş, stoklar adet.
 */

export type ListingStatus =
  "unknown" | "pending" | "approved" | "rejected" | "locked" | "archived" | "blacklisted";

// ── Senkron bağlamı ──────────────────────────────────────────────────────────

export async function loadSyncSettings(tx: TenantTx, tenantId: number) {
  const [t] = await tx
    .select({
      syncPaused: tenants.syncPaused,
      syncEnv: tenants.syncEnv,
      tier: tenants.listingLimitTier,
      safetyStock: tenants.safetyStock,
      maxAutoChangeRate: tenants.maxAutoChangeRate,
      fxRates: tenants.fxRates,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!t) return undefined;
  const rules = await tx.select().from(pricingRules).orderBy(asc(pricingRules.id));
  return {
    ...t,
    rules: rules.map((r) => ({
      id: String(r.id),
      scope: r.scope,
      ...(r.scopeKey !== null ? { scopeKey: r.scopeKey } : {}),
      multiplier: r.multiplier,
      addFixed: r.addFixed,
      rounding: r.rounding as { kind: "none" } | { kind: "ending"; kurus: number },
      ...(r.minMarginRate !== null ? { minMarginRate: r.minMarginRate } : {}),
      ...(r.commissionRate !== null ? { commissionRate: r.commissionRate } : {}),
      ...(r.minPrice !== null ? { minPrice: r.minPrice } : {}),
      ...(r.maxPrice !== null ? { maxPrice: r.maxPrice } : {}),
      listPriceRule: r.listPriceRule as { kind: "same" } | { kind: "multiplier"; value: number },
    })),
  };
}

/**
 * Senkron adayları (id sırasıyla, sayfalı): yönetilen ve Trendyol'da onaylı varyantlar.
 * Kararı `planSync` verir; burada yalnızca gereksiz satırlar elenir.
 */
export async function listSyncCandidates(tx: TenantTx, afterVariantId: number, limit: number) {
  const rows = await tx
    .select({
      variantId: variants.id,
      barcode: variants.barcode,
      managed: variants.managed,
      supplierProductId: variants.supplierProductId,
      stock: variants.stock,
      costPrice: variants.costPrice,
      currency: variants.currency,
      brandName: products.brandName,
      sourceCategory: products.sourceCategory,
      supplierId: supplierProducts.supplierId,
      missingSince: supplierProducts.missingSince,
      supplierPaused: suppliers.syncPaused,
      supplierActive: suppliers.active,
      mapping: suppliers.mapping,
      tyStatus: channelListings.tyStatus,
      lastSentPrice: channelListings.lastSentPrice,
      lastSentListPrice: channelListings.lastSentListPrice,
      lastSentStock: channelListings.lastSentStock,
      tyPrice: channelListings.tyPrice,
      approvedPrice: sql<number | null>`(
        SELECT pr.new_price FROM ${priceReviews} pr
        WHERE pr.variant_id = "variants"."id" AND pr.status = 'approved'
        ORDER BY pr.decided_at DESC NULLS LAST LIMIT 1
      )`,
    })
    .from(variants)
    .innerJoin(products, eq(products.id, variants.productId))
    .innerJoin(channelListings, eq(channelListings.variantId, variants.id))
    .leftJoin(supplierProducts, eq(supplierProducts.id, variants.supplierProductId))
    .leftJoin(suppliers, eq(suppliers.id, supplierProducts.supplierId))
    .where(
      and(
        gt(variants.id, afterVariantId),
        eq(variants.managed, true),
        eq(channelListings.tyStatus, "approved"),
      ),
    )
    .orderBy(asc(variants.id))
    .limit(limit);
  return rows.map((r) => ({
    variantId: r.variantId,
    barcode: r.barcode,
    managed: r.managed,
    supplierOwned: r.supplierProductId !== null,
    supplierId: r.supplierId,
    supplierMissing: r.missingSince !== null,
    // Pasif tedarikçi de duraklatılmış sayılır: verisi güncel değildir.
    supplierPaused: r.supplierPaused === true || r.supplierActive === false,
    missingPolicy:
      (r.mapping as { missingPolicy?: string } | null)?.missingPolicy === "keep"
        ? ("keep" as const)
        : ("zero_stock" as const),
    stock: r.stock,
    costPrice: r.costPrice,
    currency: r.currency,
    brandName: r.brandName,
    sourceCategory: r.sourceCategory,
    listing: {
      tyStatus: r.tyStatus,
      lastSentPrice: r.lastSentPrice,
      lastSentListPrice: r.lastSentListPrice,
      lastSentStock: r.lastSentStock,
      tyPrice: r.tyPrice,
    },
    approvedPrice: r.approvedPrice === null ? null : Number(r.approvedPrice),
  }));
}

export interface SentItem {
  variantId: number;
  sent: { stock?: number; price?: number; listPrice?: number };
}

/**
 * Gönderimi kaydeder: son gönderilen değerler hemen yazılır (aynı değer tekrar gönderilmesin);
 * batch sonucunda başarısız olanlar sıfırlanır ve bir sonraki turda yeniden gönderilir.
 */
export async function recordSentBatch(
  tx: TenantTx,
  tenantId: number,
  batchRequestId: string,
  items: SentItem[],
): Promise<void> {
  // Trendyol'a gönderim zaten yapıldı: kayıt hiçbir koşulda başarısız olmamalı, yoksa aynı
  // değerler 15 dk içinde tekrar gönderilip reddedilir.
  await tx
    .insert(tyBatches)
    .values({ tenantId, type: "price_inventory", batchRequestId, itemCount: items.length })
    .onConflictDoNothing();
  for (const i of items) {
    await tx
      .update(channelListings)
      .set({
        ...(i.sent.stock !== undefined ? { lastSentStock: i.sent.stock } : {}),
        ...(i.sent.price !== undefined ? { lastSentPrice: i.sent.price } : {}),
        ...(i.sent.listPrice !== undefined ? { lastSentListPrice: i.sent.listPrice } : {}),
        lastSentAt: sql`now()`,
        lastBatchRequestId: batchRequestId,
        updatedAt: sql`now()`,
      })
      .where(eq(channelListings.variantId, i.variantId));
  }
}

export interface PriceReviewInput {
  variantId: number;
  oldPrice: number | null;
  newPrice: number;
  newListPrice: number;
  changeRate: number;
  ruleId: string;
}

/** Guardrail'e takılan fiyatlar: varyant başına tek bekleyen kayıt (yenisi eskisini günceller). */
export async function upsertPriceReviews(
  tx: TenantTx,
  tenantId: number,
  reviews: PriceReviewInput[],
): Promise<void> {
  for (const r of reviews) {
    const values = {
      oldPrice: r.oldPrice,
      newPrice: r.newPrice,
      newListPrice: r.newListPrice,
      changeRate: Math.round(r.changeRate * 10_000) / 10_000,
      ruleId: Number(r.ruleId),
    };
    await tx
      .insert(priceReviews)
      .values({ tenantId, variantId: r.variantId, ...values })
      .onConflictDoUpdate({
        target: priceReviews.variantId,
        targetWhere: sql`${priceReviews.status} = 'pending'`,
        set: { ...values, createdAt: sql`now()` },
      });
  }
}

// ── Batch sonuçları ──────────────────────────────────────────────────────────

/** Sonucu beklenen stok/fiyat batch'leri (sistem bağlantısı, tüm tenant'lar). */
export function listPendingBatches(db: Db) {
  return db
    .select({
      id: tyBatches.id,
      tenantId: tyBatches.tenantId,
      batchRequestId: tyBatches.batchRequestId,
      sentAt: tyBatches.sentAt,
    })
    .from(tyBatches)
    .where(and(eq(tyBatches.status, "pending"), eq(tyBatches.type, "price_inventory")))
    .orderBy(asc(tyBatches.sentAt));
}

export interface BatchItemResult {
  barcode: string;
  status: "SUCCESS" | "FAILED";
  failureReasons: string[];
}

/**
 * Tamamlanan batch'i işler: başarısız öğelerin son gönderim değerleri sıfırlanır (bir sonraki
 * turda yeniden gönderilir) ve hata yazılır; başarılıların hatası temizlenir.
 */
export async function applyBatchResult(
  tx: TenantTx,
  batchId: number,
  batchRequestId: string,
  items: BatchItemResult[],
): Promise<{ succeeded: number; failed: number }> {
  const failed = items.filter((i) => i.status === "FAILED");
  const succeeded = items.filter((i) => i.status === "SUCCESS");
  const variantIdsFor = async (barcodes: string[]) =>
    barcodes.length
      ? (
          await tx
            .select({ id: variants.id, barcode: variants.barcode })
            .from(variants)
            .where(inArray(variants.barcode, barcodes))
        ).reduce((m, v) => m.set(v.barcode, v.id), new Map<string, number>())
      : new Map<string, number>();

  const failedIds = await variantIdsFor(failed.map((f) => f.barcode));
  for (const f of failed) {
    const id = failedIds.get(f.barcode);
    if (id === undefined) continue;
    await tx
      .update(channelListings)
      .set({
        lastSentStock: null,
        lastSentPrice: null,
        lastSentListPrice: null,
        lastError: f.failureReasons.join("; ").slice(0, 2000) || "Bilinmeyen hata",
        updatedAt: sql`now()`,
      })
      // Bu batch'ten sonra yeni bir gönderim yapıldıysa ona dokunma.
      .where(
        and(
          eq(channelListings.variantId, id),
          eq(channelListings.lastBatchRequestId, batchRequestId),
        ),
      );
  }
  const okIds = [...(await variantIdsFor(succeeded.map((s) => s.barcode))).values()];
  if (okIds.length) {
    await tx
      .update(channelListings)
      .set({ lastError: null })
      .where(
        and(
          inArray(channelListings.variantId, okIds),
          eq(channelListings.lastBatchRequestId, batchRequestId),
        ),
      );
  }
  await tx
    .update(tyBatches)
    .set({
      status: failed.length && !succeeded.length ? "failed" : "completed",
      completedAt: sql`now()`,
      result: {
        succeeded: succeeded.length,
        failed: failed.length,
        failures: failed.slice(0, 100),
      },
    })
    .where(eq(tyBatches.id, batchId));
  return { succeeded: succeeded.length, failed: failed.length };
}

/**
 * 4 saat içinde sonucu alınamayan batch: sonucu artık sorgulanamaz. Gönderim durumu bilinmediği
 * için ilgili kayıtların son gönderim değerleri sıfırlanır; bir sonraki tur yeniden gönderir.
 */
export async function expireBatch(
  tx: TenantTx,
  batchId: number,
  batchRequestId: string,
): Promise<void> {
  await tx
    .update(channelListings)
    .set({
      lastSentStock: null,
      lastSentPrice: null,
      lastSentListPrice: null,
      lastError: "Batch sonucu 4 saat içinde alınamadı; yeniden gönderilecek",
    })
    .where(eq(channelListings.lastBatchRequestId, batchRequestId));
  await tx
    .update(tyBatches)
    .set({ status: "expired", completedAt: sql`now()` })
    .where(eq(tyBatches.id, batchId));
}

// ── Trendyol'dan içe aktarma ────────────────────────────────────────────────

export interface TrendyolListingInput {
  barcode: string;
  productMainId: string | null;
  title: string | null;
  status: ListingStatus;
  contentId: number | null;
  onSale: boolean | null;
  lockReason: string | null;
  /** Kuruş. */
  price: number | null;
  listPrice: number | null;
  stock: number | null;
  rejectReasons: unknown;
}

/**
 * Trendyol'daki ürünleri kanal durumuna yazar. Katalogda olmayan barkodlar için sahipsiz
 * (yönetilmeyen) ürün/varyant açılır; bir feed aynı barkodu getirdiğinde sahiplenir.
 *
 * İlk okumada son gönderim değerleri Trendyol'daki mevcut değerlerle başlatılır: böylece diff,
 * Trendyol'da zaten aynı olan değeri tekrar göndermez.
 */
export async function applyTrendyolListings(
  tx: TenantTx,
  tenantId: number,
  listings: TrendyolListingInput[],
): Promise<{ created: number; updated: number }> {
  if (listings.length === 0) return { created: 0, updated: 0 };
  let created = 0;
  const existing = await tx
    .select({ id: variants.id, barcode: variants.barcode })
    .from(variants)
    .where(
      inArray(
        variants.barcode,
        listings.map((l) => l.barcode),
      ),
    );
  const idOf = new Map(existing.map((e) => [e.barcode, e.id]));

  for (const l of listings) {
    let variantId = idOf.get(l.barcode);
    if (variantId === undefined) {
      const productMainId = l.productMainId ?? l.barcode;
      const [p] = await tx
        .insert(products)
        .values({ tenantId, productMainId, title: l.title ?? productMainId })
        .onConflictDoUpdate({
          target: [products.tenantId, products.productMainId],
          // Mevcut ürünü değiştirme; yalnızca id'sini al.
          set: { productMainId: sql`excluded.product_main_id` },
        })
        .returning({ id: products.id });
      const [v] = await tx
        .insert(variants)
        .values({ tenantId, productId: p!.id, barcode: l.barcode, stock: 0, managed: false })
        .returning({ id: variants.id });
      variantId = v!.id;
      created++;
    }
    const ty = {
      tyStatus: l.status,
      tyContentId: l.contentId,
      tyOnSale: l.onSale,
      lockReason: l.lockReason,
      tyPrice: l.price,
      tyListPrice: l.listPrice,
      tyStock: l.stock,
      rejectReasons: l.rejectReasons ?? null,
      tyCheckedAt: sql`now()`,
      updatedAt: sql`now()`,
    };
    await tx
      .insert(channelListings)
      .values({
        tenantId,
        variantId,
        ...ty,
        lastSentPrice: l.price,
        lastSentListPrice: l.listPrice,
        lastSentStock: l.stock,
      })
      .onConflictDoUpdate({
        target: channelListings.variantId,
        set: {
          ...ty,
          lastSentPrice: sql`coalesce(${channelListings.lastSentPrice}, excluded.last_sent_price)`,
          lastSentListPrice: sql`coalesce(${channelListings.lastSentListPrice}, excluded.last_sent_list_price)`,
          lastSentStock: sql`coalesce(${channelListings.lastSentStock}, excluded.last_sent_stock)`,
        },
      });
  }
  return { created, updated: listings.length - created };
}

/**
 * Tam tarama başarıyla bittiğinde: bu taramada görülmeyen kayıtlar Trendyol'da artık yok
 * (silinmiş olabilir) → durum "unknown"; senkron onlara istek göndermez.
 */
export async function markUnseenListings(tx: TenantTx, scanStartedAt: Date): Promise<number> {
  const rows = await tx
    .update(channelListings)
    .set({ tyStatus: "unknown", updatedAt: sql`now()` })
    .where(
      and(
        lt(channelListings.tyCheckedAt, scanStartedAt),
        sql`${channelListings.tyStatus} <> 'unknown'`,
      ),
    )
    .returning({ id: channelListings.variantId });
  return rows.length;
}

// ── Zamanlama ────────────────────────────────────────────────────────────────

/**
 * Senkron/içe aktarma zamanlayıcısı için (sistem bağlantısı): senkron ortamında API bilgileri
 * doğrulanmış tenant'lar ve son senkron/içe aktarma başlangıç zamanları.
 */
export async function listSyncableTenants(db: Db) {
  const rows = await db.execute<{
    tenant_id: string | number;
    sync_paused: boolean;
    last_sync_at: string | Date | null;
    last_import_at: string | Date | null;
    last_orders_at: string | Date | null;
  }>(sql`
    SELECT t.id AS tenant_id, t.sync_paused,
      (SELECT max(started_at) FROM job_logs j WHERE j.tenant_id = t.id AND j.job_type = 'ty_sync') AS last_sync_at,
      (SELECT max(started_at) FROM job_logs j WHERE j.tenant_id = t.id AND j.job_type = 'ty_import') AS last_import_at,
      (SELECT max(started_at) FROM job_logs j WHERE j.tenant_id = t.id AND j.job_type = 'ty_orders') AS last_orders_at
    FROM tenants t
    JOIN trendyol_credentials c ON c.tenant_id = t.id AND c.env = t.sync_env AND c.verified_at IS NOT NULL
  `);
  const toDate = (v: string | Date | null) => (v === null ? null : new Date(v));
  return [...rows].map((r) => ({
    tenantId: Number(r.tenant_id),
    syncPaused: r.sync_paused,
    lastSyncAt: toDate(r.last_sync_at),
    lastImportAt: toDate(r.last_import_at),
    lastOrdersAt: toDate(r.last_orders_at),
  }));
}

export async function hasPendingBatches(db: Db): Promise<boolean> {
  const [row] = await db
    .select({ id: tyBatches.id })
    .from(tyBatches)
    .where(eq(tyBatches.status, "pending"))
    .limit(1);
  return row !== undefined;
}
