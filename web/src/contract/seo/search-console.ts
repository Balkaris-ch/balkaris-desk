/**
 * GET /api/v1/seo/search-console — an explorer over the desk's own Search
 * Console history (daily snapshots kept beyond Google's sixteen months) and,
 * for what the snapshots do not hold, live Search Console.
 *
 *   ?dimension=query     query | page | device | country | date | searchAppearance
 *   ?range=30d           or ?start=YYYY-MM-DD&end=YYYY-MM-DD
 *   ?country=che         che | all (the snapshots keep these two); any other ISO code reads live
 *   ?device=MOBILE       DESKTOP | MOBILE | TABLET | all
 *   ?q=kosten            the query contains these words
 *   ?page=/seo           one page
 *   ?sort=impressions    clicks | impressions | ctr | position | key
 *   ?dir=desc
 *   ?offset=0&limit=50   at most 500
 *   ?source=snapshots    snapshots (default) | live
 *   ?ix=not-indexed      the URL Inspection table: all | not-indexed | indexed
 *   ?ixo=0               its offset (fifteen rows a page)
 *
 * country and searchAppearance as a dimension, or another country, are read
 * live from Search Console (kept six hours); `source` says which it was.
 *
 * GET /api/v1/seo/search-console/export.csv takes the same explorer
 * parameters (no offset or limit) and answers every row as CSV.
 *
 * Types only.
 */
import type { EarlySignals, Reading } from "../common";
import type { Rate, SeoHead } from "./common";

export type ExplorerDimension = "query" | "page" | "device" | "country" | "date" | "searchAppearance";

export interface SeoSearchConsolePayload {
  head: SeoHead;
  asked: ExplorerQuery;
  result: Reading<ExplorerResult>;
  /** The sitemaps Search Console knows for the property, and what it made of each. */
  sitemaps: Reading<SitemapRow[]>;
  /** What the desk's history holds: first and last day, rows, days snapshotted. */
  history: Reading<{ from: string; to: string; days: number; rows: number; lastSnapshot: string | null }>;
  /** Search Console's own performance report for the property, or null. */
  href: string | null;
  /** What the filters offer: the pages and countries Google showed the site for in the window. */
  options: ExplorerOptions;
  /**
   * The desk's own count of the addresses the website's sitemap lists, from
   * its last daily index check (cc_series gsc.sitemap_addresses), to set
   * beside what Google counted in it. Null before the first check.
   */
  listed: { addresses: number; day: string } | null;
  /** Google's URL Inspection of every sitemap address, the newest daily check. */
  inspection: Reading<InspectionTable>;
  /** What the inspection table was asked for (?ix=, ?ixo=). */
  inspectionAsked: InspectionQuery;
  /** Search Console's sitemaps report for the property, or null. */
  sitemapsHref: string | null;
}

export interface SitemapRow {
  path: string;
  lastSubmitted: string | null;
  lastDownloaded: string | null;
  isPending: boolean;
  warnings: number;
  errors: number;
  submitted: number;
  /** An index of other sitemaps rather than a list of pages. */
  isIndex?: boolean;
  /** Google's word for the file ("sitemap", "rssFeed"…), when it gave one. */
  type?: string | null;
}

export interface ExplorerOptions {
  /** Paths Google showed in the window (the desk's history), most impressions first. Empty when there is no history. */
  pages: { path: string; impressions: number }[];
  /**
   * The countries the filter offers: every country ("all") and Switzerland
   * ("che") from the desk's snapshots, then the countries Google reported for
   * the window (read live, kept), which are answered live.
   */
  countries: { key: string; label: string; impressions: number | null; live: boolean }[];
}

export interface ExplorerQuery {
  dimension: ExplorerDimension;
  start: string;
  end: string;
  country: string;
  device: string;
  q: string;
  page: string | null;
  sort: "clicks" | "impressions" | "ctr" | "position" | "key";
  dir: "asc" | "desc";
  offset: number;
  limit: number;
  source: "snapshots" | "live";
}

export interface ExplorerResult {
  source: "snapshots" | "live";
  start: string;
  end: string;
  /** The window before, when the history covers it whole; else null and nothing is compared. */
  previous: { start: string; end: string } | null;
  totals: { clicks: number; impressions: number; ctr: Rate; position: number | null };
  previousTotals: { clicks: number; impressions: number; ctr: Rate; position: number | null } | null;
  /** One row per day of the window, for the chart. */
  days: { date: string; clicks: number; impressions: number; position: number | null }[];
  total: number;
  rows: ExplorerRow[];
  /** False when Google's row limit cut a live answer short. */
  complete: boolean;
  /** The caveats that belong to these numbers, in one line (rare queries withheld, final days only…). */
  note: string;
  /**
   * Early signals (the rule is EARLY in src/cc/search/gsc.ts): the window holds
   * too little for a position or a rate to settle. Rows under `early.standard`
   * impressions carry `early`. Null when the window is past that.
   */
  early: EarlySignals | null;
  /** What the "top" column holds for this dimension: "Top page" beside a query, "Top query" beside a page; null for none. */
  topLabel: string | null;
}

export interface ExplorerRow {
  key: string;
  /** What the row shows: the path for a page, "Mobile" for a device, the country's name. */
  label: string;
  clicks: number;
  impressions: number;
  ctr: Rate;
  position: number | null;
  /**
   * The same row in the window before. Null when it is not compared: the
   * window before is not covered whole, or (for a query) Google reported no
   * figure for it then, which says nothing because rare queries are withheld.
   */
  previous: { clicks: number; impressions: number; position: number | null } | null;
  /** Shown fewer times than the early floor while the window is early. */
  early: boolean;
  /** Beside a query, the page Google showed most for it; beside a page, the query it was shown most for. From the desk's history; null when there is none. */
  top: string | null;
}

/* ---------- URL Inspection ---------------------------------------------------------- */

export interface InspectionQuery {
  /** all | not-indexed | indexed (?ix=). */
  show: "all" | "not-indexed" | "indexed";
  offset: number;
  limit: number;
}

export interface InspectionTable {
  /** The day of the check (Zurich). */
  day: string;
  /** Addresses the sitemap listed that day; null for a day checked before this was kept. */
  of: number | null;
  /** False when the day's check was cut short: the counts are part of the site, not its total. */
  complete: boolean;
  inspected: number;
  indexed: number;
  notIndexed: number;
  /** Addresses where Google chose another canonical than the page declares. */
  canonicalDiffers: number;
  /** Google's coverage words, how many addresses carry them, not indexed first. */
  states: { state: string; indexed: boolean; count: number; meaning: string }[];
  /** Rows matching `show`, before paging. */
  total: number;
  rows: InspectionRow[];
}

export interface InspectionRow {
  url: string;
  path: string;
  indexed: boolean;
  /** PASS, NEUTRAL, FAIL, or null. */
  verdict: string | null;
  /** Google's own words: "Submitted and indexed", "Crawled - currently not indexed"… */
  coverage: string | null;
  /** What Google means by it, and what fixes it (src/cc/seo/indexation.ts). */
  meaning: string;
  fix: string;
  lastCrawl: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  canonicalOk: boolean | null;
  robots: string | null;
  fetchState: string | null;
  /** This result in Search Console itself, where a person presses "Request indexing". */
  link: string | null;
  /**
   * The address in the desk's "Request indexing" queue (a not-indexed
   * opportunity): open, or marked as requested by a person. Null when it is
   * not in the queue.
   */
  queue: { state: "open" | "requested" | "other"; by: string | null; at: string | null } | null;
}
