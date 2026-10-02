import { Hono } from "hono";
import { db } from "../../db.ts";
import { byEmail, getPerson } from "../../people.ts";
import { me, type Vars } from "../access.ts";
import {
  COUNT_METHOD,
  countInterval,
  DAILY_METHOD,
  dailyInterval,
  dayIn,
  daysBetween,
  daysFrom,
  isDay,
  MIN_DAYS,
  MIN_EVENTS,
  PLAN_METHOD,
  perVersion,
  shiftDay,
  windowsAround,
} from "../compare.ts";
import * as ga from "../ga4.ts";
import { commitFiles, commitUrl, deployments, inventory, repoFetchedAt, repoFiles, type CommitFiles } from "../site/index.ts";
import { note, off, ok, reading, state, waiting } from "../store.ts";
import type { ApiError, Range, Reading, Stat } from "../../../web/src/contract/common.ts";
import type {
  ChangeRow,
  CompareAsk,
  CompareResult,
  CompareWindow,
  Comparison,
  ComparePoint,
  ExperimentsPayload,
  MetricKey,
  MetricResult,
  PageOption,
  Readiness,
  SaveComparison,
  SavedAnswer,
  SavedRow,
} from "../../../web/src/contract/experiments.ts";

/**
 * /api/v1/experiments — before / after comparisons around changes to the
 * website. See web/src/contract/experiments.ts for why it is not a split
 * test, and src/cc/compare.ts for the arithmetic.
 *
 *   GET  /                      the whole screen, one call
 *        ?range=7d|30d|90d|1y   the tiles and Recent changes (default 30d)
 *        ?change=<sha>          compare around this commit, or
 *        ?date=YYYY-MM-DD       around this day (wins over change; the
 *                               screen's form never sends both: picking one
 *                               clears the other)
 *        ?page=/address         one page; absent is the whole site
 *        ?window=7|14|28        days on each side, at most (default 14)
 *        ?metric=visitors|engagement|forms|enquiries   what the chart draws
 *        ?saved=<id>            open a saved comparison (its change, page, window)
 *        ?changes=all           every commit in the range, not the newest eight
 *   POST /saved                 save what is being compared (anyone signed in)
 *   POST /saved/:id/delete      remove one (who saved it, or the owner)
 *
 * TWO SOURCES, BOTH CONNECTED wherever the desk runs: the website's git
 * history (the repository collector) and GA4. So this screen offers no
 * specimen: everything it draws is real or says why it is absent.
 *
 * A SAVED COMPARISON KEEPS NO FIGURE. cc_comparisons holds who saved it,
 * when, its name and note, and what was asked (the commit or the day, the
 * page, the window). The figures are worked out again whenever it is opened,
 * because GA4 revises its last days and a stored figure would go stale
 * silently.
 */
export const routes = new Hono<Vars>();

db.exec(`
  CREATE TABLE IF NOT EXISTS cc_comparisons (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    /* The person who saved it: people.telegram. */
    who   INTEGER NOT NULL,
    at    TEXT NOT NULL,
    name  TEXT NOT NULL,
    note  TEXT,
    /* A commit or a day, never both. */
    sha   TEXT,
    day   TEXT,
    /* An address, or NULL for the whole site. */
    page  TEXT,
    days  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cc_comparisons_at ON cc_comparisons (at DESC);
`);

/* ---------- small words ------------------------------------------------------ */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "25 Sep 2026" */
const words = (day: string): string => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
/** "25 Sep" */
const shortWords = (day: string): string => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;

const fmt = (n: number, digits = 0): string => new Intl.NumberFormat("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(n);
const signed = (n: number, digits = 1): string => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${fmt(Math.abs(n), digits)}`;
const plural = (n: number, one: string, many = `${one}s`): string => `${fmt(n)} ${n === 1 ? one : many}`;

const RANGES: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };
const WINDOWS: CompareWindow[] = [7, 14, 28];
const METRICS: MetricKey[] = ["visitors", "engagement", "forms", "enquiries"];
/** Recent changes shows this many unless every one is asked for: as many as fill its row beside the comparison's form. */
const SHOWN = 8;
/**
 * How far back the desk reads the history: the most commitFiles reads in one
 * call. The whole of it today, and about a year and a half at today's pace.
 * When the read stops short of a range, the figures for that range say so
 * instead of counting short (see `covers`).
 */
const HISTORY_CAP = 5000;

const REPO_NOTE =
  "Commits to the website's main branch, each on the day it was committed. Each push to main starts a production build on Vercel; when it was pushed, and whether that build succeeded, is not known here.";
const PAGES_RULE =
  "A page counts as changed when its own page file, a file in its own folder, or its article's file was changed. Shared components, styles, content and pictures are not guessed onto any page; templates such as /insights/[slug] are counted apart.";

/* ---------- the history, with the pages each commit touched -------------------- */

/**
 * A git read kept for as long as the branch's head stays where it is: the
 * history and the tree cannot change without a new head. The repository job
 * writes the head after every fetch (site:repo:head), so a fetch that found
 * nothing new costs nothing here. Requests that arrive while the read is
 * running wait for the same one instead of queuing a second git call behind
 * it.
 */
function byHead<T>(read: () => Promise<T>): () => Promise<T> {
  let done: { key: string; value: T } | null = null;
  let running: { key: string; promise: Promise<T> } | null = null;
  return () => {
    const key = state("site:repo:head") ?? repoFetchedAt() ?? "";
    if (done && done.key === key) return Promise.resolve(done.value);
    if (running && running.key === key) return running.promise;
    const promise = read().then((value) => {
      done = { key, value };
      return value;
    });
    const mine = { key, promise };
    running = mine;
    void promise
      .finally(() => {
        if (running === mine) running = null;
      })
      .catch(() => {});
    return promise;
  };
}

/** Every commit on main with its files, newest first, up to HISTORY_CAP. */
const history = byHead(() => commitFiles(HISTORY_CAP));

/** A page folder's address: route groups vanish; a parallel or private folder has none; a [param] makes it a template. */
function folderAddress(folder: string): { address: string; template: boolean } | null {
  const parts = (folder === "app" ? "" : folder.slice(4)).split("/").filter((s) => s && !/^\(.*\)$/.test(s));
  if (parts.some((s) => s.startsWith("@") || s.startsWith("_") || s.startsWith("("))) return null;
  return { address: `/${parts.join("/")}`, template: parts.some((s) => s.includes("[")) };
}

const PAGE_FILE = /^(app(?:\/.+)?)\/page\.(?:tsx|ts|jsx|js|mdx)$/;
/* Files in a page's folder that are not that page: they apply to every page under it, or are not pages at all. */
const NOT_THE_PAGE = /^(layout|template|loading|error|not-found|global-error|forbidden|unauthorized|default|route|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\./;

interface Mapper {
  /** Folder of every page file on the branch now, with its address. */
  folders: Map<string, { address: string; template: boolean }>;
  /** Addresses the crawl knows, or null when it has not run: then an article file is named by the site's own convention. */
  known: Set<string> | null;
}

/** The page folders on the branch's head: read from git once per head. */
const pageFolders = byHead(async () => {
  const folders = new Map<string, { address: string; template: boolean }>();
  for (const f of await repoFiles("app")) {
    const m = PAGE_FILE.exec(f.path);
    const a = m ? folderAddress(m[1] as string) : null;
    if (m && a) folders.set(m[1] as string, a);
  }
  return folders;
});

async function mapper(): Promise<Mapper> {
  const crawl = inventory();
  const known = crawl.state === "ok" ? new Set(crawl.value.map((p) => p.path)) : null;
  return { folders: await pageFolders(), known };
}

/** What one changed file says about pages: an address, a template, or nothing a page can be named for. */
function placeOf(path: string, map: Mapper): { page: string } | { template: string } | null {
  const pageFile = PAGE_FILE.exec(path);
  if (pageFile) {
    const a = folderAddress(pageFile[1] as string);
    return a ? (a.template ? { template: a.address } : { page: a.address }) : null;
  }
  if (path.startsWith("app/")) {
    const cut = path.lastIndexOf("/");
    if (NOT_THE_PAGE.test(path.slice(cut + 1))) return null;
    const a = map.folders.get(path.slice(0, cut));
    return a ? (a.template ? { template: a.address } : { page: a.address }) : null;
  }
  const post = /^content\/posts\/([^/]+)\.ts$/.exec(path);
  if (post && post[1] !== "index") {
    const address = `/insights/${post[1]}`;
    if (!map.known || map.known.has(address)) return { page: address };
  }
  return null;
}

/** The first name a screen prints for a commit's author: the people table's, when the address is somebody's there. */
function firstName(c: CommitFiles, names: Map<string, string | null>): string {
  const key = c.email.toLowerCase();
  if (!names.has(key)) names.set(key, key ? (byEmail(key)?.name ?? null) : null);
  const name = (names.get(key) ?? c.author).trim();
  return name.split(/\s+/)[0] || name || "unknown";
}

function toRow(c: CommitFiles, map: Mapper, zone: string, names: Map<string, string | null>): ChangeRow {
  const pages = new Set<string>();
  const templates = new Set<string>();
  let otherFiles = 0;
  for (const p of c.paths) {
    const at = placeOf(p, map);
    if (!at) otherFiles++;
    else if ("page" in at) pages.add(at.page);
    else templates.add(at.template);
  }
  return {
    sha: c.sha,
    short: c.sha.slice(0, 7),
    at: c.at,
    day: dayIn(c.at, zone),
    subject: c.subject,
    author: firstName(c, names),
    authorFull: c.author,
    kind: /^Publish\b/.test(c.subject) ? "publish" : "deploy",
    pages: [...pages].sort(),
    templates: [...templates].sort(),
    otherFiles,
    files: c.files,
    url: commitUrl(c.sha),
  };
}

interface History {
  rows: ChangeRow[];
  /** True when the read reached the repository's first commit: nothing older exists. */
  complete: boolean;
  /** The day of the oldest commit read, or null when there is none. */
  from: string | null;
}

/** The history as rows, or why there is none: the repository collector's own state. */
async function changeRows(): Promise<Reading<History>> {
  const d = deployments(1);
  if (d.state === "off") return off("repo", d.reason, d.step);
  if (d.state === "waiting") return waiting("repo", d.reason);
  const [list, map] = await Promise.all([history(), mapper()]);
  const zone = ga.zone();
  const names = new Map<string, string | null>();
  const rows = list.map((c) => toRow(c, map, zone, names));
  /* The first-parent walk ends at a commit with no parent (files null) only when it was read to the end. */
  const last = list[list.length - 1];
  return ok({ rows, complete: !last || last.files === null, from: rows.length ? rows[rows.length - 1]!.day : null }, "repo", d.asOf, REPO_NOTE);
}

/** True when every commit on or after `day` was read: the history is complete, or it reaches back past that day. */
const covers = (h: History, day: string): boolean => h.complete || (h.from !== null && h.from < day);

/* ---------- GA4 reads ---------------------------------------------------------- */

/** A GA4 read with no data as the reading a panel shows instead. */
function absentFrom(r: ga.Read<unknown>): Reading<never> {
  if (r.off) return off("ga4", r.error ?? "GA4 is not connected.", r.step);
  return waiting("ga4", r.error ?? "GA4 has not answered yet.");
}

/** The caveat on every comparison figure. */
const gaNote = (stale: string | undefined): string => `${ga.GA4_NOTE}${stale ? ` Not refreshed: ${stale}` : ""}`;

const EVENTS: Record<"forms" | "enquiries", string> = { forms: "form_start", enquiries: "generate_lead" };

const DEFINITIONS: Record<MetricKey, { label: string; definition: string; unit: "count" | "s" }> = {
  visitors: {
    label: "Visitors",
    unit: "count",
    definition: "People who viewed the page (or the site), each counted once per window by GA4. The interval is on the average per day. Consenting visitors only.",
  },
  engagement: {
    label: "Engagement time per visitor",
    unit: "s",
    definition: "Seconds the page (or the site) was in the foreground, divided by visitors, day by day (GA4 userEngagementDuration over activeUsers). Consenting visitors only.",
  },
  forms: {
    label: "Forms started",
    unit: "count",
    definition: "GA4's own form_start event: the first interaction with ANY form on the page, the enquiry form or another. It cannot tell an enquiry from another form until a form parameter is registered in GA4. Consenting visitors only.",
  },
  enquiries: {
    label: "Enquiries sent",
    unit: "count",
    definition: "The website's generate_lead event: an enquiry was sent, from the contact form, the AI guide or a page's enquiry dock. Consenting visitors only: the engine's own count of enquiries is the complete one.",
  },
};

/* ---------- one comparison ----------------------------------------------------- */

interface Day {
  users: number;
  seconds: number;
  forms: number;
  enquiries: number;
}

function dailyVerdict(
  key: "visitors" | "engagement",
  days: number,
  beforeDays: Day[],
  afterDays: Day[],
  shown: { before: number; after: number; perDayBefore: number | null; perDayAfter: number | null },
): MetricResult {
  const d = DEFINITIONS[key];
  const base = { key, label: d.label, definition: d.definition, unit: d.unit, ...shown };
  const sum = (list: Day[], f: (x: Day) => number) => list.reduce((n, x) => n + f(x), 0);
  const visitorDays = { before: sum(beforeDays, (x) => x.users), after: sum(afterDays, (x) => x.users) };
  const unitWord = key === "visitors" ? " a day" : " s per visitor";
  const method = DAILY_METHOD(key === "visitors" ? "and their average visitors per day compared" : "their seconds and visitors added up and divided");

  if (days < MIN_DAYS) {
    return { ...base, verdict: "too-few", says: `Too few days to say: ${plural(days, "whole day")} on each side, and at least ${MIN_DAYS} are needed.`, interval: null, percent: null, method };
  }
  if (visitorDays.before < 20 || visitorDays.after < 20) {
    return {
      ...base,
      verdict: "too-few",
      says: `Too few visitors to say: ${fmt(visitorDays.before)} → ${fmt(visitorDays.after)} visitor-days, and at least 20 on each side are needed.`,
      interval: null,
      percent: null,
      method,
    };
  }
  const iv = dailyInterval(
    beforeDays.map((x) => (key === "visitors" ? { num: x.users, den: 1 } : { num: x.seconds, den: x.users })),
    afterDays.map((x) => (key === "visitors" ? { num: x.users, den: 1 } : { num: x.seconds, den: x.users })),
  );
  if (!iv) {
    return { ...base, verdict: "too-few", says: "Too few to say: too many of these days had no visitor at all.", interval: null, percent: null, method };
  }
  const digits = key === "visitors" ? 1 : 0;
  const interval = `${signed(iv.lo, digits)} to ${signed(iv.hi, digits)}${unitWord}`;
  const verdict = iv.lo > 0 ? "higher" : iv.hi < 0 ? "lower" : "unclear";
  const tail = verdict === "unclear" ? "which includes no change: these days cannot tell the windows apart" : "which leaves out no change. It does not say the change caused it";
  const both20 = shown.before >= 20 && shown.after >= 20;
  return {
    ...base,
    verdict,
    says: `The 95% interval of the difference is ${interval}, ${tail}.`,
    interval,
    percent: both20 && shown.before > 0 ? ((shown.after - shown.before) / shown.before) * 100 : null,
    method,
  };
}

function countVerdict(key: "forms" | "enquiries", before: number, after: number): MetricResult {
  const d = DEFINITIONS[key];
  const base = { key, label: d.label, definition: d.definition, unit: d.unit, before, after, perDayBefore: null, perDayAfter: null, method: COUNT_METHOD };
  if (before + after < MIN_EVENTS) {
    return { ...base, verdict: "too-few", says: `Too few to say: at least ${MIN_EVENTS} in both windows together are needed before two counts are compared.`, interval: null, percent: null };
  }
  const iv = countInterval(before, after);
  const r = (v: number) => (v >= 10 ? fmt(v) : fmt(v, v < 1 ? 2 : 1));
  const interval = Number.isFinite(iv.hi) ? `after ÷ before ${r(iv.lo)} to ${r(iv.hi)}` : `after ÷ before at least ${r(iv.lo)}`;
  const verdict = iv.lo > 1 ? "higher" : iv.hi < 1 ? "lower" : "unclear";
  const tail = verdict === "unclear" ? "which includes 1, no change: these counts cannot tell the windows apart" : "which leaves out 1, no change. It does not say the change caused it";
  return {
    ...base,
    verdict,
    says: `The exact 95% interval is ${interval}, ${tail}.`,
    interval,
    percent: before >= 20 && after >= 20 ? ((after - before) / before) * 100 : null,
  };
}

async function compare(ask: CompareAsk, rows: ChangeRow[] | null, measured: { fullFrom: string; provisionalFrom: string } | null): Promise<Reading<CompareResult>> {
  if (!measured) return waiting("ga4", "Where GA4's measurement of the website begins is not known yet, so no window can be placed.");
  const zone = ga.zone();
  const changeDay = ask.change.kind === "date" ? ask.change.day : ask.change.at ? dayIn(ask.change.at, zone) : null;
  if (!changeDay) return off("repo", "That commit is not on the website's main branch as the desk has read it.", "Pick a change from Recent changes, or type a date.");

  const lastWhole = shiftDay(ga.propertyToday(), -1);
  const w = windowsAround(changeDay, ask.window, measured.fullFrom, lastWhole, words);
  if (!w.ok) return w.state === "off" ? off("ga4", w.reason) : waiting("ga4", w.reason);
  const { before, after, days } = w.value;

  const pageFilter = ask.page ? ga.where.is("pagePath", ask.page) : undefined;
  const whole = { startDate: before.start, endDate: after.end };
  const o: ga.Ask = { screen: true };
  const [daily, totals, events] = await Promise.all([
    ga.report({ dimensions: ["date"], metrics: ["activeUsers", "userEngagementDuration"], dateRanges: [whole], dimensionFilter: pageFilter, orderBys: [{ by: "date" }], limit: 200 }, o),
    ga.report({ metrics: ["activeUsers"], dateRanges: [{ startDate: before.start, endDate: before.end }, { startDate: after.start, endDate: after.end }], dimensionFilter: pageFilter }, o),
    ga.report(
      {
        dimensions: ["date", "eventName"],
        metrics: ["eventCount"],
        dateRanges: [whole],
        dimensionFilter: pageFilter ? ga.where.all(ga.where.among("eventName", Object.values(EVENTS)), pageFilter) : ga.where.among("eventName", Object.values(EVENTS)),
        limit: 1000,
      },
      o,
    ),
  ]);
  for (const r of [daily, totals, events]) if (r.data === null || r.at === null) return absentFrom(r);

  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const byDay = new Map<string, Day>();
  for (const d of daysFrom(before.start, after.end)) byDay.set(d, { users: 0, seconds: 0, forms: 0, enquiries: 0 });
  for (const row of daily.data!.rows) {
    const d = byDay.get(String(row.date));
    if (d) {
      d.users = n(row.activeUsers);
      d.seconds = n(row.userEngagementDuration);
    }
  }
  for (const row of events.data!.rows) {
    const d = byDay.get(String(row.date));
    if (!d) continue;
    if (row.eventName === EVENTS.forms) d.forms += n(row.eventCount);
    if (row.eventName === EVENTS.enquiries) d.enquiries += n(row.eventCount);
  }
  const side = (day: string): ComparePoint["side"] => (day < changeDay ? "before" : day > changeDay ? "after" : "change");
  const of = (from: string, to: string) => daysFrom(from, to).map((d) => byDay.get(d) as Day);
  const beforeDays = of(before.start, before.end);
  const afterDays = of(after.start, after.end);
  const sum = (list: Day[], f: (x: Day) => number) => list.reduce((s, x) => s + f(x), 0);

  const uniques = {
    before: n(totals.data!.ranges[0]?.[0]?.activeUsers),
    after: n(totals.data!.ranges[1]?.[0]?.activeUsers),
  };
  const perVisitor = (list: Day[]): number => {
    const u = sum(list, (x) => x.users);
    return u > 0 ? sum(list, (x) => x.seconds) / u : 0;
  };

  const metrics: MetricResult[] = [
    dailyVerdict("visitors", days, beforeDays, afterDays, {
      before: uniques.before,
      after: uniques.after,
      perDayBefore: sum(beforeDays, (x) => x.users) / days,
      perDayAfter: sum(afterDays, (x) => x.users) / days,
    }),
    dailyVerdict("engagement", days, beforeDays, afterDays, { before: perVisitor(beforeDays), after: perVisitor(afterDays), perDayBefore: null, perDayAfter: null }),
    countVerdict("forms", sum(beforeDays, (x) => x.forms), sum(afterDays, (x) => x.forms)),
    countVerdict("enquiries", sum(beforeDays, (x) => x.enquiries), sum(afterDays, (x) => x.enquiries)),
  ];

  const all = [...byDay.entries()];
  const series = {
    visitors: all.map(([date, d]) => ({ date, value: d.users, side: side(date) })),
    engagement: all.map(([date, d]) => ({ date, value: d.users > 0 ? Math.round((d.seconds / d.users) * 10) / 10 : null, side: side(date) })),
    forms: all.map(([date, d]) => ({ date, value: d.forms, side: side(date) })),
    enquiries: all.map(([date, d]) => ({ date, value: d.enquiries, side: side(date) })),
  } satisfies Record<MetricKey, ComparePoint[]>;

  const chosen = ask.change.kind === "commit" ? ask.change.sha : null;
  const inWindows = (d: string) => (d >= before.start && d <= before.end) || (d >= after.start && d <= after.end);
  const others = (rows ?? [])
    .filter((r) => r.sha !== chosen && inWindows(r.day))
    .map((r) => ({ sha: r.sha, short: r.short, subject: r.subject, day: r.day, samePage: ask.page ? r.pages.includes(ask.page) : false }));
  const onTheDay = (rows ?? []).filter((r) => r.sha !== chosen && r.day === changeDay).length;

  const stale = [daily, totals, events].find((r) => r.stale)?.error;
  const at = Math.min(daily.at!, totals.at!, events.at!);
  return ok(
    {
      days,
      asked: ask.window,
      shortened: w.value.shortened,
      before,
      after,
      changeDay,
      metrics,
      series,
      provisional: daysFrom(before.start, after.end).filter((d) => d >= measured.provisionalFrom).length,
      others,
      onTheDay,
      sameWeekdays: days % 7 === 0,
    },
    "ga4",
    at,
    gaNote(stale),
  );
}

/* ---------- saved comparisons ---------------------------------------------------- */

interface SavedDb {
  id: number;
  who: number;
  at: string;
  name: string;
  note: string | null;
  sha: string | null;
  day: string | null;
  page: string | null;
  days: number;
}

const asWindow = (v: unknown): CompareWindow => (WINDOWS.includes(Number(v) as CompareWindow) ? (Number(v) as CompareWindow) : 14);

function changeOf(sha: string | null, day: string | null, rows: ChangeRow[] | null): CompareAsk["change"] {
  if (day) return { kind: "date", day };
  const s = sha ?? "";
  const r = rows?.find((x) => x.sha.startsWith(s));
  return r ? { kind: "commit", sha: r.sha, short: r.short, subject: r.subject, at: r.at, author: r.author } : { kind: "commit", sha: s, short: s.slice(0, 7), subject: "", at: "", author: "" };
}

function savedRows(c: { telegram: number; owner: boolean }, rows: ChangeRow[] | null): SavedRow[] {
  const list = db.prepare("SELECT id, who, at, name, note, sha, day, page, days FROM cc_comparisons ORDER BY at DESC, id DESC LIMIT 200").all() as unknown as SavedDb[];
  return list.map((s) => {
    const person = getPerson(s.who);
    return {
      id: s.id,
      name: s.name,
      note: s.note,
      by: person ? (person.name.trim().split(/\s+/)[0] ?? person.name) : "Someone no longer on the desk",
      at: s.at,
      change: changeOf(s.sha, s.day, rows),
      page: s.page,
      window: asWindow(s.days),
      mine: s.who === c.telegram || c.owner,
    };
  });
}

/* ---------- reading the address ---------------------------------------------------- */

/** An address on the site, as GA4 writes pagePath; null for anything else. */
function asPage(raw: string | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v.startsWith("/") || v.length > 300 || /[\s<>"]/.test(v)) return null;
  return ga.normalPath(v);
}

/* ---------- the screen ---------------------------------------------------------------- */

routes.get("/", async (c) => {
  const who = me(c);
  const q = (k: string) => c.req.query(k);
  const range = (Object.hasOwn(RANGES, q("range") ?? "") ? q("range") : "30d") as Range;
  const span = RANGES[range] as number;
  const today = ga.propertyToday();
  const start = shiftDay(today, 1 - span);
  const prevStart = shiftDay(start, -span);

  /* The history first: tiles, the list, the form's choices and a comparison all stand on it. */
  const history = await reading("repo", changeRows);
  const rows = history.state === "ok" ? history.value.rows : null;

  /* Where GA4's measurement begins, from the cached 30-day totals: the same read feeds the readiness panel. */
  const totals30 = await ga.totals("30d", { screen: true });
  const measured = totals30.data ? { since: totals30.data.span.since, fullFrom: totals30.data.span.fullFrom, provisionalFrom: totals30.data.span.provisionalFrom } : null;

  /* ---- what is being compared ---- */
  let ask: CompareAsk | null = null;
  let saved: Comparison["saved"] = null;
  const metricAsked = q("metric") as MetricKey | undefined;
  const metric: MetricKey = metricAsked && METRICS.includes(metricAsked) ? metricAsked : "visitors";
  const savedId = Number(q("saved"));
  if (Number.isInteger(savedId) && savedId > 0) {
    const s = db.prepare("SELECT id, who, at, name, note, sha, day, page, days FROM cc_comparisons WHERE id = ?").get(savedId) as unknown as SavedDb | undefined;
    if (s) {
      ask = { change: changeOf(s.sha, s.day, rows), page: s.page, window: asWindow(s.days), metric };
      saved = { id: s.id, name: s.name, note: s.note };
    }
  }
  if (!ask) {
    const date = q("date");
    const sha = (q("change") ?? "").toLowerCase();
    const window = asWindow(q("window"));
    const page = asPage(q("page"));
    if (date && isDay(date) && date <= today && date >= "2015-08-14") ask = { change: { kind: "date", day: date }, page, window, metric };
    else if (/^[0-9a-f]{7,40}$/.test(sha)) ask = { change: changeOf(sha, null, rows), page, window, metric };
  }

  /* ---- the tiles ---- */
  const inRange = (r: ChangeRow, from: string, to: string) => r.day >= from && r.day <= to;
  const rangeDays = daysFrom(start, today);
  const h = history.state === "ok" ? history.value : null;
  /* Every commit of the range was read, or the count would come out short. */
  const rangeRead = !!h && covers(h, start);
  /*
   * The previous period is compared only when it lies wholly inside the
   * history read. When the read is complete, that means on or after the
   * repository's first commit: the website was not in this repository before
   * it, and a period that began before the history did is absent, not a
   * smaller count.
   */
  const previousKnown = !!h && h.from !== null && (h.complete ? h.from <= prevStart : h.from < prevStart);
  /** A tile or list the read does not reach back far enough for: absent, with the way to a figure that is whole. */
  const cutShort = (from: string): Reading<never> =>
    off(
      "repo",
      `The desk reads the newest ${fmt(HISTORY_CAP)} commits on main, and they reach back only to ${words(from)}. This range begins on ${words(start)}, so a count of it would come out short.`,
      `Pick a shorter range: every commit since ${words(from)} is counted in full.`,
    );

  const shipped = await reading<Stat>("repo", () => {
    if (history.state !== "ok") return history;
    if (!rangeRead) return cutShort(history.value.from ?? start);
    const now = history.value.rows.filter((r) => inRange(r, start, today));
    const perDay = new Map<string, number>();
    for (const r of now) perDay.set(r.day, (perDay.get(r.day) ?? 0) + 1);
    const published = now.filter((r) => r.kind === "publish").length;
    return ok(
      {
        value: now.length,
        previous: previousKnown ? history.value.rows.filter((r) => inRange(r, prevStart, shiftDay(start, -1))).length : null,
        unit: "count",
        series: rangeDays.map((d) => perDay.get(d) ?? 0),
        ...(published ? { sub: `${plural(published, "article")} published among them` } : {}),
      },
      "repo",
      history.asOf,
      REPO_NOTE,
    );
  });

  const pagesChanged = await reading<Stat>("repo", () => {
    if (history.state !== "ok") return history;
    if (!rangeRead) return cutShort(history.value.from ?? start);
    const count = (from: string, to: string) => {
      const pages = new Set<string>();
      const templates = new Set<string>();
      for (const r of history.value.rows) {
        if (!inRange(r, from, to)) continue;
        for (const p of r.pages) pages.add(p);
        for (const t of r.templates) templates.add(t);
      }
      return { pages: pages.size, templates: templates.size };
    };
    const now = count(start, today);
    const perDay = new Map<string, Set<string>>();
    for (const r of history.value.rows) {
      if (!inRange(r, start, today)) continue;
      const set = perDay.get(r.day) ?? new Set<string>();
      for (const p of r.pages) set.add(p);
      perDay.set(r.day, set);
    }
    return ok(
      {
        value: now.pages,
        previous: previousKnown ? count(prevStart, shiftDay(start, -1)).pages : null,
        unit: "count",
        series: rangeDays.map((d) => perDay.get(d)?.size ?? 0),
        ...(now.templates ? { sub: `and ${plural(now.templates, "page template")}` } : {}),
      },
      "repo",
      history.asOf,
      PAGES_RULE,
    );
  });

  const savedList = await reading<SavedRow[]>("desk", () => ok(savedRows(who, rows), "desk", new Date().toISOString(), "Kept on the desk: who saved each comparison, and what it asks. Its figures are worked out again when it is opened."));

  /* Counted in the table, not from the list above (which stops at 200), and people by who saved, not by first name. */
  const savedTile = await reading<Stat>("desk", () => {
    const t = db.prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT who) AS people FROM cc_comparisons").get() as { n: number; people: number };
    return ok(
      {
        value: Number(t.n),
        previous: null,
        unit: "count",
        series: [],
        sub: t.n ? `by ${plural(Number(t.people), "person", "people")}` : "Figures are recomputed when one is opened",
      },
      "desk",
      new Date().toISOString(),
      "Comparisons saved on this screen, all time. Only what was asked is kept, never a figure.",
    );
  });

  const measuredTile = await reading<Stat>("ga4", () => {
    if (!totals30.data || totals30.at === null) return absentFrom(totals30);
    const since = totals30.data.span.since;
    const lastWhole = shiftDay(today, -1);
    const days = Math.max(0, daysBetween(since, lastWhole) + 1);
    return ok(
      { value: days, previous: null, unit: "count", series: [], sub: `since ${words(since)}${totals30.data.span.fullFrom > since ? ", the first in part" : ""}` },
      "ga4",
      totals30.at,
      `Finished days from the first day GA4 has data for ${ga.hosts().join(", ")} up to yesterday. Nothing before it can be compared. ${ga.GA4_NOTE}`,
    );
  });

  /* ---- Recent changes ---- */
  const all = q("changes") === "all";
  const changes = await reading("repo", () => {
    if (history.state !== "ok") return history;
    const list = history.value.rows.filter((r) => inRange(r, start, today));
    /* The newest rows are right however far the read reaches; only the total can come out short, and then it says so. */
    return ok(
      { rows: all ? list : list.slice(0, SHOWN), total: list.length, all, limit: SHOWN, complete: rangeRead, readFrom: history.value.from },
      "repo",
      history.asOf,
      rangeRead ? REPO_NOTE : `${REPO_NOTE} Only the newest ${fmt(HISTORY_CAP)} commits are read, back to ${words(history.value.from ?? start)}.`,
    );
  });

  const choiceOf = (r: ChangeRow) => ({ sha: r.sha, label: `${shortWords(r.day)} · ${r.short} · ${r.subject.length > 64 ? `${r.subject.slice(0, 63)}…` : r.subject}` });
  const choices = (rows ?? [])
    .filter((r) => r.day >= shiftDay(today, -89))
    .slice(0, 200)
    .map(choiceOf);
  /* The commit being compared is always among the choices, wherever it is in the history: a form sent again keeps it. */
  const askedChange = ask?.change;
  if (askedChange?.kind === "commit" && !choices.some((x) => x.sha === askedChange.sha)) {
    const row = rows?.find((r) => r.sha === askedChange.sha);
    choices.unshift(row ? choiceOf(row) : { sha: askedChange.sha, label: `${askedChange.short} · not on the branch as the desk has read it` });
  }

  /* ---- the comparison ---- */
  let comparison: Comparison | null = null;
  if (ask) {
    const result = await reading<CompareResult>("ga4", () => compare(ask, rows, measured));
    comparison = { ask, saved, result };
  }

  /* ---- the page list ---- */
  const touched = ask?.change.kind === "commit" ? (rows?.find((r) => r.sha === (ask.change as { sha: string }).sha)?.pages ?? []) : [];
  const pages = await reading<PageOption[]>("crawl", () => {
    const inv = inventory();
    if (inv.state !== "ok") return inv;
    const set = new Set(inv.value.filter((p) => p.status === 200 && !p.redirectTo).map((p) => p.path));
    for (const t of touched) set.add(t);
    if (ask?.page) set.add(ask.page);
    const t = new Set(touched);
    const list = [...set].map((path) => ({ path, touched: t.has(path) }));
    list.sort((a, b) => Number(b.touched) - Number(a.touched) || a.path.localeCompare(b.path));
    return ok(list, "crawl", inv.asOf);
  });

  /* ---- what a real experiment needs ---- */
  const readiness = await reading<Readiness>("ga4", async () => {
    if (!totals30.data || totals30.at === null) return absentFrom(totals30);
    const ev = await ga.events("30d", { screen: true });
    if (!ev.data || ev.at === null) return absentFrom(ev);
    const s = totals30.data.span;
    const days = daysBetween(s.since > s.start ? s.since : s.start, s.end) + 1;
    const visitors = totals30.data.current.activeUsers;
    const enquiries = ev.data.rows.find((r) => r.name === "generate_lead")?.count ?? 0;
    const each = visitors > 0 && enquiries > 0 ? perVersion(enquiries / visitors) : null;
    const perDay = days > 0 ? visitors / days : 0;
    return ok(
      { days, visitors, enquiries, perVersion: each, daysNeeded: each !== null && perDay > 0 ? Math.ceil((2 * each) / perDay) : null, method: PLAN_METHOD },
      "ga4",
      Math.min(totals30.at, ev.at),
      gaNote(totals30.stale ? totals30.error : ev.stale ? ev.error : undefined),
    );
  });

  return c.json<ExperimentsPayload>({
    range,
    specimen: false,
    tiles: { shipped, pagesChanged, saved: savedTile, measured: measuredTile },
    changes,
    choices,
    comparison,
    pages,
    saved: savedList,
    readiness,
    measuredFrom: measured?.fullFrom ?? null,
  });
});

/* ---------- saving and removing -------------------------------------------------------- */

routes.post("/saved", async (c) => {
  const who = me(c);
  const body = (await c.req.json().catch(() => null)) as Partial<SaveComparison> | null;
  if (!body || typeof body !== "object") return c.json<ApiError>({ error: "Send the comparison as JSON." }, 400);

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) return c.json<ApiError>({ error: "Give the comparison a name of 1 to 80 characters." }, 400);
  const noteText = typeof body.note === "string" ? body.note.trim() : "";
  if (noteText.length > 500) return c.json<ApiError>({ error: "Keep the note under 500 characters." }, 400);
  if (!WINDOWS.includes(body.window as CompareWindow)) return c.json<ApiError>({ error: "The window must be 7, 14 or 28 days." }, 400);
  const page = body.page == null || body.page === "" ? null : asPage(body.page);
  if (body.page && !page) return c.json<ApiError>({ error: "The page must be an address on the site, starting with /." }, 400);

  let sha: string | null = null;
  let day: string | null = null;
  if (typeof body.day === "string" && body.day) {
    if (!isDay(body.day) || body.day > ga.propertyToday()) return c.json<ApiError>({ error: "The day must be a date up to today, written YYYY-MM-DD." }, 400);
    day = body.day;
  } else if (typeof body.sha === "string" && /^[0-9a-f]{7,40}$/i.test(body.sha)) {
    const list = await history().catch(() => []);
    const found = list.find((x) => x.sha.startsWith(String(body.sha).toLowerCase()));
    if (!found) return c.json<ApiError>({ error: "That commit is not on the website's main branch as the desk has read it." }, 400);
    sha = found.sha;
  } else {
    return c.json<ApiError>({ error: "Say what changed: a commit or a day." }, 400);
  }

  const at = new Date().toISOString();
  const res = db.prepare("INSERT INTO cc_comparisons (who, at, name, note, sha, day, page, days) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(who.telegram, at, name, noteText || null, sha, day, page, body.window as number);
  const id = Number(res.lastInsertRowid);
  note("experiment", `Comparison saved: ${name}`, { tone: "info", actor: who.name, href: `/experiments?saved=${id}`, detail: `${page ?? "the whole site"} · ${body.window} days each side` });
  return c.json<SavedAnswer>({ ok: true, id }, 201);
});

routes.post("/saved/:id/delete", (c) => {
  const who = me(c);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id < 1) return c.json<ApiError>({ error: "There is no such comparison." }, 404);
  const row = db.prepare("SELECT who, name FROM cc_comparisons WHERE id = ?").get(id) as { who: number; name: string } | undefined;
  if (!row) return c.json<ApiError>({ error: "There is no such comparison." }, 404);
  if (row.who !== who.telegram && !who.owner) return c.json<ApiError>({ error: "Only the person who saved a comparison, or the owner, can remove it." }, 403);
  db.prepare("DELETE FROM cc_comparisons WHERE id = ?").run(id);
  return c.json({ ok: true });
});
