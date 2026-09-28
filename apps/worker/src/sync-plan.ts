import { calculatePrice, resolveRule, type PricingRule } from "@trendy/pricing";
import { fromKurus } from "@trendy/shared";
import { MAX_STOCK_PER_ITEM, type PriceInventoryItem } from "@trendy/trendyol-client";

/**
 * Stok/fiyat senkron planı (ROADMAP Faz 9). Saf fonksiyon: hangi varyanta ne gönderileceğine
 * ve neyin atlanacağına karar verir; ağ ve veritabanına dokunmaz.
 *
 * Kurallar:
 * - Yalnızca yönetilen (feed'den gelen) varyantlar; içe aktarılıp feed'de olmayanlara dokunulmaz.
 * - Yalnızca Trendyol'da onaylı ve satışa kapatılmamış (kilitli/arşivli/kara liste olmayan) ürünler.
 * - Yalnızca değişen değer gönderilir (son gönderilenle karşılaştırma): aynı istek 15 dk içinde
 *   tekrar gönderilemez ve gereksiz istek limit tüketir.
 * - Fiyat yalnızca fiyat kuralı, maliyet ve kur varsa; guardrail'e takılan fiyat onay kuyruğuna
 *   düşer, stok yine gönderilir.
 */

export interface SyncCandidate {
  variantId: number;
  barcode: string;
  managed: boolean;
  /** Varyant bir ham tedarikçi ürününe bağlı mı (değilse artık varyanttır → stok 0). */
  supplierOwned: boolean;
  supplierId: number | null;
  supplierMissing: boolean;
  supplierPaused: boolean;
  missingPolicy: "zero_stock" | "keep";
  stock: number;
  costPrice: number | null;
  currency: string;
  brandName: string | null;
  sourceCategory: string | null;
  listing: {
    tyStatus: string;
    lastSentPrice: number | null;
    lastSentListPrice: number | null;
    lastSentStock: number | null;
    tyPrice: number | null;
  } | null;
  /** Satıcının onay kuyruğunda onayladığı son fiyat (kuruş); aynı fiyat guardrail'e takılmaz. */
  approvedPrice?: number | null;
}

export interface SyncSettings {
  rules: PricingRule[];
  maxAutoChangeRate: number;
  safetyStock: number;
  fxRates: Record<string, number>;
}

export interface PlannedItem extends PriceInventoryItem {
  variantId: number;
  /** Kuruş cinsinden gönderilen değerler (last_sent_* olarak yazılır). */
  sent: { stock?: number; price?: number; listPrice?: number };
}

export interface PriceReviewRequest {
  variantId: number;
  oldPrice: number | null;
  newPrice: number;
  newListPrice: number;
  changeRate: number;
  ruleId: string;
}

export type SkipReason =
  "unmanaged" | "not_listed" | "not_approved" | "supplier_paused" | "unchanged";

export type PriceNote =
  "no_rule" | "no_cost" | "fx_missing" | "blocked" | "needs_review" | "orphan";

export interface SyncPlan {
  items: PlannedItem[];
  reviews: PriceReviewRequest[];
  skipped: Partial<Record<SkipReason, number>>;
  priceNotes: Partial<Record<PriceNote, number>>;
  /** Trendyol üst sınırı nedeniyle 20.000'e indirilen stok sayısı. */
  stockCapped: number;
}

export function planSync(candidates: SyncCandidate[], settings: SyncSettings): SyncPlan {
  const plan: SyncPlan = { items: [], reviews: [], skipped: {}, priceNotes: {}, stockCapped: 0 };
  const skip = (r: SkipReason) => void (plan.skipped[r] = (plan.skipped[r] ?? 0) + 1);
  const note = (n: PriceNote) => void (plan.priceNotes[n] = (plan.priceNotes[n] ?? 0) + 1);

  for (const c of candidates) {
    if (!c.managed) {
      skip("unmanaged");
      continue;
    }
    if (!c.listing) {
      skip("not_listed");
      continue;
    }
    if (c.listing.tyStatus !== "approved") {
      skip("not_approved");
      continue;
    }
    if (c.supplierOwned && c.supplierPaused) {
      skip("supplier_paused");
      continue;
    }

    // ── Hedef stok ──
    let stock: number | undefined;
    if (!c.supplierOwned) stock = 0;
    else if (c.supplierMissing) stock = c.missingPolicy === "zero_stock" ? 0 : undefined;
    else if (c.stock < settings.safetyStock) stock = 0;
    else if (c.stock > MAX_STOCK_PER_ITEM) {
      stock = MAX_STOCK_PER_ITEM;
      plan.stockCapped++;
    } else stock = c.stock;

    // ── Hedef fiyat ──
    let price: { sale: number; list: number } | undefined;
    if (!c.supplierOwned || c.supplierMissing) {
      if (!c.supplierOwned) note("orphan");
    } else if (settings.rules.length === 0) note("no_rule");
    else if (c.costPrice === null) note("no_cost");
    else {
      const fx = c.currency === "TRY" ? 1 : settings.fxRates[c.currency];
      const rule = resolveRule(settings.rules, {
        ...(c.brandName ? { brand: c.brandName } : {}),
        ...(c.sourceCategory ? { category: c.sourceCategory } : {}),
        ...(c.supplierId !== null ? { supplier: String(c.supplierId) } : {}),
      });
      if (!fx || !(fx > 0)) note("fx_missing");
      else if (!rule) note("no_rule");
      else {
        const last = c.listing.lastSentPrice ?? c.listing.tyPrice ?? undefined;
        const r = calculatePrice(
          {
            cost: c.costPrice,
            fxRate: fx,
            ...(last !== undefined ? { lastSentSalePrice: last } : {}),
          },
          rule,
          { maxAutoChangeRate: settings.maxAutoChangeRate },
        );
        if (r.status === "ok") price = { sale: r.salePrice, list: r.listPrice };
        else if (r.status === "needs_review" && c.approvedPrice === r.salePrice) {
          // Satıcı bu fiyatı onayladı.
          price = { sale: r.salePrice, list: r.listPrice };
        } else if (r.status === "needs_review") {
          note("needs_review");
          plan.reviews.push({
            variantId: c.variantId,
            oldPrice: last ?? null,
            newPrice: r.salePrice,
            newListPrice: r.listPrice,
            changeRate: r.changeRate,
            ruleId: r.ruleId,
          });
        } else note("blocked");
      }
    }

    // ── Diff ──
    const item: PlannedItem = { barcode: c.barcode, variantId: c.variantId, sent: {} };
    if (stock !== undefined && stock !== c.listing.lastSentStock) {
      item.quantity = stock;
      item.sent.stock = stock;
    }
    if (
      price &&
      (price.sale !== c.listing.lastSentPrice || price.list !== c.listing.lastSentListPrice)
    ) {
      item.salePrice = fromKurus(price.sale);
      item.listPrice = fromKurus(price.list);
      item.sent.price = price.sale;
      item.sent.listPrice = price.list;
    }
    if (item.quantity === undefined && item.salePrice === undefined) {
      skip("unchanged");
      continue;
    }
    plan.items.push(item);
  }
  return plan;
}

/** Trendyol istek sınırı (1000) için gruplara böler. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
