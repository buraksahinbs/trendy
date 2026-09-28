import cookie from "@fastify/cookie";
import type { Db, MemberRole, SessionInfo } from "@trendy/db";
import { getSession } from "@trendy/db";
import type { JobQueue } from "@trendy/jobs";
import type { Logger, SecretBox } from "@trendy/shared";
import type { RateLimiter, TrendyolClientConfig } from "@trendy/trendyol-client";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { authRoutes } from "./routes/auth.js";
import { jobRoutes, supplierRoutes } from "./routes/suppliers.js";
import { trendyolRoutes } from "./routes/trendyol.js";

export interface AppDeps {
  db: Db;
  secretBox: SecretBox;
  /** Giriş denemesi sınırlaması (brute-force). Üretimde Redis tabanlı olmalı. */
  limiter: RateLimiter;
  queue: JobQueue;
  /** Trendyol User-Agent'taki entegratör adı (`TRENDYOL_INTEGRATOR_NAME`). */
  integratorName: string;
  /** Yalnızca testler için: mock Trendyol adresi vb. */
  trendyolClientOptions?: Partial<Pick<TrendyolClientConfig, "baseUrl" | "sleep" | "random">>;
  /** Yalnızca testler için: feed analizinde yerel adreslere izin. */
  feedDownloadOptions?: { allowPrivateNetwork?: boolean };
  logger?: Logger;
  sessionTtlMs: number;
  /** Üretimde true: cookie yalnızca HTTPS ile gönderilir ve `__Host-` önekini alır. */
  secureCookies: boolean;
  now?: () => Date;
}

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

declare module "fastify" {
  interface FastifyInstance {
    deps: AppDeps;
    sessionCookieName: string;
  }
  interface FastifyRequest {
    session: SessionInfo | null;
    sessionToken: string | null;
  }
}

export async function buildApp(deps: AppDeps) {
  const app = Fastify({
    ...(deps.logger ? { loggerInstance: deps.logger } : { logger: false }),
    bodyLimit: 1024 * 1024,
  });

  app.decorate("deps", deps);
  app.decorate(
    "sessionCookieName",
    deps.secureCookies ? "__Host-trendy_session" : "trendy_session",
  );
  app.decorateRequest("session", null);
  app.decorateRequest("sessionToken", null);
  await app.register(cookie);

  // Her istekte oturum çözülür; yetki kontrolü route'larda `requireUser`/`requireTenant` ile yapılır.
  app.addHook("onRequest", async (req) => {
    const token = req.cookies[app.sessionCookieName];
    if (!token) return;
    const session = await getSession(deps.db, token, deps.now?.() ?? new Date());
    if (session) {
      req.session = session;
      req.sessionToken = token;
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: "validation",
        message: "Geçersiz istek",
        issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).headers(err.headers).send({
        error: err.code,
        message: err.message,
      });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: "bad_request", message: (err as Error).message });
    }
    req.log.error({ err }, "beklenmeyen hata");
    return reply.status(500).send({ error: "internal", message: "Sunucu hatası" });
  });

  app.get("/health", async () => ({ ok: true }));
  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(trendyolRoutes, { prefix: "/trendyol" });
  await app.register(supplierRoutes, { prefix: "/suppliers" });
  await app.register(jobRoutes, { prefix: "/jobs" });
  return app;
}

export function requireUser(req: FastifyRequest): SessionInfo {
  if (!req.session) throw new HttpError(401, "unauthenticated", "Giriş yapılmalı");
  return req.session;
}

export function requireTenant(
  req: FastifyRequest,
  roles: MemberRole[] = ["owner", "staff"],
): { userId: number; tenantId: number; role: MemberRole } {
  const s = requireUser(req);
  if (s.tenantId === null || s.role === null) {
    throw new HttpError(403, "no_tenant", "Aktif bir mağaza seçilmeli");
  }
  if (!roles.includes(s.role)) throw new HttpError(403, "forbidden", "Bu işlem için yetki yok");
  return { userId: s.userId, tenantId: s.tenantId, role: s.role };
}

export function setSessionCookie(
  app: { sessionCookieName: string; deps: AppDeps },
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
) {
  reply.setCookie(app.sessionCookieName, token, {
    httpOnly: true,
    secure: app.deps.secureCookies,
    // Lax: başka siteden gelen POST isteklerinde cookie gönderilmez (CSRF koruması).
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export type App = Awaited<ReturnType<typeof buildApp>>;
