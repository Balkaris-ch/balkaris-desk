import { createHash } from "node:crypto";
import { db } from "../../db.ts";
import type { EarlySignals, Range, Reading, SourceStatus, Stat } from "../../../web/src/contract/common.ts";
import { accountEmail, hasKey, SCOPES, token } from "../gauth.ts";
import { runNow, type Job } from "../scheduler.ts";
import { cached, forget, kept, note, off, ok, record, series, setState, state, today, waiting } from "../store.ts";
import { countryName } from "./countries.ts";
import {
  addDays,
  answered,
  ask,
  asReading,
  base,
  countOn,
  dayIn,
  dayWindow,
  type DayWindow,
  eachDay,
  failed,
  gate,
  inTurns,
  median,
  pathOf,
  round,
  sameAddress,
  setCount,
  siteBase,
  SourceError,
  SPAN,
  statusOf,
} from "./shared.ts";

/**
 * Google Search Console: what people typed, what Google showed, what they
 * clicked, and whether each page is in the index.
 *
 * THE SAME ACCOUNT AS GA4. The desk's read-only service account signs a token
 * for the Search Console scope (src/cc/gauth.ts). Nothing new is minted; what
 * is missing until a person does it is the GRANT: the API switched on in the
 * Cloud project, and the account added as a user on a property that contains
 * the www pages. Those are three different omissions with three different
 * steps, so this file finds out which one it is (`checkAccess`) and says it.
 *
 * WHAT THE NUMBERS ARE. Clicks and impressions on Google Search only. Final
 * figures run two to three days behind, so every window here ends on the last
 * day Google has finished, not on today, and says so in its note. Position is
 * an average over the queries a page was shown for, not a tracked rank. Rare
 * queries are withheld, so query rows do not add up to the totals. CTR is in
 * percent (2.4 means 2.4%) everywhere in this file.
 *
 * WHAT GOOGLE DOES NOT GIVE. No backlinks, no "Page indexing" report, no
 * expected CTR. The index counts here come from inspecting every sitemap
 * address once a day (`inspectAll`); the CTR yardstick is this site's own
 * median and is labelled as ours.
 *
 * Endpoints and limits, as read on 2 October 2026:
 *   https://developers.google.com/webmaster-tools/v1/searchanalytics/query
 *   https://developers.google.com/webmaster-tools/v1/sites/list
 *   https://developers.google.com/webmaster-tools/v1/sitemaps/list
 *   https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect
 *   https://developers.google.com/webmaster-tools/limits (2,000 inspections a day per property)
 */

const API = (): string => base("GSC_API_BASE", "https://www.googleapis.com/webmasters/v3");
const INSPECT = (): string => base("GSC_INSPECT_BASE", "https://searchconsole.googleapis.com/v1");
const SITEMAP = (): string => base("CC_SITEMAP_URL", `${siteBase()}/sitemap.xml`);

/**
 * Where the bearer token comes from. The check script replaces it with a
 * fixed word so a test never talks to Google's token endpoint.
 */
export const wire = { bearer: (): Promise<string | null> => token(SCOPES.searchConsole) };

const PACIFIC = "America/Los_Angeles";
const HOUR = 3_600_000;
/** Kept a little over a day: the job refreshes twice a day, a screen never has to ask. */
const KEEP = 26 * HOUR;

/* ---------- Google's refusals, in words ---------------------------------- */

/**
 * Google's error body is { error: { code, message, status, details: [{ reason }] } }
 * (https://google.aip.dev/193; reasons in google/api/error_reason.proto). The
 * machine-readable reason is trusted first; the message is only a fallback,
 * because Google says not to code against its wording.
 */
function refusal(status: number, json: unknown): SourceError {
  const err = ((json as { error?: unknown } | null)?.error ?? {}) as {
    message?: string;
    status?: string;
    details?: { reason?: string }[];
    errors?: { reason?: string }[];
  };
  const message = String(err.message ?? "").slice(0, 200);
  const reasons = [...(err.details ?? []), ...(err.errors ?? [])].map((d) => String(d?.reason ?? "")).concat(String(err.status ?? ""));
  const has = (...names: string[]) => reasons.some((r) => names.includes(r));

  if (has("SERVICE_DISABLED", "accessNotConfigured") || /has not been used in project|it is disabled/i.test(message))
    return new SourceError(status, "forbidden", "The Google Search Console API is not enabled in the Cloud project", "SERVICE_DISABLED");
  if (status === 429 || has("RATE_LIMIT_EXCEEDED", "RESOURCE_EXHAUSTED", "rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded"))
    return new SourceError(status, "quota", "Search Console's quota is used up for the moment; it answers again by itself", "QUOTA");
  if (status === 401) return new SourceError(status, "auth", "Google refused the desk's service-account key (401)", "KEY");
  if (status === 403) return new SourceError(status, "forbidden", "Google says the desk's account may not read this Search Console property (403)", "PERMISSION");
  if (status === 404) return new SourceError(status, "absent", "Search Console does not know this property or address (404)", "NOT_FOUND");
  if (status >= 500) return new SourceError(status, "down", `Search Console answered ${status}`, "SERVER");
  return new SourceError(status, "request", `Search Console did not accept the request (${status})${message ? `: ${message}` : ""}`, "REQUEST");
}

/**
 * The token, with a refusal of the key put into words. A deleted or disabled
 * key never reaches Search Console: Google's token service turns it down
 * first (400 invalid_grant), and gauth.ts throws a plain Error saying so with
 * the status in brackets. That is the key, a person's step ("refused"); a
 * token service that cannot be reached or answers 5xx is the network, which
 * passes by itself ("down").
 */
async function bearer(): Promise<string | null> {
  try {
    return await wire.bearer();
  } catch (e) {
    const said = e instanceof Error ? e.message : String(e);
    const status = Number(/\((\d{3})\)/.exec(said)?.[1] ?? 0);
    const name = (e as { name?: string } | null)?.name ?? "";
    if (e instanceof TypeError || name === "TimeoutError" || name === "AbortError" || status >= 500)
      throw new SourceError(status, "down", "Google's token service could not be reached", "TOKEN_DOWN");
    throw new SourceError(status, "auth", `Google refused the desk's service-account key when asked for a token${status ? ` (${status})` : ""}`, "KEY");
  }
}

async function call<T>(method: "GET" | "POST", url: string, body?: unknown, timeout = 30_000): Promise<T> {
  try {
    const bearerToken = await bearer();
    if (!bearerToken) throw new SourceError(0, "auth", "The desk has no Google service-account key", "NO_KEY");
    const res = await ask("Search Console", url, { method, headers: { authorization: `Bearer ${bearerToken}` }, body, timeout });
    if (res.status < 200 || res.status >= 300) throw refusal(res.status, res.json);
    answered("gsc");
    return (res.json ?? {}) as T;
  } catch (e) {
    /* "The API is off" and "not added yet" are not failures of a connected
       source: `checkAccess` turns them into the off state with its step. */
    if (!(e instanceof SourceError && e.reason === "SERVICE_DISABLED")) failed("gsc", e);
    throw e;
  }
}

/* ---------- may the desk read, and which property ------------------------ */

/**
 *   no-key       there is no service-account key file on this machine
 *   unchecked    there is a key and Google has not been asked yet
 *   api-off      the Search Console API is not enabled in the Cloud project
 *   no-property  the account has not been added to any property (or not to GSC_SITE)
 *   no-www       it can read a property, and that property does not contain the www pages
 *   refused      Google refused the key itself
 *   ok           `site` is the property to read
 */
export type AccessState = "no-key" | "unchecked" | "api-off" | "no-property" | "no-www" | "refused" | "ok";

export interface Access {
  state: AccessState;
  /** The property the desk reads: "sc-domain:example.com" or "https://www.example.com/". */
  site: string | null;
  /** siteOwner, siteFullUser or siteRestrictedUser. */
  permission: string | null;
  /** Every property the account can read, as Search Console spells them. */
  readable: string[];
  /** ISO time of the last time Google was asked, or null. */
  checkedAt: string | null;
  detail: string;
}

const NO_KEY: Access = { state: "no-key", site: null, permission: null, readable: [], checkedAt: null, detail: "" };

/** What is known about access without asking Google: the last check, as it was written down. */
export function access(): Access {
  if (!hasKey()) return NO_KEY;
  try {
    const had = JSON.parse(state("gsc.access") ?? "null") as Access | null;
    /* A property chosen by hand that differs from the one checked is a new question. */
    if (had && (process.env.GSC_SITE ?? "") === (state("gsc.access.asked") ?? "")) return had;
  } catch {
    /* fall through */
  }
  return { ...NO_KEY, state: "unchecked" };
}

function save(a: Omit<Access, "checkedAt">): Access {
  const full: Access = { ...a, checkedAt: new Date().toISOString() };
  setState("gsc.access", JSON.stringify(full));
  setState("gsc.access.asked", process.env.GSC_SITE ?? "");
  return full;
}

/** Does a Search Console property contain the website's www pages? */
function covers(site: string): boolean {
  const home = `${siteBase()}/`;
  if (site.startsWith("sc-domain:")) {
    const domain = site.slice("sc-domain:".length).toLowerCase();
    const host = new URL(home).hostname.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  }
  return home.toLowerCase().startsWith(site.toLowerCase());
}

/**
 * Ask Google which properties the account can read and choose one.
 *
 * GSC_SITE, when set, is the property. Otherwise the Domain property for the
 * site is preferred (it contains every host and protocol), then the www
 * URL-prefix property, then anything else that contains the www pages.
 *
 * The three ways of not being connected are RESULTS here, not errors: they
 * are written down and the function returns. It throws only when Google
 * could not be asked at all, and then what was known before is left alone.
 */
export async function checkAccess(): Promise<Access> {
  if (!hasKey()) return NO_KEY;

  let entries: { siteUrl: string; permissionLevel: string }[];
  try {
    const got = await call<{ siteEntry?: { siteUrl?: string; permissionLevel?: string }[] }>("GET", `${API()}/sites`);
    entries = (got.siteEntry ?? [])
      .map((e) => ({ siteUrl: String(e.siteUrl ?? ""), permissionLevel: String(e.permissionLevel ?? "") }))
      /* An unverified user is listed and can read nothing. */
      .filter((e) => e.siteUrl && e.permissionLevel !== "siteUnverifiedUser");
  } catch (e) {
    if (e instanceof SourceError && e.reason === "SERVICE_DISABLED") return save({ ...NO_KEY, state: "api-off", detail: e.message });
    if (e instanceof SourceError && (e.kind === "auth" || e.kind === "forbidden")) return save({ ...NO_KEY, state: "refused", detail: e.message });
    throw e;
  }

  const readable = entries.map((e) => e.siteUrl);
  const found = (site: string) => entries.find((e) => e.siteUrl === site);
  const host = new URL(siteBase()).hostname;
  const wanted = process.env.GSC_SITE ? [process.env.GSC_SITE] : [`sc-domain:${host.replace(/^www\./, "")}`, `https://${host}/`];

  const hit = wanted.map(found).find(Boolean) ?? (process.env.GSC_SITE ? undefined : entries.find((e) => covers(e.siteUrl)));
  if (hit && covers(hit.siteUrl)) return save({ state: "ok", site: hit.siteUrl, permission: hit.permissionLevel, readable, detail: "" });
  if (hit || (readable.length && !process.env.GSC_SITE)) return save({ ...NO_KEY, state: "no-www", readable, detail: "" });
  return save({ ...NO_KEY, state: "no-property", readable, detail: "" });
}

/** Access, asked again when the last answer is old: every six hours while connected, every fifteen minutes while not. */
async function ensure(): Promise<Access> {
  const a = access();
  if (a.state === "no-key") return a;
  const age = a.checkedAt ? Date.now() - Date.parse(a.checkedAt) : Infinity;
  if (age < (a.state === "ok" ? 6 * HOUR : HOUR / 4)) return a;
  try {
    return await checkAccess();
  } catch (e) {
    if (a.state === "ok") return a;
    throw e;
  }
}

/** The Cloud project a service account lives in, read from its address: name@PROJECT.iam.gserviceaccount.com. */
const projectOf = (email: string | null): string => email?.match(/@([^.]+)\.iam\.gserviceaccount\.com$/)?.[1] ?? "the desk's Google Cloud project";

/** Why Search Console is not readable, in one sentence. */
export function reasonFor(a: Access): string {
  switch (a.state) {
    case "no-key":
      return "The desk has no Google service-account key on this machine, so Search Console cannot be asked.";
    case "unchecked":
      return "Search Console has not been asked yet whether the desk may read it.";
    case "api-off":
      return "The Google Search Console API is not enabled in the Cloud project the desk's account belongs to.";
    case "no-property":
      return process.env.GSC_SITE
        ? `The desk's Google account has not been added to the Search Console property ${process.env.GSC_SITE}.`
        : "The desk's Google account has not been added to any Search Console property.";
    case "no-www":
      return `The desk's Google account can read ${a.readable.join(", ") || "a property"}, which does not contain ${siteBase()}/.`;
    case "refused":
      return a.detail || "Google refused the desk's account.";
    case "ok":
      return "";
  }
}

/**
 * What a person does to connect it, for the state it is in: EVERYTHING still
 * missing, in order, so it is done in one visit. The desk can only see one
 * omission at a time (while the API is off it cannot even ask which
 * properties exist), so a step that named only the first would send Fini
 * back to Google's consoles once per omission.
 *
 * The permission asked for is Full. Google documents a service account on a
 * property only as an Owner (Indexing API guide); its permissions table gives
 * a Restricted user "fetch only" on URL Inspection and says nothing about the
 * API, so Full is the smallest level that is not a guess.
 * https://support.google.com/webmasters/answer/7687615
 *
 * The apex clause is there because the property Fini had is likely the
 * URL-prefix one for the apex, which the redirect to www leaves empty
 * (research notes of 2 October 2026; unconfirmed until the desk can look).
 */
export function stepFor(a: Access): string {
  const who = accountEmail() ?? "the desk's service-account address";
  const host = new URL(siteBase()).hostname;
  const apex = host.replace(/^www\./, "");
  const project = projectOf(accountEmail());
  const library = /\s/.test(project)
    ? "the Google Cloud console's API Library"
    : `https://console.cloud.google.com/apis/library/searchconsole.googleapis.com?project=${project}`;
  const addProperty = `a Domain property for ${apex}, verified by a DNS TXT record, or a URL-prefix property for https://${host}/, verified by the HTML tag the website already prints once the tag's content value is in the Vercel variable NEXT_PUBLIC_GOOGLE_VERIFICATION and the site is redeployed`;
  const addUser = `go to Settings, Users and permissions, Add user, enter ${who}, choose Full and save`;
  const openProperty = process.env.GSC_SITE
    ? `In Search Console open the property ${process.env.GSC_SITE}`
    : `In Search Console open the property that contains https://${host}/ (the Domain property ${apex}, or a URL-prefix property for https://${host}/; if there is only https://${apex}/, which does not contain the www pages, first add ${addProperty})`;
  switch (a.state) {
    case "no-key":
      return "Put the desk's Google service-account key file on the box at /opt/balkaris-desk/ga4.json (the file GA4_CREDENTIALS_FILE names in /opt/balkaris-desk/.env) and restart the desk.";
    case "api-off":
      return `Open ${library} (Google Cloud console, project ${project}, APIs & Services, Library, "Google Search Console API") and press Enable. Then ${openProperty.charAt(0).toLowerCase()}${openProperty.slice(1)}, and ${addUser}. The desk notices both within half an hour.`;
    case "no-www":
      return `In Search Console add ${addProperty}. Then in that property ${addUser}; the desk notices within half an hour.`;
    case "refused":
      return `Check in the Google Cloud console that ${who} still exists and that the key file on the box is one of its current keys; if the key was deleted, create a new one and replace the file.`;
    default:
      return `${openProperty}, ${addUser}; the desk notices within half an hour.`;
  }
}

/** True when the key exists and the last check found a readable property. */
export const configured = (): boolean => access().state === "ok";

export function status(): SourceStatus {
  const a = access();
  const feeds = "Organic clicks, impressions, CTR and position, queries and landing pages, which pages Google has indexed";
  if (a.state === "unchecked") return { id: "gsc", name: "Google Search Console", state: "waiting", feeds, lastOk: null };
  return statusOf({ id: "gsc", name: "Google Search Console", feeds, connected: a.state === "ok", offReason: reasonFor(a), step: stepFor(a) });
}

/** Runs a read only when a property is readable; otherwise says why not, and makes no request without a key. */
async function guarded<T>(read: (site: string) => Promise<Reading<T>>): Promise<Reading<T>> {
  let a: Access;
  try {
    a = await ensure();
  } catch (e) {
    return waiting("gsc", `Search Console could not be asked whether the desk may read it: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (a.state !== "ok" || !a.site) return off("gsc", reasonFor(a), stepFor(a));
  try {
    return await read(a.site);
  } catch (e) {
    /* A property that turned us away after having let us in: ask again next time. */
    if (e instanceof SourceError && (e.kind === "forbidden" || e.kind === "auth")) setState("gsc.access", "null");
    return waiting("gsc", `The last read failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
  }
}

/* ---------- the search analytics call ------------------------------------ */

export type Dimension = "date" | "hour" | "query" | "page" | "country" | "device" | "searchAppearance";
export type SearchType = "web" | "image" | "video" | "news" | "discover" | "googleNews";
export type DataState = "final" | "all" | "hourly_all";
export type FilterOperator = "equals" | "notEquals" | "contains" | "notContains" | "includingRegex" | "excludingRegex";

export interface Filter {
  dimension: Exclude<Dimension, "date" | "hour">;
  /** Default: equals. */
  operator?: FilterOperator;
  expression: string;
}

/** The four figures Search Console gives for anything. CTR in percent, position 1-based (lower is better). */
export interface Figures {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** One row of an answer: `keys` holds one value per dimension asked for, in that order. */
export interface Row extends Figures {
  keys: string[];
}

interface Ask {
  start: string;
  end: string;
  dimensions: Dimension[];
  filters?: Filter[];
  type?: SearchType;
  dataState?: DataState;
  aggregationType?: "auto" | "byPage" | "byProperty";
  /** Rows wanted in all. Above 25,000 the call pages. */
  limit?: number;
  startRow?: number;
}

interface Rows {
  rows: Row[];
  /** False when the row limit cut the answer short. */
  complete: boolean;
  /** The first day whose figures may still change, when Google said. */
  firstIncompleteDate: string | null;
}

const PAGE = 25_000;

const figures = (r: { clicks?: number; impressions?: number; ctr?: number; position?: number }): Figures => ({
  clicks: Math.round(Number(r.clicks ?? 0)),
  impressions: Math.round(Number(r.impressions ?? 0)),
  ctr: round(Number(r.ctr ?? 0) * 100, 2),
  position: round(Number(r.position ?? 0), 2),
});

async function rows(site: string, q: Ask): Promise<Rows> {
  const want = Math.max(1, q.limit ?? 1000);
  const out: Row[] = [];
  let firstIncompleteDate: string | null = null;
  let start = q.startRow ?? 0;
  let full = false;

  /* 50,000 rows a day per search type is all Google exposes; two pages reach it. */
  for (let page = 0; page < 4; page++) {
    const size = Math.min(PAGE, want - out.length);
    const got = await call<{ rows?: { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }[]; metadata?: { first_incomplete_date?: string } }>(
      "POST",
      `${API()}/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
      {
        startDate: q.start,
        endDate: q.end,
        dimensions: q.dimensions,
        type: q.type ?? "web",
        dataState: q.dataState ?? "final",
        rowLimit: size,
        startRow: start,
        ...(q.aggregationType ? { aggregationType: q.aggregationType } : {}),
        ...(q.filters?.length
          ? { dimensionFilterGroups: [{ groupType: "and", filters: q.filters.map((f) => ({ dimension: f.dimension, operator: f.operator ?? "equals", expression: f.expression })) }] }
          : {}),
      },
    );
    firstIncompleteDate ??= got.metadata?.first_incomplete_date ?? null;
    const batch = got.rows ?? [];
    for (const r of batch) out.push({ keys: (r.keys ?? []).map(String), ...figures(r) });
    full = batch.length === size;
    if (!full || out.length >= want) break;
    start += size;
  }
  return { rows: out, complete: !full, firstIncompleteDate };
}

/**
 * The last day Google has finished counting. Asked the way Google suggests:
 * by date over the last ten days, taking the newest day that came back.
 * Kept for six hours, and renewed by the scheduled refresh. When the
 * property has no rows at all, three days ago.
 */
async function lastFinalDay(site: string): Promise<string> {
  const had = await cached<string>("gsc:anchor", 6 * HOUR, async () => {
    const now = dayIn(PACIFIC);
    const got = await rows(site, { start: addDays(now, -10), end: now, dimensions: ["date"], limit: 20 });
    return got.rows.map((r) => r.keys[0] ?? "").sort().at(-1) || addDays(now, -3);
  });
  return had.value;
}

const SHORT = "Search Console counts by the day and runs two to three days behind, so it has no answer for the last hour or day. Choose seven days or longer.";

const caveat = (w: { start: string; end: string }, more = ""): string =>
  `Google Search only, ${w.start} to ${w.end}. Final figures run two to three days behind.${more ? ` ${more}` : ""}`;

/** The question, as asked through `query()`. Either a `range` or both dates. */
export interface QuerySpec {
  range?: Range;
  /** YYYY-MM-DD, Pacific Time, as Search Console counts days. */
  startDate?: string;
  endDate?: string;
  dimensions?: Dimension[];
  filters?: Filter[];
  /** Default: web. */
  type?: SearchType;
  /** Default: final. "all" adds the fresh, still-changing days; "hourly_all" goes with the hour dimension. */
  dataState?: DataState;
  aggregationType?: "auto" | "byPage" | "byProperty";
  /** Rows wanted in all, default 1,000. Above 25,000 the call pages; Google exposes at most 50,000 a day. */
  rowLimit?: number;
  startRow?: number;
}

export interface QueryAnswer {
  startDate: string;
  endDate: string;
  rows: Row[];
  /** False when `rowLimit` cut the answer short. */
  complete: boolean;
  firstIncompleteDate: string | null;
}

/**
 * The general door: any Search Analytics question, kept for six hours under
 * its own wording (and deleted two days later by the scheduled refresh, so
 * questions worded by what a person typed do not pile up). The named reads
 * below are built on the same call; use this for the question none of them asks.
 */
export async function query(spec: QuerySpec): Promise<Reading<QueryAnswer>> {
  return guarded(async (site) => {
    let start = spec.startDate;
    let end = spec.endDate;
    if (!start || !end) {
      const w = dayWindow(spec.range ?? "30d", await lastFinalDay(site));
      if (!w) return off("gsc", SHORT);
      start = w.start;
      end = w.end;
    }
    const key = `gsc:q:${createHash("sha1").update(JSON.stringify(spec)).digest("hex").slice(0, 16)}`;
    const had = await cached<QueryAnswer>(key, 6 * HOUR, async () => {
      const got = await rows(site, {
        start: start!,
        end: end!,
        dimensions: spec.dimensions ?? [],
        filters: spec.filters,
        type: spec.type,
        dataState: spec.dataState,
        aggregationType: spec.aggregationType,
        limit: spec.rowLimit,
        startRow: spec.startRow,
      });
      return { startDate: start!, endDate: end!, ...got };
    });
    return asReading("gsc", had, caveat({ start: had.value.startDate, end: had.value.endDate }));
  });
}

/* ---------- the named reads ---------------------------------------------- */

export interface ReadOptions {
  /** Ask Google now instead of using the kept answer. The scheduled job does; a screen does not. */
  fresh?: boolean;
}

/**
 * One kept answer per read and range. An answer with nothing in it is kept
 * for an hour only, so a property that has just been connected fills in soon
 * after Google has something to say.
 */
async function named<T extends { window: DayWindow }>(
  name: string,
  range: Range,
  o: ReadOptions,
  empty: (v: T) => boolean,
  build: (site: string, w: DayWindow) => Promise<T>,
  more = "",
): Promise<Reading<T>> {
  return guarded(async (site) => {
    /* The anchor is kept six hours whatever `fresh` says: the scheduled
       refresh renews it once (`warm`), not once for each of its 21 reads. */
    const w = dayWindow(range, await lastFinalDay(site));
    if (!w) return off("gsc", SHORT);
    const key = `gsc:${name}:${range}`;
    const before = kept<T>(key);
    const ttl = o.fresh ? 0 : before && empty(before.value) ? HOUR : KEEP;
    const had = await cached<T>(key, ttl, () => build(site, w));
    if (empty(had.value)) return waiting("gsc", `Search Console is connected and reports nothing for ${had.value.window.start} to ${had.value.window.end} yet.`);
    return asReading("gsc", had, caveat(had.value.window, more));
  });
}

/** Both windows of one breakdown, joined on the dimension's value. */
async function compared(site: string, w: DayWindow, dimensions: Dimension[], limit: number): Promise<{ key: string; keys: string[]; now: Figures; before: Figures | null }[]> {
  const [cur, prev] = await Promise.all([
    rows(site, { start: w.start, end: w.end, dimensions, limit }),
    rows(site, { start: w.previousStart, end: w.previousEnd, dimensions, limit }),
  ]);
  const old = new Map(prev.rows.map((r) => [r.keys.join("\u0000"), r]));
  return cur.rows.map((r) => {
    const key = r.keys.join("\u0000");
    const b = old.get(key);
    const { keys, ...now } = r;
    return { key, keys, now, before: b ? { clicks: b.clicks, impressions: b.impressions, ctr: b.ctr, position: b.position } : null };
  });
}

/** One day of search, with the same weekday-distance day of the window before. */
export interface SearchDay {
  /** YYYY-MM-DD, a Pacific Time day. */
  date: string;
  clicks: number;
  impressions: number;
  /** Percent. Null on a day with no impressions: there is nothing to divide. */
  ctr: number | null;
  /** Null on a day with no impressions. */
  position: number | null;
  previous: { date: string; clicks: number; impressions: number; ctr: number | null; position: number | null } | null;
}

export interface SearchTotals {
  window: DayWindow;
  /**
   * The first day in `days`: the window's start, or later when Google's
   * figures for the property begin inside the window. Days before that are
   * left out because nothing was counted on them, which is not zero.
   */
  from: string;
  clicks: Stat;
  impressions: Stat;
  /**
   * Percent: clicks over impressions for the whole window. Null when the
   * window had no impressions to divide by. Its `series` is filled only when
   * every day in `days` had impressions; one day without leaves it EMPTY,
   * because that day has no CTR, and a series that skipped it would put every
   * later point on the wrong date. Draw from `days[].ctr`, which carries null.
   */
  ctr: Stat | null;
  /**
   * Average position weighted by impressions, as Search Console computes its
   * own total. Lower is better. Null without impressions. `series` as for
   * `ctr`: empty when a day had no impressions; `days[].position` always lines up.
   */
  position: Stat | null;
  /** One per day from `from` to the window's end, oldest first. The one list every chart can draw against dates. */
  days: SearchDay[];
}

/**
 * Clicks, impressions, CTR and position: the four totals with the window
 * before, and one row per day for the chart. `previous` is null on every
 * figure unless Google has figures from the first day of the window before
 * (a young property is compared once it has a whole window behind it).
 */
export function totalsByDay(range: Range, o: ReadOptions = {}): Promise<Reading<SearchTotals>> {
  return named<SearchTotals>(
    "totals",
    range,
    o,
    (v) => v.impressions.value === 0 && v.impressions.previous === null,
    async (site, w) => {
      const got = await rows(site, { start: w.previousStart, end: w.end, dimensions: ["date"], limit: 800 });
      const by = new Map(got.rows.map((r) => [r.keys[0] ?? "", r]));
      const dayOf = (date: string) => {
        const r = by.get(date);
        return r && r.impressions > 0
          ? { date, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr as number | null, position: r.position as number | null }
          : { date, clicks: r?.clicks ?? 0, impressions: 0, ctr: null, position: null };
      };
      const firstData = got.rows.map((r) => r.keys[0] ?? "").filter(Boolean).sort()[0] ?? null;
      /* Google sends no row for a day without impressions, so once its figures
         have begun a missing day is a zero. Before the first figure it is not
         known to be: nothing may have been counted yet. Those days are left
         out (or their `previous` is null), never drawn as zero, and a window
         before that is only partly covered is not compared as a whole. */
      const hadBefore = !!firstData && firstData <= w.previousEnd;
      const coveredBefore = !!firstData && firstData <= w.previousStart;
      const from = !hadBefore && firstData && firstData > w.start ? firstData : w.start;
      const days: SearchDay[] = eachDay(from, w.end).map((date) => {
        const then = addDays(date, -w.days);
        return { ...dayOf(date), previous: hadBefore && then >= firstData! ? dayOf(then) : null };
      });

      /* CTR and position need impressions to divide by; without any they are not zero, they do not exist. */
      const sum = (list: { clicks: number; impressions: number; position: number | null }[]) => {
        const clicks = list.reduce((n, d) => n + d.clicks, 0);
        const impressions = list.reduce((n, d) => n + d.impressions, 0);
        const weighted = list.reduce((n, d) => n + (d.position ?? 0) * d.impressions, 0);
        return { clicks, impressions, ctr: impressions ? round((clicks / impressions) * 100, 2) : null, position: impressions ? round(weighted / impressions, 2) : null };
      };
      const now = sum(days);
      const before = coveredBefore ? sum(days.map((d) => d.previous!)) : null;
      /* A series must have one point per day of `days`, or none at all. */
      const aligned = (pick: (d: SearchDay) => number | null): number[] => {
        const values = days.map(pick);
        return values.every((v) => v !== null) ? (values as number[]) : [];
      };

      return {
        window: w,
        from,
        clicks: { value: now.clicks, previous: before?.clicks ?? null, unit: "count", series: days.map((d) => d.clicks) },
        impressions: { value: now.impressions, previous: before?.impressions ?? null, unit: "count", series: days.map((d) => d.impressions) },
        ctr: now.ctr === null ? null : { value: now.ctr, previous: before?.ctr ?? null, unit: "percent", series: aligned((d) => d.ctr) },
        position: now.position === null ? null : { value: now.position, previous: before?.position ?? null, unit: "ratio", series: aligned((d) => d.position) },
        days,
      };
    },
  );
}

export interface QueryRow extends Figures {
  query: string;
  /** The same query in the window before, or null when it had no impressions then. */
  previous: Figures | null;
}

export interface Listed<R> {
  window: DayWindow;
  rows: R[];
  /** False when there were more rows than were asked for. */
  complete: boolean;
}

const LIST = 1000;

/** The queries the site was shown for, most clicks first, each with the window before. */
export function queries(range: Range, o: ReadOptions = {}): Promise<Reading<Listed<QueryRow>>> {
  return named<Listed<QueryRow>>(
    "queries",
    range,
    o,
    (v) => v.rows.length === 0,
    async (site, w) => {
      const got = await compared(site, w, ["query"], LIST);
      return { window: w, rows: got.map((r) => ({ query: r.keys[0] ?? "", ...r.now, previous: r.before })), complete: got.length < LIST };
    },
    "Rare queries are withheld by Google, so these rows do not add up to the totals.",
  );
}

export interface PageRow extends Figures {
  /** The full address, as Google reports it. */
  page: string;
  /** The same page as a path: "/logistics". */
  path: string;
  previous: Figures | null;
}

/** The pages people landed on from Google, most clicks first, each with the window before. */
export function pages(range: Range, o: ReadOptions = {}): Promise<Reading<Listed<PageRow>>> {
  return named<Listed<PageRow>>("pages", range, o, (v) => v.rows.length === 0, async (site, w) => {
    const got = await compared(site, w, ["page"], LIST);
    return { window: w, rows: got.map((r) => ({ page: r.keys[0] ?? "", path: pathOf(r.keys[0] ?? ""), ...r.now, previous: r.before })), complete: got.length < LIST };
  });
}

export interface QueryPageRow extends Figures {
  query: string;
  page: string;
  path: string;
}

const PAIRS = 5000;

/** Which page Google showed for which query. The most expensive question Search Console answers, so it is asked for one window only. */
export function queryPages(range: Range, o: ReadOptions = {}): Promise<Reading<Listed<QueryPageRow>>> {
  return named<Listed<QueryPageRow>>(
    "query-pages",
    range,
    o,
    (v) => v.rows.length === 0,
    async (site, w) => {
      const got = await rows(site, { start: w.start, end: w.end, dimensions: ["query", "page"], limit: PAIRS });
      return {
        window: w,
        rows: got.rows.map(({ keys, ...f }) => ({ query: keys[0] ?? "", page: keys[1] ?? "", path: pathOf(keys[1] ?? ""), ...f })),
        complete: got.complete,
      };
    },
    "Rare queries are withheld by Google.",
  );
}

export interface PartRow extends Figures {
  /** Country: the ISO code in capitals ("CHE"). Device: DESKTOP, MOBILE or TABLET. */
  key: string;
  label: string;
  previous: Figures | null;
}

/** Search by the searcher's country, most clicks first. */
export function byCountry(range: Range, o: ReadOptions = {}): Promise<Reading<Listed<PartRow>>> {
  return named<Listed<PartRow>>("countries", range, o, (v) => v.rows.length === 0, async (site, w) => {
    const got = await compared(site, w, ["country"], 300);
    return { window: w, rows: got.map((r) => ({ key: (r.keys[0] ?? "").toUpperCase(), label: countryName(r.keys[0] ?? ""), ...r.now, previous: r.before })), complete: true };
  });
}

const DEVICE: Record<string, string> = { DESKTOP: "Desktop", MOBILE: "Mobile", TABLET: "Tablet" };

/** Search by the kind of device, most clicks first. */
export function byDevice(range: Range, o: ReadOptions = {}): Promise<Reading<Listed<PartRow>>> {
  return named<Listed<PartRow>>("devices", range, o, (v) => v.rows.length === 0, async (site, w) => {
    const got = await compared(site, w, ["device"], 10);
    return {
      window: w,
      rows: got.map((r) => {
        const key = (r.keys[0] ?? "").toUpperCase();
        return { key, label: DEVICE[key] ?? key, ...r.now, previous: r.before };
      }),
      complete: true,
    };
  });
}

/** How many queries sat how high on one day. Each count includes the ones above it: top10 contains top3. */
export interface BucketDay {
  date: string;
  top3: number;
  top10: number;
  top50: number;
  /** Every query Google reported for the day, at any position. */
  queries: number;
}

export interface PositionBuckets {
  window: DayWindow;
  /** The first day in `days`: the window's start, or the day Google's figures begin when that is later. */
  from: string;
  days: BucketDay[];
  /** False when Google's row limit cut the answer, so some days' counts are short. */
  complete: boolean;
}

/**
 * The ranking trend: per day, the number of queries whose average position
 * that day was 3 or better, 10 or better, 50 or better. Counts of queries
 * Google reported, so withheld rare queries are not in them. Days before
 * Google's first figure for the property are left out, as in `totalsByDay`.
 */
export function positionBuckets(range: Range, o: ReadOptions = {}): Promise<Reading<PositionBuckets>> {
  return named<PositionBuckets>(
    "buckets",
    range,
    o,
    (v) => v.days.every((d) => d.queries === 0),
    async (site, w) => {
      const got = await rows(site, { start: w.start, end: w.end, dimensions: ["date", "query"], limit: 50_000 });
      const firstData = got.rows.map((r) => r.keys[0] ?? "").filter(Boolean).sort()[0] ?? null;
      let from = w.start;
      if (firstData && firstData > w.start) {
        /* Empty first days are zeros only if Google counted anything before them: one cheap question settles it. */
        const earlier = await rows(site, { start: w.previousStart, end: addDays(w.start, -1), dimensions: ["date"], limit: 1 });
        if (!earlier.rows.length) from = firstData;
      }
      const by = new Map<string, BucketDay>(eachDay(from, w.end).map((date) => [date, { date, top3: 0, top10: 0, top50: 0, queries: 0 }]));
      for (const r of got.rows) {
        const d = by.get(r.keys[0] ?? "");
        if (!d) continue;
        d.queries++;
        if (r.position <= 50) d.top50++;
        if (r.position <= 10) d.top10++;
        if (r.position <= 3) d.top3++;
      }
      return { window: w, from, days: [...by.values()], complete: got.complete };
    },
    "Counts of the queries Google reports; rare queries are withheld.",
  );
}

/* ---------- what follows from them --------------------------------------- */

/** A reading turned into another without asking anything: the rule's result carries the same time and source. */
function derived<A, B>(r: Reading<A>, make: (value: A) => B, rule: string): Reading<B> {
  if (r.state !== "ok") return r;
  return ok(make(r.value), r.source, r.asOf, [r.note, rule].filter(Boolean).join(" "));
}

/**
 * The floors below which a figure is noise. A page shown eleven times moves
 * ten positions for no reason at all; reporting it would be reporting chance.
 * They are our own choice, returned with every result so a screen can say so.
 */
export const FLOOR = { movers: 30, opportunities: 30, ctr: 50, gaps: 10 } as const;

/**
 * EARLY SIGNALS: what a young site sees instead of empty lists.
 *
 * The floors above are set for a site Google already shows often. A property
 * a few weeks old has almost nothing above them, so every list built on them
 * comes back empty, and an empty list reads as a broken one. So the lists that
 * only SHOW what Google showed (`opportunities`, `gaps`, and through them the
 * Insights screen) have an early mode; the lists that COMPARE (`movers`,
 * `ctrOutliers`) do not, because a comparison on a handful of impressions is
 * noise however it is labelled: they say why they wait instead.
 *
 * THE RULE, stated here and nowhere else: a list is EARLY while fewer than
 * 10 of its own rows (the rows its rule keeps, before any floor) reach its
 * standard floor, or while the queries Google reports for the window add up
 * to fewer than 1,000 impressions. The first half is the list's own: a window
 * can be well past 1,000 impressions with one query carrying most of them,
 * and a list that asked only about the window would then go back to its
 * standard floor with nothing above it, empty again. The second half keeps a
 * young window early as a whole, so ten rows that barely reach the floor in a
 * site's first weeks are still read as early.
 *
 * In an early list the floor drops to 1 impression, every row under the
 * standard floor carries `early: true`, and the list carries `early`
 * (EarlySignals) with the line a screen prints at its head. Nothing switches
 * it back by hand: the first read after the list stops being early is at the
 * standard floor again, and it has at least ten rows then.
 *
 * A caller that passes `floor` gets exactly that floor and never the early
 * mode. The attention rules do (src/cc/attention.ts): an alert must never
 * fire on noise.
 */
export const EARLY = { impressions: 1000, rows: 10 } as const;

const EARLY_RULE = `A list is early while fewer than ${EARLY.rows} of its rows reach its standard floor, or while the queries Google reports for the window add up to fewer than ${EARLY.impressions.toLocaleString("en-GB")} impressions.`;

/**
 * Whether a list is early (the rule above). `own` are the rows the list's
 * rule keeps before any floor; `all` every query row of the window.
 */
export function isEarly(own: readonly { impressions: number }[], all: readonly { impressions: number }[], standard: number): boolean {
  const impressions = all.reduce((n, r) => n + r.impressions, 0);
  return impressions < EARLY.impressions || own.filter((r) => r.impressions >= standard).length < EARLY.rows;
}

const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "9 Nov 2026": a day as a person reads it in a sentence, with the screens' month names (Intl's en-GB now says "Sept"). */
export const dayText = (day: string): string => {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
};

/**
 * A period as a person reads it: "1 Sep – 30 Sep 2026" inside one year,
 * "30 Sep 2024 – 29 Sep 2025" across two, so a window that crosses New Year
 * is never dated as if it began in the year it ends.
 */
export const spanText = (start: string, end: string): string =>
  start.slice(0, 4) === end.slice(0, 4) ? `${dayText(start).replace(/ \d{4}$/, "")} – ${dayText(end)}` : `${dayText(start)} – ${dayText(end)}`;

/**
 * The early signals of a list, or null when it is not early (the rule above).
 * `own` are the rows the list's rule keeps before any floor, `all` every query
 * row of the window; `after` is the list's own sentence: what a figure under
 * its standard floor is worth, and that the list returns to the floor by itself.
 */
export function earlySignals(rows: { own: readonly { impressions: number }[]; all: readonly { impressions: number }[] }, standard: number, after: string): EarlySignals | null {
  if (!isEarly(rows.own, rows.all, standard)) return null;
  const impressions = rows.all.reduce((n, r) => n + r.impressions, 0);
  return {
    standard,
    queries: rows.all.length,
    impressions,
    line: `Early signals: Google showed the site ${count(impressions, "time")} for the ${count(rows.all.length, "query", "queries")} it reports in this window (rare queries are withheld). ${after}`,
  };
}

/** What a row under each list's standard floor is worth, in one clause. */
const UNDER = {
  opportunities: (standard: number) => `A position measured on 1 to ${standard - 1} impressions moves a lot from day to day`,
  gaps: (standard: number) => `A query shown 1 to ${standard - 1} times can be a one-off rather than a question people keep asking`,
};

/**
 * The floor a list is read at: the caller's, or the standard one, or 1 with
 * the early signals. `own` are the rows the list's rule keeps before any
 * floor, `all` every query row of the window.
 */
function floorFor(
  rows: { own: readonly { impressions: number }[]; all: readonly { impressions: number }[] },
  standard: number,
  asked: number | undefined,
  under: (standard: number) => string,
): { floor: number; early: EarlySignals | null } {
  if (asked !== undefined) return { floor: asked, early: null };
  const early = earlySignals(rows, standard, `${under(standard)}; the list switches to the standard floor of ${standard} by itself once enough data exists.`);
  return { floor: early ? 1 : standard, early };
}

/**
 * The first day of Google's figures for the property, as a window's totals
 * read it: the earliest day of the window before that has a figure, or the
 * first day drawn when none does. When the window before is covered from its
 * first day, that first day (Google's own begin earlier). The day the totals'
 * rule (`coveredBefore` in routes/seo.ts) measures coverage by.
 */
export function figuresBegin(t: SearchTotals): string {
  return t.days.map((d) => d.previous?.date).filter((d): d is string => !!d).sort()[0] ?? t.from;
}

/** Google keeps sixteen months of Search Console figures; at their shortest that is 485 days. */
const KEPT_DAYS = 485;

/**
 * WHEN A MOVEMENT CAN FIRST BE MEASURED, in one place for every sentence that
 * names the day (`movers` here, `moversRead` in routes/seo.ts), so the day a
 * panel promises is the day the desk starts comparing. Two things must hold
 * for a window of `days` days ending on day E:
 *
 *   Google's figures cover the window before from its first day (the totals'
 *   rule; `figures` is the first day of Google's figures, `figuresBegin`):
 *   E ≥ figures + 2 × days − 1.
 *   The window before holds a query Search Console reports, or there is
 *   nothing to compare (`queries` is the first day it reports one, when
 *   known): E ≥ queries + days.
 *
 * The later of the two, as a sentence, with the fact that sets it. Google
 * finishes counting a day two to three days after it. Two whole windows of
 * more than sixteen months together are never both in Search Console: said
 * instead of a day that would never come.
 */
export function firstComparison(o: { figures: string | null; queries?: string | null }, days: number): string {
  if (2 * days > KEPT_DAYS) {
    return `Google keeps sixteen months of Search Console figures, so two whole ${days}-day periods can never both be read from it; movements are measured over 7, 30 or 90 days.`;
  }
  const byFigures = o.figures ? addDays(o.figures, 2 * days - 1) : null;
  const byQueries = o.queries ? addDays(o.queries, days) : null;
  const late = " (Google finishes counting a day two to three days after it)";
  if (byQueries && (!byFigures || byQueries > byFigures)) {
    return `Search Console reports queries from ${dayText(o.queries!)}; the period before first holds them, and the first movement can be measured, once Google's final figures reach ${dayText(byQueries)}${late}.`;
  }
  if (byFigures) {
    return `Google's figures for the site begin on ${dayText(o.figures!)}; the first comparison of two full ${days}-day windows is possible once its final figures reach ${dayText(byFigures)}${late}.`;
  }
  return `A comparison of two full ${days}-day windows becomes possible ${2 * days - 1} days after Google's first figure for the site.`;
}

/** The first day of the window with a query in it, from the ranking trend's own kept answer. */
async function firstQueryDay(range: Range): Promise<string | null> {
  const b = await positionBuckets(range);
  return b.state === "ok" ? (b.value.days.find((d) => d.queries > 0)?.date ?? null) : null;
}

export interface Mover {
  kind: "query" | "page";
  /** The query, or the page's full address. */
  key: string;
  /** For a page, its path. */
  path?: string;
  previous: number;
  current: number;
  /** Positions gained: positive means it moved up (8 from 17 is +9). */
  change: number;
  impressions: number;
  previousImpressions: number;
  clicks: number;
}

/**
 * Pages and queries whose average position changed between the two windows,
 * largest move first. Only those shown at least `floor` times in BOTH
 * windows, and moved by at least one position: below that it is noise.
 *
 * NO EARLY MODE. A movement is a comparison, and a comparison needs a window
 * before with figures in it. When nothing moved, the reading says which of
 * three things is true: something passed the floor in both windows and did
 * not move (ok, an empty list); Search Console reports no query at all for
 * the window before, so there is nothing to compare with yet (waiting, with
 * the day the first comparison becomes possible, by `firstComparison`); or
 * both windows have figures and none reaches the floor in both (waiting,
 * with the counts). A year is never compared (off, without a step): Google
 * keeps sixteen months, so a year and the year before are never both there.
 */
export async function movers(range: Range, o: { floor?: number } = {}): Promise<Reading<{ window: DayWindow; floor: number; rows: Mover[]; compared: { queries: number; pages: number } }>> {
  const floor = o.floor ?? FLOOR.movers;
  /* A year against the year before is never both in Search Console: not "waiting", it cannot be given. Nothing is asked. */
  if (2 * SPAN[range] > KEPT_DAYS) return off("gsc", firstComparison({ figures: null }, SPAN[range]));
  const [q, p] = await Promise.all([queries(range), pages(range)]);
  if (q.state !== "ok") return q;
  const list: Mover[] = [];
  /* What passed the floor in both windows: compared, whether or not it moved. */
  const compared = { queries: 0, pages: 0 };
  const add = (kind: Mover["kind"], key: string, path: string | undefined, r: Figures & { previous: Figures | null }) => {
    if (!r.previous || r.impressions < floor || r.previous.impressions < floor) return;
    compared[kind === "query" ? "queries" : "pages"]++;
    const change = round(r.previous.position - r.position, 1);
    if (Math.abs(change) < 1) return;
    list.push({ kind, key, ...(path ? { path } : {}), previous: r.previous.position, current: r.position, change, impressions: r.impressions, previousImpressions: r.previous.impressions, clicks: r.clicks });
  };
  for (const r of q.value.rows) add("query", r.query, undefined, r);
  if (p.state === "ok") for (const r of p.value.rows) add("page", r.page, r.path, r);
  list.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

  const passed = compared.queries + compared.pages > 0;
  if (!list.length && !passed) {
    const w = q.value.window;
    const shownBefore = <R extends { impressions: number; previous: Figures | null }>(rows: R[]) => rows.filter((r) => r.previous && r.previous.impressions > 0);
    const queriesBoth = shownBefore(q.value.rows);
    const pagesBoth = p.state === "ok" ? shownBefore(p.value.rows) : [];
    /* "No query in the period before" is asked of that period itself (one row is enough, kept six hours): a query shown then and not now is not in the rows above. */
    const before = queriesBoth.length ? null : await query({ startDate: w.previousStart, endDate: w.previousEnd, dimensions: ["query"], rowLimit: 1 });
    if (before?.state === "ok" && before.value.rows.length === 0) {
      /* The day is the one `moversRead` (routes/seo.ts) will hold to as well: the same rule, from the same two facts. */
      const [first, t] = await Promise.all([firstQueryDay(range), totalsByDay(range)]);
      return waiting(
        "gsc",
        `No comparison yet: Search Console reports no query for the site in ${spanText(w.previousStart, w.previousEnd)}, the period this one is measured against. ` +
          (first
            ? firstComparison({ figures: t.state === "ok" ? figuresBegin(t.value) : null, queries: first }, w.days)
            : `A comparison becomes possible ${w.days} days after Search Console reports a first query for the site.`),
      );
    }
    return waiting(
      "gsc",
      `Too few impressions to measure a movement: ${count(queriesBoth.length, "query", "queries")} and ${count(pagesBoth.length, "page")} were shown in both ${spanText(w.previousStart, w.previousEnd)} and ${spanText(w.start, w.end)}, none of them ${floor} times in each. The list starts by itself once a query or a page has been shown at least ${floor} times in both periods.`,
    );
  }
  return derived(q, (v) => ({ window: v.window, floor, rows: list, compared }), `Average position, this window against the one before; only what was shown at least ${floor} times in both.`);
}

export interface Opportunity extends Figures {
  query: string;
  previous: Figures | null;
  /** The page Google shows most for it, when known. */
  page: string | null;
  path: string | null;
  /** Listed by an early list and shown fewer times than the standard floor (EARLY above). */
  early?: boolean;
}

/** A list built on the query rows: its window, the floor it was read at, its early signals, its rows. */
export interface QueryRule<R> {
  window: DayWindow;
  floor: number;
  /** Null when the list was read at its standard floor (or at a floor the caller chose). */
  early: EarlySignals | null;
  rows: R[];
}

/** The page Google showed most for each query. */
function landingOf(qp: Reading<Listed<QueryPageRow>>): Map<string, QueryPageRow> {
  const landing = new Map<string, QueryPageRow>();
  if (qp.state === "ok") for (const r of qp.value.rows) if ((landing.get(r.query)?.impressions ?? -1) < r.impressions) landing.set(r.query, r);
  return landing;
}

/**
 * Queries the site already ranks for on the first two pages without being at
 * the top: average position 4 to 20, shown at least `floor` times. The ones
 * where a better page moves real traffic. Most impressions first. In an early
 * list, from one impression up, the rows under the floor marked (EARLY).
 */
export async function opportunities(range: Range, o: { floor?: number } = {}): Promise<Reading<QueryRule<Opportunity>>> {
  const [q, qp] = await Promise.all([queries(range), queryPages(range)]);
  if (q.state !== "ok") return q;
  const landing = landingOf(qp);
  const ranked = q.value.rows.filter((r) => r.position >= 4 && r.position <= 20);
  const { floor, early } = floorFor({ own: ranked, all: q.value.rows }, FLOOR.opportunities, o.floor, UNDER.opportunities);
  return derived(
    q,
    (v) => ({
      window: v.window,
      floor,
      early,
      rows: ranked
        .filter((r) => r.impressions >= floor)
        .sort((a, b) => b.impressions - a.impressions)
        .map((r) => ({ ...r, page: landing.get(r.query)?.page ?? null, path: landing.get(r.query)?.path ?? null, ...(early && r.impressions < early.standard ? { early: true } : {}) })),
    }),
    early ? `Queries at average position 4 to 20, shown at least once. ${early.line} ${EARLY_RULE}` : `Queries at average position 4 to 20 shown at least ${floor} times.`,
  );
}

/** The position bands pages are compared within. A page at 2 and a page at 15 do not share a fair CTR. */
const BANDS: [number, number, string][] = [
  [1, 3, "1 to 3"],
  [3, 6, "4 to 6"],
  [6, 10, "7 to 10"],
  [10, 20, "11 to 20"],
  [20, Infinity, "beyond 20"],
];

export interface CtrOutlier extends Figures {
  page: string;
  path: string;
  /** The yardstick: the median CTR, in percent, of this site's own pages in the same band. */
  median: number;
  band: string;
  /** How many pages the median was taken over. */
  peers: number;
}

/** The least number of pages a position band needs, each shown `floor` times, before their click rates are compared. */
const PEERS = 3;

/**
 * Pages whose CTR is less than half the median CTR of this site's own pages
 * at a similar position.
 *
 * THE YARDSTICK IS OURS. Google publishes no expected CTR. The comparison is
 * a page against its neighbours on this site, in five position bands, and
 * only where a band holds at least three pages shown `floor` times or more
 * and the median of their CTR is above zero.
 *
 * NO EARLY MODE: click rates on a handful of clicks are noise. When no band
 * can be compared at all, the reading waits and says so with the window's
 * actual clicks and impressions; an empty list is kept for the case where
 * bands were compared and no page fell under half their median.
 */
export async function ctrOutliers(range: Range, o: { floor?: number } = {}): Promise<Reading<{ window: DayWindow; floor: number; rows: CtrOutlier[] }>> {
  const floor = o.floor ?? FLOOR.ctr;
  const p = await pages(range);
  if (p.state !== "ok") return p;
  const out: CtrOutlier[] = [];
  let compared = 0;
  for (const [from, to, band] of BANDS) {
    const inBand = p.value.rows.filter((r) => r.impressions >= floor && r.position > (from === 1 ? 0 : from) && r.position <= to);
    const mid = median(inBand.map((r) => r.ctr));
    if (inBand.length < PEERS || mid === null || mid === 0) continue;
    compared++;
    for (const r of inBand) {
      if (r.ctr < mid / 2) out.push({ page: r.page, path: r.path, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position, median: round(mid, 2), band, peers: inBand.length });
    }
  }
  if (!compared) {
    /* The window's own totals, as the overview shows them; the page rows when they cannot be read (they count an impression once per page shown). */
    const t = await totalsByDay(range);
    const clicks = t.state === "ok" ? t.value.clicks.value : p.value.rows.reduce((n, r) => n + r.clicks, 0);
    const impressions = t.state === "ok" ? t.value.impressions.value : p.value.rows.reduce((n, r) => n + r.impressions, 0);
    const shown = p.value.rows.filter((r) => r.impressions >= floor).length;
    return waiting(
      "gsc",
      `Too few to compare click rates: ${count(clicks, "click")} and ${count(impressions, "impression")} in this window, ${shown ? `and ${count(shown, "page")} shown at least ${floor} times` : `and no page shown ${floor} times`}. This list starts when ${PEERS} pages at a similar position have each been shown at least ${floor} times, with clicks among them.`,
    );
  }
  out.sort((a, b) => b.impressions - a.impressions);
  return derived(
    p,
    (v) => ({ window: v.window, floor, rows: out }),
    `Our own yardstick, not Google's: a page is listed when its CTR is under half the median of this site's pages in the same position band (pages shown at least ${floor} times). Google publishes no expected CTR.`,
  );
}

/** A page as the crawl knows it: enough to tell whether it is about a query. */
export interface PageTitle {
  path: string;
  title: string;
  h1?: string | null;
}

export interface Gap extends Figures {
  query: string;
  /** The page Google shows for it today, when known: the nearest thing the site has. */
  page: string | null;
  path: string | null;
  /** Listed by an early list and shown fewer times than the standard floor (EARLY above). */
  early?: boolean;
}

/** Words that say nothing about what a query is about, in the site's two languages. */
const SMALL = new Set("a an and are as at be by for from how in is it of on or the to what with der die das und für mit von im in zu ein eine was wie ist".split(" "));

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !SMALL.has(t));

/**
 * Queries the site is shown for although no page is about them: none of the
 * given pages carries all of the query's words in its title or h1.
 *
 * It only finds gaps among queries Google already shows the site for; what
 * people search and never see the site for is not knowable for free. In an
 * early list, from one impression up, the rows under the floor marked (EARLY).
 */
export async function gaps(range: Range, pageTitles: PageTitle[], o: { floor?: number } = {}): Promise<Reading<QueryRule<Gap>>> {
  const [q, qp] = await Promise.all([queries(range), queryPages(range)]);
  if (q.state !== "ok") return q;
  const landing = landingOf(qp);
  const heads = pageTitles.map((p) => new Set(words(`${p.title} ${p.h1 ?? ""}`)));
  const unanswered = q.value.rows.filter((r) => {
    const terms = words(r.query);
    return terms.length > 0 && !heads.some((h) => terms.every((t) => h.has(t)));
  });
  const { floor, early } = floorFor({ own: unanswered, all: q.value.rows }, FLOOR.gaps, o.floor, UNDER.gaps);
  return derived(
    q,
    (v) => ({
      window: v.window,
      floor,
      early,
      rows: unanswered
        .filter((r) => r.impressions >= floor)
        .sort((a, b) => b.impressions - a.impressions)
        .map(({ previous: _previous, ...r }) => ({
          ...r,
          page: landing.get(r.query)?.page ?? null,
          path: landing.get(r.query)?.path ?? null,
          ...(early && r.impressions < early.standard ? { early: true } : {}),
        })),
    }),
    early
      ? `Queries shown at least once for which no page's title or h1 contains every word of the query. Our own rule. ${early.line} ${EARLY_RULE}`
      : `Queries shown at least ${floor} times for which no page's title or h1 contains every word of the query. Our own rule.`,
  );
}

/* ---------- sitemaps ----------------------------------------------------- */

export interface SitemapStatus {
  path: string;
  lastSubmitted: string | null;
  lastDownloaded: string | null;
  isPending: boolean;
  isIndex: boolean;
  type: string | null;
  warnings: number;
  errors: number;
  /** Addresses Google counted in the file, over every content type. */
  submitted: number;
}

/** The sitemaps Search Console knows for the property, and what it made of each. */
export function sitemaps(o: ReadOptions = {}): Promise<Reading<SitemapStatus[]>> {
  return guarded(async (site) => {
    const had = await cached<SitemapStatus[]>("gsc:sitemaps", o.fresh ? 0 : KEEP, async () => {
      const got = await call<{
        sitemap?: { path?: string; lastSubmitted?: string; lastDownloaded?: string; isPending?: boolean; isSitemapsIndex?: boolean; type?: string; warnings?: string | number; errors?: string | number; contents?: { submitted?: string | number }[] }[];
      }>("GET", `${API()}/sites/${encodeURIComponent(site)}/sitemaps`);
      return (got.sitemap ?? []).map((s) => ({
        path: String(s.path ?? ""),
        lastSubmitted: s.lastSubmitted ?? null,
        lastDownloaded: s.lastDownloaded ?? null,
        isPending: !!s.isPending,
        isIndex: !!s.isSitemapsIndex,
        type: s.type ?? null,
        /* Google sends these counts as strings. */
        warnings: Number(s.warnings ?? 0),
        errors: Number(s.errors ?? 0),
        submitted: (s.contents ?? []).reduce((n, c) => n + Number(c.submitted ?? 0), 0),
      }));
    });
    if (!had.value.length) return waiting("gsc", "No sitemap has been submitted to this Search Console property.");
    return asReading("gsc", had);
  });
}

/* ---------- is each page in the index ------------------------------------ */

db.exec(`
  CREATE TABLE IF NOT EXISTS cc_inspect (
    day              TEXT NOT NULL,
    url              TEXT NOT NULL,
    verdict          TEXT,
    coverage         TEXT,
    last_crawl       TEXT,
    google_canonical TEXT,
    user_canonical   TEXT,
    robots_state     TEXT,
    fetch_state      TEXT,
    indexing_state   TEXT,
    is_indexed       INTEGER NOT NULL,
    /* 1 the two canonicals agree, 0 they differ, NULL Google named none. */
    canonical_ok     INTEGER,
    link             TEXT,
    checked_at       TEXT NOT NULL,
    PRIMARY KEY (day, url)
  );
  CREATE INDEX IF NOT EXISTS cc_inspect_url ON cc_inspect (url, day DESC);
`);

/** What Google has stored about one address. Its indexed version, not a live test. */
export interface Inspection {
  url: string;
  path: string;
  /** PASS (indexed), NEUTRAL (excluded), FAIL (error), or null. */
  verdict: string | null;
  /** Google's own words: "Submitted and indexed", "Crawled - currently not indexed", ... */
  coverage: string | null;
  lastCrawl: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  robots: string | null;
  fetchState: string | null;
  indexing: string | null;
  indexed: boolean;
  /** Null when Google chose no canonical (a page it has not crawled). */
  canonicalOk: boolean | null;
  /** The address of this result in Search Console itself. */
  link: string | null;
}

async function inspect(site: string, url: string): Promise<Inspection> {
  const got = await call<{
    inspectionResult?: {
      inspectionResultLink?: string;
      indexStatusResult?: { verdict?: string; coverageState?: string; robotsTxtState?: string; indexingState?: string; lastCrawlTime?: string; pageFetchState?: string; googleCanonical?: string; userCanonical?: string };
    };
  }>("POST", `${INSPECT()}/urlInspection/index:inspect`, { inspectionUrl: url, siteUrl: site, languageCode: "en" });
  const r = got.inspectionResult?.indexStatusResult ?? {};
  const googleCanonical = r.googleCanonical ?? null;
  const userCanonical = r.userCanonical ?? null;
  return {
    url,
    path: pathOf(url),
    verdict: r.verdict ?? null,
    coverage: r.coverageState ?? null,
    lastCrawl: r.lastCrawlTime ?? null,
    googleCanonical,
    userCanonical,
    robots: r.robotsTxtState ?? null,
    fetchState: r.pageFetchState ?? null,
    indexing: r.indexingState ?? null,
    /* PASS is Search Console's "valid": the address is in the index. */
    indexed: r.verdict === "PASS",
    /* The front page's canonical and its sitemap address differ by a trailing
       slash; compared as written that is a false alarm every day. */
    canonicalOk: googleCanonical ? sameAddress(googleCanonical, userCanonical ?? url) : null,
    link: got.inspectionResult?.inspectionResultLink ?? null,
  };
}

/** Every address in the website's sitemap. One GET, or a few when it is an index of sitemaps. */
export async function sitemapAddresses(): Promise<string[]> {
  const read = async (url: string): Promise<string> =>
    gate(async () => {
      const res = await fetch(url, { headers: { "user-agent": "balkaris-desk" }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`the sitemap answered ${res.status}`);
      return res.text();
    });
  const locs = (xml: string) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));

  const first = await read(SITEMAP());
  if (!/<sitemapindex[\s>]/.test(first)) return [...new Set(locs(first))];
  const out = new Set<string>();
  for (const child of locs(first).slice(0, 10)) for (const u of locs(await read(child))) out.add(u);
  return [...out];
}

/** The address of the website's own sitemap, the one whose addresses the daily check inspects. */
export const sitemapUrl = (): string => SITEMAP();

/** Google allows 2,000 inspections a day per property; the desk stops well short, however often the job is started. */
const INSPECT_DAILY = 1800;

/** How much of the day's inspection allowance is used (Google counts its day in Pacific Time). No request. */
export function inspectAllowance(): { used: number; of: number } {
  return { used: countOn("gsc.inspect.used", dayIn(PACIFIC)), of: INSPECT_DAILY };
}

/**
 * The addresses the sitemap listed when it was last read for a check, with
 * the day. Kept because a count alone ("98") cannot say WHICH addresses a
 * cut-short day still owes, nor which ones left the sitemap since. Before the
 * list was kept, the addresses of the newest whole day stand in for it.
 */
function lastListed(): { day: string; urls: string[] } | null {
  try {
    const had = JSON.parse(state("gsc.inspect.listed") ?? "null") as { day?: string; urls?: string[] } | null;
    if (had?.day && Array.isArray(had.urls) && had.urls.length) return { day: had.day, urls: had.urls.map(String) };
  } catch {
    /* fall through to the table */
  }
  const whole = db
    .prepare(
      `SELECT i.day AS day FROM cc_inspect i JOIN cc_series s ON s.metric = 'gsc.sitemap_addresses' AND s.day = i.day
       GROUP BY i.day HAVING COUNT(*) >= MAX(s.value) ORDER BY i.day DESC LIMIT 1`,
    )
    .get() as { day: string } | undefined;
  if (!whole) return null;
  return { day: whole.day, urls: (db.prepare("SELECT url FROM cc_inspect WHERE day = ? ORDER BY url").all(whole.day) as { url: string }[]).map((r) => r.url) };
}

const PUT_INSPECTION = `INSERT INTO cc_inspect (day, url, verdict, coverage, last_crawl, google_canonical, user_canonical, robots_state, fetch_state, indexing_state, is_indexed, canonical_ok, link, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(day, url) DO UPDATE SET verdict = excluded.verdict, coverage = excluded.coverage, last_crawl = excluded.last_crawl,
       google_canonical = excluded.google_canonical, user_canonical = excluded.user_canonical, robots_state = excluded.robots_state,
       fetch_state = excluded.fetch_state, indexing_state = excluded.indexing_state, is_indexed = excluded.is_indexed,
       canonical_ok = excluded.canonical_ok, link = excluded.link, checked_at = excluded.checked_at`;

const inspectionArgs = (day: string, r: Inspection): (string | number | null)[] => [
  day,
  r.url,
  r.verdict,
  r.coverage,
  r.lastCrawl,
  r.googleCanonical,
  r.userCanonical,
  r.robots,
  r.fetchState,
  r.indexing,
  r.indexed ? 1 : 0,
  r.canonicalOk === null ? null : r.canonicalOk ? 1 : 0,
  r.link,
  new Date().toISOString(),
];

interface Stored {
  day: string;
  url: string;
  verdict: string | null;
  coverage: string | null;
  last_crawl: string | null;
  google_canonical: string | null;
  user_canonical: string | null;
  robots_state: string | null;
  fetch_state: string | null;
  indexing_state: string | null;
  is_indexed: number;
  canonical_ok: number | null;
  link: string | null;
  checked_at: string;
}

/**
 * The daily index check: inspect every sitemap address, keep the result under
 * `day`, write the counts into the daily series, and say what changed since
 * the last day each address was looked at.
 *
 * "Google indexed /x" is written when an address that was NOT indexed the
 * last time is indexed now. The first day an address is ever seen writes
 * nothing: all it would say is that the desk started looking. We learn of a
 * change on the next daily check, not when it happens; Google sends no event.
 *
 * A RUN MAY BE CUT SHORT (Google failing, the daily allowance running out
 * after a few runs by hand). So the day's counts are taken from every result
 * kept for the day, never from this run alone, and they are written only once
 * every sitemap address has a result for the day: part of the site counted as
 * the whole would draw a drop in the index that never happened. Addresses
 * without a result yet for the day are asked first, so a second run finishes
 * what the first could not.
 *
 * Returns the line shown beside the run.
 */
export async function inspectAll(day: string = today(), o: { progress?: (done: number, of: number, what?: string) => void } = {}): Promise<string> {
  const a = await ensure();
  if (a.state !== "ok" || !a.site) throw new Error(reasonFor(a));
  const site = a.site;

  /* Google's day for the quota is the Pacific one. */
  const quotaDay = dayIn(PACIFIC);
  const used = countOn("gsc.inspect.used", quotaDay);
  /* The website not answering does not stop Google being asked about it: URL
     Inspection reads Google's own record. So when the sitemap cannot be read,
     the addresses of the last check stand in, and the run's line says so. */
  let all: string[];
  let stoodIn = "";
  try {
    all = await sitemapAddresses();
  } catch (e) {
    const had = lastListed();
    if (!had) throw e;
    all = had.urls;
    stoodIn = `; the website's sitemap could not be read (${(e instanceof Error ? e.message : String(e)).slice(0, 60)}), so the addresses of the check on ${had.day} were asked`;
  }
  const hadResult = new Set((db.prepare("SELECT url FROM cc_inspect WHERE day = ?").all(day) as { url: string }[]).map((r) => r.url));
  const order = [...all.filter((u) => !hadResult.has(u)), ...all.filter((u) => hadResult.has(u))];
  const list = order.slice(0, Math.max(0, INSPECT_DAILY - used));
  if (!list.length) return all.length ? "Today's inspection allowance is used; nothing was asked." : "The sitemap lists no address.";
  /* The size of the whole the day is measured against: kept per day so a report can say "of how many". */
  record("gsc.sitemap_addresses", all.length, day);
  /* And which addresses they were, for the newest check only (see `lastListed`). */
  setState("gsc.inspect.listed", JSON.stringify({ day, urls: all }));

  const put = db.prepare(PUT_INSPECTION);
  const before = db.prepare("SELECT is_indexed FROM cc_inspect WHERE url = ? AND day < ? ORDER BY day DESC LIMIT 1");

  let done = 0;
  let missed = 0;
  let stop: unknown = null;
  const seen: Inspection[] = [];

  /* Two at a time: a hundred addresses take a minute or two and stay far under 600 a minute. */
  await inTurns(list, 2, async (url) => {
    if (stop) return;
    setCount("gsc.inspect.used", quotaDay, countOn("gsc.inspect.used", quotaDay) + 1);
    try {
      const r = await inspect(site, url);
      put.run(...inspectionArgs(day, r));
      seen.push(r);
    } catch (e) {
      /* One address Google will not inspect is a gap; a refusal of the key or
         the quota, or a source that has gone quiet, ends the run. */
      missed++;
      if (!(e instanceof SourceError) || e.kind === "auth" || e.kind === "forbidden" || e.kind === "quota" || missed > 5) stop = e;
    }
    o.progress?.(++done, list.length, pathOf(url));
  });
  if (stop && !seen.length) throw stop;

  let gained = 0;
  let lost = 0;
  for (const r of seen) {
    const was = before.get(r.url, day) as { is_indexed: number } | undefined;
    if (!was) continue;
    if (!was.is_indexed && r.indexed) {
      gained++;
      note("gsc.indexed", `Google indexed ${r.path}`, {
        tone: "good",
        ...(r.lastCrawl ? { detail: `Last crawled ${r.lastCrawl.slice(0, 10)}. Found by the daily index check.` } : { detail: "Found by the daily index check." }),
        ...(r.link ? { href: r.link } : {}),
        dedupe: `gsc.indexed:${r.path}:${day}`,
      });
    } else if (was.is_indexed && !r.indexed) {
      lost++;
      note("gsc.dropped", `Google no longer has ${r.path} in its index`, {
        tone: "warn",
        detail: r.coverage ? `Google says: ${r.coverage}.` : "Found by the daily index check.",
        ...(r.link ? { href: r.link } : {}),
        dedupe: `gsc.dropped:${r.path}:${day}`,
      });
    }
  }

  /* The day as a whole: every result kept for it, this run's and any earlier
     run's, over the addresses the sitemap lists now. */
  const listed = new Set(all);
  const results = (db.prepare("SELECT url, is_indexed, canonical_ok FROM cc_inspect WHERE day = ?").all(day) as { url: string; is_indexed: number; canonical_ok: number | null }[]).filter((r) =>
    listed.has(r.url),
  );
  const whole = results.length === all.length;
  const indexed = results.filter((r) => r.is_indexed).length;
  const differs = results.filter((r) => r.canonical_ok === 0).length;
  if (whole) {
    record("gsc.inspected", results.length, day);
    record("gsc.indexed", indexed, day);
    record("gsc.not_indexed", results.length - indexed, day);
    record("gsc.canonical_differs", differs, day);
  }

  /* A year and a bit of days is all a chart will ever draw. */
  db.prepare("DELETE FROM cc_inspect WHERE day < ?").run(addDays(day, -400));

  const counts = `${indexed} indexed, ${results.length - indexed} not${differs ? `, ${differs} with a canonical Google did not accept` : ""}`;
  const outcome = !whole
    ? `; ${results.length} of ${all.length} have a result for ${day}, too few to count the day (${counts} so far)`
    : seen.length === all.length
      ? `: ${counts}`
      : `; with the day's earlier results: ${counts}`;
  const line = `${seen.length} of ${all.length} addresses inspected${outcome}${gained ? `; ${gained} newly indexed` : ""}${lost ? `; ${lost} dropped` : ""}${stoodIn}`;
  if (stop) throw new Error(`${line}. Stopped early: ${stop instanceof Error ? stop.message : String(stop)}`);
  return line;
}

export interface IndexReport {
  /** The day of the check, in Zurich. */
  day: string;
  /** Addresses with a result for that day. */
  inspected: number;
  /**
   * How many addresses the sitemap listed when that day was checked: the
   * whole `inspected` is part of. Null for a day checked before this was
   * kept. Always set by `indexing()`; optional only so that a value built
   * elsewhere (a screen's specimen) still fits the type.
   */
  of?: number | null;
  /**
   * False when the day's check was cut short (Google failing, the daily
   * allowance used up) and not every sitemap address has a result. Then the
   * counts below are a PART of the site and must not be shown as its total.
   * Always set by `indexing()`; treat a missing value as false.
   */
  complete?: boolean;
  indexed: number;
  notIndexed: number;
  /** Addresses where Google chose a different canonical than the page declares. */
  canonicalDiffers: number;
  rows: Inspection[];
}

const inspectionOf = (r: Stored): Inspection => ({
  url: r.url,
  path: pathOf(r.url),
  verdict: r.verdict,
  coverage: r.coverage,
  lastCrawl: r.last_crawl,
  googleCanonical: r.google_canonical,
  userCanonical: r.user_canonical,
  robots: r.robots_state,
  fetchState: r.fetch_state,
  indexing: r.indexing_state,
  indexed: !!r.is_indexed,
  canonicalOk: r.canonical_ok === null ? null : !!r.canonical_ok,
  link: r.link,
});

/**
 * The newest daily index check: how many sitemap addresses Google has, and
 * each address with Google's own words about it. This stands in for the
 * "Page indexing" report, which no API gives: the whole is the sitemap, not
 * every address Google ever saw. When that day's check was cut short,
 * `complete` is false and the note says how much of the sitemap it covers.
 */
export async function indexing(): Promise<Reading<IndexReport>> {
  return guarded(async () => {
    const last = { d: newestCheckDay() };
    if (!last.d) return waiting("gsc", "The first daily index check has not run yet.");
    /* The day's results for the sitemap's addresses: one address a person asked about by hand (Inspect now, src/cc/seo/google-actions.ts, kept in this table under the day it was asked) that the sitemap does not list is not part of the check. */
    const listed = listedOn(last.d);
    const list = (db.prepare("SELECT * FROM cc_inspect WHERE day = ? ORDER BY is_indexed, url").all(last.d) as unknown as Stored[]).filter((r) => !listed || listed.has(r.url));
    const indexed = list.filter((r) => r.is_indexed).length;
    const size = db.prepare("SELECT value FROM cc_series WHERE metric = 'gsc.sitemap_addresses' AND day = ?").get(last.d) as { value: number } | undefined;
    const of = size ? size.value : null;
    const complete = of !== null && list.length >= of;
    return ok(
      {
        day: last.d,
        inspected: list.length,
        of,
        complete,
        indexed,
        notIndexed: list.length - indexed,
        canonicalDiffers: list.filter((r) => r.canonical_ok === 0).length,
        rows: list.map(inspectionOf),
      },
      "gsc",
      list.reduce((t, r) => (r.checked_at > t ? r.checked_at : t), ""),
      [
        "Google's stored state for each address in the sitemap, checked once a day. Not the total of Search Console's Page indexing report, which no API gives.",
        complete ? "" : `The check on ${last.d} was cut short: ${list.length} of ${of ?? "the"} sitemap addresses have a result, so these counts are part of the site, not its total.`,
      ]
        .filter(Boolean)
        .join(" "),
    );
  });
}

/**
 * The day of the newest daily check: the newest day `inspectAll` wrote the
 * sitemap's size for. One address asked by hand on a later day (Inspect now, google-actions.ts)
 * is a result, not a check of the site, and must not be taken for one. For
 * results kept before sizes were, the newest day with any result.
 */
function newestCheckDay(): string | null {
  const sized = db.prepare("SELECT MAX(s.day) AS d FROM cc_series s WHERE s.metric = 'gsc.sitemap_addresses' AND EXISTS (SELECT 1 FROM cc_inspect i WHERE i.day = s.day)").get() as { d: string | null };
  if (sized.d) return sized.d;
  return (db.prepare("SELECT MAX(day) AS d FROM cc_inspect").get() as { d: string | null }).d;
}

/** The addresses the sitemap listed at the check of `day`, when that is the list kept; else null (not known). */
function listedOn(day: string): Set<string> | null {
  try {
    const had = JSON.parse(state("gsc.inspect.listed") ?? "null") as { day?: string; urls?: string[] } | null;
    return had?.day === day && Array.isArray(had.urls) ? new Set(had.urls.map(String)) : null;
  } catch {
    return null;
  }
}

/** One address as the desk last heard of it from Google, with the day it was asked. */
export interface StoodInspection extends Inspection {
  /** The day (Zurich) this result was asked for: the newest check's, or an earlier one's when that check did not reach the address. */
  day: string;
  checkedAt: string;
  /** False for an address the sitemap did not list at the newest check (one a person asked about by hand). */
  listed: boolean;
}

export interface IndexStand {
  /** The day of the newest daily check. */
  day: string;
  /** Addresses the sitemap listed at that check; null for a day checked before this was kept. */
  of: number | null;
  /** Results that check wrote itself. */
  checked: number;
  /** False when that check was cut short: fewer results than the sitemap listed. */
  dayComplete: boolean;
  /** Sitemap addresses shown as last checked on an earlier day, because the newest check did not reach them. */
  carried: number;
  /** The oldest day a carried result is from; null when none is carried. */
  carriedFrom: string | null;
  /** True when every address the sitemap listed has a result here, the newest check's or a carried one. */
  complete: boolean;
  /** Over `rows`. */
  indexed: number;
  notIndexed: number;
  canonicalDiffers: number;
  rows: StoodInspection[];
}

/** How far back an earlier result may stand in for an address the newest check did not reach. Older than this it says too little about today. */
const STAND_DAYS = 7;

/**
 * WHERE EVERY ADDRESS STANDS: the newest result the desk holds for each
 * sitemap address. `indexing()` above answers for one day and says when that
 * day is a part; a person working through "not indexed" needs the whole list
 * even when Google failed halfway through last night's check. So here an
 * address the newest check did not reach keeps its result from the last day
 * it was asked (at most a week back), each row carries its own day, and the
 * note says how many are carried. An address that left the sitemap is not
 * carried, when the desk knows which the sitemap listed. No request.
 *
 * `paths` is the desk's own last read of the website's sitemap (the paths it
 * lists, src/cc/site/sitemap.ts), passed in by the caller so this file does
 * not read the website: it says which addresses are the sitemap's when the
 * check did not keep its own list (results kept before it did), so an
 * address a person asked about by hand that day is not taken for one.
 */
export async function indexStand(paths: Set<string> | null = null): Promise<Reading<IndexStand>> {
  return guarded(async () => {
    const day = newestCheckDay();
    if (!day) return waiting("gsc", "The first daily index check has not run yet.");
    const newest = db
      .prepare(
        `SELECT i.* FROM cc_inspect i JOIN (SELECT url, MAX(day) AS d FROM cc_inspect WHERE day >= ? GROUP BY url) n ON n.url = i.url AND n.d = i.day ORDER BY i.is_indexed, i.url`,
      )
      .all(addDays(day, -STAND_DAYS)) as unknown as Stored[];
    const size = db.prepare("SELECT value FROM cc_series WHERE metric = 'gsc.sitemap_addresses' AND day = ?").get(day) as { value: number } | undefined;
    const of = size ? size.value : null;
    const dayUrls = (db.prepare("SELECT url FROM cc_inspect WHERE day = ?").all(day) as { url: string }[]).map((r) => r.url);
    /* Which addresses are the sitemap's: the list kept at this check; without one, the paths the desk's own
       read of the sitemap lists; without that, what a whole check asked about, or (cut short) that and the
       addresses of the last whole check. Null: not known, every row counts. */
    const exact = listedOn(day);
    const byPath = !exact && paths && paths.size ? paths : null;
    const known = (url: string): boolean => (exact ? exact.has(url) : byPath ? byPath.has(pathOf(url)) : true);
    const checked = dayUrls.filter(known).length;
    const dayComplete = of !== null && checked >= of;
    let sitemap: Set<string> | null = exact;
    if (!sitemap && !byPath) {
      const last = dayComplete ? null : lastListed();
      sitemap = dayComplete ? new Set(dayUrls) : last ? new Set([...dayUrls, ...last.urls]) : null;
    }
    const inSitemap = (url: string): boolean => (byPath ? byPath.has(pathOf(url)) : !sitemap || sitemap.has(url));
    /* The check's own results and anything asked since stay; an earlier result stands in only for an address the sitemap still lists. */
    const kept = newest.filter((r) => r.day >= day || inSitemap(r.url));
    const old = kept.filter((r) => r.day < day);
    const rows: StoodInspection[] = kept.map((r) => ({ ...inspectionOf(r), day: r.day, checkedAt: r.checked_at, listed: inSitemap(r.url) }));
    const inList = rows.filter((r) => r.listed).length;
    const complete = of !== null && inList >= of;
    const indexed = rows.filter((r) => r.indexed).length;
    return ok(
      {
        day,
        of,
        checked,
        dayComplete,
        carried: old.length,
        carriedFrom: old.length ? old.reduce((d, r) => (r.day < d ? r.day : d), old[0]!.day) : null,
        complete,
        indexed,
        notIndexed: rows.length - indexed,
        canonicalDiffers: rows.filter((r) => r.canonicalOk === false).length,
        rows,
      },
      "gsc",
      kept.reduce((t, r) => (r.checked_at > t ? r.checked_at : t), ""),
      [
        "Google's stored state for each address in the sitemap, checked once a day. Not the total of Search Console's Page indexing report, which no API gives.",
        dayComplete ? "" : `The check on ${day} was cut short: ${checked} of ${of ?? "the"} sitemap addresses have a result for that day.`,
        old.length ? `${old.length} ${old.length === 1 ? "address is" : "addresses are"} shown as last checked on an earlier day (back to ${old.reduce((d, r) => (r.day < d ? r.day : d), old[0]!.day)}); each row says which.` : "",
        !complete && of !== null ? `${Math.max(0, of - inList)} of the sitemap's ${of} addresses have no result from the last ${STAND_DAYS} days.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  });
}

/** Indexed and not-indexed counts per day, from the day the desk started checking. Only days whose check covered the whole sitemap. No request. */
export function indexHistory(days = 90): { day: string; indexed: number; notIndexed: number }[] {
  const not = new Map(series("gsc.not_indexed", days).map((p) => [p.day, p.value]));
  return series("gsc.indexed", days).map((p) => ({ day: p.day, indexed: p.value, notIndexed: not.get(p.day) ?? 0 }));
}

/* ---------- for the SEO engine's own history (src/cc/seo/rank.ts) -------- */

/**
 * The newest day Google has finished counting (dataState final): the day
 * every window of the screens ends on. Kept six hours, like the screens' own.
 * Off with the step while Search Console cannot be read.
 */
export function newestFinalDay(): Promise<Reading<string>> {
  return guarded(async (site) => ok(await lastFinalDay(site), "gsc", new Date().toISOString(), "The newest day Google has finished counting."));
}

/**
 * One Search Analytics question asked now and NOT kept in cc_cache. The SEO
 * engine keeps the answer in its own tables (one snapshot per day), so a
 * cached copy would only be a second, older store of the same rows. Both
 * dates must be given; the row limit pages as `query` does (at most 100,000).
 */
export function rawRows(q: {
  start: string;
  end: string;
  dimensions: Dimension[];
  filters?: Filter[];
  dataState?: DataState;
  limit?: number;
}): Promise<Reading<{ rows: Row[]; complete: boolean; firstIncompleteDate: string | null }>> {
  return guarded(async (site) => ok(await rows(site, { ...q, limit: q.limit ?? 25_000 }), "gsc", new Date().toISOString(), caveat(q)));
}

/* ---------- the scheduled work ------------------------------------------- */

const WARM: Range[] = ["7d", "30d", "90d"];

/**
 * Ask Google again for everything the screens show, so that no screen has to.
 * Also writes clicks, impressions and position per day into the desk's own
 * series: Search Console forgets after sixteen months, the desk does not.
 */
async function warm(): Promise<string> {
  const failures: string[] = [];
  let through = "";
  /* The general door keeps one answer per wording, and a screen may word it
     by what a person typed (a page, a term). Nothing else ever deletes them,
     so answers older than two days go here: well past their six hours, and
     still long enough to stand in, marked stale, while Google is down. */
  db.prepare("DELETE FROM cc_cache WHERE key LIKE 'gsc:q:%' AND at < ?").run(Date.now() - 48 * HOUR);
  /* Which day Google has finished is asked again once, here, for every read below. */
  forget("gsc:anchor");
  for (const range of WARM) {
    const reads: [string, Reading<unknown>][] = [
      ["totals", await totalsByDay(range, { fresh: true })],
      ["queries", await queries(range, { fresh: true })],
      ["pages", await pages(range, { fresh: true })],
      ["query-pages", await queryPages(range, { fresh: true })],
      ["countries", await byCountry(range, { fresh: true })],
      ["devices", await byDevice(range, { fresh: true })],
      ["buckets", await positionBuckets(range, { fresh: true })],
    ];
    for (const [name, r] of reads) {
      if (r.state === "off") throw new Error(r.reason);
      if (r.state === "waiting" && r.reason.startsWith("The last read failed")) failures.push(`${name} ${range}`);
    }
    const totals = reads[0]![1] as Reading<SearchTotals>;
    if (range === "90d" && totals.state === "ok") {
      through = totals.value.window.end;
      for (const d of totals.value.days) {
        record("gsc.clicks", d.clicks, d.date);
        record("gsc.impressions", d.impressions, d.date);
        if (d.position !== null) record("gsc.position", d.position, d.date);
      }
    }
  }
  const maps = await sitemaps({ fresh: true });
  if (maps.state === "waiting" && maps.reason.startsWith("The last read failed")) failures.push("sitemaps");
  if (failures.length) throw new Error(`Some reads failed and kept their last answer: ${failures.join(", ")}`);
  return through ? `Search figures refreshed for 7, 30 and 90 days, final up to ${through}` : "Search Console is connected and has no figures yet";
}

/* How many of today's index checks failed (Google answering 500 halfway, the sitemap not readable). In the
   database, like every count here: the desk restarts on each deploy and must not forget it owes a retry. */
const INSPECT_FAILS = "gsc.inspect.fails";
const INSPECT_RETRIES = 3;

const INSPECT_RETRY_MS = HOUR;

/**
 * How a retry is asked for: after a wait, through the scheduler's own queue,
 * so it runs like any other run (one job at a time, the owner's off switch
 * respected). A check replaces `later` and `ask` to see what would be asked.
 */
export const inspectRetry = {
  later: (ms: number, run: () => void): void => void setTimeout(run, ms).unref(),
  ask: (): boolean => runNow("gsc-inspect"),
};

/** True while today's index check has failed and has tries left. */
const retryOwed = (day: string = today()): boolean => {
  const fails = countOn(INSPECT_FAILS, day);
  return fails > 0 && fails <= INSPECT_RETRIES;
};

function planRetry(ms: number): void {
  setState("gsc.inspect.retry", new Date(Date.now() + ms).toISOString());
  inspectRetry.later(ms, () => {
    /* A person may have run it by hand in the meantime, and it worked: then nothing is owed. */
    if (retryOwed()) inspectRetry.ask();
  });
}

/** When the next retry of a failed index check is planned, ISO; null when none is owed. */
export function inspectRetryAt(): string | null {
  return retryOwed() ? state("gsc.inspect.retry") : null;
}

/**
 * The daily index check as the scheduler runs it. A run that FAILED is asked
 * for again an hour later, at most three times that day. `inspectAll` is
 * written so that "a second run finishes what the first could not" (it asks
 * first for the addresses the day has no result for), and until this existed
 * nothing ever started that second run: one 500 from Google on 3 October 2026
 * left the day at 17 of 98 addresses until the next evening. A run the daily
 * allowance stopped is not a failure and is not retried: asking again would be
 * refused the same way.
 */
export async function inspectJob(progress?: (done: number, of: number, what?: string) => void): Promise<string> {
  const day = today();
  try {
    const line = await inspectAll(day, { progress });
    setCount(INSPECT_FAILS, day, 0);
    return line;
  } catch (e) {
    const fails = setCount(INSPECT_FAILS, day, countOn(INSPECT_FAILS, day) + 1);
    if (fails <= INSPECT_RETRIES) {
      planRetry(INSPECT_RETRY_MS);
      throw new Error(`${e instanceof Error ? e.message : String(e)}. Trying again in an hour (${fails} of ${INSPECT_RETRIES})`.slice(0, 300));
    }
    throw e;
  }
}

export const jobs: Job[] = [
  {
    /* The only job here that runs before Search Console is connected, and the
       reason the panels fill by themselves: it asks one cheap question until
       the answer is yes, then stops. Not being connected is its result, never
       its failure. */
    name: "gsc-access",
    title: "Ask whether Search Console is connected",
    every: 30 * 60,
    delay: 45,
    ready: () => hasKey() && access().state !== "ok",
    run: async () => {
      try {
        const a = await checkAccess();
        return a.state === "ok" ? `Connected: reading ${a.site}` : `Not connected yet. ${reasonFor(a)}`;
      } catch (e) {
        return `Could not ask: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  },
  {
    name: "gsc-daily",
    title: "Refresh search figures from Search Console",
    every: 12 * 3600,
    delay: 120,
    ready: configured,
    run: () => warm(),
  },
  {
    name: "gsc-inspect",
    title: "Ask Google which pages it has indexed",
    every: 24 * 3600,
    delay: 300,
    ready: configured,
    run: ({ progress }) => inspectJob(progress),
  },
];

/* A retry owed from before the desk restarted (it restarts on every deploy) is asked for again soon after it is up. */
if (retryOwed()) planRetry(10 * 60_000);
