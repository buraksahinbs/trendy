import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter } from "./rate-limiter.js";

describe("InMemoryRateLimiter", () => {
  it("pencere dolunca en eski kaydın düşeceği ana kadar bekletir", async () => {
    let now = 0;
    const l = new InMemoryRateLimiter(() => now);
    expect(await l.reserve("k", 2, 1000)).toBe(0);
    now = 400;
    expect(await l.reserve("k", 2, 1000)).toBe(0);
    expect(await l.reserve("k", 2, 1000)).toBe(600);
    now = 1001;
    expect(await l.reserve("k", 2, 1000)).toBe(0);
    expect(await l.reserve("k", 2, 1000)).toBe(399);
  });

  it("anahtarlar birbirinden bağımsız", async () => {
    const l = new InMemoryRateLimiter(() => 0);
    expect(await l.reserve("a", 1, 1000)).toBe(0);
    expect(await l.reserve("b", 1, 1000)).toBe(0);
    expect(await l.reserve("a", 1, 1000)).toBe(1000);
  });
});
