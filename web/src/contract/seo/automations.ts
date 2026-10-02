/**
 * GET /api/v1/seo/automations — the jobs the SEO section runs on, the SEO
 * engine's own and the desk's it depends on, each with what it does, its
 * schedule, its last run and its budget.
 *
 * Switching one off or on is the owner's: POST /api/v1/jobs/:name/enabled
 * { enabled } (src/cc/api.ts). Running one now: POST /api/v1/jobs/:name/run.
 * A step in the owner's browser is marked done by a person:
 * POST /api/v1/seo/owner-tasks/:id { done } (src/cc/seo/api.ts).
 *
 * Types only.
 */
import type { ActivityItem, Reading } from "../common";
import type { AutomationRun, FinishedRun, JobSource, JobState } from "../automations";
import type { RunnerState } from "../operator";
import type { OwnerTaskRow, SeoHead, SeoJob } from "./common";

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
  /** The job `nextRun` belongs to; null when none of them has a next run. */
  next: { at: string; name: string; title: string } | null;
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
}

/** One job's standing and runs, as the desk-wide Automations screen keeps them (contract/automations.ts). */
export interface SeoJobRuns {
  state: JobState;
  /** Until when its source paused it (the speed test after Google's 429); null otherwise. */
  pausedUntil: string | null;
  /** The source it reads, as Settings knows it; null for one Settings does not list (Autocomplete, competitors' pages). */
  source: JobSource | null;
  /** What it asks, in a few words. */
  reads: string;
  /** What it writes. None of them changes the website. */
  writes: string;
  last: FinishedRun | null;
  /** When the scheduler starts it next; for a paused job, when its pause is over. Null when it has no next run. */
  nextRun: string | null;
  /** The last runs, newest first (the scheduler keeps a week). */
  recent: AutomationRun[];
  /** Runs started in the last 24 hours. */
  day: { ok: number; failed: number };
  /** Durations of the last finished runs, oldest first, in ms. */
  durations: number[];
  /** From when "Run now" is accepted (the core API's floor); null when it cannot be asked for. */
  askableFrom: string | null;
}

export interface SeoJobsDay {
  ok: number;
  failed: number;
  /** Runs a restart of the desk cut off: they neither finished nor failed. */
  cut: number;
  /** Titles of the jobs whose newest finished run failed. */
  failing: string[];
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
