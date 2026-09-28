import { describe, expect, it } from "vitest";
import { applyRounding, calculatePrice, resolveRule } from "./engine.js";
import type { PricingRule } from "./types.js";

const guard = { maxAutoChangeRate: 0.3 };

function rule(overrides: Partial<PricingRule> = {}): PricingRule {
  return {
    id: "r1",
    scope: "general",
    multiplier: 1,
    addFixed: 0,
    rounding: { kind: "none" },
    listPriceRule: { kind: "same" },
    ...overrides,
  };
}

describe("applyRounding", () => {
  it.each([
    [10000, 90, 10090],
    [10090, 90, 10090],
    [10091, 90, 10190],
    [10099, 99, 10099],
    [10050, 0, 10100],
    [10000, 0, 10000],
  ])("%d + ,%d -> %d", (value, kurus, expected) => {
    expect(applyRounding(value, { kind: "ending", kurus })).toBe(expected);
  });

  it("none dokunmaz", () => {
    expect(applyRounding(12345, { kind: "none" })).toBe(12345);
  });
});

describe("resolveRule", () => {
  const rules: PricingRule[] = [
    rule({ id: "gen" }),
    rule({ id: "sup", scope: "supplier", scopeKey: "s1" }),
    rule({ id: "cat", scope: "category", scopeKey: "Ayakkabı" }),
    rule({ id: "brand", scope: "brand", scopeKey: "Nike" }),
  ];

  it.each([
    [{ brand: "Nike", category: "Ayakkabı", supplier: "s1" }, "brand"],
    [{ brand: "Adidas", category: "Ayakkabı", supplier: "s1" }, "cat"],
    [{ brand: "Adidas", category: "Çanta", supplier: "s1" }, "sup"],
    [{ brand: "Adidas", category: "Çanta", supplier: "s2" }, "gen"],
    [{}, "gen"],
  ])("%j -> %s", (ctx, expected) => {
    expect(resolveRule(rules, ctx)?.id).toBe(expected);
  });

  it("kural yoksa undefined", () => {
    expect(resolveRule([], {})).toBeUndefined();
  });
});

describe("calculatePrice", () => {
  it("adımları sırayla uygular: döviz → çarpan → sabit → yuvarlama", () => {
    // 10 USD, kur 34 → 340,00 TL; ×1,35 → 459,00; +25 → 484,00; ,90 → 484,90
    const r = calculatePrice(
      { cost: 1000, fxRate: 34 },
      rule({ multiplier: 1.35, addFixed: 2500, rounding: { kind: "ending", kurus: 90 } }),
      guard,
    );
    expect(r).toEqual({ status: "ok", salePrice: 48490, listPrice: 48490, ruleId: "r1" });
  });

  it("listPrice çarpanla hesaplanır ve salePrice'tan küçük olamaz", () => {
    const up = calculatePrice(
      { cost: 10000, fxRate: 1 },
      rule({ listPriceRule: { kind: "multiplier", value: 1.2 } }),
      guard,
    );
    expect(up).toMatchObject({ salePrice: 10000, listPrice: 12000 });
    const down = calculatePrice(
      { cost: 10000, fxRate: 1 },
      rule({ listPriceRule: { kind: "multiplier", value: 0.5 } }),
      guard,
    );
    expect(down).toMatchObject({ salePrice: 10000, listPrice: 10000 });
  });

  it("komisyon sonrası minimum marjı korur", () => {
    // maliyet 100 TL, komisyon %20, min marj %10 → taban = 110 / 0,8 = 137,50
    const r = calculatePrice(
      { cost: 10000, fxRate: 1 },
      rule({ multiplier: 1.1, commissionRate: 0.2, minMarginRate: 0.1 }),
      guard,
    );
    expect(r).toMatchObject({ status: "ok", salePrice: 13750 });
  });

  it("marj tabanından sonra yuvarlama yukarı yapılır, marj bozulmaz", () => {
    const r = calculatePrice(
      { cost: 10000, fxRate: 1 },
      rule({ commissionRate: 0.2, minMarginRate: 0.1, rounding: { kind: "ending", kurus: 99 } }),
      guard,
    );
    expect(r).toMatchObject({ salePrice: 13799 });
  });

  it("min/max sınırları uygular", () => {
    expect(
      calculatePrice({ cost: 1000, fxRate: 1 }, rule({ minPrice: 5000 }), guard),
    ).toMatchObject({ salePrice: 5000 });
    expect(
      calculatePrice({ cost: 10000, fxRate: 1 }, rule({ multiplier: 2, maxPrice: 15000 }), guard),
    ).toMatchObject({ salePrice: 15000 });
  });

  describe("guardrail'ler", () => {
    it("maliyetin altında fiyatı engeller (max sınırı maliyetin altına çekerse)", () => {
      const r = calculatePrice({ cost: 10000, fxRate: 1 }, rule({ maxPrice: 9000 }), guard);
      expect(r).toMatchObject({ status: "blocked", reason: "below_cost" });
    });

    it.each([
      [{ cost: 0, fxRate: 1 }, {}],
      [{ cost: -100, fxRate: 1 }, {}],
      [{ cost: NaN, fxRate: 1 }, {}],
      [{ cost: 1000, fxRate: 0 }, {}],
      [{ cost: 1000, fxRate: NaN }, {}],
      [{ cost: 1000, fxRate: 1 }, { multiplier: 0 }],
      [{ cost: 1000, fxRate: 1 }, { multiplier: NaN }],
      [{ cost: 1000, fxRate: 1 }, { commissionRate: 1 }],
      [{ cost: 1000, fxRate: 1 }, { rounding: { kind: "ending", kurus: 100 } }],
    ] as const)("geçersiz girdi engellenir: %j %j", (input, overrides) => {
      const r = calculatePrice(input, rule(overrides as Partial<PricingRule>), guard);
      expect(r).toMatchObject({ status: "blocked", reason: "invalid_input" });
    });

    it("negatif sabit ekleme fiyatı sıfıra indirirse engeller", () => {
      const r = calculatePrice({ cost: 1000, fxRate: 1 }, rule({ addFixed: -2000 }), guard);
      expect(r).toMatchObject({ status: "blocked", reason: "non_positive_price" });
    });

    it("büyük değişimi onay kuyruğuna alır", () => {
      const r = calculatePrice({ cost: 10000, fxRate: 1, lastSentSalePrice: 20000 }, rule(), guard);
      expect(r).toMatchObject({ status: "needs_review", reason: "large_change", changeRate: 0.5 });
    });

    it("eşikteki değişim otomatik geçer", () => {
      const r = calculatePrice({ cost: 13000, fxRate: 1, lastSentSalePrice: 10000 }, rule(), guard);
      expect(r).toMatchObject({ status: "ok", salePrice: 13000 });
    });

    it("ilk gönderimde değişim kontrolü yapılmaz", () => {
      expect(calculatePrice({ cost: 10000, fxRate: 1 }, rule(), guard).status).toBe("ok");
    });
  });
});
