import { db } from "../../db.ts";
import type { Person } from "../../people.ts";
import { runNow, status as jobStatus } from "../scheduler.ts";
import { note, setState, state } from "../store.ts";
import { scrub } from "../system.ts";
import type { AuditChanges, AuditCounts, AuditDetail, AuditKept, AuditRun, AuditStep } from "../../../web/src/contract/seo/common.ts";
import { indexCheckWhole, indexFigures, keywordFigures, openOpportunities } from "./figures.ts";
import { json, now } from "./tables.ts";

/**
 * "RUN FULL SEO AUDIT": every job the SEO section's figures come from, one
 * after the other, on the desk's one scheduler.
 *
 *   sitemap         what the site lists (the crawl and the index check read it)
 *   crawl           every page, its findings and the site score
 *   gsc-daily       Search Console's figures for the screens
 *   gsc-inspect     Google's URL Inspection of every sitemap address: what is indexed
 *   seo-snapshot    the newest finished days into the rank history
 *   speed           PageSpeed runs of the most important pages
 *   seo-readiness   every page checked for AI search
 *   seo-referrals   referrals and AI-assistant visits from GA4
 *   seo-presence    the studio's profiles and listings
 *   seo-engine      the opportunity rules over all of the above, last
 *
 * A DEEP audit also researches phrases in Google Autocomplete (seo-research,
 * which spends its weekly budget of requests) and reads competitors' pages
 * (seo-competitors, two seconds apart per site): slow and budgeted, so they
 * are a choice, not part of every press.
 *
 * ONE STEP AT A TIME, ASKED WHEN ITS TURN COMES. The audit does not hand the
 * scheduler the whole list at once: it asks for a step, waits until that run
 * has ended, then decides the next one. So a step that depends on the one
 * before sees its result (the readiness check needs a crawl), a step is
 * judged fresh or not at the moment it would run, and the wait between two
 * steps is a second, not the scheduler's half-minute. Something has to keep
 * the audit moving when nobody is looking at the page, so while one is open
 * a one-second timer here calls `advance`; every read of the audit calls it
 * too.
 *
 * WHAT IS NOT RUN AGAIN. A step whose job finished well moments ago uses that
 * run (the crawl has no budget and must not read the site twice in ten
 * minutes; PageSpeed and the index check have a daily allowance). A job that
 * is ALREADY RUNNING when its turn comes is followed to its end instead of
 * asked twice. One that cannot run (not connected, switched off by the owner)
 * is skipped with the reason. The index check is the exception to freshness:
 * a day that was cut short (Google answered 500 after seventeen addresses) is
 * finished whatever the hour, because the check asks first for the addresses
 * that have no result yet.
 *
 * WHAT IS KEPT. The audit as it stands is in cc_state (a page that polls reads
 * it cheaply) and every audit is a row of cc_seo_audits with the section's
 * headline counts as it started and as it ended, so "what did it find" has an
 * answer afterwards (`audits`, `auditDetail`). A desk restart forgets the
 * scheduler's queue but not the audit: a step that was asked and never
 * started is asked again; one the restart cut off in the middle is said to
 * have failed, and the rest still run.
 */

interface StepPlan {
  job: string;
  title: string;
  /** A run that finished well less than this ago is used instead of a new one; 0: always run. */
  freshMs: number;
  /** Only in a deep audit. */
  deep?: boolean;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

/** The steps, in the order they run. Exported for the check script and for the page that explains an audit. */
export const STEPS: readonly StepPlan[] = [
  { job: "sitemap", title: "Read the sitemap and robots.txt", freshMs: 5 * MIN },
  { job: "crawl", title: "Read every page of the website", freshMs: 10 * MIN },
  { job: "gsc-daily", title: "Refresh Search Console's figures", freshMs: HOUR },
  { job: "gsc-inspect", title: "Ask Google which pages it has indexed", freshMs: 6 * HOUR },
  { job: "seo-snapshot", title: "Keep the newest days of rankings", freshMs: 0 },
  { job: "speed", title: "Measure page speed", freshMs: 12 * HOUR },
  { job: "seo-readiness", title: "Check AI search readiness", freshMs: 30 * MIN },
  { job: "seo-referrals", title: "Read referrals and AI assistant visits", freshMs: HOUR },
  { job: "seo-presence", title: "Check profiles and listings", freshMs: 6 * HOUR },
  { job: "seo-research", title: "Research search phrases", freshMs: 0, deep: true },
  { job: "seo-competitors", title: "Read competitors' pages", freshMs: 6 * HOUR, deep: true },
  { job: "seo-engine", title: "Find opportunities", freshMs: 0 },
];

/** The job names of an audit, deep ones included: what a page may take for "the audit is running". */
export const AUDIT_JOBS: readonly string[] = STEPS.map((s) => s.job);

const KEY = "seo:audit";
/** An audit is shown in the head this long after it finished. */
const SHOWN_MS = HOUR;
/** A step asked this long ago that never started is given up: something holds the scheduler. */
const LOST_MS = 45 * MIN;
/** An audit still open this long after it was asked is closed with what is left marked as not run. */
const GIVE_UP_MS = 6 * HOUR;
/** A step asked and not started while nothing runs is asked again after this: the scheduler looks only twice a minute by itself. */
const NUDGE_MS = 3_000;
/** How many audits are kept. */
const KEEP = 60;
/** When this desk process started: a step asked before it and not started since was in the queue the restart forgot. */
const BOOT = new Date(Date.now() - process.uptime() * 1000).toISOString();
/** Jobs register as the desk starts; a step is not called "no such job" before this much uptime. */
const SETTLE_MS = 30_000;

interface KeptStep {
  job: string;
  title: string;
  /** pending: its turn has not come. asked: the scheduler has it (or the run it follows was already going). */
  state: "pending" | "asked" | "done" | "failed" | "skipped";
  /** When it was asked for, or the start of the run it follows. */
  asked: string | null;
  /** When the scheduler was last reminded of it. */
  nudged: string | null;
  note: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

interface Kept {
  id: string;
  startedAt: string;
  by: string;
  deep: boolean;
  finishedAt: string | null;
  steps: KeptStep[];
  before: AuditCounts;
}

const minutes = (ms: number): string => {
  const m = Math.max(1, Math.round(ms / MIN));
  return m >= 120 ? `${Math.round(m / 60)} hours` : `${m} minute${m === 1 ? "" : "s"}`;
};

const over = (s: KeptStep): boolean => s.state === "done" || s.state === "failed" || s.state === "skipped";

const read = (): Kept | null => {
  const k = json<Kept | null>(state(KEY), null);
  return k && Array.isArray(k.steps) ? k : null;
};

/* ---------- the counts an audit is measured by --------------------------------------------- */

const one = (sql: string, ...args: (string | number)[]): number | null => {
  try {
    const r = db.prepare(sql).get(...args) as { n: number | null } | undefined;
    return r?.n ?? null;
  } catch {
    return null;
  }
};

/** The section's headline counts now: the crawl's, the engine's, the index check's, the keyword table's. */
export function countsNow(): AuditCounts {
  const index = indexFigures();
  return {
    score: one("SELECT value AS n FROM cc_series WHERE metric = 'seo.score' ORDER BY day DESC LIMIT 1"),
    pages: one("SELECT COUNT(*) AS n FROM cc_pages"),
    critical: one("SELECT COUNT(*) AS n FROM cc_issues WHERE severity = 'critical'"),
    warning: one("SELECT COUNT(*) AS n FROM cc_issues WHERE severity = 'warning'"),
    opportunities: openOpportunities(),
    indexed: index ? index.indexed : null,
    notIndexed: index ? index.notIndexed : null,
    keywords: keywordFigures().tracked,
  };
}

/** What changed in the desk's tables since `from` (an audit's start), counted. */
function changesSince(from: string, to: string | null): AuditChanges {
  const until = to ?? "9999";
  return {
    opportunitiesNew: one("SELECT COUNT(*) AS n FROM cc_seo_opps WHERE first_seen >= ? AND first_seen <= ?", from, until) ?? 0,
    opportunitiesCleared: one("SELECT COUNT(*) AS n FROM cc_seo_opps WHERE active = 0 AND cleared_at >= ? AND cleared_at <= ?", from, until) ?? 0,
    findingsNew: one("SELECT COUNT(*) AS n FROM cc_issues WHERE first_seen >= ? AND first_seen <= ?", from, until) ?? 0,
    indexedNew: one("SELECT COUNT(*) AS n FROM cc_activity WHERE kind = 'gsc.indexed' AND at >= ? AND at <= ?", from, until) ?? 0,
    indexedLost: one("SELECT COUNT(*) AS n FROM cc_activity WHERE kind = 'gsc.dropped' AND at >= ? AND at <= ?", from, until) ?? 0,
    keywordsNew: one("SELECT COUNT(*) AS n FROM cc_seo_keywords WHERE first_seen >= ? AND first_seen <= ?", from, until) ?? 0,
  };
}

/* ---------- the history --------------------------------------------------------------------- */

const stateOf = (k: Kept): AuditRun["state"] => (k.steps.some((s) => !over(s)) ? "running" : k.steps.some((s) => s.state === "failed") ? "failed" : "done");

/** Write the audit as it stands: the cheap copy a polling page reads, and its row of the history. */
function keep(k: Kept, after: AuditCounts | null = null): void {
  setState(KEY, JSON.stringify(k));
  try {
    db.prepare(
      `INSERT INTO cc_seo_audits (id, started_at, finished_at, by, deep, state, steps, before, after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET finished_at = excluded.finished_at, state = excluded.state, steps = excluded.steps, after = COALESCE(excluded.after, cc_seo_audits.after)`,
    ).run(k.id, k.startedAt, k.finishedAt, k.by, k.deep ? 1 : 0, stateOf(k), JSON.stringify(k.steps), JSON.stringify(k.before), after ? JSON.stringify(after) : null);
    db.prepare("DELETE FROM cc_seo_audits WHERE id NOT IN (SELECT id FROM cc_seo_audits ORDER BY started_at DESC LIMIT ?)").run(KEEP);
  } catch (e) {
    /* The history is a record, not the audit: a desk whose table is not there yet still runs it. */
    console.warn(`cc seo audit: its history row was not written: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/* ---------- moving it along ----------------------------------------------------------------- */

let timer: NodeJS.Timeout | null = null;

function watch(): void {
  if (timer) return;
  timer = setInterval(() => {
    try {
      advance();
    } catch (e) {
      console.warn(`cc seo audit: could not move on: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, 1_000);
  timer.unref();
}

function rest(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Whether the index check's newest day was cut short: then it is finished whatever the hour. */
const indexCutShort = (): boolean => {
  try {
    return indexCheckWhole() === false;
  } catch {
    return false;
  }
};

type JobNow = ReturnType<typeof jobStatus>[number];

/** Decide a step whose turn has come: skip it with the reason, follow a run already going, or ask for it. */
function begin(s: KeptStep, j: JobNow | undefined, at: string): void {
  const plan = STEPS.find((p) => p.job === s.job);
  const skip = (why: string): void => {
    s.state = "skipped";
    s.note = why;
  };
  if (!j) return skip("This desk has no such job.");
  if (!j.ready) return skip("What it reads is not connected.");
  if (!j.enabled) return skip("The owner switched it off in Automations.");
  if (j.running && j.lastStart) {
    /* Already going (its own hour came, or somebody pressed its button): that run is this step. */
    s.state = "asked";
    s.asked = j.lastStart;
    s.note = "It was already running when its turn came; that run is used.";
    return;
  }
  const age = j.lastEnd ? Date.now() - Date.parse(j.lastEnd) : Infinity;
  const fresh = !!plan?.freshMs && j.lastOk === true && age < plan.freshMs;
  if (fresh && !(s.job === "gsc-inspect" && indexCutShort())) return skip(`It finished ${minutes(age)} ago; that run is used.`);
  if (!runNow(s.job)) return skip("The scheduler would not take it.");
  s.state = "asked";
  s.asked = at;
  s.nudged = at;
}

/**
 * Move the audit on as far as it can go now: close the step whose run has
 * ended, begin the next, and when the last is over write what the audit
 * found. Safe to call at any time and as often as anyone likes.
 */
export function advance(): void {
  const k = read();
  if (!k || k.finishedAt) return rest();
  const jobs = jobStatus();
  const busy = jobs.some((j) => j.running);
  const at = now();
  let changed = false;

  /* An audit still open long after it was asked (the desk was down for hours) is closed, not resumed:
     nobody is waiting for it any more, and a fresh one reads fresher. A step in the middle of its run
     is let finish. */
  if (Date.now() - Date.parse(k.startedAt) > GIVE_UP_MS) {
    for (const s of k.steps) {
      const j = jobs.find((x) => x.name === s.job);
      const going = s.state === "asked" && !!j?.running && !!j.lastStart && !!s.asked && j.lastStart >= s.asked;
      if (over(s) || going) continue;
      s.state = "failed";
      s.note = `The audit was given up ${minutes(GIVE_UP_MS)} after it was asked for. Run it again.`;
      changed = true;
    }
  }

  for (const s of k.steps) {
    if (over(s)) continue;
    const j = jobs.find((x) => x.name === s.job);

    if (s.state === "pending") {
      /* Just after a restart the jobs are still registering: wait rather than call one missing. */
      if (!j && process.uptime() * 1000 < SETTLE_MS) break;
      begin(s, j, at);
      changed = true;
      if (over(s)) continue;
      break;
    }

    /* Asked: has its run started, and ended? */
    if (!j) {
      s.state = "failed";
      s.note = "Its job is no longer on this desk.";
      changed = true;
      continue;
    }
    const started = !!j.lastStart && !!s.asked && j.lastStart >= s.asked;
    if (started && j.running) break;
    if (started && j.lastEnd && j.lastEnd >= j.lastStart!) {
      s.state = j.lastOk ? "done" : "failed";
      const said = j.lastNote ? scrub(j.lastNote) : null;
      s.note = s.note && said ? `${said} (${s.note})` : (said ?? s.note);
      s.startedAt = j.lastStart;
      s.endedAt = j.lastEnd;
      changed = true;
      continue;
    }
    if (started) {
      /* Began, does not run, never ended: the desk restarted under it. */
      s.state = "failed";
      s.note = "It was cut off when the desk restarted. Run the audit again to repeat it.";
      s.startedAt = j.lastStart;
      changed = true;
      continue;
    }
    const waited = Date.now() - Date.parse(s.asked ?? at);
    if (waited > LOST_MS && !(s.asked! < BOOT)) {
      s.state = "failed";
      s.note = `It did not start within ${minutes(LOST_MS)}: another job holds the scheduler. Run the audit again.`;
      changed = true;
      continue;
    }
    /* Not started. A restart forgot the queue, or the scheduler has not looked since the job before
       ended: ask again. Asking twice never runs it twice (the scheduler keeps one place per job). */
    if (!busy && (s.asked! < BOOT || Date.now() - Date.parse(s.nudged ?? s.asked ?? at) > NUDGE_MS)) {
      if (!runNow(s.job)) {
        s.state = "skipped";
        s.note = "It can no longer run: what it reads was disconnected, or the owner switched it off.";
        changed = true;
        continue;
      }
      if (s.asked! < BOOT) s.asked = at;
      s.nudged = at;
      changed = true;
    }
    break;
  }

  if (k.steps.every(over)) {
    k.finishedAt = k.steps.map((s) => s.endedAt).filter((x): x is string => !!x).sort().at(-1) ?? at;
    const after = countsNow();
    keep(k, after);
    rest();
    const ran = k.steps.filter((s) => s.state === "done").length;
    const skipped = k.steps.filter((s) => s.state === "skipped").length;
    const failed = k.steps.filter((s) => s.state === "failed");
    const c = changesSince(k.startedAt, null);
    note("seo-action", failed.length ? `The full SEO audit ended with ${failed.length} step${failed.length === 1 ? "" : "s"} failed` : "The full SEO audit finished", {
      tone: failed.length ? "warn" : "good",
      actor: k.by,
      detail: [
        `${ran} step${ran === 1 ? "" : "s"} run${skipped ? `, ${skipped} skipped` : ""}`,
        failed.length ? `failed: ${failed.map((s) => s.title).join(", ")}` : null,
        `${c.opportunitiesNew} new opportunit${c.opportunitiesNew === 1 ? "y" : "ies"}, ${c.opportunitiesCleared} cleared`,
        `open ${k.before.opportunities} → ${after.opportunities}`,
      ]
        .filter(Boolean)
        .join("; "),
      href: auditHref(k.id),
      dedupe: `seo:audit:end:${k.id}`,
    });
    return;
  }
  if (changed) keep(k);
  watch();
}

/** Where an audit's own page is. */
export const auditHref = (id: string): string => `/seo/list/audits?open=${encodeURIComponent(id)}`;

/** Ask for the audit. One already running is answered instead of a second. */
export function startAudit(by: Person, o: { deep?: boolean } = {}): AuditRun {
  const running = auditRun();
  if (running && running.state === "running") return running;
  const at = now();
  const deep = !!o.deep;
  const steps: KeptStep[] = STEPS.filter((s) => deep || !s.deep).map((s) => ({ job: s.job, title: s.title, state: "pending", asked: null, nudged: null, note: null, startedAt: null, endedAt: null }));
  const kept: Kept = { id: at, startedAt: at, by: by.name, deep, finishedAt: null, steps, before: countsNow() };
  keep(kept);
  note("seo-action", deep ? "Started a deep SEO audit" : "Started a full SEO audit", {
    tone: "info",
    actor: by.name,
    detail: `${steps.length} steps, one after the other: ${steps.map((s) => s.title).join("; ")}`,
    href: auditHref(at),
    dedupe: `seo:audit:${at}`,
  });
  advance();
  return auditRun()!;
}

/** A kept step as a page reads it, with the running job's progress laid over it. */
function shown(s: KeptStep, jobs: JobNow[]): AuditStep {
  const base = { job: s.job, title: s.title, note: s.note, progress: null, startedAt: s.startedAt, endedAt: s.endedAt };
  if (s.state === "pending") return { ...base, state: "queued", note: null };
  if (s.state !== "asked") return { ...base, state: s.state };
  const j = jobs.find((x) => x.name === s.job);
  const running = !!j?.running && !!j.lastStart && !!s.asked && j.lastStart >= s.asked;
  if (!running) return { ...base, state: "queued", note: null };
  return { ...base, state: "running", note: null, startedAt: j!.lastStart, progress: j!.progress?.what ? { ...j!.progress, what: scrub(j!.progress.what) } : (j!.progress ?? null) };
}

const runOf = (k: Kept, jobs: JobNow[]): AuditRun => ({ id: k.id, startedAt: k.startedAt, by: k.by, state: stateOf(k), finishedAt: k.finishedAt, steps: k.steps.map((s) => shown(s, jobs)), deep: k.deep });

/** The last audit as it stands now; null an hour after it finished, or before the first. */
export function auditRun(): AuditRun | null {
  let k = read();
  if (!k) return null;
  if (!k.finishedAt) {
    advance();
    k = read() ?? k;
  }
  if (k.finishedAt && Date.now() - Date.parse(k.finishedAt) > SHOWN_MS) return null;
  return runOf(k, jobStatus());
}

/* ---------- reading the history -------------------------------------------------------------- */

interface AuditDb {
  id: string;
  started_at: string;
  finished_at: string | null;
  by: string;
  deep: number;
  state: AuditRun["state"];
  steps: string;
  before: string;
  after: string | null;
}

const EMPTY: AuditCounts = { score: null, pages: null, critical: null, warning: null, opportunities: 0, indexed: null, notIndexed: null, keywords: 0 };

function keptOf(r: AuditDb, jobs: JobNow[]): AuditKept {
  const steps = json<KeptStep[]>(r.steps, []);
  const k: Kept = { id: r.id, startedAt: r.started_at, by: r.by, deep: !!r.deep, finishedAt: r.finished_at, steps, before: json<AuditCounts>(r.before, EMPTY) };
  return {
    ...runOf(k, jobs),
    deep: k.deep,
    before: k.before,
    after: json<AuditCounts | null>(r.after, null),
    changes: r.finished_at ? changesSince(r.started_at, r.finished_at) : null,
    href: auditHref(r.id),
  };
}

/** The audits kept, newest first. The one running now is moved on before it is read. */
export function audits(limit = 30): AuditKept[] {
  advance();
  const jobs = jobStatus();
  let rows: AuditDb[] = [];
  try {
    rows = db.prepare("SELECT * FROM cc_seo_audits ORDER BY started_at DESC LIMIT ?").all(limit) as unknown as AuditDb[];
  } catch {
    rows = [];
  }
  return rows.map((r) => keptOf(r, jobs));
}

/** What an audit found, row by row (fifty of each at most), or null for an id nothing is kept under. */
export function auditDetail(id: string): AuditDetail | null {
  advance();
  let r: AuditDb | undefined;
  try {
    r = db.prepare("SELECT * FROM cc_seo_audits WHERE id = ?").get(id) as unknown as AuditDb | undefined;
  } catch {
    r = undefined;
  }
  if (!r) return null;
  const from = r.started_at;
  const until = r.finished_at ?? "9999";
  const all = <T>(sql: string, ...args: (string | number)[]): T[] => {
    try {
      return db.prepare(sql).all(...args) as T[];
    } catch {
      return [];
    }
  };
  const opp = (o: { id: string; title: string; page: string | null; keyword: string | null; cluster: string | null; why?: string | null }) => ({
    id: o.id,
    title: o.title,
    subject: o.page ?? o.keyword ?? o.cluster ?? null,
    why: o.why ?? null,
    href: `/seo/opportunities?open=${encodeURIComponent(o.id)}`,
  });
  return {
    ...keptOf(r, jobStatus()),
    found: {
      opportunities: all<{ id: string; title: string; page: string | null; keyword: string | null; cluster: string | null }>(
        "SELECT id, title, page, keyword, cluster FROM cc_seo_opps WHERE first_seen >= ? AND first_seen <= ? ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id LIMIT 50",
        from,
        until,
      ).map(opp),
      cleared: all<{ id: string; title: string; page: string | null; keyword: string | null; cluster: string | null; why: string | null }>(
        "SELECT id, title, page, keyword, cluster, cleared_why AS why FROM cc_seo_opps WHERE active = 0 AND cleared_at >= ? AND cleared_at <= ? ORDER BY id LIMIT 50",
        from,
        until,
      ).map(opp),
      findings: all<{ rule: string; severity: string; path: string | null; text: string }>(
        "SELECT rule, severity, path, text FROM cc_issues WHERE first_seen >= ? AND first_seen <= ? ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, path LIMIT 50",
        from,
        until,
      ),
      index: all<{ kind: string; text: string; at: string }>("SELECT kind, text, at FROM cc_activity WHERE kind IN ('gsc.indexed', 'gsc.dropped') AND at >= ? AND at <= ? ORDER BY at LIMIT 50", from, until).map((e) => ({
        indexed: e.kind === "gsc.indexed",
        text: scrub(e.text),
        at: e.at,
      })),
    },
  };
}

/* An audit that was running when the desk stopped goes on by itself once the jobs have registered. */
setTimeout(() => {
  try {
    const k = read();
    if (k && !k.finishedAt) watch();
  } catch {
    /* the store is not there yet: the next read of the audit moves it on */
  }
}, SETTLE_MS).unref();
