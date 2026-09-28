import { SaxesParser, type SaxesTagPlain } from "saxes";

/**
 * XML düğümünün JSON karşılığı:
 * - yalnızca metin içeren eleman → string
 * - attribute'lar `@ad` anahtarıyla, alt elemanlarla karışık metin `#text` anahtarıyla
 * - tekrarlanan alt elemanlar → dizi
 */
export type XmlValue = string | XmlObject;
export interface XmlObject {
  [key: string]: XmlValue | XmlValue[];
}

export class XmlParseError extends Error {
  constructor(
    message: string,
    readonly line?: number,
    readonly column?: number,
  ) {
    super(message);
    this.name = "XmlParseError";
  }
}

export interface ParseOptions {
  /** Tekrarlanan ürün düğümünün yolu, ör. `/Urunler/Urun`. */
  itemPath: string;
  /** Bir ürün düğümü içindeki maksimum iç içe derinlik. */
  maxItemDepth?: number;
}

interface Frame {
  obj: XmlObject;
  text: string;
  hasChildren: boolean;
}

function normalizePath(path: string): string {
  return "/" + path.split("/").filter(Boolean).join("/");
}

function addChild(parent: XmlObject, key: string, value: XmlValue): void {
  const existing = parent[key];
  if (existing === undefined) parent[key] = value;
  else if (Array.isArray(existing)) existing.push(value);
  else parent[key] = [existing, value];
}

function createParser(onError: (err: XmlParseError) => void): SaxesParser {
  // saxes DTD entity tanımlarını işlemez; tanımsız entity (XXE, billion laughs) hata verir.
  const parser = new SaxesParser({ position: true });
  parser.on("error", (err) => {
    onError(new XmlParseError(err.message, parser.line, parser.column));
  });
  return parser;
}

/**
 * Metin akışını streaming olarak ayrıştırır ve her ürün düğümünü JSON olarak üretir.
 * Bellekte en fazla bir chunk'ın ürettiği ürünler tutulur.
 */
export async function* parseItems(
  source: AsyncIterable<string>,
  options: ParseOptions,
): AsyncGenerator<XmlObject | string> {
  const itemPath = normalizePath(options.itemPath);
  const maxDepth = options.maxItemDepth ?? 32;

  const path: string[] = [];
  let frames: Frame[] = [];
  let ready: (XmlObject | string)[] = [];
  let error: XmlParseError | undefined;

  const parser = createParser((err) => {
    error ??= err;
  });

  parser.on("opentag", (tag: SaxesTagPlain) => {
    path.push(tag.name);
    const inItem = frames.length > 0;
    if (!inItem && "/" + path.join("/") !== itemPath) return;
    if (frames.length >= maxDepth) {
      error ??= new XmlParseError(
        `Ürün düğümü ${maxDepth} seviyeden derin`,
        parser.line,
        parser.column,
      );
      return;
    }
    const obj: XmlObject = {};
    for (const [name, value] of Object.entries(tag.attributes)) obj[`@${name}`] = value;
    const parent = frames.at(-1);
    if (parent) parent.hasChildren = true;
    frames.push({ obj, text: "", hasChildren: Object.keys(obj).length > 0 });
  });

  const onText = (text: string) => {
    const top = frames.at(-1);
    if (top) top.text += text;
  };
  parser.on("text", onText);
  parser.on("cdata", onText);

  parser.on("closetag", (tag) => {
    path.pop();
    const frame = frames.pop();
    if (!frame) return;
    const text = frame.text.trim();
    let value: XmlValue;
    if (!frame.hasChildren) value = text;
    else {
      if (text) frame.obj["#text"] = text;
      value = frame.obj;
    }
    const parent = frames.at(-1);
    if (parent) addChild(parent.obj, tag.name, value);
    else ready.push(value);
  });

  const drain = function* () {
    if (error) throw error;
    const out = ready;
    ready = [];
    yield* out;
  };

  for await (const chunk of source) {
    parser.write(chunk);
    yield* drain();
  }
  parser.close();
  yield* drain();
  frames = [];
}

export interface PathSuggestion {
  path: string;
  count: number;
}

/**
 * Ürün düğümü yolu önerisi: alt elemanı olan ve en çok tekrarlanan eleman yolları.
 * Dosyanın yalnızca başı okunur (`maxElements`).
 */
export async function suggestItemPaths(
  source: AsyncIterable<string>,
  { maxElements = 20_000, limit = 5 } = {},
): Promise<PathSuggestion[]> {
  const counts = new Map<string, number>();
  const path: string[] = [];
  const hasChild: boolean[] = [];
  let seen = 0;
  let error: XmlParseError | undefined;

  const parser = createParser((err) => {
    error ??= err;
  });
  parser.on("opentag", (tag) => {
    if (hasChild.length) hasChild[hasChild.length - 1] = true;
    path.push(tag.name);
    hasChild.push(false);
    seen++;
  });
  parser.on("closetag", () => {
    if (hasChild.pop() && path.length > 1) {
      const p = "/" + path.join("/");
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    path.pop();
  });

  for await (const chunk of source) {
    parser.write(chunk);
    if (error) throw error;
    if (seen >= maxElements) break;
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([p, count]) => ({ path: p, count }))
    .sort((a, b) => b.count - a.count || a.path.length - b.path.length)
    .slice(0, limit);
}
