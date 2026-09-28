import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RedisRateLimiter } from "./redis-rate-limiter.js";

/**
 * Gerçek Redis ile entegrasyon testi (ROADMAP §6). REDIS_URL yoksa atlanır;
 * CI'da Redis servisiyle çalışır.
 */
const url = process.env.REDIS_URL;

describe.skipIf(!url)("RedisRateLimiter", () => {
  let redis: Redis;
  const prefix = `test:${randomUUID()}:`;

  beforeAll(() => {
    redis = new Redis(url!, { lazyConnect: false, maxRetriesPerRequest: 1 });
  });

  afterAll(async () => {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  });

  it("limite kadar slot verir, sonra bekleme süresi döner", async () => {
    const rl = new RedisRateLimiter(redis, prefix);
    for (let i = 0; i < 5; i++) expect(await rl.reserve("a", 5, 10_000)).toBe(0);
    const wait = await rl.reserve("a", 5, 10_000);
    expect(wait).toBeGreaterThan(9_000);
    expect(wait).toBeLessThanOrEqual(10_000);
  });

  it("reddedilen istek slot tüketmez", async () => {
    const rl = new RedisRateLimiter(redis, prefix);
    expect(await rl.reserve("b", 1, 10_000)).toBe(0);
    await rl.reserve("b", 1, 10_000);
    await rl.reserve("b", 1, 10_000);
    expect(await redis.zcard(`${prefix}b`)).toBe(1);
  });

  it("pencere dolunca yeniden izin verir", async () => {
    const rl = new RedisRateLimiter(redis, prefix);
    expect(await rl.reserve("c", 2, 200)).toBe(0);
    expect(await rl.reserve("c", 2, 200)).toBe(0);
    expect(await rl.reserve("c", 2, 200)).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 250));
    expect(await rl.reserve("c", 2, 200)).toBe(0);
  });

  it("anahtarlar birbirinden bağımsızdır ve süre sonunda silinir", async () => {
    const rl = new RedisRateLimiter(redis, prefix);
    expect(await rl.reserve("d1", 1, 10_000)).toBe(0);
    expect(await rl.reserve("d2", 1, 10_000)).toBe(0);
    const ttl = await redis.pttl(`${prefix}d1`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(10_000);
  });

  it("birden fazla bağlantı yarışsa da limit aşılmaz", async () => {
    const clients = [redis, redis.duplicate(), redis.duplicate(), redis.duplicate()];
    const limiters = clients.map((c) => new RedisRateLimiter(c, prefix));
    const results = await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        limiters[i % limiters.length]!.reserve("e", 50, 10_000),
      ),
    );
    expect(results.filter((w) => w === 0)).toHaveLength(50);
    await Promise.all(clients.slice(1).map((c) => c.quit()));
  });
});
