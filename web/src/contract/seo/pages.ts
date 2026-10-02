/**
 * GET /api/v1/seo/pages — every page the desk knows, with its search figures,
 * index state, score, issues, AI readiness and open opportunities.
 *
 *   ?range=30d
 *   ?type=service        the crawl's kind (service, segment, article, hub…), or "all"
 *   ?status=indexed      indexed | not-indexed | issues | all
 *   ?score=90-100        90-100 | 70-89 | 50-69 | 0-49 | all
 *   ?traffic=high        high (100+ impressions) | medium (10–99) | low (1–9) | none | all
 *   ?q=law               words in the address or title
 *   ?sort=impressions    impressions (default) | clicks | position | score | issues | opportunities | path | updated
 *   ?dir=desc            asc | desc
 *   ?offset=0&limit=50   at most 200
 *   ?open=/law-firms     the page the right-hand summary shows (else the list's first row)
 *
 * GET /api/v1/seo/pages/export.csv takes the same filters (no offset or
 * limit: every matching row) and answers the table as CSV.
 *
 * Types only.
 */
import type { Reading, Stat } from "../common";
import type { NewTask, ProposalState } from "../operator";
import type { ReadinessCheck } from "./ai-search";
import type { PageRef, Potential, Priority, Rate, RateStat, SeoHead } from "./common";
import type { Serp } from "./opportunities";

export interface SeoPagesPayload {
  head: SeoHead;
  tiles: PagesTiles;
  facets: PageFacets;
  list: Reading<{ total: number; offset: number; limit: number; rows: SeoPageRow[] }>;
  /** The question the list answers, as the server read it: a value it did not know is replaced by its default. */
  query: PagesQuery;
  /**
   * Where the search columns (clicks, impressions, CTR, position) come from:
   * the desk's own daily copy of Search Console when it has one, or Search
   * Console asked directly (kept six hours) while it has none yet.
   */
  search: Reading<SearchBasis>;
  /** Addresses Search Console counted in the window that the crawl does not read (old or other-host addresses). */
  elsewhere: Reading<{ addresses: number; clicks: number; impressions: number; top: { path: string; clicks: number; impressions: number }[] }>;
  /** The page the right-hand summary shows: `?open=`, else the list's first row. Null when the list is empty or absent. */
  selected: Reading<SeoPageSummary> | null;
}

export type PagesSort = "impressions" | "clicks" | "ctr" | "position" | "score" | "issues" | "opportunities" | "path" | "updated";

export interface PagesQuery {
  type: string;
  status: "all" | "indexed" | "not-indexed" | "issues";
  score: "all" | "90-100" | "70-89" | "50-69" | "0-49";
  traffic: "all" | "high" | "medium" | "low" | "none";
  q: string;
  sort: PagesSort;
  dir: "asc" | "desc";
  offset: number;
  limit: number;
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
  /**
   * Clicks and impressions Google counted for the site in the window without
   * naming a page: the property's totals (the tiles) less every page row (the
   * list's and `elsewhere`'s). They are in no row of the list. Null when
   * nothing is left over, or when the page rows were cut short.
   */
  unnamed: { clicks: number; impressions: number } | null;
}

export interface PagesTiles {
  /** Every page the crawl reads (`sub` says how many are in the sitemap); `previous` from the crawl's own daily count, when it reaches back that far. */
  pages: Reading<Stat>;
  /** Of those, indexed by Google at the last daily URL Inspection (`of` is the sitemap's count). */
  indexed: Reading<Stat>;
  /** Pages with at least one critical or warning finding of the crawl. */
  withIssues: Reading<Stat>;
  /** Organic clicks: Search Console's totals for the site (more than the list's rows add up to: see `SearchBasis.unnamed`). */
  clicks: Reading<Stat>;
  position: Reading<Stat>;
  ctr: Reading<RateStat>;
}

export interface PageFacets {
  types: { key: string; label: string; count: number }[];
  status: { key: "indexed" | "not-indexed" | "issues"; label: string; count: number }[];
  score: { key: string; label: string; count: number }[];
  traffic: { key: "high" | "medium" | "low" | "none"; label: string; count: number }[];
}

export interface SeoPageRow {
  page: PageRef;
  /** The address on the live site. */
  url: string;
  status: number;
  inSitemap: boolean;
  /** Google's word at the last URL Inspection, and whether that is "indexed". Null before the first check or for a page not in the sitemap. */
  index: { indexed: boolean; coverage: string | null; day: string } | null;
  clicks: number;
  impressions: number;
  ctr: Rate;
  /** Average position over the window; null without impressions. */
  position: number | null;
  /** The crawl's score out of 100 by its stated rules; null for a page it does not score. */
  score: number | null;
  issues: { critical: number; warning: number; opportunity: number };
  /** Open opportunities for this page. */
  opportunities: number;
  /** AI-readiness checks the page passes, of those that apply to it; null before the first readiness check. */
  readiness: { pass: number; of: number } | null;
  words: number | null;
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
  /** Google's stored state of the address at the last daily URL Inspection. */
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
  /** The AI-readiness check of this page (src/cc/seo/readiness.ts). */
  readiness: Reading<{ checkedAt: string; pass: number; of: number; checks: ReadinessCheck[] }>;
  /** Open opportunities the engine found for this page. */
  opportunities: Reading<{ open: number; rows: { id: string; title: string; typeLabel: string; priority: Priority; potential: Potential | null }[] }>;
  /** Title, description and redirect proposals for this address that are waiting, approved or applied. */
  proposals: { id: number; kind: "meta" | "redirect"; state: ProposalState; href: string }[];
}

export interface SummaryIndex {
  day: string;
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
