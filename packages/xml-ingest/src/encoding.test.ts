import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import { decodeStream, detectEncoding, type DecodeOptions, type DecodeStats } from "./encoding.js";

const TR = "ÇĞİÖŞÜçğıöşü";

async function decode(buf: Buffer, options: DecodeOptions = {}, chunkSize = 5) {
  async function* src() {
    for (let i = 0; i < buf.length; i += chunkSize) yield buf.subarray(i, i + chunkSize);
  }
  const stats: DecodeStats = { replacementChars: 0 };
  let text = "";
  for await (const s of decodeStream(src(), options, stats)) text += s;
  return { text, stats };
}

describe("detectEncoding", () => {
  it.each([
    [`<?xml version="1.0" encoding="windows-1254"?>`, "windows-1254"],
    [`<?xml version='1.0' encoding='ISO-8859-9'?>`, "iso-8859-9"],
    [`  <?xml version="1.0" encoding="UTF-8"?>`, "utf-8"],
  ])("%s", (decl, expected) => {
    expect(detectEncoding(Buffer.from(decl)).encoding).toBe(expected);
  });

  it("desteklenmeyen kodlamayı bildirir ama seçmez", () => {
    expect(detectEncoding(Buffer.from(`<?xml version="1.0" encoding="shift_jis"?>`))).toEqual({
      declared: "shift_jis",
      bom: false,
    });
  });

  it("UTF-8 BOM", () => {
    expect(detectEncoding(Buffer.from([0xef, 0xbb, 0xbf, 0x3c]))).toEqual({
      bom: true,
      encoding: "utf-8",
    });
  });
});

describe("decodeStream", () => {
  it("windows-1254 deklarasyonunu uygular", async () => {
    const xml = `<?xml version="1.0" encoding="windows-1254"?><a>${TR}</a>`;
    const { text, stats } = await decode(iconv.encode(xml, "windows-1254"));
    expect(text).toContain(TR);
    expect(stats).toMatchObject({ encoding: "windows-1254", replacementChars: 0 });
  });

  it("UTF-8 çok byte'lı karakterler chunk sınırında bölünmez", async () => {
    const { text } = await decode(Buffer.from(`<a>${TR.repeat(5)}</a>`), {}, 3);
    expect(text).toBe(`<a>${TR.repeat(5)}</a>`);
  });

  it("deklarasyon yoksa fallback kullanılır", async () => {
    const { text, stats } = await decode(iconv.encode(`<a>${TR}</a>`, "iso-8859-9"), {
      fallback: "iso-8859-9",
    });
    expect(text).toBe(`<a>${TR}</a>`);
    expect(stats.encoding).toBe("iso-8859-9");
  });

  it("force deklarasyonu ezer; yanlış kodlama replacement sayısından anlaşılır", async () => {
    const buf = iconv.encode(`<?xml version="1.0" encoding="UTF-8"?><a>${TR}</a>`, "windows-1254");
    const wrong = await decode(buf);
    expect(wrong.stats.replacementChars).toBeGreaterThan(0);
    const right = await decode(buf, { force: "windows-1254" });
    expect(right.text).toContain(TR);
    expect(right.stats.replacementChars).toBe(0);
  });

  it("BOM metinden çıkarılır", async () => {
    const { text } = await decode(
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("<a/>")]),
    );
    expect(text).toBe("<a/>");
  });
});
