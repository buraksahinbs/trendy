import { hash, verify } from "@node-rs/argon2";

/**
 * Şifre hash'i: argon2id (ROADMAP Faz 1). Kütüphane varsayılanları OWASP önerisidir
 * (m=19 MiB, t=2, p=1); parametreler hash içinde saklandığı için ileride artırılabilir.
 */
export const PASSWORD_MIN = 10;
/** Çok uzun girdilerle CPU tüketme saldırısına karşı üst sınır. */
export const PASSWORD_MAX = 200;

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/**
 * Kullanıcı bulunamadığında da aynı süre harcansın diye sahte hash ile doğrulama yapılır;
 * yanıt süresinden e-postanın kayıtlı olup olmadığı anlaşılmasın.
 */
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hash("trendy-dummy-password-for-timing");
  await verifyPassword(await dummyHash, password);
}
