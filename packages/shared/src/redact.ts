/**
 * Log'lara gizli bilgi sızmasını önler (ROADMAP §0.9, Faz 1).
 * Anahtar adı eşleşen alanlar maskelenir; iç içe nesne ve diziler de taranır.
 */
const SECRET_KEY = /authorization|api[-_]?key|api[-_]?secret|password|secret|token|cookie/i;

export const REDACTED = "[REDACTED]";

export function redact<T>(value: T, depth = 0): T {
  if (depth > 10 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as T;
  if (value instanceof Error) {
    // Error alanları sayılabilir değildir; düz nesneye çevrilmezse mesaj ve stack kaybolur.
    const { name, message, stack } = value;
    return redact({ ...value, type: name, message, stack }, depth) as T;
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
