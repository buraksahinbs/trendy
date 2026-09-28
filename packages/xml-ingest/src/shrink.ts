/**
 * Güvenlik freni (ROADMAP Faz 4): Yeni feed bir önceki çekime göre ürünlerin büyük kısmını
 * kaybetmişse, kaybolan ürünlerin stoğu otomatik sıfırlanmaz. Bozuk veya boş gelen bir feed
 * tüm mağazayı kapatmamalı.
 */
export interface ShrinkCheckInput {
  previousCount: number;
  currentCount: number;
  /** Bu orandan fazla düşüş freni tetikler (0.5 = %50). */
  maxDropRate?: number;
}

export type ShrinkCheckResult =
  | { allowed: true; dropRate: number }
  | { allowed: false; dropRate: number; reason: "empty_feed" | "large_drop" };

export function checkFeedShrink({
  previousCount,
  currentCount,
  maxDropRate = 0.5,
}: ShrinkCheckInput): ShrinkCheckResult {
  if (previousCount <= 0) return { allowed: true, dropRate: 0 };
  const dropRate = Math.max(0, (previousCount - currentCount) / previousCount);
  if (currentCount === 0) return { allowed: false, dropRate, reason: "empty_feed" };
  if (dropRate > maxDropRate) return { allowed: false, dropRate, reason: "large_drop" };
  return { allowed: true, dropRate };
}
