import { describe, expect, it } from "vitest";
import { decodeStream } from "./encoding.js";
import { parseItems } from "./parser.js";

/** 100.000 ürünlük (~100 MB) sentetik feed'i parça parça üretir; hiçbir zaman tamamı bellekte değil. */
async function* syntheticFeed(count: number): AsyncGenerator<Buffer> {
  yield Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Urunler>`);
  const desc = "Açıklama ".repeat(90);
  let batch = "";
  for (let i = 0; i < count; i++) {
    batch += `<Urun><Kod>K${i}</Kod><Barkod>869${String(i).padStart(10, "0")}</Barkod><Ad>Ürün ${i}</Ad><Aciklama><![CDATA[${desc}]]></Aciklama><Stok>${i % 50}</Stok></Urun>`;
    if (i % 100 === 99) {
      yield Buffer.from(batch);
      batch = "";
    }
  }
  yield Buffer.from(batch + "</Urunler>");
}

describe("yük testi", () => {
  it("100.000 ürünü sabit bellekle işler", { timeout: 60_000 }, async () => {
    const start = process.memoryUsage().heapUsed;
    let peak = start;
    let count = 0;
    let lastCode = "";
    for await (const item of parseItems(decodeStream(syntheticFeed(100_000)), {
      itemPath: "/Urunler/Urun",
    })) {
      count++;
      if (typeof item !== "string") lastCode = item.Kod as string;
      if (count % 1000 === 0) peak = Math.max(peak, process.memoryUsage().heapUsed);
    }
    expect(count).toBe(100_000);
    expect(lastCode).toBe("K99999");
    // Feed ~100 MB; tamamı tutulsaydı heap bunun katları kadar büyürdü.
    expect(peak - start).toBeLessThan(80 * 1024 * 1024);
  });
});
