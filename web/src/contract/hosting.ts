/**
 * Hosting: what GET /api/v1/hosting answers, in one payload.
 *
 * Site Health is the website as the desk sees it from OUTSIDE. This screen is
 * what only Vercel knows, read three ways, each with its own off state:
 *
 *   vercel-drain   Vercel's own record of every request, delivered to the
 *                  desk by a log drain (POST /drain/vercel). Turned into page
 *                  views by the rules in src/cc/vercel/drain.ts, which this
 *                  payload repeats so the screen can show them. No IP address
 *                  and no user agent is ever kept: only counts per day.
 *   vercel-api     the Vercel REST API with a desk-only project token:
 *                  production builds, the project, its domains, the firewall.
 *   vercel-status  Vercel's public status page: no credential.
 *
 * And the engine on the box, which the website's enquiry, booking and slots
 * routes call: the desk's own check of it (source "probe").
 *
 * Types only: the server imports this file with `import type`.
 */
import type { Range, Reading, Share, Stat } from "./common";

/** The ranges the page head offers. */
export type HostingRange = Extract<Range, "7d" | "30d" | "90d">;

/**
 * What one request record was decided to be, by the rules in order. Every
 * record lands in exactly one kind; "view" and "navigation" are the page
 * views, everything else is set aside and counted under its own name.
 */
export type DrainKind =
  | "view" /* a page loaded in the browser: GET, 200 or 304, a document */
  | "navigation" /* an App Router navigation inside the site, proved by its matched path (<page>.rsc) */
  | "prefetch" /* the router fetching a page ahead of a click: not a view */
  | "rsc" /* a router request (?_rsc=) the record does not prove to be a navigation: not a view */
  | "file" /* an asset or a machine file: /_next/, pictures, video, fonts, favicon, robots, sitemap, feed */
  | "api" /* the site's own /api routes */
  | "bot" /* a document request from a robot, by its user agent */
  | "notFound" /* a person's document request answered 404 */
  | "redirect" /* answered 3xx (other than 304) */
  | "serverError" /* answered 5xx */
  | "otherStatus" /* any other status, or none */
  | "otherHost" /* not www.balkaris.ch or balkaris.ch: the preview, a vercel.app address */
  | "method" /* not a GET */
  | "noRequest" /* a record about no request: build output, a function's own log line */
  | "duplicate"; /* a record already counted: the same record id, or another record of the same request */

/** One of the stated rules, with how many records it decided in the range. */
export interface ViewRule {
  kind: DrainKind;
  /** The rule, in one sentence. */
  rule: string;
  /** Why it is the rule. */
  why: string;
  /** Records it decided in the range; null while the drain has delivered nothing. */
  count: number | null;
}

/** How the drain is doing: deliveries, refusals, the newest record. */
export interface DrainCounting {
  /** The first signed delivery, ISO: where this screen's page views begin. */
  since: string;
  /** The newest signed delivery, ISO. */
  lastDelivery: string;
  /** The newest record's own time, ISO, or null when no record carried one. */
  newestRecord: string | null;
  /** Today (Zurich): signed deliveries, the records in them, and deliveries refused (bad or missing signature). */
  today: { deliveries: number; records: number; refused: number };
  /** The last refused delivery, ISO, or null. */
  lastRefused: string | null;
  /** Records the rules decided in the range, all kinds together. */
  records: number;
  /** Hours since the last signed delivery when that is longer than the alarm's limit; null when deliveries are current. */
  quietHours: number | null;
  /**
   * The router's markers, checked (markerGaps in src/cc/vercel/drain.ts):
   * the days of the range with `minViews` page views or more and not one
   * prefetch, router request or navigation beside them. On such a day the
   * records carried no marker, and its page views may include prefetches.
   * Empty when every day is clear.
   */
  markers: { minViews: number; gaps: { day: string; views: number }[] };
}

/** Page views per day, from the first day the drain delivered; GA4 on the same days beside them. */
export interface ViewsChart {
  /** YYYY-MM-DD, oldest first, from the later of the range's start and the first delivery's day, to today. */
  days: string[];
  /**
   * Page views by the drain's rules, per day. Never back-filled: the first day
   * is counted from its first delivery. Null on a day no delivery arrived at
   * all (the desk was down, or the drain paused): unknown, not zero.
   */
  views: (number | null)[];
  /** GA4's page views on the same days, or null where GA4 gave none. Null altogether when GA4 is not readable. */
  ga4: (number | null)[] | null;
  /** Why the GA4 line is missing, when it is. */
  ga4Why: string | null;
  /** The first delivery's day and time (ISO): that day is counted from then on, not from midnight. */
  firstDay: string;
  firstAt: string;
}

/** The consent gap: GA4's page views against the server's, on the same whole days. */
export interface ConsentGap {
  ga4: number;
  server: number;
  /** The whole days compared, both ends included, YYYY-MM-DD. */
  from: string;
  to: string;
  days: number;
}

/** A production deployment as Vercel reports it. */
export type BuildState = "READY" | "ERROR" | "BUILDING" | "QUEUED" | "INITIALIZING" | "CANCELED" | "BLOCKED" | "DELETED";

export interface BuildRow {
  uid: string;
  state: BuildState;
  /** When it was created, ISO. */
  createdAt: string;
  /** Build time: ready minus building start, in ms. Null while building or when Vercel gave no end. */
  durationMs: number | null;
  /** The commit, from Vercel's git source (withGitRepoInfo). */
  sha: string | null;
  ref: string | null;
  /** Who started it, as Vercel names them (a GitHub login, a Vercel username). */
  creator: string | null;
  /** Vercel's own words when it failed. */
  error: { code: string | null; message: string | null; step: string | null } | null;
  /** The deployment in Vercel's dashboard. */
  inspectorUrl: string | null;
  /** True for the deployment the production domain serves now. */
  current: boolean;
}

/** The last lines of a build's log, on demand (GET /api/v1/hosting/builds/:uid). */
export interface BuildLog {
  build: BuildRow | null;
  lines: { at: string | null; type: string; error: boolean; text: string }[];
  /** How many log events Vercel returned before they were cut to `lines`. */
  total: number;
}

export interface BuildLogPayload {
  uid: string;
  log: Reading<BuildLog>;
}

/** What the production domain serves, from the project. */
export interface ProductionNow {
  /** The deployment serving production: its address and state. */
  deploymentUrl: string | null;
  readyState: string | null;
  /** The addresses Vercel lists for production. */
  aliases: string[];
  /** Whether the project's production is paused (Spend Management can pause it). */
  paused: boolean | null;
  firewall: {
    enabled: boolean | null;
    attackMode: boolean | null;
    attackModeUntil: string | null;
    botId: boolean | null;
  };
}

export interface DomainRow {
  name: string;
  verified: boolean;
  /** Where it redirects, when it does, and with which status. */
  redirect: string | null;
  redirectStatus: number | null;
}

/** The firewall's attack detection over the last day. */
export interface AttackStatus {
  total: number;
  /** Anomalies without an end yet. */
  active: number;
  /** The newest anomaly's start, ISO, or null. */
  newest: string | null;
}

export interface PlatformComponent {
  id: string;
  name: string;
  /** Why the desk watches it: "CDN, the edge that serves the site (fra1)". */
  why: string;
  /** Statuspage's words: operational, degraded_performance, partial_outage, major_outage, under_maintenance. */
  status: string;
}

export interface PlatformIncident {
  id: string;
  name: string;
  /** investigating, identified, monitoring … */
  status: string;
  /** none, minor, major, critical. */
  impact: string;
  startedAt: string;
  link: string | null;
  /** The watched components it touches, by name; empty when it names none of them. */
  touches: string[];
}

export interface PlatformStatus {
  /** The page's own summary: none, minor, major, critical, maintenance. */
  indicator: string;
  description: string;
  components: PlatformComponent[];
  /** Unresolved incidents, the ones touching a watched component first. */
  incidents: PlatformIncident[];
}

/** One check of the engine's /health. */
export interface EngineCheck {
  at: string;
  url: string;
  /** 0 when nothing answered. */
  status: number;
  /** 200 and the engine's own `ok: true`. */
  ok: boolean;
  ms: number | null;
  failure: string | null;
  /** What /health said, when it said it as the engine does. */
  body: { ok: boolean; aiMode: string | null; store: string | null; crm: string | null } | null;
}

/** The loopback check, every two minutes, with its last 24 hours. */
export interface EngineLocal extends EngineCheck {
  checks: number;
  passed: number;
  /** The first check in those 24 hours, ISO. */
  since: string;
  /** Time to answer per hour, oldest first; null where no check was answered. */
  spark: (number | null)[];
}

/** The public address, hourly, with its certificate. */
export interface EnginePublic extends EngineCheck {
  cert: { daysLeft: number | null; validTo: string | null; issuer: string | null; trusted: boolean; problem: string | null } | null;
}

/** A figure that only Vercel's dashboard shows, and why the desk cannot read it. */
export interface DashboardLink {
  key: string;
  label: string;
  href: string;
  why: string;
}

export interface HostingTiles {
  /** Today's page views by the drain's rules; `sub` names the range's total. */
  viewsToday: Reading<Stat>;
  /** GA4's page views on the whole days the gap compares. */
  ga4Views: Reading<Stat>;
  gap: Reading<ConsentGap>;
  build: Reading<BuildRow>;
  platform: Reading<PlatformStatus>;
  engine: Reading<EngineLocal>;
}

export interface HostingPayload {
  range: HostingRange;
  /** True when some panels hold artificial specimen rows (?specimen=1, development only); `specimenPanels` names them. */
  specimen: boolean;
  specimenPanels: string[];
  tiles: HostingTiles;
  chart: Reading<ViewsChart>;
  counting: Reading<DrainCounting>;
  /** The rules, always: what would be counted and why, with counts once the drain delivers. */
  rules: ViewRule[];
  pages: Reading<Share[]>;
  referrers: Reading<Share[]>;
  devices: Reading<Share[]>;
  /** The Vercel edge region that served each view: the records carry no country. */
  regions: Reading<Share[]>;
  /** Always off: the request records carry no country, and the desk does not look one up from an IP address. */
  countries: Reading<Share[]>;
  bots: Reading<{ total: number; list: Share[] }>;
  notFound: Reading<{ total: number; list: Share[] }>;
  builds: Reading<BuildRow[]>;
  production: Reading<ProductionNow>;
  domains: Reading<DomainRow[]>;
  attacks: Reading<AttackStatus>;
  platform: Reading<PlatformStatus>;
  engine: { local: Reading<EngineLocal>; public: Reading<EnginePublic> };
  dashboard: DashboardLink[];
}
