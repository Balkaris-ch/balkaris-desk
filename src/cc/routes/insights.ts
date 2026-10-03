import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db, lastBeat, log } from "../../db.ts";
import { TOPICS } from "../../catalogue.ts";
import { firstUrl } from "../../extract.ts";
import { takeLink } from "../../intake.ts";
import { FORMATS, isFormat, type Format } from "../../templates.ts";
import { isSocial, platformOf } from "../../social/shape.ts";
import { me, type Vars } from "../access.ts";
import { articleStats, asReading, insightsByDay, report, where, type GaRange, type Read, type Report, type Span } from "../ga4.ts";
import { gsc } from "../search/index.ts";
import { crawledAt, inventory, LIMITS, type PageRow } from "../site/index.ts";
import { specimenAllowed } from "../specimen.ts";
import { whyLine } from "../system.ts";
import { explain } from "../../why.ts";
import { ok, off, reading, waiting } from "../store.ts";
import type { DayPoint, EarlySignals, Range, Reading, Stat } from "../../../web/src/contract/common.ts";
import type {
  ArticleFigures,
  ArticleTraffic,
  CalendarDot,
  CreateAnswer,
  InboxRow,
  InsightRow,
  InsightSource,
  InsightStatus,
  InsightsPayload,
  InsightsState,
  Opportunity,
  Recommendation,
  SearchFigures,
  TopInsight,
} from "../../../web/src/contract/insights.ts";

/**
 * /api/v1/insights — the Insights screen.
 *
 *   GET  /              the whole screen: ?range= ?month= ?source= ?type= (?specimen=1 on a workstation)
 *   GET  /state         what the Create insight dialog must say: autopublish, the runner's heartbeat
 *   POST /create        { url, format }: a link and its job, through intake.ts `takeLink`, as Telegram does
 *   POST /retry/:link   the console's "Try it again" for a stuck job or an unreadable link
 *
 * THE DESK'S OWN LIFE OF A LINK is read straight from its tables (src/db.ts):
 * shared (links) → a write or ingest job queued (jobs) → written on the
 * workstation → a draft (drafts, state 'draft') → live at its address but in
 * no menu (drafts 'unlisted') → listed (drafts 'listed'). A job the
 * workstation failed three times is 'stuck'. A piece taken off the site goes
 * back to 'draft' with a `draft.remove` event; a deleted draft leaves a
 * `draft.removed` event and its link. The dates are the events' own.
 *
 * Every panel is read on its own through `reading()`, so a source that fails
 * costs its panel and nothing else.
 */
export const routes = new Hono<Vars>();

/* ---------- small helpers ------------------------------------------------------ */

const SITE_BASE = (process.env.SITE_BASE ?? "https://www.balkaris.ch").replace(/\/$/, "");
const DAY_MS = 86_400_000;
const RANGES = ["7d", "30d", "90d", "1y"] as const;
type ScreenRange = (typeof RANGES)[number];
const DAYS: Record<ScreenRange, number> = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };

const asRange = (v: string | undefined): ScreenRange => (RANGES as readonly string[]).includes(v ?? "") ? (v as ScreenRange) : "30d";

const ZDAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" });
/** SQLite's datetime('now') is UTC with a space and no zone. */
const instant = (s: string): Date => new Date(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);
const iso = (s: string): string => instant(s).toISOString();
/** The studio's calendar day of a stored time. */
const zday = (s: string): string => ZDAY.format(instant(s));
const todayZ = (): string => ZDAY.format(new Date());
const shift = (day: string, by: number): string => new Date(Date.parse(`${day}T12:00:00Z`) + by * DAY_MS).toISOString().slice(0, 10);
const daysFrom = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = from; d <= to; d = shift(d, 1)) out.push(d);
  return out;
};

/** An absent reading carried over to another type: it has no value, so nothing is lost. */
function absent<B>(r: Exclude<Reading<unknown>, { state: "ok" }>): Reading<B> {
  return r.state === "off" ? off<B>(r.source, r.reason, r.step) : waiting<B>(r.source, r.reason);
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/* ---------- the desk's records ------------------------------------------------- */

interface LinkRec {
  id: number;
  url: string;
  title: string | null;
  site: string | null;
  author: string | null;
  kind: string;
  platform: string | null;
  topic: string | null;
  state: string;
  error: string | null;
  created_at: string;
  draft_id: number | null;
  slug: string | null;
  draft_state: string | null;
  draft_at: string | null;
  cover_alt: string | null;
  draft_title: string | null;
}

interface JobRec {
  id: number;
  link_id: number;
  kind: string;
  state: string;
  error: string | null;
  created_at: string;
}

interface EventRec {
  link_id: number | null;
  what: string;
  detail: string | null;
  at: string;
}

/** Not yet written: the Inbox tab, and the inbox panel. */
const WAITING: readonly InsightStatus[] = ["toread", "writing", "stuck"];

const PLATFORMS: Record<string, string> ={ tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" };

/** Where a link came from: its platform as the workstation recorded it, or as the address says, or the web. */
function sourceOf(l: Pick<LinkRec, "platform" | "url">): InsightSource {
  const named = (l.platform ?? platformOf(l.url) ?? "").toLowerCase();
  if (PLATFORMS[named]) return { key: named, label: PLATFORMS[named]! };
  if (isSocial(l.url)) return { key: "social", label: "Social" };
  return { key: "web", label: "Web" };
}

const topicOf = (id: string | null): { id: string; label: string } | null => {
  const t = TOPICS.find((x) => x.id === id);
  return t ? { id: t.id, label: t.name } : null;
};

interface Desk {
  links: LinkRec[];
  /** The latest write or ingest job per link. */
  writeJob: Map<number, JobRec>;
  events: EventRec[];
  stuckJobs: number;
  queuedWrites: number;
  /** Per link: the first time it was listed, went live unlisted, was taken down, its draft deleted; its last failure. */
  firstListed: Map<number, string>;
  firstLive: Map<number, string>;
  lastListedOrLive: Map<number, string>;
  lastTakenDown: Map<number, string>;
  removed: Set<number>;
  lastFailure: Map<number, string>;
  /** The first day the desk recorded anything: where its history begins. */
  since: string;
  at: string;
}

function readDesk(): Desk {
  const links = db
    .prepare(
      `SELECT l.id, l.url, l.title, l.site, l.author, l.kind, l.platform, l.topic, l.state, l.error, l.created_at,
              d.id AS draft_id, d.slug, d.state AS draft_state, d.created_at AS draft_at, d.cover_alt,
              json_extract(d.post, '$.title') AS draft_title
         FROM links l
         LEFT JOIN drafts d ON d.id = (SELECT MAX(id) FROM drafts WHERE link_id = l.id)
        ORDER BY l.id DESC`,
    )
    .all() as unknown as LinkRec[];

  const writeJob = new Map<number, JobRec>();
  for (const j of db.prepare("SELECT id, link_id, kind, state, error, created_at FROM jobs WHERE kind IN ('write', 'ingest') ORDER BY id").all() as unknown as JobRec[]) {
    writeJob.set(j.link_id, j);
  }

  const events = db
    .prepare(
      `SELECT link_id, what, detail, at FROM events
        WHERE what IN ('auto.published', 'draft.list', 'draft.publish', 'draft.unlist', 'draft.remove', 'draft.removed', 'job.taken', 'job.failed', 'job.stuck')
        ORDER BY id`,
    )
    .all() as unknown as EventRec[];

  const firstListed = new Map<number, string>();
  const firstLive = new Map<number, string>();
  const lastListedOrLive = new Map<number, string>();
  const lastTakenDown = new Map<number, string>();
  const removed = new Set<number>();
  const lastFailure = new Map<number, string>();
  for (const e of events) {
    if (e.link_id === null) continue;
    if (e.what === "auto.published" || e.what === "draft.list") {
      if (!firstListed.has(e.link_id)) firstListed.set(e.link_id, e.at);
      if (!firstLive.has(e.link_id)) firstLive.set(e.link_id, e.at);
      lastListedOrLive.set(e.link_id, e.at);
    }
    if (e.what === "draft.publish") {
      if (!firstLive.has(e.link_id)) firstLive.set(e.link_id, e.at);
      lastListedOrLive.set(e.link_id, e.at);
    }
    if (e.what === "draft.remove") lastTakenDown.set(e.link_id, e.at);
    if (e.what === "draft.removed") removed.add(e.link_id);
    if (e.what === "job.failed") lastFailure.set(e.link_id, e.at);
  }

  const count = (sql: string): number => (db.prepare(sql).get() as { c: number }).c;
  const first = (db.prepare("SELECT MIN(created_at) AS a FROM links").get() as { a: string | null }).a;

  return {
    links,
    writeJob,
    events,
    stuckJobs: count("SELECT COUNT(*) c FROM jobs WHERE state = 'stuck'"),
    queuedWrites: count("SELECT COUNT(*) c FROM jobs WHERE state = 'queued' AND kind IN ('write', 'ingest')"),
    firstListed,
    firstLive,
    lastListedOrLive,
    lastTakenDown,
    removed,
    lastFailure,
    since: first ? zday(first) : todayZ(),
    at: new Date().toISOString(),
  };
}

/** Where one link stands, by the rules in the file's head. */
function statusOf(l: LinkRec, desk: Desk): { status: InsightStatus; archived?: "taken-down" | "removed" } {
  if (l.draft_id !== null) {
    if (l.draft_state === "listed") return { status: "published" };
    if (l.draft_state === "unlisted" || l.draft_state === "published") return { status: "review" };
    const down = desk.lastTakenDown.get(l.id);
    const live = desk.lastListedOrLive.get(l.id);
    if (down && (!live || down >= live)) return { status: "archived", archived: "taken-down" };
    return { status: "draft" };
  }
  const job = desk.writeJob.get(l.id);
  if (job?.state === "stuck") return { status: "stuck" };
  if (job && (job.state === "queued" || job.state === "running")) return { status: "writing" };
  if (desk.removed.has(l.id)) return { status: "archived", archived: "removed" };
  return { status: "toread" };
}

/** A link nobody has read yet, named by its address without the tracking: "instagram.com/p/Dd1B…". */
function linkName(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return url;
  }
}

const coverOf = (l: LinkRec): string | null => (l.draft_id !== null && l.cover_alt && l.slug ? `/cover/${encodeURIComponent(l.slug)}.webp` : null);

function handleOf(l: LinkRec, source: InsightSource): string | null {
  if (source.key !== "web") return l.author ? `@${l.author.replace(/^@/, "")}` : null;
  if (l.site) return l.site;
  try {
    return new URL(l.url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/* ---------- the crawl ---------------------------------------------------------- */

interface Crawl {
  at: string;
  /** Every article page the crawl read, by path. */
  articles: Map<string, PageRow>;
  /** Which topic page lists each article. */
  topicOf: Map<string, string>;
  /** Articles whose own text links to at least one service page. */
  linksService: Set<string>;
}

function readCrawl(): Reading<Crawl> {
  const at = crawledAt();
  const inv = inventory();
  if (!at || inv.state !== "ok") return inv.state === "ok" ? waiting("crawl", "The first crawl has not finished yet.") : absent(inv);
  const articles = new Map(inv.value.filter((p) => p.kind === "article").map((p) => [p.path, p]));

  /* Two questions the crawl's read functions do not ask, put to its own tables:
     which topic page lists an article, and which articles link to a service
     page from their own text (not the menu). Read-only. */
  const topicOf = new Map<string, string>();
  const linksService = new Set<string>();
  try {
    for (const r of db
      .prepare("SELECT source, target FROM cc_links WHERE internal = 1 AND place = 'main' AND source LIKE '/insights/topic/%' AND target LIKE '/insights/%'")
      .all() as { source: string; target: string }[]) {
      if (articles.has(r.target) && !topicOf.has(r.target)) topicOf.set(r.target, r.source.slice("/insights/topic/".length));
    }
    for (const r of db
      .prepare(
        `SELECT DISTINCT l.source FROM cc_links l JOIN cc_pages p ON p.path = l.target
          WHERE l.internal = 1 AND l.place = 'main' AND l.source LIKE '/insights/%' AND p.kind IN ('service', 'landing')`,
      )
      .all() as { source: string }[]) {
      linksService.add(r.source);
    }
  } catch {
    /* The crawl's tables are made by its first run; until then there is nothing to add. */
  }
  return ok({ at, articles, topicOf, linksService }, "crawl", at);
}

/* ---------- the rows ----------------------------------------------------------- */

function buildRows(desk: Desk, crawl: Crawl | null): InsightRow[] {
  const rows: InsightRow[] = [];
  const deskSlugs = new Set<string>();

  for (const l of desk.links) {
    const { status, archived } = statusOf(l, desk);
    const source = sourceOf(l);
    if (l.slug) deskSlugs.add(l.slug);
    const onSite = status === "published" || status === "review";
    const path = onSite && l.slug ? `/insights/${l.slug}` : null;
    const job = desk.writeJob.get(l.id);
    const when = status === "published" ? desk.firstListed.get(l.id) : status === "review" ? desk.firstLive.get(l.id) : undefined;
    /* Why it is stuck or unread: the line that says so (not the first, which for the local model is a harmless load warning), and the whole text beside it. */
    const raw = status === "stuck" ? (job?.error ?? "The workstation gave it up after three attempts.") : l.draft_id === null && l.state === "failed" ? (l.error ?? "It could not be read.") : null;
    /* The row says it the way Telegram does (src/why.ts): why, and what to do. The raw error stays in problemFull for the hover. */
    const why = raw === null ? null : (() => { const w = explain(raw); return { line: `${w.reason} ${w.next}`, full: `${w.reason}

What to do: ${w.next}

What the workstation said: ${whyLine(raw).full}` }; })();
    rows.push({
      key: `l${l.id}`,
      href: l.draft_id !== null ? `/insights/${l.draft_id}` : `/insights/link/${l.id}`,
      title: (l.draft_title ?? l.title ?? "").trim() || linkName(l.url),
      cover: coverOf(l) ?? (path ? (crawl?.articles.get(path)?.sharePicture ?? null) : null),
      status,
      ...(archived ? { archived } : {}),
      source,
      category: topicOf(l.topic),
      published: when ? zday(when) : null,
      path,
      liveUrl: path ? `${SITE_BASE}${path}` : null,
      shared: iso(l.created_at),
      handle: handleOf(l, source),
      linkId: l.id,
      draftId: l.draft_id,
      canRetry: status === "stuck" || (l.draft_id === null && l.state === "failed"),
      problem: why?.line ?? null,
      problemFull: why?.full ?? null,
    });
  }

  /* Articles on the website that the desk did not write: they are insights
     too, and GA4 counts them. The crawl says whether they are listed. */
  if (crawl) {
    for (const [path, p] of crawl.articles) {
      const slug = path.slice("/insights/".length);
      if (deskSlugs.has(slug) || p.status !== 200) continue;
      const listed = p.inSitemap && p.indexable;
      rows.push({
        key: `s${path}`,
        href: `${SITE_BASE}${path}`,
        title: (p.h1 ?? p.title ?? path).replace(/\s*\|\s*Balkaris\s*$/i, ""),
        cover: p.sharePicture,
        status: listed ? "published" : "review",
        source: { key: "site", label: "Website" },
        category: topicOf(crawl.topicOf.get(path) ?? null),
        published: null,
        path,
        liveUrl: `${SITE_BASE}${path}`,
        shared: null,
        handle: null,
        linkId: null,
        draftId: null,
        canRetry: false,
        problem: null,
        problemFull: null,
      });
    }
  }
  return rows;
}

/* ---------- the desk's tiles --------------------------------------------------- */

/** Per day from where the desk's history begins (or the range's start, if later) to today: how many of `stamps` fell on it. */
function perDay(stamps: string[], start: string, desk: Desk): number[] {
  const from = desk.since > start ? desk.since : start;
  const days = daysFrom(from, todayZ());
  const n = new Map<string, number>();
  for (const s of stamps) {
    const d = zday(s);
    n.set(d, (n.get(d) ?? 0) + 1);
  }
  return days.map((d) => n.get(d) ?? 0);
}

const detailOf = (e: EventRec): Record<string, unknown> => {
  try {
    return e.detail ? (JSON.parse(e.detail) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

function deskTiles(desk: Desk, rows: InsightRow[], range: ScreenRange) {
  const start = shift(todayZ(), 1 - DAYS[range]);
  const month = todayZ().slice(0, 7);
  const count = (s: InsightStatus) => rows.filter((r) => r.status === s).length;
  const stat = (value: number, series: number[], sub: string): Stat => ({ value, previous: null, unit: "count", series, sub });

  const listings = [...desk.firstListed.values()];
  const thisMonth = listings.filter((at) => zday(at).startsWith(month)).length;
  const taken = desk.events.filter((e) => e.what === "job.taken" && ["write", "ingest"].includes(String(detailOf(e).kind))).map((e) => e.at);
  const gaveUp = desk.events.filter((e) => e.what === "job.stuck" || (e.what === "job.failed" && detailOf(e).gaveUp === true)).map((e) => e.at);
  const shared = desk.links.map((l) => l.created_at);
  const note = "The desk's own records: its links, jobs and drafts.";

  return {
    published: ok(stat(count("published"), perDay(listings, start, desk), `+${thisMonth} this month`), "desk", desk.at, `${note} The line is the articles the desk listed each day.`),
    writing: ok(stat(count("writing"), perDay(taken, start, desk), "in progress"), "desk", desk.at, `${note} The line is the write jobs the workstation took each day.`),
    toRead: ok(stat(count("toread"), perDay(shared, start, desk), "saved for later"), "desk", desk.at, `${note} The line is the links shared each day.`),
    stuck: ok(stat(desk.stuckJobs, perDay(gaveUp, start, desk), "need attention"), "desk", desk.at, `${note} Jobs the workstation gave up after three attempts; the line is the days it gave up.`),
  };
}

/* ---------- GA4 ---------------------------------------------------------------- */

const isArticlePath = (p: string): boolean => /^\/insights\/[^/]+$/.test(p) && p !== "/insights/topic";
const clean = (p: string): string => {
  const bare = (p || "").split(/[?#]/)[0]!.replace(/\/+$/, "");
  return bare || "/";
};
const n = (row: Record<string, string | number> | undefined, name: string): number => (row && typeof row[name] === "number" ? (row[name] as number) : 0);

/** The days of a span, as GA4's day series begin: where measurement does. */
function spanDays(span: Span): string[] {
  return daysFrom(span.since > span.start ? span.since : span.start, span.end);
}

/** A day series for the span, each point with the same day one period earlier where both were measured whole. */
function points(span: Span, at: (day: string) => number): DayPoint[] {
  return spanDays(span).map((day) => {
    const before = shift(day, -span.days);
    const whole = before >= span.fullFrom && (span.complete || day < span.end);
    return { date: day, value: at(day), previous: whole ? at(before) : null };
  });
}

const dateRangesOf = (span: Span) => [
  { startDate: span.since > span.start ? span.since : span.start, endDate: span.end },
  ...(span.previous ? [{ startDate: span.previous.start, endDate: span.previous.end }] : []),
];
const stretchOf = (span: Span) => {
  const back = shift(span.start, -span.days);
  return { startDate: span.since > back ? span.since : back, endDate: span.end };
};

/** Carry a failed read across: its state, its error, its step. */
function failed<T>(r: Read<unknown>): Read<T> {
  return { ...(r as Read<T>), data: null };
}

interface Landed {
  /** Organic Search sessions that began on an /insights/ page, per day, and over the period and the one before. */
  organic: { days: Map<string, number>; now: number; before: number | null };
  /** generate_lead events in sessions that began on an /insights/ page: per day, per landing article, totals. */
  leads: { days: Map<string, number>; byPath: Map<string, number>; now: number; before: number | null };
}

/**
 * The two tiles GA4's named reads do not carry: sessions that LANDED on an
 * /insights/ page from Organic Search, and generate_lead events in sessions
 * that landed on one. Four cached reports, inside the span `articleStats`
 * already settled.
 */
async function landed(span: Span): Promise<Read<Landed>> {
  const ask = { screen: true };
  const insights = where.begins("landingPage", "/insights/");
  const organicOnly = where.all(insights, where.is("sessionDefaultChannelGroup", "Organic Search"));
  const leadsOnly = where.all(insights, where.is("eventName", "generate_lead"));

  const [oDays, oTotal, lDays, lPages] = await Promise.all([
    report({ dimensions: ["date"], metrics: ["sessions"], dateRanges: [stretchOf(span)], dimensionFilter: organicOnly, limit: 1000 }, ask),
    report({ metrics: ["sessions"], dateRanges: dateRangesOf(span), dimensionFilter: organicOnly }, ask),
    report({ dimensions: ["date"], metrics: ["eventCount"], dateRanges: [stretchOf(span)], dimensionFilter: leadsOnly, limit: 1000 }, ask),
    report({ dimensions: ["landingPage"], metrics: ["eventCount"], dateRanges: dateRangesOf(span), dimensionFilter: leadsOnly, limit: 1000 }, ask),
  ]);
  const bad = [oDays, oTotal, lDays, lPages].find((r) => r.data === null);
  if (bad) return failed(bad);

  const byDay = (rep: Report, metric: string) => new Map(rep.rows.map((r) => [String(r.date ?? ""), n(r, metric)]));
  const pages = new Map<string, number>();
  for (const r of lPages.data!.ranges[0] ?? []) {
    const p = clean(String(r.landingPage ?? ""));
    pages.set(p, (pages.get(p) ?? 0) + n(r, "eventCount"));
  }
  const sum = (rows: Report["rows"] | undefined, metric: string) => (rows ?? []).reduce((s, r) => s + n(r, metric), 0);

  return {
    data: {
      organic: { days: byDay(oDays.data!, "sessions"), now: n(oTotal.data!.ranges[0]?.[0], "sessions"), before: span.previous ? n(oTotal.data!.ranges[1]?.[0], "sessions") : null },
      leads: { days: byDay(lDays.data!, "eventCount"), byPath: pages, now: sum(lPages.data!.ranges[0], "eventCount"), before: span.previous ? sum(lPages.data!.ranges[1], "eventCount") : null },
    },
    at: Math.min(...[oDays, oTotal, lDays, lPages].map((r) => r.at ?? Date.now())),
    source: "ga4",
  };
}

/** Article traffic for some articles only (one shelf), the same shape `insightsByDay` gives for all. */
async function trafficOf(span: Span, paths: string[]): Promise<Read<ArticleTraffic>> {
  const ask = { screen: true };
  const among = where.among("pagePath", paths.flatMap((p) => [p, `${p}/`]));
  const [days, total] = await Promise.all([
    report({ dimensions: ["date", "sessionDefaultChannelGroup"], metrics: ["sessions"], dateRanges: [stretchOf(span)], dimensionFilter: among, limit: 10_000 }, ask),
    report({ metrics: ["sessions"], dateRanges: dateRangesOf(span), dimensionFilter: among }, ask),
  ]);
  if (days.data === null) return failed(days);
  if (total.data === null) return failed(total);
  const cell = new Map<string, number>();
  for (const r of days.data.rows) {
    const ch = String(r.sessionDefaultChannelGroup ?? "");
    const key = `${ch === "Organic Search" ? "o" : ch === "Direct" ? "d" : "x"} ${String(r.date ?? "")}`;
    cell.set(key, (cell.get(key) ?? 0) + n(r, "sessions"));
  }
  const organic = points(span, (d) => cell.get(`o ${d}`) ?? 0);
  return {
    data: {
      organic,
      direct: points(span, (d) => cell.get(`d ${d}`) ?? 0),
      visits: n(total.data.ranges[0]?.[0], "sessions"),
      previous: span.previous ? n(total.data.ranges[1]?.[0], "sessions") : null,
      provisional: organic.filter((p) => p.date >= span.provisionalFrom).length,
      since: span.partial ? span.since : null,
    },
    at: Math.min(days.at ?? Date.now(), total.at ?? Date.now()),
    source: "ga4",
  };
}

/* ---------- Search Console, and its specimen ------------------------------------ */

/**
 * SPECIMEN ROWS. Shown only when `specimenAllowed` says so (a workstation,
 * ?specimen=1), so the connected state of the Search Console columns and the
 * Opportunities tab can be looked at before Google's key exists. Every figure
 * is a repeated digit and every query says "specimen": none resembles a real
 * one.
 */
function specimenSearch(paths: string[]): Record<string, SearchFigures> {
  const out: Record<string, SearchFigures> = {};
  paths.forEach((p, i) => {
    const d = (i % 9) + 1;
    out[p] = { clicks: d * 11, impressions: d * 1111, ctr: d + d / 10 + d / 100, position: d * 1.1, keywords: d };
  });
  return out;
}

/** The Opportunities tab lists this many queries, the most shown first; its count is all of them. */
const OPPORTUNITIES_SHOWN = 100;

type OpportunityList = InsightsPayload["opportunities"] extends Reading<infer T> ? T : never;

const SPECIMEN_OPPORTUNITIES: Opportunity[] = ["a", "b", "c", "d", "e"].map((x, i) => ({
  query: `specimen query ${x}`,
  impressions: (5 - i) * 111,
  clicks: 5 - i,
  ctr: (5 - i) * 0.11,
  position: 11 + i,
  path: null,
}));

/**
 * Search Console's figures per article, and the window's early signals: in
 * an early window (gsc.ts, EARLY) an article shown fewer times than the
 * standard floor has its CTR and keyword count marked early.
 */
async function searchByPath(range: ScreenRange): Promise<Reading<{ byPath: Record<string, SearchFigures>; early: EarlySignals | null }>> {
  const [pages, pairs, q] = await Promise.all([gsc.pages(range), gsc.queryPages(range), gsc.queries(range)]);
  if (pages.state !== "ok") return absent(pages);
  /* The list's own rows are the articles Google showed: early while fewer than ten of them reach the floor (gsc.ts, EARLY). */
  const articles = pages.value.rows.filter((r) => isArticlePath(clean(r.path)));
  const early =
    q.state === "ok"
      ? gsc.earlySignals(
          { own: articles, all: q.value.rows },
          gsc.FLOOR.opportunities,
          `A click rate or a keyword count measured on 1 to ${gsc.FLOOR.opportunities - 1} impressions moves a lot from day to day; those figures are marked early until enough data exists.`,
        )
      : null;
  const words = new Map<string, Set<string>>();
  if (pairs.state === "ok") {
    for (const r of pairs.value.rows) {
      const p = clean(r.path);
      const set = words.get(p) ?? new Set<string>();
      set.add(r.query);
      words.set(p, set);
    }
  }
  const out: Record<string, SearchFigures> = {};
  for (const r of pages.value.rows) {
    const p = clean(r.path);
    if (!isArticlePath(p)) continue;
    out[p] = {
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.impressions > 0 ? r.ctr : null,
      position: r.impressions > 0 ? r.position : null,
      keywords: pairs.state === "ok" ? (words.get(p)?.size ?? 0) : null,
      ...(early && r.impressions < early.standard ? { early: true } : {}),
    };
  }
  return ok({ byPath: out, early }, "gsc", pages.asOf, `${pages.note ?? ""} Position is Google's average position, not a tracked rank.${early ? ` ${early.line}` : ""}`.trim());
}

/* ---------- recommendations ---------------------------------------------------- */

function recommend(rows: InsightRow[], desk: Desk, crawl: Reading<Crawl>): Reading<Recommendation[]> {
  const out: Recommendation[] = [];
  const now = Date.now();
  const c = crawl.state === "ok" ? crawl.value : null;
  const add = (r: InsightRow, rule: string, kind: string, tone: Recommendation["tone"], action: string, measure: string, text: string) =>
    out.push({ id: `${rule}|${r.key}`, action, subject: r.title, measure, href: r.href, kind, tone, text });

  for (const r of rows) {
    const page = r.path && c ? c.articles.get(r.path) : undefined;
    if (page && page.status === 200) {
      const title = [...(page.title ?? "")].length;
      if (title > LIMITS.title) add(r, "title", "Title", "warn", "Shorten the title", `${title} characters`, `Its title is ${title} characters; search results cut titles near ${LIMITS.title}.`);
      const descr = [...(page.description ?? "")].length;
      if (!descr) add(r, "descr", "Description", "warn", "Write a description", "none", "It has no description, so search engines write their own.");
      else if (descr > LIMITS.description) add(r, "descr", "Description", "info", "Shorten the description", `${descr} characters`, `Its description is ${descr} characters; results show about ${LIMITS.description}.`);
      if (!c!.linksService.has(r.path!)) add(r, "links", "Links", "info", "Link a service page", "no service link", "Its text links to no service page, so a reader has no next step.");
      if (page.words !== null && page.words < LIMITS.thinWords) add(r, "thin", "Content", "info", "Expand the article", plural(page.words, "word"), `${plural(page.words, "word")} of its own, under the desk's ${LIMITS.thinWords}-word line for a thin page.`);
    }
    if (r.draftId !== null && r.cover === null && (r.status === "draft" || r.status === "review" || r.status === "published")) {
      add(r, "cover", "Cover", "warn", "Draw a cover", "no cover", "No cover has been drawn for it.");
    }
    if (r.status === "stuck" && r.linkId !== null) {
      const since = desk.lastFailure.get(r.linkId) ?? desk.writeJob.get(r.linkId)?.created_at;
      const age = since ? now - instant(since).getTime() : 0;
      if (age > DAY_MS) add(r, "stuck", "Stuck", "bad", "Try it again", plural(Math.floor(age / DAY_MS), "day"), `Stuck for ${plural(Math.floor(age / DAY_MS), "day")}: the workstation gave it up after three attempts.`);
    }
    if (r.status === "review" && r.linkId !== null && !desk.firstListed.has(r.linkId)) {
      const live = desk.firstLive.get(r.linkId);
      const age = live ? now - instant(live).getTime() : 0;
      if (age > 3 * DAY_MS) add(r, "fresh", "Freshness", "warn", "List it, or take it down", plural(Math.floor(age / DAY_MS), "day"), `Live but unlisted for ${plural(Math.floor(age / DAY_MS), "day")} and never listed.`);
    }
  }
  const rank = { bad: 0, warn: 1, info: 2 } as const;
  out.sort((a, b) => rank[a.tone] - rank[b.tone]);
  const rules = `Stated rules over the desk's records${c ? " and its crawl of the site" : ""}: title over ${LIMITS.title} characters, description over ${LIMITS.description}, no link to a service page, under ${LIMITS.thinWords} words, no cover, stuck over a day, unlisted over three days. No predictions.`;
  return ok(out, "desk", desk.at, c ? rules : `${rules} The crawl has not finished, so the page rules wait for it.`);
}

/* ---------- the dialog's truth ------------------------------------------------- */

function stateFor(c: Context<Vars>, desk?: Desk): InsightsState {
  const who = me(c);
  const seen = lastBeat();
  const at = seen ? iso(seen) : null;
  return {
    autopublish: (process.env.DESK_AUTOPUBLISH ?? "1") !== "0",
    runner: { lastSeen: at, awake: at !== null && Date.now() - Date.parse(at) < 5 * 60_000 },
    canCreate: who.canPublish && !who.revoked,
    formats: (Object.keys(FORMATS) as Format[]).map((key) => ({ key, label: FORMATS[key].button, as: FORMATS[key].as })),
    queued: desk?.queuedWrites ?? (db.prepare("SELECT COUNT(*) c FROM jobs WHERE state = 'queued' AND kind IN ('write', 'ingest')").get() as { c: number }).c,
  };
}

/* ---------- GET / -------------------------------------------------------------- */

routes.get("/", async (c) => {
  const range = asRange(c.req.query("range"));
  const ga: GaRange = range;
  const specimen = specimenAllowed(c);
  const monthAsked = c.req.query("month") ?? "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(monthAsked) ? monthAsked : todayZ().slice(0, 7);
  const sourceAsked = c.req.query("source") ?? "";
  const typeAsked = c.req.query("type") ?? "";

  const desk = readDesk();
  /* The crawl's tables belong to its collector; a read that throws costs the page rules, not the screen. */
  let crawl: Reading<Crawl>;
  try {
    crawl = readCrawl();
  } catch (e) {
    crawl = waiting("crawl", `The crawl could not be read: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
  }
  const rows = buildRows(desk, crawl.state === "ok" ? crawl.value : null);

  /* GA4: the per-article read first, because its span is the one every other GA4 panel reads inside. */
  const stats = await articleStats(ga, { screen: true });
  const span = stats.data?.span ?? null;
  const [days, land, search, gaps] = await Promise.all([
    insightsByDay(ga, { screen: true }),
    span ? landed(span) : Promise.resolve(failed<Landed>(stats)),
    reading("gsc", () => searchByPath(range)),
    reading("gsc", async () => {
      const titles = rows.filter((r) => r.path).map((r) => ({ path: r.path!, title: r.title, h1: crawl.state === "ok" ? (crawl.value.articles.get(r.path!)?.h1 ?? null) : null }));
      const g = await gsc.gaps(range, titles);
      if (g.state !== "ok") return absent<OpportunityList>(g);
      const out = g.value.rows
        .slice(0, OPPORTUNITIES_SHOWN)
        .map((r) => ({ query: r.query, impressions: r.impressions, clicks: r.clicks, ctr: r.ctr, position: r.position, path: r.path ? clean(r.path) : null, ...(r.early ? { early: true } : {}) }));
      return ok({ rows: out, floor: g.value.floor, early: g.value.early, total: g.value.rows.length }, "gsc", g.asOf, g.note);
    }),
  ]);

  /* The tiles. */
  const tiles = {
    ...deskTiles(desk, rows, range),
    organic: asReading(land, (l) => ({
      value: l.organic.now,
      previous: l.organic.before,
      unit: "count" as const,
      series: spanDays(span!).map((d) => l.organic.days.get(d) ?? 0),
      sub: "from insight content",
    })),
    conversions: asReading(land, (l) => ({
      value: l.leads.now,
      previous: l.leads.before,
      unit: "count" as const,
      series: spanDays(span!).map((d) => l.leads.days.get(d) ?? 0),
      sub: "from insight content",
    })),
  };

  /* Article traffic, for every article or for one shelf. */
  const live = rows.filter((r) => r.path);
  const types = [...new Map(live.filter((r) => r.category).map((r) => [r.category!.id, r.category!.label])).entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const type = types.some((t) => t.value === typeAsked) ? typeAsked : null;
  const trafficRead: Read<ArticleTraffic> =
    type && span
      ? await trafficOf(span, live.filter((r) => r.category?.id === type).map((r) => r.path!))
      : days.data
        ? {
            ...days,
            data: {
              organic: days.data.sessions.organic,
              direct: days.data.sessions.direct,
              visits: days.data.period.current.sessions.all,
              previous: days.data.period.previous?.sessions.all ?? null,
              provisional: days.data.sessions.organic.filter((p) => p.date >= days.data!.span.provisionalFrom).length,
              since: days.data.span.partial ? days.data.span.since : null,
            },
          }
        : failed(days);
  const traffic = asReading(trafficRead);

  /* Per-article GA4 figures, by path. */
  const ga4 = asReading(stats, (s): Record<string, ArticleFigures> => {
    const out: Record<string, ArticleFigures> = {};
    for (const a of s.rows) {
      out[a.path] = {
        views: a.views,
        previousViews: a.previous?.views ?? null,
        users: a.users,
        engagementSeconds: a.engagementSeconds,
        entrances: a.entrances,
        organic: a.byChannel.find((ch) => ch.key === "organic-search")?.value ?? 0,
        conversions: land.data ? (land.data.leads.byPath.get(a.path) ?? 0) : null,
      };
    }
    /* An article with a conversion but no recorded view in the range still has its conversions. */
    if (land.data) {
      for (const [p, v] of land.data.leads.byPath) {
        if (isArticlePath(p) && !out[p]) out[p] = { views: 0, previousViews: s.span.previous ? 0 : null, users: 0, engagementSeconds: 0, entrances: 0, organic: 0, conversions: v };
      }
    }
    return out;
  });

  /* Top performing: the three most-viewed articles. */
  const byPath = new Map(rows.filter((r) => r.path).map((r) => [r.path!, r]));
  const top = asReading(stats, (s): TopInsight[] =>
    s.rows
      .filter((a) => a.views > 0)
      .slice(0, 3)
      .map((a) => {
        const r = byPath.get(a.path);
        const page = crawl.state === "ok" ? crawl.value.articles.get(a.path) : undefined;
        return {
          path: a.path,
          title: r?.title ?? (page?.h1 ?? page?.title ?? a.path).replace(/\s*\|\s*Balkaris\s*$/i, ""),
          href: r?.href ?? `${SITE_BASE}${a.path}`,
          cover: r?.cover ?? page?.sharePicture ?? null,
          views: a.views,
          previousViews: a.previous?.views ?? null,
        };
      }),
  );

  /* The calendar: the month asked for, with a week either side. */
  /* The weeks the month grid shows: from the Monday on or before the 1st to the Sunday on or after the last day. */
  const first = `${month}-01`;
  const lead = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const last = shift(shift(first, 32).slice(0, 7) + "-01", -1);
  const tail = (7 - new Date(`${last}T12:00:00Z`).getUTCDay()) % 7;
  const from = shift(first, -lead);
  const to = shift(last, tail);
  const dots: CalendarDot[] = [];
  const titleOf = new Map(rows.filter((r) => r.linkId !== null).map((r) => [r.linkId!, r.title]));
  const put = (at: string, kind: string, linkId: number) => {
    const d = zday(at);
    if (d >= from && d <= to) dots.push({ date: d, kind, title: titleOf.get(linkId) ?? "" });
  };
  for (const [id, at] of desk.firstListed) put(at, "published", id);
  for (const e of desk.events) if (e.what === "draft.publish" && e.link_id !== null) put(e.at, "unlisted", e.link_id);
  for (const l of desk.links) {
    put(l.created_at, "shared", l.id);
    if (l.draft_at) put(l.draft_at, "draft", l.id);
  }

  /* The inbox: the links not yet written (the Inbox tab's rows), by where they were shared from. Every
     source the desk has had a link from keeps its tab, with how many of its links wait. */
  const linkRows = rows.filter((r) => r.linkId !== null);
  const sourceCount = new Map<string, { key: string; label: string; count: number; shared: number }>();
  for (const r of linkRows) {
    const s = sourceCount.get(r.source.key) ?? { key: r.source.key, label: r.source.key === "web" ? "Links" : r.source.label, count: 0, shared: 0 };
    s.shared++;
    if (WAITING.includes(r.status)) s.count++;
    sourceCount.set(r.source.key, s);
  }
  const ORDER = ["tiktok", "instagram", "youtube", "social", "web"];
  const sources = [...sourceCount.values()].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  const source = sources.some((s) => s.key === sourceAsked) ? sourceAsked : (sources.find((s) => s.count > 0)?.key ?? sources[0]?.key ?? null);
  const inboxRows: InboxRow[] = linkRows
    .filter((r) => r.source.key === source && WAITING.includes(r.status))
    .slice(0, 4)
    .map((r) => ({ linkId: r.linkId!, title: r.title, handle: r.handle, shared: r.shared!, cover: r.cover, href: r.href, status: r.status, canRetry: r.canRetry, problem: r.problem, problemFull: r.problemFull }));

  const gscTable: Reading<Record<string, SearchFigures>> = specimen
    ? ok(specimenSearch(live.map((r) => r.path!)), "gsc", new Date().toISOString(), "Specimen data: made-up figures, shown only on a workstation.")
    : search.state === "ok"
      ? { ...search, value: search.value.byPath }
      : search;
  const searchEarly = !specimen && search.state === "ok" ? search.value.early : null;
  const opportunities: Reading<OpportunityList> = specimen
    ? ok({ rows: SPECIMEN_OPPORTUNITIES, floor: 10, early: null, total: SPECIMEN_OPPORTUNITIES.length }, "gsc", new Date().toISOString(), "Specimen data: made-up queries, shown only on a workstation.")
    : gaps;

  const count = (s: InsightStatus) => rows.filter((r) => r.status === s).length;
  const payload: InsightsPayload = {
    range: range as Range,
    specimen,
    tiles,
    counts: {
      inbox: rows.filter((r) => WAITING.includes(r.status)).length,
      drafts: count("draft"),
      review: count("review"),
      published: count("published"),
      archive: count("archived"),
      opportunities: opportunities.state === "ok" ? opportunities.value.total : null,
    },
    traffic,
    types,
    type,
    top,
    calendar: { month, today: todayZ(), dots },
    inbox: { sources, source, rows: inboxRows, asOf: desk.at },
    table: { rows, asOf: desk.at, ga4, gsc: gscTable, searchEarly, conversionsRead: land.data !== null },
    opportunities,
    recommendations: recommend(rows, desk, crawl),
    state: stateFor(c, desk),
  };
  return c.json(payload);
});

/* ---------- GET /state --------------------------------------------------------- */

routes.get("/state", (c) => c.json(stateFor(c)));

/* ---------- POST /create ------------------------------------------------------- */

const CreateBody = z.object({
  url: z
    .string()
    .trim()
    .min(1, "Paste a link.")
    .max(2000)
    .refine((u) => /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(u), "That is not a web address (it must start with http:// or https://).")
    /* Both as written and as takeLink will read it (extract.ts firstUrl cuts the address at a bracket or a quote). */
    .refine((u) => !insideHost(u) && !insideHost(firstUrl(u) ?? u), "That address points inside a network, not to the public web, so the desk will not read it."),
  format: z.string().refine(isFormat, "Choose one of the four ways of writing."),
});

/**
 * Whether an address names this machine or a private network instead of the
 * public web: "localhost", a *.local / *.internal / *.localhost name, or an IP
 * literal in a loopback, private, link-local (the cloud's metadata address),
 * carrier-grade or unspecified range. The box reads what it is given
 * (extract.ts), so this door refuses such an address before anything is
 * fetched. It reads the address as the WHATWG parser does, so "2130706433",
 * "0x7f.1" and "user@127.0.0.1" are all seen as 127.0.0.1. A public name that
 * resolves to a private address, or a public page that redirects to one, is
 * not caught here: that needs a check of every hop inside extract.ts (it
 * follows redirects), which this screen does not own.
 */
function insideHost(raw: string): boolean {
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
  if (host === "localhost" || /\.(localhost|local|internal|home\.arpa)$/.test(host)) return true;

  if (host.startsWith("[")) {
    const v6 = host.slice(1, -1);
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    if (mapped) return privateV4(mapped[1]!);
    /* The URL parser writes a mapped IPv4 address in hex: ::ffff:7f00:1. */
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6);
    if (hex) {
      const a = parseInt(hex[1]!, 16);
      const b = parseInt(hex[2]!, 16);
      return privateV4(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`);
    }
    return v6 === "::" || v6 === "::1" || /^f[cd][0-9a-f]{0,2}:/.test(v6) || /^fe[89ab][0-9a-f]?:/.test(v6);
  }
  return /^\d+\.\d+\.\d+\.\d+$/.test(host) && privateV4(host);
}

function privateV4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  );
}

routes.post("/create", async (c) => {
  const who = me(c);
  if (!who.canPublish || who.revoked) {
    throw new HTTPException(403, { message: "Only people who can publish may create an insight: add your Vercel email on the people page first." });
  }
  const body = CreateBody.parse(await c.req.json().catch(() => ({})));
  const format = body.format as Format;

  /* The same door Telegram uses. The way of writing travels as the word a
     person would type beside the link ("Long read", "Technical"…), which is
     how intake.ts reads it; no chat is passed, so nothing is sent anywhere. */
  const got = await takeLink(`${body.url} ${FORMATS[format].button}`, { user: who.telegram, name: who.name });
  if (!got) throw new HTTPException(400, { message: "The desk found no web address in that." });

  const l = db.prepare("SELECT id, state, error, format FROM links WHERE id = ?").get(got.id) as { id: number; state: string; error: string | null; format: string | null } | undefined;
  /* intake.ts keeps an unreadable link without its format; set it, so "Try it again" writes it as it was asked. */
  if (!got.already && l && l.format !== format) {
    db.prepare("UPDATE links SET format = ? WHERE id = ? AND format IS NULL").run(format, got.id);
  }
  if (!got.already) log("link.desk", { by: who.name, format }, got.id);

  const draft = db.prepare("SELECT MAX(id) AS id FROM drafts WHERE link_id = ?").get(got.id) as { id: number | null };
  const autopublish = (process.env.DESK_AUTOPUBLISH ?? "1") !== "0";
  const said = got.already
    ? "That link was already on the desk, so nothing new was queued."
    : l?.state === "failed"
      ? `Kept, but the desk could not read it: ${(l.error ?? "no reason given").slice(0, 200)}. It waits in the inbox, where it can be tried again.`
      : autopublish
        ? `Queued for the workstation, to be written ${FORMATS[format].as}. When it is written and its cover drawn, it is published and listed on balkaris.ch.`
        : `Queued for the workstation, to be written ${FORMATS[format].as}. It will wait as a draft until somebody publishes it.`;

  const answer: CreateAnswer = { linkId: got.id, already: got.already, href: draft.id ? `/insights/${draft.id}` : `/insights/link/${got.id}`, said };
  return c.json(answer, got.already ? 200 : 201);
});

/* ---------- POST /retry/:link -------------------------------------------------- */

/**
 * Try a link again: the same statements as the console's POST /link/:id/retry
 * in src/server.ts, which this screen cannot reach without leaving for the
 * console. Stuck and waiting jobs go back in the queue with their attempts
 * reset; a link with nothing queued gets a new job; the link is asked again
 * whether it is social, because a misread share link is exactly the one
 * somebody retries.
 *
 * Only for a link the rows offer it on (`canRetry` in buildRows): no draft,
 * and its latest write job stuck or the link unreadable. Anything else is
 * refused before a single write, because a second write job for a link that is
 * already on the site would, with autopublish on, put a second copy of the
 * article on balkaris.ch; and nothing is queued while a job of the link's is
 * running on the workstation.
 */
function retryRefusal(id: number): string | null {
  const l = db.prepare("SELECT state, (SELECT MAX(id) FROM drafts WHERE link_id = links.id) AS draft FROM links WHERE id = ?").get(id) as { state: string; draft: number | null };
  const running = db.prepare("SELECT COUNT(*) c FROM jobs WHERE link_id = ? AND state = 'running'").get(id) as { c: number };
  if (running.c) return "It is being worked on at the workstation right now; nothing was queued.";
  const job = db.prepare("SELECT state FROM jobs WHERE link_id = ? AND kind IN ('write', 'ingest') ORDER BY id DESC LIMIT 1").get(id) as { state: string } | undefined;
  if (l.draft === null && (job?.state === "stuck" || l.state === "failed")) return null;
  return "That link is not stuck or unread; nothing was queued.";
}

routes.post("/retry/:link", (c) => {
  const id = Number(c.req.param("link"));
  const link = Number.isInteger(id) ? (db.prepare("SELECT id, kind, url FROM links WHERE id = ?").get(id) as { id: number; kind: string; url: string } | undefined) : undefined;
  if (!link) throw new HTTPException(404, { message: "The desk has no such link." });
  const refused = retryRefusal(id);
  if (refused) throw new HTTPException(409, { message: refused });

  db.prepare("UPDATE jobs SET state='queued', attempts=0, error=NULL, runner=NULL, taken_at=NULL WHERE link_id=? AND state IN ('stuck','queued')").run(id);
  const social = isSocial(link.url);
  if (social && link.kind === "article") db.prepare("UPDATE links SET kind='social' WHERE id=?").run(id);
  const open = db.prepare("SELECT COUNT(*) c FROM jobs WHERE link_id=? AND state='queued'").get(id) as { c: number };
  if (!open.c) db.prepare("INSERT INTO jobs (link_id, kind) VALUES (?, ?)").run(id, social ? "ingest" : "write");
  db.prepare("UPDATE links SET state='queued', error=NULL, updated_at=datetime('now') WHERE id=?").run(id);
  log("link.retried", { by: me(c).name }, id);
  return c.json({ ok: true, linkId: id });
});
