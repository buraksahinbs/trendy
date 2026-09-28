import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSecretBox } from "./crypto.js";
import { EnvError, loadEnv, secretBoxFromEnv } from "./env.js";

const key = randomBytes(32).toString("base64");
const valid = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  SECRETS_ENCRYPTION_KEY: key,
  TRENDYOL_INTEGRATOR_NAME: "SelfIntegration",
};

describe("loadEnv", () => {
  it("geçerli değerleri varsayılanlarla döner", () => {
    const env = loadEnv(valid);
    expect(env).toMatchObject({
      NODE_ENV: "development",
      LOG_LEVEL: "info",
      SECRETS_ENCRYPTION_KEY_VERSION: 1,
      SECRETS_ENCRYPTION_PREVIOUS_KEYS: {},
    });
  });

  it("eksik ve hatalı değerleri tek hatada toplar, değerleri mesaja yazmaz", () => {
    try {
      loadEnv({
        ...valid,
        DATABASE_URL: "mysql://x",
        SECRETS_ENCRYPTION_KEY: "c2hvcnQ=",
        TRENDYOL_INTEGRATOR_NAME: "Firma Adı!",
        REDIS_URL: undefined,
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      const issues = (e as EnvError).issues.join("\n");
      for (const name of [
        "DATABASE_URL",
        "REDIS_URL",
        "SECRETS_ENCRYPTION_KEY",
        "TRENDYOL_INTEGRATOR_NAME",
      ]) {
        expect(issues).toContain(name);
      }
      expect(issues).not.toContain("c2hvcnQ=");
    }
  });

  it("eski anahtarları ayrıştırır ve rotasyonlu SecretBox kurar", () => {
    const oldKey = randomBytes(32).toString("base64");
    const legacy = createSecretBox({ 1: oldKey }, 1).encrypt("s", "c");
    const env = loadEnv({
      ...valid,
      SECRETS_ENCRYPTION_KEY_VERSION: "2",
      SECRETS_ENCRYPTION_PREVIOUS_KEYS: `1:${oldKey}`,
    });
    const box = secretBoxFromEnv(env);
    expect(box.currentVersion).toBe(2);
    expect(box.decrypt(legacy, "c")).toBe("s");
  });

  it.each(["abc", "0:x", `1:${"a".repeat(8)}`])("hatalı eski anahtar reddedilir: %j", (v) => {
    expect(() => loadEnv({ ...valid, SECRETS_ENCRYPTION_PREVIOUS_KEYS: v })).toThrow(EnvError);
  });
});
