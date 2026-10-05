/**
 * GET /api/v1/seo/technical — the crawl's findings, the indexation driver,
 * and the site-wide checks search engines and AI crawlers depend on.
 *
 *   ?range=7d|30d|90d|1y   the period of the three figures that carry a history
 *   ?q=                    narrows Issues by rule and Pages by score: text a rule's title, a finding's
 *                          words, or a page's address or title contains
 *   ?sev=critical|warning|opportunity    Issues by rule: one severity
 *   ?index=indexed|not|unknown           Pages by score: by Google's newest answer for the address
 *   ?device=mobile|desktop               Page speed: which of the daily lab runs to list
 *
 * GET /api/v1/seo/technical/export.csv?what=issues|pages|redirects|index (&q=&sev=&index=)
 *   the same lists as a file: every finding, every page, every redirect, every address's index state.
 *
 * The Google panel (`google`) and its buttons are /api/v1/seo/google (contract/seo/google.ts): submit a
 * sitemap, inspect one address now, the Request indexing queue, IndexNow.
 *
 * Changes (a signed-in person):
 *   POST /api/v1/seo/indexing/requested   { path, submitted: boolean }   mark a page as submitted
 *        in Search Console's URL Inspection (by hand, in the owner's browser) → OpportunityAnswer
 *   POST /api/v1/jobs/speed/run           the PageSpeed test now (the scheduler's own door)
 *   POST /api/v1/operator/tasks           a fix the operator proposes (titles and descriptions,
 *        redirects); what it proposes waits for a person's approval
 *   POST /api/v1/seo/opportunities/act    { id }  take one technical opportunity's action: a
 *        proposal or a brief is queued for the operator, a change to the website's code goes
 *        on the to-do list in AI Operator, "Request indexing" is marked as pressed
 *   POST /api/v1/seo/opportunities/owner-task   { task }  a step from the audit marked done
 *        by the person who took it (the owner's own steps: the owner only)
 *
 * Nothing here changes the live website.
 *
 * Types only.
 */
import type { JobListed, Reading, Share, Stat } from "../common";
import type { NewTask } from "../operator";
import type { ReadinessCheck } from "./ai-search";
import type { OpportunityRow, SeoHead } from "./common";
import type { GooglePanel } from "./google";

export interface SeoTechnicalPayload {
  head: SeoHead;
  /** The crawl's site score out of 100, with its daily history. */
  score: Reading<Stat>;
  crawl: Reading<{ finished: string; pages: number; inSitemap: number; critical: number; warning: number; opportunity: number }>;
  /** The crawl's findings by rule, worst first. `total`: how many rules have findings before ?q and ?sev narrowed them. */
  issues: Reading<{ rows: IssueGroup[]; total?: number }>;
  indexation: Reading<Indexation>;
  /** Every sitemap address with a real lastmod, or the code task when it has none. */
  sitemap: Reading<SitemapCheck>;
  /** Whether robots.txt lets each named crawler read the site, as the live file says. */
  robots: Reading<{ status: number; agents: { agent: string; family: string; allowed: boolean }[] } & Partial<RobotsFile>>;
  /** /llms.txt on the live site. */
  llms: Reading<{ status: number; present: boolean; line: string }>;
  /** PageSpeed lab runs (one Lighthouse load each, not visitors), slowest first. */
  speed: Reading<{ rows: SpeedRun[] } & Partial<SpeedSweepInfo>>;
  /** The technical opportunities (crawl findings, site checks) as the engine lists them. */
  opportunities: OpportunityRow[];

  /* ---- added for the page (board 113, panel 7) ---- */

  /** The board's checklist, in its order: each line counted by its own source, or absent with its reason. */
  checks: TechLine[];
  /** Core Web Vitals: Google's field data when it has any, else the lab, every figure labelled which. */
  vitals: TechVitals;
  /** Every page the crawl read, by its score, lowest first. `read` counts all of them; `rows` only those ?q and ?index left. */
  pages: Reading<{ rows: TechPage[]; read: number; scored: number }>;
  /** Structured data: the types on the site and the findings of the schema rules. */
  schema: Reading<SchemaCheck>;
  /** Every redirect the site promises, tried at the last crawl, and links on the site that go through one. */
  redirects: Reading<RedirectsCheck>;
  /** Links to addresses that do not answer: on the site, and to other sites. */
  broken: Reading<BrokenCheck>;
  /** The site-wide checks of the AI-readiness job that belong to this page: robots for crawlers, llms.txt, lastmod, Bing Webmaster. */
  siteChecks: Reading<{ rows: ReadinessCheck[] }>;
  /** The sitemaps submitted to Google: Search Console's own record of when Google last fetched each and what it counted. */
  submitted: Reading<{ rows: SubmittedSitemap[] }>;
  /** The jobs behind the page, for its buttons and its "last read" lines. Null when a job is not on this desk. */
  jobs: { crawl: JobListed | null; sitemap: JobListed | null; speed: JobListed | null; inspect: JobListed | null; readiness: JobListed | null };
  /** Who is looking: the owner's own steps ("Needs you") are marked done by the owner only. */
  viewer: { owner: boolean };
  /** What the desk can do at Google and the other engines: sitemaps, the indexing queue, inspect now, IndexNow. */
  google: GooglePanel;
  /** The filters as the server read them (an unknown value is read as "all"). */
  asked: TechAsked;
  /** Search Console's Sitemaps report for the property, where Google says what a sitemap's errors are; null when not connected. */
  sitemapsHref: string | null;
}

/** The lists' filters, held in the address. */
export interface TechAsked {
  q: string;
  sev: "all" | "critical" | "warning" | "opportunity";
  index: "all" | "indexed" | "not" | "unknown";
  device: "mobile" | "desktop";
}

/** One line of the board's checklist. */
export interface TechLine {
  key: "crawled" | "indexable" | "in-index" | "broken" | "descriptions" | "titles" | "schema" | "duplicates" | "slow" | "alt" | "redirects";
  label: string;
  /**
   * The count, out of `of` when it is a part of a whole; `previous` is the
   * same count at the start of the period, only where the desk has a daily
   * history reaching that far. `tone` follows the crawl's one rule: critical
   * findings are bad, warnings warn, a count that is not a fault is info.
   */
  reading: Reading<{ count: number; of: number | null; previous: number | null; tone: "good" | "warn" | "bad" | "info" }>;
  /** How the line is counted, in one sentence. */
  rule: string;
  /** Where on this page the line's detail is ("#broken"). */
  href: string;
  /** An operator task that proposes the fix (it waits for approval), where one exists. */
  fix: { label: string; task: NewTask } | null;
}

/** A Core Web Vital as measured, always with which kind of number it is. */
export interface VitalFigure {
  metric: "lcp" | "inp" | "cls" | "tbt";
  name: string;
  value: number;
  unit: "ms" | "score";
  kind: "lab" | "field";
  rating: "good" | "needs-improvement" | "poor";
  /** The bands `rating` was read against, and whose they are. */
  limits: { good: number; poor: number; by: string };
  /** "site": the median of the lab's pages; "origin": the whole site's real visits; "page": one address. */
  scope: "page" | "site" | "origin";
  /** Pages a lab median is taken over; 0 for field data. */
  pages: number;
  /** What it covers: "28 days to 30 Sep" (field), or the lab run's ISO time. */
  window: string;
}

/** LCP, INP and CLS as the board shows them, and Total Blocking Time: the lab's stand-in for INP, under its own name. */
export interface TechVitals {
  lcp: Reading<VitalFigure>;
  inp: Reading<VitalFigure>;
  cls: Reading<VitalFigure>;
  tbt: Reading<VitalFigure>;
}

/** One PageSpeed lab run of one page. */
export interface SpeedRun {
  path: string;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  at: string;
  strategy?: "mobile" | "desktop";
  /** Lighthouse's performance score, 0 to 100; null when the run failed. */
  performance?: number | null;
  /** Each measured value's band, by Lighthouse's lab bands for the device. */
  rating?: { lcp: VitalFigure["rating"] | null; cls: VitalFigure["rating"] | null; tbt: VitalFigure["rating"] | null };
  /** Why the run failed, when it did. */
  failure?: string | null;
}

export interface SpeedSweepInfo {
  strategy: "mobile" | "desktop";
  /** The band LCP is held against for "slow" (Lighthouse's lab bands for the device). */
  lcpLimits: { good: number; poor: number; by: string };
  /** Runs measured, and how many of them are over `lcpLimits.good`. */
  measured: number;
  slow: number;
  failed: number;
}

/** One sitemap as Search Console records it. */
export interface SubmittedSitemap {
  /** The sitemap's address as submitted. */
  path: string;
  lastSubmitted: string | null;
  /** When Google last fetched the file. */
  lastDownloaded: string | null;
  isPending: boolean;
  isIndex: boolean;
  warnings: number;
  errors: number;
  /** Addresses Google counted in the file. */
  submitted: number;
}

/** robots.txt as the sitemap job read it (every quarter of an hour). */
export interface RobotsFile {
  /** Every "Sitemap:" line. */
  sitemaps: string[];
  /** Allow and disallow rules for every crawler ("User-agent: *"). */
  rules: number;
  /** When the file was read, ISO. */
  readAt: string;
  /** The robots rules' findings (robots.*, sitemap.blocked). */
  findings: { rule: string; title: string; severity: IssueGroup["severity"]; text: string }[];
  /** When the agents were read (the AI-readiness job), or null when that job has not run: then `agents` is empty. */
  agentsAt: string | null;
}

/** A page by the crawl's score. */
export interface TechPage {
  path: string;
  title: string | null;
  kindLabel: string;
  status: number;
  inSitemap: boolean;
  indexable: boolean;
  /** 0 to 100, or null for a page that is not scored. */
  score: number | null;
  critical: number;
  warning: number;
  opportunity: number;
  /** Google's newest URL Inspection of the address: in the index or not, and its words; null when it was not inspected. */
  inIndex: boolean | null;
  coverage: string | null;
  /** The day that answer is from (the newest check's, or an earlier one's when that check did not reach the address). */
  inIndexDay?: string | null;
}

export interface SchemaCheck {
  /** Every structured-data type on the site and how many pages carry it. */
  types: Share[];
  /** Pages answering 200 that carry any structured data, of the pages answering 200. */
  withSchema: number;
  read: number;
  /** Pages whose structured data is not valid JSON or misses a required field. */
  invalid: number;
  /** The findings of the schema rules, worst first. */
  rows: IssueGroup[];
}

export interface RedirectRow {
  source: string;
  destination: string;
  by: "config" | "desk" | "hosting";
  tested: string | null;
  status: number | null;
  lands: string | null;
  landed: number | null;
  hops: number;
  outcome: "ok" | "broken" | "chain" | "untested";
  remark: string;
}

export interface LinkRow {
  target: string;
  /** What it answered; 0 for nothing. */
  status: number;
  lands: string | null;
  remark: string | null;
  /** The pages that carry the link, with its words. */
  sources: { path: string; text: string; place: "main" | "chrome" }[];
}

export interface RedirectsCheck {
  rows: RedirectRow[];
  working: number;
  broken: number;
  chains: number;
  /** Links on the site that reach their page only through a redirect. */
  linksThrough: LinkRow[];
  /** Sitemap addresses that redirect (they should list where they lead). */
  sitemapRedirects: { path: string; to: string | null }[];
}

export interface BrokenCheck {
  /** Addresses on the site that links point to and that do not answer. */
  inside: LinkRow[];
  /** Other sites' pages linked from the site that are gone. */
  outside: LinkRow[];
  /** Other sites' pages that refused or failed the check: not counted as broken. */
  unchecked: number;
  /** Which they are, with what each answered, so a person can open them. */
  uncheckedRows?: LinkRow[];
  /** Pages the crawl read that do not answer 200 (and do not redirect). */
  pagesDown: { path: string; status: number }[];
}

export interface IssueGroup {
  rule: string;
  title: string;
  severity: "critical" | "warning" | "opportunity";
  /** Points it costs a page (or the site) in the crawl's score. */
  cost: number;
  count: number;
  pages: string[];
  /** The checklist area the rule belongs to ("title", "schema", "links"…). */
  area?: string;
  /** "page" or "site": what the rule is about. */
  scope?: "page" | "site";
  /** Each finding in the crawl's words, the page first (null for the site), with the day a crawl first found it. At most 60. */
  lines?: { path: string | null; text: string; firstSeen?: string }[];
  /** How many of the group's findings the newest crawl found for the first time. */
  fresh?: number;
  /**
   * An operator task that proposes the fix (it waits for approval), where one exists. For titles and
   * descriptions it names the group's own pages (five at most) that have no proposal waiting and no task open.
   */
  fix?: { label: string; task: NewTask } | null;
  /** Why there is no button although the rule has a fix: every page already has a proposal waiting, or a task is open. */
  fixNote?: string | null;
}

/**
 * The indexation driver: Google's stored state for every sitemap address, by state.
 *
 * EACH ADDRESS'S NEWEST ANSWER. When the newest daily check was cut short (Google answering an error after
 * a part of the sitemap), the addresses it did not reach keep their last earlier answer, so the figures
 * stay the site's; `complete`, `checked` and `carried` say how the picture was put together.
 */
export interface Indexation {
  /** The day of the newest daily check. */
  day: string;
  /** Addresses with an answer (the newest check's, a carried one, or one a person asked for since). */
  inspected: number;
  of: number | null;
  indexed: number;
  /** False when the check on `day` did not reach every sitemap address. */
  complete?: boolean;
  /** How far the check on `day` reached; answers carried from an earlier day; answers a person asked for since ("Inspect now"). */
  checked?: number;
  carried?: number;
  later?: number;
  /** The newest day whose check reached every address; null when none has. */
  wholeDay?: string | null;
  /** Sitemap addresses with no answer in the last week: not known, counted neither way. */
  missing?: number;
  /** When the desk asks for the check again after one that failed today (an hour later, three times at most); null when none is owed. */
  retryAt?: string | null;
  /** One group per coverage state Google reports, with Google's meaning and the fix. */
  groups: CoverageGroup[];
  /** Indexed and not indexed per day, from the desk's daily checks. */
  history: { day: string; indexed: number; notIndexed: number }[];
  /** "Request indexing": pages the lead submits by hand in Search Console, ~10 a day (Google publishes no quota). */
  queue: IndexRequest[];
  /** Addresses Google chose another canonical for than the page declares. */
  canonicalDiffers?: { path: string; declared: string | null; chosen: string | null }[];
}

export interface CoverageGroup {
  /** Google's own words: "Crawled - currently not indexed". */
  state: string;
  indexed: boolean;
  /** What Google means by it, in plain words. */
  meaning: string;
  /** What fixes it. */
  fix: string;
  pages: { path: string; lastCrawl: string | null; robots: string | null; indexing: string | null; livePageSaysIndex: boolean | null; link: string | null; /** The day this answer is from. */ day?: string }[];
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
  /** What sitemap.xml answered at its last read (0: nothing), and when that was. */
  status?: number;
  readAt?: string;
  /** The sitemap rules' findings; empty when it is valid as far as the desk checks. */
  findings?: { rule: string; title: string; severity: IssueGroup["severity"]; text: string }[];
  /** Whether robots.txt names this sitemap. */
  named?: boolean;
  /** Addresses by the kind of page, with how many of them carry a lastmod. */
  byKind?: { kind: string; label: string; addresses: number; withLastmod: number }[];
  /** Every entry as the file lists it, newest lastmod first: the address, its date and its priority. */
  entries?: { path: string; lastmod: string | null; priority: number | null }[];
}
