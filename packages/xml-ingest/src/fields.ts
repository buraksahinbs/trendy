import type { XmlObject, XmlValue } from "./parser.js";

/**
 * Ürün düğümü içinden alan okuma. Yol noktayla ayrılır (`Kimlik.Kod`), `@` öneki XML
 * attribute'u demektir (`@id`). Metin ve attribute'u olan düğümde metin `#text` altındadır;
 * yol böyle bir düğümde biterse metni döner. Tekrarlanan alanlarda ilk değer alınır.
 */
export function getAtPath(item: XmlValue, path: string): string | undefined {
  let cur: XmlValue | XmlValue[] | undefined = item;
  for (const key of path.split(".").filter(Boolean)) {
    if (Array.isArray(cur)) cur = cur[0];
    if (cur === undefined || typeof cur === "string") return undefined;
    cur = (cur as XmlObject)[key];
  }
  if (Array.isArray(cur)) cur = cur[0];
  if (cur === undefined) return undefined;
  if (typeof cur === "string") return cur.trim() || undefined;
  const text = cur["#text"];
  return typeof text === "string" ? text.trim() || undefined : undefined;
}

/**
 * `getAtPath` gibi, ama tekrarlanan elemanların hepsini döner (ör. birden fazla `<Resim>`).
 * Boş değerler atlanır, sıra korunur.
 */
export function getAllAtPath(item: XmlValue, path: string): string[] {
  let cur: XmlValue[] = [item];
  for (const key of path.split(".").filter(Boolean)) {
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
  const out: string[] = [];
  for (const c of cur) {
    const text = typeof c === "string" ? c : c["#text"];
    if (typeof text === "string" && text.trim()) out.push(text.trim());
  }
  return out;
}

export interface IdFieldSuggestion {
  path: string;
  samples: string[];
}

/** Adında kimlik çağrışımı olan alanlar öne alınır. */
const ID_HINT =
  /(^|[._@-])(id|kod|code|sku|stok_?kodu|stockcode|urun_?kodu|productcode|barkod|barcode)$/i;

/**
 * Örnek ürünlerde her üründe bulunan ve değeri benzersiz olan alanları kimlik adayı olarak
 * önerir. Yalnızca düz alanlar ve bir seviye iç içe alanlar taranır.
 */
export function suggestIdFields(items: XmlValue[], limit = 5): IdFieldSuggestion[] {
  const objects = items.filter((i): i is XmlObject => typeof i === "object");
  if (objects.length === 0) return [];

  const paths = new Set<string>();
  for (const obj of objects) {
    for (const [k, v] of Object.entries(obj)) {
      if (k === "#text") continue;
      const first = Array.isArray(v) ? v[0] : v;
      if (typeof first === "string" || (first && typeof first["#text"] === "string")) paths.add(k);
      else if (first && typeof first === "object") {
        for (const [k2, v2] of Object.entries(first)) {
          if (typeof v2 === "string" && k2 !== "#text") paths.add(`${k}.${k2}`);
        }
      }
    }
  }

  const out: (IdFieldSuggestion & { score: number })[] = [];
  for (const path of paths) {
    const values = objects.map((o) => getAtPath(o, path));
    if (values.some((v) => v === undefined)) continue;
    if (new Set(values).size !== values.length) continue;
    const score = (ID_HINT.test(path) ? 10 : 0) - path.split(".").length;
    out.push({ path, samples: (values as string[]).slice(0, 3), score });
  }
  return out
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map(({ path, samples }) => ({ path, samples }));
}
