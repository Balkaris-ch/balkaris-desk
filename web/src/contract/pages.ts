import type { DayPoint, Range, Reading, Stat, Tone } from "./common";

/**
 * What GET /api/v1/pages?range= answers (the Pages screen) and what
 * GET /api/v1/pages/view?path=&range= answers (one page's detail).
 *
 * Every page the desk knows comes from its own crawl: the sitemap plus the
 * pages the website's repository keeps out of it. Each other source is a
 * column or a panel of its own, a Reading of its own, so a source that is not
 * connected costs that column and nothing else: GA4 (visitors, events;
 * consenting visitors only), the engine (enquiries, counts only), the
 * website's git history (who changed a page, when), PageSpeed (lab speed) and
 * Search Console (queries, index state).
 *
 * Types only: the server imports this file with `import type`.
 */

/** The kinds of page, as the crawl files them (src/cc/site/rules.ts, PageKind). */
export type PageType = "home" | "service" | "segment" | "article" | "insights" | "landing" | "case" | "legal" | "standard";

/**
 * What the address answered at the last crawl, as the Status column says it.
 *   live      200, offered to search engines
 *   noindex   200, but tells search engines to stay away
 *   redirect  3xx
 *   error     4xx, 5xx, or no answer at all
 */
export type PageState = "live" | "noindex" | "redirect" | "error";

/** Why a row is in one of the lists the screen filters by. Each is a stated rule over the crawl's findings. */
export interface PageFlags {
  /** No title or description, or one longer than the limit (rules title.missing, title.long, description.missing, description.long). */
  meta: boolean;
  /** No structured data at all (rule schema.none). */
  schema: boolean;
  /** In the sitemap and no other page links to it (rule links.orphan). */
  orphan: boolean;
  /** No share picture of its own: on the site's default one, or none (rules share.default-picture, share.missing). */
  picture: boolean;
  /** Anything that keeps a page out of the Metadata status panel's "Complete": a title or description missing or over the limit, no picture of its own, no structured data. */
  metadata: boolean;
  /** At least one critical issue or warning. */
  attention: boolean;
  /** Answers with a redirect or an error. */
  route: boolean;
}

/** One page of the inventory, as the crawl read it. */
export interface PageListRow {
  /** The stored address: "/seo", "/" for home. */
  path: string;
  /** The address on the live site. */
  url: string;
  /** The page's <title> without the site's name after it; else its heading; else its address. */
  name: string;
  /** The full <title> as served, or null when it has none. */
  title: string | null;
  type: PageType;
  /** The type as a chip prints it: "Service", "Industry", "Insight". */
  typeLabel: string;
  /** The line under the name: the part of the site the type belongs to ("Services", "Insights"). */
  section: string;
  state: PageState;
  /** The status the address itself answered; 0 when nothing did. */
  status: number;
  redirectTo: string | null;
  inSitemap: boolean;
  /** How the desk knows the page: the sitemap, a page file the sitemap leaves out ("route"), or an article not listed yet ("unlisted"). */
  listedBy: "sitemap" | "route" | "unlisted";
  /** Answers 200 and is kept out of search: says noindex, or is an article not listed yet. */
  draft: boolean;
  /** The share picture as an absolute https address, or null when the page names none. */
  picture: string | null;
  /** 0 to 100 by the crawl's own table (src/cc/site/rules.ts); null for a page kept out of the sitemap, which is not scored. */
  score: number | null;
  issues: { critical: number; warning: number; opportunity: number };
  flags: PageFlags;
  /** Other pages linking here, from anywhere on them (menus included), and from their own content only. */
  inlinks: number;
  inlinksFromContent: number;
  /** When a crawl first read the address, ISO. */
  firstSeen: string;
  /** First read by a crawl after the desk's first one, or an article published, within the last 14 days. */
  isNew: boolean;
  /**
   * An article's publish date (YYYY-MM-DD), as its own content file in the
   * website's repository states it (`date:`); null for every other page, and
   * for an article whose file the desk has not read yet.
   */
  dated: string | null;
  /**
   * The sitemap's date for the page (YYYY-MM-DD or ISO), which the website
   * gives to articles only: its `updated` date when it has one, else its
   * publish date. When the article was last updated, not when it appeared.
   */
  lastmod: string | null;
}

/** The period a GA4 column covers. */
export interface PagesPeriod {
  /** YYYY-MM-DD, both ends included. It ends yesterday. */
  start: string;
  end: string;
  /** The first day GA4 measured the website. */
  since: string;
  /** True when the range starts before `since`. */
  partial: boolean;
  /** The period before, or null when it was not measured whole: then no change is shown. */
  previous: { start: string; end: string } | null;
  /** The first day on which a period of this length and the one before it will both have been measured whole. */
  comparableFrom: string;
}

/** Visitors per address for the range. An address GA4 has no row for had no visitor in the range. */
export interface TrafficColumn {
  period: PagesPeriod;
  /** `sessions` is null when GA4's sessions report for the period could not be read. */
  rows: Record<string, { visitors: number; previous: number | null; views: number; sessions: number | null }>;
}

/** Enquiries per address: the engine's count when it is connected, GA4's generate_lead events until then. */
export interface ConversionColumn {
  source: "engine" | "ga4";
  /** In words, for the column's tooltip: what one counted thing is. */
  counts: string;
  rows: Record<string, { count: number; previous: number | null }>;
}

/** When a page last changed, and who changed it. */
export interface PageUpdate {
  /** ISO time, or YYYY-MM-DD for an article's own date. */
  at: string;
  /** A first name, as the desk's people table or the commit has it. Null when the date is the article's own. */
  who: string | null;
  /** The commit's subject, or null. */
  subject: string | null;
  sha: string | null;
  /**
   * "commit": the newest commit to the files only this page uses (its page
   * file and what only it imports; a case study's or an article's own content
   * file). "dated": an article whose content no single file holds, so its own
   * date is what is known.
   */
  how: "commit" | "dated";
}

/** How the site's addresses answered at the last crawl, the redirect rules included. */
export interface RouteHealthPanel {
  /** Pages and tested redirect rules together. */
  total: number;
  /** Answer 200. */
  healthy: number;
  /** Answer with a redirect: pages that redirect, and redirect rules that work (in one hop or in a chain). */
  redirects: number;
  /**
   * Redirect rules the site promises that do not work, wherever they ended:
   * no redirect at all, the wrong place, or a page that does not answer 200.
   * Listed one by one, with what happened, in the SEO report's Redirects.
   */
  brokenRules: number;
  /** 4xx, from a page. */
  clientErrors: number;
  /** 5xx, from a page. */
  serverErrors: number;
  /** Nothing answered, at a page's address. */
  unanswered: number;
  /** Of `total`: crawled pages, and redirect rules tried. */
  pages: number;
  rules: number;
  /** Of `pages`: the pages that redirect or fail, which the table's "Route issues" list shows. */
  routePages: number;
  /** Redirect rules with a :param no existing page could stand in for, so not tried. */
  untested: number;
}

/** The sitemap's pages by what their head is missing. */
export interface MetadataPanel {
  /** Pages in the sitemap that answered and were read. */
  total: number;
  /** A title and a description within the limits, a share picture of their own, and structured data. */
  complete: number;
  missingTitle: number;
  /** A title longer than the limit (60 characters): cut in results. */
  longTitle: number;
  missingDescription: number;
  /** A description longer than the limit (160 characters): cut in results. */
  longDescription: number;
  /** On the site's default share picture, or with none. */
  missingPicture: number;
  missingSchema: number;
}

/** A line in "Recent page activity". */
export interface PageActivityItem {
  id: string;
  /** ISO time. */
  at: string;
  tone: Tone;
  /** "Published /insights/…", "Title changed on /seo", "New page /x", "Updated /about". */
  text: string;
  /** The address it is about, when one. */
  path: string | null;
  /** A first name from the commit, or null for what the crawl noticed. */
  who: string | null;
  /** The commit's subject, or what changed ("“old” → “new”"). */
  detail: string | null;
  kind: "commit" | "publish" | "crawl";
}

export interface PagesTiles {
  /** Every page the desk reads (the sitemap's and those kept out of it), with the daily history the crawl records. */
  total: Reading<Stat>;
  missingMeta: Reading<Stat>;
  missingSchema: Reading<Stat>;
  orphans: Reading<Stat>;
  /** Pages above the median in visitors that also rose against the period before. Absent while there is no period before. */
  topPerformers: Reading<Stat>;
  drafts: Reading<Stat>;
}

export interface PagesPayload {
  range: Range;
  /** True when the specimen switch fed a panel from made-up rows (development only). */
  specimen: boolean;
  tiles: PagesTiles;
  inventory: Reading<PageListRow[]>;
  traffic: Reading<TrafficColumn>;
  conversions: Reading<ConversionColumn>;
  /** Address → its last change. An address that is absent cannot be mapped to its own files truthfully. */
  updates: Reading<Record<string, PageUpdate>>;
  /** The addresses the Top performers rule picked, for its filter. */
  top: string[];
  routeHealth: Reading<RouteHealthPanel>;
  metadata: Reading<MetadataPanel>;
  activity: Reading<PageActivityItem[]>;
  /** The crawl job as the scheduler knows it, for the action that runs it now. */
  crawl: { running: boolean; lastEnd: string | null; ready: boolean };
}

/* ---------- one page ------------------------------------------------------ */

export interface PageFinding {
  id: string;
  rule: string;
  title: string;
  severity: "critical" | "warning" | "opportunity";
  /** One sentence with the measured value and the limit. */
  text: string;
  measured: number | string | null;
  limit: number | string | null;
  /** Points it takes from the page's score (0 for a rule that only warns). */
  cost: number;
  firstSeen: string;
}

export interface PageSchemaBlock {
  parses: boolean;
  error?: string;
  nodes: { type: string; missing: string[]; known: boolean }[];
}

export interface PageImage {
  /** The file on the site, or the other host's address. */
  src: string;
  /** Absolute address to show it, when it is an https one. */
  url: string | null;
  alt: "written" | "empty" | "absent";
  altText: string | null;
  width: number | null;
  height: number | null;
  place: "main" | "chrome";
  hidden: boolean;
  unnamedLink: boolean;
}

/** Everything the crawl read about one address. */
export interface PageFactsView {
  row: PageListRow;
  /** The limits the issues are held against (rules.ts LIMITS). */
  limits: { title: number; description: number; thinWords: number };
  titleLength: number | null;
  description: string | null;
  descriptionLength: number | null;
  canonical: string | null;
  /** True when the canonical names this page, false when it names another, null when there is none. */
  canonicalSelf: boolean | null;
  robots: string | null;
  robotsHeader: string | null;
  lang: string | null;
  h1: string[];
  h2: number;
  og: { title: string | null; description: string | null; image: string | null; type: string | null };
  twitterCard: string | null;
  /** The site's default share picture, absolute, when known. */
  defaultPicture: string | null;
  schema: PageSchemaBlock[];
  schemaTypes: string[];
  /** Words of the page's own content; null when it was not read. */
  words: number | null;
  /** How the request went at the last crawl, from the desk's server: one sample, a hint and not a measurement. */
  fetch: {
    hops: { url: string; status: number }[];
    ttfbMs: number | null;
    totalMs: number | null;
    bytes: number | null;
    cache: string | null;
    cacheControl: string | null;
    contentType: string | null;
    error: string | null;
  };
  lastSeen: string;
  /** When the crawl last saw what a reader would notice change, ISO; null when it has not since it first read the page. */
  lastChanged: string | null;
  findings: PageFinding[];
  linksIn: { source: string; text: string; place: "main" | "chrome" }[];
  linksOut: { target: string; text: string; internal: boolean; place: "main" | "chrome"; rel: string; outcome: "ok" | "redirect" | "broken" | "unchecked" | null; status: number | null }[];
  outlinks: number | null;
  images: PageImage[];
}

/** Why the page scored what it did: 100, less each rule that fired once. */
export interface PageScoreView {
  score: number | null;
  /** Why there is no score, when there is none. */
  unscored: string | null;
  lines: { rule: string; title: string; severity: "critical" | "warning" | "opportunity"; cost: number }[];
}

export interface PageTrafficView {
  period: PagesPeriod;
  visitors: Stat;
  views: Stat;
  sessions: Stat;
  /** Visitors per day, with the same day one period earlier where it was measured. */
  days: DayPoint[];
  /** How many of the newest days GA4 may still change. */
  provisional: number;
}

export interface PageEventRow {
  name: string;
  /** In words, for the website's own five events. */
  what: string | null;
  count: number;
  previous: number | null;
  ours: boolean;
}

export interface PageSpeedView {
  /** The newest lab runs of this page, phone and desktop. */
  runs: {
    strategy: "mobile" | "desktop";
    at: string;
    performance: number | null;
    seo: number | null;
    accessibility: number | null;
    bestPractices: number | null;
    lcpMs: number | null;
    cls: number | null;
    tbtMs: number | null;
    failure: string | null;
  }[];
}

export interface PageSearchView {
  start: string;
  end: string;
  totals: { clicks: number; impressions: number; ctr: number | null; position: number | null };
  queries: { query: string; clicks: number; impressions: number; ctr: number; position: number }[];
}

export interface PageInspectionView {
  day: string;
  indexed: boolean;
  verdict: string | null;
  coverage: string | null;
  lastCrawl: string | null;
  googleCanonical: string | null;
  canonicalOk: boolean | null;
  link: string | null;
}

export interface PageHistoryItem {
  id: string;
  at: string;
  tone: Tone;
  text: string;
  detail: string | null;
  who: string | null;
  href: string | null;
  kind: "commit" | "crawl";
}

export interface PageViewPayload {
  path: string;
  range: Range;
  specimen: boolean;
  facts: Reading<PageFactsView>;
  score: Reading<PageScoreView>;
  traffic: Reading<PageTrafficView>;
  events: Reading<PageEventRow[]>;
  enquiries: Reading<{ count: number; previous: number | null; counts: string }>;
  speed: Reading<PageSpeedView>;
  search: Reading<PageSearchView>;
  inspection: Reading<PageInspectionView>;
  history: Reading<PageHistoryItem[]>;
  /** The files the git history is read from for this page, repository-relative; empty when none maps truthfully. */
  ownFiles: string[];
  crawl: { running: boolean; lastEnd: string | null; ready: boolean };
}
