import { createHash } from "node:crypto";
import { db } from "../db.ts";
import { cached, kept, ok, off, setState, state, waiting } from "./store.ts";
import { SCOPES, hasKey, token } from "./gauth.ts";
import { registerCheck, registerSource } from "./sources.ts";
import type { Job } from "./scheduler.ts";
import type { DayPoint, Range, Reading, Share, SourceId, SourceStatus } from "../../web/src/contract/common.ts";

/**
 * Google Analytics 4 for the command center: history and the live panel.
 *
 * WHAT A SCREEN SHOULD KNOW BEFORE IT CALLS ANYTHING HERE.
 *
 *   1. Every figure is CONSENTING VISITORS ONLY. The website loads GA4 after
 *      the cookie banner is accepted, so each number is an undercount by
 *      however many decline. `GA4_NOTE` says so and travels with the figure.
 *
 *   2. The property is older than the website. It also holds the Framer site
 *      that lived on balkaris.ch from June 2026 and a handful of Framer preview
 *      hosts. Mixed in, "the last 30 days" would be two different websites and
 *      "the period before" would be the old one. So every history read here is
 *      narrowed to the website's own host (`hosts()`), and `measuredSince()` is
 *      the first day THAT host has data, not the first day of the property.
 *
 *   3. A comparison is made only between two WHOLE periods, and is null,
 *      never 0, otherwise. A period ends YESTERDAY unless a caller asks for
 *      today (GA4's own "Last 7 days" does the same): today is still being
 *      counted, hours behind, and six and a half days compared with seven is
 *      a fall that did not happen. And `span.previous` is null until the
 *      whole earlier period lies on or after `span.fullFrom`, the first day
 *      measured from midnight: the website's first day of data began part-way
 *      through, and part of a day compared with a whole one is growth that is
 *      not.
 *
 *   4. History costs almost nothing (one token a report on this property,
 *      measured 2 October 2026) and realtime costs about twenty times as much
 *      (measured, once, under `LIVE_EVERY`). Both come out of 14,000 tokens an
 *      hour and 200,000 a day, in separate buckets, and the buckets belong to
 *      the property: every copy of the desk that holds the key draws on the
 *      same ones. That is why the live panel is one shared poller that sleeps
 *      when no person is looking, and why nothing here is asked twice.
 *
 * Nothing in this file throws at a caller. A read answers
 * `{ data, at, stale?, error? }`, and `asReading()` turns that into the
 * `Reading` a screen prints.
 *
 * NO LIBRARY, as in src/ga4.ts: a signed token (gauth.ts) and a POST.
 */

/* ---------- what travels with every figure ------------------------------ */

/** The caveat every GA4 history figure carries. `asReading` attaches it; say it wherever a figure is drawn. */
export const GA4_NOTE = "Consenting visitors only: GA4 loads after the cookie banner is accepted, so this is an undercount.";

/**
 * The caveat every realtime figure carries: a 30-minute window, consenting
 * visitors, titles not addresses, and every site in the property. Realtime has
 * no host name, and the property's one data stream also carries the retired
 * Framer pages and the website's preview address, so the live count can be
 * higher than anything the history reads (www alone) would suggest.
 */
export const LIVE_NOTE =
  "People active in the last 30 minutes, not this second, and only those who accepted the cookie banner. GA4 reports live pages by title, never by address or traffic source. It counts every site that sends to this GA4 property, not only www.balkaris.ch (the retired Framer pages, and the website's preview address when somebody accepts analytics there), so it will not line up exactly with the history figures.";

/** Why LinkedIn appears beside Google's own channels. Shown wherever `channels()` is drawn. */
export const CHANNEL_NOTE =
  "Google's default channel groups, with LinkedIn taken out of Social and Referral as a group of its own (our grouping, by session source). No session is counted twice.";

/* ---------- the property ------------------------------------------------- */

const API = "https://analyticsdata.googleapis.com/v1beta";
const PROPERTY = (): string => process.env.GA4_PROPERTY_ID ?? "543223467";

/** The property every figure is read from, digits only: for links into GA4's own reports ("#/p<id>/..."). */
export const propertyId = (): string => PROPERTY().replace(/\D/g, "");

/**
 * The host names that are the website. From GA4_HOSTS (comma separated) when
 * set, otherwise the host of SITE_BASE, otherwise www.balkaris.ch.
 */
export function hosts(): string[] {
  const named = (process.env.GA4_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (named.length) return named;
  try {
    return [new URL(process.env.SITE_BASE ?? "https://www.balkaris.ch").hostname.toLowerCase()];
  } catch {
    return ["www.balkaris.ch"];
  }
}

/**
 * The property's own time zone, which is the one its days are cut in. Google
 * says it with every report; until the first report it is the studio's.
 */
export const zone = (): string => state("ga4:zone") ?? "Europe/Zurich";

/* ---------- asking for part of the data ---------------------------------- */

/** GA4's own filter expression, exactly as the Data API takes it. Build one with `where`. */
export type Filter =
  | {
      filter: {
        fieldName: string;
        stringFilter?: { matchType: "EXACT" | "BEGINS_WITH" | "ENDS_WITH" | "CONTAINS" | "FULL_REGEXP" | "PARTIAL_REGEXP"; value: string; caseSensitive?: boolean };
        inListFilter?: { values: string[]; caseSensitive?: boolean };
        numericFilter?: { operation: "EQUAL" | "LESS_THAN" | "LESS_THAN_OR_EQUAL" | "GREATER_THAN" | "GREATER_THAN_OR_EQUAL"; value: { int64Value?: string; doubleValue?: number } };
      };
    }
  | { andGroup: { expressions: Filter[] } }
  | { orGroup: { expressions: Filter[] } }
  | { notExpression: Filter };

/** Small words for the filters a screen needs, so nobody writes Google's nesting by hand. */
export const where = {
  /** The field is exactly this. */
  is: (field: string, value: string): Filter => ({ filter: { fieldName: field, stringFilter: { matchType: "EXACT", value } } }),
  /** The field starts with this. */
  begins: (field: string, value: string): Filter => ({ filter: { fieldName: field, stringFilter: { matchType: "BEGINS_WITH", value } } }),
  /** The field contains this, in any case. */
  contains: (field: string, value: string): Filter => ({ filter: { fieldName: field, stringFilter: { matchType: "CONTAINS", value, caseSensitive: false } } }),
  /** A regular expression (RE2) matches somewhere in the field, in any case. */
  matches: (field: string, pattern: string): Filter => ({ filter: { fieldName: field, stringFilter: { matchType: "PARTIAL_REGEXP", value: pattern, caseSensitive: false } } }),
  /** The field is one of these. */
  among: (field: string, values: string[]): Filter => ({ filter: { fieldName: field, inListFilter: { values } } }),
  all: (...filters: Filter[]): Filter => (filters.length === 1 ? filters[0]! : { andGroup: { expressions: filters } }),
  any: (...filters: Filter[]): Filter => (filters.length === 1 ? filters[0]! : { orGroup: { expressions: filters } }),
  not: (filter: Filter): Filter => ({ notExpression: filter }),
};

/** One history report. Dimension and metric names are GA4's API names ("pagePath", "activeUsers"). */
export interface ReportSpec {
  dimensions?: string[];
  metrics: string[];
  /**
   * One period, or two to compare. Write real dates (YYYY-MM-DD, from
   * `rangeDates`): GA4 also takes "today" and "7daysAgo", but an answer kept
   * under those words would still be served tomorrow.
   */
  dateRanges: { startDate: string; endDate: string }[];
  dimensionFilter?: Filter;
  metricFilter?: Filter;
  /** `by` is one of the names above. Largest first with `desc`. */
  orderBys?: { by: string; desc?: boolean }[];
  /** Rows to return, for all date ranges together. 1,000 unless said. */
  limit?: number;
  /** True to read every host in the property, the old Framer site included. Almost never what a screen wants. */
  allHosts?: boolean;
}

/** One realtime report. The schema is small: unifiedScreenName, country, countryId, city, deviceCategory, eventName, minutesAgo; activeUsers, screenPageViews, eventCount, keyEvents. No address, no source. */
export interface RealtimeSpec {
  dimensions?: string[];
  metrics: string[];
  /** Minutes back from now, 0 to 29. The last 30 minutes unless said; at most two. */
  minuteRanges?: { startMinutesAgo: number; endMinutesAgo: number }[];
  dimensionFilter?: Filter;
  metricFilter?: Filter;
  orderBys?: { by: string; desc?: boolean }[];
  limit?: number;
}

/** A row as a plain object: dimensions are strings, metrics are numbers. A `date` is YYYY-MM-DD. */
export type Row = Record<string, string | number>;

/** What `report()` and `realtime()` answer: Google's rows as plain objects, one list per range asked. */
export interface Report {
  /** The rows of the first (or only) range. */
  rows: Row[];
  /** The rows of each range, in the order asked. `ranges[0]` is `rows`. */
  ranges: Row[][];
  /** How many rows matched, whatever the limit returned. */
  rowCount: number;
  /** Tokens this report cost when it was asked. */
  tokens: number;
  /** True when Google withheld rows with too few people to show. */
  thresholded?: boolean;
  /** True when Google folded rows into an "(other)" row. */
  otherRow?: boolean;
}

/** How to ask. Every read takes this as its last argument and none is required. */
export interface Ask {
  /** Milliseconds an answer counts as fresh. 15 minutes for history, 55 seconds for realtime. */
  ttl?: number;
  /**
   * History only. By default a read that was already answered today is handed
   * back at once while a newer one is fetched behind it (`refreshing`), so a
   * screen never waits on Google twice. True waits for the newer one.
   */
  wait?: boolean;
  /**
   * True when a PERSON's screen is asking: the /api/v1 handler that serves a
   * desk page passes it (or calls `touch()` itself). It keeps the live
   * panel's poller and the warm-up awake for fifteen minutes. Leave it out
   * everywhere else (a job, an attention rule, the AI operator, a check): a
   * caller that is not a person must never keep the desk awake, or ga4-live
   * polls around the clock (`LIVE_EVERY` says what a day of that costs).
   */
  screen?: boolean;
  /**
   * Named reads only: the last day of the period. By default it is
   * YESTERDAY, the last whole day, so the period and the one before it are
   * both whole and can be compared.
   *
   *   "today"      the period ends today and holds today so far. Today is
   *                incomplete and GA4 runs two to six hours behind on it, so
   *                nothing is compared: `span.complete` is false and
   *                `span.previous` null. Today's own date means the same.
   *   YYYY-MM-DD   an earlier last day. The last two days are still being
   *                processed by Google and move between two reads; a period
   *                that ends before them is settled. A date after today is
   *                ignored.
   */
  end?: string;
}

/** What every read answers. */
export interface Read<T> {
  /** What was read, or null when there is nothing to show; `error` says why. */
  data: T | null;
  /** When Google was asked, in milliseconds since the epoch. Null when it never answered. */
  at: number | null;
  /** True when a newer read failed or was held back for quota, and this is the last good answer. */
  stale?: boolean;
  /** True when this is an earlier answer from today and a newer one is on its way. */
  refreshing?: boolean;
  /** Why `data` is null or stale: Google's own message, shortened. */
  error?: string;
  /**
   * True when nothing failed and nothing is coming: the key is not here
   * (`step` says what would connect it), the parameter is not registered
   * (`step` again), or the period lies before measurement began (no `step`:
   * nothing would). `asReading` turns it into an "off" Reading.
   */
  off?: boolean;
  /** What a person would do about it, in one sentence. */
  step?: string;
  /**
   * Where it was read: "ga4" for history, "ga4-live" for realtime. Every read
   * in this file sets it, and `asReading` labels the figure by it, so a live
   * figure cannot leave here dressed as a history one.
   */
  source?: SourceId;
}

/* ---------- the meter ----------------------------------------------------- */

type Kind = "core" | "realtime";

/** The limits of a standard property, from Google's quota page. They are not in any response. */
const LIMIT = { day: 200_000, hour: 14_000 } as const;
/** Below this share of a bucket a read is spaced out four times wider. */
const SLOW = 0.3;
/** Below this share nothing is asked: what is kept is served, and says so. */
const FLOOR = 0.1;

interface Meter {
  /** Tokens left today and this hour (per project, the tighter of the two hourly limits), as Google last said. */
  day: number | null;
  hour: number | null;
  /** What the last request cost. */
  cost: number | null;
  /** When Google said so. */
  at: number;
  okAt: number;
  errAt: number;
  error: string | null;
  /** Failures in a row. Each one doubles the wait before the next attempt. */
  fails: number;
  /** Set when Google answers 429: nothing is asked before this. */
  blockedUntil: number;
}

const blank = (): Meter => ({ day: null, hour: null, cost: null, at: 0, okAt: 0, errAt: 0, error: null, fails: 0, blockedUntil: 0 });

/* Kept in the database, so a restart in the middle of a low hour does not
   forget that the hour is low. */
function loadMeter(kind: Kind): Meter {
  try {
    return { ...blank(), ...(JSON.parse(state(`ga4:meter:${kind}`) ?? "{}") as Partial<Meter>) };
  } catch {
    return blank();
  }
}

const meters: Record<Kind, Meter> = { core: loadMeter("core"), realtime: loadMeter("realtime") };
const saveMeter = (kind: Kind): void => setState(`ga4:meter:${kind}`, JSON.stringify(meters[kind]));

const sent: Record<Kind | "meta", number> = { core: 0, realtime: 0, meta: 0 };
/** Requests actually sent to Google since this process started, per bucket. A check proves a cache with it. */
export const requests = (): { core: number; realtime: number; meta: number } => ({ ...sent });

/** Daily quotas reset at midnight Pacific. A reading from before that is about yesterday's bucket. */
function pacificMidnight(now: number): number {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(now);
  const n = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return now - (((n("hour") % 24) * 60 + n("minute")) * 60 + n("second")) * 1000;
}

function pace(kind: Kind): { mode: "ok" | "slow" | "hold"; reason?: string } {
  const m = meters[kind];
  const now = Date.now();
  const name = kind === "core" ? "history" : "realtime";
  if (m.blockedUntil > now) return { mode: "hold", reason: `Google said the GA4 ${name} quota is used up; asking again after ${new Date(m.blockedUntil).toISOString().slice(11, 16)} UTC.` };

  let mode: "ok" | "slow" | "hold" = "ok";
  let reason: string | undefined;
  const weigh = (left: number | null, limit: number, per: string, still: boolean) => {
    if (left === null || !still) return;
    if (left < limit * FLOOR) {
      mode = "hold";
      reason = `The GA4 ${name} quota is nearly used: ${left.toLocaleString("en-GB")} of ${limit.toLocaleString("en-GB")} tokens left ${per}. Showing what was last read.`;
    } else if (left < limit * SLOW && mode === "ok") {
      mode = "slow";
      reason = `The GA4 ${name} quota is running low (${left.toLocaleString("en-GB")} of ${limit.toLocaleString("en-GB")} tokens left ${per}), so reads are spaced out.`;
    }
  };
  /* An hourly reading says nothing after an hour, a daily one nothing after
     the reset: a hold must end by itself or one low reading holds forever. */
  weigh(m.hour, LIMIT.hour, "this hour", now - m.at < 3_600_000);
  weigh(m.day, LIMIT.day, "today", m.at >= pacificMidnight(now));
  return reason ? { mode, reason } : { mode };
}

/** How much of the hour and the day is left in one bucket, and what the desk is doing about it. */
export interface Quota {
  /** When Google last said, in milliseconds, or null when it has not been asked. */
  at: number | null;
  dayLeft: number | null;
  dayLimit: number;
  hourLeft: number | null;
  hourLimit: number;
  /** Tokens the last request cost. */
  lastCost: number | null;
  /** `slow`: reads are spaced four times wider. `hold`: nothing is asked, kept answers are served. */
  pace: "ok" | "slow" | "hold";
  reason?: string;
}

/** The latest quota state of both buckets. History and realtime are counted separately by Google. */
export function quota(): { core: Quota; realtime: Quota } {
  const one = (kind: Kind): Quota => {
    const m = meters[kind];
    const p = pace(kind);
    return { at: m.at || null, dayLeft: m.day, dayLimit: LIMIT.day, hourLeft: m.hour, hourLimit: LIMIT.hour, lastCost: m.cost, pace: p.mode, ...(p.reason ? { reason: p.reason } : {}) };
  };
  return { core: one("core"), realtime: one("realtime") };
}

/* ---------- one request at a time ---------------------------------------- */

const NO_KEY = "The Google Analytics key file is not on this machine.";
const KEY_STEP =
  "Put the read-only service-account key (balkaris-desk-ga4.json in the secrets index) on this machine and point GA4_CREDENTIALS_FILE at it.";

/** Google's own sentence out of an error body, shortened, with anything shaped like a credential removed. */
function googleSays(text: string): string {
  let said = text;
  try {
    const j = JSON.parse(text) as { error?: { message?: string; status?: string } };
    said = j.error?.message ?? j.error?.status ?? text;
  } catch {
    /* not JSON: an HTML error page from a proxy; its first words will do */
  }
  return clean(said).slice(0, 220);
}

const clean = (s: string): string =>
  s
    .replace(/ya29\.[\w.-]+/g, "[token]")
    .replace(/Bearer\s+[\w.-]+/gi, "Bearer [token]")
    .replace(/\s+/g, " ")
    .trim();

let line: Promise<unknown> = Promise.resolve();

/**
 * The property allows ten requests at once and this box has 768 MB. One at a
 * time is plenty for a dashboard, and it makes the quota arithmetic exact:
 * each answer's "tokens left" is read before the next question is put.
 */
function inLine<T>(work: () => Promise<T>): Promise<T> {
  const next = line.then(work, work);
  line = next.catch(() => undefined);
  return next;
}

interface Raw {
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string }[];
  rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
  rowCount?: number;
  metadata?: { timeZone?: string; subjectToThresholding?: boolean; dataLossFromOtherRow?: boolean };
  propertyQuota?: {
    tokensPerDay?: { consumed?: number; remaining?: number };
    tokensPerHour?: { consumed?: number; remaining?: number };
    tokensPerProjectPerHour?: { consumed?: number; remaining?: number };
  };
}

function failed(kind: Kind, message: string): Error {
  const m = meters[kind];
  m.errAt = Date.now();
  m.error = message;
  m.fails += 1;
  saveMeter(kind);
  return new Error(message);
}

/**
 * After a failure, wait before trying again: a minute, then two, then four,
 * up to a quarter of an hour. Google allows ten server errors an hour, and a
 * screen that reloads must not spend them. Returns the failure being waited
 * out, or null when it is time to ask.
 */
function resting(kind: Kind): string | null {
  const m = meters[kind];
  if (m.fails === 0 || Date.now() - m.errAt >= Math.min(60_000 * 2 ** (m.fails - 1), 15 * 60_000)) return null;
  return m.error ?? "The last read failed.";
}

async function send(kind: Kind, body: Record<string, unknown>): Promise<Raw> {
  return inLine(async () => {
    const m = meters[kind];
    /* Asked again here, at the head of the line: eight questions queued
       behind one that timed out must not each wait twenty seconds to learn
       the same thing. */
    const rest = resting(kind);
    if (rest) throw new Error(rest);
    let res: Response;
    try {
      const t = await token(SCOPES.analytics);
      if (!t) throw new Error(NO_KEY);
      sent[kind] += 1;
      res = await fetch(`${API}/properties/${PROPERTY()}:${kind === "core" ? "runReport" : "runRealtimeReport"}`, {
        method: "POST",
        headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
        body: JSON.stringify({ ...body, returnPropertyQuota: true }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      const why = e instanceof Error ? (e.name === "TimeoutError" ? "GA4 did not answer within 20 seconds" : e.message) : String(e);
      /* A missing key is "not connected", which is not a failure of the source. */
      if (why === NO_KEY) throw new Error(NO_KEY);
      throw failed(kind, clean(why).slice(0, 220));
    }
    if (!res.ok) {
      const said = `GA4 answered ${res.status}: ${googleSays(await res.text().catch(() => ""))}`;
      /* A 400 or 404 is a question GA4 could not make sense of: a misspelt
         metric, two fields that do not go together. Google answered; the
         source is fine, and one panel's mistake must not put every other
         panel into the wait that follows a real failure. */
      if (res.status === 400 || res.status === 404) throw new Error(said);
      /* 429 is an empty bucket. Which bucket is in the message, not in a
         field, so the safe reading is the longest of the short ones: an hour. */
      if (res.status === 429) m.blockedUntil = Date.now() + 3_600_000;
      throw failed(kind, said);
    }

    let json: Raw;
    try {
      json = (await res.json()) as Raw;
    } catch (e) {
      /* A 200 whose body never arrived whole (the timeout covers the body
         too) or was not JSON (a proxy's page in front of Google). That is the
         source failing like any other: it is marked, and the questions queued
         behind this one wait instead of each trying for twenty seconds. */
      throw failed(kind, e instanceof Error && e.name === "TimeoutError" ? "GA4 did not answer within 20 seconds" : `GA4 answered ${res.status} with something that is not JSON`);
    }
    const q = json.propertyQuota;
    m.okAt = Date.now();
    m.fails = 0;
    m.error = null;
    if (q) {
      m.at = m.okAt;
      m.day = q.tokensPerDay?.remaining ?? m.day;
      /* Two hourly limits apply; the project's 14,000 is the one that binds. */
      m.hour = q.tokensPerProjectPerHour?.remaining ?? q.tokensPerHour?.remaining ?? m.hour;
      /* `consumed` is what THIS request cost, not a running total. */
      m.cost = q.tokensPerDay?.consumed ?? m.cost;
    }
    saveMeter(kind);
    const tz = json.metadata?.timeZone;
    if (tz && tz !== state("ga4:zone")) setState("ga4:zone", tz);
    return json;
  });
}

const order = (by: { by: string; desc?: boolean }, metrics: string[]) =>
  metrics.includes(by.by)
    ? { metric: { metricName: by.by }, ...(by.desc ? { desc: true } : {}) }
    : { dimension: { dimensionName: by.by }, ...(by.desc ? { desc: true } : {}) };

function historyBody(spec: ReportSpec): Record<string, unknown> {
  const host = spec.allHosts ? null : where.among("hostName", hosts());
  const filter = host && spec.dimensionFilter ? where.all(host, spec.dimensionFilter) : (host ?? spec.dimensionFilter);
  return {
    dateRanges: spec.dateRanges.map((r) => ({ startDate: r.startDate, endDate: r.endDate })),
    dimensions: (spec.dimensions ?? []).map((name) => ({ name })),
    metrics: spec.metrics.map((name) => ({ name })),
    ...(filter ? { dimensionFilter: filter } : {}),
    ...(spec.metricFilter ? { metricFilter: spec.metricFilter } : {}),
    ...(spec.orderBys?.length ? { orderBys: spec.orderBys.map((o) => order(o, spec.metrics)) } : {}),
    limit: Math.min(Math.max(1, spec.limit ?? 1000), 10_000),
  };
}

function realtimeBody(spec: RealtimeSpec): Record<string, unknown> {
  return {
    dimensions: (spec.dimensions ?? []).map((name) => ({ name })),
    metrics: spec.metrics.map((name) => ({ name })),
    ...(spec.minuteRanges?.length ? { minuteRanges: spec.minuteRanges.slice(0, 2) } : {}),
    ...(spec.dimensionFilter ? { dimensionFilter: spec.dimensionFilter } : {}),
    ...(spec.metricFilter ? { metricFilter: spec.metricFilter } : {}),
    ...(spec.orderBys?.length ? { orderBys: spec.orderBys.map((o) => order(o, spec.metrics)) } : {}),
    limit: Math.min(Math.max(1, spec.limit ?? 250), 10_000),
  };
}

/**
 * Google's columns and cells into plain objects. When two ranges were asked
 * Google adds a `dateRange` column ("date_range_0", "date_range_1"); it is
 * taken out again and the rows are sorted into one list per range.
 */
function shape(raw: Raw, ranges: number): Report {
  const dims = (raw.dimensionHeaders ?? []).map((h) => h.name);
  const mets = (raw.metricHeaders ?? []).map((h) => h.name);
  const out: Row[][] = Array.from({ length: Math.max(1, ranges) }, () => []);
  for (const r of raw.rows ?? []) {
    const row: Row = {};
    let which = 0;
    dims.forEach((name, i) => {
      const v = r.dimensionValues?.[i]?.value ?? "";
      if (name === "dateRange") which = Number(v.replace(/\D+/g, "")) || 0;
      else row[name] = name === "date" && /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : v;
    });
    mets.forEach((name, i) => {
      row[name] = Number(r.metricValues?.[i]?.value ?? 0);
    });
    (out[which] ?? out[0]!).push(row);
  }
  return {
    rows: out[0]!,
    ranges: out,
    rowCount: raw.rowCount ?? 0,
    tokens: raw.propertyQuota?.tokensPerDay?.consumed ?? 0,
    ...(raw.metadata?.subjectToThresholding ? { thresholded: true } : {}),
    ...(raw.metadata?.dataLossFromOtherRow ? { otherRow: true } : {}),
  };
}

/* ---------- somebody is looking ------------------------------------------- */

/** A desk nobody has looked at for this long stops asking Google anything live. */
const IDLE_MS = 15 * 60_000;

let touched = 0;

/**
 * Say that a person has a desk screen open. Nothing in this file says it by
 * itself: a read says it only when asked with `screen: true`. So the /api/v1
 * handler that serves a screen either passes that to its reads or calls this,
 * once per request a person makes, and nothing else ever does: a job or a
 * rule that called it would keep the live poller spending tokens all night.
 * `when` exists for the check, which has to pretend that time has passed.
 */
export function touch(when: number = Date.now()): void {
  touched = when;
}

/** True when no person's screen has asked for anything for fifteen minutes. */
export const idle = (): boolean => Date.now() - touched > IDLE_MS;

/* ---------- the two doors ------------------------------------------------- */

const HISTORY_TTL = 15 * 60_000;
const REALTIME_TTL = 55_000;
/** An earlier answer may stand in for a newer one for this long, and only for history. */
const GRACE = 12 * 3_600_000;

const keyOf = (kind: Kind, body: Record<string, unknown>): string =>
  `ga4:${kind === "core" ? "rep" : "rt"}:${createHash("sha1").update(`${PROPERTY()} ${JSON.stringify(body)}`).digest("hex").slice(0, 20)}`;

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The one path from a question to an answer, with where it was read on every answer it gives. */
async function through(kind: Kind, key: string, ranges: number, body: Record<string, unknown>, o: Ask): Promise<Read<Report>> {
  const source: SourceId = kind === "core" ? "ga4" : "ga4-live";
  return { ...(await decide(kind, key, ranges, body, o)), source };
}

/** Fresh from the cache, or held back by the meter, or asked. Decides; never throws. */
async function decide(kind: Kind, key: string, ranges: number, body: Record<string, unknown>, o: Ask): Promise<Read<Report>> {
  if (o.screen) touch();
  if (!hasKey()) return { data: null, at: null, off: true, error: NO_KEY, step: KEY_STEP };

  const p = pace(kind);
  const ttl = (o.ttl ?? (kind === "core" ? HISTORY_TTL : REALTIME_TTL)) * (p.mode === "slow" ? 4 : 1);
  const had = kept<Report>(key);
  const age = had ? Date.now() - had.at : Infinity;
  if (had && age < ttl) return { data: had.value, at: had.at };

  const last = (why: string): Read<Report> => (had ? { data: had.value, at: had.at, stale: true, error: why } : { data: null, at: null, error: why });

  if (p.mode === "hold") return last(p.reason ?? "The GA4 quota is nearly used.");

  const rest = resting(kind);
  if (rest) return last(rest);

  const ask = async (): Promise<Report> => shape(await send(kind, body), ranges);

  if (kind === "core" && had && !o.wait && age < GRACE) {
    void cached(key, ttl, ask).catch(() => undefined);
    return { data: had.value, at: had.at, refreshing: true };
  }

  try {
    const got = await cached(key, ttl, ask);
    return { data: got.value, at: got.at, ...(got.stale ? { stale: true } : {}), ...(got.error ? { error: got.error } : {}) };
  } catch (e) {
    return { data: null, at: null, error: message(e), ...(message(e) === NO_KEY ? { off: true, step: KEY_STEP } : {}) };
  }
}

/**
 * Any history report (GA4 `runReport`), cached. The door for whatever the
 * named reads below did not foresee. Narrowed to the website's host unless the
 * spec says `allHosts`.
 */
export function report(spec: ReportSpec, o: Ask = {}): Promise<Read<Report>> {
  const body = historyBody(spec);
  return through("core", keyOf("core", body), spec.dateRanges.length, body, o);
}

/**
 * Any realtime report (GA4 `runRealtimeReport`), cached for 55 seconds. Always
 * waits for the answer: "now" from this morning is not now. Realtime cannot be
 * narrowed to a host (see `LIVE_NOTE`), and costs about twenty times what a
 * history report does (measured under `LIVE_EVERY`): ask the `live()` panel
 * first, and this only for what it does not carry. Its reads carry the source
 * "ga4-live".
 */
export function realtime(spec: RealtimeSpec, o: Ask = {}): Promise<Read<Report>> {
  const body = realtimeBody(spec);
  return through("realtime", keyOf("realtime", body), spec.minuteRanges?.length ?? 1, body, o);
}

/**
 * A read as the `Reading` a screen prints: the figure with its caveat, or the
 * reason there is none. `pick` takes the part of the data the panel shows.
 * The source, and with it the caveat (`GA4_NOTE` or `LIVE_NOTE`), is the one
 * the read carries; `source` is only for a Read made elsewhere that carries
 * none, and is "ga4" when that is left out too.
 */
export function asReading<T, U = T>(read: Read<T>, pick?: (data: T) => U, source?: SourceId): Reading<U> {
  const from: SourceId = read.source ?? source ?? "ga4";
  if (read.data !== null && read.at !== null) {
    const caveat = from === "ga4-live" ? LIVE_NOTE : GA4_NOTE;
    const value = pick ? pick(read.data) : (read.data as unknown as U);
    return ok(value, from, read.at, read.stale && read.error ? `${caveat} Not refreshed: ${read.error}` : caveat);
  }
  if (read.off) return off(from, read.error ?? "Not connected.", read.step);
  return waiting(from, read.error ?? "Not read yet.");
}

/* ---------- days and periods ---------------------------------------------- */

/**
 * The ranges GA4 history answers, in whole days: "24h" is one day, "7d" seven.
 * One hour is not among them: reports run two to six hours behind.
 */
export type GaRange = Exclude<Range, "1h">;

/** A range from a query string, made safe: "1h" reads as "24h", anything unknown as "30d". */
export function gaRange(asked: string | undefined | null): GaRange {
  if (asked === "1h") return "24h";
  return asked === "24h" || asked === "7d" || asked === "30d" || asked === "90d" || asked === "1y" ? asked : "30d";
}

const DAYS: Record<GaRange, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90, "1y": 365 };
const DAY_MS = 86_400_000;

/* Noon, so that a day shifted across a clock change is still that day. */
const shift = (day: string, by: number): string => new Date(Date.parse(`${day}T12:00:00Z`) + by * DAY_MS).toISOString().slice(0, 10);

/** Today in the property's time zone, as YYYY-MM-DD. */
export const propertyToday = (): string => new Intl.DateTimeFormat("en-CA", { timeZone: zone() }).format(new Date());

/** A stretch of whole days in the property's time zone. */
export interface Period {
  /** YYYY-MM-DD, both ends included. */
  start: string;
  end: string;
  days: number;
}

/**
 * A range as two periods of equal length, in the property's time zone: the
 * one that ends on the last WHOLE day, yesterday, and the one before it.
 * Pure dates: whether the earlier period was measured is `span.previous` on
 * each read. `end` moves the last day (see `Ask.end`): "today" (or today's
 * date) ends it today, and `complete` is then false; an earlier YYYY-MM-DD
 * ends it there; anything else is ignored. `today` is always today.
 */
export function rangeDates(range: GaRange, end?: string): { range: GaRange; today: string; complete: boolean; current: Period; previous: Period } {
  const days = DAYS[range];
  const today = propertyToday();
  const last = end === "today" || end === today ? today : end && /^\d{4}-\d\d-\d\d$/.test(end) && end < today ? end : shift(today, -1);
  return {
    range,
    today,
    complete: last < today,
    current: { start: shift(last, 1 - days), end: last, days },
    previous: { start: shift(last, 1 - 2 * days), end: shift(last, -days), days },
  };
}

/** What a read covers, sent back with it so a screen can say so in words. */
export interface Span {
  range: GaRange;
  /** The period asked for, both ends included. It ends yesterday unless `Ask.end` said otherwise. */
  start: string;
  end: string;
  days: number;
  /** The first day the website has any data: "measured since". That day may have begun part-way through. */
  since: string;
  /**
   * The first day measured from its first hour: `since` itself, or the day
   * after it when measurement began part-way through `since`. Nothing is
   * compared with a day before this one.
   */
  fullFrom: string;
  /**
   * False when the period ends today, which GA4 is still counting (two to six
   * hours behind): `previous` is then null, and so is the `previous` of today
   * in a day series.
   */
  complete: boolean;
  /** True when the period starts before `fullFrom`: its figures cover `since` to `end` only, the first of those days in part. */
  partial: boolean;
  /** The period before, or null when it was not measured whole (it starts before `fullFrom`) or this period is not `complete`. */
  previous: { start: string; end: string } | null;
  /** From this day on (yesterday) GA4 may still change the figures. */
  provisionalFrom: string;
}

/** Where the website's measurement begins: the first day with data, and the first day with data from midnight. */
interface Measured {
  since: string;
  fullFrom: string;
}

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\d$/.test(v);

/**
 * Where the website's host has data from. Asked once, then remembered in
 * cc_state; while there is no data at all it is asked again every hour.
 *
 * Asked by the hour, not the day, because the first day is rarely whole: the
 * tag went live at some hour of it, and that day's figures cover the hours
 * after. One request answers both: the first hour with data, which names
 * `since`, and whether that hour was midnight, which decides `fullFrom`.
 */
async function firstDay(o: Ask): Promise<Read<Measured | null>> {
  const name = `ga4:measured:${PROPERTY()}:${hosts().join(",")}`;
  try {
    const known = JSON.parse(state(name) ?? "null") as Partial<Measured> | null;
    if (known && isDay(known.since) && isDay(known.fullFrom)) return { data: { since: known.since, fullFrom: known.fullFrom }, at: Date.now(), source: "ga4" };
  } catch {
    /* unreadable: asked again below */
  }

  /* 2015-08-14 is the earliest date GA4 accepts. One row, oldest first. */
  const r = await report(
    { dimensions: ["dateHour"], metrics: ["eventCount"], dateRanges: [{ startDate: "2015-08-14", endDate: propertyToday() }], orderBys: [{ by: "dateHour" }], limit: 1 },
    { ...o, ttl: 3_600_000, wait: true },
  );
  if (r.data === null) return { ...r, data: null };
  const hour = String(r.data.rows[0]?.dateHour ?? "");
  if (!/^\d{10}$/.test(hour)) return { data: null, at: r.at, source: "ga4" };
  const since = `${hour.slice(0, 4)}-${hour.slice(4, 6)}-${hour.slice(6, 8)}`;
  const found: Measured = { since, fullFrom: hour.slice(8) === "00" ? since : shift(since, 1) };
  setState(name, JSON.stringify(found));
  return { data: found, at: r.at, source: "ga4" };
}

/** The first day the website has any GA4 data ("measured since 21 Sep"), or null when there is none yet or GA4 cannot be asked. */
export async function measuredSince(): Promise<string | null> {
  return (await firstDay({})).data?.since ?? null;
}

/** Runs a read inside its span, or answers why there is no span to read in. */
async function within<T>(range: GaRange, o: Ask, read: (span: Span) => Promise<Read<T>>): Promise<Read<T>> {
  if (o.screen) touch();
  const first = await firstDay(o);
  if (first.data === null) {
    if (first.error || first.off) return { ...first, data: null };
    return { data: null, at: first.at, source: "ga4", error: `GA4 has recorded nothing for ${hosts().join(", ")} yet.` };
  }
  const d = rangeDates(range, o.end);
  const { since, fullFrom } = first.data;
  /* A period that ended before measurement began: asking would be an error
     from Google (a start after the end), and the honest answer is "nothing
     was measured then", which is not a row of zeros. Nothing will ever be,
     so it is "off" with no step, not "waiting". */
  if (since > d.current.end) return { data: null, at: first.at, source: "ga4", off: true, error: `GA4 measured nothing for ${hosts().join(", ")} before ${since}.` };
  return read({
    range,
    start: d.current.start,
    end: d.current.end,
    days: d.current.days,
    since,
    fullFrom,
    complete: d.complete,
    partial: fullFrom > d.current.start,
    previous: d.complete && fullFrom <= d.previous.start ? { start: d.previous.start, end: d.previous.end } : null,
    provisionalFrom: shift(d.today, -1),
  });
}

/* Asking for days before measurement began would cost tokens to be told
   nothing, so the period is cut to where the data starts. */
const now = (s: Span) => ({ startDate: s.since > s.start ? s.since : s.start, endDate: s.end });
const both = (s: Span) => [now(s), ...(s.previous ? [{ startDate: s.previous.start, endDate: s.previous.end }] : [])];
/** One stretch covering the period and, where it was measured, the one before: for day series. */
const stretch = (s: Span) => ({ startDate: s.since > shift(s.start, -s.days) ? s.since : shift(s.start, -s.days), endDate: s.end });

const num = (row: Row | undefined, name: string): number => (row && typeof row[name] === "number" ? (row[name] as number) : 0);
const str = (row: Row, name: string): string => String(row[name] ?? "");

/** Carries a report's time and state onto what was made of it. */
function derive<T>(reads: Read<Report>[], make: (reports: Report[]) => T): Read<T> {
  const bad = reads.find((r) => r.data === null);
  if (bad) return { ...bad, data: null };
  const error = reads.find((r) => r.error)?.error;
  const source = reads.find((r) => r.source)?.source;
  return {
    data: make(reads.map((r) => r.data as Report)),
    /* The oldest of them: a figure is as old as its oldest part. */
    at: Math.min(...reads.map((r) => r.at ?? 0)),
    ...(reads.some((r) => r.stale) ? { stale: true } : {}),
    ...(reads.some((r) => r.refreshing) ? { refreshing: true } : {}),
    ...(error ? { error } : {}),
    ...(source ? { source } : {}),
  };
}

/**
 * One value per day of the period, oldest first, beginning where measurement
 * does (the first day in part, as it was measured). A day GA4 has no row for
 * is a real zero. `previous` is the same position one period earlier, or null
 * where either day is not whole: the earlier one before `fullFrom`, or this
 * one being today.
 */
function dayPoints(span: Span, at: (day: string) => number): DayPoint[] {
  const out: DayPoint[] = [];
  for (let day = span.since > span.start ? span.since : span.start; day <= span.end; day = shift(day, 1)) {
    const before = shift(day, -span.days);
    const whole = before >= span.fullFrom && (span.complete || day < span.end);
    out.push({ date: day, value: at(day), previous: whole ? at(before) : null });
  }
  return out;
}

/**
 * An address as the desk writes it everywhere: no query, no fragment, no
 * trailing slash except the home page. GA4's own "(not set)" is left alone.
 */
export function normalPath(path: string): string {
  if (!path || path.startsWith("(")) return path || "(not set)";
  const bare = path.split(/[?#]/)[0]!.replace(/\/+$/, "");
  return bare === "" ? "/" : bare.startsWith("/") ? bare : `/${bare}`;
}

const slug = (label: string): string => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";

/* ---------- LinkedIn, and channels ---------------------------------------- */

/* LinkedIn is not a channel of Google's. Its visits arrive as Organic Social,
   Referral or Paid Social depending on the link, and the studio's audience
   comes from there, so it is drawn as one slice. lnkd.in is its shortener. */
const LINKEDIN = where.matches("sessionSource", "linkedin|lnkd\\.in");
const isLinkedIn = (source: string): boolean => /linkedin|lnkd\.in/i.test(source);

/** Google's default channel groups, so a slug from a URL can be turned back into the label GA4 filters by. */
const CHANNELS = [
  "Direct", "Organic Search", "Paid Search", "Organic Social", "Paid Social", "Email", "Referral", "Display", "Organic Video", "Paid Video",
  "Organic Shopping", "Paid Shopping", "Affiliates", "Audio", "SMS", "Mobile Push Notifications", "Cross-network", "Paid Other", "Unassigned",
];

/** The filter for one of our channel groups, by key ("organic-search", "linkedin") or by Google's label. */
function channelFilter(channel: string): Filter {
  if (slug(channel) === "linkedin") return LINKEDIN;
  const label = CHANNELS.find((c) => slug(c) === slug(channel)) ?? channel;
  return where.all(where.is("sessionDefaultChannelGroup", label), where.not(LINKEDIN));
}

/* ---------- named reads --------------------------------------------------- */

/** The headline counts of one period, as GA4 counts them (people once per period, not per day). */
export interface Counts {
  activeUsers: number;
  newUsers: number;
  sessions: number;
  engagedSessions: number;
  screenPageViews: number;
  /** Seconds the site was in the foreground, added up over everyone (`userEngagementDuration`). */
  engagementSeconds: number;
}

/** What `totals()` answers. */
export interface Totals {
  span: Span;
  current: Counts;
  /** Null when the period before was not measured. */
  previous: Counts | null;
}

const counts = (row: Row | undefined): Counts => ({
  activeUsers: num(row, "activeUsers"),
  newUsers: num(row, "newUsers"),
  sessions: num(row, "sessions"),
  engagedSessions: num(row, "engagedSessions"),
  screenPageViews: num(row, "screenPageViews"),
  engagementSeconds: num(row, "userEngagementDuration"),
});

/** The headline counts for the range and for the range before it. People are counted once per period, so these cannot be added up from days. */
export function totals(range: GaRange, o: Ask = {}): Promise<Read<Totals>> {
  return within(range, o, async (span) => {
    const r = await report({ metrics: ["activeUsers", "newUsers", "sessions", "engagedSessions", "screenPageViews", "userEngagementDuration"], dateRanges: both(span) }, o);
    return derive([r], ([rep]) => ({ span, current: counts(rep!.ranges[0]?.[0]), previous: span.previous ? counts(rep!.ranges[1]?.[0]) : null }));
  });
}

/** What `byDay()` answers: three day lines over the same days. */
export interface Days {
  span: Span;
  users: DayPoint[];
  sessions: DayPoint[];
  views: DayPoint[];
}

/** People, sessions and views for each day of the range, each with the same day one period earlier. One request. */
export function byDay(range: GaRange, o: Ask = {}): Promise<Read<Days>> {
  return within(range, o, async (span) => {
    const r = await report({ dimensions: ["date"], metrics: ["activeUsers", "sessions", "screenPageViews"], dateRanges: [stretch(span)], orderBys: [{ by: "date" }], limit: 800 }, o);
    return derive([r], ([rep]) => {
      const days = new Map(rep!.rows.map((row) => [str(row, "date"), row]));
      const line = (metric: string) => dayPoints(span, (day) => num(days.get(day), metric));
      return { span, users: line("activeUsers"), sessions: line("sessions"), views: line("screenPageViews") };
    });
  });
}

/** People per day with the same day one period earlier: the line on "Website traffic". */
export async function usersByDay(range: GaRange, o: Ask = {}): Promise<Read<DayPoint[]>> {
  const r = await byDay(range, o);
  return r.data ? { ...r, data: r.data.users } : { ...r, data: null };
}

/** One slice of the traffic-sources donut. */
export interface ChannelRow {
  /** "organic-search", "direct", "linkedin". */
  key: string;
  /** Google's label, or "LinkedIn". */
  label: string;
  sessions: number;
  /** People who came through this group. Somebody who came through two groups is in both, so these do not add up to the total. */
  users: number;
  previous: { sessions: number; users: number } | null;
}

/** What `channels()` answers. */
export interface Channels {
  span: Span;
  /** Largest first. The sessions add up to `sessions`. */
  rows: ChannelRow[];
  sessions: number;
  /** `CHANNEL_NOTE`: say it where this is drawn. */
  note: string;
}

/**
 * Sessions and people by channel, with LinkedIn as a group of its own.
 *
 * Two requests so that both figures are exact: every channel WITHOUT its
 * LinkedIn sessions, and LinkedIn by itself. Adding a people column up from
 * channel-and-source rows would count a visitor once per source.
 */
export function channels(range: GaRange, o: Ask = {}): Promise<Read<Channels>> {
  return within(range, o, async (span) => {
    const rest = await report(
      { dimensions: ["sessionDefaultChannelGroup"], metrics: ["sessions", "activeUsers"], dateRanges: both(span), dimensionFilter: where.not(LINKEDIN), limit: 200 },
      o,
    );
    const linkedin = await report({ metrics: ["sessions", "activeUsers"], dateRanges: both(span), dimensionFilter: LINKEDIN }, o);
    return derive([rest, linkedin], ([a, b]) => {
      const before = new Map((a!.ranges[1] ?? []).map((row) => [str(row, "sessionDefaultChannelGroup"), row]));
      const labels = new Set([...a!.rows.map((row) => str(row, "sessionDefaultChannelGroup")), ...before.keys()]);
      const current = new Map(a!.rows.map((row) => [str(row, "sessionDefaultChannelGroup"), row]));
      const rows: ChannelRow[] = [...labels].map((label) => ({
        key: slug(label),
        label,
        sessions: num(current.get(label), "sessions"),
        users: num(current.get(label), "activeUsers"),
        previous: span.previous ? { sessions: num(before.get(label), "sessions"), users: num(before.get(label), "activeUsers") } : null,
      }));
      const li = b!.ranges[0]?.[0];
      const liBefore = b!.ranges[1]?.[0];
      /* LinkedIn is listed once it has ever sent a session in either period;
         before that it would be a row of our own invention. */
      if (num(li, "sessions") > 0 || num(liBefore, "sessions") > 0) {
        rows.push({
          key: "linkedin",
          label: "LinkedIn",
          sessions: num(li, "sessions"),
          users: num(li, "activeUsers"),
          previous: span.previous ? { sessions: num(liBefore, "sessions"), users: num(liBefore, "activeUsers") } : null,
        });
      }
      rows.sort((x, y) => y.sessions - x.sessions);
      return { span, rows, sessions: rows.reduce((sum, row) => sum + row.sessions, 0), note: CHANNEL_NOTE };
    });
  });
}

/** One source and medium pair, as GA4 names them ("google", "organic"). */
export interface SourceRow {
  source: string;
  medium: string;
  sessions: number;
  engagedSessions: number;
  users: number;
  previous: { sessions: number; users: number } | null;
}

/** Sessions and people by source and medium ("google / organic"), largest first, at most 250 pairs. */
export function sourcesMediums(range: GaRange, o: Ask = {}): Promise<Read<{ span: Span; rows: SourceRow[] }>> {
  return within(range, o, async (span) => {
    const r = await report(
      { dimensions: ["sessionSource", "sessionMedium"], metrics: ["sessions", "engagedSessions", "activeUsers"], dateRanges: both(span), orderBys: [{ by: "sessions", desc: true }], limit: 1000 },
      o,
    );
    return derive([r], ([rep]) => {
      const pair = (row: Row) => `${str(row, "sessionSource")} / ${str(row, "sessionMedium")}`;
      const before = new Map((rep!.ranges[1] ?? []).map((row) => [pair(row), row]));
      const rows = rep!.rows.slice(0, 250).map((row) => ({
        source: str(row, "sessionSource"),
        medium: str(row, "sessionMedium"),
        sessions: num(row, "sessions"),
        engagedSessions: num(row, "engagedSessions"),
        users: num(row, "activeUsers"),
        previous: span.previous ? { sessions: num(before.get(pair(row)), "sessions"), users: num(before.get(pair(row)), "activeUsers") } : null,
      }));
      return { span, rows };
    });
  });
}

/**
 * Rows of both ranges brought together under one normalised address. Two
 * spellings of one address ("/x" and "/x/") become one row with their counts
 * added; for people that is an upper bound, since one person may have seen
 * both. The website redirects the second spelling, so it should not arise.
 */
function byPath(rep: Report, dimension: string, metrics: string[]): Map<string, { now: Record<string, number>; before: Record<string, number> }> {
  const out = new Map<string, { now: Record<string, number>; before: Record<string, number> }>();
  rep.ranges.slice(0, 2).forEach((rows, which) => {
    for (const row of rows) {
      const path = normalPath(str(row, dimension));
      const slot = out.get(path) ?? { now: {}, before: {} };
      const into = which === 0 ? slot.now : slot.before;
      for (const m of metrics) into[m] = (into[m] ?? 0) + num(row, m);
      out.set(path, slot);
    }
  });
  return out;
}

/** One address in `pages()`. */
export interface PageRow {
  /** Normalised: see `normalPath`. */
  path: string;
  users: number;
  views: number;
  engagementSeconds: number;
  previous: { users: number; views: number; engagementSeconds: number } | null;
}

/** People, views and time for every address that was seen in the range, most people first. */
export function pages(range: GaRange, o: Ask = {}): Promise<Read<{ span: Span; rows: PageRow[] }>> {
  return within(range, o, async (span) => {
    const r = await report(
      { dimensions: ["pagePath"], metrics: ["activeUsers", "screenPageViews", "userEngagementDuration"], dateRanges: both(span), orderBys: [{ by: "screenPageViews", desc: true }], limit: 5000 },
      o,
    );
    return derive([r], ([rep]) => {
      const rows: PageRow[] = [];
      for (const [path, v] of byPath(rep!, "pagePath", ["activeUsers", "screenPageViews", "userEngagementDuration"])) {
        /* An address only the earlier period saw is not a row of this one. */
        if (!Object.keys(v.now).length) continue;
        rows.push({
          path,
          users: v.now.activeUsers ?? 0,
          views: v.now.screenPageViews ?? 0,
          engagementSeconds: v.now.userEngagementDuration ?? 0,
          previous: span.previous ? { users: v.before.activeUsers ?? 0, views: v.before.screenPageViews ?? 0, engagementSeconds: v.before.userEngagementDuration ?? 0 } : null,
        });
      }
      rows.sort((x, y) => y.users - x.users || y.views - x.views);
      return { span, rows };
    });
  });
}

/** One address in `landingPages()`: sessions that began there. */
export interface LandingRow {
  /** The first address of the session, normalised. "(not set)" is a session with no page view. */
  path: string;
  sessions: number;
  engagedSessions: number;
  users: number;
  previous: { sessions: number; users: number } | null;
}

/**
 * Where sessions began, most sessions first. `channel` narrows it to one of
 * our channel groups, by key ("organic-search", "linkedin") or by Google's
 * label. On settled days the rows add up to `totals()` sessions exactly; on
 * the last day or two GA4 can still hold a session under two landing pages,
 * so they may add up to a session or two more until it has processed them
 * (seen 2 October 2026).
 */
export function landingPages(range: GaRange, channel?: string, o: Ask = {}): Promise<Read<{ span: Span; channel: string | null; rows: LandingRow[] }>> {
  return within(range, o, async (span) => {
    const r = await report(
      {
        dimensions: ["landingPage"],
        metrics: ["sessions", "engagedSessions", "activeUsers"],
        dateRanges: both(span),
        ...(channel ? { dimensionFilter: channelFilter(channel) } : {}),
        orderBys: [{ by: "sessions", desc: true }],
        limit: 5000,
      },
      o,
    );
    return derive([r], ([rep]) => {
      const rows: LandingRow[] = [];
      for (const [path, v] of byPath(rep!, "landingPage", ["sessions", "engagedSessions", "activeUsers"])) {
        if (!Object.keys(v.now).length) continue;
        rows.push({
          path,
          sessions: v.now.sessions ?? 0,
          engagedSessions: v.now.engagedSessions ?? 0,
          users: v.now.activeUsers ?? 0,
          previous: span.previous ? { sessions: v.before.sessions ?? 0, users: v.before.activeUsers ?? 0 } : null,
        });
      }
      rows.sort((x, y) => y.sessions - x.sessions);
      return { span, channel: channel ? slug(channel) : null, rows };
    });
  });
}

/** One country in `countries()`. */
export interface CountryRow {
  /** ISO 3166-1 alpha-2 ("CH"), or null when GA4 could not place the visitor. */
  code: string | null;
  name: string;
  users: number;
  sessions: number;
  previous: { users: number; sessions: number } | null;
}

/** People and sessions by country, most people first. */
export function countries(range: GaRange, o: Ask = {}): Promise<Read<{ span: Span; rows: CountryRow[] }>> {
  return within(range, o, async (span) => {
    const r = await report({ dimensions: ["countryId", "country"], metrics: ["activeUsers", "sessions"], dateRanges: both(span), orderBys: [{ by: "activeUsers", desc: true }], limit: 600 }, o);
    return derive([r], ([rep]) => {
      const before = new Map((rep!.ranges[1] ?? []).map((row) => [str(row, "countryId"), row]));
      const rows = rep!.rows.map((row) => {
        const id = str(row, "countryId");
        return {
          code: /^[A-Z]{2}$/.test(id) ? id : null,
          name: str(row, "country"),
          users: num(row, "activeUsers"),
          sessions: num(row, "sessions"),
          previous: span.previous ? { users: num(before.get(id), "activeUsers"), sessions: num(before.get(id), "sessions") } : null,
        };
      });
      return { span, rows };
    });
  });
}

/** One kind of device in `devices()`. */
export interface DeviceRow {
  /** "desktop", "mobile", "tablet", "smart tv". */
  key: string;
  users: number;
  sessions: number;
  previous: { users: number; sessions: number } | null;
}

/** People and sessions by kind of device, most people first. */
export function devices(range: GaRange, o: Ask = {}): Promise<Read<{ span: Span; rows: DeviceRow[] }>> {
  return within(range, o, async (span) => {
    const r = await report({ dimensions: ["deviceCategory"], metrics: ["activeUsers", "sessions"], dateRanges: both(span), orderBys: [{ by: "activeUsers", desc: true }], limit: 20 }, o);
    return derive([r], ([rep]) => {
      const before = new Map((rep!.ranges[1] ?? []).map((row) => [str(row, "deviceCategory"), row]));
      const rows = rep!.rows.map((row) => {
        const key = str(row, "deviceCategory");
        return {
          key,
          users: num(row, "activeUsers"),
          sessions: num(row, "sessions"),
          previous: span.previous ? { users: num(before.get(key), "activeUsers"), sessions: num(before.get(key), "sessions") } : null,
        };
      });
      return { span, rows };
    });
  });
}

/* ---------- events -------------------------------------------------------- */

/**
 * The events the website itself sends, read from its source on 2 October 2026
 * (lib/track.ts and its callers). Everything else in `events()` is GA4's own
 * (page_view, session_start, first_visit, user_engagement, scroll, click,
 * form_start, form_submit, …).
 *
 * `method` is a dimension GA4 has built in, so it can be read today. `intent`
 * and `from` are parameters of ours: the Data API cannot see them until each
 * is registered as an event-scoped custom dimension in GA4 Admin, and then
 * only from that day on. `eventByParam` says so instead of answering empty.
 */
export const SITE_EVENTS = {
  /** An enquiry was sent (components/forms/EnquiryForm.tsx, components/search/Ask.tsx, components/blocks/avp-dock.tsx). `intent` "talk" comes only from the AI guide. */
  generate_lead: { what: "Enquiry sent", params: { method: ["contact_form", "ai_guide", "avp_dock"], intent: ["quote", "meeting", "talk"] } },
  /** A meeting time was booked, from the same three places. */
  book_meeting: { what: "Meeting booked", params: { method: ["contact_form", "ai_guide", "avp_dock"] } },
  /** A booked meeting was cancelled by the visitor (EnquiryForm.tsx). */
  cancel_meeting: { what: "Meeting cancelled", params: { method: ["contact_form"] } },
  /** The enquiry sheet of a marketing page opened (components/blocks/invite.tsx). `method` is the sheet's id; `from` is "cta" when a button raised it and absent when the timer did. */
  invite_shown: { what: "Enquiry sheet shown", params: { method: "the sheet's id", from: ["cta"] } },
  /** The "ask an assistant about us" block was used (components/blocks/cml-ask.tsx). `method` is "copy" or the assistant's id. */
  commercial_ask: { what: "Asked an assistant", params: { method: "copy, or the assistant's id" } },
} as const;

/** The name of one of the events the website itself sends. */
export type SiteEvent = keyof typeof SITE_EVENTS;

const SITE_EVENT_NAMES = Object.keys(SITE_EVENTS) as SiteEvent[];

/** One event name in `events()`. */
export interface EventRow {
  name: string;
  count: number;
  /** People who sent it at least once. */
  users: number;
  /** True when it is marked as a key event in GA4 Admin. */
  key: boolean;
  /** True for the five the website sends itself. */
  ours: boolean;
  previous: { count: number; users: number } | null;
}

/** What `events()` answers. */
export interface Events {
  span: Span;
  /** Every event GA4 recorded in the range, most frequent first. One of ours that never fired is absent: zero, not unknown. */
  rows: EventRow[];
  /** A count per day for each of the website's own events, zeros included. */
  byDay: Record<SiteEvent, DayPoint[]>;
}

/** How often each event happened, and day by day for the five the website sends. Two requests. */
export function events(range: GaRange, o: Ask = {}): Promise<Read<Events>> {
  return within(range, o, async (span) => {
    const all = await report({ dimensions: ["eventName", "isKeyEvent"], metrics: ["eventCount", "activeUsers"], dateRanges: both(span), orderBys: [{ by: "eventCount", desc: true }], limit: 1000 }, o);
    const daily = await report(
      { dimensions: ["date", "eventName"], metrics: ["eventCount"], dateRanges: [stretch(span)], dimensionFilter: where.among("eventName", SITE_EVENT_NAMES), limit: 5000 },
      o,
    );
    return derive([all, daily], ([a, b]) => {
      /* An event marked as key halfway through a period comes back as two
         rows, one for each answer to "is it key". They are one event. */
      const fold = (rows: Row[]) => {
        const m = new Map<string, { count: number; users: number; key: boolean }>();
        for (const row of rows) {
          const name = str(row, "eventName");
          const had = m.get(name) ?? { count: 0, users: 0, key: false };
          m.set(name, { count: had.count + num(row, "eventCount"), users: Math.max(had.users, num(row, "activeUsers")), key: had.key || str(row, "isKeyEvent") === "true" });
        }
        return m;
      };
      const current = fold(a!.rows);
      const before = fold(a!.ranges[1] ?? []);
      const rows: EventRow[] = [...current].map(([name, v]) => ({
        name,
        count: v.count,
        users: v.users,
        key: v.key,
        ours: name in SITE_EVENTS,
        previous: span.previous ? { count: before.get(name)?.count ?? 0, users: before.get(name)?.users ?? 0 } : null,
      }));
      rows.sort((x, y) => y.count - x.count);

      const cell = new Map(b!.rows.map((row) => [`${str(row, "eventName")} ${str(row, "date")}`, num(row, "eventCount")]));
      const byDay = Object.fromEntries(SITE_EVENT_NAMES.map((name) => [name, dayPoints(span, (day) => cell.get(`${name} ${day}`) ?? 0)])) as Record<SiteEvent, DayPoint[]>;
      return { span, rows, byDay };
    });
  });
}

/** One address in `eventByPage()`. */
export interface EventPageRow {
  path: string;
  count: number;
  users: number;
  previous: { count: number; users: number } | null;
}

/** On which addresses an event happened ("generate_lead"), most often first. */
export function eventByPage(eventName: string, range: GaRange, o: Ask = {}): Promise<Read<{ span: Span; event: string; rows: EventPageRow[] }>> {
  return within(range, o, async (span) => {
    const r = await report(
      { dimensions: ["pagePath"], metrics: ["eventCount", "activeUsers"], dateRanges: both(span), dimensionFilter: where.is("eventName", eventName), orderBys: [{ by: "eventCount", desc: true }], limit: 5000 },
      o,
    );
    return derive([r], ([rep]) => {
      const rows: EventPageRow[] = [];
      for (const [path, v] of byPath(rep!, "pagePath", ["eventCount", "activeUsers"])) {
        if (!Object.keys(v.now).length) continue;
        rows.push({ path, count: v.now.eventCount ?? 0, users: v.now.activeUsers ?? 0, previous: span.previous ? { count: v.before.eventCount ?? 0, users: v.before.activeUsers ?? 0 } : null });
      }
      rows.sort((x, y) => y.count - x.count);
      return { span, event: eventName, rows };
    });
  });
}

/** One of our channel groups in `eventByChannel()`. */
export interface EventChannelRow {
  key: string;
  label: string;
  count: number;
  previous: { count: number } | null;
}

/**
 * Through which channel the sessions came in which an event happened, with
 * LinkedIn as its own group. Counts of events add up, so one request by
 * channel and source is exact here.
 */
export function eventByChannel(eventName: string, range: GaRange, o: Ask = {}): Promise<Read<{ span: Span; event: string; rows: EventChannelRow[]; note: string }>> {
  return within(range, o, async (span) => {
    const r = await report(
      { dimensions: ["sessionDefaultChannelGroup", "sessionSource"], metrics: ["eventCount"], dateRanges: both(span), dimensionFilter: where.is("eventName", eventName), limit: 5000 },
      o,
    );
    return derive([r], ([rep]) => {
      const fold = (rows: Row[]) => {
        const m = new Map<string, number>();
        for (const row of rows) {
          const label = isLinkedIn(str(row, "sessionSource")) ? "LinkedIn" : str(row, "sessionDefaultChannelGroup");
          m.set(label, (m.get(label) ?? 0) + num(row, "eventCount"));
        }
        return m;
      };
      const current = fold(rep!.rows);
      const before = fold(rep!.ranges[1] ?? []);
      const rows = [...current].map(([label, count]) => ({ key: slug(label), label, count, previous: span.previous ? { count: before.get(label) ?? 0 } : null }));
      rows.sort((x, y) => y.count - x.count);
      return { span, event: eventName, rows, note: CHANNEL_NOTE };
    });
  });
}

/**
 * Which dimensions this property can report on: Google's own, plus whatever
 * was registered as a custom definition. Costs no tokens; kept for six hours.
 */
async function dimensionNames(o: Ask): Promise<Read<string[]>> {
  if (o.screen) touch();
  if (!hasKey()) return { data: null, at: null, off: true, error: NO_KEY, step: KEY_STEP, source: "ga4" };
  try {
    const got = await cached<string[]>(`ga4:dims:${PROPERTY()}`, 6 * 3_600_000, () =>
      inLine(async () => {
        const t = await token(SCOPES.analytics);
        if (!t) throw new Error(NO_KEY);
        sent.meta += 1;
        const res = await fetch(`${API}/properties/${PROPERTY()}/metadata`, { headers: { authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`GA4 answered ${res.status}: ${googleSays(await res.text().catch(() => ""))}`);
        const json = (await res.json()) as { dimensions?: { apiName?: string }[] };
        return (json.dimensions ?? []).map((d) => d.apiName ?? "").filter(Boolean);
      }),
    );
    return { data: got.value, at: got.at, source: "ga4", ...(got.stale ? { stale: true } : {}), ...(got.error ? { error: got.error } : {}) };
  } catch (e) {
    return { data: null, at: null, source: "ga4", error: clean(message(e)).slice(0, 220) };
  }
}

/** The Data API's name for an event parameter. `method` is built in; anything else must be a registered custom dimension. */
const paramDimension = (param: string): string => (param === "method" ? "method" : `customEvent:${param}`);

const registerStep = (param: string): string =>
  `In GA4 Admin, under Data display > Custom definitions, create an event-scoped custom dimension for the event parameter "${param}". Figures appear a day or two later and do not reach back before that.`;

/**
 * The parameters the website sends with its events, sorted into those GA4 can
 * report on today and those that still need registering (the owner's step:
 * the desk's account can only read).
 */
export async function eventParams(o: Ask = {}): Promise<Read<{ readable: string[]; unregistered: { param: string; step: string }[] }>> {
  const names = await dimensionNames(o);
  if (names.data === null) return { ...names, data: null };
  const sentParams = [...new Set(Object.values(SITE_EVENTS).flatMap((e) => Object.keys(e.params)))];
  const has = new Set(names.data);
  return {
    ...names,
    data: {
      readable: sentParams.filter((p) => has.has(paramDimension(p))),
      unregistered: sentParams.filter((p) => !has.has(paramDimension(p))).map((param) => ({ param, step: registerStep(param) })),
    },
  };
}

/** One value of the parameter in `eventByParam()`. */
export interface EventParamRow {
  /** The parameter's value. "(not set)" is GA4's word for an event sent without it. */
  value: string;
  count: number;
  previous: { count: number } | null;
}

/**
 * An event split by one of its parameters: `eventByParam("generate_lead",
 * "method", "30d")` is enquiries by the form they came from. A parameter GA4
 * cannot report on answers `off` with the step that registers it, never an
 * empty list.
 */
export async function eventByParam(eventName: string, param: string, range: GaRange, o: Ask = {}): Promise<Read<{ span: Span; event: string; param: string; rows: EventParamRow[] }>> {
  const dimension = paramDimension(param);
  const names = await dimensionNames(o);
  if (names.data === null) return { ...names, data: null };
  if (!names.data.includes(dimension)) {
    return { data: null, at: names.at, source: "ga4", off: true, error: `GA4 cannot report on the parameter "${param}": it is not registered as a custom dimension.`, step: registerStep(param) };
  }
  return within(range, o, async (span) => {
    const r = await report(
      { dimensions: [dimension], metrics: ["eventCount"], dateRanges: both(span), dimensionFilter: where.is("eventName", eventName), orderBys: [{ by: "eventCount", desc: true }], limit: 500 },
      o,
    );
    return derive([r], ([rep]) => {
      const before = new Map((rep!.ranges[1] ?? []).map((row) => [str(row, dimension), num(row, "eventCount")]));
      const rows = rep!.rows.map((row) => ({ value: str(row, dimension), count: num(row, "eventCount"), previous: span.previous ? { count: before.get(str(row, dimension)) ?? 0 } : null }));
      return { span, event: eventName, param, rows };
    });
  });
}

/* ---------- the journal ---------------------------------------------------- */

/* An article is /insights/<slug>: exactly one step below the hub. The hub
   (/insights) and the topic lists (/insights/topic/<name>) are lists of
   articles, and counting them as article traffic would count the menu as the
   meal. The filter says so to Google; `isArticle` says it again to the rows,
   once their addresses are normalised. */
const ARTICLES = "/insights/";
const isArticle = (path: string): boolean => /^\/insights\/[^/]+$/.test(path) && path !== "/insights/topic";
const articlesOn = (field: "pagePath" | "landingPage"): Filter =>
  where.all(where.matches(field, "^/insights/[^/]+/?$"), where.not(where.is(field, "/insights/topic")));

/** Article traffic over a whole period. Every figure is exact: none is a sum of days. */
export interface InsightCounts {
  /** Sessions that included an article. A session has one channel, so organic + direct + other = all. */
  sessions: { all: number; organic: number; direct: number; other: number };
  /** People who read an article. Somebody who came once from Google and once directly is in both channels, so these do NOT add up to `all`. */
  users: { all: number; organic: number; direct: number };
}

/** What `insightsByDay()` answers: the "Article traffic" line and its headline. */
export interface InsightDays {
  span: Span;
  /**
   * Sessions that included an article, per day. A session has one channel, so
   * organic + direct + other = all exactly. A session that crosses midnight is
   * in both days, so a period's total is `period`, never a sum of these.
   */
  sessions: { organic: DayPoint[]; direct: DayPoint[]; other: DayPoint[]; all: DayPoint[] };
  /** People who read an article, per day, for the two channels where the count is exact. */
  users: { organic: DayPoint[]; direct: DayPoint[] };
  /** The headline beside the line ("N visits"): the period, and the one before it or null when it was not measured whole. */
  period: { current: InsightCounts; previous: InsightCounts | null };
}

/**
 * Article traffic by day, split into organic search, direct and everything
 * else, with the period's own totals. Three requests: the days; the period by
 * channel, which gives sessions exactly and people per channel; and the
 * period undivided, which gives the people who read any article (they cannot
 * be added up from channels).
 */
export function insightsByDay(range: GaRange, o: Ask = {}): Promise<Read<InsightDays>> {
  return within(range, o, async (span) => {
    const r = await report(
      { dimensions: ["date", "sessionDefaultChannelGroup"], metrics: ["sessions", "activeUsers"], dateRanges: [stretch(span)], dimensionFilter: articlesOn("pagePath"), limit: 10_000 },
      o,
    );
    const byChannel = await report(
      { dimensions: ["sessionDefaultChannelGroup"], metrics: ["sessions", "activeUsers"], dateRanges: both(span), dimensionFilter: articlesOn("pagePath"), limit: 200 },
      o,
    );
    const whole = await report({ metrics: ["activeUsers"], dateRanges: both(span), dimensionFilter: articlesOn("pagePath") }, o);
    return derive([r, byChannel, whole], ([rep, ch, all]) => {
      const period = (which: number): InsightCounts => {
        const rows = ch!.ranges[which] ?? [];
        const at = (label: string) => rows.find((row) => str(row, "sessionDefaultChannelGroup") === label);
        const sessions = rows.reduce((n, row) => n + num(row, "sessions"), 0);
        const organic = num(at("Organic Search"), "sessions");
        const direct = num(at("Direct"), "sessions");
        return {
          sessions: { all: sessions, organic, direct, other: sessions - organic - direct },
          users: { all: num(all!.ranges[which]?.[0], "activeUsers"), organic: num(at("Organic Search"), "activeUsers"), direct: num(at("Direct"), "activeUsers") },
        };
      };
      const cell = new Map<string, number>();
      for (const row of rep!.rows) {
        const channel = str(row, "sessionDefaultChannelGroup");
        const group = channel === "Organic Search" ? "organic" : channel === "Direct" ? "direct" : "other";
        const day = str(row, "date");
        for (const [metric, short] of [["sessions", "s"], ["activeUsers", "u"]] as const) {
          cell.set(`${short} ${group} ${day}`, (cell.get(`${short} ${group} ${day}`) ?? 0) + num(row, metric));
          if (short === "s") cell.set(`s all ${day}`, (cell.get(`s all ${day}`) ?? 0) + num(row, metric));
        }
      }
      const line = (what: string) => dayPoints(span, (day) => cell.get(`${what} ${day}`) ?? 0);
      return {
        span,
        sessions: { organic: line("s organic"), direct: line("s direct"), other: line("s other"), all: line("s all") },
        users: { organic: line("u organic"), direct: line("u direct") },
        period: { current: period(0), previous: span.previous ? period(1) : null },
      };
    });
  });
}

/** One article in `articleStats()`. */
export interface ArticleRow {
  slug: string;
  /** /insights/<slug> */
  path: string;
  views: number;
  users: number;
  engagementSeconds: number;
  /** Sessions that began on this article. */
  entrances: number;
  /** Those entrances by our channel groups (LinkedIn its own), largest first. */
  byChannel: Share[];
  previous: { views: number; users: number; entrances: number } | null;
}

/** What `articleStats()` answers. */
export interface Articles {
  span: Span;
  /** Every article that was seen or entered on in the range, most views first. */
  rows: ArticleRow[];
  /** Sessions that began on any article, and those of them from organic search. */
  entrances: { all: number; organic: number; previous: { all: number; organic: number } | null };
}

/** Each article's views, readers, time and where its entrances came from. Two requests. */
export function articleStats(range: GaRange, o: Ask = {}): Promise<Read<Articles>> {
  return within(range, o, async (span) => {
    const seen = await report(
      { dimensions: ["pagePath"], metrics: ["screenPageViews", "activeUsers", "userEngagementDuration"], dateRanges: both(span), dimensionFilter: articlesOn("pagePath"), limit: 5000 },
      o,
    );
    const entered = await report(
      { dimensions: ["landingPage", "sessionDefaultChannelGroup", "sessionSource"], metrics: ["sessions"], dateRanges: both(span), dimensionFilter: articlesOn("landingPage"), limit: 10_000 },
      o,
    );
    return derive([seen, entered], ([a, b]) => {
      const views = byPath(a!, "pagePath", ["screenPageViews", "activeUsers", "userEngagementDuration"]);

      const doors = new Map<string, { now: Map<string, number>; before: number }>();
      const sum = { all: 0, organic: 0, beforeAll: 0, beforeOrganic: 0 };
      b!.ranges.slice(0, 2).forEach((rows, which) => {
        for (const row of rows) {
          const path = normalPath(str(row, "landingPage"));
          if (!isArticle(path)) continue;
          const label = isLinkedIn(str(row, "sessionSource")) ? "LinkedIn" : str(row, "sessionDefaultChannelGroup");
          const n = num(row, "sessions");
          const slot = doors.get(path) ?? { now: new Map<string, number>(), before: 0 };
          if (which === 0) {
            slot.now.set(label, (slot.now.get(label) ?? 0) + n);
            sum.all += n;
            if (label === "Organic Search") sum.organic += n;
          } else {
            slot.before += n;
            sum.beforeAll += n;
            if (label === "Organic Search") sum.beforeOrganic += n;
          }
          doors.set(path, slot);
        }
      });

      const rows: ArticleRow[] = [];
      for (const path of new Set([...views.keys(), ...doors.keys()])) {
        const v = views.get(path);
        const d = doors.get(path);
        if (!isArticle(path)) continue;
        if (!(v && Object.keys(v.now).length) && !d?.now.size) continue;
        const name = path.slice(ARTICLES.length);
        const byChannel = [...(d?.now ?? [])].map(([label, value]) => ({ key: slug(label), label, value })).sort((x, y) => y.value - x.value);
        rows.push({
          slug: name,
          path,
          views: v?.now.screenPageViews ?? 0,
          users: v?.now.activeUsers ?? 0,
          engagementSeconds: v?.now.userEngagementDuration ?? 0,
          entrances: byChannel.reduce((s, c) => s + c.value, 0),
          byChannel,
          previous: span.previous ? { views: v?.before.screenPageViews ?? 0, users: v?.before.activeUsers ?? 0, entrances: d?.before ?? 0 } : null,
        });
      }
      rows.sort((x, y) => y.views - x.views);
      return {
        span,
        rows,
        entrances: { all: sum.all, organic: sum.organic, previous: span.previous ? { all: sum.beforeAll, organic: sum.beforeOrganic } : null },
      };
    });
  });
}

/* ---------- the live panel ------------------------------------------------- */

/**
 * Seconds between two reads of the live panel, and the one place in this file
 * where the cost of realtime is written down.
 *
 * MEASURED on this property on 2 October 2026, over six runs of the check,
 * with nobody or almost nobody in the window: an undivided realtime count
 * costs 19 to 21 tokens, and one cycle of the panel (the three reports below)
 * 111 to 121. That is far above the "10 or fewer" Google's page suggests, and
 * Google says the cost grows with the rows a report returns, so a busier
 * window costs more. At 60 seconds a watched day would be 160,000 to 175,000
 * tokens of the realtime bucket's 200,000, which every copy of the desk that
 * holds the key shares: a tab left open overnight, or the workstation copy
 * running beside the box, would empty it. At 120 seconds it is 80,000 to
 * 88,000 a day and about 3,600 an hour (of 14,000), which leaves room for the
 * cost to grow with traffic. So: two minutes. For a count of the last thirty
 * minutes that is fresh enough.
 */
export const LIVE_EVERY = 120;

/* Three reports, because people cannot be added up across pages or minutes:
   somebody who read two pages is in both rows. Country and device share one
   report: a visitor is one browser on one device in one country, so those
   cells do add up, to each country, to each device and to everybody. */
const LIVE_SCREENS: RealtimeSpec = { dimensions: ["unifiedScreenName"], metrics: ["activeUsers", "screenPageViews"], orderBys: [{ by: "activeUsers", desc: true }], limit: 50 };
const LIVE_PLACES: RealtimeSpec = { dimensions: ["countryId", "country", "deviceCategory"], metrics: ["activeUsers"], limit: 500 };
const LIVE_MINUTES: RealtimeSpec = { dimensions: ["minutesAgo"], metrics: ["activeUsers"], limit: 30 };

/**
 * What `live()` answers: people active in the last 30 minutes, four ways, on
 * EVERY site that sends to the GA4 property, not www.balkaris.ch alone
 * (realtime has no host name: see `LIVE_NOTE`, which says so on screen).
 */
export interface Live {
  /** People active in the last 30 minutes, on every site in the property. */
  total: number;
  /** By page TITLE, most people first: realtime has no address. Match titles to addresses with the crawl's page table. */
  screens: { title: string; users: number; views: number }[];
  countries: { code: string | null; name: string; users: number }[];
  devices: { key: string; users: number }[];
  /** People active in each of the last 30 minutes, oldest first: `minutesAgo` 29 down to 0. A minute without a row is a real zero. */
  minutes: { minutesAgo: number; users: number }[];
  /** Realtime tokens this read cost. */
  tokens: number;
}

async function readLive(o: Ask): Promise<Read<Live>> {
  const screens = await realtime(LIVE_SCREENS, o);
  const places = await realtime(LIVE_PLACES, o);
  const minutes = await realtime(LIVE_MINUTES, o);
  return derive([screens, places, minutes], ([s, p, m]) => {
    const byCountry = new Map<string, { code: string | null; name: string; users: number }>();
    const byDevice = new Map<string, number>();
    let total = 0;
    for (const row of p!.rows) {
      const id = str(row, "countryId");
      const n = num(row, "activeUsers");
      const c = byCountry.get(id) ?? { code: /^[A-Z]{2}$/.test(id) ? id : null, name: str(row, "country"), users: 0 };
      c.users += n;
      byCountry.set(id, c);
      byDevice.set(str(row, "deviceCategory"), (byDevice.get(str(row, "deviceCategory")) ?? 0) + n);
      total += n;
    }
    const perMinute = new Map(m!.rows.map((row) => [Number(str(row, "minutesAgo")), num(row, "activeUsers")]));
    return {
      total,
      screens: s!.rows.map((row) => ({ title: str(row, "unifiedScreenName"), users: num(row, "activeUsers"), views: num(row, "screenPageViews") })),
      countries: [...byCountry.values()].sort((x, y) => y.users - x.users),
      devices: [...byDevice].map(([key, users]) => ({ key, users })).sort((x, y) => y.users - x.users),
      minutes: Array.from({ length: 30 }, (_, i) => ({ minutesAgo: 29 - i, users: perMinute.get(29 - i) ?? 0 })),
      tokens: s!.tokens + p!.tokens + m!.tokens,
    };
  });
}

/**
 * Who is active now, with the age of the answer in seconds. Its source is
 * "ga4-live", so `asReading(await live(), (d) => d.total)` carries `LIVE_NOTE`.
 *
 * The "ga4-live" job keeps this fresh while a person is looking. The screen's
 * handler says so with `live({ screen: true })` (or `touch()`), which wakes
 * the job after a quiet spell; any other caller leaves it out. If what is kept
 * is older than two missed cycles, this call reads it afresh itself rather
 * than hand over a "now" from before lunch.
 */
export async function live(o: Ask = {}): Promise<Read<Live> & { age: number | null }> {
  const r = await readLive({ ...o, ttl: (2 * LIVE_EVERY + 60) * 1000 });
  return { ...r, source: "ga4-live", age: r.at === null ? null : Math.max(0, Math.round((Date.now() - r.at) / 1000)) };
}

/* ---------- the jobs -------------------------------------------------------- */

/** What the Command Center opens with. Kept warm so its first paint never waits on Google. */
const WARM: ((o: Ask) => Promise<Read<unknown>>)[] = [
  (o) => totals("30d", o),
  (o) => byDay("30d", o),
  (o) => channels("30d", o),
  (o) => pages("30d", o),
  (o) => countries("30d", o),
  (o) => devices("30d", o),
  (o) => events("30d", o),
  (o) => eventByPage("generate_lead", "30d", o),
];

/**
 * An idle desk still warms, but every three hours instead of every quarter,
 * and once when the property's day turns (reads are kept under their dates,
 * so at midnight every one of them is new). If it stopped entirely, the first
 * screen of the morning would be the one that waits. A warm run is about ten
 * history tokens, of 200,000 a day.
 */
const IDLE_WARM_MS = 3 * 3_600_000;
const WARM_TTL = 10 * 60_000;

const NOBODY = "skipped: no desk screen has asked for fifteen minutes";

/** The two scheduled jobs, registered by src/cc/index.ts: the live panel's poller and the 30-day warm-up. */
export const jobs: Job[] = [
  {
    name: "ga4-live",
    title: "Read who is on the website now",
    every: LIVE_EVERY,
    delay: 15,
    ready: hasKey,
    run: async () => {
      if (idle()) return NOBODY;
      /* Held back for quota is the desk slowing down as designed, not a failed run. */
      const held = pace("realtime");
      if (held.mode === "hold") return `held: ${held.reason ?? "quota"}`;
      const r = await readLive({ ttl: REALTIME_TTL });
      if (r.data === null) throw new Error(r.error ?? "GA4 realtime gave no answer");
      if (r.stale) return `kept the last answer: ${r.error ?? "not refreshed"}`;
      return `3 reports, ${r.data.tokens} realtime tokens`;
    },
  },
  {
    name: "ga4-warm",
    title: "Keep the 30-day analytics ready",
    every: 15 * 60,
    delay: 40,
    ready: hasKey,
    run: async ({ progress }) => {
      const last = Number(state("ga4:warmed") ?? 0);
      const sameDay = new Intl.DateTimeFormat("en-CA", { timeZone: zone() }).format(last) === propertyToday();
      if (idle() && sameDay && Date.now() - last < IDLE_WARM_MS) return NOBODY;
      const before = sent.core;
      let failedReads = 0;
      let why = "";
      for (const [i, read] of WARM.entries()) {
        /* Ten minutes, not fifteen: what the last run kept is a few seconds
           short of fifteen minutes old when this one starts, and a ttl of
           fifteen would let every other run pass without refreshing anything. */
        const r = await read({ wait: true, ttl: WARM_TTL });
        if (r.data === null || r.stale) {
          failedReads += 1;
          why ||= r.error ?? "";
        }
        progress(i + 1, WARM.length);
      }
      /* Each day's reads are kept under that day's dates, so yesterday's are
         never asked for again. Three days is long enough to look back at. */
      db.prepare("DELETE FROM cc_cache WHERE key LIKE 'ga4:rep:%' AND at < ?").run(Date.now() - 3 * DAY_MS);
      if (failedReads === WARM.length) throw new Error(why || "no read succeeded");
      setState("ga4:warmed", String(Date.now()));
      return `${WARM.length - failedReads} of ${WARM.length} reads ready, ${sent.core - before} asked${failedReads ? `; ${why}` : ""}`;
    },
  },
];

/* ---------- reporting on itself --------------------------------------------- */

function sourceStatus(id: "ga4" | "ga4-live", kind: Kind, name: string, feeds: string): SourceStatus {
  const m = meters[kind];
  const lastOk = m.okAt ? new Date(m.okAt).toISOString() : null;
  if (!hasKey()) return { id, name, state: "off", feeds, lastOk, step: KEY_STEP };
  if (m.errAt > m.okAt) return { id, name, state: "failing", feeds, lastOk, error: m.error ?? "The last read failed." };
  if (!m.okAt) return { id, name, state: "waiting", feeds, lastOk };
  return { id, name, state: "connected", feeds, lastOk };
}

registerSource(
  () => sourceStatus("ga4", "core", "Google Analytics 4", "Visitors, channels, pages, countries and events, for visitors who accepted cookies"),
  () => sourceStatus("ga4-live", "realtime", "Google Analytics 4, realtime", "People on the website in the last 30 minutes"),
);

registerCheck(() => {
  /* No key is "off", which is not a failure; no attempt yet is nothing to say. */
  if (!hasKey()) return null;
  const m = meters.core;
  if (!m.okAt && !m.errAt) return null;
  if (m.errAt > m.okAt) return { name: "Analytics answered", ok: false, detail: m.error ?? "The last read failed." };
  const held = pace("core");
  const minutes = Math.round((Date.now() - m.okAt) / 60_000);
  const ago = minutes < 1 ? "less than a minute ago" : minutes < 90 ? `${minutes} minute${minutes === 1 ? "" : "s"} ago` : `${Math.round(minutes / 60)} hours ago`;
  return { name: "Analytics answered", ok: true, detail: held.mode === "ok" ? `GA4 last answered ${ago}.` : (held.reason ?? "") };
});
