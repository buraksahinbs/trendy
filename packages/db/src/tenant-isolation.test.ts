import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Db } from "./client.js";
import {
  channelListings,
  orders,
  products,
  suppliers,
  tenants,
  TENANT_TABLES,
  users,
  variants,
} from "./schema.js";
import { createTestDatabase } from "./testing.js";

/**
 * Tenant izolasyon testleri (ROADMAP Faz 1 kabul kriteri, §7).
 * Gerçek PostgreSQL gerekir; DATABASE_URL yoksa atlanır.
 */
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("tenant izolasyonu", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let a: number;
  let b: number;
  let productB: number;
  let variantB: number;

  beforeAll(async () => {
    const t = await createTestDatabase(url!);
    db = t.db;
    drop = t.drop;
    [{ id: a }, { id: b }] = (await db
      .insert(tenants)
      .values([{ name: "A" }, { name: "B" }])
      .returning({ id: tenants.id })) as [{ id: number }, { id: number }];

    await withTenant(db, a, (tx) =>
      tx.insert(products).values({ tenantId: a, productMainId: "M-A", title: "A ürünü" }),
    );
    await withTenant(db, b, async (tx) => {
      const [p] = await tx
        .insert(products)
        .values({ tenantId: b, productMainId: "M-B", title: "B ürünü" })
        .returning();
      productB = p!.id;
      const [v] = await tx
        .insert(variants)
        .values({ tenantId: b, productId: productB, barcode: "B1", stock: 5 })
        .returning();
      variantB = v!.id;
      await tx.insert(orders).values({
        tenantId: b,
        shipmentPackageId: "1",
        orderNumber: "O1",
        status: "Created",
        lastModifiedAt: new Date(),
        raw: { customer: "kişisel veri" },
      });
    });
  });

  afterAll(async () => {
    await drop?.();
  });

  it("tenant yalnızca kendi satırlarını görür", async () => {
    const seenByA = await withTenant(db, a, (tx) => tx.select().from(products));
    expect(seenByA.map((p) => p.productMainId)).toEqual(["M-A"]);
    const ordersSeenByA = await withTenant(db, a, (tx) => tx.select().from(orders));
    expect(ordersSeenByA).toEqual([]);
  });

  it("id ile doğrudan sorgu da başka tenant'ın satırını döndürmez", async () => {
    const rows = await withTenant(db, a, (tx) =>
      tx.select().from(products).where(eq(products.id, productB)),
    );
    expect(rows).toEqual([]);
  });

  it("başka tenant'ın satırını güncelleyemez ve silemez", async () => {
    await withTenant(db, a, async (tx) => {
      const upd = await tx
        .update(variants)
        .set({ stock: 0 })
        .where(eq(variants.id, variantB))
        .returning();
      expect(upd).toEqual([]);
      const del = await tx.delete(products).where(eq(products.id, productB)).returning();
      expect(del).toEqual([]);
    });
    const [v] = await withTenant(db, b, (tx) =>
      tx.select().from(variants).where(eq(variants.id, variantB)),
    );
    expect(v!.stock).toBe(5);
  });

  it("başka tenant adına satır ekleyemez", async () => {
    await expect(
      withTenant(db, a, (tx) =>
        tx.insert(products).values({ tenantId: b, productMainId: "SIZMA", title: "x" }),
      ),
    ).rejects.toThrow();
  });

  it("satırını başka tenant'a taşıyamaz", async () => {
    await expect(
      withTenant(db, a, (tx) =>
        tx.update(products).set({ tenantId: b }).where(eq(products.productMainId, "M-A")),
      ),
    ).rejects.toThrow();
  });

  it("kendi satırını başka tenant'ın kaydına bağlayamaz (bileşik FK)", async () => {
    // A, B'nin ürün id'sini tahmin edip kendi varyantını ona bağlamaya çalışır.
    await expect(
      withTenant(db, a, (tx) =>
        tx.insert(variants).values({ tenantId: a, productId: productB, barcode: "X" }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(db, a, (tx) =>
        tx.insert(channelListings).values({ tenantId: a, variantId: variantB }),
      ),
    ).rejects.toThrow();
  });

  it("tenant bağlamı olmadan uygulama rolü hiçbir satır görmez", async () => {
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE trendy_app`);
      return tx.select().from(products);
    });
    expect(rows).toEqual([]);
  });

  it("uygulama rolü parola hash'ini okuyamaz", async () => {
    await db.insert(users).values({ email: "a@example.com", passwordHash: "hash" });
    await expect(
      withTenant(db, a, (tx) => tx.select({ h: users.passwordHash }).from(users)),
    ).rejects.toThrow();
  });

  it("tenant bağlamı işlem bitince bağlantıya sızmaz", async () => {
    await withTenant(db, a, (tx) => tx.select().from(products));
    const [row] = await db.execute<{ role: string; tenant: string | null }>(
      sql`SELECT current_user AS role, current_setting('app.tenant_id', true) AS tenant`,
    );
    expect(row!.role).not.toBe("trendy_app");
    expect(row!.tenant ?? "").toBe("");
  });

  it("TENANT_TABLES'taki her tabloda RLS açık ve politika var", async () => {
    const rows = await db.execute<{ table: string; rls: boolean; policies: number }>(sql`
      SELECT c.relname AS table, c.relrowsecurity AS rls,
             (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    `);
    const byName = new Map(rows.map((r) => [r.table, r]));
    for (const t of TENANT_TABLES) {
      expect(byName.get(t), t).toMatchObject({ rls: true, policies: 1 });
    }
  });

  it("tenant_id sütunu olan her tablo TENANT_TABLES'ta (unutulan tablo yok)", async () => {
    const rows = await db.execute<{ table: string }>(sql`
      SELECT table_name AS table FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'tenant_id'
    `);
    expect(rows.map((r) => r.table).sort()).toEqual([...TENANT_TABLES].sort());
  });

  it("tedarikçi silinince ürün kalır, bağlantısı boşalır (tenant_id korunur)", async () => {
    await withTenant(db, a, async (tx) => {
      const [s] = await tx
        .insert(suppliers)
        .values({ tenantId: a, name: "T", feedUrl: "https://example.com/feed.xml" })
        .returning();
      const [p] = await tx
        .insert(products)
        .values({ tenantId: a, supplierId: s!.id, productMainId: "M-S", title: "t" })
        .returning();
      await tx.delete(suppliers).where(eq(suppliers.id, s!.id));
      const [after] = await tx.select().from(products).where(eq(products.id, p!.id));
      expect(after).toMatchObject({ supplierId: null, tenantId: a });
    });
  });

  it("geçersiz tenantId reddedilir", async () => {
    await expect(withTenant(db, 0, async () => 1)).rejects.toThrow(/tenantId/);
    await expect(withTenant(db, 1.5, async () => 1)).rejects.toThrow(/tenantId/);
  });
});
