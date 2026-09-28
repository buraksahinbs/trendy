import { listSchedulableSuppliers, type Db } from "@trendy/db";
import { isDue, type JobQueue } from "@trendy/jobs";
import type { Logger } from "@trendy/shared";

/**
 * Zamanı gelen tedarikçi çekimlerini kuyruğa ekler. Birden fazla worker aynı anda çalıştırsa
 * da sorun olmaz: kuyruk aynı tedarikçi için ikinci işi eklemez.
 */
export async function scheduleDueFetches(
  deps: { db: Db; queue: JobQueue; logger: Logger },
  now: Date = new Date(),
): Promise<{ checked: number; queued: number }> {
  const rows = await listSchedulableSuppliers(deps.db);
  let queued = 0;
  for (const s of rows) {
    let due: boolean;
    try {
      due = isDue(s.scheduleCron, s.lastAttemptAt ?? s.createdAt, now);
    } catch (err) {
      deps.logger.error({ err, supplierId: s.id }, "geçersiz zamanlama ifadesi");
      continue;
    }
    if (!due) continue;
    const r = await deps.queue.enqueueSupplierFetch({
      tenantId: s.tenantId,
      supplierId: s.id,
      trigger: "schedule",
    });
    if (r.queued) queued++;
  }
  return { checked: rows.length, queued };
}
