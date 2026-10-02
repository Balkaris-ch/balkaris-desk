/**
 * GET /api/v1/seo/ai-search?range=30d — AI search visibility: the owner's
 * "0% on that side", measured.
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
 * Changes:
 *   POST /api/v1/seo/ai-search/record        owner only  { check: NewAiCheck }         → RecordAnswer
 *   POST /api/v1/seo/ai-checks               owner only  { checks: NewAiCheck[] }      → { ok, added, rows }
 *   POST /api/v1/seo/imports/gsc-generative-ai   owner only  { month: "2026-10", csv }  → ImportAnswer
 *   POST /api/v1/seo/imports/bing-ai-performance owner only  { month, csv }            → ImportAnswer
 *
 * One page's readiness details, fetched when its row opens:
 *   GET /api/v1/seo/ai-search/page?path=/a-page   → PageReadinessAnswer
 *
 * Types only.
 */
import type { Reading, SourceId } from "../common";
import type { OperatorPanel, OpportunityRow, OpportunityType, OwnerTaskRow, SeoHead } from "./common";

export interface SeoAiSearchPayload {
  head: SeoHead;
  checks: Reading<AiChecks>;
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
  /** The companies the answers named, most named first (Balkaris left out). */
  named: { name: string; answers: number; engines: string[]; questions: number }[];
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
  /** Every page read, each check's state only; a page's details come with GET /page?path= when its row opens. */
  pages: PageReadinessRow[];
  /** Pages passing every check that applies to them, of the pages checked. */
  ready: number;
  of: number;
  /** Each page check over every page it applies to, in the checks' order. */
  byCheck: ReadinessTally[];
  /** What robots.txt says to each named AI and search crawler, as last read; null before the first site-wide check. */
  robots: { agent: string; family: string; allowed: boolean }[] | null;
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
}

/** GET /api/v1/seo/ai-search/page?path=: one page's checks with what each read, or null when the readiness check has not read it. */
export interface PageReadinessAnswer {
  page: PageReadiness | null;
  checkedAt: string | null;
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
