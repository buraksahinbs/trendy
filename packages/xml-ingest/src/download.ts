import http from "node:http";
import https from "node:https";
import net from "node:net";
import { Transform, type Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { BlockedAddressError, isBlockedAddress, safeLookup } from "./ssrf.js";

export interface DownloadOptions {
  /** Tüm indirme için üst süre. */
  timeoutMs?: number;
  /** Açılmış (decompress edilmiş) veri için üst sınır; gzip bombasına karşı da korur. */
  maxBytes?: number;
  maxRedirects?: number;
  /** Tedarikçi Basic Auth veya token header'ları. Farklı host'a yönlendirmede gönderilmez. */
  headers?: Record<string, string>;
  etag?: string;
  lastModified?: string;
  /** Yalnızca testler için: yerel test sunucusuna bağlanmaya izin verir. */
  allowPrivateNetwork?: boolean;
}

export type DownloadResult =
  | { status: "not_modified" }
  | {
      status: "ok";
      body: Readable;
      etag?: string;
      lastModified?: string;
      contentType?: string;
      finalUrl: string;
    };

export type FeedDownloadErrorCode =
  | "invalid_url"
  | "blocked_address"
  | "http_status"
  | "too_many_redirects"
  | "too_large"
  | "timeout"
  | "network";

export class FeedDownloadError extends Error {
  constructor(
    readonly code: FeedDownloadErrorCode,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "FeedDownloadError";
  }
}

const DEFAULTS = {
  timeoutMs: 120_000,
  maxBytes: 500 * 1024 * 1024,
  maxRedirects: 5,
};

function parseFeedUrl(raw: string, allowPrivate: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FeedDownloadError("invalid_url", `Geçersiz URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FeedDownloadError("invalid_url", `Yalnızca http/https desteklenir: ${url.protocol}`);
  }
  // IP literal'lerde DNS çözümlemesi yapılmaz, lookup kontrolü devreye girmez.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate && net.isIP(host) && isBlockedAddress(host)) {
    throw new FeedDownloadError("blocked_address", `İzin verilmeyen adres: ${host}`);
  }
  return url;
}

function limitBytes(maxBytes: number): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length;
      if (total > maxBytes) {
        cb(new FeedDownloadError("too_large", `Feed ${maxBytes} byte sınırını aştı`));
        return;
      }
      cb(null, chunk);
    },
  });
}

function request(
  url: URL,
  headers: Record<string, string>,
  opts: Required<Pick<DownloadOptions, "allowPrivateNetwork">> & { signal: AbortSignal },
) {
  const mod = url.protocol === "https:" ? https : http;
  return new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = mod.get(url, {
      headers,
      signal: opts.signal,
      ...(opts.allowPrivateNetwork ? {} : { lookup: safeLookup }),
    });
    req.on("response", resolve);
    req.on("error", reject);
  });
}

function toDownloadError(err: unknown, signal: AbortSignal): FeedDownloadError {
  if (err instanceof FeedDownloadError) return err;
  if (err instanceof BlockedAddressError)
    return new FeedDownloadError("blocked_address", err.message);
  if (signal.aborted) return new FeedDownloadError("timeout", "Feed indirme zaman aşımına uğradı");
  return new FeedDownloadError("network", err instanceof Error ? err.message : String(err));
}

export async function downloadFeed(
  rawUrl: string,
  options: DownloadOptions = {},
): Promise<DownloadResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
  const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;
  const allowPrivateNetwork = options.allowPrivateNetwork ?? false;
  const signal = AbortSignal.timeout(timeoutMs);

  let url = parseFeedUrl(rawUrl, allowPrivateNetwork);
  const originHost = url.host;

  for (let redirects = 0; ; redirects++) {
    const headers: Record<string, string> = { "accept-encoding": "gzip" };
    if (url.host === originHost) Object.assign(headers, options.headers);
    if (options.etag) headers["if-none-match"] = options.etag;
    if (options.lastModified) headers["if-modified-since"] = options.lastModified;

    let res: http.IncomingMessage;
    try {
      res = await request(url, headers, { allowPrivateNetwork, signal });
    } catch (err) {
      throw toDownloadError(err, signal);
    }

    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && status !== 304) {
      res.resume();
      const location = res.headers.location;
      if (!location)
        throw new FeedDownloadError("http_status", "Yönlendirmede Location yok", status);
      if (redirects >= maxRedirects) {
        throw new FeedDownloadError("too_many_redirects", `${maxRedirects} yönlendirme aşıldı`);
      }
      url = parseFeedUrl(new URL(location, url).toString(), allowPrivateNetwork);
      continue;
    }
    if (status === 304) {
      res.resume();
      return { status: "not_modified" };
    }
    if (status < 200 || status >= 300) {
      res.resume();
      throw new FeedDownloadError("http_status", `Tedarikçi sunucusu ${status} döndü`, status);
    }

    const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
    const gzipped = encoding.includes("gzip") || url.pathname.toLowerCase().endsWith(".gz");
    const limiter = limitBytes(maxBytes);
    const forward = (err: unknown) => limiter.destroy(toDownloadError(err, signal));
    res.on("error", forward);
    if (gzipped) {
      const gunzip = createGunzip();
      gunzip.on("error", forward);
      res.pipe(gunzip).pipe(limiter);
    } else {
      res.pipe(limiter);
    }

    const result: DownloadResult = { status: "ok", body: limiter, finalUrl: url.toString() };
    const etag = res.headers.etag;
    const lastModified = res.headers["last-modified"];
    const contentType = res.headers["content-type"];
    if (etag) result.etag = etag;
    if (lastModified) result.lastModified = lastModified;
    if (contentType) result.contentType = contentType;
    return result;
  }
}
