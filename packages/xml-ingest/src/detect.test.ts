import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectFeed, detectFeedFromUrl } from "./detect.js";
import { XmlParseError } from "./parser.js";

async function* chunks(...parts: string[]) {
  yield* parts;
}

const feed = `<?xml version="1.0"?>
<Katalog><Bilgi><Tarih>2026</Tarih></Bilgi><Urunler>
${Array.from({ length: 30 }, (_, i) => `<Urun id="${i}"><StokKodu>S${i}</StokKodu><Marka>M</Marka><Ad>Ürün ${i}</Ad></Urun>`).join("")}
</Urunler></Katalog>`;

describe("detectFeed", () => {
  it("ürün yolunu ve kimlik alanlarını önerir", async () => {
    const d = await detectFeed(chunks(feed));
    expect(d.itemPath).toBe("/Katalog/Urunler/Urun");
    expect(d.itemPaths[0]).toEqual({ path: "/Katalog/Urunler/Urun", count: 30 });
    expect(
      d.idFields
        .map((f) => f.path)
        .slice(0, 2)
        .sort(),
    ).toEqual(["@id", "StokKodu"]);
    expect(d.sampleItems).toHaveLength(3);
    expect(d.sampleCount).toBe(30);
  });

  it("verilen ürün yolunu kullanır", async () => {
    const d = await detectFeed(chunks(feed), { itemPath: "/Katalog/Bilgi" });
    expect(d.itemPath).toBe("/Katalog/Bilgi");
    expect(d.sampleCount).toBe(1);
  });

  it("yalnızca başı okunan büyük dosyada sondaki yarım düğümü tolere eder", async () => {
    const d = await detectFeed(chunks(feed.slice(0, 1200), feed.slice(1200)), { maxChars: 1000 });
    expect(d.sampleCount).toBeGreaterThan(0);
  });

  it("bozuk XML hatası iletilir", async () => {
    await expect(detectFeed(chunks("<a><b></a>"))).rejects.toBeInstanceOf(XmlParseError);
  });

  it("ürün bulunamazsa boş öneri döner", async () => {
    const d = await detectFeed(chunks("<a>metin</a>"));
    expect(d).toMatchObject({ itemPath: null, sampleCount: 0, idFields: [] });
  });
});

describe("detectFeedFromUrl", () => {
  let server: http.Server;
  let base: string;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.headers.authorization !== `Basic ${Buffer.from("u:p").toString("base64")}`) {
        res.writeHead(401).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/xml" }).end(feed);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it("indirir ve analiz eder", async () => {
    const d = await detectFeedFromUrl(`${base}/feed.xml`, {
      headers: { authorization: `Basic ${Buffer.from("u:p").toString("base64")}` },
      allowPrivateNetwork: true,
    });
    expect(d.sampleCount).toBe(30);
  });

  it("yerel adresleri varsayılan olarak reddeder (SSRF)", async () => {
    await expect(detectFeedFromUrl(`${base}/feed.xml`)).rejects.toMatchObject({
      code: "blocked_address",
    });
  });
});
