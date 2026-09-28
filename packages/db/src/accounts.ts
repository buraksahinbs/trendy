import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { sessions, tenantMembers, tenants, users } from "./schema.js";

/**
 * Hesap ve oturum işlemleri (ROADMAP Faz 1). Bunlar tenant bağlamı kurulmadan önce çalışır
 * (giriş sırasında tenant bilinmez), bu yüzden sistem bağlantısını kullanır. Tenant verisine
 * dokunan işlemler burada değil, `withTenant` ile yapılır.
 */

export type MemberRole = "owner" | "staff";

export class EmailTakenError extends Error {
  constructor() {
    super("Bu e-posta ile kayıtlı bir kullanıcı var");
    this.name = "EmailTakenError";
  }
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Kullanıcı + tenant + owner üyeliği tek işlemde oluşturulur. */
export async function createAccount(
  db: Db,
  input: { email: string; passwordHash: string; tenantName: string },
): Promise<{ userId: number; tenantId: number }> {
  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email: normalizeEmail(input.email), passwordHash: input.passwordHash })
        .returning({ id: users.id });
      const [tenant] = await tx
        .insert(tenants)
        .values({ name: input.tenantName.trim() })
        .returning({ id: tenants.id });
      await tx
        .insert(tenantMembers)
        .values({ tenantId: tenant!.id, userId: user!.id, role: "owner" });
      return { userId: user!.id, tenantId: tenant!.id };
    });
  } catch (err) {
    if (isUniqueViolation(err, "users_email_lower_uq")) throw new EmailTakenError();
    throw err;
  }
}

export async function findUserByEmail(db: Db, email: string) {
  const [row] = await db
    .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(sql`lower(${users.email})`, normalizeEmail(email)));
  return row;
}

export async function updatePasswordHash(db: Db, userId: number, passwordHash: string) {
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

export async function listMemberships(db: Db, userId: number) {
  return db
    .select({ tenantId: tenants.id, tenantName: tenants.name, role: tenantMembers.role })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
    .where(eq(tenantMembers.userId, userId))
    .orderBy(tenants.id);
}

// ── Oturumlar ────────────────────────────────────────────────────────────────

const hashToken = (token: string) => createHash("sha256").update(token).digest("base64url");

export interface SessionInfo {
  userId: number;
  email: string;
  expiresAt: Date;
  /** Aktif tenant ve rol; üyelik kaldırılmışsa ikisi de null. */
  tenantId: number | null;
  role: MemberRole | null;
}

/** Yeni oturum açar ve tarayıcıya verilecek token'ı döner (token veritabanına yazılmaz). */
export async function createSession(
  db: Db,
  input: { userId: number; activeTenantId: number | null; ttlMs: number; now?: Date },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date((input.now ?? new Date()).getTime() + input.ttlMs);
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId: input.userId,
    activeTenantId: input.activeTenantId,
    expiresAt,
  });
  return { token, expiresAt };
}

export async function getSession(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<SessionInfo | undefined> {
  const [row] = await db
    .select({
      userId: sessions.userId,
      email: users.email,
      expiresAt: sessions.expiresAt,
      tenantId: tenantMembers.tenantId,
      role: tenantMembers.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    // Üyelik kontrolü her istekte: kullanıcı tenant'tan çıkarılınca oturum o tenant'a erişemez.
    .leftJoin(
      tenantMembers,
      and(
        eq(tenantMembers.userId, sessions.userId),
        eq(tenantMembers.tenantId, sessions.activeTenantId),
      ),
    )
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now)));
  if (!row) return undefined;
  return { ...row, tenantId: row.tenantId ?? null, role: row.role ?? null };
}

/** Aktif tenant'ı değiştirir; kullanıcı o tenant'ın üyesi değilse false döner. */
export async function setActiveTenant(db: Db, token: string, tenantId: number): Promise<boolean> {
  const res = await db
    .update(sessions)
    .set({ activeTenantId: tenantId })
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        sql`EXISTS (SELECT 1 FROM ${tenantMembers}
                    WHERE ${tenantMembers.userId} = ${sessions.userId}
                      AND ${tenantMembers.tenantId} = ${tenantId})`,
      ),
    )
    .returning({ userId: sessions.userId });
  return res.length > 0;
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** Şifre değişince kullanıcının tüm oturumları kapatılır. */
export async function deleteUserSessions(db: Db, userId: number): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function deleteExpiredSessions(db: Db, now: Date = new Date()): Promise<number> {
  const res = await db
    .delete(sessions)
    .where(lte(sessions.expiresAt, now))
    .returning({ h: sessions.tokenHash });
  return res.length;
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  // postgres.js hatası drizzle tarafından `cause` içine sarılabilir.
  for (let e: unknown = err; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    const pg = e as { code?: string; constraint_name?: string };
    if (pg.code === "23505" && pg.constraint_name === constraint) return true;
  }
  return false;
}
