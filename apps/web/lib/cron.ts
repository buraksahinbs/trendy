// Çekim sıklığı seçenekleri. Kullanıcı cron yazmaz; bu hazır ifadelerden birini seçer.
export const SCHEDULE_PRESETS = [
  { value: "*/15 * * * *", label: "15 dakikada bir" },
  { value: "*/30 * * * *", label: "30 dakikada bir" },
  { value: "0 * * * *", label: "Saatte bir" },
  { value: "0 */6 * * *", label: "6 saatte bir" },
  { value: "0 3 * * *", label: "Günde bir (03:00)" },
] as const;

// Veritabanı varsayılanıyla aynı
export const DEFAULT_SCHEDULE = "*/30 * * * *";

export function scheduleLabel(cron: string): string {
  return SCHEDULE_PRESETS.find((p) => p.value === cron.trim())?.label ?? cron;
}

export const ENCODING_OPTIONS = [
  { value: "utf-8", label: "UTF-8" },
  { value: "iso-8859-9", label: "ISO-8859-9 (Türkçe)" },
  { value: "windows-1254", label: "Windows-1254 (Türkçe)" },
] as const;
