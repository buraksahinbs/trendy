import { CronExpressionParser } from "cron-parser";

/** Zamanlamalar Türkiye saatine göre yorumlanır ("her gün 03:00" satıcının saatiyle). */
export const SCHEDULE_TZ = "Europe/Istanbul";
/** Tedarikçi sunucularını ve kendi kaynaklarımızı korumak için en kısa çekim aralığı. */
export const MIN_FETCH_INTERVAL_MS = 15 * 60_000;

export type CronCheck = { ok: true } | { ok: false; message: string };

/** 5 alanlı cron ifadesini doğrular; aralık 15 dakikadan kısa olamaz. */
export function validateFetchCron(expr: string): CronCheck {
  if (expr.trim().split(/\s+/).length !== 5) {
    return {
      ok: false,
      message: "Zamanlama 5 alanlı cron ifadesi olmalı (dakika saat gün ay haftanın günü)",
    };
  }
  let it;
  try {
    it = CronExpressionParser.parse(expr, {
      tz: SCHEDULE_TZ,
      currentDate: new Date("2026-01-01T00:00:00Z"),
    });
  } catch {
    return { ok: false, message: "Geçersiz cron ifadesi" };
  }
  // Bir günü aşan örneklemde en kısa aralık kontrol edilir.
  let prev = it.next().getTime();
  for (let i = 0; i < 100; i++) {
    const next = it.next().getTime();
    if (next - prev < MIN_FETCH_INTERVAL_MS) {
      return { ok: false, message: "Çekim aralığı en az 15 dakika olmalı" };
    }
    prev = next;
  }
  return { ok: true };
}

/** `after` anından sonraki ilk çalışma zamanı. */
export function nextRunAfter(expr: string, after: Date): Date {
  return CronExpressionParser.parse(expr, { tz: SCHEDULE_TZ, currentDate: after }).next().toDate();
}

/**
 * Zamanı gelmiş mi: son çekimden (hiç çekilmediyse oluşturulma anından) sonraki ilk çalışma
 * zamanı geçtiyse evet. Worker kapalı kaldıysa kaçırılan çalışmalar birikmez, tek sefer çalışır.
 */
export function isDue(expr: string, lastRunAt: Date, now: Date): boolean {
  return nextRunAfter(expr, lastRunAt).getTime() <= now.getTime();
}
