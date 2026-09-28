import { randomBytes } from "node:crypto";
import { createSecretBox } from "@trendy/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Db } from "./client.js";
import {
  loadTrendyolCredentials,
  markTrendyolCredentialsVerified,
  rotateTrendyolCredentials,
  saveTrendyolCredentials,
} from "./credentials.js";
import { tenants, trendyolCredentials } from "./schema.js";
import { createTestDatabase } from "./testing.js";

const url = process.env.DATABASE_URL;
const k1 = randomBytes(32).toString("base64");
const k2 = randomBytes(32).toString("base64");

describe.skipIf(!url)("Trendyol API bilgileri", () => {
  let db: Db;
  let drop: () => Promise<void>;
  let a: number;
  let b: number;
  const box = createSecretBox({ 1: k1 }, 1);
  const creds = { env: "prod", sellerId: "1234", apiKey: "KEY-A", apiSecret: "SECRET-A" } as const;

  beforeAll(async () => {
    const t = await createTestDatabase(url!);
    db = t.db;
    drop = t.drop;
    [{ id: a }, { id: b }] = (await db
      .insert(tenants)
      .values([{ name: "A" }, { name: "B" }])
      .returning({ id: tenants.id })) as [{ id: number }, { id: number }];
  });

  afterAll(async () => {
    await drop?.();
  });

  it("şifreli kaydeder, çözerek okur", async () => {
    await withTenant(db, a, (tx) => saveTrendyolCredentials(tx, box, { tenantId: a, ...creds }));
    const [raw] = await db.select().from(trendyolCredentials);
    expect(raw!.apiKeyEnc).not.toContain("KEY-A");
    expect(raw!.apiSecretEnc).not.toContain("SECRET-A");

    const loaded = await withTenant(db, a, (tx) => loadTrendyolCredentials(tx, box, a, "prod"));
    expect(loaded).toMatchObject({ sellerId: "1234", apiKey: "KEY-A", apiSecret: "SECRET-A" });
    expect(loaded!.verifiedAt).toBeNull();
  });

  it("bilgi değişince doğrulama sıfırlanır", async () => {
    await withTenant(db, a, (tx) => markTrendyolCredentialsVerified(tx, a, "prod"));
    let loaded = await withTenant(db, a, (tx) => loadTrendyolCredentials(tx, box, a, "prod"));
    expect(loaded!.verifiedAt).toBeInstanceOf(Date);

    await withTenant(db, a, (tx) =>
      saveTrendyolCredentials(tx, box, { tenantId: a, ...creds, apiSecret: "YENI" }),
    );
    loaded = await withTenant(db, a, (tx) => loadTrendyolCredentials(tx, box, a, "prod"));
    expect(loaded).toMatchObject({ apiSecret: "YENI", verifiedAt: null });
  });

  it("başka tenant okuyamaz; şifreli değer başka satıra kopyalansa da çözülemez", async () => {
    expect(
      await withTenant(db, b, (tx) => loadTrendyolCredentials(tx, box, a, "prod")),
    ).toBeUndefined();

    // Sistem bağlantısıyla A'nın şifreli değerlerini B'nin satırına kopyala (saldırı senaryosu).
    const [rowA] = await db.select().from(trendyolCredentials);
    await db.insert(trendyolCredentials).values({ ...rowA!, tenantId: b });
    await expect(
      withTenant(db, b, (tx) => loadTrendyolCredentials(tx, box, b, "prod")),
    ).rejects.toThrow(/çözülemedi/);
    await db.delete(trendyolCredentials);
  });

  it("anahtar rotasyonu eski kayıtları yeniden şifreler", async () => {
    await withTenant(db, a, (tx) => saveTrendyolCredentials(tx, box, { tenantId: a, ...creds }));
    const rotatedBox = createSecretBox({ 1: k1, 2: k2 }, 2);
    expect(await withTenant(db, a, (tx) => rotateTrendyolCredentials(tx, rotatedBox))).toBe(1);
    expect(await withTenant(db, a, (tx) => rotateTrendyolCredentials(tx, rotatedBox))).toBe(0);

    const [raw] = await db.select().from(trendyolCredentials);
    expect(raw!.apiKeyEnc.startsWith("v2:")).toBe(true);
    const onlyNew = createSecretBox({ 2: k2 }, 2);
    const loaded = await withTenant(db, a, (tx) => loadTrendyolCredentials(tx, onlyNew, a, "prod"));
    expect(loaded!.apiKey).toBe("KEY-A");
  });

  it("geçersiz sellerId reddedilir", async () => {
    await expect(
      withTenant(db, a, (tx) =>
        saveTrendyolCredentials(tx, box, { tenantId: a, ...creds, sellerId: "12a" }),
      ),
    ).rejects.toThrow(/sellerId/);
  });
});
