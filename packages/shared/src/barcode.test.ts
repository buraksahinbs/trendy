import { describe, expect, it } from "vitest";
import { normalizeBarcode } from "./barcode.js";

describe("normalizeBarcode", () => {
  it.each([
    ["8690000000001", "8690000000001"],
    ["  869 000 000 0001 ", "8690000000001"],
    ["ABC-12.3_x", "ABC-12.3_x"],
    ["a\tb\nc", "abc"],
  ])("%j -> %j", (raw, expected) => {
    expect(normalizeBarcode(raw)).toEqual({ ok: true, barcode: expected });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["x".repeat(41), "too_long"],
    ["ABC/123", "invalid_chars"],
    ["ÇİĞ123", "invalid_chars"],
    ["A+B", "invalid_chars"],
  ])("%j geçersiz: %s", (raw, issue) => {
    expect(normalizeBarcode(raw)).toMatchObject({ ok: false, issue });
  });

  it("tam 40 karakter kabul edilir", () => {
    expect(normalizeBarcode("x".repeat(40)).ok).toBe(true);
  });
});
