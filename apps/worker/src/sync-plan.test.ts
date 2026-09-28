import type { PricingRule } from "@trendy/pricing";
import { describe, expect, it } from "vitest";
import { chunk, planSync, type SyncCandidate, type SyncSettings } from "./sync-plan.js";

const base: SyncCandidate = {
  variantId: 1,
  barcode: "B1",
  managed: true,
  supplierOwned: true,
  supplierId: 10,
  supplierMissing: false,
  supplierPaused: false,
  missingPolicy: "zero_stock",
  stock: 5,
  costPrice: 10000,
  currency: "TRY",
  brandName: "Marka",
  sourceCategory: "Kategori",
  listing: {
    tyStatus: "approved",
    lastSentPrice: null,
    lastSentListPrice: null,
    lastSentStock: null,
    tyPrice: null,
  },
};
const c = (
  patch: Partial<SyncCandidate> = {},
  listing: Partial<NonNullable<SyncCandidate["listing"]>> = {},
) => ({
  ...base,
  ...patch,
  listing: patch.listing === null ? null : { ...base.listing!, ...listing },
});

const rule: PricingRule = {
  id: "r1",
  scope: "general",
  multiplier: 1.5,
  addFixed: 0,
  rounding: { kind: "none" },
  listPriceRule: { kind: "multiplier", value: 1.2 },
};
const noPrice: SyncSettings = { rules: [], maxAutoChangeRate: 0.3, safetyStock: 0, fxRates: {} };
const withPrice: SyncSettings = { ...noPrice, rules: [rule] };

describe("planSync — kapsam", () => {
  it.each([
    [{ managed: false }, {}, "unmanaged"],
    [{ listing: null }, {}, "not_listed"],
    [{}, { tyStatus: "pending" }, "not_approved"],
    [{}, { tyStatus: "locked" }, "not_approved"],
    [{}, { tyStatus: "archived" }, "not_approved"],
    [{}, { tyStatus: "blacklisted" }, "not_approved"],
    [{ supplierPaused: true }, {}, "supplier_paused"],
  ] as const)("%j %j → atlanır: %s", (patch, listing, reason) => {
    const plan = planSync([c(patch as Partial<SyncCandidate>, listing)], noPrice);
    expect(plan.items).toEqual([]);
    expect(plan.skipped).toEqual({ [reason]: 1 });
  });
});

describe("planSync — stok", () => {
  it("stok değiştiyse yalnızca stok gönderilir (fiyat kuralı yok)", () => {
    const plan = planSync([c({}, { lastSentStock: 3 })], noPrice);
    expect(plan.items).toEqual([{ barcode: "B1", variantId: 1, quantity: 5, sent: { stock: 5 } }]);
    expect(plan.priceNotes).toEqual({ no_rule: 1 });
  });

  it("değişmediyse gönderilmez", () => {
    const plan = planSync([c({}, { lastSentStock: 5 })], noPrice);
    expect(plan.items).toEqual([]);
    expect(plan.skipped).toEqual({ unchanged: 1 });
  });

  it.each([
    ["kaybolan ürün, zero_stock", { supplierMissing: true }, 0],
    ["artık varyant (sahipsiz ama yönetilen)", { supplierOwned: false, supplierId: null }, 0],
    ["stok 0", { stock: 0 }, 0],
  ] as const)("%s → 0", (_, patch, expected) => {
    const plan = planSync([c(patch, { lastSentStock: 7 })], noPrice);
    expect(plan.items[0]!.quantity).toBe(expected);
  });

  it("kaybolan ürün, keep politikası → stok gönderilmez", () => {
    const plan = planSync(
      [c({ supplierMissing: true, missingPolicy: "keep" }, { lastSentStock: 7 })],
      noPrice,
    );
    expect(plan.items).toEqual([]);
  });

  it("güvenlik stoğunun altı 0 gönderilir", () => {
    const plan = planSync([c({ stock: 2 }, { lastSentStock: 9 })], { ...noPrice, safetyStock: 3 });
    expect(plan.items[0]!.quantity).toBe(0);
    expect(
      planSync([c({ stock: 3 }, { lastSentStock: 9 })], { ...noPrice, safetyStock: 3 }).items[0]!
        .quantity,
    ).toBe(3);
  });

  it("20.000 üstü stok sınırlanır ve sayılır", () => {
    const plan = planSync([c({ stock: 50_000 })], noPrice);
    expect(plan.items[0]!.quantity).toBe(20_000);
    expect(plan.stockCapped).toBe(1);
  });
});

describe("planSync — fiyat", () => {
  it("kural varsa fiyat hesaplanır, TL'ye çevrilir; listPrice ≥ salePrice", () => {
    const plan = planSync([c({}, { lastSentStock: 5 })], withPrice);
    // maliyet 100,00 TL × 1,5 = 150,00; liste × 1,2 = 180,00
    expect(plan.items).toEqual([
      {
        barcode: "B1",
        variantId: 1,
        salePrice: 150,
        listPrice: 180,
        sent: { price: 15000, listPrice: 18000 },
      },
    ]);
  });

  it("fiyat aynıysa tekrar gönderilmez", () => {
    const plan = planSync(
      [c({}, { lastSentStock: 5, lastSentPrice: 15000, lastSentListPrice: 18000 })],
      withPrice,
    );
    expect(plan.items).toEqual([]);
  });

  it("stok ve fiyat birlikte değişirse tek öğede gider", () => {
    const plan = planSync(
      [c({ stock: 8 }, { lastSentStock: 5, lastSentPrice: 14000, lastSentListPrice: 16800 })],
      withPrice,
    );
    expect(plan.items[0]).toMatchObject({ quantity: 8, salePrice: 150, listPrice: 180 });
  });

  it("büyük değişim onay kuyruğuna düşer, stok yine gönderilir", () => {
    const plan = planSync([c({ stock: 8 }, { lastSentStock: 5, lastSentPrice: 10000 })], withPrice);
    expect(plan.items).toEqual([{ barcode: "B1", variantId: 1, quantity: 8, sent: { stock: 8 } }]);
    expect(plan.reviews).toEqual([
      {
        variantId: 1,
        oldPrice: 10000,
        newPrice: 15000,
        newListPrice: 18000,
        changeRate: 0.5,
        ruleId: "r1",
      },
    ]);
  });

  it("onaylanan fiyat guardrail'e takılmadan gönderilir; farklı fiyat yine onaya düşer", () => {
    const approved = planSync(
      [c({ approvedPrice: 15000 }, { lastSentStock: 5, lastSentPrice: 10000 })],
      withPrice,
    );
    expect(approved.items[0]).toMatchObject({ salePrice: 150, listPrice: 180 });
    expect(approved.reviews).toEqual([]);
    const other = planSync(
      [c({ approvedPrice: 14000 }, { lastSentStock: 5, lastSentPrice: 10000 })],
      withPrice,
    );
    expect(other.reviews).toHaveLength(1);
  });

  it("son gönderim yoksa Trendyol'daki mevcut fiyat guardrail tabanıdır", () => {
    const plan = planSync([c({}, { lastSentStock: 5, tyPrice: 5000 })], withPrice);
    expect(plan.reviews).toHaveLength(1);
    expect(plan.items).toEqual([]);
  });

  it.each([
    [{ costPrice: null }, "no_cost"],
    [{ currency: "USD" }, "fx_missing"],
    [{ supplierOwned: false, supplierId: null }, "orphan"],
  ] as const)("%j → fiyat gönderilmez (%s)", (patch, n) => {
    const plan = planSync([c(patch, { lastSentStock: 5 })], withPrice);
    expect(plan.items.every((i) => i.salePrice === undefined)).toBe(true);
    expect(plan.priceNotes[n]).toBe(1);
  });

  it("döviz kuru girilmişse çevrilir", () => {
    const plan = planSync([c({ currency: "USD", costPrice: 1000 }, { lastSentStock: 5 })], {
      ...withPrice,
      fxRates: { USD: 40 },
    });
    // 10 USD × 40 = 400 TL × 1,5 = 600 TL
    expect(plan.items[0]!.salePrice).toBe(600);
  });

  it("maliyet altı fiyat hiçbir koşulda gönderilmez", () => {
    const cheap: PricingRule = { ...rule, multiplier: 0.5 };
    const plan = planSync([c({}, { lastSentStock: 5 })], { ...noPrice, rules: [cheap] });
    expect(plan.items).toEqual([]);
    expect(plan.priceNotes).toEqual({ blocked: 1 });
  });

  it("en spesifik kural kazanır (marka > genel)", () => {
    const brand: PricingRule = {
      ...rule,
      id: "b",
      scope: "brand",
      scopeKey: "Marka",
      multiplier: 2,
    };
    const plan = planSync([c({}, { lastSentStock: 5 })], { ...noPrice, rules: [rule, brand] });
    expect(plan.items[0]!.salePrice).toBe(200);
  });
});

describe("chunk", () => {
  it("1000'lik gruplara böler", () => {
    const groups = chunk(
      Array.from({ length: 2500 }, (_, i) => i),
      1000,
    );
    expect(groups.map((g) => g.length)).toEqual([1000, 1000, 500]);
  });
});
