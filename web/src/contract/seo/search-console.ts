/**
 * GET /api/v1/seo/search-console — an explorer over the desk's own Search
 * Console history (daily snapshots kept beyond Google's sixteen months) and,
 * for what the snapshots do not hold, live Search Console.
 *
 *   ?dimension=query     query | page | device | country | date | searchAppearance
 *   ?range=30d           or ?start=YYYY-MM-DD&end=YYYY-MM-DD (a window that runs past the last counted day is cut there)
 *   ?country=che         che | all (the snapshots keep these two); any other ISO code reads live
 *   ?device=MOBILE       DESKTOP | MOBILE | TABLET | all
 *   ?q=kosten -balkaris  the query contains every plain word and none of the words with a minus;
 *                        ?q="website kosten" (in double quotes) is that exact query
 *   ?page=/seo           one page
 *   ?pagepart=/insights/ pages whose address contains this (a section of the site)
 *   ?offsite=1           with dimension=page: only addresses the website no longer has as a page
 *   ?sort=impressions    clicks | impressions | ctr | position | key
 *   ?dir=desc
 *   ?offset=0&limit=50   at most 500; an offset past the end answers the last page
 *   ?source=snapshots    snapshots (default) | live
 *   ?ix=not-indexed      the URL Inspection table: all | not-indexed | indexed
 *   ?ixq=insights        its addresses containing this
 *   ?ixs=Crawled…        only this one of Google's states, in Google's words
 *   ?ixsort=queue        queue (default: what to request first) | address | crawl (crawled most recently first)
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
import type { EarlySignals, JobListed, Reading } from "../common";
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
   * beside what Google counted in THAT file (`file` is its path, so the count
   * is not printed beside a feed it has nothing to do with). Null before the
   * first check.
   */
  listed: { addresses: number; day: string; file: string } | null;
  /**
   * The desk's own last read of the website's sitemap (its job "sitemap",
   * every fifteen minutes): what the file answered, how many addresses it
   * lists and what is wrong with it as far as the desk checks. Google's API
   * gives an error COUNT and never the error, so this is the nearest thing to
   * "what is wrong" the desk can say itself. Null before the first read.
   */
  ownSitemap: { at: string; status: number; addresses: number; entriesAt: string | null; issues: string[] } | null;
  /** Where Google has every sitemap address: the newest result the desk holds for each. */
  inspection: Reading<InspectionTable>;
  /** What the inspection table was asked for (?ix=, ?ixq=, ?ixs=, ?ixsort=, ?ixo=), as answered. */
  inspectionAsked: InspectionQuery;
  /** The daily index check itself: its last run, whether it runs now, the day's allowance. Null when this desk has no such job. */
  inspectJob: InspectJob | null;
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
  /** The word that makes a query a brand query ("balkaris"), from the website's own address: what "Brand" and "Without brand" filter by. */
  brand: string;
  /** The first and last day a window can be chosen from: the desk's history. Null before the first snapshot. */
  days: { from: string; to: string } | null;
}

export interface ExplorerQuery {
  dimension: ExplorerDimension;
  /** The window that was answered. A window given by dates that ran past the last counted day ends there (see `window`). */
  start: string;
  end: string;
  /** The dates the address gave (?start=&end=), as given, when it gave valid ones; null for a window chosen by its period. */
  window: { start: string; end: string } | null;
  country: string;
  device: string;
  q: string;
  page: string | null;
  /** Pages whose address contains this, lower case (?pagepart=); null for none. */
  part: string | null;
  /**
   * The Pages list narrowed to addresses the website no longer has as a page
   * (?offsite=1): it redirects, answered 404 or 410, or the crawl knows no
   * page there. Only with dimension=page; the figures above stay the view's.
   */
  offsite: boolean;
  sort: "clicks" | "impressions" | "ctr" | "position" | "key";
  dir: "asc" | "desc";
  /** The offset that was answered: one past the end is brought back to the last page. */
  offset: number;
  limit: number;
  source: "snapshots" | "live";
}

export interface ExplorerResult {
  source: "snapshots" | "live";
  start: string;
  end: string;
  /**
   * The end that was asked for, when the window was cut: its last days are
   * ones nobody has counted yet (Google finishes a day two to three days
   * later), and an uncounted day is not a zero. Null when nothing was cut.
   */
  askedEnd: string | null;
  /** The window before, when the history covers it whole; else null and nothing is compared. */
  previous: { start: string; end: string } | null;
  totals: { clicks: number; impressions: number; ctr: Rate; position: number | null };
  /**
   * The window before, in the same figures. Null when it is not compared: the
   * history does not cover it, or the view is narrowed by query words and
   * Google reported none of those queries then, which says nothing because
   * rare queries are withheld (the note says which).
   */
  previousTotals: { clicks: number; impressions: number; ctr: Rate; position: number | null } | null;
  /** One row per day of the window, for the chart: the same days the totals add up. */
  days: { date: string; clicks: number; impressions: number; position: number | null }[];
  /** Rows in the list, before paging (after ?offsite= when it is set). */
  total: number;
  /** The offset these rows start at (see ExplorerQuery.offset). */
  offset: number;
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
  /**
   * For the Pages list: how many of its addresses the website no longer has as
   * a page (what ?offsite=1 keeps), counted before that filter. Null for
   * every other dimension, and before the desk's first crawl, when it cannot
   * be told.
   */
  offsite: number | null;
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
   * window before is not covered whole, the row is a day (a day has no
   * window before), or (for a query) Google reported no figure for it then,
   * which says nothing because rare queries are withheld.
   */
  previous: { clicks: number; impressions: number; position: number | null } | null;
  /** Shown fewer times than the early floor while the window is early. */
  early: boolean;
  /** Beside a query, the page Google showed most for it; beside a page, the query it was shown most for. From the desk's history; null when there is none. */
  top: string | null;
  /** For a page row: what the website itself has at the address. Absent for every other dimension, and before the first crawl. */
  site?: PageStanding;
}

/**
 * A page Google shows, set against the website as the desk's crawler last
 * read it: Google keeps showing addresses the site no longer has.
 */
export interface PageStanding {
  /**
   * listed      a page of the site, in its sitemap
   * not-listed  a page of the site that its sitemap does not list
   * redirects   the address redirects (`to` says where)
   * gone        the address answered 404 or 410 at the last crawl
   * unknown     the crawl knows no page at this address (an old address, or one nothing links to)
   */
  state: "listed" | "not-listed" | "redirects" | "gone" | "unknown";
  to: string | null;
  /** In Google's index at the newest URL Inspection the desk holds; null when the address was not inspected (only sitemap addresses are). */
  indexed: boolean | null;
}

/* ---------- URL Inspection ---------------------------------------------------------- */

export interface InspectionQuery {
  /** all | not-indexed | indexed (?ix=). */
  show: "all" | "not-indexed" | "indexed";
  /** The address contains this (?ixq=); empty for no search. */
  q: string;
  /** Only this one of Google's states, in Google's words (?ixs=); null for every state. */
  state: string | null;
  /** queue: not indexed first, what still waits for a request before what was requested; address: A to Z; crawl: crawled most recently first. */
  sort: "queue" | "address" | "crawl";
  /** The offset that was answered: one past the end is brought back to the last page. */
  offset: number;
  limit: number;
}

export interface InspectionTable {
  /** The day of the newest daily check (Zurich). */
  day: string;
  /** Addresses the sitemap listed that day; null for a day checked before this was kept. */
  of: number | null;
  /** Results that check wrote itself. Fewer than `of` when it was cut short (`dayComplete` false). */
  checked: number;
  dayComplete: boolean;
  /** Addresses shown as last checked on an earlier day, because the newest check did not reach them; each row says its day. */
  carried: number;
  /** The oldest day a carried result is from; null when none is carried. */
  carriedFrom: string | null;
  /** True when every sitemap address has a result here (the newest check's or a carried one): the counts are the site's. False: they are a part. */
  complete: boolean;
  /** Addresses with a result here, before any filter. */
  inspected: number;
  indexed: number;
  notIndexed: number;
  /** Addresses where Google chose another canonical than the page declares. */
  canonicalDiffers: number;
  /** Google's coverage words, how many addresses carry them, not indexed first. */
  states: { state: string; indexed: boolean; count: number; meaning: string }[];
  /** Rows matching the question, before paging. */
  total: number;
  rows: InspectionRow[];
}

export interface InspectionRow {
  url: string;
  path: string;
  /** The day (Zurich) Google was asked about this address: the newest check's, or an earlier day's for a carried row. */
  day: string;
  /** False for an address the sitemap does not list (one a person asked Google about by hand). */
  listed: boolean;
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
  /** Google's word for what robots.txt says of the address (ALLOWED, DISALLOWED), or null. */
  robots: string | null;
  /** Google's word for how its last fetch went (SUCCESSFUL, SOFT_404, NOT_FOUND…), or null. */
  fetchState: string | null;
  /** This result in Search Console itself, where a person presses "Request indexing". */
  link: string | null;
  /**
   * The address in the desk's "Request indexing" queue (a not-indexed
   * opportunity): open, or marked as requested by a person. A mark a person
   * set is theirs and is shown whether or not the opportunity engine lists
   * the address at the moment. Null when the engine has never listed it.
   */
  queue: { state: "open" | "requested" | "other"; by: string | null; at: string | null } | null;
}

/** The daily index check (job gsc-inspect) as this page shows it. */
export interface InspectJob {
  /** The scheduler's record of the job, its notes scrubbed. */
  job: JobListed;
  /** Inspections asked of Google today against the desk's own daily cap (Google allows 2,000 a day per property; its day is Pacific Time). */
  allowance: { used: number; of: number };
  /** When a check that failed is tried again by itself, ISO; null when none is planned. */
  retryAt: string | null;
}
