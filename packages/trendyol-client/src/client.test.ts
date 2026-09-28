import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TrendyolClient, type Logger, type TrendyolClientConfig } from "./client.js";
import {
  TrendyolAuthError,
  TrendyolDeprecatedEndpointError,
  TrendyolError,
  TrendyolRateLimitError,
  TrendyolServerError,
  TrendyolValidationError,
} from "./errors.js";
import { InMemoryRateLimiter } from "./rate-limiter.js";

/** Mock Trendyol: her path için sıradaki yanıtlar kuyruktan verilir. */
type Reply = { status: number; body?: unknown; headers?: Record<string, string> };
const replies = new Map<string, Reply[]>();
const received: { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }[] =
  [];

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      const path = req.url!.split("?")[0]!;
      const reply = replies.get(path)?.shift() ?? { status: 200, body: { ok: true } };
      res.writeHead(reply.status, { "content-type": "application/json", ...reply.headers });
      res.end(reply.body === undefined ? "" : JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

let clock = 0;
let slept: number[] = [];
let logs: { level: string; obj: object }[] = [];

beforeEach(() => {
  replies.clear();
  received.length = 0;
  clock = 0;
  slept = [];
  logs = [];
});

const logger: Logger = {
  info: (obj) => logs.push({ level: "info", obj }),
  warn: (obj) => logs.push({ level: "warn", obj }),
  error: (obj) => logs.push({ level: "error", obj }),
};

function client(overrides: Partial<TrendyolClientConfig> = {}) {
  return new TrendyolClient({
    env: "stage",
    sellerId: "1234",
    apiKey: "KEY",
    apiSecret: "SECRET",
    integratorName: "SelfIntegration",
    tier: "50k",
    limiter: new InMemoryRateLimiter(() => clock),
    logger,
    baseUrl,
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
    random: () => 0,
    ...overrides,
  });
}

const get = { method: "GET", path: "/x", group: "productRead", endpoint: "x" } as const;

describe("TrendyolClient", () => {
  it("Basic Auth, User-Agent ve query parametrelerini gönderir", async () => {
    replies.set("/x", [{ status: 200, body: { a: 1 } }]);
    const result = await client().request({
      ...get,
      query: { page: 0, size: 50, skip: undefined },
    });
    expect(result).toEqual({ a: 1 });
    const req = received[0]!;
    expect(req.headers.authorization).toBe(`Basic ${Buffer.from("KEY:SECRET").toString("base64")}`);
    expect(req.headers["user-agent"]).toBe("1234 - SelfIntegration");
    expect(req.url).toBe("/x?page=0&size=50");
  });

  it("POST gövdesini JSON gönderir", async () => {
    await client().request({
      method: "POST",
      path: "/p",
      group: "inventoryWrite",
      endpoint: "p",
      body: { items: [1] },
    });
    expect(received[0]!.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(received[0]!.body)).toEqual({ items: [1] });
  });

  it("429'da Retry-After'a uyup tekrar dener", async () => {
    replies.set("/x", [
      { status: 429, headers: { "retry-after": "3" } },
      { status: 429 },
      { status: 200, body: 1 },
    ]);
    expect(await client().request(get)).toBe(1);
    expect(slept).toEqual([3000, 2000]);
  });

  it("429 tekrarları tükenince TrendyolRateLimitError", async () => {
    replies.set(
      "/x",
      Array.from({ length: 3 }, () => ({ status: 429 })),
    );
    await expect(client({ maxRateLimitRetries: 2 }).request(get)).rejects.toBeInstanceOf(
      TrendyolRateLimitError,
    );
    expect(received).toHaveLength(3);
  });

  it("5xx'te sınırlı tekrar, sonra TrendyolServerError", async () => {
    replies.set(
      "/x",
      Array.from({ length: 4 }, () => ({ status: 503 })),
    );
    await expect(client().request(get)).rejects.toBeInstanceOf(TrendyolServerError);
    expect(received).toHaveLength(4);
    expect(slept).toEqual([1000, 2000, 4000]);
  });

  it("5xx sonrası başarı", async () => {
    replies.set("/x", [{ status: 500 }, { status: 200, body: "ok" }]);
    expect(await client().request(get)).toBe("ok");
  });

  it.each([
    [401, TrendyolAuthError],
    [403, TrendyolAuthError],
    [400, TrendyolValidationError],
    [404, TrendyolValidationError],
    [426, TrendyolDeprecatedEndpointError],
  ])("%d tekrar denenmez", async (status, Cls) => {
    replies.set("/x", [{ status, body: { errors: [{ message: "hata" }] } }]);
    const err = await client()
      .request(get)
      .then(
        () => undefined,
        (e: unknown) => e as TrendyolError,
      );
    expect(err).toBeInstanceOf(Cls);
    expect(err?.status).toBe(status);
    expect(err?.responseBody).toContain("hata");
    expect(received).toHaveLength(1);
  });

  it("426 error seviyesinde loglanır", async () => {
    replies.set("/x", [{ status: 426 }]);
    await client()
      .request(get)
      .catch(() => {});
    expect(logs.some((l) => l.level === "error")).toBe(true);
  });

  it("ağ hatasında tekrar dener, sonra TrendyolServerError", async () => {
    const c = client({ baseUrl: "http://127.0.0.1:1", maxServerRetries: 1 });
    await expect(c.request(get)).rejects.toBeInstanceOf(TrendyolServerError);
    expect(slept).toEqual([1000]);
  });

  it("log'lara gizli bilgi yazılmaz", async () => {
    replies.set("/x", [{ status: 400, body: { apiSecret: "SECRET" } }, { status: 200 }]);
    await client()
      .request(get)
      .catch(() => {});
    const dump = JSON.stringify(logs);
    expect(dump).not.toContain("KEY:SECRET");
    expect(dump).not.toContain(Buffer.from("KEY:SECRET").toString("base64"));
  });

  describe("rate limit", () => {
    it("endpoint limiti: 10 saniyede 50 istek, 51. bekler", async () => {
      const c = client({ tier: "unlimited" });
      for (let i = 0; i < 51; i++) await c.request({ ...get, group: "none" });
      expect(slept).toEqual([10_000]);
    });

    it("grup limiti: 50K seviyesinde siparişte dakikada 30 istek", async () => {
      const c = client();
      const orders = { ...get, group: "orders" } as const;
      for (let i = 0; i < 31; i++) await c.request(orders);
      expect(slept).toEqual([60_000]);
    });

    it("limitler satıcı bazındadır", async () => {
      const limiter = new InMemoryRateLimiter(() => clock);
      const a = client({ limiter, sellerId: "1" });
      const b = client({ limiter, sellerId: "2" });
      const orders = { ...get, group: "orders" } as const;
      for (let i = 0; i < 30; i++) await a.request(orders);
      await b.request(orders);
      expect(slept).toEqual([]);
    });
  });

  describe("yapılandırma doğrulaması", () => {
    it.each([
      [{ integratorName: "Firma Adı" }],
      [{ integratorName: "x".repeat(31) }],
      [{ integratorName: "" }],
      [{ sellerId: "abc" }],
    ])("%j reddedilir", (overrides) => {
      expect(() => client(overrides)).toThrow();
    });

    it("ortama göre base URL", () => {
      expect(() => client({ env: "prod", baseUrl: undefined } as never)).not.toThrow();
    });
  });
});
