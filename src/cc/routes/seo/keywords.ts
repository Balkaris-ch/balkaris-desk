import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { db } from "../../../db.ts";
import type { Person } from "../../../people.ts";
import { me, type Vars } from "../../access.ts";
import { createTask } from "../../operator/queue.ts";
import { runNow, status as jobStatus } from "../../scheduler.ts";
import { round } from "../../search/shared.ts";
import { note, off, ok, reading, today, waiting } from "../../store.ts";
import type { Reading, Stat } from "../../../../web/src/contract/common.ts";
import type { NewTask } from "../../../../web/src/contract/operator.ts";
import type { KeywordVolume, ResearchMode, ResearchResult, SeoRange, SeoSpan, WebLang } from "../../../../web/src/contract/seo/common.ts";
import type {
  BriefQueued,
  ClusterSort,
  Intent,
  KeptSerp,
  KeywordChanged,
  KeywordClusterRow,
  KeywordDetail,
  KeywordFacets,
  KeywordFlag,
  KeywordRow,
  KeywordsActed,
  KeywordSource,
  KeywordsQuery,
  KeywordsSort,
  KeywordStatus,
  KeywordsTracked,
  KeywordTiles,
  KeywordWindow,
  PositionBand,
  Researched,
  ResearchPanel,
  ResearchState,
  SeoKeywordsPayload,
  SerpView,
  SitePageOption,
  TopicChanged,
  VolumeState,
} from "../../../../web/src/contract/seo/keywords.ts";
import {
  addTopic,
  budget,
  clusters as allClusters,
  editKeyword,
  isLang,
  keywordById,
  keywords as allKeywords,
  langOfPhrase,
  lastResearch,
  latestGoogleByPhrase,
  releaseClusterPage,
  releaseKeywordPage,
  removeKeyword,
  renameTopic,
  setClusterPage,
  setKeywordStatus,
  topicFor,
  topicKey,
  trackResearched,
  upsertKeyword,
  type Cluster,
  type KeptGoogle,
  type Keyword,
} from "../../seo/keywords.ts";
import { bucketsByDay, daysOf, positionsByDay, queryFigures, queryPageFigures, querySeries, RANGES, rate, spanOf, totals, type Where } from "../../seo/rank.ts";
import { ownTitle, siteView, type SiteView } from "../../seo/site.ts";
import { json, now } from "../../seo/tables.ts";
import * as web from "../../seo/web/index.ts";
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
 *   …and the web research, who ranks, the local AI, editing and topics:
 *   every address with its body is in web/src/contract/seo/keywords.ts.
 *
 * THE WEB. Research and result pages come from the web layer
 * (src/cc/seo/web/, work/audit/FOUNDATION-API.md): its allowances, pauses
 * and refusal sentences are passed on as they are. A GET never asks the web:
 * it draws what a person's POST researched (kept here seven days), or what the
 * web layer kept, and says what researching would cost.
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
 * NO INVENTED FIGURE. Search volume only where somebody gave a number (the
 * owner's Keyword Planner export, or DataForSEO once connected), always with
 * its source and day; otherwise the column is Search Console's impressions,
 * named as such. Difficulty is DataForSEO's when bought; "competition" is the
 * desk's own reading of a kept Google page (ads, map pack), named so. A target
 * is a person's mark, nothing more.
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

/*
 * The briefs asked from this page, per phrase: so a row shows its brief after
 * a reload, and a second brief is refused while the first is still on its way.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS cc_seo_kw_briefs (
    keyword_id INTEGER NOT NULL,
    task_id    INTEGER NOT NULL,
    by         TEXT NOT NULL,
    at         TEXT NOT NULL,
    PRIMARY KEY (keyword_id, task_id)
  );
`);

/*
 * A person's web research as it was answered, seven days: the address
 * ?research= draws it again without asking the web (a reload, a shared link).
 * The web layer keeps the engines' raw answers; this keeps the merged result.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS cc_seo_kw_research (
    key    TEXT PRIMARY KEY,
    result TEXT NOT NULL,
    by     TEXT NOT NULL,
    at     TEXT NOT NULL
  );
`);

const fail = (status: 400 | 403 | 404 | 409, message: string): never => {
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
  const open = Number(r("open"));
  const modes = (r("rmodes") ?? "")
    .split(",")
    .filter((m): m is ResearchMode => (web.ALL_MODES as readonly string[]).includes(m));
  const research = normal(r("research") ?? "").slice(0, 80);
  return {
    view: r("view") === "clusters" ? "clusters" : "keywords",
    lang: pick(["de", "en", "fr", "it", "all"] as const, r("lang"), "all"),
    where: r("where") === "che" ? "che" : "all",
    device: pick(["desktop", "mobile", "tablet", "all"] as const, r("device"), "all"),
    moved: pick(["new", "lost", ""] as const, r("moved"), ""),
    open: Number.isInteger(open) && open > 0 ? open : null,
    research,
    rlang: web.asLang(r("rlang") ?? langOfPhrase(research) ?? "de"),
    rmodes: modes.length ? web.ALL_MODES.filter((m) => modes.includes(m)) : [...web.DEFAULT_MODES],
    serp: normal(r("serp") ?? "").slice(0, 120),
    slang: web.asLang(r("slang") ?? langOfPhrase(normal(r("serp") ?? "")) ?? "de"),
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
function figsByPhrase(start: string, end: string, o: Where = {}): Map<string, Fig> {
  const by = new Map<string, { c: number; i: number; w: number }>();
  for (const q of queryFigures(start, end, o)) {
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
function trendsByPhrase(start: string, end: string, o: Where = {}): Map<string, (number | null)[]> {
  const raw = queryFigures(start, end, o).map((q) => q.query);
  const out = new Map<string, (number | null)[]>();
  for (const [q, line] of positionsByDay(start, end, raw, o)) {
    const k = normal(q);
    const had = out.get(k);
    out.set(k, had ? had.map((v, i) => v ?? line[i] ?? null) : line);
  }
  return out;
}

/** The page Google showed most for each phrase over the window. */
function shownPageByPhrase(start: string, end: string, o: Where = {}): Map<string, string> {
  const best = new Map<string, { path: string; impressions: number }>();
  for (const r of queryPageFigures(start, end, o)) {
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
  /** The country and device the figures are for. */
  where: Where;
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
function beforeOf(span: SeoSpan, o: Where = {}): { before: Map<string, Fig> | null; notCompared: string | null; withheld: boolean } {
  if (!span.compared) {
    return {
      before: null,
      notCompared: `The desk's own Search Console history begins ${span.historyFrom ? dayName(span.historyFrom) : "later"}, after the start of the ${span.days} days before this window (${dayName(span.previousStart)}).`,
      withheld: false,
    };
  }
  const before = figsByPhrase(span.previousStart, span.previousEnd, o);
  const was = totals(span.previousStart, span.previousEnd, o);
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
function comparableBelow(range: SeoRange, o: Where = {}): string[] {
  return RANGES.filter((r) => daysOf(r) < daysOf(range))
    .filter((r) => {
      const s = spanOf(r);
      return !!s && beforeOf(s, o).before !== null;
    })
    .map((r) => RANGE_NAME[r]);
}

function searchOf(range: SeoRange, o: Where = {}): Reading<Search> {
  const span = spanOf(range);
  if (!span) return historyAbsent();
  const was = beforeOf(span, o);
  return ok(
    {
      span,
      now: figsByPhrase(span.start, span.end, o),
      ...was,
      comparable: was.before ? [] : comparableBelow(range, o),
      total: totals(span.start, span.end, o),
      trends: trendsByPhrase(span.start, span.end, o),
      shown: shownPageByPhrase(span.start, span.end, o),
      where: o,
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
  volumes: Map<number, KeywordVolume>;
  kept: Map<string, KeptGoogle>;
  briefs: Map<number, { task: number; state: string; at: string }>;
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
  /* Demand figures belong to the web layer: a failure there costs that column, not the list. */
  let volumes: Desk["volumes"] = new Map();
  try {
    volumes = web.allVolumes();
  } catch {
    /* no volume columns yet */
  }
  return { kw, cls, clusterBy: new Map(cls.map((c) => [c.key, c])), targets, oppsByKeyword, oppsByCluster, statusBy, volumes, kept: latestGoogleByPhrase(), briefs: briefsByKeyword() };
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
    volume: d.volumes.get(k.id) ?? null,
    kept: keptOf(d.kept.get(k.phrase)),
    brief: d.briefs.get(k.id) ?? null,
    removable: k.sources.length > 0 && k.sources.every((x) => x === "manual"),
  };
}

/** The briefs asked from this page, newest per phrase, with where each task stands. */
function briefsByKeyword(): Map<number, { task: number; state: string; at: string }> {
  const out = new Map<number, { task: number; state: string; at: string }>();
  let rows: { keyword_id: number; task_id: number; at: string; state: string | null }[];
  try {
    rows = db
      .prepare("SELECT b.keyword_id, b.task_id, b.at, t.state FROM cc_seo_kw_briefs b LEFT JOIN cc_ai_tasks t ON t.id = b.task_id ORDER BY b.at DESC")
      .all() as typeof rows;
  } catch {
    return out;
  }
  for (const r of rows) if (!out.has(r.keyword_id)) out.set(r.keyword_id, { task: r.task_id, state: r.state ?? "gone", at: r.at });
  return out;
}

/**
 * The desk's own "competition" reading of a kept Google page: ads and a map
 * pack above the organic results push them down, so more of either is a
 * harder page. Named as the desk's own; never a vendor's difficulty.
 */
function keptOf(k: KeptGoogle | undefined): KeptSerp | null {
  if (!k) return null;
  const level: KeptSerp["competition"] = k.ads >= 3 || (k.ads >= 1 && k.localPack) ? "high" : k.ads >= 1 || k.localPack ? "medium" : "low";
  const above = [k.ads ? plural(k.ads, "ad") : "no ads", k.localPack ? "a map pack" : "no map pack"].join(" and ");
  return {
    check: k.id,
    at: k.doneAt,
    ownPosition: k.ownPosition,
    competition: level,
    line: `The desk's own reading of Google's page of ${dayName(k.doneAt.slice(0, 10))}: ${above} above the results; ${k.ownPosition ? `Balkaris at ${k.ownPosition}` : "Balkaris not in the first ten"}.`,
  };
}

/** Only these statuses, by the question's status filter. */
const statusPasses = (q: KeywordsQuery) => (r: KeywordRow): boolean => (q.status === "all" ? true : q.status === "default" ? DEFAULT_STATUSES.includes(r.status) : r.status === q.status);

/**
 * One spelling for comparing: lower case, accents and umlauts folded (ü, ue
 * and u are one letter here, as are ß and ss), quotation marks dropped. The
 * asked words and the phrases are folded alike, so "zuerich", "zürich" and
 * "zurich" find each other.
 */
const folded = new Map<string, string>();
function fold(s: string): string {
  let f = folded.get(s);
  if (f === undefined) {
    f = s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/ß/g, "ss")
      .replace(/ae/g, "a")
      .replace(/oe/g, "o")
      .replace(/ue/g, "u")
      .replace(/["'“”„«»‘’]/g, "");
    if (folded.size > 20_000) folded.clear();
    folded.set(s, f);
  }
  return f;
}

/** The asked words, folded; a one-letter word is left out (it is in nearly every phrase). */
function words(q: string): string[] {
  return fold(q)
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 6);
}

/** Every asked word is in the phrase, or in the phrase written without spaces ("webdesign" finds "web design"). */
function hasWords(phrase: string, w: string[]): boolean {
  if (!w.length) return true;
  const f = fold(phrase);
  const tight = f.replace(/\s+/g, "");
  return w.every((x) => f.includes(x) || tight.includes(x));
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
  if (q.moved === "new" && !(r.impressions !== null && r.previousPosition === null)) return false;
  if (q.moved === "lost" && !(r.impressions === null && r.previousPosition !== null)) return false;
  return hasWords(r.phrase, words(q.q));
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
  const buckets = bucketsByDay(span.start, span.end, s.value.where);
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
    .filter((c) => !w.length || hasWords(c.name, w) || (by.get(c.key) ?? []).some((r) => hasWords(r.phrase, w)));
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
    sentLast: last?.sent ?? 0,
    canRun: !!job && job.enabled && job.ready !== false,
    line: `Google's suggestions: ${b.used} of ${b.cap} requests this week (${b.week}); at most 20 a run, one a second.`,
  };
}

const SOURCE_LINE: Record<KeywordSource, { label: string; line: string }> = {
  gsc: { label: "Search Console", line: "Google showed the site for it. New queries flow in after each daily snapshot, unjudged." },
  autocomplete: { label: "Web research", line: "Found in Google's or Bing's suggestions: by the desk's daily run, a person's research on this page, or the audit's own." },
  audit: { label: "SEO audit", line: "The audit's keyword table, with its judgement, cluster, intent and page." },
  manual: { label: "Added by a person", line: "Tracked from this page, typed or ticked in a research." },
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

/* ---------- research on the web ------------------------------------------------------------------ */

const KEEP_RESEARCH_MS = 7 * 86_400_000;
const researchKey = (seed: string, lang: string, modes: readonly string[]): string => `${lang}|ch|${[...modes].sort().join(",")}|${seed}`;

function keepResearch(r: ResearchResult, by: string): void {
  db.prepare("INSERT INTO cc_seo_kw_research (key, result, by, at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET result = excluded.result, by = excluded.by, at = excluded.at").run(
    researchKey(r.seed, r.lang, r.modes),
    JSON.stringify(r),
    by,
    now(),
  );
  db.prepare("DELETE FROM cc_seo_kw_research WHERE at < ?").run(new Date(Date.now() - KEEP_RESEARCH_MS).toISOString());
}

function keptResearch(seed: string, lang: string, modes: readonly string[]): { result: ResearchResult; by: string; at: string } | null {
  const r = db.prepare("SELECT result, by, at FROM cc_seo_kw_research WHERE key = ?").get(researchKey(seed, lang, modes)) as { result: string; by: string; at: string } | undefined;
  if (!r || Date.now() - Date.parse(r.at) > KEEP_RESEARCH_MS) return null;
  const result = json<ResearchResult | null>(r.result, null);
  return result ? { result, by: r.by, at: r.at } : null;
}

/** The table changes after a research (rows tracked, refiled, judged): each suggestion's row and topic are read again. */
function freshMarks(r: ResearchResult): ResearchResult {
  if (!r.suggestions.length) return r;
  const list = r.suggestions.map((s) => s.phrase);
  const rows = new Map(
    (db.prepare(`SELECT id, phrase, status, cluster FROM cc_seo_keywords WHERE phrase IN (${list.map(() => "?").join(",")})`).all(...list) as { id: number; phrase: string; status: KeywordStatus; cluster: string | null }[]).map((x) => [x.phrase, x]),
  );
  const file = web.filer();
  return {
    ...r,
    suggestions: r.suggestions.map((s) => {
      const t = rows.get(s.phrase);
      return { ...s, tracked: t ? { id: t.id, status: t.status, cluster: t.cluster } : null, cluster: file(s.phrase, langOfPhrase(s.phrase, r.lang)) };
    }),
  };
}

/** The research box and the asked phrase's answer. Never asks the web: only a person's POST does. */
async function lookupOf(q: KeywordsQuery, by: string): Promise<ResearchPanel> {
  const paused = (["google", "bing"] as const).flatMap((source) => {
    const p = web.sourcePaused(source);
    return p ? [{ source, until: p.until, why: p.why }] : [];
  });
  const allowance = web.researchAllowance();
  const base = { seed: q.research, lang: q.rlang, modes: q.rmodes, allowance, paused, lane: web.googleLane() };
  if (!q.research) return { ...base, result: null, cost: null };
  if (q.research.length < 2) return { ...base, result: off("desk", "Type the phrase to research: 2 to 80 characters."), cost: null };
  const cost = web.researchCost(q.research, q.rlang, "ch", q.rmodes);
  const had = keptResearch(q.research, q.rlang, q.rmodes);
  if (had) return { ...base, cost, result: ok(freshMarks(had.result), "desk", had.result.asOf, `Researched by ${had.by}, ${dayName(had.at.slice(0, 10))}. The engines' answers are kept seven days.`) };
  /* Every part answered in the last seven days: drawing it sends nothing. */
  if (cost.send === 0) {
    try {
      const r = await web.researchPhrase({ seed: q.research, lang: q.rlang, modes: q.rmodes, by });
      keepResearch(r, by);
      return { ...base, cost, result: ok(r, "desk", r.asOf) };
    } catch (e) {
      return { ...base, cost, result: off("desk", e instanceof Error ? e.message : String(e)) };
    }
  }
  return {
    ...base,
    cost,
    result: off(
      "desk",
      `“${q.research}” was not researched this way in the last seven days. Researching it sends ${plural(cost.send, "request")} to Google's and Bing's suggestions, one a second${cost.kept ? `; ${plural(cost.kept, "more")} are answered from the last seven days` : ""}. Today ${allowance.left} of ${allowance.cap} are left.`,
      "Press Research.",
    ),
  };
}

/* ---------- who ranks --------------------------------------------------------------------------- */

/** Who ranks for a phrase: the newest kept pages, what is on its way, the history, the Google lane. */
function serpViewOf(phrase: string, lang: WebLang): SerpView {
  const latest = web.latestSerp(phrase, lang);
  const g = latest.google;
  const page = g?.page;
  return {
    phrase,
    lang,
    tracked: (db.prepare("SELECT id FROM cc_seo_keywords WHERE phrase = ?").get(phrase) as { id: number } | undefined)?.id ?? null,
    google: g,
    duckduckgo: latest.duckduckgo,
    pending: latest.pending,
    history: web.serpHistory(phrase, { lang, limit: 12 }),
    lane: web.googleLane(),
    kept: g && page && g.doneAt ? keptOf({ id: g.id, lang: g.lang, doneAt: g.doneAt, ownPosition: g.ownPosition, ads: page.ads, localPack: page.localPack.length > 0, source: g.source }) : null,
  };
}

/* ---------- one keyword's own view ------------------------------------------------------------- */

type Day = { date: string; clicks: number; impressions: number; position: number | null };

/** Days of several spellings of one phrase, added up; the position weighted by impressions. */
function sumDays(lists: Day[][]): Day[] {
  const by = new Map<string, { c: number; i: number; w: number }>();
  for (const list of lists) {
    for (const d of list) {
      const m = by.get(d.date) ?? { c: 0, i: 0, w: 0 };
      m.c += d.clicks;
      m.i += d.impressions;
      m.w += (d.position ?? 0) * d.impressions;
      by.set(d.date, m);
    }
  }
  return [...by]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, m]) => ({ date, clicks: m.c, impressions: m.i, position: m.i ? round(m.w / m.i, 1) : null }));
}

function detailOf(id: number, all: KeywordRow[], d: Desk, range: SeoRange, o: Where, s: Search | null): Reading<KeywordDetail> {
  const found = all.find((r) => r.id === id);
  if (!found) return off("desk", `There is no keyword ${id} in the table: it may have been taken out.`);
  const row: KeywordRow = { ...found, trend: s?.trends.get(found.phrase) ?? [] };
  const k = d.kw.find((x) => x.id === id)!;
  const span = spanOf(range);
  const spellings = span ? [...new Set(queryFigures(span.start, span.end, o).map((x) => x.query))].filter((x) => normal(x) === row.phrase) : [];
  const series: KeywordDetail["series"] = !span ? historyAbsent() : ok(sumDays(spellings.map((x) => querySeries(x, span.start, span.end, o))), "gsc", historyAt(), HISTORY_NOTE);
  const pages: KeywordDetail["pages"] = !span
    ? historyAbsent()
    : ok(
        (() => {
          const by = new Map<string, { c: number; i: number; w: number }>();
          for (const r of queryPageFigures(span.start, span.end, o)) {
            if (normal(r.query) !== row.phrase) continue;
            const m = by.get(r.path) ?? { c: 0, i: 0, w: 0 };
            m.c += r.clicks;
            m.i += r.impressions;
            m.w += (r.position ?? 0) * r.impressions;
            by.set(r.path, m);
          }
          return [...by].map(([path, m]) => ({ path, clicks: m.c, impressions: m.i, position: m.i ? round(m.w / m.i, 1) : null })).sort((a, b) => b.impressions - a.impressions);
        })(),
        "gsc",
        historyAt(),
        HISTORY_NOTE,
      );
  const cl = row.cluster ? d.clusterBy.get(row.cluster.key) : undefined;
  const briefs = (() => {
    try {
      return (
        db
          .prepare("SELECT b.task_id, b.by, b.at, t.state FROM cc_seo_kw_briefs b LEFT JOIN cc_ai_tasks t ON t.id = b.task_id WHERE b.keyword_id = ? ORDER BY b.at DESC LIMIT 10")
          .all(id) as { task_id: number; by: string; at: string; state: string | null }[]
      ).map((b) => ({ task: b.task_id, state: b.state ?? "gone", at: b.at, by: b.by }));
    } catch {
      return [];
    }
  })();
  return ok(
    {
      row,
      series,
      pages,
      serp: serpViewOf(row.phrase, web.asLang(row.lang ?? langOfPhrase(row.phrase) ?? "de")),
      seed: k.seed,
      found: (db.prepare("SELECT id, phrase, status FROM cc_seo_keywords WHERE seed = ? AND id <> ? ORDER BY id DESC LIMIT 30").all(row.phrase, id) as { id: number; phrase: string; status: KeywordStatus }[]).map((x) => ({ ...x })),
      topic: cl ? { key: cl.key, name: cl.name, lang: cl.lang, page: cl.page } : null,
      briefs,
      editedBy: (db.prepare("SELECT edited_by FROM cc_seo_keywords WHERE id = ?").get(id) as { edited_by: string | null } | undefined)?.edited_by ?? null,
    },
    "desk",
    now(),
  );
}

function volumesOf(d: Desk | null): VolumeState {
  const v = d ? [...d.volumes.values()] : [];
  let configured = false;
  let step: string | null = null;
  try {
    configured = web.dataforseoConfigured();
    step = configured ? null : web.dataforseoStep();
  } catch {
    step = "DataForSEO's state could not be read.";
  }
  return { withVolume: v.filter((x) => x.volume !== null || x.low !== null).length, withDifficulty: v.filter((x) => x.difficulty).length, dataforseo: { configured, step } };
}

/* ---------- the screen --------------------------------------------------------------------- */

interface Screen {
  payload: SeoKeywordsPayload;
  /** Every row matching the filters, in order (for the export). */
  matching: KeywordRow[];
}

async function screen(c: Context<Vars>, paged: boolean): Promise<Screen> {
  const who = me(c);
  const range = rangeFrom(c);
  const q = queryOf(c, paged);
  const h = head(range);
  const view = siteView();
  const where: Where = { country: q.where, device: q.device === "all" ? null : q.device };
  const search = await reading<Search>("gsc", () => searchOf(range, where));
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
          "The keyword store is empty: phrases come from Search Console's snapshot, the daily research of Google's suggestions (with a weekly budget), a person's research on this page and the SEO audit's table (npm run seo:import on this machine, or the owner's POST /api/v1/seo/imports/audit).",
        )
      : q.moved && !s?.before
        ? off("gsc", `New and lost phrases need the window before compared query by query. ${s?.notCompared ?? "Search Console's figures are not available."}`, s?.comparable.length ? `Choose ${s.comparable.join(" or ")} in the period select.` : undefined)
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
        return { used: 0, cap: 0, week: "", lastRun: null, lastNote: null, nextRun: null, found: 0, foundLast: 0, sentLast: 0, canRun: false, line: "The research's state could not be read." };
      }
    })(),
    lookup: await lookupOf(q, who.name),
    serp: q.serp.length >= 2 ? serpViewOf(q.serp, q.slang) : null,
    open: q.open === null ? null : desk ? detailOf(q.open, all, desk, range, where, s) : broken(),
    volumes: volumesOf(desk),
    canImport: who.owner,
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
  /* Ids sent but none of them a keyword's: no rows, never the whole list. */
  const asked = c.req.queries("id");
  const only = new Set(asked?.map(Number).filter(Number.isInteger) ?? []);
  const rows = asked?.length ? s.matching.filter((r) => only.has(r.id)) : s.matching;
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
    "Monthly searches",
    "Searches, range",
    "Volume source and day",
    "Difficulty (DataForSEO)",
    "Competition (the desk's own reading of Google's page)",
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
        r.volume?.volume ?? null,
        r.volume && r.volume.low !== null ? `${r.volume.low}-${r.volume.high ?? ""}` : null,
        r.volume ? `${r.volume.source === "planner" ? "Keyword Planner" : "DataForSEO"} ${r.volume.at.slice(0, 10)}` : null,
        r.volume?.difficulty?.value ?? null,
        r.kept ? `${r.kept.competition} (${r.kept.at.slice(0, 10)})` : null,
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
  if (b.path === "auto") {
    const got = releaseKeywordPage(id);
    return c.json<KeywordChanged>({ ok: true, id, line: `${quote(k.phrase)}: the desk decides its page again${got?.page ? `; it now maps it to ${got.page}` : "; no page of its language answers it by the desk's rule"}.` });
  }
  if (b.path !== null && typeof b.path !== "string") fail(400, "path is one of the site's addresses (starting with /), null (no page answers it), or \"auto\" (let the desk decide).");
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

const LANG_NAME: Record<string, string> = { de: "German", en: "English", fr: "French", it: "Italian" };
const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** What Search Console measured for a phrase over the last 30 days of the history, in words; null without a history. */
function measured(phrase: string): string | null {
  const span = spanOf("30d");
  if (!span) return null;
  const f = figsByPhrase(span.start, span.end).get(phrase);
  if (!f || !f.impressions) return `Google did not show the site for it from ${span.start} to ${span.end}.`;
  return `Search Console, ${span.start} to ${span.end}: shown ${plural(f.impressions, "time")}, ${plural(f.clicks, "click")}, average position ${f.position ?? "?"}.`;
}

/**
 * The operator keeps a brief's first 300 characters as its question (src/cc/operator/queue.ts,
 * titleFor), and its own brief instructions do the rest (sections, questions, links, no invented
 * figure). So a brief from this page says the essentials first and stops at 300.
 */
const BRIEF_MOST = 300;

/** Words that fit the brief's 300 characters, cut at a word and never mid-search. */
function briefWords(parts: string[]): string {
  let out = "";
  for (const p of parts.filter(Boolean)) {
    const next = out ? `${out} ${p}` : p;
    if (next.length > BRIEF_MOST) break;
    out = next;
  }
  return out || truncate(parts[0] ?? "", BRIEF_MOST);
}

/** A brief still on its way for this phrase: queued or running on the workstation. */
function briefBusy(id: number): number | null {
  try {
    const r = db
      .prepare("SELECT b.task_id FROM cc_seo_kw_briefs b JOIN cc_ai_tasks t ON t.id = b.task_id WHERE b.keyword_id = ? AND t.state IN ('queued', 'running') ORDER BY b.at DESC LIMIT 1")
      .get(id) as { task_id: number } | undefined;
    return r?.task_id ?? null;
  } catch {
    return null;
  }
}

async function queueBrief(task: NewTask, by: Person, what: string, href: string, dedupe: string): Promise<BriefQueued> {
  const t = await createTask(task, by);
  note("seo-action", `Asked for a brief: ${what}`, { tone: "info", actor: by.name, detail: `Operator task #${t.id}; it runs on the studio workstation when it is on.`, href, dedupe: `${dedupe}:${t.id}` });
  return { ok: true, task: { id: t.id, title: t.title }, line: `Queued as operator task #${t.id}: it runs on the studio workstation when it is on.` };
}

routes.post("/:id/brief", async (c) => {
  const id = idOf(c.req.param("id"));
  const k = keywordOf(id);
  const busy = briefBusy(id);
  if (busy) fail(409, `A brief for ${quote(k.phrase)} is already on its way: operator task #${busy}. Wait for it, or stop it on the Operator page.`);
  const page = k.page ? siteView().byPath.get(k.page) : undefined;
  const lang = k.lang ? LANG_NAME[k.lang] : null;
  const prompt = briefWords([
    `The search “${k.phrase}”${lang ? ` (${lang}${k.lang === "de" ? ", de-CH" : ""})` : ""}${k.intent ? `, ${k.intent} intent` : ""}.`,
    page ? `${k.page} answers it today: improve it or write a new page?` : "No page of the site answers it yet.",
    k.cluster ? `Topic: ${allClusters().find((x) => x.key === k.cluster)?.name ?? k.cluster}.` : "",
    measured(k.phrase) ?? "",
  ]);
  const who = me(c);
  const got = await queueBrief({ kind: "brief", prompt, depth: "deep" }, who, quote(k.phrase), `/seo/keywords?open=${id}`, `seo:kw:brief:${id}`);
  db.prepare("INSERT OR IGNORE INTO cc_seo_kw_briefs (keyword_id, task_id, by, at) VALUES (?, ?, ?, ?)").run(id, got.task.id, who.name, now());
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
  /* The page's situation first, then as many of its searches as fit. */
  const head = `A ${lang}${cl.lang === "de" ? " (de-CH)" : ""} page for the topic “${cl.name}”${cl.intent ? `, ${cl.intent} intent` : ""}. ${gap ? `No ${lang} page answers it yet.` : `${cl.page} answers it today: what to add?`} Searches:`;
  let prompt = head;
  for (const p of list) {
    const next = `${prompt}${prompt === head ? " " : ", "}“${p}”`;
    if (next.length + 1 > BRIEF_MOST) break;
    prompt = next;
  }
  const who = me(c);
  const got = await queueBrief({ kind: "brief", prompt: `${prompt}.`, depth: "deep" }, who, `the topic ${quote(cl.name)}`, `/seo/keywords?view=clusters&q=${encodeURIComponent(cl.name)}`, `seo:cluster:brief:${key}`);
  /* Tell Content Gaps, which follows a cluster's brief on its gap opportunity: one brief, known on both pages. */
  try {
    const gaps = await import("./content-gaps.ts");
    gaps.rememberBrief(key, got.task.id, who.name);
  } catch {
    /* Content Gaps could not load: the brief is queued all the same */
  }
  return c.json<BriefQueued>(got);
});

/* ---------- a cluster's page, kept as a person's word ----------------------------------------- */

routes.post("/clusters/:key/page", async (c) => {
  const key = c.req.param("key");
  const cl = allClusters().find((x) => x.key === key) ?? fail(404, `There is no cluster ${key}.`);
  const b = await body(c);
  if (b.path === "auto") {
    const got = releaseClusterPage(key);
    return c.json<KeywordChanged>({ ok: true, id: 0, line: `${quote(cl.name)}: the desk decides its page again${got?.page ? `; it now maps it to ${got.page}` : "; no page answers it by the desk's rule"}.` });
  }
  if (b.path !== null && typeof b.path !== "string") fail(400, "path is one of the site's addresses, null (no page answers it), or \"auto\" (let the desk decide).");
  const path = b.path === null ? null : (pathParam(b.path as string) ?? fail(400, "path is one of the site's addresses, starting with /."));
  if (path && siteView().byPath.get(path)?.status !== 200) fail(400, `The crawl reads no page answering at ${path}.`);
  const who = me(c);
  setClusterPage(key, path, who.name);
  note("seo-action", path ? `Mapped the topic ${quote(cl.name)} to ${path}` : `Said no page answers the topic ${quote(cl.name)}`, { tone: "info", actor: who.name, href: `/seo/keywords?view=clusters&q=${encodeURIComponent(cl.name)}`, dedupe: `seo:cluster:page:${key}:${path ?? "none"}` });
  return c.json<KeywordChanged>({ ok: true, id: 0, line: path ? `${quote(cl.name)} is answered by ${path}; no run or import changes that.` : `${quote(cl.name)}: no page answers it (a gap), by your word; no run or import changes that.` });
});

/* ---------- editing phrases and topics ----------------------------------------------------------- */

const INTENT_SET = new Set<string>(INTENTS);

routes.post("/:id/edit", async (c) => {
  const id = idOf(c.req.param("id"));
  const k = keywordOf(id);
  const b = await body(c);
  const change: { cluster?: string | null; lang?: string | null; intent?: string | null } = {};
  if ("cluster" in b) {
    const v = b.cluster === null || b.cluster === "" ? null : String(b.cluster);
    if (v && !allClusters().some((x) => x.key === v)) fail(400, `There is no topic ${v}.`);
    change.cluster = v;
  }
  if ("lang" in b) change.lang = b.lang === null || b.lang === "" ? null : isLang(b.lang) ? b.lang : fail(400, "lang is de, en, fr, it, or empty.");
  if ("intent" in b) change.intent = b.intent === null || b.intent === "" ? null : INTENT_SET.has(String(b.intent)) ? String(b.intent) : fail(400, `intent is one of ${INTENTS.join(", ")}, or empty.`);
  const who = me(c);
  const got = editKeyword(id, change, who.name) ?? fail(404, `There is no keyword ${id}.`);
  return c.json<KeywordChanged>({
    ok: true,
    id,
    line: got.changed.length ? `${quote(k.phrase)}: ${got.changed.join(", ")} changed; no run or import changes it back.` : `${quote(k.phrase)}: nothing to change.`,
  });
});

routes.post("/:id/remove", async (c) => {
  const id = idOf(c.req.param("id"));
  const k = keywordOf(id);
  const got = removeKeyword(id);
  if (got === "not-mine") fail(409, `${quote(k.phrase)} came from ${k.sources.filter((x) => x !== "manual").map((x) => SOURCE_LINE[x].label).join(" and ")} too, and would come back with its next run. Judge it irrelevant instead: it then leaves the list.`);
  const who = me(c);
  note("seo-action", `Stopped tracking the search ${quote(k.phrase)}`, { tone: "info", actor: who.name, dedupe: `seo:kw:remove:${id}` });
  return c.json<KeywordChanged>({ ok: true, id, line: `${quote(k.phrase)} is out of the table.` });
});

routes.post("/many", async (c) => {
  const b = await body(c);
  const raw = Array.isArray(b.phrases) ? (b.phrases as unknown[]).map(String) : typeof b.phrases === "string" ? b.phrases.split(/[\r\n;]+/) : [];
  const list = [...new Set(raw.map(normal).filter((p) => p.length >= 2 && p.length <= 120 && !/[<>]/.test(p)))];
  if (!list.length) fail(400, "Write the phrases, one per line: 2 to 120 characters each.");
  if (list.length > 200) fail(400, "At most 200 at once.");
  const lang = b.lang === undefined || b.lang === null || b.lang === "" ? null : isLang(b.lang) ? b.lang : fail(400, "lang is de, en, fr, it, or left out.");
  const cluster = typeof b.cluster === "string" && b.cluster ? b.cluster : null;
  if (cluster && !allClusters().some((x) => x.key === cluster)) fail(400, `There is no topic ${cluster}.`);
  const who = me(c);
  const results: KeywordsActed["results"] = [];
  for (const phrase of list) {
    const got = upsertKeyword({ phrase, lang: lang ?? langOfPhrase(phrase), cluster, source: "manual", status: "relevant", by: who.name });
    const row = db.prepare("SELECT id, status FROM cc_seo_keywords WHERE phrase = ?").get(phrase) as { id: number; status: KeywordStatus } | undefined;
    if (!row) {
      results.push({ id: 0, ok: false, line: `${quote(phrase)} could not be kept.` });
      continue;
    }
    if (got !== "added" && row.status !== "relevant") setKeywordStatus(row.id, "relevant", who.name);
    results.push({ id: row.id, ok: true, line: got === "added" ? `Tracking ${quote(phrase)}.` : `${quote(phrase)} was already in the table; judged relevant by you.` });
  }
  const added = results.filter((r) => r.line.startsWith("Tracking")).length;
  if (added) note("seo-action", `Started tracking ${plural(added, "search")}`, { tone: "info", actor: who.name, href: "/seo/keywords?source=manual&sort=first-seen&status=all", dedupe: `seo:kw:many:${now()}` });
  return c.json<KeywordsActed>({ ok: true, results });
});

routes.post("/topics", async (c) => {
  const b = await body(c);
  const name = typeof b.name === "string" ? b.name.replace(/\s+/g, " ").trim() : "";
  if (name.length < 2 || name.length > 80) fail(400, "Name the topic: 2 to 80 characters.");
  const lang = isLang(b.lang) ? b.lang : fail(400, "A topic has one language: de, en, fr or it.");
  const intent = b.intent === undefined || b.intent === null || b.intent === "" ? null : INTENT_SET.has(String(b.intent)) ? (String(b.intent) as Intent) : fail(400, `intent is one of ${INTENTS.join(", ")}, or left out.`);
  const key = topicKey(name, lang);
  if (allClusters().some((x) => x.key === key)) fail(409, `A topic ${quote(name)} in that language exists already.`);
  const who = me(c);
  const t = addTopic(name, lang, intent, who.name);
  note("seo-action", `Created the topic ${quote(name)}`, { tone: "info", actor: who.name, href: `/seo/keywords?cluster=${encodeURIComponent(t.key)}&status=all`, dedupe: `seo:topic:add:${t.key}` });
  return c.json<TopicChanged>({ ok: true, topic: { key: t.key, name: t.name, lang: t.lang }, line: `The topic ${quote(name)} (${LANG_NAME[lang]}) exists; file phrases under it from their row's menu.` });
});

routes.post("/topics/:key", async (c) => {
  const key = c.req.param("key");
  const had = allClusters().find((x) => x.key === key) ?? fail(404, `There is no topic ${key}.`);
  const b = await body(c);
  const name = typeof b.name === "string" ? b.name.replace(/\s+/g, " ").trim() : "";
  if (name.length < 2 || name.length > 80) fail(400, "Name the topic: 2 to 80 characters.");
  const t = renameTopic(key, name) ?? fail(404, `There is no topic ${key}.`);
  return c.json<TopicChanged>({ ok: true, topic: { key: t.key, name: t.name, lang: t.lang }, line: `${quote(had.name)} is now called ${quote(name)}; its phrases stay filed under it.` });
});

/* ---------- research on the web, who ranks ------------------------------------------------------- */

/** The ways asked: a list or "a,b"; the defaults when none is named. */
const modesOf = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? v.split(",") : undefined);

routes.post("/research", async (c) => {
  const b = await body(c);
  const who = me(c);
  const got = await web.researchPhrase({ seed: String(b.seed ?? ""), lang: typeof b.lang === "string" ? b.lang : undefined, modes: modesOf(b.modes), by: who.name, fresh: b.fresh === true });
  keepResearch(got, who.name);
  if (got.sent) note("seo-action", `Researched ${quote(got.seed)} on the web`, { tone: "info", actor: who.name, detail: got.line, href: `/seo/keywords?research=${encodeURIComponent(got.seed)}&rlang=${got.lang}`, dedupe: `seo:kw:research:${got.lang}:${got.seed}:${today()}` });
  return c.json<Researched>({ ok: true, line: got.line, href: `/seo/keywords?research=${encodeURIComponent(got.seed)}&rlang=${got.lang}&rmodes=${got.modes.join(",")}` });
});

routes.post("/research/track", async (c) => {
  const b = await body(c);
  const seed = normal(String(b.seed ?? ""));
  if (seed.length < 2) fail(400, "Say which research the phrases come from (seed).");
  const lang = web.asLang(b.lang ?? langOfPhrase(seed) ?? "de");
  const chosen = typeof b.cluster === "string" && b.cluster ? b.cluster : null;
  if (chosen && !allClusters().some((x) => x.key === chosen)) fail(400, `There is no topic ${chosen}.`);
  const list = Array.isArray(b.phrases) ? (b.phrases as unknown[]) : [];
  const phrases = list
    .map((x) => (typeof x === "string" ? { phrase: x, cluster: null } : x && typeof x === "object" ? { phrase: String((x as { phrase?: unknown }).phrase ?? ""), cluster: (x as { cluster?: unknown }).cluster ? String((x as { cluster?: unknown }).cluster) : null } : null))
    .filter((x): x is { phrase: string; cluster: string | null } => !!x && x.phrase.trim().length >= 2);
  if (!phrases.length) fail(400, "Tick the phrases to track first.");
  if (phrases.length > 200) fail(400, "At most 200 at once.");
  const who = me(c);
  const got = trackResearched(
    phrases.map((p) => ({ phrase: p.phrase, cluster: chosen ?? p.cluster })),
    { seed, lang, by: who.name },
  );
  if (got.added) note("seo-action", `Started tracking ${plural(got.added, "search")} found by researching ${quote(seed)}`, { tone: "info", actor: who.name, href: `/seo/keywords?q=&source=manual&sort=first-seen&status=all`, dedupe: `seo:kw:track:${seed}:${now()}` });
  const line = [got.added ? `Tracking ${plural(got.added, "new phrase")}` : "", got.known ? `${plural(got.known, "phrase")} already in the table, now judged relevant by you` : ""].filter(Boolean).join("; ");
  return c.json<KeywordsTracked>({ ok: true, added: got.added, known: got.known, line: `${line || "Nothing to track"}. Each is filed by its own language${chosen ? "" : ", under the topic the desk suggested"}.` });
});

routes.post("/research/run", async (c) => {
  const who = me(c);
  if (!runNow("seo-research")) fail(409, "The daily research cannot run now: it is switched off in SEO › Automations, or what it needs is not connected.");
  note("seo-action", "Asked for the daily research of Google's suggestions now", { tone: "info", actor: who.name, dedupe: `seo:kw:research-run:${today()}:${who.name}` });
  const b = budget();
  return c.json({ ok: true, line: `The research runs within a minute: at most 20 requests, ${b.cap - b.used} of this week's ${b.cap} left. New phrases arrive unjudged.` });
});

routes.post("/serp", async (c) => {
  const b = await body(c);
  const phrase = normal(String(b.phrase ?? ""));
  const had = phrase ? (db.prepare("SELECT lang, cluster FROM cc_seo_keywords WHERE phrase = ?").get(phrase) as { lang: string | null; cluster: string | null } | undefined) : undefined;
  const lang = typeof b.lang === "string" && b.lang ? b.lang : (had?.lang ?? undefined);
  const cluster = typeof b.cluster === "string" && b.cluster ? b.cluster : (had?.cluster ?? null);
  const got = await web.requestSerp({ phrase, lang, by: me(c).name, clusterKey: cluster, fresh: b.fresh === true });
  return c.json({ ok: true as const, ...got });
});

/* ---------- the local AI: the studio workstation's model sorts phrases --------------------------- */

/**
 * "Ask the AI to sort these": a task for the workstation's own model through
 * the operator queue, never a hosted model. Tracked phrases go as the
 * operator's "keywords" kind (it judges and files table rows); phrases a
 * research found join the table unjudged first and go the same way. Only if
 * the operator refuses that kind does the plain question with the topics
 * remain, answered in words for a person to act on.
 */
routes.post("/ai-sort", async (c) => {
  const b = await body(c);
  const who = me(c);
  const ids = Array.isArray(b.ids) ? [...new Set((b.ids as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 30) : [];
  if (ids.length) {
    const rows = ids.map((id) => keywordById(id)).filter((k): k is Keyword => !!k);
    if (!rows.length) fail(404, "None of those phrases is in the table.");
    try {
      const got = await queueBrief({ kind: "keywords", ids: rows.map((k) => k.id), prompt: `Sort ${plural(rows.length, "tracked search phrase")}: relevant, weak or irrelevant, their topic and intent.`, depth: "quick" }, who, `sorting ${plural(rows.length, "phrase")}`, "/seo/keywords?status=unjudged", "seo:kw:ai-sort");
      return c.json<BriefQueued>({ ...got, line: `${got.line} Its judgements come back for a person to accept.` });
    } catch (e) {
      /* The operator does not take this kind yet: ask the same as a plain question below. */
      if (!(e instanceof HTTPException) || e.status !== 400) throw e;
    }
    return c.json<BriefQueued>(await askToSort(rows.map((k) => k.phrase), rows[0]!.lang ?? "de", null, who));
  }
  const seed = normal(String(b.seed ?? ""));
  const list = Array.isArray(b.phrases) ? [...new Set((b.phrases as unknown[]).map((x) => normal(String(x))).filter((p) => p.length >= 2))].slice(0, 40) : [];
  if (!list.length) fail(400, "Tick the phrases to sort first.");
  const lang = typeof b.lang === "string" ? b.lang : "de";
  /*
   * Researched phrases join the table as "waiting for a judgement", exactly as
   * the daily research files what it finds, so the operator's "keywords" kind
   * can judge them as rows and "Apply these judgements" acts on them. Nothing
   * is marked relevant here: that stays the person's or the model's call.
   */
  const at = now();
  let added = 0;
  const found: number[] = [];
  for (const phrase of list.slice(0, 30)) {
    if (phrase.length > 120 || /[<>]/.test(phrase)) continue;
    const pl = langOfPhrase(phrase, lang);
    if (upsertKeyword({ phrase, lang: pl, cluster: topicFor(null, pl), source: "autocomplete", seed: seed || null }, at) === "added") added++;
    const row = db.prepare("SELECT id FROM cc_seo_keywords WHERE phrase = ?").get(phrase) as { id: number } | undefined;
    if (row) found.push(row.id);
  }
  if (found.length) {
    try {
      const got = await queueBrief({ kind: "keywords", ids: found, prompt: `Sort ${plural(found.length, "researched search phrase")}: relevant, weak or irrelevant, their topic and intent.`, depth: "quick" }, who, `sorting ${plural(found.length, "researched phrase")}`, "/seo/keywords?status=unjudged", "seo:kw:ai-sort");
      return c.json<BriefQueued>({ ...got, line: `${added ? `${plural(added, "new phrase")} added to the table, waiting for a judgement. ` : ""}${got.line} Its judgements come back for a person to accept.` });
    } catch (e) {
      if (!(e instanceof HTTPException) || e.status !== 400) throw e;
    }
  }
  return c.json<BriefQueued>(await askToSort(list, lang, seed || null, who));
});

/** The plain question: what the studio is, the phrases, and the topics of their language to choose from. */
async function askToSort(phrases: string[], lang: string, seed: string | null, who: Person): Promise<BriefQueued> {
  /* The operator takes 1,000 characters in all: the topics get at most 450 of them, the phrases the rest. */
  const topics: string[] = [];
  for (const x of allClusters().filter((t) => t.lang === lang)) {
    if (topics.join("; ").length + x.name.length > 450) break;
    topics.push(x.name);
  }
  const head = `Balkaris is a Swiss studio for websites, film and photography. For each search phrase${seed ? ` found by researching “${seed}”` : ""}, say relevant, weak or irrelevant for its website, and its topic${topics.length ? ` (one of: ${topics.join("; ")}; or a new one)` : ""}. One line each.`;
  let prompt = `${head} Phrases:`;
  for (const p of phrases) {
    const next = `${prompt} “${p}”;`;
    if (next.length > 990) break;
    prompt = next;
  }
  return queueBrief({ kind: "ask", prompt: prompt.replace(/;$/, "."), context: "none", depth: "quick" }, who, `sorting ${plural(phrases.length, "researched phrase")}`, seed ? `/seo/keywords?research=${encodeURIComponent(seed)}` : "/seo/keywords", "seo:kw:ai-sort");
}

/* ---------- demand figures ----------------------------------------------------------------------- */

routes.post("/planner", async (c) => {
  const who = me(c);
  if (!who.owner) fail(403, "Only the owner imports a Keyword Planner export.");
  const b = await body(c);
  const csv = typeof b.csv === "string" ? b.csv : "";
  if (csv.length < 10) fail(400, "Paste the Keyword Planner export (its CSV text), or choose the file.");
  if (csv.length > 5_000_000) fail(400, "That export is over 5 MB: export fewer keywords at once.");
  const got = web.importPlannerCsv(csv, who.name, { lang: isLang(b.lang) ? b.lang : undefined, addMissing: b.addMissing === true });
  note("seo-action", "Imported a Keyword Planner export", { tone: "info", actor: who.name, detail: got.line, dedupe: `seo:kw:planner:${now()}` });
  return c.json({ ok: true as const, ...got });
});

routes.post("/volumes", async (c) => {
  const b = await body(c);
  const ids = Array.isArray(b.ids) ? [...new Set((b.ids as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 200) : [];
  const got = await web.refreshVolumes(ids, me(c).name);
  return c.json({ ok: true as const, line: got.line });
});

/* ---------- GET /clusters.csv ------------------------------------------------------------------- */

routes.get("/clusters.csv", async (c) => {
  const range = rangeFrom(c);
  const q = queryOf(c, false);
  const desk = deskOf();
  const s = searchOf(range, { country: q.where, device: q.device === "all" ? null : q.device });
  /* One read of the site for every row: siteView() reads the whole crawl, and once per phrase took half a minute. */
  const view = siteView();
  const all = desk.kw.map((k) => rowOf(k, desk, view, s.state === "ok" ? s.value : null));
  const rows = sortClusters(clusterRows(all, desk, view, q), q.clusterSort);
  const head = ["Topic", "Language", "Intent", "Priority", "Audit's order", "Page", "Mapped by", "Gap", "Phrases", "Relevant", "Targets", "Shown in Google", "Impressions", "Clicks", "Best position", "Opportunities", "Top phrases", "Why", "What to do"];
  const lines = [head.map(cell).join(",")];
  for (const r of rows) {
    lines.push(
      [r.name, r.lang, r.intent, r.priority, r.rank, r.page, r.mappedBy, r.gap ? "yes" : "no", r.phrases, r.relevant, r.targets, r.shown, r.impressions, r.clicks, r.bestPosition, r.opportunities, r.top.join("; "), r.why, r.action]
        .map(cell)
        .join(","),
    );
  }
  return c.body(`${lines.join("\r\n")}\r\n`, 200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="balkaris-topics-${today()}.csv"`,
    "cache-control": "no-store",
  });
});
