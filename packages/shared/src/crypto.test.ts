import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSecretBox, SecretDecryptionError } from "./crypto.js";

const k1 = randomBytes(32).toString("base64");
const k2 = randomBytes(32).toString("base64");
const ctx = "tenant:1:trendyol_api_secret";

describe("createSecretBox", () => {
  it("şifreler ve çözer; aynı metin her seferinde farklı şifrelenir", () => {
    const box = createSecretBox({ 1: k1 }, 1);
    const a = box.encrypt("gizli-değer ğüşiöç", ctx);
    const b = box.encrypt("gizli-değer ğüşiöç", ctx);
    expect(a).not.toBe(b);
    expect(a.startsWith("v1:")).toBe(true);
    expect(a).not.toContain("gizli");
    expect(box.decrypt(a, ctx)).toBe("gizli-değer ğüşiöç");
  });

  it("boş metni destekler", () => {
    const box = createSecretBox({ 1: k1 }, 1);
    expect(box.decrypt(box.encrypt("", ctx), ctx)).toBe("");
  });

  it("farklı bağlamla (başka tenant) çözülemez", () => {
    const box = createSecretBox({ 1: k1 }, 1);
    const enc = box.encrypt("s", ctx);
    expect(() => box.decrypt(enc, "tenant:2:trendyol_api_secret")).toThrow(SecretDecryptionError);
  });

  it("değiştirilmiş şifreli metni reddeder", () => {
    const box = createSecretBox({ 1: k1 }, 1);
    const enc = box.encrypt("secret-value", ctx);
    const parts = enc.split(":");
    const data = Buffer.from(parts[3]!, "base64url");
    data[0]! ^= 1;
    parts[3] = data.toString("base64url");
    expect(() => box.decrypt(parts.join(":"), ctx)).toThrow(SecretDecryptionError);
  });

  it.each(["", "abc", "v1:a:b", "vx:a:b:c", "v1:AAAA:AAAA:AAAA"])(
    "bozuk biçim reddedilir: %j",
    (bad) => {
      const box = createSecretBox({ 1: k1 }, 1);
      expect(() => box.decrypt(bad, ctx)).toThrow(SecretDecryptionError);
    },
  );

  it("anahtar rotasyonu: eski sürüm çözülür, yeni kayıtlar güncel sürümle şifrelenir", () => {
    const old = createSecretBox({ 1: k1 }, 1);
    const legacy = old.encrypt("eski", ctx);

    const rotated = createSecretBox({ 1: k1, 2: k2 }, 2);
    expect(rotated.decrypt(legacy, ctx)).toBe("eski");
    expect(rotated.needsRotation(legacy)).toBe(true);
    const fresh = rotated.encrypt("eski", ctx);
    expect(fresh.startsWith("v2:")).toBe(true);
    expect(rotated.needsRotation(fresh)).toBe(false);
  });

  it("tanımsız sürüm çözülemez", () => {
    const enc = createSecretBox({ 2: k2 }, 2).encrypt("x", ctx);
    expect(() => createSecretBox({ 1: k1 }, 1).decrypt(enc, ctx)).toThrow(/v2 anahtarı/);
  });

  it("hatalı anahtar yapılandırmasını reddeder", () => {
    expect(() => createSecretBox({ 1: "kısa" }, 1)).toThrow(/32 bayt/);
    expect(() => createSecretBox({ 1: k1 }, 2)).toThrow(/v2/);
    expect(() => createSecretBox({ 0: k1 }, 0)).toThrow(/sürüm/);
  });

  it("hata mesajı anahtarı veya düz metni içermez", () => {
    const box = createSecretBox({ 1: k1 }, 1);
    const enc = box.encrypt("super-secret", ctx);
    try {
      box.decrypt(enc, "other");
    } catch (e) {
      expect(String(e)).not.toContain("super-secret");
      expect(String(e)).not.toContain(k1);
    }
  });
});
