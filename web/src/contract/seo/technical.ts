/**
 * GET /api/v1/seo/technical — the crawl's findings, the indexation driver,
 * and the site-wide checks search engines and AI crawlers depend on.
 *
 * Changes (a signed-in person):
 *   POST /api/v1/seo/indexing/requested   { path, submitted: boolean }   mark a page as submitted
 *        in Search Console's URL Inspection (by hand, in the owner's browser) → OpportunityAnswer
 *
 * Types only.
 */
import type { Reading, Stat } from "../common";
import type { OpportunityRow, SeoHead } from "./common";

export interface SeoTechnicalPayload {
  head: SeoHead;
  /** The crawl's site score out of 100, with its daily history. */
  score: Reading<Stat>;
  crawl: Reading<{ finished: string; pages: number; inSitemap: number; critical: number; warning: number; opportunity: number }>;
  /** The crawl's findings by rule, worst first. */
  issues: Reading<{ rows: IssueGroup[] }>;
  indexation: Reading<Indexation>;
  /** Every sitemap address with a real lastmod, or the code task when it has none. */
  sitemap: Reading<SitemapCheck>;
  /** Whether robots.txt lets each named crawler read the site, as the live file says. */
  robots: Reading<{ status: number; agents: { agent: string; family: string; allowed: boolean }[] }>;
  /** /llms.txt on the live site. */
  llms: Reading<{ status: number; present: boolean; line: string }>;
  /** PageSpeed lab runs (one Lighthouse load each, not visitors), slowest first. */
  speed: Reading<{ rows: { path: string; lcpMs: number | null; cls: number | null; tbtMs: number | null; at: string }[] }>;
  /** The technical opportunities (crawl findings, site checks) as the engine lists them. */
  opportunities: OpportunityRow[];
}

export interface IssueGroup {
  rule: string;
  title: string;
  severity: "critical" | "warning" | "opportunity";
  /** Points it costs a page (or the site) in the crawl's score. */
  cost: number;
  count: number;
  pages: string[];
}

/** The indexation driver: Google's stored state for every sitemap address, by state. */
export interface Indexation {
  day: string;
  inspected: number;
  of: number | null;
  indexed: number;
  /** One group per coverage state Google reports, with Google's meaning and the fix. */
  groups: CoverageGroup[];
  /** Indexed and not indexed per day, from the desk's daily checks. */
  history: { day: string; indexed: number; notIndexed: number }[];
  /** "Request indexing": pages the lead submits by hand in Search Console, ~10 a day (Google publishes no quota). */
  queue: IndexRequest[];
}

export interface CoverageGroup {
  /** Google's own words: "Crawled - currently not indexed". */
  state: string;
  indexed: boolean;
  /** What Google means by it, in plain words. */
  meaning: string;
  /** What fixes it. */
  fix: string;
  pages: { path: string; lastCrawl: string | null; robots: string | null; indexing: string | null; livePageSaysIndex: boolean | null; link: string | null }[];
}

export interface IndexRequest {
  path: string;
  /** Google's state when it was queued. */
  coverage: string | null;
  priority: "high" | "medium" | "low";
  /** The opportunity behind it (type not-indexed). */
  opportunityId: string;
  submitted: boolean;
  submittedBy: string | null;
  submittedAt: string | null;
  /** Search Console's URL Inspection for the address, where "Request indexing" is pressed. */
  href: string | null;
}

export interface SitemapCheck {
  addresses: number;
  withLastmod: number;
  /** False while any address lacks a real lastmod. */
  ok: boolean;
  line: string;
  /** The website change that fixes it, when it is not ok. */
  codeTask: string | null;
}
