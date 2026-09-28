import { describe, expect, it } from "vitest";
import { parseItems, suggestItemPaths, XmlParseError } from "./parser.js";

async function* chunks(xml: string, size = 7): AsyncGenerator<string> {
  for (let i = 0; i < xml.length; i += size) yield xml.slice(i, i + size);
}

async function collect(xml: string, itemPath: string) {
  const out = [];
  for await (const item of parseItems(chunks(xml), { itemPath })) out.push(item);
  return out;
}

describe("parseItems", () => {
  it("düz ürün düğümlerini JSON'a çevirir (chunk sınırları önemsiz)", async () => {
    const xml = `<?xml version="1.0"?>
      <Urunler>
        <Urun><Kod>A1</Kod><Ad>Tişört</Ad><Fiyat>199,90</Fiyat></Urun>
        <Urun><Kod>A2</Kod><Ad>Şort</Ad><Fiyat>149,90</Fiyat></Urun>
      </Urunler>`;
    expect(await collect(xml, "/Urunler/Urun")).toEqual([
      { Kod: "A1", Ad: "Tişört", Fiyat: "199,90" },
      { Kod: "A2", Ad: "Şort", Fiyat: "149,90" },
    ]);
  });

  it("attribute, CDATA, tekrarlanan elemanlar ve iç içe varyantlar", async () => {
    const xml = `<root><products><product id="10">
      <name><![CDATA[Elbise <b>yeni</b>]]></name>
      <images><img>https://x/1.jpg</img><img>https://x/2.jpg</img></images>
      <variants>
        <variant barcode="111"><size>S</size><stock>3</stock></variant>
        <variant barcode="222"><size>M</size><stock>0</stock></variant>
      </variants>
      <price currency="USD">12.5</price>
      <empty/>
    </product></products></root>`;
    expect(await collect(xml, "root/products/product")).toEqual([
      {
        "@id": "10",
        name: "Elbise <b>yeni</b>",
        images: { img: ["https://x/1.jpg", "https://x/2.jpg"] },
        variants: {
          variant: [
            { "@barcode": "111", size: "S", stock: "3" },
            { "@barcode": "222", size: "M", stock: "0" },
          ],
        },
        price: { "@currency": "USD", "#text": "12.5" },
        empty: "",
      },
    ]);
  });

  it("entity'leri çözer", async () => {
    expect(await collect("<a><b>x &amp; y &#199;</b></a>", "/a/b")).toEqual(["x & y Ç"]);
  });

  it("yol eşleşmezse ürün üretmez", async () => {
    expect(await collect("<a><b>1</b></a>", "/a/c")).toEqual([]);
  });

  it("bozuk XML'de satır bilgili hata verir", async () => {
    await expect(collect("<a><b>1</c></a>", "/a/b")).rejects.toBeInstanceOf(XmlParseError);
  });

  it("XXE: harici entity çözülmez", async () => {
    const xml = `<?xml version="1.0"?>
      <!DOCTYPE a [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
      <a><b>&xxe;</b></a>`;
    await expect(collect(xml, "/a/b")).rejects.toThrow(XmlParseError);
  });

  it("billion laughs: entity genişletilmez", async () => {
    const defs = Array.from(
      { length: 9 },
      (_, i) => `<!ENTITY lol${i + 1} "${`&lol${i};`.repeat(10)}">`,
    ).join("");
    const xml = `<!DOCTYPE a [<!ENTITY lol0 "lol">${defs}]><a><b>&lol9;</b></a>`;
    await expect(collect(xml, "/a/b")).rejects.toThrow(XmlParseError);
  });

  it("aşırı derin ürün düğümünü reddeder", async () => {
    const deep = "<x>".repeat(40) + "</x>".repeat(40);
    const out = parseItems(chunks(`<a><b>${deep}</b></a>`), { itemPath: "/a/b" });
    await expect(async () => {
      for await (const _ of out) void _;
    }).rejects.toThrow(/derin/);
  });
});

describe("suggestItemPaths", () => {
  it("en çok tekrarlanan ürün düğümünü önerir", async () => {
    const items = Array.from(
      { length: 5 },
      (_, i) => `<Urun><Kod>${i}</Kod><Resimler><R>a</R><R>b</R></Resimler></Urun>`,
    ).join("");
    const result = await suggestItemPaths(chunks(`<Urunler>${items}</Urunler>`));
    expect(result[0]).toEqual({ path: "/Urunler/Urun", count: 5 });
  });
});
