import { HTTPException } from "hono/http-exception";
import { db } from "../../db.ts";
import type { Person } from "../../people.ts";
import { createTask } from "../operator/queue.ts";
import * as bing from "../search/bing.ts";
import * as gsc from "../search/gsc.ts";
import { addDays } from "../search/shared.ts";
import { abs } from "../site/http.ts";
import { issues as crawlIssues, lastSitemap, LIMITS } from "../site/index.ts";
import { note, record } from "../store.ts";
import type { NewTask, TaskState } from "../../../web/src/contract/operator.ts";
import type {
  Evidence,
  OpportunityAction,
  OpportunityRow,
  OpportunityState,
  OpportunityType,
  Potential,
  Priority,
} from "../../../web/src/contract/seo/common.ts";
import type { SourceId } from "../../../web/src/contract/common.ts";
import type { EngineInput } from "../../../web/src/contract/seo/opportunities.ts";
import { potential, TARGET_POSITION, expectedCtr } from "./ctr.ts";
import { latestInspection, meaningOf, type LatestInspection } from "./indexation.ts";
import { clusters, keywords, remap, shownPages, syncFromSearch, type Keyword } from "./keywords.ts";
import { ownerTasks } from "./owner.ts";
import { historyFrom, lastSnapDay, pageFigures, queryFigures, type Fig } from "./rank.ts";
import { lastRun as readinessRun, pageReadiness, siteReadiness } from "./readiness.ts";
import { capAt, CATCH_ALL, DROP_DAYS, FLOOR, MONEY, PRIORITY_RANK, READ_SHARE, SPEED, TARGET_HELD, TYPE_LABEL, WINDOW_DAYS } from "./rules.ts";
import { ownTitle, pageRef, siteView, type SiteView } from "./site.ts";
import { json, now } from "./tables.ts";
import { answers, normal, pageWords } from "./words.ts";

/**
 * THE OPPORTUNITY ENGINE: one table of everything worth doing, made by the
 * rules in rules.ts from what the desk measured, each with its evidence, its
 * priority and the action that moves it.
 *
 * A RUN NEVER RESETS A PERSON'S DECISION. An opportunity has a stable id
 * ("<type>:<subject>"). A run writes its evidence, priority, potential and
 * action again and leaves its state (open, queued, in progress, done,
 * dismissed, who and when) alone. One the rules no longer find is marked
 * inactive with the reason, its decision kept; found again, it is active
 * again with that same decision. A rule family that could not look (no crawl,
 * no Search Console history) clears nothing.
 *
 * "COULD NOT LOOK" INCLUDES HALF A LOOK. A source that answered for part of
 * the site says nothing about the rest: an index check cut short after
 * seventeen of ninety-eight addresses, a crawl of a site that answered 402, a
 * readiness check whose pages did not load. Each family therefore says what
 * it could read (`engineInputs` prints it on the page), a partial read only
 * replaces what it did read, and a read that failed clears nothing.
 *
 * ACTIONS GO THROUGH PEOPLE. A proposal or a brief is an operator task on the
 * studio workstation's model, and a proposal then waits in the approval queue
 * (src/cc/operator/apply.ts): nothing here changes the live site. Owner,
 * browser and code tasks are a person's to do and to mark.
 */

/** What a rule found, before it is kept. */
export interface Found {
  id: string;
  type: OpportunityType;
  page: string | null;
  keyword: string | null;
  cluster: string | null;
  title: string;
  evidence: Evidence[];
  priority: Priority;
  priorityWhy: string;
  potential: Potential | null;
  action: StoredAction;
  early: boolean;
}

/** The action as kept; whether it can be taken now is worked out when it is read. */
export type StoredAction = Omit<OpportunityAction, "available" | "why">;

const fmt = (n: number): string => n.toLocaleString("en-GB");
const ev = (label: string, value: string | number, source: SourceId, asOf: string | null): Evidence => ({ label, value: typeof value === "number" ? fmt(value) : value, source, asOf });

const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/* `because` may be a finding's own sentence, which ends in its own full stop: one is enough. */
const metadataAction = (path: string, because: string): StoredAction => ({
  kind: "proposal",
  label: "Propose a title and description",
  step: `The operator (the studio workstation's model) writes a new title and description for ${path} ${because.trim().replace(/[.\s]+$/, "")}. They wait in the approval queue (AI Operator › Approvals) and nothing on the live site changes until a person approves.`,
  operator: { kind: "metadata", paths: [path], depth: "deep" },
  ownerTaskId: null,
  href: null,
});

const briefAction = (prompt: string, label = "Write a brief", step?: string): StoredAction => ({
  kind: "brief",
  label,
  step: step ?? "The operator (the studio workstation's model) writes a brief: what the page must answer, its sections and links. A person writes and publishes the page.",
  operator: { kind: "brief", prompt: truncate(prompt.replace(/\s+/g, " ").trim(), 990), depth: "deep" },
  ownerTaskId: null,
  href: null,
});

const codeAction = (step: string, label = "Hand to the website's code"): StoredAction => ({ kind: "code", label, step, operator: null, ownerTaskId: null, href: null });

/* ---------- the rule families ------------------------------------------------------------- */

/**
 * Not indexed: from each address's newest URL Inspection (indexation.ts,
 * `latestInspection`).
 *
 * The daily index check can be cut short: Search Console answers an error
 * after seventeen of ninety-eight addresses, and that day then holds part of
 * the site. Read alone it once said the other eighty-one had left the list,
 * and on 2026-10-03 that cleared 34 of 40 "Not indexed" rows that were still
 * true. `latestInspection` now gives every address its newest result, carried
 * for a week where the newest check did not reach it. What is left is the
 * address it has NO result for: `unknown` names those the sitemap still
 * lists (or any, while the sitemap is not known), and their rows are kept as
 * they are. An address that really left the sitemap is cleared, as before.
 */
function notIndexed(view: SiteView): { found: Found[]; ins: LatestInspection; unknown: (path: string) => boolean } | null {
  const ins = latestInspection();
  if (!ins) return null;
  const have = new Set(ins.rows.map((r) => r.path));
  let listed: Set<string> | null = null;
  try {
    const m = lastSitemap();
    listed = m?.entries.length ? new Set(m.entries.map((e) => e.path)) : null;
  } catch {
    listed = null;
  }
  const unknown = (path: string): boolean => !have.has(path) && (!listed || listed.has(path));
  const out: Found[] = [];
  for (const r of ins.rows) {
    if (r.indexed) continue;
    const p = view.byPath.get(r.path);
    const kind = p?.kind ?? null;
    const live = p ? p.indexable : null;
    const staleNoindex = /noindex/i.test(r.coverage ?? "") && live === true;
    const priority: Priority = staleNoindex || (kind && MONEY.has(kind)) ? "high" : kind === "legal" || kind === "insights" ? "low" : "medium";
    const why = staleNoindex
      ? "High: Google last saw a noindex this page no longer says, so its record is stale."
      : priority === "high"
        ? "High: the page carries the offer (home, service, industry or landing page)."
        : priority === "low"
          ? "Low: a legal or listing page."
          : "Medium: an article, case study or other page.";
    const m = meaningOf(r.coverage, false);
    out.push({
      id: `not-indexed:${r.path}`,
      type: "not-indexed",
      page: r.path,
      keyword: null,
      cluster: null,
      title: `Not in Google's index: ${r.coverage ?? "no reason given"}`,
      evidence: [
        ev("Google's state (URL Inspection)", r.coverage ?? "not indexed", "gsc", r.day),
        ev("Last crawled by Google", r.lastCrawl ? r.lastCrawl.slice(0, 10) : "never", "gsc", r.day),
        ...(live === null ? [] : [ev("The live page says", live ? "index" : "noindex (or does not answer 200)", "crawl", view.at)]),
        ...(r.indexing && r.indexing !== "INDEXING_ALLOWED" ? [ev("Indexing state", r.indexing, "gsc", r.day)] : []),
        ev("What Google means", m.meaning, "gsc", r.day),
      ],
      priority,
      priorityWhy: why,
      potential: null,
      action: {
        kind: "chrome",
        label: "Request indexing",
        step: `In Search Console open URL Inspection for ${abs(r.path)} and press "Request indexing", then mark it submitted here. About ten a day: Google publishes no quota, and each address once.${/noindex/i.test(r.coverage ?? "") ? ' For all the pages excluded by noindex at once: Indexing › Pages › "Excluded by \'noindex\' tag" › Validate fix.' : ""}`,
        operator: null,
        ownerTaskId: null,
        href: r.link,
      },
      early: false,
    });
  }
  return { found: out, ins, unknown };
}

interface SearchContext {
  start: string;
  end: string;
  days: number;
  status: Map<string, { status: string; cluster: string | null; intent: string | null }>;
  shown: Map<string, string>;
  /** The page the keyword table maps a phrase to (the audit's, the rule's or a person's). */
  mapped: Map<string, string>;
  /** Google's figures over the window per phrase as the keyword table spells it (`byPhrase`). */
  figures: Map<string, Fig>;
  /** The page Google showed most for a phrase, by the keyword table's spelling. */
  shownFor: Map<string, string>;
  /** The phrases a person marked as targets in Keywords, with who and when; null when that record cannot be read. */
  targets: Map<string, { by: string; at: string }> | null;
}

/** A query as a title quotes it: the searcher's own quotation marks left out. The screens quote it the same way. */
export const shownQuery = (q: string): string => q.replace(/^["'“”]+|["'“”]+$/g, "").trim() || q;

/**
 * Google's figures per phrase as the keyword table spells it. Search Console
 * reports a search typed inside quotation marks, or with a full stop, as a
 * query of its own, while the keyword table keeps one spelling per phrase
 * (words.ts, `normal`). Looked up by the raw query, such a phrase read as
 * never shown. Here the spellings of one phrase are added, the position
 * weighted by impressions as Search Console combines its own.
 */
export function byPhrase(rows: (Fig & { query: string })[]): Map<string, Fig> {
  const sum = new Map<string, { clicks: number; impressions: number; w: number }>();
  for (const r of rows) {
    const k = normal(r.query);
    const m = sum.get(k) ?? { clicks: 0, impressions: 0, w: 0 };
    m.clicks += r.clicks;
    m.impressions += r.impressions;
    m.w += (r.position ?? 0) * r.impressions;
    sum.set(k, m);
  }
  return new Map([...sum].map(([k, m]) => [k, { clicks: m.clicks, impressions: m.impressions, position: m.impressions ? Math.round((m.w / m.impressions) * 10) / 10 : null }]));
}

/**
 * The phrases a person marked as targets. The mark is the Keywords page's own
 * record (cc_seo_kw_targets, made by src/cc/routes/seo/keywords.ts); on a desk
 * where that page never loaded there is no such table, and the engine then
 * says it could not look rather than that nobody has a target.
 */
function targetPhrases(kw: Keyword[]): Map<string, { by: string; at: string }> | null {
  try {
    const phrase = new Map(kw.map((k) => [k.id, k.phrase]));
    const out = new Map<string, { by: string; at: string }>();
    for (const r of db.prepare("SELECT keyword_id, by, at FROM cc_seo_kw_targets").all() as { keyword_id: number; by: string; at: string }[]) {
      const p = phrase.get(r.keyword_id);
      if (p) out.set(p, { by: r.by, at: r.at });
    }
    return out;
  } catch {
    return null;
  }
}

function searchContext(): SearchContext | null {
  const end = lastSnapDay();
  if (!end) return null;
  const start = addDays(end, -(WINDOW_DAYS - 1));
  const kw = keywords();
  const cl = new Map(clusters().map((c) => [c.key, c]));
  const shown = shownPages(start, end);
  /* Two spellings of one phrase can show on two pages: the first one read is kept. */
  const shownFor = new Map<string, string>();
  for (const [q, path] of shown) if (!shownFor.has(normal(q))) shownFor.set(normal(q), path);
  return {
    start,
    end,
    days: WINDOW_DAYS,
    status: new Map(kw.map((k) => [k.phrase, { status: k.status, cluster: k.cluster, intent: (k.cluster ? cl.get(k.cluster)?.intent : null) ?? k.intent }])),
    shown,
    mapped: new Map(kw.filter((k) => k.page).map((k) => [k.phrase, k.page!])),
    figures: byPhrase(queryFigures(start, end)),
    shownFor,
    targets: targetPhrases(kw),
  };
}

const COMMERCIAL = new Set(["commercial", "transactional", "local"]);

/** Near page one: queries at average position 4 to 20, with early signals while the window is young. */
function nearPageOne(ctx: SearchContext, view: SiteView): Found[] {
  const all = queryFigures(ctx.start, ctx.end);
  const ranked = all.filter((q) => q.position !== null && q.position >= 4 && q.position <= 20);
  const early = gsc.isEarly(ranked, all, FLOOR.nearPageOne);
  const floor = early ? 1 : FLOOR.nearPageOne;
  const out: Found[] = [];
  for (const q of ranked) {
    if (q.impressions < floor) continue;
    const k = ctx.status.get(normal(q.query));
    if (k?.status === "irrelevant") continue;
    const isEarly = q.impressions < FLOOR.nearPageOne;
    let priority: Priority = k?.status === "relevant" && k.intent && COMMERCIAL.has(k.intent) ? "high" : k?.status === "relevant" ? "medium" : "low";
    if (isEarly) priority = capAt(priority, "medium");
    /* A person's own choice outranks the rule's caution: a target is high, early or not. */
    const target = ctx.targets?.get(normal(q.query)) ?? null;
    if (target) priority = "high";
    const page = ctx.shown.get(q.query) ?? null;
    const p = page ? view.byPath.get(page) : undefined;
    const titled = p ? answers(q.query, pageWords({ path: p.path, title: p.title, h1: p.h1 })) : false;
    /* A new title is proposed only for a page that carries the offer and is not the home page: the
       home page is not retitled for one query, and a page about something else needs a brief. */
    const retitle = !!(page && p && p.path !== "/" && MONEY.has(p.kind) && !titled);
    const mapped = ctx.mapped.get(normal(q.query)) ?? null;
    out.push({
      id: `near-page-one:${q.query}`,
      type: "near-page-one",
      page,
      keyword: q.query,
      cluster: k?.cluster ?? null,
      title: `“${shownQuery(q.query)}” at position ${q.position} in Google`,
      evidence: [
        ev(`Impressions (Search Console, ${ctx.days} days)`, q.impressions, "gsc", ctx.end),
        ev("Clicks", q.clicks, "gsc", ctx.end),
        ev("Average position", String(q.position), "gsc", ctx.end),
        ...(page ? [ev("The page Google shows", page, "gsc", ctx.end)] : []),
        ev("The phrase is", k ? `${k.status}${k.cluster ? `, cluster ${k.cluster}` : ""}` : "not yet in the keyword table", "desk", null),
        ...(target ? [ev("Marked as a target", `by ${target.by}, ${target.at.slice(0, 10)}`, "desk", target.at)] : []),
      ],
      priority,
      priorityWhy:
        (target
          ? "High: a person marked the phrase as a target in Keywords."
          : priority === "high"
            ? "High: a relevant phrase with commercial intent."
            : priority === "medium"
              ? k?.status === "relevant"
                ? "Medium: a relevant phrase."
                : "Medium at most: an early signal."
              : "Low: the phrase is not yet judged relevant.") +
        (isEarly ? ` Early signal: shown ${q.impressions} time${q.impressions === 1 ? "" : "s"}, under the standard floor of ${FLOOR.nearPageOne}.` : ""),
      potential: potential({ impressions: q.impressions, clicks: q.clicks, days: ctx.days, target: TARGET_POSITION }),
      action: retitle
        ? metadataAction(page!, `so that its title answers “${shownQuery(q.query)}”`)
        : briefAction(
            `Strengthen ${mapped && mapped !== page ? `${mapped} (the page that answers it; Google shows ${page ?? "no single page"})` : (page ?? "the page that should answer it")} for the search “${shownQuery(q.query)}” (Google average position ${q.position}, ${q.impressions} impressions in ${ctx.days} days): what the page must answer for that search, the sections to add, and the internal links that point to it.`,
          ),
      early: isEarly,
    });
  }
  return out;
}

/** Low CTR: clicks under half of what our curve expects at the page's position. */
function lowCtr(ctx: SearchContext, view: SiteView): Found[] {
  const out: Found[] = [];
  for (const f of pageFigures(ctx.start, ctx.end)) {
    if (f.position === null || f.position > 20 || !f.impressions) continue;
    const expected = (f.impressions * expectedCtr(f.position)) / 100;
    if (expected < FLOOR.ctrExpected || f.clicks >= expected / 2) continue;
    const p = view.byPath.get(f.path);
    const priority: Priority = p && MONEY.has(p.kind) ? "high" : "medium";
    out.push({
      id: `low-ctr:${f.path}`,
      type: "low-ctr",
      page: f.path,
      keyword: null,
      cluster: null,
      title: `${f.clicks} click${f.clicks === 1 ? "" : "s"} where our curve expects ${expected.toFixed(1)} at position ${f.position}`,
      evidence: [
        ev(`Impressions (Search Console, ${ctx.days} days)`, f.impressions, "gsc", ctx.end),
        ev("Clicks", f.clicks, "gsc", ctx.end),
        ev("Average position", String(f.position), "gsc", ctx.end),
        ev("Our curve expects (our assumption)", `${expectedCtr(f.position)}% of impressions`, "none", null),
      ],
      priority,
      priorityWhy: priority === "high" ? "High: the page carries the offer." : "Medium: another page.",
      potential: potential({ impressions: f.impressions, clicks: f.clicks, days: ctx.days, target: Math.max(1, Math.round(f.position)) }),
      action: metadataAction(f.path, "that make a searcher choose it at its position"),
      early: false,
    });
  }
  return out;
}

/** Ranking drops: two windows of 14 days, both shown at least 30 times. Null when the history does not reach back two windows. */
function rankingDrops(ctx: SearchContext, view: SiteView): Found[] | null {
  const from = historyFrom();
  const aStart = addDays(ctx.end, -(DROP_DAYS - 1));
  const bEnd = addDays(aStart, -1);
  const bStart = addDays(bEnd, -(DROP_DAYS - 1));
  if (!from || from > bStart) return null;
  const out: Found[] = [];
  const before = new Map(queryFigures(bStart, bEnd).map((q) => [q.query, q]));
  for (const q of queryFigures(aStart, ctx.end)) {
    const b = before.get(q.query);
    if (!b || q.position === null || b.position === null) continue;
    if (q.impressions < FLOOR.drop || b.impressions < FLOOR.drop || q.position - b.position < FLOOR.dropBy) continue;
    const k = ctx.status.get(normal(q.query));
    if (k?.status === "irrelevant") continue;
    const priority: Priority = k?.status === "relevant" && k.intent && COMMERCIAL.has(k.intent) ? "high" : "medium";
    out.push({
      id: `ranking-drop:${q.query}`,
      type: "ranking-drop",
      page: ctx.shown.get(q.query) ?? null,
      keyword: q.query,
      cluster: k?.cluster ?? null,
      title: `“${shownQuery(q.query)}” fell from ${b.position} to ${q.position}`,
      evidence: [
        ev(`Position, ${bStart} to ${bEnd}`, String(b.position), "gsc", bEnd),
        ev(`Position, ${aStart} to ${ctx.end}`, String(q.position), "gsc", ctx.end),
        ev("Impressions then → now", `${b.impressions} → ${q.impressions}`, "gsc", ctx.end),
      ],
      priority,
      priorityWhy: priority === "high" ? "High: a relevant phrase with commercial intent." : "Medium: another phrase.",
      potential: potential({ impressions: q.impressions, clicks: q.clicks, days: DROP_DAYS, target: Math.max(1, Math.round(b.position)) }),
      action: briefAction(`Investigate why “${shownQuery(q.query)}” fell from position ${b.position} to ${q.position} in Google over two weeks, for ${ctx.shown.get(q.query) ?? "the page Google shows"}: what changed on the page, which pages now outrank it, what to fix.`, "Investigate"),
      early: false,
    });
  }
  const pagesBefore = new Map(pageFigures(bStart, bEnd).map((p) => [p.path, p]));
  for (const p of pageFigures(aStart, ctx.end)) {
    const b = pagesBefore.get(p.path);
    if (!b || p.position === null || b.position === null) continue;
    if (p.impressions < FLOOR.drop || b.impressions < FLOOR.drop || p.position - b.position < FLOOR.dropBy) continue;
    const page = view.byPath.get(p.path);
    out.push({
      id: `ranking-drop:page:${p.path}`,
      type: "ranking-drop",
      page: p.path,
      keyword: null,
      cluster: null,
      title: `${p.path} fell from ${b.position} to ${p.position}`,
      evidence: [ev(`Position, ${bStart} to ${bEnd}`, String(b.position), "gsc", bEnd), ev(`Position, ${aStart} to ${ctx.end}`, String(p.position), "gsc", ctx.end), ev("Impressions then → now", `${b.impressions} → ${p.impressions}`, "gsc", ctx.end)],
      priority: page && MONEY.has(page.kind) ? "high" : "medium",
      priorityWhy: page && MONEY.has(page.kind) ? "High: the page carries the offer." : "Medium: another page.",
      potential: potential({ impressions: p.impressions, clicks: p.clicks, days: DROP_DAYS, target: Math.max(1, Math.round(b.position)) }),
      action: briefAction(`Investigate why ${p.path} fell from average position ${b.position} to ${p.position} in Google over two weeks: what changed, which queries moved, what to fix.`, "Investigate"),
      early: false,
    });
  }
  return out;
}

/** Gaps: clusters with no page of their language. */
function gaps(ctx: SearchContext | null): Found[] {
  const kw = keywords();
  const figures = ctx?.figures ?? new Map<string, Fig>();
  const out: Found[] = [];
  for (const c of clusters()) {
    if (c.page) continue;
    /* A catch-all group of leftover phrases is not a topic: no one page could answer "Unclustered". */
    if (CATCH_ALL.test(c.key)) continue;
    const phrases = kw.filter((k) => k.cluster === c.key);
    const relevant = phrases.filter((k) => k.status === "relevant");
    /* A cluster none of whose phrases is judged relevant is not demand the site should answer. */
    if (!relevant.length) continue;
    let impressions = 0;
    let clicks = 0;
    for (const k of phrases) {
      const f = figures.get(k.phrase);
      if (f) {
        impressions += f.impressions;
        clicks += f.clicks;
      }
    }
    const german = c.lang === "de";
    const type: OpportunityType = german ? "german-missing" : "keyword-gap";
    const examples = (relevant.length ? relevant.map((k) => k.phrase) : c.examples).slice(0, 8);
    out.push({
      id: `${type}:${c.key}`,
      type,
      page: null,
      keyword: null,
      cluster: c.key,
      title: german ? `No German page for “${c.name}”` : `No page answers “${c.name}”`,
      evidence: [
        ev("Relevant phrases in the cluster", relevant.length, "desk", null),
        ...(examples.length ? [ev("People search for", examples.slice(0, 3).join("; "), "desk", null)] : []),
        ...(impressions ? [ev(`Impressions of its phrases (Search Console, ${ctx?.days ?? WINDOW_DAYS} days)`, impressions, "gsc", ctx?.end ?? null)] : []),
        ...(c.pageSaid ? [ev("The audit said", c.pageSaid, "desk", null)] : []),
        ...(german ? [ev("The site's languages", "English only", "crawl", null)] : []),
      ],
      priority: c.priority,
      priorityWhy: `${c.priority[0]!.toUpperCase()}${c.priority.slice(1)}: the cluster's priority, the audit's judgement of whether a young site can win it${c.rank ? ` (its order of attack: ${c.rank})` : ""}.`,
      potential: ctx && impressions ? potential({ impressions, clicks, days: ctx.days, target: TARGET_POSITION }) : null,
      action: briefAction(
        `${german ? "A German (de-CH) page, written for Swiss readers, for" : "A new page for"} the searches “${c.name}”. ${c.action ?? ""} Phrases people search: ${examples.join("; ")}.`,
        "Create brief",
        `The operator (the studio workstation's model) writes the brief for a new ${german ? "German " : ""}page: the question it answers, its sections, the facts it needs from the studio and its links. A person writes and publishes the page.`,
      ),
      early: false,
    });
  }
  return out;
}

/** Target phrases: what a person marked in Keywords and the site holds no top position for. Null when the marks cannot be read. */
function targeted(ctx: SearchContext, listed: ReadonlySet<string>): Found[] | null {
  if (!ctx.targets) return null;
  const out: Found[] = [];
  for (const [phrase, mark] of ctx.targets) {
    /* "Near page one" lists it already, as high: one row for one search. */
    if (listed.has(phrase)) continue;
    const f = ctx.figures.get(phrase);
    const position = f?.impressions ? f.position : null;
    if (position !== null && position <= TARGET_HELD) continue;
    const k = ctx.status.get(phrase);
    const shown = f?.impressions ? (ctx.shownFor.get(phrase) ?? null) : null;
    const mapped = ctx.mapped.get(phrase) ?? null;
    const page = shown ?? mapped;
    out.push({
      id: `target:${phrase}`,
      type: "keyword-gap",
      page,
      keyword: phrase,
      cluster: k?.cluster ?? null,
      title: position === null ? `Target “${phrase}”: Google has not shown the site for it` : `Target “${phrase}”: at position ${position}${position > 20 ? ", beyond the second page" : ""}`,
      evidence: [
        ev("Marked as a target", `by ${mark.by}, ${mark.at.slice(0, 10)}`, "desk", mark.at),
        ...(f?.impressions
          ? [ev(`Impressions (Search Console, ${ctx.days} days)`, f.impressions, "gsc", ctx.end), ev("Clicks", f.clicks, "gsc", ctx.end), ev("Average position", String(position), "gsc", ctx.end)]
          : [ev(`Shown by Google (Search Console, ${ctx.days} days)`, "not once", "gsc", ctx.end)]),
        shown
          ? ev("The page Google shows", shown, "gsc", ctx.end)
          : mapped
            ? ev("The page that answers it (keyword table)", mapped, "desk", null)
            : ev("A page that answers it", "none: no page's title, heading or address carries its words", "desk", null),
      ],
      priority: "high",
      priorityWhy: "High: a person marked the phrase as a target in Keywords.",
      potential: f?.impressions ? potential({ impressions: f.impressions, clicks: f.clicks, days: ctx.days, target: TARGET_POSITION }) : null,
      action: page
        ? briefAction(
            `Strengthen ${page} for the search “${phrase}” (${position === null ? "Google has not shown the site for it" : `Google average position ${position}, ${f!.impressions} impressions`} in ${ctx.days} days): what the page must answer for that search, the sections to add, and the internal links that point to it.`,
          )
        : briefAction(
            `A new page for the search “${phrase}”: no page of the site answers it yet. The question it answers, its sections, the facts it needs from the studio and its links.`,
            "Create brief",
            "The operator (the studio workstation's model) writes the brief for a new page: the question it answers, its sections, the facts it needs from the studio and its links. A person writes and publishes the page.",
          ),
      early: false,
    });
  }
  return out;
}

/** What the newest crawl could read of the sitemap's pages. */
export interface CrawlRead {
  listed: number;
  answered: number;
  /** What most of the pages that did not answer 200 answered; 0: nothing at all; null: every page answered. */
  mostly: number | null;
  /** False when under READ_SHARE of the listed pages answered 200: the site was down or refusing. */
  readable: boolean;
}

export function crawlRead(view: SiteView): CrawlRead {
  const listed = view.pages.filter((p) => p.inSitemap);
  const answered = listed.filter((p) => p.status === 200).length;
  const tally = new Map<number, number>();
  for (const p of listed) if (p.status !== 200) tally.set(p.status, (tally.get(p.status) ?? 0) + 1);
  const mostly = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { listed: listed.length, answered, mostly, readable: !listed.length || answered >= listed.length * READ_SHARE };
}

const answeredAs = (status: number | null): string => (status === null ? "nothing" : status === 0 ? "nothing at all" : `HTTP ${status}`);

/**
 * The one row a crawl of a site that does not answer makes. Its page-by-page
 * findings would be the same outage once per page, and what it could not
 * read proves nothing fixed, so the crawl family then adds this row and
 * neither adds nor clears anything else.
 */
function unreadable(view: SiteView, read: CrawlRead): Found {
  const said = answeredAs(read.mostly);
  /* 401, 402 and 403 are the hosting account's answers (a payment, a protection), not the code's. */
  const account = read.mostly === 401 || read.mostly === 402 || read.mostly === 403;
  const step = account
    ? `The website answers ${said}${read.mostly === 402 ? " (payment required: the hosting plan)" : ""} instead of its pages. Sign in to the hosting account and put the deployment back in service. The next crawl reads the site again and this row clears by itself.`
    : `The website answers ${said} instead of its pages. Find the failing deployment or route (the website's repository, the hosting dashboard) and put the site back. The next crawl reads it again and this row clears by itself.`;
  return {
    id: "technical:site.unreadable:site",
    type: "technical",
    page: null,
    keyword: null,
    cluster: null,
    title: `The website did not answer the desk's crawl: ${read.answered} of ${read.listed} sitemap pages answered 200`,
    evidence: [
      ev("Sitemap pages that answered 200", `${read.answered} of ${read.listed}`, "crawl", view.at),
      ev("Most of the others answered", said, "crawl", view.at),
      ev("Meanwhile", "The crawl's earlier findings are kept as they were: a site that does not answer proves none of them fixed.", "desk", null),
    ],
    priority: "high",
    priorityWhy: "High: while the site does not answer, visitors and Google get the same refusal, and nothing the crawl found can be checked.",
    potential: null,
    action: account ? { kind: "owner", label: "Needs the owner", step, operator: null, ownerTaskId: null, href: null } : codeAction(step, "Put the site back"),
    early: false,
  };
}

/** The crawl's findings: thin pages, technical findings, pages few others link to. */
function crawled(view: SiteView): { thin: Found[]; technical: Found[]; links: Found[]; read: CrawlRead } | null {
  if (!view.at) return null;
  const all = crawlIssues();
  if (all.state !== "ok") return null;
  const read = crawlRead(view);
  if (!read.readable) return { thin: [], technical: [unreadable(view, read)], links: [], read };
  const thin: Found[] = [];
  const technical: Found[] = [];
  const links: Found[] = [];
  for (const f of all.value) {
    const p = f.path ? view.byPath.get(f.path) : undefined;
    if (f.rule === "content.thin") {
      if (!p || !p.inSitemap || p.kind === "legal") continue;
      const money = MONEY.has(p.kind);
      thin.push({
        id: `thin-content:${f.path}`,
        type: "thin-content",
        page: f.path,
        keyword: null,
        cluster: null,
        title: `Thin page: ${f.measured ?? "?"} words of its own`,
        evidence: [ev("Words of own content (the crawl)", String(f.measured ?? "?"), "crawl", view.at), ev("The desk's yardstick", `${LIMITS.thinWords} words`, "crawl", null)],
        priority: money ? "medium" : "low",
        priorityWhy: money ? "Medium: the page carries the offer." : "Low: another page.",
        potential: null,
        action: briefAction(`Expand ${f.path} (“${ownTitle(p.title) ?? f.path}”, ${f.measured ?? "few"} words of its own): what a client needs answered there, the sections to add, the proof and the links.`),
        early: false,
      });
      continue;
    }
    if (f.rule === "links.orphan") continue;
    if (f.severity === "opportunity") continue;
    const meta = f.rule.startsWith("title.") || f.rule.startsWith("description.");
    technical.push({
      id: `technical:${f.rule}:${f.path ?? "site"}`,
      type: "technical",
      page: f.path,
      keyword: null,
      cluster: null,
      title: `${f.title}${f.path ? "" : " (site)"}`,
      evidence: [ev("The crawl found", f.text, "crawl", view.at), ...(f.measured !== null ? [ev("Measured", String(f.measured), "crawl", view.at)] : []), ...(f.limit !== null ? [ev("Against", String(f.limit), "crawl", null)] : [])],
      priority: f.severity === "critical" ? "high" : "medium",
      priorityWhy: f.severity === "critical" ? "High: a critical finding of the crawl's rules." : "Medium: a warning of the crawl's rules.",
      potential: null,
      action: meta && f.path && p?.status === 200 ? metadataAction(f.path, `to fix: ${f.text}`) : codeAction(`${f.text} Fix it in the website's repository; the next crawl checks it.`),
      early: false,
    });
  }
  const orphans = new Set(all.value.filter((f) => f.rule === "links.orphan" && f.path).map((f) => f.path as string));
  for (const p of view.pages) {
    if (!p.inSitemap || p.status !== 200 || !MONEY.has(p.kind) || p.path === "/") continue;
    const orphan = orphans.has(p.path) || p.inlinks === 0;
    if (!orphan && p.inlinksFromContent > 0) continue;
    links.push({
      id: `internal-links:${p.path}`,
      type: "internal-links",
      page: p.path,
      keyword: null,
      cluster: null,
      title: orphan ? "No page links here" : "Linked only from the menu and footer",
      evidence: [ev("Pages linking here", p.inlinks, "crawl", view.at), ev("Of them from their own content", p.inlinksFromContent, "crawl", view.at)],
      priority: orphan ? "high" : "medium",
      priorityWhy: orphan ? "High: nothing links to it at all." : "Medium: only the menu and footer link to it.",
      potential: null,
      action: codeAction(`Link to ${p.path} (“${ownTitle(p.title) ?? p.path}”) from the text of two or three related pages (its hub, its neighbours), with words that say what it is.`, "Add internal links"),
      early: false,
    });
  }
  return { thin, technical, links, read };
}

/** How many pages the readiness check asked for and how many it could judge. */
export function readinessRead(): { asked: number; judged: number; read: boolean } {
  try {
    const r = db
      .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN json_valid(json) AND json_extract(json, '$.checks') IS NOT NULL THEN 1 ELSE 0 END), 0) AS judged FROM cc_seo_readiness")
      .get() as { n: number; judged: number };
    return { asked: r.n, judged: r.judged, read: r.n > 0 && r.judged >= r.n * READ_SHARE };
  } catch {
    return { asked: 0, judged: 0, read: false };
  }
}

/** A file the check asked the site for answered when it is there (200) or plainly absent (404, 410); anything else is the site refusing. A value kept before the status was recorded is taken as answered. */
const fileAnswered = (status: number | undefined): boolean => status === undefined || status === 200 || status === 404 || status === 410;

/**
 * AI readiness: pages without a direct answer or questions, and the failed
 * site-wide checks the website's code fixes. `pages` says how many pages the
 * check could judge: when the site did not answer it, a page's missing row
 * is no proof its answer was written. `unanswered` names the site-wide checks
 * whose file (robots.txt, llms.txt) the site refused to give: a refusal reads
 * as "blocks every crawler", which it is not.
 */
function readiness(ctx: SearchContext | null): { found: Found[]; pages: { asked: number; judged: number; read: boolean }; unanswered: string[] } | null {
  const pages = pageReadiness();
  const site = siteReadiness();
  if (!pages.checkedAt && !site) return null;
  const shown = ctx ? new Set(pageFigures(ctx.start, ctx.end).filter((f) => f.impressions > 0).map((f) => f.path)) : new Set<string>();
  const out: Found[] = [];
  for (const p of pages.pages) {
    const fails = p.checks.filter((c) => (c.key === "answer" || c.key === "faq" || c.key === "faq-schema") && c.state === "fail");
    if (!fails.some((c) => c.key === "answer" || c.key === "faq")) continue;
    const priority: Priority = shown.has(p.path) ? "high" : "medium";
    out.push({
      id: `missing-answer:${p.path}`,
      type: "missing-answer",
      page: p.path,
      keyword: null,
      cluster: null,
      title: fails.map((c) => c.label).join(", "),
      evidence: fails.map((c) => ev(c.label, c.detail, "crawl", pages.checkedAt)),
      priority,
      priorityWhy: priority === "high" ? "High: Google already shows the page." : "Medium: a page that carries the offer.",
      potential: null,
      action: briefAction(
        `Write the direct answer for the top of ${p.path} (“${ownTitle(p.title) ?? p.path}”): 50 to 100 words that answer the page's question for a Swiss client, naming Balkaris and Zürich; then five to eight questions clients ask, each with a short, specific answer. Use only what the page and the studio can stand behind.`,
        "Write the answer and FAQ",
      ),
      early: false,
    });
  }
  const WEIGHT: Record<string, Priority> = { robots: "high", lastmod: "medium", llms: "low" };
  const unanswered: string[] = [];
  for (const c of site?.checks ?? []) {
    if (!WEIGHT[c.key]) continue;
    if (!fileAnswered(c.key === "robots" ? site?.robots?.status : c.key === "llms" ? site?.llms?.status : 200)) {
      unanswered.push(c.key);
      continue;
    }
    if (c.state !== "fail" || c.who !== "code") continue;
    out.push({
      id: `technical:site:${c.key}`,
      type: "technical",
      page: null,
      keyword: null,
      cluster: null,
      title: c.label,
      evidence: [ev("The check read", c.detail, "crawl", site?.at ?? null)],
      priority: WEIGHT[c.key]!,
      priorityWhy: `${WEIGHT[c.key]![0]!.toUpperCase()}${WEIGHT[c.key]!.slice(1)}: the stated weight of this site-wide check (src/cc/seo/engine.ts).`,
      potential: null,
      action: codeAction(c.fix ?? c.detail),
      early: false,
    });
  }
  return { found: out, pages: readinessRead(), unanswered };
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/** The newest day a mobile speed test measured a page, or null before the first. */
function speedDay(): string | null {
  try {
    return (db.prepare("SELECT MAX(day) AS d FROM cc_vitals WHERE strategy = 'mobile' AND lcp_ms IS NOT NULL").get() as { d: string | null }).d;
  } catch {
    return null;
  }
}

/**
 * Slow pages: PageSpeed Insights' mobile lab runs the desk keeps (cc_vitals,
 * src/cc/site/psi.ts). A page is listed when its newest run is slow by
 * rules.ts SPEED and, when there is a run before it, that one was slow too:
 * one lab run varies, two in a row are a finding. Pages whose last run is
 * older than a week before the newest are no longer among those tested.
 */
function slow(view: SiteView): Found[] | null {
  const newest = speedDay();
  if (!newest) return null;
  type Run = { day: string; path: string; performance: number | null; lcp_ms: number };
  const rows = db
    .prepare("SELECT day, path, performance, lcp_ms FROM cc_vitals WHERE strategy = 'mobile' AND lcp_ms IS NOT NULL AND day >= ? ORDER BY day DESC, id DESC")
    .all(addDays(newest, -SPEED.freshDays)) as Run[];
  /* Per page its newest measured run of each day, newest day first. */
  const by = new Map<string, Run[]>();
  for (const r of rows) {
    const list = by.get(r.path) ?? [];
    if (list.at(-1)?.day !== r.day) list.push(r);
    by.set(r.path, list);
  }
  const isSlow = (r: Run): boolean => r.lcp_ms > SPEED.lcpMs || (r.performance !== null && r.performance < SPEED.performance);
  const out: Found[] = [];
  for (const [path, runs] of by) {
    const now = runs[0]!;
    const before = runs[1] ?? null;
    if (!isSlow(now) || (before && !isSlow(before))) continue;
    const p = view.byPath.get(path);
    const money = !!p && MONEY.has(p.kind);
    out.push({
      id: `technical:speed:${path}`,
      type: "technical",
      page: path,
      keyword: null,
      cluster: null,
      title: `Slow on a phone: the largest element paints after ${seconds(now.lcp_ms)} in Google's lab test`,
      evidence: [
        ev("Largest Contentful Paint (mobile lab run)", seconds(now.lcp_ms), "psi", now.day),
        ...(now.performance !== null ? [ev("Lighthouse performance score (mobile)", `${Math.round(now.performance)} of 100`, "psi", now.day)] : []),
        ...(before ? [ev("The run before", `${seconds(before.lcp_ms)}${before.performance !== null ? `, score ${Math.round(before.performance)}` : ""}`, "psi", before.day)] : []),
        ev("Lighthouse's band", `over ${SPEED.lcpMs / 1000} s is poor. A lab value from a throttled phone on Google's machines, not what visitors had`, "psi", null),
      ],
      priority: money ? "high" : "medium",
      priorityWhy: money ? "High: the page carries the offer." : "Medium: another page.",
      potential: null,
      action: {
        ...codeAction(
          `Make ${path} paint its largest element sooner on a phone. PageSpeed Insights' report names the element (usually the first picture or video) and what delays it. Fix it in the website's repository; the desk's next daily speed test checks it.`,
          "Speed up the page",
        ),
        href: `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(abs(path))}&form_factor=mobile`,
      },
      early: false,
    });
  }
  return out;
}

/** Topics a rule measures itself: the audit's own task for them is not added twice. */
const MEASURED = new Set(["sitemap-lastmod", "llms-txt", "gsc-request-indexing"]);

const AUDIT_TYPE: [RegExp, OpportunityType][] = [
  [/^german-/, "german-missing"],
  [/^(answer-fields|service-answers|price-ranges|faq-schema)$/, "missing-answer"],
  [/^(about-page|hubs-copy)$/, "thin-content"],
  [/^(insights-bylines|data-piece|bylined-articles|youtube|off-site-presence|crawl-demand|brave-submit)$/, "entity"],
  [/^(ai-answer-pages|wedding-page)$/, "keyword-gap"],
];

/** The owner's tasks, the lead's browser steps and the audit's code and content changes. */
function audited(): Found[] {
  const out: Found[] = [];
  for (const t of ownerTasks(["owner", "lead-chrome", "code", "content"])) {
    if (t.done || MEASURED.has(t.id)) continue;
    const evidence = [ev("Why", t.why || "As the audit said.", "desk", null), ev("From", t.from, "desk", null)];
    if (t.whoAll === "owner") {
      out.push({
        id: `entity:${t.id}`,
        type: "entity",
        page: null,
        keyword: null,
        cluster: null,
        title: t.title,
        evidence,
        priority: t.impact,
        priorityWhy: `${t.impact[0]!.toUpperCase()}${t.impact.slice(1)}: the audit's impact judgement.`,
        potential: null,
        action: { kind: "owner", label: "Needs the owner", step: t.step, operator: null, ownerTaskId: t.id, href: null },
        early: false,
      });
      continue;
    }
    const type = AUDIT_TYPE.find(([re]) => re.test(t.id))?.[1] ?? (/\bgerman\b|\bde-ch\b/i.test(t.title) ? "german-missing" : t.whoAll === "content" ? "keyword-gap" : "technical");
    const action: StoredAction =
      t.whoAll === "lead-chrome"
        ? { kind: "chrome", label: "Do it in the owner's browser", step: t.step, operator: null, ownerTaskId: t.id, href: null }
        : t.whoAll === "content"
          ? briefAction(t.step, "Write a brief")
          : codeAction(t.step);
    out.push({
      id: `audit:${t.id}`,
      type,
      page: null,
      keyword: null,
      cluster: null,
      title: t.title,
      evidence,
      priority: t.impact,
      priorityWhy: `${t.impact[0]!.toUpperCase()}${t.impact.slice(1)}: the audit's impact judgement.`,
      potential: null,
      action,
      early: false,
    });
  }
  return out;
}

/* ---------- keeping what was found -------------------------------------------------------- */

const CLEARED: Partial<Record<OpportunityType, string>> = {
  "not-indexed": "Google's URL Inspection reports it indexed now, or it left the sitemap.",
  "near-page-one": "The query is no longer at position 4 to 20 over the window, or no longer reaches the floor.",
  "low-ctr": "Its clicks are no longer under half of our curve's expectation.",
  "ranking-drop": "The drop is no longer measured between the last two windows.",
  "keyword-gap": "A page now answers the cluster, or none of its phrases is judged relevant any more.",
  "german-missing": "A German page now answers the cluster, or none of its phrases is judged relevant any more.",
  "thin-content": "The crawl no longer finds the page thin.",
  "missing-answer": "The readiness check now passes.",
  technical: "The check or the crawl no longer finds it.",
  "internal-links": "Other pages link to it from their content now.",
  entity: "Its owner task was marked done, or the audit no longer lists it.",
};

/** The rule family an opportunity's id belongs to: what must have looked before it may be cleared. */
export type Family = "index" | "search" | "drops" | "clusters" | "crawl" | "readiness" | "audit" | "speed" | "targets";

export function familyOf(id: string): Family {
  if (id.startsWith("not-indexed:")) return "index";
  if (id.startsWith("near-page-one:") || id.startsWith("low-ctr:")) return "search";
  if (id.startsWith("ranking-drop:")) return "drops";
  if (id.startsWith("target:")) return "targets";
  if (id.startsWith("keyword-gap:") || id.startsWith("german-missing:")) return "clusters";
  if (id.startsWith("missing-answer:") || id.startsWith("technical:site:")) return "readiness";
  if (id.startsWith("technical:speed:")) return "speed";
  if (id.startsWith("audit:") || id.startsWith("entity:")) return "audit";
  return "crawl";
}

/** Why one opportunity was cleared, where its type's sentence would not be true of it. */
function clearedWhy(id: string): string | null {
  if (id.startsWith("technical:speed:")) return "Its newest mobile speed test is no longer slow, or the page is no longer among those tested.";
  if (id.startsWith("target:")) return `The site holds a top-${TARGET_HELD} position for it now, “near page one” lists it, or it is no longer marked as a target.`;
  if (id === "technical:site.unreadable:site") return "The crawl reads the site again.";
  if (/^(keyword-gap|german-missing):/.test(id) && CATCH_ALL.test(id.replace(/^[^:]+:/, ""))) return "A catch-all group of leftover phrases is not one topic a page could answer: the list no longer makes a gap of it.";
  return null;
}

/**
 * Write what the rules found; clear (never delete) what they no longer find,
 * only for the families that looked. `keep` names opportunities inside a
 * family that looked which it could still not judge this time (a page the
 * readiness check could not load): they are left exactly as they are.
 */
export function persist(found: Found[], ran: Set<Family>, at = now(), keep: (id: string) => boolean = () => false): { added: number; updated: number; cleared: number; reopened: number } {
  const upsert = db.prepare(
    `INSERT INTO cc_seo_opps (id, type, page, keyword, cluster, title, evidence, priority, priority_why, potential, action, early, first_seen, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET type = excluded.type, page = excluded.page, keyword = excluded.keyword, cluster = excluded.cluster, title = excluded.title,
       evidence = excluded.evidence, priority = excluded.priority, priority_why = excluded.priority_why, potential = excluded.potential, action = excluded.action,
       early = excluded.early, active = 1, cleared_at = NULL, cleared_why = NULL, last_seen = excluded.last_seen`,
  );
  const had = new Map((db.prepare("SELECT id, active FROM cc_seo_opps").all() as { id: string; active: number }[]).map((r) => [r.id, r.active]));
  let added = 0;
  let updated = 0;
  let reopened = 0;
  const seen = new Set<string>();
  db.exec("BEGIN");
  try {
    for (const f of found) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      const before = had.get(f.id);
      if (before === undefined) added++;
      else if (before === 0) reopened++;
      else updated++;
      upsert.run(f.id, f.type, f.page, f.keyword, f.cluster, f.title, JSON.stringify(f.evidence), f.priority, f.priorityWhy, f.potential ? JSON.stringify(f.potential) : null, JSON.stringify(f.action), f.early ? 1 : 0, at, at);
    }
    let cleared = 0;
    const clear = db.prepare("UPDATE cc_seo_opps SET active = 0, cleared_at = ?, cleared_why = ? WHERE id = ? AND active = 1");
    for (const r of db.prepare("SELECT id, type FROM cc_seo_opps WHERE active = 1").all() as { id: string; type: OpportunityType }[]) {
      if (seen.has(r.id) || !ran.has(familyOf(r.id)) || keep(r.id)) continue;
      clear.run(at, clearedWhy(r.id) ?? CLEARED[r.type] ?? "The rules no longer find it.", r.id);
      cleared++;
    }
    db.exec("COMMIT");
    return { added, updated, cleared, reopened };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/* ---------- following its task and proposals ------------------------------------------------ */

interface OppDb {
  id: string;
  type: OpportunityType;
  page: string | null;
  keyword: string | null;
  cluster: string | null;
  title: string;
  evidence: string;
  priority: Priority;
  priority_why: string;
  potential: string | null;
  action: string;
  early: number;
  state: OpportunityState;
  state_by: string | null;
  state_at: string | null;
  state_note: string | null;
  task_id: number | null;
  active: number;
  cleared_at: string | null;
  cleared_why: string | null;
  first_seen: string;
  last_seen: string;
}

interface Linked {
  task: { id: number; state: TaskState; title: string; error: string | null; kind: string } | null;
  proposals: { id: number; state: "waiting" | "approved" | "applied" | "rejected" | "withdrawn"; address: string; decided_by: string | null }[];
}

function linked(taskId: number | null): Linked {
  if (!taskId) return { task: null, proposals: [] };
  const t = db.prepare("SELECT id, state, prompt, error, kind, result_data FROM cc_ai_tasks WHERE id = ?").get(taskId) as
    | { id: number; state: TaskState; prompt: string; error: string | null; kind: string; result_data: string | null }
    | undefined;
  if (!t) return { task: null, proposals: [] };
  const ids = json<{ proposals?: number[] }>(t.result_data, {}).proposals ?? [];
  const proposals = ids.length
    ? (db.prepare(`SELECT id, state, address, decided_by FROM cc_proposals WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as Linked["proposals"])
    : [];
  return { task: { id: t.id, state: t.state, title: t.prompt, error: t.error, kind: t.kind }, proposals };
}

/**
 * Move opportunities along with what their task did: running is in
 * progress; proposals waiting are in progress; every proposal applied is
 * done (by whoever approved it); a failed or stopped task, or proposals all
 * rejected, is open again with the reason. A state a person set to done or
 * dismissed is never moved.
 */
export function syncLinks(): number {
  const rows = db.prepare("SELECT * FROM cc_seo_opps WHERE task_id IS NOT NULL AND state IN ('queued', 'in-progress')").all() as unknown as OppDb[];
  let moved = 0;
  const set = db.prepare("UPDATE cc_seo_opps SET state = ?, state_by = ?, state_at = ?, state_note = ? WHERE id = ?");
  for (const o of rows) {
    const l = linked(o.task_id);
    if (!l.task) continue;
    let next: { state: OpportunityState; by: string; note: string } | null = null;
    const t = l.task;
    if (t.state === "running") next = { state: "in-progress", by: "the operator", note: `Operator task #${t.id} is running on the studio workstation.` };
    else if (t.state === "failed" || t.state === "cancelled") next = { state: "open", by: "the operator", note: `Operator task #${t.id} ${t.state === "failed" ? `failed${t.error ? `: ${t.error.slice(0, 160)}` : ""}` : "was stopped"}.` };
    else if (t.state === "done") {
      const p = l.proposals;
      if (p.length && p.every((x) => x.state === "applied")) next = { state: "done", by: p.find((x) => x.decided_by)?.decided_by ?? "a person", note: `Applied: proposal${p.length === 1 ? "" : "s"} ${p.map((x) => `#${x.id}`).join(", ")} approved and live.` };
      else if (p.some((x) => x.state === "waiting" || x.state === "approved")) next = { state: "in-progress", by: "the operator", note: `${p.filter((x) => x.state === "waiting" || x.state === "approved").length} proposal(s) wait for approval in AI Operator › Approvals.` };
      else if (p.length) next = { state: "open", by: "a person", note: `Its proposal${p.length === 1 ? " was" : "s were"} rejected or withdrawn.` };
      else if (t.kind === "brief") next = { state: "in-progress", by: "the operator", note: `The brief is ready (operator task #${t.id}): read it, act on it, then mark this done.` };
      else next = { state: "open", by: "the operator", note: `Operator task #${t.id} finished without a proposal; its result says why.` };
    }
    if (next && (next.state !== o.state || next.note !== o.state_note)) {
      set.run(next.state, next.by, now(), next.note, o.id);
      moved++;
    }
  }
  return moved;
}

/* ---------- the run -------------------------------------------------------------------------- */

const ALL_TYPES = Object.keys(TYPE_LABEL) as OpportunityType[];

/** The engine's run: keywords in, mapping, every rule family, kept. Returns the line shown beside the run. */
export async function runEngine(progress: (done: number, of: number, what?: string) => void = () => {}): Promise<string> {
  const view = siteView();
  const found: Found[] = [];
  const ran = new Set<Family>();
  const skipped: string[] = [];
  /* What a family that looked could still not judge: kept as it is. */
  const keeps: ((id: string) => boolean)[] = [];
  /* What was read only in part, for the line beside the run. */
  const partly: string[] = [];
  const STEPS = 8;

  progress(0, STEPS, "keywords");
  const sync = syncFromSearch();
  const mapped = remap(view);

  progress(1, STEPS, "index");
  const ni = notIndexed(view);
  if (ni) {
    found.push(...ni.found);
    ran.add("index");
    /* An address Google was not asked about is not an address Google indexed. */
    keeps.push((id) => id.startsWith("not-indexed:") && ni.unknown(id.slice("not-indexed:".length)));
    if (!ni.ins.complete && ni.ins.of !== null) {
      partly.push(`the index check of ${ni.ins.day} reached ${ni.ins.checked} of ${ni.ins.of} addresses, ${ni.ins.carried} keep an earlier day's result${ni.ins.missing ? ` and ${ni.ins.missing} have none` : ""}`);
    }
  } else skipped.push("no URL Inspection yet");

  progress(2, STEPS, "search");
  const ctx = searchContext();
  if (ctx) {
    const near = nearPageOne(ctx, view);
    found.push(...near, ...lowCtr(ctx, view));
    ran.add("search");
    const drops = rankingDrops(ctx, view);
    if (drops) {
      found.push(...drops);
      ran.add("drops");
    }
    const targets = targeted(ctx, new Set(near.map((f) => normal(f.keyword ?? ""))));
    if (targets) {
      found.push(...targets);
      ran.add("targets");
    }
  } else skipped.push("no Search Console history yet");

  progress(3, STEPS, "clusters");
  found.push(...gaps(ctx));
  ran.add("clusters");

  progress(4, STEPS, "crawl");
  const c = crawled(view);
  if (c) {
    found.push(...c.thin, ...c.technical, ...c.links);
    /* A crawl the site did not answer found nothing out: its row is added, nothing of the crawl's is cleared. */
    if (c.read.readable) ran.add("crawl");
    else partly.push(`the website did not answer the crawl (${c.read.answered} of ${c.read.listed} pages, most answered ${answeredAs(c.read.mostly)}), its earlier findings are kept`);
  } else skipped.push("no crawl yet");

  progress(5, STEPS, "readiness");
  const r = readiness(ctx);
  if (r) {
    found.push(...r.found);
    ran.add("readiness");
    if (!r.pages.read) {
      keeps.push((id) => id.startsWith("missing-answer:"));
      partly.push(`the readiness check could judge ${r.pages.judged} of ${r.pages.asked} pages, its page findings are kept`);
    }
    for (const key of r.unanswered) keeps.push((id) => id === `technical:site:${key}`);
    if (r.unanswered.length) partly.push(`the site did not give ${r.unanswered.map((k) => (k === "robots" ? "robots.txt" : k === "llms" ? "llms.txt" : k)).join(" or ")} to the readiness check`);
  } else skipped.push("no readiness check yet");

  progress(6, STEPS, "speed");
  const s = slow(view);
  if (s) {
    found.push(...s);
    ran.add("speed");
  } else skipped.push("no mobile speed test yet");

  progress(7, STEPS, "owner tasks");
  found.push(...audited());
  ran.add("audit");

  const kept = persist(found, ran, now(), (id) => keeps.some((k) => k(id)));
  const moved = syncLinks();

  /* One number a day per type, so a tile has a line and a "before". */
  const counts = db.prepare("SELECT type, COUNT(*) AS n FROM cc_seo_opps WHERE active = 1 AND state NOT IN ('done', 'dismissed') GROUP BY type").all() as { type: string; n: number }[];
  const by = new Map(counts.map((x) => [x.type, x.n]));
  for (const t of ALL_TYPES) record(`seo.opps.${t}`, by.get(t) ?? 0);
  const open = counts.reduce((n, x) => n + x.n, 0);
  record("seo.opps.open", open);
  record("seo.opps.pages", (db.prepare("SELECT COUNT(DISTINCT page) AS n FROM cc_seo_opps WHERE active = 1 AND page IS NOT NULL AND state NOT IN ('done', 'dismissed')").get() as { n: number }).n);

  if (kept.added) {
    note("seo", `Found ${kept.added} new SEO opportunit${kept.added === 1 ? "y" : "ies"}`, {
      tone: "info",
      detail: `${open} open in all${kept.cleared ? `; ${kept.cleared} no longer found` : ""}.`,
      href: "/seo/opportunities",
      dedupe: `seo:engine:${now()}`,
    });
  }
  progress(STEPS, STEPS);
  return `${open} open opportunities (${kept.added} new, ${kept.cleared} cleared, ${kept.reopened} found again); ${sync.added} new search queries; ${mapped.keywords} phrases and ${mapped.clusters} clusters mapped anew${moved ? `; ${moved} moved with their tasks` : ""}${partly.length ? `; read in part: ${partly.join("; ")}` : ""}${skipped.length ? `; not looked at: ${skipped.join(", ")}` : ""}`;
}

/* ---------- what the engine could read ----------------------------------------------------- */

/**
 * Each source the rules read, with what it could give the last time: read
 * whole, in part, not at all, or not connected (with the owner's one step).
 * Worked out from the same tables by the same tests the rules use, so the
 * page says exactly what the list is made from. Bing is here to say that it
 * is not: no rule reads it until its key exists.
 */
export function engineInputs(view: SiteView = siteView()): EngineInput[] {
  const out: EngineInput[] = [];

  const end = lastSnapDay();
  if (end) out.push({ key: "search", label: "Search Console history", state: "read", line: `Positions, impressions and clicks per search and page, kept to ${end} (Google's final days run two to three behind).`, asOf: end });
  else {
    const a = gsc.access();
    out.push(
      a.state === "ok"
        ? { key: "search", label: "Search Console history", state: "unread", line: "Search Console is connected; the desk's first snapshot of its history has not run yet. Near page one, low CTR, ranking drops and every estimate wait for it.", asOf: null }
        : { key: "search", label: "Search Console history", state: "off", line: gsc.reasonFor(a), asOf: null, step: gsc.stepFor(a) },
    );
  }

  let ins: LatestInspection | null = null;
  try {
    ins = latestInspection();
  } catch {
    ins = null;
  }
  if (!ins) out.push({ key: "index", label: "Google's index (URL Inspection)", state: "unread", line: "The daily index check has not inspected the sitemap's addresses yet, so there is no “Not indexed” row.", asOf: null });
  else if (!ins.complete && ins.of !== null)
    out.push({
      key: "index",
      label: "Google's index (URL Inspection)",
      state: "partial",
      line: `The check of ${ins.day} reached ${ins.checked} of ${ins.of} addresses before Search Console stopped answering. ${ins.carried} keep the result of an earlier day${ins.missing ? `, and ${ins.missing} have none from the last week: their rows are left as they were` : ""}. Nothing is cleared for an address Google was not asked about.`,
      asOf: ins.day,
    });
  else out.push({ key: "index", label: "Google's index (URL Inspection)", state: "read", line: `${ins.rows.length} sitemap addresses, each with Google's answer of ${ins.day}.`, asOf: ins.day });

  if (!view.at) out.push({ key: "crawl", label: "The desk's crawl", state: "unread", line: "The crawl has not read the site yet: thin pages, technical findings and internal links wait for it.", asOf: null });
  else {
    const read = crawlRead(view);
    out.push(
      read.readable
        ? { key: "crawl", label: "The desk's crawl", state: "read", line: `${read.answered} of ${read.listed} sitemap pages answered 200.`, asOf: view.at }
        : {
            key: "crawl",
            label: "The desk's crawl",
            state: "unread",
            line: `The website did not answer the last crawl: ${read.answered} of ${read.listed} sitemap pages answered 200, most of the others ${answeredAs(read.mostly)}. Thin pages, technical findings and internal links are kept as they were until a crawl reads the site again.`,
            asOf: view.at,
          },
    );
  }

  const site = siteReadiness();
  const pages = readinessRead();
  /* What the newest run itself read (readiness.ts keeps it); a desk whose last run predates that record has only the table. */
  let run: ReturnType<typeof readinessRun> = null;
  try {
    run = readinessRun();
  } catch {
    run = null;
  }
  if (!site && !pages.asked && !run) out.push({ key: "readiness", label: "AI-readiness check", state: "unread", line: "The readiness check has not run yet: it reads the pages the crawl lists, once a day.", asOf: null });
  else if (run && run.read < run.pages)
    out.push({
      key: "readiness",
      label: "AI-readiness check",
      state: run.read ? "partial" : "unread",
      line: `The last check read ${run.read} of ${run.pages} pages${run.why ? `: the website ${run.why}` : ""}. Every page it could not read keeps its earlier reading, and no row is cleared for it.`,
      asOf: run.at,
    });
  else if (run && !run.pages)
    out.push({ key: "readiness", label: "AI-readiness check", state: "unread", line: `The last check had nothing to read${run.why ? `: ${run.why}` : ""}. The earlier readings are kept, and no row is cleared.`, asOf: run.at });
  else
    out.push(
      pages.read
        ? { key: "readiness", label: "AI-readiness check", state: "read", line: `${pages.judged} of ${pages.asked} pages read for a direct answer and questions.`, asOf: run?.at ?? site?.at ?? null }
        : { key: "readiness", label: "AI-readiness check", state: "partial", line: `The check has a reading of ${pages.judged} of ${pages.asked} pages; the rows of the pages it could not read are kept as they were.`, asOf: run?.at ?? site?.at ?? null },
    );

  const speed = speedDay();
  out.push(
    speed
      ? { key: "speed", label: "PageSpeed Insights (mobile lab)", state: "read", line: `Mobile lab runs to ${speed}: a handful of pages a day, a throttled phone on Google's machines. Not what visitors had: Google has no field data for the site yet.`, asOf: speed }
      : { key: "speed", label: "PageSpeed Insights (mobile lab)", state: "unread", line: "No mobile speed test has measured a page yet (once a day), so no slow page is listed.", asOf: null },
  );

  let steps = 0;
  try {
    steps = ownerTasks(["owner", "lead-chrome", "code", "content"]).length;
  } catch {
    steps = 0;
  }
  out.push(
    steps
      ? { key: "audit", label: "The SEO audit's steps", state: "read", line: `${steps} steps a person takes, from the imported SEO audit.`, asOf: null }
      : { key: "audit", label: "The SEO audit's steps", state: "unread", line: "No SEO audit has been imported, so the list has no owner, browser or content steps from one.", asOf: null },
  );

  let marks: Map<string, { by: string; at: string }> | null = null;
  try {
    marks = targetPhrases(keywords());
  } catch {
    marks = null;
  }
  out.push(
    marks
      ? { key: "targets", label: "Target phrases", state: "read", line: marks.size ? `${marks.size} phrase${marks.size === 1 ? "" : "s"} marked as a target in Keywords.` : "No phrase is marked as a target in Keywords yet. A target joins this list until the site holds a top position for it.", asOf: null }
      : { key: "targets", label: "Target phrases", state: "unread", line: "The Keywords page's target marks could not be read on this desk.", asOf: null },
  );

  let b: ReturnType<typeof bing.status> | null = null;
  try {
    b = bing.status();
  } catch {
    b = null;
  }
  out.push(
    b?.state === "connected"
      ? { key: "bing", label: "Bing Webmaster Tools", state: "unread", line: "Connected, but no rule of this list reads Bing yet: every row is from Google's figures and the desk's own checks.", asOf: null }
      : {
          key: "bing",
          label: "Bing Webmaster Tools",
          state: "off",
          line: "Not connected. Every row is from Google's figures and the desk's own checks; Bing's positions and index would add rows Google does not show.",
          asOf: null,
          ...(b?.step ? { step: b.step } : {}),
        },
  );
  return out;
}

/* ---------- reading ----------------------------------------------------------------------------- */

const href = (id: number): string => `/operator?result=${id}#response`;

/** An opportunity as the screens get it, with its task, proposals and whether its action can be taken now. */
export function clusterNames(): Map<string, string> {
  return new Map(clusters().map((c) => [c.key, c.name]));
}

export function toRow(o: OppDb, view: SiteView, names: Map<string, string> = clusterNames()): OpportunityRow {
  const action = json<StoredAction>(o.action, { kind: "code", label: "", step: "", operator: null, ownerTaskId: null, href: null });
  const l = linked(o.task_id);
  const busy = l.task && (l.task.state === "queued" || l.task.state === "running");
  let available = true;
  let why: string | null = null;
  if (o.state === "done" || o.state === "dismissed") {
    available = false;
    why = `It is ${o.state === "done" ? "done" : "dismissed"}; open it again to act.`;
  } else if (action.kind === "owner") {
    available = false;
    why = action.ownerTaskId ? "Only the owner can do this: mark the owner task done when it is." : "Only the owner can do this. It clears by itself once the desk no longer finds it.";
  } else if (busy) {
    available = false;
    why = `Operator task #${l.task!.id} is ${l.task!.state}.`;
  } else if (action.kind === "proposal" && action.operator?.paths?.some((p) => view.byPath.get(p)?.status !== 200)) {
    available = false;
    why = "The crawl has no page answering 200 at this address, so there is no title to change.";
  }
  return {
    id: o.id,
    type: o.type,
    typeLabel: TYPE_LABEL[o.type] ?? o.type,
    title: o.title,
    subject: { page: o.page ? pageRef(o.page, view) : null, keyword: o.keyword, cluster: o.cluster ? { key: o.cluster, name: names.get(o.cluster) ?? o.cluster } : null },
    evidence: json<Evidence[]>(o.evidence, []),
    priority: o.priority,
    priorityWhy: o.priority_why,
    potential: json<Potential | null>(o.potential, null),
    action: { ...action, available, why },
    state: {
      state: o.state,
      by: o.state_by,
      at: o.state_at,
      note: o.state_note,
      task: l.task ? { id: l.task.id, state: l.task.state, title: l.task.title, href: href(l.task.id) } : null,
      proposals: l.proposals.map((p) => ({ id: p.id, state: p.state, address: p.address, href: `/operator?ap=${p.state === "waiting" ? "waiting" : p.state === "applied" || p.state === "approved" ? "approved" : "completed"}#approvals` })),
    },
    active: !!o.active,
    clearedAt: o.cleared_at,
    clearedWhy: o.cleared_why,
    firstSeen: o.first_seen,
    lastSeen: o.last_seen,
    early: !!o.early,
  };
}

export function opportunityDb(id: string): OppDb | null {
  return (db.prepare("SELECT * FROM cc_seo_opps WHERE id = ?").get(id) as OppDb | undefined) ?? null;
}

export function allOpportunities(): OppDb[] {
  return db.prepare("SELECT * FROM cc_seo_opps").all() as unknown as OppDb[];
}

export function opportunity(id: string, view: SiteView = siteView()): OpportunityRow | null {
  const o = opportunityDb(id);
  return o ? toRow(o, view) : null;
}

/** Highest priority first, then the largest estimate, then the newest. */
export function rank(a: OpportunityRow, b: OpportunityRow): number {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (b.potential?.clicksPerMonth ?? -1) - (a.potential?.clicksPerMonth ?? -1) || b.firstSeen.localeCompare(a.firstSeen) || a.id.localeCompare(b.id);
}

/* ---------- a person's changes ------------------------------------------------------------- */

const fail = (status: 400 | 404 | 409, message: string): never => {
  throw new HTTPException(status, { message });
};

/** A person sets the state. Any state; the note says why when given. */
export function setState(id: string, state: OpportunityState, by: Person, noteText?: string | null): OpportunityRow {
  const o = opportunityDb(id) ?? fail(404, `There is no opportunity ${id}.`);
  db.prepare("UPDATE cc_seo_opps SET state = ?, state_by = ?, state_at = ?, state_note = ? WHERE id = ?").run(state, by.name, now(), noteText?.trim() || null, id);
  if (o.state !== state) {
    note("seo-state", `${state === "done" ? "Done" : state === "dismissed" ? "Dismissed" : state === "open" ? "Opened again" : state === "in-progress" ? "In progress" : "Queued"}: ${o.title}`, {
      tone: state === "done" ? "good" : state === "dismissed" ? "quiet" : "info",
      actor: by.name,
      detail: [TYPE_LABEL[o.type], o.page ?? o.keyword ?? o.cluster, noteText?.trim()].filter(Boolean).join(" · "),
      href: `/seo/opportunities?open=${encodeURIComponent(id)}`,
      dedupe: `seo:state:${id}:${state}:${now()}`,
    });
  }
  return opportunity(id)!;
}

/**
 * Take an opportunity's action: queue its operator task (a proposal or a
 * brief), or mark a person's step as taken (the lead submitted it in the
 * browser; it was handed to the website's code). Never changes the live site.
 */
export async function act(id: string, by: Person): Promise<OpportunityRow> {
  const view = siteView();
  const o = opportunityDb(id) ?? fail(404, `There is no opportunity ${id}.`);
  const row = toRow(o, view);
  if (!row.action.available) fail(409, row.action.why ?? "Its action cannot be taken now.");
  const action = row.action;
  if (action.kind === "proposal" || action.kind === "brief") {
    const task = await createTask(action.operator as NewTask, by);
    db.prepare("UPDATE cc_seo_opps SET state = 'queued', state_by = ?, state_at = ?, state_note = ?, task_id = ? WHERE id = ?").run(
      by.name,
      now(),
      `Queued as operator task #${task.id}: it runs on the studio workstation when it is on.`,
      task.id,
      id,
    );
    note("seo-action", `${action.kind === "proposal" ? "Asked for a title and description" : "Asked for a brief"}: ${o.title}`, {
      tone: "info",
      actor: by.name,
      detail: `Operator task #${task.id}${action.kind === "proposal" ? "; what it proposes waits for approval" : ""}.`,
      href: `/seo/opportunities?open=${encodeURIComponent(id)}`,
      dedupe: `seo:act:${id}:${task.id}`,
    });
  } else if (action.kind === "chrome") {
    db.prepare("UPDATE cc_seo_opps SET state = 'in-progress', state_by = ?, state_at = ?, state_note = ? WHERE id = ?").run(by.name, now(), `${action.label}: done by hand in the owner's browser.`, id);
    note("seo-action", `${action.label}: ${o.page ?? o.title}`, { tone: "info", actor: by.name, detail: "By hand, in Search Console in the owner's browser.", href: "/seo/technical#indexing", dedupe: `seo:act:${id}:${now()}` });
  } else if (action.kind === "code") {
    /* Nothing is sent anywhere: it waits on the queue for a change to the website's repository, and the next crawl or engine run that no longer finds it clears it. */
    db.prepare("UPDATE cc_seo_opps SET state = 'queued', state_by = ?, state_at = ?, state_note = ? WHERE id = ?").run(by.name, now(), "Waiting for a change to the website's code; it clears when the next run no longer finds it.", id);
    note("seo-action", `Queued for the website's code: ${o.title}`, { tone: "info", actor: by.name, href: `/seo/opportunities?open=${encodeURIComponent(id)}`, dedupe: `seo:act:${id}:${now()}` });
  }
  return opportunity(id, view)!;
}

/** Mark a not-indexed page as submitted in Search Console (or not). */
export function markSubmitted(path: string, submitted: boolean, by: Person): OpportunityRow {
  const id = `not-indexed:${path}`;
  const o = opportunityDb(id) ?? fail(404, `${path} is not in the Request indexing queue.`);
  if (submitted) {
    db.prepare("UPDATE cc_seo_opps SET state = 'in-progress', state_by = ?, state_at = ?, state_note = ? WHERE id = ?").run(by.name, now(), "Requested indexing in Search Console by hand.", id);
    note("seo-action", `Requested indexing: ${path}`, { tone: "info", actor: by.name, detail: "By hand, in Search Console's URL Inspection.", href: "/seo/technical#indexing", dedupe: `seo:submitted:${path}:${now()}` });
  } else if (o.state === "in-progress") {
    db.prepare("UPDATE cc_seo_opps SET state = 'open', state_by = ?, state_at = ?, state_note = NULL WHERE id = ?").run(by.name, now(), id);
  }
  return opportunity(id)!;
}
