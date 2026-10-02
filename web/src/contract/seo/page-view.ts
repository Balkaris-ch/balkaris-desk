/**
 * GET /api/v1/seo/pages/view?path=/how-to-get-more-clients-for-my-law-firm&range=30d
 * — one page optimised: its search figures over time, its queries, what Google
 * and the crawl say about it, its AI readiness, its opportunities, what waits
 * for approval, and the operator's actions for it.
 *
 * `off` (from the crawl) when the desk knows no page at that address.
 *
 * Types only.
 */
import type { Reading, Stat } from "../common";
import type { ProposalRow } from "../operator";
import type { OperatorPanel, OpportunityRow, PageRef, Rate, RateStat, SeoHead } from "./common";
import type { Serp } from "./opportunities";
import type { ReadinessCheck } from "./ai-search";

export interface SeoPageViewPayload {
  head: SeoHead;
  page: Reading<PageSummary>;
  tiles: PageTiles;
  /** Clicks, impressions and position per day from the desk's Search Console history. */
  performance: Reading<{ days: { date: string; clicks: number; impressions: number; position: number | null }[] }>;
  /** The queries Google showed this page for in the window. */
  queries: Reading<{ rows: PageQuery[]; withheld: string }>;
  /** Google's stored state of the address (URL Inspection), the newest first, one row per day the state changed. */
  index: Reading<IndexHistory>;
  crawl: Reading<PageCrawl>;
  readiness: Reading<{ checkedAt: string; checks: ReadinessCheck[] }>;
  opportunities: OpportunityRow[];
  /** Title, description and redirect proposals for this address, waiting or decided. */
  proposals: ProposalRow[];
  serp: Serp | null;
  /** The clusters this page answers (by the audit's mapping or the desk's rule). */
  clusters: { key: string; name: string; lang: string; mappedBy: "audit" | "rule" | "person" }[];
  /** Competitor pages captured for those clusters. No invented metrics: what the page says, as fetched. */
  competitors: { domain: string; url: string; title: string | null; h1: string | null; words: number | null; lang: string | null; schemaTypes: string[]; priceStated: boolean | null; fetchedAt: string | null }[];
  /** The operator's actions for this page, as tasks a button posts to POST /api/v1/operator/tasks. */
  operator: OperatorPanel;
}

export interface PageSummary extends PageRef {
  url: string;
  status: number;
  inSitemap: boolean;
  indexable: boolean;
  /** When the desk last saw it change, or the sitemap's date. */
  updated: string | null;
  /** Visitors who began a session here from Google, GA4 (consenting visitors only); null when GA4 is not readable. */
  organicSessions: number | null;
}

export interface PageTiles {
  position: Reading<Stat>;
  impressions: Reading<Stat>;
  clicks: Reading<Stat>;
  ctr: Reading<RateStat>;
  /** The crawl's score out of 100 for this page. */
  score: Reading<Stat>;
}

export interface PageQuery {
  query: string;
  clicks: number;
  impressions: number;
  ctr: Rate;
  position: number;
  /** The cluster the keyword table puts it in, when it knows it. */
  cluster: { key: string; name: string } | null;
}

export interface IndexHistory {
  /** The newest inspection. */
  now: { day: string; indexed: boolean; coverage: string | null; lastCrawl: string | null; googleCanonical: string | null; userCanonical: string | null; robots: string | null; indexing: string | null; link: string | null };
  /** Google's meaning of that state and the fix, in plain words (src/cc/seo/indexation.ts). */
  meaning: string;
  fix: string;
  /** Each day the state changed, newest first. */
  changes: { day: string; coverage: string | null; indexed: boolean }[];
  /** In the "Request indexing" queue, and whether someone marked it submitted. */
  request: { queued: boolean; submittedBy: string | null; submittedAt: string | null } | null;
}

export interface PageCrawl {
  at: string;
  title: string | null;
  titleLength: number;
  description: string | null;
  descriptionLength: number;
  h1: string | null;
  words: number | null;
  canonical: string | null;
  robots: string | null;
  schemaTypes: string[];
  linksIn: number;
  linksInFromContent: number;
  linksOut: number | null;
  /** The crawl's findings for the page, worst first. */
  findings: { rule: string; title: string; severity: "critical" | "warning" | "opportunity"; text: string }[];
}
