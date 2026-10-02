/**
 * Automations: what the desk does by itself, and what it did.
 *
 *   GET  /api/v1/automations?kinds=a,b&tone=bad&page=2   the whole screen, one call
 *   POST /api/v1/automations/run-due                     queue every job whose time has come
 *
 * Running one job and switching one on or off are the core API's own routes
 * (POST /api/v1/jobs/:name/run and /jobs/:name/enabled), which check rights.
 *
 * Types only: the server imports this file with `import type`.
 */
import type { ActivityItem, Reading, SourceId, SourceStatus, Stat, Tone } from "./common";

/**
 * Where a job stands, in one word.
 *
 *   running   it is running now
 *   ok        its last finished run succeeded
 *   failed    its last finished run threw
 *   waiting   what it reads is not connected (a key, an API to enable, an
 *             account to add): listed, never run, never failing
 *   paused    its source told the desk to stop for a while (PageSpeed
 *             Insights answered 429): it runs again by itself at `pausedUntil`
 *   off       the owner switched it off
 *   new       ready and on, and has not run yet
 */
export type JobState = "running" | "ok" | "failed" | "waiting" | "paused" | "off" | "new";

/**
 * How one run ended, decided by the desk server, which knows which run is in
 * progress: the scheduler writes no end for a run a restart cut off, so an
 * open row is "running" only when it is the newest run of the job running now.
 */
export type RunState = "running" | "cut" | "ok" | "failed";

/** One run of a job, as the scheduler kept it (a week of them). */
export interface AutomationRun {
  /** ISO. */
  start: string;
  /** ISO, or null while it runs and when a restart cut it off. */
  end: string | null;
  state: RunState;
  /** How long it took, or null while it runs or when a restart cut it off. */
  ms: number | null;
  /** Null while it runs, or when a restart cut it off. */
  ok: boolean | null;
  /** The line the job said about its run, with any credential blanked out. */
  note: string | null;
}

/** The newest run that finished, ok or failed: what "Last run" shows. */
export interface FinishedRun {
  /** ISO, or null when only its end is still known (its row is older than the week kept). */
  start: string | null;
  end: string;
  ms: number | null;
  ok: boolean;
  note: string | null;
}

/** The source a job reads, as Settings knows it. */
export interface JobSource {
  id: SourceId;
  name: string;
  state: SourceStatus["state"];
  /** Why it is not connected, or what its last failure said. */
  reason?: string;
  /** The one step that connects it, when a person has one to take. */
  step?: string;
  /** When it last answered, ISO. */
  lastOk: string | null;
}

/** One scheduled job. */
export interface AutomationJob {
  name: string;
  /** "Read every page of the website". */
  title: string;
  /** What it does, in plain words. */
  does: string;
  /** Seconds between runs. */
  every: number;
  state: JobState;
  enabled: boolean;
  /** False while what it reads is not connected, or while it is paused. */
  ready: boolean;
  running: boolean;
  /** Until when it is paused (ISO), for state "paused"; null otherwise. */
  pausedUntil: string | null;
  /** How far the run in progress has got, as the job reports it. */
  progress: { done: number; of: number; what?: string } | null;
  source: JobSource | null;
  /** When the newest run started, finished or not: the run in progress, or one a restart cut off. */
  lastStart: string | null;
  /** The newest finished run's result, as the scheduler keeps it. */
  lastEnd: string | null;
  lastOk: boolean | null;
  lastNote: string | null;
  /** The newest run that finished, with its own start, length and line; null before the first. */
  last: FinishedRun | null;
  /** When the scheduler starts it next (for a paused job, when its pause ends); null when it has no next run. */
  nextRun: string | null;
  /** Every run and every failure the desk has counted for it. */
  runs: number;
  fails: number;
  /** Runs started in the last 24 hours. */
  day: { ok: number; failed: number };
  /** Durations of the last finished runs, oldest first, in ms. */
  durations: number[];
  /** The last runs, newest first. */
  recent: AutomationRun[];
  /**
   * From when "Run now" would be accepted (ISO): the job is ready, on and
   * not running, and its last start is further back than the core API's
   * floor. Null when it cannot be asked for at all.
   */
  askableFrom: string | null;
}

/** The next job the scheduler will start. */
export interface NextRun {
  at: string;
  name: string;
  title: string;
}

/** One piece of the article writer's work. Titles are the shared articles' own; no sender is named. */
export interface RunnerWork {
  id: number;
  /** "write", "cover", "ingest", "clip", or what the queue says. */
  kind: string;
  /** The shared link's title, or its site when it has none. */
  what: string;
  state: string;
  attempts: number;
  /** ISO times. */
  queued: string;
  taken: string | null;
  finished: string | null;
  /** Why it failed or is stuck, with any credential blanked out. */
  error?: string;
}

/** The workstation's article writer, as the desk's queue knows it. */
export interface Runner {
  /** When it last asked for work (ISO), or null when no runner ever has. */
  lastSeen: string | null;
  /** It asked within the last five minutes. */
  awake: boolean;
  queue: { queued: number; running: number; stuck: number; drafts: number };
  /** What it has taken and not finished. */
  doing: RunnerWork[];
  /** The latest finished, failed or stuck work, newest first. */
  recent: RunnerWork[];
}

/** A commit that last touched a file. */
export interface FileChange {
  sha: string;
  at: string;
  subject: string;
  href: string | null;
}

/**
 * The website's own automation: a GitHub Actions workflow that announces
 * changed addresses after each production deployment. What it does is read
 * from its files in the desk's copy of the website's repository; how its runs
 * went is GitHub's to say, and the desk has no token to ask.
 */
export interface SiteWorkflow {
  file: string;
  script: string;
  fileChange: FileChange | null;
  scriptChange: FileChange | null;
  /** The workflow runs after a successful production deployment. */
  onDeploy: boolean;
  /** It can also be started by hand from the Actions tab. */
  byHand: boolean;
  /** The script compares the new deployment's sitemap with the one before it. */
  compares: boolean;
  /** The script announces to IndexNow. */
  indexNow: boolean;
  /** The script pings Google's WebSub hub for the journal's feed. */
  webSub: boolean;
  /** It pings the hub only when an article's address is among the changed ones. */
  webSubArticlesOnly: boolean;
  /** The feed it pings for, as the script names it. */
  feed: string | null;
  /** The workflow's runs on GitHub. */
  runsHref: string | null;
}

/** One attention rule: what it watches and its yardstick. */
export interface AlertRule {
  id: string;
  title: string;
  /** "SEO", "HEALTH", … when the rule says. */
  area: string | null;
  source: SourceId | null;
  /** The rule in one sentence, with its threshold. */
  rule: string;
  /** Whether it can run now, when the rules module says. */
  state?: "ok" | "waiting" | "off";
  reason?: string;
  step?: string;
}

/** A page of the activity log. */
export interface ActivityPage {
  items: ActivityItem[];
  /** Rows matching the filter. */
  total: number;
  /** 1-based. */
  page: number;
  pages: number;
  per: number;
  /** Every kind in the log with its count, most frequent first. */
  kinds: { kind: string; count: number }[];
  /** Rows per tone, within the kinds asked for. */
  tones: { tone: Tone; count: number }[];
  filter: { kinds: string[]; tone: Tone | null };
}

export interface AutomationsPayload {
  /** True only when the desk answered `?specimen=1` with made-up rows. */
  specimen?: boolean;
  /** When the desk put this together. */
  at: string;
  tiles: {
    jobs: Reading<Stat>;
    succeeded: Reading<Stat>;
    failed: Reading<Stat>;
    waiting: Reading<Stat>;
    next: Reading<NextRun>;
  };
  /** Jobs whose last run failed, for the failed tile's badge. */
  failing: number;
  jobs: Reading<AutomationJob[]>;
  /** Names of the jobs whose time has come (ready, on, not running, next run passed). */
  due: string[];
  runner: Reading<Runner>;
  workflow: Reading<SiteWorkflow>;
  rules: Reading<AlertRule[]>;
  activity: Reading<ActivityPage>;
}

/** What POST /api/v1/automations/run-due answers. */
export interface RunDueAnswer {
  ok: true;
  /** Titles of the jobs put at the front of the queue. */
  asked: string[];
  /** One sentence for the person who pressed it. */
  said: string;
}
