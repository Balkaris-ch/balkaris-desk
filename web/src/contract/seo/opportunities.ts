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
 *   ?q=words            words in the title, the page or the keyword
 *   ?cluster=<key>      one keyword cluster's opportunities
 *   ?sort=priority      priority (default) | potential | newest | page
 *   ?offset=0&limit=50  paging, limit at most 200
 *   ?open=<id>          one opportunity in detail (`selected`); without it, the
 *                       first row of the list is the one in detail
 *
 * Changes (a signed-in person; the desk's own pages only):
 *   POST /api/v1/seo/opportunities/:id/state   { state, note? }        → OpportunityAnswer
 *   POST /api/v1/seo/opportunities/:id/act     { as? }                 → OpportunityAnswer
 *        queues its operator task (proposal, brief); a change to the website's
 *        code goes on the to-do list in AI Operator; "Request indexing" is
 *        marked as done by the person who pressed it in Search Console. A step
 *        from the audit is refused here: it is marked with /owner-task.
 *        `as: "metadata" | "brief"` queues one of its `alternatives` instead
 *   POST /api/v1/seo/opportunities/act         { ids: string[] }       → OpportunitiesActed
 *        "Queue operator tasks": the operator's own (proposals and briefs), for
 *        up to 10; proposals still wait for approval; any other row answers
 *        ok: false with the step a person takes on its own row
 *   POST /api/v1/seo/opportunities/act         { id, as? }             → OpportunityAnswer
 *   POST /api/v1/seo/opportunities/state       { ids: string[], state, note? } → OpportunitiesActed
 *        the same as /:id/state for up to 50 at once (the list's bulk "Dismiss", "Mark done")
 *   POST /api/v1/seo/opportunities/owner-task  { task }                → OwnerStepAnswer
 *        "I have done it": a step from the audit (OpportunityAction.ownerTaskId)
 *        marked done, and the opportunities waiting on it marked done with it.
 *        The owner's own steps (action kind "owner"): the owner only (403).
 *   An id carries ":" and often "/": the body forms need no escaping; the
 *   /:id/ forms take it encoded with encodeURIComponent.
 *
 * Types only.
 */
import type { Reading, Stat } from "../common";
import type { ProposalRow } from "../operator";
import type { ActionKind, CtrCurve, OperatorPanel, OpportunityRow, OpportunityState, OpportunityType, OwnerTaskAnswer, PageRef, Priority, Rate, SeoHead } from "./common";
import type { KeywordStatus } from "./keywords";

export interface SeoOpportunitiesPayload {
  head: SeoHead;
  tiles: OpportunityTiles;
  /** Every filter with its real count over the active opportunities. */
  facets: OpportunityFacets;
  /** The filters as the server applied them. */
  asked: OpportunityQuery;
  list: Reading<{ total: number; offset: number; limit: number; rows: OpportunityLine[] }>;
  /** ?open=<id>, or the list's first row: one opportunity in detail; null when the list is empty. */
  selected: Reading<OpportunityDetail> | null;
  curve: CtrCurve;
  /**
   * The window of whole Search Console days the list's "Current" column and
   * the detail's figures are read over (the head's range, ending on the
   * history's last day), or why there is none.
   */
  rank: Reading<{ start: string; end: string; days: number; compared: boolean }>;
  /** Every type's rule in one sentence (src/cc/seo/rules.ts), for the (i) beside the list. */
  rules: { type: OpportunityType; label: string; rule: string }[];
  /** The operator that answers the AI suggestions: where it runs, said truthfully, and whether it is on. */
  operator: OperatorPanel;
  /** Who is looking: "I have done it" on the owner's own steps is shown to the owner only. */
  viewer: { owner: boolean };
}

/** POST …/owner-task: the step marked done, and the opportunities that waited on it, now done. */
export interface OwnerStepAnswer extends OwnerTaskAnswer {
  opportunities: OpportunityRow[];
}

/** A row of the list: the opportunity with its subject's Search Console figures over the head's range. */
export interface OpportunityLine extends OpportunityRow {
  /**
   * The query's or the page's figures over `rank`'s window. Null when the
   * opportunity has no single query or page to measure (a cluster, a
   * site-wide finding) or the desk has no Search Console history (`rank`
   * says why). Zero impressions and a null position: Google did not show it.
   */
  now: SubjectNow | null;
}

export interface SubjectNow {
  of: "query" | "page";
  /** Google's average position over the window; null when it was not shown. */
  position: number | null;
  impressions: number;
  clicks: number;
}

export interface OpportunityTiles {
  /** Queries at average position 4 to 20 the rules list ("near page one"). */
  nearPageOne: Reading<Stat>;
  /** Low-CTR opportunities. */
  ctr: Reading<Stat>;
  /** Technical opportunities (crawl findings and site checks). */
  technical: Reading<Stat>;
  /**
   * "Estimated traffic gain": OUR ESTIMATE, in clicks a month, the open
   * opportunities' `potential` added with each search counted once: a
   * search's own estimate first, then a page's or a topic's only when none of
   * the searches it draws on is counted yet. `from` is how many were added,
   * `left` how many more have an estimate but overlap. Off when no
   * opportunity has impressions to estimate from: then there is nothing
   * honest to add up.
   */
  estimatedGain: Reading<{ clicksPerMonth: number; from: number; left: number; line: string }>;
  /** Every open opportunity (open, queued, in progress) the rules still find. */
  total: Reading<Stat>;
  /** Content gaps: keyword-gap and German-page-missing opportunities together. */
  gaps: Reading<Stat>;
}

export interface OpportunityFacets {
  /**
   * Counted over the opportunities the state and active filters show (open,
   * queued and in progress by default), whatever type, priority, page or
   * cluster is chosen: the chips' numbers.
   */
  types: { type: OpportunityType; label: string; count: number }[];
  priorities: { priority: Priority; count: number }[];
  /** Counted over every opportunity the active filter shows, whatever its state. */
  states: { state: OpportunityState; count: number }[];
  actions: { kind: ActionKind; label: string; count: number }[];
  /** The pages the shown opportunities are about, most opportunities first. */
  pages: { path: string; count: number }[];
  /** The keyword clusters the shown opportunities belong to. */
  clusters: { key: string; name: string; count: number }[];
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
  cluster: string | null;
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
  /** The subject's figures over `rank`'s window, and the window before when the history covers it whole. */
  figures: Reading<SubjectFigures>;
  /** The position the chart's target line marks: the estimate's target, else 3; null when nothing is ranked. */
  target: number | null;
  /** The keyword cluster with each phrase's Search Console figures, or the queries Google showed the page for. */
  cluster: Reading<ClusterPanel>;
  /** Title and description proposals for the subject's page, from any task, newest first (at most six), each with its state in the approval queue. */
  proposals: ProposalRow[];
  /** The operator tasks the opportunity can queue besides its own action (POST …/act with `as`). */
  alternatives: OpportunityAlternative[];
}

export interface SubjectFigures {
  of: "query" | "page" | "cluster";
  /** What was measured, as printed: the query in quotes, the page's address, or "8 phrases of the cluster". */
  label: string;
  /** Google's average position; null when it was not shown (and for a cluster, which has no one position). */
  position: number | null;
  previousPosition: number | null;
  impressions: Stat;
  clicks: Stat;
  ctr: Rate;
  previousCtr: Rate | null;
}

export interface ClusterPanel {
  kind: "cluster" | "page";
  /** The cluster's name and language, or the page's address. */
  title: string;
  cluster: { key: string; name: string; lang: string; intent: string | null; priority: Priority; page: string | null } | null;
  /**
   * Most impressions first; phrases Google did not show the site for follow,
   * relevant first. At most six (`href` has them all). The figures are null (unknown, not zero)
   * while the desk keeps no Search Console history.
   */
  rows: { phrase: string; status: KeywordStatus | null; impressions: number | null; clicks: number | null; position: number | null }[];
  /** Phrases in the cluster, or queries the page was shown for, in all. */
  total: number;
  /** Where the whole list is: the Keywords page filtered to the cluster or the page. */
  href: string;
}

export interface OpportunityAlternative {
  as: "metadata" | "brief";
  /** The button's words. */
  label: string;
  /** What happens, in plain words. */
  step: string;
  available: boolean;
  why: string | null;
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
