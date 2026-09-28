import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Gizli bilgi şifreleme (ROADMAP Faz 1, §7): AES-256-GCM.
 *
 * Çıktı biçimi: `v{sürüm}:{iv}:{tag}:{şifreli metin}` (base64url). Sürüm alanı anahtar
 * rotasyonu içindir: yeni kayıtlar güncel anahtarla şifrelenir, eski kayıtlar kendi
 * sürümündeki anahtarla çözülür ve `needsRotation` ile yeniden şifrelenmek üzere bulunur.
 *
 * `context` (AAD) şifreli metni bağlamına bağlar (ör. `tenant:42:trendyol_api_secret`).
 * Bir tenant'ın şifreli değeri başka tenant'ın satırına kopyalanırsa çözülemez.
 */
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const FORMAT = /^v(\d+):([\w-]+):([\w-]+):([\w-]*)$/;

export class SecretDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretDecryptionError";
  }
}

export interface SecretBox {
  readonly currentVersion: number;
  encrypt(plaintext: string, context: string): string;
  decrypt(ciphertext: string, context: string): string;
  /** Kayıt güncel anahtar sürümüyle şifrelenmemişse true. */
  needsRotation(ciphertext: string): boolean;
}

/**
 * @param keys sürüm → base64 kodlu 32 baytlık anahtar
 * @param currentVersion yeni şifrelemelerde kullanılacak sürüm
 */
export function createSecretBox(keys: Record<number, string>, currentVersion: number): SecretBox {
  const ring = new Map<number, Buffer>();
  for (const [v, b64] of Object.entries(keys)) {
    const version = Number(v);
    if (!Number.isInteger(version) || version < 1) {
      throw new Error(`Geçersiz anahtar sürümü: ${v}`);
    }
    const key = Buffer.from(b64, "base64");
    if (key.length !== KEY_BYTES) {
      throw new Error(`v${version} anahtarı ${KEY_BYTES} bayt olmalı (base64)`);
    }
    ring.set(version, key);
  }
  const currentKey = ring.get(currentVersion);
  if (!currentKey) throw new Error(`Güncel anahtar sürümü (v${currentVersion}) tanımlı değil`);

  const parse = (ciphertext: string) => {
    const m = FORMAT.exec(ciphertext);
    if (!m) throw new SecretDecryptionError("Şifreli metin biçimi geçersiz");
    return { version: Number(m[1]), iv: m[2]!, tag: m[3]!, data: m[4]! };
  };

  return {
    currentVersion,

    encrypt(plaintext, context) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, currentKey, iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(Buffer.from(context, "utf8"));
      const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `v${currentVersion}:${iv.toString("base64url")}:${tag.toString("base64url")}:${data.toString("base64url")}`;
    },

    decrypt(ciphertext, context) {
      const p = parse(ciphertext);
      const key = ring.get(p.version);
      if (!key) throw new SecretDecryptionError(`v${p.version} anahtarı tanımlı değil`);
      const iv = Buffer.from(p.iv, "base64url");
      const tag = Buffer.from(p.tag, "base64url");
      if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
        throw new SecretDecryptionError("Şifreli metin biçimi geçersiz");
      }
      try {
        const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
        decipher.setAAD(Buffer.from(context, "utf8"));
        decipher.setAuthTag(tag);
        const out = Buffer.concat([
          decipher.update(Buffer.from(p.data, "base64url")),
          decipher.final(),
        ]);
        return out.toString("utf8");
      } catch {
        // Ayrıntı (anahtar, metin) hata mesajına yazılmaz.
        throw new SecretDecryptionError("Şifre çözülemedi: anahtar veya bağlam uyuşmuyor");
      }
    },

    needsRotation(ciphertext) {
      return parse(ciphertext).version !== currentVersion;
    },
  };
}
