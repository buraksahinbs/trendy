import http from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { downloadFeed, FeedDownloadError } from "./download.js";
import { isBlockedAddress } from "./ssrf.js";

async function readAll(body: NodeJS.ReadableStream): Promise<string> {
  const parts: Buffer[] = [];
  for await (const c of body) parts.push(c as Buffer);
  return Buffer.concat(parts).toString();
}

let server: http.Server;
let base: string;
const XML = "<Urunler><Urun><Kod>1</Kod></Urun></Urunler>";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    switch (req.url) {
      case "/feed.xml":
        if (req.headers["if-none-match"] === '"v1"') {
          res.writeHead(304).end();
          return;
        }
        res.writeHead(200, { etag: '"v1"', "content-type": "application/xml" }).end(XML);
        return;
      case "/gzip":
        res.writeHead(200, { "content-encoding": "gzip" }).end(gzipSync(XML));
        return;
      case "/auth":
        res.writeHead(req.headers.authorization === "Basic eDp5" ? 200 : 401).end(XML);
        return;
      case "/redirect":
        res.writeHead(302, { location: "/feed.xml" }).end();
        return;
      case "/loop":
        res.writeHead(302, { location: "/loop" }).end();
        return;
      case "/to-file":
        res.writeHead(302, { location: "file:///etc/passwd" }).end();
        return;
      case "/big":
        res.writeHead(200).end("x".repeat(10_000));
        return;
      case "/gzip-bomb":
        res.writeHead(200, { "content-encoding": "gzip" }).end(gzipSync("x".repeat(1_000_000)));
        return;
      case "/slow":
        res.writeHead(200);
        res.write("<a>");
        return; // hiç bitmez
      default:
        res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const local = { allowPrivateNetwork: true };

describe("downloadFeed", () => {
  it("indirir ve ETag döner; ETag ile tekrar istekte 304", async () => {
    const r = await downloadFeed(`${base}/feed.xml`, local);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.etag).toBe('"v1"');
    expect(await readAll(r.body)).toBe(XML);
    expect(await downloadFeed(`${base}/feed.xml`, { ...local, etag: '"v1"' })).toEqual({
      status: "not_modified",
    });
  });

  it("gzip açar", async () => {
    const r = await downloadFeed(`${base}/gzip`, local);
    if (r.status !== "ok") throw new Error("beklenmeyen");
    expect(await readAll(r.body)).toBe(XML);
  });

  it("tedarikçi header'larını gönderir", async () => {
    const r = await downloadFeed(`${base}/auth`, {
      ...local,
      headers: { authorization: "Basic eDp5" },
    });
    expect(r.status).toBe("ok");
    await expect(downloadFeed(`${base}/auth`, local)).rejects.toMatchObject({
      code: "http_status",
      httpStatus: 401,
    });
  });

  it("yönlendirmeyi izler, döngüyü keser, http dışı protokolü reddeder", async () => {
    const r = await downloadFeed(`${base}/redirect`, local);
    expect(r.status === "ok" && r.finalUrl).toBe(`${base}/feed.xml`);
    await expect(downloadFeed(`${base}/loop`, local)).rejects.toMatchObject({
      code: "too_many_redirects",
    });
    await expect(downloadFeed(`${base}/to-file`, local)).rejects.toMatchObject({
      code: "invalid_url",
    });
  });

  it("boyut sınırını aşan feed'i keser (gzip bombası dahil)", async () => {
    for (const path of ["/big", "/gzip-bomb"]) {
      const r = await downloadFeed(`${base}${path}`, { ...local, maxBytes: 1000 });
      if (r.status !== "ok") throw new Error("beklenmeyen");
      await expect(readAll(r.body)).rejects.toMatchObject({ code: "too_large" });
    }
  });

  it("zaman aşımında durur", async () => {
    const r = await downloadFeed(`${base}/slow`, { ...local, timeoutMs: 200 });
    if (r.status !== "ok") throw new Error("beklenmeyen");
    await expect(readAll(r.body)).rejects.toMatchObject({ code: "timeout" });
  });

  it("geçersiz URL ve protokol", async () => {
    await expect(downloadFeed("not a url")).rejects.toMatchObject({ code: "invalid_url" });
    await expect(downloadFeed("ftp://example.com/a.xml")).rejects.toMatchObject({
      code: "invalid_url",
    });
  });

  describe("SSRF", () => {
    it("varsayılan olarak yerel sunucuya bağlanmaz (IP literal)", async () => {
      await expect(downloadFeed(`${base}/feed.xml`)).rejects.toMatchObject({
        code: "blocked_address",
      });
    });

    it("localhost DNS ile çözülse de engellenir", async () => {
      const url = base.replace("127.0.0.1", "localhost");
      await expect(downloadFeed(`${url}/feed.xml`)).rejects.toMatchObject({
        code: "blocked_address",
      });
    });

    it("hata sınıfı FeedDownloadError", async () => {
      await expect(downloadFeed("http://169.254.169.254/latest/meta-data")).rejects.toBeInstanceOf(
        FeedDownloadError,
      );
    });

    it.each([
      ["127.0.0.1", true],
      ["10.1.2.3", true],
      ["172.16.0.1", true],
      ["192.168.1.1", true],
      ["169.254.169.254", true],
      ["100.64.0.1", true],
      ["0.0.0.0", true],
      ["::1", true],
      ["fe80::1", true],
      ["fd00::1", true],
      ["::ffff:127.0.0.1", true],
      ["not-an-ip", true],
      ["8.8.8.8", false],
      ["185.12.1.1", false],
      ["2606:4700::1111", false],
    ])("isBlockedAddress(%s) = %s", (ip, blocked) => {
      expect(isBlockedAddress(ip)).toBe(blocked);
    });
  });
});
