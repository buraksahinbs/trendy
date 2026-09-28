import { randomBytes } from "node:crypto";
import {
  createSupplier,
  schema,
  supplierValidationReport,
  upsertSupplierProducts,
  withTenant,
  type Db,
} from "@trendy/db";
import { createTestDatabase } from "@trendy/db/testing";
import { createSecretBox } from "@trendy/shared";
import { contentHash, type MappingConfig } from "@trendy/xml-ingest";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeSupplier } from "./normalize.js";

const url = process.env.DATABASE_URL;

const flatMapping: MappingConfig = {
  version: 1,
  variantMode: "flat",
  missingPolicy: "zero_stock",
  fields: {
    productMainId: { path: "Model" },
    title: { path: "Ad" },
    brandName: { path: "Marka" },
    barcode: { path: "Barkod" },
    stock: { path: "Stok" },
    costPrice: { path: "Fiyat" },
  },
  attributes: [{ name: "Beden", mapping: { path: "Beden" } }],
};

const nestedMapping: MappingConfig = {
  version: 1,
  variantMode: "nested",
  variantPath: "V",
  missingPolicy: "zero_stock",
  fields: {
    productMainId: { path: "@kod" },
    title: { path: "Ad" },
    barcode: { path: "@b" },
    stock: { path: "@s" },
  },
};

describe.skipIf(!url)("normalizasyon", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let tenantId: number;
  const box = createSecretBox({ 1: randomBytes(32).toString("base64") }, 1);

  beforeAll(async () => {
    const t = await createTestDatabase(url!);
    db = t.db;
    drop = t.drop;
    const [tenant] = await db
      .insert(schema.tenants)
      .values({ name: "A" })
      .returning({ id: schema.tenants.id });
    tenantId = tenant!.id;
  });
  afterAll(async () => {
    await drop?.();
  });

  const tx = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, tenantId, fn);
  const newSupplier = (mapping: MappingConfig | null) =>
    tx((t) =>
      createSupplier(t, box, tenantId, {
        name: "T",
        feedUrl: "https://x.example.com/f.xml",
      }).then(async (id) => {
        await t.update(schema.suppliers).set({ mapping }).where(eq(schema.suppliers.id, id));
        return id;
      }),
    );
  const seed = (supplierId: number, items: Record<string, unknown>[]) =>
    tx((t) =>
      upsertSupplierProducts(
        t,
        tenantId,
        supplierId,
        items.map((raw) => ({
          externalId: String(raw.id),
          raw,
          hash: contentHash(raw),
        })),
      ),
    );
  const variantByBarcode = async (barcode: string) =>
    (
      await tx((t) => t.select().from(schema.variants).where(eq(schema.variants.barcode, barcode)))
    )[0];

  it("eşleştirme yoksa atlanır", async () => {
    const s = await newSupplier(null);
    expect((await normalizeSupplier(db, tenantId, s)).skipped).toBe("mapping_missing");
  });

  it("geçersiz eşleştirme atlanır", async () => {
    const s = await newSupplier({ version: 1 } as unknown as MappingConfig);
    expect((await normalizeSupplier(db, tenantId, s)).skipped).toBe("mapping_invalid");
  });

  it("flat: aynı model kodundaki öğeler tek ürünün varyantları olur; hatalar raporlanır", async () => {
    const s = await newSupplier(flatMapping);
    await seed(s, [
      {
        id: 1,
        Model: "TS-1",
        Ad: "Tişört",
        Marka: "M",
        Barkod: "F-S",
        Stok: "3",
        Fiyat: "100",
        Beden: "S",
      },
      {
        id: 2,
        Model: "TS-1",
        Ad: "Tişört",
        Marka: "M",
        Barkod: "F-M",
        Stok: "0",
        Fiyat: "100",
        Beden: "M",
      },
      { id: 3, Model: "TS-2", Ad: "Diğer", Barkod: "F/X", Stok: "1" },
    ]);
    const r = await normalizeSupplier(db, tenantId, s);
    expect(r).toMatchObject({
      processed: 3,
      products: 2,
      variants: 2,
      itemsWithErrors: 1,
      conflicts: 0,
    });

    const vs = await tx((t) => t.select().from(schema.variants));
    const byBarcode = new Map(vs.map((v) => [v.barcode, v]));
    expect(byBarcode.get("F-S")).toMatchObject({
      stock: 3,
      costPrice: 10000,
      currency: "TRY",
      attributes: { Beden: "S" },
    });
    expect(byBarcode.get("F-S")!.productId).toBe(byBarcode.get("F-M")!.productId);

    const report = await tx((t) => supplierValidationReport(t, s));
    expect(report).toMatchObject({
      supplierProducts: 3,
      normalized: 3,
      withErrors: 1,
      products: 1,
      variants: 2,
    });
    expect(report.issues).toContainEqual({
      level: "error",
      field: "barcode",
      code: "invalid_chars",
      count: 1,
    });

    // Değişiklik yok: hiçbir şey yeniden işlenmez.
    expect((await normalizeSupplier(db, tenantId, s)).processed).toBe(0);

    // Tek öğe değişir: yalnızca o işlenir.
    await seed(s, [
      {
        id: 1,
        Model: "TS-1",
        Ad: "Tişört",
        Marka: "M",
        Barkod: "F-S",
        Stok: "9",
        Fiyat: "100",
        Beden: "S",
      },
    ]);
    expect(await normalizeSupplier(db, tenantId, s)).toMatchObject({ processed: 1, variants: 1 });
    expect((await variantByBarcode("F-S"))!.stock).toBe(9);

    // Eşleştirme değişir: hepsi yeniden işlenir.
    await tx((t) =>
      t
        .update(schema.suppliers)
        .set({ mapping: { ...flatMapping, attributes: [] } })
        .where(eq(schema.suppliers.id, s)),
    );
    expect((await normalizeSupplier(db, tenantId, s)).processed).toBe(3);
    expect((await variantByBarcode("F-S"))!.attributes).toEqual({});
  });

  it("başka tedarikçinin barkodu ve model kodu çakışma olarak raporlanır, mevcut kayıt korunur", async () => {
    const s1 = await newSupplier(flatMapping);
    const s2 = await newSupplier(flatMapping);
    await seed(s1, [{ id: 1, Model: "C-1", Ad: "A", Barkod: "CONF-1", Stok: "5" }]);
    await normalizeSupplier(db, tenantId, s1);

    await seed(s2, [
      { id: 1, Model: "C-OTHER", Ad: "B", Barkod: "CONF-1", Stok: "99" },
      { id: 2, Model: "C-1", Ad: "B", Barkod: "CONF-2", Stok: "7" },
    ]);
    const r = await normalizeSupplier(db, tenantId, s2);
    expect(r.conflicts).toBe(2);
    expect((await variantByBarcode("CONF-1"))!.stock).toBe(5);
    expect(await variantByBarcode("CONF-2")).toBeUndefined();
    const report = await tx((t) => supplierValidationReport(t, s2));
    expect(report.issues.map((i) => `${i.field}:${i.code}`).sort()).toEqual([
      "barcode:conflict",
      "productMainId:conflict",
    ]);
  });

  it("nested: üründen çıkan varyant silinmez, sahipliği bırakılır ve stoğu 0 olur", async () => {
    const s = await newSupplier(nestedMapping);
    await seed(s, [
      {
        id: 1,
        "@kod": "N-1",
        Ad: "Ayakkabı",
        V: [
          { "@b": "N-40", "@s": "4" },
          { "@b": "N-41", "@s": "6" },
        ],
      },
    ]);
    await normalizeSupplier(db, tenantId, s);
    expect((await variantByBarcode("N-41"))!.stock).toBe(6);

    await seed(s, [{ id: 1, "@kod": "N-1", Ad: "Ayakkabı", V: [{ "@b": "N-40", "@s": "4" }] }]);
    const r = await normalizeSupplier(db, tenantId, s);
    expect(r).toMatchObject({ processed: 1, orphaned: 1 });
    expect(await variantByBarcode("N-41")).toMatchObject({ stock: 0, supplierProductId: null });
    expect((await variantByBarcode("N-40"))!.stock).toBe(4);
  });

  it("tüm varyantları geçersizleşen öğenin varyantları da 0'lanır", async () => {
    const s = await newSupplier(flatMapping);
    await seed(s, [{ id: 1, Model: "Z-1", Ad: "Z", Barkod: "Z-1", Stok: "8" }]);
    await normalizeSupplier(db, tenantId, s);
    await seed(s, [{ id: 1, Model: "Z-1", Ad: "Z", Barkod: "Z-1", Stok: "bilinmiyor" }]);
    const r = await normalizeSupplier(db, tenantId, s);
    expect(r).toMatchObject({ itemsWithErrors: 1, orphaned: 1 });
    expect(await variantByBarcode("Z-1")).toMatchObject({ stock: 0, supplierProductId: null });
  });

  it("sahipsiz kayıtlar (ör. Trendyol'dan içe aktarılan) sahiplenilir", async () => {
    const [p] = await tx((t) =>
      t
        .insert(schema.products)
        .values({ tenantId, productMainId: "IMP-1", title: "İçe aktarılan" })
        .returning({ id: schema.products.id }),
    );
    await tx((t) =>
      t.insert(schema.variants).values({ tenantId, productId: p!.id, barcode: "IMP-B", stock: 0 }),
    );
    const s = await newSupplier(flatMapping);
    await seed(s, [{ id: 1, Model: "IMP-1", Ad: "Tedarikçiden", Barkod: "IMP-B", Stok: "11" }]);
    const r = await normalizeSupplier(db, tenantId, s);
    expect(r).toMatchObject({ conflicts: 0, variants: 1 });
    const v = await variantByBarcode("IMP-B");
    expect(v).toMatchObject({ stock: 11, productId: p!.id });
    expect(v!.supplierProductId).not.toBeNull();
  });

  it("kaybolan ham ürün normalize edilmez (stoğu senkronda politikaya göre belirlenir)", async () => {
    const s = await newSupplier(flatMapping);
    await seed(s, [{ id: 1, Model: "L-1", Ad: "L", Barkod: "L-1", Stok: "2" }]);
    await tx((t) =>
      t
        .update(schema.supplierProducts)
        .set({ missingSince: new Date() })
        .where(eq(schema.supplierProducts.supplierId, s)),
    );
    expect((await normalizeSupplier(db, tenantId, s)).processed).toBe(0);
  });
});
