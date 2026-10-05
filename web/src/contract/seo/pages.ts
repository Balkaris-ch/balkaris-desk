/**
 * GET /api/v1/seo/pages — every page the desk knows, with its search figures,
 * index state, score, issues, AI readiness and open opportunities.
 *
 *   ?range=30d
 *   ?type=service        the crawl's kind (service, segment, article, hub…), or "all"
 *   ?status=indexed      indexed | not-indexed | not-inspected | issues | all
 *   ?score=90-100        90-100 | 70-89 | 50-69 | 0-49 | all
 *   ?traffic=high        high (100+ impressions) | medium (10–99) | low (1–9) | none | all
 *   ?sitemap=in          in | out | all: listed in the sitemap, or kept out of it
 *   ?links=none          none (no page links here) | menus (linked from menus and footers only) | all
 *   ?finding=title.long  one rule of the crawl that fired on the page (src/cc/site/rules.ts), or "all"
 *   ?proposal=waiting    pages with a title, description or redirect proposal waiting for approval
 *   ?lang=de             the page's html lang, or "all"
 *   ?moved=up            up | down | all: more or fewer impressions than in the window before (only when the two are compared)
 *   ?country=che         all | che: the search figures of every country, or of Switzerland alone
 *   ?device=mobile       all | mobile | desktop | tablet
 *   ?q=law               words in the address, title, description, main heading or a search the page is shown for; or a pasted address
 *   ?sort=impressions    impressions (default) | clicks | ctr | position | score | issues | opportunities | path | updated | words | links | change | sessions
 *   ?dir=desc            asc | desc
 *   ?offset=0&limit=50   at most 200
 *   ?cols=words,updated  the optional columns the table shows beside its own (PagesColumn), in any order
 *   ?open=/law-firms     the page the right-hand summary shows (else the list's first row). An address
 *                        on the site that the crawl does not read is looked up on the live site instead
 *                        (`lookup`).
 *
 * GET /api/v1/seo/pages/export.csv takes the same filters (no offset or
 * limit: every matching row) and answers the table as CSV.
 *
 * GET /api/v1/seo/pages/lookup?url=<path or full address>&range= answers one
 * address of the website as it is now (PageLookup): what it answers on the
 * live site, what Google holds for it and what it earned in search, whether
 * the crawl reads it or not.
 *
 * Types only.
 */
import type { Reading, Stat } from "../common";
import type { NewTask, ProposalKind, ProposalState } from "../operator";
import type { ReadinessCheck } from "./ai-search";
import type { PageRef, Potential, Priority, Rate, RateStat, SeoHead } from "./common";
import type { Serp } from "./opportunities";

export interface SeoPagesPayload {
  head: SeoHead;
  tiles: PagesTiles;
  facets: PageFacets;
  list: Reading<{
    total: number;
    offset: number;
    limit: number;
    rows: SeoPageRow[];
    /** Where the words of ?q= were looked for, as one phrase ("the address, title, description, main heading and the searches Google showed each page for"). Null without a search. */
    searchedIn: string | null;
  }>;
  /** The question the list answers, as the server read it: a value it did not know is replaced by its default. */
  query: PagesQuery;
  /**
   * Where the search columns (clicks, impressions, CTR, position) come from:
   * the desk's own daily copy of Search Console when it has one, or Search
   * Console asked directly (kept six hours) while it has none yet.
   */
  search: Reading<SearchBasis>;
  /** Which daily index checks the Index column is read from. */
  index: Reading<IndexBasis>;
  /** GA4's sessions from organic search by landing page, behind the optional "Organic sessions" column. Consenting visitors only. */
  organic: Reading<{ start: string; end: string; pages: number; sessions: number }>;
  /** Addresses Search Console counted in the window that the crawl does not read (old or other-host addresses). */
  elsewhere: Reading<{ addresses: number; clicks: number; impressions: number; top: { path: string; clicks: number; impressions: number }[] }>;
  /** The page the right-hand summary shows: `?open=`, else the list's first row. Null when the list is empty or absent, or when `lookup` is shown instead. */
  selected: Reading<SeoPageSummary> | null;
  /**
   * An address of the website that the crawl does not read, looked up on the
   * live site: `?open=` naming one, or a full address typed into the search
   * that matches no row. Null otherwise.
   */
  lookup: Reading<PageLookup> | null;
}

export type PagesSort = "impressions" | "clicks" | "ctr" | "position" | "score" | "issues" | "opportunities" | "path" | "updated" | "words" | "links" | "change" | "sessions";

/** The columns the table can show beside its own (Page, Type, Clicks, Impr., CTR, Pos., Index, Score, Issues). */
export type PagesColumn = "title" | "status" | "change" | "sessions" | "opportunities" | "readiness" | "words" | "links" | "updated";

export interface PagesQuery {
  type: string;
  status: "all" | "indexed" | "not-indexed" | "not-inspected" | "issues";
  score: "all" | "90-100" | "70-89" | "50-69" | "0-49";
  traffic: "all" | "high" | "medium" | "low" | "none";
  sitemap: "all" | "in" | "out";
  links: "all" | "none" | "menus";
  /** A rule id of the crawl ("title.long"), or "all". */
  finding: string;
  proposal: "all" | "waiting";
  lang: string;
  moved: "all" | "up" | "down";
  country: "all" | "che";
  device: "all" | "mobile" | "desktop" | "tablet";
  q: string;
  sort: PagesSort;
  dir: "asc" | "desc";
  offset: number;
  limit: number;
  cols: PagesColumn[];
  /** The address asked for with ?open=, when one was. */
  open: string | null;
}

export interface SearchBasis {
  /** "history": the desk's own snapshots (src/cc/seo/rank.ts). "live": Search Console's API, asked for this window. */
  by: "history" | "live";
  start: string;
  end: string;
  days: number;
  /** True when the window before is covered whole and the tiles are compared with it (see `uncompared`). */
  compared: boolean;
  /** The first day Google reported any page of the site, in the desk's history. Null when it has reported none yet, or when the figures are asked live. */
  pagesFrom: string | null;
  /**
   * Set when the tiles are NOT compared with the window before although
   * Search Console has figures for it, because Google named no page of the
   * site in all of it. The list is by page; a site total from days without a
   * single page set beside it would compare the property before its pages
   * were counted with the site after, unlabelled.
   *   before-pages          the window before ends before `pagesFrom`
   *   starts-before-pages   it starts before `pagesFrom`
   *   no-pages              Google named no page in it (live), or none yet at all
   */
  uncompared: { why: "before-pages" | "starts-before-pages" | "no-pages"; start: string; end: string } | null;
  /** The window before, when the rows carry its figures (`SeoPageRow.previous`); null when they do not. */
  previous: { start: string; end: string } | null;
  /**
   * Clicks and impressions Google counted for the site in the window without
   * naming a page: the property's totals (the tiles) less every page row (the
   * list's and `elsewhere`'s). They are in no row of the list. Null when
   * nothing is left over, or when the page rows were cut short.
   */
  unnamed: { clicks: number; impressions: number } | null;
  /** The part of search the figures are of. Country and device splits exist in the desk's own history only: asked live, both are "all". */
  country: "all" | "che";
  device: "all" | "mobile" | "desktop" | "tablet";
}

/**
 * The daily URL Inspection the Index column is read from. Each address shows
 * its NEWEST answer of the last `days` daily checks, with its own day, so a
 * check that was cut short does not blank the pages it did not reach.
 */
export interface IndexBasis {
  /** The newest day any address was checked, and the oldest day an answer shown is from. */
  newest: string;
  oldest: string;
  /** How many daily checks back an answer may come from. */
  days: number;
  /** False when the newest check was cut short. */
  complete: boolean;
  /** Addresses with an answer on the newest day, and how many the sitemap listed that day (null when not kept). */
  onNewest: number;
  of: number | null;
  /** Addresses whose answer is from an earlier check of the window. */
  carried: number;
}

export interface PagesTiles {
  /** Every page the crawl reads (`sub` says how many are in the sitemap); `previous` from the crawl's own daily count, when it reaches back that far. */
  pages: Reading<Stat>;
  /** Of the sitemap's pages, those whose newest URL Inspection answer says indexed (`of` is the sitemap's count). */
  indexed: Reading<Stat>;
  /** Pages with at least one critical or warning finding of the crawl. */
  withIssues: Reading<Stat>;
  /** Organic clicks: Search Console's totals for the site (more than the list's rows add up to: see `SearchBasis.unnamed`). */
  clicks: Reading<Stat>;
  position: Reading<Stat>;
  /**
   * The position tile's line: one point per day of the window, oldest first,
   * null on a day without impressions (there is no position to average).
   * `position.series` is left empty whenever a day has none, because a series
   * that skipped it would put every later point on the wrong date: draw this.
   */
  positionDays: (number | null)[];
  ctr: Reading<RateStat>;
}

export interface Facet<K extends string = string> {
  key: K;
  label: string;
  /** Pages the option would list, with every OTHER group's choice kept. */
  count: number;
}

export interface PageFacets {
  /** Each group's "All" count: the pages the other groups' choices leave. */
  all: { type: number; status: number; score: number; traffic: number; sitemap: number; links: number; finding: number; proposal: number; lang: number; moved: number };
  types: Facet[];
  status: Facet<"indexed" | "not-indexed" | "not-inspected" | "issues">[];
  score: Facet[];
  /** Empty when Search Console is not available. */
  traffic: Facet<"high" | "medium" | "low" | "none">[];
  sitemap: Facet<"in" | "out">[];
  links: Facet<"none" | "menus">[];
  /** The crawl's rules that fired on at least one page, worst first. */
  findings: (Facet & { severity: CrawlSeverity })[];
  proposal: Facet<"waiting">[];
  /** Empty when every page is in one language. */
  langs: Facet[];
  /** Empty when the window before is not compared. */
  moved: Facet<"up" | "down">[];
}

export interface SeoPageRow {
  page: PageRef;
  /** The address on the live site. */
  url: string;
  status: number;
  inSitemap: boolean;
  /** The page's full title and description as the crawl read them. */
  title: string | null;
  description: string | null;
  /** The page's main heading (its first <h1>). */
  heading: string | null;
  /** Google's word at the address's newest URL Inspection of the last daily checks, and whether that is "indexed". Null when none of them asked about it (a page kept out of the sitemap, or one no check has reached). */
  index: { indexed: boolean; coverage: string | null; day: string } | null;
  /** Search Console's figures for the window. Null when Search Console is not available: then nothing is known, which is not a zero. */
  clicks: number | null;
  impressions: number | null;
  ctr: Rate;
  /** Average position over the window; null without impressions. */
  position: number | null;
  /** The same figures in the window before; null when the two windows are not compared (`SearchBasis.previous`). */
  previous: { clicks: number; impressions: number; position: number | null } | null;
  /** Sessions that began on this page from organic search, as GA4 counts them (consenting visitors only); null when GA4 is not available. */
  organic: { sessions: number; engaged: number } | null;
  /** The crawl's score out of 100 by its stated rules; null for a page it does not score. */
  score: number | null;
  issues: { critical: number; warning: number; opportunity: number };
  /** The crawl's rules that fired on the page, once each. */
  rules: string[];
  /** Open opportunities for this page. */
  opportunities: number;
  /** Title, description or redirect proposals for this address waiting for approval. */
  proposalsWaiting: number;
  /** AI-readiness checks the page passes, of those that apply to it; null before the first readiness check. */
  readiness: { pass: number; of: number } | null;
  words: number | null;
  /** Other pages linking here: from anywhere on them, and from their own content only. */
  inlinks: number;
  inlinksFromContent: number;
  /** When the desk last saw the page's content change, or the sitemap's own date; null when neither is known. */
  updated: string | null;
}

/* ---------- the right-hand summary and the row under the table -------------------------- */

export type CrawlSeverity = "critical" | "warning" | "opportunity";

/**
 * One page, for the side panel and the four panels under the table. Each part
 * is its own reading, so a source that is missing costs that part only.
 */
export interface SeoPageSummary {
  row: SeoPageRow;
  /** The crawl's score: 100 less the cost of each rule that fired, once per rule (src/cc/site/rules.ts). The desk's own score, not Google's. */
  score: { value: number | null; unscored: string | null; lines: { rule: string; title: string; severity: CrawlSeverity; cost: number }[] };
  /** Google's stored state of the address at its newest daily URL Inspection. */
  index: Reading<SummaryIndex>;
  /** Google's index state first when the page is not indexed, then the crawl's findings, worst first. */
  issues: Reading<SummaryIssue[]>;
  /** The side panel's quick actions: each queues a real operator task or opens a real page, or says why it cannot. */
  actions: QuickAction[];
  /** Clicks, impressions and position per day for this address. */
  performance: Reading<{ start: string; end: string; days: { date: string; clicks: number; impressions: number; position: number | null }[] }>;
  /** The searches Google showed this page for in the window, most impressions first. */
  keywords: Reading<{ rows: PageKeyword[]; total: number }>;
  /** The content checklist, read from the crawl (and the AI-readiness check when it has read the page). */
  content: Reading<ContentCheck[]>;
  /** What a search result would show, from the page's own tags as the crawl read them. */
  serp: Reading<SerpPreview>;
  links: Reading<PageLinks>;
  technical: Reading<PageTechnical>;
  /** The newest PageSpeed lab run of this address, when it is on the speed test's list. */
  speed: Reading<PageSpeed>;
  /** The AI-readiness check of this page (src/cc/seo/readiness.ts). */
  readiness: Reading<{ checkedAt: string; pass: number; of: number; checks: ReadinessCheck[] }>;
  /** Open opportunities the engine found for this page. */
  opportunities: Reading<{ open: number; rows: { id: string; title: string; typeLabel: string; priority: Priority; potential: Potential | null }[] }>;
  /** Proposals of every kind (title, share card, index, canonical, structured data, redirect) for this address that are waiting, approved or applied. */
  proposals: { id: number; kind: ProposalKind; state: ProposalState; href: string }[];
}

export interface SummaryIndex {
  /** The day of the check this answer is from, and the newest day any address was checked (later, when the newest check did not reach this address). */
  day: string;
  newest: string;
  indexed: boolean;
  /** Google's own words: "Submitted and indexed", "Excluded by 'noindex' tag"… */
  coverage: string | null;
  lastCrawl: string | null;
  /** What Google means by that state, and what fixes it, in plain words (src/cc/seo/indexation.ts). */
  meaning: string;
  fix: string;
  /** The inspection in Search Console itself. */
  link: string | null;
  /** The live page says index (the crawl), when known: a "noindex" Google saw may be stale. */
  liveSaysIndex: boolean | null;
  /** The canonical Google chose and the one the page declared when Google read it; `canonicalOk` false when they differ, null when Google chose none. */
  googleCanonical: string | null;
  userCanonical: string | null;
  canonicalOk: boolean | null;
  /** Google's words for robots.txt ("ALLOWED"), for its fetch ("SUCCESSFUL") and for the page's own indexing directive ("INDEXING_ALLOWED"). */
  robots: string | null;
  fetchState: string | null;
  indexing: string | null;
}

export interface SummaryIssue {
  key: string;
  title: string;
  /** The sentence with the measured value and the limit. */
  detail: string;
  /** Google's index state: high when the page is not indexed. The crawl: critical is high, warning medium, opportunity low. */
  level: Priority;
  from: "gsc" | "crawl";
  action: IssueAction | null;
}

export type IssueAction =
  /* Queues an operator task (POST /api/v1/operator/tasks): what it proposes waits in the approval queue. */
  | { kind: "task"; label: string; task: NewTask }
  | { kind: "link"; label: string; href: string };

export interface QuickAction {
  key: "metadata" | "content" | "links" | "schema" | "optimize" | "inspect";
  label: string;
  /** What happens when it is pressed, in one sentence. */
  step: string;
  /** The operator task it queues, or null for a link. */
  task: NewTask | null;
  href: string | null;
  available: boolean;
  why: string | null;
}

export interface PageKeyword {
  query: string;
  clicks: number;
  impressions: number;
  ctr: Rate;
  position: number;
}

export interface ContentCheck {
  key: "h1" | "length" | "terms" | "images" | "links" | "faq" | "schema" | "meta";
  label: string;
  /** What was read: "842 words", "1 heading". */
  value: string;
  state: "good" | "work" | "missing" | "unknown";
  /** The chip: "Good", "Short", "Needs work", "Missing". */
  verdict: string;
  /** The yardstick or source behind the verdict, in one sentence. */
  rule: string;
}

export interface SerpPreview extends Serp {
  /** The share picture, which Google may show beside a result (it chooses). */
  picture: string | null;
  /** The host as the crawl fetched the page ("www.example.ch"): a result prints the real host. */
  host: string;
  /** The path's parts, as a result prints the address: "https://www.example.ch › law-firms". */
  crumbs: string[];
}

export interface PageLinks {
  /** Other pages linking here, from anywhere on them, and from their own content only. */
  in: number;
  inFromContent: number;
  out: number | null;
  /** The pages that link here from their content first, at most twelve. */
  from: { source: string; text: string; place: "main" | "chrome" }[];
}

export interface PageTechnical {
  crawledAt: string;
  status: number;
  ttfbMs: number | null;
  totalMs: number | null;
  bytes: number | null;
  cache: string | null;
  robots: string | null;
  robotsHeader: string | null;
  canonical: string | null;
  /** True when the canonical is this page's own address; null without one. */
  canonicalSelf: boolean | null;
  lang: string | null;
  h1: string[];
  h2: number;
  words: number | null;
  schemaTypes: string[];
}

/** One PageSpeed lab run of the page per kind of device: Lighthouse on Google's machines, not real visitors. */
export interface PageSpeed {
  runs: {
    strategy: "mobile" | "desktop";
    at: string;
    /** Lighthouse's performance score, 0 to 100; null when the run failed. */
    performance: number | null;
    lcpMs: number | null;
    cls: number | null;
    tbtMs: number | null;
    /** Why the run failed, when it did. */
    failure: string | null;
  }[];
}

/* ---------- one address looked up on the live site ------------------------------------------ */

/**
 * One address of the website as it is NOW, whether the crawl reads it or not:
 * a new page not yet in the sitemap, an old address Google still counts, a
 * spelling with a query string. Each part is its own reading.
 */
export interface PageLookup {
  /** The address as the desk stores it ("/old-page") and on the live site. */
  path: string;
  url: string;
  /** True when the crawl reads this address: its summary is then the fuller view. */
  known: boolean;
  /** Whether the sitemap, as the desk last read it, lists the address; null before the first read. */
  inSitemap: boolean | null;
  /** One GET by the desk's server now (kept two minutes), following redirects by hand. */
  live: Reading<LookupLive>;
  /** Google's stored state, when a daily index check asked about the address. */
  index: Reading<SummaryIndex>;
  /** What Search Console counted for exactly this address in the window, and the searches it was shown for. */
  search: Reading<{ start: string; end: string; clicks: number; impressions: number; ctr: Rate; position: number | null; keywords: PageKeyword[]; total: number }>;
  /** A redirect from this address that is waiting, approved or applied, when there is one. */
  redirect: { id: number; to: string | null; state: ProposalState; href: string } | null;
  /** Whether a redirect from this address may be proposed, as the desk's own rules see it; `why` says why not. */
  mayRedirect: { ok: boolean; why: string | null };
}

export interface LookupLive {
  /** The final status; 0 when nothing answered (`error` says why). */
  status: number;
  /** The address that finally answered, and each redirect on the way. */
  finalUrl: string;
  /** The stored path of `finalUrl` when it is on the site and differs from the address asked; null otherwise. */
  landsOn: string | null;
  hops: { url: string; status: number; location: string | null }[];
  ttfbMs: number;
  bytes: number;
  error: string | null;
  /** Read from the HTML when the address answered 200 with a page; null otherwise. */
  page: {
    title: string | null;
    description: string | null;
    canonical: string | null;
    /** True when the canonical is this address itself. */
    canonicalSelf: boolean | null;
    robots: string | null;
    robotsHeader: string | null;
    /** Answers 200 and says no noindex, by tag or header. */
    indexable: boolean;
    lang: string | null;
    h1: string[];
    words: number;
    schemaTypes: string[];
    hreflang: { lang: string; href: string }[];
  } | null;
}
