import { Hono } from "hono";
import { db } from "../../db.ts";
import type { Vars } from "../access.ts";
import { status as jobStatus } from "../scheduler.ts";
import { ok, reading, waiting } from "../store.ts";
import { scrub } from "../system.ts";
import type { Reading, Share, SourceId } from "../../../web/src/contract/common.ts";
import type {
  AssetCheck,
  AssetDetail,
  AssetFigure,
  AssetItem,
  AssetKind,
  AssetList,
  AssetSort,
  AssetsPayload,
  AssetsQuery,
  AssetTab,
  AssetTiles,
  CachingSummary,
  CheckId,
  FilterOption,
  FolderWeight,
  FormatSummary,
  KindWeight,
  RemoteSummary,
  ScanStatus,
  ShareList,
  ShareRow,
  ShareSummary,
} from "../../../web/src/contract/assets.ts";
import type { AssetRow, FolderCache, PageRow, RemoteImage, SharePicture } from "../site/index.ts";

/**
 * /api/v1/assets: every file in the website's public/ folder, where the pages
 * use it, and how it stands for search and speed.
 *
 *   GET /             the whole screen, one payload (query: see the contract)
 *   GET /export.csv   the rows the same query selects, every page of them
 *
 * Everything comes from the website collector (src/cc/site): the files and
 * their measures from the site's repository, the uses from the crawl of the
 * served HTML, each folder's Cache-Control from one file asked per folder.
 * All of it is read from what those jobs stored: nothing here asks the
 * website or the repository. Rescanning is the `assets` job, run through
 * POST /api/v1/jobs/assets/run like any other.
 *
 * There is no period: the files are what is on the branch now. There is no
 * specimen either: every source of this screen is the desk's own and needs no
 * key, so the screen is never waiting for one.
 *
 * THE CHECKS. The collector flags what is wrong by its stated limits (heavy,
 * legacy format, oversized, not found, uncached folder, no alt attribute).
 * This file turns each into a chip and adds three rules of its own, each
 * stated where it is applied: a descriptive file name, width and height in
 * the markup, and the format of films and fonts. A chip that cannot be judged
 * from what the desk sees is left out, never guessed.
 */

export const routes = new Hono<Vars>();

const site = () => import("../site/index.ts");
type Site = Awaited<ReturnType<typeof site>>;

/* ---------- the query ------------------------------------------------------------- */

const TABS: readonly AssetTab[] = ["all", "images", "video", "share", "other", "attention"];
const SORTS: readonly AssetSort[] = ["heaviest", "lightest", "name", "pages", "issues"];
const PER = [8, 25, 50, 100] as const;
const CHECK_IDS: readonly CheckId[] = ["found", "alt", "name", "format", "weight", "pixels", "size", "cache"];

function queryOf(get: (k: string) => string | undefined): AssetsQuery {
  const one = <T extends string>(list: readonly T[], raw: string | undefined, fallback: T): T => list.find((x) => x === raw?.toLowerCase()) ?? fallback;
  const text = (raw: string | undefined, max: number) => (raw ?? "").trim().slice(0, max);
  const per = Number(get("per"));
  const page = Number(get("page"));
  const folder = text(get("folder"), 80);
  const format = text(get("format"), 12).toLowerCase();
  const file = text(get("file") ?? get("open"), 400);
  const flag = get("flag");
  return {
    tab: one(TABS, get("tab"), "all"),
    q: text(get("q"), 120),
    folder: folder && /^[\w.() -]+$/.test(folder) ? folder : null,
    format: format && /^[a-z0-9]+$/.test(format) ? format : null,
    flag: CHECK_IDS.find((c) => c === flag) ?? null,
    sort: one(SORTS, get("sort"), "heaviest"),
    page: Number.isInteger(page) && page > 0 ? Math.min(page, 10_000) : 1,
    per: (PER as readonly number[]).includes(per) ? per : 8,
    file: file.startsWith("/") ? file : null,
  };
}

/* ---------- printing, in the collector's own units (1000, as its limits are written) --- */

function weight(n: number): string {
  if (n < 1000) return `${n} B`;
  if (n < 1_000_000) return `${n < 10_000 ? (n / 1000).toFixed(1) : Math.round(n / 1000)} kB`;
  return `${(n / 1_000_000).toFixed(1)} MB`;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

const KIND_WORD: Record<AssetKind, string> = { image: "a picture", video: "a film", font: "a font", scene: "a 3D scene", audio: "a sound file", document: "a document", other: "a file" };

/** Pictures and films are named by what they show; a camera's or a hash's name says nothing to a search engine. */
const CAMERA = /^(img|dsc[nf]?|dcim|pxl|mvimg|vid|gopr|dji|photo|image|picture|untitled|unnamed|screen ?shot|screenshot|whatsapp image|download|copy of)(?:[\s_-]*[\d(]|$)/i;
const HASHES = [/^[0-9a-f]{12,}$/i, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, /^(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{16,}$/i];
const NAME_RULE = "a word of two letters or more, and no camera, screenshot or hash pattern";

/** Files the website's server and browsers fetch by convention, never through a page: robots.txt, the favicon, a folder's notes. */
const byConvention = (a: Pick<AssetRow, "folder" | "ext">): boolean => a.folder === "" || a.ext === "md";

/* ---------- the checks ------------------------------------------------------------- */

const flagOf = (a: AssetRow, id: AssetRow["flags"][number]["id"]) => a.flags.find((f) => f.id === id);

/** Uses a reader's browser certainly fetches the file for: the collector's own rule (assets.ts, `build`). */
function loadedDirectly(a: AssetRow): boolean {
  return a.uses.some((u) => (u.how === "img" && u.via === "direct") || u.how === "video" || u.how === "poster" || (u.how === "mention" && a.kind !== "image"));
}

/**
 * `crawled`: whether a crawl has finished. Before it, no file has a use, and
 * a rule that reads the uses ("not found on a page") cannot be judged: it is
 * left out, never said.
 */
function checksFor(a: AssetRow, cache: Map<string, FolderCache>, heavyAt: Record<AssetKind, number>, crawled: boolean): AssetCheck[] {
  const out: AssetCheck[] = [];
  const imgs = a.uses.filter((u) => u.how === "img");
  const direct = imgs.filter((u) => u.via === "direct");

  /* found */
  const nf = flagOf(a, "not-found");
  if (nf) out.push({ id: "found", state: "warn", label: "Not found on a page", text: nf.text, measured: "0 pages", limit: "1 page" });

  /* alt */
  if (a.kind === "image" && imgs.length) {
    const absent = flagOf(a, "alt-absent");
    if (absent) {
      out.push({ id: "alt", state: "fail", label: "No alt attribute", text: absent.text, measured: plural(a.alt.absent, "tag"), limit: "0 tags" });
    } else if (a.alt.written) {
      const first = a.altTexts[0];
      out.push({
        id: "alt",
        state: "pass",
        label: "Alt text",
        text: `Described on ${a.alt.written} of ${imgs.length} <img> uses.${a.alt.empty ? ` Marked decorative (alt="") on ${a.alt.empty}.` : ""}${first ? ` First: “${first.slice(0, 120)}”` : ""}`,
        measured: `${a.alt.written} of ${imgs.length}`,
        limit: null,
      });
    } else if (a.decorativeEverywhere) {
      out.push({
        id: "alt",
        state: "note",
        label: "Decorative",
        text: `Every <img> that shows it says alt="": decoration, on purpose, and skipped by screen readers. Right for a picture that adds nothing a reader needs; the desk cannot see the picture to judge that.`,
        measured: `alt="" on ${imgs.length}`,
        limit: null,
      });
    }
  }

  /* name */
  if ((a.kind === "image" || a.kind === "video") && !byConvention(a)) {
    const name = nameOf(a.path);
    const stem = name.replace(/\.[^.]+$/, "");
    const says = (label: string, why: string): AssetCheck => ({
      id: "name",
      state: "warn",
      label,
      text: `“${name}” ${why} A few words for what it shows do: search engines read a file's name beside its alt text.`,
      measured: name,
      limit: NAME_RULE,
    });
    if (CAMERA.test(stem)) out.push(says("Camera name", "is a camera, screenshot or download name: it says nothing about the picture."));
    else if (HASHES.some((h) => h.test(stem))) out.push(says("Hash name", "is a hash or a code: it says nothing about the picture."));
    else if (/^[\d\s._x×-]+$/i.test(stem)) out.push(says("Number name", "is a number: it says nothing about the picture."));
    else if (!/\p{L}{2,}/u.test(stem)) out.push(says("No word in name", "holds no word of two letters or more."));
    else out.push({ id: "name", state: "pass", label: "Descriptive name", text: `“${name}” holds words a search engine can read.`, measured: name, limit: NAME_RULE });
  }

  /* format */
  const EXT = a.ext.toUpperCase();
  if (a.kind === "image" && a.ext !== "ico") {
    const legacy = flagOf(a, "legacy-format");
    if (a.ext === "webp" || a.ext === "avif") {
      out.push({ id: "format", state: "pass", label: EXT, text: `${EXT}: a modern format, which carries a picture in fewer bytes than PNG or JPG.`, measured: a.ext, limit: "webp or avif" });
    } else if (a.ext === "svg") {
      out.push({ id: "format", state: "pass", label: "SVG", text: "SVG: drawn, not pixels, so it is sharp at any size.", measured: a.ext, limit: null });
    } else if (legacy) {
      out.push({ id: "format", state: "fail", label: `${EXT} to readers`, text: legacy.text, measured: a.ext, limit: "webp or avif" });
    } else if (a.sharePictureOf.length && !imgs.length && !loadedDirectly(a)) {
      out.push({ id: "format", state: "note", label: `${EXT} share picture`, text: `Only named as a share picture: social networks fetch it, no reader's browser loads it, and ${EXT} is a format every network's fetcher takes.`, measured: a.ext, limit: null });
    } else if (imgs.length && !direct.length) {
      out.push({ id: "format", state: "note", label: "Re-encoded", text: `Readers get it through the site's image optimiser, which re-encodes it for each browser; the ${EXT} is only the source.`, measured: a.ext, limit: null });
    } else if (crawled && !a.pages.length) {
      out.push({ id: "format", state: "note", label: EXT, text: `${EXT}, not found on a page: whether it should be WebP or AVIF depends on where it is used.`, measured: a.ext, limit: null });
    }
  } else if (a.kind === "video") {
    /* The extension names the container, not the codec inside, and the desk does not read the codec: so a fact, not a pass. */
    if (a.ext === "mov") out.push({ id: "format", state: "warn", label: "MOV", text: "MOV: not every browser plays it. MP4 (H.264) or WebM plays everywhere.", measured: a.ext, limit: "mp4 or webm" });
    else if (a.ext === "mp4" || a.ext === "m4v") out.push({ id: "format", state: "note", label: EXT, text: `${EXT} container. The desk does not read the codec inside it; H.264 in MP4 plays in every current browser, HEVC does not everywhere.`, measured: a.ext, limit: null });
    else if (a.ext === "webm") out.push({ id: "format", state: "note", label: "WEBM", text: "WebM container. The desk does not read the codec inside it; VP9 or AV1 in WebM plays in every current browser.", measured: a.ext, limit: null });
  } else if (a.kind === "font") {
    if (a.ext === "woff2") out.push({ id: "format", state: "pass", label: "WOFF2", text: "WOFF2: the compressed web font format every current browser takes.", measured: a.ext, limit: "woff2" });
    else if (a.ext === "woff") out.push({ id: "format", state: "warn", label: "WOFF", text: "WOFF: compressed, but less than WOFF2, which every current browser takes.", measured: a.ext, limit: "woff2" });
    else out.push({ id: "format", state: "fail", label: EXT, text: `${EXT}: a desktop font file, sent uncompressed. WOFF2 is the web's compressed form of the same font.`, measured: a.ext, limit: "woff2" });
  }

  /* weight */
  if (a.kind !== "document" && a.kind !== "other") {
    const heavy = flagOf(a, "heavy");
    const limit = heavy?.limit != null ? Number(heavy.limit) : null;
    if (heavy) out.push({ id: "weight", state: "fail", label: weight(a.bytes), text: heavy.text, measured: weight(a.bytes), limit: limit !== null ? weight(limit) : null });
    else out.push({ id: "weight", state: "pass", label: "Weight OK", text: `${weight(a.bytes)}, under the desk's limit of ${weight(heavyAt[a.kind])} for ${KIND_WORD[a.kind]}.`, measured: weight(a.bytes), limit: weight(heavyAt[a.kind]) });
  }

  /* pixels: only where the collector could judge (a width on every <img> that shows the file itself) */
  if (a.kind === "image" && a.ext !== "svg" && a.ext !== "ico") {
    const over = flagOf(a, "oversized");
    if (over) {
      out.push({ id: "pixels", state: "fail", label: "Oversized", text: over.text, measured: `${a.width} px`, limit: over.limit != null ? `${over.limit} px` : null });
    } else if (a.width && direct.length && direct.every((u) => u.width)) {
      const widest = Math.max(...direct.map((u) => u.width as number));
      out.push({
        id: "pixels",
        state: "pass",
        label: "Sized to fit",
        text: `${a.width} px wide; the widest <img> that shows it declares ${widest} px, and up to twice that is used by sharp screens.`,
        measured: `${a.width} px`,
        limit: `${widest * 2} px`,
      });
    }
  }

  /* size: width and height in the markup */
  if (a.kind === "image" && imgs.length) {
    const missing = (u: (typeof imgs)[number]) => u.width == null || u.height == null;
    const directMissing = direct.filter(missing).length;
    const fills = imgs.filter((u) => u.via === "optimised" && missing(u)).length;
    const fillWords = fills ? ` ${plural(fills, "optimised use")} fill their box and carry none by design; the box holds their place.` : "";
    if (directMissing) {
      out.push({
        id: "size",
        state: "warn",
        label: "No width/height",
        text: `${plural(directMissing, "<img> tag")} showing the file itself ${directMissing === 1 ? "carries" : "carry"} no width and height: unless the page's CSS sizes the box, the layout jumps when the picture arrives. The desk reads the HTML, not the CSS.${fillWords}`,
        measured: `${directMissing} of ${direct.length}`,
        limit: "0",
      });
    } else if (imgs.some((u) => !missing(u))) {
      out.push({ id: "size", state: "pass", label: "Width & height", text: `Every <img> that names its size gives width and height, so the browser keeps the picture's place before it arrives.${fillWords}`, measured: null, limit: null });
    } else {
      out.push({ id: "size", state: "note", label: "Fills its box", text: `Shown through the optimiser to fill its container, which holds its place; such pictures carry no width and height by design.`, measured: null, limit: null });
    }
  }

  /* cache */
  const unc = flagOf(a, "uncached-folder");
  if (unc) {
    out.push({ id: "cache", state: "fail", label: "No browser cache", text: unc.text, measured: String(unc.measured ?? ""), limit: "max-age above 0" });
  } else {
    const fc = cache.get(a.folder);
    if (fc && fc.cacheControl && fc.maxAge > 0 && loadedDirectly(a)) {
      out.push({ id: "cache", state: "pass", label: "Cached", text: `Served from /${a.folder}/ with “${fc.cacheControl}”: a returning reader's browser keeps it.`, measured: fc.cacheControl, limit: "max-age above 0" });
    }
  }

  return out;
}

const attention = (a: AssetItem): boolean => a.checks.some((c) => c.state === "fail" || c.state === "warn");
const issues = (a: AssetItem): number => a.checks.reduce((s, c) => s + (c.state === "fail" ? 2 : c.state === "warn" ? 1 : 0), 0);

function itemOf(a: AssetRow, cache: Map<string, FolderCache>, heavyAt: Record<AssetKind, number>, crawled: boolean, posters: Map<string, string>): AssetItem {
  return {
    path: a.path,
    name: nameOf(a.path),
    folder: a.folder,
    ext: a.ext,
    kind: a.kind,
    bytes: a.bytes,
    width: a.width,
    height: a.height,
    pages: a.pages,
    alt: a.alt,
    altTexts: a.altTexts,
    decorativeEverywhere: a.decorativeEverywhere,
    shareOf: a.sharePictureOf.length,
    poster: a.kind === "video" ? (posters.get(a.path) ?? null) : null,
    checks: checksFor(a, cache, heavyAt, crawled),
  };
}

/* ---------- films' posters ------------------------------------------------------------ */

let posterMemo: { key: string; map: Map<string, string> } | null = null;

/**
 * Each film's poster, from the crawl's stored facts: the first <video> that
 * shows the film with a poster in public/. Read once per finished crawl; only
 * the films' part of each page's facts is kept. A thumbnail only, so a page
 * whose facts do not parse is passed over.
 */
function postersOf(crawled: string | null): Map<string, string> {
  if (!crawled) return new Map();
  if (posterMemo && posterMemo.key === crawled) return posterMemo.map;
  const map = new Map<string, string>();
  let rows: { path: string; facts: string }[];
  try {
    rows = db.prepare("SELECT path, facts FROM cc_pages WHERE facts IS NOT NULL ORDER BY path").all() as { path: string; facts: string }[];
  } catch (e) {
    console.error("assets: the films' posters could not be read:", e);
    return map;
  }
  for (const r of rows) {
    let videos: unknown;
    try {
      videos = (JSON.parse(r.facts) as { videos?: unknown }).videos;
    } catch {
      continue;
    }
    if (!Array.isArray(videos)) continue;
    for (const v of videos as { file?: unknown; poster?: unknown }[]) {
      if (typeof v?.file === "string" && typeof v.poster === "string" && v.poster.startsWith("/") && !map.has(v.file)) map.set(v.file, v.poster);
    }
  }
  posterMemo = { key: crawled, map };
  return map;
}

/* ---------- selecting rows --------------------------------------------------------- */

const inTab = (tab: Exclude<AssetTab, "share">, a: AssetItem): boolean =>
  tab === "all" ? true : tab === "images" ? a.kind === "image" : tab === "video" ? a.kind === "video" : tab === "other" ? a.kind !== "image" && a.kind !== "video" : attention(a);

function matches(a: AssetItem, q: AssetsQuery): boolean {
  if (q.folder !== null && (q.folder === "(root)" ? a.folder !== "" : a.folder !== q.folder)) return false;
  if (q.format !== null && a.ext !== q.format) return false;
  if (q.flag !== null && !a.checks.some((c) => c.id === q.flag && (c.state === "fail" || c.state === "warn"))) return false;
  if (q.q) {
    const n = q.q.toLowerCase();
    if (!a.path.toLowerCase().includes(n) && !a.altTexts.some((t) => t.toLowerCase().includes(n)) && !a.pages.some((p) => p.toLowerCase().includes(n))) return false;
  }
  return true;
}

const ORDER: Record<AssetSort, (a: AssetItem, b: AssetItem) => number> = {
  heaviest: (a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path),
  lightest: (a, b) => a.bytes - b.bytes || a.path.localeCompare(b.path),
  name: (a, b) => a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" }) || a.path.localeCompare(b.path),
  pages: (a, b) => b.pages.length - a.pages.length || b.bytes - a.bytes,
  issues: (a, b) => issues(b) - issues(a) || b.bytes - a.bytes,
};

const pageOf = <T>(rows: T[], q: AssetsQuery): { rows: T[]; total: number; page: number; per: number } => {
  const last = Math.max(1, Math.ceil(rows.length / q.per));
  const page = Math.min(q.page, last);
  return { rows: rows.slice((page - 1) * q.per, page * q.per), total: rows.length, page, per: q.per };
};

/* ---------- share pictures --------------------------------------------------------- */

/**
 * The site's fallback share picture, site-relative, as the website's
 * repository names it (lib/site.ts `ogImage`): first as the last crawl
 * recorded it, the same reading the Pages screen's rule uses, else from the
 * repository at the fetched commit. Null when neither could read it: no page
 * is then said to be on the default, whatever it shares.
 */
async function siteDefault(s: Site): Promise<string | null> {
  try {
    const sum = s.crawlSummary();
    const fromCrawl = sum.state === "ok" ? sum.value.defaultShare : undefined;
    if (fromCrawl) return fromCrawl;
    return (await s.structure().catch(() => null))?.defaultShare ?? null;
  } catch (e) {
    console.error("assets: the site's default share picture could not be read:", e);
    return null;
  }
}

function shareRows(pictures: SharePicture[], titles: Map<string, string | null>, defaultPath: string | null, pathOf: (url: string) => string | null): { rows: ShareRow[]; defaultPicture: string | null } {
  const onDefault = (picture: string): boolean => defaultPath !== null && pathOf(picture) === defaultPath;
  const rows = pictures.map(
    (s): ShareRow => ({
      page: s.page,
      title: titles.get(s.page) ?? null,
      picture: s.picture,
      file: s.file,
      origin: s.origin,
      status: !s.picture ? "none" : onDefault(s.picture) ? "default" : s.sharedBy > 1 ? "shared" : "own",
      sharedBy: s.sharedBy,
      width: s.width,
      height: s.height,
      bytes: s.bytes,
    }),
  );
  return { rows, defaultPicture: defaultPath };
}

const SHARE_ORDER: Record<ShareRow["status"], number> = { none: 0, default: 1, shared: 2, own: 3 };

function shareMatches(r: ShareRow, q: AssetsQuery): boolean {
  if (!q.q) return true;
  const n = q.q.toLowerCase();
  return r.page.toLowerCase().includes(n) || (r.title ?? "").toLowerCase().includes(n) || (r.picture ?? "").toLowerCase().includes(n);
}

/* ---------- reading everything once ------------------------------------------------- */

interface Loaded {
  s: Site;
  /** The collector's rows, the screen's items in the same order, and the reading they came in. */
  rows: AssetRow[];
  items: AssetItem[];
  base: Reading<AssetRow[]>;
  folderCache: Reading<FolderCache[]>;
  crawled: string | null;
}

async function load(): Promise<Loaded | { failed: string }> {
  try {
    const s = await site();
    const base = s.assets();
    const folderCache = s.folders();
    const cache = new Map((folderCache.state === "ok" ? folderCache.value : []).map((f) => [f.folder, f]));
    const rows = base.state === "ok" ? base.value : [];
    const crawled = s.crawledAt();
    /* A poster is drawn only when it is a picture the desk has listed in public/. */
    const pictures = new Set(rows.filter((r) => r.kind === "image").map((r) => r.path));
    const posters = new Map([...postersOf(crawled)].filter(([, p]) => pictures.has(p)));
    return { s, rows, items: rows.map((r) => itemOf(r, cache, s.ASSET_LIMITS.heavy, Boolean(crawled), posters)), base, folderCache, crawled };
  } catch (e) {
    /* The whole reason goes to the log; a browser gets a sentence, not a file path or a stack. */
    console.error("assets: the website collector did not load:", e);
    return { failed: "The website collector did not load, so nothing about the files can be read. The reason is in the desk's log; the top bar's light names the failing part." };
  }
}

/** A reading that needs the files measured (and, with `crawl`, the crawl finished). */
function fromFiles<T>(l: Loaded, make: () => T, o: { crawl?: boolean; note?: string } = {}): Reading<T> {
  if (l.base.state !== "ok") return l.base;
  if (o.crawl && !l.crawled) return waiting("crawl", "The first crawl has not finished yet; which page uses which file comes from it.");
  const source: SourceId = o.crawl ? "crawl" : "repo";
  const asOf = o.crawl ? (l.crawled as string) : l.base.asOf;
  return ok(make(), source, asOf, o.note ?? (o.crawl ? undefined : l.base.note));
}

const CRAWL_NOTE = "From the served HTML of every page the crawl reads. The crawl runs no scripts, so a file only client code loads is not seen.";

function kindParts(items: AssetItem[], by: "count" | "bytes"): Share[] {
  const groups: { key: KindWeight["key"]; label: string }[] = [
    { key: "image", label: "Images" },
    { key: "video", label: "Video" },
    { key: "font", label: "Fonts" },
    { key: "other", label: "Other" },
  ];
  return groups.map((g) => {
    const of = items.filter((a) => (g.key === "other" ? a.kind !== "image" && a.kind !== "video" && a.kind !== "font" : a.kind === g.key));
    return { key: g.key, label: g.label, value: by === "count" ? of.length : of.reduce((s, a) => s + a.bytes, 0) };
  });
}

function formatParts(items: AssetItem[]): Share[] {
  const by = new Map<string, number>();
  for (const a of items) by.set(a.ext, (by.get(a.ext) ?? 0) + 1);
  return [...by].sort((x, y) => y[1] - x[1]).map(([ext, n]) => ({ key: ext, label: ext.toUpperCase(), value: n }));
}

function tiles(l: Loaded): AssetTiles {
  const items = l.items;
  const images = items.filter((a) => a.kind === "image");
  const videos = items.filter((a) => a.kind === "video");
  const bytes = items.reduce((s, a) => s + a.bytes, 0);
  const folderCount = new Set(items.map((a) => a.folder)).size;
  const fig = (f: AssetFigure): AssetFigure => f;
  const byKindBytes = kindParts(items, "bytes");

  const alt = l.rows.reduce((t, a) => ({ written: t.written + a.alt.written, empty: t.empty + a.alt.empty, absent: t.absent + a.alt.absent }), { written: 0, empty: 0, absent: 0 });
  const checked = l.rows.filter((a) => !byConvention(a));
  const notFound = l.rows.filter((a) => a.flags.some((f) => f.id === "not-found")).length;

  const n = (v: number) => v.toLocaleString("en-GB");
  const counts = kindParts(items, "count");
  const countOf = (k: string) => counts.find((p) => p.key === k)?.value ?? 0;
  const kindLine = [
    [countOf("image"), "image", "images"],
    [countOf("video"), "film", "films"],
    [countOf("font"), "font", "fonts"],
    [countOf("other"), "other", "other"],
  ]
    .filter(([v]) => (v as number) > 0)
    .map(([v, one, many]) => `${n(v as number)} ${v === 1 ? one : many}`)
    .join(" · ");
  const weightLine = [...byKindBytes]
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 2)
    .map((p) => `${p.label} ${Math.round((p.value / bytes) * 100)}%`)
    .join(" · ");
  const formatLine = (list: AssetItem[]) =>
    formatParts(list)
      .slice(0, 3)
      .map((p) => `${n(p.value)} ${p.label}`)
      .join(" · ");

  return {
    files: fromFiles(l, () => fig({ value: items.length, unit: "count", sub: kindLine || `in ${plural(folderCount, "folder")}`, parts: counts, partsUnit: "count" })),
    weight: fromFiles(l, () => fig({ value: bytes, unit: "bytes", sub: weightLine || undefined, parts: byKindBytes, partsUnit: "bytes" })),
    images: fromFiles(l, () => fig({ value: images.length, unit: "count", sub: formatLine(images) || undefined, parts: formatParts(images), partsUnit: "count" })),
    videos: fromFiles(l, () =>
      fig({ value: videos.length, unit: "count", sub: videos.length ? `${weight(videos.reduce((s, a) => s + a.bytes, 0))} together` : undefined, parts: formatParts(videos), partsUnit: "count" }),
    ),
    missingAlt: fromFiles(
      l,
      () =>
        fig({
          value: l.rows.filter((a) => a.alt.absent > 0).length,
          unit: "count",
          sub: `${n(alt.empty)} uses marked decorative`,
          parts: [
            { key: "written", label: "Described", value: alt.written },
            { key: "empty", label: 'Decorative (alt="")', value: alt.empty },
            { key: "absent", label: "No alt attribute", value: alt.absent },
          ],
          partsUnit: "count",
        }),
      { crawl: true, note: CRAWL_NOTE },
    ),
    notFound: fromFiles(
      l,
      () =>
        fig({
          value: notFound,
          unit: "count",
          of: checked.length,
          sub: "client code may still load some",
          parts: [
            { key: "found", label: "Found on a page", value: checked.length - notFound },
            { key: "not-found", label: "Not found on any page", value: notFound },
          ],
          partsUnit: "count",
        }),
      { crawl: true, note: CRAWL_NOTE },
    ),
  };
}

const CHECK_LABEL: Record<CheckId, string> = {
  found: "Not found on any page",
  alt: "No alt attribute",
  name: "Camera, hash or number name",
  format: "Format to change",
  weight: "Heavy for its kind",
  pixels: "Pixels far above display",
  size: "No width/height in markup",
  cache: "No browser cache",
};

function filters(l: Loaded): AssetsPayload["filters"] {
  const count = (key: (a: AssetItem) => string) => {
    const m = new Map<string, number>();
    for (const a of l.items) m.set(key(a), (m.get(key(a)) ?? 0) + 1);
    return m;
  };
  const folders: FilterOption[] = [...count((a) => a.folder || "(root)")].sort((a, b) => a[0].localeCompare(b[0])).map(([value, n]) => ({ value, label: value === "(root)" ? "/ (root)" : `/${value}/`, count: n }));
  const formats: FilterOption[] = [...count((a) => a.ext || "(none)")].filter(([v]) => v !== "(none)").sort((a, b) => b[1] - a[1]).map(([value, n]) => ({ value, label: value.toUpperCase(), count: n }));
  const flags: FilterOption[] = CHECK_IDS.map((id) => ({ value: id, label: CHECK_LABEL[id], count: l.items.filter((a) => a.checks.some((c) => c.id === id && (c.state === "fail" || c.state === "warn"))).length }));
  return { folders, formats, flags };
}

function byKind(l: Loaded): Reading<KindWeight[]> {
  return fromFiles(l, () => {
    const others = l.items.filter((a) => a.kind !== "image" && a.kind !== "video" && a.kind !== "font");
    const words = new Map<AssetKind, number>();
    for (const a of others) words.set(a.kind, (words.get(a.kind) ?? 0) + 1);
    const KIND_PLURAL: Record<AssetKind, [string, string]> = { image: ["picture", "pictures"], video: ["film", "films"], font: ["font", "fonts"], scene: ["3D scene", "3D scenes"], audio: ["sound file", "sound files"], document: ["document", "documents"], other: ["other file", "other files"] };
    const detail = [...words].map(([k, n]) => `${n} ${KIND_PLURAL[k][n === 1 ? 0 : 1]}`).join(", ");
    return kindParts(l.items, "bytes").map((p) => ({
      key: p.key as KindWeight["key"],
      label: p.label,
      bytes: p.value,
      files: kindParts(l.items, "count").find((c) => c.key === p.key)?.value ?? 0,
      ...(p.key === "other" && detail ? { detail } : {}),
    }));
  });
}

function byFolder(l: Loaded): Reading<FolderWeight[]> {
  return fromFiles(l, () => {
    const m = new Map<string, { bytes: number; files: number }>();
    for (const a of l.items) {
      const g = m.get(a.folder) ?? { bytes: 0, files: 0 };
      g.bytes += a.bytes;
      g.files++;
      m.set(a.folder, g);
    }
    return [...m].map(([folder, g]) => ({ folder, label: folder ? `/${folder}/` : "/ (root)", ...g })).sort((a, b) => b.bytes - a.bytes);
  });
}

function formats(l: Loaded): Reading<FormatSummary> {
  return fromFiles(
    l,
    () => {
      const m = new Map<string, { kind: AssetKind; files: number; bytes: number }>();
      for (const a of l.items) {
        if (a.kind !== "image" && a.kind !== "video" && a.kind !== "font") continue;
        const g = m.get(a.ext) ?? { kind: a.kind, files: 0, bytes: 0 };
        g.files++;
        g.bytes += a.bytes;
        m.set(a.ext, g);
      }
      const legacy = (a: AssetItem) => a.kind === "image" && ["png", "jpg", "jpeg", "gif"].includes(a.ext);
      const toReaders = l.items.filter((a) => legacy(a) && a.checks.some((c) => c.id === "format" && c.state === "fail"));
      const elsewhere = l.items.filter((a) => legacy(a) && !toReaders.includes(a));
      const sum = (list: AssetItem[]) => ({ files: list.length, bytes: list.reduce((s, a) => s + a.bytes, 0) });
      return {
        formats: [...m].map(([ext, g]) => ({ ext, label: ext.toUpperCase(), ...g })).sort((a, b) => b.files - a.files),
        toReaders: sum(toReaders),
        elsewhere: sum(elsewhere),
      };
    },
    { crawl: true, note: "Which files reach readers as they are comes from the crawl of the served HTML." },
  );
}

function caching(l: Loaded): Reading<CachingSummary> {
  if (l.folderCache.state !== "ok") return l.folderCache;
  if (l.base.state !== "ok") return l.base;
  const fc = l.folderCache;
  const rowsByFolder = new Map<string, AssetRow[]>();
  for (const a of l.rows) rowsByFolder.set(a.folder, [...(rowsByFolder.get(a.folder) ?? []), a]);
  const folders = fc.value
    .map((f) => ({ folder: f.folder, files: f.files, bytes: f.bytes, cacheControl: f.cacheControl, maxAge: f.maxAge, sample: f.sample, loaded: (rowsByFolder.get(f.folder) ?? []).filter(loadedDirectly).length }))
    .sort((a, b) => a.maxAge - b.maxAge || b.bytes - a.bytes);
  const flagged = l.rows.filter((a) => a.flags.some((x) => x.id === "uncached-folder"));
  return ok(
    {
      folders,
      checked: folders.filter((f) => f.cacheControl !== null).length,
      uncached: folders.filter((f) => f.cacheControl !== null && f.maxAge === 0).length,
      uncachedLoaded: flagged.length,
      uncachedLoadedBytes: flagged.reduce((s, a) => s + a.bytes, 0),
    },
    "probe",
    fc.asOf,
    "One file per folder was asked for its headers at the last scan; the site sets Cache-Control by folder.",
  );
}

function remote(r: Reading<RemoteImage[]>): Reading<RemoteSummary> {
  if (r.state !== "ok") return r;
  const hosts = new Map<string, { pictures: number; uses: number; pages: Set<string>; optimised: number }>();
  const pages = new Map<string, { pictures: Set<string>; hosts: Set<string> }>();
  let altAbsent = 0;
  for (const p of r.value) {
    const h = hosts.get(p.host) ?? { pictures: 0, uses: 0, pages: new Set<string>(), optimised: 0 };
    h.pictures++;
    h.uses += p.uses;
    if (p.optimised) h.optimised++;
    for (const pg of p.pages) {
      h.pages.add(pg);
      const e = pages.get(pg) ?? { pictures: new Set<string>(), hosts: new Set<string>() };
      e.pictures.add(p.url);
      e.hosts.add(p.host);
      pages.set(pg, e);
    }
    hosts.set(p.host, h);
    altAbsent += p.alt.absent;
  }
  return ok(
    {
      pictures: r.value.length,
      uses: r.value.reduce((s, p) => s + p.uses, 0),
      hosts: [...hosts].map(([host, h]) => ({ host, pictures: h.pictures, uses: h.uses, pages: h.pages.size, optimised: h.optimised })).sort((a, b) => b.uses - a.uses),
      pages: [...pages].map(([page, e]) => ({ page, pictures: e.pictures.size, hosts: [...e.hosts].sort() })).sort((a, b) => b.pictures - a.pictures || a.page.localeCompare(b.page)),
      altAbsent,
    },
    r.source,
    r.asOf,
    "Pictures in <img> tags whose address is on another host. They are outside the repository: somebody else's to move or take down.",
  );
}

function shareSummary(rows: ShareRow[], defaultPicture: string | null, l: Loaded): ShareSummary {
  const og = l.rows.filter((a) => a.folder === "og");
  return {
    pages: rows.length,
    own: rows.filter((r) => r.status === "own").length,
    onDefault: rows.filter((r) => r.status === "default").length,
    shared: rows.filter((r) => r.status === "shared").length,
    none: rows.filter((r) => r.status === "none").length,
    generated: rows.filter((r) => r.status === "own" && r.origin === "generated").length,
    defaultPicture,
    defaultPages: rows.filter((r) => r.status === "default").map((r) => r.page).sort(),
    offSize: rows.filter((r) => r.width !== null && r.height !== null && (r.width !== 1200 || r.height !== 630)).length,
    ogFiles: og.length,
    ogUnnamed: og.filter((a) => a.sharePictureOf.length === 0).length,
  };
}

function scanStatus(l: Loaded | null, jobs: { name: string; running: boolean; progress: ScanStatus["progress"]; lastOk: boolean | null; lastNote: string | null; lastStart: string | null; lastEnd: string | null; enabled: boolean }[]): ScanStatus {
  const j = jobs.find((x) => x.name === "assets");
  return {
    scannedAt: l && l.base.state === "ok" ? l.base.asOf : null,
    crawledAt: l?.crawled ?? null,
    running: j?.running ?? false,
    progress: j?.progress ?? null,
    lastOk: j?.lastOk ?? null,
    lastNote: j?.lastNote ?? null,
    lastStart: j?.lastStart ?? null,
    lastEnd: j?.lastEnd ?? null,
    enabled: j?.enabled ?? false,
  };
}

/* ---------- the screen ---------------------------------------------------------------- */

/** A part of the answer that is not one reading: if it throws, it becomes `fallback`, never the whole screen's failure. */
function safely<T>(make: () => T, fallback: (why: <U>() => Reading<U>) => T): T {
  try {
    return make();
  } catch (e) {
    console.error("assets: a part of the screen failed:", e);
    return fallback(() => waiting("repo", `This part could not be worked out: ${(e instanceof Error ? e.message : String(e)).split(/\r?\n/)[0]?.slice(0, 120)}`));
  }
}

routes.get("/", async (c) => {
  const q = queryOf((k) => c.req.query(k));
  const l = await load();
  const jobs = jobStatus().map((j) => ({ ...j, lastNote: j.lastNote === null ? null : scrub(j.lastNote) }));

  if ("failed" in l) {
    const none = <T>(): Reading<T> => waiting("repo", l.failed);
    const payload: AssetsPayload = {
      query: q,
      site: (process.env.SITE_BASE ?? "https://www.balkaris.ch").replace(/\/+$/, ""),
      scan: scanStatus(null, jobs),
      tiles: { files: none(), weight: none(), images: none(), videos: none(), missingAlt: none(), notFound: none() },
      tabs: none(),
      filters: { folders: [], formats: [], flags: [] },
      list: none(),
      shares: q.tab === "share" ? none() : null,
      open: q.file ? none() : null,
      byKind: none(),
      byFolder: none(),
      formats: none(),
      caching: none(),
      remote: none(),
      sharePictures: none(),
    };
    return c.json(payload);
  }

  const { s } = l;
  const { base: siteBase, pathOf } = await import("../site/http.ts");

  /* Page titles, for the share pictures and the opened file. */
  const titles = new Map<string, string | null>();
  const inv: Reading<PageRow[]> = await reading("crawl", () => s.inventory());
  if (inv.state === "ok") for (const p of inv.value) titles.set(p.path, p.title);

  const pictures = await reading("crawl", () => s.sharePictures());
  const share = pictures.state === "ok" ? shareRows(pictures.value, titles, await siteDefault(s), (u) => pathOf(u)) : null;

  const tabs = await reading("repo", () =>
    fromFiles(l, () => {
      const hit = l.items.filter((a) => matches(a, q));
      const counts = {} as Record<AssetTab, number | null>;
      for (const t of TABS) if (t !== "share") counts[t] = hit.filter((a) => inTab(t, a)).length;
      /* No count, not zero, while the crawl has not read the pages. */
      counts.share = share ? share.rows.filter((r) => shareMatches(r, q)).length : null;
      return counts;
    }),
  );

  const list = await reading("repo", (): Reading<AssetList> => {
    if (q.tab === "share") return fromFiles(l, () => ({ rows: [], total: 0, page: 1, per: q.per }));
    const tab = q.tab;
    return fromFiles(l, () => pageOf(l.items.filter((a) => inTab(tab, a) && matches(a, q)).sort(ORDER[q.sort]), q));
  });

  const shares: Reading<ShareList> | null =
    q.tab !== "share"
      ? null
      : await reading("crawl", (): Reading<ShareList> => {
          if (pictures.state !== "ok" || !share) return pictures.state === "ok" ? waiting("crawl", "No share pictures were read.") : pictures;
          const rows = share.rows.filter((r) => shareMatches(r, q)).sort((a, b) => SHARE_ORDER[a.status] - SHARE_ORDER[b.status] || a.page.localeCompare(b.page));
          return ok(pageOf(rows, q), pictures.source, pictures.asOf, "Each page's og:image, from the crawl of its served HTML.");
        });

  const open: Reading<AssetDetail> | null = !q.file
    ? null
    : await reading("repo", (): Reading<AssetDetail> => {
        /* The rows are in hand: found here, not listed a second time. */
        if (l.base.state !== "ok") return l.base;
        const at = l.rows.findIndex((r) => r.path === q.file);
        const a = l.rows[at];
        const item = l.items[at];
        if (!a || !item) return { state: "off", source: "repo", reason: `There is no file public${q.file} on the website's branch.` };
        const t: Record<string, string | null> = {};
        for (const p of a.pages) t[p] = titles.get(p) ?? null;
        return ok({ ...item, repoPath: a.repoPath, alpha: a.alpha, uses: a.uses, firstSeen: a.firstSeen, titles: t }, l.base.source, l.base.asOf, l.base.note);
      });

  const payload: AssetsPayload = {
    query: q,
    site: siteBase(),
    scan: scanStatus(l, jobs),
    tiles: safely(() => tiles(l), (why) => ({ files: why(), weight: why(), images: why(), videos: why(), missingAlt: why(), notFound: why() })),
    tabs,
    filters: safely(() => filters(l), () => ({ folders: [], formats: [], flags: [] })),
    list,
    shares,
    open,
    byKind: await reading("repo", () => byKind(l)),
    byFolder: await reading("repo", () => byFolder(l)),
    formats: await reading("repo", () => formats(l)),
    caching: await reading("probe", () => caching(l)),
    remote: await reading("crawl", () => remote(s.remoteImages())),
    sharePictures: await reading("crawl", (): Reading<ShareSummary> => {
      if (pictures.state !== "ok" || !share) return pictures.state === "ok" ? waiting("crawl", "No share pictures were read.") : pictures;
      return fromFiles(l, () => shareSummary(share.rows, share.defaultPicture, l), {
        crawl: true,
        note: share.defaultPicture
          ? `Each page's og:image, from the crawl of its served HTML. The default is the site's fallback, ${share.defaultPicture}, as the website's lib/site.ts names it. Share pictures are meant to be 1200 × 630.`
          : "Each page's og:image, from the crawl of its served HTML. The site's fallback picture could not be read from its repository, so no page is said to be on it. Share pictures are meant to be 1200 × 630.",
      });
    }),
  };
  return c.json(payload);
});

/* ---------- the CSV ------------------------------------------------------------------- */

/** A cell, quoted, and kept from being read as a formula by a spreadsheet. */
function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

routes.get("/export.csv", async (c) => {
  const q = queryOf((k) => c.req.query(k));
  const l = await load();
  if ("failed" in l) return c.json({ error: l.failed }, 503);
  if (l.base.state !== "ok") return c.json({ error: l.base.reason }, 503);
  const day = new Date().toISOString().slice(0, 10);
  let lines: string[];

  if (q.tab === "share") {
    const pictures = l.s.sharePictures();
    if (pictures.state !== "ok") return c.json({ error: pictures.reason }, 503);
    const titles = new Map<string, string | null>();
    const inv = l.s.inventory();
    if (inv.state === "ok") for (const p of inv.value) titles.set(p.path, p.title);
    const { pathOf } = await import("../site/http.ts");
    const rows = shareRows(pictures.value, titles, await siteDefault(l.s), (u) => pathOf(u))
      .rows.filter((r) => shareMatches(r, q))
      .sort((a, b) => SHARE_ORDER[a.status] - SHARE_ORDER[b.status] || a.page.localeCompare(b.page));
    lines = [
      ["page", "title", "share_picture", "origin", "status", "shared_by_pages", "width", "height", "bytes"].join(","),
      ...rows.map((r) => [r.page, r.title, r.picture, r.origin, r.status, r.sharedBy, r.width, r.height, r.bytes].map(cell).join(",")),
    ];
  } else {
    const tab = q.tab;
    const rows = l.items.filter((a) => inTab(tab, a) && matches(a, q)).sort(ORDER[q.sort]);
    lines = [
      ["path", "folder", "kind", "format", "width", "height", "bytes", "pages", "page_list", "alt_described", "alt_decorative", "alt_absent", "alt_texts", "share_picture_of", "needs_attention"].join(","),
      ...rows.map((a) =>
        [
          a.path,
          a.folder,
          a.kind,
          a.ext,
          a.width,
          a.height,
          a.bytes,
          a.pages.length,
          a.pages.join(" "),
          a.alt.written,
          a.alt.empty,
          a.alt.absent,
          a.altTexts.join(" | "),
          a.shareOf,
          a.checks
            .filter((x) => x.state === "fail" || x.state === "warn")
            .map((x) => (x.id === "weight" ? `Heavy: ${x.measured}, limit ${x.limit}` : x.id === "pixels" ? `Oversized: ${x.measured}, limit ${x.limit}` : x.label))
            .join("; "),
        ]
          .map(cell)
          .join(","),
      ),
    ];
  }

  /* A byte-order mark first: Excel on Windows otherwise reads UTF-8 as the system's codepage, and every dash and quote in a title comes out garbled. */
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="balkaris-assets${q.tab === "share" ? "-share-pictures" : ""}-${day}.csv"`,
      "cache-control": "no-store",
    },
  });
});
