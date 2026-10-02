import { db } from "../../db.ts";
import type { Range, Reading, SourceStatus, Stat } from "../../../web/src/contract/common.ts";
import type { Job } from "../scheduler.ts";
import { cached, note, off, record, series, setState, state, today, waiting } from "../store.ts";
import {
  answered,
  ask,
  asReading,
  base,
  dayIn,
  dayWindow,
  type DayWindow,
  eachDay,
  failed,
  inTurns,
  kindOf,
  pathOf,
  placeOnBox,
  round,
  siteOrigin,
  SourceError,
  statusOf,
} from "./shared.ts";

/**
 * Bing Webmaster Tools: Bing's own view of the site.
 *
 * It is here for one thing Google gives nobody by API: INBOUND LINKS, with
 * the page that links and the words it links with. It also has Bing's own
 * search figures, its crawl problems and how much of the site it has indexed.
 *
 * EVERY LABEL SAYS BING. Bing sees far fewer links than Google and a small
 * share of the searches. A row from here must never read as Google's link
 * index or as "search traffic": the notes and the activity lines all name
 * Bing, and a screen that drops the word is wrong.
 *
 * The documentation is old (pages dated 2019 to 2023) and silent about how
 * fresh the figures are, how far back they reach and how often one may ask.
 * So this asks once a day, keeps the answers, and keeps the daily link count
 * in the desk's own series. What the real answers look like has to be read
 * once a key exists; until then the shapes are the documented samples.
 *
 *   https://learn.microsoft.com/en-us/bingwebmaster/getting-access
 *   https://learn.microsoft.com/en-us/bingwebmaster/getting-started
 *   https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi
 */

const API = (): string => base("BING_API_BASE", "https://ssl.bing.com/webmaster/api.svc/json");
const apiKey = (): string => (process.env.BING_API_KEY ?? "").trim();

/** The site as Bing Webmaster Tools has it. BING_SITE when it was added under another spelling. */
const site = (): string => process.env.BING_SITE ?? `${siteOrigin()}/`;

export const configured = (): boolean => !!apiKey();

const REASON = "Bing Webmaster Tools is not connected.";

/**
 * Menu path as documented at https://learn.microsoft.com/en-us/bingwebmaster/getting-access
 * (read 2 October 2026): Settings at the top right, API Access, accept the
 * terms the first time, API Key, Generate API Key. One key per user, valid
 * for all of that user's verified sites.
 */
export const step = (): string =>
  `Sign in to Bing Webmaster Tools (bing.com/webmasters), add and verify ${siteOrigin()}/ (it can be imported from Search Console), press Settings at the top right, open API Access, accept the terms the first time, press API Key and then Generate API Key, ${placeOnBox("BING_API_KEY")}.`;

const LABEL = "Bing only: Bing's own search and Bing's own index of links, not Google's.";

export function status(): SourceStatus {
  return statusOf({
    id: "bing",
    name: "Bing Webmaster Tools",
    feeds: "Inbound links with their anchor text (Bing's index), Bing search clicks and impressions, Bing's crawl problems",
    connected: configured(),
    offReason: REASON,
    step: step(),
  });
}

/* ---------- asking Bing --------------------------------------------------- */

/**
 * Bing answers a refused call with HTTP 400 and { ErrorCode, Message }
 * (ApiErrorCode: 3 InvalidApiKey, 4 ThrottleUser, 5 ThrottleHost, 6
 * UserBlocked, 13 NotAllowed, 14 NotAuthorized). A proxy in front of it may
 * still answer 401, 403 or 429, so the status is read as well.
 */
function refusal(status: number, json: unknown): SourceError {
  const body = (json ?? {}) as { ErrorCode?: number; Message?: string };
  const code = Number(body.ErrorCode ?? 0);
  const name = String(body.Message ?? "").slice(0, 80);
  if (code === 3 || status === 401) return new SourceError(status, "auth", "Bing refused the API key: it is mistyped, deleted or was replaced by a newer one", name || "InvalidApiKey");
  if (code === 4 || code === 5 || status === 429) return new SourceError(status, "quota", "Bing says the desk asked too often; it answers again by itself", name || "Throttle");
  if (code === 6 || code === 13 || code === 14 || status === 403)
    return new SourceError(status, "forbidden", "Bing says the key's account may not read this site: the site is not verified in that Bing Webmaster Tools account", name || "NotAuthorized");
  if (status >= 500) return new SourceError(status, "down", `Bing Webmaster answered ${status}`, name);
  return new SourceError(status, kindOf(status), `Bing Webmaster did not accept the request (${status}${name ? `, ${name}` : ""})`, name);
}

/**
 * One method of the JSON API. The key travels in the address, which is why
 * the address is never logged or put into an error. The answer is wrapped in
 * { "d": ... }.
 */
async function call<T>(method: string, params: Record<string, string | number> = {}): Promise<T> {
  try {
    if (!configured()) throw new SourceError(0, "auth", REASON, "NO_KEY");
    const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), apikey: apiKey() });
    const res = await ask("Bing Webmaster", `${API()}/${method}?${query}`, { timeout: 30_000 });
    if (res.status !== 200) throw refusal(res.status, res.json);
    answered("bing");
    return (res.json as { d?: T } | null)?.d as T;
  } catch (e) {
    failed("bing", e);
    throw e;
  }
}

/** "/Date(1316156400000-0700)/" as the day it names in its own offset: 2011-09-16. */
export function bingDay(value: unknown): string | null {
  const m = /\/Date\((-?\d+)([+-]\d{4})?\)\//.exec(String(value ?? ""));
  if (!m) return null;
  let ms = Number(m[1]);
  if (m[2]) ms += (m[2].startsWith("-") ? -1 : 1) * (Number(m[2].slice(1, 3)) * 60 + Number(m[2].slice(3))) * 60_000;
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
}

const HOUR = 3_600_000;
const KEEP = 26 * HOUR;

export interface ReadOptions {
  /** Ask Bing now instead of using the kept answer. The daily job does; a screen does not. */
  fresh?: boolean;
}

/** A kept answer as a reading, or the reason there is none. Makes no request when there is no key. */
async function read<T>(key: string, o: ReadOptions, askBing: () => Promise<T>, empty: (v: T) => string | null, more = ""): Promise<Reading<T>> {
  if (!configured()) return off("bing", REASON, step());
  try {
    const had = await cached<T>(`bing:${key}`, o.fresh ? 0 : KEEP, askBing);
    const nothing = empty(had.value);
    if (nothing) return waiting("bing", nothing);
    return asReading("bing", had, [LABEL, more].filter(Boolean).join(" "));
  } catch (e) {
    return waiting("bing", `The last read failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
  }
}

/* ---------- inbound links ------------------------------------------------- */

db.exec(`
  CREATE TABLE IF NOT EXISTS cc_bing_links (
    target     TEXT NOT NULL,
    source     TEXT NOT NULL,
    anchor     TEXT,
    first_seen TEXT NOT NULL,
    last_seen  TEXT NOT NULL,
    PRIMARY KEY (target, source)
  );
`);

export interface LinkedPage {
  /** The page on our site that is linked to. */
  url: string;
  path: string;
  /** How many inbound links Bing knows for it. */
  links: number;
}

export interface LinkCounts {
  /** Inbound links Bing knows, over all pages. */
  total: number;
  pages: LinkedPage[];
  /** False when Bing had more pages of results than were read. */
  complete: boolean;
}

/** Bing pages its link lists; twenty pages of them is more than this site will have for years. */
const LINK_PAGES = 20;

/** The pages of the site that Bing knows inbound links for, and how many each has. Most linked first. */
export function linkCounts(o: ReadOptions = {}): Promise<Reading<LinkCounts>> {
  return read<LinkCounts>(
    "link-counts",
    o,
    async () => {
      const pages: LinkedPage[] = [];
      let total = 1;
      let page = 0;
      for (; page < total && page < LINK_PAGES; page++) {
        const got = await call<{ Links?: { Url?: string; Count?: number }[]; TotalPages?: number } | null>("GetLinkCounts", { siteUrl: site(), page });
        total = Number(got?.TotalPages ?? 0);
        for (const l of got?.Links ?? []) if (l.Url) pages.push({ url: l.Url, path: pathOf(l.Url), links: Number(l.Count ?? 0) });
      }
      pages.sort((a, b) => b.links - a.links);
      return { total: pages.reduce((n, p) => n + p.links, 0), pages, complete: page >= total };
    },
    () => null,
    "A count of zero means Bing knows no link to the site, not that there is none.",
  );
}

export interface InboundLink {
  /** The page that links to us. */
  source: string;
  /** Its host, for a short label: "example.org". */
  host: string;
  /** The words of the link, as Bing read them. May be empty. */
  anchor: string;
  /** The page on our site it links to. */
  target: string;
  path: string;
  /** The day the desk first saw Bing report it. */
  firstSeen: string;
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/**
 * The inbound links to one page, read from Bing now and written into the
 * desk's own list. Returns the links that the desk had not seen before.
 *
 * `link` is sent as a plain address. Microsoft's JSON request sample sends it
 * JSON-quoted (link=%22http%3a%5c%2f%5c%2f…%22) while the same request passes
 * siteUrl plain, and the XML sample passes both plain
 * (https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi.geturllinks,
 * read 2 October 2026). Plain is what every other method here sends; if the
 * first real key gets InvalidUrl (ErrorCode 7) for every page, quoting this
 * one value is the change to make.
 */
async function pullLinks(target: string, day: string): Promise<{ source: string; anchor: string }[]> {
  const fresh: { source: string; anchor: string }[] = [];
  const known = db.prepare("SELECT 1 FROM cc_bing_links WHERE target = ? AND source = ?");
  const put = db.prepare(
    `INSERT INTO cc_bing_links (target, source, anchor, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(target, source) DO UPDATE SET anchor = excluded.anchor, last_seen = excluded.last_seen`,
  );
  let total = 1;
  for (let page = 0; page < total && page < 5; page++) {
    const got = await call<{ Details?: { Url?: string; AnchorText?: string }[]; TotalPages?: number } | null>("GetUrlLinks", { siteUrl: site(), link: target, page });
    total = Number(got?.TotalPages ?? 0);
    for (const d of got?.Details ?? []) {
      if (!d.Url) continue;
      const anchor = String(d.AnchorText ?? "").trim().slice(0, 200);
      if (!known.get(target, d.Url)) fresh.push({ source: d.Url, anchor });
      put.run(target, d.Url, anchor, day, day);
    }
  }
  return fresh;
}

/**
 * Every inbound link the desk has seen Bing report, newest first. No request:
 * it reads the desk's own list, which the daily job fills.
 */
export function inboundLinks(limit = 200): Reading<InboundLink[]> {
  if (!configured()) return off("bing", REASON, step());
  const rows = db.prepare("SELECT target, source, anchor, first_seen FROM cc_bing_links ORDER BY first_seen DESC, source LIMIT ?").all(limit) as {
    target: string;
    source: string;
    anchor: string | null;
    first_seen: string;
  }[];
  const at = state("bing.links.at");
  if (!at) return waiting("bing", "The first daily read of Bing's links has not run yet.");
  return {
    state: "ok",
    source: "bing",
    asOf: at,
    note: `${LABEL} The day beside a link is the day the desk first saw it, not the day it was made.`,
    value: rows.map((r) => ({ source: r.source, host: hostOf(r.source), anchor: r.anchor ?? "", target: r.target, path: pathOf(r.target), firstSeen: r.first_seen })),
  };
}

/** The links Bing knows to one page of the site, from the desk's own list. No request. */
export function linksTo(url: string): Reading<InboundLink[]> {
  const all = inboundLinks(5000);
  if (all.state !== "ok") return all;
  const path = pathOf(url);
  return { ...all, value: all.value.filter((l) => l.path === path) };
}

/* ---------- Bing's search figures ----------------------------------------- */

/** Bing's figures for one query or page. Positions are Bing's averages exactly as it sends them. */
export interface BingRow {
  /** The query, or for `pageStats` the page's address. */
  key: string;
  /** For a page, its path. */
  path?: string;
  clicks: number;
  impressions: number;
  /** Average position when shown, weighted by impressions. */
  avgImpressionPosition: number | null;
  /** Average position when clicked, weighted by clicks. Null without clicks. */
  avgClickPosition: number | null;
}

interface RawStat {
  Query?: string;
  Date?: string;
  Impressions?: number;
  Clicks?: number;
  AvgImpressionPosition?: number;
  AvgClickPosition?: number;
}

const SHORT = "Bing reports by the day and updates weekly at best, so it has no answer for the last hour or day. Choose seven days or longer.";

/** Bing sends one row per query and date; a range is the sum of the rows whose date falls inside it. */
function summed(raw: RawStat[], w: DayWindow, asPage: boolean): BingRow[] {
  const by = new Map<string, { clicks: number; impressions: number; shown: number; clicked: number }>();
  for (const r of raw) {
    const day = bingDay(r.Date);
    if (!r.Query || !day || day < w.start || day > w.end) continue;
    const t = by.get(r.Query) ?? { clicks: 0, impressions: 0, shown: 0, clicked: 0 };
    const clicks = Number(r.Clicks ?? 0);
    const impressions = Number(r.Impressions ?? 0);
    t.clicks += clicks;
    t.impressions += impressions;
    t.shown += Number(r.AvgImpressionPosition ?? 0) * impressions;
    t.clicked += Number(r.AvgClickPosition ?? 0) * clicks;
    by.set(r.Query, t);
  }
  return [...by.entries()]
    .map(([key, t]) => ({
      key,
      ...(asPage ? { path: pathOf(key) } : {}),
      clicks: t.clicks,
      impressions: t.impressions,
      avgImpressionPosition: t.impressions ? round(t.shown / t.impressions, 1) : null,
      avgClickPosition: t.clicks ? round(t.clicked / t.clicks, 1) : null,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
}

async function stats(method: "GetQueryStats" | "GetPageStats", range: Range, o: ReadOptions): Promise<Reading<{ window: DayWindow; rows: BingRow[] }>> {
  const w = dayWindow(range, dayIn("UTC"));
  if (!configured()) return off("bing", REASON, step());
  if (!w) return off("bing", SHORT);
  const raw = await read<RawStat[]>(method, o, async () => (await call<RawStat[] | null>(method, { siteUrl: site() })) ?? [], () => null);
  if (raw.state !== "ok") return raw;
  const list = summed(raw.value, w, method === "GetPageStats");
  if (!list.length) return waiting("bing", `Bing reports no searches for the site between ${w.start} and ${w.end}.`);
  return { ...raw, value: { window: w, rows: list }, note: `${LABEL} Bing updates these figures about once a week.` };
}

/** The queries Bing showed the site for in the range, most clicks first. */
export const queryStats = (range: Range, o: ReadOptions = {}): Promise<Reading<{ window: DayWindow; rows: BingRow[] }>> => stats("GetQueryStats", range, o);

/** The pages Bing showed in the range, most clicks first. `key` is the page's address. */
export const pageStats = (range: Range, o: ReadOptions = {}): Promise<Reading<{ window: DayWindow; rows: BingRow[] }>> => stats("GetPageStats", range, o);

export interface BingTraffic {
  window: DayWindow;
  clicks: Stat;
  impressions: Stat;
  days: { date: string; clicks: number; impressions: number }[];
}

/**
 * Bing's clicks and impressions per day, with the window before. Since March
 * 2023 Bing counts every surface in these (web, chat, news, images, videos),
 * so they are not web search alone. `previous` is null unless Bing's figures
 * reach back to the first day of the window before. `series` lines up with
 * `days`, which holds only the days Bing sent.
 */
export async function traffic(range: Range, o: ReadOptions = {}): Promise<Reading<BingTraffic>> {
  if (!configured()) return off("bing", REASON, step());
  const w = dayWindow(range, dayIn("UTC"));
  if (!w) return off("bing", SHORT);
  const raw = await read<{ Date?: string; Clicks?: number; Impressions?: number }[]>(
    "traffic",
    o,
    async () => (await call<{ Date?: string; Clicks?: number; Impressions?: number }[] | null>("GetRankAndTrafficStats", { siteUrl: site() })) ?? [],
    (v) => (v.length ? null : "Bing reports no traffic figures for the site yet."),
  );
  if (raw.state !== "ok") return raw;
  const by = new Map<string, { clicks: number; impressions: number }>();
  for (const r of raw.value) {
    const day = bingDay(r.Date);
    if (day) by.set(day, { clicks: Number(r.Clicks ?? 0), impressions: Number(r.Impressions ?? 0) });
  }
  const first = [...by.keys()].sort()[0] ?? w.start;
  /* A day Bing did not send is a day it has not counted yet (the newest ones)
     or a day before its history starts; neither is a zero, so neither is drawn. */
  const days = eachDay(w.start, w.end).flatMap((date) => (by.has(date) ? [{ date, ...by.get(date)! }] : []));
  const before = eachDay(w.previousStart, w.previousEnd).flatMap((date) => (by.has(date) ? [by.get(date)!] : []));
  const sum = (list: { clicks: number; impressions: number }[], k: "clicks" | "impressions") => list.reduce((n, d) => n + d[k], 0);
  /* Compared only when Bing's history covers the WHOLE window before: eleven
     counted days set against thirty would be growth that never happened.
     Search Console's totals follow the same rule. */
  const hadBefore = before.length > 0 && first <= w.previousStart;
  return {
    ...raw,
    note: `${LABEL} Every Bing surface is counted (web, chat, images, news), and the newest days arrive late.`,
    value: {
      window: w,
      clicks: { value: sum(days, "clicks"), previous: hadBefore ? sum(before, "clicks") : null, unit: "count", series: days.map((d) => d.clicks) },
      impressions: { value: sum(days, "impressions"), previous: hadBefore ? sum(before, "impressions") : null, unit: "count", series: days.map((d) => d.impressions) },
      days,
    },
  };
}

/* ---------- Bing's crawl --------------------------------------------------- */

/** UrlWithCrawlIssues.CrawlIssues is a set of flags; these are their names in words. */
const ISSUES: [number, string][] = [
  [1, "Redirects (301)"],
  [2, "Redirects (302)"],
  [4, "Answers 4xx"],
  [8, "Answers 5xx"],
  [16, "Blocked by robots.txt"],
  [32, "Contains malware"],
  [64, "Important address blocked by robots.txt"],
  [128, "DNS error"],
  [256, "Timed out"],
];

export interface CrawlIssue {
  url: string;
  path: string;
  httpCode: number | null;
  /** What Bing found wrong, in words. */
  issues: string[];
  /** How many links Bing knows to the address. */
  inLinks: number;
}

/** The addresses Bing could not crawl cleanly. An empty list is a good answer and comes back as one. */
export function crawlIssues(o: ReadOptions = {}): Promise<Reading<CrawlIssue[]>> {
  return read<CrawlIssue[]>(
    "crawl-issues",
    o,
    async () => {
      const got = (await call<{ Url?: string; HttpCode?: number; Issues?: number; InLinks?: number }[] | null>("GetCrawlIssues", { siteUrl: site() })) ?? [];
      return got
        .filter((r) => r.Url)
        .map((r) => ({
          url: r.Url!,
          path: pathOf(r.Url!),
          httpCode: r.HttpCode == null ? null : Number(r.HttpCode),
          issues: ISSUES.filter(([bit]) => (Number(r.Issues ?? 0) & bit) !== 0).map(([, name]) => name),
          inLinks: Number(r.InLinks ?? 0),
        }));
    },
    () => null,
    "A fixed problem can stay listed for a few days.",
  );
}

export interface CrawlDay {
  date: string;
  crawledPages: number;
  inIndex: number;
  inLinks: number;
  crawlErrors: number;
  code2xx: number;
  code301: number;
  code302: number;
  code4xx: number;
  code5xx: number;
  blockedByRobotsTxt: number;
}

/** What Bing's crawler did per day, for as far back as Bing keeps it (it says six months), oldest first. */
export function crawlStats(o: ReadOptions = {}): Promise<Reading<CrawlDay[]>> {
  return read<CrawlDay[]>(
    "crawl-stats",
    o,
    async () => {
      const got = (await call<Record<string, unknown>[] | null>("GetCrawlStats", { siteUrl: site() })) ?? [];
      const n = (r: Record<string, unknown>, k: string) => Number(r[k] ?? 0);
      return got
        .flatMap((r) => {
          const date = bingDay(r.Date);
          return date
            ? [
                {
                  date,
                  crawledPages: n(r, "CrawledPages"),
                  inIndex: n(r, "InIndex"),
                  inLinks: n(r, "InLinks"),
                  crawlErrors: n(r, "CrawlErrors"),
                  code2xx: n(r, "Code2xx"),
                  code301: n(r, "Code301"),
                  code302: n(r, "Code302"),
                  code4xx: n(r, "Code4xx"),
                  code5xx: n(r, "Code5xx"),
                  blockedByRobotsTxt: n(r, "BlockedByRobotsTxt"),
                },
              ]
            : [];
        })
        .sort((a, b) => a.date.localeCompare(b.date));
    },
    (v) => (v.length ? null : "Bing has no crawl figures for the site yet."),
  );
}

/* ---------- the daily read -------------------------------------------------- */

/** How many linked pages are opened for their links in one run, and how many new links are announced one by one. */
const OPEN = 40;
const ANNOUNCE = 10;

/**
 * Which linked pages have had their links read at least once, and which pages
 * Bing listed as linked last time. Together they decide whether a link the
 * desk has not seen is news: see `daily`.
 */
interface LinkMemo {
  read: string[];
  listed: string[];
}

function memo(): LinkMemo {
  try {
    const had = JSON.parse(state("bing.links.memo") ?? "null") as Partial<LinkMemo> | null;
    return { read: Array.isArray(had?.read) ? had.read : [], listed: Array.isArray(had?.listed) ? had.listed : [] };
  } catch {
    return { read: [], listed: [] };
  }
}

/**
 * Once a day: the link counts into the daily series, each linked page's
 * links into the desk's list, and "Bing found a new link from ..." for every
 * link not seen before.
 *
 * A link the desk has not seen is only NEWS when the desk could have seen it
 * before: the page's links were read on an earlier day, or the page was not
 * linked at all last time. The very first run, a page read for the first
 * time because it failed before or sat beyond the first forty, and a page
 * Bing will not answer for today, announce nothing: all they would say is
 * that the desk started looking.
 *
 * One page Bing refuses is skipped and named in the result; a refusal of the
 * key, the site or the rate ends the run.
 *
 * Returns the line shown beside the run. Exported so the check can run it on
 * a chosen day.
 */
export async function daily(day: string = today()): Promise<string> {
  const counts = await linkCounts({ fresh: true });
  if (counts.state === "off") throw new Error(counts.reason);
  if (counts.state === "waiting") throw new Error(counts.reason);

  record("bing.links", counts.value.total, day);
  record("bing.linked_pages", counts.value.pages.length, day);

  const baseline = !state("bing.links.at");
  const before = memo();
  const readBefore = new Set(before.read);
  const listedBefore = new Set(before.listed);
  const found: { source: string; anchor: string; target: string }[] = [];
  let skipped = 0;
  let stop: unknown = null;
  await inTurns(counts.value.pages.slice(0, OPEN), 2, async (p) => {
    if (stop) return;
    try {
      const fresh = await pullLinks(p.url, day);
      const news = !baseline && (readBefore.has(p.url) || !listedBefore.has(p.url));
      if (news) for (const l of fresh) found.push({ ...l, target: p.url });
      readBefore.add(p.url);
    } catch (e) {
      if (!(e instanceof SourceError) || e.kind === "auth" || e.kind === "forbidden" || e.kind === "quota") stop = e;
      else skipped++;
    }
  });
  if (stop) throw stop;
  setState("bing.links.memo", JSON.stringify({ read: [...readBefore].slice(-2000), listed: counts.value.pages.map((p) => p.url) } satisfies LinkMemo));
  setState("bing.links.at", new Date().toISOString());

  if (!baseline) {
    for (const l of found.slice(0, ANNOUNCE)) {
      note("bing.link", `Bing found a new link from ${hostOf(l.source)}`, {
        tone: "good",
        detail: `To ${pathOf(l.target)}${l.anchor ? `, with the words "${l.anchor}"` : ""}. From Bing's index of links, not Google's.`,
        href: l.source,
        dedupe: `bing.link:${l.source}>${l.target}`,
      });
    }
    if (found.length > ANNOUNCE) {
      note("bing.link", `Bing found ${found.length - ANNOUNCE} more new links`, { tone: "good", detail: "From Bing's index of links, not Google's.", dedupe: `bing.links.more:${day}` });
    }
  }

  /* The rest is warmed for the screens. One of them failing is said, and does not undo the links. */
  const failures: string[] = [];
  const t = await traffic("90d", { fresh: true });
  if (t.state === "ok") {
    for (const d of t.value.days) {
      record("bing.clicks", d.clicks, d.date);
      record("bing.impressions", d.impressions, d.date);
    }
  } else if (t.reason.startsWith("The last read failed")) failures.push("traffic");
  for (const [name, r] of [
    ["queries", await queryStats("90d", { fresh: true })],
    ["pages", await pageStats("90d", { fresh: true })],
    ["crawl issues", await crawlIssues({ fresh: true })],
    ["crawl figures", await crawlStats({ fresh: true })],
  ] as [string, Reading<unknown>][]) {
    if (r.state === "waiting" && r.reason.startsWith("The last read failed")) failures.push(name);
  }
  const crawl = await crawlStats();
  if (crawl.state === "ok" && crawl.value.length) record("bing.in_index", crawl.value.at(-1)!.inIndex, day);

  const line = `Bing knows ${counts.value.total} links to ${counts.value.pages.length} pages${baseline ? " (first read, nothing announced)" : found.length ? `; ${found.length} new` : "; none new"}${skipped ? `; ${skipped} pages Bing would not answer for were skipped` : ""}`;
  if (failures.length) throw new Error(`${line}. These reads failed and kept their last answer: ${failures.join(", ")}`);
  return line;
}

/** Bing's link count per day, from the day the desk started asking. No request. */
export function linkHistory(days = 90): { day: string; links: number }[] {
  return series("bing.links", days).map((r) => ({ day: r.day, links: r.value }));
}

export const jobs: Job[] = [
  {
    name: "bing-daily",
    title: "Read links and search figures from Bing",
    every: 24 * 3600,
    delay: 420,
    ready: configured,
    run: () => daily(),
  },
];
