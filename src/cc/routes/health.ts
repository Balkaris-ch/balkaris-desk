import { Hono } from "hono";
import { db } from "../../db.ts";
import type { Vars } from "../access.ts";
import { status as jobStatus } from "../scheduler.ts";
import { specimenAllowed } from "../specimen.ts";
import { activity, cached, off, ok, reading, series, since as seriesSince, waiting } from "../store.ts";
import { scrub, scrubItem } from "../system.ts";
import type { ActivityItem, Range, Reading, Stat } from "../../../web/src/contract/common.ts";
import type {
  CheckRow,
  DeployRow,
  Deployment,
  DeskServer,
  EndpointRow,
  HealthDeployments,
  HealthLogs,
  HealthPayload,
  HealthRange,
  HealthTiles,
  Infrastructure,
  JobRow,
  PerfTrend,
  ResponseRange,
  ResponseSeries,
  SiteInfra,
  TechChecks,
  TrendRange,
  VitalNow,
} from "../../../web/src/contract/health.ts";

/**
 * /api/v1/health: Site Health, the website as the desk can see it from outside.
 *
 *   GET /?range=1h|24h|7d|30d&trend=7d|30d|90d&rt=1h|24h|7d   the whole screen
 *   GET /logs?kind=&limit=      everything "Recent incidents & logs" draws from
 *   GET /deployments?n=         the commits on main the desk has recorded
 *
 * The website is on Vercel and the desk holds no Vercel token, so nothing here
 * is a figure only Vercel knows (builds, function invocations, bandwidth, its
 * own logs). What there is:
 *
 *   probe    a handful of addresses asked every two minutes from the desk's
 *            server (site/probes.ts, table cc_probes, kept 35 days)
 *   psi      PageSpeed Insights lab runs once a day, field data when Google
 *            has any (site/psi.ts), and the Chrome UX Report (search/crux.ts)
 *   crawl    the daily crawl, the sitemap and robots.txt, the asset scan
 *   repo     the website's git history: every push to main is a production build
 *   desk     the scheduler's runs (cc_runs, kept 7 days) and the desk's own box
 *
 * Every panel is its own reading(), so one failing source costs one panel. The
 * probe, run and commit tables are counted with plain SQL here (grouped by
 * bucket in SQLite, never loaded row by row) because no collector function
 * splits them the way this screen needs; nothing is written.
 *
 * `?specimen=1` (development only, decided by specimenAllowed) feeds the
 * PageSpeed panels from the SPECIMEN_ functions at the bottom while PageSpeed
 * has measured nothing. Nothing else on this screen needs a key.
 */

export const routes = new Hono<Vars>();

const site = () => import("../site/index.ts");
const search = () => import("../search/index.ts");
type Site = Awaited<ReturnType<typeof site>>;

const RANGES = ["1h", "24h", "7d", "30d"] as const satisfies readonly HealthRange[];
const TRENDS = ["7d", "30d", "90d"] as const satisfies readonly TrendRange[];
const WINDOWS = ["1h", "24h", "7d"] as const satisfies readonly ResponseRange[];
const pick = <T extends string>(list: readonly T[], asked: string | undefined, fallback: T): T => list.find((r) => r === asked?.toLowerCase()) ?? fallback;

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const SPAN: Record<Range, number> = { "1h": HOUR, "24h": DAY, "7d": 7 * DAY, "30d": 30 * DAY, "90d": 90 * DAY, "1y": 365 * DAY };
/** Bucket width of a tile's spark, per range: about thirty bars or points each. */
const TILE_BUCKET: Record<HealthRange, number> = { "1h": 2 * MIN, "24h": HOUR, "7d": 6 * HOUR, "30d": DAY };
/** Bucket width of the response-time chart. */
const RESPONSE_BUCKET: Record<ResponseRange, number> = { "1h": 2 * MIN, "24h": 30 * MIN, "7d": 3 * HOUR };
const RANGE_WORDS: Record<Range, string> = { "1h": "hour", "24h": "24 hours", "7d": "7 days", "30d": "30 days", "90d": "90 days", "1y": "year" };

/** Under this many events a rate is two counts, not a percentage. */
const FEW = 30;

/**
 * How long after the desk first saw a commit a check of the home page counts
 * for it: Vercel's production build takes about two minutes, so a check
 * sooner may still be answered by the build before.
 */
const SETTLE = 3 * MIN;

const VANTAGE = "Measured from the desk's own server, one vantage point; each check opens a new connection, so the time includes DNS and TLS. When the desk is down there is a gap, not downtime.";

/* ---------- small helpers ---------------------------------------------------- */

const iso = (ms: number): string => new Date(ms).toISOString();
const failedRead = (e: unknown): string => `The last read failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`;

/* Months by the desk's own list: Node 22 and 24 disagree about "Sep" and "Sept". */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const zurichParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** "2 Oct, 12:13" by the studio's clock; "12:13" when it is today. */
function when(isoTime: string): string {
  const p = (d: Date) => Object.fromEntries(zurichParts.formatToParts(d).map((x) => [x.type, x.value]));
  const a = p(new Date(isoTime));
  const n = p(new Date());
  const time = `${a.hour}:${a.minute}`;
  if (a.year === n.year && a.month === n.month && a.day === n.day) return time;
  return `${Number(a.day)} ${MONTHS[Number(a.month) - 1]}, ${time}`;
}
/** "2 Oct" for a YYYY-MM-DD day. */
const dayWords = (day: string): string => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

/**
 * A row's bucket number, in SQL, for a width bound as the next parameter:
 * the ISO time as milliseconds since 1970 (julianday is exact to well under a
 * millisecond at today's dates), divided by the width. The width is cast,
 * because node:sqlite binds a JS number as REAL and REAL division does not
 * floor. Bucket number × width is the bucket's start, as `buckets()` makes it.
 */
const bucketSql = (col: string): string => `CAST(ROUND((julianday(${col}) - 2440587.5) * 86400000.0) AS INTEGER) / CAST(? AS INTEGER)`;

/** The first probe the desk ever made, ISO, or null. The 35-day table first; the kept daily line when that has been pruned. */
function probingSince(): string | null {
  const row = db.prepare("SELECT MIN(at) AS a FROM cc_probes").get() as { a: string | null };
  const day = seriesSince("uptime.checks");
  if (day && (!row.a || day < row.a.slice(0, 10))) return `${day}T00:00:00.000Z`;
  return row.a;
}

/** Bucket starts from the first event to now, so a line begins where measurement did. */
function buckets(from: number, width: number, first: number | null): number[] {
  const now = Date.now();
  const start = Math.floor(Math.max(from, first ?? now) / width) * width;
  const out: number[] = [];
  for (let k = start; k <= now; k += width) out.push(k);
  return out;
}

/**
 * A rate as a tile's Stat. Under FEW events it is the two counts ("20 / 20")
 * with no comparison; otherwise a percentage with the window before when that
 * window was measured whole (and had FEW events itself).
 */
function rateStat(hit: number, total: number, prev: { hit: number; total: number } | null, spark: number[], sub: string): Stat {
  if (total < FEW) return { value: hit, of: total, unit: "count", previous: null, series: spark, sub };
  return {
    value: (hit / total) * 100,
    unit: "percent",
    previous: prev && prev.total >= FEW ? (prev.hit / prev.total) * 100 : null,
    series: spark,
    sub,
  };
}

/** Run `f` once, on first call; a throw is thrown again to every caller, so each reading() that asks turns it into its own words. */
function once<T>(f: () => T): () => T {
  let kept: { v: T } | null = null;
  return () => (kept ??= { v: f() }).v;
}

/* ---------- the probes, counted by SQLite ---------------------------------------- */

const firstProbe = (where = ""): number | null => {
  const r = db.prepare(`SELECT MIN(at) AS a FROM cc_probes WHERE 1 = 1 ${where}`).get() as { a: string | null };
  return r.a ? Date.parse(r.a) : null;
};

const NO_CHECK = "No check has run yet. The first runs within a minute of the desk starting, then every two minutes.";

interface Tally {
  n: number;
  /** Checks that got their healthy answer. */
  good: number;
}

/** The three probe tiles' counts, from one grouped read of the range: per bucket, the home page apart from the other addresses. */
interface ProbeTally {
  from: number;
  prevFrom: number;
  rows: (Tally & { b: number; home: number; last: string })[];
  /** The window before, per group; null when no probe is that old. */
  prev: (Tally & { home: number })[] | null;
  first: { home: number | null; other: number | null };
}

function tallyProbes(range: HealthRange): ProbeTally {
  const now = Date.now();
  const from = now - SPAN[range];
  const prevFrom = from - SPAN[range];
  const rows = db
    .prepare(`SELECT ${bucketSql("at")} AS b, (target = 'home') AS home, COUNT(*) AS n, TOTAL(ok) AS good, MAX(at) AS last FROM cc_probes WHERE at >= ? AND at < ? GROUP BY b, home ORDER BY b`)
    .all(TILE_BUCKET[range], iso(from), iso(now + 1)) as unknown as ProbeTally["rows"];
  const first = { home: firstProbe("AND target = 'home'"), other: firstProbe("AND target <> 'home'") };
  const earliest = Math.min(first.home ?? Infinity, first.other ?? Infinity);
  const prev =
    earliest <= prevFrom
      ? (db.prepare("SELECT (target = 'home') AS home, COUNT(*) AS n, TOTAL(ok) AS good FROM cc_probes WHERE at >= ? AND at < ? GROUP BY home").all(iso(prevFrom), iso(from)) as unknown as ProbeTally["prev"])
      : null;
  return { from, prevFrom, rows, prev, first };
}

/**
 * A rate over probes of one group: the share that passed, or the share that
 * failed. The window before is compared only when the group's probes cover it
 * from its first minute.
 */
function probeRate(t: ProbeTally, range: HealthRange, group: "home" | "other" | "all", count: "passed" | "failed", what: string): Reading<Stat> {
  const mine = (home: number) => group === "all" || (group === "home") === (home === 1);
  const hitOf = (x: Tally) => (count === "passed" ? x.good : x.n - x.good);
  const rows = t.rows.filter((r) => mine(r.home));
  const total = rows.reduce((a, r) => a + r.n, 0);
  if (!total) {
    return t.first.home === null && t.first.other === null ? waiting("probe", NO_CHECK) : waiting("probe", `No check of ${what} inside the last ${RANGE_WORDS[range]}.`);
  }
  const both = Math.min(t.first.home ?? Infinity, t.first.other ?? Infinity);
  const first = group === "home" ? t.first.home : group === "other" ? t.first.other : Number.isFinite(both) ? both : null;
  let prev: { hit: number; total: number } | null = null;
  if (t.prev && first !== null && first <= t.prevFrom) {
    const before = t.prev.filter((r) => mine(r.home));
    prev = { hit: before.reduce((a, r) => a + hitOf(r), 0), total: before.reduce((a, r) => a + r.n, 0) };
  }
  /* "all" has two rows per bucket (home and the rest): they are one point of the spark. */
  const by = new Map<number, Tally>();
  for (const r of rows) {
    const x = by.get(r.b) ?? { n: 0, good: 0 };
    by.set(r.b, { n: x.n + r.n, good: x.good + r.good });
  }
  const spark = [...by.values()].map((x) => (hitOf(x) / x.n) * 100);
  const hit = rows.reduce((a, r) => a + hitOf(r), 0);
  const last = rows.reduce((a, r) => (r.last > a ? r.last : a), "");
  const startedInside = first !== null && first > t.from;
  const sub = `${plural(total, "check")}${startedInside ? ` since ${when(iso(first))}` : ""}`;
  return ok(rateStat(hit, total, prev, spark, sub), "probe", last, VANTAGE);
}

/* ---------- tiles ---------------------------------------------------------------- */

async function speedTile(range: HealthRange): Promise<Reading<Stat>> {
  const s = await site();
  const c = await search();
  /* Field first: what real Chrome visits measured. */
  const field = await c.crux.vitals("ALL");
  if (field.state === "ok" && field.value.lcp) {
    const line = series("crux.lcp", 30);
    return ok(
      {
        value: field.value.lcp.p75 / 1000,
        unit: "s",
        previous: dayAgo(line, range),
        series: line.map((p) => p.value / 1000),
        sub: `Field · real visits, 28 days${field.value.to ? ` to ${dayWords(field.value.to)}` : ""}`,
      },
      "crux",
      field.asOf,
      field.note,
    );
  }
  const psiField = s.vital("lcp", "mobile", { from: "field", days: 30 });
  const v = psiField.state === "ok" ? psiField : s.vital("lcp", "mobile", { days: 30 });
  if (v.state !== "ok") return v as Reading<Stat>;
  const line = v.value.history.map((p) => ({ day: p.date, value: p.value }));
  return ok(
    {
      value: v.value.value / 1000,
      unit: "s",
      previous: dayAgo(line, range),
      series: line.map((p) => p.value / 1000),
      sub: v.value.kind === "field" ? "Field · real visits, 28 days" : `Lab · mobile, median of ${plural(v.value.pages, "page")}`,
    },
    v.source,
    v.asOf,
    v.note,
  );
}

/** The same daily line one range earlier, in seconds; null for the short ranges and before history began. */
function dayAgo(line: { day: string; value: number }[], range: HealthRange): number | null {
  if (!line.length) return null;
  const back = range === "24h" ? 1 : range === "7d" ? 7 : range === "30d" ? 30 : 0;
  if (!back) return null;
  const newest = line[line.length - 1]!.day;
  const target = new Date(Date.parse(`${newest}T12:00:00Z`) - back * DAY).toISOString().slice(0, 10);
  const hit = line.find((p) => p.day === target);
  return hit ? hit.value / 1000 : null;
}

/* ---------- deployments: one rule for the tile and every row ------------------------- */

interface CommitSeen {
  sha: string;
  at: string;
  subject: string;
  /** When the desk's fetch first recorded it: the push was no later than this. */
  seen: string;
}

/** The newest commits on main the desk has recorded, with when it first saw each. Newest first, as `commits()` orders them. */
const commitsSeen = (limit: number): CommitSeen[] => db.prepare("SELECT sha, at, subject, seen FROM cc_commits ORDER BY at DESC LIMIT ?").all(limit) as unknown as CommitSeen[];

const DEPLOY_NOTE =
  "Commits to the website's main branch; each starts a production build on Vercel, whose result only Vercel knows. The status is what the desk verified: the home page's first check at least three minutes after the desk saw the commit, before the next one.";

/**
 * What the desk can say about a commit: see DeployState in the contract.
 * A check counts for a commit from SETTLE after the later of its commit time
 * and the moment the desk first saw it (a commit can be pushed hours after it
 * was made; it cannot be pushed after the desk saw it), until the next commit.
 */
function verifier(s: Site): (c: CommitSeen, next: CommitSeen | null) => DeployRow {
  const began = probingSince();
  const beganMs = began ? Date.parse(began) : null;
  const keptFrom = firstProbe("AND target = 'home'");
  const find = db.prepare("SELECT at, status, ok FROM cc_probes WHERE target = 'home' AND at >= ? AND at < ? ORDER BY at LIMIT 1");
  const now = Date.now();
  return (c, next) => {
    const fromMs = Math.max(Date.parse(c.at), Date.parse(c.seen)) + SETTLE;
    const base = { sha: c.sha, short: c.sha.slice(0, 7), subject: c.subject, at: c.at, url: s.commitUrl(c.sha), checkFrom: iso(fromMs), check: null };
    if (next) {
      const untilMs = Date.parse(next.at);
      if (beganMs === null || untilMs <= beganMs) return { ...base, state: "before" };
      if (keptFrom === null || untilMs <= keptFrom) return { ...base, state: "unkept" };
      if (fromMs >= untilMs) return { ...base, state: "unchecked" };
    }
    const hit = find.get(iso(fromMs), next ? next.at : iso(now + 1)) as { at: string; status: number; ok: number } | undefined;
    if (!hit) return { ...base, state: next ? "unchecked" : "pending" };
    return { ...base, state: !hit.ok ? "failed" : next ? "answered" : "live", check: { at: hit.at, status: hit.status } };
  };
}

/** Verify a newest-first list that begins with the newest commit of all. */
function verifyList(s: Site, list: CommitSeen[]): DeployRow[] {
  const check = verifier(s);
  return list.map((c, i) => check(c, i === 0 ? null : list[i - 1]!));
}

async function deploymentTile(range: HealthRange): Promise<Reading<Deployment>> {
  const s = await site();
  const d = s.deployments(1);
  if (d.state !== "ok") return d as Reading<Deployment>;
  const newest = commitsSeen(1);
  if (!newest.length) return waiting("repo", "The website's repository has no commit on its main branch yet.");
  const [row] = verifyList(s, newest);
  /* The bars begin where the desk's record of commits does: a day before it is unknown, not zero. */
  const now = Date.now();
  const width = TILE_BUCKET[range];
  const from = now - SPAN[range];
  const since = s.commitsSince();
  const begins = since ? Math.max(from, Date.parse(since)) : from;
  const marks = buckets(begins, width, begins);
  const counted = db.prepare(`SELECT ${bucketSql("at")} AS b, COUNT(*) AS n FROM cc_commits WHERE at >= ? GROUP BY b`).all(width, iso(begins)) as { b: number; n: number }[];
  const per = new Map(counted.map((x) => [x.b * width, x.n]));
  return ok(
    { ...row!, perBucket: marks.map((k) => per.get(k) ?? 0), barsSince: since && Date.parse(since) > from ? since : null },
    "repo",
    d.asOf,
    "The last commit on the website's main branch: each push starts a production build on Vercel. Whether that build succeeded only Vercel knows; “Live” means the home page answered 200 at least three minutes after the desk saw the commit. The bars count commits per bucket since the desk's record of them begins.",
  );
}

async function deploymentRows(): Promise<Reading<DeployRow[]>> {
  const s = await site();
  const d = s.deployments(1);
  if (d.state !== "ok") return d as Reading<DeployRow[]>;
  return ok(verifyList(s, commitsSeen(5)), "repo", d.asOf, DEPLOY_NOTE);
}

/* ---------- background jobs ------------------------------------------------------------- */

function jobsTile(range: HealthRange): Reading<Stat> {
  const now = Date.now();
  const from = now - SPAN[range];
  const rows = db
    .prepare(`SELECT ${bucketSql("started")} AS b, COUNT(*) AS n, TOTAL(ok) AS good, MAX(started) AS last FROM cc_runs WHERE ok IS NOT NULL AND started >= ? GROUP BY b ORDER BY b`)
    .all(TILE_BUCKET[range], iso(from)) as unknown as (Tally & { b: number; last: string })[];
  const total = rows.reduce((a, r) => a + r.n, 0);
  if (!total) return waiting("desk", `No scheduled job finished a run in the last ${RANGE_WORDS[range]}.`);
  const firstRow = db.prepare("SELECT MIN(started) AS a FROM cc_runs").get() as { a: string | null };
  const first = firstRow.a ? Date.parse(firstRow.a) : null;
  const prevFrom = from - SPAN[range];
  let prev: { hit: number; total: number } | null = null;
  if (first !== null && first <= prevFrom) {
    const before = db.prepare("SELECT COUNT(*) AS n, TOTAL(ok) AS good FROM cc_runs WHERE ok IS NOT NULL AND started >= ? AND started < ?").get(iso(prevFrom), iso(from)) as unknown as Tally;
    prev = { hit: before.good, total: before.n };
  }
  const good = rows.reduce((a, r) => a + r.good, 0);
  const last = rows.reduce((a, r) => (r.last > a ? r.last : a), "");
  const startedInside = first !== null && first > from;
  return ok(
    rateStat(good, total, prev, rows.map((r) => (r.good / r.n) * 100), `${plural(total, "run")}${startedInside ? ` since ${when(iso(first))}` : ""}`),
    "desk",
    last,
    "Runs of the desk's scheduled jobs that finished without an error. The desk keeps a week of runs, so a longer range counts that week only.",
  );
}

/* ---------- performance trend --------------------------------------------------- */

async function trend(days: number): Promise<Reading<PerfTrend>> {
  const s = await site();
  const lcp = series("speed.mobile.lcp", days);
  const cls = series("speed.mobile.cls", days);
  /* INP only from field data: the Chrome UX Report's daily line, or PageSpeed's origin field.
     Without either, Total Blocking Time under its own name. */
  const cruxInp = series("crux.inp", days);
  const psiInp = series("field.mobile.inp", days);
  const second = cruxInp.length
    ? { metric: "inp" as const, kind: "field" as const, key: "crux.inp", line: cruxInp }
    : psiInp.length
      ? { metric: "inp" as const, kind: "field" as const, key: "field.mobile.inp", line: psiInp }
      : { metric: "tbt" as const, kind: "lab" as const, key: "speed.mobile.tbt", line: series("speed.mobile.tbt", days) };

  if (!lcp.length && !cls.length && !second.line.length) {
    const why = s.vital("lcp", "mobile");
    if (why.state !== "ok") return why as Reading<PerfTrend>;
    return waiting("psi", "No daily speed line has been recorded inside this window yet.");
  }
  const allDays = [...new Set([...lcp, ...cls, ...second.line].map((p) => p.day))].sort();
  const at = (line: { day: string; value: number }[]) => {
    const m = new Map(line.map((p) => [p.day, p.value]));
    return allDays.map((d) => m.get(d) ?? null);
  };
  /* The newest reading against the same line one window earlier, when it was recorded then. */
  const latest = (metric: string, line: { day: string; value: number }[]) => {
    const last = line[line.length - 1];
    if (!last) return null;
    const before = new Date(Date.parse(`${last.day}T12:00:00Z`) - days * DAY).toISOString().slice(0, 10);
    const old = series(metric, days * 2 + 1).find((p) => p.day === before);
    return { value: last.value, previous: old ? old.value : null };
  };
  const firstEver =
    [seriesSince("speed.mobile.lcp"), seriesSince("speed.mobile.cls"), seriesSince(second.key)].filter((d): d is string => !!d).sort()[0] ?? allDays[0]!;
  const lab = s.vital("lcp", "mobile");
  return ok(
    {
      days: allDays,
      lcpMs: at(lcp),
      second: { metric: second.metric, kind: second.kind, values: at(second.line) },
      cls: at(cls),
      latest: {
        lcpMs: latest("speed.mobile.lcp", lcp),
        second: latest(second.key, second.line),
        cls: latest("speed.mobile.cls", cls),
      },
      strategy: "mobile",
      since: firstEver,
    },
    "psi",
    lab.state === "ok" ? lab.asOf : iso(Date.now()),
    second.metric === "inp"
      ? "LCP and CLS: lab, the median of the tested pages on a simulated phone, one point a day. INP: field, real Chrome visits over 28 days."
      : "Lab, one point a day: the median of the tested pages on a simulated phone. INP exists only in field data, which Google does not have for this site; Total Blocking Time is the lab's stand-in, shown under its own name.",
  );
}

/* ---------- response time ----------------------------------------------------------- */

/**
 * Each answered check's class, in SQL. Cached (edge): Vercel's cache answered
 * (HIT, STALE). Rendered (origin): the request ran (MISS, BYPASS, REVALIDATED,
 * or the function probe). Anything else (PRERENDER: the build's stored page)
 * counts in the average and in neither line.
 */
const CACHE_CLASS =
  "CASE WHEN target <> 'function' AND cache IN ('HIT', 'STALE') THEN 'cached' WHEN target = 'function' OR cache IN ('MISS', 'BYPASS', 'REVALIDATED') THEN 'rendered' ELSE 'other' END";
const ANSWERED = "ok = 1 AND ttfb_ms IS NOT NULL";

interface TimeSum {
  k: "cached" | "rendered" | "other";
  n: number;
  /** The sum of the times to first byte, ms. */
  sum: number;
}

function response(window: ResponseRange): Reading<ResponseSeries> {
  const now = Date.now();
  const from = now - SPAN[window];
  const width = RESPONSE_BUCKET[window];
  const rows = db
    .prepare(`SELECT ${bucketSql("at")} AS b, ${CACHE_CLASS} AS k, COUNT(*) AS n, TOTAL(ttfb_ms) AS sum, MIN(at) AS first, MAX(at) AS last FROM cc_probes WHERE at >= ? AND at < ? AND ${ANSWERED} GROUP BY b, k ORDER BY b`)
    .all(width, iso(from), iso(now + 1)) as unknown as (TimeSum & { b: number; first: string; last: string })[];
  if (!rows.length) return firstProbe() === null ? waiting("probe", NO_CHECK) : waiting("probe", `No answered check inside the last ${RANGE_WORDS[window]}.`);
  const firstAt = rows.reduce((a, r) => (r.first < a ? r.first : a), rows[0]!.first);
  const lastAt = rows.reduce((a, r) => (r.last > a ? r.last : a), rows[0]!.last);
  const marks = buckets(from, width, Date.parse(firstAt));
  const line = (k: TimeSum["k"]) => {
    const m = new Map(rows.filter((r) => r.k === k).map((r) => [r.b * width, r.sum / r.n]));
    return marks.map((x) => {
      const v = m.get(x);
      return v === undefined ? null : Math.round(v);
    });
  };

  /* The window before, only when the probes covered it from its start. */
  const everFirst = firstProbe();
  const prevRows =
    everFirst !== null && everFirst <= from - SPAN[window]
      ? (db.prepare(`SELECT ${CACHE_CLASS} AS k, COUNT(*) AS n, TOTAL(ttfb_ms) AS sum FROM cc_probes WHERE at >= ? AND at < ? AND ${ANSWERED} GROUP BY k`).all(iso(from - SPAN[window]), iso(from)) as unknown as TimeSum[])
      : null;
  const meanOf = (list: TimeSum[], keep: (k: TimeSum["k"]) => boolean) => {
    let n = 0;
    let sum = 0;
    for (const r of list) {
      if (!keep(r.k)) continue;
      n += r.n;
      sum += r.sum;
    }
    return n ? { mean: sum / n, n } : null;
  };
  const figure = (keep: (k: TimeSum["k"]) => boolean) => {
    const v = meanOf(rows, keep);
    if (!v) return null;
    const p = prevRows ? meanOf(prevRows, keep) : null;
    return { value: Math.round(v.mean), previous: p ? Math.round(p.mean) : null, checks: v.n };
  };
  return ok(
    {
      window,
      bucketMinutes: width / MIN,
      x: marks.map(iso),
      cached: line("cached"),
      rendered: line("rendered"),
      average: figure(() => true)!,
      cachedAvg: figure((k) => k === "cached"),
      renderedAvg: figure((k) => k === "rendered"),
      since: firstAt,
    },
    "probe",
    lastAt,
    `Mean time to first byte of the desk's checks. Cached (edge): Vercel's cache answered (HIT, STALE). Rendered (origin): the request ran (MISS, BYPASS, REVALIDATED, or the function probe). ${VANTAGE}`,
  );
}

/* ---------- core web vitals ----------------------------------------------------------- */

/** What the owner can do about a missing INP when Google simply has no field data: nothing. */
const INP_STEP =
  "Nothing to connect: Google publishes INP once enough real Chrome visits have been measured. Until then the performance trend shows Total Blocking Time, the lab's stand-in, under its own name.";

async function vitals(): Promise<HealthPayload["vitals"]> {
  const s = await site();
  const c = await search();
  const crux = await reading("crux", () => c.crux.vitals("ALL"));
  if (crux.state === "ok") {
    const v = crux.value;
    const win = v.from && v.to ? `28 days to ${dayWords(v.to)}` : "28 days";
    const one = (x: { p75: number } | null, unit: "ms" | "score", name: string): Reading<VitalNow> =>
      x ? ok({ value: x.p75, unit, kind: "field", scope: "origin", pages: 0, window: win }, "crux", crux.asOf, crux.note) : off("crux", `Google's field data for this site does not include ${name}.`);
    return { lcp: one(v.lcp, "ms", "LCP"), inp: one(v.inp, "ms", "INP"), cls: one(v.cls, "score", "CLS") };
  }
  const now = (metric: "lcp" | "inp" | "cls"): Reading<VitalNow> => {
    /* Field when PageSpeed's answer carried it, otherwise lab; INP has no lab version. */
    const f = s.vital(metric, "mobile", { from: "field" });
    const r = f.state === "ok" || metric === "inp" ? f : s.vital(metric, "mobile");
    if (r.state !== "ok") {
      /* The collector's step for a missing INP is written for a screen's builder; the reader gets the owner's. */
      if (metric === "inp" && r.state === "off" && r.source === "crux") return off("crux", r.reason, INP_STEP);
      return r as Reading<VitalNow>;
    }
    return ok({ value: r.value.value, unit: r.value.unit, kind: r.value.kind, scope: r.value.scope, pages: r.value.pages, window: r.value.kind === "field" ? "28 days" : r.asOf }, r.source, r.asOf, r.note);
  };
  return { lcp: now("lcp"), inp: now("inp"), cls: now("cls") };
}

/* ---------- endpoints ----------------------------------------------------------------------- */

async function endpoints(): Promise<Reading<EndpointRow[]>> {
  const s = await site();
  if (firstProbe() === null) return waiting("probe", NO_CHECK);
  const now = Date.now();
  const from = now - DAY;
  const timed = ANSWERED;
  const hours = db
    .prepare(
      `SELECT target, ${bucketSql("at")} AS b, COUNT(*) AS n, TOTAL(ok = 0) AS failed, COUNT(CASE WHEN ${timed} THEN 1 END) AS tn, TOTAL(CASE WHEN ${timed} THEN ttfb_ms END) AS ts FROM cc_probes WHERE at >= ? AND at < ? GROUP BY target, b ORDER BY b`,
    )
    .all(HOUR, iso(from), iso(now + 1)) as { target: string; b: number; n: number; failed: number; tn: number; ts: number }[];
  /* SQLite takes a bare column from the row that holds the MAX(): each target's newest answer. */
  const newest = db.prepare("SELECT target, MAX(at) AS at, status, ok FROM cc_probes WHERE at >= ? AND at < ? GROUP BY target").all(iso(from), iso(now + 1)) as {
    target: string;
    at: string;
    status: number;
    ok: number;
  }[];
  const known = s.probeTargets();
  /* A target probed today and no longer on the list (the function probe stopped itself) keeps its row. */
  const ids = [...known.map((t) => t.id), ...[...new Set(hours.map((r) => r.target))].filter((id) => !known.some((t) => t.id === id))];
  const marks = buckets(from, HOUR, from);
  const out: EndpointRow[] = ids.map((id) => {
    const t = known.find((k) => k.id === id);
    const mine = hours.filter((r) => r.target === id);
    const last = newest.find((r) => r.target === id);
    const tn = mine.reduce((a, r) => a + r.tn, 0);
    const ts = mine.reduce((a, r) => a + r.ts, 0);
    const perHour = new Map(mine.filter((r) => r.tn > 0).map((r) => [r.b * HOUR, Math.round(r.ts / r.tn)]));
    const firstMark = perHour.size ? Math.min(...perHour.keys()) : now;
    return {
      id,
      label: t?.label ?? (id === "function" ? "A function" : id),
      path: t?.path ?? (id === "function" ? (process.env.SITE_FUNCTION_PROBE ?? "/api/ask") : id),
      expect: t?.expect ?? 200,
      status: last ? last.status : null,
      ok: last ? Boolean(last.ok) : null,
      avgMs: tn ? Math.round(ts / tn) : null,
      checks: mine.reduce((a, r) => a + r.n, 0),
      failed: mine.reduce((a, r) => a + r.failed, 0),
      spark: marks.filter((k) => k >= firstMark).map((k) => perHour.get(k) ?? null),
    };
  });
  const newestAt = newest.reduce((a, r) => (r.at > a ? r.at : a), "") || iso(now);
  return ok(out, "probe", newestAt, `The addresses the desk checks every two minutes, over the last 24 hours. /api/ask answers only POST: a GET it turns away (405) is its healthy answer, the time of a function waking with no work done. ${VANTAGE}`);
}

/* ---------- jobs ----------------------------------------------------------------------------- */

function jobs(): Reading<JobRow[]> {
  const list = jobStatus().map((j) => ({ ...j, lastNote: j.lastNote === null ? null : scrub(j.lastNote), progress: j.progress?.what ? { ...j.progress, what: scrub(j.progress.what) } : j.progress }));
  if (!list.length) return waiting("desk", "No scheduled job is registered.");
  /* What is wrong first, then what is running, then the most recently run; jobs waiting for a key last. */
  const rank = (j: JobRow) => (!j.ready ? 3 : j.lastOk === false ? 0 : j.running ? 1 : 2);
  list.sort((a, b) => rank(a) - rank(b) || (b.lastStart ?? "").localeCompare(a.lastStart ?? ""));
  return ok(list, "desk", iso(Date.now()), "The desk's scheduler: one job at a time, every run kept for a week.");
}

/* ---------- technical checks -------------------------------------------------------------- */

async function checks(): Promise<TechChecks> {
  const s = await site();
  const ssl = await reading<CheckRow>("probe", () => {
    const c = s.certificate();
    if (c.state !== "ok") return c as Reading<CheckRow>;
    if (!c.value.length) return waiting("probe", "No certificate has been read yet.");
    const unread = c.value.find((x) => x.daysLeft === null);
    if (unread) return ok({ value: "Unreadable", tone: "bad", detail: `${unread.host}: ${unread.problem ?? "no answer"}` }, "probe", c.asOf);
    const soonest = c.value.reduce((a, b) => ((a.daysLeft as number) <= (b.daysLeft as number) ? a : b));
    const days = soonest.daysLeft as number;
    const untrusted = c.value.find((x) => !x.trusted);
    const detail = c.value.map((x) => `${x.host}: ${x.issuer ?? "unknown issuer"}, valid until ${x.validTo?.slice(0, 10) ?? "?"}${x.trusted ? "" : ` (${x.problem})`}`).join("; ");
    if (untrusted) return ok({ value: "Not trusted", tone: "bad", detail }, "probe", c.asOf);
    if (days < 0) return ok({ value: "Expired", tone: "bad", detail }, "probe", c.asOf);
    return ok({ value: `Valid (${days} days)`, tone: days > 14 ? "good" : "warn", detail: `${detail}. Vercel renews about a month ahead; under two weeks means renewal is not happening.` }, "probe", c.asOf, "Read once an hour.");
  });

  const dns = await reading<CheckRow>("probe", () => {
    const d = s.dns();
    if (d.state !== "ok") return d as Reading<CheckRow>;
    const bad = d.value.filter((x) => x.problem || (!x.a.length && !x.aaaa.length));
    const detail = d.value.map((x) => `${x.host}: ${x.problem ?? `${plural(x.a.length + x.aaaa.length, "address", "addresses")}${x.cname.length ? `, alias of ${x.cname.join(", ")}` : ""}`}`).join("; ");
    return ok(bad.length ? { value: `${bad.length} not resolving`, tone: "bad", detail } : { value: "Healthy", tone: "good", detail: `Both names resolve. ${detail}` }, "probe", d.asOf, d.note);
  });

  const map = await reading("crawl", () => s.sitemap());
  const area = (rule: string) => (s.RULES as Record<string, { area: string } | undefined>)[rule]?.area;
  const sitemapRow = await reading<CheckRow>("crawl", () => {
    if (map.state !== "ok") return map as Reading<CheckRow>;
    const issues = map.value.issues.filter((i) => area(i.rule) === "sitemap");
    const critical = issues.filter((i) => i.severity === "critical");
    const n = map.value.entries.length;
    if (map.value.status !== 200) return ok<CheckRow>({ value: `Answers ${map.value.status || "nothing"}`, tone: "bad", detail: issues[0]?.text ?? "The sitemap did not answer." }, "crawl", map.asOf);
    return ok<CheckRow>(
      { value: critical.length ? plural(critical.length, "problem") : `Valid (${n.toLocaleString("en-GB")} URLs)`, tone: critical.length ? "bad" : issues.length ? "warn" : "good", detail: issues.length ? issues.map((i) => i.text).join(" ") : `${plural(n, "address", "addresses")}, well-formed, all on the canonical host.` },
      "crawl",
      map.asOf,
      "Read every 15 minutes.",
    );
  });
  const robotsRow = await reading<CheckRow>("crawl", () => {
    if (map.state !== "ok") return map as Reading<CheckRow>;
    const issues = map.value.issues.filter((i) => area(i.rule) === "robots");
    const r = map.value.robots;
    if (r.status !== 200) return ok<CheckRow>({ value: `Answers ${r.status || "nothing"}`, tone: "warn", detail: issues[0]?.text ?? "robots.txt did not answer." }, "crawl", map.asOf);
    const critical = issues.filter((i) => i.severity === "critical");
    return ok<CheckRow>(
      { value: issues.length ? plural(issues.length, "problem") : "Valid", tone: critical.length ? "bad" : issues.length ? "warn" : "good", detail: issues.length ? issues.map((i) => i.text).join(" ") : `Names ${plural(r.sitemaps.length, "sitemap")}, ${plural(r.rules, "rule")} for every crawler, blocks no address in the sitemap.` },
      "crawl",
      map.asOf,
    );
  });

  const brokenLinks = await reading("crawl", () => {
    const b = s.brokenLinks();
    if (b.state !== "ok") return b as Reading<CheckRow & { count: number }>;
    const n = b.value.length;
    const links = b.value.reduce((a, x) => a + x.sources.length, 0);
    return ok({ count: n, value: n ? plural(n, "issue") : "0 issues", tone: n ? "warn" : "good", detail: n ? `${plural(n, "address", "addresses")} on the site that do not answer, linked ${plural(links, "time")}.` : "Every internal link answered at the last crawl." } as CheckRow & { count: number }, "crawl", b.asOf, b.note);
  });

  const redirects = await reading("crawl", () => {
    const r = s.redirects();
    if (r.state !== "ok") return r as Reading<CheckRow & { count: number; failing: number }>;
    const failing = r.value.filter((x) => x.outcome === "broken").length;
    const chains = r.value.filter((x) => x.outcome === "chain").length;
    const n = r.value.length;
    return ok(
      {
        count: n,
        failing,
        value: `${plural(n, "rule")}, ${failing} failing`,
        tone: failing ? "bad" : chains ? "warn" : "good",
        detail: `Every redirect the site's config promises, and the bare domain's, tried once at the last crawl: ${failing} failing, ${chains} in more than one hop, ${r.value.filter((x) => x.outcome === "untested").length} with no real address to try.`,
      } as CheckRow & { count: number; failing: number },
      "crawl",
      r.asOf,
    );
  });

  const files = await reading("repo", () => s.assets());
  const oversized = await reading<CheckRow & { count: number }>("repo", () => {
    if (files.state !== "ok") return files as Reading<CheckRow & { count: number }>;
    const heavy = files.value.filter((a) => a.flags.some((f) => f.id === "heavy")).length;
    const wide = files.value.filter((a) => a.flags.some((f) => f.id === "oversized")).length;
    const n = files.value.filter((a) => a.flags.some((f) => f.id === "heavy" || f.id === "oversized")).length;
    return ok({ count: n, value: plural(n, "asset"), tone: n ? "warn" : "good", detail: `Files in public/: ${heavy} heavy for their kind (over 400 kB for a picture, 8 MB for a video), ${wide} more than twice as wide as any <img> showing them needs.` }, "repo", files.asOf, files.note);
  });
  const missingAlt = await reading<CheckRow & { count: number }>("repo", () => {
    if (files.state !== "ok") return files as Reading<CheckRow & { count: number }>;
    const hit = files.value.filter((a) => a.flags.some((f) => f.id === "alt-absent"));
    const uses = hit.reduce((a, x) => a + x.alt.absent, 0);
    return ok({ count: hit.length, value: plural(hit.length, "issue"), tone: hit.length ? "warn" : "good", detail: hit.length ? `${plural(hit.length, "file")} shown by ${plural(uses, "<img> tag")} with no alt attribute at all. alt="" (decoration) is not counted.` : "Every <img> of a file in public/ carries an alt attribute." }, "repo", files.asOf, files.note);
  });

  return { ssl, dns, sitemap: sitemapRow, robots: robotsRow, brokenLinks, redirects, oversized, missingAlt };
}

/* ---------- infrastructure ------------------------------------------------------------------ */

async function infra(): Promise<Infrastructure> {
  const s = await site();
  const siteInfo = await reading<SiteInfra>("probe", async () => {
    const home = s.lastHome();
    if (!home) return waiting("probe", NO_CHECK);
    const fn = s.functionProbe();
    const fnRow = db.prepare("SELECT fn_region AS r FROM cc_probes WHERE fn_region IS NOT NULL ORDER BY id DESC LIMIT 1").get() as { r: string } | undefined;
    let versions: { next: { declared: string | null; installed: string | null }; node: string | null } | null = null;
    try {
      if (s.readCopyExists()) versions = (await cached("health:site-versions", 10 * MIN, () => s.siteVersions())).value;
    } catch {
      versions = null;
    }
    return ok(
      {
        hosting: home.region ? "Vercel" : null,
        edgeRegion: home.region,
        functionRegion: fn.state === "ok" ? fn.value.functionRegion : (fnRow?.r ?? null),
        next: versions ? versions.next : null,
        node: versions ? versions.node : null,
        branch: process.env.SITE_BRANCH ?? "main",
      },
      "probe",
      home.at,
      "Hosting and regions from the x-vercel-id header of the desk's checks; Next.js from the website's lock file at the last fetched commit.",
    );
  });
  const cache = await reading("probe", () => {
    const c = s.cacheHitRate("24h");
    return c.state === "ok" ? ok({ percent: c.value.percent, hits: c.value.hits, answered: c.value.answered }, "probe", c.asOf, c.note) : (c as Reading<{ percent: number; hits: number; answered: number }>);
  });
  const desk = await reading<DeskServer>("desk", () => {
    const b = s.box();
    if (b.state !== "ok") return b as Reading<DeskServer>;
    const v = b.value;
    return ok(
      {
        hostname: v.hostname,
        platform: v.platform,
        cpus: v.cpus,
        loadPercent: v.load ? (v.load.one / Math.max(1, v.cpus)) * 100 : null,
        memoryPercent: v.memory.usedPercent,
        memoryTotal: v.memory.total,
        diskPercent: v.disk ? v.disk.usedPercent : null,
        diskTotal: v.disk ? v.disk.total : null,
        processBytes: v.process.rss,
        processLimit: v.process.limit,
        processUptime: v.process.uptime,
        node: v.process.node,
      },
      "desk",
      b.asOf,
      b.note,
    );
  });
  return { site: siteInfo, cache, desk };
}

/* ---------- incidents & logs ------------------------------------------------------------------ */

/** The kinds this screen lists as incidents and logs. Content changes ("page", "insight") and the desk's own work belong to other screens. */
const LOG_KINDS = ["incident", "probe", "deploy", "sitemap", "crawl", "automation"];

/**
 * The scheduler's failed runs, newest first, as log rows of kind "job". They
 * are not written to the activity log: they are read from the scheduler's own
 * record (cc_runs, a week). The id is the run's, negated, so it never meets an
 * activity row's.
 */
function failedRuns(limit: number): ActivityItem[] {
  const titles = new Map(jobStatus().map((j) => [j.name, j.title]));
  const rows = db.prepare("SELECT id, job, started, ended, note FROM cc_runs WHERE ok = 0 ORDER BY started DESC LIMIT ?").all(limit) as {
    id: number;
    job: string;
    started: string;
    ended: string | null;
    note: string | null;
  }[];
  return rows.map((r) => ({
    id: -r.id,
    at: r.ended ?? r.started,
    kind: "job",
    tone: "bad",
    text: `“${titles.get(r.job) ?? r.job}” failed`,
    ...(r.note ? { detail: scrub(r.note) } : {}),
    href: "/automations",
    actor: "desk",
  }));
}

/** The log rows behind the panel, newest first: one kind, or all of LOG_KINDS with the failed runs. */
function logRows(limit: number, kind: string | null): ActivityItem[] {
  const fromLog = kind === "job" ? [] : activity(limit, kind ? [kind] : LOG_KINDS).map(scrubItem);
  const fromRuns = kind === null || kind === "job" ? failedRuns(limit) : [];
  return [...fromLog, ...fromRuns].sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
}

function incidents(): Reading<ActivityItem[]> {
  const all = logRows(12, null).slice(0, 12);
  return ok(all, "desk", all[0]?.at ?? iso(Date.now()), "The desk's activity log (incidents, the function probe, deployments, sitemap changes, crawls, automations) and the scheduler's failed runs.");
}

/* ---------- the routes ---------------------------------------------------------------------- */

routes.get("/", async (c) => {
  const range = pick(RANGES, c.req.query("range"), "30d");
  const trendRange = pick(TRENDS, c.req.query("trend"), "30d");
  const responseRange = pick(WINDOWS, c.req.query("rt"), "24h");
  const specimen = specimenAllowed(c);
  /* One grouped read of the probes for the three probe tiles; each tile is still its own reading. */
  const tally = once(() => tallyProbes(range));

  const [uptime, endpointRate, errors, speed, deployment, jobRate, perf, rt, vit, ends, deploys, jobList, techChecks, infrastructure, log] = await Promise.all([
    reading("probe", () => probeRate(tally(), range, "home", "passed", "the home page")),
    reading("probe", () => probeRate(tally(), range, "other", "passed", "the other addresses")),
    reading("probe", () => probeRate(tally(), range, "all", "failed", "any address")),
    reading("psi", () => speedTile(range)),
    reading("repo", () => deploymentTile(range)),
    reading("desk", () => jobsTile(range)),
    reading("psi", () => trend(Number(trendRange.replace("d", "")))),
    reading("probe", () => response(responseRange)),
    vitals().catch((e: unknown): HealthPayload["vitals"] => {
      const w = waiting<VitalNow>("psi", failedRead(e));
      return { lcp: w, inp: w, cls: w };
    }),
    reading("probe", endpoints),
    reading("repo", deploymentRows),
    reading("desk", () => jobs()),
    /* Each row is its own reading inside; this catches what fails before them (the collectors' module). */
    checks().catch((e: unknown): TechChecks => {
      const w = waiting<never>("crawl", failedRead(e));
      return { ssl: w, dns: w, sitemap: w, robots: w, brokenLinks: w, redirects: w, oversized: w, missingAlt: w };
    }),
    infra().catch((e: unknown): Infrastructure => {
      const w = waiting<never>("probe", failedRead(e));
      return { site: w, cache: w, desk: w };
    }),
    reading("desk", () => incidents()),
  ]);

  /* The specimen stands in only where PageSpeed has not measured: a real figure is never covered. */
  const useSpecimen = specimen && speed.state !== "ok";
  const tiles: HealthTiles = {
    uptime,
    speed: useSpecimen ? SPECIMEN_speedTile() : speed,
    endpoints: endpointRate,
    deployment,
    jobs: jobRate,
    errors,
  };
  let since: string | null = null;
  try {
    since = probingSince();
  } catch {
    since = null;
  }

  return c.json<HealthPayload>({
    range,
    trendRange,
    responseRange,
    specimen: useSpecimen,
    probingSince: since,
    siteUrl: (process.env.SITE_BASE ?? "https://www.balkaris.ch").replace(/\/+$/, ""),
    tiles,
    trend: useSpecimen && perf.state !== "ok" ? SPECIMEN_trend(Number(trendRange.replace("d", ""))) : perf,
    response: rt,
    vitals: useSpecimen ? SPECIMEN_vitals(vit) : vit,
    endpoints: ends,
    deployments: deploys,
    jobs: jobList,
    checks: techChecks,
    infra: infrastructure,
    incidents: log,
  });
});

/** "Recent incidents & logs" in full: the same rows the panel draws from, one kind at a time if asked. */
routes.get("/logs", (c) => {
  const asked = (c.req.query("kind") ?? "").trim();
  const limit = Math.min(500, Math.max(1, Number(c.req.query("limit")) || 100));
  const counted = db.prepare(`SELECT kind, COUNT(*) AS n FROM cc_activity WHERE kind IN (${LOG_KINDS.map(() => "?").join(", ")}) GROUP BY kind`).all(...LOG_KINDS) as { kind: string; n: number }[];
  const failed = (db.prepare("SELECT COUNT(*) AS n FROM cc_runs WHERE ok = 0").get() as { n: number }).n;
  const kinds = [...counted, ...(failed ? [{ kind: "job", n: failed }] : [])].sort((a, b) => b.n - a.n);
  const kind = kinds.some((k) => k.kind === asked) ? asked : null;
  /* Each source gives its newest limit + 1, so the merged list's newest `limit` are right and `more` is known. */
  const rows = logRows(limit + 1, kind);
  return c.json<HealthLogs>({ kind, items: rows.slice(0, limit), kinds, more: rows.length > limit });
});

/** Deployment history in full: every commit on main the desk has recorded, newest first, verified by the same rule as the panel. */
routes.get("/deployments", async (c) => {
  const n = Math.min(1000, Math.max(20, Math.floor(Number(c.req.query("n")) || 100)));
  let s: Site | null = null;
  try {
    s = await site();
  } catch {
    s = null;
  }
  const list = await reading<DeployRow[]>("repo", () => {
    if (!s) throw new Error("The website's collectors did not load.");
    const d = s.deployments(1);
    if (d.state !== "ok") return d as Reading<DeployRow[]>;
    return ok(verifyList(s, commitsSeen(n)), "repo", d.asOf, DEPLOY_NOTE);
  });
  let total = 0;
  let since: string | null = null;
  try {
    total = (db.prepare("SELECT COUNT(*) AS n FROM cc_commits").get() as { n: number }).n;
    since = s ? s.commitsSince() : null;
  } catch {
    /* the list says what failed */
  }
  return c.json<HealthDeployments>({ list, total, since, n });
});

/* ---------- specimen: the PageSpeed panels before PageSpeed has measured ---------- */

/*
 * SPECIMEN values for ?specimen=1 on a development desk only (specimenAllowed),
 * and only while PageSpeed has measured nothing. They are a saw-tooth of round
 * numbers from no source, so nobody mistakes them for the website's speed.
 */
const SPECIMEN_NOTE = "Specimen: artificial values to show the panel connected. Not a measurement of the website.";

const SPECIMEN_saw = (i: number, lo: number, hi: number, period = 4): number => lo + ((hi - lo) * (i % period)) / (period - 1);

function SPECIMEN_days(n: number): string[] {
  return Array.from({ length: n }, (_, i) => new Date(Date.now() - (n - 1 - i) * DAY).toISOString().slice(0, 10));
}

function SPECIMEN_speedTile(): Reading<Stat> {
  return ok({ value: 2, unit: "s", previous: 3, series: Array.from({ length: 12 }, (_, i) => SPECIMEN_saw(i, 1, 3)), sub: "Specimen · lab" }, "none", iso(Date.now()), SPECIMEN_NOTE);
}

function SPECIMEN_trend(days: number): Reading<PerfTrend> {
  const n = Math.min(days, 12);
  const list = SPECIMEN_days(n);
  return ok(
    {
      days: list,
      lcpMs: list.map((_, i) => SPECIMEN_saw(i, 1000, 3000)),
      second: { metric: "tbt", kind: "lab", values: list.map((_, i) => SPECIMEN_saw(i + 1, 100, 400)) },
      cls: list.map((_, i) => SPECIMEN_saw(i + 2, 0.05, 0.2)),
      latest: { lcpMs: { value: 2000, previous: 3000 }, second: { value: 200, previous: null }, cls: { value: 0.1, previous: 0.2 } },
      strategy: "mobile",
      since: list[0]!,
    },
    "none",
    iso(Date.now()),
    SPECIMEN_NOTE,
  );
}

function SPECIMEN_vitals(real: HealthPayload["vitals"]): HealthPayload["vitals"] {
  const v = (value: number, unit: "ms" | "score"): Reading<VitalNow> => ok({ value, unit, kind: "lab", scope: "site", pages: 3, window: iso(Date.now()) }, "none", iso(Date.now()), SPECIMEN_NOTE);
  return {
    lcp: real.lcp.state === "ok" ? real.lcp : v(2000, "ms"),
    /* INP stays absent even in the specimen: a lab run cannot produce it, and the panel must show that state. */
    inp: real.inp,
    cls: real.cls.state === "ok" ? real.cls : v(0.1, "score"),
  };
}
