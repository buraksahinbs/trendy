import { createDatabase, deleteExpiredSessions } from "@trendy/db";
import {
  createJobQueue,
  TRENDYOL_QUEUE,
  XML_FETCH_QUEUE,
  type TrendyolPayload,
  type XmlFetchPayload,
} from "@trendy/jobs";
import { createLogger, loadEnv, secretBoxFromEnv } from "@trendy/shared";
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
const fetchDeps = { db: database.db, secretBox, logger };
const tyDeps = {
  db: database.db,
  secretBox,
  logger,
  limiter: new RedisRateLimiter(limiterRedis, "ty:"),
  integratorName: env.TRENDYOL_INTEGRATOR_NAME,
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

async function tick() {
  try {
    const r = await scheduleDueFetches({ db: database.db, queue, logger });
    if (r.queued) logger.info(r, "zamanlanmış çekimler kuyruğa eklendi");
    const t = await scheduleTrendyolJobs({ db: database.db, queue });
    if (t.sync || t.import) logger.info(t, "Trendyol işleri kuyruğa eklendi");
  } catch (err) {
    logger.error({ err }, "zamanlayıcı hatası");
  }
}
async function cleanup() {
  try {
    const n = await deleteExpiredSessions(database.db);
    if (n) logger.info({ deleted: n }, "süresi dolan oturumlar silindi");
  } catch (err) {
    logger.error({ err }, "temizlik hatası");
  }
}

const timers = [setInterval(tick, SCHEDULE_EVERY_MS), setInterval(cleanup, CLEANUP_EVERY_MS)];
void tick();
void cleanup();
logger.info("worker başladı");

const shutdown = async (signal: string) => {
  logger.info({ signal }, "kapanıyor");
  timers.forEach(clearInterval);
  await Promise.all([fetchWorker.close(), trendyolWorker.close()]);
  await queue.close();
  await database.close();
  connection.disconnect();
  limiterRedis.disconnect();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
