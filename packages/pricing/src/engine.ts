import type { Kurus } from "@trendy/shared";
import type {
  GuardrailConfig,
  PricingInput,
  PricingResult,
  PricingRule,
  Rounding,
  RuleScope,
} from "./types.js";

const SCOPE_PRIORITY: RuleScope[] = ["brand", "category", "supplier", "general"];

export interface RuleContext {
  brand?: string;
  category?: string;
  supplier?: string;
}

/** En spesifik kural kazanır: marka > kategori > tedarikçi > genel. */
export function resolveRule(rules: PricingRule[], ctx: RuleContext): PricingRule | undefined {
  for (const scope of SCOPE_PRIORITY) {
    const key = scope === "general" ? undefined : ctx[scope];
    const match = rules.find(
      (r) =>
        r.scope === scope && (scope === "general" || (key !== undefined && r.scopeKey === key)),
    );
    if (match) return match;
  }
  return undefined;
}

/** Değeri, verilen bitiş hanesine sahip ve değerden küçük olmayan en yakın tutara yuvarlar. */
export function applyRounding(value: Kurus, rounding: Rounding): Kurus {
  if (rounding.kind === "none") return value;
  const ending = rounding.kurus;
  const base = Math.floor(value / 100) * 100 + ending;
  return base >= value ? base : base + 100;
}

/**
 * Hesaplama sırası sabittir (ROADMAP Faz 7):
 * maliyet → döviz → çarpan → sabit ekleme → marj tabanı → yuvarlama → min/max → guardrail.
 */
export function calculatePrice(
  input: PricingInput,
  rule: PricingRule,
  guard: GuardrailConfig,
): PricingResult {
  const blocked = (reason: "invalid_input" | "non_positive_price" | "below_cost", detail: string) =>
    ({ status: "blocked", reason, ruleId: rule.id, detail }) as const;

  const { cost, fxRate } = input;
  if (!Number.isFinite(cost) || cost <= 0) return blocked("invalid_input", `maliyet: ${cost}`);
  if (!Number.isFinite(fxRate) || fxRate <= 0) return blocked("invalid_input", `kur: ${fxRate}`);
  if (!Number.isFinite(rule.multiplier) || rule.multiplier <= 0) {
    return blocked("invalid_input", `çarpan: ${rule.multiplier}`);
  }

  if (rule.rounding.kind === "ending") {
    const e = rule.rounding.kurus;
    if (!Number.isInteger(e) || e < 0 || e > 99) return blocked("invalid_input", `yuvarlama: ${e}`);
  }

  const costTry = Math.round(cost * fxRate);
  let price = Math.round(costTry * rule.multiplier) + rule.addFixed;

  const commission = rule.commissionRate ?? 0;
  if (commission < 0 || commission >= 1) return blocked("invalid_input", `komisyon: ${commission}`);
  if (rule.minMarginRate !== undefined) {
    const floor = Math.ceil((costTry * (1 + rule.minMarginRate)) / (1 - commission));
    price = Math.max(price, floor);
  }

  price = applyRounding(price, rule.rounding);
  if (rule.maxPrice !== undefined) price = Math.min(price, rule.maxPrice);
  if (rule.minPrice !== undefined) price = Math.max(price, rule.minPrice);

  if (!Number.isFinite(price) || price <= 0)
    return blocked("non_positive_price", `fiyat: ${price}`);
  if (price < costTry) return blocked("below_cost", `fiyat ${price} < maliyet ${costTry}`);

  const listPrice =
    rule.listPriceRule.kind === "same"
      ? price
      : Math.max(price, Math.round(price * rule.listPriceRule.value));

  const last = input.lastSentSalePrice;
  if (last !== undefined && last > 0) {
    const changeRate = Math.abs(price - last) / last;
    if (changeRate > guard.maxAutoChangeRate) {
      return {
        status: "needs_review",
        salePrice: price,
        listPrice,
        ruleId: rule.id,
        reason: "large_change",
        changeRate,
      };
    }
  }

  return { status: "ok", salePrice: price, listPrice, ruleId: rule.id };
}
