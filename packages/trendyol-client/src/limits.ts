/**
 * Trendyol servis limitleri (ROADMAP §2.2, 28.09.2026 itibarıyla doğrulandı).
 * Limitler satıcı (API bilgisi) bazındadır; anahtarlar bu yüzden sellerId içerir.
 */
export type ListingTier = "50k" | "75k" | "150k" | "500k" | "unlimited";

/** Limit grupları. "none": yalnızca endpoint limiti uygulanır. */
export type LimitGroup = "productRead" | "productWrite" | "inventoryWrite" | "orders" | "none";

/** Aynı endpoint'e 10 saniyede en fazla 50 istek. */
export const ENDPOINT_LIMIT = { limit: 50, windowMs: 10_000 } as const;

/** Aynı barkod için dakikada en fazla 30 fiyat güncellemesi. */
export const BARCODE_PRICE_LIMIT = { limit: 30, windowMs: 60_000 } as const;

const PER_MINUTE: Record<Exclude<LimitGroup, "none">, Record<ListingTier, number>> = {
  productRead: { "50k": 1000, "75k": 1250, "150k": 1500, "500k": 1750, unlimited: 2000 },
  productWrite: { "50k": 200, "75k": 300, "150k": 400, "500k": 500, unlimited: 600 },
  inventoryWrite: { "50k": 350, "75k": 500, "150k": 1000, "500k": 1500, unlimited: 2000 },
  orders: { "50k": 30, "75k": 40, "150k": 50, "500k": 100, unlimited: 100 },
};

export function groupLimit(group: LimitGroup, tier: ListingTier) {
  if (group === "none") return undefined;
  return { limit: PER_MINUTE[group][tier], windowMs: 60_000 };
}
