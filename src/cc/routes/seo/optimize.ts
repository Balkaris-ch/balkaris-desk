import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "../../../db.ts";
import { me, type Vars } from "../../access.ts";
import { propose, proposalRow } from "../../operator/apply.ts";
import { BRAND, ownTitle as ownOf } from "../../operator/packs.ts";
import { openRows } from "../../operator/queue.ts";
import { json as taskJson, toTaskRow, type TaskDb, type TaskOptions } from "../../operator/tables.ts";
import * as gsc from "../../search/gsc.ts";
import { eachDay, round } from "../../search/shared.ts";
import { base as siteBase, abs } from "../../site/http.ts";
import { crawledAt, LIMITS, page as crawlPage, RULES, structure, type Finding } from "../../site/index.ts";
import { note, off, ok, reading, since, waiting } from "../../store.ts";
import type { Reading, Stat } from "../../../../web/src/contract/common.ts";
import type { NewTask, ProposalAnswer, ProposalRow } from "../../../../web/src/contract/operator.ts";
import type { OpportunityAnswer, OpportunityRow, OpportunityStateInfo, Priority, RateStat, SeoRange } from "../../../../web/src/contract/seo/common.ts";
import type {
  AskedTask,
  IndexHistory,
  OptimizeList,
  OptimizeListRow,
  OptimizeSiteTiles,
  PageCrawl,
  PageLinks,
  PagePotential,
  PageQuery,
  PageStatus,
  PageStatusArea,
  PageSuggestion,
  PageSummary,
  PageTiles,
  PageVisitors,
  QuickAction,
  SearchFrom,
  SeoPageViewPayload,
} from "../../../../web/src/contract/seo/page-view.ts";
import type { Serp } from "../../../../web/src/contract/seo/opportunities.ts";
import { competitorPages, sightings } from "../../seo/competitors.ts";
import { curve, potential as estimate, TARGET_POSITION } from "../../seo/ctr.ts";
import { act, clusterNames, rank, toRow } from "../../seo/engine.ts";
import { inspectionHistory, latestInspection, meaningOf } from "../../seo/indexation.ts";
import { clusters as allClusters, keywords as allKeywords } from "../../seo/keywords.ts";
import { covered, daysOf, pageFigures, pageSeries, queryFigures, queryPageFigures, rate, spanOf, tiles as rankTiles } from "../../seo/rank.ts";
import { readinessOf } from "../../seo/readiness.ts";
import { PRIORITY_RANK } from "../../seo/rules.ts";
import { pageRef, type SiteView } from "../../seo/site.ts";
import { head, HISTORY_NOTE, historyAbsent, historyAt, operatorPanel, rangeFrom, recorded, view } from "./shared.ts";

/**
 * SEO › Page Optimization (board 115), at /api/v1/seo/optimize.
 *
 *   GET  /?path=/logistics&range=30d     the whole screen, one payload
 *   POST /act      { id }                take one of the page's opportunities' action
 *   POST /propose  { path, title?, description?, why? }
 *                                        a person's own title or description, for approval
 *
 * WHERE EACH PART COMES FROM, each a reading of its own so one failing
 * source costs one panel:
 *
 *   the list, status, findings, links      the desk's crawl (src/cc/site)
 *   priorities, suggestions                the opportunity engine (src/cc/seo/engine.ts),
 *                                          and the crawl's findings no opportunity carries
 *   position, clicks, impressions, CTR,    the desk's own Search Console history (src/cc/seo/rank.ts);
 *   queries                                while it has no snapshot yet, Search Console asked
 *                                          directly (kept six hours by src/cc/search/gsc.ts),
 *                                          and `searchFrom` says which
 *   traffic potential, estimated gain      OUR ESTIMATE (src/cc/seo/ctr.ts), from real impressions only
 *   index state                            the daily URL Inspection (cc_inspect)
 *   AI readiness                           the daily readiness check (src/cc/seo/readiness.ts)
 *   competitors                            the captured competitor pages for the page's clusters,
 *                                          as fetched; nothing estimated
 *   visitors                               GA4, consenting visitors only
 *
 * NOTHING HERE CHANGES THE LIVE SITE. A title or description becomes a
 * proposal in the approval queue (src/cc/operator/apply.ts); an action
 * becomes an operator task on the studio workstation or a person's step.
 */

export const routes = new Hono<Vars>();

const ga4 = () => import("../../ga4.ts");

/** The screen is drawn within this, whatever GA4 is doing; a panel that misses it says so and fills on the next load. */
const PATIENCE_MS = 10_000;
const SLOW = "GA4 is still answering. Its answer is kept as soon as it arrives: reload in a moment.";

function inTime<T>(work: Promise<Reading<T>>, until: number): Promise<Reading<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Reading<T>>((resolve) => {
    timer = setTimeout(() => resolve(waiting("ga4", SLOW)), Math.max(0, until - Date.now()));
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** A reading that has no value, passed on as one of another type. */
const absent = <T>(r: Reading<unknown>): Reading<T> => (r.state === "ok" ? waiting<T>(r.source, "Nothing to show.") : (r as Reading<T>));

const fail = (status: 400 | 404 | 409, message: string): never => {
  throw new HTTPException(status, { message });
};

/** "/logistics/", "https://www.balkaris.ch/logistics?x" → "/logistics". Null for nothing asked; throws 400 for nonsense. */
function addressOf(raw: string | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const refuse = (): never => fail(400, "Name the page by its address, for example ?path=/logistics.");
  let p = t;
  try {
    p = t.startsWith("/") ? t : new URL(t).pathname;
  } catch {
    refuse();
  }
  p = p.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  if (!p.startsWith("/") || p.length > 400 || /\s/.test(p)) refuse();
  return p;
}

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

const n = (v: number): string => v.toLocaleString("en-GB");

/* ---------- search: the desk's history, or Search Console asked directly ------------------- */

interface Fig {
  clicks: number;
  impressions: number;
  position: number | null;
}

interface Search {
  from: "history" | "search-console";
  start: string;
  end: string;
  /** Days of the window that hold figures: what impressions are scaled to a month by. */
  days: number;
  asOf: string;
  note: string;
  site: { clicks: Stat; impressions: Stat; position: Stat | null; ctr: RateStat; compared: boolean };
  /** Google's own figure per query over the whole site. */
  queries: (Fig & { query: string })[];
  /** Per page, with the window before when the site's figures are compared. */
  pages: Map<string, Fig & { previous: Fig | null }>;
  /** Which page Google showed for which query. */
  pairs: (Fig & { query: string; path: string })[];
  /** One page per day, oldest first. */
  series: (path: string) => Promise<{ date: string; clicks: number; impressions: number; position: number | null }[]>;
}

const ZERO: Fig = { clicks: 0, impressions: 0, position: null };

function fromHistory(range: SeoRange): Search | null {
  const span = spanOf(range);
  if (!span) return null;
  const t = rankTiles(span);
  const before = span.compared ? new Map(pageFigures(span.previousStart, span.previousEnd).map((p) => [p.path, p])) : null;
  const days = covered(span.start, span.end).length || span.days;
  return {
    from: "history",
    start: span.start,
    end: span.end,
    days,
    asOf: historyAt(),
    note: HISTORY_NOTE,
    site: { clicks: t.clicks, impressions: t.impressions, position: t.position, ctr: t.ctr, compared: span.compared },
    queries: queryFigures(span.start, span.end),
    pages: new Map(pageFigures(span.start, span.end).map((p) => [p.path, { ...p, previous: before ? (before.get(p.path) ?? ZERO) : null }])),
    pairs: queryPageFigures(span.start, span.end),
    series: async (path) => pageSeries(path, span.start, span.end),
  };
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Search Console's page filter for one path on either host of the property (apex or www). */
function pageRegex(path: string): string {
  const host = new URL(siteBase()).host.replace(/^www\./, "");
  return `^https?://(www\\.)?${escape(host)}${path === "/" ? "/?" : `${escape(path)}/?`}$`;
}

async function fromConsole(range: SeoRange): Promise<Reading<Search>> {
  const tot = await gsc.totalsByDay(range);
  if (tot.state !== "ok") return absent(tot);
  const t = tot.value;
  const [q, p, qp] = await Promise.all([gsc.queries(range), gsc.pages(range), gsc.queryPages(range)]);
  const compared = t.impressions.previous !== null;
  const fig = (f: { clicks: number; impressions: number; position: number }): Fig => ({ clicks: f.clicks, impressions: f.impressions, position: f.impressions ? f.position : null });
  const pages = new Map<string, Fig & { previous: Fig | null }>();
  for (const r of p.state === "ok" ? p.value.rows : []) {
    /* Apex and www are one page here, as in the history. */
    const had = pages.get(r.path);
    const now = fig(r);
    const prev = compared ? (r.previous ? fig(r.previous) : ZERO) : null;
    if (!had) pages.set(r.path, { ...now, previous: prev });
    else {
      const merge = (a: Fig, b: Fig): Fig => {
        const i = a.impressions + b.impressions;
        return { clicks: a.clicks + b.clicks, impressions: i, position: i ? round(((a.position ?? 0) * a.impressions + (b.position ?? 0) * b.impressions) / i, 1) : null };
      };
      pages.set(r.path, { ...merge(had, now), previous: had.previous && prev ? merge(had.previous, prev) : null });
    }
  }
  const pairs = new Map<string, Fig & { query: string; path: string }>();
  for (const r of qp.state === "ok" ? qp.value.rows : []) {
    const k = `${r.query}\u0000${r.path}`;
    const had = pairs.get(k);
    const now = fig(r);
    if (!had) pairs.set(k, { query: r.query, path: r.path, ...now });
    else {
      const i = had.impressions + now.impressions;
      pairs.set(k, { ...had, clicks: had.clicks + now.clicks, impressions: i, position: i ? round(((had.position ?? 0) * had.impressions + (now.position ?? 0) * now.impressions) / i, 1) : null });
    }
  }
  const ctrSeries = t.days.map((d) => d.ctr);
  return ok<Search>(
    {
      from: "search-console",
      start: t.window.start,
      end: t.window.end,
      days: eachDay(t.from, t.window.end).length,
      asOf: tot.asOf,
      note: tot.note ?? "Google Search only.",
      site: {
        clicks: t.clicks,
        impressions: t.impressions,
        position: t.position,
        ctr: {
          now: rate(t.clicks.value, t.impressions.value),
          previous: compared && t.clicks.previous !== null ? rate(t.clicks.previous, t.impressions.previous ?? 0) : null,
          series: ctrSeries,
        },
        compared,
      },
      queries: (q.state === "ok" ? q.value.rows : []).map((r) => ({ query: r.query, ...fig(r) })),
      pages,
      pairs: [...pairs.values()].sort((a, b) => b.impressions - a.impressions),
      series: async (path) => {
        const r = await gsc.query({ startDate: t.window.start, endDate: t.window.end, dimensions: ["date"], filters: [{ dimension: "page", operator: "includingRegex", expression: pageRegex(path) }], rowLimit: 500 });
        if (r.state !== "ok") throw new Error(r.reason);
        const by = new Map(r.value.rows.map((x) => [x.keys[0] ?? "", x]));
        /* Google sends no row for a day without impressions: once the property's figures have begun, that is a zero. */
        return eachDay(t.from, t.window.end).map((date) => {
          const x = by.get(date);
          return x && x.impressions ? { date, clicks: x.clicks, impressions: x.impressions, position: x.position } : { date, clicks: x?.clicks ?? 0, impressions: 0, position: null };
        });
      },
    },
    "gsc",
    tot.asOf,
    `${tot.note ?? ""} Asked of Search Console directly: the desk's own daily history has no snapshot yet.`.trim(),
  );
}

async function searchFor(range: SeoRange): Promise<Reading<Search>> {
  const h = fromHistory(range);
  if (h) return ok(h, "gsc", h.asOf, h.note);
  const a = gsc.access();
  if (a.state !== "ok") return historyAbsent<Search>();
  return fromConsole(range);
}

/* ---------- the engine's opportunities --------------------------------------------------- */

interface OppLite {
  id: string;
  page: string | null;
  priority: Priority;
}

/** Whether the opportunity engine has run at least once: it records the open count on every run. */
const engineRan = (): boolean => since("seo.opps.open") !== null || (db.prepare("SELECT COUNT(*) AS n FROM cc_seo_opps").get() as { n: number }).n > 0;

const OPEN = "active = 1 AND state IN ('open', 'queued', 'in-progress')";

function openByPage(): Map<string, OppLite[]> {
  const out = new Map<string, OppLite[]>();
  for (const r of db.prepare(`SELECT id, page, priority FROM cc_seo_opps WHERE ${OPEN} AND page IS NOT NULL`).all() as unknown as OppLite[]) {
    out.set(r.page!, [...(out.get(r.page!) ?? []), r]);
  }
  return out;
}

const best = (list: OppLite[] | undefined): Priority | null =>
  list?.length ? list.reduce<Priority>((p, o) => (PRIORITY_RANK[o.priority] < PRIORITY_RANK[p] ? o.priority : p), "low") : null;

/** This page's opportunities as rows, active ones, best first. */
function pageOpportunities(path: string, v: SiteView): OpportunityRow[] {
  const names = clusterNames();
  const rows = db.prepare("SELECT * FROM cc_seo_opps WHERE page = ? AND active = 1").all(path) as unknown as Parameters<typeof toRow>[0][];
  return rows.map((o) => toRow(o, v, names)).sort(rank);
}

/* ---------- GA4 -------------------------------------------------------------------------------- */

type GaPages = Map<string, { users: number; views: number; engagementSeconds: number; previous: { users: number; views: number; engagementSeconds: number } | null }>;

async function gaPages(range: SeoRange): Promise<Reading<{ start: string; end: string; rows: GaPages }>> {
  const g = await ga4();
  const r = await g.pages(range, { screen: true });
  return g.asReading(r, (d) => ({ start: d.span.start, end: d.span.end, rows: new Map(d.rows.map((x) => [x.path, x])) }));
}

async function organicLanding(range: SeoRange): Promise<Reading<Map<string, number>>> {
  const g = await ga4();
  const r = await g.landingPages(range, "organic-search", { screen: true });
  return g.asReading(r, (d) => new Map(d.rows.map((x) => [x.path, x.sessions])));
}

/* ---------- the tile row ------------------------------------------------------------------------ */

function siteTiles(range: SeoRange, v: SiteView, search: Reading<Search>, opps: Map<string, OppLite[]>, ran: boolean): OptimizeSiteTiles {
  const days = daysOf(range);

  let pages: Reading<Stat>;
  if (!v.at) pages = waiting("crawl", "The crawl has not read the site yet.");
  else {
    const map = v.pages.filter((p) => p.inSitemap);
    const good = map.filter((p) => p.status === 200 && p.indexable).length;
    const notOk = map.length - good;
    pages = ok(
      { value: good, previous: null, unit: "count", series: [], of: map.length, ...(notOk ? { sub: `${notOk} answer${notOk === 1 ? "s" : ""} other than 200 or say${notOk === 1 ? "s" : ""} noindex` } : {}) },
      "crawl",
      v.at,
      "Sitemap pages that answer 200 and do not say noindex, of every sitemap address the crawl read.",
    );
  }

  let toOptimize: Reading<Stat>;
  if (!ran) toOptimize = waiting("desk", "The opportunity engine has not run yet: it runs a few minutes after the desk starts, then every hour.");
  else {
    const high = [...opps.values()].filter((l) => l.some((o) => o.priority === "high")).length;
    const line = recorded("seo.opps.pages", days);
    toOptimize = ok(
      { value: opps.size, previous: line?.previous ?? null, unit: "count", series: line?.series ?? [], sub: `${high} with a high-priority opportunity` },
      "desk",
      new Date().toISOString(),
      "Pages with at least one open opportunity found by the rules in src/cc/seo/rules.ts.",
    );
  }

  if (search.state !== "ok") {
    const a = absent<never>(search);
    return { pages, toOptimize, position: a, ctr: a, gain: a };
  }
  const s = search.value;
  const position: Reading<Stat> = s.site.position
    ? ok(s.site.position, "gsc", s.asOf, `Google's average position, weighted by impressions; lower is better. ${s.note}`)
    : waiting("gsc", `Google showed the site to nobody between ${s.start} and ${s.end}, so it has no average position.`);
  const ctr: Reading<RateStat> = ok(s.site.ctr, "gsc", s.asOf, s.note);

  let clicks = 0;
  let shown = 0;
  let count = 0;
  for (const q of s.queries) {
    if (q.position === null || q.position < 4 || q.position > 20) continue;
    const p = estimate({ impressions: q.impressions, clicks: q.clicks, days: s.days, target: TARGET_POSITION });
    if (!p) continue;
    clicks += p.clicksPerMonth;
    shown += p.impressionsPerMonth;
    count++;
  }
  const gain: OptimizeSiteTiles["gain"] = count
    ? ok(
        {
          clicksPerMonth: round(clicks, 1),
          queries: count,
          impressionsPerMonth: shown,
          line: `Our estimate: ${count} quer${count === 1 ? "y" : "ies"} at position 4 to 20, ${n(shown)} impressions a month, brought to position ${TARGET_POSITION} by our CTR curve.`,
        },
        "gsc",
        s.asOf,
        "OUR ESTIMATE, not a figure from Google: real Search Console impressions × (our curve's CTR at position 3 − the CTR now). The curve is our assumption (src/cc/seo/ctr.ts).",
      )
    : off("gsc", `No query stands at position 4 to 20 between ${s.start} and ${s.end}, where our estimate reaches, so there is nothing honest to add up.`);
  return { pages, toOptimize, position, ctr, gain };
}

/* ---------- the list ------------------------------------------------------------------------------ */

function list(v: SiteView, asked: string | null, opps: Map<string, OppLite[]>, ran: boolean, search: Reading<Search>, ga: Reading<{ rows: GaPages }>): Reading<OptimizeList> {
  if (!v.at) return waiting("crawl", "The crawl has not read the site yet; the list is the pages it reads.");
  const shown = v.pages.filter((p) => p.inSitemap || p.path === asked);
  const rows: OptimizeListRow[] = shown.map((p) => {
    const f = search.state === "ok" ? (search.value.pages.get(p.path) ?? ZERO) : null;
    const g = ga.state === "ok" ? ga.value.rows.get(p.path) : undefined;
    return {
      page: pageRef(p.path, v),
      priority: best(opps.get(p.path)),
      opportunities: opps.get(p.path)?.length ?? 0,
      score: p.score,
      views: ga.state === "ok" ? (g?.views ?? 0) : null,
      impressions: f ? f.impressions : null,
      ctr: f ? rate(f.clicks, f.impressions) : null,
    };
  });
  const prio = (r: OptimizeListRow): number => (r.priority ? PRIORITY_RANK[r.priority] : 3);
  if (ran) {
    rows.sort((a, b) => prio(a) - prio(b) || b.opportunities - a.opportunities || (b.impressions ?? 0) - (a.impressions ?? 0) || (a.score ?? 101) - (b.score ?? 101) || a.page.path.localeCompare(b.page.path));
  } else {
    rows.sort((a, b) => (a.score ?? 101) - (b.score ?? 101) || (b.impressions ?? 0) - (a.impressions ?? 0) || a.page.path.localeCompare(b.page.path));
  }
  const counts = { all: rows.length, high: 0, medium: 0, low: 0, none: 0 };
  for (const r of rows) counts[r.priority ?? "none"]++;
  return ok(
    {
      rows,
      counts,
      ranked: ran,
      order: ran
        ? "By the highest priority among each page's open opportunities, then how many it has, then Search Console impressions."
        : "The opportunity engine has not run yet, so no page has a priority: by the crawl's score, lowest first.",
    },
    "crawl",
    v.at,
  );
}

/* ---------- one page ------------------------------------------------------------------------------- */

const AREAS: { key: PageStatusArea["key"]; label: string; areas: string[] }[] = [
  { key: "metadata", label: "Metadata", areas: ["title", "description", "share"] },
  { key: "content", label: "Content", areas: ["headings", "content"] },
  { key: "schema", label: "Structured data", areas: ["schema"] },
  { key: "links", label: "Internal links", areas: ["links"] },
  { key: "technical", label: "Technical", areas: ["status", "indexing", "canonical"] },
  { key: "images", label: "Images", areas: ["images"] },
];

const STATUS_RULE =
  "The ring is the crawl's score: 100, less the cost of each rule that fired on the page, once per rule (src/cc/site/rules.ts). Each line is the same for one area: 100 less what that area's rules took, so the points lost add up to the ring's. The desk's own yardsticks, not a figure from Google.";

function bandOf(score: number): PageStatus["band"] {
  if (score >= 90) return { key: "good", label: "Good" };
  if (score >= 70) return { key: "fair", label: "Fair" };
  if (score >= 50) return { key: "needs-work", label: "Needs work" };
  return { key: "poor", label: "Poor" };
}

function statusOf(findings: Finding[], score: number | null, inSitemap: boolean, readiness: { checkedAt: string; checks: { state: string }[] } | null, asOf: string): Reading<PageStatus> {
  const seen = new Set<string>();
  const fired: Finding[] = [];
  for (const f of findings) {
    if (f.path === null || RULES[f.rule]?.scope !== "page" || seen.has(f.rule)) continue;
    seen.add(f.rule);
    fired.push(f);
  }
  const areas: PageStatusArea[] = AREAS.map((a) => {
    const rules = fired.filter((f) => a.areas.includes(f.area)).map((f) => ({ rule: f.rule, title: f.title, severity: f.severity, cost: f.cost, text: f.text }));
    const lost = rules.reduce((s, r) => s + r.cost, 0);
    return { key: a.key, label: a.label, score: Math.max(0, 100 - lost), lost, rules };
  });
  const applying = readiness?.checks.filter((c) => c.state !== "n/a") ?? [];
  return ok(
    {
      score,
      unscored:
        score !== null
          ? null
          : inSitemap
            ? "The page answered and could not be read, so the crawl gives it no score: its finding says why."
            : "Kept out of the sitemap, so it has no SEO score: the crawl only checks that it really is kept out of search.",
      band: score === null ? null : bandOf(score),
      areas,
      readiness: readiness ? { pass: applying.filter((c) => c.state === "pass").length, of: applying.length, checkedAt: readiness.checkedAt } : null,
      rule: STATUS_RULE,
    },
    "crawl",
    asOf,
    STATUS_RULE,
  );
}

const SUGGEST_MOST = 12;

/** The to-do list refuses a longer title (src/cc/operator/todos.ts). */
const TODO_TITLE_MOST = 160;

/* ---------- what is already asked: a line is not offered twice ------------------------------ */

interface OpenTask {
  id: number;
  kind: string;
  prompt: string;
  state: "queued" | "running";
  asked_by: string | null;
  created_at: string;
  options: string | null;
}

/**
 * What this page already has in hand, read once per answer: the operator
 * tasks queued or running, the open to-dos, and the title and description
 * proposals waiting for approval. A suggestion or quick action that would
 * ask for the same thing again is shown as asked, its button off, so a
 * second press cannot queue a second task or add a second to-do.
 */
interface InHand {
  tasks: OpenTask[];
  todos: Map<string, { id: number; who: string; created_at: string }>;
  /** Waiting title and description proposals for the page: a new metadata task would replace them. */
  waitingMeta: number;
}

function inHand(path: string): InHand {
  const tasks = db.prepare("SELECT id, kind, prompt, state, asked_by, created_at, options FROM cc_ai_tasks WHERE state IN ('queued', 'running') ORDER BY id DESC").all() as unknown as OpenTask[];
  const todos = new Map<string, { id: number; who: string; created_at: string }>();
  for (const t of db.prepare("SELECT id, title, who, created_at FROM cc_todos WHERE done = 0 ORDER BY id").all() as unknown as { id: number; title: string; who: string; created_at: string }[]) {
    if (!todos.has(t.title)) todos.set(t.title, { id: t.id, who: t.who, created_at: t.created_at });
  }
  const waitingMeta = (db.prepare("SELECT COUNT(*) AS n FROM cc_proposals WHERE kind = 'meta' AND address = ? AND state = 'waiting'").get(path) as { n: number }).n;
  return { tasks, todos, waitingMeta };
}

const NOTHING_IN_HAND: InHand = { tasks: [], todos: new Map(), waitingMeta: 0 };

/** The prompt as the queue keeps it (src/cc/operator/queue.ts titleFor): spaces folded; a brief's cut at 300. */
const kept = (task: NewTask): string => {
  const s = (task.prompt ?? "").replace(/\s+/g, " ").trim();
  return task.kind === "brief" ? s.slice(0, 300) : s;
};

/** The open operator task that already does what `task` asks for this page, or null. */
function sameTask(task: NewTask, path: string, h: InHand): OpenTask | null {
  for (const t of h.tasks) {
    if (t.kind !== task.kind) continue;
    if (task.kind === "metadata") {
      if ((taskJson<TaskOptions>(t.options, {}).paths ?? []).includes(path)) return t;
    } else if (t.prompt === kept(task)) return t;
  }
  return null;
}

/** An open metadata task for the page, whichever button queued it. */
const metaTask = (path: string, h: InHand): OpenTask | null => sameTask({ kind: "metadata", paths: [path] }, path, h);

const taskNote = (t: OpenTask): string =>
  t.state === "running" ? `Operator task #${t.id} is running on the studio workstation.` : `Queued as operator task #${t.id}: it runs on the studio workstation when it is on.`;

const taskState = (t: OpenTask): OpportunityStateInfo => ({
  state: t.state === "running" ? "in-progress" : "queued",
  by: t.asked_by,
  at: t.created_at,
  note: taskNote(t),
  task: { id: t.id, state: t.state, title: t.prompt, href: `/operator?result=${t.id}#response` },
  proposals: [],
});

const metaWaiting = (n: number): string =>
  `${n} title and description proposal${n === 1 ? "" : "s"} for this page wait${n === 1 ? "s" : ""} for approval (AI Operator › Approvals): approve or reject ${n === 1 ? "it" : "them"} first, or a new task replaces ${n === 1 ? "it" : "them"}.`;

/** A crawl or readiness suggestion, shown as asked when the same task or to-do is already in hand. */
function withHand(s: PageSuggestion, path: string, h: InHand): PageSuggestion {
  const a = s.act;
  if (a.kind === "task") {
    const t = sameTask(a.task, path, h);
    if (t) return { ...s, available: false, unavailable: taskNote(t), state: taskState(t) };
    if (a.task.kind === "metadata" && h.waitingMeta) return { ...s, available: false, unavailable: metaWaiting(h.waitingMeta) };
  } else if (a.kind === "todo") {
    const t = h.todos.get(a.title.replace(/\s+/g, " ").trim());
    if (t) {
      const note = `On the operator's to-do list as #${t.id}, added by ${t.who}.`;
      return { ...s, available: false, unavailable: note, state: { state: "queued", by: t.who, at: t.created_at, note, task: null, proposals: [] } };
    }
  }
  return s;
}

/** A finding the engine does not carry as an opportunity of this page, as a suggestion with its real action. */
function fromFinding(f: Finding, path: string, title: string | null): PageSuggestion | null {
  const named = `${path}${title ? ` (“${title}”)` : ""}`;
  const base = {
    key: `finding:${f.rule}`,
    why: f.text,
    priority: (f.severity === "critical" ? "high" : f.severity === "warning" ? "medium" : "low") as Priority,
    from: "crawl" as const,
    available: true,
    unavailable: null,
    state: null,
    potential: null,
    href: null,
    queueable: false,
  };
  const todo = (label: string, step: string): PageSuggestion => ({
    ...base,
    label,
    act: { kind: "todo", title: `${label}: ${path}`.slice(0, TODO_TITLE_MOST), note: `${f.text} (the desk's crawl, rule ${f.rule})`.slice(0, 1900) },
    button: "Add to to-do",
    step: `${step} It goes on the operator's to-do list (AI Operator); the change is made in the website's code and the next crawl checks it.`,
  });
  switch (f.area) {
    case "title":
    case "description":
      return {
        ...base,
        queueable: true,
        label: f.area === "title" ? "Rewrite the title" : "Rewrite the description",
        act: { kind: "task", task: { kind: "metadata", paths: [path], depth: "deep" } },
        button: "Propose",
        step: `The operator (the studio workstation's model) writes a new title and description for ${named}. They wait in AI Operator › Approvals; nothing on the live site changes until a person approves.`,
      };
    case "content":
      if (f.rule === "content.thin")
        return {
          ...base,
          queueable: true,
          label: "Expand the content",
          act: { kind: "task", task: { kind: "brief", prompt: `Expand ${named}, ${f.measured ?? "few"} words of its own: what a client needs answered there, the sections to add, the proof and the links. Use only what the page and the studio can stand behind.`, depth: "deep" } },
          button: "Brief",
          step: "The operator writes a brief: the questions the page must answer, its sections and links. A person writes and publishes the words.",
        };
      return todo("Declare the page's language", "Set the html lang attribute on the page.");
    case "headings":
      return todo(f.rule === "h1.missing" ? "Give the page one main heading" : "Keep one main heading", "One <h1> that says what the page is about.");
    case "schema":
      return {
        ...base,
        queueable: true,
        label: f.rule === "schema.unreadable" ? "Repair the structured data" : f.rule === "schema.incomplete" ? "Complete the structured data" : "Add structured data for this page",
        act: {
          kind: "task",
          task: {
            kind: "ask",
            path,
            context: "pages",
            depth: "deep",
            prompt: `Write the JSON-LD structured data ${path} should carry for what it is (a Service, an Article, an FAQPage…), using only facts the page states. The crawl says: ${f.text}`.slice(0, 990),
          },
        },
        button: "Generate",
        step: "The operator writes the JSON-LD from the page's own facts; a person adds it to the website's code. Google's Rich Results Test has the last word on it.",
      };
    case "links":
      if (f.rule === "links.orphan")
        return {
          ...base,
          queueable: true,
          label: "Add internal links to it",
          act: { kind: "task", task: { kind: "ask", path, context: "pages", depth: "deep", prompt: `Which pages of the site should link to ${path} from their own text, and with what words? Name only addresses the desk knows.` } },
          button: "Ask",
          step: "The operator names the pages that should link here and the words to use; a person adds the links in the website's content.",
        };
      return todo(f.rule === "links.broken" ? "Fix the broken links" : f.rule === "links.redirected" ? "Link the final addresses" : "Fix the failing outside links", "Change the links in the page's content or code.");
    case "images":
      return todo("Name the pictures", "Write alt text for each picture that has none (alt=\"\" for decoration).");
    case "share":
      return todo(f.rule === "share.missing" ? "Give it a share card" : f.rule === "share.no-card" ? "Add a Twitter card" : "Give it a share picture of its own", "Set og:title, og:image and twitter:card for the page.");
    case "canonical":
      return todo("Fix the canonical link", "Point the canonical at the page's own address.");
    case "status":
    case "indexing":
      return todo("Make the page answer and be indexable", "The page should answer 200, be in the sitemap and not say noindex.");
    default:
      return null;
  }
}

/** A failed AI-readiness check the engine does not carry, as a suggestion. */
function fromReadiness(c: { key: string; label: string; state: string; detail: string; fix: string | null; who: string | null }, path: string, title: string | null, shownInGoogle: boolean): PageSuggestion | null {
  if (c.state !== "fail") return null;
  const named = `${path}${title ? ` (“${title}”)` : ""}`;
  const base = {
    key: `readiness:${c.key}`,
    why: c.detail,
    priority: (shownInGoogle ? "medium" : "low") as Priority,
    from: "readiness" as const,
    available: true,
    unavailable: null,
    state: null,
    potential: null,
    href: null,
    queueable: false,
  };
  const fix = c.fix ?? "";
  if (c.who === "owner") return { ...base, label: c.label, act: { kind: "person" }, button: null, step: `Needs you: ${fix}` };
  if (c.who === "code")
    return {
      ...base,
      label: c.label,
      act: { kind: "todo", title: `${c.label}: ${path}`.slice(0, TODO_TITLE_MOST), note: `${c.detail} Fix: ${fix}`.slice(0, 1900) },
      button: "Add to to-do",
      step: `${fix} In the website's code; it goes on the operator's to-do list.`,
    };
  const prompt =
    c.key === "answer" || c.key === "faq"
      ? `Write the direct answer for the top of ${named}: 50 to 100 words that answer the page's question for a Swiss client, naming Balkaris and Zürich; then five to eight questions clients ask, each with a short, specific answer. Use only what the page and the studio can stand behind.`
      : c.key === "german"
        ? `A German (de-CH) version of ${named}, written for Swiss readers: what it must say, its sections and the searches it should answer.`
        : `For ${named}: ${fix} Say what to write and where on the page.`;
  return {
    ...base,
    queueable: true,
    label: c.key === "answer" || c.key === "faq" ? "Write the answer and FAQ" : c.key === "german" ? "Brief a German version" : c.label,
    act: { kind: "task", task: { kind: "brief", prompt: prompt.slice(0, 990), depth: "deep" } },
    button: "Brief",
    step: "The operator writes the brief on the studio workstation; a person writes and publishes the page's words.",
  };
}

/**
 * An opportunity's reason in one line: its title, and the first figure of its
 * evidence the title does not already say ("Last crawled by Google:
 * 2026-09-21"). The type is not repeated: the title says it.
 */
function whyOf(o: OpportunityRow): string {
  const bare = (s: string): string => s.replace(/[.\s]+$/, "");
  const title = bare(o.title);
  const more = o.evidence.find((e) => e.value && e.value.length <= 90 && !title.includes(bare(e.value)));
  return more ? `${title}. ${more.label}: ${bare(more.value)}.` : title;
}

const ENGINE_BUTTON: Record<OpportunityRow["action"]["kind"], string | null> = { owner: null, proposal: "Apply", brief: "Brief", chrome: "Mark requested", code: "Hand to code" };

/** The operator column: the engine's opportunities for this page, then what the crawl and the readiness check found that none carries. */
function suggestionsFor(
  path: string,
  opps: OpportunityRow[],
  findings: Finding[],
  readiness: { checks: { key: string; label: string; state: string; detail: string; fix: string | null; who: string | null }[] } | null,
  title: string | null,
  shownInGoogle: boolean,
  h: InHand = NOTHING_IN_HAND,
): PageSuggestion[] {
  const out: PageSuggestion[] = [];
  const carried = new Set(opps.map((o) => o.id));
  /* An open opportunity whose action is a metadata task already writes the title and the description. */
  let metaCarried = false;
  for (const o of opps) {
    if (o.state.state === "done" || o.state.state === "dismissed") continue;
    const a = o.action;
    const writesMeta = a.kind === "proposal" && a.operator?.kind === "metadata";
    if (writesMeta) metaCarried = true;
    let available = a.available;
    let unavailable = a.why;
    /* The same task queued from another button (a quick action, an earlier suggestion): not twice. */
    if (available && a.operator) {
      const t = sameTask(a.operator, path, h);
      if (t) {
        available = false;
        unavailable = taskNote(t);
      } else if (writesMeta && h.waitingMeta) {
        available = false;
        unavailable = metaWaiting(h.waitingMeta);
      }
    }
    out.push({
      key: o.id,
      label: a.kind === "owner" ? o.title : a.label,
      why: whyOf(o),
      priority: o.priority,
      from: "engine",
      act: a.kind === "owner" ? { kind: "person" } : { kind: "opportunity", id: o.id },
      button: ENGINE_BUTTON[a.kind] ?? null,
      step: a.step,
      href: a.href,
      available,
      unavailable,
      state: o.state,
      potential: o.potential,
      /* Only what queues an operator task: "Mark requested" and "Hand to code" record a person's step, one deliberate press each. */
      queueable: a.kind === "proposal" || a.kind === "brief",
    });
  }
  const seen = new Set<string>();
  for (const f of findings) {
    if (seen.has(f.rule) || RULES[f.rule]?.scope !== "page") continue;
    seen.add(f.rule);
    if (carried.has(`technical:${f.rule}:${path}`)) continue;
    if (f.rule === "content.thin" && carried.has(`thin-content:${path}`)) continue;
    if (f.rule === "links.orphan" && carried.has(`internal-links:${path}`)) continue;
    if (f.rule === "page.missing-from-sitemap" || f.rule === "page.unreadable") continue;
    const s = fromFinding(f, path, title);
    if (!s) continue;
    /* One metadata task writes both the title and the description: one line for them, the engine's when it has one. */
    if (s.act.kind === "task" && s.act.task.kind === "metadata" && (metaCarried || out.some((x) => x.act.kind === "task" && x.act.task.kind === "metadata"))) continue;
    out.push(withHand(s, path, h));
  }
  for (const c of readiness?.checks ?? []) {
    if ((c.key === "answer" || c.key === "faq") && carried.has(`missing-answer:${path}`)) continue;
    if (c.key === "faq" && out.some((x) => x.key === "readiness:answer")) continue;
    const s = fromReadiness(c, path, title, shownInGoogle);
    if (s) out.push(withHand(s, path, h));
  }
  const order = (s: PageSuggestion): number => (s.from === "engine" ? 0 : 1) * 10 + (s.priority ? PRIORITY_RANK[s.priority] : 3);
  return out.sort((a, b) => order(a) - order(b)).slice(0, SUGGEST_MOST);
}

function quickFor(path: string, title: string | null, words: number | null, schemaTypes: string[], answers200: boolean, h: InHand = NOTHING_IN_HAND): QuickAction[] {
  const named = `${path}${title ? ` (“${title}”)` : ""}`;
  const no = answers200 ? null : "The crawl has no page answering 200 at this address.";
  const q = (key: QuickAction["key"], label: string, task: NewTask, step: string): QuickAction => {
    if (!answers200) return { key, label, task, step, available: false, unavailable: no, pending: null };
    /* Asked already, from here or from a suggestion: the button waits for that task. */
    const t = sameTask(task, path, h);
    if (t) return { key, label, task, step, available: false, unavailable: taskNote(t), pending: { id: t.id, running: t.state === "running", href: `/operator?result=${t.id}#response` } };
    if (task.kind === "metadata" && h.waitingMeta) return { key, label, task, step, available: false, unavailable: metaWaiting(h.waitingMeta), pending: null };
    return { key, label, task, step, available: true, unavailable: null, pending: null };
  };
  return [
    q(
      "optimize",
      "Optimize with AI",
      { kind: "ask", path, context: "pages", depth: "deep", prompt: `Review ${path} for search: what should change in its title, description, headings, content, internal links and structured data to win the searches it is shown for? Use only the page's facts and findings.` },
      "Asks the operator for a review of this page. It runs on the studio workstation's model; the answer appears in AI Operator.",
    ),
    q("meta", "Improve title & meta", { kind: "metadata", paths: [path], depth: "deep" }, "The operator writes a new title and description. They wait in AI Operator › Approvals; nothing on the live site changes until a person approves."),
    q(
      "expand",
      "Expand content",
      { kind: "brief", prompt: `Expand ${named}${words !== null ? `, ${words} words of its own` : ""}: what a client needs answered there, the sections to add, the proof and the links. Use only what the page and the studio can stand behind.`, depth: "deep" },
      "The operator writes a brief for more content; a person writes and publishes it.",
    ),
    q(
      "links",
      "Add internal links",
      { kind: "ask", path, context: "pages", depth: "deep", prompt: `Which pages of the site should link to ${path} from their own text, and with what words? Name only addresses the desk knows.` },
      "The operator names the pages that should link here and the words to use; a person adds the links.",
    ),
    q(
      "schema",
      "Generate schema",
      {
        kind: "ask",
        path,
        context: "pages",
        depth: "deep",
        prompt: `Write the JSON-LD structured data ${path} should carry for what it is, using only facts the page states.${schemaTypes.length ? ` It carries ${schemaTypes.join(", ")} now.` : " It carries none now."}`,
      },
      "The operator writes the JSON-LD from the page's facts; a person adds it to the website's code.",
    ),
  ];
}

function askedAbout(path: string): AskedTask[] {
  const open = new Map(openRows().map((t) => [t.id, t]));
  const rows = db
    .prepare("SELECT id, kind, prompt, options, state, stage, asked_by, created_at, taken_at, finished_at, runner, attempts, retried, error, result_data FROM cc_ai_tasks ORDER BY id DESC LIMIT 400")
    .all() as unknown as TaskDb[];
  const mention = new RegExp(`(^|[\\s“"'(])${escape(path)}(?=$|[\\s”"'),.:;?])`);
  const out: AskedTask[] = [];
  for (const t of rows) {
    const o = taskJson<TaskOptions>(t.options, {});
    const about = o.path === path || (o.paths ?? []).includes(path) || (path !== "/" && mention.test(t.prompt));
    if (!about) continue;
    const ids = taskJson<{ proposals?: number[] }>(t.result_data, {}).proposals ?? [];
    const waitingN = ids.length
      ? (db.prepare(`SELECT COUNT(*) AS n FROM cc_proposals WHERE state = 'waiting' AND id IN (${ids.map(() => "?").join(",")})`).get(...ids) as { n: number }).n
      : 0;
    out.push({ task: open.get(t.id) ?? toTaskRow(t), href: `/operator?result=${t.id}#response`, proposals: ids.length, waiting: waitingN });
    if (out.length >= 12) break;
  }
  return out;
}

function proposalsFor(path: string): ProposalRow[] {
  const ids = db.prepare("SELECT id FROM cc_proposals WHERE address = ? ORDER BY id DESC LIMIT 12").all(path) as { id: number }[];
  return ids.map((r) => proposalRow(r.id)).filter((p): p is ProposalRow => p !== null);
}

function indexFor(path: string): Reading<IndexHistory> {
  const latest = latestInspection();
  if (!latest) {
    const a = gsc.access();
    if (a.state !== "ok") return off("gsc", gsc.reasonFor(a), gsc.stepFor(a));
    return waiting("gsc", "The daily URL Inspection of the sitemap's addresses has not run yet.");
  }
  const h = inspectionHistory(path);
  if (!h) return waiting("gsc", `The URL Inspection of ${latest.day} has no result for this address: only addresses in the sitemap are inspected.`);
  const m = meaningOf(h.now.coverage, h.now.indexed);
  const opp = db.prepare("SELECT state, state_by, state_at, state_note FROM cc_seo_opps WHERE id = ?").get(`not-indexed:${path}`) as
    | { state: string; state_by: string | null; state_at: string | null; state_note: string | null }
    | undefined;
  const submitted = opp && opp.state === "in-progress" && /request/i.test(opp.state_note ?? "");
  return ok(
    {
      now: { day: h.now.day, indexed: h.now.indexed, coverage: h.now.coverage, lastCrawl: h.now.lastCrawl, googleCanonical: h.now.googleCanonical, userCanonical: h.now.userCanonical, robots: h.now.robots, indexing: h.now.indexing, link: h.now.link },
      meaning: m.meaning,
      fix: m.fix,
      changes: h.changes,
      request: opp && !h.now.indexed ? { queued: opp.state === "open" || !!submitted, submittedBy: submitted ? opp.state_by : null, submittedAt: submitted ? opp.state_at : null } : null,
    },
    "gsc",
    `${h.now.day}T12:00:00Z`,
    "Google's URL Inspection, asked once a day for every sitemap address. Google's stored state, which can lag the live page by days.",
  );
}

/** The clusters this page answers: mapped to it whole, or through its phrases. */
function clustersOf(path: string): SeoPageViewPayload["clusters"] {
  const all = allClusters();
  const out = new Map<string, SeoPageViewPayload["clusters"][number]>();
  for (const c of all) if (c.page === path) out.set(c.key, { key: c.key, name: c.name, lang: c.lang, mappedBy: c.mappedBy ?? "rule" });
  const byKey = new Map(all.map((c) => [c.key, c]));
  for (const k of allKeywords()) {
    if (k.page !== path || !k.cluster || out.has(k.cluster)) continue;
    const c = byKey.get(k.cluster);
    if (c) out.set(c.key, { key: c.key, name: c.name, lang: c.lang, mappedBy: k.mappedBy ?? "rule" });
  }
  return [...out.values()];
}

const OWN = (): string => new URL(siteBase()).host.replace(/^www\./, "");

function competitorsOf(keys: string[], queries: Set<string>): SeoPageViewPayload["competitors"] {
  if (!keys.length && !queries.size) return [];
  /* The same topic in the other language counts too: the site's German searches are answered by its English pages until German ones exist. */
  const stems = new Set(keys.map((k) => k.split(":")[0]));
  const want = new Set([...keys, ...allClusters().filter((c) => stems.has(c.key.split(":")[0])).map((c) => c.key)]);
  const own = OWN();
  const seen = new Map<string, { position: number; query: string; day: string }>();
  for (const s of sightings()) {
    if (s.engine !== "google" || s.kind !== "organic" || s.position === null) continue;
    if (!(s.cluster && want.has(s.cluster)) && !queries.has(s.query)) continue;
    const had = seen.get(s.domain);
    if (!had || s.position < had.position || (s.position === had.position && s.day > had.day)) seen.set(s.domain, { position: s.position, query: s.query, day: s.day });
  }
  const pages = competitorPages().filter((p) => p.domain !== own && !p.domain.endsWith(`.${own}`) && ((p.cluster && want.has(p.cluster)) || (p.query && queries.has(p.query))));
  /* One row a site: its ranking page when one was captured, else its home page. */
  const bySite = new Map<string, (typeof pages)[number]>();
  for (const p of pages) {
    const had = bySite.get(p.domain);
    if (!had || (had.address !== "ranking" && p.address === "ranking")) bySite.set(p.domain, p);
  }
  return [...bySite.values()]
    .map((p) => {
      const s = seen.get(p.domain);
      return {
        domain: p.domain,
        url: p.url,
        title: p.title,
        h1: p.h1,
        words: p.words,
        lang: p.lang,
        schemaTypes: p.schemaTypes,
        priceStated: p.priceStated,
        fetchedAt: p.fetchedAt,
        position: s?.position ?? null,
        query: s?.query ?? p.query,
        seen: s?.day ?? null,
        unread: p.fetchedAt === null ? "Not read yet: the weekly read of competitor pages has not reached it." : p.error,
      };
    })
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || a.domain.localeCompare(b.domain))
    .slice(0, 8);
}

/* ---------- the answer ------------------------------------------------------------------------- */

routes.get("/", async (c) => {
  const range = rangeFrom(c);
  const asked = addressOf(c.req.query("path"));
  const until = Date.now() + PATIENCE_MS;
  const v = view();
  const ran = (() => {
    try {
      return engineRan();
    } catch {
      return false;
    }
  })();
  const opps = ran ? openByPage() : new Map<string, OppLite[]>();
  const [search, ga, organic] = await Promise.all([
    reading("gsc", () => searchFor(range)),
    inTime(reading("ga4", () => gaPages(range)), until),
    inTime(reading("ga4", () => organicLanding(range)), until),
  ]);
  const listed = list(v, asked, opps, ran, search, ga);
  const path = asked ?? (listed.state === "ok" ? (listed.value.rows[0]?.page.path ?? null) : null);
  const curveNow = curve();

  const searchFrom: SearchFrom | null =
    search.state === "ok"
      ? {
          from: search.value.from,
          start: search.value.start,
          end: search.value.end,
          days: search.value.days,
          line:
            search.value.from === "history"
              ? `From the desk's own daily history of Search Console, ${search.value.start} to ${search.value.end}.`
              : `Asked of Search Console directly, ${search.value.start} to ${search.value.end}: the desk's own daily history has no snapshot yet.`,
        }
      : null;

  const none = <T>(why: string): Reading<T> => waiting("crawl", why);
  const noPage = path ? `The crawl knows no page at ${path}: it is not in the sitemap and not among the repository's page files.` : "Choose a page from the list.";

  /* The crawl's detail of the page, once. */
  const detail = path ? crawlPage(path) : null;
  const d = detail && detail.state === "ok" ? detail.value : null;
  const findings = (d?.findings ?? []) as Finding[];
  const readiness = path ? readinessOf(path) : null;

  /* Search figures for the page. */
  const fig = path && search.state === "ok" ? (search.value.pages.get(path) ?? { ...ZERO, previous: search.value.site.compared ? ZERO : null }) : null;
  const series = path && search.state === "ok" ? await reading("gsc", async () => ok(await search.value.series(path), "gsc", search.value.asOf, search.value.note)) : null;
  const pairs = path && search.state === "ok" ? search.value.pairs.filter((p) => p.path === path) : [];

  let pageReading: Reading<PageSummary>;
  if (!path) pageReading = none(noPage);
  else if (!d) pageReading = detail && detail.state !== "ok" ? absent(detail) : off("crawl", noPage);
  else {
    const summary: PageSummary = {
      ...pageRef(path, v),
      url: abs(path),
      status: d.status,
      inSitemap: d.inSitemap,
      indexable: d.indexable,
      updated: d.lastChanged && d.lastChanged !== d.firstSeen ? d.lastChanged : d.lastmod,
      organicSessions: organic.state === "ok" ? (organic.value.get(path) ?? 0) : null,
    };
    pageReading = ok(summary, "crawl", detail!.state === "ok" ? detail!.asOf : new Date().toISOString());
  }

  /* The page's four search tiles and its score. */
  const tiles: PageTiles = (() => {
    const scoreTile: Reading<Stat> = d
      ? d.score === null
        ? off("crawl", d.inSitemap ? "The page answered and could not be read, so it has no score." : "Kept out of the sitemap, so it has no SEO score.")
        : ok({ value: d.score, previous: null, unit: "score", series: [], of: 100 }, "crawl", detail!.state === "ok" ? detail!.asOf : new Date().toISOString(), STATUS_RULE)
      : none(noPage);
    if (search.state !== "ok" || !fig) {
      const a = search.state !== "ok" ? absent<never>(search) : none<never>(noPage);
      return { position: a, impressions: a, clicks: a, ctr: a, score: scoreTile };
    }
    const s = search.value;
    const days = series && series.state === "ok" ? series.value : [];
    const prev = fig.previous;
    const at = s.asOf;
    const pos = days.map((x) => x.position);
    return {
      position:
        fig.position === null
          ? waiting("gsc", `Google showed this page to nobody between ${s.start} and ${s.end}, so it has no position.`)
          : ok({ value: fig.position, previous: prev?.position ?? null, unit: "ratio", series: pos.every((p) => p !== null) ? (pos as number[]) : [] }, "gsc", at, `Google's average position, weighted by impressions; lower is better. ${s.note}`),
      impressions: ok({ value: fig.impressions, previous: prev ? prev.impressions : null, unit: "count", series: days.map((x) => x.impressions) }, "gsc", at, s.note),
      clicks: ok({ value: fig.clicks, previous: prev ? prev.clicks : null, unit: "count", series: days.map((x) => x.clicks) }, "gsc", at, s.note),
      ctr: ok({ now: rate(fig.clicks, fig.impressions), previous: prev ? rate(prev.clicks, prev.impressions) : null, series: days.map((x) => (x.impressions ? round((x.clicks / x.impressions) * 100, 2) : null)) }, "gsc", at, s.note),
      score: scoreTile,
    };
  })();

  /* Queries, with their cluster and our estimate. */
  const kw = (() => {
    try {
      return new Map(allKeywords().map((k) => [k.phrase, k.cluster]));
    } catch {
      return new Map<string, string | null>();
    }
  })();
  const names = (() => {
    try {
      return clusterNames();
    } catch {
      return new Map<string, string>();
    }
  })();
  const days = search.state === "ok" ? search.value.days : daysOf(range);
  const queryRows: PageQuery[] = pairs.map((p) => {
    const cl = kw.get(p.query) ?? null;
    return {
      query: p.query,
      clicks: p.clicks,
      impressions: p.impressions,
      ctr: rate(p.clicks, p.impressions),
      position: p.position ?? 0,
      cluster: cl ? { key: cl, name: names.get(cl) ?? cl } : null,
      potential: p.position !== null && p.position >= 4 && p.position <= 20 ? estimate({ impressions: p.impressions, clicks: p.clicks, days, target: TARGET_POSITION }) : null,
    };
  });
  const queries: SeoPageViewPayload["queries"] = !path
    ? none(noPage)
    : search.state !== "ok"
      ? absent(search)
      : ok(
          {
            rows: queryRows,
            withheld: (() => {
              const listed = queryRows.reduce((s, r) => s + r.impressions, 0);
              const all = fig?.impressions ?? 0;
              if (!all) return "Google showed the page for no query in the window.";
              return all > listed
                ? `Google withholds rare queries: the ${n(queryRows.length)} listed hold ${n(listed)} of the page's ${n(all)} impressions.`
                : "Every impression of the page is in a listed query (Google withholds rare ones, none here).";
            })(),
          },
          "gsc",
          search.value.asOf,
          search.value.note,
        );

  /* Traffic potential: our estimate, from the page's real impressions. */
  const potential: Reading<PagePotential> = (() => {
    if (!path) return none(noPage);
    if (search.state !== "ok") return absent(search);
    const s = search.value;
    if (!fig || !fig.impressions) return off("gsc", `Google showed this page to nobody between ${s.start} and ${s.end}, so there is nothing to estimate from.`);
    const parts = queryRows
      .filter((q) => q.potential)
      .map((q) => ({ query: q.query, impressions: q.impressions, position: q.position, clicksPerMonth: q.potential!.clicksPerMonth, basis: q.potential!.basis }))
      .sort((a, b) => b.clicksPerMonth - a.clicksPerMonth);
    if (!parts.length) {
      const further = queryRows.filter((q) => q.position > 20).length;
      return off(
        "gsc",
        `None of the page's queries stands at position 4 to 20, where our estimate reaches${further ? ` (${further} stand${further === 1 ? "s" : ""} further back)` : ""}, so it gives no number.`,
      );
    }
    const clicks = round(parts.reduce((t, p) => t + p.clicksPerMonth, 0), 1);
    const shown = queryRows.filter((q) => q.potential).reduce((t, q) => t + q.potential!.impressionsPerMonth, 0);
    return ok(
      {
        clicksPerMonth: clicks,
        impressionsPerMonth: shown,
        queries: parts.slice(0, 6),
        days: series && series.state === "ok" ? series.value.map((x) => ({ date: x.date, impressions: x.impressions })) : [],
        basis: `Our estimate: ${parts.length} quer${parts.length === 1 ? "y" : "ies"} at position 4 to 20, ${n(shown)} impressions a month, each brought to position ${TARGET_POSITION} by our CTR curve (impressions × (curve at ${TARGET_POSITION} − CTR now)).`,
      },
      "gsc",
      s.asOf,
      `OUR ESTIMATE, not a figure from Google. ${curveNow.note}`,
    );
  })();

  /* The engine's opportunities for the page. */
  const pageOpps: OpportunityRow[] = path && ran ? (() => {
    try {
      return pageOpportunities(path, v);
    } catch {
      return [];
    }
  })() : [];

  const ownTitle = pageRef(path ?? "/", v).title;
  const shownInGoogle = !!fig && fig.impressions > 0;
  const hand = path
    ? (() => {
        try {
          return inHand(path);
        } catch {
          return NOTHING_IN_HAND;
        }
      })()
    : NOTHING_IN_HAND;
  const suggestions = path && d ? suggestionsFor(path, pageOpps, findings, readiness, ownTitle, shownInGoogle, hand) : [];
  const quick = path ? quickFor(path, ownTitle, d?.words ?? null, d?.schemaTypes ?? [], d?.status === 200, hand) : [];

  const defaultShare = await structure()
    .then((s) => s?.defaultShare ?? null)
    .catch(() => null);

  const crawlReading: Reading<PageCrawl> = !path
    ? none(noPage)
    : !d
      ? detail && detail.state !== "ok"
        ? absent(detail)
        : off("crawl", noPage)
      : ok(
          {
            at: detail!.state === "ok" ? detail!.asOf : new Date().toISOString(),
            title: d.title,
            titleLength: d.title ? [...d.title].length : 0,
            description: d.description,
            descriptionLength: d.description ? [...d.description].length : 0,
            h1: d.h1,
            words: d.words,
            canonical: d.facts?.canonical ?? null,
            robots: d.facts?.robots ?? d.fetched?.robotsTag ?? null,
            schemaTypes: d.schemaTypes,
            linksIn: d.inlinks,
            linksInFromContent: d.inlinksFromContent,
            linksOut: d.outlinks,
            findings: findings.map((f) => ({ rule: f.rule, title: f.title, severity: f.severity, text: f.text, cost: f.cost, area: f.area })),
            status: d.status,
            lang: d.facts?.lang ?? null,
            og: { title: d.facts?.og.title ?? null, description: d.facts?.og.description ?? null, image: pictureOf(d.facts?.og.image ?? null) },
            twitterCard: d.facts?.twitter.card ?? null,
            defaultPicture: pictureOf(defaultShare),
            h1s: d.facts?.h1 ?? [],
            h2: d.facts?.h2 ?? 0,
            images: (() => {
              const shown = (d.facts?.images ?? []).filter((i) => !i.hidden);
              const missing = shown.filter((i) => i.alt === "absent");
              return { shown: shown.length, altAbsent: missing.length, files: [...new Set(missing.map((i) => i.file ?? i.remote ?? "?"))].slice(0, 12) };
            })(),
          },
          "crawl",
          detail!.state === "ok" ? detail!.asOf : new Date().toISOString(),
          "The desk's own read of the live page at the last crawl.",
        );

  const serp: Serp | null = d
    ? {
        url: d.url,
        title: d.title,
        titleLength: d.title ? [...d.title].length : 0,
        titleLimit: LIMITS.title,
        description: d.description,
        descriptionLength: d.description ? [...d.description].length : 0,
        descriptionLimit: LIMITS.description,
        schemaTypes: d.schemaTypes,
      }
    : null;

  const clusterList = path
    ? (() => {
        try {
          return clustersOf(path);
        } catch {
          return [];
        }
      })()
    : [];
  const competitors = (() => {
    try {
      return competitorsOf(
        clusterList.map((x) => x.key),
        new Set(pairs.map((p) => p.query)),
      );
    } catch {
      return [];
    }
  })();

  const links: Reading<PageLinks> = !d
    ? none(noPage)
    : ok(
        {
          in: d.linksIn,
          out: d.linksOut.map((l) => ({ target: l.target, text: l.text, internal: l.internal, place: l.place, status: l.status, outcome: l.outcome })),
        },
        "crawl",
        detail!.state === "ok" ? detail!.asOf : new Date().toISOString(),
        "Links as the crawl read them: “main” is the page's own text, “chrome” the menu and footer every page shares.",
      );

  const visitors: Reading<PageVisitors> = !path
    ? none(noPage)
    : ga.state !== "ok"
      ? absent(ga)
      : (() => {
          const g = ga.value.rows.get(path);
          return ok(
            {
              start: ga.value.start,
              end: ga.value.end,
              users: g?.users ?? 0,
              views: g?.views ?? 0,
              engagementSeconds: g?.engagementSeconds ?? 0,
              previous: g ? g.previous : null,
              organicSessions: organic.state === "ok" ? (organic.value.get(path) ?? 0) : null,
            },
            "ga4",
            ga.asOf,
            ga.note,
          );
        })();

  const asked2: Reading<AskedTask[]> = path ? await reading("desk", () => ok(askedAbout(path), "desk", new Date().toISOString())) : none(noPage);

  return c.json<SeoPageViewPayload>({
    head: head(range),
    path,
    site: siteTiles(range, v, search, opps, ran),
    list: listed,
    searchFrom,
    status: !path ? none(noPage) : !d ? (detail && detail.state !== "ok" ? absent(detail) : off("crawl", noPage)) : statusOf(findings, d.score, d.inSitemap, readiness, detail!.state === "ok" ? detail!.asOf : new Date().toISOString()),
    potential,
    curve: curveNow,
    suggestions,
    quick,
    asked: asked2,
    links,
    visitors,
    page: pageReading,
    tiles,
    performance: !path ? none(noPage) : series ? (series.state === "ok" ? ok({ days: series.value }, "gsc", series.asOf, series.note) : absent(series)) : absent(search),
    queries,
    index: path ? indexFor(path) : none(noPage),
    crawl: crawlReading,
    readiness: !path
      ? none(noPage)
      : readiness
        ? ok(readiness, "crawl", readiness.checkedAt, "Read on the page the way a crawler gets it, without JavaScript (src/cc/seo/readiness.ts).")
        : waiting("crawl", "The AI-readiness check (daily) has not read this page yet."),
    opportunities: pageOpps,
    proposals: path ? proposalsFor(path) : [],
    serp,
    clusters: clusterList,
    competitors,
    operator: operatorPanel(quick.map((q) => ({ label: q.label, task: q.task }))),
  });
});

/* ---------- changes -------------------------------------------------------------------------- */

const ActBody = z.object({ id: z.string().min(3).max(600) });

routes.post("/act", async (c) => {
  const body = ActBody.parse(await c.req.json().catch(() => ({})));
  const opportunity = await act(body.id, me(c));
  return c.json<OpportunityAnswer>({ ok: true, opportunity });
});

const ProposeBody = z.object({
  path: z.string().min(1).max(400),
  title: z.string().max(200).optional(),
  description: z.string().max(400).optional(),
  why: z.string().max(400).optional(),
});

routes.post("/propose", async (c) => {
  const body = ProposeBody.parse(await c.req.json().catch(() => ({})));
  const path = addressOf(body.path) ?? fail(400, "Name the page by its address.");
  if (!crawledAt()) fail(409, "The crawl has not read the site yet, so the desk cannot say what the page says now.");
  const d = crawlPage(path);
  if (d.state !== "ok") fail(404, `The crawl knows no page at ${path}.`);
  const live = d.state === "ok" ? d.value : null;
  if (!live || live.status !== 200) fail(409, `${path} does not answer 200 at the last crawl, so it has no title to change.`);
  const nowOwn = ownOf(live!.title);
  const after: { title?: string; description?: string } = {};
  const t = body.title?.replace(/\s+/g, " ").trim();
  const dsc = body.description?.replace(/\s+/g, " ").trim();
  if (t !== undefined && t !== (nowOwn ?? "")) after.title = t;
  if (dsc !== undefined && dsc !== (live!.description ?? "")) after.description = dsc;
  if (after.title === undefined && after.description === undefined) fail(400, "It changes nothing: the title and description are what the page says now.");
  const made = await propose({ kind: "meta", address: path, before: { title: live!.title, description: live!.description }, after, why: body.why?.trim() || null }, { source: "person", by: me(c) });
  if ("refused" in made) return fail(409, made.refused);
  const who = me(c).name;
  note("operator-proposal", `Proposed a new ${after.title !== undefined && after.description !== undefined ? "title and description" : after.title !== undefined ? "title" : "description"} for ${path}`, {
    tone: "info",
    detail: `By ${who}, on Page Optimization; it waits for approval.${after.title !== undefined ? ` Title as shown: “${after.title}${BRAND}”.` : ""}`,
    href: "/operator?ap=waiting#approvals",
    actor: who,
    dedupe: `op:proposed:${made.id}`,
  });
  return c.json<ProposalAnswer>({ ok: true, proposal: proposalRow(made.id)! }, 201);
});

/* Kept for the check script: the parts that are pure. */
export const parts = { addressOf, pageRegex, bandOf, fromFinding, fromReadiness, statusOf, suggestionsFor, quickFor, whyOf, sameTask };
