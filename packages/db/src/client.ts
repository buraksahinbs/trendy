import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = PostgresJsDatabase<typeof schema>;
/** Tenant bağlamı ayarlanmış işlem. Tenant verisine yalnızca bununla erişilir. */
export type TenantTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface Database {
  db: Db;
  close(): Promise<void>;
}

export function createDatabase(url: string, opts: { max?: number } = {}): Database {
  const client = postgres(url, {
    max: opts.max ?? 10,
    onnotice: () => {},
    // Kopan/yarım kalan bağlantılar havuzda birikmesin; sorun hızlıca hata olarak görünsün.
    connect_timeout: 10,
    idle_timeout: 300,
    max_lifetime: 60 * 30,
  });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end() };
}

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

/**
 * Tenant verisine erişimin TEK yolu. İşlem boyunca `trendy_app` rolüne geçilir ve
 * `app.tenant_id` ayarlanır; RLS politikaları diğer tenant'ların satırlarını gizler ve
 * başka tenant adına yazmayı reddeder. Ayarlar `LOCAL` olduğundan işlem bitince sıfırlanır,
 * havuzdaki bağlantıya sızmaz.
 */
export async function withTenant<T>(
  db: Db,
  tenantId: number,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
    throw new Error(`Geçersiz tenantId: ${tenantId}`);
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE trendy_app`);
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${String(tenantId)}, true)`);
    return fn(tx);
  });
}
