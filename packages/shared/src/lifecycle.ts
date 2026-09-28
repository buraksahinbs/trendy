import type { Logger } from "./logger.js";

export interface LifecycleOptions {
  logger: Pick<Logger, "info" | "error" | "fatal">;
  /** Kaynakları sırayla kapatır (sunucu, worker, kuyruk, veritabanı...). */
  close: () => Promise<void>;
  /** Kapanış bu süreyi aşarsa süreç zorla sonlandırılır (Docker SIGKILL'den önce). */
  timeoutMs?: number;
  exit?: (code: number) => void;
  /** Testler için false: süreç sinyal/hata dinleyicileri eklenmez. */
  processHandlers?: boolean;
}

/**
 * Süreç yaşam döngüsü: SIGINT/SIGTERM'de kontrollü kapanış; yakalanmamış hata veya
 * reddedilmiş promise'te hatayı loglayıp kapanış (kod 1). Tutarsız durumda çalışmaya devam
 * etmek yerine yeniden başlamak (Docker `restart`) daha güvenlidir.
 */
export function installLifecycle(opts: LifecycleOptions): (reason: string, code?: number) => void {
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  let closing = false;

  const shutdown = (reason: string, code = 0) => {
    if (closing) return;
    closing = true;
    opts.logger.info({ reason }, "kapanıyor");
    const timer = setTimeout(() => {
      opts.logger.error({ reason }, "kapanış süresi aşıldı, zorla çıkılıyor");
      exit(code || 1);
    }, opts.timeoutMs ?? 25_000);
    timer.unref();
    opts
      .close()
      .then(() => exit(code))
      .catch((err: unknown) => {
        opts.logger.error({ err }, "kapanış hatası");
        exit(code || 1);
      })
      .finally(() => clearTimeout(timer));
  };

  if (opts.processHandlers === false) return shutdown;
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => {
    opts.logger.fatal({ err }, "yakalanmamış hata");
    shutdown("uncaughtException", 1);
  });
  process.on("unhandledRejection", (err) => {
    opts.logger.fatal({ err }, "yakalanmamış promise reddi");
    shutdown("unhandledRejection", 1);
  });
  return shutdown;
}
