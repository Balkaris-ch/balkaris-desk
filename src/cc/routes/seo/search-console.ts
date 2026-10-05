import { Hono, type Context } from "hono";
import { db } from "../../../db.ts";
import type { Vars } from "../../access.ts";
import { status as jobStatus } from "../../scheduler.ts";
import { countryName } from "../../search/countries.ts";
import * as gsc from "../../search/gsc.ts";
import { eachDay, pathOf, round, siteBase } from "../../search/shared.ts";
import { lastSitemap } from "../../site/index.ts";
import { ok, reading, waiting } from "../../store.ts";
import { scrub } from "../../system.ts";
import type { EarlySignals, Reading } from "../../../../web/src/contract/common.ts";
import type { SeoRange, SeoSpan } from "../../../../web/src/contract/seo/common.ts";
import type {
  ExplorerDimension,
  ExplorerOptions,
  ExplorerQuery,
  ExplorerResult,
  ExplorerRow,
  InspectionQuery,
  InspectionRow,
  InspectionTable,
  InspectJob,
  PageStanding,
  SeoSearchConsolePayload,
  SitemapRow,
} from "../../../../web/src/contract/seo/search-console.ts";
import { covered, historyFacts, lastSnapDay, pageFigures, queryFigures, rate, spanBetween, spanOf, spanWithin, type Country } from "../../seo/rank.ts";
import type { SiteView } from "../../seo/site.ts";
import { head, HISTORY_NOTE, historyAbsent, historyAt, int, rangeFrom, view } from "./shared.ts";

/**
 * /api/v1/seo/search-console — SEO › Search Console (board 113, panel 8): an
 * explorer over Google's own search figures.
 *
 *   GET /             the whole screen (contract/seo/search-console.ts)
 *   GET /export.csv   the explorer's rows as CSV, every row, with the same filters
 *
 * WHERE THE FIGURES COME FROM. The desk's own daily snapshots of Search
 * Console (src/cc/seo/rank.ts: four tables, every country and Switzerland
 * alone, kept beyond Google's sixteen months) answer queries, pages, devices
 * and dates, with every filter the snapshots can answer: query words, one
 * page, one device, all countries or Switzerland. What they do not hold is
 * asked of Search Console live (src/cc/search/gsc.ts `query`, each question
 * kept six hours): countries and search appearance as a dimension, any other
 * country, and ?source=live. The result says which it was.
 *
 * WHICH SNAPSHOT TABLE. Google's figure per query (cc_seo_rank_queries) for
 * the query list; per page with the withheld queries' impressions
 * (cc_seo_rank_pages) for the page list; the property's totals
 * (cc_seo_rank_days) for devices, dates and the tiles. A filter on query words
 * or on one page can only be answered from the rows that carry both
 * (cc_seo_rank), as Search Console answers it: then the figures are the
 * matched queries' only, and the note says so.
 *
 * NO INVENTED FIGURE. Nothing here estimates. A position is Google's average,
 * weighted by impressions. A rate carries its counts (small under 30). The
 * window before is compared only when the desk's history covers it from its
 * first day; a query Google reported nothing for in the window before is not
 * called new (rare queries are withheld), so its `previous` is null, and a
 * view narrowed by query words is not compared with a window in which Google
 * reported none of them. A day nobody has counted yet is not a zero: a window
 * that runs past the newest finished day ends there, and says so.
 *
 * Nothing here changes anything.
 */
export const routes = new Hono<Vars>();

/* ---------- the question ------------------------------------------------------------------- */

const DIMENSIONS: ExplorerDimension[] = ["query", "page", "country", "device", "date", "searchAppearance"];
const SORTS: ExplorerQuery["sort"][] = ["clicks", "impressions", "ctr", "position", "key"];
const DEVICES = ["DESKTOP", "MOBILE", "TABLET"] as const;
const DEVICE_LABEL: Record<string, string> = { DESKTOP: "Desktop", MOBILE: "Mobile", TABLET: "Tablet" };
/** The countries the snapshots keep. Any other is asked live. */
const SNAPSHOT_COUNTRIES = new Set<string>(["all", "che"]);
/** Rows Search Console is asked for in a live answer, and the most an export carries. */
const LIVE_ROWS = 5000;
const INSPECTION_ROWS = 15;
const INSPECTION_SORTS: InspectionQuery["sort"][] = ["queue", "address", "crawl"];

const pick = <T extends string>(list: readonly T[], raw: string | undefined, fallback: T): T => (list.includes(raw as T) ? (raw as T) : fallback);
const isDay = (s: string | undefined): s is string => !!s && /^\d{4}-\d\d-\d\d$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

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

/**
 * What the search box asks of a query, as Search Console's own filter offers
 * it: plain words it must contain (every one), words with a minus in front it
 * must not contain ("-balkaris": everything but the brand), or, the whole box
 * in double quotes, that exact query. Lower case, six words at most.
 */
interface Terms {
  words: string[];
  not: string[];
  exact: string | null;
}

function termsOf(q: string): Terms {
  const s = q.trim().toLowerCase();
  const whole = /^"([^"]+)"$/.exec(s);
  if (whole && whole[1]!.trim()) return { words: [], not: [], exact: whole[1]!.trim() };
  const parts = s.replace(/"/g, " ").split(" ").filter(Boolean).slice(0, 6);
  return { words: parts.filter((p) => !p.startsWith("-")), not: parts.filter((p) => p.startsWith("-") && p.length > 1).map((p) => p.slice(1)), exact: null };
}

const narrows = (t: Terms): boolean => t.words.length > 0 || t.not.length > 0 || t.exact !== null;

/** The terms in words, for a note: queries containing “a b”, without “c”. */
function said(t: Terms): string {
  if (t.exact !== null) return `the query “${t.exact}”`;
  return [t.words.length ? `queries containing “${t.words.join(" ")}”` : "queries", t.not.length ? `without ${t.not.map((w) => `“${w}”`).join(" or ")}` : ""].filter(Boolean).join(" ");
}

/**
 * Why a question must be read live, in one sentence, or null when the
 * snapshots answer it.
 *
 * PAGES. The snapshots keep pages per device (date, page, device), and Search
 * Console leaves the impressions of withheld queries out of every answer that
 * splits pages by device: measured on 2 October 2026, the same thirty days
 * grouped by page and device came to well under half the impressions of the
 * same days grouped by page alone. So a
 * page list or a page filter (without query words, which drop the withheld
 * queries anyway) is read live, where Google groups by page alone.
 */
function liveWhy(a: Pick<ExplorerQuery, "dimension" | "country" | "q" | "page">): string | null {
  if (a.dimension === "country") return "Countries are read live from Search Console: the desk's daily copy keeps every country together and Switzerland alone.";
  if (a.dimension === "searchAppearance") return "Search appearance is read live from Search Console: the desk's daily copy does not keep it.";
  if (!SNAPSHOT_COUNTRIES.has(a.country)) return `${countryName(a.country)} is read live from Search Console: the desk's daily copy keeps every country together and Switzerland alone.`;
  if ((a.dimension === "page" || a.page !== null) && !narrows(termsOf(a.q)))
    return "Pages are read live from Search Console: the desk's daily copy keeps pages per device, and Google leaves the impressions of withheld queries out of any answer that splits pages by device, so the copy's page figures are short.";
  return null;
}

/** The order a sort starts in: figures from the most, the position and a name from the least, dates from the newest. */
const firstDir = (sort: ExplorerQuery["sort"], dimension: ExplorerDimension): "asc" | "desc" =>
  sort === "position" ? "asc" : sort === "key" ? (dimension === "date" ? "desc" : "asc") : "desc";

/**
 * The offset a list of `total` rows is really read from. An offset past the
 * end (a shorter period chosen on page three, a filter set from another page)
 * is brought back to the last page, so the table and its pager never
 * contradict each other.
 */
const within = (offset: number, total: number, limit: number): number => (total <= 0 ? 0 : offset < total ? offset : Math.floor((total - 1) / limit) * limit);

/** The window a question is answered for, and what became of the dates asked. */
interface WindowAsked {
  span: SeoSpan | null;
  /** The end that was asked for, when the window was cut to the days that are counted. */
  askedEnd: string | null;
  /** Set when no day of the dates asked can be answered yet: the explorer says this instead. */
  absent: Reading<ExplorerResult> | null;
}

/**
 * A window by its dates is cut to the days somebody has counted: the desk's
 * snapshots end on the newest day Google has FINISHED (two to three days
 * back), and a live read can go no further either. Days past that are not
 * zeros, so they are left out, the window before is made as long as what is
 * left, and the result says the window was cut.
 */
async function windowOf(range: SeoRange, dates: { start: string; end: string } | null, source: ExplorerQuery["source"]): Promise<WindowAsked> {
  if (!dates) return { span: spanOf(range), askedEnd: null, absent: null };
  let last = lastSnapDay();
  if (source === "live") {
    const final = await gsc.newestFinalDay();
    if (final.state === "ok" && (!last || final.value > last)) last = final.value;
    /* Nothing kept and Google not saying which day it has finished: ask for the dates as they are; the answer carries what Google has. */
    if (!last) return { span: spanBetween(dates.start, dates.end), askedEnd: null, absent: null };
  }
  if (!last) return { span: null, askedEnd: null, absent: null };
  const span = spanWithin(dates.start, dates.end, last);
  if (!span) {
    const asked = dates.start === dates.end ? dates.start : `${dates.start} to ${dates.end}`;
    return { span: null, askedEnd: null, absent: waiting("gsc", `Google has not finished counting ${asked} yet: it finishes a day two to three days later, and the newest finished day is ${last}. Choose a window that begins on or before it.`) };
  }
  return { span, askedEnd: span.askedEnd > span.end ? span.askedEnd : null, absent: null };
}

/** The explorer's question, from the address. `paged` false: every row (the export). */
async function askedOf(c: Context<Vars>, paged: boolean): Promise<{ asked: ExplorerQuery; range: SeoRange; window: WindowAsked }> {
  const r = (k: string) => c.req.query(k);
  const range = rangeFrom(c);
  const dimension = pick(DIMENSIONS, r("dimension"), "query");
  const sort = pick(SORTS, r("sort"), dimension === "date" ? "key" : "clicks");
  const rawCountry = (r("country") ?? "all").trim().toLowerCase();
  const country = rawCountry === "all" || /^[a-z]{3}$/.test(rawCountry) ? rawCountry : "all";
  const rawDevice = (r("device") ?? "all").trim().toUpperCase();
  const device = (DEVICES as readonly string[]).includes(rawDevice) ? rawDevice : "all";
  const q = (r("q") ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  const page = pathParam(r("page"));
  const source: ExplorerQuery["source"] = liveWhy({ dimension, country, q, page }) || r("source") === "live" ? "live" : "snapshots";

  /* A window by its dates when both are given and make sense; else the period's. */
  const start = r("start");
  const end = r("end");
  const dates = isDay(start) && isDay(end) && start <= end && eachDay(start, end).length <= 485 ? { start, end } : null;
  const window = await windowOf(range, dates, source);

  const asked: ExplorerQuery = {
    dimension,
    start: window.span?.start ?? "",
    end: window.span?.end ?? "",
    window: dates,
    country,
    device,
    q,
    page,
    sort,
    dir: r("dir") === "asc" ? "asc" : r("dir") === "desc" ? "desc" : firstDir(sort, dimension),
    offset: paged ? int(r("offset"), 0, 0, 100_000) : 0,
    limit: paged ? int(r("limit"), 25, 1, 500) : 100_000,
    source,
  };
  return { asked, range, window };
}

/* ---------- figures ------------------------------------------------------------------------- */

/** Clicks, impressions and the sum of position × impressions: what adds up. */
interface Sum {
  c: number;
  i: number;
  w: number;
}

const add = (into: Sum, r: Sum): void => {
  into.c += r.c;
  into.i += r.i;
  into.w += r.w;
};
const positionOf = (s: Sum): number | null => (s.i ? round(s.w / s.i, 1) : null);
const figuresOf = (s: Sum) => ({ clicks: s.c, impressions: s.i, ctr: rate(s.c, s.i), position: positionOf(s) });

/** What one snapshot read is narrowed by. */
interface Narrow {
  country: Country;
  device: string;
  /** What the query must contain, must not contain, or be. */
  terms: Terms;
  page: string | null;
}

type Group = "query" | "page" | "device" | "day" | "none";

/**
 * The snapshot table a read is answered from: the one that carries every
 * column the grouping and the filters need, and no more (see the head).
 */
function tableOf(group: Group, n: Narrow): string {
  const query = group === "query" || narrows(n.terms);
  const page = group === "page" || n.page !== null;
  if (query && page) return "cc_seo_rank";
  if (query) return "cc_seo_rank_queries";
  if (page) return "cc_seo_rank_pages";
  return "cc_seo_rank_days";
}

/** The WHERE of a snapshot read: country, window, device, and the query terms. */
function whereOf(n: Narrow, start: string, end: string): { where: string[]; args: string[] } {
  const where: string[] = ["country = ?", "day >= ?", "day <= ?"];
  const args: string[] = [n.country, start, end];
  if (n.device !== "all") {
    where.push("device = ?");
    args.push(n.device);
  }
  for (const w of n.terms.words) {
    where.push("instr(lower(query), ?) > 0");
    args.push(w);
  }
  for (const w of n.terms.not) {
    where.push("instr(lower(query), ?) = 0");
    args.push(w);
  }
  if (n.terms.exact !== null) {
    where.push("lower(query) = ?");
    args.push(n.terms.exact);
  }
  return { where, args };
}

/**
 * One snapshot read: the window's rows grouped by `group`, summed. A page is
 * matched by its path (the apex, www and a trailing slash are one page), so
 * the page column is read and compared here rather than in SQL.
 */
function sums(group: Group, n: Narrow, start: string, end: string): Map<string, Sum> {
  const table = tableOf(group, n);
  const key = group === "none" ? "''" : group;
  const withPage = n.page !== null && group !== "page";
  const { where, args } = whereOf(n, start, end);
  const rows = db
    .prepare(
      `SELECT ${key} AS k${withPage ? ", page AS p" : ""}, SUM(clicks) AS c, SUM(impressions) AS i, SUM(position * impressions) AS w FROM ${table} WHERE ${where.join(" AND ")} GROUP BY ${key}${withPage ? ", page" : ""}`,
    )
    .all(...args) as { k: string; p?: string; c: number; i: number; w: number }[];
  const out = new Map<string, Sum>();
  for (const r of rows) {
    if (withPage && pathOf(String(r.p ?? "")) !== n.page) continue;
    const k = group === "page" ? pathOf(String(r.k)) : String(r.k);
    if (group === "page" && n.page !== null && k !== n.page) continue;
    const s = out.get(k) ?? { c: 0, i: 0, w: 0 };
    add(s, { c: Number(r.c ?? 0), i: Number(r.i ?? 0), w: Number(r.w ?? 0) });
    out.set(k, s);
  }
  return out;
}

const total = (m: Map<string, Sum>): Sum => {
  const s = { c: 0, i: 0, w: 0 };
  for (const v of m.values()) add(s, v);
  return s;
};

/** Beside each query the page Google showed most for it, or beside each page the query it showed it most for. From the rows that carry both. */
function tops(dimension: "query" | "page", n: Narrow, start: string, end: string): Map<string, string> {
  const { where, args } = whereOf(n, start, end);
  const rows = db
    .prepare(`SELECT query, page, SUM(impressions) AS i, SUM(clicks) AS c FROM cc_seo_rank WHERE ${where.join(" AND ")} GROUP BY query, page`)
    .all(...args) as { query: string; page: string; i: number; c: number }[];
  const merged = new Map<string, { own: string; other: string; i: number; c: number }>();
  for (const r of rows) {
    const path = pathOf(r.page);
    if (n.page !== null && path !== n.page) continue;
    const own = dimension === "query" ? r.query : path;
    const other = dimension === "query" ? path : r.query;
    const k = `${own}\u0000${other}`;
    const m = merged.get(k) ?? { own, other, i: 0, c: 0 };
    m.i += Number(r.i ?? 0);
    m.c += Number(r.c ?? 0);
    merged.set(k, m);
  }
  const best = new Map<string, { other: string; i: number; c: number }>();
  for (const m of merged.values()) {
    const had = best.get(m.own);
    if (!had || m.i > had.i || (m.i === had.i && m.c > had.c)) best.set(m.own, { other: m.other, i: m.i, c: m.c });
  }
  return new Map([...best.entries()].map(([k, v]) => [k, v.other]));
}

const humanAppearance = (s: string): string => {
  const t = s.replace(/_/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function labelOf(dimension: ExplorerDimension, key: string): string {
  switch (dimension) {
    case "device":
      return DEVICE_LABEL[key.toUpperCase()] ?? key;
    case "country":
      return countryName(key);
    case "searchAppearance":
      return humanAppearance(key);
    default:
      return key;
  }
}

/** Sort and page the rows as asked: ties by impressions, then clicks, then name. */
function ordered(rows: ExplorerRow[], a: ExplorerQuery): ExplorerRow[] {
  const sign = a.dir === "asc" ? 1 : -1;
  const value = (r: ExplorerRow): number | string | null =>
    a.sort === "key" ? r.key : a.sort === "clicks" ? r.clicks : a.sort === "impressions" ? r.impressions : a.sort === "ctr" ? r.ctr.value : r.position;
  return [...rows].sort((x, y) => {
    const vx = value(x);
    const vy = value(y);
    if (vx === null && vy !== null) return 1;
    if (vy === null && vx !== null) return -1;
    if (vx !== null && vy !== null && vx !== vy) return (vx < vy ? -1 : 1) * sign;
    return y.impressions - x.impressions || y.clicks - x.clicks || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
  });
}

/** The window's days as the chart draws them: every day the history covers, a day with no row a real zero. */
function dayLine(by: Map<string, Sum>, start: string, end: string): ExplorerResult["days"] {
  const days = covered(start, end);
  return days.map((date) => {
    const s = by.get(date) ?? { c: 0, i: 0, w: 0 };
    return { date, clicks: s.c, impressions: s.i, position: positionOf(s) };
  });
}

const EARLY_AFTER = (standard: number): string =>
  `A position or a rate measured on 1 to ${standard - 1} impressions moves a lot from day to day; rows under that carry “early”, and the mark goes by itself once enough data exists.`;

/** The early signals of the window (the rule is gsc.ts EARLY), from Google's figure per query. */
function earlyOf(queries: readonly { impressions: number }[]): EarlySignals | null {
  return gsc.earlySignals({ own: queries, all: queries }, gsc.FLOOR.opportunities, EARLY_AFTER(gsc.FLOOR.opportunities));
}

/** What a window cut short says of itself. */
const cutNote = (askedEnd: string | null, end: string): string =>
  askedEnd ? `The window asked for ran to ${askedEnd}; ${end} is the newest day Google has finished counting, so the days after it are left out rather than counted as zeros.` : "";

/** Why a view narrowed by query words is not compared with a window in which none of them was reported. */
const WITHHELD_BEFORE = (start: string, end: string): string =>
  `Not compared: Google reported none of these queries from ${start} to ${end}. It withholds rare queries, so that is not a zero.`;

/* ---------- the explorer, from the desk's snapshots ----------------------------------------- */

function fromSnapshots(a: ExplorerQuery, span: SeoSpan, askedEnd: string | null): Reading<ExplorerResult> {
  const terms = termsOf(a.q);
  const n: Narrow = { country: a.country as Country, device: a.device, terms, page: a.page };
  const byQuery = narrows(terms);
  const group: Group = a.dimension === "date" ? "day" : (a.dimension as Group);

  const byDay = sums("day", n, span.start, span.end);
  const now = total(byDay);
  const beforeSums = span.compared ? sums("none", n, span.previousStart, span.previousEnd) : null;
  /* Narrowed by query words, the window before holds only the queries Google reported then. None
     reported is not a zero (rare queries are withheld): the table already refuses to call such a
     query new, and the totals must not print a rise from nothing either. */
  const withheldBefore = byQuery && beforeSums !== null && beforeSums.size === 0;
  const compared = span.compared && !withheldBefore;
  const before = compared && beforeSums ? total(beforeSums) : null;

  const rowsNow = a.dimension === "date" ? byDay : sums(group, n, span.start, span.end);
  /* A day has no window before: the chart is where days are compared. */
  const rowsBefore = compared && a.dimension !== "date" ? sums(group, n, span.previousStart, span.previousEnd) : null;
  const top = a.dimension === "query" && a.page === null ? tops("query", n, span.start, span.end) : a.dimension === "page" ? tops("page", n, span.start, span.end) : null;

  /* The early rule reads Google's figure per query for the window, under the country and device asked. */
  const early = earlyOf(queryFigures(span.start, span.end, { country: n.country, device: n.device === "all" ? null : n.device }));

  let rows: ExplorerRow[] = [...rowsNow.entries()]
    .filter(([, s]) => s.i > 0 || s.c > 0)
    .map(([key, s]) => {
      const had = rowsBefore?.get(key);
      /* A query Google reported nothing for before may have been withheld as rare: not compared. A page or device with no row was not shown. */
      const previous = !rowsBefore ? null : had ? { clicks: had.c, impressions: had.i, position: positionOf(had) } : a.dimension === "query" || byQuery ? null : { clicks: 0, impressions: 0, position: null };
      return { key, label: labelOf(a.dimension, key), ...figuresOf(s), previous, early: !!early && s.i < early.standard, top: top?.get(key) ?? null };
    });
  rows = ordered(rows, a);
  const offset = within(a.offset, rows.length, a.limit);

  const notes = [HISTORY_NOTE];
  if (a.country === "che") notes.push("Searches made in Switzerland only.");
  if (a.device !== "all") notes.push(`${DEVICE_LABEL[a.device] ?? a.device} only.`);
  if (byQuery || a.page) notes.push(`Narrowed to ${[byQuery ? said(terms) : "", a.page ? `the page ${a.page}` : ""].filter(Boolean).join(" on ")}: the figures are those of the queries Google reports, so they are lower than the totals with no filter.`);
  else if (a.dimension === "query") notes.push("Query rows do not add up to the totals: Google withholds rare queries.");
  if (span.historyFrom && span.historyFrom > span.start) notes.push(`The history covers this window from ${span.historyFrom}: Google's figures for the property begin then.`);
  if (askedEnd) notes.push(cutNote(askedEnd, span.end));
  if (!span.compared) notes.push(span.historyFrom ? `Not compared: the history begins ${span.historyFrom}, after the window before began.` : "Not compared: there is no history before this window.");
  else if (withheldBefore) notes.push(WITHHELD_BEFORE(span.previousStart, span.previousEnd));

  return ok(
    {
      source: "snapshots",
      start: span.start,
      end: span.end,
      askedEnd,
      previous: compared ? { start: span.previousStart, end: span.previousEnd } : null,
      totals: figuresOf(now),
      previousTotals: before ? figuresOf(before) : null,
      days: dayLine(byDay, span.start, span.end),
      total: rows.length,
      offset,
      rows: rows.slice(offset, offset + a.limit),
      complete: true,
      note: notes.join(" "),
      early,
      topLabel: a.dimension === "query" && a.page === null ? "Top page" : a.dimension === "page" ? "Top query" : null,
    },
    "gsc",
    historyAt(),
    HISTORY_NOTE,
  );
}

/* ---------- the explorer, from Search Console live ------------------------------------------ */

const reEscape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Search Console's filters for what was asked: the query terms, one page under either host spelling, a country, a device. */
function liveFilters(a: ExplorerQuery): gsc.Filter[] {
  const out: gsc.Filter[] = [];
  const t = termsOf(a.q);
  for (const w of t.words) out.push({ dimension: "query", operator: "contains", expression: w });
  for (const w of t.not) out.push({ dimension: "query", operator: "notContains", expression: w });
  if (t.exact !== null) out.push({ dimension: "query", operator: "equals", expression: t.exact });
  if (a.page) {
    const host = reEscape(new URL(siteBase()).host.replace(/^www\./, ""));
    const tail = a.page === "/" ? "/?" : `${reEscape(a.page)}/?`;
    out.push({ dimension: "page", operator: "includingRegex", expression: `^https?://(www\\.)?${host}${tail}$` });
  }
  if (a.country !== "all") out.push({ dimension: "country", operator: "equals", expression: a.country });
  if (a.device !== "all") out.push({ dimension: "device", operator: "equals", expression: a.device });
  return out;
}

type LiveRow = { keys: string[]; clicks: number; impressions: number; position: number };
const liveSum = (r: LiveRow): Sum => ({ c: r.clicks, i: r.impressions, w: r.position * r.impressions });

/** A live answer's rows as sums by their first key; pages by their path. */
function liveSums(rows: LiveRow[], dimension: ExplorerDimension | "none"): Map<string, Sum> {
  const out = new Map<string, Sum>();
  for (const r of rows) {
    const raw = r.keys[0] ?? "";
    const k = dimension === "page" ? pathOf(raw) : dimension === "device" ? raw.toUpperCase() : dimension === "country" ? raw.toLowerCase() : dimension === "none" ? "" : raw;
    const s = out.get(k) ?? { c: 0, i: 0, w: 0 };
    add(s, liveSum(r));
    out.set(k, s);
  }
  return out;
}

const DIM: Record<ExplorerDimension, gsc.Dimension> = { query: "query", page: "page", country: "country", device: "device", date: "date", searchAppearance: "searchAppearance" };

type When = { startDate: string; endDate: string } | { range: SeoRange };

/**
 * One live question, worded one way wherever it is asked: Search Console's
 * answers are kept under their wording, so the page list the filter offers and
 * the page list the table draws are one request, not two.
 */
const liveAsk = (w: When, dimensions: gsc.Dimension[], filters: gsc.Filter[], limit: number) => gsc.query({ ...w, dimensions, filters, rowLimit: limit, dataState: "final" });

/**
 * The days a live answer covers, for the chart AND the totals: every day from
 * the window's start (or the first day Google has anything for the property,
 * when that is later) to its end, a day Google returned no row for a real
 * zero. The totals are summed over the same answer, so the four figures, the
 * chart and the Dates table always stand on the same days.
 */
function liveDays(by: Map<string, Sum>, start: string, end: string, historyFrom: string | null): ExplorerResult["days"] {
  const first = historyFrom && historyFrom > start && historyFrom <= end ? historyFrom : start;
  return eachDay(first, end).map((date) => {
    const s = by.get(date) ?? { c: 0, i: 0, w: 0 };
    return { date, clicks: s.c, impressions: s.i, position: positionOf(s) };
  });
}

async function fromLive(a: ExplorerQuery, range: SeoRange, span: SeoSpan | null, askedEnd: string | null, rowLimit: number): Promise<Reading<ExplorerResult>> {
  const filters = liveFilters(a);
  const byQuery = narrows(termsOf(a.q));
  /* Without a snapshot yet, the window is Search Console's own for the period, and nothing is compared. */
  const when: When = span ? { startDate: span.start, endDate: span.end } : { range };
  const ask = (dimensions: gsc.Dimension[], w: When, limit: number) => liveAsk(w, dimensions, filters, limit);
  const before: When | null = span && span.compared ? { startDate: span.previousStart, endDate: span.previousEnd } : null;

  const [rowsNow, daysNow, rowsBefore, totalBefore, queriesNow] = await Promise.all([
    ask([DIM[a.dimension]], when, rowLimit),
    a.dimension === "date" ? null : ask(["date"], when, 1000),
    before && a.dimension !== "date" ? ask([DIM[a.dimension]], before, rowLimit) : null,
    before ? ask([], before, 1) : null,
    a.dimension === "query" ? null : ask(["query"], when, LIVE_ROWS),
  ]);
  if (rowsNow.state !== "ok") return rowsNow;
  const dayAnswer = daysNow ?? rowsNow;
  if (dayAnswer.state !== "ok") return dayAnswer;
  const start = rowsNow.value.startDate;
  const end = rowsNow.value.endDate;

  const byDay = liveSums(dayAnswer.value.rows, "date");
  const now = total(byDay);
  const beforeRead = totalBefore && totalBefore.state === "ok" ? totalBefore.value.rows : null;
  /* As in the snapshots: with query words, a window before in which Google reported none of them is not a zero. */
  const withheldBefore = byQuery && beforeRead !== null && beforeRead.length === 0;
  const beforeTotal = beforeRead && !withheldBefore ? total(liveSums(beforeRead, "none")) : null;
  const prevRows = !withheldBefore && rowsBefore && rowsBefore.state === "ok" ? liveSums(rowsBefore.value.rows, a.dimension) : null;
  const queryRows = a.dimension === "query" ? rowsNow : queriesNow;
  const early = queryRows && queryRows.state === "ok" ? earlyOf(queryRows.value.rows) : null;

  /* The top column needs the rows that carry both a query and a page: only the snapshots have them, for the countries they keep. */
  const n: Narrow = { country: (SNAPSHOT_COUNTRIES.has(a.country) ? a.country : "all") as Country, device: a.device, terms: termsOf(a.q), page: a.page };
  const topFor = span && SNAPSHOT_COUNTRIES.has(a.country) ? (a.dimension === "query" && a.page === null ? "query" : a.dimension === "page" ? "page" : null) : null;
  const top = topFor && span ? tops(topFor, n, start, end) : null;

  let rows: ExplorerRow[] = [...liveSums(rowsNow.value.rows, a.dimension).entries()].map(([key, s]) => {
    const had = prevRows?.get(key);
    const previous = !prevRows || a.dimension === "date" ? null : had ? { clicks: had.c, impressions: had.i, position: positionOf(had) } : a.dimension === "query" || byQuery ? null : { clicks: 0, impressions: 0, position: null };
    return { key, label: labelOf(a.dimension, key), ...figuresOf(s), previous, early: !!early && s.i < early.standard, top: top?.get(key) ?? null };
  });
  rows = ordered(rows, a);
  const offset = within(a.offset, rows.length, a.limit);

  const notes = [rowsNow.note ?? "", liveWhy(a) ?? "Read live from Search Console, as asked.", "Each answer is kept six hours."];
  if (a.country === "che") notes.push("Searches made in Switzerland only.");
  if (a.device !== "all") notes.push(`${DEVICE_LABEL[a.device] ?? a.device} only.`);
  if (a.dimension === "searchAppearance") notes.push("Only results Google shows in a special form (rich results, videos, FAQ and the like) have a search appearance; plain results are in none of these rows.");
  if (a.dimension === "country") notes.push("The country is the searcher's, as Google reads it.");
  if (byQuery) notes.push("Narrowed by query words: the figures are those of the queries Google reports.");
  else if (a.dimension === "query") notes.push("Query rows do not add up to the totals: Google withholds rare queries.");
  const pages = a.dimension === "page" || a.page !== null;
  const split = a.dimension === "device" || a.dimension === "country" || a.device !== "all" || a.country !== "all";
  if (pages && split && !byQuery) notes.push("Google leaves the impressions of withheld queries out when pages are combined with a device or a country, so these page figures can be lower than the same page's figures without that filter.");
  if (askedEnd) notes.push(cutNote(askedEnd, end));
  if (!before) notes.push(span?.historyFrom ? `Not compared: the history begins ${span.historyFrom}, after the window before began.` : "Not compared: the desk has no history of its own yet.");
  else if (withheldBefore) notes.push(WITHHELD_BEFORE(span!.previousStart, span!.previousEnd));
  else if (beforeTotal === null) notes.push("The window before could not be read, so nothing is compared.");
  else if (prevRows === null && a.dimension !== "date") notes.push("The window before could not be read row by row, so no row is compared.");

  return ok(
    {
      source: "live",
      start,
      end,
      askedEnd,
      previous: before && beforeTotal ? { start: span!.previousStart, end: span!.previousEnd } : null,
      totals: figuresOf(now),
      previousTotals: beforeTotal ? figuresOf(beforeTotal) : null,
      days: liveDays(byDay, start, end, span?.historyFrom ?? null),
      total: rows.length,
      offset,
      rows: rows.slice(offset, offset + a.limit),
      complete: rowsNow.value.complete,
      note: notes.filter(Boolean).join(" "),
      early,
      topLabel: topFor === "query" ? "Top page" : topFor === "page" ? "Top query" : null,
    },
    "gsc",
    rowsNow.asOf,
    "Read live from Search Console.",
  );
}

async function explore(a: ExplorerQuery, range: SeoRange, w: WindowAsked, rowLimit: number): Promise<Reading<ExplorerResult>> {
  if (w.absent) return w.absent;
  if (a.source === "live") return reading("gsc", () => fromLive(a, range, w.span, w.askedEnd, rowLimit));
  const span = w.span;
  if (!span) return historyAbsent();
  return reading("gsc", () => fromSnapshots(a, span, w.askedEnd));
}

/* ---------- what the filters offer ---------------------------------------------------------- */

/** The word that makes a query a brand query: the website's own name, from its address ("balkaris" of www.balkaris.ch). */
const brandWord = (): string => new URL(siteBase()).hostname.replace(/^www\./, "").split(".")[0]!.toLowerCase();

async function optionsOf(range: SeoRange, span: SeoSpan | null, asked: ExplorerQuery): Promise<ExplorerOptions> {
  /*
   * The pages Google showed in the window: its own page list (grouped by page
   * alone, so whole), then any page only the snapshots name. Most impressions
   * first. For a period that is the kept answer the scheduled refresh writes;
   * for a window given by its dates it is asked for those dates (the same
   * question the Pages table asks, so it is kept once).
   */
  const byDates: When | null = asked.window && span ? { startDate: span.start, endDate: span.end } : null;
  const byPath = new Map<string, number>();
  if (byDates) {
    const listed = await reading("gsc", () => liveAsk(byDates, ["page"], [], LIVE_ROWS));
    if (listed.state === "ok") for (const p of listed.value.rows) if (p.impressions > 0) byPath.set(pathOf(p.keys[0] ?? ""), (byPath.get(pathOf(p.keys[0] ?? "")) ?? 0) + p.impressions);
  } else {
    const listed = await reading("gsc", () => gsc.pages(range));
    if (listed.state === "ok") for (const p of listed.value.rows) if (p.impressions > 0) byPath.set(p.path, (byPath.get(p.path) ?? 0) + p.impressions);
  }
  if (span) for (const p of pageFigures(span.start, span.end, { country: "all" })) if (p.impressions > 0 && !byPath.has(p.path)) byPath.set(p.path, p.impressions);
  const pages = [...byPath.entries()].map(([path, impressions]) => ({ path, impressions })).sort((a, b) => b.impressions - a.impressions || (a.path < b.path ? -1 : 1));
  if (asked.page && !pages.some((p) => p.path === asked.page)) pages.push({ path: asked.page, impressions: 0 });

  const snap = (key: Country): number | null => (span ? Number((db.prepare("SELECT SUM(impressions) AS i FROM cc_seo_rank_days WHERE country = ? AND day >= ? AND day <= ?").get(key, span.start, span.end) as { i: number | null }).i ?? 0) : null);
  const countries: ExplorerOptions["countries"] = [
    { key: "all", label: "All countries", impressions: snap("all"), live: false },
    { key: "che", label: countryName("che"), impressions: snap("che"), live: false },
  ];
  /* The other countries Google reported for the window: for a period the kept answer the scheduled refresh writes, for dates the Countries table's own question. */
  const others: { key: string; label: string; impressions: number }[] = [];
  if (byDates) {
    const listed = await reading("gsc", () => liveAsk(byDates, ["country"], [], LIVE_ROWS));
    if (listed.state === "ok") for (const r of listed.value.rows) others.push({ key: (r.keys[0] ?? "").toLowerCase(), label: countryName((r.keys[0] ?? "").toLowerCase()), impressions: r.impressions });
  } else {
    const listed = await reading("gsc", () => gsc.byCountry(range));
    if (listed.state === "ok") for (const r of listed.value.rows) others.push({ key: r.key.toLowerCase(), label: r.label, impressions: r.impressions });
  }
  countries.push(
    ...others
      .filter((r) => r.key && !SNAPSHOT_COUNTRIES.has(r.key) && r.impressions > 0)
      .sort((a, b) => b.impressions - a.impressions || a.label.localeCompare(b.label))
      .map((r) => ({ ...r, live: true })),
  );
  if (!countries.some((c) => c.key === asked.country)) countries.push({ key: asked.country, label: countryName(asked.country), impressions: null, live: true });
  return { pages, countries, brand: brandWord(), days: daysOffered() };
}

/** The days a window can be chosen from: the desk's history, first to last. */
function daysOffered(): ExplorerOptions["days"] {
  const h = historyFacts();
  return h ? { from: h.from, to: h.to } : null;
}

/* ---------- pages Google shows, against the website ----------------------------------------- */

/**
 * What the website has at an address Google shows, from the desk's own crawl
 * (nothing is fetched here), and whether the newest URL Inspection has it in
 * the index. Google keeps showing addresses a site no longer has: without
 * this an old address reads like any other page. Undefined before the first
 * crawl, when nothing can be said.
 */
function standingOf(path: string, site: SiteView, indexed: Map<string, boolean>): PageStanding | undefined {
  if (!site.pages.length) return undefined;
  const inIndex = indexed.get(path) ?? null;
  const p = site.byPath.get(path);
  if (!p) return { state: "unknown", to: null, indexed: inIndex };
  if (p.redirectTo) return { state: "redirects", to: p.redirectTo, indexed: inIndex };
  if (p.status === 404 || p.status === 410) return { state: "gone", to: null, indexed: inIndex };
  return { state: p.inSitemap ? "listed" : "not-listed", to: null, indexed: inIndex };
}

/** The page rows of a result with what the website has at each address. Other dimensions pass through. */
function withStanding(result: Reading<ExplorerResult>, dimension: ExplorerDimension, stand: Reading<gsc.IndexStand>): Reading<ExplorerResult> {
  if (result.state !== "ok" || dimension !== "page") return result;
  let site: SiteView;
  try {
    site = view();
  } catch {
    return result;
  }
  const indexed = new Map<string, boolean>(stand.state === "ok" ? stand.value.rows.map((r) => [r.path, r.indexed]) : []);
  return {
    ...result,
    value: {
      ...result.value,
      rows: result.value.rows.map((row) => {
        const standing = standingOf(row.key, site, indexed);
        return standing ? { ...row, site: standing } : row;
      }),
    },
  };
}

/* ---------- sitemaps, history ---------------------------------------------------------------- */

async function sitemapsOf(): Promise<Reading<SitemapRow[]>> {
  const got = await reading("gsc", () => gsc.sitemaps());
  if (got.state !== "ok") return got;
  return { ...got, value: got.value.map((s) => ({ path: s.path, lastSubmitted: s.lastSubmitted, lastDownloaded: s.lastDownloaded, isPending: s.isPending, warnings: s.warnings, errors: s.errors, submitted: s.submitted, isIndex: s.isIndex, type: s.type })) };
}

function listedOf(): SeoSearchConsolePayload["listed"] {
  try {
    const r = db.prepare("SELECT day, value FROM cc_series WHERE metric = 'gsc.sitemap_addresses' ORDER BY day DESC LIMIT 1").get() as { day: string; value: number } | undefined;
    /* The count is of ONE file, the website's own sitemap: its path goes with it, so it is not printed beside a feed. */
    return r ? { addresses: r.value, day: r.day, file: pathOf(gsc.sitemapUrl()) } : null;
  } catch {
    return null;
  }
}

/** The desk's own last read of the website's sitemap (src/cc/site/sitemap.ts), or null before the first. */
function ownSitemapOf(): SeoSearchConsolePayload["ownSitemap"] {
  try {
    const s = lastSitemap();
    if (!s) return null;
    return { at: s.at, status: s.status, addresses: s.entries.length, entriesAt: s.entriesAt ?? null, issues: s.issues.map((i) => i.text).slice(0, 5) };
  } catch {
    return null;
  }
}

function historyOf(): SeoSearchConsolePayload["history"] {
  const h = historyFacts();
  if (!h) return historyAbsent();
  return ok(h, "gsc", h.lastSnapshot ?? new Date().toISOString(), "The desk's own copy of Search Console, one snapshot a day of the newest day Google has finished, every country and Switzerland alone.");
}

/* ---------- URL Inspection ------------------------------------------------------------------- */

function inspectionAskedOf(c: Context<Vars>): InspectionQuery {
  const show = c.req.query("ix");
  return {
    show: show === "indexed" ? "indexed" : show === "not-indexed" ? "not-indexed" : "all",
    q: (c.req.query("ixq") ?? "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80),
    state: (c.req.query("ixs") ?? "").trim().slice(0, 120) || null,
    sort: pick(INSPECTION_SORTS, c.req.query("ixsort"), "queue"),
    offset: int(c.req.query("ixo"), 0, 0, 10_000),
    limit: INSPECTION_ROWS,
  };
}

/**
 * The desk's "Request indexing" queue by path: every not-indexed opportunity
 * the engine has ever listed, with the mark a person set on it. A mark is a
 * person's ("I pressed Request indexing on 2 October") and stays true whether
 * or not the engine lists the address at the moment, so it is read from the
 * rows the engine cleared as well: on 3 October 2026 a check cut short made
 * the engine clear 34 of them, 11 already marked, and the marks went off the
 * screen with them.
 */
function queueByPath(): Map<string, InspectionRow["queue"]> {
  try {
    const rows = db.prepare("SELECT id, state, state_by, state_at FROM cc_seo_opps WHERE type = 'not-indexed'").all() as { id: string; state: string; state_by: string | null; state_at: string | null }[];
    return new Map(
      rows.map((r) => [
        r.id.slice("not-indexed:".length),
        { state: r.state === "open" ? "open" : r.state === "in-progress" ? "requested" : "other", by: r.state === "open" ? null : r.state_by, at: r.state === "open" ? null : r.state_at },
      ]),
    );
  } catch {
    return new Map();
  }
}

/** Google's state of a row as the chips and ?ixs= name it. */
const stateOf = (x: { coverage: string | null; indexed: boolean }): string => x.coverage ?? (x.indexed ? "Indexed" : "Not indexed (no reason given)");

async function inspectionOf(asked: InspectionQuery, got: Reading<gsc.IndexStand>): Promise<{ table: Reading<InspectionTable>; asked: InspectionQuery }> {
  if (got.state !== "ok") return { table: got, asked: { ...asked, offset: 0 } };
  const { meaningOf } = await import("../../seo/indexation.ts");
  const r = got.value;
  const queue = queueByPath();
  const all: InspectionRow[] = r.rows.map((x) => {
    const m = meaningOf(x.coverage, x.indexed);
    return {
      url: x.url,
      path: x.path,
      day: x.day,
      listed: x.listed,
      indexed: x.indexed,
      verdict: x.verdict,
      coverage: x.coverage,
      meaning: m.meaning,
      fix: m.fix,
      lastCrawl: x.lastCrawl,
      googleCanonical: x.googleCanonical,
      userCanonical: x.userCanonical,
      canonicalOk: x.canonicalOk,
      robots: x.robots,
      fetchState: x.fetchState,
      link: x.link,
      queue: queue.get(x.path) ?? null,
    };
  });
  const by = new Map<string, { state: string; indexed: boolean; count: number; meaning: string }>();
  for (const x of all) {
    const state = stateOf(x);
    const g = by.get(state) ?? { state, indexed: x.indexed, count: 0, meaning: x.meaning };
    g.count++;
    by.set(state, g);
  }
  const states = [...by.values()].sort((a, b) => Number(a.indexed) - Number(b.indexed) || b.count - a.count);

  const wanted = asked.state?.toLowerCase() ?? null;
  const matched = all.filter(
    (x) => (asked.show === "all" ? true : asked.show === "indexed" ? x.indexed : !x.indexed) && (!asked.q || x.path.toLowerCase().includes(asked.q)) && (wanted === null || stateOf(x).toLowerCase() === wanted),
  );
  /* queue: not indexed first, those still waiting in the queue before those already requested, then by address. */
  const rank = (x: InspectionRow) => (x.indexed ? 3 : x.queue?.state === "open" ? 0 : x.queue ? 1 : 2);
  const byAddress = (a: InspectionRow, b: InspectionRow) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const order: Record<InspectionQuery["sort"], (a: InspectionRow, b: InspectionRow) => number> = {
    queue: (a, b) => rank(a) - rank(b) || byAddress(a, b),
    address: byAddress,
    /* Crawled most recently first; an address Google never crawled has no date and goes last. */
    crawl: (a, b) => (a.lastCrawl && b.lastCrawl ? (a.lastCrawl < b.lastCrawl ? 1 : a.lastCrawl > b.lastCrawl ? -1 : 0) : a.lastCrawl ? -1 : b.lastCrawl ? 1 : 0) || byAddress(a, b),
  };
  matched.sort(order[asked.sort]);
  const offset = within(asked.offset, matched.length, asked.limit);
  return {
    asked: { ...asked, offset },
    table: {
      ...got,
      value: {
        day: r.day,
        of: r.of,
        checked: r.checked,
        dayComplete: r.dayComplete,
        carried: r.carried,
        carriedFrom: r.carriedFrom,
        complete: r.complete,
        inspected: all.length,
        indexed: r.indexed,
        notIndexed: r.notIndexed,
        canonicalDiffers: r.canonicalDiffers,
        states,
        total: matched.length,
        rows: matched.slice(offset, offset + asked.limit),
      },
    },
  };
}

/** The daily index check as the scheduler knows it, with the day's allowance and a retry that is planned. Null when this desk has no such job. */
function inspectJobOf(): InspectJob | null {
  try {
    const j = jobStatus().find((x) => x.name === "gsc-inspect");
    if (!j) return null;
    return {
      job: { ...j, lastNote: j.lastNote === null ? null : scrub(j.lastNote), progress: j.progress?.what ? { ...j.progress, what: scrub(j.progress.what) } : j.progress },
      allowance: gsc.inspectAllowance(),
      retryAt: gsc.inspectRetryAt(),
    };
  } catch {
    return null;
  }
}

/* ---------- the screen ------------------------------------------------------------------------ */

const consoleUrl = (kind: "performance/search-analytics" | "sitemaps"): string | null => {
  const a = gsc.access();
  return a.state === "ok" && a.site ? `https://search.google.com/search-console/${kind}?resource_id=${encodeURIComponent(a.site)}` : null;
};

routes.get("/", async (c) => {
  const { asked, range, window } = await askedOf(c, true);
  const inspectionAsked = inspectionAskedOf(c);
  const failed = (e: unknown): string => `The last read failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`;
  const [explored, sitemaps, options, stand] = await Promise.all([
    explore(asked, range, window, LIVE_ROWS),
    sitemapsOf(),
    optionsOf(range, window.span, asked).catch((): ExplorerOptions => ({ pages: [], countries: [{ key: "all", label: "All countries", impressions: null, live: false }], brand: brandWord(), days: null })),
    reading("gsc", () => gsc.indexStand()),
  ]);
  const inspection = await inspectionOf(inspectionAsked, stand).catch((e: unknown) => ({ table: waiting<InspectionTable>("gsc", failed(e)), asked: inspectionAsked }));
  const result = withStanding(explored, asked.dimension, stand);
  /* What the result was really read for: a live answer may carry Search Console's own window, and an offset past the end is the last page. */
  const answered: ExplorerQuery = result.state === "ok" ? { ...asked, start: result.value.start, end: result.value.end, source: result.value.source, offset: result.value.offset } : asked;
  return c.json<SeoSearchConsolePayload>({
    head: head(range),
    asked: answered,
    result,
    sitemaps,
    history: historyOf(),
    href: consoleUrl("performance/search-analytics"),
    options,
    listed: listedOf(),
    ownSitemap: ownSitemapOf(),
    inspection: inspection.table,
    inspectionAsked: inspection.asked,
    inspectJob: inspectJobOf(),
    sitemapsHref: consoleUrl("sitemaps"),
  });
});

/* ---------- GET /export.csv ------------------------------------------------------------------- */

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  let s = String(v);
  /* A spreadsheet runs a cell that starts like a formula. */
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const HEAD: Record<ExplorerDimension, string> = { query: "Query", page: "Page", country: "Country", device: "Device", date: "Date", searchAppearance: "Search appearance" };
const STANDING: Record<PageStanding["state"], string> = { listed: "In the sitemap", "not-listed": "Not in the sitemap", redirects: "Redirects", gone: "Gone (404)", unknown: "Not a page of the site" };

routes.get("/export.csv", async (c) => {
  const { asked, range, window } = await askedOf(c, false);
  const explored = await explore(asked, range, window, LIVE_ROWS);
  if (explored.state !== "ok") return c.json({ error: `There is nothing to export: ${explored.reason}` }, 409);
  const got = asked.dimension === "page" ? withStanding(explored, "page", await reading("gsc", () => gsc.indexStand())) : explored;
  if (got.state !== "ok") return c.json({ error: "There is nothing to export." }, 409);
  const r = got.value;
  /* A day has no window before, so the Dates export carries no empty "before" columns. */
  const before = r.previous && asked.dimension !== "date" ? `${r.previous.start} to ${r.previous.end}` : null;
  const standing = asked.dimension === "page" && r.rows.some((x) => x.site);
  const headRow = [
    HEAD[asked.dimension],
    ...(asked.dimension === "country" ? ["Code"] : []),
    `Clicks (${r.start} to ${r.end})`,
    "Impressions",
    "CTR %",
    "Average position",
    ...(before ? [`Clicks before (${before})`, "Impressions before", "Average position before"] : []),
    ...(r.topLabel ? [r.topLabel] : []),
    ...(standing ? ["On the website", "In Google's index"] : []),
  ];
  const lines = [headRow.map(cell).join(",")];
  for (const x of r.rows) {
    lines.push(
      [
        asked.dimension === "country" || asked.dimension === "device" || asked.dimension === "searchAppearance" ? x.label : x.key,
        ...(asked.dimension === "country" ? [x.key.toUpperCase()] : []),
        x.clicks,
        x.impressions,
        x.ctr.value ?? "",
        x.position ?? "",
        ...(before ? [x.previous?.clicks ?? "", x.previous?.impressions ?? "", x.previous?.position ?? ""] : []),
        ...(r.topLabel ? [x.top ?? ""] : []),
        ...(standing ? [x.site ? STANDING[x.site.state] : "", x.site?.indexed == null ? "" : x.site.indexed ? "yes" : "no"] : []),
      ]
        .map(cell)
        .join(","),
    );
  }
  const narrowed = [asked.country !== "all" ? asked.country : "", asked.device !== "all" ? asked.device.toLowerCase() : "", asked.q ? "filtered" : "", asked.page ? "page" : ""].filter(Boolean).join("-");
  c.header("content-type", "text/csv; charset=utf-8");
  c.header("content-disposition", `attachment; filename="balkaris-search-console-${asked.dimension}-${r.start}-${r.end}${narrowed ? `-${narrowed}` : ""}.csv"`);
  c.header("cache-control", "no-store");
  return c.body(`﻿${lines.join("\r\n")}\r\n`);
});

/* For the check (scripts/check-cc-seo-search-console.ts): the pure parts. */
export const parts = { tableOf, liveFilters, ordered, labelOf, pathParam, firstDir, termsOf, within, standingOf, liveDays };
