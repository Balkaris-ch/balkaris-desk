/**
 * What the desk server tells the interface, and how it says "I do not know".
 *
 * THE RULE THIS FILE EXISTS FOR. Every figure on a desk screen is either read
 * from a real source or it is absent with the reason written beside it. There
 * is no third state. A zero means "the source says zero"; it never means "no
 * source". So nothing here is a bare number: it is a `Reading`, and a reading
 * that is not `ok` carries, in words a person can act on, what is missing and
 * what would connect it.
 *
 * Types only. The server imports this file with `import type`, so nothing in
 * it may exist at runtime: no enums, no constants, no functions.
 */

/** The ranges the top bar offers. Site Health also offers the two short ones. */
export type Range = "1h" | "24h" | "7d" | "30d" | "90d" | "1y";

/** Where a figure comes from. Shown beside it, and listed in Settings. */
export type SourceId =
  | "ga4" /* Google Analytics 4 Data API: consenting visitors only */
  | "ga4-live" /* GA4 realtime report */
  | "gsc" /* Google Search Console API */
  | "bing" /* Bing Webmaster API */
  | "clarity" /* Microsoft Clarity data export */
  | "psi" /* PageSpeed Insights: a lab run on Google's machines */
  | "crux" /* Chrome UX Report: field data, if Google has any for the site */
  | "crawl" /* the desk's own read of every page in the sitemap */
  | "probe" /* the desk's own uptime and response checks */
  | "repo" /* the website's git history and files */
  | "engine" /* enquiries, read from the engine */
  | "desk" /* the desk's own database: links, drafts, jobs, events */
  | "runner" /* the workstation and its local model */
  | "none"; /* no free source exists */

/**
 * A figure, or the reason there is none.
 *
 *   ok       read from the source; `asOf` is when, `note` is the caveat that
 *            belongs to the number (for example "consenting visitors only").
 *   waiting  the source is connected and has nothing to say yet: history that
 *            starts today, a first run that has not finished.
 *   off      the source is not connected, or cannot give this. `step` says
 *            what would change that, in one plain sentence, or is absent when
 *            nothing would (no free source exists).
 */
export type Reading<T> =
  | { state: "ok"; value: T; source: SourceId; asOf: string; note?: string }
  | { state: "waiting"; source: SourceId; reason: string }
  | { state: "off"; source: SourceId; reason: string; step?: string };

/** One headline figure with what it was before and the line behind it. */
export interface Stat {
  value: number;
  /** The same figure for the period before, or null when there is none yet. */
  previous: number | null;
  /** How to print it. `count` is a whole number. */
  unit: "count" | "percent" | "ms" | "s" | "score" | "ratio";
  /** The line or bars drawn beside the figure, oldest first. May be empty. */
  series: number[];
  /** The "/ 192" beside a figure, when it is a part of a whole. */
  of?: number;
  /** A small line under the figure ("+10 this month"). Real, or absent. */
  sub?: string;
}

/** One day of something, with the same day one period earlier. */
export interface DayPoint {
  /** YYYY-MM-DD */
  date: string;
  value: number;
  previous?: number | null;
}

/** A named part of a whole: one slice, one bar. */
export interface Share {
  key: string;
  label: string;
  value: number;
}

export type Tone = "good" | "warn" | "bad" | "info" | "quiet";

/** A row in "Attention required". Always produced by a stated rule. */
export interface AttentionItem {
  id: string;
  /** A page address or a short subject. */
  subject: string;
  /** What the rule found, with the two figures it compared. */
  text: string;
  area: "SEO" | "CONVERSION" | "HEALTH" | "CONTENT" | "PAGES";
  tone: Tone;
  /** Where the button goes. */
  action: { label: string; href: string };
  source: SourceId;
}

/** A row in an activity or incident list. Something that happened. */
export interface ActivityItem {
  id: number;
  /** ISO time. */
  at: string;
  kind: string;
  tone: Tone;
  text: string;
  /** A second line, when there is one. */
  detail?: string;
  href?: string;
  /** Who did it: a person's name, "desk", "runner". */
  actor?: string;
}

/** Who is looking, as the interface needs to know them. */
export interface Me {
  name: string;
  email: string | null;
  owner: boolean;
  canPublish: boolean;
  /** May read enquiries (names, contact details, messages). */
  seesLeads: boolean;
}

/** One source in Settings and behind "All systems operational". */
export interface SourceStatus {
  id: SourceId;
  name: string;
  state: "connected" | "waiting" | "off" | "failing";
  /** What it feeds, in a few words. */
  feeds: string;
  /** When it last answered, ISO, or null. */
  lastOk: string | null;
  /** The last error, when failing. */
  error?: string;
  /** What connects it, when off. One sentence, a person's step. */
  step?: string;
}

/** The top bar's light. */
export interface SystemStatus {
  /** Nothing is failing. Says nothing about whether anything was checked: read `checked` for that. */
  ok: boolean;
  /**
   * How many things the light stands on: checks that vouched (the workstation's
   * heartbeat is not one) plus sources that answered, well or failing. 0 means
   * nothing has been checked yet, and the light is then neither green nor red.
   */
  checked: number;
  /** "All systems operational", or the name of what is not. */
  line: string;
  checks: { name: string; ok: boolean; detail: string }[];
  sources: SourceStatus[];
  /** Unread things for the bell. */
  notices: ActivityItem[];
}

/** One scheduled job, as Automations and Site Health list it. */
export interface JobStatus {
  name: string;
  title: string;
  /** Seconds between runs. */
  every: number;
  enabled: boolean;
  running: boolean;
  lastStart: string | null;
  lastEnd: string | null;
  lastOk: boolean | null;
  lastNote: string | null;
  nextRun: string | null;
  runs: number;
  fails: number;
}

/** A job as GET /api/v1/jobs lists it. */
export type JobListed = JobStatus & {
  /** False while what it reads is not connected: listed, never run, never failing. */
  ready: boolean;
  /** How far the run in progress has got, as the job reports it; null when it is not running or says nothing. */
  progress: { done: number; of: number; what?: string } | null;
};

/** What POST /api/v1/jobs/:name/run (202) and /jobs/:name/enabled (200) answer. */
export interface JobAnswer {
  ok: true;
  job: JobListed;
}

/** A search hit in the top bar. */
export interface SearchHit {
  kind: "page" | "insight" | "keyword" | "lead" | "asset" | "section";
  title: string;
  sub?: string;
  href: string;
}

/** Every error the API returns has this shape. */
export interface ApiError {
  error: string;
}
