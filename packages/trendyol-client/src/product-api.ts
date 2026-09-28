import { normalizeBarcode } from "@trendy/shared";
import { z } from "zod";
import type { TrendyolClient } from "./client.js";

/**
 * Ürün V2 ve stok/fiyat servisleri. Yollar, parametreler ve alanlar resmi OpenAPI
 * tanımlarından alınmıştır (kopyalar: `docs/trendyol-api/ref-*.md`, 28.09.2026).
 *
 * Gelen yanıtlar yalnızca kullandığımız alanlar için doğrulanır; Trendyol'un yeni eklediği
 * alanlar kodu kırmaz (`looseObject`). Giden istekler göndermeden önce sıkı doğrulanır.
 */

// ── Stok ve fiyat güncelleme (updatePriceAndInventory) ──────────────────────

export const PRICE_INVENTORY_MAX_ITEMS = 1000;
export const MAX_STOCK_PER_ITEM = 20_000;

/** Tutarlar TL cinsinden (Trendyol `number`). listPrice = PSF (üstü çizili), salePrice = TSF. */
export interface PriceInventoryItem {
  barcode: string;
  quantity?: number;
  salePrice?: number;
  listPrice?: number;
}

const price = z
  .number()
  .finite()
  .positive("Fiyat pozitif olmalı")
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Fiyat en fazla 2 ondalık olmalı");

const priceInventoryItem = z
  .object({
    barcode: z.string().refine((b) => {
      const r = normalizeBarcode(b);
      return r.ok && r.barcode === b;
    }, "Barkod normalize edilmiş ve geçerli olmalı"),
    quantity: z.number().int().min(0).max(MAX_STOCK_PER_ITEM).optional(),
    salePrice: price.optional(),
    listPrice: price.optional(),
  })
  .strict()
  .refine(
    (i) => i.quantity !== undefined || i.salePrice !== undefined || i.listPrice !== undefined,
    "Stok veya fiyat alanlarından en az biri gönderilmeli",
  )
  .refine(
    (i) => i.salePrice === undefined || i.listPrice === undefined || i.listPrice >= i.salePrice,
    "listPrice, salePrice'tan küçük olamaz",
  );

const priceInventoryRequest = z
  .array(priceInventoryItem)
  .min(1)
  .max(PRICE_INVENTORY_MAX_ITEMS)
  .refine(
    (items) => new Set(items.map((i) => i.barcode)).size === items.length,
    "Aynı barkod bir istekte iki kez gönderilemez",
  );

const batchRequestResponse = z.looseObject({ batchRequestId: z.string().min(1) });

/**
 * Onaylı ürünlerin stok/fiyatını günceller; işlem asenkrondur, dönen `batchRequestId` ile
 * `getBatchRequestResult` sorgulanır. Aynı gövde 15 dakika içinde tekrar gönderilemez:
 * çağıran yalnızca değişen kayıtları göndermeli (diff).
 */
export async function updatePriceAndInventory(
  client: TrendyolClient,
  items: PriceInventoryItem[],
): Promise<{ batchRequestId: string }> {
  const body = { items: priceInventoryRequest.parse(items) };
  const res = await client.request<unknown>({
    method: "POST",
    path: `/integration/inventory/sellers/${client.sellerId}/products/price-and-inventory`,
    group: "inventoryWrite",
    endpoint: "updatePriceAndInventory",
    body,
  });
  return batchRequestResponse.parse(res);
}

// ── Toplu işlem kontrolü (getBatchRequestResult) ────────────────────────────

const batchItem = z.looseObject({
  requestItem: z.record(z.string(), z.unknown()).nullish(),
  /** Stok/fiyat batch'lerinde öğe bazında IN_PROGRESS da görülebilir. */
  status: z.string().nullish(),
  failureReasons: z.array(z.string()).nullish(),
});

const batchResult = z.looseObject({
  batchRequestId: z.string(),
  items: z.array(batchItem).nullish(),
  status: z.string().nullish(),
  creationDate: z.number().nullish(),
  lastModification: z.number().nullish(),
  itemCount: z.number().nullish(),
  failedItemCount: z.number().nullish(),
  batchRequestType: z.string().nullish(),
});

export type BatchRequestResult = z.infer<typeof batchResult>;

/** Batch sonuçları 4 saat boyunca sorgulanabilir. */
export const BATCH_RESULT_TTL_MS = 4 * 60 * 60_000;

export async function getBatchRequestResult(
  client: TrendyolClient,
  batchRequestId: string,
): Promise<BatchRequestResult> {
  const res = await client.request<unknown>({
    method: "GET",
    path: `/integration/product/sellers/${client.sellerId}/products/batch-requests/${encodeURIComponent(batchRequestId)}`,
    group: "productRead",
    endpoint: "getBatchRequestResult",
  });
  return batchResult.parse(res);
}

/**
 * Batch tamamlandı mı? Dokümana göre stok/fiyat batch'lerinde batch seviyesinde `status`
 * dönmez; öğe bazlı durumlara bakılmalıdır. Bu yüzden: `status === "COMPLETED"` ya da
 * tüm öğeler SUCCESS/FAILED ve öğe sayısı `itemCount`'a ulaşmış.
 */
export function isBatchComplete(r: BatchRequestResult): boolean {
  if (r.status === "COMPLETED") return true;
  if (r.status === "IN_PROGRESS") return false;
  const items = r.items ?? [];
  if (items.length === 0) return false;
  if (r.itemCount != null && items.length < r.itemCount) return false;
  return items.every((i) => i.status === "SUCCESS" || i.status === "FAILED");
}

// ── Ürün filtreleme ─────────────────────────────────────────────────────────

/** Onaylı ürünlerde `page × size` en fazla 10.000; ötesi `nextPageToken` ile. */
export const PAGE_WINDOW_LIMIT = 10_000;

const pageEnvelope = {
  totalElements: z.number().nullish(),
  totalPages: z.number().nullish(),
  page: z.number().nullish(),
  size: z.number().nullish(),
  nextPageToken: z.string().nullish(),
};

const inventoryAndPriceVariant = z.looseObject({
  variantId: z.number().nullish(),
  barcode: z.string(),
  salePrice: z.number().nullish(),
  listPrice: z.number().nullish(),
  quantity: z.number().nullish(),
  stockCode: z.string().nullish(),
  stockLastModifiedDate: z.number().nullish(),
});
const inventoryAndPriceResponse = z.looseObject({
  ...pageEnvelope,
  content: z
    .array(
      z.looseObject({
        contentId: z.number().nullish(),
        productMainId: z.string().nullish(),
        variants: z.array(inventoryAndPriceVariant).nullish(),
      }),
    )
    .nullish(),
});
export type InventoryAndPricePage = z.infer<typeof inventoryAndPriceResponse>;

export interface PageParams {
  page?: number;
  size?: number;
  nextPageToken?: string;
}

export interface InventoryAndPriceParams extends PageParams {
  barcode?: string;
  contentId?: number;
  stockCode?: string;
  productMainId?: string;
  status?: "archived" | "blacklisted" | "locked" | "onSale" | "notOnSale";
  orderByDirection?: "asc" | "desc";
}

/** Onaylı ürünlerin yalnızca stok ve fiyat bilgisi (size en fazla 100). */
export async function filterApprovedProductsInventoryAndPrice(
  client: TrendyolClient,
  params: InventoryAndPriceParams = {},
): Promise<InventoryAndPricePage> {
  const res = await client.request<unknown>({
    method: "GET",
    path: `/integration/product/sellers/${client.sellerId}/products/approved/inventory-and-price`,
    group: "productRead",
    endpoint: "filterApprovedProductsInventoryAndPrice",
    query: { ...params, size: clampSize(params.size, 100) },
  });
  return inventoryAndPriceResponse.parse(res);
}

const approvedVariant = z.looseObject({
  variantId: z.number().nullish(),
  barcode: z.string(),
  stockCode: z.string().nullish(),
  onSale: z.boolean().nullish(),
  locked: z.boolean().nullish(),
  lockReason: z.string().nullish(),
  archived: z.boolean().nullish(),
  blacklisted: z.boolean().nullish(),
  vatRate: z.number().nullish(),
  price: z
    .looseObject({ salePrice: z.number().nullish(), listPrice: z.number().nullish() })
    .nullish(),
  channels: z.array(z.string()).nullish(),
});
const approvedResponse = z.looseObject({
  ...pageEnvelope,
  content: z
    .array(
      z.looseObject({
        contentId: z.number().nullish(),
        productMainId: z.string().nullish(),
        title: z.string().nullish(),
        brand: z.looseObject({ id: z.number().nullish(), name: z.string().nullish() }).nullish(),
        category: z.looseObject({ id: z.number().nullish(), name: z.string().nullish() }).nullish(),
        variants: z.array(approvedVariant).nullish(),
      }),
    )
    .nullish(),
});
export type ApprovedProductsPage = z.infer<typeof approvedResponse>;

export interface ApprovedProductsParams extends PageParams {
  barcode?: string;
  stockCode?: string;
  productMainId?: string;
  status?: "archived" | "blacklisted" | "locked" | "onSale";
  startDate?: number;
  endDate?: number;
  dateQueryType?: "VARIANT_CREATED_DATE" | "VARIANT_MODIFIED_DATE" | "CONTENT_MODIFIED_DATE";
}

/** Onaylı ürünler, content bazlı (size en fazla 100). */
export async function filterApprovedProducts(
  client: TrendyolClient,
  params: ApprovedProductsParams = {},
): Promise<ApprovedProductsPage> {
  const res = await client.request<unknown>({
    method: "GET",
    path: `/integration/product/sellers/${client.sellerId}/products/approved`,
    group: "productRead",
    endpoint: "filterApprovedProducts",
    query: { ...params, size: clampSize(params.size, 100) },
  });
  return approvedResponse.parse(res);
}

const unapprovedResponse = z.looseObject({
  ...pageEnvelope,
  content: z
    .array(
      z.looseObject({
        barcode: z.string(),
        productMainId: z.string().nullish(),
        title: z.string().nullish(),
        stockCode: z.string().nullish(),
        quantity: z.number().nullish(),
        salePrice: z.number().nullish(),
        listPrice: z.number().nullish(),
        rejectReasonDetails: z
          .array(
            z.looseObject({
              rejectReason: z.string().nullish(),
              rejectReasonDetail: z.string().nullish(),
            }),
          )
          .nullish(),
      }),
    )
    .nullish(),
});
export type UnapprovedProductsPage = z.infer<typeof unapprovedResponse>;

export interface UnapprovedProductsParams extends PageParams {
  barcode?: string;
  stockCode?: string;
  productMainId?: string;
  status?: "rejected" | "pendingApproval";
  startDate?: number;
  endDate?: number;
  dateQueryType?: "CREATED_DATE" | "LAST_MODIFIED_DATE";
}

/** Onaysız (onay bekleyen ve reddedilen) ürünler (size en fazla 1000). */
export async function filterUnapprovedProducts(
  client: TrendyolClient,
  params: UnapprovedProductsParams = {},
): Promise<UnapprovedProductsPage> {
  const res = await client.request<unknown>({
    method: "GET",
    path: `/integration/product/sellers/${client.sellerId}/products/unapproved`,
    group: "productRead",
    endpoint: "filterUnapprovedProducts",
    query: { ...params, size: clampSize(params.size, 1000) },
  });
  return unapprovedResponse.parse(res);
}

const productBase = z.looseObject({
  barcode: z.string().nullish(),
  approved: z.boolean().nullish(),
  approvedDate: z.number().nullish(),
  archived: z.boolean().nullish(),
  listingId: z.string().nullish(),
  contentId: z.number().nullish(),
});
export type ProductBase = z.infer<typeof productBase>;

/** Tek ürünün temel durum bilgisi. */
export async function getProductBase(
  client: TrendyolClient,
  barcode: string,
): Promise<ProductBase> {
  const res = await client.request<unknown>({
    method: "GET",
    path: `/integration/product/sellers/${client.sellerId}/product/${encodeURIComponent(barcode)}`,
    group: "productRead",
    endpoint: "getProductBase",
  });
  return productBase.parse(res);
}

function clampSize(size: number | undefined, max: number): number {
  if (size === undefined) return max;
  if (!Number.isInteger(size) || size < 1) throw new RangeError(`Geçersiz size: ${size}`);
  return Math.min(size, max);
}

/**
 * Sayfalı filtreleme servislerini baştan sona gezer. `page × size` 10.000'e ulaşınca
 * dokümandaki gibi `nextPageToken` ile devam eder (token isteğinde `page` gönderilmez).
 */
export async function* paginate<
  T extends {
    content?: unknown[] | null | undefined;
    totalPages?: number | null | undefined;
    nextPageToken?: string | null | undefined;
  },
>(fetchPage: (p: PageParams) => Promise<T>, size: number): AsyncGenerator<T> {
  let page = 0;
  let token: string | undefined;
  for (;;) {
    const res = await fetchPage(token ? { size, nextPageToken: token } : { page, size });
    yield res;
    if (!res.content || res.content.length === 0) return;
    if (!token && res.totalPages != null && page + 1 >= res.totalPages) return;
    if (!token && (page + 1) * size < PAGE_WINDOW_LIMIT) {
      page++;
      continue;
    }
    if (!res.nextPageToken || res.nextPageToken === token) return;
    token = res.nextPageToken;
  }
}
