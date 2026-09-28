import { createLogger, envSchema } from "@trendy/shared";
import { createDatabase, runMigrations } from "./client.js";

/** `pnpm --filter @trendy/db migrate`: DATABASE_URL'deki veritabanına migration'ları uygular. */
// Migration yalnızca veritabanı adresine ihtiyaç duyar; diğer değişkenler zorunlu tutulmaz.
const env = envSchema.pick({ DATABASE_URL: true, LOG_LEVEL: true }).parse(process.env);
const log = createLogger({ level: env.LOG_LEVEL, name: "migrate" });
const { db, close } = createDatabase(env.DATABASE_URL, { max: 1 });
try {
  await runMigrations(db);
  log.info("migration'lar uygulandı");
} finally {
  await close();
}
