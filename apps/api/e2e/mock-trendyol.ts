import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Uçtan uca test için sahte Trendyol. Yalnızca platformun kullandığı servisleri, resmi
 * dokümandaki yol ve alan adlarıyla taklit eder; kimlik ve User-Agent kontrol edilir.
 * Gerçek Trendyol'a hiçbir istek gitmez.
 */

export interface MockProduct {
  barcode: string;
  productMainId: string;
  title: string;
  brand: string;
  status: "approved" | "rejected" | "pendingApproval";
  salePrice: number;
  listPrice: number;
  quantity: number;
  locked?: boolean;
  lockReason?: string;
}

export interface MockPackage {
  shipmentPackageId: number;
  orderNumber: string;
  status: string;
  lastModifiedDate: number;
  orderDate: number;
  packageTotalPrice: number;
  currencyCode: string;
  customerFirstName: string;
  customerLastName: string;
  identityNumber?: string;
  shipmentAddress?: Record<string, unknown>;
  lines: Record<string, unknown>[];
}

export interface MockOptions {
  sellerId: string;
  apiKey: string;
  apiSecret: string;
  products: MockProduct[];
  packages: MockPackage[];
}

export interface PriceInventoryCall {
  batchRequestId: string;
  items: { barcode: string; quantity?: number; salePrice?: number; listPrice?: number }[];
}

export async function startMockTrendyol(opts: MockOptions) {
  const calls: PriceInventoryCall[] = [];
  const requests: { method: string; path: string; status: number }[] = [];
  /** Bu barkodlar bir sonraki batch'te FAILED döner (bir kez). */
  const failNext = new Map<string, string>();
  const batches = new Map<string, { barcode: string; ok: boolean; reason?: string }[]>();
  const expectedAuth = `Basic ${Buffer.from(`${opts.apiKey}:${opts.apiSecret}`).toString("base64")}`;
  const seller = opts.sellerId;
  let batchSeq = 0;

  const byMain = (items: MockProduct[]) => {
    const groups = new Map<string, MockProduct[]>();
    for (const p of items) groups.set(p.productMainId, [...(groups.get(p.productMainId) ?? []), p]);
    return [...groups.entries()];
  };
  const page = <T>(all: T[], q: URLSearchParams) => {
    const size = Number(q.get("size") ?? 50);
    const pageNo = Number(q.get("page") ?? 0);
    return {
      totalElements: all.length,
      totalPages: Math.max(1, Math.ceil(all.length / size)),
      page: pageNo,
      size,
      content: all.slice(pageNo * size, pageNo * size + size),
    };
  };

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url!, "http://mock");
      const send = (status: number, data?: unknown) => {
        requests.push({ method: req.method!, path: url.pathname, status });
        res.writeHead(status, { "content-type": "application/json" });
        res.end(data === undefined ? "" : JSON.stringify(data));
      };
      if (req.headers.authorization !== expectedAuth)
        return send(401, { errors: ["Unauthorized"] });
      if (req.headers["user-agent"] !== `${seller} - SelfIntegration`) {
        return send(403, { errors: ["User-Agent"] });
      }
      const p = url.pathname;
      const q = url.searchParams;
      const approved = opts.products.filter((x) => x.status === "approved");

      if (p === `/integration/product/sellers/${seller}/products/approved/inventory-and-price`) {
        const content = byMain(approved).map(([main, vs], i) => ({
          contentId: 1000 + i,
          productMainId: main,
          variants: vs.map((v) => ({
            barcode: v.barcode,
            salePrice: v.salePrice,
            listPrice: v.listPrice,
            quantity: v.quantity,
          })),
        }));
        return send(200, page(content, q));
      }
      if (p === `/integration/product/sellers/${seller}/products/approved`) {
        const content = byMain(approved).map(([main, vs], i) => ({
          contentId: 1000 + i,
          productMainId: main,
          title: vs[0]!.title,
          brand: { id: 1, name: vs[0]!.brand },
          variants: vs.map((v) => ({
            barcode: v.barcode,
            onSale: !v.locked,
            locked: v.locked ?? false,
            lockReason: v.lockReason ?? null,
            archived: false,
            blacklisted: false,
            price: { salePrice: v.salePrice, listPrice: v.listPrice },
          })),
        }));
        return send(200, page(content, q));
      }
      if (p === `/integration/product/sellers/${seller}/products/unapproved`) {
        const status = q.get("status");
        const content = opts.products
          .filter((x) => x.status === status)
          .map((x) => ({
            barcode: x.barcode,
            productMainId: x.productMainId,
            title: x.title,
            quantity: x.quantity,
            salePrice: x.salePrice,
            listPrice: x.listPrice,
            rejectReasonDetails:
              status === "rejected"
                ? [{ rejectReason: "Görsel", rejectReasonDetail: "Eksik" }]
                : [],
          }));
        return send(200, page(content, q));
      }
      if (
        req.method === "POST" &&
        p === `/integration/inventory/sellers/${seller}/products/price-and-inventory`
      ) {
        const { items } = JSON.parse(body) as PriceInventoryCall;
        const batchRequestId = `mock-batch-${++batchSeq}`;
        calls.push({ batchRequestId, items });
        const results = items.map((it) => {
          const reason = failNext.get(it.barcode);
          failNext.delete(it.barcode);
          const product = opts.products.find((x) => x.barcode === it.barcode);
          if (reason || !product) {
            return { barcode: it.barcode, ok: false, reason: reason ?? "Ürün bulunamadı" };
          }
          if (it.quantity !== undefined) product.quantity = it.quantity;
          if (it.salePrice !== undefined) product.salePrice = it.salePrice;
          if (it.listPrice !== undefined) product.listPrice = it.listPrice;
          return { barcode: it.barcode, ok: true };
        });
        batches.set(batchRequestId, results);
        return send(200, { batchRequestId });
      }
      const batchMatch = p.match(
        new RegExp(`^/integration/product/sellers/${seller}/products/batch-requests/(.+)$`),
      );
      if (batchMatch) {
        const results = batches.get(decodeURIComponent(batchMatch[1]!));
        if (!results) return send(404, { errors: ["batch yok"] });
        return send(200, {
          batchRequestId: batchMatch[1],
          itemCount: results.length,
          items: results.map((r) => ({
            requestItem: { barcode: r.barcode },
            status: r.ok ? "SUCCESS" : "FAILED",
            failureReasons: r.ok ? [] : [r.reason],
          })),
        });
      }
      if (p === `/integration/order/sellers/${seller}/orders/stream`) {
        const from = Number(q.get("lastModifiedStartDate"));
        const to = Number(q.get("lastModifiedEndDate"));
        const content = opts.packages.filter(
          (x) => x.lastModifiedDate >= from && x.lastModifiedDate <= to,
        );
        return send(200, { hasMore: false, size: content.length, content });
      }
      return send(404, { errors: [`mock: bilinmeyen yol ${p}`] });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    calls,
    requests,
    failNext,
    products: opts.products,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** ETag destekli sahte tedarikçi XML feed'i; içerik test sırasında değiştirilebilir. */
export async function startFeedServer(initial: string) {
  let xml = initial;
  let hits = 0;
  let notModified = 0;
  const etag = () => `"${createHash("sha1").update(xml).digest("hex")}"`;
  const server = http.createServer((req, res) => {
    hits++;
    if (req.headers["if-none-match"] === etag()) {
      notModified++;
      res.writeHead(304).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/xml; charset=utf-8", etag: etag() });
    res.end(xml);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/feed.xml`,
    set: (next: string) => (xml = next),
    stats: () => ({ hits, notModified }),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
