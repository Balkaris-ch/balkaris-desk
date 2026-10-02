import { Hono, type Context } from "hono";
import type { Vars } from "../../access.ts";
import { status as jobStatus } from "../../scheduler.ts";
import * as gsc from "../../search/gsc.ts";
import { eachDay, pathOf, round, siteBase } from "../../search/shared.ts";
import { off, ok, reading, today, waiting } from "../../store.ts";
import type { Reading, Stat } from "../../../../web/src/contract/common.ts";
import type { NewTask } from "../../../../web/src/contract/operator.ts";
import type { RateStat, SeoRange } from "../../../../web/src/contract/seo/common.ts";
import type {
  ContentCheck,
  CrawlSeverity,
  PageFacets,
  PageKeyword,
  PageLinks,
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
 *                                      address, once a day (cc_inspect)
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
 * applies nothing.
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

/* ---------- the question ------------------------------------------------------------------- */

const SORTS: PagesSort[] = ["impressions", "clicks", "ctr", "position", "score", "issues", "opportunities", "path", "updated"];
const STATUSES = ["all", "indexed", "not-indexed", "issues"] as const;
const SCORES = ["all", "90-100", "70-89", "50-69", "0-49"] as const;
const TRAFFIC = ["all", "high", "medium", "low", "none"] as const;

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

function queryOf(c: Context<Vars>, paged: boolean): PagesQuery {
  const r = (k: string) => c.req.query(k);
  const sort = pick(SORTS, r("sort"), "impressions");
  return {
    type: (r("type") ?? "all").trim().slice(0, 40) || "all",
    status: pick(STATUSES, r("status"), "all"),
    score: pick(SCORES, r("score"), "all"),
    traffic: pick(TRAFFIC, r("traffic"), "all"),
    q: (r("q") ?? "").trim().slice(0, 80),
    sort,
    dir: r("dir") === "asc" ? "asc" : r("dir") === "desc" ? "desc" : sort === "path" || sort === "position" ? "asc" : "desc",
    offset: paged ? int(r("offset"), 0, 0, 100_000) : 0,
    limit: paged ? int(r("limit"), 10, 1, 200) : 100_000,
    open: pathParam(r("open")),
  };
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

/** The site's host without "www.", for matching both spellings Google may report. */
const bareHost = (): string => new URL(siteBase()).host.replace(/^www\./, "");
const reEscape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

interface SearchRead {
  basis: SearchBasis;
  /** The first day of the window Google has any figure on (live), or the window's start. */
  from: string;
  now: Map<string, Fig>;
  before: Map<string, Fig> | null;
  tiles: { clicks: Stat; position: Stat | null; ctr: RateStat };
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

async function searchRead(range: SeoRange): Promise<Reading<SearchRead>> {
  const r = await rankMod();
  const span = r.spanOf(range);
  if (span) {
    const now = merge(r.pageFigures(span.start, span.end));
    const before = span.compared ? merge(r.pageFigures(span.previousStart, span.previousEnd)) : null;
    const t = r.tiles(span);
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
    return ok(
      {
        basis: { by: "history", start: span.start, end: span.end, days: span.days, compared: span.compared && !uncompared, pagesFrom, uncompared, unnamed },
        from: span.historyFrom && span.historyFrom > span.start ? span.historyFrom : span.start,
        now,
        before,
        tiles: { ...shown, clicks: clicksSub(shown.clicks, unnamed) },
      },
      "gsc",
      historyAt(),
      HISTORY_NOTE,
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
      basis: { by: "live", start: w.start, end: w.end, days: w.days, compared, pagesFrom: null, uncompared, unnamed },
      from: t.from,
      now,
      before,
      tiles: { ...shown, clicks: clicksSub(shown.clicks, unnamed) },
    },
    "gsc",
    totals.asOf,
    LIVE_NOTE,
  );
}

/* ---------- Google's index, the engine's counts ---------------------------------------------- */

interface IndexRead {
  day: string;
  complete: boolean;
  of: number | null;
  by: Map<string, gsc.Inspection>;
}

async function indexRead(): Promise<Reading<IndexRead>> {
  const r = await gsc.indexing();
  if (r.state !== "ok") return r;
  const by = new Map(r.value.rows.map((x) => [x.path, x]));
  return { ...r, value: { day: r.value.day, complete: r.value.complete !== false, of: r.value.of ?? null, by } };
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

/* ---------- the rows -------------------------------------------------------------------------- */

const updatedOf = (p: { lastChanged: string | null; firstSeen: string; lastmod: string | null }): string | null =>
  p.lastChanged && p.lastChanged !== p.firstSeen ? p.lastChanged : p.lastmod;

function rowsOf(v: SiteView, search: SearchRead | null, index: IndexRead | null, opps: Map<string, number> | null, ready: Map<string, { pass: number; of: number }>): SeoPageRow[] {
  return v.pages.map((p) => {
    const f = search?.now.get(p.path) ?? { clicks: 0, impressions: 0, position: null };
    const ins = index?.by.get(p.path);
    const ref = pageRef(p.path, v);
    return {
      page: { ...ref, picture: pictureOf(ref.picture) },
      url: p.url,
      status: p.status,
      inSitemap: p.inSitemap,
      index: ins ? { indexed: ins.indexed, coverage: ins.coverage, day: index!.day } : null,
      clicks: f.clicks,
      impressions: f.impressions,
      ctr: rate(f.clicks, f.impressions),
      position: f.position,
      score: p.score,
      issues: { critical: p.issues.critical, warning: p.issues.warning, opportunity: p.issues.opportunity },
      opportunities: opps?.get(p.path) ?? 0,
      readiness: ready.get(p.path) ?? null,
      words: p.words,
      updated: updatedOf(p),
    };
  });
}

const hasIssues = (r: SeoPageRow): boolean => r.issues.critical + r.issues.warning > 0;
const scoreBucket = (s: number | null): string | null => (s === null ? null : s >= 90 ? "90-100" : s >= 70 ? "70-89" : s >= 50 ? "50-69" : "0-49");
const trafficBucket = (i: number): "high" | "medium" | "low" | "none" => (i >= 100 ? "high" : i >= 10 ? "medium" : i >= 1 ? "low" : "none");

const KIND_ORDER = ["home", "service", "landing", "segment", "article", "case", "insights", "standard", "legal"];

function facetsOf(rows: SeoPageRow[], searchOk: boolean): PageFacets {
  const types = new Map<string, { label: string; count: number }>();
  for (const r of rows) {
    const k = r.page.kind ?? "other";
    const t = types.get(k) ?? { label: r.page.kindLabel ?? "Other", count: 0 };
    t.count++;
    types.set(k, t);
  }
  const n = (f: (r: SeoPageRow) => boolean) => rows.filter(f).length;
  return {
    types: [...types]
      .map(([key, t]) => ({ key, label: t.label, count: t.count }))
      .sort((a, b) => (KIND_ORDER.indexOf(a.key) + 1 || 99) - (KIND_ORDER.indexOf(b.key) + 1 || 99)),
    status: [
      { key: "indexed", label: "Indexed", count: n((r) => r.index?.indexed === true) },
      { key: "not-indexed", label: "Not indexed", count: n((r) => r.index?.indexed === false) },
      { key: "issues", label: "Has issues", count: n(hasIssues) },
    ],
    score: (["90-100", "70-89", "50-69", "0-49"] as const).map((k) => ({ key: k, label: k.replace("-", "–"), count: n((r) => scoreBucket(r.score) === k) })),
    traffic: searchOk
      ? [
          { key: "high", label: "High (100+)", count: n((r) => trafficBucket(r.impressions) === "high") },
          { key: "medium", label: "Medium (10–99)", count: n((r) => trafficBucket(r.impressions) === "medium") },
          { key: "low", label: "Low (1–9)", count: n((r) => trafficBucket(r.impressions) === "low") },
          { key: "none", label: "None", count: n((r) => r.impressions === 0) },
        ]
      : [],
  };
}

function filtered(rows: SeoPageRow[], q: PagesQuery, searchOk: boolean): SeoPageRow[] {
  const words = q.q.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (q.type !== "all" && (r.page.kind ?? "other") !== q.type) return false;
    if (q.status === "indexed" && r.index?.indexed !== true) return false;
    if (q.status === "not-indexed" && r.index?.indexed !== false) return false;
    if (q.status === "issues" && !hasIssues(r)) return false;
    if (q.score !== "all" && scoreBucket(r.score) !== q.score) return false;
    if (searchOk && q.traffic !== "all" && trafficBucket(r.impressions) !== q.traffic) return false;
    if (words.length) {
      const hay = `${r.page.path} ${r.page.title ?? ""}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
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
    return b.impressions - a.impressions || b.clicks - a.clicks || a.page.path.localeCompare(b.page.path);
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
    const iv = index.value;
    const n = [...iv.by.values()].filter((x) => x.indexed).length;
    const rec = iv.complete ? recorded("gsc.indexed", days) : null;
    indexed = ok(
      { value: n, previous: rec?.previous ?? null, unit: "count", series: rec?.series ?? [], ...(iv.of !== null ? { of: iv.of } : {}) },
      "gsc",
      index.asOf,
      `Sitemap addresses Google had in its index at the daily URL Inspection of ${iv.day}.${iv.complete ? "" : " That check was cut short, so the count is part of the sitemap, not all of it."}`,
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
    rows = r.queryPageFigures(s.basis.start, s.basis.end, { path }).map((x) => ({ query: x.query, clicks: x.clicks, impressions: x.impressions, ctr: rate(x.clicks, x.impressions), position: x.position ?? 0 }));
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
    const days = r.pageSeries(path, s.basis.start, s.basis.end);
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

async function indexOf(path: string, index: Reading<IndexRead>, live: boolean | null): Promise<Reading<SummaryIndex>> {
  if (index.state !== "ok") return index as Reading<never>;
  const ins = index.value.by.get(path);
  if (!ins) return off("gsc", `Not inspected: the daily index check of ${index.value.day} asks Google about the addresses in the sitemap only, and this one is not listed there.`);
  const m = await indexationMod();
  const said = m.meaningOf(ins.coverage, ins.indexed);
  return ok(
    { day: index.value.day, indexed: ins.indexed, coverage: ins.coverage, lastCrawl: ins.lastCrawl, meaning: said.meaning, fix: said.fix, link: ins.link, liveSaysIndex: live },
    "gsc",
    index.asOf,
    "Google's stored state of the address, from the daily URL Inspection: what Google last saw, not a live test.",
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

function quickActions(path: string, d: PageDetail, idx: Reading<SummaryIndex>): QuickAction[] {
  const answers = d.status === 200;
  const why = answers ? null : `The page answers ${d.status || "nothing"}, so there is nothing on it to change.`;
  const ask = (prompt: string): NewTask => ({ kind: "ask", prompt, path, context: "pages", depth: "deep" });
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
      step: "The operator reads the page and its figures and answers, in plain text, what to add, cut or reword. A person edits the page.",
      task: ask(`How should the content of ${path} change so it answers the searches it is shown for better? Be specific: what to add, cut or reword, section by section. Use only the page and the figures given.`),
      href: null,
      available: answers,
      why,
    },
    {
      key: "links",
      label: "Find internal links",
      step: "The operator names the pages that should link here from their content, with the words of each link. A person adds the links.",
      task: ask(`Which pages of the website should link to ${path} from their own content, and with what words? Name each page and the sentence the link would sit in. Use only the pages given.`),
      href: null,
      available: answers,
      why,
    },
    {
      key: "schema",
      label: "Draft structured data",
      step: "The operator drafts the schema.org markup this page should carry. It goes into the website's code by hand; nothing is applied.",
      task: ask(`Which structured data (schema.org JSON-LD) should ${path} carry, given what the page says? Draft it, and name each field you could not fill from the page.`),
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
      verdict: faqRead?.state === "n/a" ? "Not needed" : "Not read yet",
      rule: faqRead?.state === "n/a" ? faqRead.detail : "Whether the page answers questions is read by the AI-readiness check, which has not read this page yet; no FAQPage markup is on it.",
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

function technicalOf(path: string, d: PageDetail, crawledAt: string): PageTechnical {
  const f = d.facts;
  let canonicalSelf: boolean | null = null;
  if (f?.canonical) {
    try {
      canonicalSelf = pathOf(f.canonical) === path && new URL(f.canonical, `${siteBase()}/`).host.replace(/^www\./, "") === bareHost();
    } catch {
      canonicalSelf = false;
    }
  }
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
    canonicalSelf,
    lang: f?.lang ?? null,
    h1: f?.h1 ?? [],
    h2: f?.h2 ?? 0,
    words: f?.words ?? null,
    schemaTypes: f?.schemaTypes ?? [],
  };
}

async function readinessOf(path: string): Promise<SeoPageSummary["readiness"]> {
  const m = await readinessMod();
  const r = m.readinessOf(path);
  if (!r) {
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
  const idx = await reading("gsc", () => indexOf(path, index, live));
  const [keywords, performance, readiness, opportunities, proposals] = await Promise.all([
    reading("gsc", () => keywordsOf(path, range, search)),
    reading("gsc", () => performanceOf(path, range, search)),
    reading("desk", () => readinessOf(path)),
    reading("desk", () => opportunitiesOf(path, v)),
    proposalsOf(path),
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
      actions: quickActions(path, d, idx),
      performance,
      keywords,
      content,
      serp: serpOf(d),
      links: ok(linksOf(d), "crawl", crawledAt),
      technical: ok(technicalOf(path, d, crawledAt), "crawl", crawledAt, "One fetch by the desk's crawl, from the desk's server: a hint about speed, not a measurement."),
      readiness,
      opportunities,
      proposals,
    },
    "crawl",
    crawledAt,
  );
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
  const [search, index, opps, ready] = await Promise.all([reading("gsc", () => searchRead(range)), reading("gsc", indexRead), oppCounts(), readinessCounts()]);
  const searchOk = search.state === "ok";
  const all = v.at ? rowsOf(v, searchOk ? search.value : null, index.state === "ok" ? index.value : null, opps, ready) : [];
  const matched = sorted(filtered(all, q, searchOk), q);
  const offset = Math.min(q.offset, Math.max(0, matched.length - 1));
  const page = matched.slice(offset, offset + q.limit);

  const list: SeoPagesPayload["list"] = v.at
    ? ok(
        { total: matched.length, offset, limit: q.limit, rows: page },
        "crawl",
        v.at,
        `The desk's crawl, with Search Console's figures${search.state === "ok" ? ` for ${search.value.basis.start} to ${search.value.basis.end}` : " (not available: see the tiles)"} and Google's index state at the last daily URL Inspection.`,
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
              { addresses: out.length, clicks: out.reduce((n, x) => n + x.clicks, 0), impressions: out.reduce((n, x) => n + x.impressions, 0), top: out.slice(0, 8) },
              "gsc",
              search.asOf,
              "Addresses Search Console counted that the crawl does not read: addresses of an earlier site, or another host's spelling.",
            );
          })();

  let selected: SeoPagesPayload["selected"] = null;
  if (withSummary && v.at) {
    const path = q.open ?? page[0]?.page.path ?? null;
    if (path) {
      const row = all.find((r) => r.page.path === path) ?? null;
      selected = await reading("crawl", () => summaryOf(path, row, range, v, search, index));
    }
  }

  return {
    payload: {
      head: head(range),
      tiles: tilesOf(range, v, all, search, index),
      facets: facetsOf(all, searchOk),
      list,
      query: { ...q, offset },
      search: search.state === "ok" ? { ...search, value: search.value.basis } : (search as Reading<never>),
      elsewhere,
      selected,
    },
    matched,
    basis: search.state === "ok" ? search.value.basis : null,
  };
}

routes.get("/", async (c) => c.json<SeoPagesPayload>((await screen(c, true, true)).payload));

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
  const w = s.basis ? `${s.basis.start} to ${s.basis.end}` : "not available";
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
        s.basis ? r.clicks : "",
        s.basis ? r.impressions : "",
        s.basis && r.ctr.value !== null ? r.ctr.value : "",
        s.basis ? (r.position ?? "") : "",
        r.score,
        r.issues.critical,
        r.issues.warning,
        r.issues.opportunity,
        r.opportunities,
        r.readiness ? `${r.readiness.pass} of ${r.readiness.of}` : "",
        r.words,
        r.updated ? r.updated.slice(0, 10) : "",
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

/* Exported for the check script: the pure parts, fed artificial rows. */
export const _test = { filtered, sorted, facetsOf, merge, pathParam, scoreBucket, trafficBucket };
