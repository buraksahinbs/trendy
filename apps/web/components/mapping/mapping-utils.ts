import type { FieldMapping, MappingConfig, MappingFieldKey, Transform } from "@/lib/api";

// ── Alan tanımları ──────────────────────────────────────────────────────────

export interface FieldDef {
  key: MappingFieldKey;
  label: string;
  required?: boolean;
  /** variant: nested modda varyant düğümünden okunur */
  scope: "product" | "variant";
  hint: string;
  placeholder?: string;
}

export const FIELD_DEFS: FieldDef[] = [
  {
    key: "barcode",
    label: "Barkod",
    required: true,
    scope: "variant",
    hint: "Trendyol ürünüyle eşleşen barkod.",
  },
  {
    key: "stock",
    label: "Stok",
    required: true,
    scope: "variant",
    hint: "Satılabilir adet; tam sayı.",
  },
  {
    key: "productMainId",
    label: "Model kodu",
    scope: "product",
    hint: "Varyantları gruplar. Boşsa ürün kimliği kullanılır.",
  },
  { key: "title", label: "Başlık", scope: "product", hint: "En fazla 100 karakter." },
  {
    key: "description",
    label: "Açıklama",
    scope: "product",
    hint: "HTML içeriyorsa “HTML temizle” ekleyin.",
  },
  { key: "brandName", label: "Marka", scope: "product", hint: "" },
  {
    key: "sourceCategory",
    label: "Kategori",
    scope: "product",
    hint: "Tedarikçinin kategori adı.",
  },
  { key: "vatRate", label: "KDV", scope: "product", hint: "0, 1, 10 veya 20.", placeholder: "20" },
  { key: "origin", label: "Menşei", scope: "product", hint: "", placeholder: "TR" },
  { key: "desi", label: "Desi", scope: "product", hint: "" },
  {
    key: "stockCode",
    label: "Stok kodu",
    scope: "variant",
    hint: "Siparişte tedarikçiye iletilir.",
  },
  {
    key: "costPrice",
    label: "Maliyet",
    scope: "variant",
    hint: "Alış fiyatı; fiyat kuralı buna göre hesaplar.",
  },
  {
    key: "currency",
    label: "Para birimi",
    scope: "variant",
    hint: "Boşsa TRY. TL, ₺, $ gibi yazımlar tanınır.",
    placeholder: "TRY",
  },
];

/** Stok/fiyat senkronu için gereken alanlar; geri kalanı yalnızca yeni ürün açarken kullanılır. */
export const SYNC_FIELD_KEYS = new Set<MappingFieldKey>([
  "barcode",
  "stock",
  "costPrice",
  "currency",
  "stockCode",
]);

// ── Taslak (form durumu) ────────────────────────────────────────────────────

export interface FieldDraft {
  mode: "path" | "constant";
  path: string;
  constant: string;
  transforms: Transform[];
}

export interface MappingDraft {
  variantMode: "flat" | "nested";
  variantPath: string;
  fields: Record<MappingFieldKey, FieldDraft>;
  images: FieldDraft[];
  attributes: { name: string; field: FieldDraft }[];
  missingPolicy: "zero_stock" | "keep";
}

export const emptyField = (path = ""): FieldDraft => ({
  mode: "path",
  path,
  constant: "",
  transforms: [],
});

const fieldFromMapping = (m: FieldMapping | undefined): FieldDraft =>
  m
    ? {
        mode: m.constant !== undefined ? "constant" : "path",
        path: m.path ?? "",
        constant: m.constant ?? "",
        transforms: m.transforms ?? [],
      }
    : emptyField();

export function draftFromConfig(c: MappingConfig): MappingDraft {
  const fields = Object.fromEntries(
    FIELD_DEFS.map((d) => [d.key, fieldFromMapping(c.fields[d.key])]),
  ) as Record<MappingFieldKey, FieldDraft>;
  return {
    variantMode: c.variantMode,
    variantPath: c.variantPath ?? "",
    fields,
    images: (c.images ?? []).map(fieldFromMapping),
    attributes: (c.attributes ?? []).map((a) => ({
      name: a.name,
      field: fieldFromMapping(a.mapping),
    })),
    missingPolicy: c.missingPolicy ?? "zero_stock",
  };
}

const isEmpty = (f: FieldDraft) => (f.mode === "path" ? !f.path.trim() : f.constant === "");

/** Yarım girilmiş dönüşümler (boş "bul", boş eşleme satırı) gönderilmez. */
function cleanTransforms(ts: Transform[]): Transform[] {
  return ts.flatMap((t): Transform[] => {
    if (t.type === "replace" && !t.find) return [];
    if (t.type === "split" && !t.separator) return [];
    if (t.type === "map") {
      const values = Object.fromEntries(Object.entries(t.values).filter(([k]) => k !== ""));
      return Object.keys(values).length || t.default ? [{ ...t, values }] : [];
    }
    return [t];
  });
}

function fieldToMapping(f: FieldDraft): FieldMapping {
  const base: FieldMapping = f.mode === "path" ? { path: f.path.trim() } : { constant: f.constant };
  const transforms = cleanTransforms(f.transforms);
  return transforms.length ? { ...base, transforms } : base;
}

/** Taslağı API'nin beklediği yapıya çevirir; boş alanlar atlanır. */
export function configFromDraft(d: MappingDraft): { config: MappingConfig; errors: string[] } {
  const errors: string[] = [];
  const fields: Partial<Record<MappingFieldKey, FieldMapping>> = {};
  for (const def of FIELD_DEFS) {
    const f = d.fields[def.key];
    if (isEmpty(f)) {
      if (def.required) errors.push(`${def.label} alanı zorunlu`);
      continue;
    }
    if (f.mode === "path" && /\s/.test(f.path.trim()))
      errors.push(`${def.label}: alan yolu boşluk içeremez`);
    fields[def.key] = fieldToMapping(f);
  }
  if (d.variantMode === "nested" && !d.variantPath.trim())
    errors.push("Varyant listesi yolu zorunlu (iç içe varyant yapısı)");
  const images = d.images.filter((f) => !isEmpty(f)).map(fieldToMapping);
  const attributes = d.attributes
    .filter((a) => a.name.trim() && !isEmpty(a.field))
    .map((a) => ({ name: a.name.trim(), mapping: fieldToMapping(a.field) }));
  const config = {
    version: 1,
    variantMode: d.variantMode,
    ...(d.variantMode === "nested" && d.variantPath.trim()
      ? { variantPath: d.variantPath.trim() }
      : {}),
    fields,
    ...(images.length ? { images } : {}),
    ...(attributes.length ? { attributes } : {}),
    missingPolicy: d.missingPolicy,
  } as MappingConfig;
  return { config, errors };
}

// ── Ham veri gezinme ────────────────────────────────────────────────────────

type Raw = unknown;
const isObj = (v: Raw): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function textOf(v: Raw): string | undefined {
  if (Array.isArray(v)) v = v[0];
  if (typeof v === "string") return v;
  if (isObj(v) && typeof v["#text"] === "string") return v["#text"];
  return undefined;
}

/** Sunucudaki `getAtPath` ile aynı kural: nokta ayrımlı yol, tekrarlarda ilk değer. */
export function getAtPath(node: Raw, path: string, parent?: Raw): string | undefined {
  let p = path.trim();
  let cur: Raw = node;
  if (p.startsWith("../")) {
    cur = parent ?? node;
    p = p.slice(3);
  }
  for (const key of p.split(".").filter(Boolean)) {
    if (Array.isArray(cur)) cur = cur[0];
    if (!isObj(cur)) return undefined;
    cur = cur[key];
  }
  const t = textOf(cur);
  return t?.trim() || undefined;
}

/** Yolun gösterdiği düğümleri döner (nested modda varyant düğümleri). */
export function getNodes(node: Raw, path: string): Raw[] {
  let cur: Raw[] = [node];
  for (const key of path.split(".").filter(Boolean)) {
    const next: Raw[] = [];
    for (const c of cur) {
      if (!isObj(c)) continue;
      const v = c[key];
      if (v === undefined) continue;
      if (Array.isArray(v)) next.push(...v);
      else next.push(v);
    }
    cur = next;
  }
  return cur;
}

export interface PathSuggestion {
  path: string;
  sample: string | undefined;
}

/** Örnek üründeki okunabilir alan yollarını çıkarır (öneri listesi). */
export function suggestPaths(node: Raw, prefix = "", depth = 0, out: PathSuggestion[] = []) {
  if (!isObj(node) || depth > 4 || out.length > 300) return out;
  for (const [key, value] of Object.entries(node)) {
    if (key === "#text") continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const first = Array.isArray(value) ? value[0] : value;
    const text = textOf(first);
    if (text !== undefined) out.push({ path, sample: text.trim() });
    if (isObj(first)) suggestPaths(first, path, depth + 1, out);
  }
  return out;
}

/** Nested mod için varyant listesi adayları: nesne dizisi olan yollar. */
export function suggestVariantPaths(node: Raw, prefix = "", depth = 0, out: string[] = []) {
  if (!isObj(node) || depth > 3) return out;
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@") || key === "#text") continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const first = Array.isArray(value) ? value[0] : value;
    if (isObj(first)) {
      const hasFields = Object.keys(first).some((k) => k !== "#text");
      if (hasFields && (Array.isArray(value) || depth > 0)) out.push(path);
      suggestVariantPaths(first, path, depth + 1, out);
    }
  }
  return out;
}

// ── Dönüşümler (sunucudaki `applyTransforms` ile aynı) ──────────────────────

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

export function applyTransforms(value: string | undefined, transforms: Transform[]) {
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
          .replace(/<[^>]*>/g, " ")
          .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e] ?? e)
          .replace(/\s+/g, " ")
          .trim();
        break;
      case "replace":
        if (t.find) v = v.split(t.find).join(t.replace);
        break;
      case "split":
        if (t.separator) v = v.split(t.separator).at(t.index);
        break;
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

// ── Otomatik öneri ──────────────────────────────────────────────────────────

const GUESS: [MappingFieldKey, RegExp][] = [
  ["barcode", /barkod|barcode|ean|gtin/i],
  ["stockCode", /stok_?kod|stockcode|stock_code|sku/i],
  ["stock", /stok|stock|miktar|quantity|qty|adet/i],
  ["productMainId", /model_?kod|productmainid|model|urun_?grup|parent/i],
  ["title", /^(urun_?)?ad[iı]?$|urun_?ad|isim|baslik|başlık|title|name/i],
  ["description", /aciklama|açıklama|description|detay/i],
  ["brandName", /marka|brand/i],
  ["sourceCategory", /kategori|category/i],
  ["vatRate", /kdv|vat|tax/i],
  ["origin", /mensei|menşei|origin/i],
  ["desi", /desi/i],
  ["costPrice", /maliyet|alis|alış|cost|bayi|fiyat|price/i],
  ["currency", /para_?birim|doviz|döviz|currency/i],
];

/** Örnek üründen ilk eşleştirme taslağı: alan adlarından tahmin. */
const VARIANT_KEYS = new Set<MappingFieldKey>([
  "barcode",
  "stockCode",
  "stock",
  "costPrice",
  "currency",
]);

/**
 * Örnek üründen ilk eşleştirme taslağı: alan adlarından tahmin. Üst düzeyde barkod yoksa ve
 * bir varyant listesi varsa iç içe yapı önerilir; varyant alanları o listeden okunur.
 */
export function guessDraft(sample: Raw): MappingDraft {
  const fields = Object.fromEntries(FIELD_DEFS.map((d) => [d.key, emptyField()])) as Record<
    MappingFieldKey,
    FieldDraft
  >;
  const leafs = (node: Raw) => suggestPaths(node).filter((s) => !s.path.includes("."));
  const top = leafs(sample);
  const hasTopBarcode = top.some((l) => /barkod|barcode|ean|gtin/i.test(l.path));
  let variantPath = "";
  let variantLeafs: PathSuggestion[] = [];
  if (!hasTopBarcode) {
    for (const vp of suggestVariantPaths(sample)) {
      const node = getNodes(sample, vp)[0];
      const vl = leafs(node);
      if (vl.some((l) => /barkod|barcode|ean|gtin/i.test(l.path))) {
        variantPath = vp;
        variantLeafs = vl;
        break;
      }
    }
  }
  const nested = Boolean(variantPath);
  const used = new Set<string>();
  for (const [key, re] of GUESS) {
    const pool = nested && VARIANT_KEYS.has(key) ? variantLeafs : top;
    const hit = pool.find((l) => !used.has(l.path) && re.test(l.path.replace(/^@/, "")));
    if (hit) {
      used.add(hit.path);
      fields[key] = emptyField(hit.path);
    } else if (nested && VARIANT_KEYS.has(key)) {
      // Varyantta yoksa üst üründen oku (ör. ortak fiyat)
      const up = top.find((l) => !used.has(l.path) && re.test(l.path.replace(/^@/, "")));
      if (up) {
        used.add(up.path);
        fields[key] = emptyField(`../${up.path}`);
      }
    }
  }
  // <price currency="USD"> gibi: para birimi fiyat düğümünün niteliğinde olabilir
  if (!fields.currency.path && fields.costPrice.path) {
    const attr = suggestPaths(sample).find((p) => /\.@(currency|para_?birim|doviz)$/i.test(p.path));
    if (attr) fields.currency = emptyField(nested ? `../${attr.path}` : attr.path);
  }
  if (fields.description.path) fields.description.transforms = [{ type: "strip_html" }];
  const image = suggestPaths(sample).find((s) =>
    /resim|image|gorsel|görsel|foto|picture/i.test(s.path),
  );
  // Varyantı ayırt eden özellikler (renk, beden): listede aynı adlı satırları ayırır.
  const attributes: MappingDraft["attributes"] = [];
  for (const [name, re] of ATTRIBUTE_GUESS) {
    const pool = nested ? variantLeafs : top;
    const hit = pool.find((l) => !used.has(l.path) && re.test(l.path.replace(/^@/, "")));
    if (hit) {
      used.add(hit.path);
      attributes.push({ name, field: emptyField(hit.path) });
    }
  }
  return {
    variantMode: nested ? "nested" : "flat",
    variantPath,
    fields,
    images: image ? [emptyField(nested ? `../${image.path}` : image.path)] : [],
    attributes,
    missingPolicy: "zero_stock",
  };
}

const ATTRIBUTE_GUESS: [string, RegExp][] = [
  ["Renk", /^(renk|color|colour)$/i],
  ["Beden", /^(beden|size|numara|olcu|ölçü)$/i],
];

export function blankDraft(): MappingDraft {
  return {
    variantMode: "flat",
    variantPath: "",
    fields: Object.fromEntries(FIELD_DEFS.map((d) => [d.key, emptyField()])) as Record<
      MappingFieldKey,
      FieldDraft
    >,
    images: [],
    attributes: [],
    missingPolicy: "zero_stock",
  };
}

export const FIELD_LABEL: Record<string, string> = {
  ...Object.fromEntries(FIELD_DEFS.map((d) => [d.key, d.label])),
  variantPath: "Varyant listesi",
  images: "Görseller",
  images_https: "Görseller (https)",
};

export function fieldLabel(field: string): string {
  if (field.startsWith("attributes.")) return `Özellik: ${field.slice(11)}`;
  return FIELD_LABEL[field] ?? field;
}
