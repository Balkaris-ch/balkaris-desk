import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { db } from "../../../db.ts";
import type { Person } from "../../../people.ts";
import { me, type Vars } from "../../access.ts";
import { createTask } from "../../operator/queue.ts";
import { addTodo } from "../../operator/todos.ts";
import { note, off, ok, reading, setState, state as kept, waiting } from "../../store.ts";
import type { Reading, Stat } from "../../../../web/src/contract/common.ts";
import type { NewTask, TaskState } from "../../../../web/src/contract/operator.ts";
import type { OpportunityAnswer, OpportunityRow, OwnerTaskRow, Priority, SeoSpan } from "../../../../web/src/contract/seo/common.ts";
import type {
  BriefsAnswer,
  BriefState,
  ClusterDetail,
  ClusterRow,
  CompetitorPage,
  CompetitorSite,
  ConsoleGap,
  GapChanged,
  GapGroup,
  GapKeyword,
  GapQuery,
  GapSort,
  GapTab,
  GapTiles,
  GapView,
  GermanGap,
  GroupDetail,
  Paged,
  PriceGap,
  RivalCounts,
  SeoContentGapsPayload,
  Suggestion,
} from "../../../../web/src/contract/seo/content-gaps.ts";
import type { KeywordStatus } from "../../../../web/src/contract/seo/keywords.ts";
import { competitorNames, competitorPages, ENGINE_LABEL, sightings, type CompPageRow, type SightingRow } from "../../seo/competitors.ts";
import { act, allOpportunities, clusterNames, opportunity, toRow } from "../../seo/engine.ts";
import { clusters, keywords, setKeywordStatus, shownPages, type Cluster, type Keyword } from "../../seo/keywords.ts";
import { ownerTasks, type OwnerTask } from "../../seo/owner.ts";
import { queryFigures, spanOf } from "../../seo/rank.ts";
import { pageReadiness } from "../../seo/readiness.ts";
import { PRIORITY_RANK } from "../../seo/rules.ts";
import { ownTitle, siteView, type SiteView } from "../../seo/site.ts";
import { json, now } from "../../seo/tables.ts";
import { answers, langOf as langOfWords, normal, pageWords } from "../../seo/words.ts";
import { body, csvFile, head, historyAbsent, historyAt, int, rangeFrom } from "./shared.ts";

/**
 * /api/v1/seo/content-gaps: SEO › Content Gaps (board 113, panel 5).
 *
 *   GET  /             the whole page: the two largest gaps (German, price
 *                      questions), the coverage list of the view asked (by topic,
 *                      industry, language or cluster), the open group with its
 *                      missing phrases, partly answered phrases, the pages to make
 *                      and the competitor pages read for it; or the phrase view,
 *                      the searches Search Console already reports (console), or
 *                      the competitor sites
 *   GET  /export.csv   the table the same address shows, every row of it
 *   POST /brief        "Create brief": one operator brief per cluster, for the
 *                      phrases sent (a row's own phrase, or the ticked ones)
 *                      first and the cluster's other missing phrases after
 *                      them; or the cluster's missing phrases when a cluster
 *                      is sent
 *   POST /briefs       "Generate all briefs": each named cluster's brief for its
 *                      missing phrases, in this page's words (promptFor)
 *   POST /step         one of the German or price steps the cards show, taken as
 *                      Opportunities takes it: a brief queued, a code change put
 *                      on the to-do list; the owner's steps refused
 *   POST /judge        a person's judgement of phrases (relevant, weak, irrelevant)
 *   POST /map          a person says which page answers a cluster or phrases
 *
 * WHAT A GAP IS. The keyword table (src/cc/seo/keywords.ts) holds the phrases
 * people search, each judged relevant or not and filed in a CLUSTER: one topic
 * in one language. A relevant phrase is ANSWERED when the table maps it to a
 * page whose html lang is the phrase's own language (the audit's mapping, a
 * person's, or the desk's rule). A cluster is a GAP when it holds at least one
 * relevant phrase and no page of its own language answers it: every German
 * cluster while the site is English only, and a German cluster the audit
 * mapped to an English page too. Coverage is answered phrases of relevant
 * phrases: phrases are COUNTED. No free source gives a search volume, so no
 * phrase is weighed by one, and no "difficulty" or "traffic" is shown.
 *
 * NOTHING HERE CHANGES THE WEBSITE. "Create brief" queues an operator task on
 * the studio workstation's model; a person writes and publishes the page. A
 * cluster's gap opportunity (src/cc/seo/engine.ts) follows its brief, so the
 * same brief is not asked twice; a brief for a cluster with no opportunity is
 * remembered here (cc_state, BRIEFS_KEY) for the same reason. A judgement and
 * a mapping are the desk's own records of what a person said.
 */

export const routes = new Hono<Vars>();

const VIEWS: { key: GapView; label: string }[] = [
  { key: "topic", label: "By topic" },
  { key: "industry", label: "By industry" },
  { key: "language", label: "By language" },
  { key: "clusters", label: "By cluster" },
  { key: "keywords", label: "By keyword" },
  { key: "console", label: "From Search Console" },
  { key: "competitors", label: "By competitor" },
];
const LISTED: GapView[] = ["topic", "industry", "language", "clusters"];
const TABS: GapTab[] = ["missing", "partial", "suggested", "competitors"];
const PRIORITIES: Priority[] = ["high", "medium", "low"];
/** Briefs asked at once, by "Generate all briefs" and by the ticked rows alike: the operator's queue holds twenty. */
const BRIEFS_MOST = 10;
/** Ticked phrases a brief request takes: a whole page of the largest size. */
const BRIEF_PHRASES_MOST = 200;
/** Phrases judged or mapped at once. */
const CHANGE_MOST = 200;
/** Rows of a table the page shows at once, as the board shows them; the pager has the rest. */
const LIMIT = 12;
/** Briefs this page queued for a cluster that has no gap opportunity: { cluster key: operator task id }. */
const BRIEFS_KEY = "seo:content-gaps:briefs";
const LANG_NAME: Record<string, string> = { de: "German", en: "English" };

const fail = (status: 400 | 404 | 409, message: string): never => {
  throw new HTTPException(status, { message });
};
const said = (err: unknown): string => (err instanceof HTTPException ? err.message : err instanceof Error ? err.message.slice(0, 200) : String(err));
const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
const quote = (s: string): string => `“${s.length > 60 ? `${s.slice(0, 59)}…` : s}”`;

/* ---------- the search --------------------------------------------------------------------- */

/**
 * One spelling for comparing: lower case, accents off, ß as ss, and "ae", "oe",
 * "ue" as the vowel alone, so "zürich", "zuerich" and "zurich" find each other.
 * Both sides of a comparison go through it, so what it loses it loses twice.
 */
const fold = (s: string): string =>
  s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/([aou])e/g, "$1");
/** The words of a search: at most six, each must appear. */
const needles = (q: string): string[] => fold(q).split(/[^a-z0-9]+/).filter(Boolean).slice(0, 6);
const carries = (text: string, need: string[]): boolean => {
  const t = fold(text);
  return need.every((n) => t.includes(n));
};

/* ---------- the world the page is read from ----------------------------------------------- */

interface Fig {
  impressions: number;
  clicks: number;
  position: number | null;
}

interface Facts {
  c: Cluster;
  relevant: Keyword[];
  /** Relevant phrases a page of the cluster's language answers. */
  covered: number;
  total: number;
  gap: boolean;
  /** The mapped page is in another language than the cluster. */
  otherLanguage: boolean;
  price: number;
  questions: number;
  impressions: number | null;
}

/** When each thing the page is made from was last written: a reading is stamped with the newest of its own. */
interface Stamps {
  /** The keyword table: a phrase added or judged, a cluster changed. */
  table: string | null;
  crawl: string | null;
  /** The desk's Search Console history, when it was last written; null when the window has none. */
  search: string | null;
  /** The last day that history holds. */
  searchDay: string | null;
  /** The newest change to a cluster's gap opportunity (a brief queued, written, a state set). */
  opps: string | null;
}

interface World {
  view: SiteView;
  cls: Cluster[];
  byKey: Map<string, Cluster>;
  names: Map<string, string>;
  kw: Keyword[];
  relevant: Keyword[];
  /** Search Console per normalised phrase over the window; null without the history. */
  figures: Map<string, Fig> | null;
  span: SeoSpan | null;
  facts: Map<string, Facts>;
  /** Every opportunity as the screens get it, by id. */
  opps: Map<string, OpportunityRow>;
  /** Briefs this page queued for clusters without an opportunity, with their task's state. */
  loose: Map<string, { id: number; state: TaskState }>;
  at: Stamps;
}

const langOfPage = (w: { view: SiteView }, path: string | null): string | null => (path ? (w.view.byPath.get(path)?.lang ?? null) : null);
/** The language a phrase is judged in: its cluster's, else its own. */
const langOf = (k: Keyword, byKey: Map<string, Cluster>): string | null => (k.cluster ? (byKey.get(k.cluster)?.lang ?? k.lang) : k.lang);
const coveredBy = (k: Keyword, w: { view: SiteView; byKey: Map<string, Cluster> }): boolean => {
  const lang = langOf(k, w.byKey);
  return !!k.page && !!lang && langOfPage(w, k.page) === lang;
};

function figuresOf(span: SeoSpan | null): Map<string, Fig> | null {
  if (!span) return null;
  const out = new Map<string, Fig & { w: number }>();
  for (const q of queryFigures(span.start, span.end)) {
    const k = normal(q.query);
    const had = out.get(k) ?? { impressions: 0, clicks: 0, position: null, w: 0 };
    had.impressions += q.impressions;
    had.clicks += q.clicks;
    had.w += (q.position ?? 0) * q.impressions;
    out.set(k, had);
  }
  return new Map([...out.entries()].map(([k, f]) => [k, { impressions: f.impressions, clicks: f.clicks, position: f.impressions ? Math.round((f.w / f.impressions) * 10) / 10 : null }]));
}

function looseBriefs(): Map<string, { id: number; state: TaskState }> {
  const map = json<Record<string, number>>(kept(BRIEFS_KEY), {});
  const out = new Map<string, { id: number; state: TaskState }>();
  for (const [key, id] of Object.entries(map)) {
    const t = db.prepare("SELECT id, state FROM cc_ai_tasks WHERE id = ?").get(id) as { id: number; state: TaskState } | undefined;
    if (t) out.set(key, t);
  }
  return out;
}

/** One value of one row, or null when the table is not there yet or holds nothing. */
function lastAt(sql: string): string | null {
  try {
    const at = (db.prepare(sql).get() as { at: string | null } | undefined)?.at;
    return at ? at : null;
  } catch {
    return null;
  }
}

/** The newest of some times (ISO, or a day); now when none is known, which is then the only honest stamp. */
const newest = (...xs: (string | null | undefined)[]): string => xs.filter((x): x is string => !!x).sort().at(-1) ?? now();

function stampsOf(view: SiteView, span: SeoSpan | null, hasFigures: boolean): Stamps {
  const phrases = lastAt("SELECT MAX(MAX(last_seen), COALESCE(MAX(status_at), '')) AS at FROM cc_seo_keywords");
  const topics = lastAt("SELECT MAX(updated_at) AS at FROM cc_seo_clusters");
  let search: string | null = null;
  if (hasFigures) {
    try {
      search = historyAt();
    } catch {
      search = null;
    }
  }
  return {
    table: phrases || topics ? newest(phrases, topics) : null,
    crawl: view.at,
    search,
    searchDay: hasFigures ? (span?.end ?? null) : null,
    opps: lastAt("SELECT MAX(state_at) AS at FROM cc_seo_opps WHERE cluster IS NOT NULL"),
  };
}

/** What a reading was made from and how old each part is, for its note: the stamp beside it is the newest of them. */
function madeFrom(w: World, more: [string, string | null][] = []): string {
  const day = (at: string | null): string | null => (at ? at.slice(0, 10) : null);
  const parts = [
    w.at.table ? `the keyword table, last changed ${day(w.at.table)}` : null,
    w.at.crawl ? `the crawl of ${day(w.at.crawl)}` : "no crawl yet",
    w.at.searchDay ? `Search Console up to ${w.at.searchDay}` : null,
    ...more.map(([label, at]) => (at ? `${label} ${day(at)}` : null)),
  ].filter(Boolean);
  return `Made from ${parts.join("; ")}. The time shown is the newest of these, not the moment the page was opened.`;
}

function readWorld(span: SeoSpan | null): World {
  const view = siteView();
  const cls = clusters();
  const byKey = new Map(cls.map((c) => [c.key, c]));
  const kw = keywords();
  const relevant = kw.filter((k) => k.status === "relevant");
  let figures: Map<string, Fig> | null = null;
  try {
    figures = figuresOf(span);
  } catch {
    figures = null;
  }
  const facts = new Map<string, Facts>();
  const byCluster = new Map<string, Keyword[]>();
  for (const k of kw) if (k.cluster) byCluster.set(k.cluster, [...(byCluster.get(k.cluster) ?? []), k]);
  const w0 = { view, byKey };
  for (const c of cls) {
    const all = byCluster.get(c.key) ?? [];
    const rel = all.filter((k) => k.status === "relevant");
    const pageLang = langOfPage(w0, c.page);
    const otherLanguage = !!c.page && !!pageLang && pageLang !== c.lang;
    let impressions = 0;
    let seen = false;
    for (const k of all) {
      const f = figures?.get(k.phrase);
      if (f && f.impressions) {
        impressions += f.impressions;
        seen = true;
      }
    }
    facts.set(c.key, {
      c,
      relevant: rel,
      covered: rel.filter((k) => coveredBy(k, w0)).length,
      total: all.length,
      gap: rel.length > 0 && (!c.page || otherLanguage),
      otherLanguage,
      price: rel.filter((k) => k.flags.price).length,
      questions: rel.filter((k) => k.flags.question).length,
      impressions: seen ? impressions : null,
    });
  }
  const names = clusterNames();
  const opps = new Map(allOpportunities().map((o) => [o.id, toRow(o, view, names)]));
  return { view, cls, byKey, names, kw, relevant, figures, span, facts, opps, loose: looseBriefs(), at: stampsOf(view, span, !!figures) };
}

/* ---------- briefs ----------------------------------------------------------------------- */

const gapOppId = (c: { lang: string; key: string }): string => `${c.lang === "de" ? "german-missing" : "keyword-gap"}:${c.key}`;
const BUSY: TaskState[] = ["queued", "running"];
const taskHref = (id: number): string => `/operator?result=${id}#response`;

/**
 * Where a cluster's brief stands. A brief that is written (its task done, its
 * opportunity not closed) is READY: the page links to it, and it can still be
 * asked again, which is said as "Ask again" and never drawn as if no brief
 * existed.
 */
function briefState(w: World, c: Cluster): BriefState {
  const f = w.facts.get(c.key);
  const o = w.opps.get(gapOppId(c));
  if (o && o.active && f?.gap) {
    const t = o.state.task;
    const closed = o.state.state === "done" || o.state.state === "dismissed";
    const busy = !!t && BUSY.includes(t.state);
    return {
      opportunityId: o.id,
      state: o.state.state,
      available: !closed && !busy,
      ready: !closed && t?.state === "done",
      why: closed ? `Its opportunity is ${o.state.state}; open it again in Opportunities to ask for another brief.` : busy ? `Operator task #${t!.id} is ${t!.state}.` : null,
      task: t ? { id: t.id, state: t.state, href: t.href } : null,
      note: o.state.note,
    };
  }
  const loose = w.loose.get(c.key);
  const busy = !!loose && BUSY.includes(loose.state);
  return {
    opportunityId: null,
    state: null,
    available: !busy && !!f && f.relevant.length > 0,
    ready: loose?.state === "done",
    why: busy ? `Operator task #${loose!.id} is ${loose!.state}.` : f && !f.relevant.length ? "No phrase of this cluster is judged relevant." : null,
    task: loose ? { id: loose.id, state: loose.state, href: taskHref(loose.id) } : null,
    note: null,
  };
}

/** A brief's state in a few words, for the export. */
const briefWord = (b: BriefState | null): string =>
  !b ? "" : b.ready ? `written (operator task #${b.task!.id})` : b.task && BUSY.includes(b.task.state) ? `${b.task.state} (operator task #${b.task.id})` : b.state === "done" || b.state === "dismissed" ? b.state : "";

/** The phrases a brief names: impressions first, then price and questions, then the rest. */
function phraseOrder(w: World): (a: Keyword, b: Keyword) => number {
  const imp = (k: Keyword): number => w.figures?.get(k.phrase)?.impressions ?? -1;
  const pr = (k: Keyword): number => {
    const c = k.cluster ? w.byKey.get(k.cluster) : undefined;
    return c ? PRIORITY_RANK[c.priority] : 3;
  };
  const rk = (k: Keyword): number => (k.cluster ? (w.byKey.get(k.cluster)?.rank ?? 9999) : 9999);
  return (a, b) =>
    imp(b) - imp(a) ||
    pr(a) - pr(b) ||
    rk(a) - rk(b) ||
    Number(b.flags.price) - Number(a.flags.price) ||
    Number(b.flags.question) - Number(a.flags.question) ||
    (a.sources.includes("autocomplete") === b.sources.includes("autocomplete") ? 0 : a.sources.includes("autocomplete") ? -1 : 1) ||
    a.phrase.localeCompare(b.phrase);
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
/** As clip, but at the last space before the limit, so no word is cut in two. */
const clipWords = (s: string, n: number): string => {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > n / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:–—-]+$/, "")}…`;
};

/**
 * The brief's words. The operator keeps a brief's topic to its first 300
 * characters (src/cc/operator/queue.ts, titleFor), so the topic says the
 * essentials first: the page (in the audit's words when it named one), then
 * as many of the searchers' own phrases as fit, most important first.
 */
const TOPIC_MOST = 300;

function promptFor(w: World, c: Cluster, phrases: Keyword[]): string {
  const f = w.facts.get(c.key)!;
  const german = c.lang === "de";
  const name = c.name.replace(/\s*\((DE|EN)\)$/i, "");
  /* The page the audit named, when its advice quotes one: "Create German page 'Was kostet …?'". */
  const named = /\b(?:page|guide|hub|article)\s+['‘“]([^'’”]{8,90})['’”]/i.exec(c.action ?? "")?.[1] ?? null;
  const head = f.gap
    ? `${german ? "German (de-CH) page" : "New page"} ${named ? `“${named}”` : `on “${name}”`}${german ? " for Swiss readers" : ""}; prices left for the owner. Searches:`
    : `Strengthen ${c.page} for searches its title and heading lack:`;
  let list = "";
  for (const k of phrases) {
    const more = list ? `${list}; ${k.phrase}` : ` ${k.phrase}`;
    if (head.length + more.length + 1 > TOPIC_MOST) break;
    list = more;
  }
  return clip(`${head}${list}.`.replace(/\s+/g, " ").trim(), TOPIC_MOST);
}

/**
 * A stored prompt made to fit the operator's 300 characters: whole when it
 * fits, else up to its last whole sentence, else up to its last whole word.
 * The German and price steps carry prompts written before that limit was
 * known; cut blindly, they ended in the middle of a sentence.
 */
function fitTopic(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length <= TOPIC_MOST) return t;
  const cut = t.slice(0, TOPIC_MOST);
  if (/[.!?]$/.test(cut) && t[TOPIC_MOST] === " ") return cut;
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end >= TOPIC_MOST / 2 ? cut.slice(0, end + 1) : clipWords(t, TOPIC_MOST);
}

/** Tie a brief's task to the cluster: on its gap opportunity when it has one, else in this page's own memory. */
function linkBrief(opportunityId: string | null, key: string, taskId: number, by: string, earlier: number | null): void {
  if (opportunityId) {
    db.prepare("UPDATE cc_seo_opps SET state = 'queued', state_by = ?, state_at = ?, state_note = ?, task_id = ? WHERE id = ?").run(
      by,
      now(),
      `Queued as operator task #${taskId}: it runs on the studio workstation when it is on.${earlier ? ` The brief before it is operator task #${earlier}.` : ""}`,
      taskId,
      opportunityId,
    );
    return;
  }
  const map = json<Record<string, number>>(kept(BRIEFS_KEY), {});
  map[key] = taskId;
  setState(BRIEFS_KEY, JSON.stringify(map));
}

/**
 * For another door that queues a cluster's brief (Keywords does, with its own
 * words): tell this page, so the cluster shows that brief here instead of
 * offering "Create brief" as if none had been asked. Nothing happens for a
 * cluster the keyword table does not hold.
 */
export function rememberBrief(clusterKey: string, taskId: number, by: string): void {
  const c = clusters().find((x) => x.key === clusterKey);
  if (!c) return;
  const o = db.prepare("SELECT id FROM cc_seo_opps WHERE id = ? AND active = 1 AND state NOT IN ('done', 'dismissed')").get(gapOppId(c)) as { id: string } | undefined;
  linkBrief(o?.id ?? null, c.key, taskId, by, null);
}

/**
 * Queue one brief for a cluster and link it where it can be followed. The
 * phrases given lead the brief; the cluster's other unanswered phrases follow
 * while they fit, because the brief is filed under the whole cluster (its
 * opportunity is queued with it), so it must be the whole cluster's brief and
 * not one row's.
 */
async function briefFor(w: World, c: Cluster, phrases: Keyword[], by: Person): Promise<BriefsAnswer["results"][number]> {
  const st = briefState(w, c);
  if (!st.available) return { cluster: c.key, ok: false, line: `${c.name}: ${st.why ?? "its brief cannot be asked now."}`, task: null };
  const f = w.facts.get(c.key)!;
  const order = phraseOrder(w);
  const chosen = new Set(phrases.map((k) => k.id));
  const list = [...[...phrases].sort(order), ...f.relevant.filter((k) => !chosen.has(k.id) && !coveredBy(k, w)).sort(order)];
  if (!list.length) return { cluster: c.key, ok: false, line: `${c.name}: every relevant phrase already has a page of its language.`, task: null };
  const task = await createTask({ kind: "brief", prompt: promptFor(w, c, list), depth: "deep" }, by);
  linkBrief(st.opportunityId, c.key, task.id, by.name, st.ready && st.task ? st.task.id : null);
  note("seo-action", `Asked for a brief: ${c.name}`, {
    tone: "info",
    actor: by.name,
    detail: `Operator task #${task.id}, ${plural(list.length, "phrase")}${f.gap ? "; a person writes and publishes the page" : `; for ${c.page}`}.`,
    href: `/seo/content-gaps?view=clusters&open=${encodeURIComponent(c.key)}`,
    dedupe: `seo:gaps:brief:${c.key}:${task.id}`,
  });
  const led = phrases.length === 1 ? `, ${quote(phrases[0]!.phrase)} first` : phrases.length ? `, the ${plural(phrases.length, "ticked phrase")} first` : "";
  return { cluster: c.key, ok: true, line: `${c.name}: queued as operator task #${task.id}${led}.`, task: task.id };
}

/* ---------- rows ------------------------------------------------------------------------- */

function clusterRow(w: World, c: Cluster): ClusterRow {
  const f = w.facts.get(c.key)!;
  const o = w.opps.get(gapOppId(c));
  return {
    key: c.key,
    name: c.name,
    lang: c.lang,
    intent: c.intent,
    priority: c.priority,
    rank: c.rank,
    page: c.page,
    mappedBy: c.mappedBy,
    gap: f.gap,
    why: c.why,
    action: c.action,
    keywords: { total: f.total, relevant: f.relevant.length, mapped: f.covered },
    impressions: f.impressions,
    examples: (f.relevant.length ? [...f.relevant].sort(phraseOrder(w)).map((k) => k.phrase) : c.examples).slice(0, 6),
    opportunityId: o && o.active ? o.id : null,
    price: f.price,
    questions: f.questions,
    otherLanguage: f.otherLanguage,
    brief: briefState(w, c),
  };
}

function keywordRow(w: World, k: Keyword, briefs: Map<string, BriefState>): GapKeyword {
  const c = k.cluster ? w.byKey.get(k.cluster) : undefined;
  const f = w.figures?.get(k.phrase);
  let brief: BriefState | null = null;
  if (c) {
    brief = briefs.get(c.key) ?? briefState(w, c);
    briefs.set(c.key, brief);
  }
  return {
    id: k.id,
    phrase: k.phrase,
    lang: langOf(k, w.byKey),
    cluster: c ? { key: c.key, name: c.name } : null,
    intent: k.intent ?? c?.intent ?? null,
    impressions: f && f.impressions ? f.impressions : null,
    flags: k.flags,
    position: f && f.impressions ? f.position : null,
    page: k.page,
    covered: coveredBy(k, w),
    sources: k.sources,
    firstSeen: k.firstSeen,
    brief,
  };
}

const priorityOf = (list: Priority[]): Priority => list.reduce<Priority>((best, p) => (PRIORITY_RANK[p] < PRIORITY_RANK[best] ? p : best), "low");

/* ---------- order and pages ----------------------------------------------------------------- */

/** The table an address shows, by the orders it can be asked in; null for a table with one order only. */
type TableKind = "phrases" | "console" | "rivals" | null;
const SORTS: Record<Exclude<TableKind, null>, GapSort[]> = {
  phrases: ["impressions", "phrase", "cluster", "priority", "first-seen"],
  console: ["impressions", "position", "phrase"],
  rivals: ["seen", "words", "domain"],
};
/** The way a column runs when it is first chosen: figures from the most, names from A, a position from the best. */
const FIRST_DIR: Record<GapSort, "asc" | "desc"> = { impressions: "desc", phrase: "asc", cluster: "asc", priority: "desc", "first-seen": "desc", position: "asc", seen: "desc", words: "desc", domain: "asc" };

const tableOf = (view: GapView, tab: GapTab): TableKind =>
  view === "keywords" ? "phrases" : view === "console" ? "console" : view === "competitors" ? null : tab === "missing" || tab === "partial" ? "phrases" : tab === "competitors" ? "rivals" : null;

/** Compare two values a row may lack: a row without one is last whichever way the column runs. */
function lacking<T>(x: T | null, y: T | null, cmp: (a: T, b: T) => number, flip: number): number {
  if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
  return cmp(x, y) * flip;
}
const byNumber = (a: number, b: number): number => a - b;
const byText = (a: string, b: string): number => a.localeCompare(b, "en", { sensitivity: "base", numeric: true });

/** The order of a phrase table: the one asked for, the page's own order within it and without it. */
function phraseSorter(w: World, q: GapQuery): (a: Keyword, b: Keyword) => number {
  const own = phraseOrder(w);
  if (!q.sort) return own;
  const flip = q.dir === "asc" ? 1 : -1;
  const imp = (k: Keyword): number | null => w.figures?.get(k.phrase)?.impressions || null;
  const name = (k: Keyword): string | null => (k.cluster ? (w.names.get(k.cluster) ?? k.cluster) : null);
  const prio = (k: Keyword): number | null => {
    const c = k.cluster ? w.byKey.get(k.cluster) : undefined;
    return c ? PRIORITY_RANK[c.priority] : null;
  };
  switch (q.sort) {
    case "impressions":
      return (a, b) => lacking(imp(a), imp(b), byNumber, flip) || own(a, b);
    case "phrase":
      return (a, b) => byText(a.phrase, b.phrase) * flip;
    case "cluster":
      return (a, b) => lacking(name(a), name(b), byText, flip) || own(a, b);
    case "priority":
      /* "desc" is the highest priority first, and high is the smallest rank. */
      return (a, b) => lacking(prio(a), prio(b), byNumber, -flip) || own(a, b);
    case "first-seen":
      return (a, b) => byText(a.firstSeen, b.firstSeen) * flip || own(a, b);
    default:
      return own;
  }
}

/** One page of a table: the offset asked, kept inside the rows. */
function slice<T, U>(rows: T[], q: { offset: number; limit: number }, map: (x: T) => U): Paged<U> {
  const offset = Math.min(q.offset, Math.max(0, rows.length - 1 - ((rows.length - 1) % q.limit)));
  return { total: rows.length, offset, limit: q.limit, rows: rows.slice(offset, offset + q.limit).map(map) };
}

/** A phrase is found by its own words or by its cluster's name. */
const phraseHit = (w: World, need: string[]) => (k: Keyword): boolean => !need.length || carries(`${k.phrase} ${k.cluster ? (w.names.get(k.cluster) ?? "") : ""}`, need);

/* ---------- groups ----------------------------------------------------------------------- */

const baseOf = (key: string): string => key.replace(/:(de|en)$/, "");
const plainName = (name: string): string => name.replace(/\s*\((DE|EN)\)$/i, "").trim();
const industryName = (name: string): string => plainName(name).split(":")[0]!.trim();
const isIndustry = (key: string): boolean => key.startsWith("seg-");

/** The clusters of a group, by the view. Language groups are made of phrases, not clusters: see groupPhrases. */
function groupClusters(w: World, view: GapView, key: string): Cluster[] {
  if (view === "clusters") return w.cls.filter((c) => c.key === key);
  if (view === "language") return w.cls.filter((c) => c.lang === key);
  return w.cls.filter((c) => baseOf(c.key) === key && (view === "industry") === isIndustry(c.key));
}

function groupPhrases(w: World, view: GapView, key: string): Keyword[] {
  if (view === "language") return w.relevant.filter((k) => (langOf(k, w.byKey) ?? "other") === key);
  const keys = new Set(groupClusters(w, view, key).map((c) => c.key));
  return w.relevant.filter((k) => k.cluster && keys.has(k.cluster));
}

function groupOf(w: World, view: GapView, key: string, name: string): GapGroup | null {
  const list = groupClusters(w, view, key).filter((c) => (w.facts.get(c.key)?.relevant.length ?? 0) > 0);
  const phrases = groupPhrases(w, view, key);
  if (!phrases.length) return null;
  const covered = phrases.filter((k) => coveredBy(k, w)).length;
  let impressions = 0;
  let seen = false;
  for (const k of phrases) {
    const f = w.figures?.get(k.phrase);
    if (f && f.impressions) {
      impressions += f.impressions;
      seen = true;
    }
  }
  const facts = list.map((c) => w.facts.get(c.key)!);
  const ranks = list.map((c) => c.rank).filter((r): r is number => r !== null);
  return {
    key,
    name,
    coverage: { covered, of: phrases.length },
    clusters: { of: list.length, gaps: facts.filter((f) => f.gap).length },
    langs: view === "language" ? [] : list.map((c) => ({ lang: c.lang, cluster: c.key, gap: w.facts.get(c.key)!.gap, page: w.facts.get(c.key)!.otherLanguage ? null : c.page })).sort((a, b) => a.lang.localeCompare(b.lang)),
    priority: list.length ? priorityOf(list.map((c) => c.priority)) : "low",
    rank: ranks.length ? Math.min(...ranks) : null,
    price: phrases.filter((k) => k.flags.price).length,
    questions: phrases.filter((k) => k.flags.question).length,
    impressions: seen ? impressions : null,
  };
}

function groupsOf(w: World, view: GapView): GapGroup[] {
  const out: GapGroup[] = [];
  if (view === "language") {
    const langs = [...new Set(w.relevant.map((k) => langOf(k, w.byKey) ?? "other"))];
    for (const l of langs) {
      const g = groupOf(w, view, l, LANG_NAME[l] ?? (l === "other" ? "Language not known" : l.toUpperCase()));
      if (g) out.push(g);
    }
  } else if (view === "clusters") {
    for (const c of w.cls) {
      const g = groupOf(w, view, c.key, c.name);
      if (g) out.push(g);
    }
  } else {
    const bases = new Map<string, string>();
    for (const c of w.cls) {
      if ((view === "industry") !== isIndustry(c.key)) continue;
      const b = baseOf(c.key);
      if (!bases.has(b) || c.lang === "en") bases.set(b, view === "industry" ? industryName(c.name) : plainName(c.name));
    }
    for (const [b, name] of bases) {
      const g = groupOf(w, view, b, name);
      if (g) out.push(g);
    }
  }
  const open = (g: GapGroup): number => g.coverage.of - g.coverage.covered;
  return out.sort(
    (a, b) =>
      Number(open(b) > 0) - Number(open(a) > 0) ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      (a.rank ?? 9999) - (b.rank ?? 9999) ||
      open(b) - open(a) ||
      a.name.localeCompare(b.name),
  );
}

/** The coverage list as the address asks for it: the view's groups, then the search and the filters. */
function listed(w: World, q: GapQuery): { all: GapGroup[]; shown: GapGroup[] } {
  const all = groupsOf(w, q.view);
  const need = needles(q.q);
  const shown = all.filter(
    (g) =>
      (q.priority === "all" || g.priority === q.priority) &&
      (q.gap === "all" || (q.gap === "1" ? g.coverage.covered < g.coverage.of : g.coverage.covered === g.coverage.of)) &&
      /* A language is asked of clusters only: a topic and an industry hold both. */
      (q.view !== "clusters" || q.lang === "all" || w.byKey.get(g.key)?.lang === q.lang) &&
      (!need.length || carries(g.name, need) || groupPhrases(w, q.view, g.key).some((k) => carries(k.phrase, need))),
  );
  return { all, shown };
}

/* ---------- competitors ----------------------------------------------------------------------- */

interface Rivals {
  pages: CompPageRow[];
  seen: SightingRow[];
  /** When a competitor page was last read. */
  at: string | null;
}

function rivalsOf(): Rivals {
  let pages: CompPageRow[] = [];
  let seen: SightingRow[] = [];
  try {
    pages = competitorPages().filter((p) => p.fetchedAt && !p.error && (p.status ?? 200) < 400);
    seen = sightings();
  } catch {
    /* the competitor tables are not there yet: the panels say there is nothing read */
  }
  return { pages, seen, at: pages.map((p) => p.fetchedAt ?? "").sort().at(-1) || null };
}

const german = (lang: string | null): boolean => (lang ?? "").toLowerCase().startsWith("de");
const shortLang = (lang: string | null): string | null => (lang ? lang.toLowerCase().split("-")[0]! : null);

/**
 * Competitor pages counted by what they are. Only a ranking page says how a
 * competitor answers a search; a home page was read because the capture named
 * the site and not the address, so its price and language are left out of
 * "state a price" and "in German".
 */
function rivalCounts(pages: CompPageRow[]): RivalCounts {
  const ranking = pages.filter((p) => p.address === "ranking");
  return { ranking: ranking.length, home: pages.length - ranking.length, priced: ranking.filter((p) => p.priceStated).length, german: ranking.filter((p) => german(p.lang)).length };
}

/** The competitor pages read for a set of clusters, the search and the order asked applied. */
function competitorRows(w: World, r: Rivals, keys: Set<string>, q: GapQuery): CompetitorPage[] {
  const seen = new Map<string, number>();
  for (const s of r.seen) if (s.cluster && keys.has(s.cluster)) seen.set(s.domain, (seen.get(s.domain) ?? 0) + 1);
  const need = needles(q.q);
  const rows = r.pages
    .filter((p) => p.cluster && keys.has(p.cluster))
    .map<CompetitorPage>((p) => ({
      domain: p.domain,
      url: p.url,
      address: p.address,
      title: p.title,
      words: p.words,
      lang: shortLang(p.lang),
      priceStated: p.priceStated,
      cluster: p.cluster ? { key: p.cluster, name: w.names.get(p.cluster) ?? p.cluster } : null,
      query: p.query,
      seen: seen.get(p.domain) ?? 0,
      fetchedAt: p.fetchedAt,
    }))
    .filter((p) => !need.length || carries(`${p.domain} ${p.title ?? ""} ${p.query ?? ""}`, need));
  const own = (a: CompetitorPage, b: CompetitorPage): number => b.seen - a.seen || a.domain.localeCompare(b.domain) || a.url.localeCompare(b.url);
  const flip = q.dir === "asc" ? 1 : -1;
  if (q.sort === "words") return rows.sort((a, b) => lacking(a.words || null, b.words || null, byNumber, flip) || own(a, b));
  if (q.sort === "domain") return rows.sort((a, b) => byText(a.domain, b.domain) * flip || a.url.localeCompare(b.url));
  if (q.sort === "seen") return rows.sort((a, b) => (a.seen - b.seen) * flip || own(a, b));
  return rows.sort(own);
}

/**
 * view=competitors: one row per competitor SITE the desk read a page of, with
 * the topics it was seen or read for (and whether the site answers each) and
 * what its pages say. Most seen first.
 */
function competitorSites(w: World, r: Rivals, q: GapQuery): CompetitorSite[] {
  let names = new Map<string, string | null>();
  try {
    names = competitorNames();
  } catch {
    names = new Map();
  }
  const sites = new Map<string, { pages: CompPageRow[]; topics: Map<string, number>; seen: number }>();
  for (const p of r.pages) {
    const s = sites.get(p.domain) ?? { pages: [], topics: new Map<string, number>(), seen: 0 };
    s.pages.push(p);
    if (p.cluster && !s.topics.has(p.cluster)) s.topics.set(p.cluster, 0);
    sites.set(p.domain, s);
  }
  for (const s of r.seen) {
    const site = sites.get(s.domain);
    if (!site) continue;
    site.seen++;
    if (s.cluster) site.topics.set(s.cluster, (site.topics.get(s.cluster) ?? 0) + 1);
  }
  const need = needles(q.q);
  return [...sites.entries()]
    .map<CompetitorSite>(([domain, s]) => ({
      domain,
      name: names.get(domain) ?? null,
      seen: s.seen,
      topics: [...s.topics.entries()]
        .map(([key, n]) => ({ key, name: w.names.get(key) ?? key, lang: w.byKey.get(key)?.lang ?? (key.endsWith(":de") ? "de" : "en"), gap: w.facts.get(key)?.gap ?? false, seen: n }))
        .sort((a, b) => b.seen - a.seen || a.name.localeCompare(b.name)),
      pages: s.pages
        .map((p) => ({ url: p.url, address: p.address, title: p.title, words: p.words, lang: shortLang(p.lang), priceStated: p.priceStated, fetchedAt: p.fetchedAt }))
        .sort((a, b) => Number(b.address === "ranking") - Number(a.address === "ranking") || a.url.localeCompare(b.url)),
    }))
    .filter((s) => !need.length || carries(`${s.domain} ${s.name ?? ""} ${s.pages.map((p) => p.title ?? "").join(" ")} ${s.topics.map((t) => t.name).join(" ")}`, need))
    .sort((a, b) => b.seen - a.seen || a.domain.localeCompare(b.domain));
}

/* ---------- the open group ----------------------------------------------------------------- */

function suggestionOf(w: World, r: Rivals, c: Cluster): Suggestion {
  const row = clusterRow(w, c);
  const o = row.opportunityId ? w.opps.get(row.opportunityId) : undefined;
  /* The audit's first sentence when it names the page to make, whole (the page clamps it to two lines and keeps it all in its title); else ours. */
  const said = c.action?.split(/(?<=[.!?])\s/)[0]?.trim() ?? "";
  const page = /^(create|write|build|add|publish|make)\b/i.test(said)
    ? clipWords(said, 400)
    : `${c.lang === "de" ? "A German (de-CH) page" : "A page"} that answers “${plainName(c.name)}”${row.examples[0] ? `, starting with “${row.examples[0]}”` : ""}`;
  /* The same topic in the other language, when a page of that language answers it: the page to twin. */
  const other = w.cls.find((x) => x.key !== c.key && baseOf(x.key) === baseOf(c.key) && !!x.page && !w.facts.get(x.key)?.otherLanguage);
  return {
    cluster: row,
    page,
    potential: o?.potential ?? null,
    competitors: rivalCounts(r.pages.filter((p) => p.cluster === c.key)),
    twin: other?.page ? { lang: other.lang, cluster: other.key, page: other.page } : null,
  };
}

function groupDetail(w: World, r: Rivals, view: GapView, g: GapGroup, q: GapQuery): GroupDetail {
  const list = groupClusters(w, view, g.key).sort((a, b) => {
    const fa = w.facts.get(a.key)!;
    const fb = w.facts.get(b.key)!;
    return Number(fb.gap) - Number(fa.gap) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.rank ?? 9999) - (b.rank ?? 9999) || fb.relevant.length - fa.relevant.length;
  });
  const keys = new Set(list.map((c) => c.key));
  const need = needles(q.q);
  /* The order asked for belongs to the open phrase table; the other tab is only counted. */
  const open = groupPhrases(w, view, g.key)
    .filter((k) => !coveredBy(k, w))
    .filter(phraseHit(w, need))
    .sort(phraseSorter(w, q));
  const gapOf = (k: Keyword): boolean => !k.cluster || (w.facts.get(k.cluster)?.gap ?? true);
  const missing = open.filter(gapOf);
  const partial = open.filter((k) => !gapOf(k));
  const gaps = list.filter((c) => w.facts.get(c.key)!.gap);
  const pages = gaps.filter((c) => !need.length || carries(c.name, need) || w.facts.get(c.key)!.relevant.some((k) => carries(k.phrase, need)));
  const comps = competitorRows(w, r, keys, q);
  const briefs = new Map<string, BriefState>();
  const page = (rows: Keyword[]) => slice(rows, q, (k) => keywordRow(w, k, briefs));
  const states = gaps.map((c) => ({ c, st: briefState(w, c) }));
  return {
    group: g,
    tab: q.tab,
    counts: { missing: missing.length, partial: partial.length, suggested: pages.length, competitors: comps.length },
    missing: q.tab === "missing" ? page(missing) : null,
    partial: q.tab === "partial" ? page(partial) : null,
    suggested: q.tab === "suggested" ? slice(pages, q, (c) => suggestionOf(w, r, c)) : null,
    competitors: q.tab === "competitors" ? slice(comps, q, (p) => p) : null,
    clusters: list.filter((c) => w.facts.get(c.key)!.relevant.length > 0).map((c) => clusterRow(w, c)),
    briefs: {
      /* A cluster whose brief is written is not asked again by "Generate all": that is one press per cluster, on purpose. */
      ready: states.filter((s) => s.st.available && !s.st.ready).map((s) => s.c.key),
      queued: states.filter((s) => s.st.task && BUSY.includes(s.st.task.state)).length,
      written: states.filter((s) => s.st.ready).length,
      total: gaps.length,
    },
  };
}

/* ---------- the phrase view and the Search Console view ---------------------------------------- */

/** view=keywords: every relevant phrase no page of its language answers, filtered and ordered, before the page is cut. */
function keywordRows(w: World, q: GapQuery): Keyword[] {
  const gapOf = (k: Keyword): boolean => !k.cluster || (w.facts.get(k.cluster)?.gap ?? true);
  return w.relevant
    .filter((k) => !coveredBy(k, w))
    .filter((k) => q.lang === "all" || langOf(k, w.byKey) === q.lang)
    .filter((k) => !q.price || k.flags.price)
    .filter((k) => !q.question || k.flags.question)
    .filter((k) => q.gap === "all" || (q.gap === "1") === gapOf(k))
    .filter((k) => q.priority === "all" || (k.cluster ? w.byKey.get(k.cluster)?.priority === q.priority : false))
    .filter(phraseHit(w, needles(q.q)))
    .sort(phraseSorter(w, q));
}

/**
 * view=console: the searches Google already shows the site for (the desk's
 * own Search Console history, the window asked) where the history names no
 * page, or the page it showed does not carry every word of the search in its
 * title, heading or address (words.answers, the rule the mapping uses). Listed
 * whether judged or not: a search nobody judged yet is exactly the gap this
 * view exists to show. Only a search a person judged NOT relevant is left
 * out, and counted (`judgedOut`): the person said it is not the studio's, and
 * listing it as a gap would overrule them. Null without the history.
 */
function consoleRows(w: World, q: GapQuery | null): { rows: ConsoleGap[]; judgedOut: number } | null {
  if (!w.figures || !w.span) return null;
  let judgedOut = 0;
  const shown = new Map<string, string>();
  for (const [query, path] of shownPages(w.span.start, w.span.end)) if (!shown.has(normal(query))) shown.set(normal(query), path);
  const byPhrase = new Map(w.kw.map((k) => [k.phrase, k]));
  const briefs = new Map<string, BriefState>();
  const out: ConsoleGap[] = [];
  for (const [query, f] of w.figures) {
    if (!f.impressions) continue;
    const path = shown.get(query) ?? null;
    const page = path ? w.view.byPath.get(path) : undefined;
    /* A page the crawl does not know cannot be compared: it is listed as shown, and its words as not read. */
    if (path && page && answers(query, pageWords({ path: page.path, title: page.title, h1: page.h1 }))) continue;
    const k = byPhrase.get(query) ?? null;
    if (k?.status === "irrelevant") {
      judgedOut++;
      continue;
    }
    const c = k?.cluster ? w.byKey.get(k.cluster) : undefined;
    let brief: BriefState | null = null;
    if (c) {
      brief = briefs.get(c.key) ?? briefState(w, c);
      briefs.set(c.key, brief);
    }
    out.push({
      query,
      lang: (k ? langOf(k, w.byKey) : null) ?? langOfWords(query),
      impressions: f.impressions,
      clicks: f.clicks,
      position: f.position,
      shown: path,
      shownTitle: ownTitle(page?.title),
      why: path ? "words-missing" : "no-page",
      keyword: k ? { id: k.id, status: k.status, cluster: c ? { key: c.key, name: c.name } : null, page: k.page } : null,
      brief,
    });
  }
  const own = (a: ConsoleGap, b: ConsoleGap): number => b.impressions - a.impressions || (a.position ?? 999) - (b.position ?? 999) || a.query.localeCompare(b.query);
  if (!q) return { rows: out.sort(own), judgedOut };
  const need = needles(q.q);
  const rows = out.filter((r) => (q.lang === "all" || r.lang === q.lang) && (!need.length || carries(`${r.query} ${r.shown ?? ""}`, need)));
  const flip = q.dir === "asc" ? 1 : -1;
  if (q.sort === "position") return { rows: rows.sort((a, b) => lacking(a.position, b.position, byNumber, flip) || own(a, b)), judgedOut };
  if (q.sort === "phrase") return { rows: rows.sort((a, b) => byText(a.query, b.query) * flip), judgedOut };
  if (q.sort === "impressions") return { rows: rows.sort((a, b) => (a.impressions - b.impressions) * flip || own(a, b)), judgedOut };
  return { rows: rows.sort(own), judgedOut };
}

/* ---------- the two largest gaps ----------------------------------------------------------- */

const STEP_PRICE = /\bprice|\bprices|\bpreis|\bkostet|\bCHF\b/i;

function stepsOf(w: World, test: (o: OpportunityRow) => boolean): OpportunityRow[] {
  return [...w.opps.values()]
    .filter((o) => o.active && o.id.startsWith("audit:") && test(o) && o.state.state !== "dismissed")
    .sort((a, b) => Number(a.state.state === "done") - Number(b.state.state === "done") || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.title.localeCompare(b.title))
    .slice(0, 6);
}

/** The owner's price task, when the audit left one: only the owner decides the prices. */
function priceOwner(): OwnerTaskRow | null {
  try {
    const t = ownerTasks(["owner", "content", "code", "lead-chrome"]).find((x) => x.id === "price-ranges" || /\bprice ranges?\b/i.test(x.title));
    return t ? ownerRow(t) : null;
  } catch {
    return null;
  }
}

/** The German card's steps and the price card's: the only steps POST /step takes. */
const germanSteps = (w: World): OpportunityRow[] => stepsOf(w, (o) => o.type === "german-missing");
const priceSteps = (w: World, owner: OwnerTaskRow | null): OpportunityRow[] => stepsOf(w, (o) => STEP_PRICE.test(o.title) && (!owner || o.id !== `audit:${owner.id}`));

const clusterOrder = (w: World) => (a: Cluster, b: Cluster) =>
  PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.rank ?? 9999) - (b.rank ?? 9999) || w.facts.get(b.key)!.relevant.length - w.facts.get(a.key)!.relevant.length;

function germanGap(w: World): Reading<GermanGap> {
  const by = { de: 0, en: 0, other: 0, total: 0 };
  const imp = { de: 0, en: 0 };
  for (const k of w.relevant) {
    const l = langOf(k, w.byKey);
    const slot = l === "de" ? "de" : l === "en" ? "en" : "other";
    by[slot]++;
    by.total++;
    const f = w.figures?.get(k.phrase);
    if (f && (slot === "de" || slot === "en")) imp[slot] += f.impressions;
  }
  if (!by.total) return waiting("desk", "No phrase in the keyword table is judged relevant yet.");
  const inMap = w.view.pages.filter((p) => p.inSitemap && p.status === 200);
  const pages = { de: 0, en: 0, other: 0, total: inMap.length, hreflang: null as number | null };
  for (const p of inMap) pages[p.lang === "de" ? "de" : p.lang === "en" ? "en" : "other"]++;
  let checked: string | null = null;
  try {
    const r = pageReadiness();
    if (r.checkedAt) {
      pages.hreflang = r.pages.filter((p) => p.checks.some((c) => c.key === "german" && c.state === "pass")).length;
      checked = r.checkedAt;
    }
  } catch {
    pages.hreflang = null;
  }
  const de = w.cls.filter((c) => c.lang === "de" && w.facts.get(c.key)!.relevant.length > 0);
  const gaps = de.filter((c) => w.facts.get(c.key)!.gap).sort(clusterOrder(w));
  return ok(
    {
      phrases: by,
      pages,
      clusters: { de: de.length, gaps: gaps.length },
      impressions: w.figures ? imp : null,
      top: gaps.slice(0, 5).map((c) => clusterRow(w, c)),
      steps: germanSteps(w),
    },
    "desk",
    newest(w.at.table, w.at.crawl, w.at.search, checked, w.at.opps),
    `Relevant phrases of the keyword table (the audit's research, Search Console and Google Autocomplete), counted by the language they are searched in; the site's pages by the html lang the crawl read. ${madeFrom(w, [["the readiness check of", checked]])}`,
  );
}

function priceGap(w: World, r: Rivals): Reading<PriceGap> {
  const price = w.relevant.filter((k) => k.flags.price);
  if (!w.relevant.length) return waiting("desk", "No phrase in the keyword table is judged relevant yet.");
  const lang = (k: Keyword) => langOf(k, w.byKey);
  const priceClusters = w.cls.filter((c) => (w.facts.get(c.key)?.price ?? 0) > 0);
  const keys = new Set(priceClusters.map((c) => c.key));
  let pricedPages: PriceGap["pricedPages"] = null;
  try {
    const rd = pageReadiness();
    if (rd.checkedAt) {
      const applies = rd.pages.filter((p) => p.checks.some((c) => c.key === "price" && c.state !== "n/a"));
      const pass = applies.filter((p) => p.checks.some((c) => c.key === "price" && c.state === "pass"));
      pricedPages = { count: pass.length, of: applies.length, paths: pass.map((p) => p.path), checkedAt: rd.checkedAt };
    }
  } catch {
    pricedPages = null;
  }
  const comp = r.pages.filter((p) => p.cluster && keys.has(p.cluster));
  const owner = priceOwner();
  return ok(
    {
      phrases: {
        total: price.length,
        de: price.filter((k) => lang(k) === "de").length,
        en: price.filter((k) => lang(k) === "en").length,
        questions: price.filter((k) => k.flags.question).length,
        covered: price.filter((k) => coveredBy(k, w)).length,
      },
      relevant: w.relevant.length,
      clusters: { total: priceClusters.length, gaps: priceClusters.filter((c) => w.facts.get(c.key)!.gap).length },
      pricedPages,
      competitors: comp.length ? rivalCounts(comp) : null,
      top: priceClusters
        .filter((c) => w.facts.get(c.key)!.gap)
        .sort((a, b) => w.facts.get(b.key)!.price - w.facts.get(a.key)!.price || clusterOrder(w)(a, b))
        .slice(0, 5)
        .map((c) => clusterRow(w, c)),
      steps: priceSteps(w, owner),
      owner,
    },
    "desk",
    newest(w.at.table, w.at.crawl, pricedPages?.checkedAt, comp.length ? r.at : null, w.at.opps),
    `A phrase asks a price when it carries kosten, kostet, preis, price, cost, how much, tarif, budget or CHF (src/cc/seo/words.ts). Pages that state a price: the readiness check's CHF test on the pages it applies to (service and landing pages). Competitors: only the pages that ranked for the search are counted; a competitor's home page, read when the capture named the site without the address, is not how it answers the search. ${madeFrom(w, [["the readiness check of", pricedPages?.checkedAt ?? null], ["competitor pages read", comp.length ? r.at : null]])}`,
  );
}

const ownerRow = ({ whoAll: _who, ...t }: OwnerTask): OwnerTaskRow => t;

/** What only the owner can do that would close or measure a content gap. */
function needsYou(): Reading<OwnerTaskRow[]> {
  const fits = (t: OwnerTask): boolean => t.id === "price-ranges" || t.id === "mobile-apps-decision" || /\bprice ranges?\b|keyword planner|mobile apps?\b/i.test(t.title);
  const list = ownerTasks(["owner", "content", "code", "lead-chrome"]).filter(fits);
  /* The list is as old as its last change: the import that wrote the tasks, or the last one marked done. */
  const at = lastAt("SELECT MAX(MAX(updated_at), COALESCE(MAX(done_at), '')) AS at FROM cc_seo_owner_tasks");
  return ok(list.map(ownerRow), "desk", at ?? now(), "From the SEO audit's owner tasks: only the owner decides prices and what the studio sells, and only the owner's Google Ads account opens Keyword Planner.");
}

/* ---------- the query ----------------------------------------------------------------------- */

function parseQuery(c: Context<Vars>): GapQuery {
  const q = (k: string): string => (c.req.query(k) ?? "").trim();
  const view = VIEWS.find((v) => v.key === q("view"))?.key ?? "topic";
  const tab = TABS.find((t) => t === q("tab")) ?? "missing";
  const lang = q("lang");
  const gap = q("gap");
  const priority = PRIORITIES.find((p) => p === q("priority")) ?? "all";
  /* An order is kept only when the table the address shows has it; any other is dropped, and said so by leaving it out of `asked`. */
  const kind = tableOf(view, tab);
  const sort = kind ? (SORTS[kind].find((s) => s === q("sort")) ?? null) : null;
  const dir = q("dir") === "asc" || q("dir") === "desc" ? (q("dir") as "asc" | "desc") : FIRST_DIR[sort ?? (kind ? SORTS[kind][0]! : "impressions")];
  return {
    view,
    open: q("open") || null,
    tab,
    q: q("q").replace(/\s+/g, " ").slice(0, 80),
    lang: lang === "de" || lang === "en" ? lang : "all",
    price: q("price") === "1",
    question: q("question") === "1",
    gap: gap === "1" || gap === "0" ? gap : "all",
    priority,
    sort,
    dir: sort ? dir : FIRST_DIR[kind ? SORTS[kind][0]! : "impressions"],
    cluster: q("cluster") || null,
    offset: int(c.req.query("offset"), 0, 0, 100_000),
    limit: int(c.req.query("limit"), LIMIT, 5, 200),
  };
}

/* ---------- GET / ----------------------------------------------------------------------------- */

const IMPRESSIONS_NOTE = (span: SeoSpan | null): string =>
  span
    ? `Impressions: how often Google showed the site for the phrase, ${span.start} to ${span.end}, from the desk's own daily snapshots of Search Console (whole days, two to three days behind; Google withholds rare queries). A gap phrase usually has none: Google seldom shows a site that has no page for it.`
    : "Impressions: none yet, because the desk holds no Search Console history (its first snapshot has not run, or Search Console is not connected).";
const COVERAGE_NOTE =
  "A relevant phrase is answered when the keyword table maps it to a page in the phrase's own language: the audit's mapping, a person's, or the desk's rule (every word of the phrase, places aside, in the page's title, heading or address). Coverage is answered phrases of all relevant phrases: counted, not weighed by any volume.";
const VOLUME_NOTE =
  "No search volume and no difficulty: no free source gives them. “Autocomplete” beside a phrase means Google completes it, so people search it, not how often. Keyword Planner ranges come only from the owner's Google Ads account (Needs you).";
const CONSOLE_NOTE =
  "Searches Google showed the site for in the period where the desk's history names no page, or the page shown does not carry every word of the search (places aside) in its title, heading or address. Google withholds rare queries, so the list is what it reports, not every search. Listed whether judged or not; a search a person judged not relevant is left out.";
const RIVALS_NOTE =
  "Competitor sites the desk read a page of (one request every two seconds per site, robots.txt obeyed), with the topics each was seen for in the captured results. A ranking page is the address that was in the results; a home page was read because the capture named the site and not the address, and says what the site is, not how it answers the search. “Seen” counts the captured results the site appeared in.";

/** The world, or why there is none: what every door of this page begins with. */
function begin(span: SeoSpan | null): { world: World | null; absent: <T>() => Reading<T> } {
  let w: World | null = null;
  let broke: string | null = null;
  try {
    w = readWorld(span);
  } catch (err) {
    broke = `The keyword table could not be read: ${said(err)}`;
  }
  const none =
    w && !w.cls.length
      ? off<never>(
          "desk",
          "No keyword clusters on this desk yet: they come from the SEO audit's keyword table.",
          "Copy the audit's files to work/seo-audit/ on this machine and run `npm run seo:import`, or have the owner import them (POST /api/v1/seo/imports/audit).",
        )
      : null;
  return { world: !none ? w : null, absent: <T>(): Reading<T> => (none as Reading<T> | null) ?? waiting<T>("desk", broke ?? "The keyword table could not be read.") };
}

routes.get("/", async (c) => {
  const range = rangeFrom(c);
  const q = parseQuery(c);
  const h = head(range);
  const { world, absent } = begin(h.span);
  const r = rivalsOf();

  /* Tiles: counts of the table, each its own reading, as old as the table and the crawl they are counted from. */
  const tile = (make: (w: World) => Stat): Promise<Reading<Stat>> =>
    world ? reading("desk", () => ok(make(world), "desk", newest(world.at.table, world.at.crawl), `${COVERAGE_NOTE} ${madeFrom(world)}`)) : Promise.resolve(absent<Stat>());
  const stat = (value: number, of?: number, sub?: string): Stat => ({ value, previous: null, unit: "count", series: [], ...(of !== undefined ? { of } : {}), ...(sub ? { sub } : {}) });
  const demand = (x: World) => x.cls.filter((cl) => x.facts.get(cl.key)!.relevant.length > 0);
  const [tClusters, tGaps, tGerman, tMapped, tPrice] = await Promise.all([
    tile((x) => {
      const d = demand(x);
      return stat(d.length, undefined, x.cls.length > d.length ? `${x.cls.length - d.length} more hold no relevant phrase` : undefined);
    }),
    tile((x) => {
      const d = demand(x);
      return stat(d.filter((cl) => x.facts.get(cl.key)!.gap).length, d.length);
    }),
    tile((x) => {
      const d = demand(x).filter((cl) => cl.lang === "de");
      return stat(d.filter((cl) => x.facts.get(cl.key)!.gap).length, d.length);
    }),
    tile((x) => stat(x.relevant.filter((k) => coveredBy(k, x)).length, x.relevant.length)),
    tile((x) => {
      const p = x.relevant.filter((k) => k.flags.price);
      return stat(p.filter((k) => !coveredBy(k, x)).length, p.length);
    }),
  ]);
  const tiles: GapTiles = { clusters: tClusters, gaps: tGaps, germanGaps: tGerman, mappedPhrases: tMapped, priceGaps: tPrice };

  const germanReading = world ? await reading("desk", () => germanGap(world)) : absent<GermanGap>();
  const price = world ? await reading("desk", () => priceGap(world, r)) : absent<PriceGap>();

  /* The coverage list and the open group. */
  let groups: SeoContentGapsPayload["groups"] = null;
  let group: SeoContentGapsPayload["group"] = null;
  let all: GapGroup[] = [];
  if (LISTED.includes(q.view)) {
    if (world) {
      try {
        const l = listed(world, q);
        all = l.all;
        groups = ok({ rows: l.shown, of: all.length }, "desk", newest(world.at.table, world.at.crawl, world.at.search), `${COVERAGE_NOTE} ${madeFrom(world)}`);
        const pick = q.open ? (all.find((g) => g.key === q.open) ?? null) : (l.shown[0] ?? null);
        if (q.open && !pick) group = off("desk", `There is no group “${q.open}” in this view: the clusters may have been renamed, or the address is old.`);
        else if (pick)
          group = await reading("desk", () =>
            ok(
              groupDetail(world, r, q.view, pick, q),
              "desk",
              newest(world.at.table, world.at.crawl, world.at.search, world.at.opps, q.tab === "competitors" || q.tab === "suggested" ? r.at : null),
              `${COVERAGE_NOTE} ${IMPRESSIONS_NOTE(world.span)} ${madeFrom(world, q.tab === "competitors" || q.tab === "suggested" ? [["competitor pages read", r.at]] : [])}`,
            ),
          );
      } catch (err) {
        groups = waiting("desk", `The coverage list could not be made: ${said(err)}`);
      }
    } else {
      groups = absent();
      group = absent();
    }
  }

  /* view=keywords: every relevant phrase no page of its language answers. */
  let keywordsReading: SeoContentGapsPayload["keywords"] = null;
  if (q.view === "keywords") {
    keywordsReading = world
      ? await reading("desk", () => {
          const briefs = new Map<string, BriefState>();
          return ok(
            slice(keywordRows(world, q), q, (k) => keywordRow(world, k, briefs)),
            "desk",
            newest(world.at.table, world.at.crawl, world.at.search, world.at.opps),
            `${COVERAGE_NOTE} ${IMPRESSIONS_NOTE(world.span)} ${madeFrom(world)}`,
          );
        })
      : absent();
  }

  /* view=console: what Google already shows the site for and no page targets. Counted for the switch whatever the view. */
  let consoleAll: ConsoleGap[] | null = null;
  if (world) {
    try {
      consoleAll = consoleRows(world, null)?.rows ?? null;
    } catch {
      consoleAll = null;
    }
  }
  let consoleReading: SeoContentGapsPayload["console"] = null;
  if (q.view === "console") {
    consoleReading = !world
      ? absent()
      : await reading("gsc", () => {
          const got = consoleRows(world, q);
          if (!got) return historyAbsent<Paged<ConsoleGap>>();
          const out = got.judgedOut ? ` ${plural(got.judgedOut, "search", "searches")} a person judged not relevant ${got.judgedOut === 1 ? "is" : "are"} left out.` : "";
          return ok(slice(got.rows, q, (x) => x), "gsc", newest(world.at.search, world.at.crawl), `${CONSOLE_NOTE}${out} ${world.span ? `Window: ${world.span.start} to ${world.span.end}.` : ""} ${madeFrom(world)}`);
        });
  }

  /* view=competitors: the competitor sites read, with the topics each was seen for. */
  let competitorsReading: SeoContentGapsPayload["competitors"] = null;
  if (q.view === "competitors") {
    competitorsReading = world
      ? await reading("desk", () => {
          if (!r.pages.length)
            return waiting("desk", "No competitor page has been read yet: the competitor job reads the pages the audit saw beside Balkaris in Google and the AI assistants, one request every two seconds per site.");
          const ranking = r.pages.filter((p) => p.address === "ranking").length;
          return ok({ rows: competitorSites(world, r, q), sites: new Set(r.pages.map((p) => p.domain)).size, pages: { ranking, home: r.pages.length - ranking } }, "desk", r.at ?? now(), RIVALS_NOTE);
        })
      : absent();
  }

  /* ?cluster=: one cluster in detail. */
  let selected: SeoContentGapsPayload["selected"] = null;
  if (q.cluster) {
    if (!world) selected = absent();
    else {
      const cl = world.byKey.get(q.cluster);
      selected = !cl
        ? off("desk", `There is no cluster ${q.cluster}.`)
        : await reading("desk", () => {
            const phrases = world.kw
              .filter((k) => k.cluster === cl.key && k.status !== "irrelevant")
              .sort(phraseOrder(world))
              .slice(0, 80)
              .map((k) => {
                const f = world.figures?.get(k.phrase);
                return { id: k.id, phrase: k.phrase, status: k.status, impressions: f && f.impressions ? f.impressions : null, position: f && f.impressions ? f.position : null, page: k.page };
              });
            const opp = world.opps.get(gapOppId(cl)) ?? null;
            const read = r.pages.filter((p) => p.cluster === cl.key);
            const detail: ClusterDetail = {
              cluster: clusterRow(world, cl),
              phrases,
              opportunity: opp && opp.active ? opp : null,
              competitors: read
                .map((p) => ({ domain: p.domain, url: p.url, address: p.address, title: p.title, h1: p.h1, words: p.words, lang: shortLang(p.lang), schemaTypes: p.schemaTypes, priceStated: p.priceStated, fetchedAt: p.fetchedAt }))
                .sort((a, b) => Number(b.address === "ranking") - Number(a.address === "ranking") || a.domain.localeCompare(b.domain)),
              sightings: r.seen.filter((s) => s.cluster === cl.key).slice(0, 40).map((s) => ({ domain: s.domain.replace(/^name:/, ""), engine: ENGINE_LABEL[s.engine] ?? s.engine, kind: s.kind, query: s.query, position: s.position, day: s.day })),
            };
            const readAt = read.map((p) => p.fetchedAt ?? "").sort().at(-1) || null;
            return ok(detail, "desk", newest(world.at.table, world.at.crawl, world.at.search, world.at.opps, readAt), `${COVERAGE_NOTE} ${madeFrom(world, [["competitor pages read", readAt]])}`);
          });
    }
  }

  const count = (v: GapView): number | null => {
    if (!world) return null;
    if (v === "keywords") return world.relevant.filter((k) => !coveredBy(k, world)).length;
    if (v === "console") return consoleAll ? consoleAll.length : null;
    /* Competitor SITES, as the view lists them. */
    if (v === "competitors") return new Set(r.pages.map((p) => p.domain)).size;
    if (v === q.view) return all.length;
    try {
      return groupsOf(world, v).length;
    } catch {
      return null;
    }
  };

  return c.json<SeoContentGapsPayload>({
    head: h,
    tiles,
    view: q.view,
    keywords: keywordsReading,
    console: consoleReading,
    competitors: competitorsReading,
    selected,
    asked: q,
    german: germanReading,
    price,
    views: VIEWS.map((v) => ({ ...v, count: count(v.key) })),
    groups,
    group,
    needsYou: await reading("desk", () => needsYou()),
    notes: { coverage: COVERAGE_NOTE, impressions: IMPRESSIONS_NOTE(world?.span ?? h.span), volume: VOLUME_NOTE },
    unjudged: world ? { count: world.kw.filter((k) => k.status === "unjudged").length, href: "/seo/keywords?status=unjudged" } : null,
    sitePages: world ? world.view.pages.filter((p) => p.status === 200).map((p) => ({ path: p.path, title: ownTitle(p.title), lang: p.lang })) : [],
    you: { owner: !!me(c).owner },
  });
});

/* ---------- GET /export.csv -------------------------------------------------------------------- */

const yes = (b: boolean | null): string => (b === null ? "" : b ? "yes" : "no");

/**
 * The table the address shows, every row of it: the same filters, search and
 * order as the page, without its paging. ?table=groups gives the coverage
 * list itself. Nothing is exported that the page does not show; an absent
 * figure is an empty cell, never a nought.
 */
routes.get("/export.csv", async (c) => {
  const q: GapQuery = { ...parseQuery(c), offset: 0, limit: 1_000_000 };
  const span = spanOf(rangeFrom(c));
  const { world, absent } = begin(span);
  if (!world) {
    const a = absent<never>();
    return c.json({ error: `There is nothing to export yet: ${a.state === "ok" ? "" : a.reason}` }, 409);
  }
  const w = world;
  const r = rivalsOf();
  const window = span ? `${span.start} to ${span.end}` : "no history";
  let name = q.view as string;
  let headRow: string[] = [];
  let rows: unknown[][] = [];

  const phraseHead = ["Phrase", "Language", "Cluster", "Cluster priority", "Intent", "Asks a price", "Question", "Local", `Impressions (Search Console, ${window})`, "Average position", "Found in", "Mapped page", "A page of its language answers it", "First seen", "Brief"];
  const phraseRow = (k: GapKeyword): unknown[] => [
    k.phrase,
    k.lang,
    k.cluster?.name,
    k.cluster ? w.byKey.get(k.cluster.key)?.priority : null,
    k.intent,
    yes(k.flags.price),
    yes(k.flags.question),
    yes(k.flags.local),
    k.impressions,
    k.position,
    k.sources.join(" "),
    k.page,
    yes(k.covered),
    k.firstSeen.slice(0, 10),
    briefWord(k.brief),
  ];

  if (c.req.query("table") === "groups" && LISTED.includes(q.view)) {
    name = `${q.view}-coverage`;
    headRow = ["Group", "Relevant phrases", "Answered", "Clusters", "Clusters with no page of their language", "Priority", "Audit order", "Price phrases", "Questions", `Impressions (Search Console, ${window})`];
    rows = listed(w, q).shown.map((g) => [g.name, g.coverage.of, g.coverage.covered, g.clusters.of, g.clusters.gaps, g.priority, g.rank, g.price, g.questions, g.impressions]);
  } else if (q.view === "keywords") {
    const briefs = new Map<string, BriefState>();
    headRow = phraseHead;
    rows = keywordRows(w, q).map((k) => phraseRow(keywordRow(w, k, briefs)));
  } else if (q.view === "console") {
    const list = consoleRows(w, q);
    if (!list) {
      const a = historyAbsent<never>();
      return c.json({ error: `There is nothing to export yet: ${a.state === "ok" ? "" : a.reason}` }, 409);
    }
    name = "search-console";
    headRow = ["Search", "Language", `Impressions (Search Console, ${window})`, "Clicks", "Average position", "Page Google showed", "Why it is listed", "Judged", "Cluster", "Brief"];
    rows = list.rows.map((x) => [x.query, x.lang, x.impressions, x.clicks, x.position, x.shown, x.why === "no-page" ? "no page named" : "the page shown lacks the words", x.keyword ? x.keyword.status : "not in the keyword table", x.keyword?.cluster?.name, briefWord(x.brief)]);
  } else if (q.view === "competitors") {
    headRow = ["Site", "Name", "Times seen", "Topics seen for", "Page read", "Kind of page", "Title", "Words", "Language", "States a price", "Read on"];
    for (const s of competitorSites(w, r, q)) for (const p of s.pages) rows.push([s.domain, s.name, s.seen, s.topics.map((t) => t.name).join("; "), p.url, p.address === "ranking" ? "ranking page" : "home page", p.title, p.words || null, p.lang, yes(p.priceStated), p.fetchedAt?.slice(0, 10)]);
  } else {
    const l = listed(w, q);
    const pick = q.open ? (l.all.find((g) => g.key === q.open) ?? fail(404, `There is no group “${q.open}” in this view.`)) : l.shown[0];
    if (!pick) return c.json({ error: "There is nothing to export: no group matches." }, 409);
    const d = groupDetail(w, r, q.view, pick, q);
    name = `${pick.key.replace(/[^a-z0-9-]+/gi, "-")}-${q.tab}`;
    if (d.missing || d.partial) {
      headRow = phraseHead;
      rows = (d.missing ?? d.partial)!.rows.map(phraseRow);
    } else if (d.suggested) {
      headRow = ["Page to make", "Cluster", "Language", "Priority", "Audit order", "Relevant phrases", "Price phrases", "Twin page", "Ranking competitor pages read", "Of them stating a price", "Brief", "Example searches"];
      rows = d.suggested.rows.map((s) => [s.page, s.cluster.name, s.cluster.lang, s.cluster.priority, s.cluster.rank, s.cluster.keywords.relevant, s.cluster.price, s.twin?.page, s.competitors.ranking, s.competitors.priced, briefWord(s.cluster.brief), s.cluster.examples.join("; ")]);
    } else if (d.competitors) {
      headRow = ["Site", "Page read", "Kind of page", "Title", "Words", "Language", "States a price", "Cluster", "Seen for", "Times seen", "Read on"];
      rows = d.competitors.rows.map((p) => [p.domain, p.url, p.address === "ranking" ? "ranking page" : "home page", p.title, p.words || null, p.lang, yes(p.priceStated), p.cluster?.name, p.query, p.seen, p.fetchedAt?.slice(0, 10)]);
    }
  }
  /* The section's one way to answer a CSV: the byte-order mark Excel needs, formula-safe cells. */
  return csvFile(c, `content-gaps-${name}`, headRow, rows);
});

/* ---------- changes ------------------------------------------------------------------------------ */

const idsOf = (v: unknown, most: number, what: string): number[] => {
  if (!Array.isArray(v)) return fail(400, `Send \`${what}\`, a list of phrase ids.`);
  const ids = [...new Set((v as unknown[]).map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0))];
  if (!ids.length) fail(400, "Tick the phrases first.");
  if (ids.length > most) fail(400, `At most ${most} phrases at once; ${ids.length} were sent.`);
  return ids;
};

/** "Create brief": { cluster } for the cluster's missing phrases, or { phrases } for the phrases ticked (one brief per cluster). */
routes.post("/brief", async (c) => {
  const b = await body(c);
  const w = readWorld(spanOf("30d"));
  const asks: { cluster: Cluster; phrases: Keyword[] }[] = [];
  const left: Cluster[] = [];
  if (Array.isArray(b.phrases)) {
    const ids = idsOf(b.phrases, BRIEF_PHRASES_MOST, "phrases");
    const byId = new Map(w.kw.map((k) => [k.id, k]));
    const by = new Map<string, Keyword[]>();
    for (const id of ids) {
      const k = byId.get(id);
      if (!k) fail(404, `There is no phrase #${id}.`);
      if (!k!.cluster || !w.byKey.has(k!.cluster)) fail(409, `“${k!.phrase}” belongs to no cluster, so there is no page to brief for it. File it under a cluster in Keywords first.`);
      by.set(k!.cluster!, [...(by.get(k!.cluster!) ?? []), k!]);
    }
    /* More clusters than are asked at once: the most important are asked, and the answer names the rest. A full page of By keyword spans more than a handful. */
    const order = [...by.keys()].map((key) => w.byKey.get(key)!).sort(clusterOrder(w));
    for (const cl of order.slice(0, BRIEFS_MOST)) asks.push({ cluster: cl, phrases: by.get(cl.key)! });
    left.push(...order.slice(BRIEFS_MOST));
  } else {
    const key = typeof b.cluster === "string" ? b.cluster.trim() : "";
    if (!key) fail(400, "Which cluster? Send `cluster`, or `phrases`.");
    const cl = w.byKey.get(key) ?? fail(404, `There is no cluster ${key}.`);
    asks.push({ cluster: cl, phrases: [] });
  }
  const results: BriefsAnswer["results"] = [];
  for (const a of asks) {
    try {
      results.push(await briefFor(w, a.cluster, a.phrases, me(c)));
    } catch (err) {
      results.push({ cluster: a.cluster.key, ok: false, line: `${a.cluster.name}: ${said(err)}`, task: null });
    }
  }
  for (const cl of left) results.push({ cluster: cl.key, ok: false, line: `${cl.name}: not asked, at most ${BRIEFS_MOST} briefs at once. Tick its phrases again when these are written.`, task: null });
  return c.json<BriefsAnswer>({ ok: true, results });
});

/**
 * A change to the website's code, as Opportunities hands one over
 * (src/cc/routes/seo/opportunities.ts, handToCode): the exact step goes on the
 * studio's to-do list in AI Operator, for whoever changes the website's code,
 * and the opportunity is queued with the entry's number. Only from open, so a
 * second press cannot write a second entry. The next crawl says whether it was
 * done: the opportunity clears when the rules no longer find it.
 *
 * Kept in step with Opportunities' copy by hand; the engine has no such
 * function yet (engine.act only marks a code step queued and puts it nowhere).
 */
function handToCode(row: OpportunityRow, by: Person): OpportunityRow {
  if (row.action.kind !== "code") fail(409, "Its action is not a change to the website's code.");
  if (!row.action.available) fail(409, row.action.why ?? "Its action cannot be taken now.");
  if (row.state.state !== "open") fail(409, `It is ${row.state.state === "in-progress" ? "in progress" : row.state.state} already${row.state.note ? `: ${row.state.note}` : "."}`);
  const where = row.subject.page?.path ?? "the whole site";
  const what = row.action.label && row.action.label !== "Hand to the website's code" ? row.action.label : "Website code";
  const todo = addTodo(
    clip(`${what}, ${where}: ${row.title}`, 158),
    `${row.action.step}\n\nFrom SEO › Content Gaps (/seo/content-gaps), also in Opportunities (/seo/opportunities?open=${encodeURIComponent(row.id)}). The next crawl checks it; the opportunity clears when the rules no longer find it.`,
    by,
  );
  db.prepare("UPDATE cc_seo_opps SET state = 'queued', state_by = ?, state_at = ?, state_note = ? WHERE id = ? AND state = 'open'").run(
    by.name,
    now(),
    `On the to-do list in AI Operator as #${todo.id}, for whoever changes the website's code. The next crawl checks it.`,
    row.id,
  );
  note("seo-action", `On the to-do list for the website's code: ${row.title}`, {
    tone: "info",
    actor: by.name,
    detail: `To-do #${todo.id}, ${where}.`,
    href: `/seo/opportunities?open=${encodeURIComponent(row.id)}`,
    dedupe: `seo:code:${row.id}:${todo.id}`,
  });
  return opportunity(row.id) ?? row;
}

/**
 * A step's brief, queued with a topic that fits the operator's 300 characters
 * whole (fitTopic). engine.act would hand the stored prompt over as it is, and
 * the operator's queue keeps its first 300 characters only, mid-sentence; so
 * the brief is queued here and the opportunity moved exactly as act moves it.
 */
async function briefStep(row: OpportunityRow, by: Person): Promise<OpportunityRow> {
  if (!row.action.available) fail(409, row.action.why ?? "Its action cannot be taken now.");
  const asked: NewTask = { ...(row.action.operator ?? { kind: "brief", depth: "deep" }), kind: "brief", prompt: fitTopic(row.action.operator?.prompt ?? row.title) };
  const task = await createTask(asked, by);
  db.prepare("UPDATE cc_seo_opps SET state = 'queued', state_by = ?, state_at = ?, state_note = ?, task_id = ? WHERE id = ?").run(
    by.name,
    now(),
    `Queued as operator task #${task.id}: it runs on the studio workstation when it is on.`,
    task.id,
    row.id,
  );
  note("seo-action", `Asked for a brief: ${row.title}`, {
    tone: "info",
    actor: by.name,
    detail: `Operator task #${task.id}.`,
    href: `/seo/opportunities?open=${encodeURIComponent(row.id)}`,
    dedupe: `seo:act:${row.id}:${task.id}`,
  });
  return opportunity(row.id) ?? row;
}

/**
 * A step of the German or the price card, taken as Opportunities takes it
 * (its actOn): a brief is queued for the operator with a topic that fits
 * (briefStep), a proposal through engine.act; a change to the website's code
 * goes on the to-do list (handToCode above); the owner's steps and steps in
 * the owner's browser are refused, because they are marked done with their
 * task ("I have done it") once a person did them. Only the steps the cards
 * show are taken.
 */
routes.post("/step", async (c) => {
  const b = await body(c);
  const id = typeof b.id === "string" ? b.id.trim() : "";
  if (!id) fail(400, "Send `id`, one of the German or price steps shown on this page.");
  const w = readWorld(null);
  const row = [...germanSteps(w), ...priceSteps(w, priceOwner())].find((s) => s.id === id) ?? fail(404, `${id} is not one of the German or price steps this page shows. Opportunities has every step.`);
  const by = me(c);
  const a = row.action;
  if (a.kind === "code") return c.json<OpportunityAnswer>({ ok: true, opportunity: handToCode(row, by) });
  if (a.kind === "owner" || a.kind === "chrome") {
    fail(409, a.kind === "owner" ? "Only the owner can do this: it is marked done with its task (“I have done it”) once it is." : "A step taken by hand in the owner's browser: do it, then mark its task done (“I have done it”).");
  }
  if (a.kind === "brief") return c.json<OpportunityAnswer>({ ok: true, opportunity: await briefStep(row, by) });
  return c.json<OpportunityAnswer>({ ok: true, opportunity: await act(id, by) });
});

/** "Generate all briefs": each cluster's brief for its missing phrases, at most ten at once. */
routes.post("/briefs", async (c) => {
  const b = await body(c);
  if (!Array.isArray(b.clusters) || !b.clusters.length) fail(400, "Send `clusters`, the clusters to brief.");
  const keys = [...new Set((b.clusters as unknown[]).map((x) => String(x ?? "").trim()).filter(Boolean))];
  if (keys.length > BRIEFS_MOST) fail(400, `At most ${BRIEFS_MOST} briefs are asked at once: the operator's queue holds twenty tasks.`);
  const w = readWorld(spanOf("30d"));
  const results: BriefsAnswer["results"] = [];
  for (const key of keys) {
    const cl = w.byKey.get(key);
    if (!cl) {
      results.push({ cluster: key, ok: false, line: `There is no cluster ${key}.`, task: null });
      continue;
    }
    try {
      results.push(await briefFor(w, cl, [], me(c)));
    } catch (err) {
      results.push({ cluster: key, ok: false, line: `${cl.name}: ${said(err)}`, task: null });
    }
  }
  return c.json<BriefsAnswer>({ ok: true, results });
});

const JUDGEMENTS: KeywordStatus[] = ["relevant", "weak", "irrelevant"];
const JUDGED_AS: Record<string, string> = { relevant: "relevant", weak: "weak", irrelevant: "not relevant" };

/**
 * A person's judgement of phrases, from the rows ticked here: a phrase that is
 * not a real gap is thrown out without leaving the page, and a search Google
 * reports is taken in. It is the same record Keywords writes (the phrase's
 * status, with who set it), and no run or import changes it again.
 */
routes.post("/judge", async (c) => {
  const b = await body(c);
  const status = JUDGEMENTS.find((s) => s === b.status) ?? fail(400, `status is one of ${JUDGEMENTS.join(", ")}.`);
  const ids = idsOf(b.ids, CHANGE_MOST, "ids");
  const by = me(c);
  const held = new Map(keywords().map((k) => [k.id, k]));
  const found = ids.map((id) => held.get(id)).filter((k): k is Keyword => !!k);
  if (!found.length) fail(404, "None of those phrases is in the keyword table any more.");
  const moved = found.filter((k) => k.status !== status);
  for (const k of moved) setKeywordStatus(k.id, status, by.name);
  const what = found.length === 1 ? quote(found[0]!.phrase) : plural(found.length, "phrase");
  const line = !moved.length
    ? `${what} ${found.length === 1 ? "was" : "were"} judged ${JUDGED_AS[status]} already.`
    : `${what} judged ${JUDGED_AS[status]}${moved.length < found.length ? ` (${moved.length} changed, the rest were so already)` : ""}. ${
        status === "relevant"
          ? "A relevant phrase counts here: as answered when a page of its language is mapped to it, else as a gap."
          : `Only relevant phrases count here, so ${found.length === 1 ? "it is" : "they are"} not ${found.length === 1 ? "a gap" : "gaps"}; Keywords keeps ${found.length === 1 ? "it" : "them"}.`
      }`;
  if (moved.length) {
    note("seo-action", `Judged ${what} ${JUDGED_AS[status]}`, {
      tone: "info",
      actor: by.name,
      detail: moved.length > 1 ? moved.slice(0, 5).map((k) => k.phrase).join("; ") + (moved.length > 5 ? "; …" : "") : undefined,
      href: `/seo/keywords?status=${status}`,
      dedupe: `seo:gaps:judge:${status}:${moved[0]!.id}:${now()}`,
    });
  } else c.set("did", null);
  return c.json<GapChanged>({ ok: true, line, changed: moved.length });
});

/** A site address as the crawl stores it: a full URL of the site is taken by its path; "/x/" is "/x". */
function sitePath(raw: unknown): string | null {
  if (raw === null) return null;
  if (typeof raw !== "string" || !raw.trim()) return fail(400, "path is one of the site's addresses (starting with /), or null: no page answers it.");
  let p = raw.trim();
  if (/^https?:\/\//i.test(p)) {
    try {
      p = new URL(p).pathname;
    } catch {
      fail(400, "That is not an address.");
    }
  }
  if (!p.startsWith("/") || p.length > 300) fail(400, "path is one of the site's addresses, starting with /.");
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

/**
 * A person says which page answers a cluster, or some phrases; or that none
 * does (path null). The page must be one the crawl reads answering 200. This
 * is how a gap is closed once its page is published: the next read counts the
 * cluster as answered when the page is in its language. A person's mapping is
 * kept by every run and import (keywords.ts, byPerson).
 */
routes.post("/map", async (c) => {
  const b = await body(c);
  const path = sitePath(b.path);
  const view = siteView();
  const page = path ? view.byPath.get(path) : undefined;
  if (path && (!page || page.status !== 200)) fail(400, `The crawl reads no page answering at ${path}. A page published since the last crawl is known after the next one.`);
  const by = me(c);
  const cls = clusters();

  if (typeof b.cluster === "string" && b.cluster.trim()) {
    const cl = cls.find((x) => x.key === (b.cluster as string).trim()) ?? fail(404, `There is no cluster ${b.cluster}.`);
    if (cl.page === path && cl.mappedBy === "person") {
      c.set("did", null);
      return c.json<GapChanged>({ ok: true, line: path ? `${quote(cl.name)} is mapped to ${path} already.` : `${quote(cl.name)} has no page already.`, changed: 0 });
    }
    /*
     * Written with the person's name even when no page answers it: setClusterPage
     * clears the name with the page, and the desk's rule (keywords.remap) and the
     * next import then put a page back that the person had just taken away.
     */
    db.prepare("UPDATE cc_seo_clusters SET page = ?, mapped_by = ?, updated_at = ? WHERE key = ?").run(path, by.name, now(), cl.key);
    const other = !!path && !!page?.lang && page.lang !== cl.lang;
    const line = !path
      ? `${quote(cl.name)} has no page again: it counts as a gap.`
      : other
        ? `${quote(cl.name)} is mapped to ${path}, but that page is in ${LANG_NAME[page!.lang!] ?? page!.lang} and the cluster is ${LANG_NAME[cl.lang] ?? cl.lang}: it stays a gap until a page of its language answers it.`
        : `${quote(cl.name)} is answered by ${path} now: it is no longer a gap. Its phrases stay under “Partly answered” until the page's title, heading or address carries their words, or a person maps them.`;
    note("seo-action", path ? `Mapped the cluster ${quote(cl.name)} to ${path}` : `Took the page from the cluster ${quote(cl.name)}`, {
      tone: "info",
      actor: by.name,
      href: `/seo/content-gaps?view=clusters&open=${encodeURIComponent(cl.key)}`,
      dedupe: `seo:gaps:map:${cl.key}:${now()}`,
    });
    return c.json<GapChanged>({ ok: true, line, changed: 1 });
  }

  const ids = idsOf(b.phrases, CHANGE_MOST, "phrases");
  const held = new Map(keywords().map((k) => [k.id, k]));
  const found = ids.map((id) => held.get(id)).filter((k): k is Keyword => !!k);
  if (!found.length) fail(404, "None of those phrases is in the keyword table any more.");
  const moved = found.filter((k) => k.page !== path);
  /* A person's mapping, kept by every run and import; "no page" is a person's word too. */
  const put = db.prepare("UPDATE cc_seo_keywords SET page = ?, mapped_by = ? WHERE id = ?");
  for (const k of moved) put.run(path, by.name, k.id);
  const what = found.length === 1 ? quote(found[0]!.phrase) : plural(found.length, "phrase");
  const byKey = new Map(cls.map((x) => [x.key, x]));
  const foreign = path && page?.lang ? found.filter((k) => (langOf(k, byKey) ?? page.lang) !== page.lang).length : 0;
  const line = !moved.length
    ? `${what} ${found.length === 1 ? "was" : "were"} mapped so already.`
    : path
      ? `${what} ${found.length === 1 ? "is" : "are"} answered by ${path}${foreign ? `; ${foreign === found.length ? "but the page is in another language, so " + (found.length === 1 ? "it stays" : "they stay") + " unanswered here" : `${foreign} of them in another language than the page stay unanswered here`}` : ""}.`
      : `${what}: no page answers ${found.length === 1 ? "it" : "them"}, by your word.`;
  if (moved.length) {
    note("seo-action", path ? `Mapped ${what} to ${path}` : `Took the page from ${what}`, { tone: "info", actor: by.name, href: "/seo/content-gaps?view=keywords", dedupe: `seo:gaps:map:${moved[0]!.id}:${now()}` });
  } else c.set("did", null);
  return c.json<GapChanged>({ ok: true, line, changed: moved.length });
});
