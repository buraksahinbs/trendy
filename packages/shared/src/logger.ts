import { pino, type DestinationStream, type Logger as PinoLogger } from "pino";
import { redact } from "./redact.js";

export type Logger = PinoLogger;

export interface LoggerOptions {
  level?: string;
  name?: string;
  /** Testler için: çıktı hedefi. */
  destination?: DestinationStream;
}

/**
 * Yapılandırılmış logger (ROADMAP Faz 1). Her log nesnesi `redact`'tan geçer; böylece
 * `authorization`, `apiKey`, `apiSecret` vb. alanlar hangi derinlikte olursa olsun maskelenir.
 * pino'nun yol tabanlı `redact` seçeneği yerine anahtar adına göre maskeleme seçildi:
 * yeni bir alanın yolunu listeye eklemeyi unutmak sızıntıya yol açmasın.
 */
export function createLogger(opts: LoggerOptions = {}): Logger {
  return pino(
    {
      level: opts.level ?? "info",
      ...(opts.name ? { name: opts.name } : {}),
      formatters: { log: (obj) => redact(obj) },
      // `redact` Error'ları zaten { type, message, stack } nesnesine çeviriyor; pino'nun
      // varsayılan err serializer'ı bu nesneyi yeniden işleyip `type`'ı bozmasın.
      serializers: { err: (e: unknown) => e },
    },
    opts.destination,
  );
}
