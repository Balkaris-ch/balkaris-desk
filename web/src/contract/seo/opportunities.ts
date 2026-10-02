/**
 * GET /api/v1/seo/opportunities — the one table of opportunities, its
 * filters, and one opportunity in detail.
 *
 *   ?range=30d          the window its figures are read over
 *   ?type=low-ctr       one OpportunityType, or a comma list
 *   ?priority=high      high | medium | low
 *   ?state=open         open | queued | in-progress | done | dismissed; default: open,queued,in-progress
 *   ?active=1           1 (the rules still find it, default) | 0 (cleared) | all
 *   ?action=brief       one ActionKind
 *   ?page=/seo          one page's opportunities
 *   ?q=law              words in the title, the page or the keyword
 *   ?sort=priority      priority (default) | potential | newest | page
 *   ?offset=0&limit=50  paging, limit at most 200
 *   ?open=<id>          one opportunity in detail (`selected`)
 *
 * Changes (a signed-in person; the desk's own pages only):
 *   POST /api/v1/seo/opportunities/:id/state   { state, note? }        → OpportunityAnswer
 *   POST /api/v1/seo/opportunities/:id/act     {}                      → OpportunityAnswer
 *        queues its operator task (proposal, brief) or marks a person's task queued
 *   POST /api/v1/seo/opportunities/act         { ids: string[] }       → OpportunitiesActed
 *        "Apply all selected": the same, for up to 10; proposals still wait for approval
 *
 * Types only.
 */
import type { Reading, Stat } from "../common";
import type { ActionKind, CtrCurve, OpportunityRow, OpportunityState, OpportunityType, PageRef, Priority, SeoHead } from "./common";

export interface SeoOpportunitiesPayload {
  head: SeoHead;
  tiles: OpportunityTiles;
  /** Every filter with its real count over the active opportunities. */
  facets: OpportunityFacets;
  /** The filters as the server applied them. */
  asked: OpportunityQuery;
  list: Reading<{ total: number; offset: number; limit: number; rows: OpportunityRow[] }>;
  /** ?open=<id>: one opportunity in detail, or null. */
  selected: Reading<OpportunityDetail> | null;
  /** The board's lower panels: the low-CTR rows and the new-keyword (gap) rows, each its own short list. */
  ctr: Reading<OpportunityRow[]>;
  newKeywords: Reading<OpportunityRow[]>;
  curve: CtrCurve;
}

export interface OpportunityTiles {
  /** Queries at average position 4 to 20 the rules list ("near page one"). */
  nearPageOne: Reading<Stat>;
  /** Distinct pages with at least one open opportunity. */
  pagesToOptimize: Reading<Stat>;
  /** Low-CTR opportunities. */
  ctr: Reading<Stat>;
  /** Technical opportunities (crawl findings and site checks). */
  technical: Reading<Stat>;
  /**
   * "Estimated traffic gain": OUR ESTIMATE, the sum of every open
   * opportunity's `potential`, in clicks a month. Off when no opportunity has
   * impressions to estimate from: then there is nothing honest to add up.
   */
  estimatedGain: Reading<{ clicksPerMonth: number; from: number; line: string }>;
}

export interface OpportunityFacets {
  types: { type: OpportunityType; label: string; count: number }[];
  priorities: { priority: Priority; count: number }[];
  states: { state: OpportunityState; count: number }[];
  actions: { kind: ActionKind; label: string; count: number }[];
  /** Opportunities the rules no longer find, kept with their decisions. */
  cleared: number;
}

export interface OpportunityQuery {
  range: string;
  types: OpportunityType[];
  priority: Priority | null;
  states: OpportunityState[];
  active: "1" | "0" | "all";
  action: ActionKind | null;
  page: string | null;
  q: string;
  sort: "priority" | "potential" | "newest" | "page";
  offset: number;
  limit: number;
}

/** One opportunity with everything known about its subject. */
export interface OpportunityDetail {
  opportunity: OpportunityRow;
  /**
   * The keyword's (or the page's) Google position per day, from the desk's
   * own Search Console history; null for a day Google did not show it.
   */
  history: { date: string; position: number | null; impressions: number; clicks: number }[];
  /** Other pages of the site Google showed for the same query in the window: real cannibalisation, from the history. */
  competing: { page: PageRef; impressions: number; position: number | null }[];
  /** Opportunities of the same cluster or page. */
  similar: OpportunityRow[];
  /** The page as a result shows it today, from the crawl: title and description with their lengths and the desk's limits. */
  serp: Serp | null;
  /** The competitor pages captured for the opportunity's cluster or query (src/cc/seo/competitors.ts); no invented metrics. */
  competitors: { domain: string; url: string; title: string | null; words: number | null; lang: string | null; priceStated: boolean | null; seen: string }[];
}

export interface Serp {
  url: string;
  title: string | null;
  titleLength: number;
  titleLimit: number;
  description: string | null;
  descriptionLength: number;
  descriptionLimit: number;
  /** Structured-data types on the page (what makes it eligible for rich results; Google's Rich Results Test is the last word). */
  schemaTypes: string[];
}
