import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import {
  createSupplier,
  listJobLogs,
  listSupplierProducts,
  schema,
  withTenant,
  type Db,
} from "@trendy/db";
import { createTestDatabase } from "@trendy/db/testing";
import type { JobQueue, XmlFetchPayload } from "@trendy/jobs";
import { createLogger, createSecretBox } from "@trendy/shared";
import iconv from "iconv-lite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { scheduleDueFetches } from "./scheduler.js";
import { FetchError, runSupplierFetch, type FetchDeps } from "./supplier-fetch.js";

const url = process.env.DATABASE_URL;

/** Test feed sunucusu: yanıt her testte ayarlanır. */
type Reply = { status?: number; body?: string | Buffer; etag?: string };
let reply: Reply = {};
let lastRequest: http.IncomingHttpHeaders = {};
let server: http.Server;
let feedUrl: string;

const feed = (items: { id?: string; stok: number; ad?: string }[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><Urunler>${items
    .map(
      (i) =>
        `<Urun>${i.id !== undefined ? `<Kod>${i.id}</Kod>` : ""}<Ad>${i.ad ?? "Ürün"}</Ad><Stok>${i.stok}</Stok></Urun>`,
    )
    .join("")}</Urunler>`;
const range = (n: number, stok = 1) => Array.from({ length: n }, (_, i) => ({ id: `K${i}`, stok }));

describe.skipIf(!url)("tedarikçi XML çekimi", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let tenantId: number;
  let deps: FetchDeps;
  const box = createSecretBox({ 1: randomBytes(32).toString("base64") }, 1);

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      lastRequest = req.headers;
      if (reply.etag && req.headers["if-none-match"] === reply.etag) {
        res.writeHead(304).end();
        return;
      }
      res.writeHead(reply.status ?? 200, {
        "content-type": "application/xml",
        ...(reply.etag ? { etag: reply.etag } : {}),
      });
      res.end(reply.body ?? "");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    feedUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/feed.xml`;

    const t = await createTestDatabase(url!);
    db = t.db;
    drop = t.drop;
    const [tenant] = await db
      .insert(schema.tenants)
      .values({ name: "A" })
      .returning({ id: schema.tenants.id });
    tenantId = tenant!.id;
    deps = {
      db,
      secretBox: box,
      logger: createLogger({ level: "silent" }),
      downloadOptions: { allowPrivateNetwork: true },
      batchSize: 7,
    };
  });

  afterAll(async () => {
    server?.close();
    await drop?.();
  });

  beforeEach(() => {
    reply = {};
    lastRequest = {};
  });

  const newSupplier = (extra: Partial<Parameters<typeof createSupplier>[3]> = {}) =>
    withTenant(db, tenantId, (tx) =>
      createSupplier(tx, box, tenantId, {
        name: "Tedarikçi",
        feedUrl,
        itemPath: "/Urunler/Urun",
        externalIdPath: "Kod",
        ...extra,
      }),
    );
  const run = (supplierId: number, trigger: XmlFetchPayload["trigger"] = "manual") =>
    runSupplierFetch(deps, { tenantId, supplierId, trigger });
  const products = (supplierId: number) =>
    withTenant(db, tenantId, (tx) =>
      listSupplierProducts(tx, supplierId, { limit: 1000, offset: 0 }),
    );
  const supplierRow = async (id: number) =>
    (
      await withTenant(db, tenantId, (tx) =>
        tx.select().from(schema.suppliers).where(eq(schema.suppliers.id, id)),
      )
    )[0]!;
  const lastJob = async (supplierId: number) =>
    (await withTenant(db, tenantId, (tx) => listJobLogs(tx, { limit: 1, supplierId })))[0]!;

  it("yapılandırma eksikse atlanır", async () => {
    const id = await newSupplier({ externalIdPath: null });
    const s = await run(id);
    expect(s.reason).toBe("config_missing");
    expect(await lastJob(id)).toMatchObject({
      status: "skipped",
      summary: { reason: "config_missing" },
    });
  });

  it("ilk çekimde ürünleri gruplar hâlinde yazar, ETag saklar, sonraki çekimde 304'e uyar", async () => {
    const id = await newSupplier();
    reply = { body: feed(range(20)), etag: '"v1"' };
    const s = await run(id);
    expect(s).toMatchObject({ itemCount: 20, inserted: 20, updated: 0, unchanged: 0, missing: 0 });
    expect((await products(id)).total).toBe(20);
    expect(await supplierRow(id)).toMatchObject({ etag: '"v1"', lastItemCount: 20 });
    expect(await lastJob(id)).toMatchObject({ status: "success", summary: { inserted: 20 } });

    const again = await run(id);
    expect(lastRequest["if-none-match"]).toBe('"v1"');
    expect(again.notModified).toBe(true);
  });

  it("değişen, değişmeyen ve kaybolan ürünleri ayırır; geri gelen ürünün kayıp işareti kalkar", async () => {
    const id = await newSupplier();
    reply = { body: feed(range(10)) };
    await run(id);

    const next = range(10).filter((i) => i.id !== "K9");
    next[0]!.stok = 99;
    reply = { body: feed(next) };
    const s = await run(id);
    expect(s).toMatchObject({ itemCount: 9, inserted: 0, updated: 1, unchanged: 8, missing: 1 });
    const p = await products(id);
    expect(p.missing).toBe(1);
    expect(p.items.find((i) => i.externalId === "K9")!.missingSince).toBeInstanceOf(Date);
    expect(p.items.find((i) => i.externalId === "K0")!.raw).toMatchObject({ Stok: "99" });

    reply = { body: feed(range(10)) };
    const back = await run(id);
    expect(back).toMatchObject({ updated: 1, missing: 0 });
    expect((await products(id)).missing).toBe(0);
  });

  it("güvenlik freni: ürünlerin yarısından fazlası kaybolursa kayıp işaretlenmez", async () => {
    const id = await newSupplier();
    reply = { body: feed(range(10)) };
    await run(id);
    reply = { body: feed(range(4)) };
    const s = await run(id);
    expect(s.shrinkBlocked).toEqual({ reason: "large_drop", dropRate: 0.6 });
    expect(s.missing).toBe(0);
    expect((await products(id)).missing).toBe(0);
    // Referans sayı korunur: bir sonraki bozuk çekim de frene takılır.
    expect((await supplierRow(id)).lastItemCount).toBe(10);
    expect(await lastJob(id)).toMatchObject({
      status: "success",
      summary: { shrinkBlocked: { reason: "large_drop" } },
    });
  });

  it("güvenlik freni: boş feed", async () => {
    const id = await newSupplier();
    reply = { body: feed(range(3)) };
    await run(id);
    reply = { body: feed([]) };
    const s = await run(id);
    expect(s.shrinkBlocked?.reason).toBe("empty_feed");
    expect((await products(id)).missing).toBe(0);
  });

  it("kimliği olmayan ve tekrarlanan ürünleri sayar, yazmaz", async () => {
    const id = await newSupplier();
    reply = {
      body: feed([{ id: "A", stok: 1 }, { stok: 2 }, { id: "A", stok: 3 }, { id: "B", stok: 4 }]),
    };
    const s = await run(id);
    expect(s).toMatchObject({ itemCount: 2, invalidItems: 1, duplicateIds: 1, inserted: 2 });
    // Tekrarlananlardan ilki tutulur.
    const a = (await products(id)).items.find((i) => i.externalId === "A")!;
    expect(a.raw).toMatchObject({ Stok: "1" });
  });

  it("bozuk XML kalıcı hatadır; önceki ürünler kayıp işaretlenmez", async () => {
    const id = await newSupplier();
    reply = { body: feed(range(10)) };
    await run(id);
    reply = { body: feed(range(10)).slice(0, 200) + "<bozuk></Urunler>" };
    const err = await run(id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect((err as FetchError).retryable).toBe(false);
    expect((await products(id)).missing).toBe(0);
    expect(await lastJob(id)).toMatchObject({ status: "failed" });
    expect((await lastJob(id)).error).toMatch(/XML okunamadı/);
  });

  it("sunucu hatası tekrar denenebilir; 404 denenmez", async () => {
    const id = await newSupplier();
    reply = { status: 503 };
    expect(((await run(id).catch((e: unknown) => e)) as FetchError).retryable).toBe(true);
    reply = { status: 404 };
    expect(((await run(id).catch((e: unknown) => e)) as FetchError).retryable).toBe(false);
    expect((await supplierRow(id)).lastAttemptAt).toBeInstanceOf(Date);
    expect((await supplierRow(id)).lastFetchedAt).toBeNull();
  });

  it("tedarikçi kimlik bilgisini Basic Auth olarak gönderir", async () => {
    const id = await newSupplier({ auth: { username: "kullanici", password: "sifre" } });
    reply = { body: feed(range(1)) };
    await run(id);
    expect(lastRequest.authorization).toBe(
      `Basic ${Buffer.from("kullanici:sifre").toString("base64")}`,
    );
  });

  it("deklarasyonu olmayan windows-1254 feed'i seçilen kodlamayla okur", async () => {
    const id = await newSupplier({ encoding: "windows-1254" });
    const xml = `<Urunler><Urun><Kod>1</Kod><Ad>Çağrı Şişe Ğİ</Ad><Stok>1</Stok></Urun></Urunler>`;
    reply = { body: iconv.encode(xml, "windows-1254") };
    const s = await run(id);
    expect(s).toMatchObject({ encoding: "windows-1254", replacementChars: 0 });
    expect((await products(id)).items[0]!.raw).toMatchObject({ Ad: "Çağrı Şişe Ğİ" });
  });

  it("zamanlanmış çekim duraklatılmış tedarikçide çalışmaz, elle çekim çalışır", async () => {
    const id = await newSupplier({ syncPaused: true });
    reply = { body: feed(range(2)) };
    expect((await run(id, "schedule")).reason).toBe("inactive");
    expect((await run(id, "manual")).inserted).toBe(2);
  });

  it("zamanlayıcı: zamanı gelenleri ekler, duraklatılmış tedarikçi ve tenant'ı atlar", async () => {
    const [tenant2] = await db
      .insert(schema.tenants)
      .values({ name: "S" })
      .returning({ id: schema.tenants.id });
    const t2 = tenant2!.id;
    const base = { feedUrl, itemPath: "/U", externalIdPath: "K", scheduleCron: "*/30 * * * *" };
    const due = await withTenant(db, t2, (tx) =>
      createSupplier(tx, box, t2, { ...base, name: "due" }),
    );
    const paused = await withTenant(db, t2, (tx) =>
      createSupplier(tx, box, t2, { ...base, name: "paused", syncPaused: true }),
    );
    const added: XmlFetchPayload[] = [];
    const queue: JobQueue = {
      enqueueSupplierFetch: async (p) => (added.push(p), { queued: true }),
      close: async () => {},
    };
    const now = new Date(Date.now() + 3_600_000);
    await scheduleDueFetches({ db, queue, logger: deps.logger }, now);
    const ids = added.map((p) => p.supplierId);
    expect(ids).toContain(due);
    expect(ids).not.toContain(paused);
    expect(added.find((p) => p.supplierId === due)).toEqual({
      tenantId: t2,
      supplierId: due,
      trigger: "schedule",
    });

    await db.update(schema.tenants).set({ syncPaused: true }).where(eq(schema.tenants.id, t2));
    added.length = 0;
    await scheduleDueFetches({ db, queue, logger: deps.logger }, now);
    expect(added.map((p) => p.supplierId)).not.toContain(due);

    // Zamanı gelmemiş: az önce denendi.
    await db.update(schema.tenants).set({ syncPaused: false }).where(eq(schema.tenants.id, t2));
    await db
      .update(schema.suppliers)
      .set({ lastAttemptAt: now })
      .where(eq(schema.suppliers.id, due));
    added.length = 0;
    await scheduleDueFetches({ db, queue, logger: deps.logger }, now);
    expect(added.map((p) => p.supplierId)).not.toContain(due);
  });
});
