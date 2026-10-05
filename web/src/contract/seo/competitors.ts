/**
 * GET /api/v1/seo/competitors — the domains seen beside or instead of
 * Balkaris: where each was seen (which query, which engine, which position or
 * citation, which day) and what its pages for our clusters say, fetched
 * politely once a week.
 *
 *   ?engine=google      google | ai (any assistant) | all
 *   ?cluster=<key>      seen for that cluster's queries
 *   ?q=agentur          words in the domain or name
 *   ?open=<domain>      one competitor in detail (`selected`)
 *   ?type=studios       studios | platforms | all
 *   ?sort=position      seen (most sightings) | position (best Google position) | ai (most AI mentions) | name
 *   ?offset=15&limit=15 the list's page
 *   ?look=<domain>      a looked-up site beside Balkaris (`lookup`)
 *   ?serp=<phrase>&serpLang=de  a "who ranks" check shown (`serp`)
 *   ?search=<query>     the list narrowed to one captured search, and its result page shown (`searches`)
 *   ?shown=ignored      active (default) | ignored | all
 *   ?range=30d          the head's window: only the clusters' Search Console figures read it;
 *                       an observation is dated and shown with its day, whatever the window
 *
 * NO INVENTED METRICS: no domain rating, no backlink count, no traffic
 * estimate. What is shown is what was observed (where it was seen) and what
 * its own page says (words, language, structured data, whether it states a price).
 *
 * Types only.
 */
import type { Reading, Stat } from "../common";
import type { NewTask } from "../operator";
import type { ProfileState } from "./backlinks";
import type { GoogleLane, PageRef, PaidDomainFacts, Priority, Rate, SeoHead, SerpCheck, SerpLocalRow, WebAllowance, WebLang } from "./common";

export interface SeoCompetitorsPayload {
  head: SeoHead;
  /** The filters as the server read them (added for the page). */
  asked: CompetitorsAsked;
  /** The five figures over the page (added for the page). */
  tiles: CompetitorTiles;
  list: Reading<{
    total: number;
    rows: CompetitorRow[];
    engines: { key: string; label: string; count: number }[];
    /* Added for the page: the pager, and the other two filters' counts. */
    offset: number;
    limit: number;
    types: { key: string; label: string; count: number }[];
    clusters: { key: string; name: string; count: number }[];
    /* Added for the web build. */
    /** Competitors, ignored ones, all: with counts. */
    shown?: { key: string; label: string; count: number }[];
    /** Nothing matched what was typed and it is an address: the site to look up. */
    lookFor?: string | null;
    /** Nothing matched and it reads as a search: the phrase to check who ranks for. */
    checkFor?: string | null;
  }>;
  selected: Reading<CompetitorDetail> | null;
  /** What the competitors' pages and listings show that Balkaris's do not, measured the same way on both sides (added for the page). */
  lacks: Reading<LackPanel>;
  /** Directories and platforms seen in the results for our searches, and the studio's own listing there (added for the page). */
  directories: Reading<DirectoryRow[]>;
  /** Each of our clusters with a competitor seen: who ranks, what their pages say, and our page beside them (added for the page). */
  clusters: Reading<ClusterCompare[]>;
  /** The page's rules in words: how a search is filed under a cluster, how a name joins a site, what an observation is (added for the page). */
  rules: { filing: string; joining: string; observed: string };
  /**
   * The weekly refresh of their pages. `lastRun` is when the job last ran (a
   * run may find nothing due); `newestRead` is when the desk last read one of
   * their pages (added for the page).
   */
  refresh: { lastRun: string | null; lastNote: string | null; nextRun: string | null; pages: number; fetched: number; registered?: boolean; running?: boolean; newestRead?: string | null; due?: number; failed?: number };
  /* Added for the page (the web build). */
  /** Whether the person asking is the owner: hand records and the audit import are his. */
  owner?: boolean;
  /** A looked-up site beside Balkaris (?look=); null when none is asked. */
  lookup?: Reading<LookupCard> | null;
  /** "Who ranks for…": the Google lane, the check shown (?serp=), the recent checks. */
  serp?: Reading<SerpPanel>;
  /** Every captured search with its cluster, our place in it, and the result page of the one chosen (?search=). */
  searches?: Reading<SearchPanel>;
}

/* ---------- added for the page (additive: nothing above was taken away) ------------------- */

export type CompetitorEngineFilter = "all" | "google" | "ai";
export type CompetitorTypeFilter = "all" | "studios" | "platforms";
export type CompetitorSort = "seen" | "position" | "ai" | "name";

export interface CompetitorsAsked {
  /** google: seen in Google's own results (organic or the map pack); ai: named or cited in an AI answer (AI Overview, AI Mode, an assistant). */
  engine: CompetitorEngineFilter;
  /**
   * studios: every site and company NOT on the desk's list of directories and
   * platforms (the key keeps its first name; they are not checked one by one
   * to be studios: search engines' help pages, software vendors, news sites
   * and public bodies are among them); platforms: directories, networks and
   * other platforms (src/cc/seo/competitors.ts PLATFORMS).
   */
  type: CompetitorTypeFilter;
  cluster: string | null;
  q: string;
  sort: CompetitorSort;
  offset: number;
  limit: number;
  open: string | null;
  /* Added for the web build. */
  /** A domain looked up (?look=), as typed. */
  look?: string | null;
  /** A phrase whose result-page checks are shown, and its language. */
  serp?: string | null;
  serpLang?: WebLang | null;
  /** The list narrowed to the sites seen for one captured search. */
  search?: string | null;
  /** active: ignored ones hidden (the default); ignored: only them; all. */
  shown?: CompetitorShown;
}

export type CompetitorShown = "active" | "ignored" | "all";

/** A person's word on a row (added for the web build). */
export interface CompetitorDecision {
  watch: boolean;
  ignore: boolean;
  /** Over the platform list; null = the list decides. */
  kind: "platform" | "studio" | null;
  /** Counted as this other key. */
  mergedInto: string | null;
  by: string;
  at: string;
}

/** One cell of a looked-up fact: the words, who said it and when; or why it could not be had, and the step. */
export interface LookupCell {
  state: "ok" | "waiting" | "off";
  text: string;
  from: string;
  at: string | null;
  step: string | null;
}

export interface LookupRow {
  key: string;
  label: string;
  them: LookupCell;
  /** Balkaris's own, from a lookup of balkaris.ch or the desk's crawl; null when nothing of ours is kept. */
  us: LookupCell | null;
}

/** A site looked up, beside Balkaris (?look=). */
export interface LookupCard {
  /** What was typed. */
  asked: string;
  domain: string;
  /** Its home page as read. */
  home: string;
  asOf: string;
  line: string;
  /** Facts still being read in the background: reload to see them. */
  pending: boolean;
  rows: LookupRow[];
  /** Its row in the list when it is one, with the person's word on it. */
  known: { key: string; name: string | null; sightings: number; decision: CompetitorDecision | null } | null;
  /** Its pages on the weekly read. */
  pages: number;
  allowance: WebAllowance;
  /** DataForSEO: what it ranks for on google.ch, its visibility and links; off with the owner's step while there is no account. */
  paid: PaidDomainFacts & { configured: boolean; step: string | null };
  brief: { task: NewTask; label: string; step: string };
}

/** One organic result of a check, with where it leads on this page. */
export interface SerpRowView {
  position: number;
  title: string;
  url: string;
  host: string;
  /** The key it has in the list (a host without www.). */
  key: string;
  /** On the list (open it) or not (look it up). */
  known: boolean;
  ours: boolean;
}

/** Who came, went or moved between this capture and the one before it for the same phrase and engine. */
export interface SerpChange {
  since: string;
  newcomers: string[];
  gone: string[];
  moved: { host: string; from: number; to: number }[];
}

export interface SerpView {
  check: Omit<SerpCheck, "page">;
  rows: SerpRowView[];
  local: SerpLocalRow[];
  related: string[];
  questions: string[];
  ads: number;
  changes: SerpChange | null;
}

export interface SerpPanel {
  lane: GoogleLane;
  dataforseo: { configured: boolean; step: string | null };
  /** The phrase shown, or null. */
  phrase: string | null;
  lang: WebLang | null;
  google: SerpView | null;
  duckduckgo: SerpView | null;
  recent: { id: number; phrase: string; lang: WebLang; engine: SerpCheck["engine"]; state: SerpCheck["state"]; label: string; requestedAt: string; doneAt: string | null; ownPosition: number | null; requestedBy: string; line: string }[];
  langs: WebLang[];
}

/** One captured search: its cluster, the newest page captured for it, and our place. */
export interface CapturedSearch {
  query: string;
  lang: string | null;
  cluster: { key: string; name: string } | null;
  /** audit: the keyword table or the capture; words: the page's rule; hand: a person; null: unfiled. */
  filed: "audit" | "words" | "hand" | null;
  /** Days it was captured, newest first, and who captured the newest. */
  days: string[];
  by: string;
  sites: number;
  /** Balkaris's place: from a capture, else Search Console's average over the head's window (labelled), else nothing. */
  ours: { position: number | null; how: "capture" | "search-console" | null; line: string };
  /** The newest capture's results (filled for the chosen search only). */
  organic?: { position: number; key: string; name: string; url: string | null; title: string | null; ours: boolean }[];
  mapPack?: { position: number; name: string }[];
  /** Who came, went or moved since the capture before (chosen search only). */
  changes?: SerpChange | null;
}

export interface SearchPanel {
  rows: CapturedSearch[];
  /** Searches under no cluster. */
  unfiled: number;
  /** Our clusters, to file a search under by hand. */
  clusters: { key: string; name: string; lang: string }[];
  /** The chosen search (?search=), with its result page. */
  chosen: CapturedSearch | null;
}

/** Counts, each from the desk's own record of what was observed; no earlier period exists to compare with. */
export interface CompetitorTiles {
  /** Sites and companies seen that are not on the platform list (platforms apart); not checked one by one to be studios. */
  seen: Reading<Stat>;
  /** Of those sites and companies, seen in Google's own results (organic top results or the map pack). */
  google: Reading<Stat>;
  /** Companies an AI answer named or cited, platforms included. */
  ai: Reading<Stat>;
  /** Their pages the desk has read, of the pages known. */
  pages: Reading<Stat>;
  /** Our clusters with a competitor seen, of the clusters known. */
  clusters: Reading<Stat>;
}

/** What a competitor's pages read show, over the pages read; null in a row whose pages were not read. */
export interface CompetitorHas {
  pages: number;
  german: boolean;
  price: boolean;
  /** FAQPage in its structured data. */
  faq: boolean;
  /** Organization, LocalBusiness, ProfessionalService or another business type in its structured data. */
  business: boolean;
  /** AggregateRating or Review in its structured data. */
  reviews: boolean;
}

/** A task in the SEO engine's list (cc_seo_owner_tasks) that acts on a lack. */
export interface TaskRef {
  id: string;
  title: string;
  /** owner and lead-chrome are "Needs you"; code and content are the website's and the writers' steps. */
  who: "owner" | "lead-chrome" | "code" | "content";
  done: boolean;
  /** Where it is listed with its step, or null. */
  href: string | null;
}

/** One line of "Beside Balkaris" in a competitor's detail. */
export interface BesideRow {
  key: string;
  label: string;
  them: string;
  us: string;
  /** True when they show it and we do not; false when we do too (or they do not); null when one side was not measured. */
  lack: boolean | null;
  task: TaskRef | null;
}

export interface LackRow {
  key: "german" | "price" | "faq" | "business" | "reviews" | "map-pack" | "ai" | "directories";
  label: string;
  /** How both sides were measured, in one sentence. */
  how: string;
  them: Rate | null;
  themLine: string;
  us: Rate | null;
  usLine: string;
  lack: boolean | null;
  task: TaskRef | null;
}

export interface LackPanel {
  /** Competitor pages read (platforms are never read). */
  pagesRead: number;
  /** Our sitemap pages the crawl read. */
  ourPages: number;
  rows: LackRow[];
}

export interface DirectoryRow {
  domain: string;
  name: string | null;
  /** Where it was seen: one line per observation. */
  seen: { query: string; engineLabel: string; kind: Sighting["kind"]; position: number | null; day: string }[];
  /** Its best organic Google position for one of our searches; null when only an AI answer named or cited it. */
  best: number | null;
  /** The studio's own profile there, from the profile registry (src/cc/seo/presence.ts); null when the registry has none for it. */
  ours: { key: string; name: string; state: ProfileState; stateWhy: string; url: string | null; checkedAt: string | null } | null;
  task: TaskRef | null;
}

/** One of their pages in a cluster's comparison. */
export interface RivalPage {
  domain: string;
  name: string | null;
  /** The best organic position seen for the cluster's searches. */
  position: number;
  query: string;
  page: Pick<CompetitorPage, "url" | "address" | "words" | "lang" | "schemaTypes" | "priceStated" | "priceText" | "priceDoubt" | "error"> | null;
}

/** Our page for a cluster, as the crawl and the readiness check read it. */
export interface OurPage {
  page: PageRef;
  /** Who mapped the cluster to it: the audit, the desk's rule, a person. */
  mappedBy: string | null;
  words: number | null;
  lang: string | null;
  schemaTypes: string[];
  faq: boolean;
  /** A German version linked by hreflang; null when the crawl did not record the page's alternates. */
  german: boolean | null;
  /** The readiness check's price check: true or false where it asks it, null where it does not (and `priceWhy` says so). */
  price: boolean | null;
  priceWhy: string;
}

export interface ClusterCompare {
  cluster: { key: string; name: string; lang: string; priority: Priority; rank: number | null };
  /** The searches captured for it, and how each was filed: by the audit's keyword table, or by the page's words rule. */
  queries: { query: string; filed: "audit" | "words" | "hand"; engines: string[] }[];
  /** Who ranks: the best organic position per site across its searches, best first, at most six. Balkaris is never among them: see `ourSeen`. */
  organic: RivalPage[];
  /**
   * Balkaris's own organic positions in the cluster's captured searches, as
   * the capture counted them, best first (added for the page). Empty when the
   * capture does not record Balkaris for them, and `ourSeenWhy` says which.
   */
  ourSeen?: { position: number; query: string; day: string }[];
  /** Why `ourSeen` is empty, in one line; null when it is not (added for the page). */
  ourSeenWhy?: string | null;
  /** Companies in Google's map pack for its searches, in order. */
  mapPack: { name: string; position: number; query: string }[];
  /** Companies AI answers named or cited for its searches. */
  ai: { name: string; engines: string[] }[];
  /** Their pages read for it (platforms never), from the sites shown in `organic` only; `shown` is how many those are (added for the page). */
  theirs: { read: number; german: number; price: number; faq: number; medianWords: number | null; prices: string[]; shown?: number };
  /** Our page for it, or null when there is none of its language (and `gap` says what the audit said). */
  ours: OurPage | null;
  gap: string | null;
  /** Search Console for the cluster's phrases over the head's window: our own figures, real or absent. */
  search: Reading<{ start: string; end: string; phrases: number; shown: number; impressions: number; clicks: number; position: number | null; top: { query: string; impressions: number; position: number | null }[] }>;
  /** A brief for the AI Operator built from the facts above; it waits for the studio workstation. */
  brief: { task: NewTask; label: string; step: string } | null;
}

export interface Sighting {
  /** google (organic), google-local (the map pack), google-aio (AI Overview), ai-mode, chatgpt, perplexity, gemini. */
  engine: string;
  engineLabel: string;
  /** organic | local-pack | named (in an AI answer) | cited (as an AI answer's source). */
  kind: "organic" | "local-pack" | "named" | "cited";
  query: string;
  /** Organic or map-pack position, 1-based; null for an AI answer. */
  position: number | null;
  day: string;
  /** Who observed it: "audit" (2 Oct 2026, the owner's Chrome) or "lead-chrome" or "api". */
  by: string;
  cluster: { key: string; name: string } | null;
  /** How the cluster was filed: the audit's keyword table, or the page's words rule (`rules.filing`); null with no cluster. Added for the page. */
  filed?: "audit" | "words" | "hand" | null;
}

export interface CompetitorRow {
  /** The site's host ("example-studio.ch"); for a company an AI answer or a map pack named without a site, "name:" and its name. */
  domain: string;
  name: string | null;
  sightings: number;
  /** The best organic Google position seen for one of our queries; null when never seen organically. */
  bestPosition: number | null;
  /** Times an AI answer named it, and times one cited its site. */
  named: number;
  cited: number;
  queries: string[];
  /** Its pages the desk has fetched, and how many of them state a price. */
  pages: number;
  pricePages: number;
  lastSeen: string;
  /* Added for the page. */
  /** A directory, network or other platform rather than a studio. */
  platform: boolean;
  /** The engines it was seen in, as keys and labels. */
  engines: { key: string; label: string }[];
  /** Its best position in Google's map pack for one of our searches; null when never seen there. */
  mapPack: number | null;
  /** Names an AI answer or the map pack gave without a site, joined to this site by `rules.joining`. */
  alsoNamed: string[];
  /** What its pages read show; null when none was read. */
  has: CompetitorHas | null;
  /** The clusters it was seen for. */
  clusters: { key: string; name: string }[];
  /** A person's word on it (added for the web build); null when nobody said anything. */
  decision?: CompetitorDecision | null;
}

export interface CompetitorPage {
  url: string;
  /**
   * "ranking": the address the observation captured for the query. "home":
   * the observation named only the domain, so its home page was read instead;
   * it is not necessarily the page that ranks. "topic": the page of its
   * sitemap whose address fits one of our clusters (added for the web build).
   */
  address: "ranking" | "home" | "topic";
  /** The cluster or query it was captured for. */
  cluster: { key: string; name: string } | null;
  query: string | null;
  status: number | null;
  title: string | null;
  h1: string | null;
  words: number | null;
  lang: string | null;
  schemaTypes: string[];
  /** Whether the page states a price (a CHF or Fr. amount, or "ab CHF"); null when not read. */
  priceStated: boolean | null;
  /** The first price-like phrase found, as written on the page. */
  priceText: string | null;
  /** Why a price-like phrase was not counted as a price ("Fr. 9" may be Friday's hours), with `priceStated` null; absent or null when it was. Added for the page. */
  priceDoubt?: string | null;
  fetchedAt: string | null;
  /** Why it was not read: robots.txt disallows the desk, the site refused, a timeout. */
  error: string | null;
}

export interface CompetitorDetail {
  competitor: CompetitorRow;
  sightings: Sighting[];
  pages: CompetitorPage[];
  /* Added for the page. */
  /** Its site's address, or null for a company named without one. */
  site: string | null;
  /** What it is set beside: the cluster of its best result and our page for that cluster, in one line. */
  against: { cluster: { key: string; name: string } | null; page: PageRef | null; line: string };
  /** What it shows beside what Balkaris shows, line by line. */
  beside: BesideRow[];
  /* Added for the web build. */
  /** Its pages read, by our clusters: what it targets in our terms (a page's cluster, else its title filed by the rule). */
  topics?: { cluster: { key: string; name: string }; pages: { url: string; title: string | null }[] }[];
  /** Other rows that could be the same company, to merge by hand. */
  mergeWith?: { key: string; name: string }[];
  /** Rows a person merged into this one, each to undo. */
  merged?: { key: string; name: string; by: string }[];
}
