import { describe, expect, it } from "vitest";
import { parseAmount, toKurus } from "./money.js";

describe("parseAmount", () => {
  it.each([
    ["1234,56", 1234.56],
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["1234.56", 1234.56],
    ["1.234.567", 1234567],
    ["  99,90 TL", 99.9],
    ["₺12", 12],
    ["0", 0],
  ])("%j -> %d", (raw, expected) => {
    expect(parseAmount(raw)).toBe(expected);
  });

  it.each(["", "abc", "12a", "1,2,3"])("%j -> null", (raw) => {
    expect(parseAmount(raw)).toBeNull();
  });
});

describe("toKurus", () => {
  it("kayan nokta hatasını yuvarlar", () => {
    expect(toKurus(0.1 + 0.2)).toBe(30);
    expect(toKurus(19.99)).toBe(1999);
  });

  it("NaN ve sonsuzu reddeder", () => {
    expect(() => toKurus(NaN)).toThrow(RangeError);
    expect(() => toKurus(Infinity)).toThrow(RangeError);
  });
});
