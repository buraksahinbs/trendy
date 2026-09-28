import { describe, expect, it } from "vitest";
import { getAtPath, suggestIdFields } from "./fields.js";

const item = {
  "@id": "10",
  Kod: " A-1 ",
  Fiyat: { "@currency": "USD", "#text": "12.5" },
  Kimlik: { Barkod: "869", Diger: { x: "y" } },
  Resim: ["r1.jpg", "r2.jpg"],
  Bos: "",
};

describe("getAtPath", () => {
  it.each([
    ["@id", "10"],
    ["Kod", "A-1"],
    ["Fiyat", "12.5"],
    ["Fiyat.@currency", "USD"],
    ["Kimlik.Barkod", "869"],
    ["Resim", "r1.jpg"],
    ["Bos", undefined],
    ["Yok", undefined],
    ["Kod.Alt", undefined],
    ["Kimlik.Diger", undefined],
  ])("%s -> %j", (path, expected) => {
    expect(getAtPath(item, path)).toBe(expected);
  });

  it("düz metin öğede undefined döner", () => {
    expect(getAtPath("metin", "x")).toBeUndefined();
  });
});

describe("suggestIdFields", () => {
  it("her üründe olan ve benzersiz alanları önerir; kimlik adlarını öne alır", () => {
    const items = [
      { "@id": "1", StokKodu: "S1", Marka: "X", Ad: "Ürün 1", Detay: { Barkod: "B1" } },
      { "@id": "2", StokKodu: "S2", Marka: "X", Ad: "Ürün 2", Detay: { Barkod: "B2" } },
      { "@id": "3", StokKodu: "S3", Marka: "Y", Ad: "Ürün 3", Detay: { Barkod: "B3" } },
    ];
    const paths = suggestIdFields(items).map((s) => s.path);
    expect(paths.slice(0, 3).sort()).toEqual(["@id", "Detay.Barkod", "StokKodu"].sort());
    expect(paths).toContain("Ad");
    expect(paths).not.toContain("Marka");
    expect(suggestIdFields(items)[0]!.samples).toHaveLength(3);
  });

  it("bazı üründe eksik olan alanı önermez", () => {
    const paths = suggestIdFields([{ Kod: "1", Id: "a" }, { Kod: "2" }]).map((s) => s.path);
    expect(paths).toEqual(["Kod"]);
  });

  it("ürün yoksa boş döner", () => {
    expect(suggestIdFields([])).toEqual([]);
    expect(suggestIdFields(["metin"])).toEqual([]);
  });
});
