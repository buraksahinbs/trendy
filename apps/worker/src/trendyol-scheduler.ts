import { hasPendingBatches, listSyncableTenants, type Db } from "@trendy/db";
import type { JobQueue } from "@trendy/jobs";

/** Stok/fiyat senkronu aralığı; feed değişince ayrıca hemen tetiklenir. */
export const SYNC_EVERY_MS = 15 * 60_000;
/** Sipariş çekme aralığı (stream servisi periyodik senkron için önerilen yöntem). */
export const ORDERS_EVERY_MS = 5 * 60_000;
/** Trendyol'daki ürün durumlarını (onay, kilit, arşiv) yenileme aralığı. */
export const IMPORT_EVERY_MS = 24 * 60 * 60_000;

/**
 * Zamanı gelen Trendyol işlerini kuyruğa ekler. Birden fazla worker çalıştırsa da kuyruk
 * aynı işi ikinci kez eklemez.
 */
export async function scheduleTrendyolJobs(
  deps: { db: Db; queue: JobQueue },
  now: Date = new Date(),
): Promise<{ sync: number; import: number; orders: number; poll: boolean }> {
  const out = { sync: 0, import: 0, orders: 0, poll: false };
  const due = (last: Date | null, every: number) =>
    !last || now.getTime() - last.getTime() >= every;
  for (const t of await listSyncableTenants(deps.db)) {
    // Sipariş çekme salt-okumadır: acil durdurmadan ve içe aktarmadan bağımsız çalışır.
    if (due(t.lastOrdersAt, ORDERS_EVERY_MS)) {
      if ((await deps.queue.enqueueTrendyol({ kind: "orders", tenantId: t.tenantId })).queued)
        out.orders++;
    }
    // İlk içe aktarma yapılmadan senkron anlamsız: kanal durumları henüz bilinmiyor.
    if (due(t.lastImportAt, IMPORT_EVERY_MS)) {
      if ((await deps.queue.enqueueTrendyol({ kind: "import", tenantId: t.tenantId })).queued)
        out.import++;
      continue;
    }
    if (!t.syncPaused && due(t.lastSyncAt, SYNC_EVERY_MS)) {
      if ((await deps.queue.enqueueTrendyol({ kind: "sync", tenantId: t.tenantId })).queued)
        out.sync++;
    }
  }
  if (await hasPendingBatches(deps.db)) {
    out.poll = (await deps.queue.enqueueTrendyol({ kind: "poll" })).queued;
  }
  return out;
}
