import { db } from "../../db.ts";
import type { Reading, SourceStatus } from "../../../web/src/contract/common.ts";
import type { Job } from "../scheduler.ts";
import { off, ok, record, series, setState, state, waiting } from "../store.ts";
import { answered, ask, base, countOn, dayIn, failed, kindOf, pathOf, placeOnBox, setCount, siteBase, SourceError, statusOf } from "./shared.ts";

/**
 * Microsoft Clarity: how visitors behaved on the pages. Sessions, how far
 * they scrolled, how long they stayed, and where they got stuck (rage clicks,
 * dead clicks, quick backs, script errors).
 *
 * THE API IS TEN QUESTIONS A DAY. One endpoint, at most ten requests per
 * project per day, the last one to three days only, at most 1,000 rows, no
 * paging, and paying does not raise it. So Clarity can never be live here:
 *
 *   - ONE job asks FOUR questions a day (by page, by device, by source and
 *     medium, by country). If a run is cut short it asks only for what is
 *     missing, later the same day, and it never spends the last two.
 *   - A COUNTER IN THE DATABASE refuses the eleventh request of a UTC day
 *     whatever asks for it, and is counted BEFORE a request is sent: whether
 *     a failed call uses up Clarity's allowance is not documented, so the
 *     worst is assumed.
 *   - EVERY ANSWER IS KEPT in cc_clarity, row by row as Clarity sent it, each
 *     row under its own place in the answer (several rows of one metric may
 *     share a page or a device). What is not stored today can never be asked
 *     for again, and history exists only on our side.
 *
 * NO HEATMAPS, NO RECORDINGS. The API has neither, and Clarity's pages refuse
 * to be framed. `deepLink` opens Clarity itself instead.
 *
 * ONLY CONSENTING VISITORS. The website loads Clarity after a visitor allows
 * session recording, so every figure is an undercount and will not agree
 * with GA4, which waits for a different switch.
 *
 * WHAT IS DOCUMENTED AND WHAT IS NOT. Microsoft documents the endpoint, the
 * dimensions, the metric names and ONE sample (Traffic, two rows), with no
 * definition of any field: not even whether totalSessionCount includes the
 * bot sessions counted beside it (see `ClarityRow.sessions`). The field names
 * inside the other metrics (sessionsCount, subTotal, averageScrollDepth,
 * totalTime, activeTime) are the ones real answers have carried and are NOT
 * in the documentation. That is why the rows are kept exactly as sent: if a
 * name turns out different, `fields` below is the one place to correct, and
 * nothing collected is lost. A field that is not found reads as null, never
 * as zero.
 *
 *   https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api
 */

const API = (): string => base("CLARITY_API_BASE", "https://www.clarity.ms/export-data/api/v1");
const token = (): string => (process.env.CLARITY_TOKEN ?? "").trim();

export const configured = (): boolean => !!token();

/** Clarity's own ceiling. */
export const DAILY_LIMIT = 10;
/** Requests the scheduled snapshot never spends, whatever it still lacks: room for a retry and for a person. */
const RESERVE = 2;

const REASON = "Microsoft Clarity's data export is not connected.";

/**
 * Menu path as documented on the page above (read 2 October 2026): Settings,
 * Data Export, Generate new API token, by a project admin only; a token name
 * is 4 to 32 letters, digits, hyphens, underscores or dots.
 */
export const step = (): string =>
  `As an admin of the website's project in Microsoft Clarity, open Settings, Data Export, press Generate new API token and name it desk-command-center, ${placeOnBox("CLARITY_TOKEN")}; for links into Clarity put CLARITY_PROJECT_ID (the id in the project's address, not a secret) the same way.`;

const CAVEAT = "Only visitors who allowed session recording. One snapshot a day; Clarity's API answers ten times a day and reaches back three days at most.";

export function status(): SourceStatus {
  return statusOf({
    id: "clarity",
    name: "Microsoft Clarity",
    feeds: "Sessions, scroll depth, time on page, rage and dead clicks, quick backs and script errors per page, device, source and country",
    connected: configured(),
    offReason: REASON,
    step: step(),
  });
}

/* ---------- the ten requests ---------------------------------------------- */

/** Clarity's day, for its allowance: results are in UTC and nothing says when the count starts again, so UTC it is. */
const utcDay = (): string => dayIn("UTC");

/** How many requests the desk has sent to Clarity today. */
export const callsToday = (): number => countOn("clarity.calls", utcDay());

/** How many it may still send today. */
export const callsLeft = (): number => Math.max(0, DAILY_LIMIT - callsToday());

export type Dimension = "Browser" | "Device" | "Country/Region" | "OS" | "Source" | "Medium" | "Campaign" | "Channel" | "URL";

/** One metric of an answer: its name and its rows, exactly as Clarity sent them. */
export interface Metric {
  metricName: string;
  information: Record<string, unknown>[];
}

/**
 * THE ONLY FUNCTION THAT TALKS TO CLARITY. One request, counted first.
 *
 * The eleventh request of a UTC day is refused here, before anything is
 * sent, whoever asks and for whatever reason. A 429 from Clarity itself means
 * its count is ahead of ours (another tool used the same project), so ours is
 * moved to the limit and nothing more is sent today.
 */
export async function pull(dimensions: Dimension[], numOfDays: 1 | 2 | 3 = 1): Promise<Metric[]> {
  if (!configured()) throw new SourceError(0, "auth", REASON, "NO_TOKEN");
  const day = utcDay();
  const used = countOn("clarity.calls", day);
  if (used >= DAILY_LIMIT) {
    throw new SourceError(429, "quota", `The desk has sent Clarity its ${DAILY_LIMIT} requests for today and will not send another before tomorrow (UTC)`, "DESK_LIMIT");
  }
  setCount("clarity.calls", day, used + 1);

  try {
    const query = new URLSearchParams({ numOfDays: String(numOfDays) });
    dimensions.slice(0, 3).forEach((d, i) => query.set(`dimension${i + 1}`, d));
    const res = await ask("Clarity", `${API()}/project-live-insights?${query}`, { headers: { authorization: `Bearer ${token()}` }, timeout: 45_000 });

    if (res.status === 429) {
      setCount("clarity.calls", day, DAILY_LIMIT);
      throw new SourceError(429, "quota", "Clarity says today's ten requests are used; the next snapshot is tomorrow", "LIMIT");
    }
    if (res.status === 401) throw new SourceError(401, "auth", "Clarity refused the token: it is missing, mistyped or expired", "TOKEN");
    if (res.status === 403) throw new SourceError(403, "forbidden", "Clarity says the token is not allowed to export this project's data", "FORBIDDEN");
    if (res.status !== 200) throw new SourceError(res.status, kindOf(res.status), res.status >= 500 ? `Clarity answered ${res.status}` : `Clarity did not accept the request (${res.status})`);
    if (!Array.isArray(res.json)) throw new SourceError(200, "request", "Clarity answered in a shape the desk does not know");

    answered("clarity");
    return (res.json as unknown[]).flatMap((m) => {
      const metric = m as { metricName?: unknown; information?: unknown };
      return typeof metric?.metricName === "string" && Array.isArray(metric.information)
        ? [{ metricName: metric.metricName, information: metric.information.filter((r): r is Record<string, unknown> => !!r && typeof r === "object") }]
        : [];
    });
  } catch (e) {
    failed("clarity", e);
    throw e;
  }
}

/* ---------- what is kept --------------------------------------------------- */

/*
 * One row per row Clarity sent, keyed by its place in the answer (`n`), not by
 * its dimension values: Microsoft lists metrics (Browser, Device, OS, Popular
 * Pages, Page Title, Referrer URL) that send several rows for one value of the
 * dimension asked for, and a key of (metric, k1, k2) kept only the last of
 * them. What Clarity sends cannot be asked for again after three days.
 */
const CLARITY_TABLE = `
  CREATE TABLE IF NOT EXISTS cc_clarity (
    /* The UTC day the snapshot was taken. */
    day    TEXT NOT NULL,
    /* Which of the four questions: url, device, source, country. */
    cut    TEXT NOT NULL,
    /* The metric's name as Clarity sent it. */
    metric TEXT NOT NULL,
    /* The row's place among that metric's rows in the answer, from 0. */
    n      INTEGER NOT NULL,
    /* The values of the dimensions asked for: the page, or source and medium. */
    k1     TEXT NOT NULL DEFAULT '',
    k2     TEXT NOT NULL DEFAULT '',
    /* The row exactly as Clarity sent it. */
    json   TEXT NOT NULL,
    /* How many days the answer covers: 1, or 2 or 3 after a missed day. */
    span   INTEGER NOT NULL,
    at     TEXT NOT NULL,
    PRIMARY KEY (day, cut, metric, n)
  );
`;

/* A table made by the first version of this file (key without `n`) is rebuilt
   once, its rows numbered in their old order, inside one transaction. */
const columns = db.prepare("PRAGMA table_info(cc_clarity)").all() as { name: string }[];
if (columns.length && !columns.some((c) => c.name === "n")) {
  db.exec("BEGIN");
  try {
    db.exec(`
      ALTER TABLE cc_clarity RENAME TO cc_clarity_before_n;
      ${CLARITY_TABLE}
      INSERT INTO cc_clarity (day, cut, metric, n, k1, k2, json, span, at)
        SELECT day, cut, metric, ROW_NUMBER() OVER (PARTITION BY day, cut, metric ORDER BY k1, k2) - 1, k1, k2, json, span, at FROM cc_clarity_before_n;
      DROP TABLE cc_clarity_before_n;
    `);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
} else {
  db.exec(CLARITY_TABLE);
}

export type Cut = "url" | "device" | "source" | "country";

/** The four questions of the daily snapshot: the breakdowns the Traffic and Conversions screens draw. */
const CUTS: { cut: Cut; dimensions: Dimension[] }[] = [
  { cut: "url", dimensions: ["URL"] },
  { cut: "device", dimensions: ["Device"] },
  { cut: "source", dimensions: ["Source", "Medium"] },
  { cut: "country", dimensions: ["Country/Region"] },
];

/** A key or a metric name without its spelling: "Country/Region", "countryRegion" and "country region" are one. */
const bare = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** How Clarity may spell a dimension as a key of a row. Only "OS" is in its documentation; the rest is tolerance. */
const KEYS: Record<Dimension, string[]> = {
  URL: ["url", "pageurl"],
  Device: ["device"],
  Source: ["source"],
  Medium: ["medium"],
  "Country/Region": ["countryregion", "country"],
  Browser: ["browser"],
  OS: ["os"],
  Campaign: ["campaign"],
  Channel: ["channel"],
};

function valueOf(row: Record<string, unknown>, d: Dimension): string {
  for (const [k, v] of Object.entries(row)) if (KEYS[d].includes(bare(k))) return v == null ? "" : String(v);
  return "";
}

/** A number from a row under any of the given names, or null when the row has none of them. Clarity sends counts as strings. */
function numberOf(row: Record<string, unknown>, ...names: string[]): number | null {
  for (const [k, v] of Object.entries(row)) {
    if (!names.includes(bare(k)) || v == null || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Take today's snapshot: the questions not yet answered today, each one
 * request. Running it again the same day costs nothing once all four are in;
 * after a failure it asks only for what is missing, and the counter above
 * still has the last word.
 *
 * After a missed day the answer covers two or three days at once (the API
 * cannot give them separately), and the rows say so in `span`.
 */
export async function snapshot(): Promise<string> {
  if (!configured()) throw new Error(REASON);
  const day = utcDay();

  let done: { day: string; cuts: Cut[] } = { day, cuts: [] };
  try {
    const had = JSON.parse(state("clarity.snapshot") ?? "null") as typeof done | null;
    if (had?.day === day) done = had;
  } catch {
    /* start over */
  }
  const missing = CUTS.filter((c) => !done.cuts.includes(c.cut));
  if (!missing.length) return `Today's snapshot is already in (${callsToday()} of ${DAILY_LIMIT} requests used today)`;
  /* Never spend the last requests of the day: they are the reserve for a person asking by hand. */
  if (callsLeft() < missing.length + RESERVE) return `Not asked: ${callsLeft()} of Clarity's ${DAILY_LIMIT} requests are left today and ${RESERVE} are kept in reserve`;

  const last = (db.prepare("SELECT MAX(day) AS d FROM cc_clarity WHERE day < ?").get(day) as { d: string | null }).d;
  const gap = last ? Math.round((Date.parse(day) - Date.parse(last)) / 86_400_000) : 1;
  const span = Math.min(3, Math.max(1, gap)) as 1 | 2 | 3;

  /* A question answered again the same day replaces its earlier answer whole. */
  const clear = db.prepare("DELETE FROM cc_clarity WHERE day = ? AND cut = ?");
  const put = db.prepare("INSERT INTO cc_clarity (day, cut, metric, n, k1, k2, json, span, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");

  /* Rows actually written, not rows handed over. */
  let kept = 0;
  for (const c of missing) {
    /* One at a time, on purpose: four requests are the whole day's work. */
    const metrics = await pull(c.dimensions, span);
    const at = new Date().toISOString();
    /* Numbered per metric name across the whole answer, so a name Clarity sends twice still has a place for every row. */
    const place = new Map<string, number>();
    db.exec("BEGIN");
    try {
      clear.run(day, c.cut);
      for (const m of metrics) {
        for (const row of m.information) {
          const n = place.get(m.metricName) ?? 0;
          place.set(m.metricName, n + 1);
          const k1 = valueOf(row, c.dimensions[0]!);
          const k2 = c.dimensions[1] ? valueOf(row, c.dimensions[1]) : "";
          kept += Number(put.run(day, c.cut, m.metricName, n, k1, k2, JSON.stringify(row), span, at).changes);
        }
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    done.cuts.push(c.cut);
    setState("clarity.snapshot", JSON.stringify(done));
  }

  /* The day's totals into the series, from the device rows: every session is on exactly one device, so they add up. */
  const devices = rowsOf(day, "device");
  const total = (pick: (r: ClarityRow) => number | null): number | null => {
    const values = devices.map(pick).filter((v): v is number => v !== null);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  const write = (metric: string, v: number | null) => v !== null && record(metric, v, day);
  write("clarity.sessions", total((r) => r.sessions));
  write("clarity.bot_sessions", total((r) => r.botSessions));
  write("clarity.rage_clicks", total((r) => r.rageClicks.count));
  write("clarity.dead_clicks", total((r) => r.deadClicks.count));
  write("clarity.quick_backs", total((r) => r.quickBacks.count));
  write("clarity.script_errors", total((r) => r.scriptErrors.count));

  return `Snapshot taken: ${kept} rows over ${missing.length} questions, the last ${span === 1 ? "24 hours" : `${span} days`} (${callsToday()} of ${DAILY_LIMIT} requests used today)`;
}

/* ---------- reading what was kept ----------------------------------------- */

/** One kind of friction on a page, device, source or country. Any part may be null when Clarity did not send it. */
export interface Friction {
  /** How often it happened. */
  count: number | null;
  /** The share of sessions in which it happened, in percent. */
  sessionsPct: number | null;
}

/** Everything Clarity said about one value of a breakdown, in one row. */
export interface ClarityRow {
  /** The page address, the device, the source, or the country. */
  key: string;
  /** For the source breakdown, the medium. */
  key2: string;
  /**
   * Clarity's totalSessionCount, as sent. WHETHER IT INCLUDES BOTS IS NOT
   * DOCUMENTED: Microsoft defines none of the fields, and its one sample has
   * the bot count below the total in every row (8,369 of 9,554), which
   * suggests it does. Do not call it "people" and do not subtract `botSessions`
   * from it until the first real snapshot has settled the question.
   */
  sessions: number | null;
  /** Clarity's totalBotSessionCount: sessions it judged to be bots. Whether `sessions` already contains them is not documented (see there). */
  botSessions: number | null;
  users: number | null;
  pagesPerSession: number | null;
  /** Average scroll depth, in percent of the page. */
  scrollDepth: number | null;
  /** Time with the page open and time actually active, as Clarity sends them (seconds on its dashboard). */
  totalTime: number | null;
  activeTime: number | null;
  rageClicks: Friction;
  deadClicks: Friction;
  quickBacks: Friction;
  excessiveScroll: Friction;
  scriptErrors: Friction;
  errorClicks: Friction;
}

/**
 * THE ONE PLACE FIELD NAMES ARE READ. Metric names are compared without
 * spaces or capitals ("Dead Click Count" and "DeadClickCount" are the same).
 * Only the Traffic fields are from Microsoft's documentation, including its
 * own misspelling "distantUserCount"; the others are to be confirmed against
 * the first real snapshot and corrected here if they differ.
 */
const fields = {
  traffic: (r: Record<string, unknown>) => ({
    sessions: numberOf(r, "totalsessioncount"),
    botSessions: numberOf(r, "totalbotsessioncount"),
    users: numberOf(r, "distantusercount", "distinctusercount"),
    pagesPerSession: numberOf(r, "pagespersessionpercentage", "pagespersession"),
  }),
  scroll: (r: Record<string, unknown>) => numberOf(r, "averagescrolldepth"),
  time: (r: Record<string, unknown>) => ({ totalTime: numberOf(r, "totaltime"), activeTime: numberOf(r, "activetime") }),
  friction: (r: Record<string, unknown>): Friction => ({ count: numberOf(r, "subtotal"), sessionsPct: numberOf(r, "sessionswithmetricpercentage") }),
};

const FRICTION: Record<string, keyof Pick<ClarityRow, "rageClicks" | "deadClicks" | "quickBacks" | "excessiveScroll" | "scriptErrors" | "errorClicks">> = {
  rageclickcount: "rageClicks",
  deadclickcount: "deadClicks",
  quickbackclick: "quickBacks",
  excessivescroll: "excessiveScroll",
  scripterrorcount: "scriptErrors",
  errorclickcount: "errorClicks",
};

const NONE: Friction = { count: null, sessionsPct: null };

/** Whether `rowsOf` reads a metric. The others are kept as sent and left for a later reader. */
const reads = (name: string): boolean => name === "traffic" || name === "scrolldepth" || name === "engagementtime" || Object.hasOwn(FRICTION, name);

/**
 * One snapshot's rows for one breakdown, folded from one row per metric into
 * one row per value. Only the metrics read here take part, so a metric that
 * sends several rows per value (Browser, OS, Popular Pages ...) adds no empty
 * row of its own; should one of the read metrics ever send two rows for one
 * value, the later one stands.
 */
function rowsOf(day: string, cut: Cut): ClarityRow[] {
  const raw = db.prepare("SELECT metric, k1, k2, json FROM cc_clarity WHERE day = ? AND cut = ? ORDER BY metric, n").all(day, cut) as { metric: string; k1: string; k2: string; json: string }[];
  const by = new Map<string, ClarityRow>();
  for (const r of raw) {
    if (!reads(bare(r.metric))) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(r.json) as Record<string, unknown>;
    } catch {
      continue;
    }
    const id = `${r.k1}\u0000${r.k2}`;
    const out: ClarityRow = by.get(id) ?? {
      key: r.k1,
      key2: r.k2,
      sessions: null,
      botSessions: null,
      users: null,
      pagesPerSession: null,
      scrollDepth: null,
      totalTime: null,
      activeTime: null,
      rageClicks: NONE,
      deadClicks: NONE,
      quickBacks: NONE,
      excessiveScroll: NONE,
      scriptErrors: NONE,
      errorClicks: NONE,
    };
    const name = bare(r.metric);
    if (name === "traffic") Object.assign(out, fields.traffic(row));
    else if (name === "scrolldepth") out.scrollDepth = fields.scroll(row);
    else if (name === "engagementtime") Object.assign(out, fields.time(row));
    else if (Object.hasOwn(FRICTION, name)) out[FRICTION[name]!] = fields.friction(row);
    by.set(id, out);
  }
  return [...by.values()].sort((a, b) => (b.sessions ?? -1) - (a.sessions ?? -1));
}

/** Which snapshot a reading came from. */
export interface SnapshotInfo {
  /** The UTC day it was taken. */
  day: string;
  /** How many days it covers: 1 normally, 2 or 3 after missed days. */
  span: number;
  takenAt: string;
}

function newest(cut: Cut): SnapshotInfo | null {
  const r = db.prepare("SELECT day, span, MAX(at) AS at FROM cc_clarity WHERE cut = ? AND day = (SELECT MAX(day) FROM cc_clarity WHERE cut = ?)").get(cut, cut) as
    | { day: string | null; span: number; at: string }
    | undefined;
  return r?.day ? { day: r.day, span: r.span, takenAt: r.at } : null;
}

/** A breakdown of the newest snapshot as a reading. No request: it reads what the daily job kept. */
function kept<T>(cut: Cut, make: (rows: ClarityRow[], info: SnapshotInfo) => T): Reading<T> {
  if (!configured()) return off("clarity", REASON, step());
  const info = newest(cut);
  if (!info) return waiting("clarity", "Clarity is connected and the first daily snapshot has not been taken yet.");
  return ok(make(rowsOf(info.day, cut), info), "clarity", info.takenAt, `${CAVEAT} This one covers the ${info.span === 1 ? "24 hours" : `${info.span} days`} before it was taken.`);
}

export interface ClaritySnapshot extends SnapshotInfo {
  /** Clarity's totalSessionCount summed over the devices. Whether bot sessions are inside it is not documented: see `ClarityRow.sessions`. */
  sessions: number | null;
  /** Clarity's totalBotSessionCount summed over the devices. */
  botSessions: number | null;
  /** How often each friction happened, over every device. Shares cannot be added up, so only counts are here. */
  rageClicks: number | null;
  deadClicks: number | null;
  quickBacks: number | null;
  scriptErrors: number | null;
  devices: ClarityRow[];
  /** Requests the desk may still send Clarity today. */
  callsLeft: number;
}

/**
 * The newest snapshot at a glance. The site-wide figures are sums over the
 * device rows, which is exact for counts (a session is on one device) and is
 * why averages such as scroll depth are given per device and not for the site.
 */
export function latest(): Reading<ClaritySnapshot> {
  return kept("device", (rows, info) => {
    const total = (pick: (r: ClarityRow) => number | null): number | null => {
      const values = rows.map(pick).filter((v): v is number => v !== null);
      return values.length ? values.reduce((a, b) => a + b, 0) : null;
    };
    return {
      ...info,
      sessions: total((r) => r.sessions),
      botSessions: total((r) => r.botSessions),
      rageClicks: total((r) => r.rageClicks.count),
      deadClicks: total((r) => r.deadClicks.count),
      quickBacks: total((r) => r.quickBacks.count),
      scriptErrors: total((r) => r.scriptErrors.count),
      devices: rows,
      callsLeft: callsLeft(),
    };
  });
}

export interface ClarityUrlRow extends ClarityRow {
  /** The page as a path: "/logistics". */
  path: string;
}

const withPath = (r: ClarityRow): ClarityUrlRow => ({ ...r, path: pathOf(r.key) });

/** Every page of the newest snapshot, most sessions first. At most 1,000 rows: Clarity sends no more. */
export const byUrl = (): Reading<SnapshotInfo & { rows: ClarityUrlRow[] }> => kept("url", (rows, info) => ({ ...info, rows: rows.map(withPath) }));

export const byDevice = (): Reading<SnapshotInfo & { rows: ClarityRow[] }> => kept("device", (rows, info) => ({ ...info, rows }));

/** By traffic source; `key` is the source and `key2` the medium. */
export const bySource = (): Reading<SnapshotInfo & { rows: ClarityRow[] }> => kept("source", (rows, info) => ({ ...info, rows }));

export const byCountry = (): Reading<SnapshotInfo & { rows: ClarityRow[] }> => kept("country", (rows, info) => ({ ...info, rows }));

export interface PageFriction extends SnapshotInfo {
  url: string;
  path: string;
  sessions: number | null;
  rageClicks: Friction;
  deadClicks: Friction;
  quickBacks: Friction;
  excessiveScroll: Friction;
  scriptErrors: Friction;
  errorClicks: Friction;
}

/** Where visitors got stuck on one page, from the newest snapshot. `url` may be a full address or a path. */
export function friction(url: string): Reading<PageFriction> {
  const all = byUrl();
  if (all.state !== "ok") return all;
  const path = pathOf(url);
  const rows = all.value.rows.filter((r) => r.path === path);
  if (!rows.length) return waiting("clarity", `The newest Clarity snapshot has no sessions on ${path}.`);
  /* The same page can come back under several addresses (a query string); the busiest one stands for it. */
  const r = rows[0]!;
  const { day, span, takenAt } = all.value;
  return {
    ...all,
    value: { day, span, takenAt, url: r.key, path, sessions: r.sessions, rageClicks: r.rageClicks, deadClicks: r.deadClicks, quickBacks: r.quickBacks, excessiveScroll: r.excessiveScroll, scriptErrors: r.scriptErrors, errorClicks: r.errorClicks },
  };
}

/** How far down each page visitors scrolled on average, in percent, deepest first. Pages Clarity gave no depth for are left out. */
export function scrollDepth(): Reading<SnapshotInfo & { rows: { url: string; path: string; scrollDepth: number; sessions: number | null }[] }> {
  return kept("url", (rows, info) => ({
    ...info,
    rows: rows.flatMap((r) => (r.scrollDepth === null ? [] : [{ url: r.key, path: pathOf(r.key), scrollDepth: r.scrollDepth, sessions: r.sessions }])).sort((a, b) => b.scrollDepth - a.scrollDepth),
  }));
}

/** Time on each page: open and actually active, as Clarity sends them. Pages without either are left out. */
export function engagementTime(): Reading<SnapshotInfo & { rows: { url: string; path: string; totalTime: number | null; activeTime: number | null; sessions: number | null }[] }> {
  return kept("url", (rows, info) => ({
    ...info,
    rows: rows.flatMap((r) => (r.totalTime === null && r.activeTime === null ? [] : [{ url: r.key, path: pathOf(r.key), totalTime: r.totalTime, activeTime: r.activeTime, sessions: r.sessions }])),
  }));
}

/** Sessions and friction counts per day, from the day the desk started keeping snapshots. No request. */
export function history(days = 90): { day: string; sessions: number | null; rageClicks: number | null; deadClicks: number | null; quickBacks: number | null; scriptErrors: number | null }[] {
  const of = (metric: string) => new Map(series(metric, days).map((p) => [p.day, p.value]));
  const sessions = of("clarity.sessions");
  const rage = of("clarity.rage_clicks");
  const dead = of("clarity.dead_clicks");
  const quick = of("clarity.quick_backs");
  const errors = of("clarity.script_errors");
  const all = [...new Set([...sessions.keys(), ...rage.keys(), ...dead.keys(), ...quick.keys(), ...errors.keys()])].sort();
  return all.map((day) => ({
    day,
    sessions: sessions.get(day) ?? null,
    rageClicks: rage.get(day) ?? null,
    deadClicks: dead.get(day) ?? null,
    quickBacks: quick.get(day) ?? null,
    scriptErrors: errors.get(day) ?? null,
  }));
}

/**
 * Where to look in Clarity itself, since heatmaps and recordings exist only
 * there. `dashboard` follows the address form Microsoft's own documentation
 * links to; `recordings` and `heatmaps` are the project's two other pages as
 * its menu names them today. Clarity documents no address that filters by
 * page, so the link opens the project and the page is chosen there; `page`
 * is handed back so a screen can say which one to pick.
 *
 * Works without a token (the project id is public, it is in the website's
 * own pages); without CLARITY_PROJECT_ID it opens the list of projects. An
 * address that cannot be read gives `page: null`; it never throws, because
 * a route may pass a query parameter straight through.
 */
export function deepLink(url?: string): { dashboard: string; recordings: string; heatmaps: string; page: string | null } {
  const id = (process.env.CLARITY_PROJECT_ID ?? "").trim();
  const home = "https://clarity.microsoft.com/projects";
  let page: string | null = null;
  if (url) {
    try {
      page = new URL(pathOf(url), `${siteBase()}/`).toString();
    } catch {
      page = null;
    }
  }
  if (!/^[a-z0-9]+$/i.test(id)) return { dashboard: home, recordings: home, heatmaps: home, page };
  const project = `${home}/view/${id}`;
  return { dashboard: `${project}/dashboard`, recordings: `${project}/impressions`, heatmaps: `${project}/heatmaps`, page };
}

export const jobs: Job[] = [
  {
    /* Woken every three hours, it asks Clarity at most once a UTC day per
       question: once the four are in, a run sends nothing. Waking more often
       than daily is what lets a snapshot cut short by a restart or a Clarity
       hiccup finish the same day instead of being lost for good. */
    name: "clarity-daily",
    title: "Take the daily snapshot from Clarity",
    every: 3 * 3600,
    delay: 360,
    ready: configured,
    run: () => snapshot(),
  },
];
