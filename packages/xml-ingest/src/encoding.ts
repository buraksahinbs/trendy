import iconv from "iconv-lite";

export const SUPPORTED_ENCODINGS = ["utf-8", "iso-8859-9", "windows-1254"] as const;
export type SupportedEncoding = (typeof SUPPORTED_ENCODINGS)[number];

const ALIASES: Record<string, SupportedEncoding> = {
  "utf-8": "utf-8",
  utf8: "utf-8",
  "iso-8859-9": "iso-8859-9",
  "iso8859-9": "iso-8859-9",
  latin5: "iso-8859-9",
  "windows-1254": "windows-1254",
  cp1254: "windows-1254",
};

export function normalizeEncodingName(name: string): SupportedEncoding | undefined {
  return ALIASES[name.trim().toLowerCase()];
}

export interface DetectedEncoding {
  /** XML deklarasyonunda yazan ad (desteklenmese bile). */
  declared?: string;
  bom: boolean;
  encoding?: SupportedEncoding;
}

/** İlk byte'lardan BOM ve `<?xml ... encoding="..."?>` bilgisini okur. */
export function detectEncoding(head: Buffer): DetectedEncoding {
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
    return { bom: true, encoding: "utf-8" };
  }
  const prolog = head.subarray(0, 256).toString("latin1");
  const match = /^\s*<\?xml[^>]*?encoding\s*=\s*["']([^"']+)["']/i.exec(prolog);
  if (!match?.[1]) return { bom: false };
  const declared = match[1];
  const encoding = normalizeEncodingName(declared);
  return encoding ? { declared, bom: false, encoding } : { declared, bom: false };
}

export interface DecodeOptions {
  /** Deklarasyon yoksa veya desteklenmiyorsa kullanılacak kodlama. */
  fallback?: SupportedEncoding;
  /** Deklarasyonu yok sayar. "utf-8 yazıyor ama aslında windows-1254" feed'leri için. */
  force?: SupportedEncoding;
}

export interface DecodeStats {
  encoding?: SupportedEncoding;
  detected?: DetectedEncoding;
  /** Çözülemeyen karakter sayısı (U+FFFD). Yüksekse yanlış kodlama seçilmiştir. */
  replacementChars: number;
}

/**
 * Byte akışını metne çevirir. Kodlama ilk chunk'tan belirlenir, sonra sabit kalır.
 * `stats` yineleme bittikten sonra doludur.
 */
export async function* decodeStream(
  source: AsyncIterable<Buffer | string>,
  options: DecodeOptions = {},
  stats: DecodeStats = { replacementChars: 0 },
): AsyncGenerator<string> {
  let decoder: ReturnType<typeof iconv.getDecoder> | undefined;
  const count = (s: string) => {
    for (const ch of s) if (ch === "�") stats.replacementChars++;
    return s;
  };

  // Deklarasyon birden fazla chunk'a bölünebilir; tamamlanana kadar baş kısım biriktirilir.
  let head: Buffer | undefined = Buffer.alloc(0);
  const start = (buf: Buffer) => {
    const detected = detectEncoding(buf);
    const encoding = options.force ?? detected.encoding ?? options.fallback ?? "utf-8";
    stats.detected = detected;
    stats.encoding = encoding;
    decoder = iconv.getDecoder(encoding, { stripBOM: true });
    return decoder.write(buf);
  };

  for await (const raw of source) {
    const chunk = typeof raw === "string" ? Buffer.from(raw) : raw;
    let text: string;
    if (head) {
      head = Buffer.concat([head, chunk]);
      if (!isHeadComplete(head)) continue;
      text = start(head);
      head = undefined;
    } else {
      text = decoder!.write(chunk);
    }
    if (text) yield count(text);
  }
  if (head) {
    const text = start(head);
    if (text) yield count(text);
  }
  const tail = decoder?.end();
  if (tail) yield count(tail);
}

const HEAD_MAX = 1024;

function isHeadComplete(head: Buffer): boolean {
  if (head.length >= HEAD_MAX) return true;
  const s = head
    .toString("latin1")
    .replace(/^﻿|^ï»¿/, "")
    .trimStart();
  if (s.length < 5) return false;
  if (!s.startsWith("<?xml")) return true;
  return s.includes("?>");
}
