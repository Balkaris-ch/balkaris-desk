import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { db } from "../../../db.ts";
import type { Person } from "../../../people.ts";
import { me, type Vars } from "../../access.ts";
import { createTask } from "../../operator/queue.ts";
import { status as jobStatus } from "../../scheduler.ts";
import { round } from "../../search/shared.ts";
import { note, off, ok, reading, today, waiting } from "../../store.ts";
import type { Reading, Stat } from "../../../../web/src/contract/common.ts";
import type { NewTask } from "../../../../web/src/contract/operator.ts";
import type { SeoRange, SeoSpan } from "../../../../web/src/contract/seo/common.ts";
import type {
  BriefQueued,
  ClusterSort,
  Intent,
  KeywordChanged,
  KeywordClusterRow,
  KeywordFacets,
  KeywordFlag,
  KeywordRow,
  KeywordsActed,
  KeywordSource,
  KeywordsQuery,
  KeywordsSort,
  KeywordStatus,
  KeywordTiles,
  KeywordWindow,
  PositionBand,
  ResearchState,
  SeoKeywordsPayload,
  SitePageOption,
} from "../../../../web/src/contract/seo/keywords.ts";
import { budget, clusters as allClusters, keywordById, keywords as allKeywords, lastResearch, setKeywordStatus, upsertKeyword, type Cluster, type Keyword } from "../../seo/keywords.ts";
import { bucketsByDay, daysOf, positionsByDay, queryFigures, queryPageFigures, RANGES, rate, spanOf, totals } from "../../seo/rank.ts";
import { ownTitle, siteView, type SiteView } from "../../seo/site.ts";
import { now } from "../../seo/tables.ts";
import { normal } from "../../seo/words.ts";
import { body, head, HISTORY_NOTE, historyAbsent, historyAt, int, rangeFrom } from "./shared.ts";

/**
 * /api/v1/seo/keywords — SEO › Keywords (board 113, panel 4): every phrase the
 * desk knows, with what Google shows for it, and the topic clusters they form.
 *
 *   GET /                          the whole screen (contract/seo/keywords.ts, SeoKeywordsPayload)
 *   GET /export.csv                the list as filtered, every matching row (?id=… repeated: only those)
 *   POST /                         { phrase, lang?, cluster?, target? }   a person tracks a phrase
 *   POST /:id/status               { status }                             a person's judgement
 *   POST /:id/page                 { path | null }                        a person's mapping
 *   POST /:id/target               { target }                             mark as a target, or not
 *   POST /:id/brief                {}                                     an operator brief for the phrase
 *   POST /bulk                     { ids, op }                            the ticked rows
 *   POST /clusters/:key/brief      {}                                     an operator brief for a cluster
 *
 * WHERE EACH COLUMN COMES FROM, each panel read on its own (`reading`), so a
 * missing source costs its own panel and nothing else:
 *
 *   the phrases, clusters,       the keyword store (src/cc/seo/keywords.ts):
 *   intent, judgement, mapping   Search Console queries, Google Autocomplete
 *                                research, the SEO audit's table, people
 *   impressions, clicks, CTR,    the desk's own daily copy of Search Console
 *   position, trend, new, lost   (src/cc/seo/rank.ts), all countries, every
 *                                device, over the head's range
 *   the mapped page's title      the desk's crawl
 *   opportunities                the opportunity engine (cc_seo_opps)
 *
 * NO INVENTED FIGURE. The board's "Volume" is Search Console's impressions for
 * the site, named as such: no free source gives search volume. There is no
 * difficulty column: nothing free measures it. A target is a person's mark,
 * nothing more.
 *
 * NOTHING HERE CHANGES THE WEBSITE. A mapping, a judgement and a target are
 * the desk's own records; a brief is an operator task answered on the studio
 * workstation, and a person writes and publishes the page.
 */
export const routes = new Hono<Vars>();

/*
 * The phrases a person marked as targets. This page's own record: a target is
 * a person's choice of what the site should rank for, kept beside the keyword
 * store and never set by a run or an import.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS cc_seo_kw_targets (
    keyword_id INTEGER PRIMARY KEY,
    by         TEXT NOT NULL,
    at         TEXT NOT NULL
  );
`);

const fail = (status: 400 | 404 | 409, message: string): never => {
  throw new HTTPException(status, { message });
};

/* ---------- the question ------------------------------------------------------------------- */

const SORTS: KeywordsSort[] = ["impressions", "position", "clicks", "ctr", "change", "phrase", "first-seen", "cluster"];
const INTENTS: Intent[] = ["commercial", "transactional", "informational", "local", "navigational"];
const SOURCES: KeywordSource[] = ["gsc", "autocomplete", "audit", "manual"];
const STATUSES: KeywordStatus[] = ["relevant", "weak", "irrelevant", "unjudged"];
const BANDS: PositionBand[] = ["1-3", "4-10", "11-20", "21-50", "51+", "none"];
const DEFAULT_STATUSES: KeywordStatus[] = ["relevant", "weak", "unjudged"];

const pick = <T extends string>(list: readonly T[], raw: string | undefined, fallback: T): T => (list.includes(raw as T) ? (raw as T) : fallback);

/** The direction a sort starts in: figures from the most, the position, the phrase and the cluster from the least. */
const firstDir = (sort: KeywordsSort): "asc" | "desc" => (sort === "position" || sort === "phrase" || sort === "cluster" ? "asc" : "desc");

/** An address as a path ("/x"), or null when it is not one. */
function pathParam(raw: string | undefined | null): string | null {
  const s = (raw ?? "").trim();
  if (!s || s.length > 300) return null;
  try {
    const p = s.startsWith("/") ? s.split(/[?#]/)[0]! : /^https?:\/\//i.test(s) ? new URL(s).pathname : `/${s.split(/[?#]/)[0]!}`;
    return p.replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
}

function queryOf(c: Context<Vars>, paged: boolean): KeywordsQuery {
  const r = (k: string) => c.req.query(k);
  const sort = pick(SORTS, r("sort"), "impressions");
  const page = (r("page") ?? "").trim();
  const status = r("status");
  return {
    view: r("view") === "clusters" ? "clusters" : "keywords",
    lang: pick(["de", "en", "all"] as const, r("lang"), "all"),
    intent: pick([...INTENTS, "all"] as const, r("intent"), "all"),
    cluster: (r("cluster") ?? "").trim().slice(0, 80),
    source: pick([...SOURCES, "all"] as const, r("source"), "all"),
    status: status === "all" ? "all" : pick([...STATUSES, "default"] as const, status, "default"),
    band: pick([...BANDS, "all"] as const, r("band"), "all"),
    shown: r("shown") === "1",
    target: r("target") === "1",
    flag: pick(["price", "question", "local", ""] as const, r("flag"), ""),
    page: page === "none" ? "none" : (pathParam(page) ?? ""),
    q: (r("q") ?? "").trim().slice(0, 80),
    sort,
    dir: r("dir") === "asc" ? "asc" : r("dir") === "desc" ? "desc" : firstDir(sort),
    clusterSort: pick(CLUSTER_SORTS, r("corder"), "rank"),
    offset: paged ? int(r("offset"), 0, 0, 100_000) : 0,
    limit: paged ? int(r("limit"), 25, 1, 500) : 100_000,
  };
}

const CLUSTER_SORTS: ClusterSort[] = ["rank", "impressions", "relevant", "opportunities"];

/** The clusters in the order asked: the audit's order of attack, or the most first (then the audit's order). */
function sortClusters(rows: KeywordClusterRow[], by: ClusterSort): KeywordClusterRow[] {
  const rank = (c: KeywordClusterRow) => c.rank ?? 9999;
  const most = (c: KeywordClusterRow): number => (by === "impressions" ? c.impressions : by === "relevant" ? c.relevant : by === "opportunities" ? c.opportunities : 0);
  return [...rows].sort((a, b) => most(b) - most(a) || rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/* ---------- Search Console, per phrase ------------------------------------------------------ */

interface Fig {
  clicks: number;
  impressions: number;
  position: number | null;
}

/** Google's figure per query over a window, merged under the keyword store's spelling of the phrase (normal()). */
function figsByPhrase(start: string, end: string): Map<string, Fig> {
  const by = new Map<string, { c: number; i: number; w: number }>();
  for (const q of queryFigures(start, end)) {
    const k = normal(q.query);
    const m = by.get(k) ?? { c: 0, i: 0, w: 0 };
    m.c += q.clicks;
    m.i += q.impressions;
    m.w += (q.position ?? 0) * q.impressions;
    by.set(k, m);
  }
  return new Map([...by].map(([k, m]) => [k, { clicks: m.c, impressions: m.i, position: m.i ? round(m.w / m.i, 1) : null }]));
}

/** Average position per day, per phrase, over a window (the history's covered days). Two spellings of one phrase: the first that has the day. */
function trendsByPhrase(start: string, end: string): Map<string, (number | null)[]> {
  const raw = queryFigures(start, end).map((q) => q.query);
  const out = new Map<string, (number | null)[]>();
  for (const [q, line] of positionsByDay(start, end, raw)) {
    const k = normal(q);
    const had = out.get(k);
    out.set(k, had ? had.map((v, i) => v ?? line[i] ?? null) : line);
  }
  return out;
}

/** The page Google showed most for each phrase over the window. */
function shownPageByPhrase(start: string, end: string): Map<string, string> {
  const best = new Map<string, { path: string; impressions: number }>();
  for (const r of queryPageFigures(start, end)) {
    const k = normal(r.query);
    const had = best.get(k);
    if (!had || r.impressions > had.impressions) best.set(k, { path: r.path, impressions: r.impressions });
  }
  return new Map([...best].map(([k, v]) => [k, v.path]));
}

interface Search {
  span: SeoSpan;
  now: Map<string, Fig>;
  /** The window before, query by query; null when it is not compared (`notCompared` says why). */
  before: Map<string, Fig> | null;
  /** Why the window before is not compared query by query, or null when it is. */
  notCompared: string | null;
  /** Not compared because Google withheld every query of the window before (not because the history is short). */
  withheld: boolean;
  /** The shorter periods whose window before is compared, as the period select names them: what a person can choose instead. */
  comparable: string[];
  /** The property's own figures over the window: every query together, the ones Google withheld too. */
  total: Fig;
  trends: Map<string, (number | null)[]>;
  shown: Map<string, string>;
}

/** A day as a sentence prints it: "1 Aug". */
const dayName = (d: string): string => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * The window before, query by query, or why it cannot be compared. Two ways it
 * cannot: the desk's history does not cover it from its first day, or Search
 * Console counted impressions in it but reported no query at all (every query
 * withheld as rare). An empty list is then not a count of zero: "0 → 17" or
 * "17 new" against it would be invented.
 */
function beforeOf(span: SeoSpan): { before: Map<string, Fig> | null; notCompared: string | null; withheld: boolean } {
  if (!span.compared) {
    return {
      before: null,
      notCompared: `The desk's own Search Console history begins ${span.historyFrom ? dayName(span.historyFrom) : "later"}, after the start of the ${span.days} days before this window (${dayName(span.previousStart)}).`,
      withheld: false,
    };
  }
  const before = figsByPhrase(span.previousStart, span.previousEnd);
  const was = totals(span.previousStart, span.previousEnd);
  if (!before.size && was.impressions > 0) {
    return {
      before: null,
      notCompared: `Search Console reported no query for ${dayName(span.previousStart)} – ${dayName(span.previousEnd)}, though it counted ${plural(was.impressions, "impression")} then; Google withholds rare queries, so which it showed then is not known.`,
      withheld: true,
    };
  }
  return { before, notCompared: null, withheld: false };
}

/** As the head's period select names them (web/src/lib/format.ts, rangeLabel). */
const RANGE_NAME: Record<SeoRange, string> = { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", "1y": "Last 12 months" };

/** The periods shorter than `range` whose window before is compared query by query. */
function comparableBelow(range: SeoRange): string[] {
  return RANGES.filter((r) => daysOf(r) < daysOf(range))
    .filter((r) => {
      const s = spanOf(r);
      return !!s && beforeOf(s).before !== null;
    })
    .map((r) => RANGE_NAME[r]);
}

function searchOf(range: SeoRange): Reading<Search> {
  const span = spanOf(range);
  if (!span) return historyAbsent();
  const was = beforeOf(span);
  return ok(
    {
      span,
      now: figsByPhrase(span.start, span.end),
      ...was,
      comparable: was.before ? [] : comparableBelow(range),
      total: totals(span.start, span.end),
      trends: trendsByPhrase(span.start, span.end),
      shown: shownPageByPhrase(span.start, span.end),
    },
    "gsc",
    historyAt(),
    HISTORY_NOTE,
  );
}

const bandOf = (p: number | null): PositionBand => (p === null ? "none" : p <= 3 ? "1-3" : p <= 10 ? "4-10" : p <= 20 ? "11-20" : p <= 50 ? "21-50" : "51+");

/* ---------- the rows ------------------------------------------------------------------------- */

interface Desk {
  kw: Keyword[];
  cls: Cluster[];
  clusterBy: Map<string, Cluster>;
  targets: Map<number, { by: string; at: string }>;
  oppsByKeyword: Map<string, number>;
  oppsByCluster: Map<string, number>;
  statusBy: Map<number, string | null>;
}

function deskOf(): Desk {
  const kw = allKeywords();
  const cls = allClusters();
  const targets = new Map(
    (db.prepare("SELECT keyword_id, by, at FROM cc_seo_kw_targets").all() as { keyword_id: number; by: string; at: string }[]).map((r) => [r.keyword_id, { by: r.by, at: r.at }]),
  );
  const oppsByKeyword = new Map<string, number>();
  const oppsByCluster = new Map<string, number>();
  try {
    for (const r of db
      .prepare("SELECT keyword, cluster, COUNT(*) AS n FROM cc_seo_opps WHERE active = 1 AND state IN ('open', 'queued', 'in-progress') GROUP BY keyword, cluster")
      .all() as { keyword: string | null; cluster: string | null; n: number }[]) {
      if (r.keyword) oppsByKeyword.set(normal(r.keyword), (oppsByKeyword.get(normal(r.keyword)) ?? 0) + r.n);
      if (r.cluster) oppsByCluster.set(r.cluster, (oppsByCluster.get(r.cluster) ?? 0) + r.n);
    }
  } catch {
    /* the engine's table is not there yet: no counts */
  }
  const statusBy = new Map((db.prepare("SELECT id, status_by FROM cc_seo_keywords").all() as { id: number; status_by: string | null }[]).map((r) => [r.id, r.status_by]));
  return { kw, cls, clusterBy: new Map(cls.map((c) => [c.key, c])), targets, oppsByKeyword, oppsByCluster, statusBy };
}

function rowOf(k: Keyword, d: Desk, view: SiteView, s: Search | null): KeywordRow {
  const fig = s?.now.get(k.phrase) ?? null;
  const prev = s?.before?.get(k.phrase) ?? null;
  const cl = k.cluster ? d.clusterBy.get(k.cluster) : undefined;
  const page = k.page ? view.byPath.get(k.page) : undefined;
  const shownNow = fig && fig.impressions > 0 ? fig : null;
  return {
    id: k.id,
    phrase: k.phrase,
    lang: k.lang,
    cluster: k.cluster ? { key: k.cluster, name: cl?.name ?? k.cluster } : null,
    intent: k.intent,
    sources: k.sources,
    status: k.status,
    statusBy: d.statusBy.get(k.id) ?? null,
    page: k.page,
    mappedBy: k.mappedBy,
    pageTitle: ownTitle(page?.title),
    pageKnown: !!page,
    shownPage: shownNow ? (s?.shown.get(k.phrase) ?? null) : null,
    impressions: shownNow ? shownNow.impressions : null,
    clicks: shownNow ? shownNow.clicks : null,
    ctr: shownNow ? rate(shownNow.clicks, shownNow.impressions) : null,
    position: shownNow ? shownNow.position : null,
    previousPosition: prev && prev.impressions > 0 ? prev.position : null,
    trend: [],
    flags: k.flags,
    target: d.targets.get(k.id) ?? null,
    opportunities: d.oppsByKeyword.get(k.phrase) ?? 0,
    firstSeen: k.firstSeen,
  };
}

/** Only these statuses, by the question's status filter. */
const statusPasses = (q: KeywordsQuery) => (r: KeywordRow): boolean => (q.status === "all" ? true : q.status === "default" ? DEFAULT_STATUSES.includes(r.status) : r.status === q.status);

function words(q: string): string[] {
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
}

/** The filters a facet can be counted without. */
type Facet = "status" | "lang" | "intent" | "cluster" | "source" | "band" | "shown" | "target" | "flag" | "page";

/** Every filter of the question, but `skip`: a facet's counts are over the rows every other filter lets through. */
function passes(q: KeywordsQuery, r: KeywordRow, skip?: Facet): boolean {
  if (skip !== "status" && !statusPasses(q)(r)) return false;
  if (skip !== "lang" && q.lang !== "all" && r.lang !== q.lang) return false;
  if (skip !== "intent" && q.intent !== "all" && r.intent !== q.intent) return false;
  if (skip !== "cluster" && (q.cluster === "none" ? r.cluster !== null : q.cluster && r.cluster?.key !== q.cluster)) return false;
  if (skip !== "source" && q.source !== "all" && !r.sources.includes(q.source)) return false;
  if (skip !== "band" && q.band !== "all" && bandOf(r.position) !== q.band) return false;
  if (skip !== "shown" && q.shown && r.impressions === null) return false;
  if (skip !== "target" && q.target && !r.target) return false;
  if (skip !== "flag" && q.flag && !r.flags[q.flag]) return false;
  if (skip !== "page" && (q.page === "none" ? r.page !== null : q.page && r.page !== q.page)) return false;
  const w = words(q.q);
  if (w.length && !w.every((x) => r.phrase.includes(x))) return false;
  return true;
}

/** Sorted with what has no value last, whichever the direction. */
function sortRows(rows: KeywordRow[], q: KeywordsQuery, clusterRank: Map<string, number>): KeywordRow[] {
  const sign = q.dir === "asc" ? 1 : -1;
  const value = (r: KeywordRow): number | string | null => {
    switch (q.sort) {
      case "impressions":
        return r.impressions;
      case "position":
        return r.position;
      case "clicks":
        return r.clicks;
      case "ctr":
        return r.ctr?.value ?? null;
      case "change":
        return r.position !== null && r.previousPosition !== null ? round(r.previousPosition - r.position, 1) : null;
      case "phrase":
        return r.phrase;
      case "first-seen":
        return r.firstSeen;
      case "cluster":
        return r.cluster ? (clusterRank.get(r.cluster.key) ?? 9999) : null;
    }
  };
  /* Between equals: the audit's order of attack for the cluster, then the phrase. */
  const tie = (a: KeywordRow, b: KeywordRow): number =>
    (a.cluster ? (clusterRank.get(a.cluster.key) ?? 9999) : 10_000) - (b.cluster ? (clusterRank.get(b.cluster.key) ?? 9999) : 10_000) || a.phrase.localeCompare(b.phrase);
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null && vb === null) return tie(a, b);
    if (va === null) return 1;
    if (vb === null) return -1;
    const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return c ? c * sign : tie(a, b);
  });
}

function facetsOf(all: KeywordRow[], q: KeywordsQuery, d: Desk): KeywordFacets {
  const over = (skip: Facet): KeywordRow[] => all.filter((r) => passes(q, r, skip));
  const count = <K extends string>(skip: Facet, keys: (r: KeywordRow) => (K | null)[]): Map<K, number> => {
    const m = new Map<K, number>();
    for (const r of over(skip)) for (const k of keys(r)) if (k !== null) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  };
  const langs = count("lang", (r) => [r.lang]);
  const intents = count("intent", (r) => [r.intent]);
  const sources = count("source", (r) => r.sources);
  const clusters = count("cluster", (r) => [r.cluster?.key ?? null]);
  const bands = count("band", (r) => [bandOf(r.position)]);
  const pages = count("page", (r) => [r.page ?? "none"]);
  const statuses = count("status", (r) => [r.status]);
  const flagBase = over("flag");
  return {
    langs: [...langs].sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ key, count: n })),
    intents: INTENTS.filter((k) => intents.has(k)).map((key) => ({ key, count: intents.get(key)! })),
    sources: SOURCES.filter((k) => sources.has(k)).map((key) => ({ key, count: sources.get(key)! })),
    statuses: STATUSES.filter((k) => statuses.has(k)).map((key) => ({ key, count: statuses.get(key)! })),
    clusters: d.cls.filter((c) => clusters.has(c.key)).map((c) => ({ key: c.key, name: c.name, lang: c.lang, count: clusters.get(c.key)! })),
    bands: BANDS.filter((k) => bands.has(k)).map((key) => ({ key, count: bands.get(key)! })),
    pages: [...pages].sort((a, b) => (a[0] === "none" ? -1 : b[0] === "none" ? 1 : b[1] - a[1] || a[0].localeCompare(b[0]))).map(([path, n]) => ({ path, count: n })),
    targets: over("target").filter((r) => r.target).length,
    shown: over("shown").filter((r) => r.impressions !== null).length,
    flags: Object.fromEntries((["price", "question", "local"] as KeywordFlag[]).map((k) => [k, flagBase.filter((r) => r.flags[k]).length])) as Record<KeywordFlag, number>,
  };
}

/* ---------- the tiles ------------------------------------------------------------------------ */

const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

function tilesOf(all: KeywordRow[], d: Desk, s: Reading<Search>, range: SeoRange, days: number): KeywordTiles {
  /* Total: the keyword store itself, now. Compared only when the table already existed at the start of the same span before today. */
  const total: Reading<Stat> = (() => {
    const tracked = all.filter((r) => DEFAULT_STATUSES.includes(r.status));
    const irrelevant = all.length - tracked.length;
    const first = d.kw.map((k) => k.firstSeen).sort()[0] ?? null;
    const before = today(-days);
    const previous = first && first.slice(0, 10) <= before ? tracked.filter((r) => r.firstSeen.slice(0, 10) <= before).length : null;
    return ok<Stat>(
      {
        value: tracked.length,
        previous,
        unit: "count",
        series: [],
        sub: `of ${all.length.toLocaleString("en-GB")} in the table; ${irrelevant.toLocaleString("en-GB")} judged irrelevant`,
      },
      "desk",
      now(),
      `The keyword store: Search Console queries, Google Autocomplete research, the SEO audit's table and phrases people add. Counted: relevant, weak and not yet judged.${first ? ` The table began ${first.slice(0, 10)}.` : ""}`,
    );
  })();
  if (s.state !== "ok") return { total, shown: s, newQueries: s, lostQueries: s, topTen: s };
  const { span, now: figs, before, notCompared, total: property } = s.value;
  const shownNow = [...figs.values()].filter((f) => f.impressions > 0);
  /* Null when the window before is not compared: never a zero standing in for "not known". */
  const shownBefore = before ? [...before.values()].filter((f) => f.impressions > 0) : null;
  const buckets = bucketsByDay(span.start, span.end);
  const impressions = shownNow.reduce((n, f) => n + f.impressions, 0);
  const at = historyAt();
  const unCompared = notCompared ? ` Not compared with the ${span.days} days before: ${notCompared}` : "";
  const shown = ok<Stat>(
    {
      value: shownNow.length,
      previous: shownBefore ? shownBefore.length : null,
      unit: "count",
      series: buckets.map((b) => b.queries),
      /* The queries Google reported carry only part of the window's impressions: say both, so this is never read as the site's total. */
      sub:
        property.impressions > impressions
          ? `${plural(impressions, "impression")} of the window's ${property.impressions.toLocaleString("en-GB")}; Google withholds rare queries`
          : `${plural(impressions, "impression")} in all`,
    },
    "gsc",
    at,
    `${HISTORY_NOTE} The bars: queries shown each day.${unCompared}`,
  );
  const topTen = ok<Stat>(
    {
      value: shownNow.filter((f) => f.position !== null && f.position <= 10).length,
      previous: shownBefore ? shownBefore.filter((f) => f.position !== null && f.position <= 10).length : null,
      unit: "count",
      series: buckets.map((b) => b.top10),
      sub: `${shownNow.filter((f) => f.position !== null && f.position <= 3).length} in the top 3`,
    },
    "gsc",
    at,
    `Average position 1 to 10 over the window, weighted by impressions. ${HISTORY_NOTE}${unCompared}`,
  );
  if (!before) {
    const instead = s.value.comparable.length ? `${s.value.comparable.join(" or ")} compares: choose it in the period select.` : undefined;
    /* Withheld: Search Console cannot give it for that window ("Not available"). A short history: it comes as the days pass ("Nothing yet"). */
    const why = s.value.withheld
      ? off<Stat>("gsc", notCompared ?? "", instead)
      : waiting<Stat>("gsc", `${notCompared ?? "The window before is not covered."}${instead ? ` ${instead}` : ""}`);
    return { total, shown, topTen, newQueries: why, lostQueries: why };
  }
  /* By the keyword store's spelling (normal()), as the rows are: the same phrase written twice is one. */
  const added = [...figs].filter(([k, f]) => f.impressions > 0 && !(before.get(k)?.impressions ?? 0)).length;
  const lost = [...before].filter(([k, f]) => f.impressions > 0 && !(figs.get(k)?.impressions ?? 0)).length;
  return {
    total,
    shown,
    topTen,
    newQueries: ok<Stat>(
      { value: added, previous: null, unit: "count", series: [], sub: `shown in this window, not in the ${span.days} days before` },
      "gsc",
      at,
      HISTORY_NOTE,
    ),
    lostQueries: ok<Stat>(
      { value: lost, previous: null, unit: "count", series: [], sub: `shown in the ${span.days} days before, not since` },
      "gsc",
      at,
      HISTORY_NOTE,
    ),
  };
}

/* ---------- the clusters -------------------------------------------------------------------- */

function clusterRows(all: KeywordRow[], d: Desk, view: SiteView, q: KeywordsQuery): KeywordClusterRow[] {
  const by = new Map<string, KeywordRow[]>();
  for (const r of all) if (r.cluster) by.set(r.cluster.key, [...(by.get(r.cluster.key) ?? []), r]);
  const w = words(q.q);
  return d.cls
    .filter((c) => (q.lang === "all" || c.lang === q.lang) && (q.intent === "all" || c.intent === q.intent))
    .map((c): KeywordClusterRow => {
      const rows = by.get(c.key) ?? [];
      const shown = rows.filter((r) => r.impressions !== null);
      const page = c.page ? view.byPath.get(c.page) : undefined;
      const best = shown.map((r) => r.position).filter((p): p is number => p !== null);
      const top = shown.length
        ? [...shown].sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0)).map((r) => r.phrase)
        : [...new Set([...rows.filter((r) => r.status === "relevant").map((r) => r.phrase), ...c.examples.map(normal)])];
      return {
        key: c.key,
        name: c.name,
        lang: c.lang,
        intent: c.intent,
        priority: c.priority,
        rank: c.rank,
        page: c.page,
        pageTitle: ownTitle(page?.title),
        mappedBy: c.mappedBy,
        pageSaid: c.pageSaid,
        gap: !c.page || !page || (!!page.lang && page.lang !== c.lang),
        phrases: rows.length,
        relevant: rows.filter((r) => r.status === "relevant").length,
        targets: rows.filter((r) => r.target).length,
        shown: shown.length,
        impressions: shown.reduce((n, r) => n + (r.impressions ?? 0), 0),
        clicks: shown.reduce((n, r) => n + (r.clicks ?? 0), 0),
        bestPosition: best.length ? Math.min(...best) : null,
        top: top.slice(0, 4),
        flags: { price: rows.filter((r) => r.flags.price).length, question: rows.filter((r) => r.flags.question).length, local: rows.filter((r) => r.flags.local).length },
        opportunities: d.oppsByCluster.get(c.key) ?? 0,
        why: c.why,
        action: c.action,
      };
    })
    .filter((c) => !w.length || w.every((x) => c.name.toLowerCase().includes(x) || (by.get(c.key) ?? []).some((r) => r.phrase.includes(x))));
}

/* ---------- research, sources, pages --------------------------------------------------------- */

function researchOf(): ResearchState {
  const b = budget();
  const last = lastResearch();
  const job = jobStatus().find((j) => j.name === "seo-research");
  const found = (db.prepare("SELECT COUNT(*) AS n FROM cc_seo_keywords WHERE seed IS NOT NULL").get() as { n: number }).n;
  return {
    used: b.used,
    cap: b.cap,
    week: b.week,
    lastRun: job?.lastEnd ?? last?.at ?? null,
    lastNote: job?.lastNote ?? null,
    nextRun: job?.enabled ? (job.nextRun ?? null) : null,
    found,
    foundLast: last?.added ?? 0,
    line: `Google Autocomplete: ${b.used} of ${b.cap} requests this week (${b.week}); at most 20 a run, one a second.`,
  };
}

const SOURCE_LINE: Record<KeywordSource, { label: string; line: string }> = {
  gsc: { label: "Search Console", line: "Google showed the site for it. New queries flow in after each daily snapshot, unjudged." },
  autocomplete: { label: "Google Autocomplete", line: "Found by the research (the desk's daily run, or the audit's own), as people type it." },
  audit: { label: "SEO audit", line: "The audit's keyword table, with its judgement, cluster, intent and page." },
  manual: { label: "Added by a person", line: "Tracked from this page." },
};

function sourcesOf(kw: Keyword[]): SeoKeywordsPayload["sources"] {
  return SOURCES.map((key) => ({ key, label: SOURCE_LINE[key].label, count: kw.filter((k) => k.sources.includes(key)).length, line: SOURCE_LINE[key].line }));
}

function sitePagesOf(view: SiteView): Reading<SitePageOption[]> {
  if (!view.at) return waiting("crawl", "The crawl has not read the website yet, so there is no page to map to. It runs within minutes of the desk starting.");
  return ok(
    view.pages
      .filter((p) => p.status === 200)
      .map((p) => ({ path: p.path, title: ownTitle(p.title), lang: p.lang }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    "crawl",
    view.at,
  );
}

/* ---------- the screen --------------------------------------------------------------------- */

interface Screen {
  payload: SeoKeywordsPayload;
  /** Every row matching the filters, in order (for the export). */
  matching: KeywordRow[];
}

async function screen(c: Context<Vars>, paged: boolean): Promise<Screen> {
  const range = rangeFrom(c);
  const q = queryOf(c, paged);
  const h = head(range);
  const view = siteView();
  const search = await reading<Search>("gsc", () => searchOf(range));
  const s = search.state === "ok" ? search.value : null;

  let desk: Desk | null = null;
  let deskFail: string | null = null;
  try {
    desk = deskOf();
  } catch (e) {
    deskFail = (e instanceof Error ? e.message : String(e)).slice(0, 160);
  }
  const broken = <T>(): Reading<T> => waiting("desk", `The keyword store could not be read: ${deskFail ?? "unknown"}.`);

  const all = desk ? desk.kw.map((k) => rowOf(k, desk!, view, s)) : [];
  const clusterRank = new Map((desk?.cls ?? []).map((cl, i) => [cl.key, cl.rank ?? 1000 + i]));
  const matching = sortRows(
    all.filter((r) => passes(q, r)),
    q,
    clusterRank,
  );
  const shownRows = matching.slice(q.offset, q.offset + q.limit);
  if (s) for (const r of shownRows) r.trend = s.trends.get(r.phrase) ?? [];

  const list: SeoKeywordsPayload["list"] = !desk
    ? broken()
    : !all.length
      ? waiting(
          "desk",
          "The keyword store is empty: phrases come from Search Console's snapshot, the weekly Google Autocomplete research and the SEO audit's table (npm run seo:import on this machine, or the owner's POST /api/v1/seo/imports/audit).",
        )
      : ok({ total: matching.length, offset: q.offset, limit: q.limit, rows: shownRows }, "desk", now(), s ? `Search figures: ${HISTORY_NOTE}` : undefined);

  const targets: Reading<KeywordRow[]> = !desk
    ? broken()
    : ok(
        all
          .filter((r) => r.target)
          .sort((a, b) => (b.impressions ?? -1) - (a.impressions ?? -1) || a.phrase.localeCompare(b.phrase))
          .map((r) => ({ ...r, trend: s?.trends.get(r.phrase) ?? [] })),
        "desk",
        now(),
      );

  const clusters: SeoKeywordsPayload["clusters"] =
    q.view !== "clusters" ? null : !desk ? broken() : await reading("desk", () => {
      const rows = sortClusters(clusterRows(all, desk!, view, q), q.clusterSort);
      return ok(
        { total: rows.length, offset: q.offset, limit: q.limit, rows: rows.slice(q.offset, q.offset + q.limit), gaps: rows.filter((c) => c.gap).length },
        "desk",
        now(),
        s ? `Search figures: ${HISTORY_NOTE}` : undefined,
      );
    });

  const searchWindow: Reading<KeywordWindow> =
    search.state === "ok"
      ? ok(
          {
            start: search.value.span.start,
            end: search.value.span.end,
            days: search.value.span.days,
            previousStart: search.value.span.compared ? search.value.span.previousStart : null,
            previousEnd: search.value.span.compared ? search.value.span.previousEnd : null,
            historyFrom: search.value.span.historyFrom,
            queriesCompared: search.value.before !== null,
            notCompared: search.value.span.compared ? search.value.notCompared : null,
            impressions: search.value.total.impressions,
          },
          "gsc",
          search.asOf,
          search.note,
        )
      : search;

  const empty: KeywordFacets = { langs: [], intents: [], sources: [], statuses: [], clusters: [], bands: [], pages: [], targets: 0, shown: 0, flags: { price: 0, question: 0, local: 0 } };
  const facets = desk ? facetsOf(all, q, desk) : empty;

  const payload: SeoKeywordsPayload = {
    head: h,
    tiles: desk
      ? tilesOf(all, desk, search, range, h.span?.days ?? 30)
      : { total: broken(), shown: broken(), newQueries: broken(), lostQueries: broken(), topTen: broken() },
    facets,
    list,
    research: (() => {
      try {
        return researchOf();
      } catch {
        return { used: 0, cap: 0, week: "", lastRun: null, lastNote: null, nextRun: null, found: 0, foundLast: 0, line: "The research's state could not be read." };
      }
    })(),
    asked: q,
    search: searchWindow,
    clusters,
    clusterTotal: desk?.cls.length ?? 0,
    topics: (desk?.cls ?? []).map((c) => ({ key: c.key, name: c.name, lang: c.lang })),
    targets,
    sitePages: sitePagesOf(view),
    sources: desk ? sourcesOf(desk.kw) : [],
  };
  return { payload, matching };
}

routes.get("/", async (c) => c.json<SeoKeywordsPayload>((await screen(c, true)).payload));

/* ---------- GET /export.csv ------------------------------------------------------------------- */

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  let s = String(v);
  /* A spreadsheet runs a cell that starts like a formula. */
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

routes.get("/export.csv", async (c) => {
  const s = await screen(c, false);
  if (s.payload.list.state !== "ok") return c.json({ error: `There is nothing to export yet: ${s.payload.list.reason}` }, 409);
  const only = new Set(c.req.queries("id")?.map(Number).filter(Number.isInteger) ?? []);
  const rows = only.size ? s.matching.filter((r) => only.has(r.id)) : s.matching;
  const w = s.payload.search.state === "ok" ? `${s.payload.search.value.start} to ${s.payload.search.value.end}` : "not available";
  const head = [
    "Phrase",
    "Language",
    "Cluster",
    "Intent",
    "Judged",
    "Target",
    "Sources",
    "Mapped page",
    "Mapped by",
    "Page Google showed",
    `Impressions (Search Console, ${w})`,
    "Clicks",
    "CTR %",
    "Average position",
    "Position, window before",
    "First seen",
  ];
  const lines = [head.map(cell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.phrase,
        r.lang,
        r.cluster?.name,
        r.intent,
        r.status,
        r.target ? `yes (${r.target.by})` : "",
        r.sources.join(" "),
        r.page,
        r.mappedBy,
        r.shownPage,
        r.impressions,
        r.clicks,
        r.ctr?.value ?? null,
        r.position,
        r.previousPosition,
        r.firstSeen.slice(0, 10),
      ]
        .map(cell)
        .join(","),
    );
  }
  return c.body(`${lines.join("\r\n")}\r\n`, 200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="balkaris-keywords-${today()}.csv"`,
    "cache-control": "no-store",
  });
});

/* ---------- changes --------------------------------------------------------------------------- */

const idOf = (raw: string): number => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : fail(400, "A keyword's id is a whole number.");
};

const keywordOf = (id: number): Keyword => keywordById(id) ?? fail(404, `There is no keyword ${id}.`);

const quote = (s: string): string => `“${s.length > 60 ? `${s.slice(0, 59)}…` : s}”`;

function setTarget(id: number, on: boolean, by: Person): string {
  const k = keywordOf(id);
  if (on) {
    db.prepare("INSERT INTO cc_seo_kw_targets (keyword_id, by, at) VALUES (?, ?, ?) ON CONFLICT(keyword_id) DO NOTHING").run(id, by.name, now());
    /* A phrase worth ranking for is relevant: a person's judgement, said in the answer. */
    const judged = k.status !== "relevant" && k.status !== "weak";
    if (judged) setKeywordStatus(id, "relevant", by.name);
    return `${quote(k.phrase)} is a target${judged ? ", and judged relevant" : ""}.`;
  }
  db.prepare("DELETE FROM cc_seo_kw_targets WHERE keyword_id = ?").run(id);
  return `${quote(k.phrase)} is no longer a target.`;
}

function setStatus(id: number, status: KeywordStatus, by: Person): string {
  const k = keywordOf(id);
  setKeywordStatus(id, status, by.name);
  return `${quote(k.phrase)} judged ${status}.`;
}

routes.post("/", async (c) => {
  const b = await body(c);
  const raw = typeof b.phrase === "string" ? normal(b.phrase) : "";
  if (raw.length < 2 || raw.length > 120) fail(400, "Write the phrase as people search it: 2 to 120 characters.");
  if (/[<>]/.test(raw)) fail(400, "A search phrase has no < or >.");
  const lang = b.lang === "de" || b.lang === "en" ? b.lang : b.lang === undefined || b.lang === null || b.lang === "" ? null : fail(400, "lang is de, en, or left out.");
  const cluster = typeof b.cluster === "string" && b.cluster ? b.cluster : null;
  if (cluster && !allClusters().some((x) => x.key === cluster)) fail(400, `There is no cluster ${cluster}.`);
  const who = me(c);
  const got = upsertKeyword({ phrase: raw, lang, cluster, source: "manual", status: "relevant", by: who.name });
  const k = (db.prepare("SELECT id FROM cc_seo_keywords WHERE phrase = ?").get(raw) as { id: number } | undefined) ?? fail(409, "The phrase could not be kept.");
  let line: string;
  if (got === "added") line = `Tracking ${quote(raw)}.`;
  else {
    /*
     * Already in the table: upsertKeyword keeps an existing phrase's judgement
     * (only the audit replaces the desk's own). Tracking it is a person's word
     * that it is relevant, so say so here, as the dialog promises; a run or an
     * import never changes a person's judgement again.
     */
    const had = keywordOf(k.id);
    const rejudged = had.status !== "relevant";
    if (rejudged) setKeywordStatus(k.id, "relevant", who.name);
    const kept = [cluster && had.cluster && had.cluster !== cluster ? "its topic" : null, lang && had.lang && had.lang !== lang ? "its language" : null].filter(Boolean);
    line = [
      `${quote(raw)} was already in the table`,
      rejudged ? `; now judged relevant by you (it was ${had.status === "unjudged" ? "not judged" : `judged ${had.status}`})` : "",
      got === "changed" ? "; it now says a person added it too" : "",
      kept.length ? `; it keeps ${kept.join(" and ")}` : "",
      ".",
    ].join("");
  }
  if (b.target === true) line = `${line} ${setTarget(k.id, true, who)}`;
  if (got === "added") note("seo-action", `Started tracking the search ${quote(raw)}`, { tone: "info", actor: who.name, href: `/seo/keywords?q=${encodeURIComponent(raw)}&status=all`, dedupe: `seo:kw:add:${k.id}` });
  return c.json<KeywordChanged>({ ok: true, id: k.id, line });
});

routes.post("/bulk", async (c) => {
  const b = await body(c);
  const op = b.op;
  if (op !== "target" && op !== "untarget" && op !== "relevant" && op !== "weak" && op !== "irrelevant") fail(400, "op is target, untarget, relevant, weak or irrelevant.");
  if (!Array.isArray(b.ids) || !b.ids.length) fail(400, "Send `ids`, a list of keyword ids.");
  const ids = [...new Set((b.ids as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length > 200) fail(400, "At most 200 at once.");
  const who = me(c);
  const results: KeywordsActed["results"] = [];
  for (const id of ids) {
    try {
      const line = op === "target" ? setTarget(id, true, who) : op === "untarget" ? setTarget(id, false, who) : setStatus(id, op as KeywordStatus, who);
      results.push({ id, ok: true, line });
    } catch (e) {
      results.push({ id, ok: false, line: e instanceof Error ? e.message : String(e) });
    }
  }
  return c.json<KeywordsActed>({ ok: true, results });
});

routes.post("/:id/status", async (c) => {
  const id = idOf(c.req.param("id"));
  const b = await body(c);
  const status = STATUSES.includes(b.status as KeywordStatus) ? (b.status as KeywordStatus) : fail(400, `status is one of ${STATUSES.join(", ")}.`);
  return c.json<KeywordChanged>({ ok: true, id, line: setStatus(id, status, me(c)) });
});

routes.post("/:id/target", async (c) => {
  const id = idOf(c.req.param("id"));
  const b = await body(c);
  if (typeof b.target !== "boolean") fail(400, "target must be true or false.");
  return c.json<KeywordChanged>({ ok: true, id, line: setTarget(id, b.target as boolean, me(c)) });
});

routes.post("/:id/page", async (c) => {
  const id = idOf(c.req.param("id"));
  const k = keywordOf(id);
  const b = await body(c);
  if (b.path !== null && typeof b.path !== "string") fail(400, "path is one of the site's addresses (starting with /), or null: no page answers it.");
  const path = b.path === null ? null : (pathParam(b.path as string) ?? fail(400, "path is one of the site's addresses, starting with /."));
  if (path) {
    const p = siteView().byPath.get(path);
    if (!p || p.status !== 200) fail(400, `The crawl reads no page answering at ${path}.`);
  }
  const who = me(c);
  /* A person's mapping, kept by every run and import (keywords.ts: byPerson); "no page" is a person's word too. */
  db.prepare("UPDATE cc_seo_keywords SET page = ?, mapped_by = ? WHERE id = ?").run(path, who.name, id);
  return c.json<KeywordChanged>({ ok: true, id, line: path ? `${quote(k.phrase)} is answered by ${path}.` : `${quote(k.phrase)}: no page answers it (a gap), by your word.` });
});

/* ---------- briefs ----------------------------------------------------------------------------- */

const LANG_NAME: Record<string, string> = { de: "German", en: "English" };
const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** What Search Console measured for a phrase over the last 30 days of the history, in words; null without a history. */
function measured(phrase: string): string | null {
  const span = spanOf("30d");
  if (!span) return null;
  const f = figsByPhrase(span.start, span.end).get(phrase);
  if (!f || !f.impressions) return `Google did not show the site for it from ${span.start} to ${span.end}.`;
  return `Search Console, ${span.start} to ${span.end}: shown ${plural(f.impressions, "time")}, ${plural(f.clicks, "click")}, average position ${f.position ?? "?"}.`;
}

async function queueBrief(task: NewTask, by: Person, what: string, href: string, dedupe: string): Promise<BriefQueued> {
  const t = await createTask(task, by);
  note("seo-action", `Asked for a brief: ${what}`, { tone: "info", actor: by.name, detail: `Operator task #${t.id}; it runs on the studio workstation when it is on.`, href, dedupe: `${dedupe}:${t.id}` });
  return { ok: true, task: { id: t.id, title: t.title }, line: `Queued as operator task #${t.id}: it runs on the studio workstation when it is on.` };
}

routes.post("/:id/brief", async (c) => {
  const id = idOf(c.req.param("id"));
  const k = keywordOf(id);
  const cl = k.cluster ? allClusters().find((x) => x.key === k.cluster) : undefined;
  const view = siteView();
  const page = k.page ? view.byPath.get(k.page) : undefined;
  const lang = k.lang ? LANG_NAME[k.lang] : null;
  const prompt = [
    `A page for the search “${k.phrase}”${lang ? ` (${lang}${k.lang === "de" ? ", for Swiss readers: de-CH" : ""})` : ""}${k.intent ? `, ${k.intent} intent` : ""}${cl ? `, in the topic “${cl.name}”` : ""}.`,
    page ? `Today ${k.page}${ownTitle(page.title) ? ` (“${ownTitle(page.title)}”)` : ""} answers it; say whether to improve that page or write a new one.` : "No page of the site answers it yet.",
    measured(k.phrase) ?? "",
    "What the page must answer first, its sections and questions, the facts it needs from the studio (leave every price and figure for the owner to fill in), and the internal links that should point to it.",
  ]
    .filter(Boolean)
    .join(" ");
  const got = await queueBrief({ kind: "brief", prompt: truncate(prompt.replace(/\s+/g, " ").trim(), 990), depth: "deep" }, me(c), quote(k.phrase), `/seo/keywords?q=${encodeURIComponent(k.phrase)}&status=all`, `seo:kw:brief:${id}`);
  return c.json<BriefQueued>(got);
});

routes.post("/clusters/:key/brief", async (c) => {
  const key = c.req.param("key");
  const cl = allClusters().find((x) => x.key === key) ?? fail(404, `There is no cluster ${key}.`);
  const phrases = (db.prepare("SELECT phrase FROM cc_seo_keywords WHERE cluster = ? AND status = 'relevant' ORDER BY id LIMIT 12").all(key) as { phrase: string }[]).map((r) => r.phrase);
  const list = [...new Set([...phrases, ...cl.examples.map(normal)])].slice(0, 10);
  const view = siteView();
  const page = cl.page ? view.byPath.get(cl.page) : undefined;
  const gap = !page || (!!page.lang && page.lang !== cl.lang);
  const lang = LANG_NAME[cl.lang] ?? cl.lang;
  const prompt = [
    `A ${lang}${cl.lang === "de" ? " (de-CH)" : ""} page for the topic “${cl.name}”${cl.intent ? `, ${cl.intent} intent` : ""}, answering these searches: ${list.map((p) => `“${p}”`).join(", ")}.`,
    gap ? `No ${lang} page of the site answers it yet${page ? ` (${cl.page} is in another language)` : ""}.` : `Today ${cl.page} answers it; say what to add or rewrite.`,
    cl.why ? `Why it matters, as the SEO audit put it: ${cl.why}` : "",
    "What the page must answer first, its sections and questions, the facts it needs from the studio (leave every price and figure for the owner to fill in), and the internal links that should point to it.",
  ]
    .filter(Boolean)
    .join(" ");
  const got = await queueBrief({ kind: "brief", prompt: truncate(prompt.replace(/\s+/g, " ").trim(), 990), depth: "deep" }, me(c), `the topic ${quote(cl.name)}`, `/seo/keywords?view=clusters&q=${encodeURIComponent(cl.name)}`, `seo:cluster:brief:${key}`);
  return c.json<BriefQueued>(got);
});
