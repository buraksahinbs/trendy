import { describe, expect, it } from "vitest";
import { isDue, nextRunAfter, validateFetchCron } from "./schedule.js";

describe("validateFetchCron", () => {
  it.each([
    "*/15 * * * *",
    "*/30 * * * *",
    "0 * * * *",
    "0 */6 * * *",
    "0 3 * * *",
    "0,30 9-18 * * 1-5",
  ])("geçerli: %s", (expr) => {
    expect(validateFetchCron(expr)).toEqual({ ok: true });
  });

  it.each([
    ["* * * * *", /15 dakika/],
    ["*/5 * * * *", /15 dakika/],
    ["0,10 * * * *", /15 dakika/],
    ["* * * * * *", /5 alanlı/],
    ["0 3 * *", /5 alanlı/],
    ["bozuk ifade x y z", /Geçersiz/],
    ["61 * * * *", /Geçersiz/],
  ])("geçersiz: %s", (expr, message) => {
    const r = validateFetchCron(expr);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(message);
  });
});

describe("zamanlama", () => {
  it("Türkiye saatine göre hesaplar", () => {
    // 03:00 TR = 00:00 UTC
    expect(nextRunAfter("0 3 * * *", new Date("2026-09-28T10:00:00Z")).toISOString()).toBe(
      "2026-09-29T00:00:00.000Z",
    );
  });

  it("isDue: son çalışmadan sonraki zaman geldiyse true", () => {
    const last = new Date("2026-09-28T10:00:00Z");
    expect(isDue("*/30 * * * *", last, new Date("2026-09-28T10:29:59Z"))).toBe(false);
    expect(isDue("*/30 * * * *", last, new Date("2026-09-28T10:30:00Z"))).toBe(true);
    // Worker uzun süre kapalı kaldıysa da yalnızca "zamanı geldi" der; birikme yok.
    expect(isDue("*/30 * * * *", last, new Date("2026-09-29T10:00:00Z"))).toBe(true);
  });
});
