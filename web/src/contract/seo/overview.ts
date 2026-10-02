/**
 * GET /api/v1/seo/overview?range=30d — the SEO section's Overview: every
 * feature of the SEO engine at a glance, what is running, and what it did.
 *
 * Types only. Each panel is its own `Reading`, so one source that fails costs
 * one panel.
 */
import type { ActivityItem, Reading, SourceId, Stat } from "../common";
import type { CtrCurve, OperatorPanel, OpportunityRow, OwnerTaskRow, PageRef, Priority, RateStat, SeoHead, SeoJob } from "./common";

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
}

export interface PriorityPanel {
  /** Open, active opportunities in all. */
  total: number;
  /** The board's filter chips, with real counts. */
  filters: { key: string; label: string; count: number }[];
  rows: OpportunityRow[];
}

export interface KeywordPanel {
  rows: KeywordOpportunity[];
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
  priority: Priority;
  /** The opportunity behind the row, and its action's words. */
  opportunityId: string;
  actionLabel: string;
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
  }[];
}

export interface TechnicalPanel {
  rows: { key: string; label: string; count: number; tone: "good" | "warn" | "bad"; href: string }[];
}

export interface PresencePanel {
  /** Inbound links in Bing's index: off until Bing Webmaster is connected (Google gives no backlink API). */
  bing: Reading<{ total: number }>;
  /** Sites that sent visitors (GA4 referrals) in the window, top five. */
  referrers: Reading<{ total: number; rows: { host: string; sessions: number }[] }>;
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
  crawlers: Reading<{ hits: number }>;
}

export interface RunningPanel {
  jobs: SeoJob[];
  /** Operator tasks queued from opportunities, still queued or running. */
  tasks: { id: number; title: string; state: "queued" | "running"; opportunityId: string | null; href: string }[];
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
