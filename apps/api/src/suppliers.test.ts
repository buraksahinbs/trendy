import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { schema, startJobLog, finishJobLog, upsertSupplierProducts, withTenant } from "@trendy/db";
import { createTestDatabase } from "@trendy/db/testing";
import type { XmlFetchPayload } from "@trendy/jobs";
import { createSecretBox } from "@trendy/shared";
import { InMemoryRateLimiter } from "@trendy/trendyol-client";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type App, type AppDeps } from "./app.js";

const url = process.env.DATABASE_URL;

const FEED = `<?xml version="1.0"?><Katalog><Urunler>${Array.from(
  { length: 5 },
  (_, i) => `<Urun id="${i}"><StokKodu>S${i}</StokKodu><Ad>Ürün ${i}</Ad></Urun>`,
).join("")}</Urunler></Katalog>`;

describe.skipIf(!url)("tedarikçi uçları", () => {
  let app: App;
  let deps: AppDeps;
  let drop: () => Promise<void>;
  let feedServer: http.Server;
  let feedUrl: string;
  const queued: XmlFetchPayload[] = [];
  const users: Record<
    "owner" | "staff" | "other",
    { cookie: string; tenantId: number; userId: number }
  > = {} as never;

  const cookieOf = (res: { cookies: { name: string; value: string }[] }) =>
    `trendy_session=${res.cookies.find((c) => c.name === "trendy_session")!.value}`;

  async function register(email: string, tenantName: string) {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password: "guclu-sifre-123", tenantName },
    });
    return { cookie: cookieOf(res), ...(res.json() as { tenantId: number; userId: number }) };
  }

  const call = (
    who: keyof typeof users,
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url: path,
      headers: { cookie: users[who].cookie },
      ...(payload ? { payload } : {}),
    });

  beforeAll(async () => {
    feedServer = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/xml" }).end(FEED);
    });
    await new Promise<void>((r) => feedServer.listen(0, "127.0.0.1", r));
    feedUrl = `http://127.0.0.1:${(feedServer.address() as AddressInfo).port}/feed.xml`;

    const t = await createTestDatabase(url!);
    drop = t.drop;
    deps = {
      db: t.db,
      secretBox: createSecretBox({ 1: randomBytes(32).toString("base64") }, 1),
      limiter: new InMemoryRateLimiter(),
      queue: {
        enqueueSupplierFetch: async (p) => (queued.push(p), { queued: true }),
        enqueueTrendyol: async () => ({ queued: true }),
        close: async () => {},
      },
      sessionTtlMs: 3_600_000,
      secureCookies: false,
      integratorName: "SelfIntegration",
      feedDownloadOptions: { allowPrivateNetwork: true },
    };
    app = await buildApp(deps);

    users.owner = await register("owner@example.com", "A");
    users.other = await register("other@example.com", "B");
    const staff = await register("staff@example.com", "S");
    await withTenant(t.db, users.owner.tenantId, (tx) =>
      tx
        .insert(schema.tenantMembers)
        .values({ tenantId: users.owner.tenantId, userId: staff.userId, role: "staff" }),
    );
    await app.inject({
      method: "POST",
      url: "/auth/switch-tenant",
      headers: { cookie: staff.cookie },
      payload: { tenantId: users.owner.tenantId },
    });
    users.staff = { ...staff, tenantId: users.owner.tenantId };
  });

  afterAll(async () => {
    feedServer?.close();
    await app?.close();
    await drop?.();
  });

  const valid = {
    name: "Tedarikçi A",
    feedUrl: "https://tedarikci.example.com/feed.xml",
    itemPath: "/Katalog/Urunler/Urun",
    externalIdPath: "StokKodu",
    encoding: "windows-1254",
    scheduleCron: "0 * * * *",
    auth: { username: "u", password: "gizli-sifre" },
  };

  it("owner tedarikçi ekler, listeler; kimlik bilgisi dönmez", async () => {
    const res = await call("owner", "POST", "/suppliers", valid);
    expect(res.statusCode).toBe(201);
    const list = await call("owner", "GET", "/suppliers");
    expect(list.json()).toEqual([
      expect.objectContaining({
        id: res.json().id,
        name: "Tedarikçi A",
        itemPath: "/Katalog/Urunler/Urun",
        externalIdPath: "StokKodu",
        scheduleCron: "0 * * * *",
        active: true,
        syncPaused: false,
        hasAuth: true,
        lastFetchedAt: null,
      }),
    ]);
    expect(list.body).not.toContain("gizli-sifre");
    expect(list.body).not.toContain("authEnc");
  });

  it("varsayılanlarla yalnızca ad ve adresle eklenebilir", async () => {
    const res = await call("owner", "POST", "/suppliers", {
      name: "Minimal",
      feedUrl: "http://x.example.com/a.xml",
    });
    expect(res.statusCode).toBe(201);
    const s = (await call("owner", "GET", `/suppliers/${res.json().id}`)).json();
    expect(s).toMatchObject({
      itemPath: null,
      externalIdPath: null,
      scheduleCron: "*/30 * * * *",
      hasAuth: false,
    });
  });

  it.each([
    [{ feedUrl: "ftp://x.example.com/a.xml" }, "feedUrl"],
    [{ feedUrl: "javascript:alert(1)" }, "feedUrl"],
    [{ itemPath: "Urunler/Urun" }, "itemPath"],
    [{ externalIdPath: "Urun Kodu" }, "externalIdPath"],
    [{ scheduleCron: "*/5 * * * *" }, "scheduleCron"],
    [{ encoding: "latin1" }, "encoding"],
    [{ name: "" }, "name"],
  ])("geçersiz alan reddedilir: %j", async (patch, field) => {
    const res = await call("owner", "POST", "/suppliers", { ...valid, ...patch });
    expect(res.statusCode).toBe(400);
    expect(res.json().issues.map((i: { path: string }) => i.path)).toContain(field);
  });

  it("güncelleme: duraklatma, alan temizleme, kimlik bilgisini kaldırma", async () => {
    const { id } = (await call("owner", "POST", "/suppliers", valid)).json();
    const res = await call("owner", "PATCH", `/suppliers/${id}`, {
      syncPaused: true,
      encoding: null,
      auth: null,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      syncPaused: true,
      encoding: null,
      hasAuth: false,
      name: "Tedarikçi A",
    });
    expect(
      (await call("owner", "PATCH", `/suppliers/${id}`, { scheduleCron: "* * * * *" })).statusCode,
    ).toBe(400);
  });

  it("personel görüntüler ve elle çekim başlatır; ekleyemez, değiştiremez, silemez", async () => {
    const { id } = (await call("owner", "POST", "/suppliers", valid)).json();
    expect((await call("staff", "GET", "/suppliers")).statusCode).toBe(200);
    expect((await call("staff", "POST", "/suppliers", valid)).statusCode).toBe(403);
    expect((await call("staff", "PATCH", `/suppliers/${id}`, { name: "x" })).statusCode).toBe(403);
    expect((await call("staff", "DELETE", `/suppliers/${id}`)).statusCode).toBe(403);
    expect((await call("staff", "POST", "/suppliers/detect", { feedUrl })).statusCode).toBe(403);

    queued.length = 0;
    const f = await call("staff", "POST", `/suppliers/${id}/fetch`);
    expect(f.statusCode).toBe(202);
    expect(queued).toEqual([{ tenantId: users.owner.tenantId, supplierId: id, trigger: "manual" }]);
  });

  it("başka mağazanın tedarikçisi görünmez, değiştirilemez, çekilemez (404)", async () => {
    const { id } = (await call("owner", "POST", "/suppliers", valid)).json();
    expect(await (await call("other", "GET", "/suppliers")).json()).toEqual([]);
    queued.length = 0;
    for (const [m, p, body] of [
      ["GET", `/suppliers/${id}`],
      ["PATCH", `/suppliers/${id}`, { name: "ele geçirildi" }],
      ["DELETE", `/suppliers/${id}`],
      ["POST", `/suppliers/${id}/fetch`],
      ["GET", `/suppliers/${id}/products`],
    ] as const) {
      expect((await call("other", m, p, body)).statusCode, `${m} ${p}`).toBe(404);
    }
    expect(queued).toEqual([]);
    expect((await call("owner", "GET", `/suppliers/${id}`)).json().name).toBe("Tedarikçi A");
  });

  it("siler", async () => {
    const { id } = (await call("owner", "POST", "/suppliers", valid)).json();
    expect((await call("owner", "DELETE", `/suppliers/${id}`)).statusCode).toBe(204);
    expect((await call("owner", "GET", `/suppliers/${id}`)).statusCode).toBe(404);
  });

  it("ürün listesi sayfalı; toplam ve kayıp sayısıyla", async () => {
    const { id } = (await call("owner", "POST", "/suppliers", valid)).json();
    const tenantId = users.owner.tenantId;
    await withTenant(deps.db, tenantId, (tx) =>
      upsertSupplierProducts(
        tx,
        tenantId,
        id,
        Array.from({ length: 5 }, (_, i) => ({
          externalId: `S${i}`,
          raw: { Ad: `Ürün ${i}` },
          hash: `h${i}`,
        })),
      ),
    );
    await withTenant(deps.db, tenantId, (tx) =>
      // S4 kaybolmuş olsun
      tx
        .update(schema.supplierProducts)
        .set({ missingSince: new Date() })
        .where(eq(schema.supplierProducts.externalId, "S4")),
    );
    const res = await call("owner", "GET", `/suppliers/${id}/products?limit=2&offset=2`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ total: 5, missing: 1 });
    expect(body.items.map((i: { externalId: string }) => i.externalId)).toEqual(["S2", "S3"]);
    expect((await call("owner", "GET", `/suppliers/${id}/products?limit=500`)).statusCode).toBe(
      400,
    );
  });

  it("işlem geçmişi tedarikçiye göre filtrelenir ve tenant'a özeldir", async () => {
    const tenantId = users.owner.tenantId;
    await withTenant(deps.db, tenantId, async (tx) => {
      const j1 = await startJobLog(tx, tenantId, "xml_fetch", { supplierId: 101 });
      await finishJobLog(tx, j1, "success", { supplierId: 101, itemCount: 5 });
      await startJobLog(tx, tenantId, "xml_fetch", { supplierId: 202 });
    });
    const all = (await call("owner", "GET", "/jobs")).json();
    expect(all.length).toBeGreaterThanOrEqual(2);
    const filtered = (await call("owner", "GET", "/jobs?supplierId=101")).json();
    expect(filtered).toEqual([
      expect.objectContaining({
        jobType: "xml_fetch",
        status: "success",
        summary: { supplierId: 101, itemCount: 5 },
      }),
    ]);
    expect((await call("other", "GET", "/jobs")).json()).toEqual([]);
  });

  it("feed analizi ürün yolunu ve kimlik alanını önerir", async () => {
    const res = await call("owner", "POST", "/suppliers/detect", { feedUrl });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.itemPath).toBe("/Katalog/Urunler/Urun");
    expect(d.idFields.map((f: { path: string }) => f.path)).toEqual(
      expect.arrayContaining(["@id", "StokKodu"]),
    );
    expect(d.sampleItems[0]).toMatchObject({ StokKodu: "S0" });
    expect(d.sampleCount).toBe(5);
  });

  it("feed analizi: indirilemeyen adres anlaşılır hata döner; sık istek 429", async () => {
    const bad = await call("owner", "POST", "/suppliers/detect", {
      feedUrl: `${feedUrl.replace(/:\d+/, ":1")}`,
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toMatch(/Feed indirilemedi/);

    let last = 0;
    for (let i = 0; i < 12; i++)
      last = (await call("other", "POST", "/suppliers/detect", { feedUrl })).statusCode;
    expect(last).toBe(429);
  });

  describe("alan eşleştirme", () => {
    const mapping = {
      version: 1,
      variantMode: "flat",
      fields: {
        productMainId: { path: "Model" },
        title: { path: "Ad" },
        barcode: { path: "Barkod" },
        stock: { path: "Stok" },
      },
    };

    async function supplierWithRaw() {
      const { id } = (await call("owner", "POST", "/suppliers", valid)).json();
      const tenantId = users.owner.tenantId;
      await withTenant(deps.db, tenantId, (tx) =>
        upsertSupplierProducts(tx, tenantId, id, [
          {
            externalId: "1",
            raw: { Model: "M1", Ad: "Ürün", Barkod: "B-1", Stok: "4" },
            hash: "h1",
          },
          {
            externalId: "2",
            raw: { Model: "M2", Ad: "Ürün 2", Barkod: "B/2", Stok: "1" },
            hash: "h2",
          },
        ]),
      );
      return id as number;
    }

    it("önizleme kaydetmeden kanonik çıktıyı ve sorunları gösterir", async () => {
      const id = await supplierWithRaw();
      const res = await call("staff", "POST", `/suppliers/${id}/mapping/preview`, {
        mapping,
        limit: 10,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ total: 2, sampled: 2, valid: 1 });
      expect(body.items[0]).toMatchObject({
        externalId: "1",
        product: { productMainId: "M1", variants: [{ barcode: "B-1", stock: 4 }] },
        issues: [],
      });
      expect(body.items[1].product).toBeNull();
      expect(body.items[1].issues[0]).toMatchObject({ field: "barcode", code: "invalid_chars" });
      expect(body.items[0].createMissing).toEqual(expect.arrayContaining(["brandName", "images"]));
      // Önizleme kaydetmez.
      expect((await call("owner", "GET", `/suppliers/${id}`)).json().mapping).toBeNull();
    });

    it("owner kaydeder; çekim kuyruğa eklenir; staff kaydedemez", async () => {
      const id = await supplierWithRaw();
      queued.length = 0;
      expect((await call("staff", "PUT", `/suppliers/${id}/mapping`, mapping)).statusCode).toBe(
        403,
      );
      const res = await call("owner", "PUT", `/suppliers/${id}/mapping`, mapping);
      expect(res.statusCode).toBe(200);
      expect(res.json().mapping).toMatchObject({
        variantMode: "flat",
        missingPolicy: "zero_stock",
      });
      expect(queued).toEqual([
        { tenantId: users.owner.tenantId, supplierId: id, trigger: "manual" },
      ]);
    });

    it.each([
      [{ ...mapping, fields: { stock: { path: "Stok" } } }, "fields.barcode"],
      [{ ...mapping, variantMode: "nested" }, "variantPath"],
      [
        { ...mapping, fields: { ...mapping.fields, barcode: { path: "B", constant: "x" } } },
        "fields.barcode",
      ],
    ])("geçersiz eşleştirme 400: %j", async (bad, pathPrefix) => {
      const id = await supplierWithRaw();
      const res = await call("owner", "PUT", `/suppliers/${id}/mapping`, bad);
      expect(res.statusCode).toBe(400);
      expect(res.json().issues.some((i: { path: string }) => i.path.startsWith(pathPrefix))).toBe(
        true,
      );
    });

    it("rapor ve eşleştirme uçları başka mağazaya kapalı", async () => {
      const id = await supplierWithRaw();
      expect((await call("other", "GET", `/suppliers/${id}/report`)).statusCode).toBe(404);
      expect(
        (await call("other", "POST", `/suppliers/${id}/mapping/preview`, { mapping })).statusCode,
      ).toBe(404);
      expect((await call("other", "PUT", `/suppliers/${id}/mapping`, mapping)).statusCode).toBe(
        404,
      );
      const report = await call("owner", "GET", `/suppliers/${id}/report`);
      expect(report.json()).toMatchObject({ supplierProducts: 2, normalized: 0, variants: 0 });
    });
  });
});
