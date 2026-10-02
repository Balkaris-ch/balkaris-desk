import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { db } from "../../../db.ts";
import type { Person } from "../../../people.ts";
import { me, type Vars } from "../../access.ts";
import { proposalRow } from "../../operator/apply.ts";
import { createTask } from "../../operator/queue.ts";
import { addTodo } from "../../operator/todos.ts";
import { status as jobStatus } from "../../scheduler.ts";
import { addDays } from "../../search/shared.ts";
import { LIMITS } from "../../site/index.ts";
import { note, off, ok, reading, series, since, today, waiting } from "../../store.ts";
import type { Reading, Stat } from "../../../../web/src/contract/common.ts";
import type { NewTask, ProposalRow } from "../../../../web/src/contract/operator.ts";
import type {
  ActionKind,
  OpportunitiesActed,
  OpportunityAnswer,
  OpportunityRow,
  OpportunityState,
  OpportunityType,
  Priority,
  SeoRange,
  SeoSpan,
} from "../../../../web/src/contract/seo/common.ts";
import type {
  ClusterPanel,
  OpportunityAlternative,
  OpportunityDetail,
  OpportunityFacets,
  OpportunityLine,
  OpportunityQuery,
  OpportunityTiles,
  OwnerStepAnswer,
  SeoOpportunitiesPayload,
  Serp,
  SubjectFigures,
  SubjectNow,
} from "../../../../web/src/contract/seo/opportunities.ts";
import { competitorPages } from "../../seo/competitors.ts";
import { curve, TARGET_POSITION } from "../../seo/ctr.ts";
import { act, allOpportunities, clusterNames, opportunity, opportunityDb, rank, setState, toRow } from "../../seo/engine.ts";
import { clusters, keywords, type Cluster, type Keyword } from "../../seo/keywords.ts";
import { markOwnerTask, ownerTask } from "../../seo/owner.ts";
import { lastSnapDay, pageFigures, pageSeries, queryFigures, queryPageFigures, querySeries, rate } from "../../seo/rank.ts";
import { ACTION_LABEL, MONEY, RULES, STATES, TYPE_LABEL, WINDOW_DAYS } from "../../seo/rules.ts";
import { ownTitle, pageRef, siteView, type SiteView } from "../../seo/site.ts";
import { now } from "../../seo/tables.ts";
import { normal } from "../../seo/words.ts";
import { body, head, HISTORY_NOTE, historyAbsent, historyAt, int, operatorPanel, rangeFrom, recorded } from "./shared.ts";

/**
 * /api/v1/seo/opportunities: SEO › Opportunities (boards 111, 109, 114).
 *
 *   GET  /                      the whole page: tiles, filters with their counts,
 *                               the list, one opportunity in detail
 *   POST /:id/act  /act         take an opportunity's action, or one of its
 *                               alternatives (`as`); in bulk (ids), only the
 *                               operator's (proposals and briefs)
 *   POST /:id/state  /state     a person's decision: open, queued, in progress,
 *                               done, dismissed; one or many
 *   POST /owner-task            "I have done it": a step from the audit marked
 *                               done, and the opportunities waiting on it with it
 *                               (the owner's own steps: the owner only)
 *
 * The opportunities are the engine's (src/cc/seo/engine.ts, rules in
 * src/cc/seo/rules.ts): this file reads them, filters them and adds what the
 * page shows around them, every figure from the desk's own Search Console
 * history (src/cc/seo/rank.ts) or the crawl, each panel its own reading().
 *
 * NOTHING HERE CHANGES THE WEBSITE. An action queues an operator task on the
 * studio workstation's model; a title or description it proposes waits in the
 * approval queue (src/cc/operator/apply.ts) for a person. A change to the
 * website's code goes on the studio's to-do list in AI Operator. A person's
 * step (Search Console by hand, the owner's logins) is only marked, by the
 * person who did it.
 *
 * The one estimate is "our estimate" (src/cc/seo/ctr.ts): impressions Search
 * Console counted × the difference between our stated CTR curve at a target
 * position and the CTR now. Nothing else is estimated, and there is no search
 * volume, difficulty or domain rating: no free source gives them.
 */

export const routes = new Hono<Vars>();

/** The states the list shows unless asked: what is still to be done. */
const OPEN_STATES: OpportunityState[] = ["open", "queued", "in-progress"];
const TYPES = Object.keys(TYPE_LABEL) as OpportunityType[];
const PRIORITIES: Priority[] = ["high", "medium", "low"];
const ACTIONS = Object.keys(ACTION_LABEL) as ActionKind[];
const SORTS: OpportunityQuery["sort"][] = ["priority", "potential", "newest", "page"];
/** "Queue operator tasks" queues at most this many at once; the queue holds twenty. */
const ACT_MOST = 10;
const STATE_MOST = 50;
const GAP_TYPES = new Set<OpportunityType>(["keyword-gap", "german-missing"]);
/** Types a new title and description can help: a page Google shows or should show better. */
const META_HELPS = new Set<OpportunityType>(["near-page-one", "low-ctr", "ranking-drop", "thin-content", "missing-answer", "internal-links", "technical"]);
/** Types a brief cannot help: Google's index (a person in Search Console), a technical finding (the website's code or a title) and the owner's logins. */
const NO_BRIEF = new Set<OpportunityType>(["not-indexed", "technical", "entity"]);
/** The kinds of action the operator takes: the only ones taken in bulk. A person's step is marked on its own row by the person who took it. */
const OPERATOR_KINDS = new Set<ActionKind>(["proposal", "brief"]);
/** The cluster panel's rows (board 111 shows five); "View all" leads to the rest. */
const CLUSTER_ROWS = 6;

const fail = (status: 400 | 403 | 404 | 409, message: string): never => {
  throw new HTTPException(status, { message });
};

/* ---------- the query ------------------------------------------------------------------------- */

const list = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function parseQuery(c: Context<Vars>, range: SeoRange): OpportunityQuery {
  const q = (k: string): string | undefined => c.req.query(k);
  const types = list(q("type")).filter((t): t is OpportunityType => (TYPES as string[]).includes(t));
  const states = list(q("state")).filter((s): s is OpportunityState => (STATES as string[]).includes(s));
  const priority = PRIORITIES.find((p) => p === q("priority")) ?? null;
  const action = ACTIONS.find((a) => a === q("action")) ?? null;
  const activeRaw = q("active");
  const active: OpportunityQuery["active"] = activeRaw === "0" || activeRaw === "all" ? activeRaw : "1";
  const sort = SORTS.find((s) => s === q("sort")) ?? "priority";
  const page = (q("page") ?? "").trim() || null;
  const cluster = (q("cluster") ?? "").trim() || null;
  return {
    range,
    types,
    priority,
    states: states.length ? states : OPEN_STATES,
    active,
    action,
    page: page && page.startsWith("/") ? page : null,
    cluster,
    q: (q("q") ?? "").trim().slice(0, 120),
    sort,
    offset: int(q("offset"), 0, 0, 100_000),
    limit: int(q("limit"), 10, 1, 200),
  };
}

const activeFits = (r: OpportunityRow, a: OpportunityQuery["active"]): boolean => (a === "all" ? true : a === "1" ? r.active : !r.active);

function matches(r: OpportunityRow, q: OpportunityQuery): boolean {
  if (q.types.length && !q.types.includes(r.type)) return false;
  if (q.priority && r.priority !== q.priority) return false;
  if (q.action && r.action.kind !== q.action) return false;
  if (q.page && r.subject.page?.path !== q.page) return false;
  if (q.cluster && r.subject.cluster?.key !== q.cluster) return false;
  if (q.q) {
    const hay = [r.title, r.typeLabel, r.subject.page?.path, r.subject.page?.title, r.subject.keyword, r.subject.cluster?.name].filter(Boolean).join(" ").toLowerCase();
    if (!q.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

function sorter(sort: OpportunityQuery["sort"]): (a: OpportunityRow, b: OpportunityRow) => number {
  switch (sort) {
    case "potential":
      return (a, b) => (b.potential?.clicksPerMonth ?? -1) - (a.potential?.clicksPerMonth ?? -1) || rank(a, b);
    case "newest":
      return (a, b) => b.firstSeen.localeCompare(a.firstSeen) || rank(a, b);
    case "page":
      return (a, b) => {
        const x = a.subject.page?.path ?? null;
        const y = b.subject.page?.path ?? null;
        if (x === y) return rank(a, b);
        if (x === null) return 1;
        if (y === null) return -1;
        return x.localeCompare(y) || rank(a, b);
      };
    default:
      return rank;
  }
}

/* ---------- reading the engine ----------------------------------------------------------------- */

interface Engine {
  rows: OpportunityRow[];
  view: SiteView;
  /** Whether the engine has ever kept anything: rows, or a day's counts. */
  ran: boolean;
  /** Why there is nothing yet, when it has not run. */
  why: string;
}

/** Every opportunity the engine keeps, as the screens get it. Read once per answer. */
function readEngine(): Engine {
  const view = siteView();
  const names = clusterNames();
  const rows = allOpportunities().map((o) => toRow(o, view, names));
  const job = jobStatus().find((j) => j.name === "seo-engine");
  const ran = rows.length > 0 || since("seo.opps.open") !== null || !!job?.lastEnd;
  const why = !job
    ? "The opportunity engine is not running on this desk yet: its job (seo-engine) is not registered."
    : !job.enabled
      ? "The owner switched the opportunity engine off in Automations."
      : job.running
        ? "The opportunity engine is running for the first time now."
        : `The opportunity engine has not run yet. It runs ${job.nextRun ? "by itself shortly after the desk starts, then every hour" : "every hour"}; "Run full SEO audit" runs it now.`;
  return { rows, view, ran, why };
}

/* ---------- the subject's figures ---------------------------------------------------------------- */

interface Window {
  span: SeoSpan;
  queries: Map<string, { clicks: number; impressions: number; position: number | null }>;
  pages: Map<string, { clicks: number; impressions: number; position: number | null }>;
}

function windowOf(span: SeoSpan | null): Window | null {
  if (!span) return null;
  return {
    span,
    queries: new Map(queryFigures(span.start, span.end).map((q) => [q.query, q])),
    pages: new Map(pageFigures(span.start, span.end).map((p) => [p.path, p])),
  };
}

/** What the "Current" column measures for a row: its query, else its page; nothing for a cluster or the site. */
function subjectOf(r: OpportunityRow): { of: "query"; key: string } | { of: "page"; key: string } | null {
  if (r.subject.keyword) return { of: "query", key: r.subject.keyword };
  if (r.subject.page && !GAP_TYPES.has(r.type)) return { of: "page", key: r.subject.page.path };
  return null;
}

function nowOf(r: OpportunityRow, w: Window | null): SubjectNow | null {
  const s = subjectOf(r);
  if (!s || !w) return null;
  const f = s.of === "query" ? w.queries.get(s.key) : w.pages.get(s.key);
  return { of: s.of, position: f?.position ?? null, impressions: f?.impressions ?? 0, clicks: f?.clicks ?? 0 };
}

type Day = { date: string; clicks: number; impressions: number; position: number | null };

/** Clicks, impressions and the impression-weighted position of a run of days. */
function sum(days: Day[]): { clicks: number; impressions: number; position: number | null } {
  let clicks = 0;
  let impressions = 0;
  let w = 0;
  let wi = 0;
  for (const d of days) {
    clicks += d.clicks;
    impressions += d.impressions;
    if (d.position !== null && d.impressions) {
      w += d.position * d.impressions;
      wi += d.impressions;
    }
  }
  return { clicks, impressions, position: wi ? Math.round((w / wi) * 10) / 10 : null };
}

function figuresOf(r: OpportunityRow, span: SeoSpan, clusterPhrases: string[] | null): SubjectFigures | null {
  const s = subjectOf(r);
  const stat = (value: number, previous: number | null, line: number[]): Stat => ({ value, previous, unit: "count", series: line });
  if (s) {
    const read = (start: string, end: string): Day[] => (s.of === "query" ? querySeries(s.key, start, end) : pageSeries(s.key, start, end));
    const days = read(span.start, span.end);
    const a = sum(days);
    const b = span.compared ? sum(read(span.previousStart, span.previousEnd)) : null;
    return {
      of: s.of,
      label: s.of === "query" ? `“${s.key}”` : s.key,
      position: a.position,
      previousPosition: b?.position ?? null,
      impressions: stat(a.impressions, b ? b.impressions : null, days.map((d) => d.impressions)),
      clicks: stat(a.clicks, b ? b.clicks : null, days.map((d) => d.clicks)),
      ctr: rate(a.clicks, a.impressions),
      previousCtr: b ? rate(b.clicks, b.impressions) : null,
    };
  }
  if (clusterPhrases?.length) {
    const set = new Set(clusterPhrases);
    const tally = (start: string, end: string) => {
      let clicks = 0;
      let impressions = 0;
      for (const q of queryFigures(start, end)) {
        if (!set.has(q.query)) continue;
        clicks += q.clicks;
        impressions += q.impressions;
      }
      return { clicks, impressions };
    };
    const a = tally(span.start, span.end);
    const b = span.compared ? tally(span.previousStart, span.previousEnd) : null;
    return {
      of: "cluster",
      label: `${clusterPhrases.length} phrase${clusterPhrases.length === 1 ? "" : "s"} of the cluster`,
      position: null,
      previousPosition: null,
      impressions: stat(a.impressions, b ? b.impressions : null, []),
      clicks: stat(a.clicks, b ? b.clicks : null, []),
      ctr: rate(a.clicks, a.impressions),
      previousCtr: b ? rate(b.clicks, b.impressions) : null,
    };
  }
  return null;
}

/* ---------- the tiles ---------------------------------------------------------------------- */

/** A live count with the engine's daily record of it: the line, and the count the day before the window. */
function countTile(value: number, metrics: string[], days: number): Stat {
  const kept = metrics.map((m) => recorded(m, days));
  const first = kept.find((k) => k !== null) ?? null;
  if (!first) return { value, previous: null, unit: "count", series: [] };
  /* Several metrics (the two gap types) are one line: the days they share, added. */
  const line = kept.length === 1 ? first.series : addLines(metrics, days);
  const previous = kept.every((k) => k && k.previous !== null) ? kept.reduce((n, k) => n + (k?.previous ?? 0), 0) : null;
  return { value, previous, unit: "count", series: line };
}

function addLines(metrics: string[], days: number): number[] {
  const by = new Map<string, number>();
  const before = today(-days);
  for (const m of metrics) for (const p of series(m, days + 1)) if (p.day > before) by.set(p.day, (by.get(p.day) ?? 0) + p.value);
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
}

/**
 * "Estimated traffic gain", each search counted once. Several opportunities
 * can draw on the same impressions: a search's own row (near page one, a
 * drop), the page Google shows it on (low CTR, a page's drop) and the topic
 * gap its phrase belongs to. So the estimates are added in that order, and one
 * is added only when none of the searches it draws on is counted already: a
 * search's own estimate first (the larger, when two rows share one search),
 * then a page's when none of the searches Google showed the page for over the
 * engine's window is counted, then a topic's when none of its phrases is. What
 * overlaps is left out, never split: the sum leans low rather than high.
 */
function gainOnce(open: OpportunityRow[]): { clicks: number; counted: number; left: number } {
  const estimated = open.filter((r) => r.potential);
  if (!estimated.length) return { clicks: 0, counted: 0, left: 0 };
  /* The searches Google showed each page for over the engine's own window (src/cc/seo/rules.ts). */
  const byPage = new Map<string, Set<string>>();
  const end = lastSnapDay();
  if (end && estimated.some((r) => !r.subject.keyword && r.subject.page && !GAP_TYPES.has(r.type))) {
    for (const f of queryPageFigures(addDays(end, -(WINDOW_DAYS - 1)), end)) {
      if (!f.impressions) continue;
      const s = byPage.get(f.path) ?? new Set<string>();
      s.add(normal(f.query));
      byPage.set(f.path, s);
    }
  }
  const phrases = new Map<string, string[]>();
  if (estimated.some((r) => !r.subject.keyword && r.subject.cluster)) {
    for (const k of keywords()) if (k.cluster) phrases.set(k.cluster, [...(phrases.get(k.cluster) ?? []), normal(k.phrase)]);
  }
  const drawsOn = (r: OpportunityRow): { level: number; keys: string[] } => {
    if (r.subject.keyword) return { level: 0, keys: [`q:${normal(r.subject.keyword)}`] };
    const path = r.subject.page?.path;
    if (path && !GAP_TYPES.has(r.type)) return { level: 1, keys: [`p:${path}`, ...[...(byPage.get(path) ?? [])].map((q) => `q:${q}`)] };
    if (r.subject.cluster) return { level: 2, keys: [`c:${r.subject.cluster.key}`, ...(phrases.get(r.subject.cluster.key) ?? []).map((q) => `q:${q}`)] };
    return { level: 3, keys: [`o:${r.id}`] };
  };
  const ordered = estimated
    .map((r) => ({ r, ...drawsOn(r) }))
    .sort((a, b) => a.level - b.level || b.r.potential!.clicksPerMonth - a.r.potential!.clicksPerMonth || a.r.id.localeCompare(b.r.id));
  const taken = new Set<string>();
  let clicks = 0;
  let counted = 0;
  for (const x of ordered) {
    if (x.keys.some((k) => taken.has(k))) continue;
    for (const k of x.keys) taken.add(k);
    clicks += x.r.potential!.clicksPerMonth;
    counted++;
  }
  return { clicks: Math.round(clicks * 10) / 10, counted, left: estimated.length - counted };
}

function tilesOf(e: Engine, days: number, span: SeoSpan | null): OpportunityTiles {
  const open = e.rows.filter((r) => r.active && OPEN_STATES.includes(r.state.state));
  const count = (t: (r: OpportunityRow) => boolean) => open.filter(t).length;
  const asOf = now();
  const tile = (value: number, metrics: string[]): Reading<Stat> =>
    e.ran ? ok(countTile(value, metrics, days), "desk", asOf, "Counted now over the open opportunities; the line is the engine's count once a day.") : waiting("desk", e.why);
  let gain: Reading<{ clicksPerMonth: number; from: number; left: number; line: string }>;
  if (!e.ran) gain = waiting("desk", e.why);
  else {
    try {
      const g = gainOnce(open);
      const of = (n: number) => `${n} open opportunit${n === 1 ? "y" : "ies"}`;
      gain = g.counted
        ? ok(
            {
              clicksPerMonth: g.clicks,
              from: g.counted,
              left: g.left,
              line: `Our estimate, each search counted once: ${of(g.counted)} with Search Console impressions added${g.left ? `; ${g.left} more left out because ${g.left === 1 ? "it draws" : "they draw"} on searches already counted` : ""}. A search's own estimate counts first, then a page's or a topic's only when none of its searches is counted yet. At our stated CTR curve; not a forecast.`,
            },
            "gsc",
            asOf,
            curve().note,
          )
        : span
          ? off("gsc", "No open opportunity has Search Console impressions to estimate from, so there is nothing honest to add up.")
          : historyAbsent();
    } catch (err) {
      gain = waiting("gsc", `The estimate could not be added up: ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`);
    }
  }
  return {
    nearPageOne: tile(count((r) => r.type === "near-page-one"), ["seo.opps.near-page-one"]),
    ctr: tile(count((r) => r.type === "low-ctr"), ["seo.opps.low-ctr"]),
    technical: tile(count((r) => r.type === "technical"), ["seo.opps.technical"]),
    total: tile(open.length, ["seo.opps.open"]),
    gaps: tile(count((r) => GAP_TYPES.has(r.type)), ["seo.opps.keyword-gap", "seo.opps.german-missing"]),
    estimatedGain: gain,
  };
}

/* ---------- the facets ---------------------------------------------------------------------- */

function facetsOf(rows: OpportunityRow[], q: OpportunityQuery): OpportunityFacets {
  const byActive = rows.filter((r) => activeFits(r, q.active));
  const base = byActive.filter((r) => q.states.includes(r.state.state));
  const tally = <K extends string>(list: OpportunityRow[], key: (r: OpportunityRow) => K | null | undefined): Map<K, number> => {
    const m = new Map<K, number>();
    for (const r of list) {
      const k = key(r);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const types = tally(base, (r) => r.type);
  const prios = tally(base, (r) => r.priority);
  const states = tally(byActive, (r) => r.state.state);
  const actions = tally(base, (r) => r.action.kind);
  const pages = tally(base, (r) => r.subject.page?.path);
  const cl = tally(base, (r) => r.subject.cluster?.key);
  const names = new Map(base.flatMap((r) => (r.subject.cluster ? [[r.subject.cluster.key, r.subject.cluster.name] as const] : [])));
  return {
    types: TYPES.filter((t) => types.has(t)).map((t) => ({ type: t, label: TYPE_LABEL[t], count: types.get(t)! })),
    priorities: PRIORITIES.map((p) => ({ priority: p, count: prios.get(p) ?? 0 })),
    states: STATES.map((s) => ({ state: s, count: states.get(s) ?? 0 })),
    actions: ACTIONS.filter((a) => actions.has(a)).map((a) => ({ kind: a, label: ACTION_LABEL[a], count: actions.get(a)! })),
    pages: [...pages.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([path, count]) => ({ path, count })),
    clusters: [...cl.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key, count]) => ({ key, name: names.get(key) ?? key, count })),
    cleared: rows.filter((r) => !r.active).length,
  };
}

/* ---------- one opportunity in detail ---------------------------------------------------------- */

const isBusy = (r: OpportunityRow): boolean => !!r.state.task && (r.state.task.state === "queued" || r.state.task.state === "running");

const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The operator tasks an opportunity can queue besides its own action, with the task each queues. */
function alternativesOf(r: OpportunityRow, view: SiteView): (OpportunityAlternative & { task: NewTask })[] {
  const out: (OpportunityAlternative & { task: NewTask })[] = [];
  const closed = r.state.state === "done" || r.state.state === "dismissed";
  const why = closed
    ? `It is ${r.state.state === "done" ? "done" : "dismissed"}; open it again to act.`
    : isBusy(r)
      ? `Operator task #${r.state.task!.id} is ${r.state.task!.state}.`
      : null;
  const path = r.subject.page?.path ?? null;
  const page = path ? view.byPath.get(path) : undefined;
  /* The engine's own rule (src/cc/seo/engine.ts, near page one): a new title only for a page that carries
     the offer and is not the home page, which is not retitled for one search. Unless the opportunity is
     about the page itself: its click rate, its own fall, or a finding on its title or description. */
  const aboutThePage = r.type === "low-ctr" || (r.type === "ranking-drop" && !r.subject.keyword) || (r.type === "technical" && /^technical:(title|description)\./.test(r.id));
  const carriesOffer = !!page && path !== "/" && !!page.kind && MONEY.has(page.kind);
  if (path && META_HELPS.has(r.type) && r.action.kind !== "proposal" && (aboutThePage || carriesOffer)) {
    const answers = page?.status === 200;
    out.push({
      as: "metadata",
      label: "Propose a title and description",
      step: `The operator (the studio workstation's model) writes a new title and description for ${path}. They wait in AI Operator › Approvals; nothing on the live site changes until a person approves.`,
      available: !why && answers,
      why: why ?? (answers ? null : "The crawl has no page answering 200 at this address, so there is no title to change."),
      task: { kind: "metadata", paths: [path], depth: "deep" },
    });
  }
  if (!NO_BRIEF.has(r.type) && r.action.kind !== "brief" && (path || r.subject.keyword || r.subject.cluster)) {
    const name = ownTitle(page?.title);
    const searches = r.subject.keyword ? ` for the search “${r.subject.keyword}”` : r.subject.cluster ? ` for the searches “${r.subject.cluster.name}”` : "";
    const evidence = r.evidence.map((e) => `${e.label}: ${e.value}`).join("; ");
    const prompt = `${path ? `Improve ${path}${name ? ` (“${name}”)` : ""}` : "A page"}${searches}. The finding: ${r.title}. What the page must answer, the sections to add or rewrite, the proof the studio can stand behind, and the internal links that should point to it. What the desk measured: ${evidence}.`;
    out.push({
      as: "brief",
      label: "Write a brief",
      step: "The operator (the studio workstation's model) writes a brief: what the page must answer, its sections, the facts it needs from the studio and its links. A person writes and publishes; nothing reaches the site by itself.",
      available: !why,
      why,
      task: { kind: "brief", prompt: truncate(prompt.replace(/\s+/g, " ").trim(), 990), depth: "deep" },
    });
  }
  return out;
}

function serpOf(path: string | null, view: SiteView): Serp | null {
  const p = path ? view.byPath.get(path) : undefined;
  if (!p) return null;
  return {
    url: p.url,
    title: p.title,
    titleLength: p.title?.length ?? 0,
    titleLimit: LIMITS.title,
    description: p.description,
    descriptionLength: p.description?.length ?? 0,
    descriptionLimit: LIMITS.description,
    schemaTypes: p.schemaTypes,
  };
}

/** Title and description proposals for a page, from any task, newest first. */
function proposalsFor(path: string | null): ProposalRow[] {
  if (!path) return [];
  const ids = db.prepare("SELECT id FROM cc_proposals WHERE kind = 'meta' AND address = ? ORDER BY id DESC LIMIT 6").all(path) as { id: number }[];
  return ids.map((r) => proposalRow(r.id)).filter((p): p is ProposalRow => p !== null);
}

/** The keyword cluster the opportunity belongs to (its own, or its keyword's), with the phrases' figures; else the page's queries. */
function clusterPanel(r: OpportunityRow, w: Window | null, kw: Keyword[], cls: Cluster[]): Reading<ClusterPanel> {
  const key = r.subject.cluster?.key ?? (r.subject.keyword ? (kw.find((k) => k.phrase === r.subject.keyword)?.cluster ?? null) : null);
  const status = new Map(kw.map((k) => [k.phrase, k.status]));
  const at = w ? historyAt() : now();
  if (key) {
    const c = cls.find((x) => x.key === key);
    const phrases = kw.filter((k) => k.cluster === key);
    const order = { relevant: 0, weak: 1, unjudged: 2, irrelevant: 3 } as const;
    const rows = phrases
      .map((k) => {
        const f = w?.queries.get(k.phrase);
        return { phrase: k.phrase, status: k.status, impressions: w ? (f?.impressions ?? 0) : null, clicks: w ? (f?.clicks ?? 0) : null, position: f?.position ?? null };
      })
      .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0) || order[a.status] - order[b.status] || a.phrase.localeCompare(b.phrase))
      .slice(0, CLUSTER_ROWS);
    const lang = c?.lang === "de" ? "German" : c?.lang === "en" ? "English" : (c?.lang ?? null);
    return ok(
      {
        kind: "cluster",
        title: `${c?.name ?? key}${lang ? ` (${lang})` : ""}`,
        cluster: c ? { key: c.key, name: c.name, lang: c.lang, intent: c.intent, priority: c.priority, page: c.page } : null,
        rows,
        total: phrases.length,
        href: `/seo/keywords?cluster=${encodeURIComponent(key)}`,
      },
      w ? "gsc" : "desk",
      at,
      w ? `${HISTORY_NOTE} Impressions are the site's in Google, not search volume: no free source gives volume.` : "The phrases are the desk's keyword table; their Search Console figures wait for the desk's history.",
    );
  }
  const path = r.subject.page?.path;
  if (path) {
    if (!w) return historyAbsent();
    const qs = queryPageFigures(w.span.start, w.span.end, { path });
    return ok(
      {
        kind: "page",
        title: path,
        cluster: null,
        rows: qs.slice(0, CLUSTER_ROWS).map((q) => ({ phrase: q.query, status: status.get(q.query) ?? null, impressions: q.impressions, clicks: q.clicks, position: q.position })),
        total: qs.length,
        href: `/seo/keywords?page=${encodeURIComponent(path)}`,
      },
      "gsc",
      at,
      `${HISTORY_NOTE} The queries Google reported for this page; rare ones are withheld.`,
    );
  }
  return off("desk", "This opportunity has no keyword, cluster or page to list searches for: it is about the site as a whole, or a step off the site.");
}

function detailOf(r: OpportunityRow, e: Engine, w: Window | null, kw: Keyword[], cls: Cluster[]): OpportunityDetail {
  const path = r.subject.page?.path ?? null;
  const s = subjectOf(r);
  const history: Day[] = s && w ? (s.of === "query" ? querySeries(s.key, w.span.start, w.span.end) : pageSeries(s.key, w.span.start, w.span.end)) : [];
  const competing =
    r.subject.keyword && w
      ? queryPageFigures(w.span.start, w.span.end, { query: r.subject.keyword })
          .filter((x) => x.path !== path)
          .slice(0, 6)
          .map((x) => ({ page: pageRef(x.path, e.view), impressions: x.impressions, position: x.position }))
      : [];
  const related = (o: OpportunityRow): boolean =>
    o.id !== r.id &&
    ((!!r.subject.cluster && o.subject.cluster?.key === r.subject.cluster.key) || (!!path && o.subject.page?.path === path) || (!!r.subject.keyword && o.subject.keyword === r.subject.keyword));
  const similar = e.rows.filter((o) => o.active && OPEN_STATES.includes(o.state.state) && related(o)).sort(rank).slice(0, 5);
  const clusterKey = r.subject.cluster?.key ?? (r.subject.keyword ? (kw.find((k) => k.phrase === r.subject.keyword)?.cluster ?? null) : null);
  const comp = (clusterKey ? competitorPages({ cluster: clusterKey }) : r.subject.keyword ? competitorPages({ query: r.subject.keyword }) : [])
    .filter((p) => p.fetchedAt && p.status === 200)
    .slice(0, 6)
    .map((p) => ({ domain: p.domain, url: p.url, title: p.title, words: p.words, lang: p.lang, priceStated: p.priceStated, seen: p.fetchedAt! }));
  const phrases = r.subject.cluster ? kw.filter((k) => k.cluster === r.subject.cluster!.key).map((k) => k.phrase) : null;
  let figures: Reading<SubjectFigures>;
  if (!w) figures = historyAbsent();
  else {
    const f = figuresOf(r, w.span, phrases);
    figures = f
      ? ok(f, "gsc", historyAt(), HISTORY_NOTE)
      : off("desk", "This opportunity has no query, page or cluster that Google shows: it is about the site as a whole, or a step off the site.");
  }
  const ranked = history.some((d) => d.position !== null);
  return {
    opportunity: r,
    history,
    competing,
    similar,
    serp: serpOf(path, e.view),
    competitors: comp,
    figures,
    target: r.potential ? r.potential.targetPosition : ranked ? TARGET_POSITION : null,
    cluster: clusterPanel(r, w, kw, cls),
    proposals: proposalsFor(path),
    alternatives: alternativesOf(r, e.view).map(({ task: _task, ...a }) => a),
  };
}

/* ---------- GET / ------------------------------------------------------------------------------ */

routes.get("/", async (c) => {
  const range = rangeFrom(c);
  const q = parseQuery(c, range);
  const h = head(range);
  const days = h.span?.days ?? { "7d": 7, "30d": 30, "90d": 90, "1y": 365 }[range];

  let e: Engine | null = null;
  let broke: string | null = null;
  try {
    e = readEngine();
  } catch (err) {
    broke = `The opportunities could not be read: ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`;
  }
  const broken = <T>(): Reading<T> => waiting("desk", broke ?? "The opportunities could not be read.");

  /* The window's figures, read once for the list and the detail. A failure costs the figures, never the list. */
  let win: Window | null = null;
  let rankReading: SeoOpportunitiesPayload["rank"];
  try {
    win = windowOf(h.span);
    rankReading = win
      ? ok({ start: win.span.start, end: win.span.end, days: win.span.days, compared: win.span.compared }, "gsc", historyAt(), HISTORY_NOTE)
      : historyAbsent();
  } catch (err) {
    rankReading = waiting("gsc", `The desk's Search Console history could not be read: ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`);
  }

  const facets: OpportunityFacets = e
    ? facetsOf(e.rows, q)
    : { types: [], priorities: PRIORITIES.map((p) => ({ priority: p, count: 0 })), states: STATES.map((s) => ({ state: s, count: 0 })), actions: [], pages: [], clusters: [], cleared: 0 };

  const shown = e ? e.rows.filter((r) => activeFits(r, q.active) && q.states.includes(r.state.state) && matches(r, q)).sort(sorter(q.sort)) : [];
  const offset = Math.min(q.offset, Math.max(0, shown.length - 1 - ((shown.length - 1) % q.limit)));
  const pageRows = shown.slice(offset, offset + q.limit);

  const listReading: SeoOpportunitiesPayload["list"] = !e
    ? broken()
    : !e.ran
      ? waiting("desk", e.why)
      : ok(
          { total: shown.length, offset, limit: q.limit, rows: pageRows.map((r): OpportunityLine => ({ ...r, now: nowOf(r, win) })) },
          "desk",
          now(),
          "The opportunity engine's table: each row's evidence names its own source and day.",
        );

  /* The one in detail: the one asked for, else the first row shown. */
  const openId = (c.req.query("open") ?? "").trim();
  let selected: SeoOpportunitiesPayload["selected"] = null;
  if (e) {
    const engine = e;
    const pick = openId ? (engine.rows.find((r) => r.id === openId) ?? null) : (pageRows[0] ?? null);
    if (openId && !pick) selected = off("desk", `There is no opportunity ${openId}: the engine may have replaced it, or the address is old.`);
    else if (pick) {
      selected = await reading("desk", () => {
        let kw: Keyword[] = [];
        let cls: Cluster[] = [];
        try {
          kw = keywords();
          cls = clusters();
        } catch {
          /* the keyword table is not there: the cluster panel says so by having no rows */
        }
        return ok(detailOf(pick, engine, win, kw, cls), "desk", now());
      });
    }
  } else if (broke) selected = broken();

  const tiles: OpportunityTiles = e
    ? tilesOf(e, days, h.span)
    : { nearPageOne: broken(), ctr: broken(), technical: broken(), estimatedGain: broken(), total: broken(), gaps: broken() };

  return c.json<SeoOpportunitiesPayload>({
    head: h,
    tiles,
    facets,
    asked: { ...q, offset },
    list: listReading,
    selected,
    curve: curve(),
    rank: rankReading,
    rules: TYPES.map((t) => ({ type: t, label: TYPE_LABEL[t], rule: RULES[t] })),
    operator: operatorPanel([]),
    viewer: { owner: !!me(c).owner },
  });
});

/* ---------- changes ------------------------------------------------------------------------------ */

/** Queue one of an opportunity's alternatives: a metadata proposal or a brief, linked to it like its own action. */
async function actAs(id: string, as: "metadata" | "brief", by: Person): Promise<OpportunityRow> {
  const view = siteView();
  const o = opportunityDb(id) ?? fail(404, `There is no opportunity ${id}.`);
  const row = toRow(o, view);
  const alt = alternativesOf(row, view).find((a) => a.as === as) ?? fail(409, as === "metadata" ? "A new title and description cannot help this opportunity, or it is already its own action." : "A brief cannot help this opportunity, or it is already its own action.");
  if (!alt.available) fail(409, alt.why ?? "It cannot be queued now.");
  const task = await createTask(alt.task, by);
  db.prepare("UPDATE cc_seo_opps SET state = 'queued', state_by = ?, state_at = ?, state_note = ?, task_id = ? WHERE id = ?").run(
    by.name,
    now(),
    `Queued as operator task #${task.id}: it runs on the studio workstation when it is on.`,
    task.id,
    id,
  );
  note("seo-action", `${as === "metadata" ? "Asked for a title and description" : "Asked for a brief"}: ${o.title}`, {
    tone: "info",
    actor: by.name,
    detail: `Operator task #${task.id}${as === "metadata" ? "; what it proposes waits for approval" : ""}.`,
    href: `/seo/opportunities?open=${encodeURIComponent(id)}`,
    dedupe: `seo:act:${id}:${task.id}`,
  });
  return opportunity(id, view)!;
}

/**
 * A change to the website's code: it goes on the studio's to-do list in AI
 * Operator (src/cc/operator/todos.ts) with the exact step, for whoever changes
 * the website's code, and the opportunity is queued with the entry's number.
 * The next crawl or check says whether it was done: the opportunity clears when
 * the rules no longer find it.
 */
function handToCode(id: string, by: Person): OpportunityRow {
  const view = siteView();
  const o = opportunityDb(id) ?? fail(404, `There is no opportunity ${id}.`);
  const row = toRow(o, view);
  if (row.action.kind !== "code") fail(409, "Its action is not a change to the website's code.");
  if (!row.action.available) fail(409, row.action.why ?? "Its action cannot be taken now.");
  if (row.state.state !== "open") fail(409, `It is ${row.state.state === "in-progress" ? "in progress" : row.state.state} already${row.state.note ? `: ${row.state.note}` : "."}`);
  const where = o.page ?? "the whole site";
  /* The engine's own label when it names the step ("Add internal links"), else what it is. */
  const what = row.action.label && row.action.label !== "Hand to the website's code" ? row.action.label : "Website code";
  const todo = addTodo(
    truncate(`${what}, ${where}: ${o.title}`, 158),
    `${row.action.step}\n\nFrom SEO › Opportunities (/seo/opportunities?open=${encodeURIComponent(id)}). The next crawl checks it; the opportunity clears when the rules no longer find it.`,
    by,
  );
  db.prepare("UPDATE cc_seo_opps SET state = 'queued', state_by = ?, state_at = ?, state_note = ? WHERE id = ?").run(
    by.name,
    now(),
    `On the to-do list in AI Operator as #${todo.id}, for whoever changes the website's code. The next crawl checks it.`,
    id,
  );
  note("seo-action", `On the to-do list for the website's code: ${o.title}`, {
    tone: "info",
    actor: by.name,
    detail: `To-do #${todo.id}, ${where}.`,
    href: `/seo/opportunities?open=${encodeURIComponent(id)}`,
    dedupe: `seo:code:${id}:${todo.id}`,
  });
  return opportunity(id, view)!;
}

/**
 * One opportunity's own action. The operator's (a proposal, a brief) and
 * "Request indexing" marked by the person who pressed it in Search Console go
 * to the engine; a change to the website's code goes on the to-do list; a step
 * from the audit is marked done with its task (POST /owner-task), never here.
 */
async function actOn(id: string, by: Person): Promise<OpportunityRow> {
  const o = opportunityDb(id) ?? fail(404, `There is no opportunity ${id}.`);
  const row = toRow(o, siteView());
  const a = row.action;
  if (a.kind === "code") return handToCode(id, by);
  if (a.kind === "owner" || (a.kind === "chrome" && a.ownerTaskId && !a.href)) {
    fail(409, a.kind === "owner" ? "Only the owner can do this: it is marked done with its task (“I have done it”) once it is." : "A step in the owner's browser: do it, then mark its task done (“I have done it”).");
  }
  return act(id, by);
}

const asOf = (v: unknown): "metadata" | "brief" | null => (v === "metadata" || v === "brief" ? v : v === undefined || v === null || v === "" ? null : fail(400, "`as` is metadata or brief."));

async function actOne(c: Context<Vars>, id: string, as: "metadata" | "brief" | null) {
  if (!id) fail(400, "Which opportunity? Send its id.");
  const row = as ? await actAs(id, as, me(c)) : await actOn(id, me(c));
  return c.json<OpportunityAnswer>({ ok: true, opportunity: row });
}

/** Why a ticked row is not taken in bulk: a person's step is marked on its own row by whoever took it. */
function notInBulk(r: OpportunityRow): string {
  switch (r.action.kind) {
    case "chrome":
      return r.action.href
        ? "A person's step: request indexing in Search Console, then mark it on its own row."
        : "A person's step in the owner's browser: do it, then mark it done on its own row.";
    case "code":
      return "A change to the website's code: put it on the to-do list from its own row.";
    case "owner":
      return "Only the owner can do this.";
    default:
      return "Not an operator task.";
  }
}

const idsOf = (v: unknown, most: number): string[] => {
  if (!Array.isArray(v) || !v.length) fail(400, "Send `ids`, a list of opportunity ids.");
  const ids = [...new Set((v as unknown[]).map((x) => String(x ?? "").trim()).filter(Boolean))];
  if (ids.length > most) fail(400, `At most ${most} at once.`);
  return ids;
};

/** The sentence an error carries back to a bulk result line. */
const said = (err: unknown): string => (err instanceof HTTPException ? err.message : err instanceof Error ? err.message.slice(0, 200) : String(err));

routes.post("/act", async (c) => {
  const b = await body(c);
  if (b.ids === undefined) return actOne(c, String(b.id ?? "").trim(), asOf(b.as));
  const ids = idsOf(b.ids, ACT_MOST);
  const results: OpportunitiesActed["results"] = [];
  const done: OpportunityRow[] = [];
  /* In bulk, only the operator's tasks are queued: nobody can have taken a person's step for the rows ticked. */
  const view = siteView();
  for (const id of ids) {
    try {
      const o = opportunityDb(id) ?? fail(404, `There is no opportunity ${id}.`);
      const r = toRow(o, view);
      if (!OPERATOR_KINDS.has(r.action.kind)) {
        results.push({ id, ok: false, line: notInBulk(r) });
        continue;
      }
      const row = await act(id, me(c));
      done.push(row);
      results.push({ id, ok: true, line: row.state.task ? `Queued as operator task #${row.state.task.id}.` : (row.state.note ?? "Queued.") });
    } catch (err) {
      results.push({ id, ok: false, line: said(err) });
    }
  }
  return c.json<OpportunitiesActed>({ ok: true, results, opportunities: done });
});

/**
 * "I have done it": a step from the audit (a person's step in the owner's
 * browser, or the owner's own login) marked done, with every opportunity
 * waiting on it, so they leave the list now rather than at the engine's next
 * run. The owner's own steps are the owner's to mark.
 */
routes.post("/owner-task", async (c) => {
  const b = await body(c);
  const id = String(b.task ?? "").trim() || fail(400, "Which task? Send `task`, its id.");
  const t = ownerTask(id) ?? fail(404, `There is no owner task ${id}.`);
  const by = me(c);
  if (t.whoAll === "owner" && !by.owner) fail(403, "Only the owner can mark the owner's own step done.");
  const task = markOwnerTask(id, true, by.name, null) ?? fail(404, `There is no owner task ${id}.`);
  const linked = db
    .prepare("SELECT id FROM cc_seo_opps WHERE json_extract(action, '$.ownerTaskId') = ? AND state NOT IN ('done', 'dismissed')")
    .all(id) as { id: string }[];
  const opportunities = linked.map((w) => setState(w.id, "done", by, `Its step was marked done: ${truncate(t.title, 200)}`));
  return c.json<OwnerStepAnswer>({ ok: true, task, opportunities });
});

const stateOf = (v: unknown): OpportunityState => ((STATES as unknown[]).includes(v) ? (v as OpportunityState) : fail(400, `\`state\` is one of ${STATES.join(", ")}.`));
const noteOf = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : null);

routes.post("/state", async (c) => {
  const b = await body(c);
  const state = stateOf(b.state);
  if (b.ids === undefined) {
    const id = String(b.id ?? "").trim() || fail(400, "Which opportunity? Send its id.");
    return c.json<OpportunityAnswer>({ ok: true, opportunity: setState(id, state, me(c), noteOf(b.note)) });
  }
  const ids = idsOf(b.ids, STATE_MOST);
  const results: OpportunitiesActed["results"] = [];
  const done: OpportunityRow[] = [];
  for (const id of ids) {
    try {
      done.push(setState(id, state, me(c), noteOf(b.note)));
      results.push({ id, ok: true, line: `Marked ${state}.` });
    } catch (err) {
      results.push({ id, ok: false, line: said(err) });
    }
  }
  return c.json<OpportunitiesActed>({ ok: true, results, opportunities: done });
});

routes.post("/:id/act", async (c) => {
  const b = await body(c);
  return actOne(c, c.req.param("id").trim(), asOf(b.as));
});

routes.post("/:id/state", async (c) => {
  const b = await body(c);
  return c.json<OpportunityAnswer>({ ok: true, opportunity: setState(c.req.param("id").trim(), stateOf(b.state), me(c), noteOf(b.note)) });
});

