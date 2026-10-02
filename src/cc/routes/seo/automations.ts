import { Hono } from "hono";
import { db } from "../../../db.ts";
import type { Vars } from "../../access.ts";
import { runnerState } from "../../operator/queue.ts";
import { history, status } from "../../scheduler.ts";
import { sources } from "../../sources.ts";
import { activity, off, ok, reading, waiting } from "../../store.ts";
import { scrub, scrubItem } from "../../system.ts";
import type { ActivityItem, Reading, SourceId, SourceStatus } from "../../../../web/src/contract/common.ts";
import type { AutomationRun, FinishedRun, JobSource, JobState } from "../../../../web/src/contract/automations.ts";
import type { SeoAutomationSplit, SeoAutomationsPayload, SeoJobRuns, SeoJobsDay } from "../../../../web/src/contract/seo/automations.ts";
import type { OperatorPanel, OwnerTaskRow, SeoJob } from "../../../../web/src/contract/seo/common.ts";
import { IMPORT_KINDS, lastImport } from "../../seo/aisearch.ts";
import { seoJobs } from "../../seo/jobs.ts";
import { ownerTasks } from "../../seo/owner.ts";
import { head, rangeFrom, SEO_KINDS } from "./shared.ts";

/**
 * /api/v1/seo/automations — SEO › Automations: the jobs the SEO section runs
 * on, and plainly what the SEO tools do by themselves, what waits for a
 * person's approval and what only a person can do.
 *
 *   GET  /?range=…   the whole page (SeoAutomationsPayload, web/src/contract/seo/automations.ts)
 *
 * Nothing else: running a job now is the core API's POST /api/v1/jobs/:name/run
 * (anybody signed in, with its floor between two asks), switching one off or
 * on is POST /api/v1/jobs/:name/enabled (the owner only), and a step in the
 * owner's browser is marked done through the engine's POST
 * /api/v1/seo/owner-tasks/:id. This file repeats none of them.
 *
 * WHERE IT COMES FROM. The scheduler (in memory, and its cc_jobs and cc_runs
 * tables), the engine's job list (src/cc/seo/jobs.ts `seoJobs`: what each
 * does, its group, its request budget), the sources Settings lists, the
 * operator's queue and approval tables, the owner tasks, the AI checks and
 * the imports. All of it is the desk's own: nobody outside the box is asked
 * while the page is drawn, so drawing it costs no quota. Each part is its own
 * reading, so one table that cannot be read costs one panel.
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
  crawl: { source: "crawl", reads: "Every page of the website, in the sitemap and out of it.", writes: "Each page's facts, links and findings, and the site score, in the desk." },
  sitemap: { source: "crawl", reads: "The website's sitemap.xml and robots.txt.", writes: "The sitemap's addresses and what was added or removed, in the desk." },
  "gsc-daily": { source: "gsc", reads: "Search Console's search figures for the last 7, 30 and 90 days, read-only.", writes: "The figures the screens show, kept in the desk." },
  "gsc-inspect": { source: "gsc", reads: "Google's URL Inspection, one sitemap address at a time.", writes: "Each address's index state per day, kept 400 days in the desk." },
  speed: { source: "psi", reads: "Google's PageSpeed Insights, a phone and a desktop run per page.", writes: "Lab speed, Lighthouse scores and field data when Google has any, in the desk." },
  "bing-daily": { source: "bing", reads: "Bing Webmaster's links and figures, once its key exists.", writes: "Bing's links with their anchor text and its search figures, in the desk." },
};

/* ---------- small helpers -------------------------------------------------------------- */

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

/** As the desk-wide Automations screen says it (src/cc/routes/automations.ts): one word for where a job stands. */
function stateOf(j: Listed, source: JobSource | null, pausedUntil: string | null, hasSource: boolean): JobState {
  if (j.running) return "running";
  if (!j.enabled) return "off";
  if (!j.ready) {
    if (pausedUntil) return "paused";
    /* Not ready while its source IS connected is a job with nothing left to ask, not a wait. */
    if (!hasSource || source?.state !== "connected") return "waiting";
  }
  if (j.lastOk === null) return "new";
  return j.lastOk ? "ok" : "failed";
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

function jobRuns(jobs: SeoJob[], now: number, pausedSpeed: string | null): Record<string, SeoJobRuns> {
  const listed = new Map(status().map((j) => [j.name, j]));
  const all = sources();
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

  const out: Record<string, SeoJobRuns> = {};
  for (const job of jobs) {
    const j = listed.get(job.name);
    if (!j) continue;
    const about = ABOUT[job.name];
    const source = sourceOf(about?.source ?? null, all);
    const pausedUntil = job.name === "speed" && !j.running && j.enabled && !j.ready ? pausedSpeed : null;
    const state = stateOf(j, source, pausedUntil, !!about?.source);
    /* The scheduler writes no end for a run a restart cut off: an open row is the run in progress
       only when it is the newest row of the job running now; every other open row was cut off. */
    const runs: AutomationRun[] = history(j.name, 20).map((r, i) => ({
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
    /* A paused job starts again when its pause is over and its interval since its last start has passed. */
    const nextRun =
      state === "paused" && pausedUntil ? new Date(Math.max(Date.parse(pausedUntil), j.lastStart ? Date.parse(j.lastStart) + j.every * 1000 : 0)).toISOString() : j.nextRun;
    const askable = j.ready && j.enabled && !j.running;
    out[job.name] = {
      state,
      pausedUntil: state === "paused" ? pausedUntil : null,
      source,
      reads: about?.reads ?? "Not described here yet: its title says what it does.",
      writes: about?.writes ?? "The desk's own database.",
      last,
      nextRun,
      recent: runs.slice(0, 8),
      day: day.get(j.name) ?? { ok: 0, failed: 0 },
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

/** These jobs' runs in the last 24 hours, and the jobs whose newest run failed. */
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
  const value: SeoJobsDay = {
    ok: rows.filter((r) => r.ok === 1).length,
    failed: rows.filter((r) => r.ok === 0).length,
    cut: rows.filter((r) => r.ok === null && newestOpen.get(r.job) !== r.started).length,
    failing: jobs.filter((j) => j.enabled && j.lastOk === false).map((j) => j.title),
    series,
  };
  const partial = first && Date.parse(first) > now - DAY ? ` The scheduler began keeping runs at ${first.slice(11, 16)} UTC, so the day is not whole.` : "";
  return ok(value, "desk", new Date(now).toISOString(), `The desk's own scheduler, which keeps a week of runs.${partial}`);
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

/** What the SEO jobs and the people acting on them wrote to the log lately, and the switches of these jobs. */
function recent(jobs: SeoJob[]): ActivityItem[] {
  const titles = jobs.map((j) => `"${j.title}"`);
  return activity(40, LOG_KINDS)
    .filter((a) => a.kind !== "automation" || titles.some((t) => a.text.includes(t)))
    .slice(0, 12)
    .map(scrubItem);
}

/* ---------- the page ------------------------------------------------------------------ */

async function page(range: ReturnType<typeof rangeFrom>): Promise<SeoAutomationsPayload> {
  const now = Date.now();
  const at = new Date(now).toISOString();
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
    jobs.length ? ok(jobRuns(jobs, now, paused), "desk", at, "The desk's own scheduler: it keeps a week of runs.") : waiting("desk", jobsWhy ?? "No SEO job is registered on this desk yet."),
  );
  const byName = runs.state === "ok" ? runs.value : null;

  /* The soonest start among the jobs that are on and not running; a paused job's is when its pause is over. */
  const upcoming = jobs
    .filter((j) => j.enabled && !j.running)
    .map((j) => ({ name: j.name, title: j.title, at: byName?.[j.name]?.nextRun ?? j.nextRun }))
    .filter((j): j is { name: string; title: string; at: string } => !!j.at)
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
    recentItems = recent(jobs);
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
  };
}

routes.get("/", async (c) => c.json<SeoAutomationsPayload>(await page(rangeFrom(c))));
