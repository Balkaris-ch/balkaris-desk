/**
 * Site Health: what GET /api/v1/health answers, in one payload.
 *
 * The website runs on Vercel, and the desk has no Vercel token. So everything
 * here is what the desk can see FROM OUTSIDE: its own probes of a few
 * addresses every two minutes, the daily crawl, the sitemap read, PageSpeed's
 * lab runs (and field data when Google has any), the website's git history,
 * and the desk's own scheduler and server. Nothing on this screen is a figure
 * only Vercel knows.
 *
 * Types only: the server imports this file with `import type`.
 */
import type { ActivityItem, JobListed, Range, Reading, Stat } from "./common";

/** The four ranges the page head offers. */
export type HealthRange = Extract<Range, "1h" | "24h" | "7d" | "30d">;
/** Performance trend's own select: days of daily history. */
export type TrendRange = Extract<Range, "7d" | "30d" | "90d">;
/** Response time's own select. */
export type ResponseRange = Extract<Range, "1h" | "24h" | "7d">;

/**
 * What the desk verified about a commit on main, by ONE rule for the tile and
 * every row: the first check of the home page that ran at least three minutes
 * after the desk first saw the commit (or after it was committed, if later),
 * so Vercel's build has had time, and before the next commit.
 *
 *   live        the newest commit, and that check answered 200
 *   answered    an older commit, and that check answered 200
 *   failed      that check failed
 *   pending     the newest commit, and no such check has run yet
 *   unchecked   the next commit came before any such check
 *   before      the next commit came before the desk's first check ever
 *   unkept      its checks were made, but are older than the 35 days the desk keeps
 *
 * None of these says that Vercel's build of the commit succeeded: only Vercel
 * knows that, and the desk has no Vercel token.
 */
export type DeployState = "live" | "answered" | "failed" | "pending" | "unchecked" | "before" | "unkept";

/** A commit on main, with what the desk verified about it. */
export interface DeployRow {
  sha: string;
  /** The first seven characters, shown as the version. */
  short: string;
  subject: string;
  /** When it was committed, ISO. */
  at: string;
  /** The commit on GitHub. The repository is private: it opens for people with access. */
  url: string | null;
  state: DeployState;
  /** The check that decided the state, when there was one. */
  check: { at: string; status: number } | null;
  /** From when a check counts for this commit, ISO (see DeployState). */
  checkFrom: string;
}

/** The Deployment status tile: the newest commit on main, and commits per bucket over the range. */
export type Deployment = DeployRow & {
  /** Commits per bucket, oldest first, from the later of the range's start and `barsSince`. */
  perBucket: number[];
  /** Where the desk's record of commits begins, ISO, when that is inside the range: the bars start there. Null when the record covers the whole range. */
  barsSince: string | null;
};

/** The six tiles under the head. Rates under 30 events come as two counts ("20 / 20"), as the contract's Stat allows. */
export interface HealthTiles {
  /** Checks of the home page that passed. */
  uptime: Reading<Stat>;
  /** Largest Contentful Paint in seconds: field when Google has it, otherwise lab. `sub` names which. */
  speed: Reading<Stat>;
  /** Checks of the probed addresses other than the home page that passed. */
  endpoints: Reading<Stat>;
  deployment: Reading<Deployment>;
  /** Scheduler runs that succeeded. */
  jobs: Reading<Stat>;
  /** Checks of every probed address that failed. */
  errors: Reading<Stat>;
}

/** Performance trend: one point per day from the desk's own history. */
export interface PerfTrend {
  /** YYYY-MM-DD, oldest first, from the first recorded day inside the window. */
  days: string[];
  /** Lab LCP, the median of the tested pages, in milliseconds. */
  lcpMs: (number | null)[];
  /**
   * The responsiveness line. INP only when field data exists; otherwise Total
   * Blocking Time, the lab's stand-in, under its own name. Milliseconds.
   */
  second: { metric: "inp" | "tbt"; kind: "field" | "lab"; values: (number | null)[] };
  /** Lab CLS, unitless. */
  cls: (number | null)[];
  /** The newest reading of each line, and the same line one window earlier when it was recorded then. */
  latest: {
    lcpMs: { value: number; previous: number | null } | null;
    second: { value: number; previous: number | null } | null;
    cls: { value: number; previous: number | null } | null;
  };
  /** "mobile": the phone run, which is what Google ranks by. */
  strategy: "mobile";
  /** The first day any line was recorded: where the history honestly begins. */
  since: string;
}

/** Response time of the probes, in buckets. */
export interface ResponseSeries {
  window: ResponseRange;
  bucketMinutes: number;
  /** ISO start of each bucket, oldest first, from the first check inside the window. */
  x: string[];
  /** Mean time to first byte of checks Vercel's cache answered (HIT or STALE): the edge alone. */
  cached: (number | null)[];
  /** Mean of checks that ran (MISS, BYPASS, REVALIDATED, or the function probe): the origin had to work. */
  rendered: (number | null)[];
  /** Over the whole window, with the window before when the probes covered it. Null means no such check. */
  average: { value: number; previous: number | null; checks: number };
  cachedAvg: { value: number; previous: number | null; checks: number } | null;
  renderedAvg: { value: number; previous: number | null; checks: number } | null;
  /** The first check inside the window. */
  since: string;
}

/** One Core Web Vital as the panel shows it, always labelled lab or field. */
export interface VitalNow {
  value: number;
  unit: "ms" | "score";
  kind: "lab" | "field";
  /** "site": the median of the tested pages (lab). "origin": the whole site's real visits (field). */
  scope: "site" | "origin" | "page";
  /** How many pages a lab median is taken over. */
  pages: number;
  /** What the figure covers: "28 days to 30 Sep" (field) or the lab run's ISO time. */
  window: string;
}

/** A probed address over the last 24 hours. */
export interface EndpointRow {
  id: string;
  label: string;
  path: string;
  /** The status that counts as healthy: 200, or 405 for the function probe (a GET its route turns away). */
  expect: number;
  /** The newest answer's status; 0 when nothing answered. Null when it has no check in 24 hours. */
  status: number | null;
  /** Whether the newest answer was the expected one. */
  ok: boolean | null;
  /** Mean time to first byte of the answered checks, in ms. */
  avgMs: number | null;
  checks: number;
  failed: number;
  /** Mean time to first byte per hour, oldest first; null where no check was answered. */
  spark: (number | null)[];
}

/** A scheduled job as this screen lists it. */
export type JobRow = JobListed;

/** One technical check. `value` is what the row prints; `tone` its dot. */
export interface CheckRow {
  value: string;
  tone: "good" | "warn" | "bad" | "info" | "quiet";
  /** What stands behind the value, for the tooltip. */
  detail: string;
}

export interface TechChecks {
  ssl: Reading<CheckRow>;
  dns: Reading<CheckRow>;
  sitemap: Reading<CheckRow>;
  robots: Reading<CheckRow>;
  brokenLinks: Reading<CheckRow & { count: number }>;
  /** Replaces the board's "Failed forms", which the desk cannot see: the redirect rules, tried at the last crawl. */
  redirects: Reading<CheckRow & { count: number; failing: number }>;
  /** Files in public/ heavy for their kind, or wider than any <img> showing them needs. */
  oversized: Reading<CheckRow & { count: number }>;
  /** Files shown by an <img> with no alt attribute at all (the asset collector's rule). */
  missingAlt: Reading<CheckRow & { count: number }>;
}

/** What is true about the website's hosting, as seen from outside. */
export interface SiteInfra {
  /** "Vercel", when the answers carry Vercel's x-vercel-id; null when they do not. */
  hosting: string | null;
  /** The edge region that answered the newest check ("fra1"). */
  edgeRegion: string | null;
  /** Where the function probe's function ran ("iad1"). */
  functionRegion: string | null;
  /** Next.js as the website's lock file pins it (and package.json asks). */
  next: { declared: string | null; installed: string | null } | null;
  /** The Node version the website's package.json asks for (engines), when it says. */
  node: string | null;
  /** The branch Vercel builds as production. */
  branch: string;
}

/** The desk's own server: NOT the website's hosting. */
export interface DeskServer {
  hostname: string;
  platform: string;
  cpus: number;
  /** One-minute load average divided by the CPU count, in percent. Null on Windows. */
  loadPercent: number | null;
  memoryPercent: number;
  memoryTotal: number;
  diskPercent: number | null;
  diskTotal: number | null;
  /** The desk process's resident memory, and the ceiling the system sets on it (null when none). */
  processBytes: number;
  processLimit: number | null;
  /** Seconds since the desk last started. */
  processUptime: number;
  node: string;
}

export interface Infrastructure {
  site: Reading<SiteInfra>;
  /** Of the desk's own checks, not of visitors' requests. */
  cache: Reading<{ percent: number; hits: number; answered: number }>;
  desk: Reading<DeskServer>;
}

export interface HealthPayload {
  range: HealthRange;
  trendRange: TrendRange;
  responseRange: ResponseRange;
  /** True when the PageSpeed-fed panels hold artificial specimen rows (?specimen=1, development only). */
  specimen: boolean;
  /** The first check the desk ever made of the site, ISO: where this screen's history begins. */
  probingSince: string | null;
  /** The website's address, "https://www.balkaris.ch", for links to its sitemap and robots.txt. */
  siteUrl: string;
  tiles: HealthTiles;
  trend: Reading<PerfTrend>;
  response: Reading<ResponseSeries>;
  vitals: { lcp: Reading<VitalNow>; inp: Reading<VitalNow>; cls: Reading<VitalNow> };
  endpoints: Reading<EndpointRow[]>;
  deployments: Reading<DeployRow[]>;
  jobs: Reading<JobRow[]>;
  checks: TechChecks;
  infra: Infrastructure;
  /** Incidents, failed jobs, sitemap changes, deployments: newest first. */
  incidents: Reading<ActivityItem[]>;
}

/**
 * GET /api/v1/health/logs: the whole of what "Recent incidents & logs" draws
 * from, newest first: the activity log's rows about the website (incidents,
 * the function probe, deployments, sitemap changes, crawls, automations) and
 * the scheduler's failed runs (kind "job", kept a week). Optionally one kind.
 */
export interface HealthLogs {
  kind: string | null;
  items: ActivityItem[];
  /** Each kind the panel draws from that has rows, with how many, for the filter. */
  kinds: { kind: string; n: number }[];
  /** True when there are more rows than `items` holds. */
  more: boolean;
}

/** GET /api/v1/health/deployments?n=: the commits on main the desk has recorded, newest first. */
export interface HealthDeployments {
  list: Reading<DeployRow[]>;
  /** How many commits on main the desk has recorded in all. */
  total: number;
  /** The oldest recorded commit, ISO: where the desk's record begins. Null before the first fetch. */
  since: string | null;
  /** How many were asked for. */
  n: number;
}
