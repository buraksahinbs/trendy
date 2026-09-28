import { createDatabase } from "@trendy/db";
import { createJobQueue } from "@trendy/jobs";
import { createLogger, loadEnv, secretBoxFromEnv } from "@trendy/shared";
import { RedisRateLimiter } from "@trendy/trendyol-client";
import { Redis } from "ioredis";
import { buildApp } from "./app.js";

const env = loadEnv();
const logger = createLogger({ level: env.LOG_LEVEL, name: "api" });
const database = createDatabase(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
const queue = createJobQueue(new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }));

const app = await buildApp({
  db: database.db,
  secretBox: secretBoxFromEnv(env),
  limiter: new RedisRateLimiter(redis, "api:"),
  queue,
  integratorName: env.TRENDYOL_INTEGRATOR_NAME,
  ...(env.PUBLIC_BASE_URL ? { publicBaseUrl: env.PUBLIC_BASE_URL.replace(/\/$/, "") } : {}),
  logger,
  sessionTtlMs: env.SESSION_TTL_HOURS * 3_600_000,
  secureCookies: env.NODE_ENV === "production",
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, "kapanıyor");
  await app.close();
  await queue.close();
  await database.close();
  redis.disconnect();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: env.API_HOST, port: env.API_PORT });
