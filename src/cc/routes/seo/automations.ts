import { Hono } from "hono";
import { db } from "../../../db.ts";
import { me, requireOwner, type Vars } from "../../access.ts";
import { runnerState } from "../../operator/queue.ts";
import { status } from "../../scheduler.ts";
import * as gsc from "../../search/gsc.ts";
import { sources } from "../../sources.ts";
import { activity, off, ok, reading, today, waiting } from "../../store.ts";
import { scrub, scrubItem } from "../../system.ts";
import type { ActivityItem, Reading, SourceId, SourceStatus } from "../../../../web/src/contract/common.ts";
import type { AutomationRun, FinishedRun, JobSource } from "../../../../web/src/contract/automations.ts";
import type { SeoAutomationSplit, SeoAutomationsPayload, SeoDigests, SeoJobRuns, SeoJobState, SeoJobsDay, SeoJobsPeriod, SeoScheduler } from "../../../../web/src/contract/seo/automations.ts";
import type { OperatorPanel, OwnerTaskRow, SeoJob, SeoRange } from "../../../../web/src/contract/seo/common.ts";
import { IMPORT_KINDS, lastImport } from "../../seo/aisearch.ts";
import { runsBegin, runsOf, runsSince, runTally, seoJobs, standings, WATCH, watchPending, watchState, type Standing } from "../../seo/jobs.ts";
import { ownerTasks } from "../../seo/owner.ts";
import { daysOf } from "../../seo/rank.ts";
import { body, head, rangeFrom, SEO_KINDS } from "./shared.ts";

/**
 * /api/v1/seo/automations — SEO › Automations: the jobs the SEO section runs
 * on, and plainly what the SEO tools do by themselves, what waits for a
 * person's approval and what only a person can do.
 *
 *   GET  /?range=…            the whole page (SeoAutomationsPayload, web/src/contract/seo/automations.ts);
 *                             the range is the window of the `period` panel and of each job's period counts
 *   GET  /export.csv?range=…  every run of these jobs that started in the window, as CSV
 *   POST /digest              { telegram: boolean }  the owner says whether the week's summary
 *                             (src/cc/seo/jobs-digest.ts) is sent to him on Telegram → { ok, line }
 *
 * Nothing else: running a job now is the core API's POST /api/v1/jobs/:name/run
 * (with its floor between two asks), switching one off or on is
 * POST /api/v1/jobs/:name/enabled (the owner only), and a step in the owner's
 * browser is marked done through the engine's POST /api/v1/seo/owner-tasks/:id.
 * This file repeats none of them.
 *
 * WHERE IT COMES FROM. The scheduler (in memory, and its cc_jobs and cc_runs
 * tables), the engine's job list and its watch over these jobs
 * (src/cc/seo/jobs.ts: what each does, its group, its request budget, when it
 * should start next and why, the runs kept longer than the scheduler's week),
 * the sources Settings lists, the operator's queue and approval tables, the
 * owner tasks, the AI checks and the imports. All of it is the desk's own:
 * nobody outside the box is asked while the page is drawn, so drawing it costs
 * no quota. Each part is its own reading, so one table that cannot be read
 * costs one panel.
 *
 * A JOB THAT DOES NOT RUN IS SAID TO BE LATE. Its last result alone used to
 * decide its word, so a job two days behind read "Success" and "Due now",
 * and a desk whose scheduler had stopped looked like one that worked. Now a
 * job more than ten minutes past its time is "late" with the time it was due,
 * and `scheduler` says whether anything starts by itself here at all.
 */
export const routes = new Hono<Vars>();

/* ---------- what each job reads and writes ------------------------------------------- */

/**
 * The source Settings knows each job by, what it asks, and what it writes.
 * Written from each job's own module (src/cc/seo/*, src/cc/site/*,
 * src/cc/search/*). None of them changes the website: every one writes only
 * to the desk's own database, and the engine queues nothing for the operator
 * by itself (src/cc/seo/engine.ts: an operator task is made only by `act`,
 * when a person presses an opportunity's button).
 */
const ABOUT: Record<string, { source: SourceId | null; reads: string; writes: string }> = {
  "seo-snapshot": { source: "gsc", reads: "Search Console's search figures, read-only, one finished day at a time.", writes: "The desk's own search history, and new searches into the keyword table." },
  "seo-engine": {
    source: null,
    reads: "Only the desk's own tables: the search history, the crawl, the index check, the readiness check, the keyword table and the owner tasks. It asks nobody outside.",
    writes: "The opportunities, with every person's decision kept. It queues nothing for the operator by itself: a person's press on an opportunity does.",
  },
  "seo-readiness": { source: "crawl", reads: "Every sitemap page of the website, one at a time, as a crawler gets it, and the site's robots.txt and llms.txt.", writes: "Each page's AI-readiness checks, in the desk." },
  "seo-referrals": { source: "ga4", reads: "GA4's report of referring sites and AI assistants, once a day (consenting visitors only).", writes: "Sessions by referring site, day and landing page, in the desk." },
  "seo-research": { source: null, reads: "Google Autocomplete, at most one request a second, within the week's budget.", writes: "New phrases in the keyword table, unjudged until a person or a rule sorts them." },
  "seo-competitors": { source: null, reads: "Competitors' public pages captured for our topics: robots.txt first and obeyed, two seconds between requests to one site.", writes: "What each page says (title, heading, words, language, structured data, a stated price), in the desk." },
  "seo-presence": { source: null, reads: "The studio's known profile and listing addresses, once each.", writes: "Whether each one exists, in the desk." },
  "seo-rank-check": {
    source: null,
    reads: "Google's results for each target phrase not checked in six days: through DataForSEO when it is connected, otherwise fetched by the studio workstation from its own line, a few a day.",
    writes: "Who ranks for each phrase, with Balkaris's own place, as sightings on the Competitors page, in the desk.",
  },
  "seo-digest": {
    source: null,
    reads: "Only the desk's own tables: the runs, the opportunities, the index check, the keyword table, the owner tasks and the log.",
    writes: "The week's summary on this page; sent to the owner on Telegram when he asked for it.",
  },
  "seo-backlinks": {
    source: "ga4",
    reads: "GA4's sessions by referring address, Bing's linking pages once Bing is connected, and each linking page itself (robots.txt first, at most 40 pages a run).",
    writes: "The sites and pages that link to the website, and whether each link is followed, in the desk.",
  },
  crawl: { source: "crawl", reads: "Every page of the website, in the sitemap and out of it.", writes: "Each page's facts, links and findings, and the site score, in the desk." },
  sitemap: { source: "crawl", reads: "The website's sitemap.xml and robots.txt.", writes: "The sitemap's addresses and what was added or removed, in the desk." },
  "gsc-daily": { source: "gsc", reads: "Search Console's search figures for the last 7, 30 and 90 days, read-only.", writes: "The figures the screens show, kept in the desk." },
  "gsc-inspect": { source: "gsc", reads: "Google's URL Inspection, one sitemap address at a time.", writes: "Each address's index state per day, kept 400 days in the desk." },
  speed: { source: "psi", reads: "Google's PageSpeed Insights, a phone and a desktop run per page.", writes: "Lab speed, Lighthouse scores and field data when Google has any, in the desk." },
  "crux-daily": { source: "crux", reads: "Google's Chrome UX Report: what real Chrome visitors experienced over the last 28 days, for phones, desktops and all together.", writes: "The field Core Web Vitals SEO › Technical shows, in the desk. Nothing while Google has no such data for the site." },
  "bing-daily": { source: "bing", reads: "Bing Webmaster's links and figures, once its key exists.", writes: "Bing's links with their anchor text and its search figures, in the desk." },
};

/* ---------- small helpers -------------------------------------------------------------- */

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The core API's floor between two asks of one job (src/cc/api.ts `floorMs`): its interval, never more than ten minutes. */
const floorMs = (every: number): number => Math.min(every, 600) * 1000;

const span = (start: string | null, end: string | null): number | null => {
  if (!start || !end) return null;
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
};

/** A count from one of the desk's tables, 0 when the table is not there yet. */
const count = (sql: string, ...args: (string | number)[]): number => {
  try {
    return (db.prepare(sql).get(...args) as { n: number | null }).n ?? 0;
  } catch {
    return 0;
  }
};

/** The same, but null when it could not be read: for a figure that must not turn into a 0. */
const counted = (sql: string, ...args: (string | number)[]): number | null => {
  try {
    return (db.prepare(sql).get(...args) as { n: number | null }).n ?? 0;
  } catch {
    return null;
  }
};

type Listed = ReturnType<typeof status>[number];

function sourceOf(id: SourceId | null, all: SourceStatus[]): JobSource | null {
  if (!id) return null;
  const s = all.find((x) => x.id === id);
  if (!s) return null;
  return {
    id: s.id,
    name: s.name,
    state: s.state,
    lastOk: s.lastOk,
    ...(s.error ? { reason: scrub(s.error) } : {}),
    ...(s.step && s.state !== "connected" ? { step: s.step } : {}),
  };
}

/**
 * One word for where a job stands: the desk-wide Automations screen's words
 * (src/cc/routes/automations.ts), and "late" for a job whose time passed more
 * than ten minutes ago without a start. A failed last run is said before
 * lateness (the row's Next run still says since when it is late); a success is
 * not, because a job that does not run has nothing new to be right about.
 */
function stateOf(j: Listed, source: JobSource | null, pausedUntil: string | null, hasSource: boolean, standing: Standing | undefined): SeoJobState {
  if (j.running) return "running";
  if (!j.enabled) return "off";
  if (!j.ready) {
    if (pausedUntil) return "paused";
    /* Not ready while its source IS connected is a job with nothing left to ask, not a wait. */
    if (!hasSource || source?.state !== "connected") return "waiting";
  }
  if (j.lastOk === false) return "failed";
  if (standing?.lateSince) return "late";
  return j.lastOk === null ? "new" : "ok";
}

/** The speed test's pause after Google's 429, read from the website collector; a collector that failed to load costs the pause only. */
async function speedPause(): Promise<string | null> {
  try {
    const site = await import("../../site/index.ts");
    return site.speedPausedUntil();
  } catch {
    return null;
  }
}

/* ---------- the jobs' runs ----------------------------------------------------------- */

function jobRuns(jobs: SeoJob[], now: number, pausedSpeed: string | null, since: string): Record<string, SeoJobRuns> {
  const listed = new Map(status().map((j) => [j.name, j]));
  const all = sources();
  const stands = standings(now);
  const watch = watchState();
  const pending = watchPending();
  const names = jobs.map((j) => j.name);
  const marks = names.map(() => "?").join(",");
  const day = new Map(
    (
      db
        .prepare(
          `SELECT job, SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS ok, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failed
             FROM cc_runs WHERE started >= ? AND job IN (${marks}) GROUP BY job`,
        )
        .all(new Date(now - DAY).toISOString(), ...names) as { job: string; ok: number | null; failed: number | null }[]
    ).map((r) => [r.job, { ok: r.ok ?? 0, failed: r.failed ?? 0 }]),
  );
  /* The head's period, from the scheduler's week and the desk's own longer copy of these runs. */
  const inPeriod = new Map<string, { ok: number; failed: number; open: number; lastFailed: string | null }>();
  for (const r of runTally(since)) {
    const had = inPeriod.get(r.job) ?? { ok: 0, failed: 0, open: 0, lastFailed: null };
    inPeriod.set(r.job, { ok: had.ok + r.ok, failed: had.failed + r.failed, open: had.open + r.open, lastFailed: r.lastFailed && (!had.lastFailed || r.lastFailed > had.lastFailed) ? r.lastFailed : had.lastFailed });
  }

  const out: Record<string, SeoJobRuns> = {};
  for (const job of jobs) {
    const j = listed.get(job.name);
    if (!j) continue;
    const about = ABOUT[job.name];
    const source = sourceOf(about?.source ?? null, all);
    const pausedUntil = job.name === "speed" && !j.running && j.enabled && !j.ready ? pausedSpeed : null;
    const standing = stands.get(j.name);
    const state = stateOf(j, source, pausedUntil, !!about?.source, standing);
    /* The scheduler writes no end for a run a restart cut off: an open row is the run in progress
       only when it is the newest row of the job running now; every other open row was cut off. */
    const runs: AutomationRun[] = runsOf(j.name, 20).map((r, i) => ({
      start: r.start,
      end: r.end,
      state: r.ok === null ? (j.running && i === 0 ? "running" : "cut") : r.ok ? "ok" : "failed",
      ms: r.ok === null ? null : span(r.start, r.end),
      ok: r.ok,
      note: r.note === null ? null : scrub(r.note),
    }));
    const newest = runs.find((r) => r.ok !== null);
    /* "Last run" is the newest run that FINISHED, never the start of one in progress beside the result of the one before. */
    const last: FinishedRun | null = newest
      ? { start: newest.start, end: newest.end as string, ms: newest.ms, ok: newest.ok as boolean, note: newest.note }
      : j.lastEnd && j.lastOk !== null
        ? (() => {
            const start = j.lastStart && j.lastStart <= j.lastEnd ? j.lastStart : null;
            return { start, end: j.lastEnd, ms: span(start, j.lastEnd), ok: j.lastOk, note: j.lastNote === null ? null : scrub(j.lastNote) };
          })()
        : null;
    /* A paused job starts again when its pause is over and its interval since its last start has passed.
       Any other: when the watch's rules say (its regular time, sooner after a failure or a cut). A job that
       never ran has a time only where a scheduler runs; a running one keeps its regular next time. */
    const nextRun =
      state === "paused" && pausedUntil
        ? new Date(Math.max(Date.parse(pausedUntil), j.lastStart ? Date.parse(j.lastStart) + j.every * 1000 : 0)).toISOString()
        : j.running
          ? j.nextRun
          : (standing?.dueAt ?? null);
    const queued = pending?.name === j.name ? { at: pending.at, why: pending.why } : null;
    const askable = j.ready && j.enabled && !j.running && !queued;
    const tally = inPeriod.get(j.name);
    /* The open row of the job running now is its run in progress, not one cut off. */
    const runningRow = j.running && j.lastStart !== null && j.lastStart >= since ? 1 : 0;
    out[job.name] = {
      state,
      pausedUntil: state === "paused" ? pausedUntil : null,
      source,
      reads: about?.reads ?? "Not described here yet: its title says what it does.",
      writes: about?.writes ?? "The desk's own database.",
      last,
      nextRun,
      nextWhy: state === "paused" || j.running ? null : (standing?.why ?? null),
      lateSince: standing?.lateSince ?? null,
      queued,
      retry: standing?.why === "retry" ? { attempt: standing.failsInRow, of: watch.on ? WATCH.retries : 0 } : null,
      cutAt: standing?.cutAt ?? null,
      gaveUp: standing?.gaveUp ?? null,
      recent: runs.slice(0, 8),
      day: day.get(j.name) ?? { ok: 0, failed: 0 },
      period: { ok: tally?.ok ?? 0, failed: tally?.failed ?? 0, cut: Math.max(0, (tally?.open ?? 0) - runningRow), lastFailed: tally?.lastFailed ?? null },
      durations: runs
        .filter((r) => r.ms !== null)
        .slice(0, 20)
        .map((r) => r.ms as number)
        .reverse(),
      askableFrom: askable ? new Date(j.lastStart ? Math.max(now, Date.parse(j.lastStart) + floorMs(j.every)) : now).toISOString() : null,
    };
  }
  return out;
}

/** These jobs' runs in the last 24 hours, the jobs whose newest run failed, and the jobs that are late. */
function lastDay(jobs: SeoJob[], now: number): Reading<SeoJobsDay> {
  const names = jobs.map((j) => j.name);
  if (!names.length) return waiting("desk", "No SEO job is registered on this desk yet.");
  const marks = names.map(() => "?").join(",");
  const rows = db.prepare(`SELECT job, started, ok FROM cc_runs WHERE started >= ? AND job IN (${marks})`).all(new Date(now - DAY).toISOString(), ...names) as {
    job: string;
    started: string;
    ok: number | null;
  }[];
  const runningNow = new Set(jobs.filter((j) => j.running).map((j) => j.name));
  /* The open row of a job running now is its run in progress; any other open row was cut off by a restart. */
  const newestOpen = new Map<string, string>();
  for (const r of rows) if (r.ok === null && runningNow.has(r.job) && (newestOpen.get(r.job) ?? "") < r.started) newestOpen.set(r.job, r.started);
  const series = Array.from({ length: 24 }, () => 0);
  for (const r of rows) {
    const i = Math.floor((Date.parse(r.started) - (now - DAY)) / HOUR);
    if (i >= 0 && i < 24) series[i] = (series[i] ?? 0) + 1;
  }
  const first = (db.prepare("SELECT MIN(started) AS s FROM cc_runs").get() as { s: string | null }).s;
  const stands = standings(now);
  const value: SeoJobsDay = {
    ok: rows.filter((r) => r.ok === 1).length,
    failed: rows.filter((r) => r.ok === 0).length,
    cut: rows.filter((r) => r.ok === null && newestOpen.get(r.job) !== r.started).length,
    failing: jobs.filter((j) => j.enabled && j.lastOk === false).map((j) => j.title),
    late: jobs.filter((j) => stands.get(j.name)?.lateSince).map((j) => j.title),
    series,
  };
  const partial = first && Date.parse(first) > now - DAY ? ` The scheduler began keeping runs at ${first.slice(11, 16)} UTC, so the day is not whole.` : "";
  return ok(value, "desk", new Date(now).toISOString(), `The desk's own scheduler, which keeps a week of runs.${partial}`);
}

/* ---------- whether anything starts by itself ----------------------------------------------- */

/** The desk has jobs that start every two minutes: ten minutes without any start is a scheduler that has stopped. */
const STALL_MS = 10 * MIN;

function scheduler(now: number): SeoScheduler {
  const on = process.env.CC_SCHEDULER !== "off";
  let lastStart: string | null = null;
  try {
    lastStart = (db.prepare("SELECT MAX(last_start) AS s FROM cc_jobs").get() as { s: string | null }).s;
  } catch {
    lastStart = null;
  }
  const watch = watchState();
  /* Not in the desk's first ten minutes: nothing is expected to have started in the seconds after a restart. */
  const settled = now - Date.parse(watch.startedAt) > STALL_MS;
  return {
    on,
    lastStart,
    stalled: on && settled && (lastStart === null || now - Date.parse(lastStart) > STALL_MS),
    watch: {
      on: watch.on,
      lastBeat: watch.lastBeat,
      asks: watch.asks.slice(0, 12),
      askAfterMin: WATCH.askAfterMs / MIN,
      lateAfterMin: WATCH.lateAfterMs / MIN,
      retryAfterMin: WATCH.retryMs / MIN,
      retries: WATCH.retries,
    },
  };
}

/* ---------- the head's period: the runs, and what they brought in ------------------------------ */

function period(jobs: SeoJob[], range: SeoRange, now: number): Reading<SeoJobsPeriod> {
  if (!jobs.length) return off("desk", "No SEO job is registered on this desk yet.");
  const days = daysOf(range);
  const since = new Date(now - days * DAY).toISOString();
  const begins = runsBegin();
  if (!begins) return waiting("desk", "No run of an SEO job is kept yet: the first ones show here once the scheduler has started them.");
  const titles = new Map(jobs.map((j) => [j.name, j.title]));

  /* One bar per slice of the period, thirty at most, counted in UTC days as the runs are stored. */
  const firstDay = Date.parse(`${since.slice(0, 10)}T00:00:00Z`);
  const allDays = days + 1;
  const sliceDays = Math.ceil(allDays / 30);
  const series = Array.from({ length: Math.ceil(allDays / sliceDays) }, () => 0);
  let good = 0;
  let failed = 0;
  let open = 0;
  for (const r of runTally(since)) {
    good += r.ok;
    failed += r.failed;
    open += r.open;
    const i = Math.floor((Date.parse(`${r.day}T00:00:00Z`) - firstDay) / (sliceDays * DAY));
    if (i >= 0 && i < series.length) series[i] = (series[i] ?? 0) + r.ok + r.failed + r.open;
  }
  const runningRows = jobs.filter((j) => j.running && j.lastStart !== null && j.lastStart >= since).length;

  /* What the jobs brought in, each from the table its job writes. One that cannot be read is left out. */
  const found: SeoJobsPeriod["found"] = [];
  const add = (key: string, label: string, from: string, href: string | null, value: number | null): void => {
    if (value !== null) found.push({ key, label, value, href, from });
  };
  add(
    "phrases",
    "New phrases from Google Autocomplete",
    titles.get("seo-research") ?? "seo-research",
    "/seo/keywords?source=autocomplete&sort=first-seen",
    counted("SELECT COUNT(*) AS n FROM cc_seo_keywords WHERE first_seen >= ? AND sources LIKE '%autocomplete%' AND sources NOT LIKE '%audit%'", since),
  );
  add(
    "queries",
    "New searches seen in Search Console",
    titles.get("seo-snapshot") ?? "seo-snapshot",
    "/seo/keywords?source=gsc&sort=first-seen",
    counted("SELECT COUNT(*) AS n FROM cc_seo_keywords WHERE first_seen >= ? AND sources LIKE '%gsc%' AND sources NOT LIKE '%audit%' AND sources NOT LIKE '%autocomplete%'", since),
  );
  add("opportunities", "Opportunities found", titles.get("seo-engine") ?? "seo-engine", "/seo/opportunities", counted("SELECT COUNT(*) AS n FROM cc_seo_opps WHERE first_seen >= ?", since));
  add("cleared", "Opportunities the rules no longer find", titles.get("seo-engine") ?? "seo-engine", null, counted("SELECT COUNT(*) AS n FROM cc_seo_opps WHERE active = 0 AND cleared_at >= ?", since));
  add("indexed", "Pages Google newly indexed", titles.get("gsc-inspect") ?? "gsc-inspect", "/seo/technical#indexing", counted("SELECT COUNT(*) AS n FROM cc_activity WHERE kind = 'gsc.indexed' AND at >= ?", since));
  add("dropped", "Pages Google dropped from its index", titles.get("gsc-inspect") ?? "gsc-inspect", "/seo/technical#indexing", counted("SELECT COUNT(*) AS n FROM cc_activity WHERE kind = 'gsc.dropped' AND at >= ?", since));

  const value: SeoJobsPeriod = {
    range,
    days,
    begins,
    ok: good,
    failed,
    cut: Math.max(0, open - runningRows),
    series,
    sliceDays,
    failures: runsSince(since, 20, { failed: true }).map((r) => ({ job: r.job, title: titles.get(r.job) ?? r.job, start: r.start, note: r.note === null ? null : scrub(r.note) })),
    found,
  };
  const short = begins > since ? ` The desk began keeping these runs on ${begins.slice(0, 10)}, so this period is not whole.` : "";
  return ok(value, "desk", new Date(now).toISOString(), `Counted from the desk's own scheduler, which keeps a week of runs, and the SEO section's copy of them, kept 400 days.${short}`);
}

/* ---------- by itself, waiting for approval, only a person --------------------------------- */

const IMPORT_LABEL: Record<string, string> = {
  "gsc-generative-ai": "Search Console › Generative AI",
  "bing-ai-performance": "Bing Webmaster › AI Performance",
};

function split(jobs: SeoJob[], runs: Record<string, SeoJobRuns> | null, now: number): SeoAutomationSplit {
  let runner: OperatorPanel["runner"];
  try {
    runner = runnerState();
  } catch {
    runner = { state: "never", lastSeen: null, line: "The workstation's state could not be read.", articlesFirst: 0 };
  }
  const tally = (who: "owner" | "lead-chrome"): { open: number; done: number } => {
    try {
      const rows = ownerTasks([who]);
      return { open: rows.filter((r) => !r.done).length, done: rows.filter((r) => r.done).length };
    } catch {
      return { open: 0, done: 0 };
    }
  };
  let ai = { rows: 0, lastDay: null as string | null };
  try {
    const r = db.prepare("SELECT COUNT(*) AS n, MAX(day) AS d FROM cc_seo_ai_checks").get() as { n: number; d: string | null };
    ai = { rows: r.n, lastDay: r.d };
  } catch {
    /* No checks table yet: none recorded. */
  }
  return {
    automatic: {
      on: jobs.filter((j) => j.enabled).length,
      of: jobs.length,
      off: jobs.filter((j) => !j.enabled).map((j) => j.title),
      waiting: jobs.filter((j) => (runs?.[j.name]?.state ?? (j.ready ? "ok" : "waiting")) === "waiting").map((j) => j.title),
    },
    approval: {
      waiting: count("SELECT COUNT(*) AS n FROM cc_proposals WHERE state = 'waiting'"),
      applied30: count("SELECT COUNT(*) AS n FROM cc_proposals WHERE applied_at IS NOT NULL AND applied_at >= ?", new Date(now - 30 * DAY).toISOString()),
      queued: count("SELECT COUNT(*) AS n FROM cc_ai_tasks WHERE state = 'queued'"),
      running: count("SELECT COUNT(*) AS n FROM cc_ai_tasks WHERE state = 'running'"),
      inProgress: count("SELECT COUNT(*) AS n FROM cc_seo_opps WHERE active = 1 AND state IN ('queued', 'in-progress')"),
      runner,
    },
    people: {
      owner: tally("owner"),
      chrome: tally("lead-chrome"),
      aiChecks: ai,
      imports: IMPORT_KINDS.map((kind) => {
        const last = lastImport(kind);
        return { kind, label: IMPORT_LABEL[kind] ?? kind, month: last?.month ?? null, at: last?.importedAt ?? null };
      }),
    },
  };
}

/* ---------- the log ------------------------------------------------------------------- */

/** The log's kinds the page reads: the SEO engine's own, and the owner's switches of a job. */
const LOG_KINDS = [...SEO_KINDS, "automation"];

/** What the SEO jobs and the people acting on them wrote to the log in the period, newest first, and the switches of these jobs. */
function recent(jobs: SeoJob[], since: string): ActivityItem[] {
  const titles = jobs.map((j) => `"${j.title}"`);
  return activity(60, LOG_KINDS)
    .filter((a) => a.at >= since && (a.kind !== "automation" || titles.some((t) => a.text.includes(t))))
    .slice(0, 12)
    .map(scrubItem);
}

/* ---------- where a step done by hand is done ------------------------------------------- */

/**
 * The screen each browser step is done on, read from its id and its words:
 * Search Console's report for the property the desk reads (its Pages report,
 * URL Inspection, Sitemaps, Performance), and Brave's submit form. A step
 * that names none gets no link. Search Console's only while the desk knows
 * the property, so a link never lands on Google's property picker.
 */
function stepLinks(tasks: OwnerTaskRow[]): Record<string, { label: string; href: string }[]> {
  let site: string | null = null;
  try {
    const a = gsc.access();
    site = a.state === "ok" && a.site ? a.site : null;
  } catch {
    site = null;
  }
  const sc = (kind: string, label: string) => (site ? [{ label, href: `https://search.google.com/search-console/${kind}?resource_id=${encodeURIComponent(site)}` }] : []);
  const out: Record<string, { label: string; href: string }[]> = {};
  for (const t of tasks) {
    const words = `${t.id} ${t.step}`.toLowerCase();
    const links: { label: string; href: string }[] = [];
    if (/generative.ai|performance/.test(words)) links.push(...sc("performance/search-analytics", "Search Console › Performance"));
    if (/validate|indexing\s*>\s*pages|noindex/.test(words)) links.push(...sc("index", "Search Console › Pages"));
    if (/request.indexing|url inspection/.test(words)) links.push(...sc("inspect", "Search Console › URL Inspection"));
    if (/sitemap|feed\.xml/.test(words)) links.push(...sc("sitemaps", "Search Console › Sitemaps"));
    if (/brave/.test(words)) links.push({ label: "Brave › Submit a URL", href: "https://search.brave.com/submit-url" });
    out[t.id] = links;
  }
  return out;
}

/* ---------- the week, in short --------------------------------------------------------- */

/** The summaries the seo-digest job kept, and the owner's say on Telegram. Loaded on demand, so a fault there costs this panel only. */
async function digest(): Promise<Reading<SeoDigests>> {
  return reading<SeoDigests>("desk", async () => {
    const d = await import("../../seo/jobs-digest.ts");
    const list = d.digests();
    const t = d.telegram();
    if (!list.length) {
      return waiting(
        "desk",
        `No summary is written yet. The job "Write the week's SEO summary" writes the first one an hour after the desk starts, then every week; Run now on its row writes one at once.${t.on ? "" : " The owner can have it sent to him on Telegram."}`,
      );
    }
    return ok({ list, telegram: t, job: "seo-digest" }, "desk", list[0]!.at, "Counted from the desk's own tables when the summary was written.");
  });
}

/* ---------- the page ------------------------------------------------------------------ */

async function page(range: SeoRange): Promise<SeoAutomationsPayload> {
  const now = Date.now();
  const at = new Date(now).toISOString();
  const since = new Date(now - daysOf(range) * DAY).toISOString();
  let jobs: SeoJob[] = [];
  let jobsWhy: string | null = null;
  try {
    jobs = seoJobs();
    if (!jobs.length) jobsWhy = "No SEO job is registered on this desk: the SEO engine's collector did not load (src/cc/seo/index.ts). The reason is under the top bar's light.";
  } catch (e) {
    jobsWhy = `The SEO jobs could not be listed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`;
  }

  const paused = await speedPause();
  const runs = await reading<Record<string, SeoJobRuns>>("desk", () =>
    jobs.length
      ? ok(jobRuns(jobs, now, paused, since), "desk", at, "The desk's own scheduler, which keeps a week of runs, and the SEO section's own copy of them, kept 400 days.")
      : waiting("desk", jobsWhy ?? "No SEO job is registered on this desk yet."),
  );
  const byName = runs.state === "ok" ? runs.value : null;

  /* The soonest start among the jobs that are on and not running; a paused job's is when its pause is over.
     Without the run table the job list's own next time still stands. */
  const upcoming = jobs
    .filter((j) => j.enabled && !j.running)
    .map((j) => ({ name: j.name, title: j.title, at: byName ? (byName[j.name]?.nextRun ?? null) : j.nextRun, late: !!byName?.[j.name]?.lateSince }))
    .filter((j): j is { name: string; title: string; at: string; late: boolean } => !!j.at)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const next = upcoming[0] ?? null;

  let chromeTasks: OwnerTaskRow[] = [];
  try {
    chromeTasks = ownerTasks(["lead-chrome"]).map(({ whoAll: _w, ...r }) => r);
  } catch {
    chromeTasks = [];
  }

  let recentItems: ActivityItem[] = [];
  try {
    recentItems = recent(jobs, since);
  } catch {
    recentItems = [];
  }

  return {
    head: head(range),
    jobs,
    running: jobs.filter((j) => j.running).length,
    nextRun: next?.at ?? null,
    recent: recentItems,
    chromeTasks,
    recentKinds: LOG_KINDS,
    jobsWhy,
    next,
    runs,
    day: await reading<SeoJobsDay>("desk", () => (jobs.length ? lastDay(jobs, now) : off("desk", jobsWhy ?? "No SEO job is registered on this desk yet."))),
    split: await reading<SeoAutomationSplit>("desk", () => ok(split(jobs, byName, now), "desk", at)),
    scheduler: scheduler(now),
    period: await reading<SeoJobsPeriod>("desk", () => period(jobs, range, now)),
    recentInPeriod: count(`SELECT COUNT(*) AS n FROM cc_activity WHERE at >= ? AND kind IN (${SEO_KINDS.map(() => "?").join(",")})`, since, ...SEO_KINDS),
    stepLinks: stepLinks(chromeTasks),
    digest: await digest(),
  };
}

routes.get("/", async (c) => c.json<SeoAutomationsPayload>(await page(rangeFrom(c))));

/* ---------- POST /digest --------------------------------------------------------------------- */

/**
 * The owner says whether the week's summary is sent to him on Telegram. His
 * alone: it is his chat. Answers { ok, line } in a sentence, or { error }.
 */
routes.post("/digest", requireOwner, async (c) => {
  const b = await body(c);
  if (typeof b.telegram !== "boolean") return c.json({ error: 'Send { "telegram": true } or { "telegram": false }.' }, 400);
  const d = await import("../../seo/jobs-digest.ts");
  d.setTelegram(b.telegram, me(c).name);
  const t = d.telegram();
  const line = b.telegram
    ? t.ready
      ? "The week's summary will be sent to you on Telegram when it is written."
      : "Switched on, but the desk cannot reach you on Telegram yet: its bot or your chat is not set. The summary stays on this page until then."
    : "The week's summary stays on this page; it is no longer sent on Telegram.";
  return c.json({ ok: true, line });
});

/* ---------- GET /export.csv ------------------------------------------------------------------- */

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  let s = String(v);
  /* A spreadsheet runs a cell that starts like a formula. */
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Every run of the SEO section's jobs that started in the period, newest
 * first: the answer to "when did this start failing" as a file. Read from
 * the same two tables as the page, so the file and the screen agree.
 */
routes.get("/export.csv", (c) => {
  const range = rangeFrom(c);
  const now = Date.now();
  const since = new Date(now - daysOf(range) * DAY).toISOString();
  const rows = runsSince(since, 50_000);
  if (!rows.length) return c.json({ error: `There is nothing to export yet: no run of an SEO job started in the last ${daysOf(range)} days.` }, 409);
  const listed = new Map(status().map((j) => [j.name, j]));
  const lines = [["Job", "Name", "Started (UTC)", "Ended (UTC)", "Seconds", "Result", "What it said"].map(cell).join(",")];
  for (const r of rows) {
    const j = listed.get(r.job);
    const running = r.ok === null && !!j?.running && j.lastStart === r.start;
    const ms = span(r.start, r.end);
    lines.push(
      [
        j?.title ?? r.job,
        r.job,
        r.start.slice(0, 19).replace("T", " "),
        r.end ? r.end.slice(0, 19).replace("T", " ") : "",
        ms === null ? "" : (ms / 1000).toFixed(1),
        r.ok === null ? (running ? "running" : "cut off by a restart") : r.ok ? "ok" : "failed",
        r.note === null ? "" : scrub(r.note),
      ]
        .map(cell)
        .join(","),
    );
  }
  c.header("content-type", "text/csv; charset=utf-8");
  c.header("content-disposition", `attachment; filename="balkaris-seo-job-runs-${today()}-${range}.csv"`);
  c.header("cache-control", "no-store");
  /* The byte-order mark makes Excel on Windows read the file as UTF-8. */
  return c.body(`﻿${lines.join("\r\n")}\r\n`);
});
