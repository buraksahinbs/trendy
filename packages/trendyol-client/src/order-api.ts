import { z } from "zod";
import type { TrendyolClient } from "./client.js";

/**
 * Sipariş paketleri (ROADMAP Faz 10): `getShipmentPackagesStream`.
 *
 * Alan adları kılavuz sayfası ve 02.04.2026 changelog'undaki **güncel** adlardır
 * (`shipmentPackageId`, `lines[].lineId`, `stockCode`, `lineUnitPrice`, `packageTotalPrice`).
 * OpenAPI referansındaki şema eski adları (id, merchantSku, price) göstermektedir ve eskimiştir
 * (`docs/TRENDYOL_NOTES.md`). Eski adlarla kod yazılmaz.
 */

const idLike = z.union([z.number(), z.string()]).transform((v) => String(v));

const orderLine = z.looseObject({
  lineId: idLike,
  barcode: z.string().nullish(),
  stockCode: z.string().nullish(),
  quantity: z.number().int(),
  lineUnitPrice: z.number().nullish(),
  lineGrossAmount: z.number().nullish(),
  commission: z.number().nullish(),
  vatRate: z.number().nullish(),
  productName: z.string().nullish(),
  orderLineItemStatusName: z.string().nullish(),
  cancelledBy: z.string().nullish(),
  cancelReason: z.string().nullish(),
});

export const shipmentPackageSchema = z.looseObject({
  shipmentPackageId: idLike,
  orderNumber: idLike,
  status: z.string(),
  lastModifiedDate: z.number(),
  orderDate: z.number().nullish(),
  packageTotalPrice: z.number().nullish(),
  currencyCode: z.string().nullish(),
  channelId: z.number().nullish(),
  paymentMethod: z.string().nullish(),
  cargoTrackingNumber: idLike.nullish(),
  cargoProviderName: z.string().nullish(),
  createdBy: z.string().nullish(),
  originPackageIds: z.array(idLike).nullish(),
  customerFirstName: z.string().nullish(),
  customerLastName: z.string().nullish(),
  lines: z.array(orderLine).default([]),
});
export type ShipmentPackage = z.infer<typeof shipmentPackageSchema>;

const streamResponse = z.looseObject({
  hasMore: z.boolean().nullish(),
  nextCursor: z.string().nullish(),
  size: z.number().nullish(),
  content: z.array(shipmentPackageSchema).nullish(),
});
export type ShipmentPackagesStreamPage = z.infer<typeof streamResponse>;

export const ORDER_STREAM_MAX_SIZE = 200;
/** Tek sorguda en fazla 14 günlük aralık. */
export const ORDER_STREAM_MAX_WINDOW_MS = 14 * 24 * 60 * 60_000;
/** Erişilebilir geçmiş: son 3 ay. */
export const ORDER_HISTORY_MS = 90 * 24 * 60 * 60_000;
/** Dokümanın önerdiği istekler arası en kısa süre. */
export const ORDER_STREAM_MIN_INTERVAL_MS = 5_000;

export type PackageItemStatus =
  | "Created"
  | "Picking"
  | "Invoiced"
  | "Shipped"
  | "Cancelled"
  | "Delivered"
  | "UnDelivered"
  | "Returned"
  | "AtCollectionPoint"
  | "UnPacked"
  | "UnSupplied"
  | "Awaiting"
  | "Verified";

export interface StreamFilter {
  /** Unix zaman damgası (ms). */
  lastModifiedStartDate: number;
  lastModifiedEndDate: number;
  packageItemStatuses?: PackageItemStatus[];
  size?: number;
}

export async function getShipmentPackagesStream(
  client: TrendyolClient,
  filter: StreamFilter,
  nextCursor?: string,
): Promise<ShipmentPackagesStreamPage> {
  if (filter.lastModifiedEndDate < filter.lastModifiedStartDate) {
    throw new RangeError("Bitiş tarihi başlangıçtan önce olamaz");
  }
  if (filter.lastModifiedEndDate - filter.lastModifiedStartDate > ORDER_STREAM_MAX_WINDOW_MS) {
    throw new RangeError("Sipariş sorgu aralığı en fazla 14 gün olabilir");
  }
  const size = Math.min(filter.size ?? ORDER_STREAM_MAX_SIZE, ORDER_STREAM_MAX_SIZE);
  const res = await client.request<unknown>({
    method: "GET",
    path: `/integration/order/sellers/${client.sellerId}/orders/stream`,
    group: "orders",
    endpoint: "getShipmentPackagesStream",
    query: {
      size,
      lastModifiedStartDate: filter.lastModifiedStartDate,
      lastModifiedEndDate: filter.lastModifiedEndDate,
      ...(filter.packageItemStatuses?.length
        ? { packageItemStatuses: filter.packageItemStatuses.join(",") }
        : {}),
      ...(nextCursor ? { nextCursor } : {}),
    },
  });
  return streamResponse.parse(res);
}

/**
 * Bir filtre için akışı sonuna kadar gezer. Kurallar (kılavuz): ilk istekte cursor yok,
 * `hasMore` true iken yanıttaki `nextCursor` olduğu gibi kullanılır, filtre akış boyunca
 * değişmez, istekler arası en az 5 saniye.
 */
export async function* streamShipmentPackages(
  client: TrendyolClient,
  filter: StreamFilter,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): AsyncGenerator<ShipmentPackage[]> {
  let cursor: string | undefined;
  for (let first = true; ; first = false) {
    if (!first) await sleep(ORDER_STREAM_MIN_INTERVAL_MS);
    const page = await getShipmentPackagesStream(client, filter, cursor);
    yield page.content ?? [];
    if (!page.hasMore || !page.nextCursor || page.nextCursor === cursor) return;
    cursor = page.nextCursor;
  }
}

/**
 * [start, end] aralığını 14 günlük pencerelere böler (son 3 ay sınırı çağıranın sorumluluğunda).
 */
export function orderWindows(start: number, end: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (let s = start; s < end; s += ORDER_STREAM_MAX_WINDOW_MS) {
    out.push({ start: s, end: Math.min(end, s + ORDER_STREAM_MAX_WINDOW_MS) });
  }
  return out;
}

/**
 * Webhook gövdesi: dokümandaki model `{ content: [paket] }` zarfını gösteriyor, açıklama ise
 * "tam sipariş verisi" diyor. İki biçim de kabul edilir.
 */
export function parseWebhookPackages(body: unknown): ShipmentPackage[] {
  if (body && typeof body === "object" && Array.isArray((body as { content?: unknown }).content)) {
    return z.array(shipmentPackageSchema).parse((body as { content: unknown[] }).content);
  }
  return [shipmentPackageSchema.parse(body)];
}

// ── İç modele dönüşüm ───────────────────────────────────────────────────────

/** KVKK veri minimizasyonu: dropshipping için gerekmeyen en hassas alanlar hiç saklanmaz. */
const DROPPED_PII_KEYS = ["identityNumber", "customerTckn"] as const;

export interface OrderInput {
  shipmentPackageId: string;
  orderNumber: string;
  status: string;
  lastModifiedAt: Date;
  orderDate: Date | null;
  /** Kuruş. */
  packageTotalPrice: number | null;
  currency: string | null;
  channelId: number | null;
  paymentMethod: string | null;
  cargoTrackingNumber: string | null;
  cargoProviderName: string | null;
  createdBy: string | null;
  originPackageIds: string[] | null;
  customerName: string | null;
  raw: Record<string, unknown>;
  lines: {
    lineId: string;
    barcode: string | null;
    stockCode: string | null;
    quantity: number;
    /** Kuruş. */
    lineUnitPrice: number | null;
    commissionRate: number | null;
    vatRate: number | null;
    productName: string | null;
    lineStatus: string | null;
  }[];
}

const kurus = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100));

export function toOrderInput(p: ShipmentPackage): OrderInput {
  const raw: Record<string, unknown> = { ...p };
  for (const k of DROPPED_PII_KEYS) delete raw[k];
  const name = [p.customerFirstName, p.customerLastName].filter(Boolean).join(" ").trim();
  return {
    shipmentPackageId: p.shipmentPackageId,
    orderNumber: p.orderNumber,
    status: p.status,
    lastModifiedAt: new Date(p.lastModifiedDate),
    orderDate: p.orderDate != null ? new Date(p.orderDate) : null,
    packageTotalPrice: kurus(p.packageTotalPrice),
    currency: p.currencyCode ?? null,
    channelId: p.channelId ?? null,
    paymentMethod: p.paymentMethod ?? null,
    cargoTrackingNumber: p.cargoTrackingNumber ?? null,
    cargoProviderName: p.cargoProviderName ?? null,
    createdBy: p.createdBy ?? null,
    originPackageIds: p.originPackageIds ?? null,
    customerName: name || null,
    raw,
    lines: p.lines.map((l) => ({
      lineId: l.lineId,
      barcode: l.barcode ?? null,
      stockCode: l.stockCode ?? null,
      quantity: l.quantity,
      lineUnitPrice: kurus(l.lineUnitPrice),
      commissionRate: l.commission ?? null,
      vatRate: l.vatRate != null ? Math.round(l.vatRate) : null,
      productName: l.productName ?? null,
      lineStatus: l.orderLineItemStatusName ?? null,
    })),
  };
}
