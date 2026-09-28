/**
 * Trendyol barkod kuralları (ROADMAP §2.3):
 * - maksimum 40 karakter
 * - özel karakter olarak yalnızca `.` `-` `_`
 * - aradaki boşluklar Trendyol tarafından birleştirilir; biz göndermeden önce kendimiz birleştiririz
 *   ki stok/fiyat güncellemeleri Trendyol'da kayıtlı barkodla birebir aynı olsun.
 *
 * Geçersiz karakterler sessizce silinmez: iki farklı barkodun çakışmasına yol açabilir.
 * Bunun yerine hata raporlanır.
 */
export const BARCODE_MAX_LENGTH = 40;

const ALLOWED = /^[A-Za-z0-9._-]+$/;

export type BarcodeIssue = "empty" | "too_long" | "invalid_chars";

export type BarcodeResult =
  { ok: true; barcode: string } | { ok: false; barcode: string; issue: BarcodeIssue };

export function normalizeBarcode(raw: string): BarcodeResult {
  const barcode = raw.replace(/\s+/g, "");
  if (barcode.length === 0) return { ok: false, barcode, issue: "empty" };
  if (barcode.length > BARCODE_MAX_LENGTH) return { ok: false, barcode, issue: "too_long" };
  if (!ALLOWED.test(barcode)) return { ok: false, barcode, issue: "invalid_chars" };
  return { ok: true, barcode };
}
