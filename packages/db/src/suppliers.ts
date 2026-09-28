import type { SecretBox } from "@trendy/shared";
import { and, count, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Db, TenantTx } from "./client.js";
import { jobLogs, supplierProducts, suppliers, tenants } from "./schema.js";

// ── Tedarikçiler ─────────────────────────────────────────────────────────────

export interface SupplierAuth {
  username: string;
  password: string;
}

export interface SupplierInput {
  name: string;
  feedUrl: string;
  itemPath?: string | null;
  externalIdPath?: string | null;
  /** Doğrulanmış `MappingConfig`; null eşleştirmeyi kaldırır. */
  mapping?: unknown;
  encoding?: string | null;
  scheduleCron?: string;
  active?: boolean;
  syncPaused?: boolean;
}

const authContext = (tenantId: number, supplierId: number) =>
  `tenant:${tenantId}:supplier:${supplierId}:auth`;

/** Panelde gösterilen alanlar; şifreli kimlik bilgisi yerine yalnızca var/yok bilgisi. */
const publicColumns = {
  id: suppliers.id,
  name: suppliers.name,
  feedUrl: suppliers.feedUrl,
  itemPath: suppliers.itemPath,
  externalIdPath: suppliers.externalIdPath,
  mapping: suppliers.mapping,
  encoding: suppliers.encoding,
  scheduleCron: suppliers.scheduleCron,
  active: suppliers.active,
  syncPaused: suppliers.syncPaused,
  lastFetchedAt: suppliers.lastFetchedAt,
  lastItemCount: suppliers.lastItemCount,
  createdAt: suppliers.createdAt,
  hasAuth: sql<boolean>`${suppliers.authEnc} IS NOT NULL`,
};

export type SupplierView = Awaited<ReturnType<typeof listSuppliers>>[number];

export function listSuppliers(tx: TenantTx) {
  return tx.select(publicColumns).from(suppliers).orderBy(suppliers.id);
}

export async function getSupplier(tx: TenantTx, id: number) {
  const [row] = await tx.select(publicColumns).from(suppliers).where(eq(suppliers.id, id));
  return row;
}

export async function createSupplier(
  tx: TenantTx,
  box: SecretBox,
  tenantId: number,
  input: SupplierInput & { auth?: SupplierAuth | null },
): Promise<number> {
  const { auth, ...fields } = input;
  const [row] = await tx
    .insert(suppliers)
    .values({ ...fields, tenantId })
    .returning({ id: suppliers.id });
  const id = row!.id;
  // Şifreleme bağlamı tedarikçi id'sini içerdiği için kayıttan sonra yazılır.
  if (auth) await setSupplierAuth(tx, box, tenantId, id, auth);
  return id;
}

export async function updateSupplier(tx: TenantTx, id: number, input: Partial<SupplierInput>) {
  if (Object.keys(input).length === 0) return getSupplier(tx, id);
  // Adres değişince önbellek başlıkları geçersizdir; eski ETag yeni feed'i "değişmedi" sanmasın.
  const reset = input.feedUrl !== undefined ? { etag: null, lastModified: null } : {};
  const [row] = await tx
    .update(suppliers)
    .set({ ...input, ...reset })
    .where(eq(suppliers.id, id))
    .returning({ id: suppliers.id });
  return row ? getSupplier(tx, id) : undefined;
}

export async function setSupplierAuth(
  tx: TenantTx,
  box: SecretBox,
  tenantId: number,
  id: number,
  auth: SupplierAuth | null,
): Promise<void> {
  const authEnc = auth ? box.encrypt(JSON.stringify(auth), authContext(tenantId, id)) : null;
  await tx.update(suppliers).set({ authEnc }).where(eq(suppliers.id, id));
}

export async function getSupplierAuth(
  tx: TenantTx,
  box: SecretBox,
  tenantId: number,
  id: number,
): Promise<SupplierAuth | undefined> {
  const [row] = await tx
    .select({ authEnc: suppliers.authEnc })
    .from(suppliers)
    .where(eq(suppliers.id, id));
  if (!row?.authEnc) return undefined;
  return JSON.parse(box.decrypt(row.authEnc, authContext(tenantId, id))) as SupplierAuth;
}

export async function deleteSupplier(tx: TenantTx, id: number): Promise<boolean> {
  const rows = await tx
    .delete(suppliers)
    .where(eq(suppliers.id, id))
    .returning({ id: suppliers.id });
  return rows.length > 0;
}

/** Çekim sonrası durum: önbellek başlıkları ve (fren devrede değilse) ürün sayısı. */
export async function recordSupplierFetch(
  tx: TenantTx,
  id: number,
  input: { etag?: string | null; lastModified?: string | null; itemCount?: number },
): Promise<void> {
  await tx
    .update(suppliers)
    .set({
      lastFetchedAt: sql`now()`,
      ...(input.etag !== undefined ? { etag: input.etag } : {}),
      ...(input.lastModified !== undefined ? { lastModified: input.lastModified } : {}),
      ...(input.itemCount !== undefined ? { lastItemCount: input.itemCount } : {}),
    })
    .where(eq(suppliers.id, id));
}

/**
 * Zamanlayıcı için (sistem bağlantısı): aktif, duraklatılmamış ve tenant'ı durdurulmamış
 * tedarikçiler.
 */
export function listSchedulableSuppliers(db: Db) {
  return db
    .select({
      id: suppliers.id,
      tenantId: suppliers.tenantId,
      scheduleCron: suppliers.scheduleCron,
      lastAttemptAt: suppliers.lastAttemptAt,
      createdAt: suppliers.createdAt,
    })
    .from(suppliers)
    .innerJoin(tenants, eq(tenants.id, suppliers.tenantId))
    .where(
      and(
        eq(suppliers.active, true),
        eq(suppliers.syncPaused, false),
        eq(tenants.syncPaused, false),
      ),
    );
}

export async function markSupplierAttempt(tx: TenantTx, id: number): Promise<void> {
  await tx
    .update(suppliers)
    .set({ lastAttemptAt: sql`now()` })
    .where(eq(suppliers.id, id));
}

/** Worker için tam kayıt (önbellek başlıkları dahil). */
export async function getSupplierForFetch(tx: TenantTx, id: number) {
  const [row] = await tx.select().from(suppliers).where(eq(suppliers.id, id));
  return row;
}

// ── Ham tedarikçi ürünleri ───────────────────────────────────────────────────

export interface RawItem {
  externalId: string;
  raw: unknown;
  hash: string;
}

export interface UpsertCounts {
  inserted: number;
  updated: number;
  unchanged: number;
}

/**
 * Bir grup ham ürünü yazar. Aynı grupta aynı `externalId` iki kez olmamalı (çağıran ayıklar).
 * Tüm satırların `last_seen_at` değeri yenilenir ve kayıp işareti kalkar; kaybolan ürün tespiti
 * buna dayanır.
 */
export async function upsertSupplierProducts(
  tx: TenantTx,
  tenantId: number,
  supplierId: number,
  items: RawItem[],
): Promise<UpsertCounts> {
  if (items.length === 0) return { inserted: 0, updated: 0, unchanged: 0 };
  const existing = await tx
    .select({ externalId: supplierProducts.externalId, hash: supplierProducts.hash })
    .from(supplierProducts)
    .where(
      and(
        eq(supplierProducts.supplierId, supplierId),
        inArray(
          supplierProducts.externalId,
          items.map((i) => i.externalId),
        ),
      ),
    );
  const oldHash = new Map(existing.map((e) => [e.externalId, e.hash]));
  const counts = { inserted: 0, updated: 0, unchanged: 0 };
  for (const i of items) {
    const h = oldHash.get(i.externalId);
    if (h === undefined) counts.inserted++;
    else if (h !== i.hash) counts.updated++;
    else counts.unchanged++;
  }

  await tx
    .insert(supplierProducts)
    .values(items.map((i) => ({ tenantId, supplierId, ...i })))
    .onConflictDoUpdate({
      target: [supplierProducts.supplierId, supplierProducts.externalId],
      set: {
        raw: sql`excluded.raw`,
        hash: sql`excluded.hash`,
        lastSeenAt: sql`now()`,
        missingSince: null,
      },
    });
  return counts;
}

/** `before` anından beri feed'de görülmeyen ürünleri kayıp olarak işaretler. */
export async function markMissingSupplierProducts(
  tx: TenantTx,
  supplierId: number,
  before: Date,
): Promise<number> {
  const rows = await tx
    .update(supplierProducts)
    .set({ missingSince: sql`now()` })
    .where(
      and(
        eq(supplierProducts.supplierId, supplierId),
        lt(supplierProducts.lastSeenAt, before),
        isNull(supplierProducts.missingSince),
      ),
    )
    .returning({ id: supplierProducts.id });
  return rows.length;
}

export async function listSupplierProducts(
  tx: TenantTx,
  supplierId: number,
  { limit, offset }: { limit: number; offset: number },
) {
  const where = eq(supplierProducts.supplierId, supplierId);
  const [totals] = await tx
    .select({
      total: count(),
      missing:
        sql<number>`count(*) FILTER (WHERE ${isNotNull(supplierProducts.missingSince)})`.mapWith(
          Number,
        ),
    })
    .from(supplierProducts)
    .where(where);
  const items = await tx
    .select({
      id: supplierProducts.id,
      externalId: supplierProducts.externalId,
      raw: supplierProducts.raw,
      lastSeenAt: supplierProducts.lastSeenAt,
      missingSince: supplierProducts.missingSince,
      normalizeIssues: supplierProducts.normalizeIssues,
      normalizedAt: supplierProducts.normalizedAt,
    })
    .from(supplierProducts)
    .where(where)
    .orderBy(supplierProducts.id)
    .limit(limit)
    .offset(offset);
  return { total: totals?.total ?? 0, missing: totals?.missing ?? 0, items };
}

// ── İşlem logları ────────────────────────────────────────────────────────────

export type JobStatus = "running" | "success" | "failed" | "skipped";

export async function startJobLog(
  tx: TenantTx,
  tenantId: number,
  jobType: string,
  summary: Record<string, unknown>,
): Promise<number> {
  const [row] = await tx
    .insert(jobLogs)
    .values({ tenantId, jobType, status: "running", summary })
    .returning({ id: jobLogs.id });
  return row!.id;
}

export async function finishJobLog(
  tx: TenantTx,
  id: number,
  status: Exclude<JobStatus, "running">,
  summary: Record<string, unknown>,
  error?: string,
): Promise<void> {
  await tx
    .update(jobLogs)
    .set({ status, summary, error: error ?? null, finishedAt: sql`now()` })
    .where(eq(jobLogs.id, id));
}

export function listJobLogs(tx: TenantTx, opts: { limit: number; supplierId?: number }) {
  return tx
    .select({
      id: jobLogs.id,
      jobType: jobLogs.jobType,
      status: jobLogs.status,
      summary: jobLogs.summary,
      error: jobLogs.error,
      startedAt: jobLogs.startedAt,
      finishedAt: jobLogs.finishedAt,
    })
    .from(jobLogs)
    .where(
      opts.supplierId !== undefined
        ? sql`${jobLogs.summary}->>'supplierId' = ${String(opts.supplierId)}`
        : undefined,
    )
    .orderBy(desc(jobLogs.startedAt), desc(jobLogs.id))
    .limit(opts.limit);
}

/** Veritabanı saati: çekim başlangıcı ile `last_seen_at` aynı saatle karşılaştırılsın. */
export async function dbNow(tx: TenantTx): Promise<Date> {
  const [row] = await tx.execute<{ now: string }>(sql`SELECT now() AS now`);
  return new Date(row!.now);
}
