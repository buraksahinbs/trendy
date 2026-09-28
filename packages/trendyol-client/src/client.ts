import { redact } from "@trendy/shared";
import {
  TrendyolAuthError,
  TrendyolDeprecatedEndpointError,
  TrendyolError,
  TrendyolRateLimitError,
  TrendyolServerError,
  TrendyolValidationError,
} from "./errors.js";
import { ENDPOINT_LIMIT, groupLimit, type LimitGroup, type ListingTier } from "./limits.js";
import type { RateLimiter } from "./rate-limiter.js";

export const BASE_URLS = {
  prod: "https://apigw.trendyol.com",
  stage: "https://stageapigw.trendyol.com",
} as const;

export type TrendyolEnv = keyof typeof BASE_URLS;

/** pino uyumlu minimal logger. */
export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface TrendyolClientConfig {
  env: TrendyolEnv;
  sellerId: string;
  apiKey: string;
  apiSecret: string;
  /**
   * User-Agent'taki entegratör adı: kendi hesabı için "SelfIntegration",
   * aracı firma için firma adı (alfanümerik, ≤30).
   */
  integratorName: string;
  tier: ListingTier;
  limiter: RateLimiter;
  logger?: Logger;
  /** Yalnızca testler için: mock sunucu adresi. */
  baseUrl?: string;
  /** 429 için en fazla tekrar deneme. */
  maxRateLimitRetries?: number;
  /** 5xx/ağ hatası için en fazla tekrar deneme. */
  maxServerRetries?: number;
  requestTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  group: LimitGroup;
  /** Endpoint limiti anahtarı; path parametreleri farklı olsa da aynı endpoint aynı anahtarı kullanır. */
  endpoint: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

const INTEGRATOR_NAME = /^[A-Za-z0-9]{1,30}$/;
const BODY_LOG_LIMIT = 2000;
const noopLogger: Logger = { info() {}, warn() {}, error() {} };
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Trendyol'a giden TEK kapı (ROADMAP Faz 2). Her istek limiter, retry ve loglamadan geçer.
 */
export class TrendyolClient {
  readonly sellerId: string;
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly logger: Logger;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly config: TrendyolClientConfig) {
    if (!/^\d+$/.test(config.sellerId)) throw new Error("sellerId yalnızca rakamlardan oluşmalı");
    if (!INTEGRATOR_NAME.test(config.integratorName)) {
      throw new Error("integratorName alfanümerik ve en fazla 30 karakter olmalı");
    }
    this.sellerId = config.sellerId;
    this.baseUrl = (config.baseUrl ?? BASE_URLS[config.env]).replace(/\/$/, "");
    // ⚠️ DOĞRULA (ROADMAP §9 #1): kullanıcı adı = API Key, şifre = API Secret varsayıldı.
    const token = Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString("base64");
    this.headers = {
      authorization: `Basic ${token}`,
      "user-agent": `${config.sellerId} - ${config.integratorName}`,
      accept: "application/json",
    };
    this.logger = config.logger ?? noopLogger;
    this.sleep = config.sleep ?? defaultSleep;
    this.random = config.random ?? Math.random;
  }

  async request<T>(opts: RequestOptions): Promise<T> {
    const url = new URL(this.baseUrl + opts.path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const maxRateRetries = this.config.maxRateLimitRetries ?? 5;
    const maxServerRetries = this.config.maxServerRetries ?? 3;
    let rateRetries = 0;
    let serverRetries = 0;

    for (let attempt = 1; ; attempt++) {
      await this.acquire(opts);
      const started = Date.now();
      const logCtx = { method: opts.method, path: opts.path, attempt };

      let res: Response;
      try {
        res = await fetch(url, {
          method: opts.method,
          headers:
            opts.body === undefined
              ? this.headers
              : { ...this.headers, "content-type": "application/json" },
          body: opts.body === undefined ? null : JSON.stringify(opts.body),
          signal: AbortSignal.timeout(this.config.requestTimeoutMs ?? 30_000),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn({ ...logCtx, err: message }, "trendyol ağ hatası");
        if (serverRetries++ < maxServerRetries) {
          await this.sleep(this.backoff(serverRetries));
          continue;
        }
        throw new TrendyolServerError(`Ağ hatası: ${message}`, undefined, opts.method, opts.path);
      }

      const durationMs = Date.now() - started;
      const text = await res.text();
      const status = res.status;

      if (status >= 200 && status < 300) {
        this.logger.info({ ...logCtx, status, durationMs }, "trendyol isteği");
        if (!text) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          // Bakım sayfası vb. JSON olmayan 2xx yanıt: geçici sunucu sorunu gibi tekrar denenir.
          this.logger.warn({ ...logCtx, status }, "trendyol yanıtı JSON değil");
          if (serverRetries++ < maxServerRetries) {
            await this.sleep(this.backoff(serverRetries));
            continue;
          }
          throw new TrendyolServerError(
            "Trendyol yanıtı okunamadı (JSON değil)",
            status,
            opts.method,
            opts.path,
            text.slice(0, BODY_LOG_LIMIT),
          );
        }
      }

      const snippet = text.slice(0, BODY_LOG_LIMIT);
      this.logger.warn(
        redact({ ...logCtx, status, durationMs, body: snippet }),
        "trendyol hata yanıtı",
      );
      const fail = <E extends TrendyolError>(
        Cls: new (m: string, s: number, me: string, p: string, b?: string) => E,
        msg: string,
      ) => new Cls(msg, status, opts.method, opts.path, snippet);

      if (status === 429) {
        if (rateRetries++ < maxRateRetries) {
          await this.sleep(this.retryAfter(res) ?? this.backoff(rateRetries));
          continue;
        }
        throw fail(TrendyolRateLimitError, "Trendyol istek limiti aşıldı (429)");
      }
      if (status >= 500) {
        if (serverRetries++ < maxServerRetries) {
          await this.sleep(this.backoff(serverRetries));
          continue;
        }
        throw fail(TrendyolServerError, `Trendyol sunucu hatası (${status})`);
      }
      if (status === 426) {
        this.logger.error({ ...logCtx, status }, "KULLANIMDAN KALKMIŞ ENDPOINT");
        throw fail(TrendyolDeprecatedEndpointError, `Endpoint kullanımdan kalkmış: ${opts.path}`);
      }
      if (status === 401) throw fail(TrendyolAuthError, "API bilgileri hatalı (401)");
      if (status === 403)
        throw fail(TrendyolAuthError, "Erişim reddedildi (403); User-Agent/yetki kontrol edilmeli");
      throw fail(TrendyolValidationError, `Trendyol isteği reddetti (${status})`);
    }
  }

  /** Grup ve endpoint limitlerinden slot alana kadar bekler. */
  private async acquire(opts: RequestOptions): Promise<void> {
    const seller = this.config.sellerId;
    const group = groupLimit(opts.group, this.config.tier);
    const buckets = [
      ...(group ? [{ key: `ty:${seller}:group:${opts.group}`, ...group }] : []),
      { key: `ty:${seller}:endpoint:${opts.endpoint}`, ...ENDPOINT_LIMIT },
    ];
    for (const b of buckets) {
      for (;;) {
        const wait = await this.config.limiter.reserve(b.key, b.limit, b.windowMs);
        if (wait <= 0) break;
        await this.sleep(wait);
      }
    }
  }

  /** Üstel geri çekilme + jitter: 1s, 2s, 4s… (en fazla 60s). */
  private backoff(retry: number): number {
    const base = Math.min(60_000, 1000 * 2 ** (retry - 1));
    return base + Math.floor(this.random() * 1000);
  }

  private retryAfter(res: Response): number | undefined {
    const h = res.headers.get("retry-after");
    if (!h) return undefined;
    const sec = Number(h);
    return Number.isFinite(sec) && sec >= 0 ? Math.min(sec * 1000, 60_000) : undefined;
  }
}
