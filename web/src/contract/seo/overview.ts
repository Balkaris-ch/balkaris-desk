/**
 * GET /api/v1/seo/overview?range=30d — the SEO section's Overview: every
 * feature of the SEO engine at a glance, what is running, and what it did.
 *
 * Types only. Each panel is its own `Reading`, so one source that fails costs
 * one panel.
 *
 *   GET  /api/v1/seo/overview/running             RunningPanel alone, for the panel that keeps itself current
 *   POST /api/v1/seo/overview/act    { ids }      OpportunitiesActed: each opportunity's action taken (an
 *                                                 operator task queued; a proposal then waits for approval)
 *   POST /api/v1/seo/overview/owner  { id, done, note? }   OwnerTaskAnswer: a person marks an owner task
 *   POST /api/v1/seo/overview/task   NewTask      TaskAnswer: an operator task queued from this page (the AI
 *                                                 SEO Operator's box and suggestions, a Technical fix), written
 *                                                 to the SEO log so Running now and Recent SEO actions show it
 *
 * A refused /act answers 409 with `error`, the first refusal's sentence, beside the per-row `results`.
 */
import type { ActivityItem, Reading, SourceId, Stat } from "../common";
import type { NewTask, RunnerState } from "../operator";
import type { CtrCurve, OperatorPanel, OpportunityAction, OpportunityRow, OpportunityState, OwnerTaskRow, PageRef, Priority, RateStat, SeoHead, SeoJob } from "./common";

export interface SeoOverviewPayload {
  head: SeoHead;
  tiles: OverviewTiles;
  /** The opportunities to do first: the highest priority, open, the rules still find them. */
  priority: Reading<PriorityPanel>;
  /** Queries close to page one and searches no page answers, with what to do. */
  keywords: Reading<KeywordPanel>;
  /** The pages Google shows most, from the desk's own Search Console history. */
  topPages: Reading<TopPagesPanel>;
  /** The topic clusters, how much of each a page of the right language answers. */
  contentGaps: Reading<GapsPanel>;
  technical: Reading<TechnicalPanel>;
  /** Links and presence: Bing's links (off until connected), the sites that send visitors, the profiles and listings. */
  presence: Reading<PresencePanel>;
  searchConsole: Reading<ConsolePanel>;
  /** AI search: what the assistants said when asked, AI assistant visits, AI crawler visits. */
  aiSearch: Reading<AiPanel>;
  /** "Needs you": the owner tasks, open first. */
  needsYou: Reading<{ open: number; done: number; rows: OwnerTaskRow[] }>;
  /** Running and queued work: the SEO jobs and the operator tasks opportunities queued. */
  running: RunningPanel;
  /** Every job the SEO section runs on (the engine's own, then the desk's it reads), for the Automations strip. */
  automations: SeoJob[];
  /** "Recent SEO actions": the engine's own log and people's decisions, newest first. */
  recent: ActivityItem[];
  /** What the SEO engine is built of, each part with its real state in one line. */
  engine: EnginePart[];
  operator: OperatorPanel;
  curve: CtrCurve;
}

export interface OverviewTiles {
  /** The desk crawl's site score out of 100 (`of` is 100), with its daily history. The desk's own rules, not Google's. */
  health: Reading<Stat>;
  /** Sitemap addresses Google's URL Inspection reports as indexed at the last daily check; `of` is the sitemap's count. */
  indexed: Reading<Stat>;
  /** From the desk's own Search Console history (all countries, web search). */
  clicks: Reading<Stat>;
  impressions: Reading<Stat>;
  /** Average position weighted by impressions. Lower is better. */
  position: Reading<Stat>;
  ctr: Reading<RateStat>;
  /**
   * The AI-search baseline: of the questions recorded as asked of AI
   * assistants (each engine's newest round), how many answers named Balkaris.
   * Raw counts: a share of a few dozen answers is printed "0 of 24".
   */
  ai: Reading<AiTile>;
}

/** The AI tile: the recorded checks, never an estimate. */
export interface AiTile {
  asked: number;
  mentioned: number;
  /** The same for the questions that do not name Balkaris themselves (no brand, no domain). */
  unprompted: { asked: number; mentioned: number };
  /** How many assistants the newest rounds cover, and their names. */
  engines: string[];
  /** The newest round's day, YYYY-MM-DD. */
  lastDay: string;
  /**
   * One share per recorded day (percent), oldest first, of the questions that
   * do not name Balkaris: the trend once there is more than one. Null on a
   * day with fewer than 30 such answers, whose share is noise.
   */
  series: (number | null)[];
}

export interface PriorityPanel {
  /** Open, active opportunities in all. */
  total: number;
  /** The board's filter chips, with real counts. */
  filters: PriorityFilter[];
  /** The rows of every filter's `ids` together, ranked; the panel picks a filter's rows in the browser. */
  rows: OpportunityRow[];
  perFilter: number;
  /** How often the opportunity engine's job wakes, in seconds; null when it is not registered on this desk. */
  every: number | null;
}

/** One filter chip: which rows it keeps. A row matches when its type is listed (or no types are) and its priority is the one named (or none is). */
export interface PriorityFilter {
  key: string;
  label: string;
  count: number;
  types: OpportunityRow["type"][] | null;
  priority: Priority | null;
  /**
   * The rows to show for it, best first: the engine's ranking, and where the
   * filter mixes types, each priority tier taken one type at a time so the
   * kinds of work stand side by side. Ids of `PriorityPanel.rows`.
   */
  ids: string[];
}

export interface KeywordPanel {
  rows: KeywordOpportunity[];
  /** The window the figures cover: the opportunity rules' own (the last 28 days the history holds). */
  window: { start: string; end: string; days: number } | null;
}

/** One line of "Top keyword opportunities". */
export interface KeywordOpportunity {
  /** The query (near page one) or the cluster's name (a gap). */
  phrase: string;
  lang: string | null;
  kind: "near-page-one" | "gap";
  /** Search Console impressions in the window: the nearest true thing to "search volume", which has no free source. Null for a gap with none. */
  impressions: number | null;
  /** Google's average position now; null for a gap. */
  position: number | null;
  /** The position "our estimate" aims at. */
  targetPosition: number | null;
  /** The page Google shows for it, or the page that answers the cluster; null for a gap. */
  page: string | null;
  /** For a gap: the cluster's relevant phrases (the board's "potential keywords", counted, not estimated). Null for a query. */
  phrases: number | null;
  priority: Priority;
  /** The opportunity behind the row, and its action's words. */
  opportunityId: string;
  actionLabel: string;
  /** The opportunity's action as Priority Opportunities draws it: its kind, its exact step, whether it can be taken now and why not. */
  actionKind: OpportunityAction["kind"];
  step: string;
  available: boolean;
  why: string | null;
  /** The opportunity's state: a queued or in-progress row shows that instead of its button. */
  state: OpportunityState;
  stateNote: string | null;
}

export interface TopPagesPanel {
  rows: {
    page: PageRef;
    clicks: number;
    impressions: number;
    ctr: { value: number | null; num: number; den: number; small: boolean };
    position: number | null;
    /** Impressions per day over the window, oldest first: the trend line. */
    trend: number[];
  }[];
}

export interface GapsPanel {
  /** Clusters in all, and how many have no page (gaps) and how many of those are German. */
  clusters: number;
  gaps: number;
  germanGaps: number;
  rows: {
    key: string;
    name: string;
    lang: string;
    priority: Priority;
    /** Share of the cluster's relevant phrases that map to a page of the right language. */
    coverage: { mapped: number; of: number };
    page: string | null;
    /** The open gap opportunity for the cluster whose brief can be asked for now, or null. */
    opportunityId: string | null;
  }[];
}

export interface TechnicalPanel {
  rows: TechnicalRow[];
  /** When the crawl that counted them finished. */
  crawledAt: string | null;
}

export interface TechnicalRow {
  key: string;
  label: string;
  count: number;
  tone: "good" | "warn" | "bad";
  href: string;
  /** What the count is out of, when it is a part ("of 4 tested"), and where the figure comes from. */
  of: number | null;
  source: SourceId;
  /** What the rule counts, in one sentence, for the row's (i). */
  rule: string;
  /**
   * The operator task that fixes it, when one exists: titles and descriptions
   * (metadata) or redirects. What it writes waits for a person's approval in
   * AI Operator › Approvals; nothing on the live site changes before that.
   */
  fix: { kind: "metadata" | "redirect"; label: string; task: NewTask } | null;
}

export interface PresencePanel {
  /** Inbound links in Bing's index: off until Bing Webmaster is connected (Google gives no backlink API). */
  bing: Reading<{ total: number }>;
  /** Sites that sent visitors (GA4 referrals) in the window, top five. */
  referrers: Reading<{ start: string; end: string; total: number; rows: { host: string; sessions: number }[] }>;
  /** The profiles and listings the desk knows of: how many exist, how many were not found. */
  profiles: { exist: number; missing: number; unknown: number; of: number };
}

export interface ConsolePanel {
  clicks: Stat;
  impressions: Stat;
  /** Null without impressions. */
  position: Stat | null;
  days: { date: string; clicks: number; impressions: number }[];
  /** Search Console's own performance report for the property, or null. */
  href: string | null;
}

export interface AiPanel {
  /** The recorded AI checks, newest round per engine: how often Balkaris was named, in raw counts. */
  checks: { asked: number; mentioned: number; unprompted: { asked: number; mentioned: number }; lastDay: string | null };
  /** Sessions GA4 attributes to AI assistants in the window. */
  referrals: Reading<{ sessions: number }>;
  /** Requests from named AI crawlers in the window, from Vercel's request records. */
  crawlers: Reading<{ hits: number; days: number }>;
  /** The window the visits cover (GA4 and the drain count whole days to yesterday). */
  window: { start: string; end: string };
}

export interface RunningPanel {
  /** The SEO section's jobs that are running now, with their progress. */
  jobs: SeoJob[];
  /**
   * Operator tasks still queued or running that are search work: the SEO kinds
   * (metadata, redirects, briefs, opportunities, audits), the ones an
   * opportunity queued (`opportunityId`), and any task, a question included,
   * queued from this page (POST /task). Questions asked on the AI Operator's
   * own page are not listed.
   */
  tasks: { id: number; title: string; kindLabel: string; state: "queued" | "running"; opportunityId: string | null; href: string; ahead: number | null }[];
  /** Steps of the full audit asked for and not started yet: the scheduler runs one job at a time. */
  queued: { job: string; title: string }[];
  /**
   * Steps of the full audit asked for before the desk last restarted and not
   * started since: the scheduler keeps its queue in memory, so they will not
   * run as part of the audit. `at` is the job's next scheduled run, if any.
   */
  lost: { job: string; title: string; at: string | null }[];
  /** When the desk server last started, ISO: what `lost` is measured against. */
  bootedAt: string;
  /** The next scheduled runs of the SEO section's jobs, soonest first (at most four). */
  next: { name: string; title: string; at: string }[];
  /** The workstation that answers operator tasks, as the desk can tell. */
  runner: RunnerState;
  /** ISO time this was read. */
  at: string;
}

export interface EnginePart {
  key: "rank-history" | "keywords" | "opportunities" | "indexation" | "ai-search" | "competitors" | "presence" | "owner-tasks";
  title: string;
  /** One line of real counts: "Search Console history from 15 Jul 2026, 80 days, 412 rows". */
  line: string;
  state: "ok" | "waiting" | "off";
  source: SourceId;
  href: string;
}
