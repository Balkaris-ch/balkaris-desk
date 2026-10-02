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
function resolveSrc(src: string, pageUrl: string): { file: string | null; remote: string | null; remoteUrl?: string; via: "optimised" | "direct" } | null {
  if (!src || src.startsWith("data:") || src.startsWith("blob:")) return null;
  let u: URL;
  try {
    u = new URL(src, pageUrl);
  } catch {
    return null;
  }
  const own = u.host === siteHost() || u.host === twinHost();
  if (own && u.pathname === "/_next/image") {
    const inner = u.searchParams.get("url");
    if (!inner) return null;
    const hit = resolveSrc(inner, pageUrl);
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

/**
 * Read one served page.
 *
 * `url` is the address it was served from: relative links and sources are
 * resolved against it. During a crawl this runs inside parser.ts's capped
 * thread (`parseIsolated`); called directly it runs here.
 */
export function parsePage(html: string, url: string): Parsed {
  const dom = new JSDOM(lighter(html), { url });
  try {
    const doc = dom.window.document;
    const meta = (sel: string): string | null => orNull(doc.querySelector(sel)?.getAttribute("content"));
    const main = doc.querySelector("main");
    const inMain = (el: Element): boolean => (main ? main.contains(el) : true);

    /* --- structured data --- */
    const schema: SchemaBlock[] = [...doc.querySelectorAll('script[type="application/ld+json"]')].map((s) => readSchema(s.textContent ?? ""));
    const schemaTypes = [...new Set(schema.flatMap((b) => b.nodes.flatMap((n) => n.type.split("+"))))].sort();

    /* --- words: the page's own content, one text node at a time so two
           blocks side by side are not glued into one word --- */
    const SKIP = "script,style,noscript,template,svg,dialog,[hidden],[aria-hidden='true']";
    const root = main ?? doc.body;
    const pieces: string[] = [];
    if (root) {
      const walker = doc.createTreeWalker(root, dom.window.NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.parentElement?.closest(SKIP)) continue;
        const t = squash(n.nodeValue);
        if (t) pieces.push(t);
      }
    }
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
      const internalPath = pathOf(u.toString());
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
    const self = pathOf(url);
    const distinct = (pred: (l: LinkFact) => boolean) => new Set(linkList.filter(pred).map((l) => l.target)).size;

    /* --- pictures --- */
    const images: ImageFact[] = [];
    for (const img of doc.querySelectorAll("img")) {
      const hit = resolveSrc((img.getAttribute("src") ?? "").trim(), url);
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
      const poster = resolveSrc((v.getAttribute("poster") ?? "").trim(), url);
      const sources = [v.getAttribute("src"), ...[...v.querySelectorAll("source")].map((s) => s.getAttribute("src"))]
        .map((s) => resolveSrc((s ?? "").trim(), url))
        .filter((s): s is NonNullable<typeof s> => s !== null);
      if (!sources.length) videos.push({ file: null, remote: null, poster: poster?.file ?? null });
      for (const s of sources) videos.push({ file: s.file, remote: s.remote, poster: poster?.file ?? null });
    }

    /* --- every file the HTML mentions, wherever --- */
    const flat = html.replace(/%2F/gi, "/").replace(/\\u002[fF]/g, "/").replace(/\\\//g, "/");
    const mentions = new Set<string>();
    const hosts = [`/${siteHost()}`, `/${twinHost()}`];
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
    };

    const hash = createHash("sha1")
      .update(JSON.stringify([title, description, canonical ? normalPath(canonical) : null, robots, h1, text]))
      .digest("hex");

    return { facts, links: linkList, hash };
  } finally {
    dom.window.close();
  }
}
