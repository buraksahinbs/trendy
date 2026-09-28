import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const destination = { write: (s: string) => void lines.push(JSON.parse(s)) };
  return { lines, destination };
}

describe("createLogger", () => {
  it("gizli alanları iç içe nesnelerde de maskeler", () => {
    const { lines, destination } = capture();
    const log = createLogger({ destination, name: "test" });
    log.info({ headers: { authorization: "Basic abc" }, apiSecret: "s", tenantId: 7 }, "istek");
    expect(lines[0]).toMatchObject({
      name: "test",
      msg: "istek",
      tenantId: 7,
      headers: { authorization: "[REDACTED]" },
      apiSecret: "[REDACTED]",
    });
    expect(JSON.stringify(lines)).not.toContain("Basic abc");
  });

  it("child logger bağlamında da maskeler", () => {
    const { lines, destination } = capture();
    createLogger({ destination }).child({ tenantId: 1 }).warn({ apiKey: "k" });
    expect(lines[0]).toMatchObject({ tenantId: 1, apiKey: "[REDACTED]" });
  });

  it("seviyeye uyar", () => {
    const { lines, destination } = capture();
    const log = createLogger({ destination, level: "warn" });
    log.info("görünmez");
    log.error("görünür");
    expect(lines.map((l) => l.msg)).toEqual(["görünür"]);
  });
});

describe("createLogger hata nesneleri", () => {
  it("err alanının mesajını korur", () => {
    const { lines, destination } = capture();
    createLogger({ destination }).error({ err: new Error("patladı") }, "hata");
    expect(lines[0]).toMatchObject({ err: { type: "Error", message: "patladı" } });
  });
});

describe("createLogger Fastify uyumu", () => {
  it("req serializer'ı çalışır, header'lar yazılmaz", () => {
    const { lines, destination } = capture();
    const log = createLogger({ destination }).child(
      {},
      {
        serializers: {
          req: (r: { method: string; url: string }) => ({ method: r.method, url: r.url }),
        },
      },
    );
    class FakeReq {
      method = "GET";
      url = "/auth/me";
      headers = { cookie: "trendy_session=gizli" };
    }
    log.info({ req: new FakeReq() }, "incoming request");
    expect(lines[0]).toMatchObject({ req: { method: "GET", url: "/auth/me" } });
    expect(JSON.stringify(lines)).not.toContain("gizli");
  });
});
