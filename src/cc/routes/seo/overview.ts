import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../../db.ts";
import { me, type Vars } from "../../access.ts";
import { gaRange } from "../../ga4.ts";
import { hasKey } from "../../gauth.ts";
import { createTask, openRows, runnerState } from "../../operator/queue.ts";
import { status as jobStatus } from "../../scheduler.ts";
import * as bing from "../../search/bing.ts";
import * as gsc from "../../search/gsc.ts";
import { addDays, round } from "../../search/shared.ts";
import * as site from "../../site/index.ts";
import { note, off, ok, reading, today, waiting } from "../../store.ts";
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
  OverviewTiles,
  PresencePanel,
  PriorityFilter,
  PriorityPanel,
  RunningPanel,
  SeoOverviewPayload,
  TechnicalPanel,
  TechnicalRow,
  TopPagesPanel,
} from "../../../../web/src/contract/seo/overview.ts";
import { aiCrawlers, aiReferrals, isAi, referralSpan, tally } from "../../seo/aisearch.ts";
import { competitorNames, competitorPages, sightings } from "../../seo/competitors.ts";
import { curve, TARGET_POSITION } from "../../seo/ctr.ts";
import { act, allOpportunities, clusterNames, rank, toRow } from "../../seo/engine.ts";
import { latestInspection } from "../../seo/indexation.ts";
import { seoJobs } from "../../seo/jobs.ts";
import { budget, clusters, keywords } from "../../seo/keywords.ts";
import { markOwnerTask, ownerTasks } from "../../seo/owner.ts";
import { profiles } from "../../seo/presence.ts";
import { auditRun } from "../../seo/audit.ts";
import { daySeries, daysOf, historyFacts, lastSnapDay, pageFigures, pageSeries, queryFigures, rate, tiles as rankTiles } from "../../seo/rank.ts";
import { PRIORITY_RANK, WINDOW_DAYS } from "../../seo/rules.ts";
import { pageRef, siteView, type SiteView } from "../../seo/site.ts";
import { head, historyAbsent, HISTORY_NOTE, historyAt, operatorPanel, rangeFrom, recorded, SEO_KINDS, SEO_SUGGESTIONS } from "./shared.ts";

/**
 * /api/v1/seo/overview — the SEO section's Overview: everything the SEO
 * engine does, on one page.
 *
 *   GET  /?range=7d|30d|90d|1y   the whole page (SeoOverviewPayload)
 *   GET  /running                "Running now" alone, for the panel that keeps itself current
 *   POST /act      { ids }       take the action of one or more opportunities: an operator
 *                                task queued (a proposal waits for approval), or a person's
 *                                step marked as taken. Never changes the live site.
 *   POST /owner    { id, done, note? }   a person marks an owner task done, or open again
 *   POST /task     NewTask        queue an operator task from this page (the AI SEO Operator's
 *                                box and suggestions, a Technical fix) and write it to the SEO
 *                                log, so Running now and Recent SEO actions know it is search work
 *
 * WHERE EACH PANEL COMES FROM. The SEO engine's own tables (src/cc/seo/*:
 * the Search Console history, the keyword table and clusters, the
 * opportunities, the owner tasks, the AI checks, the referrals, the profiles,
 * the competitors), the desk's crawl, Google's daily URL Inspection, the
 * PageSpeed runs, Bing Webmaster when it has a key, the scheduler and the
 * operator's queue. Nothing here asks Google or anybody else while the page
 * is drawn, except Bing's kept link count (a cached read, no request when it
 * is fresh or there is no key).
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
 * When GA4's referrals were last read: the job's last run if it went well,
 * else its last good run the scheduler still remembers (a week of runs), else
 * the SEO import that brought them in. With none of those, the newest day kept
 * (a date, no hour): how old the newest figure is, never a made-up time.
 */
function referralsAt(span: { to: string }): string {
  const j = engineJob("seo-referrals");
  if (j?.lastOk && j.lastEnd) return j.lastEnd;
  return (
    one("SELECT MAX(ended) AS at FROM cc_runs WHERE job = 'seo-referrals' AND ok = 1") ??
    one("SELECT MAX(at) AS at FROM cc_activity WHERE kind = 'seo-import'") ??
    span.to
  );
}

/** The window GA4 and the drain count in: whole days, ending yesterday. */
const dayWindow = (range: SeoRange): { start: string; end: string } => ({ start: today(-daysOf(range)), end: today(-1) });

/* ---------- tiles --------------------------------------------------------------------------- */

function indexedTile(days: number): Reading<Stat> {
  const a = gsc.access();
  if (a.state !== "ok") return off("gsc", gsc.reasonFor(a), gsc.stepFor(a));
  const ins = latestInspection();
  if (!ins || !ins.rows.length) {
    return waiting("gsc", "Google's URL Inspection of every sitemap address runs once a day (Automations: Inspect sitemap addresses in Google); it has not finished a first round on this desk yet.");
  }
  const indexed = ins.rows.filter((r) => r.indexed).length;
  const of = ins.of ?? ins.rows.length;
  const line = recorded("gsc.indexed", days);
  const stat: Stat = {
    value: indexed,
    previous: line?.previous ?? null,
    unit: "count",
    series: line?.series.length ? line.series : [indexed],
    of,
    sub: `${of - indexed} not indexed`,
  };
  /* When that day's inspections were made: the newest one's own time (the day itself, without an hour, if none is kept). */
  const at = one("SELECT MAX(checked_at) AS at FROM cc_inspect WHERE day = ?", ins.day) ?? ins.day;
  return ok(stat, "gsc", at, `Sitemap addresses Google's URL Inspection reported as indexed on ${ins.day}, checked once a day. Not Search Console's Page indexing total, which no API gives.`);
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

function tilesOf(range: SeoRange, span: SeoSpan | null): OverviewTiles {
  const days = daysOf(range);
  const absent = historyAbsent<never>();
  const t = span ? rankTiles(span) : null;
  if (t) {
    /* The CTR line: a day's rate only where Google showed the site 30 times or more that day; a gap elsewhere. */
    const shown = t.impressions.series;
    t.ctr = { ...t.ctr, series: t.ctr.series.map((v, i) => ((shown[i] ?? 0) >= SMALL ? v : null)) };
  }
  const at = span ? historyAt() : "";
  const note = HISTORY_NOTE;
  return {
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
const actionOf = (r: OpportunityRow): Pick<KeywordOpportunity, "opportunityId" | "actionLabel" | "actionKind" | "step" | "available" | "why" | "state" | "stateNote"> => ({
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
  const cl = new Map(clusters().map((c) => [c.key, c]));
  const rows: KeywordOpportunity[] = picked.map((r) => {
    if (r.type === "near-page-one" && r.subject.keyword) {
      const f = figures.get(r.subject.keyword);
      return {
        phrase: r.subject.keyword,
        lang: kw.find((k) => k.phrase === r.subject.keyword)?.lang ?? null,
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

function topPages(span: SeoSpan | null, view: SiteView): Reading<TopPagesPanel> {
  if (!span) return historyAbsent();
  const figures = pageFigures(span.start, span.end)
    .filter((p) => p.impressions > 0)
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 5);
  if (!figures.length) return waiting("gsc", "Google showed no page of the site in a search in this window.");
  return ok(
    {
      rows: figures.map((f) => ({
        page: pageRef(f.path, view),
        clicks: f.clicks,
        impressions: f.impressions,
        ctr: rate(f.clicks, f.impressions),
        position: f.position,
        trend: pageSeries(f.path, span.start, span.end).map((d) => d.impressions),
      })),
    },
    "gsc",
    historyAt(),
    `${HISTORY_NOTE} Most clicks first, then most impressions.`,
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
    const opp = open.find((r) => r.id === `${c.lang === "de" ? "german-missing" : "keyword-gap"}:${c.key}` && r.action.available);
    return { key: c.key, name: c.name, lang: c.lang, priority: c.priority, coverage: { mapped, of: judged.length }, page: c.page, opportunityId: opp?.id ?? null, rank: c.rank };
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

function technicalPanel(): Reading<TechnicalPanel> {
  const counts = site.issueCounts();
  if (counts.state !== "ok") return counts;
  const by = new Map(counts.value.byRule.map((r) => [r.rule, r.count]));
  const n = (...rules: site.RuleId[]): number => rules.reduce((s, r) => s + (by.get(r) ?? 0), 0);
  const tone = (c: number, bad: boolean): TechnicalRow["tone"] => (c === 0 ? "good" : bad ? "bad" : "warn");
  const rows: TechnicalRow[] = [];

  const ins = latestInspection();
  if (ins && ins.rows.length) {
    const not = ins.rows.filter((r) => !r.indexed).length;
    rows.push({ key: "not-indexed", label: "Not indexed", count: not, tone: tone(not, true), href: "/seo/technical", of: ins.of ?? ins.rows.length, source: "gsc", rule: `Sitemap addresses Google's URL Inspection reported as not indexed on ${ins.day}. Each needs Request indexing by hand in Search Console.`, fix: null });
  }
  const push = (key: string, label: string, rules: site.RuleId[], bad: boolean, rule: string, fix: TechnicalRow["fix"] = null) => {
    const c = n(...rules);
    rows.push({ key, label, count: c, tone: tone(c, bad), href: "/seo/technical", of: null, source: "crawl", rule, fix: c ? fix : null });
  };
  push("noindex", "In the sitemap but noindex", ["page.noindex-in-sitemap"], true, "Sitemap addresses whose live page says noindex, by the crawl.");
  push("broken", "Broken links", ["links.broken"], true, "Links on the site's pages to an address of the site that does not answer, by the crawl.", REDIRECT_FIX);
  push("description", "Missing meta descriptions", ["description.missing"], false, "Pages without a meta description, by the crawl.", METADATA_FIX("Propose descriptions"));
  push("title", "Duplicate titles", ["title.duplicate"], false, "Pages whose title another page also uses, by the crawl.", METADATA_FIX("Propose titles"));
  push("schema", "Missing structured data", ["schema.none", "schema.incomplete", "schema.unreadable"], false, "Pages with no structured data, or structured data missing a required field or not valid JSON, by the crawl.");

  const lab = site.labRuns("mobile");
  if (lab.state === "ok") {
    const measured = lab.value.filter((r) => r.lcpMs !== null);
    const slow = measured.filter((r) => (r.lcpMs ?? 0) > 2500).length;
    if (measured.length) {
      rows.push({ key: "slow", label: "Slow pages (lab LCP > 2.5 s)", count: slow, tone: tone(slow, false), href: "/site-health", of: measured.length, source: "psi", rule: "Pages of the daily PageSpeed test whose mobile lab Largest Contentful Paint is over 2.5 seconds. A lab run on Google's machines, not visitors' field data.", fix: null });
    }
  }
  push("orphan", "Orphan pages", ["links.orphan"], false, "Sitemap pages no other page links to, by the crawl.");
  push("redirects", "Redirect issues", ["redirect.broken", "redirect.chain", "page.redirects"], false, "Promised redirects that do not work, redirects of more than one hop, and sitemap addresses that redirect, by the crawl.");
  push("alt", "Image issues (alt text)", ["images.alt-absent", "images.unnamed-link"], false, "Pictures without an alt attribute and linked pictures with no name, by the crawl.");

  return ok({ rows, crawledAt: site.crawledAt() }, "crawl", counts.asOf, "The desk's crawl by its stated rules (src/cc/site/rules.ts); Google's URL Inspection for the index; PageSpeed's lab for speed.");
}

/* ---------- presence ------------------------------------------------------------------------------------ */

async function presencePanel(range: SeoRange): Promise<Reading<PresencePanel>> {
  const w = dayWindow(range);
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
    const rows = db
      .prepare("SELECT source, SUM(sessions) AS n FROM cc_seo_referrals WHERE day >= ? AND day <= ? AND medium = 'referral' GROUP BY source ORDER BY n DESC")
      .all(w.start, w.end) as { source: string; n: number }[];
    const human = rows.filter((r) => !isAi(r.source, "referral"));
    referrers = ok(
      { start: w.start, end: w.end, total: human.reduce((s, r) => s + r.n, 0), rows: human.slice(0, 5).map((r) => ({ host: r.source, sessions: r.n })) },
      "ga4",
      referralsAt(span),
      "GA4 sessions whose medium is referral, consenting visitors only. AI assistants are counted on AI Search instead.",
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
  };
  return ok(value, "desk", new Date().toISOString());
}

/* ---------- Search Console ------------------------------------------------------------------------------ */

function consolePanel(span: SeoSpan | null): Reading<ConsolePanel> {
  if (!span) return historyAbsent();
  const t = rankTiles(span);
  const a = gsc.access();
  return ok(
    {
      clicks: t.clicks,
      impressions: t.impressions,
      position: t.position,
      days: daySeries(span.start, span.end).map((d) => ({ date: d.date, clicks: d.clicks, impressions: d.impressions })),
      href: a.state === "ok" && a.site ? `https://search.google.com/search-console/performance/search-analytics?resource_id=${encodeURIComponent(a.site)}` : null,
    },
    "gsc",
    historyAt(),
    HISTORY_NOTE,
  );
}

/* ---------- AI search -------------------------------------------------------------------------------------- */

async function aiPanel(range: SeoRange): Promise<Reading<AiPanel>> {
  const w = dayWindow(range);
  const t = tally();
  const span = referralSpan();
  const referrals: AiPanel["referrals"] = !hasKey()
    ? off("ga4", "The desk has no Google service-account key on this machine, so GA4 cannot be asked.")
    : !span
      ? waiting("ga4", "AI assistant visits are read from GA4 once a day (Automations: Read referrals and AI assistant visits from GA4); the first read has not run yet.")
      : ok({ sessions: aiReferrals(w.start, w.end, null).sessions }, "ga4", referralsAt(span), "Sessions from chatgpt.com, perplexity.ai, gemini.google.com, copilot.microsoft.com, claude.ai and you.com, consenting visitors only.");
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

  const phrases = count("SELECT COUNT(*) AS n FROM cc_seo_keywords");
  const relevant = count("SELECT COUNT(*) AS n FROM cc_seo_keywords WHERE status = 'relevant'");
  const nClusters = count("SELECT COUNT(*) AS n FROM cc_seo_clusters");
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

  const ins = latestInspection();
  parts.push(
    ins && ins.rows.length
      ? {
          key: "indexation",
          title: "Indexation",
          line: `${fmt(ins.rows.filter((r) => r.indexed).length)} of ${fmt(ins.of ?? ins.rows.length)} sitemap addresses indexed on ${shortDay(ins.day)}; ${plural(count("SELECT COUNT(*) AS n FROM cc_seo_opps WHERE type = 'not-indexed' AND active = 1 AND state = 'open'"), "address", "addresses")} waiting for Request indexing.`,
          state: "ok",
          source: "gsc",
          href: "/seo/technical",
        }
      : { key: "indexation", title: "Indexation", line: access.state === "ok" ? "The daily URL Inspection has not finished a round yet." : gsc.reasonFor(access), state: access.state === "ok" ? "waiting" : "off", source: "gsc", href: "/seo/technical" },
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

export async function overview(range: SeoRange): Promise<SeoOverviewPayload> {
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

  const [priority, keywords, top, gaps, technical, presence, searchConsole, aiSearch, needsYou] = await Promise.all([
    reading("desk", () => priorityPanel(open)),
    reading("gsc", () => keywordPanel(open)),
    reading("gsc", () => topPages(span, view)),
    reading("desk", () => gapsPanel(view, open)),
    reading("crawl", () => technicalPanel()),
    reading("desk", () => presencePanel(range)),
    reading("gsc", () => consolePanel(span)),
    reading("desk", () => aiPanel(range)),
    reading("desk", () => {
      const rows = ownerTasks(["owner"]);
      if (!rows.length) return waiting<{ open: number; done: number; rows: typeof rows }>("desk", "No owner steps recorded yet: the audit's owner tasks come in with the SEO import (scripts/seo-import.ts).");
      return ok({ open: rows.filter((r) => !r.done).length, done: rows.filter((r) => r.done).length, rows: rows.map(({ whoAll: _w, ...r }) => r) }, "desk", new Date().toISOString(), "Steps only the owner can take: logins, decisions, profiles. Marked done by a person, never by the desk.");
    }),
  ]);

  return {
    head: h,
    tiles: safe(
      { health: site.siteScore(daysOf(range)), indexed: waiting("gsc", "Could not be read."), clicks: historyAbsent(), impressions: historyAbsent(), position: historyAbsent(), ctr: historyAbsent(), ai: waiting("desk", "Could not be read.") },
      () => tilesOf(range, span),
    ),
    priority,
    keywords,
    topPages: top,
    contentGaps: gaps,
    technical,
    presence,
    searchConsole,
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

routes.get("/", async (c) => c.json<SeoOverviewPayload>(await overview(rangeFrom(c))));

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
  const results: OpportunitiesActed["results"] = [];
  const done: OpportunityRow[] = [];
  for (const id of [...new Set(body.ids)]) {
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

const TaskBody = z.object({
  kind: z.enum(["ask", "traffic", "opportunities", "metadata", "redirect", "brief", "audit"]),
  prompt: z.string().max(2000).optional(),
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
  const body = TaskBody.parse(await c.req.json().catch(() => ({})));
  const by = me(c);
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

/** A person marks an owner task done (or open again). The desk never marks one by itself. */
routes.post("/owner", async (c) => {
  const body = OwnerBody.parse(await c.req.json().catch(() => ({})));
  const task = markOwnerTask(body.id, body.done, me(c).name, body.note ?? null);
  if (!task) return c.json({ error: `There is no owner task ${body.id}.` }, 404);
  const { whoAll: _w, ...row } = task;
  return c.json<OwnerTaskAnswer>({ ok: true, task: row });
});
