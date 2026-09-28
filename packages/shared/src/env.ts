import { z } from "zod";
import { createSecretBox, type SecretBox } from "./crypto.js";

/**
 * Ortam değişkenleri şeması (ROADMAP Faz 1). Uygulama açılışında bir kez doğrulanır;
 * eksik veya hatalı değer varsa süreç başlamadan anlaşılır bir hatayla durur.
 */
const base64Key = z
  .string()
  .refine((s) => Buffer.from(s, "base64").length === 32, "32 baytlık base64 anahtar olmalı");

/** "1:base64,2:base64" biçimindeki eski anahtarlar (rotasyon için). */
const previousKeys = z
  .string()
  .default("")
  .transform((s, ctx) => {
    const out: Record<number, string> = {};
    for (const part of s
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)) {
      const idx = part.indexOf(":");
      const version = Number(part.slice(0, idx));
      const key = part.slice(idx + 1);
      if (idx < 1 || !Number.isInteger(version) || version < 1) {
        ctx.addIssue({ code: "custom", message: "Biçim: sürüm:base64anahtar" });
        return z.NEVER;
      }
      if (Buffer.from(key, "base64").length !== 32) {
        ctx.addIssue({ code: "custom", message: `v${version} anahtarı 32 bayt olmalı` });
        return z.NEVER;
      }
      out[version] = key;
    }
    return out;
  });

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  SECRETS_ENCRYPTION_KEY: base64Key,
  SECRETS_ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).default(1),
  SECRETS_ENCRYPTION_PREVIOUS_KEYS: previousKeys,
  TRENDYOL_INTEGRATOR_NAME: z
    .string()
    .regex(/^[A-Za-z0-9]{1,30}$/, "alfanümerik ve en fazla 30 karakter olmalı"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(readonly issues: string[]) {
    super(`Ortam değişkenleri geçersiz:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "EnvError";
  }
}

/** Hata mesajları değerleri içermez; yalnızca değişken adı ve kural yazılır. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map((i) => `${i.path.join(".") || "(kök)"}: ${i.message}`),
    );
  }
  return result.data;
}

export function secretBoxFromEnv(env: Env): SecretBox {
  return createSecretBox(
    {
      ...env.SECRETS_ENCRYPTION_PREVIOUS_KEYS,
      [env.SECRETS_ENCRYPTION_KEY_VERSION]: env.SECRETS_ENCRYPTION_KEY,
    },
    env.SECRETS_ENCRYPTION_KEY_VERSION,
  );
}
