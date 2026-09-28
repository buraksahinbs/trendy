import { asc, eq } from "drizzle-orm";
import type { TenantTx } from "./client.js";
import { pricingRules } from "./schema.js";

/** API/panel biçimi: kuruş alanları tamsayı, oranlar 0–1 arası. */
export interface PricingRuleInput {
  scope: "brand" | "category" | "supplier" | "general";
  /** scope "general" ise null; marka adı, kaynak kategori veya tedarikçi id'si. */
  scopeKey: string | null;
  multiplier: number;
  addFixed: number;
  rounding: { kind: "none" } | { kind: "ending"; kurus: number };
  minMarginRate: number | null;
  commissionRate: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  listPriceRule: { kind: "same" } | { kind: "multiplier"; value: number };
}

export type PricingRuleRow = PricingRuleInput & { id: number; createdAt: Date };

const columns = {
  id: pricingRules.id,
  scope: pricingRules.scope,
  scopeKey: pricingRules.scopeKey,
  multiplier: pricingRules.multiplier,
  addFixed: pricingRules.addFixed,
  rounding: pricingRules.rounding,
  minMarginRate: pricingRules.minMarginRate,
  commissionRate: pricingRules.commissionRate,
  minPrice: pricingRules.minPrice,
  maxPrice: pricingRules.maxPrice,
  listPriceRule: pricingRules.listPriceRule,
  createdAt: pricingRules.createdAt,
};

const asRow = (r: Record<string, unknown>) => r as unknown as PricingRuleRow;

export async function listPricingRules(tx: TenantTx): Promise<PricingRuleRow[]> {
  const rows = await tx.select(columns).from(pricingRules).orderBy(asc(pricingRules.id));
  return rows.map(asRow);
}

/** Aynı kapsamda ikinci kural benzersizlik indeksine takılır (API 409 döner). */
export async function createPricingRule(
  tx: TenantTx,
  tenantId: number,
  input: PricingRuleInput,
): Promise<PricingRuleRow> {
  const [row] = await tx
    .insert(pricingRules)
    .values({ tenantId, ...input })
    .returning(columns);
  return asRow(row!);
}

export async function updatePricingRule(
  tx: TenantTx,
  id: number,
  input: PricingRuleInput,
): Promise<PricingRuleRow | undefined> {
  const [row] = await tx
    .update(pricingRules)
    .set(input)
    .where(eq(pricingRules.id, id))
    .returning(columns);
  return row ? asRow(row) : undefined;
}

export async function deletePricingRule(tx: TenantTx, id: number): Promise<boolean> {
  const rows = await tx
    .delete(pricingRules)
    .where(eq(pricingRules.id, id))
    .returning({ id: pricingRules.id });
  return rows.length > 0;
}

/** Postgres benzersizlik ihlali (23505) mi? drizzle hatayı `cause` içine sarabilir. */
export function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 3; e = (e as { cause?: unknown }).cause, i++) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}
