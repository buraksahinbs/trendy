import { normalizeBarcode, parseAmount, toKurus, type Kurus } from "@trendy/shared";
import { z } from "zod";
import { getAllAtPath } from "./fields.js";
import type { XmlValue } from "./parser.js";

/**
 * Alan eşleştirme motoru (ROADMAP Faz 5): tedarikçinin ham ürün düğümünü kanonik ürün ve
 * varyantlara çevirir. Saf fonksiyonlardır; veritabanına dokunmaz.
 *
 * Güvenlik: kullanıcı tanımlı regex desteklenmez (felaket geri izleme / ReDoS worker'ı
 * kilitleyebilir). Onun yerine bul-değiştir, böl-al ve değer eşleme dönüşümleri vardır.
 */

// ── Yapılandırma şeması ──────────────────────────────────────────────────────

const text = (max: number) => z.string().max(max);
const path = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^(\.\.\/)?[^\s]+$/, "Alan yolu boşluk içeremez");

export const transformSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("trim") }),
  z.object({ type: z.literal("upper") }),
  z.object({ type: z.literal("lower") }),
  z.object({ type: z.literal("strip_html") }),
  z.object({ type: z.literal("replace"), find: text(200).min(1), replace: text(200) }),
  z.object({
    type: z.literal("split"),
    separator: text(20).min(1),
    index: z.number().int().min(-20).max(20),
  }),
  z.object({
    type: z.literal("map"),
    values: z.record(text(200), text(200)).refine((v) => Object.keys(v).length <= 500),
    default: text(200).optional(),
  }),
  z.object({ type: z.literal("prefix"), value: text(500) }),
  z.object({ type: z.literal("default"), value: text(500) }),
]);
export type Transform = z.infer<typeof transformSchema>;

export const fieldMappingSchema = z
  .object({
    path: path.optional(),
    constant: text(1000).optional(),
    transforms: z.array(transformSchema).max(10).optional(),
  })
  .refine((m) => (m.path === undefined) !== (m.constant === undefined), {
    message: "Alan için ya kaynak yol ya da sabit değer verilmeli (ikisi birden değil)",
  });
export type FieldMapping = z.infer<typeof fieldMappingSchema>;

const productFields = [
  "productMainId",
  "title",
  "description",
  "brandName",
  "sourceCategory",
  "vatRate",
  "origin",
  "desi",
] as const;
const variantFields = ["barcode", "stockCode", "stock", "costPrice", "currency"] as const;

export const mappingConfigSchema = z
  .object({
    version: z.literal(1),
    /** flat: her düğüm bir varyant (ortak model koduyla gruplanır); nested: düğüm altında varyant listesi. */
    variantMode: z.enum(["flat", "nested"]),
    /** nested modda varyant düğümlerinin ürün içindeki yolu, ör. `Varyantlar.Varyant`. */
    variantPath: path.optional(),
    fields: z.object({
      ...Object.fromEntries(productFields.map((f) => [f, fieldMappingSchema.optional()])),
      ...Object.fromEntries(variantFields.map((f) => [f, fieldMappingSchema.optional()])),
      barcode: fieldMappingSchema,
      stock: fieldMappingSchema,
    }) as z.ZodType<
      Partial<
        Record<(typeof productFields)[number] | (typeof variantFields)[number], FieldMapping>
      > & {
        barcode: FieldMapping;
        stock: FieldMapping;
      }
    >,
    images: z.array(fieldMappingSchema).max(10).optional(),
    attributes: z
      .array(z.object({ name: text(100).min(1), mapping: fieldMappingSchema }))
      .max(30)
      .optional(),
    /** Feed'den kaybolan ürün: stok 0 gönderilir (varsayılan) veya son değer korunur. */
    missingPolicy: z.enum(["zero_stock", "keep"]).default("zero_stock"),
  })
  .refine((c) => c.variantMode === "flat" || c.variantPath !== undefined, {
    message: "nested modda variantPath zorunlu",
    path: ["variantPath"],
  });
export type MappingConfig = z.infer<typeof mappingConfigSchema>;

// ── Çıktı ────────────────────────────────────────────────────────────────────

export interface MappedVariant {
  barcode: string;
  stockCode: string | null;
  stock: number;
  /** Tedarikçi para biriminde, kuruş (1/100) cinsinden. */
  costPrice: Kurus | null;
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

export interface MappingIssue {
  level: "error" | "warning";
  field: string;
  code: string;
  message: string;
  barcode?: string;
}

export interface MapResult {
  product: MappedProduct | null;
  issues: MappingIssue[];
}

/** Trendyol sınırları (ROADMAP §2.3). */
export const LIMITS = { title: 100, description: 30_000, color: 50, images: 8 } as const;
export const VAT_RATES = [0, 1, 10, 20] as const;

// ── Uygulama ─────────────────────────────────────────────────────────────────

const HTML_TAG = /<[^>]*>/g;
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

export function applyTransforms(
  value: string | undefined,
  transforms: Transform[] = [],
): string | undefined {
  let v = value;
  for (const t of transforms) {
    if (t.type === "default") {
      if (v === undefined || v.trim() === "") v = t.value;
      continue;
    }
    if (v === undefined) continue;
    switch (t.type) {
      case "trim":
        v = v.trim();
        break;
      case "upper":
        v = v.toLocaleUpperCase("tr-TR");
        break;
      case "lower":
        v = v.toLocaleLowerCase("tr-TR");
        break;
      case "strip_html":
        v = v
          .replace(HTML_TAG, " ")
          .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e] ?? e)
          .replace(/\s+/g, " ")
          .trim();
        break;
      case "replace":
        v = v.split(t.find).join(t.replace);
        break;
      case "split": {
        const parts = v.split(t.separator);
        v = parts.at(t.index);
        break;
      }
      case "map": {
        const key = v.trim().toLocaleLowerCase("tr-TR");
        const hit = Object.entries(t.values).find(
          ([k]) => k.trim().toLocaleLowerCase("tr-TR") === key,
        );
        v = hit ? hit[1] : (t.default ?? v);
        break;
      }
      case "prefix":
        v = t.value + v;
        break;
    }
  }
  return v === undefined || v.trim() === "" ? undefined : v;
}

interface Scope {
  node: XmlValue;
  parent?: XmlValue;
}

function resolveAll(m: FieldMapping, scope: Scope): string[] {
  if (m.constant !== undefined) {
    const v = applyTransforms(m.constant, m.transforms);
    return v === undefined ? [] : [v];
  }
  const p = m.path!;
  const [node, rel] = p.startsWith("../")
    ? [scope.parent ?? scope.node, p.slice(3)]
    : [scope.node, p];
  const raw = getAllAtPath(node, rel);
  const values = (raw.length ? raw : [undefined]).map((r) => applyTransforms(r, m.transforms));
  return values.filter((v): v is string => v !== undefined);
}

const resolveOne = (m: FieldMapping | undefined, scope: Scope) =>
  m ? resolveAll(m, scope)[0] : undefined;

const CURRENCY_ALIASES: Record<string, string> = {
  TL: "TRY",
  "₺": "TRY",
  YTL: "TRY",
  "€": "EUR",
  $: "USD",
};

function normalizeCurrency(raw: string | undefined): string | null {
  if (raw === undefined) return "TRY";
  const s = raw.trim().toUpperCase();
  const c = CURRENCY_ALIASES[s] ?? s;
  return /^[A-Z]{3}$/.test(c) ? c : null;
}

/**
 * Stok tamsayıdır: "1.500" ve "1,500" (3 haneli gruplar) binlik ayracı olarak okunur (1500).
 * Genel tutar ayrıştırıcısı "1.500"ü 1,5 sayardı; stokta bu, 1500 adedi 1'e düşürürdü.
 */
function parseStock(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const s = raw.trim();
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ""));
  const n = parseAmount(s);
  if (n === null || n < 0) return null;
  return Math.floor(n);
}

/**
 * Tek bir ham ürün düğümünü kanonik ürüne çevirir. Hatalı varyantlar atlanır ve `issues`'a
 * yazılır; hiç geçerli varyant yoksa `product` null döner.
 */
export function mapItem(raw: XmlValue, externalId: string, config: MappingConfig): MapResult {
  const issues: MappingIssue[] = [];
  const f = config.fields;
  const productScope: Scope = { node: raw };
  const issue = (i: MappingIssue) => void issues.push(i);

  const variantNodes: Scope[] =
    config.variantMode === "nested"
      ? getAllNodes(raw, config.variantPath!).map((node) => ({ node, parent: raw }))
      : [productScope];
  if (variantNodes.length === 0) {
    issue({
      level: "error",
      field: "variantPath",
      code: "no_variants",
      message: "Üründe varyant bulunamadı",
    });
    return { product: null, issues };
  }

  const truncated = (field: "title" | "description", v: string | undefined) => {
    if (v === undefined) return null;
    const max = LIMITS[field];
    if (v.length <= max) return v;
    issue({
      level: "warning",
      field,
      code: "truncated",
      message: `${max} karakteri aştığı için kısaltıldı`,
    });
    return v.slice(0, max);
  };

  const vatRaw = resolveOne(f.vatRate, productScope);
  let vatRate: number | null = null;
  if (vatRaw !== undefined) {
    const n = parseAmount(vatRaw.replace("%", ""));
    if (n !== null && (VAT_RATES as readonly number[]).includes(n)) vatRate = n;
    else
      issue({
        level: "warning",
        field: "vatRate",
        code: "invalid",
        message: `Geçersiz KDV oranı: ${vatRaw} (0, 1, 10, 20 olmalı)`,
      });
  }
  const desiRaw = resolveOne(f.desi, productScope);
  const desi = desiRaw !== undefined ? parseAmount(desiRaw) : null;
  if (desiRaw !== undefined && (desi === null || desi < 0)) {
    issue({
      level: "warning",
      field: "desi",
      code: "invalid",
      message: `Geçersiz desi: ${desiRaw}`,
    });
  }

  const productMainId = resolveOne(f.productMainId, productScope) ?? externalId;
  if (productMainId.length > 40) {
    issue({
      level: "warning",
      field: "productMainId",
      code: "too_long",
      message: "Model kodu 40 karakteri aşıyor",
    });
  }

  const variants: MappedVariant[] = [];
  const seen = new Set<string>();
  for (const scope of variantNodes) {
    const rawBarcode = resolveOne(f.barcode, scope);
    if (rawBarcode === undefined) {
      issue({ level: "error", field: "barcode", code: "missing", message: "Barkod boş" });
      continue;
    }
    const b = normalizeBarcode(rawBarcode);
    if (!b.ok) {
      const why = {
        empty: "boş",
        too_long: "40 karakteri aşıyor",
        invalid_chars: "geçersiz karakter içeriyor (yalnızca harf, rakam, . - _)",
      }[b.issue];
      issue({
        level: "error",
        field: "barcode",
        code: b.issue,
        message: `Barkod ${why}: ${rawBarcode}`,
        barcode: rawBarcode,
      });
      continue;
    }
    const barcode = b.barcode;
    if (seen.has(barcode)) {
      issue({
        level: "error",
        field: "barcode",
        code: "duplicate",
        message: "Aynı üründe tekrarlanan barkod",
        barcode,
      });
      continue;
    }
    const stockRaw = resolveOne(f.stock, scope);
    const stock = parseStock(stockRaw);
    if (stock === null) {
      issue({
        level: "error",
        field: "stock",
        code: stockRaw === undefined ? "missing" : "invalid",
        message: stockRaw === undefined ? "Stok boş" : `Stok sayı değil: ${stockRaw}`,
        barcode,
      });
      continue;
    }
    const currencyRaw = resolveOne(f.currency, scope);
    const currency = normalizeCurrency(currencyRaw);
    if (currency === null) {
      issue({
        level: "error",
        field: "currency",
        code: "invalid",
        message: `Geçersiz para birimi: ${currencyRaw}`,
        barcode,
      });
      continue;
    }
    const costRaw = resolveOne(f.costPrice, scope);
    let costPrice: Kurus | null = null;
    if (costRaw !== undefined) {
      const n = parseAmount(costRaw);
      if (n !== null && n > 0) costPrice = toKurus(n);
      else
        issue({
          level: "warning",
          field: "costPrice",
          code: "invalid",
          message: `Geçersiz maliyet: ${costRaw}`,
          barcode,
        });
    }

    const attributes: Record<string, string> = {};
    for (const a of config.attributes ?? []) {
      const v = resolveOne(a.mapping, scope);
      if (v === undefined) continue;
      if (/^renk$/i.test(a.name) && v.length > LIMITS.color) {
        issue({
          level: "warning",
          field: `attributes.${a.name}`,
          code: "too_long",
          message: `Renk ${LIMITS.color} karakteri aşıyor`,
          barcode,
        });
      }
      attributes[a.name] = v;
    }

    const images = [...new Set((config.images ?? []).flatMap((m) => resolveAll(m, scope)))];
    if (images.length > LIMITS.images) {
      issue({
        level: "warning",
        field: "images",
        code: "too_many",
        message: `En fazla ${LIMITS.images} görsel; fazlası atlandı`,
        barcode,
      });
    }

    seen.add(barcode);
    variants.push({
      barcode,
      stockCode: resolveOne(f.stockCode, scope) ?? null,
      stock,
      costPrice,
      currency,
      attributes,
      images: images.slice(0, LIMITS.images),
    });
  }

  if (variants.length === 0) return { product: null, issues };
  return {
    product: {
      productMainId,
      title: truncated("title", resolveOne(f.title, productScope)),
      description: truncated("description", resolveOne(f.description, productScope)),
      brandName: resolveOne(f.brandName, productScope) ?? null,
      sourceCategory: resolveOne(f.sourceCategory, productScope) ?? null,
      vatRate,
      origin: resolveOne(f.origin, productScope) ?? null,
      desi: desi !== null && desi >= 0 ? desi : null,
      variants,
    },
    issues,
  };
}

/** Yoldaki tüm nesne düğümleri (tekrarlanan elemanlar açılır). */
function getAllNodes(item: XmlValue, p: string): XmlValue[] {
  let cur: XmlValue[] = [item];
  for (const key of p.split(".").filter(Boolean)) {
    const next: XmlValue[] = [];
    for (const c of cur) {
      if (typeof c === "string") continue;
      const v = c[key];
      if (v === undefined) continue;
      if (Array.isArray(v)) next.push(...v);
      else next.push(v);
    }
    cur = next;
  }
  return cur;
}

/**
 * Ürün yaratmaya hazırlık (Faz 8 için ön kontrol): Trendyol'un zorunlu tuttuğu kanonik
 * alanlardan eksik olanlar. Marka/kategori/özellik ID eşleştirmesi Faz 6'da ayrıca kontrol edilir.
 */
export function createReadinessIssues(p: MappedProduct): string[] {
  const missing: string[] = [];
  if (!p.title) missing.push("title");
  if (!p.description) missing.push("description");
  if (!p.brandName) missing.push("brandName");
  if (!p.sourceCategory) missing.push("sourceCategory");
  if (p.vatRate === null) missing.push("vatRate");
  if (p.variants.some((v) => v.images.length === 0)) missing.push("images");
  if (p.variants.some((v) => v.images.some((u) => !u.startsWith("https://"))))
    missing.push("images_https");
  if (p.variants.some((v) => v.costPrice === null)) missing.push("costPrice");
  return missing;
}
