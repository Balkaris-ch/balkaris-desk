import { Hono, type Context } from "hono";
import type { Vars } from "../access.ts";
import * as ga4 from "../ga4.ts";
import { status as jobStatus } from "../scheduler.ts";
import { bing, gsc } from "../search/index.ts";
import type { LinkCounts } from "../search/bing.ts";
import type { CtrOutlier, Gap, IndexReport, Listed, Mover, Opportunity, PageRow as SearchPageRow, PageTitle, PositionBuckets, QueryPageRow, QueryRow, SearchTotals } from "../search/gsc.ts";
import type { DayWindow } from "../search/shared.ts";
import * as site from "../site/index.ts";
import { specimenAllowed } from "../specimen.ts";
import { off, ok, reading, series, since, today, waiting } from "../store.ts";
import { scrub } from "../system.ts";
import type { EarlySignals, JobListed, Range, Reading, SourceId, Stat } from "../../../web/src/contract/common.ts";
import type {
  AuditState,
  CheckKey,
  CheckValue,
  ConsoleOverview,
  ContentGaps,
  GapGroup,
  GapRow,
  Landings,
  MovementRow,
  Movements,
  Opportunities,
  OpportunityRow,
  OrganicLanding,
  QueryFigures,
  RankingTrend,
  ReportBody,
  ReportFinding,
  ReportGroup,
  ReportOnlyKey,
  ReportSection,
  ScoreRule,
  SearchLanding,
  SeoList,
  SeoListBody,
  SeoListName,
  SeoPayload,
  SeoReport,
  SeoTiles,
  SeoWindow,
  TechCheck,
} from "../../../web/src/contract/seo.ts";

/**
 * /api/v1/seo — the SEO screen, its full report and its full lists.
 *
 *   GET /             the whole screen in one answer: ?range=7d|30d|90d|1y, ?open=<query>
 *   GET /report       every finding of the last crawl, by check and by rule
 *   GET /list/:name   one panel's whole list: opportunities, gaps, movements, landing
 *
 * WHERE EACH PANEL COMES FROM.
 *
 *   the desk's crawl       health score, critical issues, the technical checks
 *                          (real today, no credential needed)
 *   Search Console         indexed pages, keyword and CTR opportunities, the
 *                          ranking trend, content gaps, movements, the overview,
 *                          landing pages (absent, in place, until connected)
 *   Bing Webmaster         backlinks (absent until its key exists; Google offers
 *                          no backlink API at all)
 *   GA4                    organic landings, only while Search Console is not
 *                          connected, and named as GA4's
 *
 * Every panel is made from its source's Reading by a pure function below
 * (the `assemble…` functions), each inside `reading()`, so a source that fails
 * costs its own panel and nothing else. The check script feeds those same
 * functions artificial Search Console rows (scripts/check-cc-seo.ts).
 *
 * THE SPECIMEN. `?specimen=1`, and only where `specimenAllowed` says so (a
 * workstation: never desk.balkaris.ch), feeds the Search Console and Bing
 * panels from `SPECIMEN_*` below: rows named "specimen query 07" and
 * "/specimen/page-03" with figures made by formula, so the connected state can
 * be looked at before the credential exists. The answer then says
 * `specimen: true` and the page prints a ribbon. The crawl's panels stay real.
 */
export const routes = new Hono<Vars>();

/* ---------- ranges and windows -------------------------------------------------------- */

const RANGES = ["7d", "30d", "90d", "1y"] as const;
type SeoRange = (typeof RANGES)[number];
const DAYS: Record<SeoRange, number> = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };

const rangeOf = (asked: string | undefined): SeoRange => (RANGES as readonly string[]).includes(asked ?? "") ? (asked as SeoRange) : "30d";

/** A YYYY-MM-DD shifted by whole days, at noon so a clock change cannot move it. */
const shift = (day: string, by: number): string => new Date(Date.parse(`${day}T12:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);

const windowOf = (w: DayWindow): SeoWindow => ({ start: w.start, end: w.end, previousStart: w.previousStart, previousEnd: w.previousEnd, days: w.days });

/** The value of a reading made from another: same source, same time, the rule appended to its note. */
function carry<A, B>(r: Reading<A>, make: (value: A) => B, rule?: string): Reading<B> {
  if (r.state !== "ok") return r;
  return ok(make(r.value), r.source, r.asOf, [r.note, rule].filter(Boolean).join(" ") || undefined);
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

/** A page's title as a label: the part before " | Balkaris" or " — Balkaris". */
export function labelOf(title: string | null | undefined, path: string): string {
  const t = (title ?? "").split(/\s+[|·]\s+/)[0]!.replace(/\s+[—–-]\s+Balkaris$/i, "").trim();
  return t || path;
}

/* ---------- what the screen reads from the search sources ---------------------------- */

/** A rule's list as the collectors return it. `early` only on the lists that have an early mode (gsc.ts, EARLY). */
type Ruled<R> = { window: DayWindow; floor: number; rows: R[]; early?: EarlySignals | null; compared?: { queries: number; pages: number } };

/**
 * Everything Search Console and Bing contribute, as their own readings. Live,
 * from the collectors (`loadSearch`); or artificial (`specimenSearch`).
 */
export interface SearchSources {
  totals: Reading<SearchTotals>;
  buckets: Reading<PositionBuckets>;
  queries: Reading<Listed<QueryRow>>;
  /** The queries of the window before, read whole, so a count can be compared fairly. Null when that window is not covered. */
  previousQueries: Reading<{ rows: { query: string; position: number; impressions: number }[] }> | null;
  opportunities: Reading<Ruled<Opportunity>>;
  outliers: Reading<Ruled<CtrOutlier>>;
  movers: Reading<Ruled<Mover>>;
  gaps: Reading<Ruled<Gap>>;
  pages: Reading<Listed<SearchPageRow>>;
  /** Only read when one query is asked about (?open=). */
  queryPages: Reading<Listed<QueryPageRow>> | null;
  indexing: Reading<IndexReport>;
  indexHistory: { day: string; indexed: number; notIndexed: number }[];
  links: Reading<LinkCounts>;
  linkHistory: { day: string; links: number }[];
  /** Search Console's performance report for the property, when the property is known. */
  consoleHref: string | null;
}

/** The crawl's pages as the search panels need them: titles to judge gaps, groups, labels and pictures. */
function crawlPages(): site.PageRow[] {
  try {
    const inv = site.inventory();
    return inv.state === "ok" ? inv.value : [];
  } catch {
    /* Without the page list, gaps wait for the crawl and rows go without titles and pictures: one panel's loss, not the screen's. */
    return [];
  }
}

/** A value read on the side (a history, a link), or the fallback when reading it fails: never the reason a whole answer fails. */
function quietly<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

/**
 * Whether Google's figures cover the window before from its first day.
 * `totalsByDay` settles it for the property (a young property is not
 * compared), and every "before" on this screen follows it.
 */
export const coveredBefore = (src: SearchSources): boolean => src.totals.state === "ok" && src.totals.value.clicks.previous !== null;

/** Host and path: what tells two addresses with the same path apart. */
const hostPath = (page: string): string => page.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");

/**
 * What each page row shows: its path, or its host and path when another row
 * of the same list has the same path. Search Console reports a Domain
 * property's apex and www addresses (and a trailing slash) as different
 * pages, so after the move from Framer "/x" can be two rows.
 */
export function pageLabels(rows: { page: string; path: string }[]): (page: string, path: string) => string {
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.path, (count.get(r.path) ?? 0) + 1);
  return (page, path) => ((count.get(path) ?? 0) > 1 ? hostPath(page) : path);
}

/**
 * Read the search sources for one range. Totals first and alone: it settles
 * whether Search Console may be read, so the reads after it do not each ask
 * Google the same question at once.
 */
async function loadSearch(range: SeoRange, pagesKnown: site.PageRow[], o: { open: boolean }): Promise<SearchSources> {
  const totals = await reading("gsc", () => gsc.totalsByDay(range));
  const titles: PageTitle[] = pagesKnown.filter((p) => p.indexable).map((p) => ({ path: p.path, title: p.title ?? "", h1: p.h1 }));
  const [buckets, queries, opportunities, outliers, movers, gaps, pages, indexing, links] = await Promise.all([
    reading("gsc", () => gsc.positionBuckets(range)),
    reading("gsc", () => gsc.queries(range)),
    reading("gsc", () => gsc.opportunities(range)),
    reading("gsc", () => gsc.ctrOutliers(range)),
    reading("gsc", () => gsc.movers(range)),
    titles.length ? reading("gsc", () => gsc.gaps(range, titles)) : Promise.resolve(waiting<Ruled<Gap>>("crawl", "The crawl has not read the site's pages yet, so no query can be matched against them.")),
    reading("gsc", () => gsc.pages(range)),
    reading("gsc", () => gsc.indexing()),
    reading("bing", () => bing.linkCounts()),
  ]);

  /* The window before is compared only when Google counted it from its first day (totals says so). */
  let previousQueries: SearchSources["previousQueries"] = null;
  if (totals.state === "ok" && totals.value.clicks.previous !== null) {
    const w = totals.value.window;
    const got = await reading("gsc", () => gsc.query({ startDate: w.previousStart, endDate: w.previousEnd, dimensions: ["query"], rowLimit: 1000 }));
    /* No query at all for a window in which Google did show the site: every
       query of it was withheld as rare, and an empty list is not a count of
       zero. Queries are then not compared, exactly as for an uncounted window. */
    const withheld = got.state === "ok" && got.value.rows.length === 0 && (totals.value.impressions.previous ?? 0) > 0;
    previousQueries = withheld ? null : carry(got, (v) => ({ rows: v.rows.map((r) => ({ query: r.keys[0] ?? "", position: r.position, impressions: r.impressions })) }));
  }

  const access = quietly(() => gsc.access(), null);
  return {
    totals,
    buckets,
    queries,
    previousQueries,
    opportunities,
    outliers,
    movers,
    gaps,
    pages,
    queryPages: o.open ? await reading("gsc", () => gsc.queryPages(range)) : null,
    indexing,
    /* A history that cannot be read leaves its tile without a line or a comparison, never the screen without an answer. */
    indexHistory: quietly(() => gsc.indexHistory(DAYS[range] + 7), []),
    links,
    linkHistory: quietly(() => bing.linkHistory(DAYS[range] + 7), []),
    consoleHref: access?.state === "ok" && access.site ? `https://search.google.com/search-console/performance/search-analytics?resource_id=${encodeURIComponent(access.site)}` : null,
  };
}

/* ---------- the panels, assembled ----------------------------------------------------- */

/**
 * A daily figure of the crawl's as a tile: the last value, the value at the
 * end of the period before (only when the history reaches back that far:
 * a period before the first crawl is not compared), and the line over the
 * period.
 */
export function crawlStat(metric: string, days: number, unit: Stat["unit"], noteText: string, of?: number): Reading<Stat> {
  const at = site.crawledAt();
  const line = series(metric, days + 6);
  const last = line.at(-1);
  if (!at || !last) return waiting("crawl", "The first crawl has not finished yet. It starts about a minute after the desk does.");
  const start = today(-(days - 1));
  const before = today(-days);
  const first = since(metric);
  const then = first && first <= before ? [...line].reverse().find((p) => p.day <= before) : undefined;
  return ok(
    { value: last.value, previous: then ? then.value : null, unit, series: line.filter((p) => p.day >= start).map((p) => p.value), ...(of !== undefined ? { of } : {}) },
    "crawl",
    at,
    noteText,
  );
}

/** A count kept once a day by a collector, as a tile: newest value, the value before the period when recorded, the line. */
function historyStat(points: { day: string; value: number }[], days: number, end: string): { previous: number | null; series: number[] } {
  const start = shift(end, -(days - 1));
  const before = shift(start, -1);
  const then = points[0] && points[0].day <= before ? [...points].reverse().find((p) => p.day <= before) : undefined;
  return { previous: then ? then.value : null, series: points.filter((p) => p.day >= start).map((p) => p.value) };
}

/** The seven tiles, each read on its own: a tile whose read fails says so, and the six others stand. */
export async function assembleTiles(src: SearchSources, range: SeoRange): Promise<SeoTiles> {
  const days = DAYS[range];
  const indexStat = (which: "indexed" | "notIndexed"): Reading<Stat> =>
    carry(src.indexing, (v): Stat => {
      const h = historyStat(src.indexHistory.map((p) => ({ day: p.day, value: p[which] })), days, today());
      /* A day's check cut short counts part of the site: said under the figure, never passed off as the total. */
      const part = v.complete ? {} : { sub: `${v.inspected} of ${v.of ?? "?"} addresses checked` };
      return { value: v[which], previous: v.complete ? h.previous : null, unit: "count", series: h.series, ...part };
    });

  const previousOpportunities = (floor: number): number | null =>
    src.previousQueries?.state === "ok" ? src.previousQueries.value.rows.filter((r) => r.position >= 4 && r.position <= 20 && r.impressions >= floor).length : null;

  const [score, indexed, notIndexed, keywordOpportunities, ctrOpportunities, backlinks, critical] = await Promise.all([
    reading("crawl", () => crawlStat("seo.score", days, "score", "The desk's own score out of 100 by its stated rules (src/cc/site/rules.ts), recorded once a day since the first crawl. Not a figure from Google.", 100)),
    reading("gsc", () => indexStat("indexed")),
    reading("gsc", () => indexStat("notIndexed")),
    reading("gsc", () =>
      carry(src.opportunities, (v) => ({ value: v.rows.length, previous: previousOpportunities(v.floor), unit: "count", series: [], ...(v.early ? { sub: "early signals" } : {}) }) as Stat),
    ),
    reading("gsc", () => carry(src.outliers, (v) => ({ value: v.rows.length, previous: null, unit: "count", series: [] }) as Stat)),
    reading("bing", () =>
      carry(src.links, (v) => {
        const h = historyStat(src.linkHistory.map((p) => ({ day: p.day, value: p.links })), days, today());
        return { value: v.total, previous: h.previous, unit: "count", series: h.series } as Stat;
      }),
    ),
    reading("crawl", () => crawlStat("seo.issues.critical", days, "count", "Critical findings of the desk's crawl by its stated rules, recorded once a day since the first crawl.")),
  ]);
  return { score, indexed, notIndexed, keywordOpportunities, ctrOpportunities, backlinks, critical };
}

/** How the health score is made, from the rules table itself; null if the table cannot be read (the tooltip then says it without numbers). */
export function scoreRule(): ScoreRule | null {
  try {
    const all = Object.values(site.RULES);
    return {
      rules: all.length,
      pageRules: all.filter((r) => r.scope === "page").length,
      siteRules: all.filter((r) => r.scope === "site").length,
      heaviest: [...all]
        .filter((r) => r.cost > 0)
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 4)
        .map((r) => ({ title: r.title, cost: r.cost })),
    };
  } catch {
    return null;
  }
}

export function assembleRanking(src: SearchSources): Reading<RankingTrend> {
  const { buckets, queries } = src;
  if (buckets.state !== "ok") return buckets;
  if (queries.state !== "ok") return queries;
  const top50 = queries.value.rows.filter((r) => r.position <= 50).length;
  const previousTop50 = src.previousQueries?.state === "ok" ? src.previousQueries.value.rows.filter((r) => r.position <= 50).length : null;
  return carry(buckets, (b) => ({
    window: windowOf(b.window),
    days: b.days.map((d) => ({ date: d.date, top3: d.top3, top10: d.top10, top50: d.top50 })),
    top50,
    previousTop50,
    complete: b.complete && queries.value.complete,
  }));
}

/**
 * An earlier position is shown only when the window before is covered whole:
 * a window that began before Google's figures is not compared, as the totals
 * are not (rule: no comparison with a period before measurement began).
 */
const earlier = (src: SearchSources, before: { position: number } | null): number | null => (before && coveredBefore(src) ? before.position : null);

/**
 * A row's change in position follows the movements' rule (gsc.ts, `movers`):
 * it is measured only on a row shown at least FLOOR.movers times in both
 * periods. Under that, `changeFloor` says so and the screen prints no arrow,
 * so a list never shows a movement the Movements panel beside it calls noise.
 */
const changeFloor = (now: { impressions: number }, before: { impressions: number } | null, previousPosition: number | null): { changeFloor?: number } =>
  previousPosition !== null && before && (now.impressions < gsc.FLOOR.movers || before.impressions < gsc.FLOOR.movers) ? { changeFloor: gsc.FLOOR.movers } : {};

const opportunityRow = (src: SearchSources) => (r: Opportunity): OpportunityRow => {
  const previousPosition = earlier(src, r.previous);
  return {
    query: r.query,
    position: r.position,
    previousPosition,
    impressions: r.impressions,
    clicks: r.clicks,
    ctr: r.ctr,
    path: r.path,
    ...changeFloor(r, r.previous, previousPosition),
    ...(r.early ? { early: true } : {}),
  };
};

/**
 * Whether a query without an earlier position is new: only when the window
 * before is covered, its queries could be read (Google did not withhold every
 * one of them: `loadSearch`), and the query list was not cut at Google's row
 * limit (a query below the cut in the window before would otherwise pass for new).
 */
const queriesCompared = (src: SearchSources): boolean => coveredBefore(src) && src.previousQueries?.state === "ok" && src.queries.state === "ok" && src.queries.value.complete;

export function assembleOpportunities(src: SearchSources, limit = 8): Reading<Opportunities> {
  return carry(src.opportunities, (v) => ({
    window: windowOf(v.window),
    floor: v.floor,
    early: v.early ?? null,
    compared: queriesCompared(src),
    total: v.rows.length,
    rows: v.rows.slice(0, limit).map(opportunityRow(src)),
  }));
}

/** The whole list behind "View all", with the same rule for "new". */
export function opportunityList(src: SearchSources): Reading<{ window: SeoWindow; floor: number; early: EarlySignals | null; compared: boolean; rows: OpportunityRow[] }> {
  return carry(src.opportunities, (v) => ({ window: windowOf(v.window), floor: v.floor, early: v.early ?? null, compared: queriesCompared(src), rows: v.rows.map(opportunityRow(src)) }));
}

/** The groups content gaps are counted by: every service page and every industry page the crawl knows. */
export function gapGroups(pagesKnown: site.PageRow[]): { path: string; label: string; kind: "service" | "segment" }[] {
  return pagesKnown
    .filter((p) => (p.kind === "service" || p.kind === "segment") && p.status === 200)
    .map((p) => ({ path: p.path, label: labelOf(p.title, p.path), kind: p.kind as "service" | "segment" }));
}

export function assembleGaps(src: SearchSources, groups: { path: string; label: string; kind: "service" | "segment" }[], limit = 6): Reading<ContentGaps> {
  return carry(src.gaps, (v) => {
    const by = new Map<string, GapGroup>(groups.map((g) => [g.path, { ...g, queries: 0, impressions: 0, top: null }]));
    /* A group is early when every query in it is: it stands on nothing above the standard floor. */
    const firm = new Set<string>();
    const elsewhere = { queries: 0, impressions: 0 };
    for (const r of v.rows) {
      const g = r.path ? by.get(r.path) : undefined;
      if (!g) {
        elsewhere.queries++;
        elsewhere.impressions += r.impressions;
        continue;
      }
      g.queries++;
      g.impressions += r.impressions;
      if (!r.early) firm.add(g.path);
      /* Rows arrive most impressions first, so the first is the top one. */
      g.top ??= r.query;
    }
    const list = [...by.values()]
      .filter((g) => g.queries > 0)
      .map((g) => (v.early && !firm.has(g.path) ? { ...g, early: true } : g))
      .sort((a, b) => b.impressions - a.impressions || b.queries - a.queries);
    return { window: windowOf(v.window), floor: v.floor, early: v.early ?? null, groups: list.slice(0, limit), elsewhere };
  });
}

export function gapRows(src: SearchSources, groups: { path: string; label: string }[]): Reading<{ window: DayWindow; floor: number; early: EarlySignals | null; rows: GapRow[] }> {
  const named = new Map(groups.map((g) => [g.path, g.label]));
  return carry(src.gaps, (v) => ({
    window: v.window,
    floor: v.floor,
    early: v.early ?? null,
    rows: v.rows.map((r) => ({
      query: r.query,
      impressions: r.impressions,
      clicks: r.clicks,
      position: r.position,
      path: r.path,
      group: r.path ? (named.get(r.path) ?? null) : null,
      ...(r.early ? { early: true } : {}),
    })),
  }));
}

/** Movers as rows: keyed by the query or the page's full address, a page labelled by its path (with its host when two share it). */
export function movementRows(list: Mover[]): MovementRow[] {
  const label = pageLabels(list.filter((m) => m.kind === "page").map((m) => ({ page: m.key, path: m.path ?? m.key })));
  return list.map((m) => ({
    kind: m.kind,
    key: `${m.kind}:${m.key}`,
    label: m.kind === "page" ? label(m.key, m.path ?? m.key) : m.key,
    previous: m.previous,
    current: m.current,
    change: m.change,
    impressions: m.impressions,
  }));
}

/**
 * The movers, or why there are none to show: a movement is a comparison with
 * the window before, so a window that began before Google's figures (or whose
 * coverage cannot be read) gives no movement at all, never a partial one.
 */
export function moversRead(src: SearchSources): SearchSources["movers"] {
  if (src.movers.state !== "ok") return src.movers;
  if (src.totals.state !== "ok") return waiting("gsc", "Whether Google's figures cover the period before cannot be read just now, so no movement is measured against it.");
  if (!coveredBefore(src)) {
    const t = src.totals.value;
    const w = src.movers.value.window;
    /* The day named is `movers`'s own (gsc.ts, firstComparison): one rule, so the panel never promises two different days. */
    return waiting(
      "gsc",
      `No comparison yet: Google's figures for the site do not cover the period this one is measured against (${gsc.spanText(w.previousStart, w.previousEnd)}) from its first day, so no movement can be measured against it. ${gsc.firstComparison({ figures: gsc.figuresBegin(t) }, t.window.days)}`,
    );
  }
  return src.movers;
}

export function assembleMovements(src: SearchSources, limit = 5): Reading<Movements> {
  return carry(moversRead(src), (v) => ({ window: windowOf(v.window), floor: v.floor, compared: v.compared ?? null, total: v.rows.length, rows: movementRows(v.rows).slice(0, limit) }));
}

export function assembleConsole(src: SearchSources): Reading<ConsoleOverview> {
  return carry(src.totals, (t) => ({
    window: windowOf(t.window),
    from: t.from,
    clicks: t.clicks,
    impressions: t.impressions,
    ctr: t.ctr,
    position: t.position,
    days: t.days.map((d) => ({ date: d.date, clicks: d.clicks, impressions: d.impressions })),
    href: src.consoleHref,
  }));
}

/** Search Console's landing pages, or, while it is not connected, GA4's sessions from Organic Search by landing page. */
export async function assembleLanding(src: SearchSources, range: SeoRange, pagesKnown: site.PageRow[], limit = 5): Promise<Reading<Landings>> {
  const known = new Map(pagesKnown.map((p) => [p.path, p]));
  if (src.pages.state === "ok") {
    return carry(src.pages, (v) => {
      const label = pageLabels(v.rows);
      return {
        source: "gsc" as const,
        window: windowOf(v.window),
        compared: coveredBefore(src) && v.complete,
        total: v.rows.length,
        rows: v.rows.slice(0, limit).map((r): SearchLanding => {
          const previousPosition = earlier(src, r.previous);
          return {
            page: r.page,
            path: r.path,
            label: label(r.page, r.path),
            title: known.get(r.path)?.title ?? null,
            picture: known.get(r.path)?.sharePicture ?? null,
            clicks: r.clicks,
            impressions: r.impressions,
            ctr: r.ctr,
            position: r.position,
            previousPosition,
            ...changeFloor(r, r.previous, previousPosition),
          };
        }),
      };
    });
  }
  /* The true stand-in: where people who came from search landed, as GA4 counts them. */
  const why = src.pages.reason;
  const read = await ga4.landingPages(range, "organic-search", { screen: true });
  return ga4.asReading(read, (d) => {
    const rows = d.rows.filter((r) => r.path !== "(not set)");
    return {
      source: "ga4" as const,
      start: d.span.start,
      end: d.span.end,
      total: rows.length,
      rows: rows.slice(0, limit).map(
        (r): OrganicLanding => ({
          path: r.path,
          title: known.get(r.path)?.title ?? null,
          picture: known.get(r.path)?.sharePicture ?? null,
          sessions: r.sessions,
          users: r.users,
          previousSessions: r.previous ? r.previous.sessions : null,
        }),
      ),
      why,
    };
  });
}

export function assembleOpen(src: SearchSources, query: string): Reading<QueryFigures> {
  const q = query.trim().toLowerCase();
  if (src.queries.state !== "ok") return src.queries;
  const row = src.queries.value.rows.find((r) => r.query.toLowerCase() === q);
  if (!row) return off("gsc", `Search Console reports no query “${query}” for ${src.queries.value.window.start} to ${src.queries.value.window.end}. Rare queries are withheld by Google.`);
  const landing = src.queryPages?.state === "ok" ? src.queryPages.value.rows.filter((r) => r.query === row.query).sort((a, b) => b.impressions - a.impressions)[0] : undefined;
  return carry(src.queries, (v) => ({
    query: row.query,
    window: windowOf(v.window),
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position,
    /* Clicks and impressions of a window that began before Google's figures would be a part counted as a whole: not compared. */
    previous: coveredBefore(src) ? row.previous : null,
    compared: queriesCompared(src),
    path: landing?.path ?? null,
  }));
}

/* ---------- indexation & technical: from the crawl and the sitemap job --------------- */

const NOT_CRAWLED = "The first crawl has not finished yet. It starts about a minute after the desk does and takes under a minute.";

type Finding = site.Finding;

/** Findings of the last crawl, filtered, or null before the first crawl. */
function findings(pick: (f: Finding) => boolean): Finding[] | null {
  const all = site.issues();
  return all.state === "ok" ? all.value.filter(pick) : null;
}

/**
 * THE ONE RULE FOR EVERY LINE. Critical and warning findings are issues: they
 * set the tone (red, amber) and are counted as "n issues". Opportunity
 * findings never colour a line and never count as issues: a line without
 * issues says "n opportunities" in neutral text, or its clean text when it
 * has none. The full report lists all three severities.
 */
export function judged(list: { severity: site.Severity }[], clean = "No issues"): CheckValue {
  const issues = list.filter((f) => f.severity !== "opportunity");
  const chances = list.length - issues.length;
  if (issues.length) return { tone: issues.some((f) => f.severity === "critical") ? "bad" : "warn", text: plural(issues.length, "issue") };
  if (chances) return { tone: "good", text: plural(chances, "opportunity", "opportunities") };
  return { tone: "good", text: clean };
}

const CHECK_LABELS: Record<CheckKey, string> = {
  indexed: "Pages indexed",
  sitemap: "Sitemap",
  robots: "Robots.txt",
  canonical: "Canonical tags",
  titles: "Meta titles",
  descriptions: "Meta descriptions",
  schema: "Structured data (Schema)",
  redirects: "Redirects (3xx)",
  broken: "Broken links (4xx)",
  internal: "Internal links",
};

const CHECK_KEYS = Object.keys(CHECK_LABELS) as CheckKey[];

const failed = (e: unknown): string => `The last read failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`;

/** The rules each checklist line covers, beyond its own area. */
const LINE_RULES: Partial<Record<CheckKey, (f: Finding) => boolean>> = {
  canonical: (f) => f.area === "canonical",
  titles: (f) => f.area === "title",
  descriptions: (f) => f.area === "description",
  redirects: (f) => f.area === "redirects" || f.rule === "page.redirects" || f.rule === "links.redirected",
};

/** Pages in the sitemap that only one other page links to: the desk's own yardstick for "weakly linked". */
function oneLinkPages(): site.PageRow[] {
  return crawlPages().filter((p) => p.inSitemap && p.path !== "/" && p.status === 200 && p.inlinks === 1);
}

/**
 * The ten lines, in the board's order. Each line is read on its own: one that
 * fails says why in its row, and the nine others stand. Every line but
 * "Broken links" follows `judged`; that one counts links, as the board does,
 * and all it counts are issues (critical or warning) by the same table.
 */
export function assembleChecks(src: SearchSources): TechCheck[] {
  const at = quietly(() => site.crawledAt(), null);
  const crawled = <T>(make: () => T | null, noteText?: string): Reading<T> => {
    if (!at) return waiting("crawl", NOT_CRAWLED);
    const v = make();
    return v === null ? waiting("crawl", NOT_CRAWLED) : ok(v, "crawl", at, noteText);
  };
  const map = quietly(() => site.lastSitemap(), null);
  const mapRead = <T>(make: (m: NonNullable<typeof map>) => T): Reading<T> =>
    map ? ok(make(map), "crawl", map.at, "Read from the website every quarter of an hour.") : waiting("crawl", "The sitemap has not been read yet; the first read happens within a minute of the desk starting.");

  const byLine = (key: CheckKey): Reading<CheckValue> =>
    crawled(() => {
      const list = findings(LINE_RULES[key]!);
      return list ? judged(list) : null;
    });

  const row = (key: CheckKey, make: () => Reading<CheckValue>): TechCheck => {
    let r: Reading<CheckValue>;
    try {
      r = make();
    } catch (e) {
      r = waiting(key === "indexed" ? "gsc" : "crawl", failed(e));
    }
    return { key, label: CHECK_LABELS[key], reading: r, href: `/seo/report#${key}` };
  };

  return [
    row("indexed", () =>
      carry(src.indexing, (v): CheckValue =>
        v.complete
          ? { tone: v.notIndexed ? "warn" : "good", text: `${v.indexed.toLocaleString("en-GB")} / ${plural(v.inspected, "page")}` }
          : { tone: "warn", text: `${v.indexed.toLocaleString("en-GB")} of ${v.inspected} checked` },
      ),
    ),
    row("sitemap", () =>
      mapRead((m) => {
        if (m.status !== 200) return { tone: "bad", text: m.status ? `Answers ${m.status}` : "Does not answer" };
        return judged(
          m.issues.filter((i) => i.rule.startsWith("sitemap.") && i.rule !== "sitemap.blocked"),
          `Valid (${plural(m.entries.length, "address", "addresses")})`,
        );
      }),
    ),
    row("robots", () =>
      mapRead((m) => {
        if (m.robots.status !== 200) return { tone: "warn", text: m.robots.status ? `Answers ${m.robots.status}` : "Does not answer" };
        return judged(
          m.issues.filter((i) => i.rule.startsWith("robots.") || i.rule === "sitemap.blocked"),
          "Valid",
        );
      }),
    ),
    row("canonical", () => byLine("canonical")),
    row("titles", () => byLine("titles")),
    row("descriptions", () => byLine("descriptions")),
    row("schema", () =>
      crawled(() => {
        const list = findings((f) => f.area === "schema");
        if (!list) return null;
        const types = site.schemaTypes();
        return judged(list, `Valid (${plural(types.state === "ok" ? types.value.length : 0, "type")})`);
      }),
    ),
    row("redirects", () => byLine("redirects")),
    row("broken", () =>
      crawled(() => {
        const inside = site.brokenLinks();
        const outside = site.externalLinks("broken");
        if (inside.state !== "ok" || outside.state !== "ok") return null;
        const dead = findings((f) => f.rule === "page.status") ?? [];
        const n = inside.value.length + outside.value.length;
        const tone: CheckValue["tone"] = inside.value.length || dead.length ? "bad" : outside.value.length ? "warn" : "good";
        const text = n ? plural(n, "broken link") : dead.length ? `${plural(dead.length, "page")} not answering` : "No broken links";
        return { tone, text };
      }),
    ),
    row("internal", () =>
      crawled(() => {
        /* Orphans are warnings in the rules table, so issues; a page only one other page links to is the desk's own opportunity. */
        const orphans = findings((f) => f.rule === "links.orphan");
        if (!orphans) return null;
        return judged([...orphans, ...oneLinkPages().map(() => ({ severity: "opportunity" as const }))]);
      }, "Orphans (no page links to them) are issues; pages only one other page links to are opportunities."),
    ),
  ];
}

/** The crawl job as the audit row needs it. If the scheduler cannot be read the row still offers the run, and the desk answers it. */
export function auditState(): AuditState {
  try {
    const j = jobStatus().find((x) => x.name === "crawl") ?? null;
    const job: JobListed | null = j
      ? { ...j, lastNote: j.lastNote === null ? null : scrub(j.lastNote), progress: j.progress?.what ? { ...j.progress, what: scrub(j.progress.what) } : j.progress }
      : null;
    return { job, crawledAt: site.crawledAt() };
  } catch {
    return { job: null, crawledAt: null };
  }
}

/* ---------- the routes ------------------------------------------------------------------- */

async function sourcesFor(c: Context<Vars>, range: SeoRange, pagesKnown: site.PageRow[], o: { open: boolean }): Promise<{ src: SearchSources; specimen: boolean }> {
  if (specimenAllowed(c)) return { src: specimenSearch(range), specimen: true };
  return { src: await loadSearch(range, pagesKnown, o), specimen: false };
}

routes.get("/", async (c) => {
  const range = rangeOf(c.req.query("range"));
  const asked = (c.req.query("open") ?? "").trim().slice(0, 200);
  const pagesKnown = crawlPages();
  const { src, specimen } = await sourcesFor(c, range, pagesKnown, { open: !!asked });
  const groups = specimen ? SPECIMEN_GROUPS : gapGroups(pagesKnown);

  const [ranking, opportunities, gaps, movements, consoleView, landing] = await Promise.all([
    reading("gsc", () => assembleRanking(src)),
    reading("gsc", () => assembleOpportunities(src)),
    reading("gsc", () => assembleGaps(src, groups)),
    reading("gsc", () => assembleMovements(src)),
    reading("gsc", () => assembleConsole(src)),
    reading("gsc", () => assembleLanding(src, range, specimen ? [] : pagesKnown)),
  ]);

  /* Each line already stands on its own; this is the last net, should the list itself fail. */
  let checks: TechCheck[];
  try {
    checks = assembleChecks(src);
  } catch (e) {
    const why = waiting<CheckValue>("crawl", failed(e));
    checks = CHECK_KEYS.map((key) => ({ key, label: CHECK_LABELS[key], reading: why, href: `/seo/report#${key}` }));
  }

  const body: SeoPayload = {
    range,
    specimen,
    tiles: await assembleTiles(src, range),
    scoreRule: scoreRule(),
    floors: {
      opportunities: src.opportunities.state === "ok" ? src.opportunities.value.floor : gsc.FLOOR.opportunities,
      ctr: src.outliers.state === "ok" ? src.outliers.value.floor : gsc.FLOOR.ctr,
      early: src.opportunities.state === "ok" ? (src.opportunities.value.early ?? null) : null,
    },
    ranking,
    opportunities,
    gaps,
    movements,
    checks,
    console: consoleView,
    landing,
    audit: auditState(),
    open: asked ? { query: asked, reading: await reading("gsc", () => assembleOpen(src, asked)) } : null,
  };
  return c.json(body);
});

const LISTS: readonly SeoListName[] = ["opportunities", "gaps", "movements", "landing"];

routes.get("/list/:name", async (c) => {
  const name = c.req.param("name") as SeoListName;
  if (!LISTS.includes(name)) return c.json({ error: `There is no SEO list called "${name}".` }, 404);
  const range = rangeOf(c.req.query("range"));
  const pagesKnown = crawlPages();
  const { src, specimen } = await sourcesFor(c, range, pagesKnown, { open: false });
  const groups = specimen ? SPECIMEN_GROUPS : gapGroups(pagesKnown);

  const make = async (): Promise<Reading<SeoListBody>> => {
    switch (name) {
      case "opportunities":
        return carry(opportunityList(src), (v) => ({ name, ...v }));
      case "gaps":
        return carry(gapRows(src, groups), (v) => ({ name, window: windowOf(v.window), floor: v.floor, early: v.early, rows: v.rows }));
      case "movements":
        return carry(moversRead(src), (v) => ({ name, window: windowOf(v.window), floor: v.floor, compared: v.compared ?? null, rows: movementRows(v.rows) }));
      case "landing":
        return carry(await assembleLanding(src, range, specimen ? [] : pagesKnown, 500), (landings) => ({ name, landings }));
    }
  };
  const body: SeoList = { name, range, specimen, reading: await reading("gsc", make) };
  return c.json(body);
});

routes.get("/report", async (c) => {
  const summary = await reading("crawl", () => site.crawlSummary());
  const body: SeoReport = {
    crawl: carry(summary, (s) => ({
      finished: s.finished,
      pages: s.pages,
      inSitemap: s.inSitemap,
      siteScore: s.siteScore,
      critical: s.issues.critical,
      warning: s.issues.warning,
      opportunity: s.issues.opportunity,
    })),
    sections: await reportSections(),
  };
  return c.json(body);
});

/* ---------- the full report ---------------------------------------------------------------- */

const shown = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/** Findings grouped by rule, heaviest severity first, in the order the crawl ranks them. */
function grouped(list: { rule: string; severity: site.Severity; path: string | null; text: string; measured: unknown; limit: unknown; related?: string[] }[]): ReportGroup[] {
  const by = new Map<string, ReportGroup>();
  for (const f of list) {
    const rule = (site.RULES as Record<string, { title: string; cost: number; scope: "page" | "site" } | undefined>)[f.rule];
    const g = by.get(f.rule) ?? { rule: f.rule, title: rule?.title ?? f.rule, severity: f.severity, cost: rule?.cost ?? 0, scope: rule?.scope ?? "page", findings: [] };
    const one: ReportFinding = { path: f.path, text: f.text, measured: shown(f.measured), limit: shown(f.limit), ...(f.related?.length ? { related: f.related } : {}) };
    g.findings.push(one);
    by.set(f.rule, g);
  }
  const rank: Record<site.Severity, number> = { critical: 0, warning: 1, opportunity: 2 };
  return [...by.values()].sort((a, b) => rank[a.severity] - rank[b.severity] || b.findings.length - a.findings.length);
}

function bodyOf(groups: ReportGroup[], facts: string[], none = "Nothing found."): ReportBody {
  const n = groups.reduce((s, g) => s + g.findings.length, 0);
  /* The tone follows the screen's one rule (`judged`): opportunities are
     listed here but never colour a section. */
  const weighed = groups.filter((g) => g.severity !== "opportunity");
  const worst = weighed.some((g) => g.severity === "critical") ? "bad" : weighed.some((g) => g.findings.length) ? "warn" : "good";
  return { tone: worst, summary: n ? `${plural(n, "finding")} under ${plural(groups.length, "rule")}.` : none, facts, groups };
}

async function reportSections(): Promise<ReportSection[]> {
  const at = quietly(() => site.crawledAt(), null);
  const map = quietly(() => site.lastSitemap(), null);
  const all = quietly(() => site.issues(), null);
  const list = all?.state === "ok" ? all.value : null;
  const section = (key: CheckKey | ReportOnlyKey, label: string, make: () => ReportBody | null): ReportSection => {
    if (!at || !list) return { key, label, reading: waiting("crawl", NOT_CRAWLED) };
    try {
      const b = make();
      return { key, label, reading: b ? ok(b, "crawl", at) : waiting("crawl", NOT_CRAWLED) };
    } catch (e) {
      return { key, label, reading: waiting("crawl", failed(e)) };
    }
  };
  const area = (pick: (f: Finding) => boolean) => grouped((list ?? []).filter(pick));

  const indexed = await reading("gsc", () => gsc.indexing());
  const indexSection: ReportSection = {
    key: "indexed",
    label: "Pages indexed",
    reading: carry(indexed, (v) => {
      const not = v.rows.filter((r) => !r.indexed);
      const differs = v.rows.filter((r) => r.canonicalOk === false);
      const groups: ReportGroup[] = [];
      if (not.length)
        groups.push({
          rule: "gsc.not-indexed",
          title: "Not in Google's index",
          severity: "warning",
          cost: 0,
          scope: "page",
          findings: not.map((r) => ({ path: r.path, text: r.coverage ? `Google says: ${r.coverage}.` : "Google reports it as not indexed.", measured: r.verdict, limit: "PASS" })),
        });
      if (differs.length)
        groups.push({
          rule: "gsc.canonical",
          title: "Google chose another canonical",
          severity: "warning",
          cost: 0,
          scope: "page",
          findings: differs.map((r) => ({ path: r.path, text: `The page declares ${r.userCanonical ?? "none"}; Google chose ${r.googleCanonical ?? "none"}.`, measured: r.googleCanonical, limit: r.userCanonical })),
        });
      return bodyOf(
        groups,
        [
          `${v.indexed} of ${v.inspected} inspected sitemap addresses are in Google's index (URL Inspection, ${v.day}).`,
          ...(v.complete ? [] : [`That day's check was cut short: ${v.inspected} of ${v.of ?? "the"} sitemap addresses have a result, so these counts are part of the site, not its total.`]),
        ],
        "Every inspected address is indexed.",
      );
    }),
  };

  return [
    indexSection,
    section("sitemap", "Sitemap", () => {
      if (!map) return null;
      const groups = grouped(map.issues.filter((i) => i.rule.startsWith("sitemap.") && i.rule !== "sitemap.blocked"));
      return bodyOf(groups, [map.status === 200 ? `sitemap.xml answers 200 and lists ${plural(map.entries.length, "address", "addresses")}.` : `sitemap.xml answers ${map.status || "nothing"}.`]);
    }),
    section("robots", "Robots.txt", () => {
      if (!map) return null;
      const groups = grouped(map.issues.filter((i) => i.rule.startsWith("robots.") || i.rule === "sitemap.blocked"));
      return bodyOf(groups, [
        `robots.txt answers ${map.robots.status || "nothing"}${map.robots.status === 200 ? ` with ${plural(map.robots.rules, "rule")} for every crawler` : ""}.`,
        map.robots.sitemaps.length ? `It names ${map.robots.sitemaps.join(", ")} as the sitemap.` : "It names no sitemap.",
      ]);
    }),
    section("canonical", "Canonical tags", () => bodyOf(area(LINE_RULES.canonical!), [])),
    section("titles", "Meta titles", () => bodyOf(area(LINE_RULES.titles!), [`A title over ${site.LIMITS.title} characters is cut in results (the desk's working limit; Google cuts by width).`])),
    section("descriptions", "Meta descriptions", () => bodyOf(area(LINE_RULES.descriptions!), [`A description over ${site.LIMITS.description} characters is cut in results.`])),
    section("schema", "Structured data (Schema)", () => {
      const types = site.schemaTypes();
      return bodyOf(
        area((f) => f.area === "schema"),
        [types.state === "ok" && types.value.length ? `Types on the site: ${types.value.map((t) => `${t.label} (${t.value})`).join(", ")}.` : "No structured-data type was found on any page."],
      );
    }),
    section("redirects", "Redirects (3xx)", () => {
      const checks = site.redirects();
      const tried = checks.state === "ok" ? checks.value : [];
      const working = tried.filter((r) => r.outcome === "ok").length;
      return bodyOf(area(LINE_RULES.redirects!), [
        tried.length ? `${plural(tried.length, "redirect")} the site promises ${tried.length === 1 ? "was" : "were"} tried at the last crawl: ${working} work in one hop.` : "The site promises no redirect the crawl could try.",
        ...tried.filter((r) => r.outcome !== "ok").map((r) => `${r.source} → ${r.destination}: ${r.remark}`),
      ]);
    }),
    section("broken", "Broken links (4xx)", () => {
      const inside = site.brokenLinks();
      const outside = site.externalLinks("broken");
      return bodyOf(area((f) => f.rule === "links.broken" || f.rule === "links.external-broken" || f.rule === "page.status"), [
        `${plural(inside.state === "ok" ? inside.value.length : 0, "address", "addresses")} on the site that links point to do not answer; ${plural(outside.state === "ok" ? outside.value.length : 0, "outside page")} linked from the site ${outside.state === "ok" && outside.value.length === 1 ? "is" : "are"} gone.`,
        "Other sites are asked at most once a week; one that refuses automated checks is “could not check”, not broken.",
      ]);
    }),
    section("internal", "Internal links", () => {
      const weak = oneLinkPages();
      const groups = area((f) => f.rule === "links.orphan");
      if (weak.length)
        groups.push({
          rule: "desk.one-link",
          title: "Only one page links here",
          severity: "opportunity",
          cost: 0,
          scope: "page",
          findings: weak.map((p) => ({ path: p.path, text: "In the sitemap, and only one other page links to it; one more link from a related page makes it easier to find.", measured: "1 link in", limit: "2 or more (the desk's yardstick)" })),
        });
      return bodyOf(groups, ["Links in the menu and footer count; a page's link to itself does not."], "Every page in the sitemap has at least two pages linking to it.");
    }),
    /* Everything else the crawl holds against a page, so the report is the complete list. */
    section("indexing-rules", "Indexing directives", () => bodyOf(area((f) => f.area === "indexing" || (f.area === "status" && f.rule !== "page.status" && f.rule !== "page.redirects")), [])),
    section("headings", "Headings", () => bodyOf(area((f) => f.area === "headings"), [])),
    section("content", "Content and language", () => bodyOf(area((f) => f.area === "content"), [`A page under ${site.LIMITS.thinWords} words of its own is thin by the desk's yardstick (Google names no number).`])),
    section("share", "Share pictures and cards", () => bodyOf(area((f) => f.area === "share"), [])),
    section("images", "Images", () => bodyOf(area((f) => f.area === "images"), [])),
  ];
}

/* ---------- the specimen: artificial rows, on a workstation only ---------------------------- */

/**
 * SPECIMEN DATA. Every row below is made up and named so that nobody can take
 * it for the website's: "specimen query 07", "/specimen/page-03", "Specimen
 * service A". The figures come from small formulas, not from any source. Only
 * `?specimen=1` on a workstation reaches this (see `specimenAllowed`).
 */
export const SPECIMEN_GROUPS: { path: string; label: string; kind: "service" | "segment" }[] = [
  { path: "/specimen/service-a", label: "Specimen service A", kind: "service" },
  { path: "/specimen/service-b", label: "Specimen service B", kind: "service" },
  { path: "/specimen/service-c", label: "Specimen service C", kind: "service" },
  { path: "/specimen/industry-a", label: "Specimen industry A", kind: "segment" },
  { path: "/specimen/industry-b", label: "Specimen industry B", kind: "segment" },
  { path: "/specimen/industry-c", label: "Specimen industry C", kind: "segment" },
  { path: "/specimen/industry-d", label: "Specimen industry D", kind: "segment" },
];

const SPECIMEN_NOTE = "Specimen: artificial rows made by formula on a workstation, not Google's or Bing's figures.";

const two = (n: number): string => String(n).padStart(2, "0");

/** The artificial Search Console and Bing readings for one range. */
export function specimenSearch(range: SeoRange, now: number = Date.now()): SearchSources {
  const days = DAYS[range];
  const end = shift(new Date(now).toISOString().slice(0, 10), -3);
  const start = shift(end, -(days - 1));
  const window: DayWindow = { start, end, previousStart: shift(start, -days), previousEnd: shift(start, -1), days };
  const at = new Date(now).toISOString();
  const said = <T>(value: T): Reading<T> => ok(value, "gsc", at, SPECIMEN_NOTE);
  const dates = Array.from({ length: days }, (_, i) => shift(start, i));

  /* Sixty queries: position, impressions and clicks by formula. */
  const queries: QueryRow[] = Array.from({ length: 60 }, (_, i) => {
    const position = Math.round((1.5 + ((i * 7) % 48) + (i % 3) * 0.4) * 10) / 10;
    const impressions = 40 + ((i * 53) % 900);
    const clicks = Math.max(0, Math.round((impressions * (position < 4 ? 0.09 : position < 11 ? 0.03 : 0.005)) / (1 + (i % 4))));
    const ctr = impressions ? Math.round((clicks / impressions) * 10000) / 100 : 0;
    const was = i % 5 === 4 ? null : { clicks: Math.max(0, clicks - (i % 7)), impressions: Math.max(1, impressions - ((i * 11) % 120)), ctr, position: Math.round((position + ((i % 9) - 3) * 1.5) * 10) / 10 };
    return { query: `specimen query ${two(i + 1)}`, clicks, impressions, ctr, position, previous: was };
  }).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);

  const pagesList: SearchPageRow[] = Array.from({ length: 24 }, (_, i) => {
    const impressions = 2400 - i * 90;
    const position = Math.round((3 + ((i * 5) % 22) + (i % 2) * 0.6) * 10) / 10;
    const clicks = Math.round(impressions * (position < 6 ? 0.05 : 0.012) - i);
    const path = i < SPECIMEN_GROUPS.length ? SPECIMEN_GROUPS[i]!.path : `/specimen/page-${two(i + 1)}`;
    return {
      page: `https://specimen.invalid${path}`,
      path,
      clicks: Math.max(0, clicks),
      impressions,
      ctr: Math.round((Math.max(0, clicks) / impressions) * 10000) / 100,
      position,
      previous: i % 6 === 5 ? null : { clicks: Math.max(0, clicks - 6), impressions: impressions - 80, ctr: 1, position: Math.round((position + ((i % 5) - 2)) * 10) / 10 },
    };
  });

  const landingOf = (i: number): string => (i % 3 === 0 ? SPECIMEN_GROUPS[i % SPECIMEN_GROUPS.length]!.path : `/specimen/page-${two((i % 17) + 1)}`);

  const totalsDays = dates.map((date, i) => {
    const impressions = 600 + ((i * 97) % 380) + i * 6;
    const clicks = 18 + ((i * 13) % 21) + Math.round(i / 3);
    return { date, clicks, impressions, ctr: Math.round((clicks / impressions) * 10000) / 100, position: Math.round((24 - i * 0.05 + (i % 4) * 0.3) * 10) / 10 };
  });
  const sumC = totalsDays.reduce((n, d) => n + d.clicks, 0);
  const sumI = totalsDays.reduce((n, d) => n + d.impressions, 0);
  const avgP = Math.round((totalsDays.reduce((n, d) => n + d.position * d.impressions, 0) / sumI) * 100) / 100;
  const totals: SearchTotals = {
    window,
    from: start,
    clicks: { value: sumC, previous: Math.round(sumC * 0.86), unit: "count", series: totalsDays.map((d) => d.clicks) },
    impressions: { value: sumI, previous: Math.round(sumI * 0.79), unit: "count", series: totalsDays.map((d) => d.impressions) },
    ctr: { value: Math.round((sumC / sumI) * 10000) / 100, previous: Math.round(((sumC * 0.86) / (sumI * 0.79)) * 10000) / 100, unit: "percent", series: totalsDays.map((d) => d.ctr) },
    position: { value: avgP, previous: Math.round((avgP + 1.4) * 100) / 100, unit: "ratio", series: totalsDays.map((d) => d.position) },
    days: totalsDays.map((d) => ({ ...d, previous: null })),
  };

  const buckets: PositionBuckets = {
    window,
    from: start,
    complete: true,
    days: dates.map((date, i) => {
      const top3 = 3 + ((i * 5) % 4) + Math.floor(i / 6);
      const top10 = top3 + 8 + ((i * 3) % 5) + Math.floor(i / 4);
      const top50 = top10 + 14 + ((i * 7) % 6) + Math.floor(i / 3);
      return { date, top3, top10, top50, queries: top50 + 4 };
    }),
  };

  const opportunities: Opportunity[] = queries
    .filter((r) => r.position >= 4 && r.position <= 20 && r.impressions >= 30)
    .sort((a, b) => b.impressions - a.impressions)
    .map((r, i) => ({ ...r, page: `https://specimen.invalid${landingOf(i)}`, path: landingOf(i) }));

  const outliers: CtrOutlier[] = pagesList.filter((_, i) => i % 4 === 1).map((p) => ({ page: p.page, path: p.path, clicks: p.clicks, impressions: p.impressions, ctr: p.ctr, position: p.position, median: 2.4, band: "4 to 6", peers: 5 }));

  const movers: Mover[] = [
    ...queries.filter((r) => r.previous && r.impressions >= 30).map((r) => ({ kind: "query" as const, key: r.query, previous: r.previous!.position, current: r.position, change: Math.round((r.previous!.position - r.position) * 10) / 10, impressions: r.impressions, previousImpressions: r.previous!.impressions, clicks: r.clicks })),
    ...pagesList.filter((p) => p.previous).map((p) => ({ kind: "page" as const, key: p.page, path: p.path, previous: p.previous!.position, current: p.position, change: Math.round((p.previous!.position - p.position) * 10) / 10, impressions: p.impressions, previousImpressions: p.previous!.impressions, clicks: p.clicks })),
  ]
    .filter((m) => Math.abs(m.change) >= 1)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

  const gapPath = (i: number): string => (i % 5 === 4 ? `/specimen/page-${two((i % 17) + 1)}` : SPECIMEN_GROUPS[(i * 3) % SPECIMEN_GROUPS.length]!.path);
  const gapsRows: Gap[] = queries
    .filter((_, i) => i % 3 !== 1)
    .map((r, i) => ({ query: r.query, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position, page: `https://specimen.invalid${gapPath(i)}`, path: gapPath(i) }))
    .sort((a, b) => b.impressions - a.impressions);

  const inspected = 40;
  const indexing: IndexReport = {
    day: today(),
    inspected,
    of: inspected,
    complete: true,
    indexed: 37,
    notIndexed: 3,
    canonicalDiffers: 1,
    rows: Array.from({ length: inspected }, (_, i) => ({
      url: `https://specimen.invalid/specimen/page-${two(i + 1)}`,
      path: `/specimen/page-${two(i + 1)}`,
      verdict: i < 3 ? "NEUTRAL" : "PASS",
      coverage: i < 3 ? "Specimen: crawled, currently not indexed" : "Specimen: submitted and indexed",
      lastCrawl: null,
      googleCanonical: null,
      userCanonical: null,
      robots: null,
      fetchState: null,
      indexing: null,
      indexed: i >= 3,
      canonicalOk: i === 5 ? false : null,
      link: null,
    })),
  };
  const history = dates.map((day, i) => ({ day, indexed: 28 + Math.floor((i * 9) / days), notIndexed: 6 - Math.floor((i * 3) / days) }));

  const links: LinkCounts = {
    total: pagesList.slice(0, 9).reduce((n, _p, i) => n + 30 - i * 3, 0),
    pages: pagesList.slice(0, 9).map((p, i) => ({ url: p.page, path: p.path, links: 30 - i * 3 })),
    complete: true,
  };

  return {
    totals: said(totals),
    buckets: said(buckets),
    queries: said({ window, rows: queries, complete: true }),
    previousQueries: said({ rows: queries.filter((r) => r.previous).map((r) => ({ query: r.query, position: r.previous!.position, impressions: r.previous!.impressions })) }),
    opportunities: said({ window, floor: 30, early: null, rows: opportunities }),
    outliers: said({ window, floor: 50, rows: outliers }),
    movers: said({ window, floor: 30, rows: movers }),
    gaps: said({ window, floor: 10, early: null, rows: gapsRows }),
    pages: said({ window, rows: pagesList, complete: true }),
    queryPages: said({ window, rows: queries.map((r, i) => ({ query: r.query, page: `https://specimen.invalid${landingOf(i)}`, path: landingOf(i), clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })), complete: true }),
    indexing: said(indexing),
    indexHistory: history,
    links: ok(links, "bing" as SourceId, at, SPECIMEN_NOTE),
    linkHistory: dates.map((day, i) => ({ day, links: links.total - Math.floor(((days - i) * 20) / days) })),
    consoleHref: "https://search.google.com/search-console",
  };
}
