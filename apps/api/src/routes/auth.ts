import {
  createAccount,
  createSession,
  deleteSession,
  deleteUserSessions,
  EmailTakenError,
  findUserByEmail,
  listMemberships,
  normalizeEmail,
  setActiveTenant,
  updatePasswordHash,
} from "@trendy/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { HttpError, requireUser, setSessionCookie } from "../app.js";
import {
  burnPasswordCheck,
  hashPassword,
  PASSWORD_MAX,
  PASSWORD_MIN,
  verifyPassword,
} from "../password.js";

const email = z.email("Geçerli bir e-posta girilmeli").max(254);
const password = z
  .string()
  .min(PASSWORD_MIN, `Şifre en az ${PASSWORD_MIN} karakter olmalı`)
  .max(PASSWORD_MAX, `Şifre en fazla ${PASSWORD_MAX} karakter olabilir`);

const registerBody = z.object({
  email,
  password,
  tenantName: z.string().trim().min(1, "Mağaza adı girilmeli").max(100),
});
const loginBody = z.object({ email, password: z.string().min(1).max(PASSWORD_MAX) });
const switchBody = z.object({ tenantId: z.number().int().positive() });
const changePasswordBody = z.object({
  currentPassword: z.string().max(PASSWORD_MAX),
  newPassword: password,
});

/** Giriş denemesi sınırları: e-posta başına ve IP başına, 15 dakikalık pencere. */
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_LIMIT_PER_EMAIL = 10;
const LOGIN_LIMIT_PER_IP = 50;

export async function authRoutes(app: FastifyInstance) {
  const { db, limiter, sessionTtlMs } = app.deps;
  const now = () => app.deps.now?.() ?? new Date();

  async function throttle(req: FastifyRequest, emailAddr: string) {
    const checks = [
      { key: `login:email:${normalizeEmail(emailAddr)}`, limit: LOGIN_LIMIT_PER_EMAIL },
      { key: `login:ip:${req.ip}`, limit: LOGIN_LIMIT_PER_IP },
    ];
    for (const c of checks) {
      const wait = await limiter.reserve(c.key, c.limit, LOGIN_WINDOW_MS);
      if (wait > 0) {
        throw new HttpError(
          429,
          "too_many_attempts",
          "Çok fazla deneme; bir süre sonra tekrar deneyin",
          {
            "retry-after": String(Math.ceil(wait / 1000)),
          },
        );
      }
    }
  }

  app.post("/register", async (req, reply) => {
    const body = registerBody.parse(req.body);
    await throttle(req, body.email);
    let account;
    try {
      account = await createAccount(db, {
        email: body.email,
        passwordHash: await hashPassword(body.password),
        tenantName: body.tenantName,
      });
    } catch (err) {
      if (err instanceof EmailTakenError) throw new HttpError(409, "email_taken", err.message);
      throw err;
    }
    const s = await createSession(db, {
      userId: account.userId,
      activeTenantId: account.tenantId,
      ttlMs: sessionTtlMs,
      now: now(),
    });
    setSessionCookie(app, reply, s.token, s.expiresAt);
    return reply.status(201).send({ userId: account.userId, tenantId: account.tenantId });
  });

  app.post("/login", async (req, reply) => {
    const body = loginBody.parse(req.body);
    await throttle(req, body.email);
    const user = await findUserByEmail(db, body.email);
    const ok = user
      ? await verifyPassword(user.passwordHash, body.password)
      : (await burnPasswordCheck(body.password), false);
    // Kullanıcının var olup olmadığı yanıttan anlaşılmasın: tek tip hata.
    if (!user || !ok) throw new HttpError(401, "invalid_credentials", "E-posta veya şifre hatalı");

    const memberships = await listMemberships(db, user.id);
    const s = await createSession(db, {
      userId: user.id,
      activeTenantId: memberships[0]?.tenantId ?? null,
      ttlMs: sessionTtlMs,
      now: now(),
    });
    setSessionCookie(app, reply, s.token, s.expiresAt);
    return { userId: user.id, tenantId: memberships[0]?.tenantId ?? null };
  });

  app.post("/logout", async (req, reply) => {
    if (req.sessionToken) await deleteSession(db, req.sessionToken);
    reply.clearCookie(app.sessionCookieName, { path: "/" });
    return reply.status(204).send();
  });

  app.get("/me", async (req) => {
    const s = requireUser(req);
    return {
      userId: s.userId,
      email: s.email,
      activeTenantId: s.tenantId,
      role: s.role,
      tenants: await listMemberships(db, s.userId),
    };
  });

  app.post("/switch-tenant", async (req) => {
    requireUser(req);
    const { tenantId } = switchBody.parse(req.body);
    if (!(await setActiveTenant(db, req.sessionToken!, tenantId))) {
      throw new HttpError(403, "forbidden", "Bu mağazaya erişim yetkiniz yok");
    }
    return { activeTenantId: tenantId };
  });

  app.post("/change-password", async (req, reply) => {
    const s = requireUser(req);
    const body = changePasswordBody.parse(req.body);
    await throttle(req, s.email);
    const user = await findUserByEmail(db, s.email);
    if (!user || !(await verifyPassword(user.passwordHash, body.currentPassword))) {
      throw new HttpError(401, "invalid_credentials", "Mevcut şifre hatalı");
    }
    await updatePasswordHash(db, user.id, await hashPassword(body.newPassword));
    // Tüm cihazlardaki oturumlar kapatılır, bu cihaza yeni oturum verilir.
    await deleteUserSessions(db, user.id);
    const next = await createSession(db, {
      userId: user.id,
      activeTenantId: s.tenantId,
      ttlMs: sessionTtlMs,
      now: now(),
    });
    setSessionCookie(app, reply, next.token, next.expiresAt);
    return reply.status(204).send();
  });
}
