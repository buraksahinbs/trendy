import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Veri modeli (ROADMAP §4).
 *
 * Kurallar:
 * - Tenant'a ait HER tabloda `tenant_id` var (alt tablolarda da, ör. `variants`); RLS politikası
 *   tek tip olsun ve bir tablo "üst tablo üzerinden" korunmaya bırakılmasın.
 * - Para tutarları kuruş cinsinden tamsayı (DECISIONS: para hesabı).
 * - Barkodlar normalize edilmiş hâliyle saklanır (`normalizeBarcode`).
 * - Tenant'a ait tablolar `TENANT_TABLES` listesinde; RLS migration'ı ve testler bu listeyi kullanır.
 */

const id = () => bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity();
const tenantId = () =>
  bigint("tenant_id", { mode: "number" })
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();

// ── Enum'lar ──────────────────────────────────────────────────────────────────

export const listingTier = pgEnum("listing_tier", ["50k", "75k", "150k", "500k", "unlimited"]);
export const memberRole = pgEnum("member_role", ["owner", "staff"]);
export const trendyolEnv = pgEnum("trendyol_env", ["stage", "prod"]);
export const pricingScope = pgEnum("pricing_scope", ["brand", "category", "supplier", "general"]);
export const listingStatus = pgEnum("listing_status", [
  "unknown",
  "pending",
  "approved",
  "rejected",
  "locked",
  "archived",
]);
export const batchType = pgEnum("batch_type", ["create", "update", "price_inventory"]);
export const batchStatus = pgEnum("batch_status", ["pending", "completed", "failed", "expired"]);
export const jobStatus = pgEnum("job_status", ["running", "success", "failed", "skipped"]);
export const priceReviewStatus = pgEnum("price_review_status", ["pending", "approved", "rejected"]);

// ── Global tablolar (RLS yok) ────────────────────────────────────────────────

export const tenants = pgTable("tenants", {
  id: id(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("trial"),
  /** ⚠️ DOĞRULA #7: API'den öğrenilemiyor; satıcı ayarlardan seçer. Varsayılan en düşük seviye. */
  listingLimitTier: listingTier("listing_limit_tier").notNull().default("50k"),
  /** Acil durdurma (Faz 9): tenant'ın tüm senkronu. */
  syncPaused: boolean("sync_paused").notNull().default(false),
  createdAt: createdAt(),
});

/**
 * Kullanıcılar tenant'tan bağımsızdır: giriş sırasında tenant henüz bilinmez.
 * Tenant bağlantısı ve rol `tenant_members` tablosundadır.
 */
export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`)],
);

/**
 * Sunucu tarafı oturumlar. Tarayıcıdaki token'ın kendisi değil SHA-256 özeti saklanır;
 * veritabanı sızsa bile oturum ele geçirilemez. Çıkışta veya şifre değişince satır silinir.
 * Sütun adı bilinçli olarak `tenant_id` değil: bu tablo sistem bağlantısıyla okunur, RLS dışıdır.
 */
export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activeTenantId: bigint("active_tenant_id", { mode: "number" }).references(() => tenants.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [index().on(t.userId), index().on(t.expiresAt)],
);

// ── Tenant tabloları (RLS) ───────────────────────────────────────────────────

export const tenantMembers = pgTable(
  "tenant_members",
  {
    tenantId: tenantId(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] }), index().on(t.userId)],
);

/** API bilgileri `SecretBox` ile şifreli; bağlam: `tenant:{id}:trendyol:{env}:{alan}`. */
export const trendyolCredentials = pgTable(
  "trendyol_credentials",
  {
    tenantId: tenantId(),
    env: trendyolEnv("env").notNull(),
    sellerId: text("seller_id").notNull(),
    apiKeyEnc: text("api_key_enc").notNull(),
    apiSecretEnc: text("api_secret_enc").notNull(),
    verifiedAt: ts("verified_at"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.env] })],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    feedUrl: text("feed_url").notNull(),
    /** Opsiyonel feed kimlik bilgisi (JSON), `SecretBox` ile şifreli. */
    authEnc: text("auth_enc"),
    /** XML deklarasyonu yoksa kullanılacak kodlama. */
    encoding: text("encoding"),
    /** Tekrarlayan ürün düğümünün yolu, ör. `/Urunler/Urun`. */
    itemPath: text("item_path"),
    /** Ürün düğümü içindeki tekil kimlik alanı (`getAtPath` yolu), ör. `UrunKodu`, `@id`. */
    externalIdPath: text("external_id_path"),
    scheduleCron: text("schedule_cron").notNull().default("*/30 * * * *"),
    active: boolean("active").notNull().default(true),
    /** Acil durdurma (Faz 9): yalnızca bu tedarikçi. */
    syncPaused: boolean("sync_paused").notNull().default(false),
    etag: text("etag"),
    lastModified: text("last_modified"),
    lastFetchedAt: ts("last_fetched_at"),
    /** Başarılı olsun olmasın son çekim denemesi; zamanlayıcı buna bakar (başarısız feed dakikada bir denenmesin). */
    lastAttemptAt: ts("last_attempt_at"),
    /** Güvenlik freni (`checkFeedShrink`) için bir önceki çekimdeki ürün sayısı. */
    lastItemCount: integer("last_item_count"),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.tenantId)],
);

export const supplierFieldMappings = pgTable(
  "supplier_field_mappings",
  {
    id: id(),
    tenantId: tenantId(),
    supplierId: bigint("supplier_id", { mode: "number" })
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    targetField: text("target_field").notNull(),
    sourcePath: text("source_path"),
    constantValue: text("constant_value"),
    transform: jsonb("transform"),
  },
  (t) => [uniqueIndex().on(t.supplierId, t.targetField), index().on(t.tenantId)],
);

export const supplierProducts = pgTable(
  "supplier_products",
  {
    id: id(),
    tenantId: tenantId(),
    supplierId: bigint("supplier_id", { mode: "number" })
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    raw: jsonb("raw").notNull(),
    hash: text("hash").notNull(),
    firstSeenAt: createdAt(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    /** Feed'de artık yoksa ilk kaybolduğu an (kaybolan ürün politikası, Faz 4). */
    missingSince: ts("missing_since"),
  },
  (t) => [uniqueIndex().on(t.supplierId, t.externalId), index().on(t.tenantId)],
);

/** Kanonik ana ürün (Trendyol content karşılığı). */
export const products = pgTable(
  "products",
  {
    id: id(),
    tenantId: tenantId(),
    supplierId: bigint("supplier_id", { mode: "number" }).references(() => suppliers.id, {
      onDelete: "set null",
    }),
    productMainId: text("product_main_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    brandName: text("brand_name"),
    sourceCategory: text("source_category"),
    brandIdTy: integer("brand_id_ty"),
    categoryIdTy: integer("category_id_ty"),
    origin: text("origin"),
    vatRate: smallint("vat_rate"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.tenantId, t.productMainId)],
);

/** Kanonik varyant (barkod). */
export const variants = pgTable(
  "variants",
  {
    id: id(),
    tenantId: tenantId(),
    productId: bigint("product_id", { mode: "number" })
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    supplierProductId: bigint("supplier_product_id", { mode: "number" }).references(
      () => supplierProducts.id,
      { onDelete: "set null" },
    ),
    barcode: text("barcode").notNull(),
    stockCode: text("stock_code"),
    costPrice: integer("cost_price"),
    currency: char("currency", { length: 3 }).notNull().default("TRY"),
    stock: integer("stock").notNull().default(0),
    attributes: jsonb("attributes").notNull().default({}),
    images: jsonb("images").notNull().default([]),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.tenantId, t.barcode), index().on(t.productId)],
);

/** `@trendy/pricing` `PricingRule` ile birebir; kuruş alanları tamsayı. */
export const pricingRules = pgTable(
  "pricing_rules",
  {
    id: id(),
    tenantId: tenantId(),
    scope: pricingScope("scope").notNull(),
    scopeKey: text("scope_key"),
    multiplier: numeric("multiplier", { precision: 8, scale: 4, mode: "number" }).notNull(),
    addFixed: integer("add_fixed").notNull().default(0),
    /** `Rounding`: `{ kind: "none" }` veya `{ kind: "ending", kurus }`. */
    rounding: jsonb("rounding").notNull().default({ kind: "none" }),
    minMarginRate: numeric("min_margin_rate", { precision: 6, scale: 4, mode: "number" }),
    commissionRate: numeric("commission_rate", { precision: 6, scale: 4, mode: "number" }),
    minPrice: integer("min_price"),
    maxPrice: integer("max_price"),
    /** `ListPriceRule`: `{ kind: "same" }` veya `{ kind: "multiplier", value }`. */
    listPriceRule: jsonb("list_price_rule").notNull().default({ kind: "same" }),
    createdAt: createdAt(),
  },
  (t) => [
    // Aynı kapsamda tek kural; "general" için scope_key NULL olduğundan ayrı indeks.
    uniqueIndex("pricing_rules_scope_uq")
      .on(t.tenantId, t.scope, t.scopeKey)
      .where(sql`${t.scopeKey} IS NOT NULL`),
    uniqueIndex("pricing_rules_general_uq")
      .on(t.tenantId)
      .where(sql`${t.scope} = 'general'`),
  ],
);

/** Varyantın Trendyol'daki durumu ve son gönderilen değerler (diff senkronunun temeli). */
export const channelListings = pgTable(
  "channel_listings",
  {
    variantId: bigint("variant_id", { mode: "number" })
      .primaryKey()
      .references(() => variants.id, { onDelete: "cascade" }),
    tenantId: tenantId(),
    tyStatus: listingStatus("ty_status").notNull().default("unknown"),
    lastSentPrice: integer("last_sent_price"),
    lastSentListPrice: integer("last_sent_list_price"),
    lastSentStock: integer("last_sent_stock"),
    lastSentAt: ts("last_sent_at"),
    rejectReasons: jsonb("reject_reasons"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index().on(t.tenantId, t.tyStatus)],
);

/** Guardrail'e takılan fiyat değişiklikleri (Faz 7 onay kuyruğu). */
export const priceReviews = pgTable(
  "price_reviews",
  {
    id: id(),
    tenantId: tenantId(),
    variantId: bigint("variant_id", { mode: "number" })
      .notNull()
      .references(() => variants.id, { onDelete: "cascade" }),
    oldPrice: integer("old_price"),
    newPrice: integer("new_price").notNull(),
    newListPrice: integer("new_list_price").notNull(),
    changeRate: numeric("change_rate", { precision: 8, scale: 4, mode: "number" }).notNull(),
    ruleId: bigint("rule_id", { mode: "number" }),
    status: priceReviewStatus("status").notNull().default("pending"),
    createdAt: createdAt(),
    decidedAt: ts("decided_at"),
    decidedBy: bigint("decided_by", { mode: "number" }).references(() => users.id),
  },
  (t) => [
    // Varyant başına tek bekleyen inceleme; yenisi gelirse eskisi güncellenir.
    uniqueIndex("price_reviews_pending_uq")
      .on(t.variantId)
      .where(sql`${t.status} = 'pending'`),
    index().on(t.tenantId, t.status),
  ],
);

export const tyBatches = pgTable(
  "ty_batches",
  {
    id: id(),
    tenantId: tenantId(),
    type: batchType("type").notNull(),
    batchRequestId: text("batch_request_id").notNull(),
    itemCount: integer("item_count").notNull(),
    status: batchStatus("status").notNull().default("pending"),
    sentAt: ts("sent_at").notNull().defaultNow(),
    completedAt: ts("completed_at"),
    result: jsonb("result"),
  },
  (t) => [uniqueIndex().on(t.tenantId, t.batchRequestId), index().on(t.status, t.sentAt)],
);

export const orders = pgTable(
  "orders",
  {
    id: id(),
    tenantId: tenantId(),
    shipmentPackageId: text("shipment_package_id").notNull(),
    orderNumber: text("order_number").notNull(),
    status: text("status").notNull(),
    packageTotalPrice: integer("package_total_price"),
    lastModifiedAt: ts("last_modified_at").notNull(),
    /** Kişisel veri içerir (Faz 10): saklama süresi politikası uygulanacak. */
    raw: jsonb("raw").notNull(),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex().on(t.tenantId, t.shipmentPackageId),
    index().on(t.tenantId, t.lastModifiedAt),
  ],
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: id(),
    tenantId: tenantId(),
    orderId: bigint("order_id", { mode: "number" })
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    lineId: text("line_id").notNull(),
    barcode: text("barcode"),
    stockCode: text("stock_code"),
    quantity: integer("quantity").notNull(),
    lineUnitPrice: integer("line_unit_price"),
    commissionRate: numeric("commission_rate", { precision: 6, scale: 2, mode: "number" }),
    vatRate: smallint("vat_rate"),
  },
  (t) => [uniqueIndex().on(t.orderId, t.lineId), index().on(t.tenantId, t.barcode)],
);

export const syncCursors = pgTable(
  "sync_cursors",
  {
    tenantId: tenantId(),
    kind: text("kind").notNull(),
    lastSyncedUntil: ts("last_synced_until").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.kind] })],
);

export const jobLogs = pgTable(
  "job_logs",
  {
    id: id(),
    tenantId: tenantId(),
    jobType: text("job_type").notNull(),
    status: jobStatus("status").notNull(),
    summary: jsonb("summary"),
    error: text("error"),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index().on(t.tenantId, t.startedAt)],
);

/** RLS ile korunan tablolar. Yeni tenant tablosu eklenince buraya ve RLS migration'ına eklenmeli. */
export const TENANT_TABLES = [
  "tenant_members",
  "trendyol_credentials",
  "suppliers",
  "supplier_field_mappings",
  "supplier_products",
  "products",
  "variants",
  "pricing_rules",
  "channel_listings",
  "price_reviews",
  "ty_batches",
  "orders",
  "order_lines",
  "sync_cursors",
  "job_logs",
] as const;
