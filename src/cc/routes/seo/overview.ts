import { Hono, type Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.ts";
import { areaLevel, mayRunJob } from "../../../grants.ts";
import type { Person } from "../../../people.ts";
import { me, type Vars } from "../../access.ts";
import * as ga4 from "../../ga4.ts";
import { gaRange } from "../../ga4.ts";
import { hasKey } from "../../gauth.ts";
import { createTask, openRows, runnerState } from "../../operator/queue.ts";
import { status as jobStatus } from "../../scheduler.ts";
import * as bing from "../../search/bing.ts";
import * as gsc from "../../search/gsc.ts";
import { addDays, dayIn, round, siteBase } from "../../search/shared.ts";
import * as site from "../../site/index.ts";
import { kept, note, off, ok, reading, today, waiting } from "../../store.ts";
import { scrub, scrubItem } from "../../system.ts";
import type { ActivityItem, Reading, Stat, Tone } from "../../../../web/src/contract/common.ts";
import type { TaskAnswer, TaskKind } from "../../../../web/src/contract/operator.ts";
import type { AuditRun, OpportunitiesActed, OpportunityRow, OwnerTaskAnswer, SeoRange, SeoSpan } from "../../../../web/src/contract/seo/common.ts";
import type {
  AiPanel,
  AiTile,
  ConsolePanel,
  EnginePart,
  GapsPanel,
  KeywordOpportunity,
  KeywordPanel,
  MovedQuery,
  MovementsPanel,
  OrganicPanel,
  OverviewAsked,
  OverviewCan,
  OverviewTiles,
  PresencePanel,
  PriorityFilter,
  PriorityPanel,
  RowActionInfo,
  RunningPanel,
  SeoOverviewPayload,
  SpreadCounts,
  TechnicalPanel,
  TechnicalRow,
  TopPagesPanel,
} from "../../../../web/src/contract/seo/overview.ts";
import { aiCrawlers, aiReferrals, isAi, referralSpan, tally } from "../../seo/aisearch.ts";
import { competitorNames, competitorPages, sightings } from "../../seo/competitors.ts";
import { curve, TARGET_POSITION } from "../../seo/ctr.ts";
import { act, allOpportunities, clusterNames, opportunityDb, rank, toRow } from "../../seo/engine.ts";
import { seoJobs } from "../../seo/jobs.ts";
import { budget, clusters, keywords } from "../../seo/keywords.ts";
import { markOwnerTask, mayMark, ownerTask, ownerTasks } from "../../seo/owner.ts";
import { profiles } from "../../seo/presence.ts";
import { auditRun } from "../../seo/audit.ts";
import { daySeries, daysOf, historyFacts, lastSnapDay, newAndLost, pageFigures, pageSeries, queryFigures, rate, tiles as rankTiles, totals as rankTotals, type Where } from "../../seo/rank.ts";
import { FLOOR, PRIORITY_RANK, WINDOW_DAYS } from "../../seo/rules.ts";
import { pageRef, siteView, type SiteView } from "../../seo/site.ts";
import { normal } from "../../seo/words.ts";
import { head, historyAbsent, HISTORY_NOTE, historyAt, indexFigures, keywordFigures, operatorPanel, rangeFrom, recorded, SEO_KINDS, SEO_SUGGESTIONS } from "./shared.ts";

/**
 * /api/v1/seo/overview — the SEO section's Overview: everything the SEO
 * engine does, on one page.
 *
 *   GET  /?range=7d|30d|90d|1y&country=all|che&device=all|desktop|mobile|tablet
 *                                the whole page (SeoOverviewPayload). `country` and `device`
 *                                narrow the Search Console figures (the tiles, the Search
 *                                Console panel, What moved, Top pages); `asked` echoes them
 *   GET  /running                "Running now" alone, for the panel that keeps itself current
 *   POST /act      { ids }       take the action of one or more opportunities: an operator
 *                                task queued (a proposal waits for approval), or a person's
 *                                step marked as taken. Never changes the live site.
 *   POST /owner    { id, done, note? }   a person marks an owner task done, or open again
 *                                (the owner's own steps: the owner alone)
 *   POST /task     NewTask        queue an operator task from this page (the AI SEO Operator's
 *                                box and suggestions, a Technical fix) and write it to the SEO
 *                                log, so Running now and Recent SEO actions know it is search work
 *
 * WHO MAY. Reading takes the Overview page (src/grants.ts). Queueing work for
 * the operator (/task, and /act for a proposal or a brief) also takes edit on
 * the AI Operator, as the access screen says of SEO's AI buttons: the
 * operator reads every area's figures to answer. `can` in the payload says
 * both, so the page offers no button the server would refuse.
 *
 * WHERE EACH PANEL COMES FROM. The SEO engine's own tables (src/cc/seo/*:
 * the Search Console history, the keyword table and clusters, the
 * opportunities, the owner tasks, the AI checks, the referrals, the profiles,
 * the competitors, the backlinks it reads and Google's Links report as
 * imported), the desk's crawl, Google's daily URL Inspection, the PageSpeed
 * runs, Bing Webmaster when it has a key, the scheduler and the operator's
 * queue. Nothing here asks Google or anybody else while the page
 * is drawn, with three kept reads that ask only when their kept answer has
 * aged: Bing's link count (no request when it is fresh or there is no key),
 * GA4's sessions by channel for "From search" (the read the Traffic screen
 * keeps warm, fifteen minutes), and nothing at all for Top pages, which reads
 * Search Console's kept per-page answer straight from the desk's store.
 *
 * Every panel is its own `reading()`, so one source that fails costs one
 * panel. No figure is made up: a panel without its source says why and what
 * connects it. The one estimate on the page is the opportunities' "our
 * estimate" (src/cc/seo/ctr.ts), only ever from real impressions.
 */
export const routes = new Hono<Vars>();

/* ---------- small helpers ---------------------------------------------------------------- */

const OPEN_STATES = new Set(["open", "queued", "in-progress"]);

/** The SEO section's jobs exist only once the SEO routes registered them; until then the engine's panels say so. */
const engineJob = (name: string) => jobStatus().find((j) => j.name === name) ?? null;

/** "every 15 minutes", "every hour", "every 6 hours": a job's interval in words. */
const everyWords = (s: number): string =>
  s % 3600 === 0 ? (s === 3600 ? "every hour" : `every ${s / 3600} hours`) : s % 60 === 0 ? `every ${s / 60} minutes` : `every ${s} seconds`;

/** How the opportunity engine runs, read from its own job: it wakes on its interval and runs the rules when something it reads has changed. */
const engineRhythm = (every: number): string => `It wakes ${everyWords(every)} and runs the rules again whenever something it reads has changed, and at least every 6 hours`;

/** Why the opportunity engine has nothing to show yet. */
function engineAbsent<T>(): Reading<T> {
  const j = engineJob("seo-engine");
  if (!j) return waiting("desk", "The SEO engine's jobs are not registered on this desk yet, so the opportunity rules have not run. They run on the desk's scheduler once they are.");
  if (j.running) return waiting("desk", "The opportunity engine is running now; its findings appear here when it finishes.");
  if (!j.lastEnd) return waiting("desk", `The opportunity engine has not run yet. ${engineRhythm(j.every)} (Automations: Find SEO opportunities), or now with Run full SEO audit.`);
  if (j.lastOk === false) return waiting("desk", `The opportunity engine's last run failed: ${scrub(j.lastNote ?? "no reason given")}`);
  return waiting("desk", "The opportunity engine ran and found nothing open.");
}

/** A table the SEO engine creates may be empty because nothing was imported yet. */
const count = (sql: string, ...args: (string | number)[]): number => {
  try {
    return Number((db.prepare(sql).get(...args) as { n: number | null } | undefined)?.n ?? 0);
  } catch {
    return 0;
  }
};

/** One value of the desk's own tables, or null when the table or the value is not there. */
const one = (sql: string, ...args: (string | number)[]): string | null => {
  try {
    return (db.prepare(sql).get(...args) as { at: string | null } | undefined)?.at ?? null;
  } catch {
    return null;
  }
};

/**
 * When GA4's referrals were last read, and the last day that read covered.
 *
 * `at`: the job's last run if it went well, else its last good run the
 * scheduler still remembers (a week of runs), else the SEO import that brought
 * them in. With none of those, the newest day kept (a date, no hour): how old
 * the newest figure is, never a made-up time.
 *
 * `through`: the job reads whole days up to the day before it runs (aisearch.ts
 * `readReferrals`), so a good run covered up to the day before it ended. An
 * import or nothing at all covered no further than the newest day kept. A
 * count is only ever stated for days somebody asked GA4 about.
 */
function referralsRead(span: { to: string }): { at: string; through: string } {
  const j = engineJob("seo-referrals");
  const ran = j?.lastOk && j.lastEnd ? j.lastEnd : one("SELECT MAX(ended) AS at FROM cc_runs WHERE job = 'seo-referrals' AND ok = 1");
  if (ran) {
    const day = addDays(dayIn("Europe/Zurich", Date.parse(ran)), -1);
    return { at: ran, through: day > span.to ? day : span.to };
  }
  return { at: one("SELECT MAX(at) AS at FROM cc_activity WHERE kind = 'seo-import'") ?? span.to, through: span.to };
}

/** A window of `range` whole days ending on `end` (included). */
const windowTo = (range: SeoRange, end: string): { start: string; end: string } => ({ start: addDays(end, -(daysOf(range) - 1)), end });

/** The window Vercel's drain counts in: whole days, ending yesterday (its records arrive by themselves, day by day). */
const dayWindow = (range: SeoRange): { start: string; end: string } => windowTo(range, today(-1));

/* ---------- who may, and what was asked -------------------------------------------------------- */

/**
 * What this person may do with the page's buttons. Queueing operator work
 * takes edit on the AI Operator as well as on this page (the access screen
 * says so of SEO's AI buttons: the operator reads every area's figures to
 * answer); the owner's own steps are the owner's to mark.
 */
const canOf = (who: Person): OverviewCan => ({
  operate: areaLevel(who, "operator") === "edit",
  ownerSteps: !!who.owner,
  /* The same rule the job door applies (POST /api/v1/jobs/:name/run), so the strip offers no Run now it would refuse. */
  run: (() => {
    try {
      return seoJobs()
        .filter((j) => mayRunJob(who, j.name))
        .map((j) => j.name);
    } catch {
      return [];
    }
  })(),
});

const NEEDS_OPERATOR = "Queueing work for the AI Operator takes edit on the AI Operator as well as on SEO. The owner gives it on Team › Access & Roles.";

const COUNTRIES = ["all", "che"] as const;
const DEVICES = ["all", "desktop", "mobile", "tablet"] as const;

/** ?country= and ?device= as the address asked them; anything else is "all". */
function askedOf(c: Context<Vars>): OverviewAsked {
  const country = c.req.query("country");
  const device = c.req.query("device");
  return {
    country: (COUNTRIES as readonly string[]).includes(country ?? "") ? (country as OverviewAsked["country"]) : "all",
    device: (DEVICES as readonly string[]).includes(device ?? "") ? (device as OverviewAsked["device"]) : "all",
  };
}

const ALL: OverviewAsked = { country: "all", device: "all" };
const narrowed = (a: OverviewAsked): boolean => a.country !== "all" || a.device !== "all";
const whereOf = (a: OverviewAsked): Where => ({ country: a.country, device: a.device });
/** "Switzerland, mobile": what a narrowed figure covers, for its note. Empty when nothing is narrowed. */
const whereWords = (a: OverviewAsked): string => [a.country === "che" ? "Switzerland only" : "", a.device !== "all" ? `${a.device} only` : ""].filter(Boolean).join(", ");

/* ---------- Google's index, as every SEO screen counts it ------------------------------------------- */

interface IndexStand {
  /** The day of the newest daily check. */
  day: string;
  indexed: number;
  notIndexed: number;
  /** The sitemap's size at that check, or the addresses with a result when it was not kept. */
  of: number;
  /** Sitemap addresses with no result in the last week: unknown, never counted as not indexed. */
  missing: number;
  /** When the newest of those answers was given. */
  at: string;
  /** Said when the newest check did not reach every address: how far it got and what stands in for the rest. Null for a whole check. */
  cutShort: string | null;
}

/**
 * Google's index as the desk last heard it, taken from the one place every
 * SEO page takes it from (src/cc/seo/figures.ts `indexFigures`, so two pages
 * cannot disagree): each sitemap address's NEWEST result. A daily check may
 * be cut short (Google failing part-way, the allowance used up); the 17
 * addresses it reached are then not the site, and this page once counted them
 * against a sitemap of 98 and said "87 not indexed" on a day nothing had
 * happened. So the addresses a cut-short check did not reach keep their last
 * earlier result, one with no result is unknown (`missing`, counted neither
 * way), and `cutShort` says so beside every count here. Null before any result.
 */
function indexStand(): IndexStand | null {
  const f = indexFigures();
  if (!f) return null;
  const of = f.of ?? f.inspected;
  const missing = Math.max(0, of - f.inspected);
  const reached = f.inspected - f.carried;
  return {
    day: f.day,
    indexed: f.indexed,
    notIndexed: f.notIndexed,
    of,
    missing,
    at: one("SELECT MAX(checked_at) AS at FROM cc_inspect WHERE day = ?", f.day) ?? f.day,
    /* A day checked before the sitemap's size was kept has no whole to fall short of: nothing is said of it. */
    cutShort:
      f.complete || f.of === null
        ? null
        : `The check of ${shortDay(f.day)} was cut short: it reached ${fmt(reached)} of ${fmt(of)} addresses${f.carried ? `; ${fmt(f.carried)} keep their last earlier result` : ""}${missing ? `; ${fmt(missing)} have no result yet and are counted neither way` : ""}. Run full SEO audit finishes it (it runs the index check again while it is cut short), or Run now on the index check in the Automations strip.`,
  };
}

/* ---------- tiles --------------------------------------------------------------------------- */

function indexedTile(days: number): Reading<Stat> {
  const a = gsc.access();
  if (a.state !== "ok") return off("gsc", gsc.reasonFor(a), gsc.stepFor(a));
  const s = indexStand();
  if (!s) {
    return waiting("gsc", "Google's URL Inspection of every sitemap address runs once a day (Automations: Inspect sitemap addresses in Google); it has not finished a first round on this desk yet.");
  }
  const line = recorded("gsc.indexed", days);
  const stat: Stat = {
    value: s.indexed,
    previous: line?.previous ?? null,
    unit: "count",
    series: line?.series.length ? line.series : [s.indexed],
    of: s.of,
    /* What was actually found not indexed, never "the sitemap minus the indexed": an address nobody checked is unknown. */
    sub: `${fmt(s.notIndexed)} not indexed${s.missing ? ` · ${fmt(s.missing)} not checked` : ""}${s.cutShort ? " · last check cut short" : ""}`,
  };
  return ok(
    stat,
    "gsc",
    s.at,
    `Sitemap addresses Google's URL Inspection reports as indexed: each address's newest result, checked once a day (newest check ${s.day}). Not Search Console's Page indexing total, which no API gives.${s.cutShort ? ` ${s.cutShort}` : ""}`,
  );
}

/** Questions that name Balkaris themselves (the brand, the domain) are left out of the unprompted count. */
const PROMPTED_KINDS = "('brand', 'domain')";

function aiTile(): Reading<AiTile> {
  const t = tally();
  if (!t.length) {
    return waiting(
      "desk",
      "No answer of an AI assistant is recorded yet. The audit's checks come in with the SEO import (scripts/seo-import.ts); later rounds are added on AI Search.",
    );
  }
  const asked = t.reduce((n, e) => n + e.asked, 0);
  const mentioned = t.reduce((n, e) => n + e.mentioned, 0);
  const lastDay = t.map((e) => e.day).sort().at(-1)!;
  /* One share per recorded day over every engine, oldest first, of the questions without the name: the tile's
     headline. A day with fewer than 30 such answers has no share (null): a percentage of a handful is noise. */
  const days = db
    .prepare(`SELECT day, COUNT(*) AS asked, SUM(CASE WHEN mentioned = 1 THEN 1 ELSE 0 END) AS named FROM cc_seo_ai_checks WHERE kind NOT IN ${PROMPTED_KINDS} GROUP BY day ORDER BY day`)
    .all() as { day: string; asked: number; named: number }[];
  /* When an answer was last recorded, as it was written down. */
  const at = one("SELECT MAX(added_at) AS at FROM cc_seo_ai_checks") ?? lastDay;
  return ok(
    {
      asked,
      mentioned,
      unprompted: { asked: t.reduce((n, e) => n + e.unprompted.asked, 0), mentioned: t.reduce((n, e) => n + e.unprompted.mentioned, 0) },
      engines: t.map((e) => e.label),
      lastDay,
      series: days.map((d) => (d.asked >= SMALL ? round((d.named / d.asked) * 100, 1) : null)),
    },
    "desk",
    at,
    "Questions asked of AI assistants and whether the answer named Balkaris, as recorded (the audit, the lead in a browser): each assistant's newest round. Not a sample of what people ask.",
  );
}

/** Under this many events a rate is printed as its two counts and drawn nowhere (rank.ts `rate` says the same). */
const SMALL = 30;

/**
 * The studio's own name as people type it: the first label of the website's
 * domain ("balkaris"). A query that carries it, spaced or dotted or not, is a
 * search for the studio itself: a brand search. Kept here, in one place.
 */
const brandWord = (): string => {
  try {
    return (new URL(siteBase()).hostname.replace(/^www\./, "").split(".")[0] ?? "").toLowerCase();
  } catch {
    return "";
  }
};
export const isBrand = (query: string, brand = brandWord()): boolean => !!brand && normal(query).replace(/[\s.\-_]/g, "").includes(brand);

/**
 * The window's clicks Google names a query for, split by whether the query
 * carries the studio's name. Google withholds rare queries, so on a young site
 * most clicks have no query at all: the split is of the named ones only, and
 * says so. Null without a window.
 */
function brandSplit(span: SeoSpan | null, asked: OverviewAsked): OverviewTiles["brand"] {
  if (!span) return null;
  const brand = brandWord();
  const rows = queryFigures(span.start, span.end, whereOf(asked));
  const named = rows.reduce((n, q) => n + q.clicks, 0);
  const own = rows.filter((q) => isBrand(q.query, brand)).reduce((n, q) => n + q.clicks, 0);
  return { word: brand, named, nonBrand: named - own };
}

function tilesOf(range: SeoRange, span: SeoSpan | null, asked: OverviewAsked = ALL): OverviewTiles {
  const days = daysOf(range);
  const absent = historyAbsent<never>();
  const t = span ? rankTiles(span, whereOf(asked)) : null;
  let brand: OverviewTiles["brand"] = null;
  if (t) {
    /* The CTR line: a day's rate only where Google showed the site 30 times or more that day; a gap elsewhere. */
    const shown = t.impressions.series;
    t.ctr = { ...t.ctr, series: t.ctr.series.map((v, i) => ((shown[i] ?? 0) >= SMALL ? v : null)) };
    try {
      brand = brandSplit(span, asked);
    } catch {
      brand = null;
    }
    /* Under the clicks: how many of the clicks Google names a query for were not searches for the studio's own name. */
    if (brand && brand.named > 0) t.clicks = { ...t.clicks, sub: `Non-brand: ${fmt(brand.nonBrand)} of ${fmt(brand.named)} named` };
  }
  const at = span ? historyAt() : "";
  const where = whereWords(asked);
  const note = where ? `${HISTORY_NOTE} ${where[0]!.toUpperCase()}${where.slice(1)}.` : HISTORY_NOTE;
  return {
    brand,
    health: site.siteScore(days),
    indexed: indexedTile(days),
    clicks: t ? ok(t.clicks, "gsc", at, note) : absent,
    impressions: t ? ok(t.impressions, "gsc", at, note) : absent,
    position: t ? (t.position ? ok(t.position, "gsc", at, `${note} Average position weighted by impressions; lower is better.`) : waiting("gsc", "Google showed the site in no search in this window, so there is no position.")) : absent,
    ctr: t ? ok(t.ctr, "gsc", at, note) : absent,
    ai: aiTile(),
  };
}

/* ---------- priority opportunities ---------------------------------------------------------------- */

const FILTERS: Omit<PriorityFilter, "count" | "ids">[] = [
  { key: "all", label: "All", types: null, priority: null },
  { key: "high", label: "High priority", types: null, priority: "high" },
  { key: "index", label: "Not indexed", types: ["not-indexed"], priority: null },
  { key: "search", label: "Rankings & CTR", types: ["near-page-one", "low-ctr", "ranking-drop"], priority: null },
  { key: "gaps", label: "Keyword gaps", types: ["keyword-gap", "german-missing"], priority: null },
  { key: "site", label: "On the site", types: ["technical", "thin-content", "internal-links", "missing-answer"], priority: null },
  { key: "owner", label: "Off the site", types: ["entity"], priority: null },
];
const PER_FILTER = 8;

const matches = (f: Omit<PriorityFilter, "count" | "ids">, r: OpportunityRow): boolean => (!f.types || f.types.includes(r.type)) && (!f.priority || r.priority === f.priority);

/** Every open, active opportunity as the screens get it, ranked. */
function openOpportunities(view: SiteView): OpportunityRow[] {
  const names = clusterNames();
  return allOpportunities()
    .filter((o) => o.active && OPEN_STATES.has(o.state))
    .map((o) => toRow(o, view, names))
    .sort(rank);
}

/**
 * Ranked rows with each priority tier taken a type at a time (the best of
 * each type, then the second of each …), so a list that mixes types shows the
 * kinds of work side by side instead of six of one kind. The order of the
 * tiers, and each type's own order, are the engine's ranking unchanged.
 */
function mixed(rows: OpportunityRow[]): OpportunityRow[] {
  const out: OpportunityRow[] = [];
  for (const p of ["high", "medium", "low"] as const) {
    const byType = new Map<string, OpportunityRow[]>();
    for (const r of rows) if (r.priority === p) byType.set(r.type, [...(byType.get(r.type) ?? []), r]);
    const queues = [...byType.values()];
    while (queues.some((q) => q.length)) for (const q of queues) if (q.length) out.push(q.shift()!);
  }
  return out;
}

function priorityPanel(open: OpportunityRow[]): Reading<PriorityPanel> {
  if (!open.length && !count("SELECT COUNT(*) AS n FROM cc_seo_opps")) return engineAbsent();
  const keep = new Set<string>();
  const filters = FILTERS.map((f) => {
    const all = open.filter((r) => matches(f, r));
    const shown = (!f.types || f.types.length > 1 ? mixed(all) : all).slice(0, PER_FILTER);
    for (const r of shown) keep.add(r.id);
    return { ...f, count: all.length, ids: shown.map((r) => r.id) };
  });
  const ran = engineJob("seo-engine")?.lastEnd ?? (db.prepare("SELECT MAX(last_seen) AS at FROM cc_seo_opps").get() as { at: string | null }).at ?? new Date().toISOString();
  return ok(
    { total: open.length, filters, rows: open.filter((r) => keep.has(r.id)), perFilter: PER_FILTER, every: engineJob("seo-engine")?.every ?? null },
    "desk",
    ran,
    "Found by the stated rules (src/cc/seo/rules.ts) from Search Console, the crawl, Google's URL Inspection, the readiness check and the audit. “Our estimate” is ours, from real impressions and a stated CTR curve.",
  );
}

/* ---------- keyword opportunities ------------------------------------------------------------------ */

/** A keyword row's action, as the engine reads it now: what it is, whether it can be taken, and the opportunity's state. */
const actionOf = (r: OpportunityRow): RowActionInfo => ({
  opportunityId: r.id,
  actionLabel: r.action.label,
  actionKind: r.action.kind,
  step: r.action.step,
  available: r.action.available,
  why: r.action.why,
  state: r.state.state,
  stateNote: r.state.note,
});

function keywordPanel(open: OpportunityRow[]): Reading<KeywordPanel> {
  const end = lastSnapDay();
  const window = end ? { start: addDays(end, -(WINDOW_DAYS - 1)), end, days: WINDOW_DAYS } : null;
  /* Real searches only: queries near page one, then the clusters of searches no page answers (not the audit's site-wide actions). */
  const near = open.filter((r) => r.type === "near-page-one" && r.subject.keyword);
  const gapRows = open.filter((r) => (r.type === "keyword-gap" || r.type === "german-missing") && r.subject.cluster && (r.id.startsWith("keyword-gap:") || r.id.startsWith("german-missing:")));
  const picked = [...near, ...gapRows].slice(0, 7);
  if (!picked.length) {
    if (!count("SELECT COUNT(*) AS n FROM cc_seo_opps")) return engineAbsent();
    if (!window) return historyAbsent();
    return waiting("gsc", "No query sits at Google position 4 to 20 and no cluster of searches is without a page: nothing to list.");
  }
  const figures = window ? new Map(queryFigures(window.start, window.end).map((q) => [q.query, q])) : new Map<string, never>();
  const kw = keywords();
  /* The keyword table holds each phrase in one spelling (words.ts `normal`); Google reports a query as typed, quotation marks and all. */
  const langOf = new Map(kw.map((k) => [normal(k.phrase), k.lang]));
  const cl = new Map(clusters().map((c) => [c.key, c]));
  const rows: KeywordOpportunity[] = picked.map((r) => {
    if (r.type === "near-page-one" && r.subject.keyword) {
      const f = figures.get(r.subject.keyword);
      return {
        phrase: r.subject.keyword,
        lang: langOf.get(normal(r.subject.keyword)) ?? null,
        kind: "near-page-one",
        impressions: f ? f.impressions : null,
        position: f?.position ?? null,
        targetPosition: TARGET_POSITION,
        page: r.subject.page?.path ?? null,
        phrases: null,
        priority: r.priority,
        ...actionOf(r),
      };
    }
    const key = r.subject.cluster!.key;
    const phrases = kw.filter((k) => k.cluster === key && k.status !== "irrelevant");
    const relevant = phrases.filter((k) => k.status === "relevant").length;
    const shown = phrases.reduce((n, k) => n + (figures.get(k.phrase)?.impressions ?? 0), 0);
    return {
      phrase: r.subject.cluster!.name,
      lang: cl.get(key)?.lang ?? null,
      kind: "gap",
      impressions: shown || null,
      position: null,
      targetPosition: null,
      page: null,
      phrases: relevant || phrases.length,
      priority: r.priority,
      ...actionOf(r),
    };
  });
  return ok({ rows, window }, window ? "gsc" : "desk", window ? historyAt() : new Date().toISOString(), `${HISTORY_NOTE} Impressions are Google's, not a search volume: no free source gives volumes.`);
}

/* ---------- top pages -------------------------------------------------------------------------------- */

/** A kept answer older than this is not shown as the period's figures: its window has moved on. */
const KEPT_PAGES_MS = 4 * 86_400_000;
const TOP_PAGES = 5;

/**
 * Search Console's own per-page answer for the period, as the desk keeps it
 * (gsc.ts `pages(range)`, renewed by the gsc-daily job): read straight from
 * the store, never asked for here. The apex and www spellings of one page are
 * one path. Null when none is kept, it is empty, or it is days old.
 */
function keptPages(range: SeoRange): { window: { start: string; end: string }; rows: { path: string; clicks: number; impressions: number; position: number | null }[]; complete: boolean; at: number } | null {
  const had = kept<gsc.Listed<gsc.PageRow>>(`gsc:pages:${range}`);
  if (!had || !had.value?.rows?.length || !had.value.window || Date.now() - had.at > KEPT_PAGES_MS) return null;
  const by = new Map<string, { clicks: number; impressions: number; w: number }>();
  for (const r of had.value.rows) {
    const m = by.get(r.path) ?? { clicks: 0, impressions: 0, w: 0 };
    m.clicks += r.clicks;
    m.impressions += r.impressions;
    m.w += r.position * r.impressions;
    by.set(r.path, m);
  }
  return {
    window: { start: had.value.window.start, end: had.value.window.end },
    rows: [...by].map(([path, m]) => ({ path, clicks: m.clicks, impressions: m.impressions, position: m.impressions ? round(m.w / m.impressions, 1) : null })),
    complete: had.value.complete,
    at: had.at,
  };
}

/**
 * Top Performing Pages.
 *
 * Read from Search Console's kept per-page answer for the period, because the
 * desk's day-by-day page history (cc_seo_rank_pages) holds only part of what
 * Google reports per page (on 4 Oct 2026: 4 of the property's 41 clicks), so
 * a list built from it understates every page and reads the same for 30 days
 * and a year. The kept answer is Google's own figure for its own window,
 * which is named on the panel because it ends on Google's newest finished
 * day, not on the history's.
 *
 * The day-by-day history is used only when it must be: no kept answer, or a
 * country or device is chosen (Google's kept answer is for all of them). Then
 * `short` says how the history's page rows compare with the property's own
 * total for the same days, so a short list is never taken for the whole.
 *
 * The trend is drawn from the day-by-day history, and only for a page whose
 * history holds as many impressions as Google reports for it; a line through
 * part of a page's days would draw a fall that never happened.
 */
function topPages(range: SeoRange, span: SeoSpan | null, view: SiteView, asked: OverviewAsked = ALL): Reading<TopPagesPanel> {
  const where = whereOf(asked);
  const google = narrowed(asked) ? null : keptPages(range);
  const byClicks = <T extends { clicks: number; impressions: number }>(a: T, b: T): number => b.clicks - a.clicks || b.impressions - a.impressions;

  if (google) {
    const figures = google.rows.filter((p) => p.impressions > 0).sort(byClicks).slice(0, TOP_PAGES);
    if (!figures.length) return waiting("gsc", `Google showed no page of the site in a search, ${google.window.start} to ${google.window.end}.`);
    return ok(
      {
        basis: "google",
        window: google.window,
        short: null,
        rows: figures.map((f) => {
          const days = pageSeries(f.path, google.window.start, google.window.end);
          const held = days.reduce((n, d) => n + d.impressions, 0);
          return {
            page: pageRef(f.path, view),
            clicks: f.clicks,
            impressions: f.impressions,
            ctr: rate(f.clicks, f.impressions),
            position: f.position,
            trend: days.length > 1 && held >= f.impressions ? days.map((d) => d.impressions) : null,
          };
        }),
      },
      "gsc",
      google.at,
      `Google Search, web results: Search Console's own figure per page for ${google.window.start} to ${google.window.end}, as the desk last read it. Most clicks first, then most impressions.${google.complete ? "" : " Google's row limit cut the list."}`,
    );
  }

  if (!span) return historyAbsent();
  const figures = pageFigures(span.start, span.end, where)
    .filter((p) => p.impressions > 0)
    .sort(byClicks)
    .slice(0, TOP_PAGES);
  /* The same days, counted two ways: the page rows and the property's own total. Clicks by page can only add up to more, never to fewer. */
  const totals = rankTotals(span.start, span.end, where);
  if (!figures.length) {
    const words = whereWords(asked) ? ` (${whereWords(asked)})` : "";
    /* Google did show the site, but the page history kept no row of it: say that, never "no page was shown". */
    return totals.impressions > 0
      ? waiting("gsc", `The desk's day-by-day page history holds none of the ${fmt(totals.impressions)} impressions and ${fmt(totals.clicks)} clicks Google counts for the site in this window${words}, so no page can be named. Choose all countries and devices to read Google's own figure per page.`)
      : waiting("gsc", `Google showed no page of the site in a search in this window${words}.`);
  }
  const all = pageFigures(span.start, span.end, where).reduce((n, p) => n + p.clicks, 0);
  const property = totals.clicks;
  const short = all < property ? { pageClicks: all, propertyClicks: property } : null;
  return ok(
    {
      basis: "history",
      window: { start: span.start, end: span.end },
      short,
      rows: figures.map((f) => ({
        page: pageRef(f.path, view),
        clicks: f.clicks,
        impressions: f.impressions,
        ctr: rate(f.clicks, f.impressions),
        position: f.position,
        trend: short ? null : pageSeries(f.path, span.start, span.end, where).map((d) => d.impressions),
      })),
    },
    "gsc",
    historyAt(),
    `${HISTORY_NOTE} Most clicks first, then most impressions.${whereWords(asked) ? ` ${whereWords(asked)[0]!.toUpperCase()}${whereWords(asked).slice(1)}.` : ""}${
      short ? ` The day-by-day page history holds ${fmt(short.pageClicks)} of the ${fmt(short.propertyClicks)} clicks Google counts for the property in these days, so these rows are part of each page's figure.` : ""
    }`,
  );
}

/* ---------- content gaps --------------------------------------------------------------------------- */

function gapsPanel(view: SiteView, open: OpportunityRow[]): Reading<GapsPanel> {
  const all = clusters();
  if (!all.length) return waiting("desk", "No keyword clusters yet: they come in with the SEO audit's import (scripts/seo-import.ts), and Search Console's queries are added to them as they arrive.");
  const kw = keywords();
  const rows = all.map((c) => {
    const phrases = kw.filter((k) => k.cluster === c.key && k.status !== "irrelevant");
    const relevant = phrases.filter((k) => k.status === "relevant");
    const judged = relevant.length ? relevant : phrases;
    const mapped = judged.filter((k) => k.page && view.byPath.get(k.page)?.lang === c.lang).length;
    /* The cluster's gap opportunity while it is open, queued or in progress: a queued brief keeps its row's
       mark ("Queued") instead of falling back to a plain link the moment its button was pressed. */
    const opp = open.find((r) => r.id === `${c.lang === "de" ? "german-missing" : "keyword-gap"}:${c.key}`);
    return {
      key: c.key,
      name: c.name,
      lang: c.lang,
      priority: c.priority,
      coverage: { mapped, of: judged.length },
      page: c.page,
      opportunityId: opp?.id ?? null,
      action: opp ? actionOf(opp) : null,
      rank: c.rank,
    };
  });
  rows.sort(
    (a, b) =>
      Number(!!a.page) - Number(!!b.page) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.rank ?? 9999) - (b.rank ?? 9999) || b.coverage.of - a.coverage.of || a.name.localeCompare(b.name),
  );
  const gaps = all.filter((c) => !c.page);
  return ok(
    {
      clusters: all.length,
      gaps: gaps.length,
      germanGaps: gaps.filter((c) => c.lang === "de").length,
      rows: rows.slice(0, 8).map(({ rank: _rank, ...r }) => r),
    },
    "desk",
    new Date().toISOString(),
    "Clusters of real searches (the audit's keyword research, Search Console, Google Autocomplete). Coverage is the share of a cluster's relevant phrases mapped to a page in the cluster's language. The site is English only, so every German cluster is a gap.",
  );
}

/* ---------- technical ---------------------------------------------------------------------------------- */

const METADATA_FIX = (label: string): TechnicalRow["fix"] => ({ kind: "metadata", label, task: { kind: "metadata", depth: "deep" } });
const REDIRECT_FIX: TechnicalRow["fix"] = { kind: "redirect", label: "Propose redirects", task: { kind: "redirect", depth: "deep" } };

/**
 * The crawl's rules by family, in the order the panel lists them when all is
 * well. EVERY rule of src/cc/site/rules.ts belongs to exactly one family
 * (scripts/check-cc-seo-overview.ts proves it), so a finding of the crawl can
 * never be missing from this panel: before, ten fixed rows read all green
 * while the crawl reported 2 warnings and 39 opportunities under rules that
 * had no row. `anchor` is the family's own section of SEO › Technical.
 */
export const TECH_FAMILIES: { key: string; label: string; anchor: string; rules: site.RuleId[]; what: string; fix?: "titles" | "descriptions" | "redirects" }[] = [
  { key: "answers", label: "Pages that do not answer", anchor: "issues", rules: ["page.status", "page.unreadable"], what: "Sitemap addresses that do not answer 200, or answer and cannot be read" },
  { key: "noindex", label: "In the sitemap but noindex", anchor: "issues", rules: ["page.noindex-in-sitemap"], what: "Sitemap addresses whose live page says noindex" },
  { key: "broken", label: "Broken links", anchor: "broken", rules: ["links.broken", "links.external-broken"], what: "Links on the site's pages to an address, of the site or outside it, that does not answer", fix: "redirects" },
  { key: "canonical", label: "Canonical issues", anchor: "issues", rules: ["canonical.missing", "canonical.mismatch"], what: "Pages without a canonical, or whose canonical points at another address" },
  { key: "title", label: "Title issues", anchor: "issues", rules: ["title.missing", "title.long", "title.duplicate"], what: "Pages with no title, a title search results cut, or a title another page also uses", fix: "titles" },
  { key: "description", label: "Description issues", anchor: "issues", rules: ["description.missing", "description.long", "description.duplicate"], what: "Pages with no meta description, one search results cut, or one another page also uses", fix: "descriptions" },
  { key: "headings", label: "Heading issues", anchor: "issues", rules: ["h1.missing", "h1.multiple", "h1.duplicate", "h2.duplicate"], what: "Pages with no main heading, more than one, or headings another page also uses" },
  { key: "schema", label: "Structured data", anchor: "schema", rules: ["schema.none", "schema.site-only", "schema.incomplete", "schema.unreadable"], what: "Pages with no structured data, none of their own, a required field missing, or data that is not valid JSON" },
  { key: "content", label: "Thin or duplicate content", anchor: "duplicates", rules: ["content.thin", "content.duplicate", "content.near-duplicate", "lang.missing"], what: "Pages under the crawl's word yardstick, pages with the same or nearly the same text as another, and pages that declare no language" },
  { key: "share", label: "Share titles and pictures", anchor: "issues", rules: ["share.missing", "share.default-picture", "share.no-card"], what: "Pages with no share title or picture, on the site's default share picture, or without a card for X" },
  { key: "orphan", label: "Orphan pages", anchor: "issues", rules: ["links.orphan"], what: "Sitemap pages no other page links to" },
  { key: "redirects", label: "Redirect issues", anchor: "redirects", rules: ["redirect.broken", "redirect.chain", "redirect.loop", "page.redirects", "links.redirected"], what: "Promised redirects that do not work or loop, redirects of more than one hop, sitemap addresses that redirect, and links that go through a redirect" },
  { key: "alt", label: "Image issues (alt text)", anchor: "issues", rules: ["images.alt-absent", "images.unnamed-link"], what: "Pictures without an alt attribute and linked pictures with no name" },
  {
    key: "sitemap",
    label: "Sitemap and robots.txt",
    anchor: "sitemap",
    rules: ["sitemap.unreachable", "sitemap.malformed", "sitemap.off-host", "sitemap.duplicate", "sitemap.blocked", "robots.unreachable", "robots.no-sitemap", "page.missing-from-sitemap"],
    what: "A sitemap or robots.txt that does not answer or is not well-formed, addresses listed twice, on another host or blocked, and indexable pages the sitemap leaves out",
  },
];

const SEVERITY_RANK: Record<site.Severity, number> = { critical: 0, warning: 1, opportunity: 2 };
const TONE_RANK: Record<TechnicalRow["tone"], number> = { bad: 0, warn: 1, good: 2 };

function technicalPanel(): Reading<TechnicalPanel> {
  const counts = site.issueCounts();
  if (counts.state !== "ok") return counts;
  const by = new Map(counts.value.byRule.map((r) => [r.rule, r]));
  const rows: TechnicalRow[] = [];

  /* Google's index: each address's newest result, the same count as the tile's (see indexStand). */
  const stand = indexStand();
  if (stand) {
    rows.push({
      key: "not-indexed",
      label: "Not indexed",
      count: stand.notIndexed,
      tone: stand.notIndexed ? "bad" : "good",
      href: "/seo/technical#indexing",
      of: stand.of,
      source: "gsc",
      rule: `Sitemap addresses whose newest answer from Google's URL Inspection is "not indexed" (newest check ${stand.day}).${stand.cutShort ? ` ${stand.cutShort}` : ""}`,
      found: [],
      fix: null,
    });
  }

  let unfiled = 0;
  const filed = new Set<site.RuleId>(TECH_FAMILIES.flatMap((f) => f.rules));
  for (const r of counts.value.byRule) if (!filed.has(r.rule)) unfiled += r.count;

  for (const f of TECH_FAMILIES) {
    const fired = f.rules.flatMap((rule) => (by.get(rule)?.count ? [by.get(rule)!] : [])).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count);
    const count = fired.reduce((n, r) => n + r.count, 0);
    /* A critical finding is red; a warning or an opportunity is amber: never green while the crawl holds something against a page. */
    const tone: TechnicalRow["tone"] = !count ? "good" : fired.some((r) => r.severity === "critical") ? "bad" : "warn";
    /* Fix where an operator task exists for what was found: titles and descriptions (any rule of theirs), redirects for links to the site's own missing addresses. */
    const fix: TechnicalRow["fix"] =
      !count ? null : f.fix === "titles" ? METADATA_FIX("Propose titles") : f.fix === "descriptions" ? METADATA_FIX("Propose descriptions") : f.fix === "redirects" && by.get("links.broken")?.count ? REDIRECT_FIX : null;
    rows.push({
      key: f.key,
      label: f.label,
      count,
      tone,
      href: `/seo/technical#${f.anchor}`,
      of: null,
      source: "crawl",
      rule: `${f.what}, by the crawl.${fired.length ? ` Found: ${fired.map((r) => `${r.title} (${fmt(r.count)})`).join(", ")}.` : ""}`,
      found: fired.map((r) => ({ rule: r.rule, title: r.title, severity: r.severity, count: r.count })),
      fix,
    });
  }

  const lab = site.labRuns("mobile");
  if (lab.state === "ok") {
    const measured = lab.value.filter((r) => r.lcpMs !== null);
    const slow = measured.filter((r) => (r.lcpMs ?? 0) > 2500).length;
    if (measured.length) {
      rows.push({
        key: "slow",
        label: "Slow pages (lab LCP > 2.5 s)",
        count: slow,
        tone: slow ? "warn" : "good",
        href: "/seo/technical#speed",
        of: measured.length,
        source: "psi",
        rule: "Pages of the daily PageSpeed test whose mobile lab Largest Contentful Paint is over 2.5 seconds. A lab run on Google's machines, not visitors' field data.",
        found: [],
        fix: null,
      });
    }
  }

  /* What needs a person first: red, then amber, then what is clean; inside each, the order above. */
  const order = new Map(rows.map((r, i) => [r.key, i]));
  rows.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || order.get(a.key)! - order.get(b.key)!);

  return ok(
    { rows, findings: { critical: counts.value.critical, warning: counts.value.warning, opportunity: counts.value.opportunity }, unfiled, crawledAt: site.crawledAt() },
    "crawl",
    counts.asOf,
    "The desk's crawl by its stated rules (src/cc/site/rules.ts), every rule in one of these lines; Google's URL Inspection for the index; PageSpeed's lab for speed.",
  );
}

/* ---------- presence ------------------------------------------------------------------------------------ */

async function presencePanel(range: SeoRange): Promise<Reading<PresencePanel>> {
  const bingLinks: PresencePanel["bing"] = bing.configured()
    ? await reading("bing", async () => {
        const r = await bing.linkCounts();
        return r.state === "ok" ? { ...r, value: { total: r.value.total } } : r;
      })
    : off("bing", "Bing Webmaster Tools is not connected. Google gives no backlink API: Bing's index of links is the one free source.", bing.step());

  let referrers: PresencePanel["referrers"];
  const span = referralSpan();
  if (!hasKey()) referrers = off("ga4", "The desk has no Google service-account key on this machine, so GA4 cannot be asked for referrals.");
  else if (!span) referrers = waiting("ga4", "GA4's referrals are read once a day (Automations: Read referrals and AI assistant visits from GA4); the first read has not run yet.");
  else {
    /* The window ends on the last day GA4 was read through, not yesterday: no count is stated for a day nobody asked about. */
    const read = referralsRead(span);
    const w = windowTo(range, read.through);
    const rows = db
      .prepare("SELECT source, SUM(sessions) AS n FROM cc_seo_referrals WHERE day >= ? AND day <= ? AND medium = 'referral' GROUP BY source ORDER BY n DESC")
      .all(w.start, w.end) as { source: string; n: number }[];
    const human = rows.filter((r) => !isAi(r.source, "referral"));
    referrers = ok(
      { start: w.start, end: w.end, total: human.reduce((s, r) => s + r.n, 0), rows: human.slice(0, 5).map((r) => ({ host: r.source, sessions: r.n })) },
      "ga4",
      read.at,
      `GA4 sessions whose medium is referral, consenting visitors only, ${w.start} to ${w.end}: the days the desk has read. AI assistants are counted on AI Search instead.`,
    );
  }

  const p = profiles();
  const value: PresencePanel = {
    bing: bingLinks,
    referrers,
    profiles: {
      exist: p.filter((x) => x.state === "exists").length,
      missing: p.filter((x) => x.state === "not-found").length,
      unknown: p.filter((x) => x.state === "unknown" || x.state === "not-checked").length,
      of: p.length,
    },
    known: await knownLinks(),
  };
  return ok(value, "desk", new Date().toISOString());
}

/**
 * The links known without Bing, from the desk's own backlink tables
 * (src/cc/seo/backlinks.ts): what Google's Links report said when the owner
 * last imported it, and what the desk's own reading of each linking page
 * found. Read from the tables only; nothing is fetched here. The library is
 * loaded when the panel is drawn, so a fault in it costs this one line of the
 * panel, not the Overview.
 */
async function knownLinks(): Promise<PresencePanel["known"]> {
  try {
    const backlinks = await import("../../seo/backlinks.ts");
    const g = backlinks.googleLinks();
    const rows = backlinks.knownLinks();
    if (!g && !rows.length) {
      return waiting(
        "desk",
        "No link is known yet besides Bing's. On SEO › Backlinks, import Search Console's Links report (Search Console › Links › Export), or name a page that links to the site, and the desk reads it once a week.",
      );
    }
    const imports = g ? Object.values(g.imported).flatMap((i) => (i ? [i.at] : [])).sort() : [];
    const live = rows.filter((r) => r.state === "live").length;
    const lost = rows.filter((r) => r.state === "lost").length;
    return ok(
      {
        google: g ? { sites: g.sites.length, pages: g.pages.length, importedAt: imports.at(-1) ?? null } : null,
        read: { live, lost, other: rows.length - live - lost, all: rows.length },
      },
      "desk",
      rows.map((r) => r.checkedAt ?? r.firstSeen).sort().at(-1) ?? imports.at(-1) ?? new Date().toISOString(),
      "Google's Links report as the owner last imported it from Search Console, and the linking pages the desk reads itself: a link is live when its own reading found it on the page, lost when a later reading no longer did.",
    );
  } catch {
    return waiting("desk", "The desk's backlink tables are not on this desk yet.");
  }
}

/* ---------- Search Console ------------------------------------------------------------------------------ */

function consolePanel(span: SeoSpan | null, asked: OverviewAsked = ALL): Reading<ConsolePanel> {
  if (!span) return historyAbsent();
  const where = whereOf(asked);
  const t = rankTiles(span, where);
  const a = gsc.access();
  const words = whereWords(asked);
  return ok(
    {
      clicks: t.clicks,
      impressions: t.impressions,
      position: t.position,
      days: daySeries(span.start, span.end, where).map((d) => ({ date: d.date, clicks: d.clicks, impressions: d.impressions })),
      href: a.state === "ok" && a.site ? `https://search.google.com/search-console/performance/search-analytics?resource_id=${encodeURIComponent(a.site)}` : null,
    },
    "gsc",
    historyAt(),
    words ? `${HISTORY_NOTE} ${words[0]!.toUpperCase()}${words.slice(1)}.` : HISTORY_NOTE,
  );
}

/* ---------- what moved ------------------------------------------------------------------------------------ */

const MOVED_SHOWN = 5;

/** How many of the queries Google reports stood where, by their average position over the window. */
function spreadOf(rows: { position: number | null }[]): SpreadCounts {
  const s: SpreadCounts = { top3: 0, top10: 0, top20: 0, beyond: 0, queries: 0 };
  for (const q of rows) {
    if (q.position === null) continue;
    s.queries++;
    if (q.position <= 3) s.top3++;
    else if (q.position <= 10) s.top10++;
    else if (q.position <= 20) s.top20++;
    else s.beyond++;
  }
  return s;
}

/**
 * What moved between this window and the one before, from the desk's own
 * Search Console history and its log of the daily index check:
 *
 *   new, lost   queries Google reports in one window and not in the other.
 *               Google withholds rare queries, so a query "new" here was
 *               either not shown before or shown too rarely to be reported;
 *   moved       the largest changes of average position among queries shown
 *               at least FLOOR.drop times in BOTH windows (rules.ts): a change
 *               on fewer impressions is noise, and none is listed;
 *   spread      how many reported queries stand in the top 3, 4 to 10, 11 to
 *               20 and beyond, now and before;
 *   indexed,    pages the daily index check saw enter or leave Google's index
 *   dropped     inside the window (the log's gsc.indexed / gsc.dropped lines).
 *
 * Nothing is called new, lost or moved unless the history covers the window
 * before from its first day (`compared`); then the panel says since when.
 */
function movementsPanel(span: SeoSpan | null, asked: OverviewAsked = ALL): Reading<MovementsPanel> {
  if (!span) return historyAbsent();
  const where = whereOf(asked);
  const now = queryFigures(span.start, span.end, where);
  const toMoved = (q: { query: string; clicks: number; impressions: number; position: number | null }): MovedQuery => ({ query: q.query, clicks: q.clicks, impressions: q.impressions, position: q.position, previousPosition: null });

  let added: MovementsPanel["added"] = null;
  let lost: MovementsPanel["lost"] = null;
  let moved: MovedQuery[] = [];
  let before: SpreadCounts | null = null;
  let reason: string | null = span.compared
    ? null
    : `The desk's history of Search Console begins ${span.historyFrom ?? "later"}, after the window before (${span.previousStart} to ${span.previousEnd}) began, so nothing is called new, lost or moved yet.`;
  const then = span.compared ? queryFigures(span.previousStart, span.previousEnd, where) : [];
  /* Google reported no query at all for the window before although it showed the site then: every one was withheld
     as rare. A query "new" against that would be a guess, so none is called new (the earlier screen's rule too). */
  if (span.compared && !then.length && rankTotals(span.previousStart, span.previousEnd, where).impressions > 0) {
    reason = `Google reported no query for the window before (${span.previousStart} to ${span.previousEnd}): it withholds rare ones, and every search then was rare. So no query is called new, lost or moved against it.`;
  }
  if (!reason) {
    const nl = newAndLost(span, where);
    if (nl) {
      added = { total: nl.added.length, rows: nl.added.slice(0, MOVED_SHOWN).map(toMoved) };
      lost = { total: nl.lost.length, rows: nl.lost.slice(0, MOVED_SHOWN).map(toMoved) };
    }
    const was = new Map(then.map((q) => [q.query, q]));
    moved = now
      .flatMap((q) => {
        const b = was.get(q.query);
        if (!b || q.position === null || b.position === null || q.impressions < FLOOR.drop || b.impressions < FLOOR.drop) return [];
        return Math.abs(q.position - b.position) >= 0.5 ? [{ ...toMoved(q), previousPosition: b.position }] : [];
      })
      .sort((a, b) => Math.abs(b.position! - b.previousPosition!) - Math.abs(a.position! - a.previousPosition!))
      .slice(0, MOVED_SHOWN);
    before = spreadOf(then);
  }

  /* The index check's own log lines, inside the window's days and up to now (the history runs two to three days behind today). */
  const events = (kind: string): { path: string; at: string }[] => {
    const rows = db.prepare("SELECT at, text FROM cc_activity WHERE kind = ? AND at >= ? ORDER BY at DESC LIMIT 200").all(kind, `${span.start}T00:00:00.000Z`) as { at: string; text: string }[];
    return rows.flatMap((r) => {
      const path = /(\/[^\s]*)/.exec(r.text)?.[1];
      return path ? [{ path, at: r.at }] : [];
    });
  };
  const indexed = events("gsc.indexed");
  const dropped = events("gsc.dropped");
  const words = whereWords(asked);

  return ok(
    {
      window: { start: span.start, end: span.end, previousStart: span.previousStart, previousEnd: span.previousEnd },
      compared: !reason,
      reason,
      historyFrom: span.historyFrom,
      added,
      lost,
      moved,
      floor: FLOOR.drop,
      spread: { now: spreadOf(now), before },
      indexed: { total: indexed.length, rows: indexed.slice(0, MOVED_SHOWN) },
      dropped: { total: dropped.length, rows: dropped.slice(0, MOVED_SHOWN) },
    },
    "gsc",
    historyAt(),
    `${HISTORY_NOTE}${words ? ` ${words[0]!.toUpperCase()}${words.slice(1)}.` : ""} Pages entering or leaving the index come from the desk's daily URL Inspection, seen on the next daily check, not when it happens.`,
  );
}

/* ---------- from search, as GA4 counts it ------------------------------------------------------------------- */

/**
 * What the people Google sent did: GA4's sessions and people in the channel
 * group Organic Search, for the same number of days (GA4 counts whole days to
 * yesterday in the property's time zone; Search Console runs two to three
 * days behind, so the two windows are named, never set side by side as one).
 * The read is the one the Traffic screen keeps warm (ga4.ts `channels`, kept
 * fifteen minutes): it asks GA4 only when that kept answer has aged.
 * Consenting visitors only, which the note says.
 */
async function organicPanel(range: SeoRange): Promise<Reading<OrganicPanel>> {
  if (!hasKey()) return off("ga4", "The desk has no Google service-account key on this machine, so GA4 cannot be asked.");
  const read = await ga4.channels(range);
  return ga4.asReading(read, (d): OrganicPanel => {
    const row = d.rows.find((r) => r.key === "organic-search") ?? null;
    return {
      start: d.span.start,
      end: d.span.end,
      sessions: { value: row?.sessions ?? 0, previous: row?.previous ? row.previous.sessions : d.span.previous ? 0 : null, unit: "count", series: [] },
      users: { value: row?.users ?? 0, previous: row?.previous ? row.previous.users : d.span.previous ? 0 : null, unit: "count", series: [] },
      allSessions: d.sessions,
    };
  });
}

/* ---------- AI search -------------------------------------------------------------------------------------- */

async function aiPanel(range: SeoRange): Promise<Reading<AiPanel>> {
  const w = dayWindow(range);
  const t = tally();
  const span = referralSpan();
  let referrals: AiPanel["referrals"];
  if (!hasKey()) referrals = off("ga4", "The desk has no Google service-account key on this machine, so GA4 cannot be asked.");
  else if (!span) referrals = waiting("ga4", "AI assistant visits are read from GA4 once a day (Automations: Read referrals and AI assistant visits from GA4); the first read has not run yet.");
  else {
    /* As for the referrers on Backlinks: the days GA4 was read through, never a day nobody asked about. */
    const read = referralsRead(span);
    const v = windowTo(range, read.through);
    referrals = ok(
      { sessions: aiReferrals(v.start, v.end, null).sessions, start: v.start, end: v.end },
      "ga4",
      read.at,
      "Sessions from chatgpt.com, perplexity.ai, gemini.google.com, copilot.microsoft.com, claude.ai and you.com, consenting visitors only.",
    );
  }
  const crawlers = await reading<{ hits: number; days: number }>("vercel-drain", async () => {
    const c = await aiCrawlers(w.start, w.end);
    if (!c.deliveredDays) return waiting("vercel-drain", "Vercel's request records have not reached the desk for any day of this window: the log drain is set up on Hosting.");
    return ok({ hits: c.hits, days: c.deliveredDays }, "vercel-drain", new Date().toISOString(), "Requests by named AI crawlers (GPTBot, ClaudeBot, PerplexityBot …) on the days Vercel's records were delivered.");
  });
  return ok(
    {
      checks: {
        asked: t.reduce((n, e) => n + e.asked, 0),
        mentioned: t.reduce((n, e) => n + e.mentioned, 0),
        unprompted: { asked: t.reduce((n, e) => n + e.unprompted.asked, 0), mentioned: t.reduce((n, e) => n + e.unprompted.mentioned, 0) },
        lastDay: t.map((e) => e.day).sort().at(-1) ?? null,
      },
      referrals,
      crawlers,
      window: w,
    },
    "desk",
    new Date().toISOString(),
  );
}

/* ---------- running now ------------------------------------------------------------------------------------- */

const SEO_TASK_KINDS = new Set<TaskKind>(["metadata", "redirect", "brief", "opportunities", "audit"]);

/** The SEO log's line for an operator task queued from this page links to it with exactly this address. */
const taskHref = (id: number): string => `/operator?result=${id}#response`;

/** Operator tasks queued from this page in the last week (POST /task wrote each to the SEO log), by id. */
function queuedHere(): Set<number> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const rows = db.prepare("SELECT href FROM cc_activity WHERE kind = 'seo-action' AND href LIKE '/operator?result=%' AND at >= ?").all(since) as { href: string }[];
  return new Set(rows.map((r) => Number(/result=(\d+)/.exec(r.href)?.[1])).filter((n) => Number.isInteger(n) && n > 0));
}

export function running(): RunningPanel {
  const jobs = seoJobs();
  const linked = new Map((db.prepare("SELECT id, task_id FROM cc_seo_opps WHERE task_id IS NOT NULL").all() as { id: string; task_id: number }[]).map((r) => [r.task_id, r.id]));
  let audit: AuditRun | null = null;
  try {
    audit = auditRun();
  } catch {
    audit = null;
  }
  /*
   * The audit asks the scheduler for its steps all at once, and the scheduler
   * keeps that queue in memory: a desk that restarted after the audit began
   * has forgotten the steps not started. They are listed as lost, not as
   * waiting, until audit.ts says so itself (after 45 minutes).
   */
  const bootedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
  const waitingSteps = audit && audit.state === "running" ? audit.steps.filter((s) => s.state === "queued") : [];
  const forgotten = !!audit && audit.startedAt < bootedAt;
  const here = queuedHere();
  const tasks = openRows()
    .filter((t) => SEO_TASK_KINDS.has(t.kind) || linked.has(t.id) || here.has(t.id))
    .map((t) => ({
      id: t.id,
      title: t.title,
      kindLabel: t.kindLabel,
      state: t.state === "running" ? ("running" as const) : ("queued" as const),
      opportunityId: linked.get(t.id) ?? null,
      href: taskHref(t.id),
      ahead: t.ahead,
    }));
  return {
    jobs: jobs.filter((j) => j.running),
    tasks,
    queued: forgotten ? [] : waitingSteps.map((s) => ({ job: s.job, title: s.title })),
    lost: forgotten ? waitingSteps.map((s) => ({ job: s.job, title: s.title, at: engineJob(s.job)?.nextRun ?? null })) : [],
    bootedAt,
    next: jobs
      .filter((j) => j.nextRun && j.enabled && !j.running)
      .sort((a, b) => a.nextRun!.localeCompare(b.nextRun!))
      .slice(0, 4)
      .map((j) => ({ name: j.name, title: j.title, at: j.nextRun! })),
    runner: runnerState(),
    at: new Date().toISOString(),
  };
}

/* ---------- recent SEO actions -------------------------------------------------------------------------------- */

/**
 * The SEO engine's log, people's decisions, the crawl, and the operator's SEO
 * work (titles, redirects, briefs, and any task queued from this page, a
 * question included), newest first.
 */
function recent(limit = 12): ActivityItem[] {
  const kinds = [...SEO_KINDS, "crawl", "operator-proposal", "operator-change"];
  const marks = kinds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT a.id, a.at, a.kind, a.tone, a.text, a.detail, a.href, a.actor FROM cc_activity a
       WHERE a.kind IN (${marks})
          OR (a.kind = 'operator' AND EXISTS (
                SELECT 1 FROM cc_ai_tasks t
                WHERE a.href LIKE '/operator?result=%'
                  AND t.id = CAST(substr(a.href, length('/operator?result=') + 1) AS INTEGER)
                  AND (t.kind IN ('metadata', 'redirect', 'brief', 'opportunities', 'audit')
                       OR EXISTS (SELECT 1 FROM cc_activity s WHERE s.kind = 'seo-action' AND s.href = '/operator?result=' || t.id || '#response'))))
       ORDER BY a.at DESC, a.id DESC LIMIT ?`,
    )
    .all(...kinds, limit) as { id: number; at: string; kind: string; tone: Tone; text: string; detail: string | null; href: string | null; actor: string | null }[];
  return rows.map((r) =>
    scrubItem({ id: r.id, at: r.at, kind: r.kind, tone: r.tone, text: r.text, ...(r.detail ? { detail: r.detail } : {}), ...(r.href ? { href: r.href } : {}), ...(r.actor ? { actor: r.actor } : {}) }),
  );
}

/* ---------- what the engine is built of ----------------------------------------------------------------------- */

const fmt = (n: number): string => n.toLocaleString("en-GB");
const plural = (n: number, one: string, many = `${one}s`): string => `${fmt(n)} ${n === 1 ? one : many}`;
const shortDay = (d: string): string => {
  const [y, m, day] = d.split("-").map(Number);
  return `${day} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][(m ?? 1) - 1]} ${y}`;
};

function engineParts(open: OpportunityRow[]): EnginePart[] {
  const parts: EnginePart[] = [];
  const access = gsc.access();

  const h = historyFacts();
  parts.push(
    h
      ? { key: "rank-history", title: "Rank history", line: `Search Console kept day by day, ${shortDay(h.from)} to ${shortDay(h.to)}: ${plural(h.days, "day")}, ${plural(h.rows, "row")}.`, state: "ok", source: "gsc", href: "/seo/search-console" }
      : {
          key: "rank-history",
          title: "Rank history",
          line: access.state === "ok" ? "Connected; the first snapshot of Search Console's history has not run yet." : gsc.reasonFor(access),
          state: access.state === "ok" ? "waiting" : "off",
          source: "gsc",
          href: "/seo/search-console",
        },
  );

  /* The keyword table's counts from the one place every SEO page takes them from (src/cc/seo/figures.ts). */
  const kf = keywordFigures();
  const phrases = kf.all;
  const relevant = kf.relevant;
  const nClusters = kf.clusters;
  const b = budget();
  parts.push({
    key: "keywords",
    title: "Keywords and clusters",
    line: phrases ? `${plural(phrases, "phrase")} (${fmt(relevant)} relevant) in ${plural(nClusters, "cluster")}; Google Autocomplete ${b.used} of ${b.cap} this week.` : "No phrases yet: the audit's keyword table comes in with the SEO import.",
    state: phrases ? "ok" : "waiting",
    source: "desk",
    href: "/seo/keywords",
  });

  const high = open.filter((r) => r.priority === "high").length;
  const ej = engineJob("seo-engine");
  parts.push({
    key: "opportunities",
    title: "Opportunity engine",
    line: count("SELECT COUNT(*) AS n FROM cc_seo_opps")
      ? `${plural(open.length, "open opportunity", "open opportunities")}, ${fmt(high)} high priority${ej?.lastEnd ? `; last run ${shortDay(ej.lastEnd.slice(0, 10))}` : ""}.`
      : ej
        ? "Registered; it has not found anything yet."
        : "Its job is not registered on this desk yet.",
    state: count("SELECT COUNT(*) AS n FROM cc_seo_opps") ? "ok" : "waiting",
    source: "desk",
    href: "/seo/opportunities",
  });

  /* The same count as the tile's: each address's newest result, and how far the newest check got when it was cut short. */
  const stand = indexStand();
  parts.push(
    stand
      ? {
          key: "indexation",
          title: "Indexation",
          line: `${fmt(stand.indexed)} of ${fmt(stand.of)} sitemap addresses indexed, ${fmt(stand.notIndexed)} not${stand.missing ? `, ${fmt(stand.missing)} not checked` : ""} (newest check ${shortDay(stand.day)}${stand.cutShort ? ", cut short" : ""}); ${plural(count("SELECT COUNT(*) AS n FROM cc_seo_opps WHERE type = 'not-indexed' AND active = 1 AND state = 'open'"), "address", "addresses")} waiting for Request indexing.`,
          state: "ok",
          source: "gsc",
          href: "/seo/technical#indexing",
        }
      : { key: "indexation", title: "Indexation", line: access.state === "ok" ? "The daily URL Inspection has not finished a round yet." : gsc.reasonFor(access), state: access.state === "ok" ? "waiting" : "off", source: "gsc", href: "/seo/technical#indexing" },
  );

  const t = tally();
  const asked = t.reduce((n, e) => n + e.asked, 0);
  parts.push({
    key: "ai-search",
    title: "AI search",
    line: asked
      ? `${plural(asked, "answer")} of ${plural(t.length, "assistant")} recorded; Balkaris named in ${fmt(t.reduce((n, e) => n + e.mentioned, 0))}. Readiness checked on ${plural(count("SELECT COUNT(*) AS n FROM cc_seo_readiness"), "page")}.`
      : "No AI answers recorded yet; visits and crawlers are counted as they arrive.",
    state: asked ? "ok" : "waiting",
    source: "desk",
    href: "/seo/ai-search",
  });

  const names = competitorNames();
  const seen = sightings();
  const read = competitorPages().filter((p) => p.fetchedAt).length;
  parts.push({
    key: "competitors",
    title: "Competitors",
    line: names.size ? `${plural(names.size, "domain")} seen beside or instead of Balkaris in ${plural(new Set(seen.map((s) => s.query)).size, "search", "searches")}; ${plural(read, "page")} of theirs read.` : "None recorded yet: they come from captured results and AI answers.",
    state: names.size ? "ok" : "waiting",
    source: "desk",
    href: "/seo/competitors",
  });

  const p = profiles();
  parts.push({
    key: "presence",
    title: "Profiles and listings",
    line: p.length ? `${fmt(p.filter((x) => x.state === "exists").length)} of ${plural(p.length, "profile")} exist, ${fmt(p.filter((x) => x.state === "not-found").length)} not found; Bing's links ${bing.configured() ? "read daily" : "wait for Bing Webmaster"}.` : "No profiles recorded yet: they come in with the SEO import.",
    state: p.length ? "ok" : "waiting",
    source: "desk",
    href: "/seo/backlinks",
  });

  /* The same scope as the Needs you panel and the sidebar's count (the owner's own steps), with the steps
     the lead takes in the owner's browser named apart, so the two counts on the page agree. */
  const owner = ownerTasks(["owner"]);
  const browser = ownerTasks(["lead-chrome"]);
  const openOf = (l: typeof owner) => l.filter((x) => !x.done).length;
  parts.push({
    key: "owner-tasks",
    title: "Needs you",
    line:
      owner.length || browser.length
        ? `${plural(openOf(owner), "step")} open for you, ${fmt(owner.length - openOf(owner))} done; ${plural(openOf(browser), "step")} for the lead in your browser, ${fmt(browser.length - openOf(browser))} done.`
        : "No owner steps recorded yet: they come in with the SEO import.",
    state: owner.length || browser.length ? "ok" : "waiting",
    source: "desk",
    href: "/seo#needs-you",
  });
  return parts;
}

/* ---------- the page ------------------------------------------------------------------------------------------- */

/**
 * The whole page. `asked` narrows the Search Console figures to a country or
 * a device; `can` is what the person looking may do with the buttons (left
 * out by a caller that is not a person: everything is then allowed, as for
 * the owner).
 */
export async function overview(range: SeoRange, asked: OverviewAsked = ALL, can?: OverviewCan): Promise<SeoOverviewPayload> {
  const h = head(range);
  const span = h.span;
  const view = siteView();
  let open: OpportunityRow[] = [];
  try {
    open = openOpportunities(view);
  } catch {
    open = [];
  }
  const safe = <T>(fallback: T, f: () => T): T => {
    try {
      return f();
    } catch {
      return fallback;
    }
  };

  const [priority, keywords, top, gaps, technical, presence, searchConsole, movements, organic, aiSearch, needsYou] = await Promise.all([
    reading("desk", () => priorityPanel(open)),
    reading("gsc", () => keywordPanel(open)),
    reading("gsc", () => topPages(range, span, view, asked)),
    reading("desk", () => gapsPanel(view, open)),
    reading("crawl", () => technicalPanel()),
    reading("desk", () => presencePanel(range)),
    reading("gsc", () => consolePanel(span, asked)),
    reading("gsc", () => movementsPanel(span, asked)),
    reading("ga4", () => organicPanel(range)),
    reading("desk", () => aiPanel(range)),
    reading("desk", () => {
      const rows = ownerTasks(["owner"]);
      if (!rows.length) return waiting<{ open: number; done: number; rows: typeof rows }>("desk", "No owner steps recorded yet: the audit's owner tasks come in with the SEO import (scripts/seo-import.ts).");
      return ok({ open: rows.filter((r) => !r.done).length, done: rows.filter((r) => r.done).length, rows: rows.map(({ whoAll: _w, ...r }) => r) }, "desk", new Date().toISOString(), "Steps only the owner can take: logins, decisions, profiles. Marked done by a person, never by the desk.");
    }),
  ]);

  return {
    head: h,
    asked,
    can: can ?? { operate: true, ownerSteps: true, run: safe([], () => seoJobs().map((j) => j.name)) },
    tiles: safe(
      { brand: null, health: site.siteScore(daysOf(range)), indexed: waiting("gsc", "Could not be read."), clicks: historyAbsent(), impressions: historyAbsent(), position: historyAbsent(), ctr: historyAbsent(), ai: waiting("desk", "Could not be read.") },
      () => tilesOf(range, span, asked),
    ),
    priority,
    keywords,
    topPages: top,
    contentGaps: gaps,
    technical,
    presence,
    searchConsole,
    movements,
    organic,
    aiSearch,
    needsYou,
    running: safe<RunningPanel>(
      {
        jobs: [],
        tasks: [],
        queued: [],
        lost: [],
        bootedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
        next: [],
        runner: { state: "never", lastSeen: null, line: "The workstation's state could not be read.", articlesFirst: 0 },
        at: new Date().toISOString(),
      },
      running,
    ),
    automations: safe([], () => seoJobs()),
    recent: safe([], () => recent()),
    engine: safe([], () => engineParts(open)),
    operator: operatorPanel(SEO_SUGGESTIONS),
    curve: curve(),
  };
}

routes.get("/", async (c) => c.json<SeoOverviewPayload>(await overview(rangeFrom(c), askedOf(c), canOf(me(c)))));

routes.get("/running", (c) => c.json<RunningPanel>(running()));

/* ---------- changes ---------------------------------------------------------------------------------------------- */

const ActBody = z.object({ ids: z.array(z.string().min(3).max(400)).min(1).max(25) });

/**
 * Take the action of each opportunity asked about (engine.ts `act`): a
 * proposal or brief becomes an operator task on the studio workstation, and
 * a proposal then waits for a person's approval; a step in the owner's
 * browser or a change to the website's code is marked as taken. One that
 * cannot be acted on says why; the others carry on.
 */
routes.post("/act", async (c) => {
  const body = ActBody.parse(await c.req.json().catch(() => ({})));
  const by = me(c);
  const ids = [...new Set(body.ids)];
  /* A proposal or a brief is operator work, which takes the AI Operator too; a person's own step (in the browser, in the code) does not. */
  const operate = canOf(by).operate;
  const queues = (id: string): boolean => {
    try {
      const kind = (JSON.parse(opportunityDb(id)?.action ?? "{}") as { kind?: string }).kind;
      return kind === "proposal" || kind === "brief";
    } catch {
      return false;
    }
  };
  if (!operate && ids.every(queues)) return c.json({ error: NEEDS_OPERATOR }, 403);
  const results: OpportunitiesActed["results"] = [];
  const done: OpportunityRow[] = [];
  for (const id of ids) {
    if (!operate && queues(id)) {
      results.push({ id, ok: false, line: NEEDS_OPERATOR });
      continue;
    }
    try {
      const row = await act(id, by);
      done.push(row);
      results.push({ id, ok: true, line: row.state.note ?? `${row.action.label}: taken.` });
    } catch (e) {
      results.push({ id, ok: false, line: e instanceof Error ? e.message : String(e) });
    }
  }
  if (results.some((r) => r.ok)) return c.json<OpportunitiesActed>({ ok: true, results, opportunities: done }, 202);
  /* Nothing was taken: the refusal's own sentence goes in `error`, which is what a button shows. */
  const refused = results.filter((r) => !r.ok);
  const error = refused.length === 1 ? refused[0]!.line : `None of the ${refused.length} could be taken. The first: ${refused[0]?.line ?? "no reason given"}`;
  return c.json<OpportunitiesActed & { error: string }>({ ok: true, results, opportunities: done, error }, 409);
});

/** The operator's queue takes a question of at most this many characters (operator/queue.ts `createTask`); the box and this door say the same. */
const PROMPT_MOST = 1000;

const TaskBody = z.object({
  kind: z.enum(["ask", "traffic", "opportunities", "metadata", "redirect", "brief", "audit"]),
  prompt: z.string().max(PROMPT_MOST, `Keep the question under ${PROMPT_MOST.toLocaleString("en-GB")} characters: the workstation's model reads a few thousand in all, data included.`).optional(),
  context: z.enum(["website", "pages", "traffic", "issues", "insights", "none"]).optional(),
  depth: z.enum(["quick", "deep"]).optional(),
  paths: z.array(z.string().max(200)).max(10).optional(),
  path: z.string().max(200).optional(),
  range: z.string().max(8).optional(),
});

/**
 * Queue an operator task from this page, exactly as AI Operator's own door
 * does (POST /api/v1/operator/tasks: the same checks, the same queue), and
 * write it to the SEO log. The log line is what tells Running now and Recent
 * SEO actions that a question asked here is search work.
 */
routes.post("/task", async (c) => {
  const by = me(c);
  /* The same right the operator's own door asks for (the gate gives /api/v1/operator to that area alone); this door is the Overview's, so it asks here. */
  if (!canOf(by).operate) return c.json({ error: NEEDS_OPERATOR }, 403);
  const body = TaskBody.parse(await c.req.json().catch(() => ({})));
  const task = await createTask({ ...body, range: gaRange(body.range) }, by);
  const proposes = task.kind === "metadata" || task.kind === "redirect";
  note("seo-action", task.kind === "ask" ? `Asked the operator: ${task.title}` : `Queued for the operator: ${task.title}`, {
    tone: "info",
    actor: by.name,
    detail: `Operator task #${task.id} (${task.kindLabel}), from SEO › Overview. It runs on the studio workstation's model when the workstation is on${proposes ? "; what it proposes waits for approval" : ""}.`,
    href: taskHref(task.id),
    dedupe: `seo:task:${task.id}`,
  });
  return c.json<TaskAnswer>({ ok: true, task }, 202);
});

const OwnerBody = z.object({ id: z.string().min(1).max(200), done: z.boolean(), note: z.string().max(1000).optional().nullable() });

/**
 * A person marks an owner task done (or open again). The desk never marks one
 * by itself. The owner's own steps (his accounts, his keys, his decisions) are
 * his to close, as on the engine's own door (src/cc/seo/api.ts) and on
 * Opportunities; a step the lead takes in the owner's browser is anybody's
 * who may change this page.
 */
routes.post("/owner", async (c) => {
  const body = OwnerBody.parse(await c.req.json().catch(() => ({})));
  const had = ownerTask(body.id);
  if (!had) return c.json({ error: `There is no owner task ${body.id}.` }, 404);
  /* The one rule every door that marks a task asks (owner.ts `mayMark`): the owner's own steps are his. */
  if (!mayMark(had, me(c))) return c.json({ error: "Only the owner can mark his own steps." }, 403);
  const task = markOwnerTask(body.id, body.done, me(c).name, body.note ?? null);
  if (!task) return c.json({ error: `There is no owner task ${body.id}.` }, 404);
  const { whoAll: _w, ...row } = task;
  return c.json<OwnerTaskAnswer>({ ok: true, task: row });
});
