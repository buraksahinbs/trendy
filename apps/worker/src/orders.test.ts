import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import {
  getSyncCursor,
  listJobLogs,
  markTrendyolCredentialsVerified,
  saveTrendyolCredentials,
  schema,
  withTenant,
  type Db,
} from "@trendy/db";
import { createTestDatabase } from "@trendy/db/testing";
import { createLogger, createSecretBox } from "@trendy/shared";
import { InMemoryRateLimiter, ORDER_STREAM_MAX_WINDOW_MS } from "@trendy/trendyol-client";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ORDER_OVERLAP_MS, runOrderSync } from "./orders.js";
import type { TrendyolDeps } from "./trendyol-jobs.js";

const url = process.env.DATABASE_URL;
const SELLER = "777";
const DAY = 24 * 3_600_000;

let pages: unknown[] = [];
let failWith: number | null = null;
const requests: URLSearchParams[] = [];
let server: http.Server;
let baseUrl: string;

const pkg = (id: number, patch: Record<string, unknown> = {}) => ({
  shipmentPackageId: id,
  orderNumber: `O-${id}`,
  status: "Created",
  lastModifiedDate: 1_700_000_000_000,
  orderDate: 1_700_000_000_000,
  packageTotalPrice: 100.5,
  currencyCode: "TRY",
  customerFirstName: "Ayşe",
  customerLastName: "Yılmaz",
  identityNumber: "12345678901",
  shipmentAddress: { fullAddress: "Kadıköy", city: "İstanbul" },
  createdBy: "order-creation",
  originPackageIds: null,
  lines: [
    {
      lineId: id * 10,
      barcode: "B-1",
      stockCode: "S-1",
      quantity: 2,
      lineUnitPrice: 50.25,
      commission: 12,
      vatRate: 20,
    },
  ],
  ...patch,
});

describe.skipIf(!url)("sipariş çekme", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let tenantId: number;
  let deps: TrendyolDeps;
  let slept: number[] = [];
  const now = new Date("2026-09-28T12:00:00Z");
  const box = createSecretBox({ 1: randomBytes(32).toString("base64") }, 1);

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const u = new URL(req.url!, "http://x");
      requests.push(u.searchParams);
      if (u.pathname !== `/integration/order/sellers/${SELLER}/orders/stream`) {
        res.writeHead(404).end("{}");
        return;
      }
      if (failWith) {
        res.writeHead(failWith, { "content-type": "application/json" }).end("{}");
        return;
      }
      const body = pages.shift() ?? { hasMore: false, content: [] };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const t = await createTestDatabase(url!);
    db = t.db;
    drop = t.drop;
    const [tenant] = await db
      .insert(schema.tenants)
      .values({ name: "A" })
      .returning({ id: schema.tenants.id });
    tenantId = tenant!.id;
    await withTenant(db, tenantId, (tx) =>
      saveTrendyolCredentials(tx, box, {
        tenantId,
        env: "prod",
        sellerId: SELLER,
        apiKey: "K",
        apiSecret: "S",
      }),
    );
    deps = {
      db,
      secretBox: box,
      limiter: new InMemoryRateLimiter(),
      logger: createLogger({ level: "silent" }),
      integratorName: "SelfIntegration",
      clientOptions: { baseUrl, sleep: async () => {}, random: () => 0 },
      now: () => now,
      sleep: async (ms) => void slept.push(ms),
    };
  });
  afterAll(async () => {
    server?.close();
    await drop?.();
  });
  beforeEach(() => {
    pages = [];
    failWith = null;
    requests.length = 0;
    slept = [];
  });

  const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, tenantId, fn);
  const orderById = async (spid: string) =>
    (
      await run((t) =>
        t.select().from(schema.orders).where(eq(schema.orders.shipmentPackageId, spid)),
      )
    )[0];
  const linesOf = async (orderId: number) =>
    run((t) => t.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, orderId)));
  const lastJob = async () => (await run((t) => listJobLogs(t, { limit: 1 })))[0]!;

  it("API bilgisi doğrulanmamışsa istek atılmaz", async () => {
    await runOrderSync(deps, tenantId);
    expect(requests).toHaveLength(0);
    expect(await lastJob()).toMatchObject({ jobType: "ty_orders", status: "skipped" });
  });

  describe("doğrulanmış hesap", () => {
    beforeAll(async () => {
      await run((t) => markTrendyolCredentialsVerified(t, tenantId, "prod"));
    });

    it("ilk çekim: son 14 gün, cursor ile sayfalar, 5 sn aralık, imleç ilerler", async () => {
      pages = [
        { hasMore: true, nextCursor: "c1", content: [pkg(1), pkg(2)] },
        { hasMore: false, content: [pkg(3)] },
      ];
      const s = await runOrderSync(deps, tenantId);
      expect(s).toMatchObject({ windows: 1, fetched: 3, created: 3, updated: 0, stale: 0 });
      expect(requests).toHaveLength(2);
      expect(Number(requests[0]!.get("lastModifiedStartDate"))).toBe(
        now.getTime() - ORDER_STREAM_MAX_WINDOW_MS,
      );
      expect(Number(requests[0]!.get("lastModifiedEndDate"))).toBe(now.getTime());
      expect(requests[0]!.get("nextCursor")).toBeNull();
      expect(requests[1]!.get("nextCursor")).toBe("c1");
      expect(requests[1]!.get("lastModifiedStartDate")).toBe(
        requests[0]!.get("lastModifiedStartDate"),
      );
      expect(slept).toEqual([5000]);
      expect(await run((t) => getSyncCursor(t, "orders"))).toEqual(now);

      const o = (await orderById("1"))!;
      expect(o).toMatchObject({
        orderNumber: "O-1",
        status: "Created",
        packageTotalPrice: 10050,
        customerName: "Ayşe Yılmaz",
        createdBy: "order-creation",
      });
      expect(o.raw).not.toHaveProperty("identityNumber");
      expect(await linesOf(o.id)).toEqual([
        expect.objectContaining({
          lineId: "10",
          barcode: "B-1",
          quantity: 2,
          lineUnitPrice: 5025,
          commissionRate: 12,
          vatRate: 20,
        }),
      ]);
    });

    it("sonraki tur imleçten 4 saat geriden başlar; aynı paket tekrar gelse de çoğalmaz", async () => {
      pages = [{ hasMore: false, content: [pkg(1)] }];
      const s = await runOrderSync(deps, tenantId);
      expect(Number(requests[0]!.get("lastModifiedStartDate"))).toBe(
        now.getTime() - ORDER_OVERLAP_MS,
      );
      expect(s).toMatchObject({ created: 0, updated: 1 });
      const all = await run((t) => t.select().from(schema.orders));
      expect(all).toHaveLength(3);
    });

    it("yeni statü güncellenir ve satırlar yenilenir; eski veri yeniyi ezmez", async () => {
      pages = [
        {
          hasMore: false,
          content: [
            pkg(2, {
              status: "Shipped",
              lastModifiedDate: 1_700_000_100_000,
              cargoTrackingNumber: 7280027504111111,
              lines: [{ lineId: 20, barcode: "B-1", quantity: 1, lineUnitPrice: 50.25 }],
            }),
          ],
        },
      ];
      expect((await runOrderSync(deps, tenantId)).updated).toBe(1);
      const o = (await orderById("2"))!;
      expect(o).toMatchObject({ status: "Shipped", cargoTrackingNumber: "7280027504111111" });
      expect((await linesOf(o.id)).map((l) => l.quantity)).toEqual([1]);

      // Gecikmiş eski güncelleme (ör. webhook) gelir.
      pages = [
        {
          hasMore: false,
          content: [pkg(2, { status: "Created", lastModifiedDate: 1_700_000_050_000 })],
        },
      ];
      expect((await runOrderSync(deps, tenantId)).stale).toBe(1);
      expect((await orderById("2"))!.status).toBe("Shipped");
    });

    it("paket bölünmesi: createdBy ve originPackageIds saklanır", async () => {
      pages = [
        { hasMore: false, content: [pkg(9, { createdBy: "split", originPackageIds: [1] })] },
      ];
      await runOrderSync(deps, tenantId);
      expect(await orderById("9")).toMatchObject({ createdBy: "split", originPackageIds: ["1"] });
    });

    it("uzun kesinti: aralık 14 günlük pencerelere bölünür; hepsi ≤ 14 gün", async () => {
      await run((t) =>
        t.update(schema.syncCursors).set({ lastSyncedUntil: new Date(now.getTime() - 30 * DAY) }),
      );
      const s = await runOrderSync(deps, tenantId);
      expect(s.windows).toBe(3);
      for (const q of requests) {
        const span = Number(q.get("lastModifiedEndDate")) - Number(q.get("lastModifiedStartDate"));
        expect(span).toBeLessThanOrEqual(ORDER_STREAM_MAX_WINDOW_MS);
      }
      expect(Number(requests.at(-1)!.get("lastModifiedEndDate"))).toBe(now.getTime());
      // Pencereler arasında da 5 sn beklenir.
      expect(slept).toEqual([5000, 5000]);
    });

    it("3 aydan eski imleç son 3 aya kırpılır", async () => {
      await run((t) =>
        t.update(schema.syncCursors).set({ lastSyncedUntil: new Date(now.getTime() - 200 * DAY) }),
      );
      await runOrderSync(deps, tenantId);
      const first = Number(requests[0]!.get("lastModifiedStartDate"));
      expect(first).toBeGreaterThanOrEqual(now.getTime() - 90 * DAY);
    });

    it("hata olursa iş başarısız olur ve imleç ilerlemez", async () => {
      const before = new Date(now.getTime() - 2 * DAY);
      await run((t) => t.update(schema.syncCursors).set({ lastSyncedUntil: before }));
      failWith = 401;
      await expect(runOrderSync(deps, tenantId)).rejects.toThrow();
      expect(await lastJob()).toMatchObject({ jobType: "ty_orders", status: "failed" });
      expect(await run((t) => getSyncCursor(t, "orders"))).toEqual(before);
    });

    it("backfill verilen aralığı tarar, imleci değiştirmez", async () => {
      const before = await run((t) => getSyncCursor(t, "orders"));
      pages = [{ hasMore: false, content: [pkg(50)] }];
      const from = new Date(now.getTime() - 20 * DAY);
      const to = new Date(now.getTime() - 10 * DAY);
      const s = await runOrderSync(deps, tenantId, { from, to });
      expect(s).toMatchObject({ windows: 1, created: 1 });
      expect(Number(requests[0]!.get("lastModifiedStartDate"))).toBe(from.getTime());
      expect(Number(requests[0]!.get("lastModifiedEndDate"))).toBe(to.getTime());
      expect(await run((t) => getSyncCursor(t, "orders"))).toEqual(before);
      expect(await lastJob()).toMatchObject({ jobType: "ty_orders_backfill", status: "success" });
    });
  });
});
