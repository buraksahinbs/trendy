/**
 * Kayan pencere (sliding window log) limiter arayüzü.
 * `reserve` izin varsa slotu hemen ayırır ve 0 döner; yoksa beklenmesi gereken ms'yi döner
 * (bu durumda slot ayrılmaz).
 *
 * Birden fazla worker süreci aynı satıcı için istek atacağından üretimde Redis tabanlı
 * uygulama kullanılmalı. Bellek içi uygulama testler ve tek süreçli geliştirme içindir.
 */
export interface RateLimiter {
  reserve(key: string, limit: number, windowMs: number): Promise<number>;
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  async reserve(key: string, limit: number, windowMs: number): Promise<number> {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter((ts) => ts > t - windowMs);
    if (list.length < limit) {
      list.push(t);
      this.hits.set(key, list);
      return 0;
    }
    this.hits.set(key, list);
    return list[0]! + windowMs - t;
  }
}
