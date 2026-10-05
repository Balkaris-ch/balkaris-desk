/**
 * GET /api/v1/seo/automations — the jobs the SEO section runs on, the SEO
 * engine's own and the desk's it depends on, each with what it does, its
 * schedule, its last run, when it runs next and why, and its budget.
 *
 *   GET /api/v1/seo/automations?range=7d|30d|90d|1y    the whole page (SeoAutomationsPayload);
 *                                                      the range is the window of `period`
 *   GET /api/v1/seo/automations/export.csv?range=…     every run of these jobs in the window, as CSV
 *
 * Switching one off or on is the owner's: POST /api/v1/jobs/:name/enabled
 * { enabled } (src/cc/api.ts). Running one now: POST /api/v1/jobs/:name/run.
 * A step in the owner's browser is marked done by a person:
 * POST /api/v1/seo/owner-tasks/:id { done, note? } (src/cc/seo/api.ts).
 *
 * Types only.
 */
import type { ActivityItem, Reading } from "../common";
import type { AutomationRun, FinishedRun, JobSource, JobState } from "../automations";
import type { RunnerState } from "../operator";
import type { OwnerTaskRow, SeoHead, SeoJob, SeoRange } from "./common";

/**
 * Where an SEO job stands: the desk-wide Automations screen's words
 * (contract/automations.ts), and one more.
 *
 *   late   it is on and ready, its time passed more than ten minutes ago and
 *          it has not started. Its last result may well be a success: "late"
 *          is said first, because a job that does not run has nothing new.
 */
export type SeoJobState = JobState | "late";

export interface SeoAutomationsPayload {
  head: SeoHead;
  jobs: SeoJob[];
  /** Running now or asked for, of these jobs. */
  running: number;
  /** The next run of any of them. */
  nextRun: string | null;
  /** What the SEO jobs wrote to the log lately. */
  recent: ActivityItem[];
  /** Work for the lead in the owner's browser (Search Console steps no API offers). */
  chromeTasks: OwnerTaskRow[];

  /* ---- added with the page (src/cc/routes/seo/automations.ts) ---- */

  /** The log's kinds `recent` is read from, for its "View all" on the desk-wide Automations screen. */
  recentKinds: string[];
  /** Why `jobs` is empty when the engine's list could not be read; null when it was read. */
  jobsWhy: string | null;
  /** The job `nextRun` belongs to; null when none of them has a next run. `late` when its time passed more than ten minutes ago. */
  next: { at: string; name: string; title: string; late: boolean } | null;
  /**
   * Each listed job's standing and its last runs, by job name. Read from the
   * scheduler's own run table; when it cannot be read the table still lists
   * `jobs` with their last result.
   */
  runs: Reading<Record<string, SeoJobRuns>>;
  /** These jobs' runs in the last 24 hours. */
  day: Reading<SeoJobsDay>;
  /** What the SEO tools do by themselves, what waits for a person's approval, and what only a person can do. */
  split: Reading<SeoAutomationSplit>;

  /* ---- added so every job says when it runs next, and why it did not ---- */

  /** Whether anything starts by itself on this desk, and what looks after the SEO jobs. */
  scheduler: SeoScheduler;
  /** The head's period, on this page: these jobs' runs and what they found in it. */
  period: Reading<SeoJobsPeriod>;
  /** Log lines of the SEO kinds written in the period (`recent` shows the newest twelve of them). */
  recentInPeriod: number;
}

/** One job's standing and runs, as the desk-wide Automations screen keeps them (contract/automations.ts). */
export interface SeoJobRuns {
  state: SeoJobState;
  /** Until when its source paused it (the speed test after Google's 429); null otherwise. */
  pausedUntil: string | null;
  /** The source it reads, as Settings knows it; null for one Settings does not list (Autocomplete, competitors' pages). */
  source: JobSource | null;
  /** What it asks, in a few words. */
  reads: string;
  /** What it writes. None of them changes the website. */
  writes: string;
  last: FinishedRun | null;
  /**
   * When it starts next by the desk's rules: its regular time (its last
   * start plus its interval), sooner after a failed run or a run a restart
   * cut off (`nextWhy`); for a paused job, when its pause is over. In the past
   * when the job is due or late. Null when it has no next run.
   */
  nextRun: string | null;
  /** Why `nextRun` is when it is; null when there is none. */
  nextWhy: "regular" | "retry" | "again" | null;
  /** Its time (ISO), when that passed more than ten minutes ago and it has not started; null otherwise. */
  lateSince: string | null;
  /** The desk's watch has put it at the front of the scheduler's queue and it has not started yet. */
  queued: { at: string; why: "late" | "retry" | "again" } | null;
  /** With `nextWhy: "retry"`: which try comes next, of how many at most. */
  retry: { attempt: number; of: number } | null;
  /** The start of its newest run, when a restart of the desk cut that run off. */
  cutAt: string | null;
  /** Why no earlier try is planned although its newest run failed or was cut off: more than three failures in a row, or cut off twice in a row. */
  gaveUp: "failed" | "cut" | null;
  /** The last runs, newest first: the scheduler's week, then the desk's own longer copy. */
  recent: AutomationRun[];
  /** Runs started in the last 24 hours. */
  day: { ok: number; failed: number };
  /** Runs started in the head's period. `lastFailed` is the start of the newest failed one. */
  period: { ok: number; failed: number; cut: number; lastFailed: string | null };
  /** Durations of the last finished runs, oldest first, in ms. */
  durations: number[];
  /** From when "Run now" is accepted (the core API's floor); null when it cannot be asked for. */
  askableFrom: string | null;
}

/** Whether jobs start by themselves on this desk. */
export interface SeoScheduler {
  /** False on a desk started with its scheduler switched off (a workstation's copy): nothing starts by itself, Run now still works. */
  on: boolean;
  /** When any job of the desk, SEO or not, last started (ISO); null when none ever has. */
  lastStart: string | null;
  /** On, and nothing at all has started for more than ten minutes although the desk has jobs that run every two. */
  stalled: boolean;
  /** The SEO watch: it asks for a late job, tries a failed one again and runs a cut one again. It runs wherever the scheduler does. */
  watch: {
    on: boolean;
    /** When it last looked (ISO); null before its first look. */
    lastBeat: string | null;
    /** What it asked the scheduler for lately, newest first. */
    asks: { name: string; title: string; at: string; why: "late" | "retry" | "again"; since: string }[];
    /** Its yardsticks, in minutes and counts, so the screen states them as the server keeps them. */
    askAfterMin: number;
    lateAfterMin: number;
    retryAfterMin: number;
    retries: number;
  };
}

/** These jobs over the head's period: their runs, and what they found, counted from the desk's own tables. */
export interface SeoJobsPeriod {
  range: SeoRange;
  days: number;
  /** The first run the desk still holds (ISO): before it nothing was kept, so a longer period counts from here. Null when no run is kept. */
  begins: string | null;
  ok: number;
  failed: number;
  /** Runs a restart of the desk cut off. */
  cut: number;
  /** Runs started per slice of the period, oldest first (thirty slices at most). */
  series: number[];
  /** Days in one slice of `series`. */
  sliceDays: number;
  /** The failed runs of the period, newest first, twenty at most. */
  failures: { job: string; title: string; start: string; note: string | null }[];
  /** What the jobs brought in during the period. A count the desk could not read is left out, never shown as 0. */
  found: { key: string; label: string; value: number; href: string | null; from: string }[];
}

export interface SeoJobsDay {
  ok: number;
  failed: number;
  /** Runs a restart of the desk cut off: they neither finished nor failed. */
  cut: number;
  /** Titles of the jobs whose newest finished run failed. */
  failing: string[];
  /** Titles of the jobs that are late: on, ready, more than ten minutes past their time and not started. */
  late: string[];
  /** Runs started per hour over the last 24 hours, oldest first. */
  series: number[];
}

export interface SeoAutomationSplit {
  /** Runs by itself: the jobs above. */
  automatic: {
    on: number;
    of: number;
    /** Titles of the jobs the owner switched off. */
    off: string[];
    /** Titles of the jobs waiting for their source to be connected. */
    waiting: string[];
  };
  /** Waits for a person's approval: what the operator proposes, in AI Operator › Approvals. */
  approval: {
    /** Proposals (a title and description, or a redirect) waiting for a person. */
    waiting: number;
    /** Proposals approved and written into the website in the last 30 days. */
    applied30: number;
    /** Operator tasks queued and running now, of every kind. */
    queued: number;
    running: number;
    /** Opportunities whose operator task is queued or in progress. */
    inProgress: number;
    /** Where the operator runs, and whether it is on. */
    runner: RunnerState;
  };
  /** Only a person can do it. */
  people: {
    /** "Needs you": the owner's logins, decisions and profiles. */
    owner: { open: number; done: number };
    /** Steps the lead takes by hand in the owner's browser. */
    chrome: { open: number; done: number };
    /** Questions put to AI assistants by hand and recorded. */
    aiChecks: { rows: number; lastDay: string | null };
    /** Monthly exports only a signed-in person can download, imported by the owner. */
    imports: { kind: string; label: string; month: string | null; at: string | null }[];
  };
}
