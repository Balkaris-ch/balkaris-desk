import { Hono, type Context } from "hono";
import type { Vars } from "../../access.ts";
import { status as jobStatus } from "../../scheduler.ts";
import * as gsc from "../../search/gsc.ts";
import { addDays, eachDay, pathOf, round, siteBase } from "../../search/shared.ts";
import { get as httpGet, pathOf as sitePathOf, sleep, type Got } from "../../site/http.ts";
import { off, ok, reading, today, waiting } from "../../store.ts";
import type { Reading, Stat } from "../../../../web/src/contract/common.ts";
import type { NewTask } from "../../../../web/src/contract/operator.ts";
import type { RateStat, SeoRange } from "../../../../web/src/contract/seo/common.ts";
import type {
  ContentCheck,
  CrawlSeverity,
  IndexBasis,
  LookupLive,
  PageFacets,
  PageKeyword,
  PageLinks,
  PageLookup,
  PagesColumn,
  PageSpeed,
  PagesQuery,
  PagesSort,
  PagesTiles,
  PageTechnical,
  QuickAction,
  SearchBasis,
  SeoPageRow,
  SeoPagesPayload,
  SeoPageSummary,
  SerpPreview,
  SummaryIndex,
  SummaryIssue,
} from "../../../../web/src/contract/seo/pages.ts";
import type { Finding, PageDetail } from "../../site/index.ts";
import { rate } from "../../seo/rank.ts";
import { pageRef, type SiteView } from "../../seo/site.ts";
import { head, HISTORY_NOTE, historyAt, int, rangeFrom, recorded, view } from "./shared.ts";

/**
 * /api/v1/seo/pages — SEO › Pages: every page of the website as search sees
 * it, and one page summarised beside the list.
 *
 *   GET /             the whole screen (contract/seo/pages.ts, SeoPagesPayload)
 *   GET /export.csv   the list as CSV, with the same filters, every matching row
 *                     (?path=… repeated: only those rows, the table's ticked ones)
 *   GET /lookup       one address of the website as it is now (?url= a path or a
 *                     full address on the site's own host): what it answers on the
 *                     live site, what Google holds for it, what it earned in search.
 *                     For an address the crawl does not read: a new page, an old
 *                     address Google still counts.
 *
 * WHERE EACH COLUMN COMES FROM, each read on its own so a missing source
 * costs its own column or panel and nothing else:
 *
 *   the rows, status, score, issues,   the desk's crawl (src/cc/site)
 *   words, links, the page's tags
 *   clicks, impressions, CTR, position Search Console: the desk's own daily
 *                                      copy (src/cc/seo/rank.ts) when it has
 *                                      one, else Search Console's API asked
 *                                      for the window (kept six hours)
 *   index                              Google's URL Inspection of every sitemap
 *                                      address, once a day (cc_inspect): each
 *                                      address's NEWEST answer of the last seven
 *                                      daily checks, with its own day
 *   organic sessions                   GA4, sessions from organic search by
 *                                      landing page (consenting visitors only)
 *   opportunities                      the opportunity engine (src/cc/seo/engine.ts)
 *   AI readiness                       the readiness check (src/cc/seo/readiness.ts)
 *
 * Nothing here changes anything. The summary's buttons post operator tasks
 * (POST /api/v1/operator/tasks): a title or description the operator writes
 * waits in the approval queue, and nothing reaches the live site before a
 * person approves it.
 *
 * NO INVENTED FIGURE. The board's "traffic" is Search Console's clicks and
 * impressions, named as such; its "volume" column is impressions (no free
 * source gives search volume); "Optimize all pages" queues proposals, it
 * applies nothing. Where Search Console is not available a row carries no
 * click and no impression at all (null), never a zero.
 */
export const routes = new Hono<Vars>();

/* The engine's modules are loaded when asked, so one that does not load costs its panel, not the screen. */
const rankMod = () => import("../../seo/rank.ts");
const readinessMod = () => import("../../seo/readiness.ts");
const indexationMod = () => import("../../seo/indexation.ts");
const engineMod = () => import("../../seo/engine.ts");
const wordsMod = () => import("../../seo/words.ts");
const siteMod = () => import("../../site/index.ts");
const applyMod = () => import("../../operator/apply.ts");
const ga4Mod = () => import("../../ga4.ts");

/**
 * The one request this file sends anywhere: the live GET of a looked-up
 * address. Behind an object so the check script answers it itself and nothing
 * leaves the machine.
 */
export const wire = {
  get: (url: string): Promise<Got> => httpGet(url, { timeout: 12_000 }),
};

/* ---------- the question ------------------------------------------------------------------- */

const SORTS: PagesSort[] = ["impressions", "clicks", "ctr", "position", "score", "issues", "opportunities", "path", "updated", "words", "links", "change", "sessions"];
const STATUSES = ["all", "indexed", "not-indexed", "not-inspected", "issues"] as const;
const SCORES = ["all", "90-100", "70-89", "50-69", "0-49"] as const;
const TRAFFIC = ["all", "high", "medium", "low", "none"] as const;
const SITEMAP = ["all", "in", "out"] as const;
const LINKS = ["all", "none", "menus"] as const;
const PROPOSAL = ["all", "waiting"] as const;
const MOVED = ["all", "up", "down"] as const;
const COUNTRIES = ["all", "che"] as const;
const DEVICES = ["all", "mobile", "desktop", "tablet"] as const;
/** The optional columns, in the order the table draws them. */
const COLUMNS: PagesColumn[] = ["title", "status", "change", "sessions", "opportunities", "readiness", "words", "links", "updated"];

const pick = <T extends string>(list: readonly T[], raw: string | undefined, fallback: T): T => (list.includes(raw as T) ? (raw as T) : fallback);

/** An address as a path, from "/x", "x" or a full address; null when it is not one. */
function pathParam(raw: string | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s || s.length > 400) return null;
  try {
    const p = s.startsWith("/") ? s.split(/[?#]/)[0]! : /^https?:\/\//i.test(s) ? new URL(s).pathname : `/${s.split(/[?#]/)[0]!}`;
    return p.replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
}

/** The site's host without "www.", for matching both spellings Google may report. */
const bareHost = (): string => new URL(siteBase()).host.replace(/^www\./, "");
const reEscape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * What a search box's words are when they are ONE pasted address:
 *   { path }     an address of the website ("https://www.balkaris.ch/about?x=1", "balkaris.ch/about", "/about")
 *   { foreign }  a full address on another host (named, so the screen can say it is not looked up here)
 *   null         plain words
 */
function addressIn(q: string): { path: string } | { foreign: string } | null {
  const s = q.trim();
  if (!s || /\s/.test(s)) return null;
  const host = bareHost();
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (u.host.replace(/^www\./, "").toLowerCase() !== host) return { foreign: u.host };
      const p = pathParam(s);
      return p ? { path: p } : null;
    } catch {
      return null;
    }
  }
  if (new RegExp(`^(www\\.)?${reEscape(host)}(/|$)`, "i").test(s)) {
    const p = pathParam(`https://${s}`);
    return p ? { path: p } : null;
  }
  if (s.startsWith("/")) {
    const p = pathParam(s);
    return p ? { path: p } : null;
  }
  return null;
}

function queryOf(c: Context<Vars>, paged: boolean): PagesQuery {
  const r = (k: string) => c.req.query(k);
  const sort = pick(SORTS, r("sort"), "impressions");
  const asked = new Set((r("cols") ?? "").split(",").map((s) => s.trim()));
  return {
    /* type, finding and lang name things only the crawl knows: `screen` replaces one it does not know by "all". */
    type: (r("type") ?? "all").trim().slice(0, 40) || "all",
    status: pick(STATUSES, r("status"), "all"),
    score: pick(SCORES, r("score"), "all"),
    traffic: pick(TRAFFIC, r("traffic"), "all"),
    sitemap: pick(SITEMAP, r("sitemap"), "all"),
    links: pick(LINKS, r("links"), "all"),
    finding: (r("finding") ?? "all").trim().slice(0, 60) || "all",
    proposal: pick(PROPOSAL, r("proposal"), "all"),
    lang: (r("lang") ?? "all").trim().toLowerCase().slice(0, 12) || "all",
    moved: pick(MOVED, r("moved"), "all"),
    country: pick(COUNTRIES, r("country"), "all"),
    device: pick(DEVICES, r("device"), "all"),
    q: (r("q") ?? "").trim().slice(0, 200),
    sort,
    dir: r("dir") === "asc" ? "asc" : r("dir") === "desc" ? "desc" : sort === "path" || sort === "position" ? "asc" : "desc",
    offset: paged ? int(r("offset"), 0, 0, 100_000) : 0,
    limit: paged ? int(r("limit"), 10, 1, 200) : 100_000,
    cols: COLUMNS.filter((k) => asked.has(k)),
    open: pathParam(r("open")),
  };
}

/** Where a list of `total` rows is read from when `asked` lies past its end: the start of its last page, not its last row. */
function lastPageOffset(asked: number, total: number, limit: number): number {
  if (total <= 0) return 0;
  return asked < total ? asked : Math.floor((total - 1) / limit) * limit;
}

/* ---------- the website ---------------------------------------------------------------------- */

const absUrl = (path: string): string => new URL(path, `${siteBase()}/`).toString();

/** An https address for a picture the page names, or null. */
function pictureOf(src: string | null | undefined): string | null {
  if (!src) return null;
  try {
    const u = new URL(src, `${siteBase()}/`);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Search Console's filter for one page under either host spelling, with or without a trailing slash. */
function pageFilter(path: string): gsc.Filter {
  const tail = path === "/" ? "/?" : `${reEscape(path)}/?`;
  return { dimension: "page", operator: "includingRegex", expression: `^https?://(www\\.)?${reEscape(bareHost())}${tail}$` };
}

/* ---------- Search Console: the desk's history, or the API ----------------------------------- */

interface Fig {
  clicks: number;
  impressions: number;
  position: number | null;
}

/** The part of search asked for: every country or Switzerland, every device or one. */
interface Segment {
  country: PagesQuery["country"];
  device: PagesQuery["device"];
}

interface SearchRead {
  basis: SearchBasis;
  /** The first day of the window Google has any figure on (live), or the window's start. */
  from: string;
  now: Map<string, Fig>;
  before: Map<string, Fig> | null;
  tiles: { clicks: Stat; position: Stat | null; ctr: RateStat };
  /** The position per day of the window, null on a day without impressions. */
  positionDays: (number | null)[];
}

/** Rows of one page under two spellings are one row: summed, the position weighted by impressions. */
function merge(rows: { path: string; clicks: number; impressions: number; position: number | null }[]): Map<string, Fig> {
  const by = new Map<string, { c: number; i: number; w: number }>();
  for (const r of rows) {
    const m = by.get(r.path) ?? { c: 0, i: 0, w: 0 };
    m.c += r.clicks;
    m.i += r.impressions;
    m.w += (r.position ?? 0) * r.impressions;
    by.set(r.path, m);
  }
  return new Map([...by].map(([p, m]) => [p, { clicks: m.c, impressions: m.i, position: m.i ? round(m.w / m.i, 1) : null }]));
}

const LIVE_NOTE =
  "Google Search, web results, asked from Search Console for this window and kept six hours (final days, two to three days behind). The desk's own daily copy replaces this once its first snapshot has run.";

/** The first day the desk's history holds a page row for (Search Console's per-page report); null when it holds none. */
async function firstPageDay(): Promise<string | null> {
  try {
    await import("../../seo/tables.ts");
    const { db } = await import("../../../db.ts");
    return (db.prepare("SELECT MIN(day) AS d FROM cc_seo_snaps WHERE page_rows > 0").get() as { d: string | null }).d;
  } catch {
    return null;
  }
}

/**
 * What Google counted for the site without naming a page: its totals less
 * every page row. Search Console's site totals and its per-page report are
 * two reports; on this young property whole days carry a total and no page.
 */
function unnamedOf(clicks: number, impressions: number, pages: Map<string, Fig>): SearchBasis["unnamed"] {
  let c = 0;
  let i = 0;
  for (const f of pages.values()) {
    c += f.clicks;
    i += f.impressions;
  }
  const left = { clicks: Math.max(0, clicks - c), impressions: Math.max(0, impressions - i) };
  return left.clicks || left.impressions ? left : null;
}

/** The tiles without their window before, when it is not to be compared. */
function uncomparedTiles(t: SearchRead["tiles"]): SearchRead["tiles"] {
  return {
    clicks: { ...t.clicks, previous: null },
    position: t.position ? { ...t.position, previous: null } : null,
    ctr: { ...t.ctr, previous: null },
  };
}

/** The clicks tile's small line: how many of its clicks the list can show. */
function clicksSub(t: Stat, unnamed: SearchBasis["unnamed"]): Stat {
  if (!unnamed?.clicks) return t;
  return { ...t, sub: `${unnamed.clicks.toLocaleString("en-GB")} of them without a page named` };
}

const SEGMENT_WORDS: Record<string, string> = { che: "Switzerland only", mobile: "phones only", desktop: "desktop computers only", tablet: "tablets only" };

/** " Switzerland only, phones only." for a note, or nothing for every country and device. */
const segmentNote = (s: Segment): string => {
  const parts = [s.country !== "all" ? SEGMENT_WORDS[s.country] : null, s.device !== "all" ? SEGMENT_WORDS[s.device] : null].filter(Boolean);
  return parts.length ? ` ${parts.join(", ")}.` : "";
};

async function searchRead(range: SeoRange, seg: Segment): Promise<Reading<SearchRead>> {
  const r = await rankMod();
  const span = r.spanOf(range);
  if (span) {
    /* The history keeps Switzerland apart from every country, and every row by device. */
    const o = { country: seg.country, device: seg.device === "all" ? null : seg.device };
    const now = merge(r.pageFigures(span.start, span.end, o));
    const before = span.compared ? merge(r.pageFigures(span.previousStart, span.previousEnd, o)) : null;
    const t = r.tiles(span, o);
    const pagesFrom = await firstPageDay();
    /* The tiles are compared only with a window before that lies wholly after Google's first page figure. */
    const uncompared: SearchBasis["uncompared"] = !span.compared
      ? null
      : !pagesFrom
        ? { why: "no-pages", start: span.previousStart, end: span.previousEnd }
        : pagesFrom > span.previousEnd
          ? { why: "before-pages", start: span.previousStart, end: span.previousEnd }
          : pagesFrom > span.previousStart
            ? { why: "starts-before-pages", start: span.previousStart, end: span.previousEnd }
            : null;
    const unnamed = unnamedOf(t.clicks.value, t.impressions.value, now);
    const tiles = { clicks: t.clicks, position: t.position, ctr: t.ctr };
    const shown = uncompared ? uncomparedTiles(tiles) : tiles;
    const compared = span.compared && !uncompared;
    return ok(
      {
        basis: {
          by: "history",
          start: span.start,
          end: span.end,
          days: span.days,
          compared,
          pagesFrom,
          uncompared,
          previous: compared ? { start: span.previousStart, end: span.previousEnd } : null,
          unnamed,
          country: seg.country,
          device: seg.device,
        },
        from: span.historyFrom && span.historyFrom > span.start ? span.historyFrom : span.start,
        now,
        before: compared ? before : null,
        tiles: { ...shown, clicks: clicksSub(shown.clicks, unnamed) },
        /* One point per day the history covers; a day without impressions has no position, which is not a zero. */
        positionDays: r.daySeries(span.start, span.end, o).map((d) => d.position),
      },
      "gsc",
      historyAt(),
      `${HISTORY_NOTE}${segmentNote(seg)}`,
    );
  }
  const a = gsc.access();
  if (a.state !== "ok") return off("gsc", gsc.reasonFor(a), gsc.stepFor(a));
  const [pages, totals] = await Promise.all([gsc.pages(range), gsc.totalsByDay(range)]);
  if (totals.state !== "ok") return totals.state === "waiting" ? waiting("gsc", totals.reason) : off("gsc", totals.reason, totals.step);
  const t = totals.value;
  const w = t.window;
  /* The page list is "waiting" when Google reports no page for the window: then no page had an impression. */
  const rows = pages.state === "ok" ? pages.value.rows : [];
  if (pages.state === "off") return off("gsc", pages.reason, pages.step);
  const covered = t.clicks.previous !== null;
  const now = merge(rows.map((x) => ({ path: x.path, clicks: x.clicks, impressions: x.impressions, position: x.impressions ? x.position : null })));
  const before = covered
    ? merge(rows.filter((x) => x.previous).map((x) => ({ path: x.path, clicks: x.previous!.clicks, impressions: x.previous!.impressions, position: x.previous!.impressions ? x.previous!.position : null })))
    : null;
  /* Live, the first page figure is not known: the window before is not compared when Google named no page in it. */
  const namedBefore = before ? [...before.values()].reduce((n, f) => n + f.impressions, 0) : 0;
  const uncompared: SearchBasis["uncompared"] = covered && namedBefore === 0 && (t.impressions.previous ?? 0) > 0 ? { why: "no-pages", start: w.previousStart, end: w.previousEnd } : null;
  const compared = covered && !uncompared;
  /* A page list cut short at Google's row limit would leave pages in the "unnamed" part. */
  const unnamed = pages.state === "ok" && !pages.value.complete ? null : unnamedOf(t.clicks.value, t.impressions.value, now);
  const ctrNow = rate(t.clicks.value, t.impressions.value);
  const ctrBefore = compared && t.impressions.previous !== null ? rate(t.clicks.previous ?? 0, t.impressions.previous) : null;
  const tiles = { clicks: t.clicks, position: t.position, ctr: { now: ctrNow, previous: ctrBefore, series: t.days.map((d) => d.ctr) } };
  const shown = uncompared ? uncomparedTiles(tiles) : tiles;
  return ok(
    {
      /* Asked live, the figures are of every country and device: the splits exist in the desk's own history only. */
      basis: { by: "live", start: w.start, end: w.end, days: w.days, compared, pagesFrom: null, uncompared, previous: compared ? { start: w.previousStart, end: w.previousEnd } : null, unnamed, country: "all", device: "all" },
      from: t.from,
      now,
      before: compared ? before : null,
      tiles: { ...shown, clicks: clicksSub(shown.clicks, unnamed) },
      positionDays: t.days.map((d) => d.position),
    },
    "gsc",
    totals.asOf,
    LIVE_NOTE,
  );
}

/**
 * The searches each page is shown for, as one lower-case line per page, so
 * the search box finds a page by a search it ranks for. Read only when a
 * search was typed; null when Search Console cannot say.
 */
async function queriesByPage(range: SeoRange, search: Reading<SearchRead>): Promise<Map<string, string> | null> {
  if (search.state !== "ok") return null;
  const b = search.value.basis;
  const by = new Map<string, string[]>();
  const add = (path: string, query: string) => {
    const l = by.get(path);
    if (l) l.push(query);
    else by.set(path, [query]);
  };
  try {
    if (b.by === "history") {
      const r = await rankMod();
      for (const x of r.queryPageFigures(b.start, b.end, { country: b.country, device: b.device === "all" ? null : b.device })) add(x.path, x.query);
    } else {
      const got = await gsc.queryPages(range);
      if (got.state !== "ok") return null;
      for (const x of got.value.rows) add(x.path, x.query);
    }
  } catch {
    return null;
  }
  return new Map([...by].map(([p, l]) => [p, l.join(" \u0000 ").toLowerCase()]));
}

/* ---------- Google's index, the engine's counts ---------------------------------------------- */

/** How many daily index checks back an address's answer may come from. */
const INDEX_DAYS = 7;

/** One address's answer from a daily URL Inspection, with the day it is from. */
interface Inspected extends gsc.Inspection {
  day: string;
  checkedAt: string;
}

interface IndexRead {
  basis: IndexBasis;
  by: Map<string, Inspected>;
}

const inspectedOf = (r: Record<string, unknown>): Inspected => ({
  day: String(r.day),
  checkedAt: String(r.checked_at ?? r.day),
  url: String(r.url),
  path: pathOf(String(r.url)),
  verdict: (r.verdict as string | null) ?? null,
  coverage: (r.coverage as string | null) ?? null,
  lastCrawl: (r.last_crawl as string | null) ?? null,
  googleCanonical: (r.google_canonical as string | null) ?? null,
  userCanonical: (r.user_canonical as string | null) ?? null,
  robots: (r.robots_state as string | null) ?? null,
  fetchState: (r.fetch_state as string | null) ?? null,
  indexing: (r.indexing_state as string | null) ?? null,
  indexed: !!r.is_indexed,
  canonicalOk: r.canonical_ok === null || r.canonical_ok === undefined ? null : !!r.canonical_ok,
  link: (r.link as string | null) ?? null,
});

/** Of several days' answers, each address's newest. */
function newestPerAddress(rows: Inspected[]): Map<string, Inspected> {
  const by = new Map<string, Inspected>();
  for (const x of rows) {
    const had = by.get(x.path);
    if (!had || x.day > had.day) by.set(x.path, x);
  }
  return by;
}

/**
 * Google's stored state per address. The daily check keeps every day it ran;
 * one that is cut short (Google failing, the allowance used up) holds a part
 * of the sitemap only. So each address shows its NEWEST answer of the last
 * `INDEX_DAYS` checks with its own day: a short day adds what it learned and
 * blanks nothing.
 */
async function indexRead(): Promise<Reading<IndexRead>> {
  const r = await gsc.indexing();
  if (r.state !== "ok") return r;
  const newest = r.value.day;
  const { db } = await import("../../../db.ts");
  const rows = (db.prepare("SELECT * FROM cc_inspect WHERE day >= ? AND day <= ?").all(addDays(newest, -(INDEX_DAYS - 1)), newest) as Record<string, unknown>[]).map(inspectedOf);
  const by = newestPerAddress(rows);
  const all = [...by.values()];
  const carried = all.filter((x) => x.day < newest).length;
  const oldest = all.reduce((d, x) => (x.day < d ? x.day : d), newest);
  const complete = r.value.complete !== false;
  const basis: IndexBasis = { newest, oldest, days: INDEX_DAYS, complete, onNewest: all.length - carried, of: r.value.of ?? null, carried };
  const note = [
    "Google's stored state for each address in the sitemap, from the daily URL Inspection: what Google last saw, not a live test.",
    complete ? "" : `The check of ${newest} was cut short at ${basis.onNewest} of ${basis.of ?? "the"} sitemap addresses.`,
    carried ? `${carried} address${carried === 1 ? " shows" : "es show"} the answer of an earlier check (back to ${oldest}); each row says its day.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return ok({ basis, by }, "gsc", r.asOf, note);
}

/** Open opportunities per page; null when the engine's table cannot be read. */
async function oppCounts(): Promise<Map<string, number> | null> {
  try {
    await import("../../seo/tables.ts");
    const { db } = await import("../../../db.ts");
    const rows = db.prepare("SELECT page, COUNT(*) AS n FROM cc_seo_opps WHERE active = 1 AND state IN ('open', 'queued', 'in-progress') AND page IS NOT NULL GROUP BY page").all() as { page: string; n: number }[];
    return new Map(rows.map((x) => [x.page, x.n]));
  } catch {
    return null;
  }
}

/** AI-readiness per page: the checks passed of those that apply. */
async function readinessCounts(): Promise<Map<string, { pass: number; of: number }>> {
  try {
    const m = await readinessMod();
    return new Map(m.pageReadiness().pages.map((p) => [p.path, { pass: p.pass, of: p.of }]));
  } catch {
    return new Map();
  }
}

/** The crawl's rules that fired on each page, once each; empty when the table cannot be read. */
async function rulesByPage(): Promise<Map<string, string[]>> {
  try {
    const { db } = await import("../../../db.ts");
    const rows = db.prepare("SELECT DISTINCT path, rule FROM cc_issues WHERE path IS NOT NULL ORDER BY rule").all() as { path: string; rule: string }[];
    const by = new Map<string, string[]>();
    for (const x of rows) by.set(x.path, [...(by.get(x.path) ?? []), x.rule]);
    return by;
  } catch {
    return new Map();
  }
}

/** What each rule is called and how heavy it is, for the Finding filter. */
async function ruleInfo(): Promise<Map<string, { title: string; severity: CrawlSeverity }>> {
  try {
    const s = await siteMod();
    return new Map(Object.entries(s.RULES).map(([id, r]) => [id, { title: r.title, severity: r.severity }]));
  } catch {
    return new Map();
  }
}

/** Proposals waiting for approval per address. */
async function waitingByPage(): Promise<Map<string, number>> {
  try {
    const a = await applyMod();
    const by = new Map<string, number>();
    for (const p of a.proposals(["waiting"], 500)) by.set(p.address, (by.get(p.address) ?? 0) + 1);
    return by;
  } catch {
    return new Map();
  }
}

interface OrganicRead {
  start: string;
  end: string;
  by: Map<string, { sessions: number; engaged: number }>;
}

/**
 * GA4's sessions from organic search by the page they began on. Asked only
 * when the column, its order or the export wants it: a GA4 report costs
 * tokens, and the default table does not show it.
 */
async function organicRead(range: SeoRange, wanted: boolean): Promise<Reading<OrganicRead>> {
  if (!wanted) return off("ga4", "Not read: the Organic sessions column is not shown.", "Tick Organic sessions under Columns.");
  const g = await ga4Mod();
  const read = await g.landingPages(range, "organic-search", { screen: true });
  return g.asReading(read, (d) => ({
    start: d.span.start,
    end: d.span.end,
    by: new Map(d.rows.filter((x) => x.path !== "(not set)").map((x) => [pathParam(x.path) ?? x.path, { sessions: x.sessions, engaged: x.engagedSessions }])),
  }));
}

/* ---------- the rows -------------------------------------------------------------------------- */

const updatedOf = (p: { lastChanged: string | null; firstSeen: string; lastmod: string | null }): string | null =>
  p.lastChanged && p.lastChanged !== p.firstSeen ? p.lastChanged : p.lastmod;

/** What the rows are joined with, each already read (or absent). */
interface Joined {
  search: SearchRead | null;
  index: IndexRead | null;
  opps: Map<string, number> | null;
  ready: Map<string, { pass: number; of: number }>;
  rules: Map<string, string[]>;
  waiting: Map<string, number>;
  organic: OrganicRead | null;
}

function rowsOf(v: SiteView, j: Joined): SeoPageRow[] {
  return v.pages.map((p) => {
    /* With Search Console read, a page it does not name had no impression: a real zero. Without it, nothing is known. */
    const f = j.search ? (j.search.now.get(p.path) ?? { clicks: 0, impressions: 0, position: null }) : null;
    const was = j.search?.before ? (j.search.before.get(p.path) ?? { clicks: 0, impressions: 0, position: null }) : null;
    const ins = j.index?.by.get(p.path);
    const ref = pageRef(p.path, v);
    return {
      page: { ...ref, picture: pictureOf(ref.picture) },
      url: p.url,
      status: p.status,
      inSitemap: p.inSitemap,
      title: p.title,
      description: p.description,
      heading: p.h1,
      index: ins ? { indexed: ins.indexed, coverage: ins.coverage, day: ins.day } : null,
      clicks: f ? f.clicks : null,
      impressions: f ? f.impressions : null,
      ctr: rate(f?.clicks ?? 0, f?.impressions ?? 0),
      position: f ? f.position : null,
      previous: was,
      /* GA4 lists only the pages a session began on: a page it does not name began none. */
      organic: j.organic ? (j.organic.by.get(p.path) ?? { sessions: 0, engaged: 0 }) : null,
      score: p.score,
      issues: { critical: p.issues.critical, warning: p.issues.warning, opportunity: p.issues.opportunity },
      rules: j.rules.get(p.path) ?? [],
      opportunities: j.opps?.get(p.path) ?? 0,
      proposalsWaiting: j.waiting.get(p.path) ?? 0,
      readiness: j.ready.get(p.path) ?? null,
      words: p.words,
      inlinks: p.inlinks,
      inlinksFromContent: p.inlinksFromContent,
      updated: updatedOf(p),
    };
  });
}

const hasIssues = (r: SeoPageRow): boolean => r.issues.critical + r.issues.warning > 0;
const kindOf = (r: SeoPageRow): string => r.page.kind ?? "other";
const langOf = (r: SeoPageRow): string => r.page.lang ?? "unknown";
const scoreBucket = (s: number | null): string | null => (s === null ? null : s >= 90 ? "90-100" : s >= 70 ? "70-89" : s >= 50 ? "50-69" : "0-49");
const trafficBucket = (i: number): "high" | "medium" | "low" | "none" => (i >= 100 ? "high" : i >= 10 ? "medium" : i >= 1 ? "low" : "none");
/** Who links to the page: nobody, menus and footers only, or some page's own content. */
const linkBucket = (r: SeoPageRow): "none" | "menus" | "content" => (r.inlinks === 0 ? "none" : r.inlinksFromContent === 0 ? "menus" : "content");
/** Impressions gained on the window before; null when the two are not compared. */
const changeOf = (r: SeoPageRow): number | null => (r.previous === null || r.impressions === null ? null : r.impressions - r.previous.impressions);
/** "up" with more impressions than the window before (clicks decide a tie), "down" with fewer; null when equal or not compared. */
function movedOf(r: SeoPageRow): "up" | "down" | null {
  const d = changeOf(r);
  if (d === null || r.previous === null) return null;
  const by = d !== 0 ? d : (r.clicks ?? 0) - r.previous.clicks;
  return by > 0 ? "up" : by < 0 ? "down" : null;
}

const KIND_ORDER = ["home", "service", "landing", "segment", "article", "case", "insights", "standard", "legal"];
const SEVERITY_RANK: Record<CrawlSeverity, number> = { critical: 0, warning: 1, opportunity: 2 };

/** What the filters need to know beside the rows. */
interface FilterBasis {
  /** Search Console's figures are in the rows. */
  searchOk: boolean;
  /** The rows carry the window before. */
  compared: boolean;
  /** Each page's searches as one line; null when not read. */
  queries: Map<string, string> | null;
}

type Group = keyof PageFacets["all"];

/** Words as the search compares them: lower case, and a typographic quote is the plain one ("Let’s" is found by "let's"). */
const fold = (s: string): string => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

function filtered(rows: SeoPageRow[], q: PagesQuery, b: FilterBasis, skip?: Group): SeoPageRow[] {
  const pasted = addressIn(q.q);
  /* A word with a query string or fragment is matched without it: "about?x=1" finds /about. */
  const words = pasted
    ? []
    : fold(q.q)
        .split(/\s+/)
        .map((w) => w.split(/[?#]/)[0]!)
        .filter(Boolean);
  const on = (g: Group): boolean => g !== skip;
  return rows.filter((r) => {
    if (on("type") && q.type !== "all" && kindOf(r) !== q.type) return false;
    if (on("status")) {
      if (q.status === "indexed" && r.index?.indexed !== true) return false;
      if (q.status === "not-indexed" && r.index?.indexed !== false) return false;
      if (q.status === "not-inspected" && r.index !== null) return false;
      if (q.status === "issues" && !hasIssues(r)) return false;
    }
    if (on("score") && q.score !== "all" && scoreBucket(r.score) !== q.score) return false;
    if (on("traffic") && b.searchOk && q.traffic !== "all" && trafficBucket(r.impressions ?? 0) !== q.traffic) return false;
    if (on("sitemap") && q.sitemap !== "all" && r.inSitemap !== (q.sitemap === "in")) return false;
    if (on("links") && q.links !== "all" && linkBucket(r) !== q.links) return false;
    if (on("finding") && q.finding !== "all" && !r.rules.includes(q.finding)) return false;
    if (on("proposal") && q.proposal === "waiting" && r.proposalsWaiting === 0) return false;
    if (on("lang") && q.lang !== "all" && langOf(r) !== q.lang) return false;
    if (on("moved") && b.compared && q.moved !== "all" && movedOf(r) !== q.moved) return false;
    if (pasted) {
      /* A pasted address finds its page, and the pages under it; another website's address finds nothing. */
      if (!("path" in pasted)) return false;
      const p = pasted.path;
      if (!(r.page.path === p || (p !== "/" && r.page.path.startsWith(`${p}/`)))) return false;
    } else if (words.length) {
      const hay = fold(`${r.page.path} ${r.title ?? ""} ${r.description ?? ""} ${r.heading ?? ""} ${b.queries?.get(r.page.path) ?? ""}`);
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

/** Where ?q= was looked for, as the empty list says it. */
function searchedIn(q: PagesQuery, b: FilterBasis): string | null {
  if (!q.q) return null;
  const pasted = addressIn(q.q);
  if (pasted) return "path" in pasted ? `the crawl's pages at ${pasted.path} and under it` : `the crawl's pages; ${pasted.foreign} is another website`;
  return `the address, title, description and main heading of each page${b.queries ? ", and the searches Google showed it for in the window" : ""}`;
}

/**
 * The filter groups with their counts. Each group is counted over the rows
 * the OTHER groups' choices (and the search) leave, so a number beside an
 * option is the list that option would give.
 */
function facetsOf(rows: SeoPageRow[], q: PagesQuery, b: FilterBasis, rules: Map<string, { title: string; severity: CrawlSeverity }>): PageFacets {
  const base = (g: Group): SeoPageRow[] => filtered(rows, q, b, g);
  const count = (list: SeoPageRow[], f: (r: SeoPageRow) => boolean): number => list.filter(f).length;

  const byType = base("type");
  /* Every kind the site has is offered, with a zero when the other filters leave none of it. */
  const types = new Map<string, { label: string; count: number }>();
  for (const r of rows) if (!types.has(kindOf(r))) types.set(kindOf(r), { label: r.page.kindLabel ?? "Other", count: 0 });
  for (const r of byType) types.get(kindOf(r))!.count++;

  const byStatus = base("status");
  const byScore = base("score");
  const byTraffic = base("traffic");
  const bySitemap = base("sitemap");
  const byLinks = base("links");
  const byFinding = base("finding");
  const byProposal = base("proposal");
  const byLang = base("lang");
  const byMoved = base("moved");

  const fired = new Set(rows.flatMap((r) => r.rules));
  const langs = new Set(rows.map(langOf));
  return {
    all: {
      type: byType.length,
      status: byStatus.length,
      score: byScore.length,
      traffic: byTraffic.length,
      sitemap: bySitemap.length,
      links: byLinks.length,
      finding: byFinding.length,
      proposal: byProposal.length,
      lang: byLang.length,
      moved: byMoved.length,
    },
    types: [...types]
      .map(([key, t]) => ({ key, label: t.label, count: t.count }))
      .sort((x, y) => (KIND_ORDER.indexOf(x.key) + 1 || 99) - (KIND_ORDER.indexOf(y.key) + 1 || 99)),
    status: [
      { key: "indexed", label: "Indexed", count: count(byStatus, (r) => r.index?.indexed === true) },
      { key: "not-indexed", label: "Not indexed", count: count(byStatus, (r) => r.index?.indexed === false) },
      { key: "not-inspected", label: "Not inspected", count: count(byStatus, (r) => r.index === null) },
      { key: "issues", label: "Has issues", count: count(byStatus, hasIssues) },
    ],
    score: (["90-100", "70-89", "50-69", "0-49"] as const).map((k) => ({ key: k, label: k.replace("-", "–"), count: count(byScore, (r) => scoreBucket(r.score) === k) })),
    traffic: b.searchOk
      ? [
          { key: "high", label: "High (100+)", count: count(byTraffic, (r) => trafficBucket(r.impressions ?? 0) === "high") },
          { key: "medium", label: "Medium (10–99)", count: count(byTraffic, (r) => trafficBucket(r.impressions ?? 0) === "medium") },
          { key: "low", label: "Low (1–9)", count: count(byTraffic, (r) => trafficBucket(r.impressions ?? 0) === "low") },
          { key: "none", label: "None", count: count(byTraffic, (r) => (r.impressions ?? 0) === 0) },
        ]
      : [],
    sitemap: [
      { key: "in", label: "In the sitemap", count: count(bySitemap, (r) => r.inSitemap) },
      { key: "out", label: "Kept out of it", count: count(bySitemap, (r) => !r.inSitemap) },
    ],
    links: [
      { key: "none", label: "No page links here", count: count(byLinks, (r) => linkBucket(r) === "none") },
      { key: "menus", label: "Menus and footer only", count: count(byLinks, (r) => linkBucket(r) === "menus") },
    ],
    findings: [...fired]
      .map((key) => ({ key, label: rules.get(key)?.title ?? key, severity: rules.get(key)?.severity ?? ("opportunity" as CrawlSeverity), count: count(byFinding, (r) => r.rules.includes(key)) }))
      .sort((x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] || y.count - x.count || x.label.localeCompare(y.label)),
    proposal: [{ key: "waiting", label: "Proposal waiting", count: count(byProposal, (r) => r.proposalsWaiting > 0) }],
    langs: langs.size > 1 ? [...langs].sort().map((key) => ({ key, label: key === "unknown" ? "Not declared" : key.toUpperCase(), count: count(byLang, (r) => langOf(r) === key) })) : [],
    moved: b.compared
      ? [
          { key: "up", label: "More impressions", count: count(byMoved, (r) => movedOf(r) === "up") },
          { key: "down", label: "Fewer impressions", count: count(byMoved, (r) => movedOf(r) === "down") },
        ]
      : [],
  };
}

function sorted(rows: SeoPageRow[], q: PagesQuery): SeoPageRow[] {
  const key = (r: SeoPageRow): number | string | null => {
    switch (q.sort) {
      case "impressions":
        return r.impressions;
      case "clicks":
        return r.clicks;
      case "ctr":
        return r.ctr.value;
      case "position":
        return r.position;
      case "score":
        return r.score;
      case "issues":
        return r.issues.critical * 1000 + r.issues.warning;
      case "opportunities":
        return r.opportunities;
      case "path":
        return r.page.path;
      case "updated":
        return r.updated;
      case "words":
        return r.words;
      case "links":
        return r.inlinksFromContent * 10_000 + r.inlinks;
      case "change":
        return changeOf(r);
      case "sessions":
        return r.organic ? r.organic.sessions : null;
    }
  };
  const flip = q.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    /* A row with no value is last whichever way the column runs. */
    if (x === null || y === null) {
      if (x !== y) return x === null ? 1 : -1;
    } else if (x !== y) {
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en", { numeric: true })) * flip;
    }
    return (b.impressions ?? 0) - (a.impressions ?? 0) || (b.clicks ?? 0) - (a.clicks ?? 0) || a.page.path.localeCompare(b.page.path);
  });
}

/* ---------- the tiles ------------------------------------------------------------------------- */

function tilesOf(range: SeoRange, v: SiteView, rows: SeoPageRow[], search: Reading<SearchRead>, index: Reading<IndexRead>): PagesTiles {
  const days = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 }[range];
  const crawlAt = v.at;
  const noCrawl = waiting<Stat>("crawl", "The first crawl has not finished yet. It starts about a minute after the desk does.");

  let pages: Reading<Stat> = noCrawl;
  let withIssues: Reading<Stat> = noCrawl;
  if (crawlAt) {
    const rec = recorded("seo.pages", days);
    const inMap = v.pages.filter((p) => p.inSitemap).length;
    pages = ok(
      { value: v.pages.length, previous: rec?.previous ?? null, unit: "count", series: rec?.series ?? [], sub: `${inMap} in the sitemap, ${v.pages.length - inMap} kept out` },
      "crawl",
      crawlAt,
      "Every page the desk's crawl reads: each address in the sitemap and the page files the website keeps out of it. The bars are the crawl's own daily count.",
    );
    const offered = rows.filter((r) => r.inSitemap && r.status === 200);
    withIssues = ok(
      { value: offered.filter(hasIssues).length, previous: null, unit: "count", series: [], of: offered.length },
      "crawl",
      crawlAt,
      "Sitemap pages with at least one critical or warning finding of the crawl's rules (src/cc/site/rules.ts). Not compared: the desk keeps no daily count of it.",
    );
  }

  let indexed: Reading<Stat>;
  if (index.state !== "ok") indexed = index as Reading<never>;
  else {
    const b = index.value.basis;
    /* Of the sitemap's pages as the crawl lists them; before the first crawl, of every address a check asked about. */
    const listed = rows.filter((r) => r.inSitemap);
    const n = listed.length ? listed.filter((r) => r.index?.indexed).length : [...index.value.by.values()].filter((x) => x.indexed).length;
    const of = listed.length ? listed.length : b.of;
    const unasked = listed.filter((r) => !r.index).length;
    const rec = recorded("gsc.indexed", days);
    /* Said under the figure, not only in the (i): a count that leans on an earlier day, or that leaves pages out, must show it. */
    const sub = [b.carried ? `${b.carried} from an earlier check` : "", unasked ? `${unasked} not inspected yet` : ""].filter(Boolean).join(", ");
    indexed = ok(
      { value: n, previous: rec?.previous ?? null, unit: "count", series: rec?.series ?? [], ...(of !== null ? { of } : {}), ...(sub ? { sub } : {}) },
      "gsc",
      index.asOf,
      `Sitemap pages whose newest answer from Google's daily URL Inspection says indexed. ${index.note ?? ""} The bars count the days whose check covered the whole sitemap.`.trim(),
    );
  }

  const fromSearch = <T>(make: (s: SearchRead) => T | null, none: string): Reading<T> => {
    if (search.state !== "ok") return search as Reading<never>;
    const v2 = make(search.value);
    return v2 === null ? waiting("gsc", none) : ok(v2, "gsc", search.asOf, search.note);
  };
  return {
    pages,
    indexed,
    withIssues,
    clicks: fromSearch((s) => s.tiles.clicks, "Search Console reports no clicks for the window yet."),
    position: fromSearch((s) => s.tiles.position, "No impressions in the window, so there is no position to average."),
    positionDays: search.state === "ok" ? search.value.positionDays : [],
    ctr: fromSearch((s) => s.tiles.ctr, "No impressions in the window, so there is no rate."),
  };
}

/* ---------- one page, summarised -------------------------------------------------------------- */

const LEVEL: Record<CrawlSeverity, "high" | "medium" | "low"> = { critical: "high", warning: "medium", opportunity: "low" };
const META_RULE = /^(title|description)\./;

/** A Search Console row list (history or API) for one page's queries. */
async function keywordsOf(path: string, range: SeoRange, search: Reading<SearchRead>): Promise<Reading<{ rows: PageKeyword[]; total: number }>> {
  if (search.state !== "ok") return search as Reading<never>;
  const s = search.value;
  let rows: PageKeyword[];
  let asOf = search.asOf;
  let note = search.note;
  if (s.basis.by === "history") {
    const r = await rankMod();
    rows = r
      .queryPageFigures(s.basis.start, s.basis.end, { path, country: s.basis.country, device: s.basis.device === "all" ? null : s.basis.device })
      .map((x) => ({ query: x.query, clicks: x.clicks, impressions: x.impressions, ctr: rate(x.clicks, x.impressions), position: x.position ?? 0 }));
  } else {
    const got = await gsc.query({ range, dimensions: ["query"], filters: [pageFilter(path)], rowLimit: 250 });
    if (got.state !== "ok") return got as Reading<never>;
    asOf = got.asOf;
    note = got.note;
    const by = new Map<string, { c: number; i: number; w: number }>();
    for (const x of got.value.rows) {
      const k = x.keys[0] ?? "";
      const m = by.get(k) ?? { c: 0, i: 0, w: 0 };
      m.c += x.clicks;
      m.i += x.impressions;
      m.w += x.position * x.impressions;
      by.set(k, m);
    }
    rows = [...by].map(([query, m]) => ({ query, clicks: m.c, impressions: m.i, ctr: rate(m.c, m.i), position: m.i ? round(m.w / m.i, 1) : 0 }));
  }
  rows.sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || a.position - b.position);
  return ok({ rows: rows.slice(0, 50), total: rows.length }, "gsc", asOf, `${note ?? ""} Rare queries are withheld by Google, so these rows do not add up to the page's totals.`.trim());
}

async function performanceOf(path: string, range: SeoRange, search: Reading<SearchRead>): Promise<SeoPageSummary["performance"]> {
  if (search.state !== "ok") return search as Reading<never>;
  const s = search.value;
  if (s.basis.by === "history") {
    const r = await rankMod();
    const days = r.pageSeries(path, s.basis.start, s.basis.end, { country: s.basis.country, device: s.basis.device === "all" ? null : s.basis.device });
    return ok({ start: s.basis.start, end: s.basis.end, days }, "gsc", search.asOf, search.note);
  }
  const got = await gsc.query({ range, dimensions: ["date"], filters: [pageFilter(path)], rowLimit: 500 });
  if (got.state !== "ok") return got as Reading<never>;
  const by = new Map<string, { c: number; i: number; w: number }>();
  for (const x of got.value.rows) {
    const d = x.keys[0] ?? "";
    const m = by.get(d) ?? { c: 0, i: 0, w: 0 };
    m.c += x.clicks;
    m.i += x.impressions;
    m.w += x.position * x.impressions;
    by.set(d, m);
  }
  /* Google sends no row for a day without impressions: once the property's figures have begun, that day is a zero. */
  const days = eachDay(s.from, got.value.endDate).map((date) => {
    const m = by.get(date);
    return m ? { date, clicks: m.c, impressions: m.i, position: m.i ? round(m.w / m.i, 1) : null } : { date, clicks: 0, impressions: 0, position: null };
  });
  return ok({ start: s.from, end: got.value.endDate, days }, "gsc", got.asOf, `${got.note ?? ""}${s.from > got.value.startDate ? ` Google's figures for the site begin on ${s.from}.` : ""}`.trim());
}

/**
 * Google's stored state of one address. Without an answer it says which of
 * the two reasons holds: the address is kept out of the sitemap (the check
 * never asks about it), or it is listed and no recent check has reached it.
 */
async function indexOf(path: string, inSitemap: boolean | null, index: Reading<IndexRead>, live: boolean | null): Promise<Reading<SummaryIndex>> {
  if (index.state !== "ok") return index as Reading<never>;
  const b = index.value.basis;
  const ins = index.value.by.get(path);
  if (!ins) {
    if (inSitemap === false) return off("gsc", "Not inspected: the daily index check asks Google about the addresses in the sitemap only, and this one is not listed there.", "Open the address in Search Console's URL Inspection to see what Google holds for it.");
    return waiting(
      "gsc",
      `Not inspected yet: none of the last ${b.days} daily index checks has an answer for this address${b.complete ? ` (the newest ran on ${b.newest})` : ` (the newest, on ${b.newest}, was cut short at ${b.onNewest} of ${b.of ?? "the"} sitemap addresses)`}. The next daily check asks again.`,
    );
  }
  const m = await indexationMod();
  const said = m.meaningOf(ins.coverage, ins.indexed);
  return ok(
    {
      day: ins.day,
      newest: b.newest,
      indexed: ins.indexed,
      coverage: ins.coverage,
      lastCrawl: ins.lastCrawl,
      meaning: said.meaning,
      fix: said.fix,
      link: ins.link,
      liveSaysIndex: live,
      googleCanonical: ins.googleCanonical,
      userCanonical: ins.userCanonical,
      canonicalOk: ins.canonicalOk,
      robots: ins.robots,
      fetchState: ins.fetchState,
      indexing: ins.indexing,
    },
    "gsc",
    ins.checkedAt,
    `Google's stored state of the address, from the daily URL Inspection of ${ins.day}: what Google last saw, not a live test.${ins.day < b.newest ? ` The check of ${b.newest} did not reach this address.` : ""}`,
  );
}

function issuesOf(path: string, d: PageDetail, idx: Reading<SummaryIndex>): SummaryIssue[] {
  const out: SummaryIssue[] = [];
  if (idx.state === "ok" && !idx.value.indexed) {
    const i = idx.value;
    out.push({
      key: "index",
      title: `Not in Google's index${i.coverage ? `: ${i.coverage}` : ""}`,
      detail: `${i.meaning} ${i.fix}`,
      level: "high",
      from: "gsc",
      action: i.link ? { kind: "link", label: "Inspect", href: i.link } : null,
    });
  }
  const seen = new Set<string>();
  for (const f of d.findings as Finding[]) {
    if (seen.has(f.rule)) continue;
    seen.add(f.rule);
    const meta = META_RULE.test(f.rule) && d.status === 200;
    out.push({
      key: f.rule,
      title: f.title,
      detail: f.text,
      level: LEVEL[f.severity],
      from: "crawl",
      action: meta ? { kind: "task", label: "Propose", task: { kind: "metadata", paths: [path], depth: "deep" } } : null,
    });
  }
  return out;
}

/** The longest question the operator's queue takes (src/cc/operator/queue.ts). */
const PROMPT_MOST = 1000;

/**
 * A question with the facts it needs written into it, as many as fit the
 * operator's limit: each fact is a lead and a list, and a list that does not
 * fit whole is cut from its end, never mid-item.
 */
function promptWith(question: string, facts: { lead: string; items: string[] }[]): string {
  let out = question.replace(/\s+/g, " ").trim();
  for (const f of facts) {
    /* An item that ends its own sentence would leave two full stops at the end of the list. */
    let items = f.items.map((s) => s.replace(/\s+/g, " ").replace(/[.\s]+$/, "")).filter(Boolean);
    while (items.length) {
      const line = ` ${f.lead} ${items.join("; ")}.`;
      if (out.length + line.length <= PROMPT_MOST) {
        out += line;
        break;
      }
      items = items.slice(0, -1);
    }
  }
  return out;
}

/**
 * The summary's quick actions. An "ask" task is given the page's tags, counts
 * and findings by the operator's own pack (src/cc/operator/packs.ts), not its
 * text and not its searches. So what each question depends on is written into
 * the question here, from what the desk already holds: the searches Google
 * showed the page for, its section headings, the pages that link to it, its
 * structured-data types. Each step says what the operator is and is not given.
 */
function quickActions(path: string, d: PageDetail, idx: Reading<SummaryIndex>, keywords: Reading<{ rows: PageKeyword[]; total: number }>, basis: SearchBasis | null): QuickAction[] {
  const answers = d.status === 200;
  const why = answers ? null : `The page answers ${d.status || "nothing"}, so there is nothing on it to change.`;
  const ask = (prompt: string): NewTask => ({ kind: "ask", prompt, path, context: "pages", depth: "deep" });
  const f = d.facts;
  const short = (s: string, n: number): string => ([...s].length > n ? `${[...s].slice(0, n - 1).join("")}…` : s);
  const searches = keywords.state === "ok" ? keywords.value.rows.slice(0, 8).map((k) => `"${short(k.query, 60)}" (${k.impressions} impressions, position ${k.position})`) : [];
  const window = basis ? `${basis.start} to ${basis.end}` : "the window";
  const searchFact = searches.length
    ? { lead: `Searches Google showed it for, ${window} (Search Console):`, items: searches }
    : { lead: keywords.state === "ok" ? `Google showed it for no search, ${window}:` : "Its searches are not available:", items: ["judge it by its topic"] };
  const headings = (f?.h2s ?? []).slice(0, 14).map((h) => short(h, 70));
  const headingFact = { lead: "Its section headings, in order:", items: headings };
  const fromContent = [...new Set(d.linksIn.filter((l) => l.place === "main").map((l) => l.source))].slice(0, 15);
  const types = f?.schemaTypes ?? [];
  const given = "this page's title, description, main heading, section headings, word count and the crawl's findings";
  const list: QuickAction[] = [
    {
      key: "metadata",
      label: "New title & description",
      step: "The operator (the studio workstation's model) writes a new title and description for this page. They wait in AI Operator › Approvals; nothing on the live site changes until a person approves.",
      task: { kind: "metadata", paths: [path], depth: "deep" },
      href: null,
      available: answers,
      why,
    },
    {
      key: "content",
      label: "Improve content with AI",
      step: `The operator (the studio workstation's model) is given ${given}, and the searches Google shows the page for. It is not given the page's full text. It answers, in plain text, what to add, cut or reword. A person edits the page.`,
      task: ask(
        promptWith(
          `How should the content of ${path} change so it answers the searches it is shown for better? Be specific, section by section: what to add, cut or reword. You have its tags, headings and findings, not its full text: say so where you would need to read it.`,
          [searchFact, headingFact],
        ),
      ),
      href: null,
      available: answers,
      why,
    },
    {
      key: "links",
      label: "Find internal links",
      step: "The operator is given the list of the website's pages and the pages that already link here, and names the pages that should link here from their content, with the words of each link. A person adds the links.",
      task: ask(
        promptWith(`Which pages of the website should link to ${path} from their own content, and with what words? Name each page and the sentence the link would sit in. Use only the pages given, and leave out the ones that already link to it.`, [
          fromContent.length ? { lead: "Already linking to it from their content:", items: fromContent } : { lead: "No page links to it from its own content yet:", items: [d.inlinks ? "only menus and footers do" : "nothing links to it at all"] },
          searchFact,
        ]),
      ),
      href: null,
      available: answers,
      why,
    },
    {
      key: "schema",
      label: "Draft structured data",
      step: `The operator drafts the schema.org markup this page should carry, from ${given} (not its full text). It goes into the website's code by hand; nothing is applied.`,
      task: ask(
        promptWith(
          `Which structured data (schema.org JSON-LD) should ${path} carry? It is a ${d.kindLabel} page. Draft the markup from the title, description and headings you are given, and name each field you could not fill from them.`,
          [types.length ? { lead: "It carries these types now:", items: types.slice(0, 12) } : { lead: "It carries no structured data now:", items: ["start from none"] }, headingFact],
        ),
      ),
      href: null,
      available: answers,
      why,
    },
  ];
  if (idx.state === "ok" && idx.value.link) {
    list.push({ key: "inspect", label: "Open in Search Console", step: "Opens Google's URL Inspection of this address in Search Console, where indexing can be requested by hand.", task: null, href: idx.value.link, available: true, why: null });
  }
  return list;
}

async function contentOf(path: string, d: PageDetail, keywords: Reading<{ rows: PageKeyword[]; total: number }>, readiness: SeoPageSummary["readiness"]): Promise<Reading<ContentCheck[]>> {
  const f = d.facts;
  if (!f) return off("crawl", d.status === 200 ? "The crawl could not read this page's HTML, so its content cannot be checked." : `The page answers ${d.status || "nothing"}: there is no content to check.`);
  const s = await siteMod();
  const fired = new Set((d.findings as Finding[]).map((x) => x.rule));
  const out: ContentCheck[] = [];
  const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

  out.push(
    f.h1.length === 1
      ? { key: "h1", label: "Main heading", value: "1 heading", state: "good", verdict: "Good", rule: `One <h1>: “${f.h1[0]!.slice(0, 80)}”.` }
      : f.h1.length === 0
        ? { key: "h1", label: "Main heading", value: "none", state: "missing", verdict: "Missing", rule: "No <h1>: the page does not say what it is about in its own heading." }
        : { key: "h1", label: "Main heading", value: plural(f.h1.length, "heading"), state: "work", verdict: "Needs work", rule: "More than one <h1>: one says what the page is about, more blur it." },
  );
  out.push({
    key: "length",
    label: "Content length",
    value: plural(f.words, "word"),
    state: f.words >= s.LIMITS.thinWords ? "good" : "work",
    verdict: f.words >= s.LIMITS.thinWords ? "Good" : "Short",
    rule: `Words of the page's own content; under ${s.LIMITS.thinWords} is thin by the desk's yardstick (Google names no number).`,
  });

  if (keywords.state === "ok" && keywords.value.rows.length) {
    const w = await wordsMod();
    const have = w.pageWords({ path, title: d.title, h1: f.h1[0] ?? null });
    const top = keywords.value.rows.slice(0, 5);
    const met = top.filter((k) => w.answers(k.query, have)).length;
    const first = w.answers(top[0]!.query, have);
    out.push({
      key: "terms",
      label: "Searches in title or heading",
      value: `${met} of ${top.length}`,
      state: first ? "good" : "work",
      verdict: first ? "Good" : "Needs work",
      rule: `Of the ${top.length} searches it is shown for most, ${met} have every word (places aside) in its title, main heading or address; the first, “${top[0]!.query}”, ${first ? "does" : "does not"}. The desk's own rule (src/cc/seo/words.ts).`,
    });
  } else {
    out.push({
      key: "terms",
      label: "Searches in title or heading",
      value: "—",
      state: "unknown",
      verdict: "No searches",
      rule: keywords.state === "ok" ? "Google showed this page for no search in the window, so there is nothing to compare its title with." : keywords.reason,
    });
  }

  const shown = f.images.filter((i) => !i.hidden);
  const noAlt = shown.filter((i) => i.alt === "absent").length;
  out.push({
    key: "images",
    label: "Pictures",
    value: plural(shown.length, "picture"),
    state: noAlt ? "work" : "good",
    verdict: noAlt ? `${noAlt} without alt` : "Good",
    rule: noAlt ? `${plural(noAlt, "picture")} carry no alt attribute at all (alt="" for decoration is fine).` : "Every picture carries an alt attribute.",
  });

  const fromContent = d.inlinksFromContent;
  out.push({
    key: "links",
    label: "Links in from content",
    value: plural(fromContent, "page"),
    state: fromContent > 0 ? "good" : "work",
    verdict: fromContent > 0 ? "Good" : d.inlinks > 0 ? "Menus only" : "None",
    rule: `Other pages that link here from their own content (${d.inlinks} link here from anywhere, menus and footer included).`,
  });

  const faqRead = readiness.state === "ok" ? readiness.value.checks.find((c) => c.key === "faq") : undefined;
  const faqSchema = f.schemaTypes.includes("FAQPage");
  if (faqRead && faqRead.state !== "n/a" && faqRead.state !== "unknown") {
    out.push({ key: "faq", label: "Questions answered", value: faqRead.state === "pass" ? "on the page" : "none", state: faqRead.state === "pass" ? "good" : "missing", verdict: faqRead.state === "pass" ? "Good" : "Missing", rule: `${faqRead.detail} (the AI-readiness check).` });
  } else if (faqSchema) {
    out.push({ key: "faq", label: "Questions answered", value: "FAQPage markup", state: "good", verdict: "Good", rule: "The page carries FAQPage structured data." });
  } else {
    out.push({
      key: "faq",
      label: "Questions answered",
      value: "—",
      state: faqRead?.state === "n/a" ? "good" : "unknown",
      verdict: faqRead?.state === "n/a" ? "Not needed" : readiness.state === "off" ? "Not read" : "Not read yet",
      rule:
        faqRead?.state === "n/a"
          ? faqRead.detail
          : readiness.state === "off"
            ? `Whether the page answers questions is read by the AI-readiness check, which does not read this page: ${readiness.reason} No FAQPage markup is on it.`
            : "Whether the page answers questions is read by the AI-readiness check, which has not read this page yet; no FAQPage markup is on it.",
    });
  }

  const ownSchema = !fired.has("schema.none") && !fired.has("schema.site-only") && !fired.has("schema.unreadable");
  out.push({
    key: "schema",
    label: "Structured data",
    value: f.schemaTypes.length ? f.schemaTypes.slice(0, 3).join(", ") : "none",
    state: fired.has("schema.none") ? "missing" : ownSchema && !fired.has("schema.incomplete") ? "good" : "work",
    verdict: fired.has("schema.none") ? "Missing" : fired.has("schema.site-only") ? "Company only" : fired.has("schema.incomplete") ? "Incomplete" : fired.has("schema.unreadable") ? "Invalid" : "Good",
    rule: "Structured data describing the page itself, read by the crawl (Google's Rich Results Test is the last word).",
  });

  const titleLen = f.title ? [...f.title].length : 0;
  const descLen = f.description ? [...f.description].length : 0;
  const metaOk = titleLen > 0 && titleLen <= s.LIMITS.title && descLen > 0 && descLen <= s.LIMITS.description;
  out.push({
    key: "meta",
    label: "Title and description",
    value: `${titleLen} / ${descLen} characters`,
    state: !titleLen || !descLen ? "missing" : metaOk ? "good" : "work",
    verdict: !titleLen || !descLen ? "Missing" : metaOk ? "Good" : "Too long",
    rule: `Title up to ${s.LIMITS.title} characters and description up to ${s.LIMITS.description}: past those, results cut them (Google cuts by width; these are the desk's yardsticks).`,
  });
  return ok(out, "crawl", d.lastSeen, "Read from the page as the crawl last fetched it, without running its scripts.");
}

function serpOf(d: PageDetail): Reading<SerpPreview> {
  const f = d.facts;
  if (!f) return off("crawl", `The page answers ${d.status || "nothing"}, so it has no tags to preview.`);
  const u = new URL(d.url);
  const title = f.title ?? null;
  const description = f.description ?? null;
  return ok(
    {
      url: d.url,
      title,
      titleLength: title ? [...title].length : 0,
      titleLimit: 60,
      description,
      descriptionLength: description ? [...description].length : 0,
      descriptionLimit: 160,
      schemaTypes: f.schemaTypes,
      picture: pictureOf(f.og.image),
      /* The host as crawled, "www." kept: a result prints the address Google indexed, and the canonical carries it. */
      host: u.host,
      crumbs: u.pathname.split("/").filter(Boolean).map((p) => decodeURIComponent(p)),
    },
    "crawl",
    d.lastSeen,
    "The page's own title and description as the crawl read them. Google may rewrite either, and cuts them by width, not by a count of characters.",
  );
}

function linksOf(d: PageDetail): PageLinks {
  const from = [...d.linksIn].sort((a, b) => (a.place === b.place ? a.source.localeCompare(b.source) : a.place === "main" ? -1 : 1));
  const once = new Map<string, (typeof from)[number]>();
  for (const l of from) if (!once.has(l.source)) once.set(l.source, l);
  return { in: d.inlinks, inFromContent: d.inlinksFromContent, out: d.outlinks, from: [...once.values()].slice(0, 12) };
}

/** True when a canonical names this very address on the site's own host; null without one. */
function canonicalSelfOf(canonical: string | null | undefined, path: string): boolean | null {
  if (!canonical) return null;
  try {
    return pathOf(canonical) === path && new URL(canonical, `${siteBase()}/`).host.replace(/^www\./, "") === bareHost();
  } catch {
    return false;
  }
}

function technicalOf(path: string, d: PageDetail, crawledAt: string): PageTechnical {
  const f = d.facts;
  return {
    crawledAt,
    status: d.status,
    ttfbMs: d.fetched?.ttfb ?? null,
    totalMs: d.fetched?.total ?? null,
    bytes: d.fetched?.bytes ?? null,
    cache: d.fetched?.vercelCache ?? null,
    robots: f?.robots ?? null,
    robotsHeader: d.fetched?.robotsTag ?? null,
    canonical: f?.canonical ?? null,
    canonicalSelf: canonicalSelfOf(f?.canonical, path),
    lang: f?.lang ?? null,
    h1: f?.h1 ?? [],
    h2: f?.h2 ?? 0,
    words: f?.words ?? null,
    schemaTypes: f?.schemaTypes ?? [],
  };
}

/** The newest PageSpeed lab run of this address per kind of device, when it is one of the pages the daily test measures. */
async function speedOf(path: string): Promise<Reading<PageSpeed>> {
  const s = await siteMod();
  const runs: PageSpeed["runs"] = [];
  let absent: Reading<never> | null = null;
  let any = false;
  for (const strategy of ["mobile", "desktop"] as const) {
    const r = s.labRuns(strategy);
    if (r.state !== "ok") {
      absent = r as Reading<never>;
      continue;
    }
    any = true;
    const run = r.value.find((x) => x.path === path);
    if (run) runs.push({ strategy, at: run.at, performance: run.scores.performance, lcpMs: run.lcpMs, cls: run.cls, tbtMs: run.tbtMs, failure: run.failure });
  }
  if (!runs.length) {
    if (!any && absent) return absent;
    return off("psi", "PageSpeed measures a fixed list of pages each day, and this address is not on it.", "Site Health shows the pages it measures; CC_PSI_PAGES on the desk's server replaces the list.");
  }
  return ok({ runs }, "psi", runs.reduce((t, x) => (x.at > t ? x.at : t), ""), "A lab run: Lighthouse on Google's machines, not real visitors.");
}

/**
 * The AI-readiness check reads the sitemap's pages that answer 200, once a
 * day. A page it will never read says so (off); one it has not reached yet waits.
 */
async function readinessOf(path: string, d: PageDetail): Promise<SeoPageSummary["readiness"]> {
  const m = await readinessMod();
  const r = m.readinessOf(path);
  if (!r) {
    if (!d.inSitemap) return off("desk", "The AI-readiness check reads the sitemap's pages only, and this one is kept out of the sitemap.");
    if (d.status !== 200) return off("desk", `The AI-readiness check reads pages that answer 200, and this one answered ${d.status || "nothing"} at the last crawl.`);
    const job = jobStatus().find((j) => j.name === "seo-readiness");
    return waiting(
      "desk",
      job
        ? "The AI-readiness check has not read this page yet: it reads every sitemap page once a day, and with Run full SEO audit."
        : "The AI-readiness check is not running on this desk yet (job seo-readiness): it reads every sitemap page once a day once it is.",
    );
  }
  const applying = r.checks.filter((c) => c.state !== "n/a");
  return ok({ checkedAt: r.checkedAt, pass: applying.filter((c) => c.state === "pass").length, of: applying.length, checks: r.checks }, "desk", r.checkedAt, "Read from the page the way a crawler gets it, without running scripts. Each check says what it read.");
}

async function opportunitiesOf(path: string, v: SiteView): Promise<SeoPageSummary["opportunities"]> {
  const e = await engineMod();
  const ran = jobStatus().find((j) => j.name === "seo-engine");
  const all = e.allOpportunities().filter((o) => o.page === path && o.active && (o.state === "open" || o.state === "queued" || o.state === "in-progress"));
  if (!all.length && !ran?.lastEnd) {
    return waiting("desk", ran ? "The opportunity engine has not finished a run yet: it runs after the daily snapshot, and with Run full SEO audit." : "The opportunity engine is not running on this desk yet (job seo-engine).");
  }
  const names = e.clusterNames();
  const rows = all.map((o) => e.toRow(o, v, names)).sort(e.rank);
  return ok(
    { open: rows.length, rows: rows.slice(0, 5).map((r) => ({ id: r.id, title: r.title, typeLabel: r.typeLabel, priority: r.priority, potential: r.potential })) },
    "desk",
    ran?.lastEnd ?? new Date().toISOString(),
    "Found by the engine's stated rules (src/cc/seo/rules.ts) from what the desk measured. An estimate is ours, from Search Console impressions.",
  );
}

async function proposalsOf(path: string): Promise<SeoPageSummary["proposals"]> {
  try {
    const a = await applyMod();
    return a
      .proposals(["waiting", "approved", "applied"], 300)
      .filter((p) => p.address === path)
      .map((p) => ({ id: p.id, kind: p.kind, state: p.state, href: `/operator?ap=${p.state === "waiting" ? "waiting" : "approved"}#approvals` }));
  } catch {
    return [];
  }
}

async function summaryOf(path: string, row: SeoPageRow | null, range: SeoRange, v: SiteView, search: Reading<SearchRead>, index: Reading<IndexRead>): Promise<Reading<SeoPageSummary>> {
  const s = await siteMod();
  const one = s.page(path);
  if (one.state !== "ok") return one as Reading<never>;
  const d = one.value;
  if (!row) return off("crawl", `The crawl reads ${path}, but it is not in the list: reload in a moment.`);
  /* `indexable`: the page answers 200 and says no noindex, by tag or header, as the crawl read it. */
  const live = d.status === 200 && d.facts ? d.indexable : null;
  const idx = await reading("gsc", () => indexOf(path, d.inSitemap, index, live));
  const [keywords, performance, readiness, opportunities, proposals, speed] = await Promise.all([
    reading("gsc", () => keywordsOf(path, range, search)),
    reading("gsc", () => performanceOf(path, range, search)),
    reading("desk", () => readinessOf(path, d)),
    reading("desk", () => opportunitiesOf(path, v)),
    proposalsOf(path),
    reading("psi", () => speedOf(path)),
  ]);
  const content = await reading("crawl", () => contentOf(path, d, keywords, readiness));
  const crawledAt = one.asOf;
  const lines: SeoPageSummary["score"]["lines"] = [];
  const seen = new Set<string>();
  for (const f of d.findings as Finding[]) {
    if (seen.has(f.rule)) continue;
    seen.add(f.rule);
    if (f.cost > 0) lines.push({ rule: f.rule, title: f.title, severity: f.severity, cost: f.cost });
  }
  lines.sort((a, b) => b.cost - a.cost);
  return ok(
    {
      row,
      score: {
        value: d.score,
        unscored:
          d.score !== null
            ? null
            : !d.inSitemap
              ? "Kept out of the sitemap on purpose, so it has no SEO score: the crawl only checks that it really is kept out of search."
              : "The crawl could not read the page, so it gives it no score.",
        lines,
      },
      index: idx,
      issues: ok(issuesOf(path, d, idx), "crawl", crawledAt, "Google's index state from the daily URL Inspection, then the crawl's findings by its stated rules (src/cc/site/rules.ts)."),
      actions: quickActions(path, d, idx, keywords, search.state === "ok" ? search.value.basis : null),
      performance,
      keywords,
      content,
      serp: serpOf(d),
      links: ok(linksOf(d), "crawl", crawledAt),
      technical: ok(technicalOf(path, d, crawledAt), "crawl", crawledAt, "One fetch by the desk's crawl, from the desk's server: a hint about speed, not a measurement."),
      speed,
      readiness,
      opportunities,
      proposals,
    },
    "crawl",
    crawledAt,
  );
}

/* ---------- one address looked up on the live site -------------------------------------------- */

/** A live answer is kept this long, so reloading the screen or changing a filter does not ask the website again. */
const LOOKUP_KEEP_MS = 120_000;
const lookedUp = new Map<string, { at: number; got: Got }>();
/** When the next live request may leave: never more than one a second to the website. */
let nextLive = 0;

async function liveGet(url: string): Promise<{ at: number; got: Got }> {
  const had = lookedUp.get(url);
  if (had && Date.now() - had.at < LOOKUP_KEEP_MS) return had;
  const wait = Math.max(0, nextLive - Date.now());
  nextLive = Date.now() + wait + 1000;
  if (wait) await sleep(wait);
  const kept = { at: Date.now(), got: await wire.get(url) };
  lookedUp.set(url, kept);
  /* A handful of addresses at most: the oldest goes first. */
  if (lookedUp.size > 100) lookedUp.delete(lookedUp.keys().next().value as string);
  return kept;
}

/** The address a lookup is asked for, or the sentence that says why it cannot be looked up here. */
function lookupTarget(raw: string | undefined): { path: string } | { refused: string } {
  const s = (raw ?? "").trim();
  if (!s) return { refused: "Give an address of the website to look up: a path such as /about, or a full address." };
  if (s.length > 400) return { refused: "That address is too long to be one of the website's." };
  const pasted = addressIn(s);
  if (pasted && "foreign" in pasted) return { refused: `${pasted.foreign} is another website. Only addresses of ${bareHost()} are looked up here; other websites are looked up on SEO › Competitors.` };
  const path = pasted ? pasted.path : /\s/.test(s) ? null : pathParam(s);
  if (!path) return { refused: `“${s.slice(0, 80)}” is not an address of the website.` };
  return { path };
}

/** True when a robots tag or header keeps the page out of search: "noindex", or "none" as a whole directive (not "max-image-preview:none"). */
const saysNoindex = (robots: string | null | undefined): boolean =>
  (robots ?? "")
    .toLowerCase()
    .split(",")
    .map((d) => d.trim())
    .some((d) => d === "none" || /(^|[\s:])noindex$/.test(d));

async function liveOf(path: string, url: string): Promise<Reading<LookupLive>> {
  const { at, got } = await liveGet(url);
  let page: LookupLive["page"] = null;
  const robotsHeader = got.headers["x-robots-tag"] ?? null;
  if (got.status === 200 && got.body && /html/i.test(got.headers["content-type"] ?? "text/html")) {
    try {
      const { parsePage } = await import("../../site/parse.ts");
      const f = parsePage(got.body, got.url).facts;
      const lands = sitePathOf(got.url) ?? path;
      page = {
        title: f.title,
        description: f.description,
        canonical: f.canonical,
        canonicalSelf: canonicalSelfOf(f.canonical, lands),
        robots: f.robots,
        robotsHeader,
        indexable: !saysNoindex(f.robots) && !saysNoindex(robotsHeader),
        lang: f.lang,
        h1: f.h1,
        words: f.words,
        schemaTypes: f.schemaTypes,
        hreflang: f.hreflang ?? [],
      };
    } catch {
      page = null;
    }
  }
  const landed = sitePathOf(got.url);
  /* What the host itself says about a refusal ("DEPLOYMENT_DISABLED"), when it says anything. */
  const hostWord = got.status >= 400 ? (got.headers["x-vercel-error"] ?? null) : null;
  return ok(
    {
      status: got.status,
      finalUrl: got.url,
      landsOn: landed && landed !== path ? landed : null,
      hops: got.hops,
      ttfbMs: got.ttfb,
      bytes: got.bytes,
      error: got.error ?? hostWord,
      page,
    },
    "probe",
    at,
    "One request from the desk's server just now (kept two minutes), named BalkarisDesk, following redirects by hand. Scripts are not run.",
  );
}

async function lookupOf(path: string, range: SeoRange, v: SiteView, search: Reading<SearchRead>, index: Reading<IndexRead>): Promise<Reading<PageLookup>> {
  const url = absUrl(path);
  const s = await siteMod();
  let inSitemap: boolean | null = null;
  try {
    const map = s.lastSitemap();
    inSitemap = map ? map.entries.some((e) => e.path === path) : null;
  } catch {
    inSitemap = null;
  }
  const live = await reading("probe", () => liveOf(path, url));
  const says = live.state === "ok" && live.value.page ? live.value.page.indexable : null;
  const [idx, figures] = await Promise.all([
    reading("gsc", () => indexOf(path, inSitemap, index, says)),
    reading("gsc", async (): Promise<PageLookup["search"]> => {
      if (search.state !== "ok") return search as Reading<never>;
      const b = search.value.basis;
      /* Google names every address it showed: one it does not name was not shown, a real zero. */
      const f = search.value.now.get(path) ?? { clicks: 0, impressions: 0, position: null };
      const kw = await reading("gsc", () => keywordsOf(path, range, search));
      return ok(
        { start: b.start, end: b.end, clicks: f.clicks, impressions: f.impressions, ctr: rate(f.clicks, f.impressions), position: f.position, keywords: kw.state === "ok" ? kw.value.rows.slice(0, 20) : [], total: kw.state === "ok" ? kw.value.total : 0 },
        "gsc",
        search.asOf,
        search.note,
      );
    }),
  ]);
  let redirect: PageLookup["redirect"] = null;
  let mayRedirect: PageLookup["mayRedirect"] = { ok: false, why: "The desk's proposals could not be read." };
  try {
    const a = await applyMod();
    const had = a.proposals(["waiting", "approved", "applied"], 300).find((p) => p.kind === "redirect" && p.address === path);
    if (had) redirect = { id: had.id, to: had.after.to ?? null, state: had.state, href: `/operator?ap=${had.state === "waiting" ? "waiting" : "approved"}#approvals` };
    /* Asked with the home page as the target, so only what is wrong with the address it leaves from is said. */
    const why = path === "/" ? "The home page is a live page: a redirect from it would hide it." : a.redirectRefusal(path, "/");
    mayRedirect = { ok: !why, why };
  } catch {
    /* said above */
  }
  return ok({ path, url, known: v.byPath.has(path), inSitemap, live, index: idx, search: figures, redirect, mayRedirect }, "probe", live.state === "ok" ? live.asOf : new Date().toISOString());
}

/* ---------- the screen ------------------------------------------------------------------------ */

interface Screen {
  payload: SeoPagesPayload;
  /** Every row that matched, in order, for the export. */
  matched: SeoPageRow[];
  basis: SearchBasis | null;
}

async function screen(c: Context<Vars>, paged: boolean, withSummary: boolean): Promise<Screen> {
  const range = rangeFrom(c);
  const q = queryOf(c, paged);
  const v = view();
  const wantOrganic = !paged || q.cols.includes("sessions") || q.sort === "sessions";
  const [search, index, opps, ready, rules, waitingNow, organic, info] = await Promise.all([
    reading("gsc", () => searchRead(range, { country: q.country, device: q.device })),
    reading("gsc", indexRead),
    oppCounts(),
    readinessCounts(),
    rulesByPage(),
    waitingByPage(),
    reading("ga4", () => organicRead(range, wantOrganic)),
    ruleInfo(),
  ]);
  const searchOk = search.state === "ok";
  const all = v.at
    ? rowsOf(v, { search: searchOk ? search.value : null, index: index.state === "ok" ? index.value : null, opps, ready, rules, waiting: waitingNow, organic: organic.state === "ok" ? organic.value : null })
    : [];

  /* A value the server does not know is replaced by its default, so the echo is what the list really answers. */
  if (q.type !== "all" && !all.some((r) => kindOf(r) === q.type)) q.type = "all";
  if (q.finding !== "all" && !all.some((r) => r.rules.includes(q.finding))) q.finding = "all";
  if (q.lang !== "all" && !all.some((r) => langOf(r) === q.lang)) q.lang = "all";
  const compared = searchOk && search.value.basis.previous !== null;
  if (!compared) q.moved = "all";
  /* The splits by country and device exist in the desk's own history only. */
  if (!searchOk || search.value.basis.by !== "history") {
    q.country = "all";
    q.device = "all";
  }

  const basis: FilterBasis = { searchOk, compared, queries: q.q && !addressIn(q.q) ? await queriesByPage(range, search) : null };
  const matched = sorted(filtered(all, q, basis), q);
  const offset = lastPageOffset(q.offset, matched.length, q.limit);
  const page = matched.slice(offset, offset + q.limit);

  const list: SeoPagesPayload["list"] = v.at
    ? ok(
        { total: matched.length, offset, limit: q.limit, rows: page, searchedIn: searchedIn(q, basis) },
        "crawl",
        v.at,
        `The desk's crawl, with Search Console's figures${search.state === "ok" ? ` for ${search.value.basis.start} to ${search.value.basis.end}` : " (not available: see the tiles)"} and each address's newest answer from Google's daily URL Inspection.`,
      )
    : waiting("crawl", "The first crawl has not finished yet. It starts about a minute after the desk does and takes under a minute.");

  const elsewhere: SeoPagesPayload["elsewhere"] =
    search.state !== "ok"
      ? (search as Reading<never>)
      : !v.at
        ? waiting("crawl", "The crawl has not read the site yet.")
        : (() => {
            const out = [...search.value.now].filter(([p]) => !v.byPath.has(p)).map(([path, f]) => ({ path, clicks: f.clicks, impressions: f.impressions }));
            out.sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks);
            return ok(
              { addresses: out.length, clicks: out.reduce((n, x) => n + x.clicks, 0), impressions: out.reduce((n, x) => n + x.impressions, 0), top: out.slice(0, 50) },
              "gsc",
              search.asOf,
              "Addresses Search Console counted that the crawl does not read: addresses of an earlier site, or another host's spelling.",
            );
          })();

  let selected: SeoPagesPayload["selected"] = null;
  let lookup: SeoPagesPayload["lookup"] = null;
  if (withSummary) {
    const typed = q.q ? addressIn(q.q) : null;
    /* An address the crawl does not read is looked up on the live site: asked for by ?open=, or typed whole into the search. */
    const unknown = q.open && !v.byPath.has(q.open) ? q.open : !q.open && typed && "path" in typed && !matched.length ? typed.path : null;
    if (unknown) lookup = await reading("probe", () => lookupOf(unknown, range, v, search, index));
    else if (!q.open && typed && "foreign" in typed) lookup = off("probe", `${typed.foreign} is another website. Only addresses of ${bareHost()} are looked up here.`, "Other websites are looked up on SEO › Competitors.");
    else if (v.at) {
      const path = q.open ?? page[0]?.page.path ?? null;
      if (path) {
        const row = all.find((r) => r.page.path === path) ?? null;
        selected = await reading("crawl", () => summaryOf(path, row, range, v, search, index));
      }
    }
  }

  return {
    payload: {
      head: head(range),
      tiles: tilesOf(range, v, all, search, index),
      facets: facetsOf(all, q, basis, info),
      list,
      query: { ...q, offset },
      search: search.state === "ok" ? { ...search, value: search.value.basis } : (search as Reading<never>),
      index: index.state === "ok" ? { ...index, value: index.value.basis } : (index as Reading<never>),
      organic:
        organic.state === "ok"
          ? { ...organic, value: { start: organic.value.start, end: organic.value.end, pages: organic.value.by.size, sessions: [...organic.value.by.values()].reduce((n, x) => n + x.sessions, 0) } }
          : (organic as Reading<never>),
      elsewhere,
      selected,
      lookup,
    },
    matched,
    basis: search.state === "ok" ? search.value.basis : null,
  };
}

routes.get("/", async (c) => c.json<SeoPagesPayload>((await screen(c, true, true)).payload));

/* ---------- GET /lookup ----------------------------------------------------------------------- */

routes.get("/lookup", async (c) => {
  const asked = lookupTarget(c.req.query("url"));
  if ("refused" in asked) return c.json<Reading<PageLookup>>(off("probe", asked.refused));
  const range = rangeFrom(c);
  const [search, index] = await Promise.all([reading("gsc", () => searchRead(range, { country: "all", device: "all" })), reading("gsc", indexRead)]);
  return c.json<Reading<PageLookup>>(await reading("probe", () => lookupOf(asked.path, range, view(), search, index)));
});

/* ---------- GET /export.csv ------------------------------------------------------------------- */

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  let s = String(v);
  /* A spreadsheet runs a cell that starts like a formula. */
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

routes.get("/export.csv", async (c) => {
  const s = await screen(c, false, false);
  const list = s.payload.list;
  if (list.state !== "ok") return c.json({ error: `There is nothing to export yet: ${list.reason}` }, 409);
  const part = s.basis ? [s.basis.country !== "all" ? "Switzerland" : null, s.basis.device !== "all" ? s.basis.device : null].filter(Boolean).join(", ") : "";
  const w = s.basis ? `${s.basis.start} to ${s.basis.end}${part ? `, ${part}` : ""}` : "not available";
  const was = s.basis?.previous ? `${s.basis.previous.start} to ${s.basis.previous.end}` : "not compared";
  const organic = s.payload.organic;
  const headRow = [
    "Address",
    "URL",
    "Title",
    "Type",
    "HTTP status",
    "In sitemap",
    "In Google's index",
    "Google's words",
    "Inspected on",
    `Clicks (Search Console, ${w})`,
    "Impressions",
    "CTR %",
    "Average position",
    "SEO score (desk crawl)",
    "Critical",
    "Warnings",
    "Opportunity findings",
    "Open opportunities",
    "AI readiness (pass of)",
    "Words",
    "Updated",
    /* Added after the first twenty-one, so a sheet built on those keeps its columns. */
    `Clicks before (${was})`,
    "Impressions before",
    `Organic sessions (GA4, consenting visitors, ${organic.state === "ok" ? `${organic.value.start} to ${organic.value.end}` : "not available"})`,
    "Pages linking here",
    "Linking from their content",
    "Proposals waiting",
    "Findings (rules)",
    "Description",
  ];
  const lines = [headRow.map(cell).join(",")];
  /* ?path= (repeatable): only the rows ticked in the table. */
  const wanted = new Set((c.req.queries("path") ?? []).map((p) => pathParam(p)).filter((p): p is string => p !== null));
  for (const r of s.matched) {
    if (wanted.size && !wanted.has(r.page.path)) continue;
    lines.push(
      [
        r.page.path,
        r.url,
        r.page.title,
        r.page.kindLabel,
        r.status,
        r.inSitemap ? "yes" : "no",
        r.index ? (r.index.indexed ? "yes" : "no") : "",
        r.index?.coverage ?? "",
        r.index?.day ?? "",
        r.clicks ?? "",
        r.impressions ?? "",
        r.impressions !== null && r.ctr.value !== null ? r.ctr.value : "",
        r.position ?? "",
        r.score,
        r.issues.critical,
        r.issues.warning,
        r.issues.opportunity,
        r.opportunities,
        r.readiness ? `${r.readiness.pass} of ${r.readiness.of}` : "",
        r.words,
        r.updated ? r.updated.slice(0, 10) : "",
        r.previous ? r.previous.clicks : "",
        r.previous ? r.previous.impressions : "",
        r.organic ? r.organic.sessions : "",
        r.inlinks,
        r.inlinksFromContent,
        r.proposalsWaiting,
        r.rules.join(" "),
        r.description,
      ]
        .map(cell)
        .join(","),
    );
  }
  c.header("content-type", "text/csv; charset=utf-8");
  c.header("content-disposition", `attachment; filename="balkaris-seo-pages-${today()}-${rangeFrom(c)}${wanted.size ? "-selected" : ""}.csv"`);
  c.header("cache-control", "no-store");
  return c.body(`﻿${lines.join("\r\n")}\r\n`);
});

/* Exported for the check script (scripts/check-cc-seo-pages.ts): the pure parts, fed artificial rows. */
export const _test = {
  filtered,
  sorted,
  facetsOf,
  merge,
  pathParam,
  addressIn,
  lastPageOffset,
  scoreBucket,
  trafficBucket,
  linkBucket,
  movedOf,
  newestPerAddress,
  promptWith,
  lookupTarget,
  searchedIn,
  fold,
  saysNoindex,
  cell,
  /** Forget the kept live answers, so a check can ask twice. */
  forgetLookups: (): void => {
    lookedUp.clear();
    nextLive = 0;
  },
  PROMPT_MOST,
  INDEX_DAYS,
};
