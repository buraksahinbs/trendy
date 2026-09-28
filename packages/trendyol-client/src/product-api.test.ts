import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TrendyolClient } from "./client.js";
import { TrendyolValidationError } from "./errors.js";
import {
  filterApprovedProducts,
  filterApprovedProductsInventoryAndPrice,
  filterUnapprovedProducts,
  getBatchRequestResult,
  getProductBase,
  isBatchComplete,
  paginate,
  updatePriceAndInventory,
  type BatchRequestResult,
} from "./product-api.js";
import { InMemoryRateLimiter } from "./rate-limiter.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../fixtures/trendyol/${name}`, import.meta.url), "utf8"));

type Reply = { status?: number; body?: unknown };
let handler: (url: URL) => Reply = () => ({ body: {} });
const received: { method: string; url: URL; body: string }[] = [];
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url!, "http://x");
      received.push({ method: req.method!, url, body });
      const r = handler(url);
      res.writeHead(r.status ?? 200, { "content-type": "application/json" });
      res.end(r.body === undefined ? "" : JSON.stringify(r.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
beforeEach(() => {
  received.length = 0;
  handler = () => ({ body: {} });
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
    random: () => 0,
  });

describe("updatePriceAndInventory", () => {
  it("resmi yola doğru gövdeyle gönderir ve batchRequestId döner", async () => {
    handler = () => ({ body: { batchRequestId: "fa75dfd5-1529854840" } });
    const r = await updatePriceAndInventory(client(), [
      { barcode: "8680000000", quantity: 100, salePrice: 112.85, listPrice: 113.85 },
      { barcode: "8680000001", quantity: 0 },
    ]);
    expect(r.batchRequestId).toBe("fa75dfd5-1529854840");
    const req = received[0]!;
    expect(req.method).toBe("POST");
    expect(req.url.pathname).toBe(
      "/integration/inventory/sellers/99999999/products/price-and-inventory",
    );
    expect(JSON.parse(req.body)).toEqual({
      items: [
        { barcode: "8680000000", quantity: 100, salePrice: 112.85, listPrice: 113.85 },
        { barcode: "8680000001", quantity: 0 },
      ],
    });
  });

  it.each([
    [[], "boş istek"],
    [Array.from({ length: 1001 }, (_, i) => ({ barcode: `B${i}`, quantity: 1 })), "1000'den fazla"],
    [[{ barcode: "B1", quantity: 20_001 }], "20.000 üstü stok"],
    [[{ barcode: "B1", quantity: -1 }], "negatif stok"],
    [[{ barcode: "B1", quantity: 1.5 }], "ondalıklı stok"],
    [[{ barcode: "B1", salePrice: 0 }], "sıfır fiyat"],
    [[{ barcode: "B1", salePrice: Number.NaN }], "NaN fiyat"],
    [[{ barcode: "B1", salePrice: 10.005 }], "3 ondalık"],
    [[{ barcode: "B1", salePrice: 100, listPrice: 90 }], "listPrice < salePrice"],
    [[{ barcode: "B1" }], "ne stok ne fiyat"],
    [[{ barcode: "B 1", quantity: 1 }], "normalize edilmemiş barkod"],
    [[{ barcode: "B/1", quantity: 1 }], "geçersiz karakter"],
    [
      [
        { barcode: "B1", quantity: 1 },
        { barcode: "B1", quantity: 2 },
      ],
      "tekrarlanan barkod",
    ],
  ])("geçersiz istek gönderilmez: %j (%s)", async (items, label) => {
    await expect(updatePriceAndInventory(client(), items as never), label).rejects.toThrow();
    expect(received).toHaveLength(0);
  });

  it("yanıtta batchRequestId yoksa hata verir (sessizce başarılı sayılmaz)", async () => {
    handler = () => ({ body: {} });
    await expect(
      updatePriceAndInventory(client(), [{ barcode: "B1", quantity: 1 }]),
    ).rejects.toThrow();
  });

  it("Trendyol 400 dönerse TrendyolValidationError", async () => {
    handler = () => ({
      status: 400,
      body: { errors: [{ message: "15 dakika boyunca aynı isteği tekrarlı olarak atamazsınız!" }] },
    });
    const err = await updatePriceAndInventory(client(), [{ barcode: "B1", quantity: 1 }]).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TrendyolValidationError);
    expect((err as TrendyolValidationError).responseBody).toContain("15 dakika");
  });
});

describe("getBatchRequestResult", () => {
  it("resmi yoldan sonucu okur (doküman örneği)", async () => {
    handler = () => ({ body: fixture("batch-result-price-inventory.json") });
    const r = await getBatchRequestResult(client(), "c57e3453-2c00/x");
    expect(received[0]!.url.pathname).toBe(
      "/integration/product/sellers/99999999/products/batch-requests/c57e3453-2c00%2Fx",
    );
    expect(r).toMatchObject({
      batchRequestType: "ProductInventoryUpdate",
      itemCount: 1,
      failedItemCount: 0,
    });
    expect(r.items![0]).toMatchObject({
      status: "SUCCESS",
      requestItem: { barcode: "11111111111" },
    });
    expect(isBatchComplete(r)).toBe(true);
  });
});

describe("isBatchComplete", () => {
  const base: BatchRequestResult = { batchRequestId: "b" };
  it.each([
    [{ ...base, status: "COMPLETED" }, true],
    [{ ...base, status: "IN_PROGRESS", items: [{ status: "SUCCESS" }] }, false],
    // Stok/fiyat: batch status dönmez, öğe durumlarına bakılır.
    [{ ...base, itemCount: 2, items: [{ status: "SUCCESS" }, { status: "FAILED" }] }, true],
    [{ ...base, itemCount: 2, items: [{ status: "SUCCESS" }, { status: "IN_PROGRESS" }] }, false],
    [{ ...base, itemCount: 3, items: [{ status: "SUCCESS" }, { status: "SUCCESS" }] }, false],
    [{ ...base, items: [] }, false],
    [{ ...base }, false],
  ] as [BatchRequestResult, boolean][])("%j -> %s", (r, expected) => {
    expect(isBatchComplete(r)).toBe(expected);
  });
});

describe("ürün filtreleme", () => {
  it("onaylı ürünler: yol, parametreler ve doküman örneği (şemada olmayan alanlar kodu kırmaz)", async () => {
    handler = () => ({ body: fixture("approved-products.json") });
    const r = await filterApprovedProducts(client(), { page: 2, status: "onSale" });
    const url = received[0]!.url;
    expect(url.pathname).toBe("/integration/product/sellers/99999999/products/approved");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: "2",
      size: "100",
      status: "onSale",
    });
    const [v1, v2] = r.content![0]!.variants!;
    expect(v1).toMatchObject({
      barcode: "12613876842A60",
      onSale: false,
      locked: false,
      channels: ["CORE", "LUXE"],
    });
    expect(v2).toMatchObject({
      locked: true,
      lockReason: "Kritik fiyat hatası",
      price: { salePrice: 250, listPrice: 300 },
    });
  });

  it("stok/fiyat filtresi: yol ve doküman örneği; size 100'e sınırlanır", async () => {
    handler = () => ({ body: fixture("inventory-and-price.json") });
    const r = await filterApprovedProductsInventoryAndPrice(client(), { size: 500 });
    expect(received[0]!.url.pathname).toBe(
      "/integration/product/sellers/99999999/products/approved/inventory-and-price",
    );
    expect(received[0]!.url.searchParams.get("size")).toBe("100");
    expect(r.content![0]!.variants![0]).toMatchObject({
      barcode: "60506560",
      quantity: 50,
      salePrice: 699.99,
    });
  });

  it("onaysız ürünler: yol, size 1000'e kadar, red sebepleri", async () => {
    handler = () => ({ body: fixture("unapproved-products.json") });
    const r = await filterUnapprovedProducts(client(), { status: "rejected" });
    expect(received[0]!.url.pathname).toBe(
      "/integration/product/sellers/99999999/products/unapproved",
    );
    expect(received[0]!.url.searchParams.get("size")).toBe("1000");
    expect(r.content![1]!.rejectReasonDetails![0]!.rejectReasonDetail).toBe(
      "Görsel çözünürlüğü yetersiz",
    );
  });

  it("temel bilgi: tekil 'product' yolu", async () => {
    handler = () => ({ body: { barcode: "B1", approved: true, archived: false, contentId: 5 } });
    const r = await getProductBase(client(), "B1");
    expect(received[0]!.url.pathname).toBe("/integration/product/sellers/99999999/product/B1");
    expect(r.approved).toBe(true);
  });

  it("zorunlu alan (barcode) eksikse yanıt reddedilir", async () => {
    handler = () => ({ body: { content: [{ variants: [{ quantity: 1 }] }] } });
    await expect(filterApprovedProductsInventoryAndPrice(client())).rejects.toThrow();
  });
});

/** Üreteci en fazla `max` sayfa tüketir, sayfa sayısını döner. */
async function drain(it: AsyncIterable<unknown>, max = 1000): Promise<number> {
  let n = 0;
  for await (const page of it) {
    if (page !== undefined) n++;
    if (n >= max) break;
  }
  return n;
}

describe("paginate", () => {
  const page = (n: number, token?: string) => ({
    content: Array.from({ length: n }, (_, i) => i),
    totalPages: 1000,
    ...(token ? { nextPageToken: token } : {}),
  });

  it("totalPages'e kadar sayfa numarasıyla gezer", async () => {
    const calls: object[] = [];
    const n = await drain(
      paginate(async (q) => (calls.push(q), { content: [1], totalPages: 3 }), 100),
    );
    expect(n).toBe(3);
    expect(calls).toEqual([
      { page: 0, size: 100 },
      { page: 1, size: 100 },
      { page: 2, size: 100 },
    ]);
  });

  it("10.000 sınırında nextPageToken'a geçer; token biterse durur", async () => {
    const calls: { page?: number; nextPageToken?: string }[] = [];
    await drain(
      paginate(async (q) => {
        calls.push(q);
        if (q.nextPageToken === "t1") return page(100, "t2");
        if (q.nextPageToken === "t2") return page(100);
        return page(100, "t1");
      }, 100),
      500,
    );
    expect(calls[99]).toEqual({ page: 99, size: 100 });
    expect(calls[100]).toEqual({ size: 100, nextPageToken: "t1" });
    expect(calls[101]).toEqual({ size: 100, nextPageToken: "t2" });
    expect(calls).toHaveLength(102);
  });

  it("boş sayfada durur", async () => {
    const calls: object[] = [];
    await drain(paginate(async (q) => (calls.push(q), { content: [], totalPages: 5 }), 100));
    expect(calls).toHaveLength(1);
  });

  it("aynı token tekrar dönerse sonsuz döngüye girmez", async () => {
    const calls: object[] = [];
    await drain(
      paginate(async (q) => (calls.push(q), page(100, "ayni")), 5000),
      10,
    );
    // size 5000: 2 sayfa numarası (0,1) → token "ayni" → yine "ayni" dönünce durur.
    expect(calls).toHaveLength(3);
  });
});
