/**
 * GET /api/v1/seo/keywords — the keyword table: every phrase the desk knows
 * (from Search Console, Google Autocomplete research, the audit and people),
 * with its cluster, intent, the page it maps to and what Google shows.
 *
 *   ?range=30d
 *   ?view=clusters       keywords (default) | clusters: the topic clusters instead of the phrases
 *   ?lang=de             de | en | all
 *   ?cluster=<key>       one cluster, or "none"
 *   ?intent=commercial   commercial | transactional | informational | local | navigational | all
 *   ?source=gsc          gsc | autocomplete | audit | manual | all
 *   ?status=relevant     relevant | weak | irrelevant | unjudged | all (default: relevant, weak, unjudged)
 *   ?band=4-10           Google's average position in the window: 1-3 | 4-10 | 11-20 | 21-50 | 51+ | none (not shown) | all
 *   ?shown=1             1: only phrases Google showed the site for in the window
 *   ?target=1            1: only the phrases a person marked as a target
 *   ?flag=price          price | question | local: phrases that ask a price, ask a question, or name a place
 *   ?page=/seo           mapped to this page, or "none" for unmapped
 *   ?q=specimen          words in the phrase (in the clusters view: in the cluster's name or phrases)
 *   ?sort=impressions    impressions (default) | position | clicks | ctr | change | phrase | first-seen | cluster
 *   ?dir=desc
 *   ?corder=rank         the clusters view's order: rank (the audit's order of attack) | impressions | relevant | opportunities
 *   ?offset=0&limit=25   at most 500 (the clusters view pages the same way)
 *
 *   GET /api/v1/seo/keywords/export.csv   the list as filtered, every matching row (?id=… repeated: only those)
 *
 * Changes (a signed-in person; nothing here changes the website):
 *   POST /api/v1/seo/keywords                  { phrase, lang?, cluster?, target? } → KeywordChanged   source "manual"
 *   POST /api/v1/seo/keywords/:id/status       { status }                         → KeywordChanged
 *   POST /api/v1/seo/keywords/:id/page         { path | null }                    → KeywordChanged   a person's mapping; null: no page answers it
 *   POST /api/v1/seo/keywords/:id/target       { target: boolean }                → KeywordChanged
 *   POST /api/v1/seo/keywords/:id/brief        {}                                 → BriefQueued      an operator brief for the phrase
 *   POST /api/v1/seo/keywords/bulk             { ids, op: target | untarget | relevant | weak | irrelevant } → KeywordsActed
 *   POST /api/v1/seo/keywords/clusters/:key/brief  {}                             → BriefQueued      an operator brief for the cluster
 *   (A cluster is mapped to a page by the engine's own POST /api/v1/seo/clusters/:key/page.)
 *
 * NO SEARCH VOLUME. No free source gives it (Google Ads Keyword Planner ranges
 * may be added by hand later). The column is Search Console's impressions for
 * the site, named as such. No difficulty either: nothing free measures it.
 *
 * Types only.
 */
import type { Reading, Stat } from "../common";
import type { Priority, Rate, SeoHead } from "./common";

export type KeywordSource = "gsc" | "autocomplete" | "audit" | "manual";
export type KeywordStatus = "relevant" | "weak" | "irrelevant" | "unjudged";
export type Intent = "commercial" | "transactional" | "informational" | "local" | "navigational";

/** The two ways the page lists: the phrases, or the topic clusters they belong to. */
export type KeywordsView = "keywords" | "clusters";
/** Google's average position in the window, in bands; "none": Google did not show the site for it. */
export type PositionBand = "1-3" | "4-10" | "11-20" | "21-50" | "51+" | "none";
export type KeywordsSort = "impressions" | "position" | "clicks" | "ctr" | "change" | "phrase" | "first-seen" | "cluster";
/** What a phrase's words say about it (src/cc/seo/words.ts, flagsOf). */
export type KeywordFlag = "price" | "question" | "local";

export interface SeoKeywordsPayload {
  head: SeoHead;
  tiles: KeywordTiles;
  facets: KeywordFacets;
  list: Reading<{ total: number; offset: number; limit: number; rows: KeywordRow[] }>;
  /** The weekly Google Autocomplete research and its request budget. */
  research: ResearchState;
  /** What the server understood of the address, defaults filled in. */
  asked: KeywordsQuery;
  /** The window the search figures cover, or why there are none (Search Console not connected, no snapshot yet). */
  search: Reading<KeywordWindow>;
  /** The clusters, only in the clusters view (null in the keywords view): `total` matching, `rows` this page of them. */
  clusters: Reading<KeywordClusterList> | null;
  /** How many topic clusters the store holds, whatever is filtered. */
  clusterTotal: number;
  /** Every topic cluster, in the audit's order: what a tracked phrase may be filed under. */
  topics: { key: string; name: string; lang: string }[];
  /** The phrases marked as targets, with their figures: the panel under the list. */
  targets: Reading<KeywordRow[]>;
  /** The pages a phrase or a cluster can be mapped to: what the crawl reads (status 200). */
  sitePages: Reading<SitePageOption[]>;
  /** Where the phrases come from, counted over the whole table. */
  sources: { key: KeywordSource; label: string; count: number; line: string }[];
}

export interface KeywordsQuery {
  view: KeywordsView;
  lang: "de" | "en" | "all";
  intent: Intent | "all";
  /** A cluster's key, "none", or "" for all. */
  cluster: string;
  source: KeywordSource | "all";
  /** "default" is relevant, weak and unjudged: everything but what was judged irrelevant. */
  status: KeywordStatus | "all" | "default";
  band: PositionBand | "all";
  shown: boolean;
  target: boolean;
  /** Phrases that ask a price, ask a question or name a place; "" for all. */
  flag: KeywordFlag | "";
  /** A path, "none", or "" for all. */
  page: string;
  q: string;
  sort: KeywordsSort;
  dir: "asc" | "desc";
  /** The clusters view's order (?corder=): the audit's order of attack (default), or the most first. */
  clusterSort: ClusterSort;
  /** The page of the list, or of the clusters in that view. */
  offset: number;
  limit: number;
}

export type ClusterSort = "rank" | "impressions" | "relevant" | "opportunities";

/** The window of whole Search Console days the figures cover, and the window before it. */
export interface KeywordWindow {
  start: string;
  end: string;
  days: number;
  /** Only when the desk's own history covers the window before from its first day. */
  previousStart: string | null;
  previousEnd: string | null;
  /** The first day of the desk's own history. */
  historyFrom: string | null;
  /**
   * The window before is compared query by query (the rows' arrows and "new"
   * marks, the tiles' changes, new and lost). False when the history does not
   * cover it, or when Search Console reported no query for it although it
   * counted impressions then: an empty list is not a count of zero.
   */
  queriesCompared: boolean;
  /** Why the window before is not compared although the history covers it; null otherwise. */
  notCompared: string | null;
  /** The property's impressions over the window, every query together (those Google withheld as rare too). */
  impressions: number;
}

export interface KeywordTiles {
  /** Phrases in the table that are relevant, weak or not yet judged (the list's default); `sub` says how many the table holds in all. */
  total: Reading<Stat>;
  /** Phrases Google showed the site for in the window (Search Console impressions), whatever their judgement. */
  shown: Reading<Stat>;
  /** Queries Google showed the site for in the window and not in the window before (only when the window before is compared: KeywordWindow.queriesCompared). */
  newQueries: Reading<Stat>;
  /** Queries shown in the window before and not in this one (only when compared). */
  lostQueries: Reading<Stat>;
  /** Phrases at average position 1 to 10 in the window. */
  topTen: Reading<Stat>;
}

/** Each facet is counted over the phrases every other filter lets through. */
export interface KeywordFacets {
  langs: { key: string; count: number }[];
  intents: { key: Intent; count: number }[];
  sources: { key: KeywordSource; count: number }[];
  statuses: { key: KeywordStatus; count: number }[];
  clusters: { key: string; name: string; lang: string; count: number }[];
  bands: { key: PositionBand; count: number }[];
  /** The pages phrases are mapped to, most phrases first; "none" counts the unmapped. */
  pages: { path: string; count: number }[];
  /** Phrases marked as targets. */
  targets: number;
  /** Phrases Google showed the site for in the window. */
  shown: number;
  /** Phrases that ask a price, ask a question, name a place. */
  flags: Record<KeywordFlag, number>;
}

export interface KeywordRow {
  id: number;
  phrase: string;
  lang: string | null;
  cluster: { key: string; name: string } | null;
  intent: Intent | null;
  sources: KeywordSource[];
  status: KeywordStatus;
  /** Who judged it: "audit", "research", "gsc", or a person's name; null while unjudged. */
  statusBy: string | null;
  /** The page that answers it (by the audit, the desk's rule, or a person), or null: a gap. */
  page: string | null;
  mappedBy: "audit" | "rule" | "person" | null;
  /** The mapped page's own title as the crawl read it; null when the crawl does not know the page (then `pageKnown` is false). */
  pageTitle: string | null;
  pageKnown: boolean;
  /** The page Google showed most for it in the window, when it showed one. */
  shownPage: string | null;
  /** Search Console, over the window; null when Google did not show the site for it. */
  impressions: number | null;
  clicks: number | null;
  /** Clicks over impressions; null when not shown. Small under 30 impressions: print the counts. */
  ctr: Rate | null;
  position: number | null;
  /** Position in the window before; null when not compared or not shown then. */
  previousPosition: number | null;
  /** Average position per day over the window (null on days it was not shown), oldest first. */
  trend: (number | null)[];
  flags: { local: boolean; question: boolean; price: boolean };
  /** A person marked it as a phrase the site should rank for. */
  target: { by: string; at: string } | null;
  /** Open opportunities the engine found for this phrase. */
  opportunities: number;
  firstSeen: string;
}

/** The clusters view's list: `total` clusters match, `rows` is this page of them. */
export interface KeywordClusterList {
  total: number;
  offset: number;
  limit: number;
  rows: KeywordClusterRow[];
  /** Of `total`, those no page of their language answers. */
  gaps: number;
}

/** One topic cluster as the clusters view lists it. */
export interface KeywordClusterRow {
  key: string;
  name: string;
  lang: string;
  intent: Intent | null;
  /** The audit's judgement, or a person's. */
  priority: Priority;
  /** The audit's order of attack, 1 first. */
  rank: number | null;
  page: string | null;
  pageTitle: string | null;
  mappedBy: "audit" | "rule" | "person" | null;
  /** The audit's own words about the page ("gap", "exists", "partial: …"). */
  pageSaid: string | null;
  /** No page of the cluster's language answers it: every German cluster while the site is English only. */
  gap: boolean;
  /** Phrases in the cluster, those judged relevant, and those marked as targets. */
  phrases: number;
  relevant: number;
  targets: number;
  /** Phrases of the cluster Google showed the site for in the window, and their figures together. */
  shown: number;
  impressions: number;
  clicks: number;
  /** The best average position among its phrases in the window. */
  bestPosition: number | null;
  /** Its phrases with the most impressions, else the audit's examples. */
  top: string[];
  flags: { price: number; question: number; local: number };
  opportunities: number;
  why: string | null;
  action: string | null;
}

export interface SitePageOption {
  path: string;
  title: string | null;
  lang: string | null;
}

export interface ResearchState {
  /** Requests to Google Autocomplete this week and the cap the desk refuses beyond. */
  used: number;
  cap: number;
  /** The ISO week the count belongs to: "2026-W40". */
  week: string;
  lastRun: string | null;
  lastNote: string | null;
  nextRun: string | null;
  /** Phrases the research added in all, and in its last run. */
  found: number;
  foundLast: number;
  line: string;
}

/* ---------- answers to changes ---------------------------------------------------------- */

export interface KeywordChanged {
  ok: true;
  id: number;
  /** What happened, in one sentence, as the button shows it. */
  line: string;
}

export interface KeywordsActed {
  ok: true;
  results: { id: number; ok: boolean; line: string }[];
}

export interface BriefQueued {
  ok: true;
  task: { id: number; title: string };
  line: string;
}
