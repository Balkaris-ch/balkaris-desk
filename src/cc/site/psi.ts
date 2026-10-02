import type { DayPoint, Reading } from "../../../web/src/contract/common.ts";
import { db } from "../../db.ts";
import type { Job } from "../scheduler.ts";
import { off, ok, record, series, setState, state, today, waiting } from "../store.ts";
import { abs, median } from "./http.ts";
import { probeIfDue } from "./probes.ts";
import { lastSitemap } from "./sitemap.ts";

/**
 * How fast the pages are, as Google's own test measures them.
 *
 * Once a day the desk asks the PageSpeed Insights API to load six pages on
 * a simulated phone and on a desktop. The test (Lighthouse) runs on Google's
 * machines, not on the box: the box has no Chrome and no memory for one.
 *
 * TWO DIFFERENT KINDS OF NUMBER COME BACK, and every reading here says which
 * it is, because mixing them up is the commonest way a speed dashboard lies:
 *
 *   LAB    one load, on Google's machine, on a throttled connection, with
 *          nobody clicking. Repeatable and available for any page from the
 *          first day. It is a measurement of the page, not of any visitor.
 *          LCP, CLS, FCP, Speed Index and Total Blocking Time are lab numbers.
 *
 *   FIELD  what real Chrome users experienced over the last 28 days, from
 *          the Chrome UX Report, at the 75th percentile. Google only
 *          publishes it for a site with enough visits. For a site this size
 *          it may simply not exist, and then there is NO field number: not a
 *          zero, not the lab number under another name.
 *
 * INP EXISTS ONLY IN THE FIELD. Interaction to Next Paint is the delay after
 * a real person taps something, and a lab load taps nothing. So without
 * field data the INP reading is `off` with that reason, and Total Blocking
 * Time, the lab's closest relative, is offered under its own name. It is
 * never passed off as INP.
 *
 * SLOW AND SEQUENTIAL BY NATURE. Each run takes Google ten to thirty
 * seconds, twelve runs a day, one after the other. Keyless until
 * GOOGLE_API_KEY is set; Google publishes no quota for either, so when it
 * answers 429 the desk stops, says so, and does not ask again for 24 hours
 * (the job is "not ready" meanwhile, so it neither runs nor counts as
 * failing). A sweep that Google refused before it measured a single page is
 * a FAILED run, not a quiet success: nothing was measured.
 *
 * THE HEADLINE IS THE NEWEST SWEEP, NOT ALL HISTORY. The list of pages moves
 * ("the newest article" changes with every publish), so the lab figures are
 * taken from the newest day that measured anything, the same rows that day's
 * line in cc_series is computed from. A page tested months ago and since
 * dropped from the list is not in today's median.
 *
 * The history is the desk's alone: one line per metric per day in cc_series
 * from the first run. Nobody can ask Google what a page scored last month.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS cc_vitals (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    at            TEXT NOT NULL,
    day           TEXT NOT NULL,
    path          TEXT NOT NULL,
    /* 'mobile' or 'desktop'. Always asked for by name: the API's default is desktop. */
    strategy      TEXT NOT NULL,
    /* Lighthouse category scores, 0 to 100. NULL when the run failed. */
    performance   REAL,
    seo           REAL,
    accessibility REAL,
    practices     REAL,
    /* Lab values. */
    lcp_ms        REAL,
    cls           REAL,
    tbt_ms        REAL,
    fcp_ms        REAL,
    si_ms         REAL,
    /* Field data for this page and for the whole origin, as JSON, or NULL
       when Google has none. */
    field         TEXT,
    origin_field  TEXT,
    lighthouse    TEXT,
    failure       TEXT
  );
  CREATE INDEX IF NOT EXISTS cc_vitals_path ON cc_vitals (path, strategy, id DESC);
`);

export type Strategy = "mobile" | "desktop";

/** What real visitors experienced, at the 75th percentile, when Google has it. */
export interface FieldData {
  /** "page": for this address. "origin": for the whole site, because the page alone has too few visits. */
  scope: "page" | "origin";
  lcpMs: number | null;
  /** Interaction to Next Paint. Field only. */
  inpMs: number | null;
  cls: number | null;
  fcpMs: number | null;
  ttfbMs: number | null;
  /** Google's overall verdict: "FAST", "AVERAGE", "SLOW". */
  verdict: string | null;
}

/** One lab run of one page. */
export interface LabRun {
  path: string;
  strategy: Strategy;
  at: string;
  /** Lighthouse's four category scores, 0 to 100. Null when the run failed. */
  scores: { performance: number | null; seo: number | null; accessibility: number | null; bestPractices: number | null };
  lcpMs: number | null;
  cls: number | null;
  /** Total Blocking Time: the lab's stand-in for responsiveness. Not INP. */
  tbtMs: number | null;
  fcpMs: number | null;
  speedIndexMs: number | null;
  lighthouse: string | null;
  /** Why the run failed, when it did. */
  failure: string | null;
}

/* ---------- asking Google -------------------------------------------------------- */

interface PsiMetric {
  percentile?: number;
  category?: string;
}
interface PsiExperience {
  metrics?: Record<string, PsiMetric>;
  overall_category?: string;
  origin_fallback?: boolean;
}
interface PsiAnswer {
  lighthouseResult?: {
    lighthouseVersion?: string;
    categories?: Record<string, { score?: number | null }>;
    audits?: Record<string, { numericValue?: number }>;
    runtimeError?: { message?: string };
  };
  loadingExperience?: PsiExperience;
  originLoadingExperience?: PsiExperience;
  error?: { code?: number; message?: string; status?: string };
}

class QuotaError extends Error {}

function fieldOf(e: PsiExperience | undefined, scope: "page" | "origin"): FieldData | null {
  const m = e?.metrics;
  if (!m || !Object.keys(m).length) return null;
  const p = (k: string): number | null => (typeof m[k]?.percentile === "number" ? (m[k].percentile as number) : null);
  const cls = p("CUMULATIVE_LAYOUT_SHIFT_SCORE");
  return {
    scope,
    lcpMs: p("LARGEST_CONTENTFUL_PAINT_MS"),
    inpMs: p("INTERACTION_TO_NEXT_PAINT"),
    /* The API sends CLS multiplied by a hundred (5 means 0.05). */
    cls: cls === null ? null : cls / 100,
    fcpMs: p("FIRST_CONTENTFUL_PAINT_MS"),
    ttfbMs: p("EXPERIMENTAL_TIME_TO_FIRST_BYTE"),
    verdict: e?.overall_category ?? null,
  };
}

interface Run extends LabRun {
  field: FieldData | null;
  originField: FieldData | null;
}

/** One PageSpeed Insights run. Throws QuotaError on 429; any other failure comes back as a run with `failure` set. */
async function run(path: string, strategy: Strategy): Promise<Run> {
  const at = new Date().toISOString();
  const blank: Run = { path, strategy, at, scores: { performance: null, seo: null, accessibility: null, bestPractices: null }, lcpMs: null, cls: null, tbtMs: null, fcpMs: null, speedIndexMs: null, lighthouse: null, failure: null, field: null, originField: null };

  const q = new URLSearchParams({ url: abs(path), strategy: strategy.toUpperCase() });
  for (const c of ["PERFORMANCE", "SEO", "ACCESSIBILITY", "BEST_PRACTICES"]) q.append("category", c);
  if (process.env.GOOGLE_API_KEY) q.set("key", process.env.GOOGLE_API_KEY);

  let res: Response;
  try {
    res = await fetch(`https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, { signal: AbortSignal.timeout(120_000) });
  } catch (e) {
    /* The message of a failed fetch can carry the URL, and the URL can carry the key: say what happened, not where. */
    return { ...blank, failure: e instanceof Error && e.name === "TimeoutError" ? "PageSpeed Insights did not answer in two minutes" : "PageSpeed Insights could not be reached" };
  }
  const json = (await res.json().catch(() => ({}))) as PsiAnswer;
  if (res.status === 429) {
    /* Google's own sentence names the quota that ran out; it never carries the key. */
    const said = (json.error?.message ?? "").split("\n")[0]?.slice(0, 200);
    throw new QuotaError(`Google answered 429${said ? `: ${said}` : ""}`);
  }
  if (!res.ok || !json.lighthouseResult) {
    return { ...blank, failure: `PageSpeed Insights answered ${res.status}: ${(json.error?.message ?? "no result").split("\n")[0]?.slice(0, 200)}` };
  }

  const lh = json.lighthouseResult;
  const score = (k: string): number | null => (typeof lh.categories?.[k]?.score === "number" ? Math.round((lh.categories[k].score as number) * 100) : null);
  const audit = (k: string): number | null => (typeof lh.audits?.[k]?.numericValue === "number" ? (lh.audits[k].numericValue as number) : null);
  const page = json.loadingExperience;
  return {
    ...blank,
    scores: { performance: score("performance"), seo: score("seo"), accessibility: score("accessibility"), bestPractices: score("best-practices") },
    lcpMs: audit("largest-contentful-paint"),
    cls: audit("cumulative-layout-shift"),
    tbtMs: audit("total-blocking-time"),
    fcpMs: audit("first-contentful-paint"),
    speedIndexMs: audit("speed-index"),
    lighthouse: lh.lighthouseVersion ?? null,
    failure: lh.runtimeError?.message ? `Lighthouse: ${lh.runtimeError.message.slice(0, 200)}` : null,
    /* When the page has too few visits Google answers with the origin's
       data under the page's name and flags it: that is origin data. */
    field: page?.origin_fallback ? null : fieldOf(page, "page"),
    originField: fieldOf(json.originLoadingExperience, "origin") ?? (page?.origin_fallback ? fieldOf(page, "origin") : null),
  };
}

/* ---------- which pages ------------------------------------------------------------ */

/**
 * The short, fixed list: the home page, the insights index, the newest
 * article, two service pages and one segment page.
 *
 * The services and the segment are the first of their kind in the sitemap's
 * own order, chosen once and then REMEMBERED, so the daily line compares the
 * same pages with themselves. A remembered page that left the sitemap is
 * replaced. The newest article is by definition a different page over time;
 * its line is "the newest article", not one address.
 * CC_PSI_PAGES (comma-separated addresses) replaces the whole list.
 */
export function speedPages(): string[] {
  const fixed = process.env.CC_PSI_PAGES?.split(",").map((s) => s.trim()).filter((s) => s.startsWith("/"));
  if (fixed?.length) return fixed.slice(0, 8);

  const entries = lastSitemap()?.entries ?? [];
  const listed = new Set(entries.map((e) => e.path));
  const kindOfPath = new Map((db.prepare("SELECT path, kind FROM cc_pages WHERE in_sitemap = 1 AND status = 200").all() as { path: string; kind: string }[]).map((r) => [r.path, r.kind]));
  const firstOf = (kind: string, n: number, priority?: number) => entries.filter((e) => kindOfPath.get(e.path) === kind && (priority === undefined || e.priority === priority)).slice(0, n).map((e) => e.path);

  let chosen: { services: string[]; segment: string[] } = { services: [], segment: [] };
  try {
    chosen = { ...chosen, ...(JSON.parse(state("psi:pages") ?? "{}") as Partial<typeof chosen>) };
  } catch {
    /* start over */
  }
  chosen.services = chosen.services.filter((p) => listed.has(p));
  chosen.segment = chosen.segment.filter((p) => listed.has(p));
  /* Priority 0.8 is a service under a pillar; 0.95 is the pillar page itself. */
  for (const p of [...firstOf("service", 4, 0.8), ...firstOf("service", 4)]) if (chosen.services.length < 2 && !chosen.services.includes(p)) chosen.services.push(p);
  for (const p of firstOf("segment", 2)) if (chosen.segment.length < 1) chosen.segment.push(p);
  setState("psi:pages", JSON.stringify(chosen));

  const newest = entries
    .filter((e) => e.path.startsWith("/insights/") && !e.path.startsWith("/insights/topic/") && e.lastmod)
    .sort((a, b) => (b.lastmod as string).localeCompare(a.lastmod as string))[0]?.path;

  return [...new Set(["/", "/insights", ...(newest ? [newest] : []), ...chosen.services, ...chosen.segment])];
}

/* ---------- the job ------------------------------------------------------------------ */

export interface SpeedSweep {
  at: string;
  pages: string[];
  runs: number;
  failed: number;
  /** True when Google answered 429 and the sweep stopped early. */
  stopped: boolean;
  /** Whether Google returned any field data for the site. */
  hasField: boolean;
}

const STRATEGIES: Strategy[] = ["mobile", "desktop"];
const LAB_METRICS = ["performance", "seo", "accessibility", "practices", "lcp_ms", "cls", "tbt_ms", "fcp_ms", "si_ms"] as const;
/** Series names: "speed.mobile.lcp", "speed.mobile.lcp:/seo". */
const short = (col: (typeof LAB_METRICS)[number]): string => col.replace(/_ms$/, "");

let sweeping: Promise<SpeedSweep> | null = null;

/** Test every page of the list on both strategies, one run after the other. */
export function sweep(progress: (done: number, of: number, what?: string) => void = () => {}): Promise<SpeedSweep> {
  sweeping ??= doSweep(progress).finally(() => {
    sweeping = null;
  });
  return sweeping;
}

async function doSweep(progress: (done: number, of: number, what?: string) => void): Promise<SpeedSweep> {
  const day = today();
  const pages = speedPages();
  const insert = db.prepare(`
    INSERT INTO cc_vitals (at, day, path, strategy, performance, seo, accessibility, practices, lcp_ms, cls, tbt_ms, fcp_ms, si_ms, field, origin_field, lighthouse, failure)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const jobs = pages.flatMap((p) => STRATEGIES.map((s) => ({ path: p, strategy: s })));
  let runs = 0;
  let failed = 0;
  let stopped = false;
  let hasField = false;

  for (const [i, j] of jobs.entries()) {
    progress(i, jobs.length, `${j.path} (${j.strategy})`);
    let r: Run;
    try {
      r = await run(j.path, j.strategy);
    } catch (e) {
      if (e instanceof QuotaError) {
        stopped = true;
        setState("psi:stopped", day);
        setState("psi:stopped:said", JSON.stringify({ said: e.message, keyed: Boolean(process.env.GOOGLE_API_KEY), measuredBefore: runs - failed, at: new Date().toISOString() }));
        break;
      }
      throw e;
    }
    runs++;
    if (r.failure && r.lcpMs === null) failed++;
    if (r.field || r.originField) hasField = true;
    insert.run(r.at, day, r.path, r.strategy, r.scores.performance, r.scores.seo, r.scores.accessibility, r.scores.bestPractices, r.lcpMs, r.cls, r.tbtMs, r.fcpMs, r.speedIndexMs, r.field ? JSON.stringify(r.field) : null, r.originField ? JSON.stringify(r.originField) : null, r.lighthouse, r.failure);
    await probeIfDue();
  }

  /* Today's lines: each page's own, and the median across the list. */
  for (const s of STRATEGIES) {
    const rows = db.prepare(`SELECT * FROM cc_vitals WHERE id IN (SELECT MAX(id) FROM cc_vitals WHERE day = ? AND strategy = ? AND lcp_ms IS NOT NULL GROUP BY path)`).all(day, s) as unknown as Stored[];
    if (!rows.length) continue;
    for (const col of LAB_METRICS) {
      const values = rows.map((r) => r[col]).filter((v): v is number => typeof v === "number");
      if (values.length) record(`speed.${s}.${short(col)}`, median(values), day);
      for (const r of rows) if (typeof r[col] === "number") record(`speed.${s}.${short(col)}:${r.path}`, r[col] as number, day);
    }
    /* The origin's data is the same on every page of a sweep; the newest run's copy is taken. */
    const origin = [...rows].sort((a, b) => b.at.localeCompare(a.at)).map((r) => parse<FieldData>(r.origin_field)).find(Boolean);
    if (origin) {
      if (origin.lcpMs !== null) record(`field.${s}.lcp`, origin.lcpMs, day);
      if (origin.inpMs !== null) record(`field.${s}.inp`, origin.inpMs, day);
      if (origin.cls !== null) record(`field.${s}.cls`, origin.cls, day);
    }
  }

  const done: SpeedSweep = { at: new Date().toISOString(), pages, runs, failed, stopped, hasField };
  setState("psi:sweep", JSON.stringify(done));
  if (runs && failed === runs) throw new Error(`All ${runs} PageSpeed Insights runs failed; the last said: ${(db.prepare("SELECT failure FROM cc_vitals ORDER BY id DESC LIMIT 1").get() as { failure: string | null }).failure ?? "nothing"}`);
  if (runs > failed) setState("psi:ok", done.at);
  return done;
}

export const speedJob: Job = {
  name: "speed",
  title: "Test page speed with PageSpeed Insights",
  every: 24 * 3600,
  delay: 240,
  /* Google said stop: the job waits out the 24 hours as "not ready", which
     neither runs it nor shows it as failing (the PageSpeed source says why). */
  ready: () => speedPausedUntil() === null,
  run: async ({ progress }) => {
    const s = await sweep(progress);
    const of = s.pages.length * STRATEGIES.length;
    const measured = s.runs - s.failed;
    if (s.stopped && measured === 0) {
      const keyless = !process.env.GOOGLE_API_KEY;
      throw new Error(
        `Nothing measured: before the first page, ${speedQuota()?.said ?? "Google answered 429 (quota)"}. The desk asks again in 24 hours${keyless ? "; without a key of its own it shares Google's keyless quota with everybody who asks without one (GOOGLE_API_KEY)" : ""}.`,
      );
    }
    /* With nothing measured nothing is known about field data either: "none" would be a guess. */
    const field = measured ? (s.hasField ? "field data: yes" : "field data: none for this site") : "field data: not known, nothing was measured";
    return `${measured} of ${of} runs measured${s.failed ? `, ${s.failed} failed` : ""}${s.stopped ? "; stopped, Google answered 429 (quota), and asked again in 24 hours" : ""}; ${field}`;
  },
};

/* ---------- reading it back ---------------------------------------------------------- */

interface Stored {
  id: number;
  at: string;
  day: string;
  path: string;
  strategy: Strategy;
  performance: number | null;
  seo: number | null;
  accessibility: number | null;
  practices: number | null;
  lcp_ms: number | null;
  cls: number | null;
  tbt_ms: number | null;
  fcp_ms: number | null;
  si_ms: number | null;
  field: string | null;
  origin_field: string | null;
  lighthouse: string | null;
  failure: string | null;
}

const parse = <T>(json: string | null): T | null => {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
};

const labOf = (r: Stored): LabRun => ({
  path: r.path,
  strategy: r.strategy,
  at: r.at,
  scores: { performance: r.performance, seo: r.seo, accessibility: r.accessibility, bestPractices: r.practices },
  lcpMs: r.lcp_ms,
  cls: r.cls,
  tbtMs: r.tbt_ms,
  fcpMs: r.fcp_ms,
  speedIndexMs: r.si_ms,
  lighthouse: r.lighthouse,
  failure: r.failure,
});

/**
 * The newest sweep's runs for a strategy, one per page (the last, when a page
 * was tested twice that day), in address order.
 *
 *   "measured"  the newest day that has a lab value, and only its runs that
 *               have one: what a median is taken from. Exactly the rows
 *               doSweep computes that day's line in cc_series from, so the
 *               headline and the newest point of its line always agree.
 *   "any"       the newest day that has a run at all, failures included: what
 *               a list shows, so a failed run is visible.
 *
 * Never the newest run of every page ever tested: the list moves, and a run
 * of a page that left it months ago is not part of today's site.
 */
function latestSweep(strategy: Strategy, which: "measured" | "any"): Stored[] {
  const only = which === "measured" ? "AND lcp_ms IS NOT NULL" : "";
  const day = (db.prepare(`SELECT MAX(day) AS d FROM cc_vitals WHERE strategy = ? ${only}`).get(strategy) as { d: string | null }).d;
  if (!day) return [];
  return db
    .prepare(`SELECT * FROM cc_vitals WHERE id IN (SELECT MAX(id) FROM cc_vitals WHERE strategy = ? AND day = ? ${only} GROUP BY path) ORDER BY path`)
    .all(strategy, day) as unknown as Stored[];
}

const NO_RUN = "No speed test has run yet. The first runs a few minutes after the desk starts, then once a day; it takes about five minutes.";

/**
 * Why there is no lab figure at all. Usually the first test has not run yet;
 * but when Google turned the desk away for quota before a single page was
 * measured, and the desk asked without a key of its own, waiting will not
 * help: a key is the step.
 */
function noRun<T>(): Reading<T> {
  const q = speedQuota();
  if (q && !q.keyed && !process.env.GOOGLE_API_KEY && q.measuredBefore === 0) {
    return off(
      "psi",
      `Google refused the speed test before a single page was measured (${q.said.slice(0, 160)}). Without a key the desk shares Google's keyless quota with everybody else who asks without one.`,
      "One Google Cloud API key with the PageSpeed Insights API enabled, set as GOOGLE_API_KEY in the desk's environment.",
    );
  }
  return waiting("psi", NO_RUN);
}
const LAB_NOTE = "Lab: one Lighthouse load per page on Google's machines, on a throttled connection. A measurement of the page, not of any visitor.";
const FIELD_NOTE = "Field: what real Chrome users experienced over the last 28 days, 75th percentile, from the Chrome UX Report (delivered by PageSpeed Insights).";
const NO_FIELD = "Google has no field data for this site: the Chrome UX Report publishes only sites with enough real visits in Chrome, and this one is below that line.";

/** When the last sweep that measured anything finished, ISO, or null. */
export const speedTestedAt = (): string | null => state("psi:ok");

/** Whether the daily sweep was stopped by Google's quota today. */
export const speedStoppedToday = (): boolean => state("psi:stopped") === today();

/**
 * The last time Google refused for quota: its words, whether the desk had a
 * key of its own, and how many runs had been measured before it refused.
 * Null when it never has. Without a key every keyless caller shares Google's
 * quota, so a refusal before the first run says nothing about the desk's use.
 */
export function speedQuota(): { day: string; at: string | null; said: string; keyed: boolean; measuredBefore: number } | null {
  const day = state("psi:stopped");
  if (!day) return null;
  try {
    const s = JSON.parse(state("psi:stopped:said") ?? "{}") as { said?: string; keyed?: boolean; measuredBefore?: number; at?: string };
    return { day, at: s.at ?? null, said: s.said ?? "Google answered 429", keyed: Boolean(s.keyed), measuredBefore: s.measuredBefore ?? 0 };
  } catch {
    return { day, at: null, said: "Google answered 429", keyed: false, measuredBefore: 0 };
  }
}

/** How long the desk leaves Google alone after a 429. */
const PAUSE_MS = 24 * 3_600_000;

/**
 * Until when the speed test waits after Google answered 429, ISO, or null
 * when it is not waiting. While it waits the job is not ready: it does not
 * run and is not counted as failing. A stop recorded before its time was
 * kept counts from the start of its day.
 */
export function speedPausedUntil(): string | null {
  const q = speedQuota();
  if (!q) return null;
  const from = Date.parse(q.at ?? `${q.day}T00:00:00Z`);
  if (!Number.isFinite(from) || Date.now() >= from + PAUSE_MS) return null;
  return new Date(from + PAUSE_MS).toISOString();
}

/** The last sweep in numbers, or null before the first. */
export const lastSweep = (): SpeedSweep | null => parse<SpeedSweep>(state("psi:sweep"));

/** Every run of the newest sweep for one strategy, failed ones included (see `latestSweep`). */
export function labRuns(strategy: Strategy = "mobile"): Reading<LabRun[]> {
  const rows = latestSweep(strategy, "any");
  if (!rows.length) return noRun();
  return ok(rows.map(labOf), "psi", rows.reduce((a, r) => (r.at > a ? r.at : a), ""), `${LAB_NOTE} The runs of the newest sweep (${rows[0]?.day}).`);
}

/**
 * FIELD data for the whole site (origin), for one strategy's kind of device.
 * `off` when Google has none, which for a small site is the normal state.
 */
export function fieldData(strategy: Strategy = "mobile"): Reading<FieldData> {
  if (!latestSweep(strategy, "any").length) return noRun();
  /* Only a run Google answered can say whether field data exists: the
     newest day it answered, newest run first. The origin's data is the same
     on every page of a sweep, so an older day is never consulted. */
  const day = (db.prepare("SELECT MAX(day) AS d FROM cc_vitals WHERE strategy = ? AND lighthouse IS NOT NULL").get(strategy) as { d: string | null }).d;
  const answered = day ? (db.prepare("SELECT * FROM cc_vitals WHERE strategy = ? AND day = ? AND lighthouse IS NOT NULL ORDER BY at DESC, id DESC").all(strategy, day) as unknown as Stored[]) : [];
  if (!answered.length) return waiting("psi", "No speed test has succeeded yet, so it is not known whether Google has field data for the site.");
  const hit = answered.map((r) => ({ at: r.at, f: parse<FieldData>(r.origin_field) })).find((x) => x.f);
  if (!hit?.f) return off("crux", NO_FIELD, "Nothing to switch on: it appears by itself once enough people visit. A first-party vitals beacon on the website would measure the same thing sooner; that is a consent decision and a website change.");
  return ok(hit.f, "crux", hit.at, FIELD_NOTE);
}

/** FIELD data for one page. `off` when Google has none for that address (it then usually has none for the site either). */
export function pageFieldData(path: string, strategy: Strategy = "mobile"): Reading<FieldData> {
  const r = db.prepare("SELECT * FROM cc_vitals WHERE path = ? AND strategy = ? ORDER BY id DESC LIMIT 1").get(path, strategy) as Stored | undefined;
  if (!r) return waiting("psi", `${path} is not on the speed test's list, or no test has run yet.`);
  if (r.lighthouse === null) return waiting("psi", `The last speed test of ${path} failed, so it is not known whether Google has field data for it.`);
  const f = parse<FieldData>(r.field);
  return f ? ok(f, "crux", r.at, FIELD_NOTE) : off("crux", `Google has no field data for ${path}: too few real visits to that address in Chrome.`);
}

export type Metric = "lcp" | "cls" | "inp" | "tbt" | "fcp" | "si";

/**
 * THE BANDS A VALUE IS RATED AGAINST. At or under `good` is good, over `poor`
 * is poor, between is "needs improvement". Milliseconds, except CLS, which
 * has no unit. There are three tables, because there are three yardsticks:
 *
 *   field            Google's Core Web Vitals thresholds (LCP, INP, CLS) and
 *                    the Chrome UX Report's for FCP. The same for phones and
 *                    desktops: they describe what a visitor experienced.
 *   lab, mobile      Lighthouse's own scoring bands for its mobile run:
 *                    `good` where its score for the metric reaches 90, `poor`
 *                    where it falls under 50. For LCP, FCP and CLS these
 *                    coincide with the field thresholds; TBT and Speed Index
 *                    exist only here.
 *   lab, desktop     Lighthouse's desktop bands, far tighter (a desktop run is
 *                    unthrottled): LAB_DESKTOP_LIMITS below.
 *
 * VITAL_LIMITS holds the field thresholds and, for the lab-only metrics, the
 * mobile lab bands; it is the table `rate` uses when not told otherwise.
 */
export const VITAL_LIMITS: Record<Metric, { good: number; poor: number; unit: "ms" | "score"; name: string }> = {
  lcp: { good: 2500, poor: 4000, unit: "ms", name: "Largest Contentful Paint" },
  inp: { good: 200, poor: 500, unit: "ms", name: "Interaction to Next Paint" },
  cls: { good: 0.1, poor: 0.25, unit: "score", name: "Cumulative Layout Shift" },
  tbt: { good: 200, poor: 600, unit: "ms", name: "Total Blocking Time" },
  fcp: { good: 1800, poor: 3000, unit: "ms", name: "First Contentful Paint" },
  si: { good: 3387, poor: 5800, unit: "ms", name: "Speed Index" },
};

/** Lighthouse's desktop scoring bands for the lab metrics (INP has no lab value). */
export const LAB_DESKTOP_LIMITS: Record<Exclude<Metric, "inp">, { good: number; poor: number }> = {
  lcp: { good: 1200, poor: 2400 },
  cls: { good: 0.1, poor: 0.25 },
  tbt: { good: 150, poor: 350 },
  fcp: { good: 934, poor: 1600 },
  si: { good: 1311, poor: 2300 },
};

/** The bands a value of this kind and device is rated against, and whose they are. */
export function limitsFor(metric: Metric, kind: "lab" | "field" = "field", strategy: Strategy = "mobile"): { good: number; poor: number; by: string } {
  if (kind === "lab" && strategy === "desktop" && metric !== "inp") return { ...LAB_DESKTOP_LIMITS[metric], by: "Lighthouse's desktop scoring bands" };
  const { good, poor } = VITAL_LIMITS[metric];
  if (kind === "lab") return { good, poor, by: "Lighthouse's mobile scoring bands" };
  return { good, poor, by: metric === "fcp" ? "the Chrome UX Report's FCP thresholds" : "Google's Core Web Vitals thresholds" };
}

/**
 * Where a value falls. Say what was measured (`kind`, `strategy`): a desktop
 * lab value held against the field thresholds would be called good when
 * Lighthouse calls it slow. Without them it is rated against VITAL_LIMITS.
 */
export const rate = (metric: Metric, value: number, o: { kind?: "lab" | "field"; strategy?: Strategy } = {}): "good" | "needs-improvement" | "poor" => {
  const l = o.kind ? limitsFor(metric, o.kind, o.strategy) : VITAL_LIMITS[metric];
  return value <= l.good ? "good" : value <= l.poor ? "needs-improvement" : "poor";
};

export interface Vital {
  metric: Metric;
  /** The metric's full name. */
  name: string;
  /** THE WORD THAT MUST BE PRINTED BESIDE THE NUMBER. */
  kind: "lab" | "field";
  value: number;
  unit: "ms" | "score";
  rating: "good" | "needs-improvement" | "poor";
  /** The bands `rating` was read against: field thresholds, or Lighthouse's lab bands for this device. Draw these, not a fixed table. */
  limits: { good: number; poor: number; by: string };
  strategy: Strategy;
  /** "page": one address. "site": the median of the tested pages (lab). "origin": the whole site's real visits (field). */
  scope: "page" | "site" | "origin";
  path: string | null;
  /** How many pages the value is the median of, for scope "site": the pages the newest sweep measured. 1 for a page, 0 for field data. */
  pages: number;
  /** One point per day, oldest first, from the desk's own history. */
  history: DayPoint[];
}

const LAB_COL: Partial<Record<Metric, (typeof LAB_METRICS)[number]>> = { lcp: "lcp_ms", cls: "cls", tbt: "tbt_ms", fcp: "fcp_ms", si: "si_ms" };

/**
 * One vital, always labelled lab or field.
 *
 *   inp            field only. `off`, with the reason, when Google has no
 *                  field data; ask for "tbt" to show the lab stand-in.
 *   tbt, si        lab only.
 *   lcp, cls, fcp  lab by default; `from: "field"` asks for the field value
 *                  instead and is `off` when there is none.
 *
 * Without `path` a lab value is the median across the tested pages and a
 * field value is the whole site's. `days` is how much history comes along.
 */
export function vital(metric: Metric, strategy: Strategy = "mobile", o: { path?: string; from?: "lab" | "field"; days?: number } = {}): Reading<Vital> {
  const limits = VITAL_LIMITS[metric];
  const days = o.days ?? 30;
  const wantField = metric === "inp" || o.from === "field";

  if (wantField) {
    if (metric === "tbt" || metric === "si") return off("psi", `${limits.name} is a lab measure; there is no field version of it.`);
    const f = o.path ? pageFieldData(o.path, strategy) : fieldData(strategy);
    if (f.state !== "ok") {
      /* Only when Google answered and had nothing is "no field data" a fact.
         A test that never ran (quota, first day) keeps its own reason. */
      if (f.state === "off" && f.reason === NO_FIELD && metric === "inp") {
        return off("crux", `${NO_FIELD} INP is measured only on real visits; a lab test cannot produce it.`, "Until there is field data, show Total Blocking Time (vital(\"tbt\")), the lab stand-in, under its own name.");
      }
      return f as Reading<Vital>;
    }
    const value = metric === "lcp" ? f.value.lcpMs : metric === "inp" ? f.value.inpMs : metric === "cls" ? f.value.cls : f.value.fcpMs;
    if (value === null) return off("crux", `Google's field data for this site does not include ${limits.name}.`);
    return ok(
      {
        metric,
        name: limits.name,
        kind: "field",
        value,
        unit: limits.unit,
        rating: rate(metric, value, { kind: "field", strategy }),
        limits: limitsFor(metric, "field", strategy),
        strategy,
        scope: f.value.scope,
        path: o.path ?? null,
        pages: 0,
        history: o.path ? [] : series(`field.${strategy}.${metric}`, days).map((p) => ({ date: p.day, value: p.value })),
      },
      "crux",
      f.asOf,
      FIELD_NOTE,
    );
  }

  const col = LAB_COL[metric] as (typeof LAB_METRICS)[number];
  /* The site: the newest sweep's measured pages. One page: its own newest
     measured run, whenever that was (its time is the reading's). */
  const rows = o.path
    ? (db.prepare(`SELECT * FROM cc_vitals WHERE path = ? AND strategy = ? AND ${col} IS NOT NULL ORDER BY id DESC LIMIT 1`).all(o.path, strategy) as unknown as Stored[])
    : latestSweep(strategy, "measured").filter((r) => typeof r[col] === "number");
  if (!rows.length) return o.path ? waiting("psi", `${o.path} has no measured speed test: it is not on the list, or every test of it failed.`) : noRun();
  const value = median(rows.map((r) => r[col] as number));
  return ok(
    {
      metric,
      name: limits.name,
      kind: "lab",
      value,
      unit: limits.unit,
      rating: rate(metric, value, { kind: "lab", strategy }),
      limits: limitsFor(metric, "lab", strategy),
      strategy,
      scope: o.path ? "page" : "site",
      path: o.path ?? null,
      pages: rows.length,
      history: series(`speed.${strategy}.${short(col)}${o.path ? `:${o.path}` : ""}`, days).map((p) => ({ date: p.day, value: p.value })),
    },
    "psi",
    rows.reduce((a, r) => (r.at > a ? r.at : a), ""),
    o.path ? LAB_NOTE : `${LAB_NOTE} The figure is the median of the ${rows.length} page${rows.length === 1 ? "" : "s"} the newest sweep measured (${rows[0]?.day}).`,
  );
}

export interface LabScores {
  strategy: Strategy;
  /** Lighthouse's category scores, 0 to 100: the median across the pages the newest sweep measured. Null when no run produced one. */
  performance: number | null;
  seo: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  pages: number;
  /** The performance score's daily history. */
  history: DayPoint[];
}

/** Lighthouse's four scores, the median across the pages the newest sweep measured. Lab, by definition: Lighthouse is a lab tool. */
export function labScores(strategy: Strategy = "mobile", days = 30): Reading<LabScores> {
  const rows = latestSweep(strategy, "measured").filter((r) => r.performance !== null);
  if (!rows.length) return noRun();
  const mid = (pick: (r: Stored) => number | null): number | null => {
    const v = rows.map(pick).filter((x): x is number => x !== null);
    return v.length ? Math.round(median(v)) : null;
  };
  return ok(
    { strategy, performance: mid((r) => r.performance), seo: mid((r) => r.seo), accessibility: mid((r) => r.accessibility), bestPractices: mid((r) => r.practices), pages: rows.length, history: series(`speed.${strategy}.performance`, days).map((p) => ({ date: p.day, value: p.value })) },
    "psi",
    rows.reduce((a, r) => (r.at > a ? r.at : a), ""),
    `${LAB_NOTE} Lighthouse's SEO score checks a dozen basics on one page; it is not the desk's SEO score and not a ranking.`,
  );
}
