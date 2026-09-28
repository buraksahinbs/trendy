import {
  applyNormalizedItem,
  getSupplierMapping,
  listRowsToNormalize,
  withTenant,
  type Db,
} from "@trendy/db";
import { contentHash, mapItem, mappingConfigSchema, type XmlValue } from "@trendy/xml-ingest";

export interface NormalizeSummary {
  skipped?: "mapping_missing" | "mapping_invalid";
  processed: number;
  products: number;
  variants: number;
  itemsWithErrors: number;
  conflicts: number;
  orphaned: number;
}

/**
 * Tedarikçinin değişen ham ürünlerini kanonik kataloğa uygular (ROADMAP Faz 5).
 * Hash'i ve eşleştirmesi değişmeyen ürünler atlanır; her grup kendi işleminde yazılır.
 */
export async function normalizeSupplier(
  db: Db,
  tenantId: number,
  supplierId: number,
  batchSize = 200,
): Promise<NormalizeSummary> {
  const summary: NormalizeSummary = {
    processed: 0,
    products: 0,
    variants: 0,
    itemsWithErrors: 0,
    conflicts: 0,
    orphaned: 0,
  };
  const raw = await withTenant(db, tenantId, (tx) => getSupplierMapping(tx, supplierId));
  if (raw === null) return { ...summary, skipped: "mapping_missing" };
  const parsed = mappingConfigSchema.safeParse(raw);
  if (!parsed.success) return { ...summary, skipped: "mapping_invalid" };
  const config = parsed.data;
  const mappingHash = contentHash(config).slice(0, 16);

  let afterId = 0;
  for (;;) {
    const done = await withTenant(db, tenantId, async (tx) => {
      const rows = await listRowsToNormalize(tx, supplierId, mappingHash, afterId, batchSize);
      for (const row of rows) {
        const { product, issues } = mapItem(row.raw as XmlValue, row.externalId, config);
        const c = await applyNormalizedItem(
          tx,
          tenantId,
          supplierId,
          row,
          mappingHash,
          product,
          issues,
        );
        summary.processed++;
        summary.products += c.products;
        summary.variants += c.variants;
        summary.conflicts += c.conflicts;
        summary.orphaned += c.orphaned;
        if (!product || issues.some((i) => i.level === "error") || c.conflicts > 0) {
          summary.itemsWithErrors++;
        }
        afterId = row.id;
      }
      return rows.length < batchSize;
    });
    if (done) return summary;
  }
}
