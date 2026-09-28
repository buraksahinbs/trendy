import { describe, expect, it } from "vitest";
import { getAllAtPath } from "./fields.js";
import {
  applyTransforms,
  createReadinessIssues,
  mapItem,
  mappingConfigSchema,
  type MappingConfig,
} from "./mapping.js";

const flat = (patch: Partial<MappingConfig> = {}): MappingConfig =>
  mappingConfigSchema.parse({
    version: 1,
    variantMode: "flat",
    fields: {
      productMainId: { path: "ModelKodu" },
      title: { path: "Ad" },
      description: { path: "Aciklama", transforms: [{ type: "strip_html" }] },
      brandName: { path: "Marka" },
      sourceCategory: { path: "Kategori" },
      vatRate: { constant: "20" },
      barcode: { path: "Barkod" },
      stockCode: { path: "StokKodu" },
      stock: { path: "Stok" },
      costPrice: { path: "Fiyat" },
      currency: { path: "Fiyat.@birim" },
    },
    images: [{ path: "Resimler.Resim" }],
    attributes: [
      { name: "Renk", mapping: { path: "Renk" } },
      { name: "Beden", mapping: { path: "Beden" } },
    ],
    ...patch,
  });

const item = {
  ModelKodu: "M-1",
  Ad: "Pamuklu Tişört",
  Aciklama: "<p>Yumuşak &amp; rahat</p><br/>kumaş",
  Marka: "Markam",
  Kategori: "Giyim > Tişört",
  Barkod: " 869 000 000 0001 ",
  StokKodu: "S-1",
  Stok: "12",
  Fiyat: { "@birim": "TL", "#text": "1.234,50" },
  Renk: "Kırmızı",
  Beden: "M",
  Resimler: { Resim: ["https://cdn.example.com/1.jpg", "https://cdn.example.com/2.jpg"] },
};

describe("getAllAtPath", () => {
  it("tekrarlanan elemanları açar, boşları atlar", () => {
    expect(getAllAtPath({ A: [{ B: "1" }, { B: ["2", " "] }, { C: "x" }] }, "A.B")).toEqual([
      "1",
      "2",
    ]);
    expect(getAllAtPath(item, "Fiyat")).toEqual(["1.234,50"]);
    expect(getAllAtPath(item, "Yok")).toEqual([]);
  });
});

describe("applyTransforms", () => {
  it.each([
    [" a ", [{ type: "trim" }], "a"],
    ["ılık", [{ type: "upper" }], "ILIK"],
    ["İSTANBUL", [{ type: "lower" }], "istanbul"],
    ["<b>a</b>&nbsp;&lt;b&gt;", [{ type: "strip_html" }], "a <b>"],
    ["a-b-a", [{ type: "replace", find: "a", replace: "x" }], "x-b-x"],
    ["Giyim > Tişört > Basic", [{ type: "split", separator: " > ", index: -1 }], "Basic"],
    ["var", [{ type: "map", values: { Var: "10", Yok: "0" } }], "10"],
    ["belirsiz", [{ type: "map", values: { Var: "10" }, default: "0" }], "0"],
    [
      "1.jpg",
      [{ type: "prefix", value: "https://cdn.example.com/" }],
      "https://cdn.example.com/1.jpg",
    ],
    [undefined, [{ type: "default", value: "20" }], "20"],
    ["   ", [{ type: "default", value: "20" }], "20"],
    ["a", [{ type: "split", separator: ",", index: 3 }], undefined],
  ] as const)("%j %j -> %j", (input, transforms, expected) => {
    expect(applyTransforms(input, transforms as never)).toBe(expected);
  });
});

describe("mappingConfigSchema", () => {
  it("path ve constant birlikte veya hiçbiri olmadan reddedilir", () => {
    const bad = {
      version: 1,
      variantMode: "flat",
      fields: { barcode: { path: "B", constant: "x" }, stock: { path: "S" } },
    };
    expect(mappingConfigSchema.safeParse(bad).success).toBe(false);
    const none = { version: 1, variantMode: "flat", fields: { barcode: {}, stock: { path: "S" } } };
    expect(mappingConfigSchema.safeParse(none).success).toBe(false);
  });

  it("barkod ve stok zorunlu; nested modda variantPath zorunlu", () => {
    expect(
      mappingConfigSchema.safeParse({
        version: 1,
        variantMode: "flat",
        fields: { stock: { path: "S" } },
      }).success,
    ).toBe(false);
    expect(
      mappingConfigSchema.safeParse({
        version: 1,
        variantMode: "nested",
        fields: { barcode: { path: "B" }, stock: { path: "S" } },
      }).success,
    ).toBe(false);
  });

  it("regex dönüşümü desteklenmez (ReDoS)", () => {
    const cfg = {
      version: 1,
      variantMode: "flat",
      fields: {
        barcode: { path: "B", transforms: [{ type: "regex", pattern: "(a+)+$" }] },
        stock: { path: "S" },
      },
    };
    expect(mappingConfigSchema.safeParse(cfg).success).toBe(false);
  });

  it("missingPolicy varsayılanı zero_stock", () => {
    expect(flat().missingPolicy).toBe("zero_stock");
  });
});

describe("mapItem — flat", () => {
  it("tüm alanları kanonik modele çevirir", () => {
    const { product, issues } = mapItem(item, "EXT-1", flat());
    expect(issues).toEqual([]);
    expect(product).toEqual({
      productMainId: "M-1",
      title: "Pamuklu Tişört",
      description: "Yumuşak & rahat kumaş",
      brandName: "Markam",
      sourceCategory: "Giyim > Tişört",
      vatRate: 20,
      origin: null,
      desi: null,
      variants: [
        {
          barcode: "8690000000001",
          stockCode: "S-1",
          stock: 12,
          costPrice: 123450,
          currency: "TRY",
          attributes: { Renk: "Kırmızı", Beden: "M" },
          images: ["https://cdn.example.com/1.jpg", "https://cdn.example.com/2.jpg"],
        },
      ],
    });
    expect(createReadinessIssues(product!)).toEqual([]);
  });

  it("model kodu yoksa dış kimlik kullanılır", () => {
    const { product } = mapItem({ ...item, ModelKodu: "" }, "EXT-1", flat());
    expect(product!.productMainId).toBe("EXT-1");
  });

  it.each([
    [{ Barkod: "" }, "barcode", "missing"],
    [{ Barkod: "ABC/123" }, "barcode", "invalid_chars"],
    [{ Barkod: "x".repeat(41) }, "barcode", "too_long"],
    [{ Stok: "" }, "stock", "missing"],
    [{ Stok: "bol" }, "stock", "invalid"],
    [{ Stok: "-3" }, "stock", "invalid"],
    [{ Fiyat: { "@birim": "Altın", "#text": "10" } }, "currency", "invalid"],
  ])("geçersiz varyant atlanır: %j", (patch, field, code) => {
    const { product, issues } = mapItem({ ...item, ...patch }, "E", flat());
    expect(product).toBeNull();
    expect(issues).toContainEqual(expect.objectContaining({ level: "error", field, code }));
  });

  it("ondalıklı stok aşağı yuvarlanır; Türkçe sayı biçimi", () => {
    expect(mapItem({ ...item, Stok: "3,9" }, "E", flat()).product!.variants[0]!.stock).toBe(3);
    expect(mapItem({ ...item, Stok: "1.500" }, "E", flat()).product!.variants[0]!.stock).toBe(1500);
    expect(mapItem({ ...item, Stok: "1,500" }, "E", flat()).product!.variants[0]!.stock).toBe(1500);
    expect(mapItem({ ...item, Stok: "12.000.000" }, "E", flat()).product!.variants[0]!.stock).toBe(
      12_000_000,
    );
    expect(mapItem({ ...item, Stok: "0" }, "E", flat()).product!.variants[0]!.stock).toBe(0);
  });

  it("uyarılar: uzun başlık kısaltılır, geçersiz KDV ve maliyet, uzun renk, fazla görsel", () => {
    const cfg = flat({
      fields: { ...flat().fields, vatRate: { path: "KDV" } },
    });
    const { product, issues } = mapItem(
      {
        ...item,
        Ad: "x".repeat(150),
        KDV: "18",
        Fiyat: "yok",
        Renk: "r".repeat(60),
        Resimler: { Resim: Array.from({ length: 10 }, (_, i) => `https://c.example.com/${i}.jpg`) },
      },
      "E",
      cfg,
    );
    expect(product!.title).toHaveLength(100);
    expect(product!.vatRate).toBeNull();
    expect(product!.variants[0]!.costPrice).toBeNull();
    expect(product!.variants[0]!.images).toHaveLength(8);
    const codes = issues.map((i) => `${i.field}:${i.code}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        "title:truncated",
        "vatRate:invalid",
        "costPrice:invalid",
        "attributes.Renk:too_long",
        "images:too_many",
      ]),
    );
    expect(issues.every((i) => i.level === "warning")).toBe(true);
    expect(createReadinessIssues(product!)).toEqual(
      expect.arrayContaining(["vatRate", "costPrice"]),
    );
  });

  it("para birimi eşleşmemişse TRY; USD tanınır", () => {
    const withoutCurrency = { ...flat().fields };
    delete withoutCurrency.currency;
    const noCur = flat({ fields: withoutCurrency });
    expect(mapItem(item, "E", noCur).product!.variants[0]!.currency).toBe("TRY");
    const usd = mapItem({ ...item, Fiyat: { "@birim": "usd", "#text": "12.5" } }, "E", flat());
    expect(usd.product!.variants[0]).toMatchObject({ currency: "USD", costPrice: 1250 });
  });

  it("https olmayan görsel yaratma hazırlığında raporlanır", () => {
    const { product } = mapItem(
      { ...item, Resimler: { Resim: "http://eski.example.com/1.jpg" } },
      "E",
      flat(),
    );
    expect(createReadinessIssues(product!)).toContain("images_https");
  });
});

describe("mapItem — nested", () => {
  const nested = mappingConfigSchema.parse({
    version: 1,
    variantMode: "nested",
    variantPath: "Varyantlar.Varyant",
    fields: {
      productMainId: { path: "@kod" },
      title: { path: "Ad" },
      barcode: { path: "@barkod" },
      stock: { path: "Stok" },
      costPrice: { path: "../Fiyat" },
    },
    images: [{ path: "../Resim" }],
    attributes: [{ name: "Beden", mapping: { path: "Beden" } }],
  });
  const node = {
    "@kod": "M-9",
    Ad: "Ayakkabı",
    Fiyat: "500",
    Resim: "https://c.example.com/a.jpg",
    Varyantlar: {
      Varyant: [
        { "@barkod": "B40", Beden: "40", Stok: "2" },
        { "@barkod": "B41", Beden: "41", Stok: "0" },
        { "@barkod": "B40", Beden: "40", Stok: "5" },
        { Beden: "42", Stok: "1" },
      ],
    },
  };

  it("varyantları açar, üst düğümden (../) alan okur; tekrarlanan ve barkodsuz varyant atlanır", () => {
    const { product, issues } = mapItem(node, "E", nested);
    expect(product!.productMainId).toBe("M-9");
    expect(product!.variants).toEqual([
      expect.objectContaining({
        barcode: "B40",
        stock: 2,
        costPrice: 50000,
        attributes: { Beden: "40" },
        images: ["https://c.example.com/a.jpg"],
      }),
      expect.objectContaining({ barcode: "B41", stock: 0 }),
    ]);
    expect(issues.map((i) => `${i.field}:${i.code}`)).toEqual([
      "barcode:duplicate",
      "barcode:missing",
    ]);
  });

  it("varyant listesi yoksa ürün üretilmez", () => {
    const { product, issues } = mapItem({ "@kod": "M" }, "E", nested);
    expect(product).toBeNull();
    expect(issues[0]!.code).toBe("no_variants");
  });

  it("tek varyantlı düğüm (dizi değil) de çalışır", () => {
    const single = { ...node, Varyantlar: { Varyant: { "@barkod": "B1", Stok: "1" } } };
    expect(mapItem(single, "E", nested).product!.variants).toHaveLength(1);
  });
});
