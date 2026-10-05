import { UA } from "../site/http.ts";
import { siteWire } from "./web/guard.ts";

/**
 * Reading a page the way the SEO engine needs it: politely, and without a DOM.
 *
 * The desk lives in 1 GB beside the engine; jsdom for every competitor page
 * would be most of that. These are plain readings of the HTML a crawler gets
 * (no JavaScript is run), good enough for what is asked of them: the title,
 * the first heading, how many words, the language, the structured-data types,
 * whether a price is stated, and the first words of the content.
 */

const MAX_BYTES = 2_000_000;

export interface Fetched {
  status: number;
  /** The final address after redirects. */
  url: string;
  html: string | null;
  contentType: string | null;
  error: string | null;
}

/** GET a page with the desk's name on it. Never throws; at most 2 MB of body is read. */
export async function fetchPage(url: string, o: { timeout?: number; accept?: string } = {}): Promise<Fetched> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: o.accept ?? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "accept-language": "de-CH,de;q=0.9,en;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(o.timeout ?? 20_000),
    });
    const contentType = res.headers.get("content-type");
    let html: string | null = null;
    if (res.body) {
      const reader = res.body.getReader();
      const parts: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        size += value.byteLength;
        if (size >= MAX_BYTES) {
          await reader.cancel().catch(() => {});
          break;
        }
      }
      html = Buffer.concat(parts).toString("utf8");
    }
    return { status: res.status, url: res.url || url, html, contentType, error: null };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "TimeoutError" ? "no answer in time" : e.message) : String(e);
    return { status: 0, url, html: null, contentType: null, error: msg.slice(0, 160) };
  }
}

/**
 * GET an address somebody typed or a competitor's page, through the web
 * layer's guard (src/cc/seo/web/guard.ts): public names only, the address
 * checked again after DNS, at connect time and on every redirect, so a typed
 * host can never make the desk read the box it runs on. Same answer shape as
 * `fetchPage`; never throws.
 */
export async function fetchGuarded(url: string, o: { timeout?: number; accept?: string } = {}): Promise<Fetched> {
  const got = await siteWire.get(url, { timeoutMs: o.timeout ?? 20_000, accept: o.accept, maxBytes: MAX_BYTES, hops: 4 });
  const contentType = got.headers["content-type"] ?? null;
  return { status: got.status, url: got.url || url, html: got.error && !got.body.length ? null : got.body.toString("utf8"), contentType, error: got.error };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", eacute: "é", egrave: "è" };

export function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

const strip = (html: string): string =>
  decode(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(p|div|li|h[1-6]|section|article|header|footer|td|tr)>/gi, " \n ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();

/** The part of the page that is its own content: <main> when there is one, else <body> without header, nav and footer. */
function contentOf(html: string): string {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1];
  if (main) return main;
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return body.replace(/<(header|nav|footer)\b[\s\S]*?<\/\1>/gi, " ");
}

export interface Read {
  title: string | null;
  h1: string | null;
  lang: string | null;
  words: number;
  /** The content's text, lines kept. */
  text: string;
  schemaTypes: string[];
  /** Every JSON-LD node, parsed, for the checks that look inside them. */
  schema: Record<string, unknown>[];
  /** h2 and h3 headings, in order. */
  headings: string[];
  price: { stated: boolean; text: string | null };
}

/** Every @type in the page's JSON-LD, and the nodes themselves. */
function readSchema(html: string): { types: string[]; nodes: Record<string, unknown>[] } {
  const nodes: Record<string, unknown>[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const v = JSON.parse(m[1]!.trim()) as unknown;
      const walk = (x: unknown): void => {
        if (Array.isArray(x)) return x.forEach(walk);
        if (!x || typeof x !== "object") return;
        const o = x as Record<string, unknown>;
        if (o["@type"]) nodes.push(o);
        if (Array.isArray(o["@graph"])) (o["@graph"] as unknown[]).forEach(walk);
        for (const k of ["mainEntity", "itemListElement", "acceptedAnswer"]) if (o[k]) walk(o[k]);
      };
      walk(v);
    } catch {
      /* not JSON: counted as no structured data */
    }
  }
  const types = new Set<string>();
  for (const n of nodes) for (const t of Array.isArray(n["@type"]) ? (n["@type"] as unknown[]) : [n["@type"]]) if (typeof t === "string") types.add(t);
  return { types: [...types].sort(), nodes };
}

/** A price as Swiss pages write it: "CHF 1'500", "ab CHF 490", "Fr. 80.–", "1'200 Franken", "CHF300". */
const PRICE = /(?:\b(?:ab|from|von|bis|to)\s+)?(?:CHF|Fr\.|SFr\.?)\s?\d[\d'’.,]*(?:\s?[–-]\s?\d[\d'’.,]*)?|\d[\d'’.,]*\s?(?:CHF|Franken)\b/i;

export function readHtml(html: string): Read {
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim() || null;
  const lang = /<html\b[^>]*\blang=["']?([\w-]+)/i.exec(html)?.[1]?.toLowerCase() ?? null;
  const content = contentOf(html);
  const h1 = strip(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(content)?.[1] ?? /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim() || null;
  const text = strip(content);
  const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const headings = [...content.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi)].map((m) => strip(m[1]!).replace(/\s+/g, " ").trim()).filter(Boolean);
  const { types, nodes } = readSchema(html);
  const price = PRICE.exec(text);
  return { title, h1, lang, words, text, schemaTypes: types, schema: nodes, headings, price: { stated: !!price, text: price ? price[0].trim().slice(0, 60) : null } };
}

/** The first `n` words of the content, after its first heading when it has one. */
export function firstWords(text: string, n: number): string {
  return text.split(/\s+/).filter(Boolean).slice(0, n).join(" ");
}
