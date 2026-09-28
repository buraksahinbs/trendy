import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { createDatabase, runMigrations, type Database } from "./client.js";

/**
 * Testler için geçici veritabanı: DATABASE_URL'deki sunucuda rastgele adlı bir veritabanı
 * oluşturur, migration'ları uygular; `drop` ile siler. DATABASE_URL yoksa testler atlanmalı.
 */
export async function createTestDatabase(
  adminUrl: string,
): Promise<Database & { drop(): Promise<void> }> {
  const name = `trendy_test_${randomBytes(6).toString("hex")}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
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
