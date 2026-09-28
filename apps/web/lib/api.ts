// Fastify API'si ile konuşan küçük, tipli istemci. Tüm istekler aynı origin üzerinden
// /api/... yoluna gider (next.config.ts rewrite), oturum cookie'si otomatik taşınır.

export type Role = "owner" | "staff";
export type TrendyolEnv = "stage" | "prod";
export type Encoding = "utf-8" | "iso-8859-9" | "windows-1254";
export type JobStatus = "running" | "success" | "failed" | "skipped";
export type ListingStatus =
  "approved" | "pending" | "rejected" | "locked" | "archived" | "blacklisted" | "unknown";
export type ListingTier = "50k" | "75k" | "150k" | "500k" | "unlimited";
export type ReviewStatus = "pending" | "approved" | "rejected";

// ── Oturum ──────────────────────────────────────────────────────────────────

export interface Me {
  userId: number;
  email: string;
  activeTenantId: number | null;
  role: Role | null;
  tenants: { tenantId: number; tenantName: string; role: Role }[];
}

// ── Trendyol ────────────────────────────────────────────────────────────────

export interface TrendyolCredentialSummary {
  env: TrendyolEnv;
  sellerId: string;
  apiKeyHint: string;
  verifiedAt: string | null;
  updatedAt: string;
}

export type VerifyResult =
  | { verified: true; verifiedAt: string; approvedContentCount: number | null }
  | {
      verified: false;
      reason: "invalid_credentials" | "forbidden" | "stage_ip_not_allowed" | "unavailable";
      message: string;
    };

/** `/trendyol/status` içindeki son iş kaydı (id ve tür içermez). */
export interface StatusJob {
  status: JobStatus;
  summary: JobSummary | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface TrendyolStatus {
  syncPaused: boolean;
  syncEnv: TrendyolEnv;
  lastSync: StatusJob | null;
  lastImport: StatusJob | null;
  listings: Partial<Record<ListingStatus, number>>;
  managedVariants: number;
  listingErrors: number;
  pendingBatches: number;
  pendingReviews: number;
}

export interface Listing {
  variantId: number;
  barcode: string;
  stockCode: string | null;
  /** Varyant özellikleri, ör. { Renk: "Beyaz", Beden: "S" } */
  attributes: Record<string, string>;
  imageUrl: string | null;
  managed: boolean;
  stock: number;
  /** Tedarikçi para biriminde kuruş */
  costPrice: number | null;
  currency: string;
  productMainId: string;
  title: string | null;
  brandName: string | null;
  tyStatus: ListingStatus | null;
  tyOnSale: boolean | null;
  lockReason: string | null;
  tyPrice: number | null;
  tyListPrice: number | null;
  tyStock: number | null;
  lastSentStock: number | null;
  lastSentPrice: number | null;
  lastSentAt: string | null;
  lastError: string | null;
  rejectReasons: unknown;
}

export interface ListingsQuery {
  status?: ListingStatus | undefined;
  hasError?: boolean | undefined;
  managed?: boolean | undefined;
  search?: string | undefined;
  limit: number;
  offset: number;
}

export interface PriceReview {
  id: number;
  variantId: number;
  barcode: string;
  title: string | null;
  oldPrice: number | null;
  newPrice: number;
  newListPrice: number;
  changeRate: number;
  status: ReviewStatus;
  createdAt: string;
  decidedAt: string | null;
}

// ── Ayarlar ─────────────────────────────────────────────────────────────────

export interface TenantSettings {
  name: string;
  listingLimitTier: ListingTier;
  syncPaused: boolean;
  syncEnv: TrendyolEnv;
  safetyStock: number;
  /** 0.3 = %30 */
  maxAutoChangeRate: number;
  fxRates: Record<string, number>;
  /** Kapanmış siparişlerde kişisel verinin saklanacağı gün (30–3650) */
  orderPiiRetentionDays: number;
}

// ── Fiyat kuralları ─────────────────────────────────────────────────────────

export type RuleScope = "brand" | "category" | "supplier" | "general";

export interface PricingRuleInput {
  scope: RuleScope;
  /** general için null; marka/kategori adı veya tedarikçi id'si */
  scopeKey: string | null;
  multiplier: number;
  /** kuruş */
  addFixed: number;
  rounding: { kind: "none" } | { kind: "ending"; kurus: number };
  minMarginRate: number | null;
  commissionRate: number | null;
  /** kuruş */
  minPrice: number | null;
  maxPrice: number | null;
  listPriceRule: { kind: "same" } | { kind: "multiplier"; value: number };
}

export interface PricingRule extends PricingRuleInput {
  id: number;
  createdAt: string;
}

export type PricePreview =
  | { status: "ok"; salePrice: number; listPrice: number }
  | { status: "needs_review"; salePrice: number; listPrice: number; changeRate: number }
  | {
      status: "blocked";
      reason: "invalid_input" | "non_positive_price" | "below_cost";
      detail: string;
    };

// ── Uyarılar ────────────────────────────────────────────────────────────────

export interface PanelAlert {
  code: string;
  level: "critical" | "warning" | "info";
  title: string;
  message: string;
  ref?: { type: "supplier"; id: number; name: string };
}

// ── Tedarikçiler ────────────────────────────────────────────────────────────

export interface Supplier {
  id: number;
  name: string;
  feedUrl: string;
  itemPath: string | null;
  externalIdPath: string | null;
  mapping: MappingConfig | null;
  encoding: Encoding | null;
  scheduleCron: string;
  active: boolean;
  syncPaused: boolean;
  lastFetchedAt: string | null;
  lastItemCount: number | null;
  createdAt: string;
  hasAuth: boolean;
}

export interface SupplierAuth {
  username: string;
  password: string;
}

export interface SupplierInput {
  name: string;
  feedUrl: string;
  itemPath?: string;
  externalIdPath?: string;
  encoding?: Encoding;
  scheduleCron?: string;
  auth?: SupplierAuth;
}

export type SupplierPatch = Partial<
  Pick<
    Supplier,
    | "name"
    | "feedUrl"
    | "itemPath"
    | "externalIdPath"
    | "encoding"
    | "scheduleCron"
    | "active"
    | "syncPaused"
  >
> & { auth?: SupplierAuth | null };

export interface DetectInput {
  feedUrl: string;
  encoding?: Encoding;
  auth?: SupplierAuth;
  itemPath?: string;
}

export interface DetectResult {
  itemPaths: { path: string; count: number }[];
  itemPath: string | null;
  idFields: { path: string; samples: string[] }[];
  sampleItems: Record<string, unknown>[];
  sampleCount: number;
}

export interface NormalizeIssue {
  level: "error" | "warning";
  field: string;
  code: string;
  message: string;
  barcode?: string;
}

export interface SupplierProduct {
  id: number;
  externalId: string;
  raw: Record<string, unknown>;
  lastSeenAt: string;
  missingSince: string | null;
  normalizeIssues: NormalizeIssue[] | null;
  normalizedAt: string | null;
}

export interface SupplierProductsPage {
  total: number;
  missing: number;
  items: SupplierProduct[];
}

export interface SupplierReport {
  supplierProducts: number;
  normalized: number;
  withErrors: number;
  withWarnings: number;
  missing: number;
  products: number;
  variants: number;
  issues: { level: "error" | "warning"; field: string; code: string; count: number }[];
}

// ── Alan eşleştirme ─────────────────────────────────────────────────────────

export type Transform =
  | { type: "trim" }
  | { type: "upper" }
  | { type: "lower" }
  | { type: "strip_html" }
  | { type: "replace"; find: string; replace: string }
  | { type: "split"; separator: string; index: number }
  | { type: "map"; values: Record<string, string>; default?: string }
  | { type: "prefix"; value: string }
  | { type: "default"; value: string };

export interface FieldMapping {
  path?: string;
  constant?: string;
  transforms?: Transform[];
}

export const PRODUCT_FIELDS = [
  "productMainId",
  "title",
  "description",
  "brandName",
  "sourceCategory",
  "vatRate",
  "origin",
  "desi",
] as const;
export const VARIANT_FIELDS = ["barcode", "stock", "stockCode", "costPrice", "currency"] as const;
export type MappingFieldKey = (typeof PRODUCT_FIELDS)[number] | (typeof VARIANT_FIELDS)[number];

export interface MappingConfig {
  version: 1;
  variantMode: "flat" | "nested";
  variantPath?: string;
  fields: Partial<Record<MappingFieldKey, FieldMapping>> & {
    barcode: FieldMapping;
    stock: FieldMapping;
  };
  images?: FieldMapping[];
  attributes?: { name: string; mapping: FieldMapping }[];
  missingPolicy: "zero_stock" | "keep";
}

export interface MappedVariant {
  barcode: string;
  stockCode: string | null;
  stock: number;
  costPrice: number | null;
  currency: string;
  attributes: Record<string, string>;
  images: string[];
}

export interface MappedProduct {
  productMainId: string;
  title: string | null;
  description: string | null;
  brandName: string | null;
  sourceCategory: string | null;
  vatRate: number | null;
  origin: string | null;
  desi: number | null;
  variants: MappedVariant[];
}

export interface MappingPreview {
  total: number;
  sampled: number;
  valid: number;
  items: {
    externalId: string;
    product: MappedProduct | null;
    issues: NormalizeIssue[];
    createMissing: string[];
  }[];
}

// ── Siparişler ──────────────────────────────────────────────────────────────

export interface Order {
  id: number;
  shipmentPackageId: string;
  orderNumber: string;
  status: string;
  orderDate: string | null;
  lastModifiedAt: string;
  /** kuruş */
  packageTotalPrice: number | null;
  currency: string | null;
  /** 1 = Standart, 25 = Luxe */
  channelId: number | null;
  cargoProviderName: string | null;
  cargoTrackingNumber: string | null;
  createdBy: "order-creation" | "split" | "cancel" | "transfer" | string | null;
  customerName: string | null;
  lineCount: number;
  itemCount: number;
  firstProductName: string | null;
}

export interface OrderLine {
  lineId: string;
  barcode: string | null;
  stockCode: string | null;
  quantity: number;
  /** kuruş */
  lineUnitPrice: number | null;
  commissionRate: number | null;
  vatRate: number | null;
  productName: string | null;
  lineStatus: string | null;
  variantId: number | null;
  supplierStockCode: string | null;
}

export interface OrderAddress {
  fullName?: string;
  fullAddress?: string;
  city?: string;
  district?: string;
  phone?: string | null;
  [key: string]: unknown;
}

export type OrderDetail = Omit<Order, "lineCount" | "itemCount"> & {
  paymentMethod?: string | null;
  lines: OrderLine[];
  /** Yalnızca owner'a döner */
  shipmentAddress?: OrderAddress | null;
  invoiceAddress?: OrderAddress | null;
};

export interface OrdersQuery {
  status?: string | undefined;
  search?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit: number;
  offset: number;
}

export type WebhookInfo =
  | { configured: false }
  | {
      configured: true;
      url: string;
      authenticationType: "API_KEY";
      lastReceivedAt: string | null;
      trendyolWebhookId: string | null;
    };

// ── İşler ───────────────────────────────────────────────────────────────────

export interface JobSummary {
  // xml_fetch
  supplierId?: number;
  supplierName?: string;
  trigger?: string;
  itemCount?: number;
  inserted?: number;
  updated?: number;
  unchanged?: number;
  missing?: number;
  invalidItems?: number;
  duplicateIds?: number;
  notModified?: boolean;
  shrinkBlocked?: { reason: "empty_feed" | "large_drop"; dropRate: number };
  normalize?: {
    skipped?: "mapping_missing" | "mapping_invalid";
    processed: number;
    products: number;
    variants: number;
    itemsWithErrors: number;
    conflicts: number;
    orphaned: number;
  };
  // ty_sync
  sent?: number;
  batches?: number;
  reviews?: number;
  stockCapped?: number;
  skipped?: Record<string, number>;
  priceNotes?: Record<string, number>;
  // ty_orders
  from?: string;
  to?: string;
  windows?: number;
  fetched?: number;
  stale?: number;
  // ty_import
  approved?: number;
  unapproved?: number;
  created?: number;
  unseen?: number;
  reason?: string;
  [key: string]: unknown;
}

export interface Job {
  id: number;
  jobType: string;
  status: JobStatus;
  summary: JobSummary | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

// ── İstemci ─────────────────────────────────────────────────────────────────

export interface ApiIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: ApiIssue[] = [],
    /** 429 yanıtlarında saniye cinsinden bekleme süresi */
    readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Oturum yok/düştü. Hatalı şifre gibi diğer 401'ler girişe yönlendirmez. */
  get isUnauthenticated() {
    return this.status === 401 && this.code === "unauthenticated";
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  type ErrorBody = { error?: string; message?: string; issues?: ApiIssue[] };
  let body: ErrorBody | null;
  try {
    body = (await res.json()) as ErrorBody;
  } catch {
    body = null;
  }
  const retryAfterHeader = res.headers.get("retry-after");
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) || null : null;

  // Fastify'ın varsayılan 404'ü: route henüz sunucuda yok.
  if (res.status === 404 && body?.error === "Not Found") {
    return new ApiError(404, "not_implemented", "Bu özellik sunucuda henüz etkin değil.");
  }
  if (!body?.message) {
    const message =
      res.status >= 500
        ? "Sunucuya ulaşılamadı. Lütfen biraz sonra tekrar deneyin."
        : `Beklenmeyen yanıt (${res.status})`;
    return new ApiError(res.status, body?.error ?? "unknown", message);
  }
  return new ApiError(
    res.status,
    body.error ?? "unknown",
    body.message,
    body.issues ?? [],
    retryAfter,
  );
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "include",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? null : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "network", "Bağlantı kurulamadı. İnternet bağlantınızı kontrol edin.");
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const q = (params: Record<string, string | number | boolean | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
};

export const api = {
  auth: {
    me: () => request<Me>("GET", "/auth/me"),
    login: (input: { email: string; password: string }) =>
      request<{ userId: number; tenantId: number | null }>("POST", "/auth/login", input),
    register: (input: { email: string; password: string; tenantName: string }) =>
      request<{ userId: number; tenantId: number }>("POST", "/auth/register", input),
    logout: () => request<void>("POST", "/auth/logout"),
    switchTenant: (tenantId: number) =>
      request<{ activeTenantId: number }>("POST", "/auth/switch-tenant", { tenantId }),
    changePassword: (input: { currentPassword: string; newPassword: string }) =>
      request<void>("POST", "/auth/change-password", input),
  },
  trendyol: {
    credentials: () => request<TrendyolCredentialSummary[]>("GET", "/trendyol/credentials"),
    saveCredentials: (
      env: TrendyolEnv,
      input: { sellerId: string; apiKey: string; apiSecret: string },
    ) => request<void>("PUT", `/trendyol/credentials/${env}`, input),
    verify: (env: TrendyolEnv) =>
      request<VerifyResult>("POST", `/trendyol/credentials/${env}/verify`),
    status: () => request<TrendyolStatus>("GET", "/trendyol/status"),
    sync: () => request<{ queued: boolean }>("POST", "/trendyol/sync"),
    import: () => request<{ queued: boolean }>("POST", "/trendyol/import"),
    listings: (params: ListingsQuery) =>
      request<{ total: number; items: Listing[] }>("GET", `/trendyol/listings${q({ ...params })}`),
    priceReviews: (status: ReviewStatus) =>
      request<PriceReview[]>("GET", `/trendyol/price-reviews${q({ status })}`),
    decideReview: (id: number, decision: "approve" | "reject") =>
      request<void>("POST", `/trendyol/price-reviews/${id}/${decision}`),
  },
  settings: {
    get: () => request<TenantSettings>("GET", "/settings"),
    update: (patch: Partial<TenantSettings>) =>
      request<TenantSettings>("PATCH", "/settings", patch),
    webhook: () => request<WebhookInfo>("GET", "/settings/webhook"),
    createWebhook: () =>
      request<{ url: string; authenticationType: "API_KEY"; apiKey: string }>(
        "POST",
        "/settings/webhook",
      ),
  },
  pricing: {
    list: () => request<PricingRule[]>("GET", "/pricing-rules"),
    create: (input: PricingRuleInput) => request<PricingRule>("POST", "/pricing-rules", input),
    update: (id: number, input: PricingRuleInput) =>
      request<PricingRule>("PUT", `/pricing-rules/${id}`, input),
    remove: (id: number) => request<void>("DELETE", `/pricing-rules/${id}`),
    preview: (input: { rule: PricingRuleInput; cost: number; fxRate?: number }) =>
      request<PricePreview>("POST", "/pricing-rules/preview", input),
  },
  orders: {
    list: (params: OrdersQuery) =>
      request<{ total: number; items: Order[] }>("GET", `/orders${q({ ...params })}`),
    get: (id: number) => request<OrderDetail>("GET", `/orders/${id}`),
    sync: () => request<{ queued: boolean }>("POST", "/orders/sync"),
    backfill: (input: { from: string; to: string }) =>
      request<{ queued: boolean }>("POST", "/orders/backfill", input),
  },
  suppliers: {
    list: () => request<Supplier[]>("GET", "/suppliers"),
    get: (id: number) => request<Supplier>("GET", `/suppliers/${id}`),
    create: (input: SupplierInput) => request<{ id: number }>("POST", "/suppliers", input),
    update: (id: number, patch: SupplierPatch) =>
      request<Supplier>("PATCH", `/suppliers/${id}`, patch),
    remove: (id: number) => request<void>("DELETE", `/suppliers/${id}`),
    fetchNow: (id: number) => request<{ queued: boolean }>("POST", `/suppliers/${id}/fetch`),
    detect: (input: DetectInput) => request<DetectResult>("POST", "/suppliers/detect", input),
    products: (id: number, params: { limit: number; offset: number }) =>
      request<SupplierProductsPage>("GET", `/suppliers/${id}/products${q(params)}`),
    report: (id: number) => request<SupplierReport>("GET", `/suppliers/${id}/report`),
    saveMapping: (id: number, mapping: MappingConfig) =>
      request<Supplier>("PUT", `/suppliers/${id}/mapping`, mapping),
    previewMapping: (id: number, mapping: MappingConfig, limit = 20) =>
      request<MappingPreview>("POST", `/suppliers/${id}/mapping/preview`, { mapping, limit }),
  },
  alerts: () => request<PanelAlert[]>("GET", "/alerts"),
  jobs: {
    list: (params: { limit?: number; supplierId?: number } = {}) =>
      request<Job[]>("GET", `/jobs${q({ limit: params.limit ?? 50, ...params })}`),
  },
};

/** Kullanıcıya gösterilecek hata metni; 429'da bekleme süresini de ekler. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429 && err.retryAfter) {
      const wait =
        err.retryAfter < 60 ? `${err.retryAfter} sn` : `${Math.ceil(err.retryAfter / 60)} dk`;
      return `${err.message} (yaklaşık ${wait})`;
    }
    return err.message;
  }
  return "Beklenmeyen bir hata oluştu.";
}
