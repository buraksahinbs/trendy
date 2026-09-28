import { tenantAlerts, withTenant } from "@trendy/db";
import { WORKER_HEARTBEAT_KEY, WORKER_HEARTBEAT_MAX_AGE_MS } from "@trendy/jobs";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireTenant } from "../app.js";

type Check = { ok: boolean; detail?: string };

/**
 * Sağlık kontrolleri (ROADMAP Faz 12). `/health` yalnızca sürecin ayakta olduğunu söyler
 * (liveness); `/health/ready` veritabanı, Redis ve worker'ı kontrol eder, biri çalışmıyorsa 503.
 * Yanıtta iç ayrıntı (bağlantı adresi, hata yığını) yoktur.
 */
export async function healthRoutes(app: FastifyInstance) {
  app.get("/ready", async (req, reply) => {
    const checks: Record<string, Check> = {};
    try {
      await app.deps.db.execute(sql`SELECT 1`);
      checks.db = { ok: true };
    } catch (err) {
      req.log.error({ err }, "hazırlık: veritabanı");
      checks.db = { ok: false };
    }
    const redis = app.deps.redis;
    if (redis) {
      try {
        checks.redis = { ok: (await redis.ping()) === "PONG" };
        const beat = await redis.get(WORKER_HEARTBEAT_KEY);
        const age = beat ? Date.now() - new Date(beat).getTime() : Infinity;
        checks.worker =
          age <= WORKER_HEARTBEAT_MAX_AGE_MS
            ? { ok: true }
            : { ok: false, detail: beat ? "worker yanıt vermiyor" : "worker hiç başlamadı" };
      } catch (err) {
        req.log.error({ err }, "hazırlık: redis");
        checks.redis = { ok: false };
        checks.worker = { ok: false, detail: "redis erişilemedi" };
      }
    }
    const ok = Object.values(checks).every((c) => c.ok);
    return reply.status(ok ? 200 : 503).send({ ok, checks });
  });
}

/** Panel uyarıları (Faz 12 alarm kuralları), en kritik önce. */
export async function alertRoutes(app: FastifyInstance) {
  app.get("/", async (req) => {
    const { tenantId } = requireTenant(req);
    return withTenant(app.deps.db, tenantId, (tx) =>
      tenantAlerts(tx, tenantId, app.deps.now?.() ?? new Date()),
    );
  });
}
