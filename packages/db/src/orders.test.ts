import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Db } from "./client.js";
import { purgeExpiredOrderPii, upsertOrder, type OrderInputRow } from "./orders.js";
import { orderLines, orders, tenants } from "./schema.js";
import { createTestDatabase } from "./testing.js";

const url = process.env.DATABASE_URL;
const NOW = new Date("2026-09-28T12:00:00Z");
const DAY = 86_400_000;

const order = (id: string, status: string, ageDays: number): OrderInputRow => ({
  shipmentPackageId: id,
  orderNumber: `O-${id}`,
  status,
  lastModifiedAt: new Date(NOW.getTime() - ageDays * DAY),
  orderDate: new Date(NOW.getTime() - ageDays * DAY),
  packageTotalPrice: 1000,
  currency: "TRY",
  channelId: 1,
  paymentMethod: null,
  cargoTrackingNumber: null,
  cargoProviderName: null,
  createdBy: "order-creation",
  originPackageIds: null,
  customerName: "Ayşe Yılmaz",
  raw: {
    orderNumber: `O-${id}`,
    customerEmail: "ayse@example.com",
    customerFirstName: "Ayşe",
    shipmentAddress: { fullAddress: "Moda Cad." },
    invoiceAddress: { taxNumber: "123" },
    lines: [{ barcode: "B" }],
  },
  lines: [
    {
      lineId: `${id}-1`,
      barcode: "B",
      stockCode: null,
      quantity: 1,
      lineUnitPrice: 1000,
      commissionRate: null,
      vatRate: 20,
      productName: "Ürün",
      lineStatus: status,
    },
  ],
});

describe.skipIf(!url)("KVKK: sipariş kişisel verisinin silinmesi", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let a: number;
  let b: number;

  beforeAll(async () => {
    const t = await createTestDatabase(url!);
    db = t.db;
    drop = t.drop;
    [{ id: a }, { id: b }] = (await db
      .insert(tenants)
      .values([
        { name: "A", orderPiiRetentionDays: 30 },
        { name: "B", orderPiiRetentionDays: 365 },
      ])
      .returning({ id: tenants.id })) as [{ id: number }, { id: number }];
    await withTenant(db, a, async (tx) => {
      await upsertOrder(tx, a, order("old-delivered", "Delivered", 40));
      await upsertOrder(tx, a, order("new-delivered", "Delivered", 10));
      await upsertOrder(tx, a, order("old-shipped", "Shipped", 40));
      await upsertOrder(tx, a, order("old-cancelled", "Cancelled", 31));
    });
    await withTenant(db, b, (tx) => upsertOrder(tx, b, order("b-old-delivered", "Delivered", 40)));
  });
  afterAll(async () => {
    await drop?.();
  });

  const get = async (id: string) =>
    (await db.select().from(orders).where(eq(orders.shipmentPackageId, id)))[0]!;

  it("yalnızca süresi dolan kapanmış siparişleri siler; sipariş, tutar ve satırlar korunur", async () => {
    expect(await purgeExpiredOrderPii(db, NOW)).toBe(2);

    const purged = await get("old-delivered");
    expect(purged.piiPurgedAt).toEqual(NOW);
    expect(purged.customerName).toBeNull();
    expect(purged.raw).toEqual({ orderNumber: "O-old-delivered", lines: [{ barcode: "B" }] });
    expect(purged.packageTotalPrice).toBe(1000);
    expect(
      await db.select().from(orderLines).where(eq(orderLines.orderId, purged.id)),
    ).toHaveLength(1);
    expect((await get("old-cancelled")).piiPurgedAt).toEqual(NOW);

    // Süresi dolmamış, açık statülü ve başka tenant'ın (365 gün) siparişleri dokunulmaz.
    for (const id of ["new-delivered", "old-shipped", "b-old-delivered"]) {
      const o = await get(id);
      expect(o.piiPurgedAt, id).toBeNull();
      expect(o.customerName).toBe("Ayşe Yılmaz");
      expect(o.raw).toHaveProperty("shipmentAddress");
    }
  });

  it("idempotent: ikinci çalıştırma bir şey yapmaz", async () => {
    expect(await purgeExpiredOrderPii(db, NOW)).toBe(0);
  });
});
