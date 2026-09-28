import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { createDatabase, runMigrations, type Database } from "./client.js";

/**
 * Testler için geçici veritabanı: DATABASE_URL'deki sunucuda rastgele adlı bir veritabanı
 * oluşturur, migration'ları uygular; `drop` ile siler. DATABASE_URL yoksa testler atlanmalı.
 */
/**
 * `trendy_app` rolü sunucu genelidir (veritabanına ait değil). Paralel test dosyaları aynı
 * anda migration uygularsa 0001_rls'teki "yoksa oluştur" iki kez CREATE ROLE deneyip
 * `pg_authid_rolname_index` ihlaliyle düşebilir. Rol ve üyelik migration'lardan önce burada
 * oluşturulur; yarışı kaybeden taraf hatayı yok sayar ya da yeniden dener.
 */
async function ensureAppRole(admin: postgres.Sql) {
  for (let attempt = 1; ; attempt++) {
    try {
      await admin.unsafe(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trendy_app') THEN
            CREATE ROLE trendy_app NOLOGIN;
          END IF;
        EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
        END
        $$`);
      await admin.unsafe(`
        DO $$
        BEGIN
          EXECUTE format('GRANT trendy_app TO %I', current_user);
        EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
        END
        $$`);
      return;
    } catch (err) {
      // Eşzamanlı güncelleme ("tuple concurrently updated") gibi geçici hatalar
      if (attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 50 * attempt));
    }
  }
}

export async function createTestDatabase(
  adminUrl: string,
): Promise<Database & { drop(): Promise<void> }> {
  const name = `trendy_test_${randomBytes(6).toString("hex")}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await ensureAppRole(admin);
  await admin.unsafe(`CREATE DATABASE ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const database = createDatabase(url.toString(), { max: 5 });
  await runMigrations(database.db);
  return {
    ...database,
    async drop() {
      await database.close();
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}
