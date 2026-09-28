import {
  applyBatchResult,
  applyTrendyolListings,
  dbNow,
  expireBatch,
  finishJobLog,
  listPendingBatches,
  listSyncCandidates,
  loadSyncSettings,
  loadTrendyolCredentials,
  markUnseenListings,
  recordSentBatch,
  startJobLog,
  upsertPriceReviews,
  withTenant,
  type BatchItemResult,
  type Db,
  type ListingStatus,
  type TenantTx,
  type TrendyolListingInput,
} from "@trendy/db";
import type { Logger, SecretBox } from "@trendy/shared";
import { toKurus } from "@trendy/shared";
import {
  BATCH_RESULT_TTL_MS,
  filterApprovedProducts,
  filterApprovedProductsInventoryAndPrice,
  filterUnapprovedProducts,
  getBatchRequestResult,
  isBatchComplete,
  paginate,
  PRICE_INVENTORY_MAX_ITEMS,
  TrendyolClient,
  trendyolErrorCode,
  updatePriceAndInventory,
  type RateLimiter,
  type TrendyolClientConfig,
} from "@trendy/trendyol-client";
import { chunk, planSync, type PlannedItem, type SyncPlan } from "./sync-plan.js";

export interface TrendyolDeps {
  db: Db;
  secretBox: SecretBox;
  limiter: RateLimiter;
  logger: Logger;
  integratorName: string;
  /** Yalnızca testler için: mock Trendyol adresi vb. */
  clientOptions?: Partial<Pick<TrendyolClientConfig, "baseUrl" | "sleep" | "random">>;
  now?: () => Date;
  /** Yalnızca testler için: sipariş akışındaki istekler arası bekleme. */
  sleep?: (ms: number) => Promise<void>;
}

export class TrendyolNotReadyError extends Error {
  constructor(readonly reason: "no_credentials" | "not_verified" | "no_tenant") {
    super(
      {
        no_credentials: "Trendyol API bilgileri kayıtlı değil",
        not_verified: "Trendyol API bilgileri doğrulanmamış",
        no_tenant: "Mağaza bulunamadı",
      }[reason],
    );
    this.name = "TrendyolNotReadyError";
  }
}

const tx =
  (db: Db, tenantId: number) =>
  <T>(fn: (t: TenantTx) => Promise<T>) =>
    withTenant(db, tenantId, fn);

/** Tenant'ın senkron ortamındaki doğrulanmış API bilgileriyle istemci kurar. */
export async function tenantClient(deps: TrendyolDeps, tenantId: number, log: Logger) {
  const run = tx(deps.db, tenantId);
  const settings = await run((t) => loadSyncSettings(t, tenantId));
  if (!settings) throw new TrendyolNotReadyError("no_tenant");
  const creds = await run((t) =>
    loadTrendyolCredentials(t, deps.secretBox, tenantId, settings.syncEnv),
  );
  if (!creds) throw new TrendyolNotReadyError("no_credentials");
  if (!creds.verifiedAt) throw new TrendyolNotReadyError("not_verified");
  const client = new TrendyolClient({
    env: settings.syncEnv,
    sellerId: creds.sellerId,
    apiKey: creds.apiKey,
    apiSecret: creds.apiSecret,
    integratorName: deps.integratorName,
    tier: settings.tier,
    limiter: deps.limiter,
    logger: log,
    ...deps.clientOptions,
  });
  return { client, settings };
}

/** Başlangıç/bitiş ve hatayı iş loguna yazan sarmalayıcı. */
export async function withJobLog<T extends Record<string, unknown>>(
  deps: TrendyolDeps,
  tenantId: number,
  jobType: string,
  body: (summary: T) => Promise<"success" | "skipped">,
  initial: T,
): Promise<T> {
  const run = tx(deps.db, tenantId);
  const summary = { ...initial };
  const id = await run((t) => startJobLog(t, tenantId, jobType, summary));
  try {
    const status = await body(summary);
    await run((t) => finishJobLog(t, id, status, summary));
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof TrendyolNotReadyError) {
      await run((t) => finishJobLog(t, id, "skipped", { ...summary, reason: err.reason }, message));
      return summary;
    }
    // Hata sınıfı uyarı kurallarında kullanılır (ör. 401 → API bilgileri, 426 → kalkmış endpoint).
    await run((t) =>
      finishJobLog(t, id, "failed", { ...summary, errorCode: trendyolErrorCode(err) }, message),
    );
    throw err;
  }
}

// ── İçe aktarma ──────────────────────────────────────────────────────────────

const kurus = (v: number | null | undefined) => (v == null ? null : toKurus(v));

function approvedStatus(v: {
  blacklisted?: boolean | null | undefined;
  archived?: boolean | null | undefined;
  locked?: boolean | null | undefined;
}): ListingStatus {
  if (v.blacklisted) return "blacklisted";
  if (v.archived) return "archived";
  if (v.locked) return "locked";
  return "approved";
}

export interface ImportSummary extends Record<string, unknown> {
  approved: number;
  unapproved: number;
  created: number;
  unseen: number;
}

/**
 * Trendyol'daki ürünleri okur (ROADMAP Faz 8 "mevcut ürünleri içe aktarma"): onaylılar
 * (durum + stok/fiyat) ve onaysızlar (bekleyen/reddedilen). Tamamen salt-okumadır.
 */
export async function runTrendyolImport(
  deps: TrendyolDeps,
  tenantId: number,
): Promise<ImportSummary> {
  const log = deps.logger.child({ tenantId, job: "ty_import" });
  return withJobLog<ImportSummary>(
    deps,
    tenantId,
    "ty_import",
    async (summary) => {
      const { client } = await tenantClient(deps, tenantId, log);
      const run = tx(deps.db, tenantId);
      const scanStart = await run(dbNow);

      // Stok ve fiyat: ayrı, hafif servis.
      const inventory = new Map<
        string,
        { quantity: number | null; sale: number | null; list: number | null }
      >();
      for await (const page of paginate(
        (p) => filterApprovedProductsInventoryAndPrice(client, p),
        100,
      )) {
        for (const c of page.content ?? []) {
          for (const v of c.variants ?? []) {
            inventory.set(v.barcode, {
              quantity: v.quantity ?? null,
              sale: kurus(v.salePrice),
              list: kurus(v.listPrice),
            });
          }
        }
      }

      for await (const page of paginate((p) => filterApprovedProducts(client, p), 100)) {
        const listings: TrendyolListingInput[] = [];
        for (const c of page.content ?? []) {
          for (const v of c.variants ?? []) {
            const inv = inventory.get(v.barcode);
            listings.push({
              barcode: v.barcode,
              productMainId: c.productMainId ?? null,
              title: c.title ?? null,
              status: approvedStatus(v),
              contentId: c.contentId ?? null,
              onSale: v.onSale ?? null,
              lockReason: v.lockReason ?? null,
              price: inv?.sale ?? kurus(v.price?.salePrice),
              listPrice: inv?.list ?? kurus(v.price?.listPrice),
              stock: inv?.quantity ?? null,
              rejectReasons: null,
            });
          }
        }
        const r = await run((t) => applyTrendyolListings(t, tenantId, listings));
        summary.approved += listings.length;
        summary.created += r.created;
      }

      for (const status of ["pendingApproval", "rejected"] as const) {
        for await (const page of paginate(
          (p) => filterUnapprovedProducts(client, { ...p, status }),
          1000,
        )) {
          const listings: TrendyolListingInput[] = (page.content ?? []).map((p) => ({
            barcode: p.barcode,
            productMainId: p.productMainId ?? null,
            title: p.title ?? null,
            status: status === "rejected" ? "rejected" : "pending",
            contentId: null,
            onSale: false,
            lockReason: null,
            price: kurus(p.salePrice),
            listPrice: kurus(p.listPrice),
            stock: p.quantity ?? null,
            rejectReasons: p.rejectReasonDetails ?? null,
          }));
          const r = await run((t) => applyTrendyolListings(t, tenantId, listings));
          summary.unapproved += listings.length;
          summary.created += r.created;
        }
      }

      // Tarama eksiksiz bitti: görülmeyenler Trendyol'da artık yok.
      summary.unseen = await run((t) => markUnseenListings(t, scanStart));
      log.info(summary, "Trendyol içe aktarma tamamlandı");
      return "success";
    },
    { approved: 0, unapproved: 0, created: 0, unseen: 0 },
  );
}

// ── Stok/fiyat senkronu ─────────────────────────────────────────────────────

export interface SyncSummary extends Record<string, unknown> {
  sent: number;
  batches: number;
  reviews: number;
  stockCapped: number;
  skipped: SyncPlan["skipped"];
  priceNotes: SyncPlan["priceNotes"];
  reason?: string;
}

/**
 * Stok/fiyat senkronu (ROADMAP Faz 9): adaylar sayfa sayfa planlanır, değişenler 1000'lik
 * gruplar hâlinde gönderilir ve her batch kaydedilir. Sonuçlar `runBatchPoll` ile işlenir.
 */
export async function runTrendyolSync(
  deps: TrendyolDeps,
  tenantId: number,
  pageSize = 500,
): Promise<SyncSummary> {
  const log = deps.logger.child({ tenantId, job: "ty_sync" });
  return withJobLog<SyncSummary>(
    deps,
    tenantId,
    "ty_sync",
    async (summary) => {
      const run = tx(deps.db, tenantId);
      const settings = await run((t) => loadSyncSettings(t, tenantId));
      if (!settings) throw new TrendyolNotReadyError("no_tenant");
      if (settings.syncPaused) {
        summary.reason = "sync_paused";
        return "skipped";
      }
      const { client } = await tenantClient(deps, tenantId, log);

      let pending: PlannedItem[] = [];
      const send = async (items: PlannedItem[]) => {
        const { batchRequestId } = await updatePriceAndInventory(
          client,
          items.map((i) => ({
            barcode: i.barcode,
            ...(i.quantity !== undefined ? { quantity: i.quantity } : {}),
            ...(i.salePrice !== undefined ? { salePrice: i.salePrice } : {}),
            ...(i.listPrice !== undefined ? { listPrice: i.listPrice } : {}),
          })),
        );
        await run((t) => recordSentBatch(t, tenantId, batchRequestId, items));
        summary.sent += items.length;
        summary.batches++;
      };

      let afterId = 0;
      for (;;) {
        const candidates = await run((t) => listSyncCandidates(t, afterId, pageSize));
        if (candidates.length === 0) break;
        afterId = candidates.at(-1)!.variantId;
        const plan = planSync(candidates, {
          rules: settings.rules,
          maxAutoChangeRate: settings.maxAutoChangeRate,
          safetyStock: settings.safetyStock,
          fxRates: settings.fxRates,
        });
        for (const [k, v] of Object.entries(plan.skipped)) {
          summary.skipped[k as keyof SyncPlan["skipped"]] =
            (summary.skipped[k as keyof SyncPlan["skipped"]] ?? 0) + v;
        }
        for (const [k, v] of Object.entries(plan.priceNotes)) {
          summary.priceNotes[k as keyof SyncPlan["priceNotes"]] =
            (summary.priceNotes[k as keyof SyncPlan["priceNotes"]] ?? 0) + v;
        }
        summary.stockCapped += plan.stockCapped;
        if (plan.reviews.length) {
          await run((t) => upsertPriceReviews(t, tenantId, plan.reviews));
          summary.reviews += plan.reviews.length;
        }
        pending.push(...plan.items);
        while (pending.length >= PRICE_INVENTORY_MAX_ITEMS) {
          await send(pending.slice(0, PRICE_INVENTORY_MAX_ITEMS));
          pending = pending.slice(PRICE_INVENTORY_MAX_ITEMS);
        }
        if (candidates.length < pageSize) break;
      }
      for (const group of chunk(pending, PRICE_INVENTORY_MAX_ITEMS)) await send(group);
      log.info(summary, "senkron tamamlandı");
      return "success";
    },
    { sent: 0, batches: 0, reviews: 0, stockCapped: 0, skipped: {}, priceNotes: {} },
  );
}

// ── Batch sonuçları ──────────────────────────────────────────────────────────

/**
 * Bekleyen stok/fiyat batch'lerinin sonuçlarını işler (tüm tenant'lar). Tamamlanmayanlar bir
 * sonraki turda tekrar sorgulanır; 4 saati geçenler süresi dolmuş sayılır.
 */
export async function runBatchPoll(
  deps: TrendyolDeps,
): Promise<{ checked: number; completed: number; expired: number }> {
  const now = deps.now?.() ?? new Date();
  const batches = await listPendingBatches(deps.db);
  const out = { checked: 0, completed: 0, expired: 0 };
  const clients = new Map<number, TrendyolClient | null>();

  for (const b of batches) {
    const run = tx(deps.db, b.tenantId);
    const log = deps.logger.child({ tenantId: b.tenantId, batchRequestId: b.batchRequestId });
    if (now.getTime() - b.sentAt.getTime() > BATCH_RESULT_TTL_MS) {
      await run((t) => expireBatch(t, b.id, b.batchRequestId));
      out.expired++;
      log.warn("batch sonucu süresinde alınamadı");
      continue;
    }
    if (!clients.has(b.tenantId)) {
      try {
        clients.set(b.tenantId, (await tenantClient(deps, b.tenantId, log)).client);
      } catch (err) {
        log.warn({ err }, "batch sorgusu için istemci kurulamadı");
        clients.set(b.tenantId, null);
      }
    }
    const client = clients.get(b.tenantId);
    if (!client) continue;
    try {
      out.checked++;
      const result = await getBatchRequestResult(client, b.batchRequestId);
      if (!isBatchComplete(result)) continue;
      const items: BatchItemResult[] = [];
      for (const i of result.items ?? []) {
        const barcode = i.requestItem?.barcode;
        if (typeof barcode !== "string") continue;
        items.push({
          barcode,
          status: i.status === "SUCCESS" ? "SUCCESS" : "FAILED",
          failureReasons: i.failureReasons ?? [],
        });
      }
      await run((t) => applyBatchResult(t, b.id, b.batchRequestId, items));
      out.completed++;
    } catch (err) {
      // Tek batch'in hatası diğerlerini durdurmaz.
      log.warn({ err }, "batch sonucu işlenemedi");
    }
  }
  return out;
}
