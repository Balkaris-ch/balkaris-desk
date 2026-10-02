import { Hono, type Context } from "hono";
import { db } from "../../../db.ts";
import type { Vars } from "../../access.ts";
import { countryName } from "../../search/countries.ts";
import * as gsc from "../../search/gsc.ts";
import { eachDay, pathOf, round, siteBase } from "../../search/shared.ts";
import { ok, reading, waiting } from "../../store.ts";
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
  SeoSearchConsolePayload,
  SitemapRow,
} from "../../../../web/src/contract/seo/search-console.ts";
import { covered, historyFacts, pageFigures, queryFigures, rate, spanBetween, spanOf, type Country } from "../../seo/rank.ts";
import { head, HISTORY_NOTE, historyAbsent, historyAt, int, rangeFrom } from "./shared.ts";

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
 * called new (rare queries are withheld), so its `previous` is null.
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
  if ((a.dimension === "page" || a.page !== null) && !a.q)
    return "Pages are read live from Search Console: the desk's daily copy keeps pages per device, and Google leaves the impressions of withheld queries out of any answer that splits pages by device, so the copy's page figures are short.";
  return null;
}

/** The order a sort starts in: figures from the most, the position and a name from the least, dates from the newest. */
const firstDir = (sort: ExplorerQuery["sort"], dimension: ExplorerDimension): "asc" | "desc" =>
  sort === "position" ? "asc" : sort === "key" ? (dimension === "date" ? "desc" : "asc") : "desc";

/** The explorer's question, from the address. `paged` false: every row (the export). */
function askedOf(c: Context<Vars>, paged: boolean): { asked: ExplorerQuery; range: SeoRange; span: SeoSpan | null } {
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

  /* A window by its dates when both are given and make sense; else the period's. */
  let span: SeoSpan | null = spanOf(range);
  const start = r("start");
  const end = r("end");
  if (isDay(start) && isDay(end) && start <= end && eachDay(start, end).length <= 485) span = spanBetween(start, end);

  const source: ExplorerQuery["source"] = liveWhy({ dimension, country, q, page }) || r("source") === "live" ? "live" : "snapshots";
  const asked: ExplorerQuery = {
    dimension,
    start: span?.start ?? "",
    end: span?.end ?? "",
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
  return { asked, range, span };
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
  /** Lower-case words the query must contain, every one. */
  words: string[];
  page: string | null;
}

type Group = "query" | "page" | "device" | "day" | "none";

/**
 * The snapshot table a read is answered from: the one that carries every
 * column the grouping and the filters need, and no more (see the head).
 */
function tableOf(group: Group, n: Narrow): string {
  const query = group === "query" || n.words.length > 0;
  const page = group === "page" || n.page !== null;
  if (query && page) return "cc_seo_rank";
  if (query) return "cc_seo_rank_queries";
  if (page) return "cc_seo_rank_pages";
  return "cc_seo_rank_days";
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
  const where: string[] = ["country = ?", "day >= ?", "day <= ?"];
  const args: string[] = [n.country, start, end];
  if (n.device !== "all") {
    where.push("device = ?");
    args.push(n.device);
  }
  for (const w of n.words) {
    where.push("instr(lower(query), ?) > 0");
    args.push(w);
  }
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
  const where: string[] = ["country = ?", "day >= ?", "day <= ?"];
  const args: string[] = [n.country, start, end];
  if (n.device !== "all") {
    where.push("device = ?");
    args.push(n.device);
  }
  for (const w of n.words) {
    where.push("instr(lower(query), ?) > 0");
    args.push(w);
  }
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

/* ---------- the explorer, from the desk's snapshots ----------------------------------------- */

function fromSnapshots(a: ExplorerQuery, span: SeoSpan): Reading<ExplorerResult> {
  const n: Narrow = { country: a.country as Country, device: a.device, words: a.q.toLowerCase().split(" ").filter(Boolean).slice(0, 6), page: a.page };
  const compared = span.compared;
  const group: Group = a.dimension === "date" ? "day" : (a.dimension as Group);

  const byDay = sums("day", n, span.start, span.end);
  const now = total(byDay);
  const before = compared ? total(sums("none", n, span.previousStart, span.previousEnd)) : null;

  const rowsNow = a.dimension === "date" ? byDay : sums(group, n, span.start, span.end);
  const rowsBefore = compared && a.dimension !== "date" ? sums(group, n, span.previousStart, span.previousEnd) : null;
  const top = a.dimension === "query" && a.page === null ? tops("query", n, span.start, span.end) : a.dimension === "page" ? tops("page", n, span.start, span.end) : null;

  /* The early rule reads Google's figure per query for the window, under the country and device asked. */
  const early = earlyOf(queryFigures(span.start, span.end, { country: n.country, device: n.device === "all" ? null : n.device }));

  let rows: ExplorerRow[] = [...rowsNow.entries()]
    .filter(([, s]) => s.i > 0 || s.c > 0)
    .map(([key, s]) => {
      const had = rowsBefore?.get(key);
      /* A query Google reported nothing for before may have been withheld as rare: not compared. A page, device or day with no row was not shown. */
      const previous = !rowsBefore ? null : had ? { clicks: had.c, impressions: had.i, position: positionOf(had) } : a.dimension === "query" ? null : { clicks: 0, impressions: 0, position: null };
      return { key, label: labelOf(a.dimension, key), ...figuresOf(s), previous, early: !!early && s.i < early.standard, top: top?.get(key) ?? null };
    });
  rows = ordered(rows, a);

  const notes = [HISTORY_NOTE];
  if (a.country === "che") notes.push("Searches made in Switzerland only.");
  if (a.device !== "all") notes.push(`${DEVICE_LABEL[a.device] ?? a.device} only.`);
  if (n.words.length || a.page) notes.push(`Narrowed to ${[n.words.length ? `queries containing “${a.q}”` : "", a.page ? `the page ${a.page}` : ""].filter(Boolean).join(" on ")}: the figures are those of the queries Google reports, so they are lower than the totals with no filter.`);
  else if (a.dimension === "query") notes.push("Query rows do not add up to the totals: Google withholds rare queries.");
  if (span.historyFrom && span.historyFrom > span.start) notes.push(`The history covers this window from ${span.historyFrom}: Google's figures for the property begin then.`);
  if (!compared) notes.push(span.historyFrom ? `Not compared: the history begins ${span.historyFrom}, after the window before began.` : "Not compared: there is no history before this window.");

  return ok(
    {
      source: "snapshots",
      start: span.start,
      end: span.end,
      previous: compared ? { start: span.previousStart, end: span.previousEnd } : null,
      totals: figuresOf(now),
      previousTotals: before ? figuresOf(before) : null,
      days: dayLine(byDay, span.start, span.end),
      total: rows.length,
      rows: rows.slice(a.offset, a.offset + a.limit),
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

/** Search Console's filters for what was asked: every query word, one page under either host spelling, a country, a device. */
function liveFilters(a: ExplorerQuery): gsc.Filter[] {
  const out: gsc.Filter[] = [];
  for (const w of a.q.toLowerCase().split(" ").filter(Boolean).slice(0, 6)) out.push({ dimension: "query", operator: "contains", expression: w });
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

async function fromLive(a: ExplorerQuery, range: SeoRange, span: SeoSpan | null, rowLimit: number): Promise<Reading<ExplorerResult>> {
  const filters = liveFilters(a);
  /* Without a snapshot yet, the window is Search Console's own for the period, and nothing is compared. */
  const when = span ? { startDate: span.start, endDate: span.end } : { range };
  const compared = !!span && span.compared;
  const ask = (dimensions: gsc.Dimension[], w: { startDate: string; endDate: string } | { range: SeoRange }, limit: number) => gsc.query({ ...w, dimensions, filters, rowLimit: limit, dataState: "final" });

  const [rowsNow, daysNow, rowsBefore, totalBefore, queriesNow] = await Promise.all([
    ask([DIM[a.dimension]], when, rowLimit),
    a.dimension === "date" ? null : ask(["date"], when, 1000),
    compared && a.dimension !== "date" ? ask([DIM[a.dimension]], { startDate: span!.previousStart, endDate: span!.previousEnd }, rowLimit) : null,
    compared ? ask([], { startDate: span!.previousStart, endDate: span!.previousEnd }, 1) : null,
    a.dimension === "query" ? null : ask(["query"], when, LIVE_ROWS),
  ]);
  if (rowsNow.state !== "ok") return rowsNow;
  const dayAnswer = daysNow ?? rowsNow;
  if (dayAnswer.state !== "ok") return dayAnswer;
  const start = rowsNow.value.startDate;
  const end = rowsNow.value.endDate;

  const byDay = liveSums(dayAnswer.value.rows, "date");
  const now = total(byDay);
  const before = totalBefore && totalBefore.state === "ok" ? total(liveSums(totalBefore.value.rows, "none")) : null;
  const prevRows = rowsBefore && rowsBefore.state === "ok" ? liveSums(rowsBefore.value.rows, a.dimension) : null;
  const queryRows = a.dimension === "query" ? rowsNow : queriesNow;
  const early = queryRows && queryRows.state === "ok" ? earlyOf(queryRows.value.rows) : null;

  /* The top column needs the rows that carry both a query and a page: only the snapshots have them, for the countries they keep. */
  const n: Narrow = { country: (SNAPSHOT_COUNTRIES.has(a.country) ? a.country : "all") as Country, device: a.device, words: a.q.toLowerCase().split(" ").filter(Boolean).slice(0, 6), page: a.page };
  const topFor = span && SNAPSHOT_COUNTRIES.has(a.country) ? (a.dimension === "query" && a.page === null ? "query" : a.dimension === "page" ? "page" : null) : null;
  const top = topFor && span ? tops(topFor, n, start, end) : null;

  let rows: ExplorerRow[] = [...liveSums(rowsNow.value.rows, a.dimension).entries()].map(([key, s]) => {
    const had = prevRows?.get(key);
    const previous = !prevRows || a.dimension === "date" ? null : had ? { clicks: had.c, impressions: had.i, position: positionOf(had) } : a.dimension === "query" ? null : { clicks: 0, impressions: 0, position: null };
    return { key, label: labelOf(a.dimension, key), ...figuresOf(s), previous, early: !!early && s.i < early.standard, top: top?.get(key) ?? null };
  });
  rows = ordered(rows, a);

  /* Every day of the window: the history's days when it has them, else every day Google's window spans. */
  const days = span ? dayLine(byDay, start, end) : eachDay(start, end).map((date) => ({ date, ...(byDay.has(date) ? { clicks: byDay.get(date)!.c, impressions: byDay.get(date)!.i, position: positionOf(byDay.get(date)!) } : { clicks: 0, impressions: 0, position: null }) }));

  const notes = [rowsNow.note ?? "", liveWhy(a) ?? "Read live from Search Console, as asked.", "Each answer is kept six hours."];
  if (a.country === "che") notes.push("Searches made in Switzerland only.");
  if (a.device !== "all") notes.push(`${DEVICE_LABEL[a.device] ?? a.device} only.`);
  if (a.dimension === "searchAppearance") notes.push("Only results Google shows in a special form (rich results, videos, FAQ and the like) have a search appearance; plain results are in none of these rows.");
  if (a.dimension === "country") notes.push("The country is the searcher's, as Google reads it.");
  if (a.q) notes.push("Narrowed by query words: the figures are those of the queries Google reports.");
  else if (a.dimension === "query") notes.push("Query rows do not add up to the totals: Google withholds rare queries.");
  const pages =a.dimension === "page" || a.page !== null;
  const split = a.dimension === "device" || a.dimension === "country" || a.device !== "all" || a.country !== "all";
  if (pages && split && !a.q) notes.push("Google leaves the impressions of withheld queries out when pages are combined with a device or a country, so these page figures can be lower than the same page's figures without that filter.");
  if (!compared) notes.push(span?.historyFrom ? `Not compared: the history begins ${span.historyFrom}, after the window before began.` : "Not compared: the desk has no history of its own yet.");
  if (prevRows === null && compared && a.dimension !== "date" && rowsBefore && rowsBefore.state !== "ok") notes.push("The window before could not be read, so no row is compared.");

  return ok(
    {
      source: "live",
      start,
      end,
      previous: compared && before ? { start: span!.previousStart, end: span!.previousEnd } : null,
      totals: figuresOf(now),
      previousTotals: before ? figuresOf(before) : null,
      days,
      total: rows.length,
      rows: rows.slice(a.offset, a.offset + a.limit),
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

async function explore(a: ExplorerQuery, range: SeoRange, span: SeoSpan | null, rowLimit: number): Promise<Reading<ExplorerResult>> {
  if (a.source === "live") return reading("gsc", () => fromLive(a, range, span, rowLimit));
  if (!span) return historyAbsent();
  return reading("gsc", () => fromSnapshots(a, span));
}

/* ---------- what the filters offer ---------------------------------------------------------- */

async function optionsOf(range: SeoRange, span: SeoSpan | null, asked: ExplorerQuery): Promise<ExplorerOptions> {
  /*
   * The pages Google showed for the period: its own page list (the kept answer
   * the scheduled refresh writes; grouped by page alone, so whole), then any
   * page only the snapshots name. Most impressions first.
   */
  const byPath = new Map<string, number>();
  const listedPages = await reading("gsc", () => gsc.pages(range));
  if (listedPages.state === "ok") for (const p of listedPages.value.rows) if (p.impressions > 0) byPath.set(p.path, (byPath.get(p.path) ?? 0) + p.impressions);
  if (span) for (const p of pageFigures(span.start, span.end, { country: "all" })) if (p.impressions > 0 && !byPath.has(p.path)) byPath.set(p.path, p.impressions);
  const pages = [...byPath.entries()].map(([path, impressions]) => ({ path, impressions })).sort((a, b) => b.impressions - a.impressions || (a.path < b.path ? -1 : 1));
  if (asked.page && !pages.some((p) => p.path === asked.page)) pages.push({ path: asked.page, impressions: 0 });

  const snap = (key: Country): number | null => (span ? Number((db.prepare("SELECT SUM(impressions) AS i FROM cc_seo_rank_days WHERE country = ? AND day >= ? AND day <= ?").get(key, span.start, span.end) as { i: number | null }).i ?? 0) : null);
  const countries: ExplorerOptions["countries"] = [
    { key: "all", label: "All countries", impressions: snap("all"), live: false },
    { key: "che", label: countryName("che"), impressions: snap("che"), live: false },
  ];
  /* The other countries Google reported for the period: the kept answer the scheduled refresh writes, asked for only when it has none. */
  const listed = await reading("gsc", () => gsc.byCountry(range));
  if (listed.state === "ok") {
    const others = listed.value.rows
      .map((r) => ({ key: r.key.toLowerCase(), label: r.label, impressions: r.impressions, live: true }))
      .filter((r) => !SNAPSHOT_COUNTRIES.has(r.key) && r.impressions > 0)
      .sort((a, b) => b.impressions - a.impressions || a.label.localeCompare(b.label));
    countries.push(...others);
  }
  if (!countries.some((c) => c.key === asked.country)) countries.push({ key: asked.country, label: countryName(asked.country), impressions: null, live: true });
  return { pages, countries };
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
    return r ? { addresses: r.value, day: r.day } : null;
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
  return { show: show === "all" || show === "indexed" ? show : show === "not-indexed" ? "not-indexed" : "all", offset: int(c.req.query("ixo"), 0, 0, 10_000), limit: INSPECTION_ROWS };
}

/** The desk's "Request indexing" queue: the not-indexed opportunities, by path. */
function queueByPath(): Map<string, InspectionRow["queue"]> {
  try {
    const rows = db.prepare("SELECT id, state, state_by, state_at FROM cc_seo_opps WHERE type = 'not-indexed' AND active = 1").all() as { id: string; state: string; state_by: string | null; state_at: string | null }[];
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

async function inspectionOf(asked: InspectionQuery): Promise<Reading<InspectionTable>> {
  const got = await reading("gsc", () => gsc.indexing());
  if (got.state !== "ok") return got;
  const { meaningOf } = await import("../../seo/indexation.ts");
  const r = got.value;
  const queue = queueByPath();
  const all: InspectionRow[] = r.rows.map((x) => {
    const m = meaningOf(x.coverage, x.indexed);
    return {
      url: x.url,
      path: x.path,
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
    const state = x.coverage ?? (x.indexed ? "Indexed" : "Not indexed (no reason given)");
    const g = by.get(state) ?? { state, indexed: x.indexed, count: 0, meaning: x.meaning };
    g.count++;
    by.set(state, g);
  }
  const states = [...by.values()].sort((a, b) => Number(a.indexed) - Number(b.indexed) || b.count - a.count);
  /* Not indexed first, those still waiting in the queue before those already requested, then by address. */
  const rank = (x: InspectionRow) => (x.indexed ? 3 : x.queue?.state === "open" ? 0 : x.queue ? 1 : 2);
  const matched = all.filter((x) => (asked.show === "all" ? true : asked.show === "indexed" ? x.indexed : !x.indexed)).sort((a, b) => rank(a) - rank(b) || (a.path < b.path ? -1 : 1));
  return {
    ...got,
    value: {
      day: r.day,
      of: r.of ?? null,
      complete: r.complete ?? false,
      inspected: r.inspected,
      indexed: r.indexed,
      notIndexed: r.notIndexed,
      canonicalDiffers: r.canonicalDiffers,
      states,
      total: matched.length,
      rows: matched.slice(asked.offset, asked.offset + asked.limit),
    },
  };
}

/* ---------- the screen ------------------------------------------------------------------------ */

const consoleUrl = (kind: "performance/search-analytics" | "sitemaps"): string | null => {
  const a = gsc.access();
  return a.state === "ok" && a.site ? `https://search.google.com/search-console/${kind}?resource_id=${encodeURIComponent(a.site)}` : null;
};

routes.get("/", async (c) => {
  const { asked, range, span } = askedOf(c, true);
  const inspectionAsked = inspectionAskedOf(c);
  const [result, sitemaps, options, inspection] = await Promise.all([
    explore(asked, range, span, LIVE_ROWS),
    sitemapsOf(),
    optionsOf(range, span, asked).catch((): ExplorerOptions => ({ pages: [], countries: [{ key: "all", label: "All countries", impressions: null, live: false }] })),
    inspectionOf(inspectionAsked).catch((e: unknown): Reading<InspectionTable> => waiting("gsc", `The last read failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`)),
  ]);
  /* What the result was really read for: a live answer may carry Search Console's own window. */
  const answered: ExplorerQuery = result.state === "ok" ? { ...asked, start: result.value.start, end: result.value.end, source: result.value.source } : asked;
  return c.json<SeoSearchConsolePayload>({
    head: head(range),
    asked: answered,
    result,
    sitemaps,
    history: historyOf(),
    href: consoleUrl("performance/search-analytics"),
    options,
    listed: listedOf(),
    inspection,
    inspectionAsked,
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

routes.get("/export.csv", async (c) => {
  const { asked, range, span } = askedOf(c, false);
  const got = await explore(asked, range, span, LIVE_ROWS);
  if (got.state !== "ok") return c.json({ error: `There is nothing to export: ${got.reason}` }, 409);
  const r = got.value;
  const before = r.previous ? `${r.previous.start} to ${r.previous.end}` : null;
  const headRow = [
    HEAD[asked.dimension],
    ...(asked.dimension === "country" ? ["Code"] : []),
    `Clicks (${r.start} to ${r.end})`,
    "Impressions",
    "CTR %",
    "Average position",
    ...(before ? [`Clicks before (${before})`, "Impressions before", "Average position before"] : []),
    ...(r.topLabel ? [r.topLabel] : []),
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

/* Exported for a check: the pure parts. */
export const parts = { tableOf, liveFilters, ordered, labelOf, pathParam, firstDir };
