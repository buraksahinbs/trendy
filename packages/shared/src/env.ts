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

const optionalFlag = z.preprocess(
  (v) => (v === "" || v === undefined ? undefined : v === "true" || v === "1"),
  z.boolean().optional(),
);

// Düz nesne kalmalı: migration CLI `.pick()` ile yalnızca gereken alanları kullanır.
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
  /** Ters proxy arkasında: "true" veya güvenilen proxy adresleri (virgülle). Boş = kapalı. */
  TRUST_PROXY: z.preprocess((v) => (v === "" ? undefined : v), z.string().max(500).optional()),
  /** Dışarıdan erişilen API adresi (sipariş webhook URL'si). "trendyol"/"dolap"/"localhost" içermemeli. */
  // .env dosyasında boş bırakılırsa tanımsız sayılır.
  PUBLIC_BASE_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .url({ protocol: /^https$/, message: "https adresi olmalı" })
      .refine(
        (u) => !/trendyol|dolap|localhost/i.test(u),
        "Adres trendyol, dolap veya localhost içeremez",
      )
      .optional(),
  ),
  /** Yalnızca geliştirme/test: Trendyol yerine sahte sunucu adresi. Üretimde yasak. */
  TRENDYOL_BASE_URL: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),
  /** Yalnızca geliştirme/test: yerel ağdaki XML feed'lerine izin (SSRF koruması kapanır). Üretimde yasak. */
  FEED_ALLOW_PRIVATE_NETWORK: optionalFlag,
});

/** Yalnızca geliştirme/test için olan yönlendirmeler üretimde açılamaz. */
const runtimeEnvSchema = envSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV !== "production") return;
  for (const key of ["TRENDYOL_BASE_URL", "FEED_ALLOW_PRIVATE_NETWORK"] as const) {
    if (env[key]) ctx.addIssue({ code: "custom", path: [key], message: "üretimde kullanılamaz" });
  }
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
  const result = runtimeEnvSchema.safeParse(source);
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
