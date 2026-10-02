import { Hono, type Context } from "hono";
import { db } from "../../../db.ts";
import type { Vars } from "../../access.ts";
import { hasKey } from "../../gauth.ts";
import { status as jobStatus } from "../../scheduler.ts";
import * as bing from "../../search/bing.ts";
import { addDays } from "../../search/shared.ts";
import { off, ok, reading, since, today, waiting } from "../../store.ts";
import { scrub } from "../../system.ts";
import type { Reading, Stat } from "../../../../web/src/contract/common.ts";
import type { OwnerTaskRow, SeoRange } from "../../../../web/src/contract/seo/common.ts";
import type {
  BacklinksQuery,
  BacklinksTiles,
  LinkingSite,
  NapCell,
  NapView,
  ProfileLine,
  ProfileRow,
  Referrer,
  SeoBacklinksPayload,
  SitesFrom,
  SitesList,
  SitesSort,
} from "../../../../web/src/contract/seo/backlinks.ts";
import { daysOf } from "../../seo/rank.ts";
import { head, rangeFrom } from "./shared.ts";

/**
 * /api/v1/seo/backlinks — SEO › Backlinks: who links to the website, who
 * sends it visitors, and the studio's profiles and listings with the name,
 * address and phone each states.
 *
 *   GET /             the whole page (contract/seo/backlinks.ts, SeoBacklinksPayload)
 *                     ?range=7d|30d|90d|1y&q=<host>&from=all|links|visits|ai|views&sort=visits|links|newest|domain
 *   GET /export.csv   the linking-sites table as filtered (list=sites, the default),
 *                     or the profiles and listings with what each states (list=profiles)
 *
 * WHERE EACH PART COMES FROM, each its own reading, so one source that fails
 * costs its own tile, column or panel and nothing else:
 *
 *   links              Bing Webmaster's index of links (src/cc/search/bing.ts), the
 *                      one free source of inbound links: Google gives none by API.
 *                      Off, with the exact step, until its key exists.
 *   sites that sent    GA4 sessions whose medium is referral, and AI assistants
 *   visitors           (cc_seo_referrals, read once a day by the job
 *                      seo-referrals; consenting visitors only)
 *   page views         Vercel's own request records by referring site
 *                      (src/cc/vercel/drain.ts), every visitor, once the log drain
 *                      delivers
 *   profiles, NAP      the registry the audit seeded and the weekly check
 *                      (src/cc/seo/presence.ts, job seo-presence)
 *   needs you          the owner tasks about presence (src/cc/seo/owner.ts)
 *
 * Nothing here asks anybody while the page is drawn, except Bing's kept link
 * count (a cached read: no request when it is under a day old or there is no
 * key). Nothing here changes anything: the page's buttons mark an owner task
 * done (POST /api/v1/seo/owner-tasks/:id), run the weekly profile check now
 * (POST /api/v1/jobs/seo-presence/run) or queue an operator brief.
 *
 * NO INVENTED FIGURE. The board's "Domain rating", "DR" and "Follow" columns
 * have no free, honest source and are left out. "New" and "lost" links exist
 * only once Bing is connected, and "new" never counts Bing's first read. The
 * board's sample domains are layout: every row here is a site a source named.
 */
export const routes = new Hono<Vars>();

/* The engine's modules and the drain are loaded when asked, so one that does not load costs its part, not the page. */
const presenceMod = () => import("../../seo/presence.ts");
const ownerMod = () => import("../../seo/owner.ts");
const aiMod = () => import("../../seo/aisearch.ts");
const drainMod = () => import("../../vercel/drain.ts");
const ga4Mod = () => import("../../ga4.ts");

/* ---------- the question ------------------------------------------------------------------- */

const FROMS: SitesFrom[] = ["all", "links", "visits", "ai", "views"];
const SORTS: SitesSort[] = ["visits", "links", "newest", "domain"];

function askedOf(c: Context<Vars>): BacklinksQuery {
  const q = (c.req.query("q") ?? "").trim().toLowerCase().slice(0, 80);
  const from = c.req.query("from") as SitesFrom;
  const sort = c.req.query("sort") as SitesSort;
  return { q, from: FROMS.includes(from) ? from : "all", sort: SORTS.includes(sort) ? sort : "visits" };
}

type Window = SeoBacklinksPayload["window"];

/** Whole days ending yesterday, as GA4 and the drain count them, and the same length before. */
function windowOf(range: SeoRange): Window {
  const days = daysOf(range);
  const start = today(-days);
  return { start, end: today(-1), days, previousStart: addDays(start, -days), previousEnd: addDays(start, -1) };
}

/* ---------- hosts -------------------------------------------------------------------------- */

/** The website's own addresses: a visit "from" them is a click inside the site. */
const OWN = /(^|\.)balkaris\.ch$/i;
/** Search engines: their visits are search, counted on Search Console and Traffic, not links. Hosts only: gemini.google.com is an assistant. */
const SEARCH =
  /^(?:www\.)?(?:google\.[a-z]{2,3}(?:\.[a-z]{2})?|bing\.com|cn\.bing\.com|duckduckgo\.com|search\.yahoo\.com|yahoo\.com|ecosia\.org|startpage\.com|search\.brave\.com|qwant\.com|yandex\.[a-z]{2,3}|baidu\.com|ask\.com|search\.aol\.com|seznam\.cz)$|googlequicksearchbox/i;
/** What GA4 and the drain write when there is no site to name. */
const NOT_A_SITE = /^\((?:none|direct|not set|this site|unreadable|other)\)$/i;

const hostOf = (raw: string): string => {
  const s = raw.trim().toLowerCase();
  let h = s;
  if (s.includes("/") || s.includes(":")) {
    try {
      h = new URL(s.includes("://") ? s : `https://${s}`).hostname;
    } catch {
      h = s;
    }
  }
  return h.replace(/^www\./, "").replace(/\.$/, "");
};

/** The registrable part, for matching a referring host to a profile: l.instagram.com and instagram.com are one site. */
const siteOf = (host: string): string => {
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const two = parts.slice(-2);
  /* example.co.uk, example.com.au: the second level is part of the suffix. */
  return two[0]!.length <= 3 && two[1]!.length === 2 && ["co", "com", "org", "net", "ac", "gov"].includes(two[0]!) ? parts.slice(-3).join(".") : two.join(".");
};

/** A host a table of linking sites leaves out. */
const leftOut = (host: string): boolean => !host || NOT_A_SITE.test(host) || OWN.test(host) || SEARCH.test(host);

const LEFT_OUT = "Search engines are left out (their visits are searches, counted on Search Console), and so are the site's own addresses and visits with no referring site.";

/* ---------- Bing --------------------------------------------------------------------------- */

const BING_OFF = "Bing Webmaster Tools is not connected. Google gives no backlink figures by API: Bing's index of links is the one free source.";

type BingValue = { total: number; complete: boolean; pages: { path: string; links: number }[]; history: { day: string; links: number }[] };

async function bingCounts(w: Window): Promise<Reading<BingValue>> {
  if (!bing.configured()) return off("bing", BING_OFF, bing.step());
  const r = await bing.linkCounts();
  if (r.state !== "ok") return r;
  return {
    ...r,
    value: {
      total: r.value.total,
      complete: r.value.complete,
      pages: r.value.pages.map((p) => ({ path: p.path, links: p.links })),
      history: bing.linkHistory(w.days + 1),
    },
  };
}

function bingLinks(): Reading<bing.InboundLink[]> {
  if (!bing.configured()) return off("bing", BING_OFF, bing.step());
  return bing.inboundLinks(5000);
}

/* ---------- GA4 referrals ------------------------------------------------------------------ */

const GA4_NOTE = "GA4 sessions whose medium is referral, and sessions from AI assistants, consenting visitors only (GA4 loads after the cookie banner is accepted). Read once a day.";

interface Visits {
  reading: Reading<{ start: string; end: string; total: number; rows: Referrer[] }>;
  /** Sessions per host in the window before, when GA4 measured it whole; else null. */
  before: Map<string, number> | null;
  /** Hosts per day in the window, for the tile's line. */
  perDay: number[];
  /** Sites in the window before, when compared. */
  sitesBefore: number | null;
  /** The first day GA4 counted a visit from each host, over everything kept. */
  first: Map<string, string>;
}

async function visits(w: Window): Promise<Visits> {
  const empty = { before: null, perDay: [], sitesBefore: null, first: new Map<string, string>() };
  if (!hasKey()) return { ...empty, reading: off("ga4", "The desk has no Google service-account key on this machine, so GA4 cannot be asked for referrals.") };
  const job = jobStatus().find((j) => j.name === "seo-referrals");
  const { referrals, referralSpan, isAi } = await aiMod();
  const span = referralSpan();
  if (!span && !job?.lastEnd) {
    return { ...empty, reading: waiting("ga4", "GA4's referrals are read once a day (Automations: Read referrals and AI assistant visits from GA4); the first read has not run yet.") };
  }
  if (!span && job?.lastOk === false) {
    return { ...empty, reading: waiting("ga4", `GA4's referrals could not be read: ${scrub(job.lastNote ?? "no reason given")}`) };
  }
  const since = await (await ga4Mod()).measuredSince().catch(() => null);
  const compared = !!since && since <= w.previousStart;

  const byHost = new Map<string, { sessions: number; users: number; landing: Map<string, number>; ai: boolean }>();
  const daily = new Map<string, Set<string>>();
  for (const r of referrals(w.start, w.end)) {
    const host = hostOf(r.source);
    if (leftOut(host) && !isAi(r.source, r.medium)) continue;
    const h = byHost.get(host) ?? { sessions: 0, users: 0, landing: new Map<string, number>(), ai: false };
    h.sessions += r.sessions;
    h.users += r.users;
    h.landing.set(r.landing, (h.landing.get(r.landing) ?? 0) + r.sessions);
    h.ai ||= isAi(r.source, r.medium);
    byHost.set(host, h);
    if (r.sessions > 0) daily.set(r.day, (daily.get(r.day) ?? new Set<string>()).add(host));
  }
  let before: Map<string, number> | null = null;
  if (compared) {
    before = new Map();
    for (const r of referrals(w.previousStart, w.previousEnd)) {
      const host = hostOf(r.source);
      if (leftOut(host) && !isAi(r.source, r.medium)) continue;
      before.set(host, (before.get(host) ?? 0) + r.sessions);
    }
  }
  const first = new Map<string, string>();
  for (const r of db.prepare("SELECT source, MIN(day) AS d FROM cc_seo_referrals WHERE sessions > 0 GROUP BY source").all() as { source: string; d: string }[]) {
    const host = hostOf(r.source);
    const had = first.get(host);
    if (!had || r.d < had) first.set(host, r.d);
  }

  /* The page most of its sessions began on; "(not set)" only when GA4 named no page at all. */
  const top = (landing: Map<string, number>): string | null => {
    const named = [...landing.entries()].filter(([p]) => p.startsWith("/")).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return named[0]?.[0] ?? null;
  };
  const rows: Referrer[] = [...byHost.entries()]
    .filter(([, h]) => h.sessions > 0)
    .map(([host, h]) => ({ host, sessions: h.sessions, users: h.users, previous: before ? (before.get(host) ?? 0) : null, topLanding: top(h.landing), ai: h.ai }))
    .sort((a, b) => b.sessions - a.sessions || a.host.localeCompare(b.host));

  /* Read up to the day before the job's last good run; the days after that are read on its next run. */
  const lastGood = job?.lastOk && job.lastEnd ? job.lastEnd : null;
  const readTo = lastGood ? addDays(lastGood.slice(0, 10), -1) : (span?.to ?? null);
  const late = readTo && readTo < w.end ? ` Read up to ${readTo}; the days after are read on the next run.` : "";
  const partly = since && since > w.start ? ` GA4 measures the website from ${since}, so the window counts from then.` : "";
  const perDay: number[] = [];
  for (let d = since && since > w.start ? since : w.start; d <= w.end; d = addDays(d, 1)) perDay.push(daily.get(d)?.size ?? 0);

  return {
    reading: ok({ start: w.start, end: w.end, total: rows.reduce((n, r) => n + r.sessions, 0), rows }, "ga4", lastGood ?? new Date().toISOString(), `${GA4_NOTE}${partly}${late}`),
    before,
    perDay,
    sitesBefore: before ? [...before.values()].filter((n) => n > 0).length : null,
    first,
  };
}

/* ---------- Vercel's request records ------------------------------------------------------- */

const DRAIN_STEP = "Run bash deploy/vercel-connect.sh on the workstation: it creates the log drain for the website's production and puts VERCEL_DRAIN_SECRET in the desk's environment (Hosting shows its state).";

type DrainValue = SeoBacklinksPayload["drain"] extends Reading<infer T> ? T : never;

async function drainRefs(w: Window): Promise<{ reading: Reading<DrainValue>; first: Map<string, string> }> {
  const first = new Map<string, string>();
  const d = await drainMod();
  const s = d.drainState();
  if (!s.ready) return { first, reading: off("vercel-drain", "Vercel's request records do not reach the desk yet: no log drain delivers to it.", DRAIN_STEP) };
  const days = d.deliveredDays(w.start, w.end);
  if (!days.size) {
    return {
      first,
      reading: waiting("vercel-drain", s.last ? `Vercel's records reached the desk for no day of this window; the last delivery came ${s.last.slice(0, 10)}.` : "The drain's secret is set and no signed delivery has arrived yet."),
    };
  }
  const rows = d
    .topBetween("ref", w.start, w.end, 300)
    .map((r) => ({ host: hostOf(r.key), views: r.n }))
    .filter((r) => !leftOut(r.host));
  for (const r of db.prepare("SELECT key, MIN(day) AS d FROM cc_drain_days WHERE dim = 'ref' AND n > 0 GROUP BY key").all() as { key: string; d: string }[]) {
    const host = hostOf(r.key);
    const had = first.get(host);
    if (!had || r.d < had) first.set(host, r.d);
  }
  const span = Math.round((Date.parse(w.end) - Date.parse(w.start)) / 86_400_000) + 1;
  return {
    first,
    reading: ok(
      { start: w.start, end: w.end, days: days.size, total: rows.reduce((n, r) => n + r.views, 0), rows },
      "vercel-drain",
      s.last ?? new Date().toISOString(),
      `Page views by referring site (host only) from Vercel's own record of every request: every visitor, no consent needed because no script runs. Counted on ${days.size} of ${span} days; a day the drain did not deliver is unknown, not zero.`,
    ),
  };
}

/* ---------- the linking-sites table -------------------------------------------------------- */

interface Sources {
  links: Reading<bing.InboundLink[]>;
  visits: Visits;
  drain: Awaited<ReturnType<typeof drainRefs>>;
  profiles: ProfileRow[];
}

function sitesOf(s: Sources, asked: BacklinksQuery, isAi: (source: string, medium: string) => boolean, aiLabel: (source: string) => string): SitesList {
  type Bucket = { links: bing.InboundLink[]; sessions: Referrer | null; views: number | null };
  const by = new Map<string, Bucket>();
  const take = (host: string): Bucket => {
    const had = by.get(host);
    if (had) return had;
    const b: Bucket = { links: [], sessions: null, views: null };
    by.set(host, b);
    return b;
  };
  if (s.links.state === "ok") for (const l of s.links.value) if (!leftOut(hostOf(l.host))) take(hostOf(l.host)).links.push(l);
  if (s.visits.reading.state === "ok") for (const r of s.visits.reading.value.rows) take(r.host).sessions = r;
  if (s.drain.reading.state === "ok") for (const r of s.drain.reading.value.rows) take(r.host).views = (by.get(r.host)?.views ?? 0) + r.views;

  /* The studio's own profiles, by site: a visit from l.instagram.com is from Instagram. Google's address is search, never a profile. */
  const profileBy = new Map<string, ProfileRow>();
  for (const p of s.profiles) {
    if (!p.url) continue;
    const h = hostOf(p.url);
    if (leftOut(h)) continue;
    if (!profileBy.has(siteOf(h))) profileBy.set(siteOf(h), p);
  }

  const bingOk = s.links.state === "ok";
  const ga4Ok = s.visits.reading.state === "ok";
  const drainOk = s.drain.reading.state === "ok";
  const most = (list: string[]): string | null => {
    const n = new Map<string, number>();
    for (const x of list) if (x) n.set(x, (n.get(x) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  };

  const all: LinkingSite[] = [...by.entries()].map(([host, b]) => {
    const ai = isAi(host, "");
    const profile = profileBy.get(siteOf(host)) ?? null;
    const linkFirst = b.links.map((l) => l.firstSeen).sort()[0] ?? null;
    const seen: { day: string; by: "bing" | "ga4" | "vercel-drain" }[] = [];
    if (linkFirst) seen.push({ day: linkFirst, by: "bing" });
    const g = s.visits.first.get(host);
    if (g) seen.push({ day: g, by: "ga4" });
    const v = s.drain.first.get(host);
    if (v) seen.push({ day: v, by: "vercel-drain" });
    seen.sort((a, z) => a.day.localeCompare(z.day));
    return {
      host,
      kind: ai || b.sessions?.ai ? "ai" : profile ? "profile" : "site",
      label: ai || b.sessions?.ai ? aiLabel(host) : profile ? profile.name : null,
      profileKey: profile?.key ?? null,
      links: bingOk
        ? {
            count: b.links.length,
            pages: new Set(b.links.map((l) => l.source)).size,
            anchor: most(b.links.map((l) => l.anchor)),
            target: most(b.links.map((l) => l.path)),
            firstSeen: linkFirst,
          }
        : null,
      visits: ga4Ok ? { sessions: b.sessions?.sessions ?? 0, previous: s.visits.before ? (s.visits.before.get(host) ?? 0) : null, landing: b.sessions?.topLanding ?? null } : null,
      views: drainOk ? (b.views ?? 0) : null,
      firstSeen: seen[0] ?? null,
    } satisfies LinkingSite;
  });

  const has: Record<SitesFrom, (r: LinkingSite) => boolean> = {
    all: () => true,
    links: (r) => (r.links?.count ?? 0) > 0,
    visits: (r) => (r.visits?.sessions ?? 0) > 0,
    ai: (r) => r.kind === "ai",
    views: (r) => (r.views ?? 0) > 0,
  };
  const counts = Object.fromEntries(FROMS.map((f) => [f, all.filter(has[f]).length])) as Record<SitesFrom, number>;
  const matching = all.filter((r) => has[asked.from](r) && (!asked.q || r.host.includes(asked.q) || (r.label ?? "").toLowerCase().includes(asked.q)));
  const visitsOf = (r: LinkingSite) => r.visits?.sessions ?? -1;
  const linksOf = (r: LinkingSite) => r.links?.count ?? -1;
  const viewsOf = (r: LinkingSite) => r.views ?? -1;
  const order: Record<SitesSort, (a: LinkingSite, b: LinkingSite) => number> = {
    visits: (a, b) => visitsOf(b) - visitsOf(a) || viewsOf(b) - viewsOf(a) || linksOf(b) - linksOf(a) || a.host.localeCompare(b.host),
    links: (a, b) => linksOf(b) - linksOf(a) || visitsOf(b) - visitsOf(a) || a.host.localeCompare(b.host),
    newest: (a, b) => (b.firstSeen?.day ?? "").localeCompare(a.firstSeen?.day ?? "") || a.host.localeCompare(b.host),
    domain: (a, b) => a.host.localeCompare(b.host),
  };
  matching.sort(order[asked.sort]);
  return { rows: matching.slice(0, 200), total: matching.length, counts, leftOut: LEFT_OUT };
}

/* ---------- name, address and phone -------------------------------------------------------- */

type Field = "name" | "address" | "phone";
const FIELDS: Field[] = ["name", "address", "phone"];

/**
 * Two values are one when they differ only in capitals, spaces, punctuation or
 * word order ("Musterweg 1, Zürich 8000" and "Musterweg 1, 8000 Zürich"); "strasse" and "str."
 * are one; a phone is its digits, +41 and 0041 read as 0.
 */
const NORMAL: Record<Field, (s: string) => string> = {
  name: (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""),
  address: (s) =>
    s
      .toLowerCase()
      .replace(/strasse\b/g, "str")
      .replace(/str\./g, "str")
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
      .sort()
      .join(" "),
  phone: (s) => {
    const d = s.replace(/[^\d+]/g, "");
    return d.startsWith("+41") ? `0${d.slice(3)}` : d.startsWith("0041") ? `0${d.slice(4)}` : d;
  },
};
const NAP_RULE =
  "Two values are the same when they differ only in capitals, spaces, punctuation or word order, or in “strasse” written “str.”; a phone is compared by its digits, with +41 read as 0. A different spelling is a different value: that is what a search engine sees.";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Each field as each profile states it: read by the weekly check when it could, else as the audit saw it on its day. */
function stated(p: ProfileRow, field: Field): { value: string; read: boolean; day: string } | null {
  const read = p.nap?.[field];
  if (read && p.checkedAt) return { value: read, read: true, day: p.checkedAt.slice(0, 10) };
  const seen = p.napSeen?.[field];
  if (seen && p.napSeen) return { value: seen, read: false, day: p.napSeen.day };
  return null;
}

function napOf(rows: ProfileRow[], decision: NapView["decision"]): { view: NapView; cells: Map<string, ProfileLine["shown"]> } {
  const cells = new Map<string, ProfileLine["shown"]>(rows.map((p) => [p.key, { name: null, address: null, phone: null }]));
  const fields: NapView["fields"] = [];
  const groups: NapView["groups"] = [];
  for (const field of FIELDS) {
    const variants: { key: string; variant: string; value: string; sources: string[] }[] = [];
    const values: NapView["fields"][number]["values"] = [];
    for (const p of rows) {
      const s = stated(p, field);
      if (!s) continue;
      const key = NORMAL[field](s.value);
      let v = variants.find((x) => x.key === key);
      if (!v) {
        v = { key, variant: LETTERS[variants.length] ?? `#${variants.length + 1}`, value: s.value, sources: [] };
        variants.push(v);
      }
      v.sources.push(p.name);
      values.push({ source: s.read ? p.name : `${p.name} (as the audit saw it)`, value: s.value, day: s.day });
      const cell: NapCell = { value: s.value, variant: v.variant, read: s.read, day: s.day };
      cells.get(p.key)![field] = cell;
    }
    fields.push({ field, values, consistent: variants.length <= 1 });
    groups.push({ field, variants: variants.map(({ variant, value, sources }) => ({ variant, value, sources })) });
  }
  return { view: { fields, consistent: fields.every((f) => f.consistent), groups, decision, rule: NAP_RULE }, cells };
}

/* ---------- owner tasks about presence ------------------------------------------------------ */

/** The owner tasks this page carries: profiles, listings, reviews, credits, the one true name, address and phone. */
const PRESENCE = new Set([
  "nap-decision",
  "business-profile",
  "bing-webmaster",
  "bing-places-apple",
  "linkedin",
  "local-listings",
  "commercial-register",
  "directories",
  "reviews",
  "client-credits",
  "local-business-lists",
  "partner-programmes",
  "awards",
  "wikidata",
  "off-site-presence",
  "crawl-demand",
]);

type Task = OwnerTaskRow & { whoAll: string };
const plain = ({ whoAll: _, ...t }: Task): OwnerTaskRow => t;

/**
 * The task that creates or fixes a profile: the one the registry names when
 * it exists; else, for a profile the registry names none for or names a task
 * that does not exist, the owner's task whose step names the profile ("Then
 * get the free basic local.ch entry" is local.ch's).
 */
function taskFor(p: ProfileRow, tasks: Task[]): Task | null {
  const named = p.ownerTaskId ? tasks.find((t) => t.id === p.ownerTaskId) : undefined;
  if (named) return named;
  if (p.ownerTaskId === null && p.state === "exists") return null;
  const word = p.name.split(/\s+[(@]/)[0]!.trim();
  if (word.length < 4) return null;
  const re = new RegExp(`(^|[^\\p{L}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "iu");
  const naming = tasks.filter((t) => t.whoAll === "owner" && re.test(t.step));
  /* The task about this kind of profile before the two that name every profile in passing. */
  return naming.find((t) => !GENERAL.has(t.id)) ?? naming[0] ?? null;
}

/** Owner tasks that name every kind of profile in one list: a profile's own task is preferred to them. */
const GENERAL = new Set(["off-site-presence", "crawl-demand"]);

/* ---------- tiles --------------------------------------------------------------------------- */

function linksTile(counts: Reading<BingValue>, links: Reading<bing.InboundLink[]>, w: Window): Reading<Stat> {
  if (counts.state !== "ok") return counts;
  const history = counts.value.history.filter((h) => h.day >= w.start);
  const first = since("bing.links");
  const then = first && first <= w.previousEnd ? [...counts.value.history].reverse().find((h) => h.day <= w.previousEnd) : undefined;
  let sub: string | undefined;
  if (links.state === "ok") {
    /* Bing's first read gives every link it knows that day: nothing is called new before the second. */
    const fresh = first ? links.value.filter((l) => l.firstSeen > first && l.firstSeen >= w.start).length : 0;
    sub = first && first >= w.start ? `First read ${first}: nothing called new before the next` : `${fresh.toLocaleString("en-GB")} first reported in the period`;
  }
  return {
    ...counts,
    value: { value: counts.value.total, previous: then ? then.links : null, unit: "count", series: history.map((h) => h.links), ...(sub ? { sub } : {}) },
  };
}

function sitesTile(v: Visits): Reading<Stat> {
  const r = v.reading;
  if (r.state !== "ok") return r;
  const ai = r.value.rows.filter((x) => x.ai).reduce((n, x) => n + x.sessions, 0);
  const s = r.value.total;
  const sub = `${s.toLocaleString("en-GB")} session${s === 1 ? "" : "s"}${ai ? `, ${ai.toLocaleString("en-GB")} from AI assistants` : ""}`;
  return { ...r, value: { value: r.value.rows.length, previous: v.sitesBefore, unit: "count", series: v.perDay, sub } };
}

/* ---------- the page ------------------------------------------------------------------------ */

async function page(c: Context<Vars>): Promise<SeoBacklinksPayload> {
  const range = rangeFrom(c);
  const asked = askedOf(c);
  const w = windowOf(range);

  const [counts, links, v, drain, ai] = await Promise.all([
    reading("bing", () => bingCounts(w)),
    reading("bing", () => bingLinks()),
    visits(w).catch((e): Visits => ({ reading: waiting("ga4", `The last read failed: ${scrub(e instanceof Error ? e.message : String(e)).slice(0, 160)}`), before: null, perDay: [], sitesBefore: null, first: new Map() })),
    drainRefs(w).catch((e) => ({ first: new Map<string, string>(), reading: waiting<DrainValue>("vercel-drain", `The drain's records could not be read: ${scrub(e instanceof Error ? e.message : String(e)).slice(0, 160)}`) })),
    aiMod().catch(() => null),
  ]);

  /* The registry, the owner tasks, the name/address/phone matrix: the desk's own tables. */
  let rows: ProfileRow[] = [];
  let registryFailed: string | null = null;
  try {
    rows = (await presenceMod()).profiles();
  } catch (e) {
    registryFailed = scrub(e instanceof Error ? e.message : String(e)).slice(0, 160);
  }
  let tasks: Task[] = [];
  try {
    tasks = (await ownerMod()).ownerTasks(["owner", "lead-chrome"]) as Task[];
  } catch {
    tasks = [];
  }
  const decisionTask = tasks.find((t) => t.id === "nap-decision");
  const decision = decisionTask ? { id: decisionTask.id, title: decisionTask.title, done: decisionTask.done } : null;
  const nap = napOf(rows, decision);
  const checkedAt = rows.map((p) => p.checkedAt).filter((x): x is string => !!x).sort().at(-1) ?? null;

  const lines: ProfileLine[] = rows.map((p) => {
    const t = taskFor(p, tasks);
    return { ...p, shown: nap.cells.get(p.key)!, task: t ? { id: t.id, title: t.title, done: t.done } : null };
  });
  const NO_REGISTRY = "No profile or listing is recorded yet: they come in with the SEO audit's import (on the box: npm run seo:import, or the owner's POST /api/v1/seo/imports/audit), and the weekly check reads them after that.";
  const profiles: SeoBacklinksPayload["profiles"] = registryFailed
    ? waiting("desk", `The registry could not be read: ${registryFailed}`)
    : rows.length
      ? ok({ rows: lines, checkedAt }, "desk", checkedAt ?? new Date().toISOString(), "The registry the SEO audit seeded, checked once a week: each address is asked whether it answers. A profile without an address keeps the audit's finding until it has one.")
      : waiting("desk", NO_REGISTRY);
  const napReading: SeoBacklinksPayload["nap"] = profiles.state !== "ok" ? profiles : ok(nap.view, "desk", checkedAt ?? new Date().toISOString(), "What each profile states: read from the profile by the weekly check where it could, else what the audit saw on its day.");

  const linked = new Set(lines.map((l) => l.task?.id).filter((x): x is string => !!x));
  const needs = tasks.filter((t) => t.who === "owner" && (PRESENCE.has(t.id) || linked.has(t.id)));
  /* The one decision every listing copies comes first, done or not. */
  needs.sort((a, b) => Number(b.id === "nap-decision") - Number(a.id === "nap-decision"));
  const needsYou = needs.map(plain);

  /* The table stands while any of its three sources has something; each missing one is its own column's dash. */
  let sites: SeoBacklinksPayload["sites"];
  if (v.reading.state !== "ok" && links.state !== "ok" && drain.reading.state !== "ok") sites = waiting(v.reading.source, `No source of linking sites can be read. GA4: ${v.reading.reason} Bing: ${links.reason}`);
  else if (!ai) sites = waiting("desk", "The SEO engine's AI-assistant rules did not load, so the table cannot be drawn.");
  else {
    const from = v.reading.state === "ok" ? "ga4" : links.state === "ok" ? "bing" : "vercel-drain";
    sites = ok(sitesOf({ links, visits: v, drain, profiles: rows }, asked, ai.isAi, ai.aiLabel), from, new Date().toISOString(), LEFT_OUT);
  }

  const open = needsYou.filter((t) => !t.done).length;
  const statedFields = nap.view.fields.filter((f) => f.values.length);
  const variantsOf = (f: Field) => nap.view.groups.find((g) => g.field === f)?.variants.length ?? 0;
  const tiles: BacklinksTiles = {
    links: linksTile(counts, links, w),
    sites: sitesTile(v),
    profiles:
      profiles.state === "ok"
        ? {
            ...profiles,
            value: {
              value: rows.filter((p) => p.state === "exists").length,
              previous: null,
              unit: "count",
              series: [],
              of: rows.length,
              sub: `${rows.filter((p) => p.state === "not-found").length} not found, ${rows.filter((p) => p.state === "unknown" || p.state === "not-checked").length} not readable`,
            },
          }
        : profiles,
    nap:
      profiles.state === "ok" && statedFields.length
        ? {
            ...profiles,
            value: {
              value: statedFields.filter((f) => f.consistent).length,
              previous: null,
              unit: "count",
              series: [],
              of: statedFields.length,
              sub: `In use: ${variantsOf("name")} name${variantsOf("name") === 1 ? "" : "s"}, ${variantsOf("address")} address${variantsOf("address") === 1 ? "" : "es"}, ${variantsOf("phone")} phone${variantsOf("phone") === 1 ? "" : "s"}`,
            },
          }
        : profiles.state === "ok"
          ? waiting("desk", "No profile states a name, address or phone yet.")
          : profiles,
    needsYou: needsYou.length
      ? ok({ value: open, previous: null, unit: "count", series: [], of: needsYou.length, sub: `${needsYou.length - open} marked done` }, "desk", new Date().toISOString(), "Steps only the owner can take (a login, a decision, a profile), from the SEO audit. Done is a person's mark, never the desk's.")
      : waiting("desk", "No owner task about profiles or listings is recorded yet: they come in with the SEO audit's import."),
  };

  const job = jobStatus().find((j) => j.name === "seo-presence");
  return {
    head: head(range),
    asked,
    window: w,
    tiles,
    bing: counts,
    referrers: v.reading,
    drain: drain.reading,
    sites,
    profiles,
    nap: napReading,
    needsYou,
    presenceJob: job
      ? { name: job.name, title: job.title, enabled: job.enabled, running: job.running, lastEnd: job.lastEnd, lastOk: job.lastOk, lastNote: job.lastNote === null ? null : scrub(job.lastNote), nextRun: job.nextRun, ready: job.ready }
      : null,
  };
}

routes.get("/", async (c) => c.json<SeoBacklinksPayload>(await page(c)));

/* ---------- GET /export.csv ------------------------------------------------------------------- */

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  let s = String(v);
  /* A spreadsheet runs a cell that starts like a formula. */
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: unknown[][]): string => `﻿${rows.map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;

routes.get("/export.csv", async (c) => {
  const p = await page(c);
  const list = c.req.query("list") === "profiles" ? "profiles" : "sites";
  const w = `${p.window.start} to ${p.window.end}`;
  let body: string;
  if (list === "profiles") {
    if (p.profiles.state !== "ok") return c.json({ error: `There is nothing to export yet: ${p.profiles.reason}` }, 409);
    const shown = (x: NapCell | null) => (x ? `${x.value} [${x.variant}]${x.read ? "" : ` (as the audit saw it, ${x.day})`}` : "");
    body = csv([
      ["Profile", "Kind", "Address of the profile", "State", "Why", "Checked", "Name [variant]", "Address [variant]", "Phone [variant]", "Owner step"],
      ...p.profiles.value.rows.map((r) => [r.name, r.kind, r.url, r.state, r.stateWhy, r.checkedAt, shown(r.shown.name), shown(r.shown.address), shown(r.shown.phone), r.task ? `${r.task.title}${r.task.done ? " (done)" : ""}` : ""]),
    ]);
  } else {
    if (p.sites.state !== "ok") return c.json({ error: `There is nothing to export yet: ${p.sites.reason}` }, 409);
    body = csv([
      [
        "Site",
        "Kind",
        "Profile or assistant",
        "Links (Bing)",
        "Linking pages (Bing)",
        "Anchor text, most used (Bing)",
        "Page linked to (Bing)",
        `Sessions (GA4, ${w})`,
        "Sessions in the window before (GA4)",
        "Landing page, most sessions (GA4)",
        `Page views referred (Vercel, ${w})`,
        "First seen",
        "First seen by",
      ],
      ...p.sites.value.rows.map((r) => [
        r.host,
        r.kind,
        r.label,
        r.links?.count,
        r.links?.pages,
        r.links?.anchor,
        r.links?.target,
        r.visits?.sessions,
        r.visits?.previous,
        r.visits?.landing,
        r.views,
        r.firstSeen?.day,
        r.firstSeen ? { bing: "Bing", ga4: "GA4", "vercel-drain": "Vercel" }[r.firstSeen.by] : "",
      ]),
    ]);
  }
  c.header("content-type", "text/csv; charset=utf-8");
  c.header("content-disposition", `attachment; filename="balkaris-${list === "profiles" ? "profiles-and-listings" : "linking-sites"}-${today()}.csv"`);
  return c.body(body);
});
