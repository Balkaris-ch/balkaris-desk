/**
 * What the SEO screen is told: GET /api/v1/seo, its full report
 * (GET /api/v1/seo/report) and its full lists (GET /api/v1/seo/list/:name).
 *
 * Types only, like common.ts: the server imports this file with
 * `import type`. Every figure is a `Reading` or sits inside one, so a panel
 * whose source is not connected carries the reason and the step instead of a
 * number.
 *
 * WHAT THE FIGURES ARE. Search figures are Google Search Console's (Google
 * Search only, final days, two to three days behind; a position is Google's
 * average position over the window, not a tracked rank). Links are Bing's
 * index, never Google's (Google offers no backlink API). The health score,
 * the checks and the issues are the desk's own crawl of the website, judged
 * by the stated table in src/cc/site/rules.ts. The organic landing pages
 * shown until Search Console is connected are GA4's, which counts consenting
 * visitors only.
 */
import type { JobListed, Range, Reading, Stat } from "./common";

/** A window of whole days and the window of the same length before it. YYYY-MM-DD, both ends included. */
export interface SeoWindow {
  start: string;
  end: string;
  previousStart: string;
  previousEnd: string;
  days: number;
}

/* ---------- the screen ------------------------------------------------------ */

/** GET /api/v1/seo?range=30d[&open=<query>][&specimen=1] */
export interface SeoPayload {
  range: Range;
  /**
   * True when the panels that wait for Search Console and Bing were fed the
   * route's artificial specimen rows (?specimen=1, workstation only). The page
   * must then say so on screen.
   */
  specimen: boolean;
  tiles: SeoTiles;
  /** How the health score is made, for its (i): the desk's own table, in numbers. Null when the table could not be read. */
  scoreRule: ScoreRule | null;
  /** The floors the search tiles' rules use, for their (i), as the route applies them. */
  floors: { opportunities: number; ctr: number };
  ranking: Reading<RankingTrend>;
  opportunities: Reading<Opportunities>;
  gaps: Reading<ContentGaps>;
  movements: Reading<Movements>;
  /** Indexation & technical SEO, in the board's order. Each row has its own reading. */
  checks: TechCheck[];
  console: Reading<ConsoleOverview>;
  /** Search Console's landing pages when it is connected; until then GA4's organic landings, named as such. */
  landing: Reading<Landings>;
  audit: AuditState;
  /** ?open=<query> (where the top bar's keyword hits lead): that query's figures. Null when nothing was asked. */
  open: { query: string; reading: Reading<QueryFigures> } | null;
}

export interface SeoTiles {
  /** The crawl's site score out of 100 (`of` is 100), with its daily history. */
  score: Reading<Stat>;
  /** Sitemap addresses Google's URL Inspection reports as indexed, at the last daily check. */
  indexed: Reading<Stat>;
  notIndexed: Reading<Stat>;
  /** Queries at average position 4 to 20 shown at least the floor's number of times. */
  keywordOpportunities: Reading<Stat>;
  /** Pages whose CTR is under half the median of this site's pages at a similar position. Our yardstick. */
  ctrOpportunities: Reading<Stat>;
  /** Inbound links in Bing's index. */
  backlinks: Reading<Stat>;
  /** The crawl's critical findings today, with the daily history. */
  critical: Reading<Stat>;
}

export interface ScoreRule {
  /** Rules in the table. */
  rules: number;
  pageRules: number;
  siteRules: number;
  /** The rules that cost most, heaviest first. */
  heaviest: { title: string; cost: number }[];
}

/* ---------- ranking trend ----------------------------------------------------- */

/** How many queries sat how high on one day. Cumulative: top10 contains top3, top50 contains top10. */
export interface RankingDay {
  date: string;
  top3: number;
  top10: number;
  top50: number;
}

export interface RankingTrend {
  window: SeoWindow;
  days: RankingDay[];
  /** Distinct queries whose average position over the whole window is 50 or better. */
  top50: number;
  /** The same over the window before; null when Google's figures do not cover that window whole. */
  previousTop50: number | null;
  /** False when Google's row limit cut an answer short, so the counts are low. */
  complete: boolean;
}

/* ---------- keyword opportunities -------------------------------------------- */

export interface OpportunityRow {
  query: string;
  /** Google's average position over the window, 1-based. */
  position: number;
  /**
   * The same in the window before; null when Google reported no position for
   * it then. Whether that means "new" depends on `compared` of the list.
   */
  previousPosition: number | null;
  impressions: number;
  clicks: number;
  /** Percent: 2.4 is 2.4%. */
  ctr: number;
  /** The page Google shows most for it, as a path, when known. */
  path: string | null;
}

export interface Opportunities {
  window: SeoWindow;
  /**
   * True when Google's figures cover the window before from its first day and
   * the list was not cut by Google's row limit: only then does a missing
   * earlier position mean the query is new. False: a missing earlier position
   * is unknown, and nothing is claimed about it.
   */
  compared: boolean;
  /** The least impressions a query needs to be listed. */
  floor: number;
  /** How many queries meet the rule. `rows` may be fewer. */
  total: number;
  rows: OpportunityRow[];
}

/* ---------- content gaps ------------------------------------------------------ */

/** One service or industry page, and the queries Google lands on it that no page of the site answers. */
export interface GapGroup {
  /** The page's path. */
  path: string;
  /** The page's own title, as the crawl read it. */
  label: string;
  kind: "service" | "segment";
  queries: number;
  /** Impressions of those queries over the window: impressions without a matching page. */
  impressions: number;
  /** The query with the most impressions among them. */
  top: string | null;
}

export interface ContentGaps {
  window: SeoWindow;
  floor: number;
  /** Most impressions first. */
  groups: GapGroup[];
  /** Gaps Google lands on pages that are neither a service nor an industry page. */
  elsewhere: { queries: number; impressions: number };
}

/** One query in the full list of gaps. */
export interface GapRow {
  query: string;
  impressions: number;
  clicks: number;
  position: number;
  /** The page Google shows most for it. */
  path: string | null;
  /** That page's group: its title when it is a service or industry page. */
  group: string | null;
}

/* ---------- ranking movements ------------------------------------------------- */

export interface MovementRow {
  kind: "query" | "page";
  /** The row's key, unique in the list: the kind and the query, or the kind and the page's full address as Google reports it. */
  key: string;
  /** The query, or the page's path (host and path when another page of the list has the same path). */
  label: string;
  previous: number;
  current: number;
  /** Positions gained: positive moved up (8 from 17 is +9). */
  change: number;
  impressions: number;
}

export interface Movements {
  window: SeoWindow;
  floor: number;
  total: number;
  rows: MovementRow[];
}

/* ---------- indexation & technical ------------------------------------------- */

export type CheckKey = "indexed" | "sitemap" | "robots" | "canonical" | "titles" | "descriptions" | "schema" | "redirects" | "broken" | "internal";

/**
 * One rule for every line: critical and warning findings are issues and set
 * the tone (red, amber); opportunity findings never colour a line and never
 * count as issues: a line without issues says how many opportunities it has,
 * in neutral text, or its clean text.
 */
export interface CheckValue {
  tone: "good" | "warn" | "bad";
  /** "Valid (98 addresses)", "2 issues", "4 opportunities", "No issues". */
  text: string;
}

export interface TechCheck {
  key: CheckKey;
  label: string;
  reading: Reading<CheckValue>;
  /** Where the detail is. */
  href: string;
}

/* ---------- search console overview ------------------------------------------ */

export interface ConsoleDay {
  date: string;
  clicks: number;
  impressions: number;
}

export interface ConsoleOverview {
  window: SeoWindow;
  /** The first day drawn: the window's start, or the day Google's figures begin. */
  from: string;
  clicks: Stat;
  impressions: Stat;
  /** Null when the window had no impressions to divide by. */
  ctr: Stat | null;
  /** Lower is better. Null without impressions. */
  position: Stat | null;
  days: ConsoleDay[];
  /** Search Console's own performance report for the property, or null when the property is not known. */
  href: string | null;
}

/* ---------- landing pages ------------------------------------------------------- */

export interface SearchLanding {
  /** The full address as Google reports it: unique in the list. */
  page: string;
  path: string;
  /** What the row shows: the path, or host and path when another page of the list has the same path (balkaris.ch/x beside www.balkaris.ch/x). */
  label: string;
  /** The page's title and share picture from the crawl, when it knows the page. */
  title: string | null;
  picture: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  previousPosition: number | null;
}

export interface OrganicLanding {
  path: string;
  title: string | null;
  picture: string | null;
  /** Sessions GA4 counted as starting on this page from the Organic Search channel. */
  sessions: number;
  users: number;
  /** The same for the period before; null when it was not measured whole. */
  previousSessions: number | null;
}

export type Landings =
  | {
      source: "gsc";
      window: SeoWindow;
      /** As in `Opportunities`: whether a missing earlier position means the page is new. */
      compared: boolean;
      total: number;
      rows: SearchLanding[];
    }
  | {
      source: "ga4";
      start: string;
      end: string;
      total: number;
      rows: OrganicLanding[];
      /** Why these are not Search Console's clicks yet: its reason, in its words. */
      why: string;
    };

/* ---------- the audit and one query ------------------------------------------- */

export interface AuditState {
  /** The crawl job as the scheduler lists it; null when the desk has no such job. */
  job: JobListed | null;
  /** When the last crawl finished, ISO, or null before the first. */
  crawledAt: string | null;
}

export interface QueryFigures {
  query: string;
  window: SeoWindow;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  previous: { clicks: number; impressions: number; ctr: number; position: number } | null;
  /** As in `Opportunities`: whether a missing `previous` means the query is new. */
  compared: boolean;
  /** The page Google shows most for it. */
  path: string | null;
}

/* ---------- the full report ------------------------------------------------------ */

/** GET /api/v1/seo/report: every finding of the last crawl, by check and by rule. */
export interface SeoReport {
  crawl: Reading<ReportCrawl>;
  sections: ReportSection[];
}

export interface ReportCrawl {
  finished: string;
  pages: number;
  inSitemap: number;
  siteScore: number | null;
  critical: number;
  warning: number;
  opportunity: number;
}

/** The report's sections beyond the screen's ten checks: everything else the crawl holds against a page. */
export type ReportOnlyKey = "indexing-rules" | "headings" | "content" | "share" | "images";

export interface ReportSection {
  /** A check of the screen (its row links to `#key`), or a section only the report has. */
  key: CheckKey | ReportOnlyKey;
  label: string;
  reading: Reading<ReportBody>;
}

export interface ReportBody {
  tone: CheckValue["tone"];
  summary: string;
  /** Plain statements about the check that are not findings ("robots.txt answers 200 and names the sitemap"). */
  facts: string[];
  groups: ReportGroup[];
}

/** One rule (or one list of the desk's own) and everything it found. */
export interface ReportGroup {
  /** The rule's id in rules.ts, or a name of the desk's own for a list that is not a rule. */
  rule: string;
  title: string;
  severity: "critical" | "warning" | "opportunity";
  /** Points it costs: a page's score for a page rule, the site's for a site rule. 0 for the desk's own lists. */
  cost: number;
  scope: "page" | "site";
  findings: ReportFinding[];
}

export interface ReportFinding {
  /** The page, or null when it is about the site. */
  path: string | null;
  text: string;
  /** What was measured and what it was held against, as printed. */
  measured: string | null;
  limit: string | null;
  /** The other things involved: pages sharing a title, targets that fail. */
  related?: string[];
}

/* ---------- the full lists ----------------------------------------------------------- */

export type SeoListName = "opportunities" | "gaps" | "movements" | "landing";

/** GET /api/v1/seo/list/:name?range=30d[&specimen=1] */
export interface SeoList {
  name: SeoListName;
  range: Range;
  specimen: boolean;
  reading: Reading<SeoListBody>;
}

export type SeoListBody =
  | { name: "opportunities"; window: SeoWindow; floor: number; compared: boolean; rows: OpportunityRow[] }
  | { name: "gaps"; window: SeoWindow; floor: number; rows: GapRow[] }
  | { name: "movements"; window: SeoWindow; floor: number; rows: MovementRow[] }
  | { name: "landing"; landings: Landings };
