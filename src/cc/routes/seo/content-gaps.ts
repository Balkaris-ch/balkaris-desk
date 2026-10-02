import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { db } from "../../../db.ts";
import type { Person } from "../../../people.ts";
import { me, type Vars } from "../../access.ts";
import { createTask } from "../../operator/queue.ts";
import { addTodo } from "../../operator/todos.ts";
import { note, off, ok, reading, setState, state as kept, waiting } from "../../store.ts";
import type { Reading, Stat } from "../../../../web/src/contract/common.ts";
import type { TaskState } from "../../../../web/src/contract/operator.ts";
import type { OpportunityAnswer, OpportunityRow, OwnerTaskRow, Priority, SeoSpan } from "../../../../web/src/contract/seo/common.ts";
import type {
  BriefsAnswer,
  BriefState,
  ClusterDetail,
  ClusterRow,
  CompetitorPage,
  GapGroup,
  GapKeyword,
  GapQuery,
  GapTab,
  GapTiles,
  GapView,
  GermanGap,
  GroupDetail,
  PriceGap,
  SeoContentGapsPayload,
  Suggestion,
} from "../../../../web/src/contract/seo/content-gaps.ts";
import { competitorPages, ENGINE_LABEL, sightings, type CompPageRow, type SightingRow } from "../../seo/competitors.ts";
import { act, allOpportunities, clusterNames, opportunity, toRow } from "../../seo/engine.ts";
import { clusters, keywords, type Cluster, type Keyword } from "../../seo/keywords.ts";
import { ownerTasks, type OwnerTask } from "../../seo/owner.ts";
import { queryFigures, spanOf } from "../../seo/rank.ts";
import { pageReadiness } from "../../seo/readiness.ts";
import { PRIORITY_RANK } from "../../seo/rules.ts";
import { siteView, type SiteView } from "../../seo/site.ts";
import { json, now } from "../../seo/tables.ts";
import { normal } from "../../seo/words.ts";
import { body, head, int, rangeFrom } from "./shared.ts";

/**
 * /api/v1/seo/content-gaps: SEO › Content Gaps (board 113, panel 5).
 *
 *   GET  /         the whole page: the two largest gaps (German, price
 *                  questions), the coverage list of the view asked (by topic,
 *                  industry, language or cluster), the open group with its
 *                  missing phrases, partly answered phrases, the pages to make
 *                  and the competitor pages read for it; or the keyword and
 *                  competitor views
 *   POST /brief    "Create brief": one operator brief per cluster, for the
 *                  phrases sent (a row's own phrase, or the ticked ones), or
 *                  for the cluster's missing phrases when a cluster is sent
 *   POST /briefs   "Generate all briefs": each named cluster's brief for its
 *                  missing phrases, in this page's words (promptFor)
 *   POST /step     one of the German or price steps the cards show, taken as
 *                  Opportunities takes it: a brief queued, a code change put
 *                  on the to-do list; the owner's steps refused
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
 * remembered here (cc_state, BRIEFS_KEY) for the same reason.
 */

export const routes = new Hono<Vars>();

const VIEWS: { key: GapView; label: string }[] = [
  { key: "topic", label: "By topic" },
  { key: "industry", label: "By industry" },
  { key: "language", label: "By language" },
  { key: "clusters", label: "By cluster" },
  { key: "keywords", label: "By keyword" },
  { key: "competitors", label: "By competitor" },
];
const TABS: GapTab[] = ["missing", "partial", "suggested", "competitors"];
const PRIORITIES: Priority[] = ["high", "medium", "low"];
/** "Generate all briefs" queues at most this many at once; the operator's queue holds twenty. */
const BRIEFS_MOST = 10;
/** "Create brief" for ticked phrases: at most this many clusters, and phrases, at once. */
const BRIEF_CLUSTERS_MOST = 5;
const BRIEF_PHRASES_MOST = 60;
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
  return { view, cls, byKey, names, kw, relevant, figures, span, facts, opps, loose: looseBriefs() };
}

/* ---------- briefs ----------------------------------------------------------------------- */

const gapOppId = (c: Cluster): string => `${c.lang === "de" ? "german-missing" : "keyword-gap"}:${c.key}`;
const BUSY: TaskState[] = ["queued", "running"];
const taskHref = (id: number): string => `/operator?result=${id}#response`;

function briefState(w: World, c: Cluster): BriefState {
  const f = w.facts.get(c.key);
  const o = w.opps.get(gapOppId(c));
  if (o && o.active && f?.gap) {
    const t = o.state.task;
    const closed = o.state.state === "done" || o.state.state === "dismissed";
    return {
      opportunityId: o.id,
      state: o.state.state,
      available: !closed && !(t && BUSY.includes(t.state)),
      why: closed ? `Its opportunity is ${o.state.state}; open it again in Opportunities to ask for another brief.` : t && BUSY.includes(t.state) ? `Operator task #${t.id} is ${t.state}.` : null,
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
    why: busy ? `Operator task #${loose!.id} is ${loose!.state}.` : f && !f.relevant.length ? "No phrase of this cluster is judged relevant." : null,
    task: loose ? { id: loose.id, state: loose.state, href: taskHref(loose.id) } : null,
    note: null,
  };
}

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

/** Queue one brief for a cluster and link it where it can be followed. */
async function briefFor(w: World, c: Cluster, phrases: Keyword[], by: Person): Promise<BriefsAnswer["results"][number]> {
  const st = briefState(w, c);
  if (!st.available) return { cluster: c.key, ok: false, line: `${c.name}: ${st.why ?? "its brief cannot be asked now."}`, task: null };
  const f = w.facts.get(c.key)!;
  const list = (phrases.length ? phrases : f.relevant.filter((k) => !coveredBy(k, w))).sort(phraseOrder(w));
  if (!list.length) return { cluster: c.key, ok: false, line: `${c.name}: every relevant phrase already has a page of its language.`, task: null };
  const task = await createTask({ kind: "brief", prompt: promptFor(w, c, list), depth: "deep" }, by);
  const at = now();
  if (st.opportunityId) {
    db.prepare("UPDATE cc_seo_opps SET state = 'queued', state_by = ?, state_at = ?, state_note = ?, task_id = ? WHERE id = ?").run(
      by.name,
      at,
      `Queued as operator task #${task.id}: it runs on the studio workstation when it is on.`,
      task.id,
      st.opportunityId,
    );
  } else {
    const map = json<Record<string, number>>(kept(BRIEFS_KEY), {});
    map[c.key] = task.id;
    setState(BRIEFS_KEY, JSON.stringify(map));
  }
  note("seo-action", `Asked for a brief: ${c.name}`, {
    tone: "info",
    actor: by.name,
    detail: `Operator task #${task.id}, ${plural(list.length, "phrase")}${f.gap ? "; a person writes and publishes the page" : `; for ${c.page}`}.`,
    href: `/seo/content-gaps?view=clusters&open=${encodeURIComponent(c.key)}`,
    dedupe: `seo:gaps:brief:${c.key}:${task.id}`,
  });
  return { cluster: c.key, ok: true, line: `${c.name}: queued as operator task #${task.id}.`, task: task.id };
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
    brief,
  };
}

const priorityOf = (list: Priority[]): Priority => list.reduce<Priority>((best, p) => (PRIORITY_RANK[p] < PRIORITY_RANK[best] ? p : best), "low");

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

/* ---------- competitors ----------------------------------------------------------------------- */

interface Rivals {
  pages: CompPageRow[];
  seen: SightingRow[];
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
  return { pages, seen };
}

function competitorRows(w: World, r: Rivals, keys: Set<string>): CompetitorPage[] {
  const seen = new Map<string, number>();
  for (const s of r.seen) if (s.cluster && keys.has(s.cluster)) seen.set(s.domain, (seen.get(s.domain) ?? 0) + 1);
  return r.pages
    .filter((p) => p.cluster && keys.has(p.cluster))
    .map((p) => ({
      domain: p.domain,
      url: p.url,
      title: p.title,
      words: p.words,
      lang: p.lang ? p.lang.toLowerCase().split("-")[0]! : null,
      priceStated: p.priceStated,
      cluster: p.cluster ? { key: p.cluster, name: w.names.get(p.cluster) ?? p.cluster } : null,
      query: p.query,
      seen: seen.get(p.domain) ?? 0,
      fetchedAt: p.fetchedAt,
    }))
    .sort((a, b) => b.seen - a.seen || a.domain.localeCompare(b.domain) || a.url.localeCompare(b.url));
}

/* ---------- the open group ----------------------------------------------------------------- */

function suggestionOf(w: World, r: Rivals, c: Cluster): Suggestion {
  const row = clusterRow(w, c);
  const o = row.opportunityId ? w.opps.get(row.opportunityId) : undefined;
  const pages = r.pages.filter((p) => p.cluster === c.key);
  /* The audit's first sentence when it names the page to make, whole (the page clamps it to two lines and keeps it all in its title); else ours. */
  const said = c.action?.split(/(?<=[.!?])\s/)[0]?.trim() ?? "";
  const page = /^(create|write|build|add|publish|make)\b/i.test(said)
    ? clipWords(said, 400)
    : `${c.lang === "de" ? "A German (de-CH) page" : "A page"} that answers “${plainName(c.name)}”${row.examples[0] ? `, starting with “${row.examples[0]}”` : ""}`;
  return {
    cluster: row,
    page,
    potential: o?.potential ?? null,
    competitors: { pages: pages.length, priced: pages.filter((p) => p.priceStated).length, german: pages.filter((p) => (p.lang ?? "").toLowerCase().startsWith("de")).length },
  };
}

function groupDetail(w: World, r: Rivals, view: GapView, g: GapGroup, q: GapQuery): GroupDetail {
  const list = groupClusters(w, view, g.key).sort((a, b) => {
    const fa = w.facts.get(a.key)!;
    const fb = w.facts.get(b.key)!;
    return Number(fb.gap) - Number(fa.gap) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.rank ?? 9999) - (b.rank ?? 9999) || fb.relevant.length - fa.relevant.length;
  });
  const keys = new Set(list.map((c) => c.key));
  const order = phraseOrder(w);
  const open = groupPhrases(w, view, g.key)
    .filter((k) => !coveredBy(k, w))
    .sort(order);
  const gapOf = (k: Keyword): boolean => !k.cluster || (w.facts.get(k.cluster)?.gap ?? true);
  const missing = open.filter(gapOf);
  const partial = open.filter((k) => !gapOf(k));
  const gaps = list.filter((c) => w.facts.get(c.key)!.gap);
  const comps = competitorRows(w, r, keys);
  const briefs = new Map<string, BriefState>();
  /* One page of a table: the offset asked, kept inside the rows. */
  const slice = <T, U>(rows: T[], map: (x: T) => U) => {
    const offset = Math.min(q.offset, Math.max(0, rows.length - 1 - ((rows.length - 1) % q.limit)));
    return { total: rows.length, offset, limit: q.limit, rows: rows.slice(offset, offset + q.limit).map(map) };
  };
  const page = (rows: Keyword[]) => slice(rows, (k) => keywordRow(w, k, briefs));
  const states = gaps.map((c) => ({ c, st: briefState(w, c) }));
  return {
    group: g,
    tab: q.tab,
    counts: { missing: missing.length, partial: partial.length, suggested: gaps.length, competitors: comps.length },
    missing: q.tab === "missing" ? page(missing) : null,
    partial: q.tab === "partial" ? page(partial) : null,
    suggested: q.tab === "suggested" ? slice(gaps, (c) => suggestionOf(w, r, c)) : null,
    competitors: q.tab === "competitors" ? slice(comps, (p) => p) : null,
    clusters: list.filter((c) => w.facts.get(c.key)!.relevant.length > 0).map((c) => clusterRow(w, c)),
    briefs: {
      ready: states.filter((s) => s.st.available).map((s) => s.c.key),
      queued: states.filter((s) => s.st.task && BUSY.includes(s.st.task.state)).length,
      total: gaps.length,
    },
  };
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
  const listed = w.view.pages.filter((p) => p.inSitemap && p.status === 200);
  const pages = { de: 0, en: 0, other: 0, total: listed.length, hreflang: null as number | null };
  for (const p of listed) pages[p.lang === "de" ? "de" : p.lang === "en" ? "en" : "other"]++;
  try {
    const r = pageReadiness();
    if (r.checkedAt) pages.hreflang = r.pages.filter((p) => p.checks.some((c) => c.key === "german" && c.state === "pass")).length;
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
    now(),
    `Relevant phrases of the keyword table (the audit's research, Search Console and Google Autocomplete), counted by the language they are searched in; the site's pages by the html lang the crawl read${w.view.at ? ` on ${w.view.at.slice(0, 10)}` : ""}.`,
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
      competitors: comp.length ? { pages: comp.length, priced: comp.filter((p) => p.priceStated).length } : null,
      top: priceClusters
        .filter((c) => w.facts.get(c.key)!.gap)
        .sort((a, b) => w.facts.get(b.key)!.price - w.facts.get(a.key)!.price || clusterOrder(w)(a, b))
        .slice(0, 5)
        .map((c) => clusterRow(w, c)),
      steps: priceSteps(w, owner),
      owner,
    },
    "desk",
    now(),
    "A phrase asks a price when it carries kosten, kostet, preis, price, cost, how much, tarif, budget or CHF (src/cc/seo/words.ts). Pages that state a price: the readiness check's CHF test on the pages it applies to (service and landing pages).",
  );
}

const ownerRow = ({ whoAll: _who, ...t }: OwnerTask): OwnerTaskRow => t;

/** What only the owner can do that would close or measure a content gap. */
function needsYou(): Reading<OwnerTaskRow[]> {
  const fits = (t: OwnerTask): boolean => t.id === "price-ranges" || t.id === "mobile-apps-decision" || /\bprice ranges?\b|keyword planner|mobile apps?\b/i.test(t.title);
  const list = ownerTasks(["owner", "content", "code", "lead-chrome"]).filter(fits);
  return ok(list.map(ownerRow), "desk", now(), "From the SEO audit's owner tasks: only the owner decides prices and what the studio sells, and only the owner's Google Ads account opens Keyword Planner.");
}

/* ---------- the query ----------------------------------------------------------------------- */

function parseQuery(c: Context<Vars>): GapQuery {
  const q = (k: string): string => (c.req.query(k) ?? "").trim();
  const view = VIEWS.find((v) => v.key === q("view"))?.key ?? "topic";
  const lang = q("lang");
  const gap = q("gap");
  const priority = PRIORITIES.find((p) => p === q("priority")) ?? "all";
  return {
    view,
    open: q("open") || null,
    tab: TABS.find((t) => t === q("tab")) ?? "missing",
    lang: lang === "de" || lang === "en" ? lang : "all",
    price: q("price") === "1",
    question: q("question") === "1",
    gap: gap === "1" || gap === "0" ? gap : "all",
    priority,
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

routes.get("/", async (c) => {
  const range = rangeFrom(c);
  const q = parseQuery(c);
  const h = head(range);

  let w: World | null = null;
  let broke: string | null = null;
  try {
    w = readWorld(h.span);
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
  const absent = <T>(): Reading<T> => (none as Reading<T> | null) ?? waiting<T>("desk", broke ?? "The keyword table could not be read.");
  const r = rivalsOf();
  const world = !none ? w : null;

  /* Tiles: counts of the table, each its own reading. */
  const tile = (make: (w: World) => Stat): Promise<Reading<Stat>> => (world ? reading("desk", () => ok(make(world), "desk", now(), COVERAGE_NOTE)) : Promise.resolve(absent<Stat>()));
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

  const german = world ? await reading("desk", () => germanGap(world)) : absent<GermanGap>();
  const price = world ? await reading("desk", () => priceGap(world, r)) : absent<PriceGap>();

  /* The coverage list and the open group. */
  let groups: SeoContentGapsPayload["groups"] = null;
  let group: SeoContentGapsPayload["group"] = null;
  let all: GapGroup[] = [];
  if (q.view === "topic" || q.view === "industry" || q.view === "language" || q.view === "clusters") {
    if (world) {
      try {
        all = groupsOf(world, q.view);
        const shown = all.filter(
          (g) =>
            (q.priority === "all" || g.priority === q.priority) &&
            (q.gap === "all" || (q.gap === "1" ? g.coverage.covered < g.coverage.of : g.coverage.covered === g.coverage.of)),
        );
        groups = ok({ rows: shown }, "desk", now(), COVERAGE_NOTE);
        const pick = q.open ? (all.find((g) => g.key === q.open) ?? null) : (shown[0] ?? null);
        if (q.open && !pick) group = off("desk", `There is no group “${q.open}” in this view: the clusters may have been renamed, or the address is old.`);
        else if (pick) group = await reading("desk", () => ok(groupDetail(world, r, q.view, pick, q), "desk", now(), `${COVERAGE_NOTE} ${IMPRESSIONS_NOTE(world.span)}`));
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
          const gapOf = (k: Keyword): boolean => !k.cluster || (world.facts.get(k.cluster)?.gap ?? true);
          const rows = world.relevant
            .filter((k) => !coveredBy(k, world))
            .filter((k) => q.lang === "all" || langOf(k, world.byKey) === q.lang)
            .filter((k) => !q.price || k.flags.price)
            .filter((k) => !q.question || k.flags.question)
            .filter((k) => q.gap === "all" || (q.gap === "1") === gapOf(k))
            .filter((k) => q.priority === "all" || (k.cluster ? world.byKey.get(k.cluster)?.priority === q.priority : false))
            .sort(phraseOrder(world));
          const offset = Math.min(q.offset, Math.max(0, rows.length - 1 - ((rows.length - 1) % q.limit)));
          const briefs = new Map<string, BriefState>();
          return ok({ total: rows.length, offset, limit: q.limit, rows: rows.slice(offset, offset + q.limit).map((k) => keywordRow(world, k, briefs)) }, "desk", now(), `${COVERAGE_NOTE} ${IMPRESSIONS_NOTE(world.span)}`);
        })
      : absent();
  }

  /* view=competitors: the competitor pages read for each cluster's searches. */
  let competitorsReading: SeoContentGapsPayload["competitors"] = null;
  if (q.view === "competitors") {
    competitorsReading = world
      ? await reading("desk", () => {
          if (!r.pages.length)
            return waiting("desk", "No competitor page has been read yet: the competitor job reads the pages the audit saw beside Balkaris in Google and the AI assistants, one request every two seconds per site.");
          const by = new Map<string, CompPageRow[]>();
          for (const p of r.pages) if (p.cluster) by.set(p.cluster, [...(by.get(p.cluster) ?? []), p]);
          const seen = new Map<string, number>();
          for (const s of r.seen) if (s.cluster) seen.set(`${s.cluster}\u0000${s.domain}`, (seen.get(`${s.cluster}\u0000${s.domain}`) ?? 0) + 1);
          const rows = [...by.entries()]
            .map(([key, pages]) => ({ c: world.byKey.get(key), key, pages }))
            .sort((a, b) => (a.c && b.c ? clusterOrder(world)(a.c, b.c) : a.c ? -1 : b.c ? 1 : a.key.localeCompare(b.key)))
            .map(({ key, pages }) => ({
              cluster: { key, name: world.names.get(key) ?? key },
              pages: pages
                .map((p) => ({ domain: p.domain, url: p.url, title: p.title, words: p.words, lang: p.lang, priceStated: p.priceStated, seen: seen.get(`${key}\u0000${p.domain}`) ?? 0 }))
                .sort((a, b) => b.seen - a.seen || a.domain.localeCompare(b.domain)),
            }));
          const at = r.pages.map((p) => p.fetchedAt ?? "").sort().at(-1) ?? now();
          return ok({ rows }, "desk", at, "Competitor pages the desk read (one request every two seconds per site) for the searches the audit captured: what they answer, in which language, whether they state a price. “Seen” counts the captured results they appeared in for that cluster.");
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
            const detail: ClusterDetail = {
              cluster: clusterRow(world, cl),
              phrases,
              opportunity: opp && opp.active ? opp : null,
              competitors: r.pages
                .filter((p) => p.cluster === cl.key)
                .map((p) => ({ domain: p.domain, url: p.url, title: p.title, h1: p.h1, words: p.words, lang: p.lang, schemaTypes: p.schemaTypes, priceStated: p.priceStated, fetchedAt: p.fetchedAt })),
              sightings: r.seen.filter((s) => s.cluster === cl.key).slice(0, 40).map((s) => ({ domain: s.domain.replace(/^name:/, ""), engine: ENGINE_LABEL[s.engine] ?? s.engine, kind: s.kind, query: s.query, position: s.position, day: s.day })),
            };
            return ok(detail, "desk", now(), COVERAGE_NOTE);
          });
    }
  }

  const count = (v: GapView): number | null => {
    if (!world) return null;
    if (v === "keywords") return world.relevant.filter((k) => !coveredBy(k, world)).length;
    if (v === "competitors") return new Set(r.pages.map((p) => p.cluster).filter(Boolean)).size;
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
    competitors: competitorsReading,
    selected,
    asked: q,
    german,
    price,
    views: VIEWS.map((v) => ({ ...v, count: count(v.key) })),
    groups,
    group,
    needsYou: await reading("desk", () => needsYou()),
    notes: { coverage: COVERAGE_NOTE, impressions: IMPRESSIONS_NOTE(world?.span ?? h.span), volume: VOLUME_NOTE },
  });
});

/* ---------- changes ------------------------------------------------------------------------------ */

/** "Create brief": { cluster } for the cluster's missing phrases, or { phrases } for the phrases ticked (one brief per cluster). */
routes.post("/brief", async (c) => {
  const b = await body(c);
  const w = readWorld(spanOf("30d"));
  const asks: { cluster: Cluster; phrases: Keyword[] }[] = [];
  if (Array.isArray(b.phrases)) {
    const ids = [...new Set((b.phrases as unknown[]).map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0))];
    if (!ids.length) fail(400, "Tick the phrases first.");
    if (ids.length > BRIEF_PHRASES_MOST) fail(400, `At most ${BRIEF_PHRASES_MOST} phrases at once.`);
    const byId = new Map(w.kw.map((k) => [k.id, k]));
    const by = new Map<string, Keyword[]>();
    for (const id of ids) {
      const k = byId.get(id);
      if (!k) fail(404, `There is no phrase #${id}.`);
      if (!k!.cluster || !w.byKey.has(k!.cluster)) fail(409, `“${k!.phrase}” belongs to no cluster, so there is no page to brief for it. File it under a cluster in Keywords first.`);
      by.set(k!.cluster!, [...(by.get(k!.cluster!) ?? []), k!]);
    }
    if (by.size > BRIEF_CLUSTERS_MOST) fail(400, `The ticked phrases belong to ${by.size} clusters; at most ${BRIEF_CLUSTERS_MOST} briefs are asked at once.`);
    for (const [key, phrases] of by) asks.push({ cluster: w.byKey.get(key)!, phrases });
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
 * A step of the German or the price card, taken as Opportunities takes it
 * (its actOn): a brief or a proposal is queued for the operator (engine.act);
 * a change to the website's code goes on the to-do list (handToCode above);
 * the owner's steps and steps in the owner's browser are refused, because
 * they are marked done with their task ("I have done it") once a person did
 * them. Only the steps the cards show are taken.
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

