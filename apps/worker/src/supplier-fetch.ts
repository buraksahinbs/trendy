import {
  dbNow,
  finishJobLog,
  getSupplierAuth,
  getSupplierForFetch,
  markMissingSupplierProducts,
  markSupplierAttempt,
  recordSupplierFetch,
  startJobLog,
  upsertSupplierProducts,
  withTenant,
  type Db,
  type RawItem,
  type TenantTx,
  type UpsertCounts,
} from "@trendy/db";
import type { XmlFetchPayload } from "@trendy/jobs";
import { normalizeSupplier, type NormalizeSummary } from "./normalize.js";
import type { Logger, SecretBox } from "@trendy/shared";
import {
  checkFeedShrink,
  contentHash,
  decodeStream,
  downloadFeed,
  FeedDownloadError,
  getAtPath,
  normalizeEncodingName,
  parseItems,
  XmlParseError,
  type DecodeStats,
  type DownloadOptions,
} from "@trendy/xml-ingest";

export interface FetchDeps {
  db: Db;
  secretBox: SecretBox;
  logger: Logger;
  /** Yalnızca testler için: indirme seçenekleri (ör. yerel sunucuya izin). */
  downloadOptions?: Partial<DownloadOptions>;
  batchSize?: number;
}

export const XML_FETCH_JOB = "xml_fetch";

export interface FetchSummary {
  supplierId: number;
  supplierName: string;
  trigger: XmlFetchPayload["trigger"];
  itemCount?: number;
  inserted?: number;
  updated?: number;
  unchanged?: number;
  missing?: number;
  invalidItems?: number;
  duplicateIds?: number;
  notModified?: boolean;
  shrinkBlocked?: { reason: "empty_feed" | "large_drop"; dropRate: number };
  reason?: "config_missing" | "inactive";
  encoding?: string;
  replacementChars?: number;
  /** Kanonik kataloğa uygulama (Faz 5). */
  normalize?: NormalizeSummary;
}

/** Kullanıcıya gösterilecek hata; tekrar deneme değeri yoksa `retryable: false`. */
export class FetchError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

/**
 * Tedarikçi feed'ini çeker ve ham ürünleri yazar (ROADMAP Faz 4).
 *
 * Akış: indir (ETag/Last-Modified) → kodlamayı çöz → streaming ayrıştır → kimlik alanına göre
 * gruplar hâlinde upsert → feed tamamen okunduysa güvenlik freni → kaybolanları işaretle.
 *
 * Kaybolan ürün işaretlemesi yalnızca feed hatasız sonuna kadar okunduğunda yapılır; yarıda
 * kesilen bir feed ürünleri "kayıp" göstermez. Stok sıfırlama gibi etkiler bu işarete bakar
 * (Faz 5/9), bu job stok değiştirmez.
 */
export async function runSupplierFetch(
  deps: FetchDeps,
  payload: XmlFetchPayload,
): Promise<FetchSummary> {
  const { db, secretBox, logger } = deps;
  const { tenantId, supplierId, trigger } = payload;
  const batchSize = deps.batchSize ?? 500;
  const tx = <T>(fn: (t: TenantTx) => Promise<T>) => withTenant(db, tenantId, fn);
  const log = logger.child({ tenantId, supplierId, job: XML_FETCH_JOB });

  const supplier = await tx((t) => getSupplierForFetch(t, supplierId));
  if (!supplier) {
    log.warn("tedarikçi bulunamadı (silinmiş olabilir)");
    return { supplierId, supplierName: "", trigger };
  }
  await tx((t) => markSupplierAttempt(t, supplierId));
  const summary: FetchSummary = { supplierId, supplierName: supplier.name, trigger };
  const jobId = await tx((t) => startJobLog(t, tenantId, XML_FETCH_JOB, { ...summary }));
  const finish = (status: "success" | "failed" | "skipped", error?: string) =>
    tx((t) => finishJobLog(t, jobId, status, { ...summary }, error));

  if (!supplier.itemPath || !supplier.externalIdPath) {
    summary.reason = "config_missing";
    await finish("skipped", "Ürün düğümü yolu veya ürün kimliği alanı tanımlı değil");
    return summary;
  }
  // Zamanlanmış çekim durdurulmuş tedarikçide çalışmaz; kullanıcı elle isterse çalışır.
  if (trigger === "schedule" && (!supplier.active || supplier.syncPaused)) {
    summary.reason = "inactive";
    await finish("skipped");
    return summary;
  }

  try {
    const auth = await tx((t) => getSupplierAuth(t, secretBox, tenantId, supplierId));
    const res = await downloadFeed(supplier.feedUrl, {
      ...(supplier.etag ? { etag: supplier.etag } : {}),
      ...(supplier.lastModified ? { lastModified: supplier.lastModified } : {}),
      ...(auth
        ? {
            headers: {
              authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`,
            },
          }
        : {}),
      ...deps.downloadOptions,
    });

    if (res.status === "not_modified") {
      summary.notModified = true;
      await tx((t) => recordSupplierFetch(t, supplierId, {}));
      // Feed değişmese de eşleştirme değişmiş olabilir.
      summary.normalize = await normalizeSupplier(db, tenantId, supplierId);
      await finish("success");
      return summary;
    }

    const runStart = await tx(dbNow);
    const fallback = supplier.encoding ? normalizeEncodingName(supplier.encoding) : undefined;
    const stats: DecodeStats = { replacementChars: 0 };
    const seen = new Set<string>();
    const totals: UpsertCounts = { inserted: 0, updated: 0, unchanged: 0 };
    let invalid = 0;
    let duplicates = 0;
    let batch: RawItem[] = [];

    const flush = async () => {
      if (batch.length === 0) return;
      const items = batch;
      batch = [];
      const c = await tx((t) => upsertSupplierProducts(t, tenantId, supplierId, items));
      totals.inserted += c.inserted;
      totals.updated += c.updated;
      totals.unchanged += c.unchanged;
    };

    try {
      const text = decodeStream(res.body, fallback ? { fallback } : {}, stats);
      for await (const item of parseItems(text, { itemPath: supplier.itemPath })) {
        const externalId = getAtPath(item, supplier.externalIdPath);
        if (!externalId) {
          invalid++;
          continue;
        }
        if (seen.has(externalId)) {
          duplicates++;
          continue;
        }
        seen.add(externalId);
        batch.push({ externalId, raw: item, hash: contentHash(item) });
        if (batch.length >= batchSize) await flush();
      }
      await flush();
    } finally {
      res.body.destroy();
    }

    Object.assign(summary, totals, {
      itemCount: seen.size,
      invalidItems: invalid,
      duplicateIds: duplicates,
      ...(stats.encoding ? { encoding: stats.encoding } : {}),
      replacementChars: stats.replacementChars,
    });

    const shrink = checkFeedShrink({
      previousCount: supplier.lastItemCount ?? 0,
      currentCount: seen.size,
    });
    if (!shrink.allowed) {
      // Güvenlik freni: kayıp işaretlenmez, referans sayı güncellenmez; kullanıcı uyarılır.
      summary.shrinkBlocked = { reason: shrink.reason, dropRate: shrink.dropRate };
      summary.missing = 0;
      await tx((t) =>
        recordSupplierFetch(t, supplierId, {
          etag: res.etag ?? null,
          lastModified: res.lastModified ?? null,
        }),
      );
      log.warn({ ...summary.shrinkBlocked }, "güvenlik freni devrede");
    } else {
      summary.missing = await tx((t) => markMissingSupplierProducts(t, supplierId, runStart));
      await tx((t) =>
        recordSupplierFetch(t, supplierId, {
          etag: res.etag ?? null,
          lastModified: res.lastModified ?? null,
          itemCount: seen.size,
        }),
      );
    }
    summary.normalize = await normalizeSupplier(db, tenantId, supplierId);
    await finish("success");
    log.info({ ...summary }, "feed çekildi");
    return summary;
  } catch (err) {
    const e = toFetchError(err);
    await finish("failed", e.message);
    log.warn({ err }, "feed çekilemedi");
    throw e;
  }
}

function toFetchError(err: unknown): FetchError {
  if (err instanceof FetchError) return err;
  if (err instanceof FeedDownloadError) {
    const retryable =
      err.code === "timeout" ||
      err.code === "network" ||
      (err.code === "http_status" && (err.httpStatus ?? 0) >= 500);
    return new FetchError(err.message, retryable);
  }
  if (err instanceof XmlParseError) {
    return new FetchError(`XML okunamadı: ${err.message}`, false);
  }
  return new FetchError(err instanceof Error ? err.message : String(err), true);
}
