const dateTime = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const rtf = new Intl.RelativeTimeFormat("tr", { numeric: "auto" });
const num = new Intl.NumberFormat("tr-TR");

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return dateTime.format(new Date(iso));
}

export function formatNumber(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : num.format(n);
}

export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "Hiç";
  const diffSec = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 45) return "az önce";
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), "day");
  return formatDateTime(iso);
}

export function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return "—";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1).replace(".", ",")} sn`;
  const m = Math.floor(s / 60);
  return `${m} dk ${Math.round(s % 60)} sn`;
}

const money = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Kuruş tamsayısını gösterir: 12345 → "123,45 ₺"; TRY dışı için para birimi kodu eklenir. */
export function formatMoney(kurus: number | null | undefined, currency = "TRY"): string {
  if (kurus === null || kurus === undefined) return "—";
  const v = money.format(kurus / 100);
  return currency === "TRY" ? `${v} ₺` : `${v} ${currency}`;
}

/** Değişim oranı: 0.125 → "+%12,5". */
export function formatChangeRate(rate: number): string {
  const pct = Math.round(rate * 1000) / 10;
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}%${String(Math.abs(pct)).replace(".", ",")}`;
}

export function formatPercent(rate: number): string {
  // dropRate 0..1 aralığında beklenir; 1'den büyükse zaten yüzdedir.
  const pct = rate <= 1 ? rate * 100 : rate;
  return `%${Math.round(pct)}`;
}
