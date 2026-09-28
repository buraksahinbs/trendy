export class TrendyolError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly method: string,
    readonly path: string,
    /** Yanıt gövdesinin kısaltılmış hâli; gizli bilgi içermez. */
    readonly responseBody?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** 401 (hatalı API bilgisi) veya 403 (User-Agent eksik/yanlış). Tekrar denenmez. */
export class TrendyolAuthError extends TrendyolError {}

/** 429: tekrar denemeler tükendi. */
export class TrendyolRateLimitError extends TrendyolError {}

/** 400, 404 ve diğer 4xx. Tekrar denenmez. */
export class TrendyolValidationError extends TrendyolError {}

/** 426: kullanımdan kalkmış endpoint. Kod hatasıdır, alarm üretmeli. */
export class TrendyolDeprecatedEndpointError extends TrendyolError {}

/** 5xx veya ağ hatası: tekrar denemeler tükendi. */
export class TrendyolServerError extends TrendyolError {}

export type TrendyolErrorCode =
  "auth" | "rate_limit" | "validation" | "deprecated_endpoint" | "server" | "unknown";

/** İş loglarında ve uyarı kurallarında kullanılan hata sınıfı. */
export function trendyolErrorCode(err: unknown): TrendyolErrorCode {
  if (err instanceof TrendyolAuthError) return "auth";
  if (err instanceof TrendyolRateLimitError) return "rate_limit";
  if (err instanceof TrendyolValidationError) return "validation";
  if (err instanceof TrendyolDeprecatedEndpointError) return "deprecated_endpoint";
  if (err instanceof TrendyolServerError) return "server";
  return "unknown";
}
