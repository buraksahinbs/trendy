import { getSyncCursor, setSyncCursor, upsertOrder, withTenant } from "@trendy/db";
import {
  ORDER_HISTORY_MS,
  ORDER_STREAM_MAX_WINDOW_MS,
  ORDER_STREAM_MIN_INTERVAL_MS,
  orderWindows,
  streamShipmentPackages,
  toOrderInput,
} from "@trendy/trendyol-client";
import { tenantClient, withJobLog, type TrendyolDeps } from "./trendyol-jobs.js";

/** Olası saat/zaman dilimi farkları ve geç yansıyan güncellemeler için pencere geriden başlar. */
export const ORDER_OVERLAP_MS = 4 * 60 * 60_000;
export const ORDER_CURSOR_KIND = "orders";

export interface OrderSyncSummary extends Record<string, unknown> {
  from: string;
  to: string;
  windows: number;
  fetched: number;
  created: number;
  updated: number;
  stale: number;
}

/**
 * Sipariş paketlerini çeker (ROADMAP Faz 10): `getShipmentPackagesStream`, 14 günlük
 * pencereler, istekler arası ≥5 sn, `shipmentPackageId` ile upsert.
 *
 * - Normal tur: son başarılı çekimin bitişinden 4 saat geriden şimdiye kadar; ilk çekimde son 14 gün.
 * - `range` verilirse (backfill aracı): o aralık yeniden taranır, imleç değişmez.
 * - İmleç yalnızca tüm pencereler hatasız bitince ilerler: yarıda kalan çekim sipariş kaçırmaz.
 * - Son 3 aydan eskisi Trendyol'da sorgulanamaz; başlangıç buna kırpılır.
 */
export async function runOrderSync(
  deps: TrendyolDeps,
  tenantId: number,
  range?: { from: Date; to: Date },
): Promise<OrderSyncSummary> {
  const jobType = range ? "ty_orders_backfill" : "ty_orders";
  const log = deps.logger.child({ tenantId, job: jobType });
  const now = deps.now?.() ?? new Date();
  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(deps.db, tenantId, fn);
  const oldest = now.getTime() - ORDER_HISTORY_MS + 60_000;

  let start: number;
  let end: number;
  if (range) {
    start = range.from.getTime();
    end = Math.min(range.to.getTime(), now.getTime());
  } else {
    const cursor = await run((t) => getSyncCursor(t, ORDER_CURSOR_KIND));
    start = cursor
      ? cursor.getTime() - ORDER_OVERLAP_MS
      : now.getTime() - ORDER_STREAM_MAX_WINDOW_MS;
    end = now.getTime();
  }
  start = Math.max(start, oldest);

  return withJobLog<OrderSyncSummary>(
    deps,
    tenantId,
    jobType,
    async (summary) => {
      const { client } = await tenantClient(deps, tenantId, log);
      const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
      const windows = orderWindows(start, end);
      for (const [i, w] of windows.entries()) {
        if (i > 0) await sleep(ORDER_STREAM_MIN_INTERVAL_MS);
        const filter = { lastModifiedStartDate: w.start, lastModifiedEndDate: w.end };
        for await (const batch of streamShipmentPackages(client, filter, sleep)) {
          if (batch.length === 0) continue;
          await run(async (t) => {
            for (const p of batch) {
              const r = await upsertOrder(t, tenantId, toOrderInput(p));
              summary[r]++;
            }
          });
          summary.fetched += batch.length;
        }
        summary.windows++;
      }
      if (!range) await run((t) => setSyncCursor(t, tenantId, ORDER_CURSOR_KIND, new Date(end)));
      log.info(summary, "siparişler çekildi");
      return "success";
    },
    {
      from: new Date(start).toISOString(),
      to: new Date(end).toISOString(),
      windows: 0,
      fetched: 0,
      created: 0,
      updated: 0,
      stale: 0,
    },
  );
}
