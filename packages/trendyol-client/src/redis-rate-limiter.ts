import { randomUUID } from "node:crypto";
import type { RateLimiter } from "./rate-limiter.js";

/** ioredis uyumlu minimal arayüz; paket ioredis'e doğrudan bağımlı olmasın. */
export interface RedisEvalClient {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

/**
 * Kayan pencere (sliding window log), sorted set ile. Tüm adımlar tek Lua betiğinde
 * atomik çalışır; birden fazla worker aynı anahtar için yarışsa da limit aşılmaz.
 * Saat olarak Redis'in `TIME` değeri kullanılır: worker'ların saat kayması limiti bozmaz.
 *
 * Dönüş: 0 = slot ayrıldı; >0 = beklenmesi gereken ms (slot ayrılmadı).
 */
const SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local member = ARGV[3]
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
if redis.call('ZCARD', key) < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  return 0
end
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local wait = tonumber(oldest[2]) + window - now
if wait < 1 then wait = 1 end
return wait
`;

export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly redis: RedisEvalClient,
    private readonly prefix = "rl:",
  ) {}

  async reserve(key: string, limit: number, windowMs: number): Promise<number> {
    const res = await this.redis.eval(SCRIPT, 1, this.prefix + key, limit, windowMs, randomUUID());
    return Number(res);
  }
}
