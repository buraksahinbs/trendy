import { createDatabase } from "@trendy/db";
import { createJobQueue } from "@trendy/jobs";
import { createLogger, installLifecycle, loadEnv, secretBoxFromEnv } from "@trendy/shared";
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
  redis,
  integratorName: env.TRENDYOL_INTEGRATOR_NAME,
  ...(env.PUBLIC_BASE_URL ? { publicBaseUrl: env.PUBLIC_BASE_URL.replace(/\/$/, "") } : {}),
  logger,
  sessionTtlMs: env.SESSION_TTL_HOURS * 3_600_000,
  secureCookies: env.NODE_ENV === "production",
  ...(env.TRUST_PROXY ? { trustProxy: env.TRUST_PROXY === "true" ? true : env.TRUST_PROXY } : {}),
  ...(env.TRENDYOL_BASE_URL ? { trendyolClientOptions: { baseUrl: env.TRENDYOL_BASE_URL } } : {}),
  ...(env.FEED_ALLOW_PRIVATE_NETWORK ? { feedDownloadOptions: { allowPrivateNetwork: true } } : {}),
});

installLifecycle({
  logger,
  close: async () => {
    await app.close();
    await queue.close();
    await database.close();
    redis.disconnect();
  },
});

await app.listen({ host: env.API_HOST, port: env.API_PORT });
