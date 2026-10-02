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
 *   POST /api/v1/seo/ai-checks               owner only  { checks: NewAiCheck[] }      → { ok, added, rows }
 *   POST /api/v1/seo/imports/gsc-generative-ai   owner only  { month: "2026-10", csv }  → ImportAnswer
 *   POST /api/v1/seo/imports/bing-ai-performance owner only  { month, csv }            → ImportAnswer
 *
 * Types only.
 */
import type { Reading } from "../common";
import type { OpportunityRow, OwnerTaskRow, SeoHead } from "./common";

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
}

export type AiEngine = "google-ai-mode" | "google-ai-overview" | "chatgpt" | "perplexity" | "gemini" | "copilot" | "claude";

export interface AiChecks {
  /** Per engine, over its newest round: questions asked, answers that named Balkaris; and the same for questions that did not name it ("unprompted"). */
  tally: { engine: AiEngine; label: string; day: string; asked: number; mentioned: number; unprompted: { asked: number; mentioned: number } }[];
  rows: AiCheckRow[];
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
  /** The sources it cited, as the answer showed them: a host ("beyondweb.ch") or the name on its source card. */
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
  /** Site-wide checks, each with its state and the step that fixes it. */
  site: ReadinessCheck[];
  pages: PageReadiness[];
  /** Pages passing every check that applies to them, of the pages checked. */
  ready: number;
  of: number;
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

export interface ManualImport {
  kind: "gsc-generative-ai" | "bing-ai-performance";
  /** The month the export covers, "2026-10". */
  month: string;
  importedAt: string;
  importedBy: string;
  /** The CSV's own columns and rows, as exported. */
  columns: string[];
  rows: string[][];
  /** Earlier imports, newest first. */
  earlier: { month: string; importedAt: string; rows: number }[];
}
