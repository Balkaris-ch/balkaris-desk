import { db } from "../../db.ts";
import { hasKey } from "../gauth.ts";
import type { Job } from "../scheduler.ts";
import { history, runNow, status as jobStatus } from "../scheduler.ts";
import * as gsc from "../search/gsc.ts";
import { countOn, dayIn } from "../search/shared.ts";
import { crawledAt } from "../site/index.ts";
import { registerCheck } from "../sources.ts";
import { note, setState, state } from "../store.ts";
import { scrub } from "../system.ts";
import type { SeoJob } from "../../../web/src/contract/seo/common.ts";
import { readReferrals } from "./aisearch.ts";
import { refreshPages } from "./competitors.ts";
import { runEngine, syncLinks } from "./engine.ts";
import { AUTOCOMPLETE_CAP, budget, research, syncFromSearch } from "./keywords.ts";
import { checkProfiles } from "./presence.ts";
import { runSnapshot } from "./rank.ts";
import { checkReadiness } from "./readiness.ts";
import { json } from "./tables.ts";

/**
 * The SEO engine's scheduled jobs. Exported as a collector by ./index.ts and
 * registered by src/cc/index.ts with every other collector, so they run on the
 * desk's one scheduler, one job at a time (src/cc/scheduler.ts).
 *
 *   seo-snapshot     every 6 h    Search Console's newest final days into the history
 *                                (the first run back-fills from the property's first day)
 *   seo-engine       every 15 min the opportunity rules, over everything kept, whenever
 *                                something it reads has changed (a crawl, a Search
 *                                Console refresh, the index check, a snapshot, the
 *                                readiness check, a person's decision), and at least
 *                                every 6 h; in between it only follows its tasks
 *   seo-readiness    every 24 h   AI readiness of every sitemap page, and the site
 *   seo-referrals    every 24 h   GA4 referrals and AI-assistant sessions
 *   seo-research     every 24 h   Google Autocomplete for the clusters' seeds:
 *                                20 requests a run, 120 a week at most
 *   seo-competitors  every 7 d    competitors' pages for our clusters, politely
 *   seo-presence     every 7 d    the studio's profiles and listings
 *
 * The index check's history is the desk's own gsc-inspect job (src/cc/search/
 * gsc.ts): it keeps every sitemap address's URL Inspection result per day for
 * 400 days, and indexation.ts reads it.
 *
 * THE WATCH (further down). The scheduler starts ONE job per thirty-second
 * wake and takes the first due job in the order the collectors registered,
 * and this collector registers last. On the live desk the jobs before it asked
 * for 122 starts an hour against 120 wakes, so from 3 Oct 2026 18:39 UTC no
 * wake was left over: the daily readiness and referral jobs were passed over
 * for as long as that lasted, a failed index check waited a whole day for its
 * next try, and a run a restart cut off waited a whole interval. The watch is
 * the SEO section looking after its own jobs through the door a person's "Run
 * now" uses (`runNow`, which goes ahead of whatever is merely due): it asks
 * for a job that is late, tries a failed one again, and runs a cut one again.
 * It also keeps these jobs' runs longer than the scheduler's week.
 */

/** Requests to Autocomplete one run may make: the week's 120 spread over the days. */
const RESEARCH_PER_RUN = 20;

/**
 * The jobs whose results the engine reads: a run of any of them is new input.
 * Not the quarter-hourly sitemap read: the crawl and the readiness check carry
 * what the engine takes from the sitemap, and four whole runs an hour would
 * make "only on news" mean nothing.
 */
export const ENGINE_INPUTS = ["crawl", "gsc-daily", "gsc-inspect", "seo-snapshot", "seo-readiness", "seo-research", "seo-competitors", "seo-presence"];
/** The engine runs whole at least this often, new input or not. */
const ENGINE_WHOLE_MS = 6 * 3600_000;
const ENGINE_LAST = "seo:engine:last";

/** The newest decision a person (or the operator) made in the engine's tables: a status, a mapping, a state, a done mark. */
function lastDecision(): string | null {
  const r = db
    .prepare(
      `SELECT MAX(at) AS at FROM (
         SELECT MAX(state_at) AS at FROM cc_seo_opps
         UNION ALL SELECT MAX(status_at) FROM cc_seo_keywords
         UNION ALL SELECT MAX(updated_at) FROM cc_seo_clusters
         UNION ALL SELECT MAX(COALESCE(done_at, updated_at)) FROM cc_seo_owner_tasks
         UNION ALL SELECT MAX(updated_at) FROM cc_seo_profiles
       )`,
    )
    .get() as { at: string | null };
  return r.at;
}

/**
 * How many owner tasks there are and how many are done, as one word. "Open
 * again" on a task clears its done mark and moves no time stamp (owner.ts
 * `markOwnerTask`), so the newest decision above does not see it; this count
 * does, and the engine then finds the task's opportunity again at its next
 * look instead of up to six hours later.
 */
function taskMarks(): string {
  try {
    const r = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(done), 0) AS d FROM cc_seo_owner_tasks").get() as { n: number; d: number };
    return `${r.n}:${r.d}`;
  } catch {
    return "";
  }
}

type EngineLast = { at: string; line: string; tasks?: string };

/**
 * Why the engine should run whole now, or null when nothing it reads changed
 * since its last whole run (and that run is under six hours old).
 */
export function engineDue(nowMs = Date.now()): string | null {
  const last = json<EngineLast | null>(state(ENGINE_LAST), null);
  if (!last) return "its first run";
  if (nowMs - Date.parse(last.at) >= ENGINE_WHOLE_MS) return "six hours since its last whole run";
  const fresh = jobStatus().filter((j) => ENGINE_INPUTS.includes(j.name) && j.lastEnd && j.lastOk && j.lastEnd > last.at);
  if (fresh.length) return `new input from ${fresh.map((j) => j.name).join(", ")}`;
  const decided = lastDecision();
  if (decided && decided > last.at) return "a decision made since its last run";
  /* A run kept before this count existed has none: it is not news. */
  if (last.tasks !== undefined && last.tasks !== taskMarks()) return "an owner task marked done or opened again since its last run";
  return null;
}

/** The engine's job: whole when something changed, else only following its operator tasks. */
async function engineJob(progress: (done: number, of: number, what?: string) => void): Promise<string> {
  const why = engineDue();
  if (!why) {
    const moved = syncLinks();
    const last = json<EngineLast | null>(state(ENGINE_LAST), null);
    return `Nothing it reads changed since its run at ${last?.at.slice(11, 16) ?? "?"} UTC${moved ? `; ${moved} opportunit${moved === 1 ? "y" : "ies"} moved with their operator tasks` : ""}. That run: ${last?.line ?? "?"}`;
  }
  /* The marks as they stand BEFORE the run reads them: one changed while it runs is news for the next look. */
  const tasks = taskMarks();
  const line = await runEngine(progress);
  setState(ENGINE_LAST, JSON.stringify({ at: new Date().toISOString(), line, tasks } satisfies EngineLast));
  return line;
}

export const jobs: Job[] = [
  {
    name: "seo-snapshot",
    title: "Keep Search Console's daily rankings",
    every: 6 * 3600,
    delay: 150,
    ready: gsc.configured,
    run: async ({ progress }) => {
      const said = await runSnapshot(progress);
      const s = syncFromSearch();
      return `${said}${s.added ? `; ${s.added} new search queries in the keyword table` : ""}`;
    },
  },
  {
    name: "seo-engine",
    title: "Find SEO opportunities",
    every: 15 * 60,
    delay: 240,
    run: ({ progress }) => engineJob(progress),
  },
  {
    name: "seo-readiness",
    title: "Check every page for AI search readiness",
    every: 24 * 3600,
    delay: 600,
    ready: () => !!crawledAt(),
    run: ({ progress }) => checkReadiness(progress),
  },
  {
    name: "seo-referrals",
    title: "Read referrals and AI assistant visits from GA4",
    every: 24 * 3600,
    delay: 420,
    ready: hasKey,
    run: () => readReferrals(),
  },
  {
    name: "seo-research",
    title: "Research search phrases in Google Autocomplete",
    every: 24 * 3600,
    delay: 1800,
    run: ({ progress }) => research({ most: RESEARCH_PER_RUN, progress }),
  },
  {
    name: "seo-competitors",
    title: "Read competitors' pages for our topics",
    every: 7 * 24 * 3600,
    delay: 1200,
    run: ({ progress }) => refreshPages(progress),
  },
  {
    name: "seo-presence",
    title: "Check the studio's profiles and listings",
    every: 7 * 24 * 3600,
    delay: 1500,
    run: ({ progress }) => checkProfiles(progress),
  },
];

/** What each job the SEO section depends on does, in a sentence or two. */
const WHAT: Record<string, { what: string; group: "seo" | "desk" }> = {
  "seo-snapshot": { what: "Asks Search Console for each day it has finished counting (two to three days behind) and keeps every query, page, device and country row, for all countries and for Switzerland. The first run went back to the property's first day; the history outlives Google's sixteen months.", group: "seo" },
  "seo-engine": {
    what: "Runs the opportunity rules (src/cc/seo/rules.ts) over the history, the crawl, the index check, the readiness check and the owner tasks whenever one of them has news (looked at every quarter of an hour, whole at least every six hours), and moves each opportunity along with its operator task. Keeps every person's decision.",
    group: "seo",
  },
  "seo-readiness": { what: "Reads every sitemap page as a crawler gets it, one at a time, and checks what AI search needs: a direct answer, questions, structured data, a price, a date, a German version; and robots.txt, llms.txt, lastmod, Bing, the Business Profile, the address.", group: "seo" },
  "seo-referrals": { what: "Reads GA4 sessions from referring sites and AI assistants by day and landing page (consenting visitors only). One report a day.", group: "seo" },
  "seo-research": { what: `Expands the clusters' seed phrases through Google Autocomplete, one request a second, ${RESEARCH_PER_RUN} a run and never more than ${AUTOCOMPLETE_CAP} a week (the counter refuses beyond it). New phrases are kept unjudged.`, group: "seo" },
  "seo-competitors": { what: "Reads the competitor pages captured for our clusters: robots.txt first and obeyed, two seconds between requests to a site, the desk's name on every request. Keeps title, heading, words, language, structured data and whether a price is stated.", group: "seo" },
  "seo-presence": { what: "Asks each known profile and listing address once a week: exists, not found, or could not be read, with the reason.", group: "seo" },
  crawl: { what: "Reads every page of the website: facts, links, findings and the site score. The engine's technical, thin-content and internal-link rules read it.", group: "desk" },
  sitemap: { what: "Reads sitemap.xml and robots.txt every quarter of an hour.", group: "desk" },
  "gsc-daily": { what: "Refreshes the Search Console figures the screens show, twice a day.", group: "desk" },
  "gsc-inspect": { what: "Asks Google's URL Inspection about every sitemap address once a day and keeps each day's answer for 400 days: the index history the indexation driver groups and follows.", group: "desk" },
  speed: { what: "PageSpeed lab runs of the most important pages, once a day.", group: "desk" },
  "crux-daily": { what: "Asks Google's Chrome UX Report once a day what real Chrome visitors experienced over 28 days (loading, responsiveness, layout shift). Google has no such figures for a site until enough people visit it in Chrome; SEO › Technical shows them when it does.", group: "desk" },
  "bing-daily": { what: "Bing Webmaster's links and figures: waits for its key.", group: "desk" },
};

/** The jobs the SEO section runs on, as Automations and the Overview list them. */
export function seoJobs(): SeoJob[] {
  const all = jobStatus();
  const b = budget();
  /* gsc.ts keeps its own count of inspections per Pacific day. */
  const inspected = countOn("gsc.inspect.used", dayIn("America/Los_Angeles"));
  return Object.keys(WHAT).flatMap((name) => {
    const j = all.find((x) => x.name === name);
    if (!j) return [];
    return [
      {
        ...j,
        lastNote: j.lastNote === null ? null : scrub(j.lastNote),
        progress: j.progress?.what ? { ...j.progress, what: scrub(j.progress.what) } : j.progress,
        what: WHAT[name]!.what,
        group: WHAT[name]!.group,
        budget:
          name === "seo-research"
            ? { used: b.used, cap: b.cap, period: "week" as const, line: `Google Autocomplete: ${b.used} of ${b.cap} requests this week (${b.week})` }
            : name === "gsc-inspect"
              ? { used: inspected, cap: 1800, period: "day" as const, line: `URL Inspection: ${inspected} of the desk's 1,800 today (Google allows 2,000 a day per property)` }
              : null,
      },
    ];
  });
}

/** The names of the jobs the SEO section depends on: what the watch looks after and the run history keeps. */
export const watched = (): string[] => Object.keys(WHAT);

/* ---------- the runs, kept longer than the scheduler's week ---------------------------- */

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
/** How long a run is kept, and how many of one job at most (a quarter-hourly job fills a month with them). */
const KEEP_DAYS = 400;
const KEEP_ROWS = 3000;

export interface KeptRun {
  start: string;
  end: string | null;
  /** Null while it runs, and for a run a restart of the desk cut off. */
  ok: boolean | null;
  note: string | null;
}

let prunedAt = 0;

/**
 * Copy these jobs' runs from the scheduler's table (cc_runs, one week) into
 * the engine's own (cc_seo_job_runs, 400 days), so a weekly job's last runs
 * can be read and "when did this start failing" has an answer older than a
 * week. Called by the watch every minute; safe to call at any time. Returns
 * how many rows it wrote.
 */
export function keepRuns(nowMs = Date.now()): number {
  const names = watched();
  const marks = names.map(() => "?").join(",");
  /* Two days back catches a run that was open at the last copy and has ended since; the first copy takes all there is. */
  const any = db.prepare("SELECT 1 AS x FROM cc_seo_job_runs LIMIT 1").get();
  const from = any ? new Date(nowMs - 2 * DAY_MS).toISOString() : "";
  const r = db
    .prepare(
      `INSERT INTO cc_seo_job_runs (job, started, ended, ok, note)
         SELECT job, started, ended, ok, note FROM cc_runs WHERE job IN (${marks}) AND started >= ?
       ON CONFLICT(job, started) DO UPDATE SET ended = excluded.ended, ok = excluded.ok, note = excluded.note`,
    )
    .run(...names, from);
  if (nowMs - prunedAt >= 3600_000) {
    prunedAt = nowMs;
    db.prepare("DELETE FROM cc_seo_job_runs WHERE started < ?").run(new Date(nowMs - KEEP_DAYS * DAY_MS).toISOString());
    db.prepare(
      `DELETE FROM cc_seo_job_runs WHERE rowid IN (
         SELECT rowid FROM (SELECT rowid, ROW_NUMBER() OVER (PARTITION BY job ORDER BY started DESC) AS n FROM cc_seo_job_runs) WHERE n > ?
       )`,
    ).run(KEEP_ROWS);
  }
  return Number(r.changes);
}

/** The oldest run the scheduler's own table still holds: what is older is read from the kept copy. */
function liveEdge(): string {
  return (db.prepare("SELECT MIN(started) AS s FROM cc_runs").get() as { s: string | null }).s ?? "9999";
}

/** One job's runs, newest first: the scheduler's own rows, then the kept ones older than those. */
export function runsOf(name: string, limit = 20): KeptRun[] {
  const live = history(name, limit);
  if (live.length >= limit) return live;
  const before = live.at(-1)?.start ?? "9999";
  const kept = db
    .prepare("SELECT started AS start, ended AS end, ok, note FROM cc_seo_job_runs WHERE job = ? AND started < ? ORDER BY started DESC LIMIT ?")
    .all(name, before, limit - live.length) as { start: string; end: string | null; ok: number | null; note: string | null }[];
  return [...live, ...kept.map((r) => ({ start: r.start, end: r.end, ok: r.ok === null ? null : !!r.ok, note: r.note }))];
}

/**
 * Every run of the watched jobs that started at or after `since`, newest
 * first, from both tables without counting one twice: the export, and what
 * the period's counts are made from.
 */
export function runsSince(since: string, limit = 20_000, o: { failed?: boolean } = {}): (KeptRun & { job: string })[] {
  const names = watched();
  const marks = names.map(() => "?").join(",");
  const only = o.failed ? " AND ok = 0" : "";
  const rows = db
    .prepare(
      `SELECT job, started AS start, ended AS end, ok, note FROM cc_runs WHERE started >= ? AND job IN (${marks})${only}
       UNION ALL
       SELECT job, started, ended, ok, note FROM cc_seo_job_runs WHERE started >= ? AND started < ? AND job IN (${marks})${only}
       ORDER BY start DESC LIMIT ?`,
    )
    .all(since, ...names, since, liveEdge(), ...names, limit) as { job: string; start: string; end: string | null; ok: number | null; note: string | null }[];
  return rows.map((r) => ({ job: r.job, start: r.start, end: r.end, ok: r.ok === null ? null : !!r.ok, note: r.note }));
}

/**
 * The same runs counted per job and UTC day, in the database rather than row
 * by row: a year of a quarter-hourly job is thousands of rows. A run that is
 * neither ok nor failed has no end: cut off by a restart, or the one running now.
 */
export function runTally(since: string): { job: string; day: string; ok: number; failed: number; open: number; lastFailed: string | null }[] {
  const names = watched();
  const marks = names.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT job, substr(started, 1, 10) AS day,
              SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS ok,
              SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failed,
              SUM(CASE WHEN ok IS NULL THEN 1 ELSE 0 END) AS open,
              MAX(CASE WHEN ok = 0 THEN started END) AS lastFailed
         FROM (
           SELECT job, started, ok FROM cc_runs WHERE started >= ? AND job IN (${marks})
           UNION ALL
           SELECT job, started, ok FROM cc_seo_job_runs WHERE started >= ? AND started < ? AND job IN (${marks})
         )
        GROUP BY job, day`,
    )
    .all(since, ...names, since, liveEdge(), ...names) as { job: string; day: string; ok: number; failed: number; open: number; lastFailed: string | null }[];
}

/** The first run of a watched job the desk still holds, in either table: where the run history honestly begins. */
export function runsBegin(): string | null {
  const names = watched();
  const marks = names.map(() => "?").join(",");
  const r = db
    .prepare(`SELECT MIN(s) AS s FROM (SELECT MIN(started) AS s FROM cc_runs WHERE job IN (${marks}) UNION ALL SELECT MIN(started) FROM cc_seo_job_runs WHERE job IN (${marks}))`)
    .get(...names, ...names) as { s: string | null };
  return r.s;
}

/* ---------- the watch ------------------------------------------------------------------- */

/** The watch's yardsticks, in one place so the screen and the check script say the same numbers. */
export const WATCH = {
  /** How often it looks. */
  beatMs: MIN_MS,
  /** After the desk starts it asks for nothing this long: every desk job's own start delay (eight minutes at most) has passed by then, so a restart is still not a stampede. */
  settleMs: 10 * MIN_MS,
  /** A job this far past its time is asked for: the scheduler has then passed it over at six wakes. */
  askAfterMs: 3 * MIN_MS,
  /** A job this far past its time is shown as late. */
  lateAfterMs: 10 * MIN_MS,
  /** A job this far past its time turns the top bar's light. */
  alarmAfterMs: 30 * MIN_MS,
  /** A failed run is tried again after this long, when the job's own interval is longer... */
  retryMs: 30 * MIN_MS,
  /** ...at most this many times in a row; after that it waits for its regular time. */
  retries: 3,
  /** A run a restart cut off is run again once the desk has settled, at the earliest this long after it began. */
  againMs: 2 * MIN_MS,
  /** An ask is given this long to start before the watch asks again. */
  pendingMs: 10 * MIN_MS,
} as const;

/** Why a job's next start is when it is: its regular time, another try after a failed run, or again after a restart cut it off. */
export type NextWhy = "regular" | "retry" | "again";

export interface Standing {
  /** When it should start next by the desk's rules (ISO); null when it has no next start (off, not ready, running, or never run on a desk without a scheduler). */
  dueAt: string | null;
  why: NextWhy | null;
  /** Its time, when that passed more than ten minutes ago and it has not started; null otherwise. */
  lateSince: string | null;
  /** Failed runs in a row, newest first (0 when its newest run did not fail). */
  failsInRow: number;
  /** The start of the run a restart cut off, when its newest run is one. */
  cutAt: string | null;
  /** Why no earlier try is planned although its newest run failed or was cut: it failed more than three times in a row, or was cut twice in a row. */
  gaveUp: "failed" | "cut" | null;
}

/** What the watch asked the scheduler for. */
export interface WatchAsk {
  name: string;
  title: string;
  /** When it asked (ISO). */
  at: string;
  why: "late" | "retry" | "again";
  /** The time the job should have started (ISO). */
  since: string;
}

const w: { bootAt: number; timer: NodeJS.Timeout | null; lastBeat: number | null; pending: WatchAsk | null } = {
  bootAt: Date.now(),
  timer: null,
  lastBeat: null,
  pending: null,
};

const ASKS_KEY = "seo:jobs:watch";
const NOTHING: Standing = { dueAt: null, why: null, lateSince: null, failsInRow: 0, cutAt: null, gaveUp: null };

type Listed = ReturnType<typeof jobStatus>[number];

/** Is the watch running: it runs wherever the scheduler does, and nowhere else. */
export const watching = (): boolean => w.timer !== null;

/**
 * The scheduler starts nothing of a job before its own delay after the desk
 * started. The engine's own delays are known here; the desk's other jobs' are
 * not (the scheduler does not say), and are all past by the watch's settle time.
 */
const ownDelayMs = (name: string): number => {
  const j = jobs.find((x) => x.name === name);
  return j ? (j.delay ?? 20) * 1000 : 0;
};

/**
 * Where one job stands: when it should start next and why, and whether it is
 * late. `on` is whether the watch runs: without it (a desk whose scheduler is
 * switched off) no retry and no second run after a cut will happen, so none
 * is promised, and a job's time is simply its last start plus its interval.
 */
function stand(j: Listed, rows: KeptRun[], nowMs: number, on: boolean): Standing {
  if (!j.enabled || !j.ready || j.running) return NOTHING;
  const last = j.lastStart ? Date.parse(j.lastStart) : null;
  let cuts = 0;
  while (cuts < rows.length && rows[cuts]!.ok === null) cuts++;
  let fails = 0;
  if (!cuts) {
    while (fails < rows.length && rows[fails]!.ok === false) fails++;
    /* The run table has dropped it, the job's own row still says so. */
    if (!fails && j.lastOk === false) fails = 1;
  }
  const startable = on ? w.bootAt + ownDelayMs(j.name) : 0;
  if (last === null) {
    /* Never run. With a scheduler its time is the end of its start delay; without one it has no time at all. */
    if (!on) return NOTHING;
    const first = w.bootAt + (ownDelayMs(j.name) || WATCH.settleMs);
    return { ...NOTHING, dueAt: new Date(first).toISOString(), why: "regular", lateSince: nowMs - first >= WATCH.lateAfterMs ? new Date(first).toISOString() : null };
  }
  const regular = last + j.every * 1000;
  let when = regular;
  let why: NextWhy = "regular";
  let gaveUp: Standing["gaveUp"] = null;
  if (on && cuts === 1 && last + WATCH.againMs < regular) {
    when = last + WATCH.againMs;
    why = "again";
  } else if (on && cuts >= 2) {
    gaveUp = "cut";
  } else if (on && fails >= 1 && fails <= WATCH.retries && last + WATCH.retryMs < regular) {
    when = last + WATCH.retryMs;
    why = "retry";
  } else if (on && fails > WATCH.retries && WATCH.retryMs < j.every * 1000) {
    gaveUp = "failed";
  }
  const effective = Math.max(when, startable);
  return {
    dueAt: new Date(when).toISOString(),
    why,
    lateSince: nowMs - effective >= WATCH.lateAfterMs ? new Date(when).toISOString() : null,
    failsInRow: fails,
    cutAt: cuts ? rows[0]!.start : null,
    gaveUp,
  };
}

/** Where each watched job stands now, by name. */
export function standings(nowMs = Date.now()): Map<string, Standing> {
  const names = new Set(watched());
  const on = watching();
  const out = new Map<string, Standing>();
  for (const j of jobStatus()) if (names.has(j.name)) out.set(j.name, stand(j, runsOf(j.name, WATCH.retries + 3), nowMs, on));
  return out;
}

/**
 * The one job the watch would ask for now, or null. Exported for the check
 * script; `beat` is what acts on it.
 *
 * Nothing in the first ten minutes after the desk starts. One ask at a time:
 * while the job it asked for has not started (and ten minutes have not
 * passed) it asks for nothing else, so the scheduler's queue never fills with
 * the watch's asks. Among several, the one furthest past its time measured in
 * its own intervals: a quarter-hourly job an hour late goes before a daily
 * one an hour late.
 */
export function planAsk(nowMs = Date.now()): WatchAsk | null {
  if (nowMs - w.bootAt < WATCH.settleMs) return null;
  const all = jobStatus();
  if (w.pending) {
    const p = w.pending;
    const j = all.find((x) => x.name === p.name);
    const started = !j || j.running || (j.lastStart !== null && Date.parse(j.lastStart) >= Date.parse(p.at));
    if (started || nowMs - Date.parse(p.at) >= WATCH.pendingMs) w.pending = null;
    else return null;
  }
  const names = new Set(watched());
  let best: { ask: WatchAsk; score: number } | null = null;
  for (const j of all) {
    if (!names.has(j.name)) continue;
    const s = stand(j, runsOf(j.name, WATCH.retries + 3), nowMs, true);
    if (!s.dueAt || !s.why) continue;
    const when = Date.parse(s.dueAt);
    const effective = Math.max(when, w.bootAt + ownDelayMs(j.name));
    /* A regular start is the scheduler's to make first; a retry or a second run is nobody's but the watch's. */
    const askAt = s.why === "regular" ? effective + WATCH.askAfterMs : effective;
    if (nowMs < askAt) continue;
    const score = (nowMs - when) / (j.every * 1000);
    if (!best || score > best.score) {
      best = { ask: { name: j.name, title: j.title, at: new Date(nowMs).toISOString(), why: s.why === "regular" ? "late" : s.why, since: s.dueAt }, score };
    }
  }
  return best?.ask ?? null;
}

/** What the watch asked for lately, newest first (kept in cc_state, so a restart does not forget it). */
export function watchAsks(): WatchAsk[] {
  const list = json<WatchAsk[]>(state(ASKS_KEY), []);
  return Array.isArray(list) ? list : [];
}

const hhmm = (iso: string): string => `${iso.slice(11, 16)} UTC`;

/** One line in the log for what the watch did. A late start is said once a day per job: a starved quarter-hourly job would otherwise fill the log. */
function say(a: WatchAsk, j: Listed | undefined): void {
  const href = `/seo/automations?open=${encodeURIComponent(a.name)}`;
  if (a.why === "late") {
    const mins = Math.max(1, Math.round((Date.parse(a.at) - Date.parse(a.since)) / MIN_MS));
    note("seo", `The scheduler passed over "${a.title}"`, {
      tone: "info",
      detail: `Its time came at ${hhmm(a.since)} and it had not started ${mins} minute${mins === 1 ? "" : "s"} later, so the SEO watch put it at the front of the queue. Said once a day for each job.`,
      href,
      dedupe: `seo:watch:late:${a.name}:${a.at.slice(0, 10)}`,
    });
  } else if (a.why === "retry") {
    note("seo", `Trying again: ${a.title}`, {
      tone: "warn",
      detail: `Its run at ${j?.lastStart ? hhmm(j.lastStart) : "an unknown time"} failed${j?.lastNote ? `: ${j.lastNote.slice(0, 160)}` : ""}. The desk tries a failed run again after half an hour, three times at most.`,
      href,
      dedupe: `seo:watch:retry:${a.name}:${j?.lastStart ?? a.at}`,
    });
  } else {
    note("seo", `Running again: ${a.title}`, {
      tone: "info",
      detail: `A restart of the desk cut off its run at ${j?.lastStart ? hhmm(j.lastStart) : "an unknown time"}.`,
      href,
      dedupe: `seo:watch:again:${a.name}:${j?.lastStart ?? a.at}`,
    });
  }
}

/**
 * One look: keep the runs, then ask for the one job that needs it. Never
 * throws: it runs from a timer, where a throw would stop the whole desk.
 * Returns what it asked for, for the check script.
 */
export function beat(nowMs = Date.now()): WatchAsk | null {
  w.lastBeat = nowMs;
  try {
    keepRuns(nowMs);
  } catch (e) {
    console.warn(`seo watch: the runs could not be kept: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    const ask = planAsk(nowMs);
    if (!ask || !runNow(ask.name)) return null;
    w.pending = ask;
    setState(ASKS_KEY, JSON.stringify([ask, ...watchAsks()].slice(0, 30)));
    say(ask, jobStatus().find((j) => j.name === ask.name));
    return ask;
  } catch (e) {
    console.warn(`seo watch: could not look after the jobs: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** The job the watch asked for that has not started yet, or null. */
export function watchPending(): WatchAsk | null {
  const p = w.pending;
  if (!p) return null;
  const j = jobStatus().find((x) => x.name === p.name);
  return j && !j.running && (j.lastStart === null || Date.parse(j.lastStart) < Date.parse(p.at)) ? p : null;
}

/** The watch as the screen says it. */
export function watchState(): { on: boolean; startedAt: string; lastBeat: string | null; asks: WatchAsk[] } {
  return { on: watching(), startedAt: new Date(w.bootAt).toISOString(), lastBeat: w.lastBeat === null ? null : new Date(w.lastBeat).toISOString(), asks: watchAsks() };
}

/**
 * Start looking, once. Like the scheduler it does nothing where
 * CC_SCHEDULER=off (a workstation's copy, the check scripts): there `runNow`
 * still starts a job, and a watch that asked for every late job would read
 * the live sources from a copy nobody meant to.
 */
export function startWatch(): void {
  if (w.timer || process.env.CC_SCHEDULER === "off") return;
  w.timer = setInterval(() => void beat(), WATCH.beatMs);
  w.timer.unref();
}

/* The top bar's light: a job the watch could not get started for half an hour means the scheduler itself
   has stopped or is stuck behind one job. Nothing to vouch for on a desk without a scheduler, or while it settles. */
registerCheck(() => {
  if (!watching() || Date.now() - w.bootAt < WATCH.settleMs + WATCH.alarmAfterMs) return null;
  const now = Date.now();
  const titles = new Map(jobStatus().map((j) => [j.name, j.title]));
  const late = [...standings(now)].filter(([, s]) => s.lateSince && now - Date.parse(s.lateSince) >= WATCH.alarmAfterMs).map(([name]) => titles.get(name) ?? name);
  return late.length
    ? { name: "The SEO jobs run on time", ok: false, detail: `${late.length} did not start more than half an hour after ${late.length === 1 ? "its" : "their"} time: ${late.slice(0, 3).join("; ")}${late.length > 3 ? ` and ${late.length - 3} more` : ""}. The scheduler has stopped or is stuck behind one job.` }
    : { name: "The SEO jobs run on time", ok: true, detail: "Every SEO job that is on started when its time came." };
});

startWatch();

/** For the check script only: move the watch's idea of when the desk started, and forget what it asked for. */
export const _test = {
  boot: (ms: number): void => {
    w.bootAt = ms;
    w.pending = null;
  },
  /** Look as the watch looks where a scheduler runs, without starting its timer. */
  standingsOn: (nowMs: number): Map<string, Standing> => {
    const names = new Set(watched());
    return new Map(jobStatus().filter((j) => names.has(j.name)).map((j) => [j.name, stand(j, runsOf(j.name, WATCH.retries + 3), nowMs, true)]));
  },
};
