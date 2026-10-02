import { db } from "../../db.ts";
import * as gsc from "../search/gsc.ts";
import { addDays, eachDay, pathOf, round } from "../search/shared.ts";
import { note, setState, state } from "../store.ts";
import type { Rate, RateStat, SeoRange, SeoSpan } from "../../../web/src/contract/seo/common.ts";
import type { Stat } from "../../../web/src/contract/common.ts";
import { now } from "./tables.ts";

/**
 * RANK HISTORY: the desk's own copy of Search Console, one snapshot a day.
 *
 * Search Console answers for sixteen months and only when asked; what is not
 * asked for in time is gone. So every day the newest day Google has FINISHED
 * counting (dataState final, two to three days behind) is asked four ways and
 * kept, for every country and for Switzerland alone (country "che"):
 *
 *   date, query, page, device   cc_seo_rank          which page showed for which query
 *   date, query, device         cc_seo_rank_queries  Google's own figure per query
 *   date, page, device          cc_seo_rank_pages    per page, with the rare queries Google withholds
 *   date, device                cc_seo_rank_days     the property's totals
 *
 * The first run goes back to the first day Search Console has for the
 * property (at most 485 days: Google's sixteen months at their shortest) and
 * keeps all of it. Every day after asks only for the days since the last
 * snapshot, so a missed day is filled the next time.
 *
 * WHAT THE NUMBERS ARE. Google Search, web results only. A position is
 * Google's average position for the row, combined over days and devices by
 * impressions, as Search Console combines its own. Rare queries are withheld
 * by Google, so query rows do not add up to the page or day totals. A day in
 * cc_seo_snaps with no rows is a real zero; a day not in it is unknown.
 */

const KEPT_DAYS = 485;
const CHUNK = 31;
export const COUNTRIES = ["all", "che"] as const;
export type Country = (typeof COUNTRIES)[number];

const DAYS: Record<SeoRange, number> = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };
export const RANGES = Object.keys(DAYS) as SeoRange[];
export const rangeOf = (asked: string | undefined | null): SeoRange => ((RANGES as string[]).includes(asked ?? "") ? (asked as SeoRange) : "30d");
export const daysOf = (range: SeoRange): number => DAYS[range];

/* ---------- taking the snapshot ------------------------------------------------------------- */

type GRow = { keys: string[]; clicks: number; impressions: number; position: number };

async function ask(dimensions: gsc.Dimension[], start: string, end: string, country: Country): Promise<{ rows: GRow[]; complete: boolean }> {
  const got = await gsc.rawRows({
    start,
    end,
    dimensions,
    filters: country === "all" ? [] : [{ dimension: "country", operator: "equals", expression: country }],
    dataState: "final",
    limit: 100_000,
  });
  if (got.state !== "ok") throw new Error(got.reason);
  return { rows: got.value.rows, complete: got.value.complete };
}

/** The first day Search Console has any figure for the property, asked over the last 485 days. */
export async function firstDataDay(newest: string): Promise<string | null> {
  const known = state("seo:rank:first");
  if (known) return known;
  const got = await ask(["date"], addDays(newest, -(KEPT_DAYS - 1)), newest, "all");
  const first = got.rows.map((r) => r.keys[0] ?? "").filter(Boolean).sort()[0] ?? null;
  if (first) setState("seo:rank:first", first);
  return first;
}

/**
 * Snapshot every day from `start` to `end` (both included), both countries,
 * four ways. Replaces what was kept for those days, in one transaction, and
 * marks each day as snapshotted, including days with no rows (a real zero).
 */
export async function snapshotDays(start: string, end: string): Promise<{ days: number; rows: number; incomplete: boolean }> {
  const got: { country: Country; qp: GRow[]; q: GRow[]; p: GRow[]; d: GRow[] }[] = [];
  let incomplete = false;
  for (const country of COUNTRIES) {
    const qp = await ask(["date", "query", "page", "device"], start, end, country);
    const q = await ask(["date", "query", "device"], start, end, country);
    const p = await ask(["date", "page", "device"], start, end, country);
    const d = await ask(["date", "device"], start, end, country);
    incomplete ||= !qp.complete || !q.complete || !p.complete || !d.complete;
    got.push({ country, qp: qp.rows, q: q.rows, p: p.rows, d: d.rows });
  }

  const put = {
    qp: db.prepare("INSERT OR REPLACE INTO cc_seo_rank (day, country, device, query, page, clicks, impressions, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
    q: db.prepare("INSERT OR REPLACE INTO cc_seo_rank_queries (day, country, device, query, clicks, impressions, position) VALUES (?, ?, ?, ?, ?, ?, ?)"),
    p: db.prepare("INSERT OR REPLACE INTO cc_seo_rank_pages (day, country, device, page, clicks, impressions, position) VALUES (?, ?, ?, ?, ?, ?, ?)"),
    d: db.prepare("INSERT OR REPLACE INTO cc_seo_rank_days (day, country, device, clicks, impressions, position) VALUES (?, ?, ?, ?, ?, ?)"),
    snap: db.prepare(
      "INSERT INTO cc_seo_snaps (day, at, query_rows, page_rows, day_rows) VALUES (?, ?, ?, ?, ?) ON CONFLICT(day) DO UPDATE SET at = excluded.at, query_rows = excluded.query_rows, page_rows = excluded.page_rows, day_rows = excluded.day_rows",
    ),
  };
  let rows = 0;
  const count = new Map<string, { q: number; p: number; d: number }>();
  const tally = (day: string, k: "q" | "p" | "d") => {
    const c = count.get(day) ?? { q: 0, p: 0, d: 0 };
    c[k]++;
    count.set(day, c);
  };
  db.exec("BEGIN");
  try {
    for (const t of ["cc_seo_rank", "cc_seo_rank_queries", "cc_seo_rank_pages", "cc_seo_rank_days"]) {
      db.prepare(`DELETE FROM ${t} WHERE day >= ? AND day <= ?`).run(start, end);
    }
    for (const g of got) {
      for (const r of g.qp) {
        const [day, query, page, device] = r.keys as [string, string, string, string];
        put.qp.run(day, g.country, device, query, page, r.clicks, r.impressions, r.position);
        rows++;
        if (g.country === "all") tally(day, "q");
      }
      for (const r of g.q) {
        const [day, query, device] = r.keys as [string, string, string];
        put.q.run(day, g.country, device, query, r.clicks, r.impressions, r.position);
        rows++;
      }
      for (const r of g.p) {
        const [day, page, device] = r.keys as [string, string, string];
        put.p.run(day, g.country, device, page, r.clicks, r.impressions, r.position);
        rows++;
        if (g.country === "all") tally(day, "p");
      }
      for (const r of g.d) {
        const [day, device] = r.keys as [string, string];
        put.d.run(day, g.country, device, r.clicks, r.impressions, r.position);
        rows++;
        if (g.country === "all") tally(day, "d");
      }
    }
    const at = now();
    for (const day of eachDay(start, end)) {
      const c = count.get(day) ?? { q: 0, p: 0, d: 0 };
      put.snap.run(day, at, c.q, c.p, c.d);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { days: eachDay(start, end).length, rows, incomplete };
}

/** The first and last day snapshotted, or null before the first snapshot. */
export function historyFrom(): string | null {
  return (db.prepare("SELECT MIN(day) AS d FROM cc_seo_snaps").get() as { d: string | null }).d;
}
export function lastSnapDay(): string | null {
  return (db.prepare("SELECT MAX(day) AS d FROM cc_seo_snaps").get() as { d: string | null }).d;
}

/**
 * The daily job: back-fill once, then every day since the last snapshot up
 * to the newest day Google has finished. Returns the line shown beside the run.
 */
export async function runSnapshot(progress: (done: number, of: number, what?: string) => void = () => {}): Promise<string> {
  const n = await gsc.newestFinalDay();
  if (n.state !== "ok") throw new Error(n.reason);
  const newest = n.value;
  const last = lastSnapDay();
  let from: string;
  let backfill = false;
  if (!last) {
    const first = await firstDataDay(newest);
    if (!first) return `Search Console has no figures for the property in the last ${KEPT_DAYS} days yet; nothing to keep.`;
    from = first;
    backfill = true;
  } else from = addDays(last, 1);
  if (from > newest) return `Up to date: the history runs ${historyFrom()} to ${last}, and ${newest} is the newest day Google has finished.`;

  const days = eachDay(from, newest);
  let rows = 0;
  let incomplete = false;
  for (let i = 0; i < days.length; i += CHUNK) {
    const part = days.slice(i, i + CHUNK);
    progress(i, days.length, `${part[0]} to ${part.at(-1)}`);
    const got = await snapshotDays(part[0]!, part.at(-1)!);
    rows += got.rows;
    incomplete ||= got.incomplete;
  }
  progress(days.length, days.length);
  const line = `${backfill ? "Back-filled" : "Kept"} ${days.length} day${days.length === 1 ? "" : "s"} of Search Console, ${from} to ${newest}: ${rows.toLocaleString("en-GB")} rows${incomplete ? "; Google's row limit cut part of it short" : ""}`;
  if (backfill) {
    note("seo", `Kept Search Console's history from ${from}`, {
      tone: "good",
      detail: `${days.length} days to ${newest}, ${rows.toLocaleString("en-GB")} rows: the desk now holds it beyond Google's sixteen months.`,
      href: "/seo/search-console",
      dedupe: "seo:rank:backfill",
    });
  }
  return line;
}

/* ---------- reading it back ---------------------------------------------------------------- */

/** A window of `days` days ending on the last snapshot day, and the window before it. Null before the first snapshot. */
export function spanOf(range: SeoRange): SeoSpan | null {
  const end = lastSnapDay();
  if (!end) return null;
  return spanBetween(addDays(end, -(DAYS[range] - 1)), end);
}

export function spanBetween(start: string, end: string): SeoSpan {
  const days = eachDay(start, end).length;
  const from = historyFrom();
  const previousStart = addDays(start, -days);
  const previousEnd = addDays(start, -1);
  return { start, end, days, previousStart, previousEnd, compared: !!from && from <= previousStart, historyFrom: from };
}

export interface Fig {
  clicks: number;
  impressions: number;
  /** Impression-weighted average position; null without impressions. */
  position: number | null;
}

const fig = (r: { c: number | null; i: number | null; w: number | null } | undefined): Fig => {
  const impressions = Number(r?.i ?? 0);
  return { clicks: Number(r?.c ?? 0), impressions, position: impressions ? round(Number(r?.w ?? 0) / impressions, 1) : null };
};

/** "device = ?" when one device is asked for, else nothing. */
const deviceSql = (device: string | null | undefined): { sql: string; args: string[] } =>
  device && device !== "all" ? { sql: " AND device = ?", args: [device.toUpperCase()] } : { sql: "", args: [] };

export interface Where {
  country?: Country;
  device?: string | null;
}

/** The property's totals over a window. */
export function totals(start: string, end: string, o: Where = {}): Fig {
  const d = deviceSql(o.device);
  return fig(
    db
      .prepare(`SELECT SUM(clicks) AS c, SUM(impressions) AS i, SUM(position * impressions) AS w FROM cc_seo_rank_days WHERE country = ? AND day >= ? AND day <= ?${d.sql}`)
      .get(o.country ?? "all", start, end, ...d.args) as { c: number | null; i: number | null; w: number | null },
  );
}

/** One row per day of the window that the history covers, oldest first. */
export function daySeries(start: string, end: string, o: Where = {}): { date: string; clicks: number; impressions: number; position: number | null }[] {
  const from = historyFrom();
  const last = lastSnapDay();
  if (!from || !last) return [];
  const d = deviceSql(o.device);
  const by = new Map(
    (
      db
        .prepare(`SELECT day, SUM(clicks) AS c, SUM(impressions) AS i, SUM(position * impressions) AS w FROM cc_seo_rank_days WHERE country = ? AND day >= ? AND day <= ?${d.sql} GROUP BY day`)
        .all(o.country ?? "all", start, end, ...d.args) as { day: string; c: number; i: number; w: number }[]
    ).map((r) => [r.day, fig(r)]),
  );
  const s = start > from ? start : from;
  const e = end < last ? end : last;
  if (s > e) return [];
  return eachDay(s, e).map((date) => ({ date, ...(by.get(date) ?? { clicks: 0, impressions: 0, position: null }) }));
}

/** Google's own figures per query over a window (all pages together), most impressions first. */
export function queryFigures(start: string, end: string, o: Where & { q?: string } = {}): (Fig & { query: string })[] {
  const d = deviceSql(o.device);
  const words = (o.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  const like = words.map(() => " AND query LIKE ?").join("");
  return (
    db
      .prepare(
        `SELECT query, SUM(clicks) AS c, SUM(impressions) AS i, SUM(position * impressions) AS w FROM cc_seo_rank_queries WHERE country = ? AND day >= ? AND day <= ?${d.sql}${like} GROUP BY query ORDER BY i DESC, c DESC`,
      )
      .all(o.country ?? "all", start, end, ...d.args, ...words.map((w) => `%${w}%`)) as { query: string; c: number; i: number; w: number }[]
  ).map((r) => ({ query: r.query, ...fig(r) }));
}

/** Per query and page (as a path), over a window: which page Google showed for which query. */
export function queryPageFigures(start: string, end: string, o: Where & { path?: string; query?: string } = {}): (Fig & { query: string; path: string })[] {
  const d = deviceSql(o.device);
  const q = o.query ? " AND query = ?" : "";
  const rows = db
    .prepare(`SELECT query, page, SUM(clicks) AS c, SUM(impressions) AS i, SUM(position * impressions) AS w FROM cc_seo_rank WHERE country = ? AND day >= ? AND day <= ?${d.sql}${q} GROUP BY query, page`)
    .all(o.country ?? "all", start, end, ...d.args, ...(o.query ? [o.query] : [])) as { query: string; page: string; c: number; i: number; w: number }[];
  /* The apex and www spellings of one page are one path here. */
  const merged = new Map<string, { query: string; path: string; c: number; i: number; w: number }>();
  for (const r of rows) {
    const path = pathOf(r.page);
    if (o.path && path !== o.path) continue;
    const k = `${r.query}\u0000${path}`;
    const m = merged.get(k) ?? { query: r.query, path, c: 0, i: 0, w: 0 };
    m.c += r.c;
    m.i += r.i;
    m.w += r.w;
    merged.set(k, m);
  }
  return [...merged.values()].map((m) => ({ query: m.query, path: m.path, ...fig(m) })).sort((a, b) => b.impressions - a.impressions);
}

/** Per page (as a path) over a window, with the impressions of withheld queries: most impressions first. */
export function pageFigures(start: string, end: string, o: Where = {}): (Fig & { path: string })[] {
  const d = deviceSql(o.device);
  const rows = db
    .prepare(`SELECT page, SUM(clicks) AS c, SUM(impressions) AS i, SUM(position * impressions) AS w FROM cc_seo_rank_pages WHERE country = ? AND day >= ? AND day <= ?${d.sql} GROUP BY page`)
    .all(o.country ?? "all", start, end, ...d.args) as { page: string; c: number; i: number; w: number }[];
  const merged = new Map<string, { c: number; i: number; w: number }>();
  for (const r of rows) {
    const path = pathOf(r.page);
    const m = merged.get(path) ?? { c: 0, i: 0, w: 0 };
    m.c += r.c;
    m.i += r.i;
    m.w += r.w;
    merged.set(path, m);
  }
  return [...merged.entries()].map(([path, m]) => ({ path, ...fig(m) })).sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks);
}

/** Per day for one page (a path): clicks, impressions, position. */
export function pageSeries(path: string, start: string, end: string, o: Where = {}): { date: string; clicks: number; impressions: number; position: number | null }[] {
  const d = deviceSql(o.device);
  const rows = db
    .prepare(`SELECT day, page, SUM(clicks) AS c, SUM(impressions) AS i, SUM(position * impressions) AS w FROM cc_seo_rank_pages WHERE country = ? AND day >= ? AND day <= ?${d.sql} GROUP BY day, page`)
    .all(o.country ?? "all", start, end, ...d.args) as { day: string; page: string; c: number; i: number; w: number }[];
  const by = new Map<string, { c: number; i: number; w: number }>();
  for (const r of rows) {
    if (pathOf(r.page) !== path) continue;
    const m = by.get(r.day) ?? { c: 0, i: 0, w: 0 };
    m.c += r.c;
    m.i += r.i;
    m.w += r.w;
    by.set(r.day, m);
  }
  return covered(start, end).map((date) => ({ date, ...(by.has(date) ? fig(by.get(date)) : { clicks: 0, impressions: 0, position: null }) }));
}

/** Per day for one query: Google's figure over the property. */
export function querySeries(query: string, start: string, end: string, o: Where = {}): { date: string; clicks: number; impressions: number; position: number | null }[] {
  const d = deviceSql(o.device);
  const by = new Map(
    (
      db
        .prepare(`SELECT day, SUM(clicks) AS c, SUM(impressions) AS i, SUM(position * impressions) AS w FROM cc_seo_rank_queries WHERE country = ? AND query = ? AND day >= ? AND day <= ?${d.sql} GROUP BY day`)
        .all(o.country ?? "all", query, start, end, ...d.args) as { day: string; c: number; i: number; w: number }[]
    ).map((r) => [r.day, fig(r)]),
  );
  return covered(start, end).map((date) => ({ date, ...(by.get(date) ?? { clicks: 0, impressions: 0, position: null }) }));
}

/** Average position per day for many queries at once (for trend lines), keyed by query. */
export function positionsByDay(start: string, end: string, queries: string[], o: Where = {}): Map<string, (number | null)[]> {
  const days = covered(start, end);
  const index = new Map(days.map((d, i) => [d, i]));
  const out = new Map<string, (number | null)[]>(queries.map((q) => [q, days.map(() => null)]));
  if (!queries.length || !days.length) return out;
  const d = deviceSql(o.device);
  const rows = db
    .prepare(`SELECT day, query, SUM(impressions) AS i, SUM(position * impressions) AS w FROM cc_seo_rank_queries WHERE country = ? AND day >= ? AND day <= ?${d.sql} GROUP BY day, query`)
    .all(o.country ?? "all", start, end, ...d.args) as { day: string; query: string; i: number; w: number }[];
  for (const r of rows) {
    const line = out.get(r.query);
    const at = index.get(r.day);
    if (line && at !== undefined && r.i) line[at] = round(r.w / r.i, 1);
  }
  return out;
}

/**
 * How many queries stood in the top 3, 10, 20 and 50 each day (Google's
 * average position for the query that day, all devices together, weighted by
 * impressions), and how many queries were shown at all. One row per day the
 * history covers; a day with no query is a row of zeros. Rare queries are
 * withheld by Google, so these count the queries Google reports.
 */
export function bucketsByDay(start: string, end: string, o: Where = {}): { date: string; top3: number; top10: number; top20: number; top50: number; queries: number }[] {
  const days = covered(start, end);
  if (!days.length) return [];
  const d = deviceSql(o.device);
  const rows = db
    .prepare(`SELECT day, query, SUM(impressions) AS i, SUM(position * impressions) AS w FROM cc_seo_rank_queries WHERE country = ? AND day >= ? AND day <= ?${d.sql} GROUP BY day, query`)
    .all(o.country ?? "all", days[0]!, days.at(-1)!, ...d.args) as { day: string; query: string; i: number; w: number }[];
  const by = new Map(days.map((date) => [date, { date, top3: 0, top10: 0, top20: 0, top50: 0, queries: 0 }]));
  for (const r of rows) {
    const b = by.get(r.day);
    if (!b || !r.i) continue;
    const p = r.w / r.i;
    b.queries++;
    if (p <= 3) b.top3++;
    if (p <= 10) b.top10++;
    if (p <= 20) b.top20++;
    if (p <= 50) b.top50++;
  }
  return [...by.values()];
}

/**
 * Queries Google showed the site for in the window and not in the window
 * before (new), and the other way round (lost). Null when the history does not
 * cover the window before from its first day: a query "new" against days the
 * desk never kept would be a guess.
 */
export function newAndLost(span: SeoSpan, o: Where = {}): { added: (Fig & { query: string })[]; lost: (Fig & { query: string })[] } | null {
  if (!span.compared) return null;
  const now = queryFigures(span.start, span.end, o);
  const before = queryFigures(span.previousStart, span.previousEnd, o);
  const had = new Set(before.map((q) => q.query));
  const has = new Set(now.map((q) => q.query));
  return { added: now.filter((q) => !had.has(q.query)), lost: before.filter((q) => !has.has(q.query)) };
}

/** The days of a window the history covers. */
export function covered(start: string, end: string): string[] {
  const from = historyFrom();
  const last = lastSnapDay();
  if (!from || !last) return [];
  const s = start > from ? start : from;
  const e = end < last ? end : last;
  return s > e ? [] : eachDay(s, e);
}

/** How much the history holds. */
export function historyFacts(): { from: string; to: string; days: number; rows: number; lastSnapshot: string | null } | null {
  const r = db.prepare("SELECT MIN(day) AS f, MAX(day) AS t, COUNT(*) AS n, MAX(at) AS at FROM cc_seo_snaps").get() as { f: string | null; t: string | null; n: number; at: string | null };
  if (!r.f || !r.t) return null;
  const rows = (db.prepare("SELECT (SELECT COUNT(*) FROM cc_seo_rank) + (SELECT COUNT(*) FROM cc_seo_rank_queries) + (SELECT COUNT(*) FROM cc_seo_rank_pages) + (SELECT COUNT(*) FROM cc_seo_rank_days) AS n").get() as { n: number }).n;
  return { from: r.f, to: r.t, days: r.n, rows, lastSnapshot: r.at };
}

/* ---------- figures as the screens print them --------------------------------------------- */

/** A rate from its parts: small under 30, null with nothing to divide. */
export function rate(num: number, den: number): Rate {
  return { value: den ? round((num / den) * 100, 2) : null, num, den, small: den < 30 };
}

/**
 * The four tiles of a window: clicks, impressions, position and CTR, each
 * with the window before only when the history covers it whole.
 */
export function tiles(span: SeoSpan, o: Where = {}): { clicks: Stat; impressions: Stat; position: Stat | null; ctr: RateStat } {
  const now = totals(span.start, span.end, o);
  const before = span.compared ? totals(span.previousStart, span.previousEnd, o) : null;
  const days = daySeries(span.start, span.end, o);
  const positions = days.map((d) => d.position);
  return {
    clicks: { value: now.clicks, previous: before ? before.clicks : null, unit: "count", series: days.map((d) => d.clicks) },
    impressions: { value: now.impressions, previous: before ? before.impressions : null, unit: "count", series: days.map((d) => d.impressions) },
    position:
      now.position === null
        ? null
        : { value: now.position, previous: before?.position ?? null, unit: "ratio", series: positions.every((p) => p !== null) ? (positions as number[]) : [] },
    ctr: { now: rate(now.clicks, now.impressions), previous: before ? rate(before.clicks, before.impressions) : null, series: days.map((d) => (d.impressions ? round((d.clicks / d.impressions) * 100, 2) : null)) },
  };
}
