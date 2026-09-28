import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TrendyolClient } from "./client.js";
import {
  getShipmentPackagesStream,
  ORDER_STREAM_MAX_WINDOW_MS,
  orderWindows,
  parseWebhookPackages,
  streamShipmentPackages,
} from "./order-api.js";
import { InMemoryRateLimiter } from "./rate-limiter.js";

const fixture = JSON.parse(
  readFileSync(new URL("../../../fixtures/trendyol/order-stream.json", import.meta.url), "utf8"),
) as { content: Record<string, unknown>[] };

let pages: unknown[] = [];
const received: URL[] = [];
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    received.push(new URL(req.url!, "http://x"));
    const body = pages.shift() ?? { hasMore: false, content: [] };
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
beforeEach(() => {
  pages = [];
  received.length = 0;
});

const client = () =>
  new TrendyolClient({
    env: "prod",
    sellerId: "99999999",
    apiKey: "K",
    apiSecret: "S",
    integratorName: "SelfIntegration",
    tier: "50k",
    limiter: new InMemoryRateLimiter(),
    baseUrl,
    sleep: async () => {},
  });

const filter = { lastModifiedStartDate: 1_000, lastModifiedEndDate: 2_000 };

describe("getShipmentPackagesStream", () => {
  it("resmi yol ve parametreler; doküman örneğini güncel alan adlarıyla okur", async () => {
    pages = [fixture];
    const r = await getShipmentPackagesStream(client(), {
      ...filter,
      packageItemStatuses: ["Created", "Picking"],
    });
    const u = received[0]!;
    expect(u.pathname).toBe("/integration/order/sellers/99999999/orders/stream");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      size: "200",
      lastModifiedStartDate: "1000",
      lastModifiedEndDate: "2000",
      packageItemStatuses: "Created,Picking",
    });
    const p = r.content![0]!;
    expect(p).toMatchObject({
      shipmentPackageId: "3330111111",
      orderNumber: "10654411111",
      status: "Delivered",
      packageTotalPrice: 498.9,
      cargoTrackingNumber: "7280027504111111",
      channelId: 1,
      createdBy: "order-creation",
      originPackageIds: null,
    });
    expect(p.lines[0]).toMatchObject({
      lineId: "4765111111",
      barcode: "8683772071724",
      stockCode: "111111",
      quantity: 1,
      lineUnitPrice: 498.9,
      commission: 13,
      vatRate: 20,
    });
  });

  it("14 günden uzun veya ters aralık gönderilmez", async () => {
    await expect(
      getShipmentPackagesStream(client(), {
        lastModifiedStartDate: 0,
        lastModifiedEndDate: ORDER_STREAM_MAX_WINDOW_MS + 1,
      }),
    ).rejects.toThrow(/14 gün/);
    await expect(
      getShipmentPackagesStream(client(), { lastModifiedStartDate: 2, lastModifiedEndDate: 1 }),
    ).rejects.toThrow();
    expect(received).toHaveLength(0);
  });

  it("zorunlu alan eksikse (shipmentPackageId) yanıt reddedilir", async () => {
    pages = [
      { hasMore: false, content: [{ orderNumber: "1", status: "Created", lastModifiedDate: 1 }] },
    ];
    await expect(getShipmentPackagesStream(client(), filter)).rejects.toThrow();
  });
});

describe("streamShipmentPackages", () => {
  it("cursor ile gezer, filtreyi değiştirmez, istekler arasında 5 sn bekler", async () => {
    const pkg = (id: number) => ({ ...fixture.content[0], shipmentPackageId: id });
    pages = [
      { hasMore: true, nextCursor: "c1", content: [pkg(1), pkg(2)] },
      { hasMore: true, nextCursor: "c2", content: [pkg(3)] },
      { hasMore: false, nextCursor: null, content: [pkg(4)] },
    ];
    const slept: number[] = [];
    const ids: string[] = [];
    for await (const batch of streamShipmentPackages(
      client(),
      filter,
      async (ms) => void slept.push(ms),
    )) {
      ids.push(...batch.map((p) => p.shipmentPackageId));
    }
    expect(ids).toEqual(["1", "2", "3", "4"]);
    expect(received.map((u) => u.searchParams.get("nextCursor"))).toEqual([null, "c1", "c2"]);
    // Filtre her istekte aynı.
    expect(
      new Set(
        received.map(
          (u) =>
            `${u.searchParams.get("lastModifiedStartDate")}-${u.searchParams.get("lastModifiedEndDate")}`,
        ),
      ).size,
    ).toBe(1);
    expect(slept).toEqual([5000, 5000]);
  });

  it("aynı cursor tekrar dönerse durur (sonsuz döngü yok)", async () => {
    pages = Array.from({ length: 5 }, () => ({ hasMore: true, nextCursor: "ayni", content: [] }));
    let n = 0;
    for await (const batch of streamShipmentPackages(client(), filter, async () => {})) {
      expect(batch).toEqual([]);
      n++;
    }
    expect(n).toBe(2);
  });
});

describe("orderWindows", () => {
  it("14 günlük pencerelere böler", () => {
    const d = ORDER_STREAM_MAX_WINDOW_MS;
    expect(orderWindows(0, d * 2 + 5)).toEqual([
      { start: 0, end: d },
      { start: d, end: 2 * d },
      { start: 2 * d, end: 2 * d + 5 },
    ]);
    expect(orderWindows(10, 10)).toEqual([]);
  });
});

describe("parseWebhookPackages", () => {
  it("zarf ({content: [...]}) ve tek paket biçimlerini kabul eder", () => {
    expect(parseWebhookPackages({ totalElements: 1, content: fixture.content })).toHaveLength(1);
    expect(parseWebhookPackages(fixture.content[0])[0]!.shipmentPackageId).toBe("3330111111");
    expect(() => parseWebhookPackages({ foo: 1 })).toThrow();
  });
});

describe("toOrderInput", () => {
  it("iç modele çevirir: kuruş, tarih, müşteri adı; T.C. kimlik no saklanmaz", async () => {
    const { toOrderInput, shipmentPackageSchema } = await import("./order-api.js");
    const o = toOrderInput(shipmentPackageSchema.parse(fixture.content[0]));
    expect(o).toMatchObject({
      shipmentPackageId: "3330111111",
      packageTotalPrice: 49890,
      orderDate: new Date(1762253333685),
      lastModifiedAt: new Date(1762865408581),
      customerName: "John Doe",
      channelId: 1,
      paymentMethod: "Alışveriş Kredisi",
    });
    expect(o.lines[0]).toMatchObject({
      lineId: "4765111111",
      lineUnitPrice: 49890,
      commissionRate: 13,
      vatRate: 20,
      lineStatus: "Delivered",
    });
    expect(o.raw).not.toHaveProperty("identityNumber");
    expect(JSON.stringify(o.raw)).not.toContain('11111111111"');
  });
});
