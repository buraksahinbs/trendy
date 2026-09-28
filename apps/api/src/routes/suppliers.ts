import {
  createSupplier,
  deleteSupplier,
  getSupplier,
  listJobLogs,
  listSupplierProducts,
  listSuppliers,
  setSupplierAuth,
  updateSupplier,
  withTenant,
} from "@trendy/db";
import { validateFetchCron } from "@trendy/jobs";
import {
  detectFeedFromUrl,
  FeedDownloadError,
  SUPPORTED_ENCODINGS,
  XmlParseError,
} from "@trendy/xml-ingest";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError, requireTenant } from "../app.js";

const idParam = z.object({ id: z.coerce.number().int().positive() });
const feedUrl = z
  .url({ protocol: /^https?$/, message: "Geçerli bir http/https adresi girilmeli" })
  .max(2000);
const itemPath = z
  .string()
  .trim()
  .max(200)
  .regex(/^\/[^\s]+$/, "Yol / ile başlamalı, ör. /Urunler/Urun");
const externalIdPath = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\s]+$/, "Alan yolu boşluk içeremez, ör. UrunKodu veya @id");
const scheduleCron = z
  .string()
  .trim()
  .superRefine((v, ctx) => {
    const r = validateFetchCron(v);
    if (!r.ok) ctx.addIssue({ code: "custom", message: r.message });
  });
const auth = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
});
const encoding = z.enum(SUPPORTED_ENCODINGS);

const createBody = z.object({
  name: z.string().trim().min(1, "Tedarikçi adı girilmeli").max(100),
  feedUrl,
  itemPath: itemPath.optional(),
  externalIdPath: externalIdPath.optional(),
  encoding: encoding.optional(),
  scheduleCron: scheduleCron.optional(),
  auth: auth.optional(),
});
const updateBody = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  feedUrl: feedUrl.optional(),
  itemPath: itemPath.nullable().optional(),
  externalIdPath: externalIdPath.nullable().optional(),
  encoding: encoding.nullable().optional(),
  scheduleCron: scheduleCron.optional(),
  active: z.boolean().optional(),
  syncPaused: z.boolean().optional(),
  /** null: kimlik bilgisini kaldırır. */
  auth: auth.nullable().optional(),
});
const detectBody = z.object({
  feedUrl,
  encoding: encoding.optional(),
  itemPath: itemPath.optional(),
  auth: auth.optional(),
});
const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const jobsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  supplierId: z.coerce.number().int().positive().optional(),
});

/** Feed analizi dışarıya istek attığı için tenant başına dakikada 10 ile sınırlı. */
const DETECT_LIMIT = { limit: 10, windowMs: 60_000 };

const basicAuthHeader = (a: { username: string; password: string }) => ({
  authorization: `Basic ${Buffer.from(`${a.username}:${a.password}`).toString("base64")}`,
});

/** exactOptionalPropertyTypes: undefined alanlar güncellemeye girmesin. */
const defined = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };

export async function supplierRoutes(app: FastifyInstance) {
  const { db, secretBox, queue, limiter } = app.deps;
  const notFound = () => new HttpError(404, "not_found", "Tedarikçi bulunamadı");

  app.get("/", async (req) => {
    const { tenantId } = requireTenant(req);
    return withTenant(db, tenantId, (tx) => listSuppliers(tx));
  });

  app.post("/", async (req, reply) => {
    const { tenantId } = requireTenant(req, ["owner"]);
    const body = createBody.parse(req.body);
    const { name, feedUrl, ...optional } = body;
    const id = await withTenant(db, tenantId, (tx) =>
      createSupplier(tx, secretBox, tenantId, { name, feedUrl, ...defined(optional) }),
    );
    return reply.status(201).send({ id });
  });

  app.post("/detect", async (req) => {
    const { tenantId } = requireTenant(req, ["owner"]);
    const body = detectBody.parse(req.body);
    const wait = await limiter.reserve(
      `detect:tenant:${tenantId}`,
      DETECT_LIMIT.limit,
      DETECT_LIMIT.windowMs,
    );
    if (wait > 0) {
      throw new HttpError(429, "too_many_requests", "Çok sık analiz isteği; biraz bekleyin", {
        "retry-after": String(Math.ceil(wait / 1000)),
      });
    }
    try {
      return await detectFeedFromUrl(body.feedUrl, {
        ...(body.encoding ? { encoding: body.encoding } : {}),
        ...(body.itemPath ? { itemPath: body.itemPath } : {}),
        ...(body.auth ? { headers: basicAuthHeader(body.auth) } : {}),
        ...app.deps.feedDownloadOptions,
      });
    } catch (err) {
      if (err instanceof FeedDownloadError) {
        throw new HttpError(400, "feed_download", `Feed indirilemedi: ${err.message}`);
      }
      if (err instanceof XmlParseError) {
        throw new HttpError(400, "feed_parse", `XML okunamadı: ${err.message}`);
      }
      throw err;
    }
  });

  app.get("/:id", async (req) => {
    const { tenantId } = requireTenant(req);
    const { id } = idParam.parse(req.params);
    const s = await withTenant(db, tenantId, (tx) => getSupplier(tx, id));
    if (!s) throw notFound();
    return s;
  });

  app.patch("/:id", async (req) => {
    const { tenantId } = requireTenant(req, ["owner"]);
    const { id } = idParam.parse(req.params);
    const { auth: newAuth, ...fields } = updateBody.parse(req.body);
    const s = await withTenant(db, tenantId, async (tx) => {
      const updated = await updateSupplier(tx, id, defined(fields));
      if (updated && newAuth !== undefined) {
        await setSupplierAuth(tx, secretBox, tenantId, id, newAuth);
        return getSupplier(tx, id);
      }
      return updated;
    });
    if (!s) throw notFound();
    return s;
  });

  app.delete("/:id", async (req, reply) => {
    const { tenantId } = requireTenant(req, ["owner"]);
    const { id } = idParam.parse(req.params);
    if (!(await withTenant(db, tenantId, (tx) => deleteSupplier(tx, id)))) throw notFound();
    return reply.status(204).send();
  });

  app.post("/:id/fetch", async (req, reply) => {
    const { tenantId } = requireTenant(req);
    const { id } = idParam.parse(req.params);
    if (!(await withTenant(db, tenantId, (tx) => getSupplier(tx, id)))) throw notFound();
    const r = await queue.enqueueSupplierFetch({ tenantId, supplierId: id, trigger: "manual" });
    return reply.status(202).send(r);
  });

  app.get("/:id/products", async (req) => {
    const { tenantId } = requireTenant(req);
    const { id } = idParam.parse(req.params);
    const page = pageQuery.parse(req.query);
    return withTenant(db, tenantId, async (tx) => {
      if (!(await getSupplier(tx, id))) throw notFound();
      return listSupplierProducts(tx, id, page);
    });
  });
}

export async function jobRoutes(app: FastifyInstance) {
  const { db } = app.deps;
  app.get("/", async (req) => {
    const { tenantId } = requireTenant(req);
    const q = jobsQuery.parse(req.query);
    return withTenant(db, tenantId, (tx) =>
      listJobLogs(tx, {
        limit: q.limit,
        ...(q.supplierId !== undefined ? { supplierId: q.supplierId } : {}),
      }),
    );
  });
}
