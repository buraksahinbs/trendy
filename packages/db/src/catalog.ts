import { and, asc, eq, gt, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import type { TenantTx } from "./client.js";
import { products, supplierProducts, suppliers, variants } from "./schema.js";

/**
 * Kanonik katalog yazımı (ROADMAP Faz 5). Eşleştirme motorunun (`@trendy/xml-ingest` `mapItem`)
 * çıktısını `products`/`variants` tablolarına uygular. Motorun tiplerine bağımlı olmamak için
 * burada yapısal tipler tanımlıdır.
 */

export interface CatalogVariantInput {
  barcode: string;
  stockCode: string | null;
  stock: number;
  costPrice: number | null;
  currency: string;
  attributes: Record<string, string>;
  images: string[];
}

export interface CatalogProductInput {
  productMainId: string;
  title: string | null;
  description: string | null;
  brandName: string | null;
  sourceCategory: string | null;
  vatRate: number | null;
  origin: string | null;
  desi: number | null;
  variants: CatalogVariantInput[];
}

export interface CatalogIssue {
  level: "error" | "warning";
  field: string;
  code: string;
  message: string;
  barcode?: string;
}

export interface RowToNormalize {
  id: number;
  externalId: string;
  raw: unknown;
  hash: string;
}

export async function getSupplierMapping(tx: TenantTx, supplierId: number) {
  const [row] = await tx
    .select({ mapping: suppliers.mapping })
    .from(suppliers)
    .where(eq(suppliers.id, supplierId));
  return row?.mapping ?? null;
}

/**
 * Normalize edilmesi gereken ham ürünler (id sırasıyla, sayfalı): hash'i veya eşleştirmesi
 * değişenler. Kaybolan ürünler atlanır; stokları senkronda politikaya göre belirlenir.
 */
export function listRowsToNormalize(
  tx: TenantTx,
  supplierId: number,
  mappingHash: string,
  afterId: number,
  limit: number,
): Promise<RowToNormalize[]> {
  return tx
    .select({
      id: supplierProducts.id,
      externalId: supplierProducts.externalId,
      raw: supplierProducts.raw,
      hash: supplierProducts.hash,
    })
    .from(supplierProducts)
    .where(
      and(
        eq(supplierProducts.supplierId, supplierId),
        gt(supplierProducts.id, afterId),
        isNull(supplierProducts.missingSince),
        or(
          isNull(supplierProducts.normalizedHash),
          sql`${supplierProducts.normalizedHash} <> ${supplierProducts.hash} || ':' || ${mappingHash}`,
        ),
      ),
    )
    .orderBy(asc(supplierProducts.id))
    .limit(limit);
}

export interface ApplyCounts {
  products: number;
  variants: number;
  conflicts: number;
  orphaned: number;
}

/**
 * Tek bir ham ürünün eşleştirme sonucunu uygular.
 *
 * - Ürün `(tenant, product_main_id)`, varyant `(tenant, barcode)` ile eşlenir.
 * - Başka tedarikçiye ait model kodu veya başka ham ürüne ait barkod çakışma sayılır; mevcut
 *   kayıt korunur, sorun raporlanır. Sahipsiz kayıtlar (ör. Trendyol'dan içe aktarılan) sahiplenilir.
 * - Bu ham üründen önceden gelen ama artık çıktıda olmayan varyantlar silinmez: sahipliği
 *   bırakılır ve stoğu 0 yapılır (Trendyol'a 0 gider, gönderim geçmişi korunur).
 */
export async function applyNormalizedItem(
  tx: TenantTx,
  tenantId: number,
  supplierId: number,
  row: RowToNormalize,
  mappingHash: string,
  product: CatalogProductInput | null,
  mappingIssues: CatalogIssue[],
): Promise<ApplyCounts> {
  const issues = [...mappingIssues];
  const counts: ApplyCounts = { products: 0, variants: 0, conflicts: 0, orphaned: 0 };
  const kept: string[] = [];

  if (product) {
    const [existing] = await tx
      .select({ id: products.id, supplierId: products.supplierId })
      .from(products)
      .where(eq(products.productMainId, product.productMainId));
    if (existing && existing.supplierId !== null && existing.supplierId !== supplierId) {
      counts.conflicts++;
      issues.push({
        level: "error",
        field: "productMainId",
        code: "conflict",
        message: `Model kodu "${product.productMainId}" başka bir tedarikçinin ürününde kullanılıyor`,
      });
    } else {
      const fields = {
        title: product.title ?? product.productMainId,
        description: product.description,
        brandName: product.brandName,
        sourceCategory: product.sourceCategory,
        vatRate: product.vatRate,
        origin: product.origin,
        desi: product.desi,
      };
      const [p] = await tx
        .insert(products)
        .values({ tenantId, supplierId, productMainId: product.productMainId, ...fields })
        .onConflictDoUpdate({
          target: [products.tenantId, products.productMainId],
          set: { ...fields, supplierId, updatedAt: sql`now()` },
        })
        .returning({ id: products.id });
      counts.products++;

      const owners = await tx
        .select({ barcode: variants.barcode, owner: variants.supplierProductId })
        .from(variants)
        .where(
          inArray(
            variants.barcode,
            product.variants.map((v) => v.barcode),
          ),
        );
      const ownerOf = new Map(owners.map((o) => [o.barcode, o.owner]));

      for (const v of product.variants) {
        const owner = ownerOf.get(v.barcode);
        if (owner !== undefined && owner !== null && owner !== row.id) {
          counts.conflicts++;
          issues.push({
            level: "error",
            field: "barcode",
            code: "conflict",
            message: "Barkod başka bir tedarikçi ürününde kullanılıyor",
            barcode: v.barcode,
          });
          continue;
        }
        const values = {
          productId: p!.id,
          supplierProductId: row.id,
          stockCode: v.stockCode,
          stock: v.stock,
          costPrice: v.costPrice,
          currency: v.currency,
          attributes: v.attributes,
          images: v.images,
          managed: true,
        };
        await tx
          .insert(variants)
          .values({ tenantId, barcode: v.barcode, ...values })
          .onConflictDoUpdate({
            target: [variants.tenantId, variants.barcode],
            set: { ...values, updatedAt: sql`now()` },
          });
        kept.push(v.barcode);
        counts.variants++;
      }
    }
  }

  const orphaned = await tx
    .update(variants)
    .set({ supplierProductId: null, stock: 0, updatedAt: sql`now()` })
    .where(
      and(
        eq(variants.supplierProductId, row.id),
        kept.length ? notInArray(variants.barcode, kept) : undefined,
      ),
    )
    .returning({ id: variants.id });
  counts.orphaned = orphaned.length;

  await tx
    .update(supplierProducts)
    .set({
      normalizedHash: `${row.hash}:${mappingHash}`,
      normalizeIssues: issues.length ? issues : null,
      normalizedAt: sql`now()`,
    })
    .where(eq(supplierProducts.id, row.id));
  return counts;
}

/** Eşleştirme değişince tedarikçinin tüm ürünleri yeniden normalize edilsin. */
export async function resetSupplierNormalization(tx: TenantTx, supplierId: number): Promise<void> {
  await tx
    .update(supplierProducts)
    .set({ normalizedHash: null })
    .where(eq(supplierProducts.supplierId, supplierId));
}

/** Doğrulama raporu (Faz 5): tedarikçi bazında sorun kodlarının dağılımı ve örnekler. */
export async function supplierValidationReport(tx: TenantTx, supplierId: number) {
  const [totals] = await tx.execute<{
    total: number;
    normalized: number;
    with_errors: number;
    with_warnings: number;
    missing: number;
  }>(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE normalized_at IS NOT NULL)::int AS normalized,
           count(*) FILTER (WHERE normalize_issues @> '[{"level":"error"}]')::int AS with_errors,
           count(*) FILTER (WHERE normalize_issues @> '[{"level":"warning"}]')::int AS with_warnings,
           count(*) FILTER (WHERE missing_since IS NOT NULL)::int AS missing
    FROM ${supplierProducts} WHERE supplier_id = ${supplierId}
  `);
  const byCode = await tx.execute<{
    level: string;
    field: string;
    code: string;
    count: number;
  }>(sql`
    SELECT i->>'level' AS level, i->>'field' AS field, i->>'code' AS code, count(*)::int AS count
    FROM ${supplierProducts}, jsonb_array_elements(normalize_issues) i
    WHERE supplier_id = ${supplierId} AND normalize_issues IS NOT NULL
    GROUP BY 1, 2, 3 ORDER BY count DESC LIMIT 50
  `);
  const [variantTotals] = await tx.execute<{ variants: number; products: number }>(sql`
    SELECT count(v.*)::int AS variants, count(DISTINCT v.product_id)::int AS products
    FROM ${variants} v JOIN ${supplierProducts} sp ON sp.id = v.supplier_product_id
    WHERE sp.supplier_id = ${supplierId}
  `);
  return {
    supplierProducts: totals?.total ?? 0,
    normalized: totals?.normalized ?? 0,
    withErrors: totals?.with_errors ?? 0,
    withWarnings: totals?.with_warnings ?? 0,
    missing: totals?.missing ?? 0,
    products: variantTotals?.products ?? 0,
    /** Senkrona hazır varyantlar: geçerli barkod ve stokla kanonik katalogda. */
    variants: variantTotals?.variants ?? 0,
    issues: [...byCode],
  };
}
