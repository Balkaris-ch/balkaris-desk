import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { db, lastBeat, queueState } from "../../db.ts";
import type { Vars } from "../access.ts";
import { history, runNow, status } from "../scheduler.ts";
import { sources } from "../sources.ts";
import { cached, off, ok, reading, waiting } from "../store.ts";
import { scrub, scrubItem } from "../system.ts";
import type { ActivityItem, Reading, SourceId, SourceStatus, Stat, Tone } from "../../../web/src/contract/common.ts";
import type {
  ActivityPage,
  AlertRule,
  AutomationJob,
  AutomationRun,
  AutomationsPayload,
  FileChange,
  FinishedRun,
  JobSource,
  JobState,
  NextRun,
  RunDueAnswer,
  Runner,
  RunnerWork,
  SiteWorkflow,
} from "../../../web/src/contract/automations.ts";

/**
 * /api/v1/automations — what the desk does by itself, and what it did.
 *
 *   GET  /          the whole screen in one answer. ?kinds=a,b ?tone=bad ?page=2
 *                   filter and page the activity log; nothing else takes a range,
 *                   because the scheduler keeps one week of runs and the tiles
 *                   speak of the last 24 hours.
 *   POST /run-due   put every job whose time has come at the front of the queue.
 *
 * Running one job now and switching one off are the core API's routes
 * (POST /api/v1/jobs/:name/run, for edit on Automations or an area the job
 * feeds, decided at the gate by src/grants.ts `mayRunJob`; /jobs/:name/enabled,
 * the owner only). This file does not repeat them.
 *
 * Everything here is read from the desk's own database and the scheduler in
 * memory: no source outside the box is asked, so the screen costs no quota.
 * The two exceptions are reads of the desk's own copy of the website's
 * repository (kept for ten minutes) and the attention rules, which are
 * another screen's module and are read only if it exists.
 */
export const routes = new Hono<Vars>();

/* ---------- what each job does, in plain words ------------------------------ */

/**
 * The scheduler knows a job by name, title and interval. What it does and
 * what it reads are written here, from the collectors' own headers. A job a
 * collector adds later still appears, under its own title, with the line
 * below saying it has no description here yet.
 */
const KNOWN: Record<string, { does: string; source: SourceId }> = {
  probe: {
    does: "Asks the website for its home page, the insights index, the sitemap, one fixed file and one function address, and times each answer from the desk's server. Two failed checks of the home page in a row open an incident.",
    source: "probe",
  },
  repo: {
    does: "Fetches the website's main branch into the desk's own read copy and records each new commit, which is a production deployment on Vercel.",
    source: "repo",
  },
  sitemap: {
    does: "Reads sitemap.xml and robots.txt, checks that they are valid, and notes the addresses that were added or removed.",
    source: "crawl",
  },
  crawl: {
    does: "Reads every page in the sitemap and the ones kept out of it: titles, headings, links, pictures, structured data. Scores each page and lists its issues. It also runs when the sitemap's addresses change.",
    source: "crawl",
  },
  assets: {
    does: "Lists every file in the website's public/ folder with its size, measures pictures that are new, and joins each file to the pages that show it.",
    source: "repo",
  },
  speed: {
    does: "Asks Google's PageSpeed Insights to load six pages on a simulated phone and on a desktop: lab speed and Lighthouse scores, and field data when Google has any.",
    source: "psi",
  },
  "ga4-live": {
    does: "Asks GA4's realtime report who has been on balkaris.ch in the last 30 minutes. Only while a desk screen that shows it is open; otherwise the run skips.",
    source: "ga4-live",
  },
  "ga4-warm": {
    does: "Asks GA4 for the eight 30-day reports the Command Center opens with, so its first screen never waits on Google. Every three hours while nobody is looking.",
    source: "ga4",
  },
  "gsc-access": {
    does: "Asks Google whether the desk may read Search Console yet: one cheap question each half hour, until the answer is yes.",
    source: "gsc",
  },
  "gsc-daily": {
    does: "Refreshes clicks, impressions, click-through rate and average position from Search Console for the last 7, 30 and 90 days.",
    source: "gsc",
  },
  "gsc-inspect": {
    does: "Asks Google's URL Inspection, page by page, whether each page of the sitemap is indexed.",
    source: "gsc",
  },
  "bing-daily": {
    does: "Reads Bing's inbound links with their anchor text, and Bing's own search and crawl figures.",
    source: "bing",
  },
  "clarity-daily": {
    does: "Takes the day's snapshot from Microsoft Clarity: sessions, scroll depth, time and friction per page. Clarity allows ten requests a day.",
    source: "clarity",
  },
  "crux-daily": {
    does: "Reads field Core Web Vitals, what real Chrome visitors experienced over 28 days, from the Chrome UX Report.",
    source: "crux",
  },
};

/** The core API's floor between two asks of one job (src/cc/api.ts `floorMs`): its interval, never more than ten minutes. */
const floorMs = (every: number): number => Math.min(every, 600) * 1000;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** SQLite's datetime('now') is UTC without saying so. */
const sqlTime = (t: string | null): string | null => (t ? new Date(`${t.replace(" ", "T")}Z`).toISOString() : null);

const span = (start: string | null, end: string | null): number | null => {
  if (!start || !end) return null;
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
};

/* ---------- the jobs ---------------------------------------------------------- */

type Listed = ReturnType<typeof status>[number];

function sourceOf(id: SourceId, all: SourceStatus[]): JobSource | null {
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

/** Runs per job in a window, from the scheduler's own table. */
function runCounts(fromIso: string, toIso: string): Map<string, { ok: number; failed: number }> {
  const rows = db
    .prepare(
      `SELECT job, SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS ok, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failed
         FROM cc_runs WHERE started >= ? AND started < ? GROUP BY job`,
    )
    .all(fromIso, toIso) as { job: string; ok: number | null; failed: number | null }[];
  return new Map(rows.map((r) => [r.job, { ok: r.ok ?? 0, failed: r.failed ?? 0 }]));
}

/**
 * Jobs that a source paused, with until when. Only the speed test has a
 * pause today: after Google answers 429 it is "not ready" for 24 hours and
 * then runs again by itself, with or without a key. Read from the website
 * collector, loaded here and not at the top so that a collector which failed
 * to load costs the pause and not the screen.
 */
type Pauses = (name: string) => string | null;

async function pauses(): Promise<Pauses> {
  try {
    const site = await import("../site/index.ts");
    const speed = site.speedPausedUntil();
    return (name) => (name === "speed" ? speed : null);
  } catch {
    return () => null;
  }
}

function stateOf(j: Listed, source: JobSource | null, pausedUntil: string | null): JobState {
  if (j.running) return "running";
  if (!j.enabled) return "off";
  if (!j.ready) {
    /* Told to wait by its source: it runs again by itself when the pause ends. */
    if (pausedUntil) return "paused";
    /* Not ready and its source not connected: waiting for a key, an API to
       enable or an account to be added. Not ready while the source IS
       connected (Search Console's access question, once Google says yes) is
       a job with nothing left to do, not a wait. */
    if (source?.state !== "connected") return "waiting";
  }
  if (j.lastOk === null) return "new";
  return j.lastOk ? "ok" : "failed";
}

function buildJobs(now: number, pausedOf: Pauses): AutomationJob[] {
  const all = sources();
  const day = runCounts(new Date(now - DAY).toISOString(), new Date(now + HOUR).toISOString());
  return status().map((j) => {
    const known = KNOWN[j.name];
    const source = known ? sourceOf(known.source, all) : null;
    const pausedUntil = !j.running && j.enabled && !j.ready ? pausedOf(j.name) : null;
    const state = stateOf(j, source, pausedUntil);
    /* The scheduler writes no end for a run a restart cut off, so an open row
       is the run in progress only when it is the newest row of the job
       running now; every other open row was cut off. */
    const runs: AutomationRun[] = history(j.name, 20).map((r, i) => ({
      start: r.start,
      end: r.end,
      state: r.ok === null ? (j.running && i === 0 ? "running" : "cut") : r.ok ? "ok" : "failed",
      ms: r.ok === null ? null : span(r.start, r.end),
      ok: r.ok,
      note: r.note === null ? null : scrub(r.note),
    }));
    const finished = runs.filter((r) => r.ms !== null);
    const lastNote = j.lastNote === null ? null : scrub(j.lastNote);
    /* "Last run" is the newest run that FINISHED, with its own start, length
       and line, never the start of a run in progress or cut off beside the
       result of the one before. Past the week of runs kept, the job's own row
       still has the end and the result; its start is known only when no
       later run has overwritten it. */
    const newest = runs.find((r) => r.ok !== null);
    const last: FinishedRun | null = newest
      ? { start: newest.start, end: newest.end as string, ms: newest.ms, ok: newest.ok as boolean, note: newest.note }
      : j.lastEnd && j.lastOk !== null
        ? (() => {
            const start = j.lastStart && j.lastStart <= j.lastEnd ? j.lastStart : null;
            return { start, end: j.lastEnd, ms: span(start, j.lastEnd), ok: j.lastOk, note: lastNote };
          })()
        : null;
    /* A paused job starts again when its pause is over and its interval since
       its last start has passed, whichever is later (scheduler.due). */
    const nextRun =
      state === "paused" && pausedUntil
        ? new Date(Math.max(Date.parse(pausedUntil), j.lastStart ? Date.parse(j.lastStart) + j.every * 1000 : 0)).toISOString()
        : j.nextRun;
    const askable = j.ready && j.enabled && !j.running;
    return {
      name: j.name,
      title: j.title,
      does: known?.does ?? "A job registered by a collector that this screen has no description for yet: its title is what it says it does.",
      every: j.every,
      state,
      enabled: j.enabled,
      ready: j.ready,
      running: j.running,
      pausedUntil: state === "paused" ? pausedUntil : null,
      progress: j.progress ? { ...j.progress, ...(j.progress.what ? { what: scrub(j.progress.what) } : {}) } : null,
      source,
      lastStart: j.lastStart,
      lastEnd: j.lastEnd,
      lastOk: j.lastOk,
      lastNote,
      last,
      nextRun,
      runs: j.runs,
      fails: j.fails,
      day: day.get(j.name) ?? { ok: 0, failed: 0 },
      durations: finished
        .slice(0, 20)
        .map((r) => r.ms as number)
        .reverse(),
      recent: runs.slice(0, 8),
      askableFrom: askable ? new Date(j.lastStart ? Math.max(now, Date.parse(j.lastStart) + floorMs(j.every)) : now).toISOString() : null,
    };
  });
}

/** Ready, on, not running, and its next run has come. */
const isDue = (j: Pick<Listed, "ready" | "enabled" | "running" | "nextRun">, now: number): boolean =>
  j.ready && j.enabled && !j.running && j.nextRun !== null && Date.parse(j.nextRun) <= now;

/* ---------- the tiles ----------------------------------------------------------- */

/** One count per hour for the last 24 hours, oldest first. */
function hourly(rows: { started: string; ok: number | null }[], now: number, want: 0 | 1): number[] {
  const out = Array.from({ length: 24 }, () => 0);
  for (const r of rows) {
    if (r.ok !== want) continue;
    const i = Math.floor((Date.parse(r.started) - (now - DAY)) / HOUR);
    if (i >= 0 && i < 24) out[i] = (out[i] ?? 0) + 1;
  }
  return out;
}

function tiles(jobs: AutomationJob[], now: number): AutomationsPayload["tiles"] {
  const at = new Date(now).toISOString();
  const recent = db
    .prepare("SELECT started, ok FROM cc_runs WHERE started >= ? ORDER BY started")
    .all(new Date(now - 2 * DAY).toISOString()) as { started: string; ok: number | null }[];
  const firstRun = (db.prepare("SELECT MIN(started) AS s FROM cc_runs").get() as { s: string | null }).s;
  /* The day before is compared only when the scheduler was keeping runs for all of it. */
  const measuredBefore = firstRun !== null && Date.parse(firstRun) <= now - 2 * DAY;
  const lastDay = recent.filter((r) => Date.parse(r.started) >= now - DAY);
  const dayBefore = recent.filter((r) => Date.parse(r.started) < now - DAY);
  const count = (rows: typeof recent, want: 0 | 1) => rows.filter((r) => r.ok === want).length;
  const NOTE = "The desk's own scheduler. It keeps a week of runs; a run cut off by a restart counts as neither.";

  const on = jobs.filter((j) => j.enabled).length;
  const waitingJobs = jobs.filter((j) => j.state === "waiting");
  const waitingSources = [...new Set(waitingJobs.map((j) => j.source?.name).filter((n): n is string => !!n))];
  /* A paused job is not waiting for a credential: it runs again by itself. Named in the note, not counted. */
  const paused = jobs.filter((j) => j.state === "paused" && j.nextRun);
  const pausedNote = paused.length
    ? ` Not counted: ${paused.map((j) => `"${j.title}", paused by its source, which runs again by itself after ${(j.nextRun as string).slice(0, 16).replace("T", " ")} UTC`).join("; ")}.`
    : "";
  const running = jobs.filter((j) => j.running).length;

  const stat = (value: number, extra: Partial<Stat> = {}): Stat => ({ value, previous: null, unit: "count", series: [], ...extra });

  const nextUp = jobs
    .filter((j) => (j.ready || j.state === "paused") && j.enabled && !j.running && j.nextRun)
    .sort((a, b) => Date.parse(a.nextRun as string) - Date.parse(b.nextRun as string))[0];

  const ran = lastDay.filter((r) => r.ok !== null).length;

  return {
    jobs: ok(
      stat(jobs.length, {
        sub: [`${on} on`, jobs.length - on ? `${jobs.length - on} switched off` : null, running ? `${running} running now` : null].filter(Boolean).join(", "),
      }),
      "desk",
      at,
      NOTE,
    ),
    succeeded: ran
      ? ok(
          stat(count(lastDay, 1), {
            of: ran,
            previous: measuredBefore ? count(dayBefore, 1) : null,
            series: hourly(lastDay, now, 1),
            sub: "runs finished in the last 24 hours",
          }),
          "desk",
          at,
          NOTE,
        )
      : waiting("desk", "No job has finished a run in the last 24 hours."),
    failed: ran
      ? ok(
          stat(count(lastDay, 0), {
            previous: measuredBefore ? count(dayBefore, 0) : null,
            series: hourly(lastDay, now, 0),
            sub: `in the last 24 hours, of ${ran} run${ran === 1 ? "" : "s"}`,
          }),
          "desk",
          at,
          NOTE,
        )
      : waiting("desk", "No job has run in the last 24 hours."),
    waiting: ok(
      stat(waitingJobs.length, {
        of: jobs.length,
        sub: waitingSources.length ? `${waitingSources.length} source${waitingSources.length === 1 ? "" : "s"} not connected` : "every job's source is connected",
      }),
      "desk",
      at,
      (waitingSources.length
        ? `Waiting for: ${waitingSources.join(", ")}. A job waiting for a credential is listed and not run until its source is connected; it is not counted as failing.`
        : "A job waiting for a credential is listed and not run until its source is connected; it is not counted as failing.") + pausedNote,
    ),
    next: nextUp
      ? ok<NextRun>({ at: nextUp.nextRun as string, name: nextUp.name, title: nextUp.title }, "desk", at, NOTE)
      : waiting("desk", "No job is scheduled: each one is running, switched off or waiting for a credential."),
  };
}

/* ---------- the workstation's article writer ---------------------------------------- */

interface WorkRow {
  id: number;
  kind: string;
  state: string;
  attempts: number;
  created_at: string;
  taken_at: string | null;
  finished_at: string | null;
  error: string | null;
  title: string | null;
  site: string | null;
  url: string | null;
}

const WORK_SQL = `SELECT j.id, j.kind, j.state, j.attempts, j.created_at, j.taken_at, j.finished_at, j.error, l.title, l.site, l.url
  FROM jobs j LEFT JOIN links l ON l.id = j.link_id`;

/** The link a piece of work is about, by its own title; never who shared it. */
function whatOf(r: WorkRow): string {
  if (r.title?.trim()) return r.title.trim();
  if (r.site?.trim()) return r.site.trim();
  try {
    return r.url ? new URL(r.url).host : "A shared link";
  } catch {
    return "A shared link";
  }
}

const work = (r: WorkRow): RunnerWork => ({
  id: r.id,
  kind: r.kind,
  what: scrub(whatOf(r)),
  state: r.state,
  attempts: r.attempts,
  queued: sqlTime(r.created_at) as string,
  taken: sqlTime(r.taken_at),
  finished: sqlTime(r.finished_at),
  ...(r.error ? { error: scrub(r.error).slice(0, 240) } : {}),
});

/** Awake means it asked for work within this long. The same five minutes as the top bar's check (src/cc/system.ts). */
const AWAKE_MS = 5 * 60_000;

function runner(now: number): Reading<Runner> {
  const q = queueState();
  const seen = sqlTime(lastBeat());
  const doing = (db.prepare(`${WORK_SQL} WHERE j.state = 'running' ORDER BY j.id`).all() as unknown as WorkRow[]).map(work);
  const recent = (db.prepare(`${WORK_SQL} WHERE j.state IN ('done', 'stuck') ORDER BY j.id DESC LIMIT 5`).all() as unknown as WorkRow[]).map(work);
  return ok<Runner>(
    {
      lastSeen: seen,
      awake: seen !== null && now - Date.parse(seen) < AWAKE_MS,
      queue: { queued: q.queued, running: q.running, stuck: q.stuck, drafts: q.drafts },
      doing,
      recent,
    },
    "runner",
    new Date(now).toISOString(),
    "The desk's queue and the workstation's last request for work. It writes only while the workstation is switched on.",
  );
}

/* ---------- the website's own automation ------------------------------------------- */

const WORKFLOW = ".github/workflows/search.yml";
const SCRIPT = "scripts/announce.mjs";

async function workflow(): Promise<Reading<SiteWorkflow>> {
  /* Loaded here and not at the top, so a website collector that failed to
     load costs this one panel and not the screen. */
  const site = await import("../site/index.ts");
  if (!site.readCopyExists()) {
    return off(
      "repo",
      "The desk has no read copy of the website's repository yet, so it cannot read the workflow.",
      "Nothing to set up: the repository job makes the copy itself on its next run.",
    );
  }
  const fetched = site.repoFetchedAt();
  if (!fetched) return waiting("repo", "The website's repository has not been fetched yet; the first fetch runs within a minute of the desk starting.");

  /* One key, kept ten minutes: the two files change a few times a year. */
  const read = await cached("automations:workflow", 10 * 60_000, async () => {
    const [file, script, fileChange, scriptChange] = await Promise.all([
      site.repoRead(WORKFLOW),
      site.repoRead(SCRIPT),
      site.lastChange(WORKFLOW),
      site.lastChange(SCRIPT),
    ]);
    return { file, script, fileChange, scriptChange };
  });
  const { file, script } = read.value;
  if (file === null) return off("repo", `The website's repository has no ${WORKFLOW} any more, so nothing announces its changes.`);

  const change = (c: { sha: string; at: string; subject: string } | null): FileChange | null =>
    c ? { sha: c.sha, at: c.at, subject: c.subject, href: site.commitUrl(c.sha) } : null;
  const repoHref = site.commitUrl("0");
  const runsHref = repoHref ? repoHref.replace(/\/commit\/0$/, `/actions/workflows/${WORKFLOW.split("/").pop()}`) : null;
  const feed = script ? (/FEED\s*=\s*`\$\{SITE\}([^`]+)`/.exec(script)?.[1] ?? null) : null;

  return ok<SiteWorkflow>(
    {
      file: WORKFLOW,
      script: SCRIPT,
      fileChange: change(read.value.fileChange),
      scriptChange: change(read.value.scriptChange),
      onDeploy: /deployment_status/.test(file) && /Production/.test(file) && file.includes(SCRIPT),
      byHand: /workflow_dispatch/.test(file),
      /* Each step is claimed only when the script still does it: it reads two
         sitemaps and keeps what is new, gone or re-dated. */
      compares: !!script && /sitemap\(/.test(script) && /\bbefore\(/.test(script) && /\.has\(/.test(script),
      indexNow: !!script && /indexnow/i.test(script),
      webSub: !!script && /pubsubhubbub|websub/i.test(script),
      /* "The feed only changes when an article does": the hub is pinged only
         when one of the changed addresses is under /insights/. */
      webSubArticlesOnly: !!script && /\.some\([^\n]*\/insights\//.test(script),
      feed,
      runsHref,
    },
    "repo",
    new Date(read.at).toISOString(),
    "Read from the workflow's own files in the website's repository. How its runs went is on GitHub: the desk has no token to read them.",
  );
}

/* ---------- the attention rules ------------------------------------------------------ */

/**
 * The rules behind "Attention required" are the Command Center's module
 * (src/cc/attention.ts), written beside this screen. They are read if that
 * module exists and exports a list; nothing here depends on its exact shape
 * beyond an id, a title and a sentence per rule.
 */
const RULES_FILE = new URL("../attention.ts", import.meta.url);

type RuleLike = Record<string, unknown>;

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function asRule(r: RuleLike, i: number): AlertRule | null {
  const title = text(r.title) ?? text(r.name) ?? text(r.id);
  const rule = text(r.rule) ?? text(r.watches) ?? text(r.description) ?? text(r.text) ?? text(r.what);
  if (!title || !rule) return null;
  const threshold = text(r.threshold) ?? text(r.yardstick);
  const state = r.state === "ok" || r.state === "waiting" || r.state === "off" ? r.state : undefined;
  return {
    id: text(r.id) ?? `rule-${i}`,
    title,
    area: text(r.area),
    source: (text(r.source) as SourceId | null) ?? null,
    rule: threshold && !rule.includes(threshold) ? `${rule} Threshold: ${threshold}` : rule,
    ...(state ? { state } : {}),
    ...(text(r.reason) ? { reason: text(r.reason) as string } : {}),
    ...(text(r.step) ? { step: text(r.step) as string } : {}),
  };
}

async function rules(): Promise<Reading<AlertRule[]>> {
  if (!existsSync(fileURLToPath(RULES_FILE))) {
    return off("desk", "The attention rules are written with the Command Center and are not on this desk yet. They are listed here once that module exists.");
  }
  const mod = (await import(RULES_FILE.href)) as Record<string, unknown>;
  for (const name of ["RULES", "rules", "ATTENTION_RULES", "attentionRules", "listRules"]) {
    let v = mod[name];
    if (typeof v === "function") v = await (v as () => unknown)();
    if (Array.isArray(v)) {
      const all = sources();
      const list = v
        .flatMap((r, i) => (r && typeof r === "object" ? [asRule(r as RuleLike, i)] : []))
        .filter((r): r is AlertRule => r !== null)
        /* A rule can only find something when what it reads answers: say so
           beside each one, in the source's own words, unless the module did. */
        .map((r) => {
          if (r.state || !r.source) return r;
          const s = all.find((x) => x.id === r.source);
          if (!s || s.state === "connected") return { ...r, state: "ok" as const };
          return {
            ...r,
            state: s.state === "off" ? ("off" as const) : ("waiting" as const),
            reason: s.state === "off" ? `${s.name} is not connected.` : s.state === "failing" ? `${s.name} is failing.` : `${s.name} has not answered yet.`,
            ...(s.step && s.state === "off" ? { step: s.step } : {}),
          };
        });
      return ok(list, "desk", new Date().toISOString(), "The rules behind the Command Center's Attention required; each says what it compares and its threshold.");
    }
  }
  return waiting("desk", "The attention module exists but exports no list of rules this screen can read.");
}

/* ---------- the activity log ---------------------------------------------------------- */

const TONES: readonly Tone[] = ["bad", "warn", "good", "info", "quiet"];
const PER = 25;

function activityPage(kinds: string[], tone: Tone | null, page: number): Reading<ActivityPage> {
  const where: string[] = [];
  const args: string[] = [];
  if (kinds.length) {
    where.push(`kind IN (${kinds.map(() => "?").join(",")})`);
    args.push(...kinds);
  }
  const byKind = where.length ? `WHERE ${where.join(" AND ")}` : "";
  if (tone) {
    where.push("tone = ?");
    args.push(tone);
  }
  const filtered = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = (db.prepare(`SELECT COUNT(*) AS n FROM cc_activity ${filtered}`).get(...args) as { n: number }).n;
  const pages = Math.max(1, Math.ceil(total / PER));
  const at = Math.min(Math.max(1, page), pages);
  const rows = db
    .prepare(`SELECT id, at, kind, tone, text, detail, href, actor FROM cc_activity ${filtered} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...args, PER, (at - 1) * PER) as {
    id: number;
    at: string;
    kind: string;
    tone: Tone;
    text: string;
    detail: string | null;
    href: string | null;
    actor: string | null;
  }[];
  const items: ActivityItem[] = rows.map((r) =>
    scrubItem({
      id: r.id,
      at: r.at,
      kind: r.kind,
      tone: TONES.includes(r.tone) ? r.tone : "info",
      text: r.text,
      ...(r.detail ? { detail: r.detail } : {}),
      ...(r.href ? { href: r.href } : {}),
      ...(r.actor ? { actor: r.actor } : {}),
    }),
  );
  const kindList = db.prepare("SELECT kind, COUNT(*) AS count FROM cc_activity GROUP BY kind ORDER BY count DESC, kind LIMIT 40").all() as {
    kind: string;
    count: number;
  }[];
  const toneList = (
    db.prepare(`SELECT tone, COUNT(*) AS count FROM cc_activity ${byKind} GROUP BY tone`).all(...(kinds.length ? kinds : [])) as {
      tone: Tone;
      count: number;
    }[]
  ).filter((t) => TONES.includes(t.tone));

  const first = (db.prepare("SELECT MIN(at) AS a FROM cc_activity").get() as { a: string | null }).a;
  return ok<ActivityPage>(
    {
      items,
      total,
      page: at,
      pages,
      per: PER,
      kinds: kindList.map((k) => ({ kind: k.kind, count: k.count })),
      tones: toneList.sort((a, b) => TONES.indexOf(a.tone) - TONES.indexOf(b.tone)),
      filter: { kinds, tone },
    },
    "desk",
    new Date().toISOString(),
    `What the desk's collectors and people wrote down${first ? `, since ${first.slice(0, 10)}` : ""}. Nothing about an enquiry is ever kept here.`,
  );
}

/* ---------- the routes ------------------------------------------------------------------ */

const asKinds = (raw: string | undefined): string[] =>
  [
    ...new Set(
      (raw ?? "")
        .split(",")
        .map((k) => k.trim())
        .filter((k) => /^[\w.-]{1,40}$/.test(k)),
    ),
  ].slice(0, 12);

const asTone = (raw: string | undefined): Tone | null => (TONES.includes(raw as Tone) ? (raw as Tone) : null);

routes.get("/", async (c) => {
  const now = Date.now();
  const kinds = asKinds(c.req.query("kinds"));
  const tone = asTone(c.req.query("tone"));
  const page = Number.parseInt(c.req.query("page") ?? "1", 10) || 1;

  const pausedOf = await pauses();
  const jobsRead = await reading<AutomationJob[]>("desk", () =>
    ok(buildJobs(now, pausedOf), "desk", new Date(now).toISOString(), "The desk's own scheduler: one job at a time, a week of runs kept."),
  );
  const list = jobsRead.state === "ok" ? jobsRead.value : [];

  /* The tiles are counted from the same jobs; if either read failed, each tile says so in place. */
  const tileRead = jobsRead.state === "ok" ? await reading("desk", () => ok(tiles(list, now), "desk", now)) : jobsRead;
  const tileSet: AutomationsPayload["tiles"] =
    tileRead.state === "ok"
      ? tileRead.value
      : { jobs: tileRead, succeeded: tileRead, failed: tileRead, waiting: tileRead, next: tileRead };

  const [runnerRead, workflowRead, rulesRead, activityRead] = await Promise.all([
    reading("runner", () => runner(now)),
    reading("repo", workflow),
    reading("desk", rules),
    reading("desk", () => activityPage(kinds, tone, page)),
  ]);

  return c.json<AutomationsPayload>({
    at: new Date(now).toISOString(),
    tiles: tileSet,
    failing: list.filter((j) => j.state === "failed").length,
    jobs: jobsRead,
    due: list.filter((j) => isDue(j, now)).map((j) => j.name),
    runner: runnerRead,
    workflow: workflowRead,
    rules: rulesRead,
    activity: activityRead,
  });
});

/**
 * Put every job whose time has come at the front of the queue. It is
 * Automations' own change, so it needs edit on Automations (the gate), the
 * level that also runs any one job: it asks for nothing the scheduler would
 * not start by itself within minutes, and the scheduler still runs one job at
 * a time. A job is due when it is ready, on, not running, and its next run has
 * passed, which also means its last start is further back than the core
 * API's floor for asking.
 */
routes.post("/run-due", (c) => {
  const now = Date.now();
  const all = status();
  const asked = all.filter((j) => isDue(j, now) && runNow(j.name)).map((j) => j.title);
  if (asked.length) {
    return c.json<RunDueAnswer>({
      ok: true,
      asked,
      said: `${asked.length === 1 ? "One job was" : `${asked.length} jobs were`} put at the front of the queue: ${asked.join("; ")}. They run one at a time.`,
    });
  }
  const next = all
    .filter((j) => j.ready && j.enabled && !j.running && j.nextRun)
    .sort((a, b) => Date.parse(a.nextRun as string) - Date.parse(b.nextRun as string))[0];
  const minutes = next ? Math.max(1, Math.round((Date.parse(next.nextRun as string) - now) / 60_000)) : null;
  return c.json<RunDueAnswer>({
    ok: true,
    asked: [],
    said: next ? `Nothing is due. The next run is "${next.title}", in ${minutes} minute${minutes === 1 ? "" : "s"}.` : "Nothing is due: no job is scheduled.",
  });
});
