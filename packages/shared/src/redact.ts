/**
 * Log'lara gizli bilgi sızmasını önler (ROADMAP §0.9, Faz 1).
 * Anahtar adı eşleşen alanlar maskelenir; iç içe nesne ve diziler de taranır.
 */
const SECRET_KEY = /authorization|api[-_]?key|api[-_]?secret|password|secret|token|cookie/i;

export const REDACTED = "[REDACTED]";

/** drizzle sorgu hataları mesaja parametreleri ekler (e-posta, parola özeti, şifreli veri...). */
const QUERY_PARAMS_LINE = /\nparams: [^\n]*/g;
const stripParams = (s: string | undefined) =>
  s?.replace(QUERY_PARAMS_LINE, "\nparams: [REDACTED]");

export function redact<T>(value: T, depth = 0): T {
  if (depth > 10 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as T;
  if (value instanceof Error) {
    // Error alanları sayılabilir değildir; düz nesneye çevrilmezse mesaj ve stack kaybolur.
    const { name, message, stack } = value;
    const plain: Record<string, unknown> = {
      ...value,
      type: name,
      message: stripParams(message),
      stack: stripParams(stack),
    };
    // Sorgu hatası: parametre değerleri loga yazılmaz, sorgu metni (yer tutucularla) kalır.
    if (typeof plain.query === "string") {
      for (const k of ["params", "parameters"]) if (k in plain) plain[k] = REDACTED;
    }
    if (value.cause !== undefined) plain.cause = value.cause;
    return redact(plain, depth) as T;
  }
  // Yalnızca düz nesneler taranır. Date, Buffer, URL gibi değerler ve Fastify'ın req/res
  // nesneleri olduğu gibi bırakılır; bunları logger serializer'ları güvenli alanlarla yazar
  // (Fastify req serializer'ı header'ları/cookie'leri yazmaz). Düz nesneye çevirmek onları bozar.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? REDACTED : redact(v, depth + 1);
  }
  return out as T;
}
