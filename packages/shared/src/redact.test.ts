import { describe, expect, it } from "vitest";
import { REDACTED, redact } from "./redact.js";

describe("redact", () => {
  it("gizli alanları iç içe yapılarda da maskeler", () => {
    expect(
      redact({
        headers: { Authorization: "Basic abc", "user-agent": "1 - X" },
        apiKey: "k",
        api_secret: "s",
        list: [{ password: "p", ok: 1 }],
        name: "a",
      }),
    ).toEqual({
      headers: { Authorization: REDACTED, "user-agent": "1 - X" },
      apiKey: REDACTED,
      api_secret: REDACTED,
      list: [{ password: REDACTED, ok: 1 }],
      name: "a",
    });
  });

  it("Error nesnesini mesajıyla korur, özel alanlarını maskeler", () => {
    const err = Object.assign(new TypeError("bozuk"), { apiKey: "k", status: 401 });
    expect(redact({ err })).toMatchObject({
      err: { type: "TypeError", message: "bozuk", apiKey: REDACTED, status: 401 },
    });
  });

  it("düz olmayan nesneleri (Date, URL, sınıf örnekleri) bozmaz", () => {
    const at = new Date("2026-09-28T00:00:00Z");
    class Req {
      method = "GET";
    }
    const req = new Req();
    const out = redact({ at, url: new URL("https://example.com"), req, nested: { token: "t" } });
    expect(out.at).toBe(at);
    expect(out.req).toBe(req);
    expect(out.url.href).toBe("https://example.com/");
    expect(out.nested.token).toBe(REDACTED);
  });

  it("ilkel değerlere dokunmaz", () => {
    expect(redact("x")).toBe("x");
    expect(redact(null)).toBeNull();
  });
});
