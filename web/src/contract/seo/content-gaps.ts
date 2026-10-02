/**
 * GET /api/v1/seo/content-gaps — the topic clusters and which of them the
 * site answers. A cluster with no page of its language is a GAP; every German
 * cluster is a gap while the site is English only.
 *
 *   ?range=30d
 *   ?view=topic          topic (default) | industry | language | clusters | keywords | competitors
 *   ?open=<group key>    the group open beside the coverage list (a topic, an industry, "de"/"en", a cluster)
 *   ?tab=missing         missing (default) | partial | suggested | competitors: the open group's table
 *   ?lang=de             de | en | all          (keywords view)
 *   ?price=1             only price questions   (keywords view)
 *   ?question=1          only questions         (keywords view)
 *   ?gap=1               1: only gaps, 0: only covered, all
 *   ?priority=high       high | medium | low | all
 *   ?cluster=<key>       one cluster in detail (`selected`)
 *   ?offset=0&limit=12   the open table's page (at most 200)
 *
 * Changes (a signed-in person):
 *   POST /api/v1/seo/content-gaps/brief    { cluster } | { phrases: id[] }   "Create brief": one operator brief per
 *                                          cluster. With `phrases` (a row's own phrase, or the ticked ones, at most 60
 *                                          in at most 5 clusters) the brief names those phrases; with `cluster`, the
 *                                          cluster's missing phrases                                         → BriefsAnswer
 *   POST /api/v1/seo/content-gaps/briefs   { clusters: key[] }   "Generate all briefs": each cluster's brief for its
 *                                          missing phrases, at most ten at once                              → BriefsAnswer
 *     Both write the brief's topic here (at most 300 characters: the page to make, then the searchers' own
 *     phrases), queue it as an operator task, and link it to the cluster's gap opportunity
 *     ("german-missing:<key>" / "keyword-gap:<key>"), or remember it for a cluster that has none.
 *   POST /api/v1/seo/content-gaps/step     { id }   one of the steps `german.steps` and `price.steps` show (any other
 *                                          id is refused with 404), taken as Opportunities takes it: a brief or a
 *                                          proposal is queued for the operator; a change to the website's code goes on
 *                                          the to-do list in AI Operator (only from open); the owner's steps and steps
 *                                          in the owner's browser are refused (409): they are marked done with their
 *                                          task                                                          → OpportunityAnswer
 *   POST /api/v1/seo/clusters/:key/page     { path | null }   map the cluster to a page by hand → { ok, cluster }
 *   A cluster's brief is also its opportunity's action: POST /api/v1/seo/opportunities/:id/act
 *
 * NO SEARCH VOLUME, NO DIFFICULTY. No free source gives either. Phrases are
 * COUNTED (how many distinct searches the keyword table holds), never weighed
 * by an invented volume; "impressions" are Search Console's, for the site, in
 * the window, and are absent where Google has not shown the site.
 *
 * Types only.
 */
import type { Reading, Stat } from "../common";
import type { TaskState } from "../operator";
import type { OpportunityRow, OpportunityState, OwnerTaskRow, Potential, Priority, SeoHead } from "./common";
import type { Intent, KeywordSource } from "./keywords";

/** How the gaps are grouped. clusters, keywords and competitors were the first three; the others were added with the page. */
export type GapView = "topic" | "industry" | "language" | "clusters" | "keywords" | "competitors";

/** The open group's tables. */
export type GapTab = "missing" | "partial" | "suggested" | "competitors";

export interface SeoContentGapsPayload {
  head: SeoHead;
  tiles: GapTiles;
  view: GapView;
  /* Every cluster's row was sent here once (`clusters`); no screen read it, so it is left out: the coverage list and `selected` carry the rows a view needs. */
  /** view=keywords: relevant phrases with no page of their language. */
  keywords: Reading<{ total: number; rows: GapKeyword[]; offset: number; limit: number }> | null;
  /** view=competitors: competitor pages captured for each cluster. */
  competitors: Reading<{ rows: { cluster: { key: string; name: string }; pages: { domain: string; url: string; title: string | null; words: number | null; lang: string | null; priceStated: boolean | null; seen: number }[] }[] }> | null;
  selected: Reading<ClusterDetail> | null;

  /* ---- added with the page (board 113, panel 5) ---- */

  /** What the server understood of the address, defaults filled in. */
  asked: GapQuery;
  /** The largest gap: the market searches in German and the site has no German page. */
  german: Reading<GermanGap>;
  /** The next: price questions ("was kostet …") and the pages that state a price. */
  price: Reading<PriceGap>;
  /** The view switch: each view and how many groups or rows it holds. */
  views: { key: GapView; label: string; count: number | null }[];
  /** view=topic | industry | language | clusters: the coverage list. */
  groups: Reading<{ rows: GapGroup[] }> | null;
  /** The group open beside the list (?open=), else the list's first. */
  group: Reading<GroupDetail> | null;
  /** What only the owner can do that would close or measure a gap (prices, a decision, Keyword Planner). */
  needsYou: Reading<OwnerTaskRow[]>;
  /** How the page counts, printed once where the figures are. */
  notes: { coverage: string; impressions: string; volume: string };
}

export interface GapQuery {
  view: GapView;
  open: string | null;
  tab: GapTab;
  lang: "de" | "en" | "all";
  price: boolean;
  question: boolean;
  gap: "1" | "0" | "all";
  priority: Priority | "all";
  cluster: string | null;
  offset: number;
  limit: number;
}

export interface GapTiles {
  clusters: Reading<Stat>;
  /** Clusters with no page of their language. */
  gaps: Reading<Stat>;
  germanGaps: Reading<Stat>;
  /** Relevant phrases with a page of their language, of all relevant phrases. */
  mappedPhrases: Reading<Stat>;
  /** Relevant price questions with no page of their language, of all relevant price phrases. */
  priceGaps: Reading<Stat>;
}

/** Where a cluster's brief stands: its gap opportunity, and the operator task its brief queued. */
export interface BriefState {
  /** "german-missing:<key>" or "keyword-gap:<key>"; null for a cluster a page already answers. */
  opportunityId: string | null;
  state: OpportunityState | null;
  /** Whether "Create brief" can be pressed now; `why` says why not. */
  available: boolean;
  why: string | null;
  task: { id: number; state: TaskState; href: string } | null;
  /** The opportunity's own note ("Queued as operator task #12 …"), when it has one. */
  note: string | null;
}

export interface ClusterRow {
  key: string;
  name: string;
  lang: string;
  intent: Intent | null;
  /** The audit's judgement of whether a young site can win it (2 Oct 2026), or a person's; not a measured figure. */
  priority: Priority;
  /** The audit's order of attack, 1 first; null for a cluster added since. */
  rank: number | null;
  page: string | null;
  mappedBy: "audit" | "rule" | "person" | null;
  gap: boolean;
  /** Why it matters and what to do, as the audit wrote it. */
  why: string | null;
  action: string | null;
  keywords: { total: number; relevant: number; mapped: number };
  /** Search Console impressions of its phrases in the window: real demand the site already meets; null when none. */
  impressions: number | null;
  /** A few of its phrases. */
  examples: string[];
  /** The opportunity that carries its "Create brief" or "Optimise page". */
  opportunityId: string | null;
  /** Its relevant phrases that ask a price, and that are questions. */
  price: number;
  questions: number;
  /** The mapped page is in another language than the cluster (a German cluster mapped to an English page): still a gap. */
  otherLanguage: boolean;
  /** Where its brief stands. */
  brief: BriefState;
}

export interface GapKeyword {
  id: number;
  phrase: string;
  lang: string | null;
  cluster: { key: string; name: string } | null;
  intent: Intent | null;
  impressions: number | null;
  flags: { local: boolean; question: boolean; price: boolean };
  /** Average position in Google over the window, null when not shown. */
  position: number | null;
  /** The page the keyword table maps it to (any language), or null. */
  page: string | null;
  /** A page of its own language answers it. */
  covered: boolean;
  /** Where the phrase was found: Search Console, Google Autocomplete (people search it), the audit, a person. */
  sources: KeywordSource[];
  /** The brief of its cluster ("Create brief"). */
  brief: BriefState | null;
}

/** One row of the coverage list: a topic, an industry, a language or a cluster. */
export interface GapGroup {
  key: string;
  name: string;
  /** Relevant phrases, and those a page of their own language answers. */
  coverage: { covered: number; of: number };
  /** Its clusters with a relevant phrase, and those with no page of their language. */
  clusters: { of: number; gaps: number };
  /** Its clusters by language: whether each is a gap and the page that answers it. */
  langs: { lang: string; cluster: string; gap: boolean; page: string | null }[];
  /** The highest priority among its clusters, and the audit's best order of attack. */
  priority: Priority;
  rank: number | null;
  /** Relevant phrases that ask a price, and that are questions. */
  price: number;
  questions: number;
  /** Search Console impressions of its phrases in the window; null when Google showed none of them. */
  impressions: number | null;
}

/** A page to create: one per gap cluster. */
export interface Suggestion {
  cluster: ClusterRow;
  /** The page to make: the audit's first sentence when it names one ("Create German page 'Was kostet …'"), whole up to 400 characters and never cut inside a word; else ours. */
  page: string;
  /** Our estimate, only from the cluster's own impressions; null where there are none. */
  potential: Potential | null;
  /** Competitor pages read for the cluster's searches, and how many state a price. */
  competitors: { pages: number; priced: number; german: number };
}

export interface CompetitorPage {
  domain: string;
  url: string;
  title: string | null;
  words: number | null;
  lang: string | null;
  priceStated: boolean | null;
  cluster: { key: string; name: string } | null;
  /** The search it was seen for, as captured. */
  query: string | null;
  /** How often the domain was seen in the captured results for the group's clusters. */
  seen: number;
  fetchedAt: string | null;
}

export interface GroupDetail {
  group: GapGroup;
  tab: GapTab;
  counts: Record<GapTab, number>;
  /** The open tab's rows; the others are null. */
  missing: { total: number; offset: number; limit: number; rows: GapKeyword[] } | null;
  partial: { total: number; offset: number; limit: number; rows: GapKeyword[] } | null;
  suggested: { total: number; offset: number; limit: number; rows: Suggestion[] } | null;
  competitors: { total: number; offset: number; limit: number; rows: CompetitorPage[] } | null;
  /** The group's clusters, gaps first. */
  clusters: ClusterRow[];
  /** "Generate all briefs": the group's gap clusters whose brief can be queued now, most important first. */
  briefs: { ready: string[]; queued: number; total: number };
}

export interface GermanGap {
  /** Relevant phrases by language: counted, not weighed by any volume. */
  phrases: { de: number; en: number; other: number; total: number };
  /** The site's pages by html lang, as the crawl read them. */
  pages: { de: number; en: number; other: number; total: number; hreflang: number | null };
  clusters: { de: number; gaps: number };
  /** Search Console impressions of German and English phrases in the window; null without the history. */
  impressions: { de: number; en: number } | null;
  /** The German clusters to answer first. */
  top: ClusterRow[];
  /** The audit's site-wide steps for German (the locale, the plan, the price pages): opportunities with their actions. */
  steps: OpportunityRow[];
}

export interface PriceGap {
  /** Relevant phrases that ask a price, by language, and of them questions ("was kostet …"). */
  phrases: { total: number; de: number; en: number; questions: number; covered: number };
  relevant: number;
  /** Clusters holding price phrases, and those with no page of their language. */
  clusters: { total: number; gaps: number };
  /** Service and landing pages that state a CHF price, by the readiness check; null before its first run. */
  pricedPages: { count: number; of: number; paths: string[]; checkedAt: string } | null;
  /** Competitor pages read for the price clusters, and how many state a price. */
  competitors: { pages: number; priced: number } | null;
  top: ClusterRow[];
  steps: OpportunityRow[];
  /** Only the owner decides the prices: the task, when the audit left one. */
  owner: OwnerTaskRow | null;
}

export interface ClusterDetail {
  cluster: ClusterRow;
  phrases: { id: number; phrase: string; status: string; impressions: number | null; position: number | null; page: string | null }[];
  opportunity: OpportunityRow | null;
  competitors: { domain: string; url: string; title: string | null; h1: string | null; words: number | null; lang: string | null; schemaTypes: string[]; priceStated: boolean | null; fetchedAt: string | null }[];
  /** Where the competitors were seen for this cluster's queries. */
  sightings: { domain: string; engine: string; kind: string; query: string; position: number | null; day: string }[];
}

/** What a brief request did: one line per cluster. */
export interface BriefsAnswer {
  ok: true;
  results: { cluster: string; ok: boolean; line: string; task: number | null }[];
}
