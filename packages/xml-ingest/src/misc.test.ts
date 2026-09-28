import { describe, expect, it } from "vitest";
import { contentHash, stableStringify } from "./hash.js";
import { checkFeedShrink } from "./shrink.js";

describe("contentHash", () => {
  it("anahtar sırasından bağımsızdır", () => {
    expect(contentHash({ a: 1, b: { c: [1, 2], d: "x" } })).toBe(
      contentHash({ b: { d: "x", c: [1, 2] }, a: 1 }),
    );
  });

  it("içerik değişince değişir", () => {
    expect(contentHash({ a: "1" })).not.toBe(contentHash({ a: "2" }));
    expect(contentHash([1, 2])).not.toBe(contentHash([2, 1]));
  });

  it("undefined alanları yok sayar", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe("checkFeedShrink", () => {
  it.each([
    [0, 0, true],
    [0, 100, true],
    [100, 100, true],
    [100, 120, true],
    [100, 50, true],
    [100, 49, false],
    [100, 0, false],
  ])("önceki %d, şimdi %d → izin: %s", (previousCount, currentCount, allowed) => {
    expect(checkFeedShrink({ previousCount, currentCount }).allowed).toBe(allowed);
  });

  it("boş feed ayrı sebeple raporlanır", () => {
    expect(checkFeedShrink({ previousCount: 10, currentCount: 0 })).toEqual({
      allowed: false,
      dropRate: 1,
      reason: "empty_feed",
    });
  });
});
