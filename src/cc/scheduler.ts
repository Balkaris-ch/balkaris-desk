import { db } from "../db.ts";
import type { JobStatus } from "../../web/src/contract/common.ts";

/**
 * The box had no scheduler. This is it.
 *
 * A job is a name, an interval and a function. One timer wakes every thirty
 * seconds and runs whatever is due, ONE JOB AT A TIME: the desk lives inside
 * 768 MB beside the engine, and a crawl, a PageSpeed sweep and a Search
 * Console pull starting in the same second is how that ceiling is found.
 *
 * WHEN A JOB LAST RAN IS IN THE DATABASE, not in memory. The desk restarts on
 * every deploy; a scheduler that forgot would re-run everything each time and
 * burn a day's Clarity quota in an afternoon of deploys.
 *
 * A job that throws is a failed run with its message kept, never a crashed
 * process. A job still marked running when the desk starts was cut off by a
 * restart, and is simply due again.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS cc_jobs (
    name       TEXT PRIMARY KEY,
    enabled    INTEGER NOT NULL DEFAULT 1,
    last_start TEXT,
    last_end   TEXT,
    last_ok    INTEGER,
    last_note  TEXT,
    runs       INTEGER NOT NULL DEFAULT 0,
    fails      INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS cc_runs (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    job    TEXT NOT NULL,
    started TEXT NOT NULL,
    ended   TEXT,
    ok     INTEGER,
    note   TEXT
  );
  CREATE INDEX IF NOT EXISTS cc_runs_job ON cc_runs (job, id DESC);
`);

export interface Job {
  /** Stable and short: "crawl", "ga4-live". It is the key in the database. */
  name: string;
  /** What a person reads in Automations: "Read every page". */
  title: string;
  /** Seconds between runs. */
  every: number;
  /**
   * Does the work. May return one line saying what it did ("98 pages, 3
   * changed"), shown beside the run. Throw to fail.
   */
  run: (ctx: { progress: (done: number, of: number, what?: string) => void }) => Promise<string | void>;
  /**
   * False when the job cannot run yet (no credential). It is listed, never
   * run, and never counted as failing.
   */
  ready?: () => boolean;
  /** Seconds after boot before its first run, so a restart is not a stampede. */
  delay?: number;
}

const jobs = new Map<string, Job>();
const progress = new Map<string, { done: number; of: number; what?: string }>();
let running: string | null = null;
const bootedAt = Date.now();
/** Jobs somebody asked to run now, ahead of whatever is merely due. */
const asked: string[] = [];

export function register(...list: Job[]): void {
  for (const j of list) {
    jobs.set(j.name, j);
    db.prepare("INSERT OR IGNORE INTO cc_jobs (name) VALUES (?)").run(j.name);
  }
}

interface Row {
  name: string;
  enabled: number;
  last_start: string | null;
  last_end: string | null;
  last_ok: number | null;
  last_note: string | null;
  runs: number;
  fails: number;
}

const row = (name: string) => db.prepare("SELECT * FROM cc_jobs WHERE name = ?").get(name) as Row | undefined;

function due(j: Job, r: Row | undefined, now: number): boolean {
  if (!r?.enabled) return false;
  if (j.ready && !j.ready()) return false;
  if (now - bootedAt < (j.delay ?? 20) * 1000) return false;
  if (!r.last_start) return true;
  return now - Date.parse(r.last_start) >= j.every * 1000;
}

async function runOne(j: Job): Promise<void> {
  running = j.name;
  const start = new Date().toISOString();
  db.prepare("UPDATE cc_jobs SET last_start = ? WHERE name = ?").run(start, j.name);
  const run = db.prepare("INSERT INTO cc_runs (job, started) VALUES (?, ?)").run(j.name, start);
  let okRun = true;
  let noteText: string | null = null;
  try {
    const said = await j.run({
      progress: (done, of, what) => progress.set(j.name, { done, of, ...(what ? { what } : {}) }),
    });
    noteText = typeof said === "string" ? said.slice(0, 300) : null;
  } catch (e) {
    okRun = false;
    noteText = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    console.warn(`cc job ${j.name} failed: ${noteText}`);
  }
  const end = new Date().toISOString();
  db.prepare(
    "UPDATE cc_jobs SET last_end = ?, last_ok = ?, last_note = ?, runs = runs + 1, fails = fails + ? WHERE name = ?",
  ).run(end, okRun ? 1 : 0, noteText, okRun ? 0 : 1, j.name);
  db.prepare("UPDATE cc_runs SET ended = ?, ok = ?, note = ? WHERE id = ?").run(end, okRun ? 1 : 0, noteText, run.lastInsertRowid);
  /* A week of runs is plenty to answer "when did this start failing". */
  db.prepare("DELETE FROM cc_runs WHERE started < ?").run(new Date(Date.now() - 7 * 86_400_000).toISOString());
  progress.delete(j.name);
  running = null;
}

async function tick(): Promise<void> {
  if (running) return;
  const now = Date.now();
  const first = asked.shift();
  const next = (first && jobs.get(first)) || [...jobs.values()].find((j) => due(j, row(j.name), now));
  if (!next) return;
  await runOne(next);
}

let timer: NodeJS.Timeout | null = null;

/** Start waking. Called once, by the server, after every module registered. */
export function start(): void {
  if (timer || process.env.CC_SCHEDULER === "off") return;
  timer = setInterval(() => void tick(), 30_000);
  timer.unref();
  setTimeout(() => void tick(), 5_000).unref();
}

/** Run a job now, ahead of the queue. False when there is no such job. */
export function runNow(name: string): boolean {
  const j = jobs.get(name);
  if (!j || (j.ready && !j.ready())) return false;
  /* A job the owner switched off stays off, whoever asks. */
  if (!row(name)?.enabled) return false;
  if (!asked.includes(name) && running !== name) asked.push(name);
  setTimeout(() => void tick(), 50).unref();
  return true;
}

export function setEnabled(name: string, enabled: boolean): void {
  db.prepare("UPDATE cc_jobs SET enabled = ? WHERE name = ?").run(enabled ? 1 : 0, name);
}

export function status(): (JobStatus & { ready: boolean; progress: { done: number; of: number; what?: string } | null })[] {
  return [...jobs.values()].map((j) => {
    const r = row(j.name);
    const ready = j.ready ? j.ready() : true;
    const last = r?.last_start ? Date.parse(r.last_start) : null;
    return {
      name: j.name,
      title: j.title,
      every: j.every,
      enabled: !!r?.enabled,
      running: running === j.name,
      lastStart: r?.last_start ?? null,
      lastEnd: r?.last_end ?? null,
      lastOk: r?.last_ok == null ? null : !!r.last_ok,
      lastNote: r?.last_note ?? null,
      nextRun: !ready || !r?.enabled ? null : new Date(last ? last + j.every * 1000 : Math.max(Date.now(), bootedAt + (j.delay ?? 20) * 1000)).toISOString(),
      runs: r?.runs ?? 0,
      fails: r?.fails ?? 0,
      ready,
      progress: progress.get(j.name) ?? null,
    };
  });
}

export function history(job: string, limit = 20): { start: string; end: string | null; ok: boolean | null; note: string | null }[] {
  const rows = db.prepare("SELECT started AS start, ended AS end, ok, note FROM cc_runs WHERE job = ? ORDER BY id DESC LIMIT ?").all(job, limit) as {
    start: string;
    end: string | null;
    ok: number | null;
    note: string | null;
  }[];
  return rows.map((r) => ({ start: r.start, end: r.end, ok: r.ok == null ? null : !!r.ok, note: r.note }));
}
