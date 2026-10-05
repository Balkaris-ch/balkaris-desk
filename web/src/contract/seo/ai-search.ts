/**
 * GET /api/v1/seo/ai-search?range=30d&q=&show=&engine=&open=&named=&who=&fail=&find=&kind=&pages=&page=&psort=&asking=
 * AI search visibility: the owner's "0% on that side", measured. Every
 * filter, search and opened row is in the address (AiSearchAsked), so the
 * server draws it and a view can be shared.
 *
 *   (a) AI checks: a question asked of an assistant, and whether its answer
 *       named Balkaris. Recorded by the audit, by the lead in Chrome, or by an
 *       API; never guessed.
 *   (b) AI assistant visits: GA4 sessions from chatgpt.com, perplexity.ai,
 *       gemini.google.com, copilot.microsoft.com, claude.ai, you.com and the
 *       medium "ai-assistant", by landing page (consenting visitors only).
 *   (c) AI crawler visits per day and page, from Vercel's request records
 *       (aggregates only); waiting until the drain delivers.
 *   (d) AI readiness: per page and site-wide, from the desk's own fetch.
 *   (e) Search Console's "Generative AI" report and Bing's "AI Performance"
 *       report are in no API: monthly CSV imports, absent until the first.
 *
 * Changes, all under /api/v1/seo/ai-search so the page's own switch covers them:
 *   POST /record              owner  { check: NewAiCheck }                 one answer            → RecordAnswer
 *   POST /round               owner  { checks: NewAiCheck[] } | { text, engine?, day? }
 *                                    a whole round, typed or pasted (JSON or CSV)                → RoundAnswer
 *   POST /record/:id          owner  { check: NewAiCheck }                 correct a record      → AiDone
 *   POST /record/:id/remove   owner  (also DELETE /record/:id)             remove a record       → AiDone
 *   POST /questions           owner  { question, lang?, kind?, active }    track or retire one   → AiDone
 *   POST /page/check                 { path }       read one page again now and judge it        → PageCheckAnswer
 *   POST /readiness/run              ask for the readiness check of every page now             → AiDone
 *   POST /visits/run                 ask GA4 for the AI assistants' visits now                  → AiDone
 *   POST /act                        { ids }        an opportunity's action                      → OpportunitiesActed
 *   POST /owner                      { id, done }   an owner task's done mark (his own steps: the owner) → OwnerTaskAnswer
 *   POST /task                       NewTask        a task for the operator (the workstation's own model) → TaskAnswer
 * And the engine's own (src/cc/seo/api.ts), the owner's:
 *   POST /api/v1/seo/imports/gsc-generative-ai   { month: "2026-10", csv }  → ImportAnswer
 *   POST /api/v1/seo/imports/bing-ai-performance { month, csv }            → ImportAnswer
 *
 * Small reads:
 *   GET /api/v1/seo/ai-search/page?path=/a-page   one page's readiness checks        → PageReadinessAnswer
 *   GET /api/v1/seo/ai-search/question?q=…        one question with every answer kept → { question: AiQuestionDetail | null }
 *   GET /api/v1/seo/ai-search/export?what=answers|readiness|named|directories        → text/csv
 *
 * Types only.
 */
import type { Reading, SourceId } from "../common";
import type { NewTask } from "../operator";
import type { OperatorPanel, OpportunityRow, OpportunityType, OwnerTaskRow, SeoHead } from "./common";

export interface SeoAiSearchPayload {
  head: SeoHead;
  /** What the address asked for, as the server applied it. */
  asked: AiSearchAsked;
  checks: Reading<AiChecks>;
  /** The questions the filters let through, each with every assistant's newest answer, and the one opened in detail. */
  answers: Reading<AiAnswers>;
  /** Question-shaped searches from the keyword table, to choose what to track. */
  asking: Reading<AiAsking>;
  referrals: Reading<AiReferrals>;
  crawlers: Reading<AiCrawlers>;
  readiness: Reading<Readiness>;
  imports: { gscGenerativeAi: Reading<ManualImport>; bingAiPerformance: Reading<ManualImport> };
  /** The AI-readiness opportunities (missing answers, FAQ, German pages). */
  opportunities: OpportunityRow[];
  /** Owner tasks that decide AI visibility (Business Profile, Bing, reviews, listings). */
  needsYou: OwnerTaskRow[];
  /** What moves the share of answers naming Balkaris: each lever with what was read and the step that moves it. */
  levers: Reading<AiLever[]>;
  /** Where the recorded answers look: the directories and sites they cited, whether Balkaris is there, and who they named. */
  listings: Reading<AiListings>;
  /** Open opportunities of the kinds that decide AI answers, counted, each with the Opportunities list that shows them. */
  opportunityTypes: { type: OpportunityType; label: string; count: number; href: string }[];
  /** The AI SEO Operator: the desk's operator, with suggestions made from what this page read. */
  operator: OperatorPanel;
  /** Where each monthly report is exported, and what has to exist first. */
  importSteps: { gscGenerativeAi: ImportStep; bingAiPerformance: ImportStep };
  /** Every assistant a check can be recorded for, in the order the page lists them. */
  engines: { engine: AiEngine; label: string }[];
  /** The daily GA4 read of the assistants' visits as it stands, so "Read now" can say what is happening; null when the desk has no such job. */
  visitsJob: AiJob | null;
}

/** A daily job behind a panel, as the panel tells it: running, how far, and how its last run ended. */
export interface AiJob {
  running: boolean;
  /** "41 of 98: /branding" while it runs; null otherwise. */
  progress: string | null;
  lastStart: string | null;
  lastOk: boolean | null;
  lastNote: string | null;
  /** False while what it reads is not connected: it cannot be asked to run. */
  ready: boolean;
}

/* ---------- what the address asked for -------------------------------------------------- */

export interface AiSearchAsked {
  /** Search over the questions, the companies named, the sources cited and what the answers said. */
  q: string;
  /** Which questions: every one, those that do not name Balkaris (the default without a search), those that do, German, price. */
  show: "all" | "unprompted" | "prompted" | "de" | "price";
  /** One assistant's answers only, or "all". */
  engine: AiEngine | "all";
  /** The question opened in detail (its key: lower case, single spaces), or null: the first of the list is shown. */
  open: string | null;
  /** "Named instead": its first ten companies, every company, or the companies' own sites the answers cited. */
  named: "top" | "all" | "sites";
  /** Search in that panel's names. */
  who: string;
  /** Readiness table: only pages failing this check (its key), or null. */
  fail: string | null;
  /** Readiness table: search in a page's address and title. */
  find: string;
  /** Readiness table: one kind of page, or "". */
  kind: string;
  /** Readiness table: its first twelve rows, or all. */
  pages: "top" | "all";
  /** Readiness table: the page opened (its path), or null. */
  page: string | null;
  /** Readiness table's order: most failing checks first, by address, or most passing first. */
  psort: "fails" | "path" | "pass";
  /** "Questions people search": its first twelve, or all. */
  asking: "top" | "all";
}

/* ---------- the questions and their answers ---------------------------------------------- */

export interface AiAnswers {
  /** Every assistant as a column, with how many of the questions shown it has answered. */
  cols: { engine: AiEngine; label: string; answers: number }[];
  /** The filter chips, each counted over the search and the assistant chosen. */
  chips: { key: AiSearchAsked["show"]; label: string; count: number }[];
  /**
   * The questions the filters let through. A tracked question nobody has
   * asked yet is a row of empty cells: what is still missing is in view.
   */
  questions: AiQuestionRow[];
  /** Tracked questions before any filter, the answers counted for them, and the question and assistant pairs never asked, of all pairs. */
  tracked: number;
  counted: number;
  neverAsked: number;
  pairs: number;
  /** The question in detail: the one the address opens, else the first of the list; null when the list is empty. */
  open: AiQuestionDetail | null;
  /** Every tracked question before any filter, in the list's order: what the record and round forms offer. */
  all: { key: string; question: string; lang: "de" | "en"; kind: AiCheckRow["kind"] }[];
  /** Questions a person retired: kept with their answers, not listed, not in any count above. */
  retired: { key: string; question: string; lang: "de" | "en"; kind: AiCheckRow["kind"]; answers: number }[];
}

export interface AiQuestionRow {
  /** The question in lower case with single spaces: what `?open=` carries. */
  key: string;
  question: string;
  lang: "de" | "en";
  kind: AiCheckRow["kind"];
  /** Put on the list by a person (true), or tracked because it was recorded (false). */
  listed: boolean;
  /** The newest day any assistant answered it; null when nobody was asked yet. */
  day: string | null;
  /** In the columns' order: each assistant's newest answer, or null when it was never asked this. */
  cells: (AiCell | null)[];
  named: number;
  asked: number;
}

export interface AiCell {
  id: number;
  mentioned: boolean | null;
  position: number | null;
  day: string;
}

export interface AiQuestionDetail extends AiQuestionRow {
  /** False for a retired question opened by its address. */
  active: boolean;
  /** Each assistant that answered, in the columns' order: its newest answer, the ones before it and what changed. */
  answers: AiAnswerNow[];
  /** Tasks for the operator made from this question. They run on the studio workstation's own model, never a hosted one. */
  tasks: { label: string; task: NewTask }[];
}

export interface AiAnswerNow {
  now: AiCheckRow;
  /** The assistant's earlier answers to the question, newest first: for each day, the record that counted. */
  earlier: AiCheckRow[];
  /** What changed since the answer before, in a sentence ("Not named on 2 Oct 2026, named at place 3 now. New: …"); null when there is none before. */
  change: string | null;
}

/* ---------- questions people search ------------------------------------------------------- */

export interface AiAsking {
  /** Question-shaped phrases the keyword table holds that were not judged irrelevant. */
  total: number;
  /** The first twelve, or all: phrases Google showed the site for first, then price questions, then the rest. */
  rows: AskedPhrase[];
  /** The Search Console days the impressions cover; null when the desk has no history yet. */
  window: { start: string; end: string } | null;
}

export interface AskedPhrase {
  phrase: string;
  lang: "de" | "en" | null;
  /** It asks what something costs. */
  price: boolean;
  /** Where the phrase came from: "gsc", "autocomplete", "audit", "manual". */
  sources: string[];
  /** Search Console impressions and average position in the window; null when Google reported the phrase on no day of it. */
  impressions: number | null;
  position: number | null;
  /** The page mapped to it, with the two checks an assistant quotes from; null when no page answers it yet. */
  page: { path: string; answer: ReadinessCheck["state"] | null; faq: ReadinessCheck["state"] | null } | null;
  /** Already on the list of questions asked of the assistants. */
  tracked: boolean;
}

/* ---------- what moves the share ----------------------------------------------------- */

/** One thing that moves whether AI answers name Balkaris, with what the desk read about it. */
export interface AiLever {
  key: "indexed" | "listed" | "profile" | "german" | "prices" | "answers" | "bing" | "nap";
  title: string;
  /** How it moves AI answers, in one sentence: reasoning, never a figure of ours. */
  why: string;
  /** good: in place; warn: partly; bad: missing; unknown: could not be read. */
  state: "good" | "warn" | "bad" | "unknown";
  /** The measured figure as printed ("58 of 98 sitemap addresses"), or null when nothing could be read. */
  figure: string | null;
  /** What was read, from where and when, in a sentence or two. */
  detail: string;
  source: SourceId;
  asOf: string | null;
  step: AiLeverStep;
}

export interface AiLeverStep {
  /** Who moves it: the owner (a login, a decision), the lead in the owner's browser, a content or code change, or the desk itself. */
  who: "owner" | "lead-chrome" | "content" | "code" | "desk";
  /** The step in plain words. */
  text: string;
  /** The desk page where it is done or followed. */
  href: string | null;
  /** The owner task it waits on, with its done mark (always a person's). */
  ownerTask: { id: string; title: string; done: boolean; doneBy: string | null } | null;
  /** Open opportunities that carry this step, or null when none are counted for it. */
  opportunities: number | null;
  /** The Opportunities list that shows exactly those (`/seo/opportunities?type=…`), or null when none are counted. */
  opportunitiesHref: string | null;
}

/* ---------- where the answers look ---------------------------------------------------- */

export interface AiListings {
  /** Answers recorded, and how many of them cited any source. */
  answers: number;
  withSources: number;
  /** Directories, listings and platforms the answers cited, most cited first, with whether Balkaris is there. */
  directories: CitedListing[];
  /** Companies' own sites the answers cited (not directories), most cited first. */
  sites: { source: string; answers: number; engines: string[] }[];
  /** Answers that cited balkaris.ch itself. */
  own: { answers: number; engines: string[] };
  /** The companies the answers named, most named first (Balkaris left out): the first ten, or all of them, as `asked.named` and `asked.who` say. */
  named: { name: string; answers: number; engines: string[]; questions: number }[];
  /** Companies named in all, and companies' own sites cited in all, before the panel's search and its "first ten". */
  namedTotal: number;
  sitesTotal: number;
}

export interface CitedListing {
  /** As the answers showed it: a host ("example.ch") or the name on a source card. */
  source: string;
  answers: number;
  engines: string[];
  questions: string[];
  /** Balkaris's profile there, as the desk knows it, or null when no profile there is known. */
  profile: { key: string; name: string; state: "exists" | "not-found" | "unknown" | "not-checked"; url: string | null; why: string } | null;
  /** The owner task that creates or fixes it. */
  ownerTask: { id: string; title: string; done: boolean; doneBy: string | null } | null;
}

/* ---------- the imports' steps ---------------------------------------------------------- */

export interface ImportStep {
  kind: ManualImport["kind"];
  /** "Search Console: Generative AI". */
  title: string;
  /** Where the report is exported: the owner task's own step when there is one. */
  where: string;
  /** What has to exist before the report can be exported (Bing Webmaster set up), or null. */
  needs: string | null;
  /** The task in the owner's or the lead's list that does the export. */
  ownerTask: { id: string; title: string; done: boolean; doneBy: string | null } | null;
}

export type AiEngine = "google-ai-mode" | "google-ai-overview" | "chatgpt" | "perplexity" | "gemini" | "copilot" | "claude";

export interface AiChecks {
  /**
   * Per engine, over its newest answer to each question asked of it (so one
   * new answer replaces one old one and never shrinks the set): questions
   * asked, answers that named Balkaris; and the same for the questions that
   * do not name it ("unprompted"). `since` and `day` are the oldest and the
   * newest day among those answers.
   */
  tally: { engine: AiEngine; label: string; since: string; day: string; asked: number; mentioned: number; unprompted: { asked: number; mentioned: number } }[];
  /**
   * Each assistant's newest answer to each question, newest day first: the
   * answers every figure on the page counts. A later record of the same
   * question, assistant and day takes the earlier one's place.
   */
  rows: AiCheckRow[];
  /** Every recorded day, oldest first: the share over time. */
  rounds: AiRound[];
  /** Records kept in all, and how many of them a later record of the same question, assistant and day replaced (kept, not counted). */
  records: number;
  replaced: number;
}

/**
 * One day's recorded answers over every assistant. A round is a calendar day,
 * so rounds differ in size: compare them by share with the counts beside it,
 * never by count.
 */
export interface AiRound {
  day: string;
  asked: number;
  /** Answers that named Balkaris; answers that could not be read whole are in `unread`, never counted as "not named". */
  mentioned: number;
  unread: number;
  /** The same for questions that do not name Balkaris themselves. */
  unprompted: { asked: number; mentioned: number };
  engines: { engine: AiEngine; label: string; asked: number; mentioned: number }[];
}

export interface AiCheckRow {
  id: number;
  engine: AiEngine;
  engineLabel: string;
  question: string;
  lang: "de" | "en";
  day: string;
  /** brand: names Balkaris; domain: names balkaris.ch; category: a service and a place; price; advice: a how-to question. Brand and domain are "prompted". */
  kind: "brand" | "domain" | "category" | "price" | "advice";
  /** Null when the answer could not be read whole (it was withdrawn mid-way). */
  mentioned: boolean | null;
  /** Where Balkaris stood among the names the answer gave, 1-based; null when not named or not a list. */
  position: number | null;
  /** The companies the answer named, in its order. */
  competitors: string[];
  /** The sources it cited, as the answer showed them: a host ("example.ch") or the name on its source card. */
  sources: string[];
  /** A short note of what the answer said, in the recorder's words. */
  excerpt: string | null;
  /** audit | lead-chrome | api */
  by: string;
  note: string | null;
}

/** A check to record (owner only). */
export interface NewAiCheck {
  engine: AiEngine;
  question: string;
  lang: "de" | "en";
  day: string;
  kind: AiCheckRow["kind"];
  mentioned: boolean | null;
  position?: number | null;
  competitors?: string[];
  sources?: string[];
  excerpt?: string | null;
  by: "lead-chrome" | "api" | "audit";
  note?: string | null;
}

/** What a change on this page answers: one sentence for the person who pressed the button. */
export interface AiDone {
  ok: true;
  line: string;
}

/** POST /api/v1/seo/ai-search/round: what recording a round did, line by line. */
export interface RoundAnswer extends AiDone {
  results: { engine: AiEngine; question: string; result: "added" | "changed" | "unchanged" }[];
  added: number;
  changed: number;
  unchanged: number;
  /** Lines of a pasted round that could not be read, each with why. */
  skipped: string[];
}

/** POST /api/v1/seo/ai-search/page/check: the page as read just now, or as it stood when it could not be read. */
export interface PageCheckAnswer extends AiDone {
  /** False when the page did not answer 200: `page` is then its last good read, or null. */
  read: boolean;
  page: PageReadiness | null;
  checkedAt: string | null;
}

/** POST /api/v1/seo/ai-search/record: what recording one answer did. */
export interface RecordAnswer {
  ok: true;
  /** added: a new record; changed: your earlier record of this question, assistant and day now says this; unchanged: it already said exactly this. */
  result: "added" | "changed" | "unchanged";
  /** The record of the same question, assistant and day by another recorder that this one now takes the place of (kept, not counted), or null. */
  replaces: { by: string; id: number } | null;
  /** Whether this record is the one the page counts for that question, assistant and day (false when another recorder's later record still is). */
  counted: boolean;
}

export interface AiReferrals {
  start: string;
  end: string;
  sessions: number;
  users: number;
  /** Null when GA4 did not measure the window before whole. */
  previous: number | null;
  byAssistant: { source: string; label: string; sessions: number }[];
  byLanding: { path: string; sessions: number; sources: string[] }[];
  days: { date: string; sessions: number }[];
  /** The sources and medium counted as AI assistants, so the rule is visible. */
  rule: string;
}

export interface AiCrawlers {
  start: string;
  end: string;
  hits: number;
  /** Requests per named crawler ("GPTBot", "OAI-SearchBot", "ChatGPT-User" …), with its company and what it does. */
  byAgent: { agent: string; company: string; purpose: "training" | "search" | "user" | "search-engine" | "other"; hits: number }[];
  byPage: { path: string; hits: number; agents: string[] }[];
  days: { date: string; hits: number }[];
  /** Days the drain delivered on in the window: a day without is unknown, not zero. */
  deliveredDays: number;
}

export interface Readiness {
  checkedAt: string;
  /**
   * Site-wide checks, each with its state and the step that fixes it. The
   * Business Profile and the name/address/phone rows are read from the
   * desk's profile records when the page is drawn (as the levers are), the
   * others at the readiness run.
   */
  site: ReadinessCheck[];
  /**
   * The pages the table's filters let through, in its order: the first twelve
   * unless all are asked for. Each check's state only; what a check read
   * comes with the opened row (`opened`) or GET /page?path=.
   */
  pages: PageReadinessRow[];
  /** Pages read in all, pages the filters let through, and the kinds of page among those read. */
  list: { total: number; matching: number; kinds: { kind: string; count: number }[] };
  /** The page the address opens (`?page=`), with what each check read; null when none is opened. */
  opened: PageReadinessAnswer | null;
  /** Pages passing every check that applies to them, of the pages checked. */
  ready: number;
  of: number;
  /** Each page check over every page it applies to, in the checks' order. */
  byCheck: ReadinessTally[];
  /** What robots.txt says to each named AI and search crawler, as last read; null before the first site-wide check, or when robots.txt could not be read. */
  robots: { agent: string; family: string; allowed: boolean }[] | null;
  /** Why `robots` is null although the site-wide checks ran: how robots.txt answered. */
  robotsNote: string | null;
  /** What the last run could not read, said whole ("The run of 5 Oct 2026 read none of the 98 pages: the website answered 402 …"); null when it read every page. */
  unread: { at: string; line: string } | null;
  /** The daily job as it stands, so "Run the check" can say what is happening; null when the desk has no such job. */
  job: AiJob | null;
}

export interface ReadinessTally {
  key: string;
  label: string;
  /** Pages it applies to, and how they stand. */
  applies: number;
  pass: number;
  fail: number;
  unknown: number;
  /** The step that fixes a failing page, and who does it. */
  fix: string | null;
  who: ReadinessCheck["who"];
}

export interface ReadinessCheck {
  key: string;
  label: string;
  /** pass, fail, or unknown (could not be read); "n/a" when it does not apply to this page. */
  state: "pass" | "fail" | "unknown" | "n/a";
  /** What was read: "The first 100 words hold no sentence that answers the page's question". */
  detail: string;
  /** The step that fixes a fail. */
  fix: string | null;
  /** Who does the fix. */
  who: "content" | "code" | "owner" | null;
}

export interface PageReadiness {
  path: string;
  title: string | null;
  kind: string | null;
  lang: string | null;
  checks: ReadinessCheck[];
  pass: number;
  of: number;
  /** Set when the newest attempt to read the page failed: the checks are then its last good read's. */
  unread?: { why: string; at: string };
}

/** A page in the readiness table: each check's state by its key, without what it read. */
export interface PageReadinessRow {
  path: string;
  title: string | null;
  kind: string | null;
  lang: string | null;
  states: Record<string, ReadinessCheck["state"]>;
  pass: number;
  of: number;
  /** The newest attempt to read it failed; the marks are its last good read's. */
  unread?: boolean;
}

/** GET /api/v1/seo/ai-search/page?path=: one page's checks with what each read, or null when the readiness check has not read it. */
export interface PageReadinessAnswer {
  page: PageReadiness | null;
  checkedAt: string | null;
  /** Tasks for the operator made from what this page fails (a brief for its answer and questions). The workstation's own model writes them. */
  tasks?: { label: string; task: NewTask }[];
}

export interface ManualImport {
  kind: "gsc-generative-ai" | "bing-ai-performance";
  /** The month the export covers, "2026-10". */
  month: string;
  importedAt: string;
  importedBy: string;
  /** The CSV's own columns and rows, as exported. */
  columns: string[];
  rows: string[][];
  /** The export's row count when `rows` carries only its first rows (the page shows ten). */
  total?: number;
  /** Earlier imports, newest first. */
  earlier: { month: string; importedAt: string; rows: number }[];
}
