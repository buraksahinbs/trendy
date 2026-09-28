import { createDatabase, deleteExpiredSessions } from "@trendy/db";
import { createJobQueue, XML_FETCH_QUEUE, type XmlFetchPayload } from "@trendy/jobs";
import { createLogger, loadEnv, secretBoxFromEnv } from "@trendy/shared";
import { UnrecoverableError, Worker } from "bullmq";
import { Redis } from "ioredis";
import { scheduleDueFetches } from "./scheduler.js";
import { FetchError, runSupplierFetch } from "./supplier-fetch.js";

const env = loadEnv();
const logger = createLogger({ level: env.LOG_LEVEL, name: "worker" });
const database = createDatabase(env.DATABASE_URL);
// BullMQ worker'ları engelleyici komut kullanır; istek başına tekrar sınırı kapalı olmalı.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = createJobQueue(connection);
const deps = { db: database.db, secretBox: secretBoxFromEnv(env), logger };

const worker = new Worker<XmlFetchPayload>(
  XML_FETCH_QUEUE,
  async (job) => {
    try {
      return await runSupplierFetch(deps, job.data);
    } catch (err) {
      // Bozuk XML, 404 gibi kalıcı hatalar tekrar denenmez.
      if (err instanceof FetchError && !err.retryable) throw new UnrecoverableError(err.message);
      throw err;
    }
  },
  { connection, concurrency: 4 },
);
worker.on("error", (err) => logger.error({ err }, "worker hatası"));

const SCHEDULE_EVERY_MS = 60_000;
const CLEANUP_EVERY_MS = 60 * 60_000;

async function tick() {
  try {
    const r = await scheduleDueFetches({ db: database.db, queue, logger });
    if (r.queued) logger.info(r, "zamanlanmış çekimler kuyruğa eklendi");
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
  await worker.close();
  await queue.close();
  await database.close();
  connection.disconnect();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
