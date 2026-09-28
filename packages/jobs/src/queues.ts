import { Queue, type ConnectionOptions } from "bullmq";

/**
 * Kuyruk tanımları: API (iş ekler) ve worker (işler) aynı isimleri ve yük tiplerini kullanır.
 */
export const XML_FETCH_QUEUE = "xml-fetch";

export interface XmlFetchPayload {
  tenantId: number;
  supplierId: number;
  trigger: "schedule" | "manual";
}

/** Aynı tedarikçi için aynı anda tek çekim: bekleyen/çalışan iş varsa yenisi eklenmez. */
export const xmlFetchJobId = (supplierId: number) => `supplier-${supplierId}`;

export interface JobQueue {
  /** `queued: false` → bu tedarikçi için zaten bekleyen veya çalışan bir çekim var. */
  enqueueSupplierFetch(payload: XmlFetchPayload): Promise<{ queued: boolean }>;
  close(): Promise<void>;
}

export function createJobQueue(connection: ConnectionOptions): JobQueue {
  const queue = new Queue<XmlFetchPayload>(XML_FETCH_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 60_000 },
      // Kalıcı geçmiş `job_logs` tablosunda; Redis'te iş tutulmaz. Bitmiş iş silinmezse aynı
      // jobId ile yeni çekim eklenemezdi.
      removeOnComplete: true,
      removeOnFail: true,
    },
  });
  return {
    async enqueueSupplierFetch(payload) {
      const jobId = xmlFetchJobId(payload.supplierId);
      const existing = await queue.getJob(jobId);
      if (existing) return { queued: false };
      await queue.add("fetch", payload, { jobId });
      return { queued: true };
    },
    close: () => queue.close(),
  };
}
