import { Queue, type ConnectionOptions } from "bullmq";

/**
 * Kuyruk tanımları: API (iş ekler) ve worker (işler) aynı isimleri ve yük tiplerini kullanır.
 */
export const XML_FETCH_QUEUE = "xml-fetch";
export const TRENDYOL_QUEUE = "trendyol";

export interface XmlFetchPayload {
  tenantId: number;
  supplierId: number;
  trigger: "schedule" | "manual";
}

/**
 * Trendyol işleri: `sync` stok/fiyat senkronu, `import` Trendyol'daki ürünleri ve durumlarını
 * okuma, `poll` gönderilen batch'lerin sonuçlarını işleme (tüm tenant'lar).
 */
export type TrendyolPayload =
  { kind: "sync"; tenantId: number } | { kind: "import"; tenantId: number } | { kind: "poll" };

/** Aynı tedarikçi için aynı anda tek çekim: bekleyen/çalışan iş varsa yenisi eklenmez. */
export const xmlFetchJobId = (supplierId: number) => `supplier-${supplierId}`;
export const trendyolJobId = (p: TrendyolPayload) =>
  p.kind === "poll" ? "poll" : `${p.kind}-tenant-${p.tenantId}`;

export interface JobQueue {
  /** `queued: false` → bu tedarikçi için zaten bekleyen veya çalışan bir çekim var. */
  enqueueSupplierFetch(payload: XmlFetchPayload): Promise<{ queued: boolean }>;
  /** `queued: false` → aynı iş (tenant + tür) zaten bekliyor veya çalışıyor. */
  enqueueTrendyol(payload: TrendyolPayload): Promise<{ queued: boolean }>;
  close(): Promise<void>;
}

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 60_000 },
  // Kalıcı geçmiş `job_logs` tablosunda; Redis'te iş tutulmaz. Bitmiş iş silinmezse aynı
  // jobId ile yeni iş eklenemezdi.
  removeOnComplete: true,
  removeOnFail: true,
} as const;

export function createJobQueue(connection: ConnectionOptions): JobQueue {
  const fetchQueue = new Queue<XmlFetchPayload>(XML_FETCH_QUEUE, { connection, defaultJobOptions });
  const tyQueue = new Queue<TrendyolPayload>(TRENDYOL_QUEUE, { connection, defaultJobOptions });

  async function addOnce<T>(queue: Queue<T>, name: string, data: T, jobId: string) {
    if (await queue.getJob(jobId)) return { queued: false };
    await queue.add(name as never, data as never, { jobId });
    return { queued: true };
  }

  return {
    enqueueSupplierFetch: (p) => addOnce(fetchQueue, "fetch", p, xmlFetchJobId(p.supplierId)),
    enqueueTrendyol: (p) => addOnce(tyQueue, p.kind, p, trendyolJobId(p)),
    async close() {
      await Promise.all([fetchQueue.close(), tyQueue.close()]);
    },
  };
}
