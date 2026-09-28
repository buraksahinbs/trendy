/**
 * Para hesapları kuruş cinsinden tamsayı ile yapılır; kayan nokta hatası fiyata yansımaz.
 */
export type Kurus = number;

export function toKurus(amount: number): Kurus {
  if (!Number.isFinite(amount)) throw new RangeError(`Geçersiz tutar: ${amount}`);
  return Math.round(amount * 100);
}

export function fromKurus(kurus: Kurus): number {
  return kurus / 100;
}

/**
 * Türkçe ve İngilizce yazılmış tutarları ayrıştırır: "1.234,56", "1234,56", "1,234.56", "1234.56".
 * Son görülen ayraç ondalık ayracı kabul edilir. Ayrıştırılamazsa null döner.
 */
export function parseAmount(raw: string): number | null {
  const s = raw.trim().replace(/\s|₺|TL|TRY/gi, "");
  if (!/^-?[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let normalized: string;
  if (lastComma > lastDot) {
    if (s.indexOf(",") !== lastComma) return null;
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma && lastComma !== -1) {
    normalized = s.replace(/,/g, "");
  } else if (lastDot !== -1 && s.indexOf(".") !== lastDot) {
    // "1.234.567" → binlik ayracı
    normalized = s.replace(/\./g, "");
  } else {
    normalized = s;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
