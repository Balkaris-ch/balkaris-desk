import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import { normalPath, pathOf, siteHost, twinHost } from "./http.ts";

/**
 * One page's HTML, turned into facts.
 *
 * Pure: a string goes in, a record comes out, nothing is fetched and nothing
 * is stored. The crawl calls it once per page, inside the capped thread of
 * parser.ts; the check script calls it directly on small hand-written pages
 * to prove the rules. It imports nothing that opens the database, so the
 * thread never does either.
 *
 * WHAT IS READ IS WHAT WAS SERVED. The site is a Next.js app whose pages are
 * prerendered, so the HTML already holds everything a crawler sees: head,
 * headings, links, images, structured data. Scripts are NOT run: jsdom parses
 * and nothing else. Whatever client code adds after load (a video's source,
 * a lazily mounted scene) is therefore invisible here, which is why a file
 * the crawl did not find is "not found on any page" and never "unused".
 *
 * ONE DOCUMENT AT A TIME. A parsed page costs several megabytes of jsdom
 * objects and the desk lives inside 768 MB, so `parsePage` is synchronous
 * from the first byte to `window.close()`: two documents are never being
 * built at once, however many pages are being fetched. (A closed window is
 * only released after the event loop turns, which is why the crawl runs this
 * in a thread of its own; see parser.ts.)
 */

export type AltState =
  /** alt="Three gates in a row…": the picture is content and is described. */
  | "written"
  /** alt="": the author says it is decoration. Correct, and never an error. */
  | "empty"
  /** No alt attribute at all: a screen reader reads out the file name. Always a fault. */
  | "absent";

export interface ImageFact {
  /**
   * The file in the site's public folder, site-relative ("/work/allumi/cover.webp"),
   * or null when the picture comes from another host.
   */
  file: string | null;
  /** The other host ("images.unsplash.com"), or null when it is the site's own. */
  remote: string | null;
  /** The picture's address on that other host, without its query. Absent for the site's own files. */
  remoteUrl?: string;
  /**
   * How it reaches the reader. "optimised": through /_next/image, which
   * resizes and re-encodes it (so the source file's format and pixel size
   * are not what is sent). "direct": the file itself.
   */
  via: "optimised" | "direct";
  alt: AltState;
  /** The words, when written. */
  altText?: string;
  /** The width and height attributes, when the tag carries them. */
  width: number | null;
  height: number | null;
  /** The loading attribute ("lazy", "eager"), when present. */
  loading: string | null;
  /** Inside something marked aria-hidden or role=presentation: hidden from assistive technology on purpose. */
  hidden: boolean;
  /** In the page's own content, or in the menu, header and footer every page shares. */
  place: "main" | "chrome";
  /** The only thing inside a link, with no words anywhere on it: the link has no name. */
  unnamedLink: boolean;
}

export interface VideoFact {
  /** The video file in the public folder, or null (another host, or set later by client code). */
  file: string | null;
  remote: string | null;
  /** The poster picture in the public folder, when there is one. */
  poster: string | null;
}

export interface LinkFact {
  /** Internal: the stored address ("/seo"). External: the absolute URL without its fragment. */
  target: string;
  internal: boolean;
  /** The words of the first such link on the page (or its picture's alt, or its aria-label). */
  text: string;
  /** The rel attribute of the first such link, as written. */
  rel: string;
  place: "main" | "chrome";
  /** How many times the page links there from this place. */
  times: number;
}

export interface SchemaNode {
  /** The @type, joined with "+" when a node has several. */
  type: string;
  id: string | null;
  /** Required fields that are missing. Empty means the node is complete as far as the desk checks. */
  missing: string[];
  /** False when the desk has no rule for this type: it was read, not judged. */
  known: boolean;
}

export interface SchemaBlock {
  /** Whether the block is JSON at all. */
  parses: boolean;
  error?: string;
  nodes: SchemaNode[];
}

export interface PageFacts {
  title: string | null;
  description: string | null;
  /** The canonical link's href exactly as written. */
  canonical: string | null;
  /** The robots meta tag's content, lower-cased, or null when the page has none. */
  robots: string | null;
  lang: string | null;
  h1: string[];
  h2: number;
  og: { title: string | null; description: string | null; image: string | null; type: string | null; url: string | null };
  twitter: { card: string | null; image: string | null };
  schema: SchemaBlock[];
  /** Every structured-data type on the page, once each. */
  schemaTypes: string[];
  /** Words in the page's own content: inside <main>, without scripts, styles and anything aria-hidden. */
  words: number;
  /** Distinct addresses linked: on the site (from the content only, and in all), and elsewhere. */
  links: { internal: number; internalFromContent: number; external: number };
  images: ImageFact[];
  videos: VideoFact[];
  /**
   * Every file path the HTML mentions anywhere: tags, preloads, inline
   * styles and the data Next ships for hydration. Wider than `images`: it is
   * how a file that only client code will load is still found on the page.
   */
  mentions: string[];
  /**
   * The <h2> headings' words, in order: at most 40, each cut at 200
   * characters. Absent in facts kept before October 2026.
   */
  h2s?: string[];
  /**
   * The language versions the page names (<link rel="alternate" hreflang>):
   * the code as written and the absolute address. At most 50. Absent in facts
   * kept before October 2026.
   */
  hreflang?: { lang: string; href: string }[];
  /** The page's own text as the duplicate rules compare it (see `ContentPrint`). Absent in facts kept before October 2026. */
  content?: ContentPrint;
}

/**
 * The page's own text, fingerprinted for the duplicate rules in rules.ts.
 *
 * WHAT "OWN TEXT" IS, decided here, on the page alone. The words inside
 * <main> (the shared menu, header and footer of the layout sit outside it
 * on every page of the site, which is why `words` already counts <main>
 * only), without what is never read (scripts, styles, SVG, anything hidden
 * or aria-hidden) and without navigation INSIDE <main>: <nav>, forms and
 * role=navigation|search|menu. On the site those are the breadcrumb, the
 * "On this page" contents, the journal's shelves and the legal links: lists
 * of other pages' names, not words of this one. Taken block by block (a
 * paragraph, a list item, a heading, a table cell, a button…), each block
 * NFKC-folded, lower-cased, and every run of characters that is not a
 * letter or a digit turned into one space.
 *
 * WHAT IS TEMPLATE, decided in rules.ts, across pages: a block whose text
 * stands on many other pages (the "Work with us" box beside every article,
 * the list of capabilities under every service, "Asked before deciding.").
 * That needs every page, so this record keeps each block's fingerprint and
 * the rules leave the template blocks out when they compare two pages.
 */
export interface ContentPrint {
  /**
   * md5 (hex) of the normalised own text, its blocks joined by a line break.
   * Two pages with the same value have the same own text, word for word.
   */
  md5: string;
  /** Words in the normalised own text. */
  words: number;
  /**
   * Each block in order: the first 12 hex characters of the md5 of its
   * normalised text, and its words. At most `PRINT.blocks`; a page with more
   * keeps the first ones.
   */
  blocks: [string, number][];
  /** Distinct shingles (runs of `PRINT.shingle` words inside one block; a shorter block is one shingle). */
  shingles: number;
  /**
   * MinHash in its bottom-k form: of every distinct shingle's 32-bit hash
   * (the first four bytes of its md5), the `PRINT.sketch` smallest, each with
   * the index of the block it was first found in (0xffff when that block is
   * past the kept list). Packed little-endian, 6 bytes an entry, ascending,
   * as base64. A page with fewer shingles than that keeps them all, and
   * two such pages are compared exactly.
   */
  sketch: string;
}

/** The sizes behind `ContentPrint`. Changing one changes every fingerprint at the next crawl. */
export const PRINT = {
  /** Words in a shingle. Five is the usual size for near-duplicate detection of prose. */
  shingle: 5,
  /** Entries in the bottom-k sketch. 128 estimates a similarity of 0.8 within about ±0.04. */
  sketch: 128,
  /** Blocks listed per page. */
  blocks: 400,
} as const;

/** How the parse can be widened, for the custom extraction and the audit of one address (extract.ts, audit.ts). */
export interface ParseOptions {
  /**
   * The host the page belongs to when it is not the website's: a page of
   * another site, audited on its own. Links and pictures on that host (or
   * its "www." twin) then count as the page's own, as the site's do for a
   * page of the site.
   */
  host?: string;
  /** Called with the parsed document before its window is closed: what custom extraction reads. */
  visit?: (doc: Document) => void;
}

export interface Parsed {
  facts: PageFacts;
  links: LinkFact[];
  /** A fingerprint of what a reader and a search engine would notice changing: head, headings and the words. Not the markup, which changes with every deploy. */
  hash: string;
}

/* ---------- structured data ------------------------------------------------ */

type Node = Record<string, unknown>;

const has = (n: Node, k: string): boolean => {
  const v = n[k];
  return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

/**
 * What each type the site emits must carry.
 *
 * Google's own "required properties" where it documents a rich result
 * (BreadcrumbList, FAQPage, LocalBusiness), and for the rest the least a node
 * needs to say anything at all: a name, a headline, a url. Deliberately
 * short. A validator that demands every recommended field cries wolf, and
 * Google's Rich Results Test, which has no API, remains the last word.
 */
const SHAPES: Record<string, (n: Node) => string[]> = {
  Organization: (n) => ["name", "url"].filter((k) => !has(n, k)),
  ProfessionalService: (n) => ["name", "address"].filter((k) => !has(n, k)),
  LocalBusiness: (n) => ["name", "address"].filter((k) => !has(n, k)),
  WebSite: (n) => ["name", "url"].filter((k) => !has(n, k)),
  WebPage: (n) => ["name"].filter((k) => !has(n, k)),
  Service: (n) => ["name", "provider"].filter((k) => !has(n, k)),
  CreativeWork: (n) => ["name"].filter((k) => !has(n, k)),
  Person: (n) => ["name"].filter((k) => !has(n, k)),
  Article: (n) => ["headline", "datePublished", "author"].filter((k) => !has(n, k)),
  BreadcrumbList: (n) => {
    const items = list(n.itemListElement) as Node[];
    if (!items.length) return ["itemListElement"];
    const missing: string[] = [];
    items.forEach((it, i) => {
      if (!has(it, "position")) missing.push(`itemListElement[${i}].position`);
      if (!has(it, "name")) missing.push(`itemListElement[${i}].name`);
      /* The last crumb is the page itself and may go without a link. */
      if (!has(it, "item") && i < items.length - 1) missing.push(`itemListElement[${i}].item`);
    });
    return missing;
  },
  FAQPage: (n) => {
    const questions = list(n.mainEntity) as Node[];
    if (!questions.length) return ["mainEntity"];
    const missing: string[] = [];
    questions.forEach((q, i) => {
      if (!has(q, "name")) missing.push(`mainEntity[${i}].name`);
      const answer = (q.acceptedAnswer ?? null) as Node | null;
      if (!answer || !has(answer, "text")) missing.push(`mainEntity[${i}].acceptedAnswer.text`);
    });
    return missing;
  },
};

/** One JSON-LD block, judged. Exported for the check script. */
export function readSchema(json: string): SchemaBlock {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    return { parses: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 120), nodes: [] };
  }
  const tops = list(data) as Node[];
  const nodes: SchemaNode[] = [];
  for (const top of tops) {
    if (!top || typeof top !== "object") continue;
    const inner = Array.isArray(top["@graph"]) ? (top["@graph"] as Node[]) : [top];
    const noContext = !has(top, "@context");
    for (const n of inner) {
      const types = list(n["@type"]).map(String);
      const shape = types.map((t) => SHAPES[t]).find(Boolean);
      nodes.push({
        type: types.join("+") || "(no @type)",
        id: typeof n["@id"] === "string" ? (n["@id"] as string) : null,
        missing: [...(noContext ? ["@context"] : []), ...(types.length ? [] : ["@type"]), ...(shape ? shape(n) : [])],
        known: Boolean(shape),
      });
    }
  }
  return { parses: true, nodes };
}

/* ---------- the page -------------------------------------------------------- */

const squash = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();
const orNull = (s: string | null | undefined): string | null => squash(s) || null;
const int = (s: string | null): number | null => (s && /^\d+$/.test(s.trim()) ? Number(s) : null);

/** File types worth noticing when the HTML mentions them. */
const MEDIA = "webp|avif|png|jpe?g|gif|svg|ico|mp4|webm|mov|m4v|mp3|wav|woff2?|ttf|otf|glb|gltf|splinecode|riv|pdf";
const MENTION = new RegExp(`(?:/[A-Za-z0-9._~@+-]+)+\\.(?:${MEDIA})\\b`, "gi");

/**
 * Where a src really points: the file in public/, or the other host.
 * `/_next/image?url=%2Fwork%2Fa.webp&w=640` is the optimiser serving
 * /work/a.webp, and is reported as that file, "optimised".
 */
function resolveSrc(src: string, pageUrl: string, ownHosts: readonly string[] = [siteHost(), twinHost()]): { file: string | null; remote: string | null; remoteUrl?: string; via: "optimised" | "direct" } | null {
  if (!src || src.startsWith("data:") || src.startsWith("blob:")) return null;
  let u: URL;
  try {
    u = new URL(src, pageUrl);
  } catch {
    return null;
  }
  const own = ownHosts.includes(u.host);
  if (own && u.pathname === "/_next/image") {
    const inner = u.searchParams.get("url");
    if (!inner) return null;
    const hit = resolveSrc(inner, pageUrl, ownHosts);
    return hit ? { ...hit, via: "optimised" } : null;
  }
  if (own) return { file: decoded(u.pathname), remote: null, via: "direct" };
  return { file: null, remote: u.host, remoteUrl: `${u.origin}${u.pathname}`.slice(0, 300), via: "direct" };
}

/** "%20" back to a space, so a path matches the file's name in the repository. A broken escape is left as written. */
function decoded(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/**
 * The page without what no fact is read from: the bodies of scripts (except
 * structured data), stylesheets and the drawing inside SVG icons. Half of a
 * served page is the data Next ships for hydration, and jsdom would build
 * objects for every byte of it. Words, links, pictures and the head are
 * untouched; the files the HTML mentions are looked for in the page as
 * served, before this. A link or picture drawn inside an SVG would be lost;
 * the site's pages drew none when this was written.
 */
const lighter = (html: string): string =>
  html
    .replace(/<script\b(?![^>]*application\/ld\+json)[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<svg\b([^>]*)>[\s\S]*?<\/svg>/gi, "<svg$1></svg>");

/* ---------- the own text's fingerprint (ContentPrint) ------------------------ */

/** Never read at all: not counted in `words`, not part of the own text. */
const SKIP = "script,style,noscript,template,svg,dialog,[hidden],[aria-hidden='true']";
/** Never part of the own text: what `words` skips, and navigation inside <main>. */
const NOT_OWN = `${SKIP},nav,form,[role='navigation'],[role='search'],[role='menu']`;
/** The elements whose text is one block. Text outside all of them belongs to its nearest parent that is not inline. */
const BLOCK = "p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote,figcaption,dt,dd,pre,summary,caption,legend,button";
const INLINE = new Set(["A", "ABBR", "B", "BDI", "BDO", "CITE", "CODE", "DATA", "DFN", "EM", "I", "KBD", "MARK", "Q", "S", "SAMP", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "TIME", "U", "VAR", "LABEL", "FONT"]);
/** A ceiling on the text fingerprinted, so one enormous page costs a bounded amount: about 30,000 words. */
const PRINT_CHARS = 200_000;

/** NFKC, lower case, and every run of anything but letters and digits as one space. */
export const normaliseText = (s: string): string =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const md5 = (s: string): Buffer => createHash("md5").update(s).digest();

/**
 * The text of `root` (<main>, or <body> on a page without one), read once,
 * in document order:
 *
 *   pieces   every text node that is read at all (SKIP left out), squashed:
 *            what `words` counts and the change fingerprint hashes;
 *   blocks   the own text (NOT_OWN left out) as blocks of normalised words:
 *            what ContentPrint is made of. A text node belongs to its nearest
 *            BLOCK ancestor; without one, to its nearest ancestor that is not
 *            inline (or `root`).
 *
 * ONE TOP-DOWN PASS. Each element's state (inside something skipped, inside
 * navigation, its block) is carried down from its parent, so the cost is one
 * step per node however deep the nesting. Asking element.closest() for every
 * text node costs one step per ANCESTOR, and a page nested a few thousand
 * deep (anybody can name one to the audit) turned that into minutes.
 */
function readText(root: Element): { pieces: string[]; blocks: string[] } {
  const pieces: string[] = [];
  const by = new Map<Element, string[]>();
  let chars = 0;
  /** An element's state, which its child nodes read. */
  interface At {
    /** Inside something that is not own text (NOT_OWN). */
    notOwn: boolean;
    /** The nearest BLOCK ancestor-or-self, or null. */
    block: Element | null;
    /** The nearest ancestor-or-self that is not inline, or `root`. */
    plain: Element;
  }
  /* What lies above `root` counts as closest() would see it. */
  const above = root.parentElement;
  if (above?.closest(SKIP) || root.matches(SKIP)) return { pieces, blocks: [] };
  const start: At = {
    notOwn: Boolean(above?.closest(NOT_OWN)) || root.matches(NOT_OWN),
    block: root.matches(BLOCK) ? root : (above?.closest(BLOCK) ?? null),
    plain: root,
  };
  /* Nodes still to visit, each with its parent's state; children are pushed
     last-first so they come off in document order. */
  const stack: [ChildNode, At][] = [];
  const push = (el: Element, at: At): void => {
    const kids = el.childNodes;
    for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i] as ChildNode, at]);
  };
  push(root, start);
  while (stack.length) {
    const [n, at] = stack.pop() as [ChildNode, At];
    if (n.nodeType === 3) {
      const raw = n.nodeValue ?? "";
      const t = squash(raw);
      if (t) pieces.push(t);
      if (!at.notOwn && chars < PRINT_CHARS) {
        const own = normaliseText(raw);
        if (own) {
          const block = at.block ?? at.plain;
          const parts = by.get(block) ?? [];
          parts.push(own);
          by.set(block, parts);
          chars += own.length + 1;
        }
      }
    } else if (n.nodeType === 1) {
      const el = n as Element;
      /* Nothing under a skipped element is read at all. */
      if (el.matches(SKIP)) continue;
      push(el, {
        notOwn: at.notOwn || el.matches(NOT_OWN),
        block: el.matches(BLOCK) ? el : at.block,
        plain: INLINE.has(el.tagName) ? at.plain : el,
      });
    }
  }
  return { pieces, blocks: [...by.values()].map((p) => p.join(" ")) };
}

/** The fingerprint of a page's own text: md5, blocks, and the bottom-k MinHash sketch. Exported for the check script. */
export function contentPrint(blocks: readonly string[]): ContentPrint {
  const text = blocks.join("\n");
  const listed: [string, number][] = [];
  /* Every distinct shingle's hash, with the block it was first found in. */
  const hashes = new Map<number, number>();
  let words = 0;
  blocks.forEach((b, i) => {
    const w = b.split(" ");
    words += w.length;
    if (i < PRINT.blocks) listed.push([md5(b).toString("hex").slice(0, 12), w.length]);
    const at = i < PRINT.blocks ? i : 0xffff;
    const add = (s: string) => {
      const h = md5(s).readUInt32LE(0);
      if (!hashes.has(h)) hashes.set(h, at);
    };
    if (w.length < PRINT.shingle) add(b);
    else for (let k = 0; k + PRINT.shingle <= w.length; k++) add(w.slice(k, k + PRINT.shingle).join(" "));
  });
  const smallest = [...hashes.keys()].sort((a, b) => a - b).slice(0, PRINT.sketch);
  const packed = Buffer.alloc(smallest.length * 6);
  smallest.forEach((h, i) => {
    packed.writeUInt32LE(h, i * 6);
    packed.writeUInt16LE(hashes.get(h) as number, i * 6 + 4);
  });
  return { md5: createHash("md5").update(text).digest("hex"), words, blocks: listed, shingles: hashes.size, sketch: packed.toString("base64") };
}

/**
 * Read one served page.
 *
 * `url` is the address it was served from: relative links and sources are
 * resolved against it. During a crawl this runs inside parser.ts's capped
 * thread (`parseIsolated`), or extract.ts's when custom extraction rules are
 * on; called directly it runs here. `opts` is for a page of another site and
 * for extraction (see ParseOptions); without it the page is the website's.
 */
export function parsePage(html: string, url: string, opts: ParseOptions = {}): Parsed {
  const dom = new JSDOM(lighter(html), { url });
  try {
    const doc = dom.window.document;
    const meta = (sel: string): string | null => orNull(doc.querySelector(sel)?.getAttribute("content"));
    const main = doc.querySelector("main");
    const inMain = (el: Element): boolean => (main ? main.contains(el) : true);
    /* The hosts that are this page's own: the website's two, or the audited site's. */
    const ownHosts = opts.host ? [opts.host, opts.host.startsWith("www.") ? opts.host.slice(4) : `www.${opts.host}`] : [siteHost(), twinHost()];
    const pathOn = (u: string): string | null => {
      if (!opts.host) return pathOf(u);
      try {
        const p = new URL(u);
        return (p.protocol === "http:" || p.protocol === "https:") && ownHosts.includes(p.host) ? normalPath(p.pathname) : null;
      } catch {
        return null;
      }
    };

    /* --- structured data --- */
    const schema: SchemaBlock[] = [...doc.querySelectorAll('script[type="application/ld+json"]')].map((s) => readSchema(s.textContent ?? ""));
    const schemaTypes = [...new Set(schema.flatMap((b) => b.nodes.flatMap((n) => n.type.split("+"))))].sort();

    /* --- words: the page's own content, one text node at a time so two
           blocks side by side are not glued into one word; and the own
           text's blocks, in the same pass (readText) --- */
    const root = main ?? doc.body;
    const { pieces, blocks: own } = root ? readText(root) : { pieces: [], blocks: [] };
    const text = pieces.join(" ");
    const words = text ? text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;

    /* --- links --- */
    const links = new Map<string, LinkFact>();
    for (const a of doc.querySelectorAll("a[href]")) {
      const href = (a.getAttribute("href") ?? "").trim();
      if (!href || href.startsWith("#") || /^(mailto|tel|javascript|sms):/i.test(href)) continue;
      let u: URL;
      try {
        u = new URL(href, url);
      } catch {
        continue;
      }
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      const internalPath = pathOn(u.toString());
      const internal = internalPath !== null;
      u.hash = "";
      const target = internal ? (internalPath as string) : u.toString();
      const place = inMain(a) ? "main" : "chrome";
      const key = `${place}\n${target}`;
      const words = squash(a.textContent) || squash(a.querySelector("img[alt]")?.getAttribute("alt")) || squash(a.getAttribute("aria-label")) || squash(a.getAttribute("title"));
      const had = links.get(key);
      if (had) {
        had.times++;
        if (!had.text && words) had.text = words.slice(0, 160);
      } else {
        links.set(key, { target, internal, text: words.slice(0, 160), rel: squash(a.getAttribute("rel")), place, times: 1 });
      }
    }
    const linkList = [...links.values()];
    const self = pathOn(url);
    const distinct = (pred: (l: LinkFact) => boolean) => new Set(linkList.filter(pred).map((l) => l.target)).size;

    /* --- pictures --- */
    const images: ImageFact[] = [];
    for (const img of doc.querySelectorAll("img")) {
      const hit = resolveSrc((img.getAttribute("src") ?? "").trim(), url, ownHosts);
      if (!hit) continue;
      const altAttr = img.getAttribute("alt");
      const alt: AltState = altAttr === null ? "absent" : altAttr.trim() === "" ? "empty" : "written";
      const link = img.closest("a");
      const named = link ? Boolean(squash(link.textContent) || squash(link.getAttribute("aria-label")) || squash(link.getAttribute("title")) || squash(link.getAttribute("aria-labelledby"))) : true;
      images.push({
        ...hit,
        alt,
        ...(alt === "written" ? { altText: squash(altAttr).slice(0, 300) } : {}),
        width: int(img.getAttribute("width")),
        height: int(img.getAttribute("height")),
        loading: orNull(img.getAttribute("loading")),
        hidden: Boolean(img.closest("[aria-hidden='true'],[role='presentation'],[role='none']")),
        place: inMain(img) ? "main" : "chrome",
        unnamedLink: Boolean(link) && !named && alt !== "written",
      });
    }

    /* --- video --- */
    const videos: VideoFact[] = [];
    for (const v of doc.querySelectorAll("video")) {
      const poster = resolveSrc((v.getAttribute("poster") ?? "").trim(), url, ownHosts);
      const sources = [v.getAttribute("src"), ...[...v.querySelectorAll("source")].map((s) => s.getAttribute("src"))]
        .map((s) => resolveSrc((s ?? "").trim(), url, ownHosts))
        .filter((s): s is NonNullable<typeof s> => s !== null);
      if (!sources.length) videos.push({ file: null, remote: null, poster: poster?.file ?? null });
      for (const s of sources) videos.push({ file: s.file, remote: s.remote, poster: poster?.file ?? null });
    }

    /* --- every file the HTML mentions, wherever --- */
    const flat = html.replace(/%2F/gi, "/").replace(/\\u002[fF]/g, "/").replace(/\\\//g, "/");
    const mentions = new Set<string>();
    const hosts = ownHosts.map((h) => `/${h}`);
    for (const m of flat.matchAll(MENTION)) {
      let p = m[0];
      /* "https://www.balkaris.ch/og/home.jpg" is matched from its second slash on: take the host off again. */
      for (const h of hosts) if (p.startsWith(`${h}/`)) p = p.slice(h.length);
      if (p.startsWith("/_next/") || mentions.size >= 400) continue;
      mentions.add(p);
    }

    const title = orNull(doc.querySelector("title")?.textContent);
    const description = meta('meta[name="description"]');
    const canonical = orNull(doc.querySelector('link[rel="canonical"]')?.getAttribute("href"));
    const robots = meta('meta[name="robots"]')?.toLowerCase() ?? null;
    const h1 = [...doc.querySelectorAll("h1")].map((h) => squash(h.textContent)).filter(Boolean);
    const h2s = [...doc.querySelectorAll("h2")]
      .map((h) => squash(h.textContent).slice(0, 200))
      .filter(Boolean)
      .slice(0, 40);
    const hreflang: { lang: string; href: string }[] = [];
    for (const l of doc.querySelectorAll('link[rel~="alternate"][hreflang]')) {
      const lang = squash(l.getAttribute("hreflang"));
      let href = "";
      try {
        href = new URL((l.getAttribute("href") ?? "").trim(), url).toString();
      } catch {
        href = squash(l.getAttribute("href"));
      }
      if (lang && hreflang.length < 50) hreflang.push({ lang: lang.slice(0, 40), href: href.slice(0, 300) });
    }
    const content = contentPrint(own);

    const facts: PageFacts = {
      title,
      description,
      canonical,
      robots,
      lang: orNull(doc.documentElement.getAttribute("lang")),
      h1,
      h2: doc.querySelectorAll("h2").length,
      og: {
        title: meta('meta[property="og:title"]'),
        description: meta('meta[property="og:description"]'),
        image: meta('meta[property="og:image"]'),
        type: meta('meta[property="og:type"]'),
        url: meta('meta[property="og:url"]'),
      },
      twitter: { card: meta('meta[name="twitter:card"]'), image: meta('meta[name="twitter:image"]') },
      schema,
      schemaTypes,
      words,
      links: {
        internal: distinct((l) => l.internal && l.target !== self),
        internalFromContent: distinct((l) => l.internal && l.place === "main" && l.target !== self),
        external: distinct((l) => !l.internal),
      },
      images,
      videos,
      mentions: [...mentions].sort(),
      h2s,
      hreflang,
      content,
    };

    const hash = createHash("sha1")
      .update(JSON.stringify([title, description, canonical ? normalPath(canonical) : null, robots, h1, text]))
      .digest("hex");

    opts.visit?.(doc);
    return { facts, links: linkList, hash };
  } finally {
    dom.window.close();
  }
}
