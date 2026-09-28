import { and, count, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Db, TenantTx } from "./client.js";
import { orderLines, orders, orderWebhooks, syncCursors, variants } from "./schema.js";

/**
 * Siparişler (ROADMAP Faz 10). Polling ve webhook aynı `upsertOrder` fonksiyonundan geçer
 * (idempotent). Tutarlar kuruş.
 */

export interface OrderLineInput {
  lineId: string;
  barcode: string | null;
  stockCode: string | null;
  quantity: number;
  lineUnitPrice: number | null;
  commissionRate: number | null;
  vatRate: number | null;
  productName: string | null;
  lineStatus: string | null;
}

export interface OrderInputRow {
  shipmentPackageId: string;
  orderNumber: string;
  status: string;
  lastModifiedAt: Date;
  orderDate: Date | null;
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
  lines: OrderLineInput[];
}

export type UpsertOrderResult = "created" | "updated" | "stale";

/**
 * Paket kaydı. Anahtar `shipmentPackageId`. Daha eski `lastModifiedDate` ile gelen veri
 * (ör. gecikmiş webhook) daha yenisinin üzerine yazılmaz; eşit zaman damgası güncellenir
 * (idempotent). Satırlar paketle birlikte yenilenir.
 */
export async function upsertOrder(
  tx: TenantTx,
  tenantId: number,
  o: OrderInputRow,
): Promise<UpsertOrderResult> {
  const { lines, ...fields } = o;
  const values = { ...fields, currency: fields.currency?.slice(0, 3) ?? null };
  const [row] = await tx
    .insert(orders)
    .values({ tenantId, ...values })
    .onConflictDoUpdate({
      target: [orders.tenantId, orders.shipmentPackageId],
      set: {
        orderNumber: sql`excluded.order_number`,
        status: sql`excluded.status`,
        lastModifiedAt: sql`excluded.last_modified_at`,
        orderDate: sql`excluded.order_date`,
        packageTotalPrice: sql`excluded.package_total_price`,
        currency: sql`excluded.currency`,
        channelId: sql`excluded.channel_id`,
        paymentMethod: sql`excluded.payment_method`,
        cargoTrackingNumber: sql`excluded.cargo_tracking_number`,
        cargoProviderName: sql`excluded.cargo_provider_name`,
        createdBy: sql`excluded.created_by`,
        originPackageIds: sql`excluded.origin_package_ids`,
        customerName: sql`excluded.customer_name`,
        raw: sql`excluded.raw`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${orders.lastModifiedAt} <= excluded.last_modified_at`,
    })
    .returning({ id: orders.id, inserted: sql<boolean>`(xmax = 0)` });
  if (!row) return "stale";

  await tx.delete(orderLines).where(eq(orderLines.orderId, row.id));
  if (lines.length) {
    await tx
      .insert(orderLines)
      .values(
        lines.map((l) => ({
          tenantId,
          orderId: row.id,
          ...l,
          // Aynı satır id'si iki kez gelirse (beklenmez) sonuncusu kalsın.
        })),
      )
      .onConflictDoNothing();
  }
  return row.inserted ? "created" : "updated";
}

// ── Senkron imleci ───────────────────────────────────────────────────────────

export async function getSyncCursor(tx: TenantTx, kind: string): Promise<Date | null> {
  const [row] = await tx
    .select({ until: syncCursors.lastSyncedUntil })
    .from(syncCursors)
    .where(eq(syncCursors.kind, kind));
  return row?.until ?? null;
}

export async function setSyncCursor(
  tx: TenantTx,
  tenantId: number,
  kind: string,
  until: Date,
): Promise<void> {
  await tx
    .insert(syncCursors)
    .values({ tenantId, kind, lastSyncedUntil: until })
    .onConflictDoUpdate({
      target: [syncCursors.tenantId, syncCursors.kind],
      set: { lastSyncedUntil: until },
    });
}

// ── Listeleme ────────────────────────────────────────────────────────────────

export interface OrderFilter {
  status?: string;
  search?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

/**
 * Not: alt sorgularda dış tablo sütunu açıkça `"orders"."id"` yazılır. Tek tablolu sorguda drizzle
 * sütunu nitelemez; `ol.order_id = id` iç tablonun kendi `id`'sine bağlanıp yanlış sonuç verirdi.
 */
/** Sipariş listesi: kişisel veri içermez (adres, e-posta, telefon yok; yalnızca müşteri adı). */
export async function listOrders(tx: TenantTx, f: OrderFilter) {
  const conds = [
    f.status ? eq(orders.status, f.status) : undefined,
    f.from ? gte(orders.orderDate, f.from) : undefined,
    f.to ? lte(orders.orderDate, f.to) : undefined,
    f.search
      ? sql`(${orders.orderNumber} ILIKE ${`%${f.search}%`} OR ${orders.shipmentPackageId} ILIKE ${`%${f.search}%`} OR EXISTS (
          SELECT 1 FROM ${orderLines} ol WHERE ol.order_id = "orders"."id"
            AND (ol.barcode ILIKE ${`%${f.search}%`} OR ol.stock_code ILIKE ${`%${f.search}%`})))`
      : undefined,
  ].filter(Boolean);
  const where = conds.length ? and(...conds) : undefined;
  const [total] = await tx.select({ count: count() }).from(orders).where(where);
  const items = await tx
    .select({
      id: orders.id,
      shipmentPackageId: orders.shipmentPackageId,
      orderNumber: orders.orderNumber,
      status: orders.status,
      orderDate: orders.orderDate,
      lastModifiedAt: orders.lastModifiedAt,
      packageTotalPrice: orders.packageTotalPrice,
      currency: orders.currency,
      channelId: orders.channelId,
      cargoProviderName: orders.cargoProviderName,
      cargoTrackingNumber: orders.cargoTrackingNumber,
      createdBy: orders.createdBy,
      customerName: orders.customerName,
      lineCount: sql<number>`(SELECT count(*)::int FROM ${orderLines} ol WHERE ol.order_id = "orders"."id")`,
      itemCount: sql<number>`(SELECT coalesce(sum(ol.quantity), 0)::int FROM ${orderLines} ol WHERE ol.order_id = "orders"."id")`,
    })
    .from(orders)
    .where(where)
    .orderBy(desc(orders.orderDate), desc(orders.id))
    .limit(f.limit)
    .offset(f.offset);
  return { total: total?.count ?? 0, items };
}

/**
 * Sipariş detayı. Satırlar katalogdaki varyantla (barkod) eşlenir: tedarikçiye iletilecek
 * stok kodu bilgisi. Teslimat adresi yalnızca `includePersonal` ile döner (owner).
 */
export async function getOrder(tx: TenantTx, id: number, includePersonal: boolean) {
  const [o] = await tx.select().from(orders).where(eq(orders.id, id));
  if (!o) return undefined;
  const lines = await tx
    .select({
      lineId: orderLines.lineId,
      barcode: orderLines.barcode,
      stockCode: orderLines.stockCode,
      quantity: orderLines.quantity,
      lineUnitPrice: orderLines.lineUnitPrice,
      commissionRate: orderLines.commissionRate,
      vatRate: orderLines.vatRate,
      productName: orderLines.productName,
      lineStatus: orderLines.lineStatus,
      variantId: variants.id,
      supplierStockCode: variants.stockCode,
    })
    .from(orderLines)
    .leftJoin(variants, eq(variants.barcode, orderLines.barcode))
    .where(eq(orderLines.orderId, id))
    .orderBy(orderLines.id);
  const { raw, ...rest } = o;
  const r = raw as Record<string, unknown>;
  return {
    ...rest,
    lines,
    ...(includePersonal
      ? { shipmentAddress: r.shipmentAddress ?? null, invoiceAddress: r.invoiceAddress ?? null }
      : {}),
  };
}

// ── Webhook ──────────────────────────────────────────────────────────────────

/** Gelen webhook isteğinde token ile tenant bulunur (sistem bağlantısı; tenant henüz bilinmez). */
export async function findOrderWebhookByToken(db: Db, token: string) {
  const [row] = await db
    .select({ tenantId: orderWebhooks.tenantId, apiKeyEnc: orderWebhooks.apiKeyEnc })
    .from(orderWebhooks)
    .where(eq(orderWebhooks.token, token));
  return row;
}

export async function getOrderWebhook(tx: TenantTx) {
  const [row] = await tx.select().from(orderWebhooks);
  return row;
}

export async function saveOrderWebhook(
  tx: TenantTx,
  tenantId: number,
  token: string,
  apiKeyEnc: string,
): Promise<void> {
  await tx
    .insert(orderWebhooks)
    .values({ tenantId, token, apiKeyEnc })
    .onConflictDoUpdate({
      target: orderWebhooks.tenantId,
      set: { token, apiKeyEnc, lastReceivedAt: null, trendyolWebhookId: null },
    });
}

export async function touchOrderWebhook(tx: TenantTx): Promise<void> {
  await tx.update(orderWebhooks).set({ lastReceivedAt: sql`now()` });
}
