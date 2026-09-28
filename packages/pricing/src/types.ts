import type { Kurus } from "@trendy/shared";

export type RuleScope = "brand" | "category" | "supplier" | "general";

/** Kuruş cinsinden kuralın bitiş hanesi: 90 → x,90; 99 → x,99; 0 → tam lira. */
export type Rounding = { kind: "none" } | { kind: "ending"; kurus: number };

export type ListPriceRule = { kind: "same" } | { kind: "multiplier"; value: number };

export interface PricingRule {
  id: string;
  scope: RuleScope;
  /** scope "general" değilse eşleşecek anahtar (marka adı, kategori, tedarikçi id). */
  scopeKey?: string;
  multiplier: number;
  addFixed: Kurus;
  rounding: Rounding;
  /** Komisyon düşüldükten sonra maliyet üzerinde korunacak minimum kâr oranı (0.1 = %10). */
  minMarginRate?: number;
  /** Kullanıcının girdiği beklenen komisyon oranı (0.2 = %20). */
  commissionRate?: number;
  minPrice?: Kurus;
  maxPrice?: Kurus;
  listPriceRule: ListPriceRule;
}

export interface PricingInput {
  cost: Kurus;
  /** Maliyetin para biriminden TRY'ye kur. TRY ise 1. */
  fxRate: number;
  /** Trendyol'a son gönderilen satış fiyatı; ilk gönderimde yok. */
  lastSentSalePrice?: Kurus;
}

export interface GuardrailConfig {
  /** Bu orandan büyük değişimler onay kuyruğuna düşer (0.3 = %30). */
  maxAutoChangeRate: number;
}

export type BlockReason = "invalid_input" | "non_positive_price" | "below_cost";
export type ReviewReason = "large_change";

export type PricingResult =
  | { status: "ok"; salePrice: Kurus; listPrice: Kurus; ruleId: string }
  | {
      status: "needs_review";
      salePrice: Kurus;
      listPrice: Kurus;
      ruleId: string;
      reason: ReviewReason;
      changeRate: number;
    }
  | { status: "blocked"; reason: BlockReason; ruleId: string; detail: string };
