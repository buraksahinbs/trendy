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
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? REDACTED : redact(v, depth + 1);
  }
  return out as T;
}
