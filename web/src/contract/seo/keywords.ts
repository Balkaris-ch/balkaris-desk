/**
 * GET /api/v1/seo/keywords — the keyword table: every phrase the desk knows
 * (from Search Console, Google Autocomplete research, the audit and people),
 * with its cluster, intent, the page it maps to and what Google shows.
 *
 *   ?range=30d
 *   ?view=clusters       keywords (default) | clusters: the topic clusters instead of the phrases
 *   ?lang=de             de | en | fr | it | all
 *   ?where=che           all (default) | che: Search Console's figures for searches from Switzerland only
 *   ?device=mobile       all (default) | desktop | mobile | tablet: Search Console's figures for one device
 *   ?moved=new           new | lost: phrases shown in this window and not the one before, or the reverse
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
 *   ?open=397            one keyword's own view (KeywordDetail), beside the list
 *   ?research=webdesign  the web research of a phrase, as it was last researched (ResearchPanel); with
 *   &rlang=de&rmodes=plain,questions   its language (de | en | fr | it) and ways (plain, questions, modifiers, front, alphabet)
 *   ?serp=webdesign&slang=de           who ranks for a phrase the table does not hold (SerpView)
 *
 *   GET /api/v1/seo/keywords/export.csv            the list as filtered, every matching row (?id=… repeated: only those)
 *   GET /api/v1/seo/keywords/clusters.csv          the topic clusters as filtered
 *
 * Changes (a signed-in person; nothing here changes the website):
 *   POST /api/v1/seo/keywords                  { phrase, lang?, cluster?, target? } → KeywordChanged   source "manual"
 *   POST /api/v1/seo/keywords/:id/status       { status }                         → KeywordChanged
 *   POST /api/v1/seo/keywords/:id/page         { path | null }                    → KeywordChanged   a person's mapping; null: no page answers it
 *   POST /api/v1/seo/keywords/:id/target       { target: boolean }                → KeywordChanged
 *   POST /api/v1/seo/keywords/:id/brief        {}                                 → BriefQueued      an operator brief for the phrase
 *   POST /api/v1/seo/keywords/bulk             { ids, op: target | untarget | relevant | weak | irrelevant } → KeywordsActed
 *   POST /api/v1/seo/keywords/clusters/:key/brief  {}                             → BriefQueued      an operator brief for the cluster
 *   POST /api/v1/seo/keywords/clusters/:key/page   { path | null | "auto" }          → KeywordChanged   "auto": the desk decides again
 *   POST /api/v1/seo/keywords/:id/page         { path: "auto" } as well
 *   POST /api/v1/seo/keywords/:id/edit         { cluster?, lang?, intent? }       → KeywordChanged   kept against runs and imports
 *   POST /api/v1/seo/keywords/:id/remove       {}                                 → KeywordChanged   only a phrase a person alone added
 *   POST /api/v1/seo/keywords/many             { phrases: "one per line", lang?, cluster? } → KeywordsActed
 *   POST /api/v1/seo/keywords/topics           { name, lang, intent? }            → TopicChanged
 *   POST /api/v1/seo/keywords/topics/:key      { name }                           → TopicChanged     rename
 *   POST /api/v1/seo/keywords/research         { seed, lang?, modes?, fresh? }    → Researched       asks the web (counts on today's allowance)
 *   POST /api/v1/seo/keywords/research/track   { seed, lang, phrases: [{ phrase, cluster? }], cluster? } → KeywordsTracked
 *   POST /api/v1/seo/keywords/research/run     {}                                 → { ok, line }     the daily research, now
 *   POST /api/v1/seo/keywords/serp             { phrase, lang?, cluster?, fresh? } → SerpAsked & { ok, line }   who ranks
 *   POST /api/v1/seo/keywords/ai-sort          { ids } | { seed, lang, phrases }  → BriefQueued      the workstation's local model sorts them
 *   POST /api/v1/seo/keywords/planner          { csv, lang?, addMissing? }        → PlannerImport & { ok }   the owner only
 *   POST /api/v1/seo/keywords/volumes          { ids }                            → { ok, line }     DataForSEO, when connected
 *
 * SEARCH VOLUME only where somebody gave a number: a Keyword Planner export the
 * owner imported, or DataForSEO once connected; each figure names its source
 * and day, and the column is drawn only when a number exists. Otherwise the
 * column is Search Console's impressions for the site, named as such.
 * Difficulty is DataForSEO's when bought; "competition" is the desk's own
 * reading of a kept Google result page (its ads and map pack), named so.
 *
 * Types only.
 */
import type { Reading, Stat } from "../common";
import type { GoogleLane, KeywordVolume, Priority, Rate, ResearchMode, ResearchResult, SeoHead, SerpCheck, WebAllowance, WebLang } from "./common";

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
  /** The desk's daily research of the clusters' seeds (with a weekly budget). */
  research: ResearchState;
  /** Research on the web, the first thing on the page: the box, today's allowance, and the asked phrase's answer. */
  lookup: ResearchPanel;
  /** Who ranks for a phrase the table does not hold (?serp=); null when none is asked. */
  serp: SerpView | null;
  /** One keyword's own view (?open=); null when none is open. */
  open: Reading<KeywordDetail> | null;
  /** What demand figures exist and where more would come from. */
  volumes: VolumeState;
  /** The person may import a Keyword Planner export (the owner). */
  canImport: boolean;
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
  lang: WebLang | "all";
  /** Search Console's figures for every country (default) or searches from Switzerland only. */
  where: "all" | "che";
  /** Search Console's figures for every device (default) or one. */
  device: "all" | "desktop" | "mobile" | "tablet";
  /** Phrases new in the window, or lost since the window before; "" for all. */
  moved: "new" | "lost" | "";
  /** The keyword whose own view is open, or null. */
  open: number | null;
  /** The phrase researched on the web ("" for none), its language and ways. */
  research: string;
  rlang: WebLang;
  rmodes: ResearchMode[];
  /** A phrase whose result pages are shown though the table does not hold it ("" for none), and its language. */
  serp: string;
  slang: WebLang;
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
  /** Demand, when somebody gave a number for it (Keyword Planner or DataForSEO), with its source and day; null otherwise. */
  volume: KeywordVolume | null;
  /** The newest Google result page the desk kept for it, and the desk's own reading of it; null when never checked. */
  kept: KeptSerp | null;
  /** The newest brief asked for it from this page, and where it stands. */
  brief: { task: number; state: string; at: string } | null;
  /** A person alone added it, so a person may take it out again. */
  removable: boolean;
}

/**
 * The newest Google result page kept for a phrase, and the desk's own
 * "competition" reading of it: how many ads and whether a map pack stand
 * above the organic results. The desk's own measure, never a vendor's score.
 */
export interface KeptSerp {
  check: number;
  at: string;
  ownPosition: number | null;
  competition: "low" | "medium" | "high";
  line: string;
}

/** What demand figures the table holds, and where more would come from. */
export interface VolumeState {
  /** Phrases with a volume, and with a difficulty. */
  withVolume: number;
  withDifficulty: number;
  /** DataForSEO: connected or not, and the owner's step when not. */
  dataforseo: { configured: boolean; step: string | null };
}

/** Research on the web: the box and the answer for the asked phrase. */
export interface ResearchPanel {
  /** What the box asks with (the address's research, rlang, rmodes, or the defaults). */
  seed: string;
  lang: WebLang;
  modes: ResearchMode[];
  /** Today's person-asked allowance, and the sources paused after a refusal. */
  allowance: WebAllowance;
  paused: { source: "google" | "bing"; until: string; why: string }[];
  /**
   * The answer, as last researched in the last seven days (sending nothing);
   * waiting with the cost when this phrase was not researched in these ways;
   * null when no phrase is asked.
   */
  result: Reading<ResearchResult> | null;
  /** What researching it now would send, and what the last seven days' answers save. */
  cost: { send: number; kept: number } | null;
  /** Where a "Check who ranks" would go: the studio workstation, today's Google allowance, a pause. */
  lane: GoogleLane;
}

/** Who ranks for one phrase: the newest result pages kept, what is on its way, and the Google lane. */
export interface SerpView {
  phrase: string;
  lang: WebLang;
  /** The keyword table's row, when it holds the phrase. */
  tracked: number | null;
  google: SerpCheck | null;
  /** DuckDuckGo's page: a second opinion, never Google's ranking. */
  duckduckgo: SerpCheck | null;
  /** A check queued or running. */
  pending: SerpCheck | null;
  /** Earlier checks, newest first: the phrase's history of result pages. */
  history: SerpCheck[];
  lane: GoogleLane;
  /** The desk's own reading of the newest Google page, or null. */
  kept: KeptSerp | null;
}

/** One keyword's own view (?open=). */
export interface KeywordDetail {
  row: KeywordRow;
  /** Search Console per day over the window (the head's period, the where and device asked). */
  series: Reading<{ date: string; clicks: number; impressions: number; position: number | null }[]>;
  /** The pages Google showed for it over the window. */
  pages: Reading<{ path: string; clicks: number; impressions: number; position: number | null }[]>;
  serp: SerpView;
  /** The phrase it was found from by research, if any. */
  seed: string | null;
  /** Phrases the research found from it, at most 30. */
  found: { id: number; phrase: string; status: KeywordStatus }[];
  /** Its topic with the topic's page. */
  topic: { key: string; name: string; lang: string; page: string | null } | null;
  /** Briefs asked for it from this page, newest first. */
  briefs: { task: number; state: string; at: string; by: string }[];
  /** Who last refiled it by hand (topic, language, intent). */
  editedBy: string | null;
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

/** The desk's own daily research of the clusters' seeds, with a weekly budget. */
export interface ResearchState {
  /** Requests to Google's suggestions this week and the cap the desk refuses beyond. */
  used: number;
  cap: number;
  /** The ISO week the count belongs to: "2026-W40". */
  week: string;
  lastRun: string | null;
  lastNote: string | null;
  nextRun: string | null;
  /** Phrases the research added in all, and in its last run (and the requests that run sent). */
  found: number;
  foundLast: number;
  sentLast: number;
  /** The job can be run now from this page (it is ready and switched on). */
  canRun: boolean;
  line: string;
}

export interface TopicChanged {
  ok: true;
  topic: { key: string; name: string; lang: string };
  line: string;
}

export interface Researched {
  ok: true;
  line: string;
  /** Where the answer is drawn: the address to go to. */
  href: string;
}

export interface KeywordsTracked {
  ok: true;
  added: number;
  known: number;
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
