import { createDatabase, deleteExpiredSessions, purgeExpiredOrderPii } from "@trendy/db";
import {
  createJobQueue,
  TRENDYOL_QUEUE,
  WORKER_HEARTBEAT_KEY,
  XML_FETCH_QUEUE,
  type TrendyolPayload,
  type XmlFetchPayload,
} from "@trendy/jobs";
import { createLogger, installLifecycle, loadEnv, secretBoxFromEnv } from "@trendy/shared";
import {
  RedisRateLimiter,
  TrendyolAuthError,
  TrendyolDeprecatedEndpointError,
  TrendyolValidationError,
} from "@trendy/trendyol-client";
import { UnrecoverableError, Worker } from "bullmq";
import { Redis } from "ioredis";
import { scheduleDueFetches } from "./scheduler.js";
import { FetchError, runSupplierFetch } from "./supplier-fetch.js";
import { runOrderSync } from "./orders.js";
import { runBatchPoll, runTrendyolImport, runTrendyolSync } from "./trendyol-jobs.js";
import { scheduleTrendyolJobs } from "./trendyol-scheduler.js";

const env = loadEnv();
const logger = createLogger({ level: env.LOG_LEVEL, name: "worker" });
const database = createDatabase(env.DATABASE_URL);
// BullMQ worker'ları engelleyici komut kullanır; istek başına tekrar sınırı kapalı olmalı.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
// Rate limiter ayrı bağlantıda: engelleyici BullMQ komutlarını beklemesin.
const limiterRedis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
const queue = createJobQueue(connection);
const secretBox = secretBoxFromEnv(env);
const fetchDeps = {
  db: database.db,
  secretBox,
  logger,
  ...(env.FEED_ALLOW_PRIVATE_NETWORK ? { downloadOptions: { allowPrivateNetwork: true } } : {}),
};
const tyDeps = {
  db: database.db,
  secretBox,
  logger,
  limiter: new RedisRateLimiter(limiterRedis, "ty:"),
  integratorName: env.TRENDYOL_INTEGRATOR_NAME,
  ...(env.TRENDYOL_BASE_URL ? { clientOptions: { baseUrl: env.TRENDYOL_BASE_URL } } : {}),
};

const fetchWorker = new Worker<XmlFetchPayload>(
  XML_FETCH_QUEUE,
  async (job) => {
    try {
      const summary = await runSupplierFetch(fetchDeps, job.data);
      // Katalog değiştiyse stok/fiyat senkronunu beklemeden tetikle.
      const n = summary.normalize;
      if (n && (n.processed > 0 || n.orphaned > 0 || (summary.missing ?? 0) > 0)) {
        await queue.enqueueTrendyol({ kind: "sync", tenantId: job.data.tenantId });
      }
      return summary;
    } catch (err) {
      // Bozuk XML, 404 gibi kalıcı hatalar tekrar denenmez.
      if (err instanceof FetchError && !err.retryable) throw new UnrecoverableError(err.message);
      throw err;
    }
  },
  { connection, concurrency: 4 },
);

const trendyolWorker = new Worker<TrendyolPayload>(
  TRENDYOL_QUEUE,
  async (job) => {
    try {
      const p = job.data;
      if (p.kind === "poll") return await runBatchPoll(tyDeps);
      if (p.kind === "import") return await runTrendyolImport(tyDeps, p.tenantId);
      if (p.kind === "orders") return await runOrderSync(tyDeps, p.tenantId);
      if (p.kind === "orders_backfill") {
        return await runOrderSync(tyDeps, p.tenantId, {
          from: new Date(p.from),
          to: new Date(p.to),
        });
      }
      return await runTrendyolSync(tyDeps, p.tenantId);
    } catch (err) {
      // Yetki, doğrulama ve kullanımdan kalkmış endpoint hataları tekrar denemeyle düzelmez.
      if (
        err instanceof TrendyolAuthError ||
        err instanceof TrendyolValidationError ||
        err instanceof TrendyolDeprecatedEndpointError
      ) {
        throw new UnrecoverableError(err.message);
      }
      throw err;
    }
  },
  { connection, concurrency: 2 },
);

for (const w of [fetchWorker, trendyolWorker])
  w.on("error", (err) => logger.error({ err }, "worker hatası"));

const SCHEDULE_EVERY_MS = 60_000;
const CLEANUP_EVERY_MS = 60 * 60_000;

let ticking = false;
async function tick() {
  // Yavaş bir tur bitmeden yenisi başlamasın (aynı işleri iki kez kuyruğa eklemeyi dener).
  if (ticking) return;
  ticking = true;
  try {
    await limiterRedis.set(WORKER_HEARTBEAT_KEY, new Date().toISOString(), "EX", 300);
    const r = await scheduleDueFetches({ db: database.db, queue, logger });
    if (r.queued) logger.info(r, "zamanlanmış çekimler kuyruğa eklendi");
    const t = await scheduleTrendyolJobs({ db: database.db, queue });
    if (t.sync || t.import) logger.info(t, "Trendyol işleri kuyruğa eklendi");
  } catch (err) {
    logger.error({ err }, "zamanlayıcı hatası");
  } finally {
    ticking = false;
  }
}
async function cleanup() {
  try {
    const n = await deleteExpiredSessions(database.db);
    if (n) logger.info({ deleted: n }, "süresi dolan oturumlar silindi");
    const purged = await purgeExpiredOrderPii(database.db);
    if (purged)
      logger.info({ orders: purged }, "saklama süresi dolan siparişlerin kişisel verisi silindi");
  } catch (err) {
    logger.error({ err }, "temizlik hatası");
  }
}

const timers = [setInterval(tick, SCHEDULE_EVERY_MS), setInterval(cleanup, CLEANUP_EVERY_MS)];
void tick();
void cleanup();
logger.info("worker başladı");

installLifecycle({
  logger,
  // Uzun süren iş yarıda kalırsa BullMQ onu "stalled" sayıp yeniden çalıştırır; işler idempotent.
  timeoutMs: 50_000,
  close: async () => {
    timers.forEach(clearInterval);
    await Promise.all([fetchWorker.close(), trendyolWorker.close()]);
    await queue.close();
    await database.close();
    connection.disconnect();
    limiterRedis.disconnect();
  },
});
