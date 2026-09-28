import { downloadFeed } from "./download.js";
import { decodeStream, type SupportedEncoding } from "./encoding.js";
import { suggestIdFields, type IdFieldSuggestion } from "./fields.js";
import {
  parseItems,
  suggestItemPaths,
  XmlParseError,
  type PathSuggestion,
  type XmlObject,
} from "./parser.js";

/**
 * Feed analizi (ROADMAP Faz 4 "Önizleme"): tedarikçi eklenirken ürün düğümü yolunu ve
 * ürün kimliği alanını önerir. Dosyanın yalnızca başı okunur.
 */
export interface FeedDetection {
  itemPaths: PathSuggestion[];
  /** Kullanılan ürün düğümü yolu: istenen veya en olası öneri. */
  itemPath: string | null;
  idFields: IdFieldSuggestion[];
  sampleItems: (XmlObject | string)[];
  sampleCount: number;
}

export interface DetectOptions {
  itemPath?: string;
  /** Okunacak en fazla karakter. */
  maxChars?: number;
  /** Kimlik alanı önerisi için incelenecek ürün sayısı. */
  sampleSize?: number;
}

async function* replay(chunks: string[]): AsyncGenerator<string> {
  yield* chunks;
}

export async function detectFeed(
  source: AsyncIterable<string>,
  { itemPath, maxChars = 5_000_000, sampleSize = 50 }: DetectOptions = {},
): Promise<FeedDetection> {
  const chunks: string[] = [];
  let size = 0;
  let truncated = false;
  for await (const chunk of source) {
    chunks.push(chunk);
    size += chunk.length;
    if (size >= maxChars) {
      truncated = true;
      break;
    }
  }

  const itemPaths = await suggestItemPaths(replay(chunks));
  const chosen = itemPath ?? itemPaths[0]?.path ?? null;
  const items: (XmlObject | string)[] = [];
  if (chosen) {
    try {
      for await (const item of parseItems(replay(chunks), { itemPath: chosen })) {
        items.push(item);
        if (items.length >= sampleSize) break;
      }
    } catch (err) {
      // Dosyanın yalnızca başı okunduysa sondaki yarım düğüm hata verir; örnek yeterliyse sorun değil.
      if (!(err instanceof XmlParseError && truncated && items.length > 0)) throw err;
    }
  }
  return {
    itemPaths,
    itemPath: chosen,
    idFields: suggestIdFields(items),
    sampleItems: items.slice(0, 3),
    sampleCount: items.length,
  };
}

export interface DetectFromUrlOptions extends DetectOptions {
  headers?: Record<string, string>;
  encoding?: SupportedEncoding;
  timeoutMs?: number;
  /** Yalnızca testler için. */
  allowPrivateNetwork?: boolean;
}

/** Feed'i indirir (SSRF korumalı), başını analiz eder ve bağlantıyı kapatır. */
export async function detectFeedFromUrl(
  url: string,
  opts: DetectFromUrlOptions = {},
): Promise<FeedDetection> {
  const res = await downloadFeed(url, {
    timeoutMs: opts.timeoutMs ?? 30_000,
    ...(opts.headers ? { headers: opts.headers } : {}),
    ...(opts.allowPrivateNetwork ? { allowPrivateNetwork: true } : {}),
  });
  if (res.status !== "ok") throw new Error("Beklenmeyen 304 yanıtı");
  try {
    return await detectFeed(
      decodeStream(res.body, opts.encoding ? { fallback: opts.encoding } : {}),
      opts,
    );
  } finally {
    res.body.destroy();
  }
}
