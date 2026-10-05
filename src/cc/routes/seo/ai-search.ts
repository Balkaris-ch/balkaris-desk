import { Hono, type Context } from "hono";
import { z } from "zod";
import { areaLevel } from "../../../grants.ts";
import type { Person } from "../../../people.ts";
import { me, requireOwner, type Vars } from "../../access.ts";
import * as ga4 from "../../ga4.ts";
import { hasKey } from "../../gauth.ts";
import { createTask } from "../../operator/queue.ts";
import { runNow, status as jobStatus } from "../../scheduler.ts";
import * as bing from "../../search/bing.ts";
import { addDays } from "../../search/shared.ts";
import { sources } from "../../sources.ts";
import { note, off, ok, reading, today, waiting } from "../../store.ts";
import type { ApiError, Reading, SourceId } from "../../../../web/src/contract/common.ts";
import type { NewTask, TaskAnswer } from "../../../../web/src/contract/operator.ts";
import type {
  AiAnswerNow,
  AiAnswers,
  AiAsking,
  AiCell,
  AiCheckRow,
  AiChecks,
  AiCrawlers,
  AiDone,
  AiEngine,
  AiJob,
  AiLever,
  AiListings,
  AiQuestionDetail,
  AiQuestionRow,
  AiReferrals,
  AiRound,
  AiSearchAsked,
  AskedPhrase,
  CitedListing,
  ImportStep,
  ManualImport,
  NewAiCheck,
  PageCheckAnswer,
  PageReadiness,
  PageReadinessAnswer,
  Readiness,
  ReadinessCheck,
  ReadinessTally,
  RecordAnswer,
  RoundAnswer,
  SeoAiSearchPayload,
} from "../../../../web/src/contract/seo/ai-search.ts";
import type { ProfileRow } from "../../../../web/src/contract/seo/backlinks.ts";
import type { OpportunitiesActed, OpportunityRow, OpportunityType, OwnerTaskAnswer, OwnerTaskRow, SeoRange } from "../../../../web/src/contract/seo/common.ts";
import {
  addCheck,
  aiCrawlers,
  aiLabel,
  AI_RULE,
  checkById,
  checkRefusal,
  checks,
  editCheck,
  ENGINE_LABEL,
  guessLang,
  isAi,
  lastImport,
  parseRound,
  qKey,
  questionRefusal,
  referrals,
  referralSpan,
  removeCheck,
  setQuestion,
  trackedQuestions,
  type ImportKind,
  type TrackedQuestion,
} from "../../seo/aisearch.ts";
import { PLATFORMS } from "../../seo/competitors.ts";
import { act, allOpportunities, clusterNames, opportunityDb, rank, toRow } from "../../seo/engine.ts";
import { latestInspection } from "../../seo/indexation.ts";
import { keywords } from "../../seo/keywords.ts";
import { headOf, markOwnerTask, ownerTask, ownerTasks, type OwnerTask } from "../../seo/owner.ts";
import { napMatrix, profiles } from "../../seo/presence.ts";
import { daysOf, lastSnapDay, queryFigures } from "../../seo/rank.ts";
import { checkPage, lastRun, pageReadiness, readinessOf, siteReadiness } from "../../seo/readiness.ts";
import { TYPE_LABEL } from "../../seo/rules.ts";
import { ownTitle, siteView, type SiteView } from "../../seo/site.ts";
import { body, csvFile, head, operatorPanel, rangeFrom } from "./shared.ts";

/**
 * /api/v1/seo/ai-search — AI search visibility: whether AI assistants name
 * Balkaris, where their answers look, who comes to the site from them, and
 * what would move the share.
 *
 *   GET  /?range=&q=&show=&engine=&open=&named=&who=&fail=&find=&kind=&pages=&page=&psort=&asking=
 *                                the whole page (SeoAiSearchPayload); every filter, search and opened
 *                                row is in the address (AiSearchAsked), so a view can be reloaded and shared
 *   GET  /page?path=/a-page      one page's readiness checks with what each read (PageReadinessAnswer)
 *   GET  /question?q=…           one question with every answer kept ({ question: AiQuestionDetail | null })
 *   GET  /export?what=answers|readiness|named|directories   a CSV
 *
 *   POST /record          OWNER  { check: NewAiCheck }: one answer as a person read it (RecordAnswer)
 *   POST /round           OWNER  { checks } | { text, engine?, day? }: a whole round, typed or pasted (RoundAnswer)
 *   POST /record/:id      OWNER  { check }: correct a record (AiDone)
 *   POST /record/:id/remove, DELETE /record/:id   OWNER   remove a record (AiDone)
 *   POST /questions       OWNER  { question, lang?, kind?, active }: track a question or retire it (AiDone)
 *   POST /page/check             { path }: read one page again now and judge it (PageCheckAnswer)
 *   POST /readiness/run          the readiness check of every page, now (AiDone)
 *   POST /visits/run             GA4's read of the assistants' visits, now (AiDone)
 *   POST /act                    { ids }: an opportunity's action (OpportunitiesActed)
 *   POST /owner                  { id, done }: an owner task's done mark; the owner's own steps are his (OwnerTaskAnswer)
 *   POST /task                   NewTask: a task for the operator, the studio workstation's own model (TaskAnswer)
 *
 * Every change of this page goes through this page's own addresses, so the
 * owner's switch for AI Search decides who may press its buttons (until this
 * file had /act, /owner and /task, they posted to the Overview's and followed
 * the Overview's switch). The monthly imports stay the engine's own
 * (POST /api/v1/seo/imports/<kind>, the owner's). Nothing here changes the
 * live website; the operator's tasks run on the studio workstation's model,
 * never a hosted one, and what they propose waits for approval.
 *
 * WHERE EACH PANEL COMES FROM. The answers are the AI checks as recorded (the
 * audit, a person in a browser, an API): never sampled, never guessed. Every
 * figure counts each assistant's newest answer to each question; a later
 * record of the same question, assistant and day takes the earlier one's
 * place. The questions are the ones a person put on the list plus every
 * question ever recorded, until a person retires one. Visits are GA4's
 * sessions from AI assistants (consenting visitors only), crawler requests
 * Vercel's request records once the drain delivers them, readiness the desk's
 * own daily read of every sitemap page, the levers the desk's own tables (URL
 * Inspection, profiles, owner tasks, keyword table, crawl), "Questions people
 * search" the keyword table with Search Console's impressions. Each panel is
 * its own reading, so one source that fails costs one panel. No figure on
 * this page is an estimate.
 */
export const routes = new Hono<Vars>();

/* ---------- small helpers ---------------------------------------------------------------------- */

const fmt = (n: number): string => n.toLocaleString("en-GB");
const plural = (n: number, one: string, many = `${one}s`): string => `${fmt(n)} ${n === 1 ? one : many}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDay = (d: string): string => {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return `${day} ${MONTHS[(m ?? 1) - 1]} ${y}`;
};
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** "a, b and c". */
const listed = (xs: string[], most = 5): string => {
  const shown = xs.slice(0, most);
  const more = xs.length - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${fmt(more)} more`;
  return shown.length < 2 ? (shown[0] ?? "") : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
};

/** The Zurich calendar day of an ISO time. */
const zurichDay = (iso: string): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(iso));

/** The window GA4 and the drain count in: whole days, ending yesterday (as the Overview counts). */
const dayWindow = (range: SeoRange): { start: string; end: string } => ({ start: today(-daysOf(range)), end: today(-1) });

/** Whole days from start to end, both counted. */
const daysBetween = (start: string, end: string): number => Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000) + 1;

const job = (name: string) => safe(null, () => jobStatus().find((j) => j.name === name) ?? null);

/** A job as a panel tells it. */
function jobOf(name: string): AiJob | null {
  const j = job(name);
  if (!j) return null;
  const p = j.progress;
  return {
    running: j.running,
    progress: j.running && p ? `${fmt(p.done)} of ${fmt(p.of)}${p.what ? `: ${p.what}` : ""}` : null,
    lastStart: j.lastStart,
    lastOk: j.lastOk,
    lastNote: j.lastNote,
    ready: j.ready && j.enabled,
  };
}

const safe = <T>(fallback: T, f: () => T): T => {
  try {
    return f();
  } catch {
    return fallback;
  }
};

/** The operator's queue takes a question of at most this many characters (operator/queue.ts `createTask`): a longer suggestion would be refused when pressed. */
const PROMPT_MOST = 1000;

const ENGINES = Object.keys(ENGINE_LABEL) as AiEngine[];

/** Everything a page's figures read only once per answer. */
interface Ctx {
  range: SeoRange;
  asked: AiSearchAsked;
  view: SiteView;
  /** Every record kept, newest day first. */
  all: AiCheckRow[];
  /** One per question, assistant and day: the latest record of each. The rounds count these. A retired question's are left out. */
  byDay: AiCheckRow[];
  /** Each assistant's newest answer to each question: what every other figure counts. A retired question's are left out. */
  rows: AiCheckRow[];
  /** The same, retired questions included: what a retired question opened by its address shows. */
  everyRow: AiCheckRow[];
  /** Records a later record of the same question, assistant and day replaced (kept, not counted). */
  replaced: number;
  /** The list a person keeps: questions put on it by hand and the ones retired. */
  tracked: TrackedQuestion[];
  tasks: OwnerTask[];
  open: OpportunityRow[];
}

/**
 * A task's title as the page prints it. The engine's titles end at the first
 * sentence, and a numbered list ("in this order: 1. …") cut one after "1":
 * such a title is made again from the step's first sentence, ended at its
 * colon. (The engine's own rule is src/cc/seo/owner.ts titleOf.)
 */
const tidyTitle = (t: { title: string; step?: string }): string => {
  if (!/[:,]\s*\d+$/.test(t.title)) return t.title;
  const head = headOf((t.step ?? t.title).replace(/\s+/g, " "));
  const colon = head.indexOf(": ");
  return (colon >= 25 ? head.slice(0, colon) : t.title.replace(/[:,]\s*\d+$/, "")).replace(/[.:]$/, "");
};

/**
 * Owner tasks the profiles and this page name by an id the audit's task list
 * does not use: the profiles of local.ch and search.ch point at
 * "local-listings", which the task list files as "local-business-lists".
 * Without this a cited directory where Balkaris is not listed read "No task
 * recorded".
 */
const TASK_ALIAS: Record<string, string> = { "local-listings": "local-business-lists" };

const taskRef = (t: OwnerTask | undefined | null) => (t ? { id: t.id, title: tidyTitle(t), done: t.done, doneBy: t.doneBy } : null);
const taskOf = (ctx: Ctx, id: string | null | undefined): OwnerTask | undefined => {
  if (!id) return undefined;
  const alias = TASK_ALIAS[id];
  return ctx.tasks.find((t) => t.id === id) ?? (alias ? ctx.tasks.find((t) => t.id === alias) : undefined);
};

/** Lower case letters and digits only: "example.ch", "Example-ch" and "example ch" are one key. */
const key = (s: string): string =>
  s
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]/g, "");

/** Questions that name Balkaris or its address themselves: an answer naming it is prompted. */
const PROMPTED = new Set<AiCheckRow["kind"]>(["brand", "domain"]);

/** Of the records that share a key, the newest: the latest day, then the latest recorded (the highest id). The order given is kept. */
function newestOf(rows: AiCheckRow[], keyOf: (r: AiCheckRow) => string): AiCheckRow[] {
  const best = new Map<string, AiCheckRow>();
  for (const r of rows) {
    const k = keyOf(r);
    const had = best.get(k);
    if (!had || r.day > had.day || (r.day === had.day && r.id > had.id)) best.set(k, r);
  }
  return rows.filter((r) => best.get(keyOf(r)) === r);
}

const dayKey = (r: AiCheckRow) => `${r.engine}|${qKey(r.question)}|${r.day}`;
const pairKey = (r: AiCheckRow) => `${r.engine}|${qKey(r.question)}`;

/* ---------- the address ------------------------------------------------------------------------- */

const SHOWS: AiSearchAsked["show"][] = ["all", "unprompted", "prompted", "de", "price"];
const oneOf = <T extends string>(raw: string | undefined, list: readonly T[], fallback: T): T => (raw && (list as readonly string[]).includes(raw) ? (raw as T) : fallback);
const text = (raw: string | undefined, most: number): string => (raw ?? "").replace(/\s+/g, " ").trim().slice(0, most);

/** What the address asks for, each value checked against what it may be: anything else is the default. */
function askedOf(c: Context<Vars>): AiSearchAsked {
  const q = c.req.query.bind(c.req);
  const search = text(q("q"), 80);
  const open = text(q("open"), 300);
  const page = (q("page") ?? "").trim();
  const fail = text(q("fail"), 40);
  return {
    q: search,
    /* A search looks through every question unless a chip narrows it; without one the page opens on the questions that do not name Balkaris. */
    show: oneOf(q("show"), SHOWS, search ? "all" : "unprompted"),
    engine: oneOf<AiEngine | "all">(q("engine"), ["all", ...ENGINES], "all"),
    open: open ? qKey(open) : null,
    named: oneOf(q("named"), ["top", "all", "sites"] as const, "top"),
    who: text(q("who"), 80),
    fail: /^[a-z-]+$/.test(fail) ? fail : null,
    find: text(q("find"), 80),
    kind: text(q("kind"), 40),
    pages: oneOf(q("pages"), ["top", "all"] as const, "top"),
    page: page.startsWith("/") && page.length <= 500 ? page : null,
    psort: oneOf(q("psort"), ["fails", "path", "pass"] as const, "fails"),
    asking: oneOf(q("asking"), ["top", "all"] as const, "top"),
  };
}

/** Every word of a search, each found somewhere in the text: "web zürich" finds "Web design agency in Zürich". */
const matches = (search: string, hay: string): boolean => {
  if (!search) return true;
  const h = hay.toLowerCase();
  return search
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => h.includes(w));
};

/* ---------- the answers ------------------------------------------------------------------------- */

/** Per assistant, its newest answer to each question asked of it. */
function tallyOf(rows: AiCheckRow[]): AiChecks["tally"] {
  const out: AiChecks["tally"] = [];
  for (const engine of ENGINES) {
    const mine = rows.filter((r) => r.engine === engine);
    if (!mine.length) continue;
    const days = mine.map((r) => r.day).sort();
    const unprompted = mine.filter((r) => !PROMPTED.has(r.kind));
    out.push({
      engine,
      label: ENGINE_LABEL[engine],
      since: days[0]!,
      day: days.at(-1)!,
      asked: mine.length,
      mentioned: mine.filter((r) => r.mentioned === true).length,
      unprompted: { asked: unprompted.length, mentioned: unprompted.filter((r) => r.mentioned === true).length },
    });
  }
  return out;
}

/** Every recorded day, oldest first, over the latest record of each question, assistant and day. */
function roundsOf(rows: AiCheckRow[]): AiRound[] {
  const days = [...new Set(rows.map((r) => r.day))].sort();
  return days.map((day) => {
    const round = rows.filter((r) => r.day === day);
    const unprompted = round.filter((r) => !PROMPTED.has(r.kind));
    const engines = [...new Set(round.map((r) => r.engine))].map((engine) => {
      const mine = round.filter((r) => r.engine === engine);
      return { engine, label: ENGINE_LABEL[engine] ?? engine, asked: mine.length, mentioned: mine.filter((r) => r.mentioned === true).length };
    });
    return {
      day,
      asked: round.length,
      mentioned: round.filter((r) => r.mentioned === true).length,
      unread: round.filter((r) => r.mentioned === null).length,
      unprompted: { asked: unprompted.length, mentioned: unprompted.filter((r) => r.mentioned === true).length },
      engines,
    };
  });
}

function checksPanel(ctx: Ctx): Reading<AiChecks> {
  if (!ctx.all.length) {
    return waiting(
      "desk",
      "No answer of an AI assistant is recorded yet. The audit's answers come in with the SEO import (scripts/seo-import.ts); later rounds are recorded here by the owner (Record answers, Record a round).",
    );
  }
  if (!ctx.rows.length) return waiting("desk", "Every question with a recorded answer is retired: put one on the list again (Retired questions) or track a new one.");
  const last = ctx.rows.map((r) => r.day).sort().at(-1)!;
  const replaced = ctx.replaced;
  return ok(
    { tally: tallyOf(ctx.rows), rows: ctx.rows, rounds: roundsOf(ctx.byDay), records: ctx.all.length, replaced },
    "desk",
    `${last}T12:00:00.000Z`,
    `Questions asked of AI assistants and what each answer said, as recorded by whoever asked (the audit, a person in a browser, an API). Each assistant's newest answer to each question counts${replaced ? `; ${plural(replaced, "earlier record")} of the same question, assistant and day ${replaced === 1 ? "is" : "are"} kept and not counted` : ""}. A fixed set of questions, not a sample of what people ask; no job asks the assistants by itself.`,
  );
}

/* ---------- the questions, one row each ---------------------------------------------------------- */

interface Q {
  key: string;
  question: string;
  lang: "de" | "en";
  kind: AiCheckRow["kind"];
  listed: boolean;
  active: boolean;
}

/** Every question: the list a person keeps first (its words, language and kind win), then every question ever recorded. */
function questionsOf(ctx: Ctx): Map<string, Q> {
  const out = new Map<string, Q>();
  for (const t of ctx.tracked) out.set(t.key, { key: t.key, question: t.question, lang: t.lang, kind: t.kind, listed: true, active: t.active });
  /* Rows come newest day first: the first record of a question gives its words, language and kind. */
  for (const r of ctx.everyRow) {
    const k = qKey(r.question);
    if (!out.has(k)) out.set(k, { key: k, question: r.question.trim().replace(/\s+/g, " "), lang: r.lang, kind: r.kind, listed: false, active: true });
  }
  return out;
}

/** Each assistant's newest answer to each question, by question key and assistant (retired questions too). */
function newestByPair(ctx: Ctx): Map<string, Map<AiEngine, AiCheckRow>> {
  const out = new Map<string, Map<AiEngine, AiCheckRow>>();
  for (const r of ctx.everyRow) {
    const k = qKey(r.question);
    const m = out.get(k) ?? new Map<AiEngine, AiCheckRow>();
    if (!m.has(r.engine)) m.set(r.engine, r);
    out.set(k, m);
  }
  return out;
}

const KIND_ORDER: AiCheckRow["kind"][] = ["category", "price", "advice", "brand", "domain"];
const SHOW_TEST: Record<AiSearchAsked["show"], (q: Q) => boolean> = {
  all: () => true,
  unprompted: (q) => !PROMPTED.has(q.kind),
  prompted: (q) => PROMPTED.has(q.kind),
  de: (q) => q.lang === "de",
  price: (q) => q.kind === "price",
};
const SHOW_LABEL: Record<AiSearchAsked["show"], string> = { all: "All", unprompted: "Without the name", prompted: "By name", de: "German", price: "Price" };

const cellOf = (r: AiCheckRow | undefined): AiCell | null => (r ? { id: r.id, mentioned: r.mentioned, position: r.position, day: r.day } : null);

function rowOf(q: Q, by: Map<AiEngine, AiCheckRow> | undefined, cols: AiEngine[]): AiQuestionRow {
  const cells = cols.map((e) => cellOf(by?.get(e)));
  const answered = cells.filter((c): c is AiCell => !!c);
  return {
    key: q.key,
    question: q.question,
    lang: q.lang,
    kind: q.kind,
    listed: q.listed,
    day: answered.map((c) => c.day).sort().at(-1) ?? null,
    cells,
    named: answered.filter((c) => c.mentioned === true).length,
    asked: answered.length,
  };
}

/** How an answer reads in a sentence: "named at place 3", "not named", "could not be read whole". */
const saidOf = (r: AiCheckRow): string => (r.mentioned === null ? "could not be read whole" : r.mentioned ? `named${r.position ? ` at place ${r.position}` : ""}` : "not named");

/** What changed from one answer of an assistant to the next: whether it named Balkaris, and the companies it named. */
export function changeOf(before: AiCheckRow, now: AiCheckRow): string {
  const was = saidOf(before);
  const is = saidOf(now);
  let s = was === is ? `${cap(is)} on ${shortDay(before.day)} and now.` : `${cap(was)} on ${shortDay(before.day)}, ${is} now.`;
  const k = (n: string) => key(n) || n.toLowerCase();
  const had = new Set(before.competitors.map(k));
  const has = new Set(now.competitors.map(k));
  const added = now.competitors.filter((n) => !had.has(k(n)) && !/balkaris/i.test(n));
  const gone = before.competitors.filter((n) => !has.has(k(n)) && !/balkaris/i.test(n));
  if (added.length) s += ` Named now, not before: ${listed(added)}.`;
  if (gone.length) s += ` No longer named: ${listed(gone)}.`;
  if (!added.length && !gone.length && now.competitors.length) s += " The same companies named.";
  return s;
}

/** Operator tasks made from one question: a page that answers it, and which page comes closest. They run on the studio workstation's model. */
function questionTasks(q: Q, named: number): { label: string; task: NewTask }[] {
  const out: { label: string; task: NewTask }[] = [];
  const lang = q.lang === "de" ? "German (de-CH)" : "English";
  if (!PROMPTED.has(q.kind) && named === 0) {
    out.push({
      label: `Brief: a ${q.lang === "de" ? "German" : "English"} page that answers this question`,
      task: {
        kind: "brief",
        prompt: cut(
          `A ${lang} page that answers the question “${q.question}” for Swiss clients: a direct answer of 50 to 100 words under the heading, what the answer depends on, how Balkaris works, and five client questions with short answers.${q.kind === "price" ? " State the price as a range the owner fills in." : " Leave every price for the owner to fill in."}`,
          PROMPT_MOST,
        ),
        depth: "deep",
      },
    });
  }
  out.push({
    label: "Which page of the website answers it, and what does it lack?",
    task: {
      kind: "ask",
      prompt: cut(
        `AI assistants were asked “${q.question}”. Which page of the website comes closest to answering it, what that page lacks for an assistant to quote it (a direct answer, a price, a German version, questions answered, who and where), and whether a page is missing altogether. Answer from the pages only.`,
        PROMPT_MOST,
      ),
      context: "website",
      depth: "deep",
    },
  });
  return out;
}

/** One question in detail: each assistant's newest answer, the ones before it and what changed. */
function detailOf(ctx: Ctx, q: Q, by: Map<AiEngine, AiCheckRow> | undefined, cols: AiEngine[]): AiQuestionDetail {
  const row = rowOf(q, by, cols);
  const answers: AiAnswerNow[] = [];
  for (const engine of ENGINES) {
    const now = by?.get(engine);
    if (!now) continue;
    const earlier = newestOf(ctx.all, dayKey).filter((r) => r.engine === engine && qKey(r.question) === q.key && r.id !== now.id && r.day < now.day).sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : b.id - a.id));
    answers.push({ now, earlier, change: earlier[0] ? changeOf(earlier[0], now) : null });
  }
  return { ...row, active: q.active, answers, tasks: questionTasks(q, answers.filter((a) => a.now.mentioned === true).length) };
}

/** Every text an answer carries, for the search: the question, the companies named, the sources cited, what was said. */
const answerText = (r: AiCheckRow): string => [r.competitors.join(" "), r.sources.join(" "), r.excerpt ?? "", r.note ?? ""].join(" ");

function answersPanel(ctx: Ctx): Reading<AiAnswers> {
  const all = questionsOf(ctx);
  if (!all.size) {
    return waiting("desk", "No question is tracked and no answer is recorded yet. Put a question on the list (Track a question) or record a round of answers.");
  }
  const a = ctx.asked;
  const by = newestByPair(ctx);
  const active = [...all.values()].filter((q) => q.active);
  const retired = [...all.values()].filter((q) => !q.active);
  const cols = a.engine === "all" ? ENGINES : [a.engine];
  const found = (q: Q): boolean => matches(a.q, [q.question, ...[...(by.get(q.key)?.values() ?? [])].map(answerText)].join(" "));
  const searched = active.filter(found);
  const shown = searched
    .filter(SHOW_TEST[a.show])
    .sort((x, y) => KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind) || (x.lang === y.lang ? 0 : x.lang === "de" ? -1 : 1) || x.question.localeCompare(y.question));
  const counted = active.reduce((n, q) => n + ENGINES.filter((e) => by.get(q.key)?.has(e)).length, 0);
  const pairs = active.length * ENGINES.length;
  /* Without ?open= the first question some assistant answered opens: a row of empty cells has nothing to show. */
  const openQ = (a.open ? all.get(a.open) : undefined) ?? shown.find((q) => by.get(q.key)?.size) ?? shown[0];
  const newest = ctx.rows.map((r) => r.day).sort().at(-1);
  return ok(
    {
      cols: cols.map((engine) => ({ engine, label: ENGINE_LABEL[engine], answers: shown.filter((q) => by.get(q.key)?.has(engine)).length })),
      chips: SHOWS.map((s) => ({ key: s, label: SHOW_LABEL[s], count: searched.filter(SHOW_TEST[s]).length })),
      questions: shown.map((q) => rowOf(q, by.get(q.key), cols)),
      tracked: active.length,
      counted,
      neverAsked: pairs - counted,
      pairs,
      open: openQ ? detailOf(ctx, openQ, by.get(openQ.key), cols) : null,
      all: [...active]
        .sort((x, y) => KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind) || (x.lang === y.lang ? 0 : x.lang === "de" ? -1 : 1) || x.question.localeCompare(y.question))
        .map((q) => ({ key: q.key, question: q.question, lang: q.lang, kind: q.kind })),
      retired: retired.map((q) => ({ key: q.key, question: q.question, lang: q.lang, kind: q.kind, answers: by.get(q.key)?.size ?? 0 })),
    },
    "desk",
    newest ? `${newest}T12:00:00.000Z` : new Date().toISOString(),
    "Every question on the list (put there by a person, or recorded), each with every assistant's newest answer to it. An empty cell is an assistant never asked that question: what a round still has to record.",
  );
}

/* ---------- questions people search -------------------------------------------------------------- */

/** How many rows "Questions people search" shows before "Show all". */
const ASKING_SHOWN = 12;
/** Search Console's figures for the phrases: the last ninety days the desk's snapshots hold. */
const ASKING_DAYS = 90;
const QUESTION_WORDS = /^(wer|wie|was|wo|wann|welche[rsnm]?|warum|weshalb|kann|lohnt|braucht|gibt|ist|sind|kostet|kosten|how|what|which|who|where|when|why|is|are|can|do|does|should|best)\b|\?$|\b(kosten|kostet|preis|price|cost|costs)\b/i;

function askingPanel(ctx: Ctx): Reading<AiAsking> {
  let all: ReturnType<typeof keywords>;
  try {
    all = keywords();
  } catch {
    return waiting("desk", "The keyword table could not be read.");
  }
  const phrases = all.filter((k) => k.status !== "irrelevant" && (k.flags.question || QUESTION_WORDS.test(k.phrase.trim())));
  if (!phrases.length) return waiting("desk", "The keyword table holds no question-shaped phrase yet: they come from the SEO import, Google Autocomplete's weekly research and Search Console's queries.");
  const end = safe<string | null>(null, () => lastSnapDay());
  const window = end ? { start: addDays(end, -(ASKING_DAYS - 1)), end } : null;
  const figs = new Map<string, { impressions: number; position: number | null }>();
  if (window) for (const f of safe([], () => queryFigures(window.start, window.end))) figs.set(f.query.toLowerCase(), { impressions: f.impressions, position: f.position });
  const tracked = new Set(questionsOf(ctx).keys());
  /* The page's two checks an assistant quotes from, as the readiness check last read them. */
  const states = new Map<string, Record<string, ReadinessCheck["state"]>>();
  for (const p of safe([] as PageReadiness[], () => pageReadiness().pages)) states.set(p.path, Object.fromEntries(p.checks.map((c) => [c.key, c.state])));
  /* The phrases a person judged relevant first: Autocomplete suggests many a question nobody here would answer. */
  const relevant = new Set(phrases.filter((k) => k.status === "relevant").map((k) => k.phrase));
  const rows: AskedPhrase[] = phrases.map((k) => {
    const f = figs.get(k.phrase.toLowerCase());
    const st = k.page ? states.get(k.page) : undefined;
    return {
      phrase: k.phrase,
      lang: k.lang === "de" || k.lang === "en" ? k.lang : null,
      price: k.flags.price,
      sources: k.sources,
      impressions: f && f.impressions ? f.impressions : null,
      position: f && f.impressions ? f.position : null,
      page: k.page ? { path: k.page, answer: st?.answer ?? null, faq: st?.faq ?? null } : null,
      tracked: tracked.has(qKey(k.phrase)),
    };
  });
  rows.sort(
    (x, y) =>
      (y.impressions ?? -1) - (x.impressions ?? -1) ||
      Number(relevant.has(y.phrase)) - Number(relevant.has(x.phrase)) ||
      Number(!!y.page) - Number(!!x.page) ||
      Number(y.price) - Number(x.price) ||
      x.phrase.localeCompare(y.phrase),
  );
  return ok(
    { total: rows.length, rows: ctx.asked.asking === "all" ? rows : rows.slice(0, ASKING_SHOWN), window },
    window ? "gsc" : "desk",
    window ? `${window.end}T12:00:00.000Z` : new Date().toISOString(),
    `Question-shaped phrases in the keyword table (Search Console's queries, Google Autocomplete's suggestions, the audit) that were not judged irrelevant, with Search Console's impressions${window ? ` from ${shortDay(window.start)} to ${shortDay(window.end)}` : ""} where Google showed the site for the phrase. The questions AI answers are built for; track one to ask it of the assistants each round.`,
  );
}

/* ---------- visits from AI assistants (GA4) -------------------------------------------------------- */

/** What connects GA4, as Settings says it. */
const ga4Step = (): string | undefined => safe<string | undefined>(undefined, () => sources().find((s) => s.id === "ga4")?.step);

async function referralsPanel(range: SeoRange): Promise<Reading<AiReferrals>> {
  if (!hasKey()) return off("ga4", "The desk has no Google service-account key on this machine, so GA4 cannot be asked for visits from AI assistants.", ga4Step());
  const j = job("seo-referrals");
  const span = referralSpan();
  /* Read through: the day before the read job's last good run (it reads up to yesterday), else the newest day kept. */
  const through = j?.lastOk && j.lastEnd ? addDays(zurichDay(j.lastEnd), -1) : (span?.to ?? null);
  if (!through) return waiting("ga4", "Visits from AI assistants are read from GA4 once a day (Automations: Read referrals and AI assistant visits from GA4); the first read has not run yet. “Read now” asks for it.");
  let since: string | null = null;
  try {
    since = await ga4.measuredSince();
  } catch {
    since = null;
  }
  since ??= span?.from ?? null;
  const w = dayWindow(range);
  const start = since && since > w.start ? since : w.start;
  const end = through < w.end ? through : w.end;
  if (end < start) return waiting("ga4", `GA4's sessions are read through ${shortDay(through)}; no day of this window is read yet.`);

  const rows = referrals(start, end).filter((r) => isAi(r.source, r.medium));
  const byAssistant = new Map<string, { source: string; label: string; sessions: number }>();
  const byLanding = new Map<string, { path: string; sessions: number; sources: Set<string> }>();
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const label = aiLabel(r.source);
    const a = byAssistant.get(label) ?? { source: r.source, label, sessions: 0 };
    a.sessions += r.sessions;
    byAssistant.set(label, a);
    const l = byLanding.get(r.landing) ?? { path: r.landing, sessions: 0, sources: new Set<string>() };
    l.sessions += r.sessions;
    l.sources.add(label);
    byLanding.set(r.landing, l);
    byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.sessions);
  }
  /* Every day of the window that was read is a real count, zero included: the read covers those days whole. */
  const days: AiReferrals["days"] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push({ date: d, sessions: byDay.get(d) ?? 0 });
  /* The window before is as many days as this one counts, ending the day before it begins; compared only when GA4 measured all of it. */
  const n = daysBetween(start, end);
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(start, -n);
  const previous = since && since <= prevStart ? referrals(prevStart, prevEnd).filter((r) => isAi(r.source, r.medium)).reduce((s, r) => s + r.sessions, 0) : null;
  const value: AiReferrals = {
    start,
    end,
    sessions: rows.reduce((s, r) => s + r.sessions, 0),
    users: rows.reduce((s, r) => s + r.users, 0),
    previous,
    byAssistant: [...byAssistant.values()].sort((a, b) => b.sessions - a.sessions),
    byLanding: [...byLanding.values()].sort((a, b) => b.sessions - a.sessions).map((l) => ({ path: l.path, sessions: l.sessions, sources: [...l.sources] })),
    days,
    rule: AI_RULE,
  };
  const at = j?.lastOk && j.lastEnd ? j.lastEnd : `${through}T23:00:00.000Z`;
  const sinceNote = since && since > w.start ? ` GA4 measures the site since ${shortDay(since)}.` : "";
  return ok(value, "ga4", at, `GA4 sessions from AI assistants, consenting visitors only, read once a day through ${shortDay(end)}.${sinceNote}`);
}

/* ---------- AI crawlers (Vercel's request records) ----------------------------------------------- */

async function crawlersPanel(range: SeoRange): Promise<Reading<AiCrawlers>> {
  /* Loaded when asked: a drain that fails to load costs this panel, not the page. */
  const d = await import("../../vercel/drain.ts");
  const s = d.drainState();
  if (!s.ready) {
    return off(
      "vercel-drain",
      "Vercel's request records do not reach the desk yet: the log drain is not set up, so no AI crawler's visit can be counted. No other source sees them (GA4 does not run for crawlers).",
      "Set up the log drain on Hosting: run bash deploy/vercel-connect.sh on the workstation.",
    );
  }
  if (!s.last) return waiting("vercel-drain", "The drain's secret is set and no signed delivery from Vercel has arrived yet; crawler visits are counted from the first delivery on.");
  const w = dayWindow(range);
  const c = await aiCrawlers(w.start, w.end);
  if (!c.deliveredDays) return waiting("vercel-drain", "Vercel's request records reached the desk for no day of this window yet.");
  return ok(
    c,
    "vercel-drain",
    s.last,
    "Requests by named AI and search crawlers, read from the user agent each one announces, on the days Vercel's records were delivered. A day without a delivery is unknown, not zero. Aggregates only.",
  );
}

/* ---------- the profile and the name, address and phone: one wording for every panel ------------- */

interface ProfileRead {
  row: ProfileRow | null;
  /** As a readiness row reads it: pass (exists), fail (not found), unknown (seen by the audit and not confirmed since, or not checked). */
  state: ReadinessCheck["state"];
  /** After "Profile ": "exists", "seen by the audit on 2 Oct 2026, not confirmed since". */
  word: string;
  detail: string;
}

/** The Google Business Profile as the desk's profile record has it now: the lever, the site-wide row and the directory table read this one record. */
function businessProfile(): ProfileRead {
  const gbp = profiles().find((p) => p.key === "google-business-profile") ?? null;
  if (!gbp) return { row: null, state: "unknown", word: "not recorded", detail: "The desk has no record of a Google Business Profile yet: the profiles come in with the SEO import." };
  const why = gbp.stateWhy ? ` ${gbp.stateWhy.replace(/\.?$/, ".")}` : "";
  if (gbp.state === "exists") return { row: gbp, state: "pass", word: "exists", detail: `It exists${gbp.checkedAt ? ` (the desk's check on ${shortDay(gbp.checkedAt)})` : ""}.${why}` };
  if (gbp.state === "not-found") return { row: gbp, state: "fail", word: "not found", detail: `Not found by the desk's check${gbp.checkedAt ? ` on ${shortDay(gbp.checkedAt)}` : ""}.${why}` };
  if (gbp.napSeen) {
    const seen = `seen by the audit on ${shortDay(gbp.napSeen.day)}, not confirmed since`;
    return { row: gbp, state: "unknown", word: seen, detail: `Seen by the audit on ${shortDay(gbp.napSeen.day)}; not confirmed since.${why}` };
  }
  return { row: gbp, state: "unknown", word: gbp.state === "unknown" ? "could not be confirmed" : "not checked yet", detail: why.trim() || "The desk's check has not read it." };
}

/** The same comparison presence.ts makes for napMatrix's `consistent`: "Strasse" and "Str." are one address, "+41 44" and "044" one phone. */
const SAME: Record<"name" | "address" | "phone", (s: string) => string> = {
  name: (s) => s.toLowerCase().replace(/[^a-z0-9äöü]/g, ""),
  address: (s) => s.toLowerCase().replace(/strasse/g, "str").replace(/[^a-z0-9äöü]/g, ""),
  phone: (s) => {
    const d = s.replace(/[^\d+]/g, "");
    return d.startsWith("+41") ? `0${d.slice(3)}` : d.startsWith("0041") ? `0${d.slice(4)}` : d;
  },
};

interface NapRead {
  stated: boolean;
  consistent: boolean;
  /** "4 versions of the name, 2 versions of the address", or null when they agree. */
  differ: string | null;
  sources: number;
}

/** Name, address and phone over every source, as the profile records have them now: the lever and the site-wide row read this one. */
function napRead(): NapRead {
  const nap = napMatrix();
  const stated = nap.fields.some((f) => f.values.length);
  const differ = nap.fields
    .filter((f) => !f.consistent)
    .map((f) => `${new Set(f.values.map((v) => SAME[f.field](v.value))).size} versions of the ${f.field}`)
    .join(", ");
  return { stated, consistent: nap.consistent, differ: differ || null, sources: new Set(nap.fields.flatMap((f) => f.values.map((v) => v.source))).size };
}

/* ---------- readiness ------------------------------------------------------------------------------ */

/** The site-wide rows the profile records decide, drawn from them now so they never disagree with the levers beside them. */
function liveSiteRow(c: ReadinessCheck, gbp: ProfileRead, nap: NapRead): ReadinessCheck {
  if (c.key === "profile") {
    const fixing = gbp.state !== "pass";
    return {
      ...c,
      state: gbp.state,
      detail: `${gbp.detail} From the desk's profile record.`,
      fix: fixing ? "Owner: confirm and fix the Google Business Profile (category, services, the one true address); Needs you has the step." : null,
      who: fixing ? "owner" : null,
    };
  }
  if (c.key === "nap") {
    return {
      ...c,
      state: !nap.stated ? "unknown" : nap.consistent ? "pass" : "fail",
      detail: !nap.stated
        ? "No profile states them yet."
        : nap.consistent
          ? `The same over ${plural(nap.sources, "source")}: the website and the profiles, as read or as the audit saw them.`
          : `They differ: ${nap.differ}, over ${plural(nap.sources, "source")} (the website and the profiles, as read or as the audit saw them).`,
      fix: nap.stated && !nap.consistent ? "Owner: decide the one true name, address and phone, then copy it to every profile." : null,
      who: nap.stated && !nap.consistent ? "owner" : null,
    };
  }
  return c;
}

/** How many rows the page table shows before "Show all". */
const PAGES_SHOWN = 12;

/** Operator tasks made from what one page fails: a direct answer, client questions. */
function pageTasks(p: PageReadiness): { label: string; task: NewTask }[] {
  const failing = (k: string) => p.checks.some((c) => c.key === k && c.state === "fail");
  const out: { label: string; task: NewTask }[] = [];
  const name = p.title ? `“${p.title}” (${p.path})` : p.path;
  if (failing("answer")) {
    out.push({
      label: "Brief: a direct answer for this page",
      task: { kind: "brief", prompt: cut(`A direct answer of 50 to 100 words for the page ${name}, written as the first paragraph under its heading: it answers the question the page is about in its first sentence, says who does the work and where (Balkaris, Zürich), and leaves any price for the owner to fill in.`, PROMPT_MOST), depth: "deep" },
    });
  }
  if (failing("faq")) {
    out.push({
      label: "Brief: client questions for this page",
      task: { kind: "brief", prompt: cut(`Five to eight questions clients ask about ${name}, each with a short specific answer, to be shown on the page and marked up as FAQPage.`, PROMPT_MOST), depth: "deep" },
    });
  }
  out.push({ label: "Ask what this page lacks for an AI answer", task: { kind: "ask", prompt: cut(`What does the page ${name} lack for an AI assistant to quote it, and what would you change first? Answer from the page only.`, PROMPT_MOST), context: "pages", path: p.path, depth: "deep" } });
  return out;
}

/** One page's readiness as read, with its title and kind from the crawl. */
function pageAnswer(path: string): PageReadinessAnswer {
  const got = readinessOf(path);
  if (!got) return { page: null, checkedAt: null };
  const p = siteView().byPath.get(path);
  const applying = got.checks.filter((x) => x.state !== "n/a");
  const page: PageReadiness = {
    path,
    title: ownTitle(p?.title ?? null),
    kind: p?.kind ?? null,
    lang: p?.lang ?? null,
    checks: got.checks,
    pass: applying.filter((x) => x.state === "pass").length,
    of: applying.length,
    ...(got.unread ? { unread: got.unread } : {}),
  };
  return { page, checkedAt: got.checkedAt, tasks: pageTasks(page) };
}

/** What the last run could not read, in a sentence; null when it read every page. */
function unreadLine(): { at: string; line: string } | null {
  const run = safe(null, () => lastRun());
  if (!run || !run.why) return null;
  const when = shortDay(zurichDay(run.at));
  if (!run.pages) return { at: run.at, line: `The run of ${when} had nothing to read: ${run.why}. Every page keeps its last good read.` };
  if (!run.read) return { at: run.at, line: `The run of ${when} read none of the ${fmt(run.pages)} sitemap pages: the website ${run.why}. Every page keeps its last good read, and the site-wide checks are the run before's.` };
  return { at: run.at, line: `The run of ${when} read ${fmt(run.read)} of ${fmt(run.pages)} sitemap pages; the others ${run.why}, and keep their last good read.` };
}

function readinessPanel(ctx: Ctx): Reading<Readiness> {
  const a = ctx.asked;
  const p = pageReadiness();
  const site = siteReadiness();
  if (!p.pages.length && !site) {
    const j = job("seo-readiness");
    if (j?.running) return waiting("crawl", "The readiness check is reading the site's pages now; its findings appear here when it finishes.");
    const unread = unreadLine();
    if (unread) return waiting("crawl", `${unread.line.replace(" Every page keeps its last good read.", "").replace(" Every page keeps its last good read, and the site-wide checks are the run before's.", "")} No earlier read exists to show instead.`);
    return waiting("crawl", "The readiness check has not run yet. It reads every sitemap page once a day (Automations: Check every page for AI search readiness); “Run the check” asks for it now.");
  }
  const judged = p.pages.filter((x) => x.of > 0);
  const order: string[] = [];
  for (const page of p.pages) for (const c of page.checks) if (!order.includes(c.key)) order.push(c.key);
  const byCheck: ReadinessTally[] = order.map((k) => {
    const all = p.pages.map((page) => page.checks.find((c) => c.key === k)).filter((c): c is NonNullable<typeof c> => !!c);
    const applying = all.filter((c) => c.state !== "n/a");
    const failing = applying.find((c) => c.state === "fail");
    return {
      key: k,
      label: all[0]?.label ?? k,
      applies: applying.length,
      pass: applying.filter((c) => c.state === "pass").length,
      fail: applying.filter((c) => c.state === "fail").length,
      unknown: applying.filter((c) => c.state === "unknown").length,
      fix: failing?.fix ?? null,
      who: failing?.who ?? null,
    };
  });
  const gbp = safe<ProfileRead | null>(null, () => businessProfile());
  const nap = safe<NapRead | null>(null, () => napRead());
  const siteRows = (site?.checks ?? []).map((c) => (gbp && nap ? liveSiteRow(c, gbp, nap) : c));

  /* The table: every page read, narrowed by the address (a failing check, a search, a kind), in the order it asks for. */
  const rows = p.pages.map((x) => ({
    path: x.path,
    title: ownTitle(x.title),
    kind: x.kind,
    lang: x.lang,
    states: Object.fromEntries(x.checks.map((c) => [c.key, c.state])) as Record<string, ReadinessCheck["state"]>,
    pass: x.pass,
    of: x.of,
    ...(x.unread ? { unread: true } : {}),
  }));
  const kinds = new Map<string, number>();
  for (const r of rows) kinds.set(r.kind ?? "other", (kinds.get(r.kind ?? "other") ?? 0) + 1);
  const matching = rows
    .filter((r) => (a.fail ? r.states[a.fail] === "fail" : r.of > 0))
    .filter((r) => matches(a.find, `${r.path} ${r.title ?? ""}`))
    .filter((r) => !a.kind || (r.kind ?? "other") === a.kind)
    .sort(
      a.psort === "path"
        ? (x, y) => x.path.localeCompare(y.path)
        : a.psort === "pass"
          ? (x, y) => y.pass - x.pass || x.of - x.pass - (y.of - y.pass) || x.path.localeCompare(y.path)
          : (x, y) => y.of - y.pass - (x.of - x.pass) || y.of - x.of || x.path.localeCompare(y.path),
    );

  const robotsCheck = site?.checks.find((c) => c.key === "robots") ?? null;
  const robots = site && site.robots.agents.length ? site.robots.agents : null;
  const at = p.checkedAt ?? site?.at ?? new Date().toISOString();
  return ok(
    {
      checkedAt: at,
      site: siteRows,
      pages: a.pages === "all" ? matching : matching.slice(0, PAGES_SHOWN),
      list: { total: rows.length, matching: matching.length, kinds: [...kinds.entries()].map(([kind, count]) => ({ kind, count })).sort((x, y) => y.count - x.count || x.kind.localeCompare(y.kind)) },
      opened: a.page ? pageAnswer(a.page) : null,
      ready: judged.filter((x) => x.pass === x.of).length,
      of: judged.length,
      byCheck,
      robots,
      robotsNote: site && !robots ? (robotsCheck?.detail ?? "robots.txt could not be read at the last run.") : null,
      unread: unreadLine(),
      job: jobOf("seo-readiness"),
    },
    "crawl",
    at,
    "The desk's own read of every sitemap page as a crawler gets it (no JavaScript), once a day; the Business Profile and the name, address and phone rows from the desk's profile records as they are now. Each check says what it read; which checks apply depends on the kind of page. A page that did not answer keeps its last good read, said beside it. Not a score of ours.",
  );
}

/* ---------- where the answers look ---------------------------------------------------------------- */

/** A directory's or platform's name as an answer's source card shows it, from the hosts the engine knows as platforms. */
const PLATFORM_KEYS = new Set([...PLATFORMS].flatMap((d) => [key(d), key(d.split(".")[0]!)]).filter((k) => k.length >= 5));
const DIRECTORY = /clutch|goodfirms|designrush|sortlist|manifest/i;
/** How many companies "Named instead" shows before "Show all". */
const NAMED_SHOWN = 10;

/**
 * Two keys as one name: equal, or one the other with a few letters more
 * ("googlebusinessprofile" and "googlebusinessprofiles"). Until this rule any
 * prefix matched, so a source card "Google" became the Business Profile.
 */
const sameName = (x: string, k: string): boolean => {
  if (x === k) return true;
  const [short, long] = x.length < k.length ? [x, k] : [k, x];
  return short.length >= 5 && long.startsWith(short) && short.length / long.length >= 0.8;
};

/**
 * The profile of Balkaris a cited source is, by its key, its name or its
 * address's host. Balkaris's own website is never a directory, and an address
 * that is a search on a shared host (google.com/maps/search/…) does not make
 * every google.com citation the Business Profile.
 */
function profileMatcher(known: ProfileRow[]): (source: string) => ProfileRow | null {
  const hostKey = (url: string | null): string | null => {
    if (!url) return null;
    try {
      const u = new URL(url);
      if (/\/search\b/.test(u.pathname) || /^(www\.)?google\./.test(u.hostname)) return null;
      return key(u.hostname);
    } catch {
      return null;
    }
  };
  const keyed = known.filter((p) => p.key !== "website").map((p) => ({ p, keys: [key(p.key), key(p.name), hostKey(p.url)].filter((x): x is string => !!x && x.length >= 5) }));
  return (source) => {
    const k = key(source);
    if (k.length < 5) return null;
    return keyed.find((x) => x.keys.some((y) => sameName(y, k)))?.p ?? null;
  };
}

function listingsPanel(ctx: Ctx): Reading<AiListings> {
  const rows = ctx.rows;
  if (!rows.length) return waiting("desk", "No answers recorded yet, so no source they cite is known.");
  const profileFor = profileMatcher(profiles());

  type Seen = { source: string; answers: Set<number>; engines: Set<string>; questions: Set<string> };
  const dirs = new Map<string, Seen>();
  const sites = new Map<string, Seen>();
  const own = { answers: new Set<number>(), engines: new Set<string>() };
  let withSources = 0;
  for (const r of rows) {
    if (r.sources.length) withSources++;
    for (const s of r.sources) {
      const label = r.engineLabel;
      if (/balkaris/i.test(s)) {
        own.answers.add(r.id);
        own.engines.add(label);
        continue;
      }
      const k = key(s) || s;
      const isDirectory = /business profiles?$/i.test(s) || PLATFORM_KEYS.has(k) || DIRECTORY.test(s) || !!profileFor(s);
      const into = isDirectory ? dirs : sites;
      const had = into.get(k) ?? { source: s, answers: new Set<number>(), engines: new Set<string>(), questions: new Set<string>() };
      had.answers.add(r.id);
      had.engines.add(label);
      had.questions.add(r.question);
      into.set(k, had);
    }
  }

  const directories: CitedListing[] = [...dirs.values()]
    .map((d) => {
      const p = /business profiles?$/i.test(d.source) ? (profiles().find((x) => x.key === "google-business-profile") ?? null) : profileFor(d.source);
      const task = taskOf(ctx, p?.ownerTaskId ?? (DIRECTORY.test(d.source) ? "directories" : null));
      return {
        source: d.source,
        answers: d.answers.size,
        engines: [...d.engines],
        questions: [...d.questions],
        profile: p ? { key: p.key, name: p.name, state: p.state, url: p.url, why: p.stateWhy } : null,
        ownerTask: taskRef(task),
      };
    })
    .sort((a, b) => b.answers - a.answers || a.source.localeCompare(b.source));

  const named = new Map<string, { name: string; answers: Set<number>; engines: Set<string>; questions: Set<string> }>();
  for (const r of rows) {
    for (const n of r.competitors) {
      if (/balkaris/i.test(n)) continue;
      const k = key(n) || n;
      const had = named.get(k) ?? { name: n, answers: new Set<number>(), engines: new Set<string>(), questions: new Set<string>() };
      had.answers.add(r.id);
      had.engines.add(r.engineLabel);
      had.questions.add(r.question);
      named.set(k, had);
    }
  }
  const a = ctx.asked;
  const allNamed = [...named.values()].map((n) => ({ name: n.name, answers: n.answers.size, engines: [...n.engines], questions: n.questions.size })).sort((x, y) => y.answers - x.answers || x.name.localeCompare(y.name));
  const allSites = [...sites.values()].map((s) => ({ source: s.source, answers: s.answers.size, engines: [...s.engines] })).sort((x, y) => y.answers - x.answers || x.source.localeCompare(y.source));
  const namedFound = allNamed.filter((n) => matches(a.who, n.name));
  const sitesFound = a.named === "sites" ? allSites.filter((s) => matches(a.who, s.source)) : allSites;

  return ok(
    {
      answers: rows.length,
      withSources,
      directories,
      sites: sitesFound,
      own: { answers: own.answers.size, engines: [...own.engines] },
      named: a.named === "all" || a.who ? namedFound : namedFound.slice(0, NAMED_SHOWN),
      namedTotal: allNamed.length,
      sitesTotal: allSites.length,
    },
    "desk",
    `${rows.map((r) => r.day).sort().at(-1)}T12:00:00.000Z`,
    "The sources and companies each assistant's newest answer to each question showed, as the recorder wrote them down. A directory is a listing or platform site (the engine's list of them, or one where the desk knows a profile of Balkaris); every other source is a company's own site. Whether Balkaris is there is the desk's profile record, checked weekly where an address is known.",
  );
}

/* ---------- the levers ------------------------------------------------------------------------------ */

const shareState = (pass: number, of: number): AiLever["state"] => (!of ? "unknown" : pass === of ? "good" : pass === 0 ? "bad" : "warn");

/** The Opportunities list of one kind. */
const oppsHref = (type: OpportunityType): string => `/seo/opportunities?type=${type}`;

const INDEX_WHY = "Google's AI Mode and AI Overviews answer from pages in Google's index: a page Google has not indexed cannot be quoted or linked in them.";

function leversPanel(ctx: Ctx, listings: Reading<AiListings>, readiness: Reading<Readiness>): Reading<AiLever[]> {
  const levers: AiLever[] = [];
  const openOf = (type: OpportunityType) => ctx.open.filter((o) => o.type === type).length;
  /** An opportunity count with the list that shows exactly those, or nothing when none is open. */
  const opps = (type: OpportunityType) => {
    const n = openOf(type);
    return { opportunities: n || null, opportunitiesHref: n ? oppsHref(type) : null };
  };
  const tally = (k: string) => (readiness.state === "ok" ? (readiness.value.byCheck.find((c) => c.key === k) ?? null) : null);
  const readAt = readiness.state === "ok" ? readiness.asOf : null;
  const asked = (f: (r: AiCheckRow) => boolean) => {
    const rows = ctx.rows.filter(f);
    return { asked: rows.length, named: rows.filter((r) => r.mentioned === true).length };
  };

  /* 1. Google's index. A check cut short is not the whole sitemap: the addresses it did not reach carry their
     result of the week before (indexation.ts latestInspection), and an address with no result at all is
     unknown, never "not in the index". Until this rule a run that stopped after 17 of 98 addresses read
     "11 of 98 indexed, 87 not in the index". */
  const ins = safe(null, () => latestInspection());
  if (ins && ins.rows.length) {
    const indexed = ins.rows.filter((r) => r.indexed).length;
    const notIndexed = ins.rows.length - indexed;
    const of = ins.of ?? ins.rows.length;
    const unknown = ins.missing;
    const how = ins.complete
      ? `Google's URL Inspection of every sitemap address on ${shortDay(ins.day)}`
      : `The check on ${shortDay(ins.day)} was cut short after ${plural(ins.checked, "address", "addresses")}; ${plural(ins.carried, "address keeps its", "addresses keep their")} result of the week before${ins.wholeDay ? ` (the last whole check was on ${shortDay(ins.wholeDay)})` : ""}`;
    levers.push({
      key: "indexed",
      title: "Be in Google's index",
      why: INDEX_WHY,
      state: notIndexed === 0 && !unknown ? "good" : notIndexed / Math.max(1, of) <= 0.1 ? "warn" : "bad",
      figure: `${fmt(indexed)} of ${fmt(of)} sitemap addresses indexed`,
      detail: `${how}: ${plural(notIndexed, "address", "addresses")} not in the index${unknown ? `, ${plural(unknown, "address", "addresses")} with no result in the last week (not known, not counted as either)` : ""}.`,
      source: "gsc",
      asOf: `${ins.day}T12:00:00.000Z`,
      step: {
        who: "lead-chrome",
        text: "Request indexing for the addresses Google has not indexed, one by one in Search Console's URL Inspection; Technical lists them with Google's reason.",
        href: "/seo/technical",
        ownerTask: taskRef(taskOf(ctx, "gsc-request-indexing")),
        ...opps("not-indexed"),
      },
    });
  } else {
    levers.push({
      key: "indexed",
      title: "Be in Google's index",
      why: INDEX_WHY,
      state: "unknown",
      figure: null,
      detail: "Google's daily URL Inspection of the sitemap addresses has not finished a round on this desk yet.",
      source: "gsc",
      asOf: null,
      step: { who: "desk", text: "The desk inspects every sitemap address once a day (Automations: Inspect sitemap addresses in Google).", href: "/seo/technical", ownerTask: null, opportunities: null, opportunitiesHref: null },
    });
  }

  /* 2. Listed where the answers look */
  if (listings.state === "ok") {
    /* The directories a profile of Balkaris belongs in: one the desk records, or one an owner task would create. */
    const dirs = listings.value.directories.filter((d) => d.profile || d.ownerTask);
    const others = listings.value.directories.filter((d) => !d.profile && !d.ownerTask).map((d) => d.source);
    const there = dirs.filter((d) => d.profile?.state === "exists").length;
    const missing = dirs.filter((d) => !d.profile || d.profile.state === "not-found").map((d) => d.source);
    levers.push({
      key: "listed",
      title: "Be listed where the answers look",
      why: "When an assistant answers a question about a service and a place, it names the studios its sources list: the directories and profiles it cited are where it finds names.",
      state: !dirs.length ? "unknown" : there === dirs.length ? "good" : there === 0 ? "bad" : "warn",
      figure: dirs.length ? `${fmt(there)} of ${plural(dirs.length, "cited directory", "cited directories")} list Balkaris` : null,
      detail: dirs.length
        ? `The recorded answers cited ${plural(dirs.length, "directory or listing", "directories and listings")} where a profile of Balkaris belongs.${missing.length ? ` Not listed: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` and ${fmt(missing.length - 5)} more` : ""}.` : ""}${others.length ? ` Also cited, with no profile planned: ${others.slice(0, 4).join(", ")}.` : ""}`
        : "The recorded answers cited no directory or listing where a profile of Balkaris belongs.",
      source: "desk",
      asOf: listings.asOf,
      step: {
        who: "owner",
        text: "Create the directory profiles with the same name, address and phone everywhere, starting with the ones the answers cite most.",
        href: "/seo/backlinks",
        ownerTask: taskRef(taskOf(ctx, "directories")),
        ...opps("entity"),
      },
    });
  } else {
    levers.push({
      key: "listed",
      title: "Be listed where the answers look",
      why: "When an assistant answers a question about a service and a place, it names the studios its sources list: the directories and profiles it cited are where it finds names.",
      state: "unknown",
      figure: null,
      detail: "No answer is recorded yet, so no source the answers cite is known.",
      source: "desk",
      asOf: null,
      step: { who: "owner", text: "Record a round of answers (Answers by assistant) to see which directories they cite.", href: null, ownerTask: null, opportunities: null, opportunitiesHref: null },
    });
  }

  /* 3. A Business Profile, and reviews: the same record the site-wide row and the directory table read. */
  const gbp = businessProfile();
  const reviews = taskOf(ctx, "reviews");
  const gbpCited = listings.state === "ok" ? listings.value.directories.filter((d) => /business profiles?$/i.test(d.source) || d.profile?.key === "google-business-profile").reduce((n, d) => n + d.answers, 0) : 0;
  levers.push({
    key: "profile",
    title: "A Google Business Profile with reviews",
    why: "Google's AI answers name local studios from their Business Profiles, and quote what reviews say about them.",
    state: !gbp.row ? "unknown" : gbp.state === "pass" && reviews?.done ? "good" : gbp.state === "pass" || gbp.row.napSeen ? "warn" : "bad",
    figure: gbp.row ? `Profile ${gbp.word}` : null,
    detail: `${gbp.detail} ${gbpCited ? `The recorded answers cited Business Profiles ${plural(gbpCited, "time")}. ` : ""}Reviews: ${reviews ? (reviews.done ? `marked done by ${reviews.doneBy ?? "a person"}` : "the owner task is open") : "no owner task recorded"}; the desk has no source that counts them (Google's Places API would, once it is allowed on the desk's Google key).`,
    source: "desk",
    asOf: gbp.row?.checkedAt ?? null,
    step: {
      who: "owner",
      text: "Fix the Business Profile (category, services, the one true address), then ask past clients for a review there.",
      href: "/seo/backlinks",
      ownerTask: taskRef(taskOf(ctx, gbp.row?.ownerTaskId ?? "business-profile") ?? reviews),
      opportunities: null,
      opportunitiesHref: null,
    },
  });

  /* 4. German answer pages */
  const dePages = ctx.view.pages.filter((p) => p.lang === "de" && p.status === 200).length;
  const de = asked((r) => r.lang === "de");
  let kwLine = "";
  try {
    const rel = keywords().filter((k) => k.status === "relevant");
    const deRel = rel.filter((k) => k.lang === "de").length;
    if (rel.length) kwLine = ` German phrases among the relevant search phrases in the keyword table: ${fmt(deRel)} of ${fmt(rel.length)}.`;
  } catch {
    kwLine = "";
  }
  const germanOpen = openOf("german-missing");
  levers.push({
    key: "german",
    title: "German answer pages",
    why: "An assistant answers a German question from German pages: an English-only site is not a source for it.",
    state: !ctx.view.at ? "unknown" : dePages === 0 ? "bad" : germanOpen ? "warn" : "good",
    figure: ctx.view.at ? `${plural(dePages, "German page")} on the site` : null,
    detail: `${de.asked ? `Answers to German questions that named Balkaris: ${fmt(de.named)} of ${fmt(de.asked)}.` : "No German question recorded yet."}${kwLine}`,
    source: "crawl",
    asOf: ctx.view.at,
    step: {
      who: "content",
      text: "Write German (de-CH) pages that answer the questions clients ask, the price questions first, linked to their English pages with hreflang.",
      href: oppsHref("german-missing"),
      ownerTask: null,
      ...opps("german-missing"),
    },
  });

  /* 5. Prices: the owner decides the ranges (Needs you lists the task), the pages then state them. */
  const price = tally("price");
  const priceAsked = asked((r) => r.kind === "price");
  let pricePhrases = "";
  try {
    const rel = keywords().filter((k) => k.status === "relevant");
    const p = rel.filter((k) => k.flags.price).length;
    if (rel.length) pricePhrases = ` Price phrases among the relevant search phrases: ${fmt(p)} of ${fmt(rel.length)}.`;
  } catch {
    pricePhrases = "";
  }
  const priceTask = taskOf(ctx, "price-ranges");
  levers.push({
    key: "prices",
    title: "State prices",
    why: "Asked what a service costs, an assistant quotes pages that state a price; a page without one is passed over for one that has it.",
    state: price ? shareState(price.pass, price.applies) : "unknown",
    figure: price ? `${fmt(price.pass)} of ${plural(price.applies, "page")} state a price` : null,
    detail: `${price ? "A CHF amount stated on the pages where the readiness check looks for one." : "The readiness check has not read the pages yet."} ${priceAsked.asked ? `Price questions recorded: Balkaris named in ${fmt(priceAsked.named)} of ${fmt(priceAsked.asked)} answers.` : ""}${pricePhrases}`.trim(),
    source: "crawl",
    asOf: readAt,
    step: {
      who: "owner",
      text: "Decide the price ranges you are willing to publish (\"from CHF …\") for each service; the pages then state them.",
      href: oppsHref("missing-answer"),
      ownerTask: taskRef(priceTask),
      opportunities: null,
      opportunitiesHref: null,
    },
  });

  /* 6. Direct answers and questions on the pages */
  const ans = tally("answer");
  const faq = tally("faq");
  const schema = tally("faq-schema");
  levers.push({
    key: "answers",
    title: "Direct answers and FAQ on the pages",
    why: "Assistants quote a short paragraph that answers the question outright, and questions answered on the page; pages that open with a slogan give them nothing to quote.",
    state: ans ? shareState(ans.pass, ans.applies) : "unknown",
    figure: ans ? `${fmt(ans.pass)} of ${plural(ans.applies, "page")} open with a direct answer` : null,
    detail: ans
      ? `${faq ? `Questions answered on the page: ${fmt(faq.pass)} of ${fmt(faq.applies)}.` : ""} ${schema ? `FAQ in structured data: ${fmt(schema.pass)} of ${fmt(schema.applies)} pages with questions.` : ""}`.trim() || "Read by the daily readiness check."
      : "The readiness check has not read the pages yet.",
    source: "crawl",
    asOf: readAt,
    step: {
      who: "content",
      text: "Write a 50 to 100 word answer as the first paragraph under each page's heading, and five to eight client questions with short answers.",
      href: oppsHref("missing-answer"),
      ownerTask: null,
      ...opps("missing-answer"),
    },
  });

  /* 7. Bing. Its key is connected under Settings › Sources, not on Settings' first tab (People). */
  const bingOn = bing.configured();
  levers.push({
    key: "bing",
    title: "Bing knows the site",
    why: "Copilot and ChatGPT search draw on Bing's index; Bing Webmaster is also where Bing's AI Performance report is.",
    state: bingOn ? "good" : "bad",
    figure: bingOn ? "Bing Webmaster connected" : "Bing Webmaster not set up",
    detail: bingOn ? "The desk reads Bing Webmaster with its key." : "The desk has no Bing Webmaster key (BING_API_KEY), and no record says the site is verified there.",
    source: "bing",
    asOf: null,
    step: { who: "owner", text: bing.step(), href: "/settings?tab=sources", ownerTask: taskRef(taskOf(ctx, "bing-webmaster")), opportunities: null, opportunitiesHref: null },
  });

  /* 8. One name, address and phone: the same comparison as the site-wide row. */
  const nap = napRead();
  levers.push({
    key: "nap",
    title: "One name, address and phone everywhere",
    why: "An assistant that finds two addresses for one studio cannot tell they are the same business, and names neither with confidence.",
    state: !nap.stated ? "unknown" : nap.consistent ? "good" : "bad",
    figure: !nap.stated ? null : nap.consistent ? "The same everywhere" : nap.differ,
    detail: !nap.stated ? "No profile states them yet." : `Compared over ${plural(nap.sources, "source")}: the website and the profiles, as read or as the audit saw them.`,
    source: "desk",
    asOf: null,
    step: { who: "owner", text: "Decide the one true name, address and phone, then copy it to the website and every profile.", href: "/seo/backlinks", ownerTask: taskRef(taskOf(ctx, "nap-decision")), opportunities: null, opportunitiesHref: null },
  });

  return ok(levers, "desk", new Date().toISOString(), "Each lever is read from the desk's own records; the sentence on why it matters is reasoning, not a measurement.");
}

/* ---------- imports ---------------------------------------------------------------------------------- */

/** Rows of an import the page carries: it shows ten. */
const IMPORT_ROWS = 10;

function importPanel(kind: ImportKind): Reading<ManualImport> {
  const got = lastImport(kind);
  const source: SourceId = kind === "bing-ai-performance" ? "bing" : "gsc";
  const what = kind === "bing-ai-performance" ? "Bing's AI Performance report" : "Search Console's Generative AI report";
  if (got) {
    const shown: ManualImport = { ...got, rows: got.rows.slice(0, IMPORT_ROWS), total: got.rows.length };
    return ok(shown, source, got.importedAt, `${what} as exported, imported by ${got.importedBy}. In no API: one CSV a month, imported by the owner.`);
  }
  if (kind === "bing-ai-performance" && !bing.configured()) {
    return off("bing", `${what} is in Bing Webmaster Tools, which is not set up for the site yet, so there is nothing to export.`, "The owner sets up Bing Webmaster first (Needs you), then exports the report once a month and imports it here.");
  }
  return waiting(source, `Nothing imported yet. ${what} is in no API: it is exported as CSV once a month and imported here by the owner.`);
}

function importSteps(ctx: Ctx): SeoAiSearchPayload["importSteps"] {
  const gscTask = taskOf(ctx, "gsc-generative-ai");
  const bingTask = taskOf(ctx, "bing-webmaster");
  const g: ImportStep = {
    kind: "gsc-generative-ai",
    title: "Search Console: Generative AI",
    where: gscTask?.step ?? "Open Search Console's Generative AI report for the site, export one month as CSV, and import it here.",
    needs: null,
    ownerTask: taskRef(gscTask),
  };
  const b: ImportStep = {
    kind: "bing-ai-performance",
    title: "Bing Webmaster: AI Performance",
    where: "Open Bing Webmaster Tools' AI Performance report for the site, export one month as CSV, and import it here.",
    needs: bing.configured() ? null : "Bing Webmaster Tools set up for the site (Needs you).",
    ownerTask: bing.configured() ? null : taskRef(bingTask),
  };
  return { gscGenerativeAi: g, bingAiPerformance: b };
}

/* ---------- opportunities and owner tasks --------------------------------------------------------- */

const OPEN = new Set(["open", "queued", "in-progress"]);
/** The kinds of opportunity that decide whether AI answers can name and quote the site. */
const AI_TYPES: OpportunityType[] = ["missing-answer", "german-missing", "not-indexed", "entity"];
/** The opportunities this page lists: what is changed on the site itself. */
const LISTED: OpportunityType[] = ["missing-answer", "german-missing"];

function openRows(view: SiteView): OpportunityRow[] {
  const names = clusterNames();
  return allOpportunities()
    .filter((o) => o.active && OPEN.has(o.state) && AI_TYPES.includes(o.type))
    .map((o) => toRow(o, view, names))
    .sort(rank);
}

/** The listed kinds side by side: the best of each, then the second of each … (each kind's own order kept). */
function mixed(rows: OpportunityRow[], most: number): OpportunityRow[] {
  const queues = LISTED.map((t) => rows.filter((r) => r.type === t));
  const out: OpportunityRow[] = [];
  while (out.length < most && queues.some((q) => q.length)) for (const q of queues) if (q.length && out.length < most) out.push(q.shift()!);
  return out;
}

/** Owner and browser steps that decide AI visibility. */
const AI_TASKS = new Set([
  "business-profile",
  "reviews",
  "directories",
  "bing-webmaster",
  "nap-decision",
  "gsc-request-indexing",
  "gsc-validate-noindex",
  "gsc-generative-ai",
  "linkedin",
  "bing-places-apple",
  "local-listings",
  "local-business-lists",
  "commercial-register",
  "wikidata",
  "off-site-presence",
  "price-ranges",
  "crawl-demand",
]);

/**
 * Tasks the engine files as content or code whose first step is the owner's
 * decision: the price ranges are his to decide before any page can state
 * them, so the prices lever sends him here and Needs you lists it.
 */
const OWNER_DECISIONS = new Set(["price-ranges"]);

function needsYou(tasks: OwnerTask[]): OwnerTaskRow[] {
  return tasks
    .filter((t) => ((t.whoAll === "owner" || t.whoAll === "lead-chrome") && (AI_TASKS.has(t.id) || /\bAI\b|ChatGPT|Perplexity|Gemini|Copilot/i.test(t.title))) || OWNER_DECISIONS.has(t.id))
    .map(({ whoAll: _w, ...t }) => ({ ...t, title: tidyTitle(t) }));
}

/* ---------- the operator's suggestions ----------------------------------------------------------- */

/** Suggestions made from what the page read: only for what is actually missing, each a real task kind, each short enough for the queue. */
function suggestions(ctx: Ctx): { label: string; task: NewTask }[] {
  const out: { label: string; task: NewTask }[] = [];
  /* Every page read, not the table's filtered rows: a suggestion speaks for the site. */
  const read = safe([] as PageReadiness[], () => pageReadiness().pages);
  const failing = (k: string) => read.filter((p) => p.checks.some((c) => c.key === k && c.state === "fail")).map((p) => p.path);

  const noAnswer = failing("answer");
  if (noAnswer.length) {
    out.push({
      label: `Brief: direct answers for the ${plural(noAnswer.length, "page")} that open without one`,
      task: {
        kind: "brief",
        prompt: cut(
          `Direct answers for these pages, each 50 to 100 words, written as the first paragraph under the page's heading: ${noAnswer.slice(0, 8).join(", ")}. Each answers the question the page is about in its first sentence, says who does the work and where (Balkaris, Zürich), and leaves any price for the owner to fill in.`,
          PROMPT_MOST,
        ),
        depth: "deep",
      },
    });
  }
  const unnamedDe = ctx.rows.find((r) => r.lang === "de" && !PROMPTED.has(r.kind) && r.mentioned === false);
  if (unnamedDe) {
    out.push({
      label: `Brief: a German answer page for “${cut(unnamedDe.question, 60)}”`,
      task: {
        kind: "brief",
        prompt: cut(
          `A German (de-CH) page that answers the question “${unnamedDe.question}” for Swiss clients: a direct answer of 50 to 100 words under the heading, what the answer depends on, how Balkaris works, and five client questions with short answers. Leave every price for the owner to fill in.`,
          PROMPT_MOST,
        ),
        depth: "deep",
      },
    });
  }
  const noFaq = failing("faq");
  if (noFaq.length) {
    out.push({
      label: `Brief: client questions for the ${plural(noFaq.length, "page")} without any`,
      task: {
        kind: "brief",
        prompt: cut(`Five to eight questions clients ask, each with a short specific answer, for these pages: ${noFaq.slice(0, 8).join(", ")}. To be shown on the page and marked up as FAQPage.`, PROMPT_MOST),
        depth: "deep",
      },
    });
  }
  const questions = [...new Set(ctx.rows.filter((r) => !PROMPTED.has(r.kind) && r.mentioned === false).map((r) => r.question))];
  if (questions.length) {
    /* As many questions as fit the queue's limit with the instruction around them. */
    const lead = "AI assistants were asked these questions and did not name Balkaris: ";
    const tail = ". For each, which page of the website comes closest to answering it, what that page lacks for an assistant to quote it (a direct answer, a price, a German version, questions answered), and which page is missing altogether. Answer from the pages only.";
    const fit: string[] = [];
    for (const q of questions) {
      const next = [...fit, `“${q}”`].join("; ");
      if (lead.length + next.length + tail.length > PROMPT_MOST) break;
      fit.push(`“${q}”`);
    }
    if (fit.length) {
      out.push({
        label: "Which pages could an assistant quote for the questions asked?",
        task: { kind: "ask", prompt: `${lead}${fit.join("; ")}${tail}`, context: "website", depth: "deep" },
      });
    }
  }
  out.push({ label: "Find SEO opportunities in the crawl and Search Console", task: { kind: "opportunities", depth: "deep" } });
  return out.slice(0, 6);
}

/* ---------- the page ----------------------------------------------------------------------------------- */

function contextOf(range: SeoRange, asked: AiSearchAsked): Ctx {
  const view = siteView();
  const all = safe([], () => checks());
  const tracked = safe([], () => trackedQuestions());
  /* A retired question's answers are kept and shown apart, and leave every count: the share is over the questions tracked. */
  const retired = new Set(tracked.filter((t) => !t.active).map((t) => t.key));
  const everyDay = newestOf(all, dayKey);
  const byDay = everyDay.filter((r) => !retired.has(qKey(r.question)));
  return {
    range,
    asked,
    view,
    all,
    byDay,
    rows: newestOf(byDay, pairKey),
    everyRow: newestOf(everyDay, pairKey),
    replaced: all.length - everyDay.length,
    tracked,
    tasks: safe([], () => ownerTasks(["owner", "lead-chrome", "code", "content"])),
    open: safe([], () => openRows(view)),
  };
}

export async function aiSearch(range: SeoRange, asked: AiSearchAsked): Promise<SeoAiSearchPayload> {
  const h = head(range);
  const ctx = contextOf(range, asked);

  const [checksR, answersR, referralsR, crawlersR, readinessR, listingsR, gscImport, bingImport] = await Promise.all([
    reading("desk", () => checksPanel(ctx)),
    reading("desk", () => answersPanel(ctx)),
    reading("ga4", () => referralsPanel(range)),
    reading("vercel-drain", () => crawlersPanel(range)),
    reading("crawl", () => readinessPanel(ctx)),
    reading("desk", () => listingsPanel(ctx)),
    reading("gsc", () => importPanel("gsc-generative-ai")),
    reading("bing", () => importPanel("bing-ai-performance")),
  ]);
  const [levers, askingR] = await Promise.all([reading("desk", () => leversPanel(ctx, listingsR, readinessR)), reading("desk", () => askingPanel(ctx))]);

  const counts = new Map<OpportunityType, number>();
  for (const o of ctx.open) counts.set(o.type, (counts.get(o.type) ?? 0) + 1);

  return {
    head: h,
    asked,
    checks: checksR,
    answers: answersR,
    asking: askingR,
    referrals: referralsR,
    crawlers: crawlersR,
    readiness: readinessR,
    imports: { gscGenerativeAi: gscImport, bingAiPerformance: bingImport },
    opportunities: mixed(ctx.open, 12),
    needsYou: needsYou(ctx.tasks),
    levers,
    listings: listingsR,
    opportunityTypes: AI_TYPES.map((type) => ({ type, label: TYPE_LABEL[type] ?? type, count: counts.get(type) ?? 0, href: oppsHref(type) })),
    operator: operatorPanel(safe([], () => suggestions(ctx))),
    importSteps: safe(
      {
        gscGenerativeAi: { kind: "gsc-generative-ai", title: "Search Console: Generative AI", where: "Exported from Search Console once a month.", needs: null, ownerTask: null },
        bingAiPerformance: { kind: "bing-ai-performance", title: "Bing Webmaster: AI Performance", where: "Exported from Bing Webmaster Tools once a month.", needs: null, ownerTask: null },
      },
      () => importSteps(ctx),
    ),
    engines: ENGINES.map((engine) => ({ engine, label: ENGINE_LABEL[engine] })),
    visitsJob: jobOf("seo-referrals"),
  };
}

routes.get("/", async (c) => c.json<SeoAiSearchPayload>(await aiSearch(rangeFrom(c), askedOf(c))));

/** One page's readiness checks with what each read: the readiness table opens a row with it. */
routes.get("/page", (c) => {
  const path = c.req.query("path") ?? "";
  if (!path.startsWith("/") || path.length > 500) return c.json<ApiError>({ error: "path must be a page's address on the site, starting with /." }, 400);
  return c.json<PageReadinessAnswer>(pageAnswer(path));
});

/** One question with every answer kept, each assistant's earlier answers and what changed. Null when the desk knows no such question. */
routes.get("/question", (c) => {
  const q = text(c.req.query("q"), 300);
  if (q.length < 3) return c.json<ApiError>({ error: "q must be the question (3 to 300 characters)." }, 400);
  const ctx = contextOf(rangeFrom(c), askedOf(c));
  const found = questionsOf(ctx).get(qKey(q));
  return c.json<{ question: AiQuestionDetail | null }>({ question: found ? detailOf(ctx, found, newestByPair(ctx).get(found.key), ENGINES) : null });
});

/* ---------- the CSV ------------------------------------------------------------------------------------ */

const NAMED_WORD = (m: boolean | null): string => (m === null ? "could not be read" : m ? "yes" : "no");

/**
 * The page's lists as a CSV a writer or a client can open: every record kept
 * (with whether it is the one counted), every page read with each check's
 * state, every company named, every directory cited.
 */
routes.get("/export", (c) => {
  const what = oneOf(c.req.query("what"), ["answers", "readiness", "named", "directories"] as const, "answers");
  const ctx = contextOf(rangeFrom(c), { ...askedOf(c), named: "all", who: "", pages: "all", fail: null, find: "", kind: "" });
  if (what === "answers") {
    const counted = new Set(ctx.rows.map((r) => r.id));
    return csvFile(
      c,
      "ai-answers",
      ["Day", "Assistant", "Question", "Language", "Kind", "Named Balkaris", "Place", "Companies named", "Sources cited", "What it said", "Note", "Recorded by", "Counted"],
      ctx.all.map((r) => [r.day, r.engineLabel, r.question, r.lang, r.kind, NAMED_WORD(r.mentioned), r.position, r.competitors.join("; "), r.sources.join("; "), r.excerpt, r.note, r.by, counted.has(r.id) ? "yes" : "no (an earlier or replaced record)"]),
    );
  }
  if (what === "readiness") {
    const pages = safe([] as PageReadiness[], () => pageReadiness().pages);
    const keys: string[] = [];
    for (const p of pages) for (const k of p.checks) if (!keys.includes(k.key)) keys.push(k.key);
    const label = (k: string) => pages.flatMap((p) => p.checks).find((x) => x.key === k)?.label ?? k;
    return csvFile(
      c,
      "ai-readiness",
      ["Page", "Title", "Kind", "Language", ...keys.map(label), "Pass", "Of", "Newest read failed"],
      pages.map((p) => [p.path, ownTitle(p.title), p.kind, p.lang, ...keys.map((k) => p.checks.find((x) => x.key === k)?.state ?? ""), p.pass, p.of, p.unread ? p.unread.why : ""]),
    );
  }
  const l = listingsPanel(ctx);
  if (l.state !== "ok") return c.json<ApiError>({ error: "No answer is recorded yet, so there is nothing to export." }, 409);
  if (what === "named") return csvFile(c, "ai-named", ["Company", "Answers", "Questions", "Assistants"], l.value.named.map((n) => [n.name, n.answers, n.questions, n.engines.join("; ")]));
  return csvFile(
    c,
    "ai-directories",
    ["Source", "Cited in answers", "Assistants", "Balkaris there", "Profile", "Owner task", "Task done"],
    l.value.directories.map((d) => [d.source, d.answers, d.engines.join("; "), d.profile?.state ?? "no profile known", d.profile?.name ?? "", d.ownerTask?.title ?? "", d.ownerTask ? (d.ownerTask.done ? "yes" : "no") : ""]),
  );
});

/* ---------- recording answers (the owner's) ------------------------------------------------------- */

/**
 * One answer as a person read it in a browser (the owner's). Recorded as
 * "lead-chrome": a person's record, never the audit's. Recording the same
 * question, assistant and day again changes the person's own record; where
 * another recorder (the audit) has one for that day, the person's takes its
 * place in every count and the other is kept. The answer says which happened.
 */
routes.post("/record", requireOwner, async (c) => {
  const b = await body(c);
  const raw = b.check && typeof b.check === "object" && !Array.isArray(b.check) ? (b.check as Partial<NewAiCheck>) : {};
  const check = { ...raw, by: "lead-chrome" } as NewAiCheck;
  const why = checkRefusal(check);
  if (why) return c.json<ApiError>({ error: why }, 400);
  if (check.day > today()) return c.json<ApiError>({ error: "day cannot be after today: record an answer on the day it was given." }, 400);
  const result = addCheck(check, me(c).name);
  const k = qKey(check.question);
  const same = checks().filter((r) => r.engine === check.engine && r.day === check.day && qKey(r.question) === k);
  const counted = newestOf(same, dayKey)[0] ?? null;
  const mine = same.find((r) => r.by === check.by) ?? null;
  const others = same.filter((r) => r.by !== check.by).sort((a, b) => b.id - a.id);
  const isCounted = !!mine && counted?.id === mine.id;
  return c.json<RecordAnswer>({
    ok: true,
    result,
    replaces: isCounted && others[0] ? { by: others[0].by, id: others[0].id } : null,
    counted: isCounted,
  });
});

/** A round holds at most this many answers: seven assistants asked fourteen questions. */
const ROUND_MOST = 100;

/**
 * A whole round in one go (the owner's): typed line by line in the form
 * ({ checks }), or pasted as JSON or a sheet's CSV ({ text, engine?, day? };
 * aisearch.ts parseRound reads it). Every answer is a person's record
 * ("lead-chrome") and goes through the same rule as one answer; a line that
 * is not right is skipped with why, the rest are recorded. Nothing is
 * recorded when no line is right.
 */
routes.post("/round", requireOwner, async (c) => {
  const b = await body(c);
  const by = me(c).name;
  let lines: Partial<NewAiCheck>[] = [];
  const skipped: string[] = [];
  if (Array.isArray(b.checks)) {
    lines = b.checks.filter((x): x is Partial<NewAiCheck> => !!x && typeof x === "object" && !Array.isArray(x));
  } else if (typeof b.text === "string") {
    if (b.text.length > 200_000) return c.json<ApiError>({ error: "The pasted text is longer than 200,000 characters: paste one round at a time." }, 400);
    const ctx = contextOf("30d", askedOf(c));
    const known = new Map([...questionsOf(ctx).values()].map((q) => [q.key, { lang: q.lang, kind: q.kind }]));
    const engine = typeof b.engine === "string" && (ENGINES as string[]).includes(b.engine) ? (b.engine as AiEngine) : undefined;
    const day = typeof b.day === "string" && /^\d{4}-\d\d-\d\d$/.test(b.day) ? b.day : undefined;
    const parsed = parseRound(b.text, { engine, day, known });
    lines = parsed.checks;
    skipped.push(...parsed.problems);
  } else {
    return c.json<ApiError>({ error: "Send the round as { checks: [...] }, or the pasted text as { text }." }, 400);
  }
  if (!lines.length) return c.json<ApiError>({ error: skipped[0] ? `Nothing to record: ${skipped[0]}` : "The round holds no answer." }, 400);
  if (lines.length > ROUND_MOST) return c.json<ApiError>({ error: `A round holds at most ${ROUND_MOST} answers; this one has ${fmt(lines.length)}. Record it in parts.` }, 400);
  const good: NewAiCheck[] = [];
  for (const [i, raw] of lines.entries()) {
    const check = { ...raw, by: "lead-chrome" } as NewAiCheck;
    const why = checkRefusal(check) ?? (typeof check.day === "string" && check.day > today() ? "day cannot be after today." : null);
    if (why) skipped.push(`answer ${i + 1}${typeof check.question === "string" ? ` (“${cut(check.question, 50)}”)` : ""}: ${why}`);
    else good.push(check);
  }
  if (!good.length) return c.json<ApiError>({ error: `No answer of the round could be recorded. The first: ${skipped[0]}` }, 400);
  const results: RoundAnswer["results"] = good.map((check) => ({ engine: check.engine, question: check.question.trim(), result: addCheck(check, by) }));
  const n = (r: string) => results.filter((x) => x.result === r).length;
  const added = n("added");
  const changed = n("changed");
  const unchanged = n("unchanged");
  if (added + changed) {
    note("seo-ai", `Recorded a round of AI answers: ${plural(added + changed, "answer")}`, {
      tone: "info",
      actor: by,
      detail: `${fmt(added)} new, ${fmt(changed)} changed, ${fmt(unchanged)} unchanged${skipped.length ? `; ${plural(skipped.length, "line")} skipped` : ""}.`,
      href: "/seo/ai-search",
      dedupe: `seo:ai-round:${today()}:${added}:${changed}:${results.map((r) => r.question).join("|").length}`,
    });
  }
  return c.json<RoundAnswer>({
    ok: true,
    line: `Recorded ${plural(good.length, "answer")}: ${fmt(added)} new, ${fmt(changed)} changed, ${fmt(unchanged)} unchanged.${skipped.length ? ` Skipped ${fmt(skipped.length)}: ${skipped.slice(0, 2).join(" ")}${skipped.length > 2 ? " …" : ""}` : ""}`,
    results,
    added,
    changed,
    unchanged,
    skipped,
  });
});

const idOf = (c: Context<Vars>): number | null => {
  const n = Number(c.req.param("id"));
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Correct one record in place: a wrong assistant, day, question or anything it said (aisearch.ts editCheck). The owner's. */
routes.post("/record/:id", requireOwner, async (c) => {
  const id = idOf(c);
  if (!id) return c.json<ApiError>({ error: "That is not a record's number." }, 400);
  const b = await body(c);
  const raw = b.check && typeof b.check === "object" && !Array.isArray(b.check) ? (b.check as Partial<NewAiCheck>) : {};
  const had = checkById(id);
  if (!had) return c.json<ApiError>({ error: `There is no recorded answer ${id}.` }, 404);
  /* The recorder is the record's (a correction of the audit's becomes a person's, in editCheck); the form need not send it. */
  const check = { ...raw, by: had.by === "audit" ? "lead-chrome" : had.by } as NewAiCheck;
  const why = checkRefusal(check) ?? (check.day > today() ? "day cannot be after today." : null);
  if (why) return c.json<ApiError>({ error: why }, 400);
  let result: "changed" | "unchanged";
  try {
    result = editCheck(id, check);
  } catch (e) {
    return c.json<ApiError>({ error: e instanceof Error ? e.message : String(e) }, 409);
  }
  if (result === "changed") {
    note("seo-ai", `Corrected a recorded answer: ${ENGINE_LABEL[check.engine]}, “${cut(check.question.trim(), 80)}”`, {
      tone: "quiet",
      actor: me(c).name,
      detail: `Record ${id}, for ${check.day}.${had.by === "audit" ? " It was the audit's; corrected, it is a person's record now." : ""}`,
      href: "/seo/ai-search",
      dedupe: `seo:ai-edit:${id}:${Date.now()}`,
    });
  }
  return c.json<AiDone>({ ok: true, line: result === "changed" ? `Corrected. ${had.by === "audit" ? "It was the audit's record; it is yours now, and importing the audit again will not undo it." : "The page counts the corrected answer."}` : "Unchanged: the record already said exactly this." });
});

async function removeRecord(c: Context<Vars>): Promise<Response> {
  const id = idOf(c);
  if (!id) return c.json<ApiError>({ error: "That is not a record's number." }, 400);
  const gone = removeCheck(id, me(c).name);
  if (!gone) return c.json<ApiError>({ error: `There is no recorded answer ${id}: it may have been removed already.` }, 404);
  return c.json<AiDone>({ ok: true, line: `Removed ${gone.engineLabel}'s answer of ${shortDay(gone.day)} to “${cut(gone.question, 60)}”. It no longer counts, and importing the audit again will not bring it back.` });
}

/** Remove one record and its sightings (aisearch.ts removeCheck). The owner's. */
routes.post("/record/:id/remove", requireOwner, removeRecord);
routes.delete("/record/:id", requireOwner, removeRecord);

/**
 * Put a question on the list, change its language or kind, or retire it (the
 * owner's). Retiring removes nothing: its answers are kept and shown apart.
 * A question recorded before keeps the language and kind of its records
 * unless the body says otherwise.
 */
routes.post("/questions", requireOwner, async (c) => {
  const b = await body(c);
  const question = typeof b.question === "string" ? b.question.replace(/\s+/g, " ").trim() : "";
  const ctx = contextOf("30d", askedOf(c));
  const had = questionsOf(ctx).get(qKey(question));
  const q = { question, lang: b.lang ?? had?.lang ?? guessLang(question), kind: b.kind ?? had?.kind ?? "category" };
  const why = questionRefusal(q);
  if (why) return c.json<ApiError>({ error: why }, 400);
  if (typeof b.active !== "boolean") return c.json<ApiError>({ error: "active must be true (track it) or false (retire it)." }, 400);
  const result = setQuestion(q as { question: string; lang: "de" | "en"; kind: AiCheckRow["kind"] }, b.active, me(c).name);
  if (result !== "unchanged") {
    note("seo-ai", `${b.active ? "Tracking" : "Retired"} the AI question “${cut(question, 80)}”`, { tone: "quiet", actor: me(c).name, href: "/seo/ai-search", dedupe: `seo:ai-question:${qKey(question)}:${b.active}:${Date.now()}` });
  }
  const answers = had ? ENGINES.filter((e) => newestByPair(ctx).get(had.key)?.has(e)).length : 0;
  return c.json<AiDone>({
    ok: true,
    line: !b.active
      ? result === "unchanged"
        ? "It was retired already."
        : `Retired. ${answers ? `Its ${plural(answers, "answer")} ${answers === 1 ? "is" : "are"} kept, shown under Retired questions, and no longer counted.` : "It is left out of the rounds ahead."}`
      : result === "added"
        ? `Tracked: it is asked of every assistant each round. ${answers ? `${plural(answers, "assistant")} answered it before.` : "No assistant has been asked it yet."}`
        : result === "changed"
          ? had && !had.active
            ? `Tracked again${answers ? `: its ${plural(answers, "answer")} count${answers === 1 ? "s" : ""} again` : ""}.`
            : "Changed: its words, language or kind now read as given."
          : "It is on the list already.",
  });
});

/* ---------- readiness, now ------------------------------------------------------------------------- */

/**
 * Read one page again now and judge it: after an answer or a price went onto
 * the page, without waiting for the daily run. One request to the website, on
 * the readiness check's own polite clock. A page that does not answer 200
 * keeps its last good read, and the answer says how it answered.
 */
routes.post("/page/check", async (c) => {
  const b = await body(c);
  const path = typeof b.path === "string" ? b.path.trim() : "";
  if (!path.startsWith("/") || path.length > 500) return c.json<ApiError>({ error: "path must be a page's address on the site, starting with /." }, 400);
  const got = await checkPage(path);
  const answer = pageAnswer(path);
  if (got.ok) {
    const page = answer.page;
    const failing = page ? page.checks.filter((x) => x.state === "fail").map((x) => x.label) : [];
    return c.json<PageCheckAnswer>({
      ok: true,
      read: true,
      page,
      checkedAt: got.checkedAt,
      line: page ? `Read just now: ${fmt(page.pass)} of ${fmt(page.of)} checks pass.${failing.length ? ` Still failing: ${listed(failing, 3)}.` : ""}` : "Read just now.",
    });
  }
  /* Not a page the crawl knows: nothing was asked of the website. */
  if (!got.kept && !answer.page && /crawl knows no page|not in the sitemap/.test(got.why)) return c.json<ApiError>({ error: got.why }, 404);
  return c.json<PageCheckAnswer>({
    ok: true,
    read: false,
    page: answer.page,
    checkedAt: answer.checkedAt,
    line: `${got.why}${got.kept ? " Its last good read is kept and shown." : " No earlier read of it exists."}`,
  });
});

/** Ask the scheduler for one of this page's daily jobs now, ahead of its queue (the daily slot rarely comes). */
function runJob(c: Context<Vars>, name: string, what: string, takes: string): Response {
  const j = job(name);
  if (!j) return c.json<ApiError>({ error: `The desk has no ${what} job on this machine.` }, 404);
  if (j.running) return c.json<AiDone>({ ok: true, line: `It is running now${j.progress ? ` (${fmt(j.progress.done)} of ${fmt(j.progress.of)})` : ""}; the page shows what it found when it ends.` });
  if (!j.ready) return c.json<ApiError>({ error: `The ${what} cannot run on this machine: what it reads is not connected. Automations says what connects it.` }, 409);
  if (!j.enabled) return c.json<ApiError>({ error: `The ${what} is switched off in Automations; switch it on there first.` }, 409);
  if (!runNow(name)) return c.json<ApiError>({ error: `The scheduler did not take the ${what}.` }, 409);
  note("seo-action", `Asked for the ${what} now`, { tone: "quiet", actor: me(c).name, href: "/seo/ai-search", dedupe: `seo:ai-run:${name}:${Date.now()}` });
  return c.json<AiDone>({ ok: true, line: `Asked: the ${what} starts in a moment and ${takes}. Reload the page to see how far it is.` }, 202);
}

/** The readiness check of every sitemap page, now. */
routes.post("/readiness/run", (c) => runJob(c, "seo-readiness", "readiness check", "reads every sitemap page a second apart, about two minutes for a hundred"));

/** GA4's read of the referrals and the AI assistants' visits, now. */
routes.post("/visits/run", (c) => runJob(c, "seo-referrals", "read of AI assistant visits from GA4", "asks GA4 once"));

/* ---------- this page's buttons that change something ---------------------------------------------- */

const NEEDS_OPERATOR = "Queueing work for the AI Operator takes edit on the AI Operator as well as on SEO. The owner gives it on Team › Access & Roles.";
const operates = (who: Person): boolean => !!who.owner || areaLevel(who, "operator") === "edit";

const ActBody = z.object({ ids: z.array(z.string().min(3).max(400)).min(1).max(25) });

/**
 * Take the action of each opportunity asked about (engine.ts `act`), from
 * this page: a brief or a proposal queues an operator task (which takes the
 * AI Operator as well), a step in the website's code is marked queued for it.
 * The same rule as the Overview's door, behind this page's switch.
 */
routes.post("/act", async (c) => {
  const b = ActBody.parse(await c.req.json().catch(() => ({})));
  const by = me(c);
  const ids = [...new Set(b.ids)];
  const queues = (id: string): boolean => {
    try {
      const kind = (JSON.parse(opportunityDb(id)?.action ?? "{}") as { kind?: string }).kind;
      return kind === "proposal" || kind === "brief";
    } catch {
      return false;
    }
  };
  if (!operates(by) && ids.every(queues)) return c.json<ApiError>({ error: NEEDS_OPERATOR }, 403);
  const results: OpportunitiesActed["results"] = [];
  const done: OpportunityRow[] = [];
  for (const id of ids) {
    if (!operates(by) && queues(id)) {
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
  const refused = results.filter((r) => !r.ok);
  const error = refused.length === 1 ? refused[0]!.line : `None of the ${refused.length} could be taken. The first: ${refused[0]?.line ?? "no reason given"}`;
  return c.json<OpportunitiesActed & { error: string }>({ ok: true, results, opportunities: done, error }, 409);
});

const OwnerBody = z.object({ id: z.string().min(1).max(200), done: z.boolean(), note: z.string().max(1000).optional().nullable() });

/**
 * A person marks an owner task done, or open again. The desk never marks one
 * by itself; the owner's own steps (his accounts, his decisions) are his to
 * close, a step taken in his browser anybody's who may change this page.
 */
routes.post("/owner", async (c) => {
  const b = OwnerBody.parse(await c.req.json().catch(() => ({})));
  const had = ownerTask(b.id);
  if (!had) return c.json<ApiError>({ error: `There is no owner task ${b.id}.` }, 404);
  if (had.whoAll === "owner" && !me(c).owner) return c.json<ApiError>({ error: "Only the owner can mark his own steps." }, 403);
  const task = markOwnerTask(b.id, b.done, me(c).name, b.note ?? null);
  if (!task) return c.json<ApiError>({ error: `There is no owner task ${b.id}.` }, 404);
  const { whoAll: _w, ...row } = task;
  return c.json<OwnerTaskAnswer>({ ok: true, task: row });
});

const TaskBody = z.object({
  kind: z.enum(["ask", "traffic", "opportunities", "metadata", "redirect", "brief", "audit"]),
  prompt: z.string().max(PROMPT_MOST, `Keep the question under ${fmt(PROMPT_MOST)} characters: the workstation's model reads a few thousand in all, data included.`).optional(),
  context: z.enum(["website", "pages", "traffic", "issues", "insights", "none"]).optional(),
  depth: z.enum(["quick", "deep"]).optional(),
  paths: z.array(z.string().max(200)).max(10).optional(),
  path: z.string().max(200).optional(),
});

/**
 * Queue a task for the operator from this page (operator/queue.ts
 * createTask, the same queue and checks as AI Operator's own door), written
 * to the SEO log. It runs on the studio workstation's own model when the
 * workstation is on; what it proposes for the website waits for approval.
 */
routes.post("/task", async (c) => {
  const by = me(c);
  if (!operates(by)) return c.json<ApiError>({ error: NEEDS_OPERATOR }, 403);
  const b = TaskBody.parse(await c.req.json().catch(() => ({})));
  const task = await createTask(b as NewTask, by);
  const proposes = task.kind === "metadata" || task.kind === "redirect";
  note("seo-action", task.kind === "ask" ? `Asked the operator: ${task.title}` : `Queued for the operator: ${task.title}`, {
    tone: "info",
    actor: by.name,
    detail: `Operator task #${task.id} (${task.kindLabel}), from SEO › AI Search. It runs on the studio workstation's model when the workstation is on${proposes ? "; what it proposes waits for approval" : ""}.`,
    href: `/operator?result=${task.id}#response`,
    dedupe: `seo:task:${task.id}`,
  });
  return c.json<TaskAnswer>({ ok: true, task }, 202);
});
