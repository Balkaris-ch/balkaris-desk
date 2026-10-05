import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { db } from "../../../db.ts";
import { me, requireOwner, type Vars } from "../../access.ts";
import { hasKey } from "../../gauth.ts";
import { status as jobStatus } from "../../scheduler.ts";
import * as bing from "../../search/bing.ts";
import * as gsc from "../../search/gsc.ts";
import { addDays } from "../../search/shared.ts";
import { off, ok, reading, since, today, waiting } from "../../store.ts";
import { scrub } from "../../system.ts";
import type { ApiError, Reading, Stat } from "../../../../web/src/contract/common.ts";
import type { OwnerTaskRow, SeoRange } from "../../../../web/src/contract/seo/common.ts";
import type {
  BacklinksAnswer,
  BacklinksQuery,
  BacklinksTiles,
  GoogleLinks,
  JobLine,
  KnownLink,
  LinkCheckAnswer,
  LinkingSite,
  LinkSource,
  LinksImportAnswer,
  LinkState,
  NapCell,
  NapField,
  NapView,
  ProfileLine,
  ProfileRow,
  Referrer,
  SeoBacklinksPayload,
  SiteDetail,
  SitesFrom,
  SitesList,
  SitesSort,
  TrackedList,
} from "../../../../web/src/contract/seo/backlinks.ts";
import { daysOf } from "../../seo/rank.ts";
import { body, head, int, rangeFrom } from "./shared.ts";

/**
 * /api/v1/seo/backlinks — SEO › Backlinks: who links to the website, who
 * sends it visitors, the links being worked on, and the studio's profiles and
 * listings with the name, address and phone each states.
 *
 *   GET  /                    the whole page (contract/seo/backlinks.ts, SeoBacklinksPayload)
 *                             ?range=7d|30d|90d|1y&q=<host or address>&from=all|links|google|visits|ai|views|new
 *                             &sort=visits|links|newest|domain&page=<n>&open=<site>
 *   GET  /export.csv          list=sites (the default): every row matching the filters, not one page;
 *                             list=profiles: the registry with what each states;
 *                             list=links: every linking page any source names
 *   POST /check               { url, fresh? }     read one page of the web for a link to the website
 *   POST /links               { url, note? }      follow a link, or a page a link is expected on
 *   POST /links/:id           { tracked?, note? } stop or start following, or change the note
 *   POST /links/:id/check                         read that page again now
 *   POST /import      OWNER   { csv }             Search Console's Links export, any of its four tables
 *   POST /profiles            { name, kind, url? } add a profile or listing
 *   POST /profiles/:key       { name?, kind?, url?, stated?, remove? }
 *   POST /profiles/:key/check                     ask that one address now
 *   POST /profiles/:key/found { use }             take or dismiss an address the weekly check found
 *   POST /nap         OWNER   { name, address, phone } the one true name, address and phone
 *
 * Every change answers { ok, line } with the sentence shown beside its
 * button, or { error } in a sentence; nothing here touches the live website.
 *
 * WHERE EACH PART COMES FROM, each its own reading, so one source that fails
 * costs its own tile, column or panel and nothing else:
 *
 *   links              Bing Webmaster's index of links (src/cc/search/bing.ts), read
 *                      from what its daily job kept: drawing the page never asks Bing.
 *                      Search Console's Links report, exported by hand and imported
 *                      (src/cc/seo/backlinks.ts). The desk's own reading of linking
 *                      pages: a page a person had checked or follows, a page from the
 *                      export, a referring page GA4 named (job seo-backlinks).
 *   sites that sent    GA4 sessions by the session's source (cc_seo_referrals, job
 *   visitors           seo-referrals: medium referral and AI assistants) and by the
 *                      referring address (cc_seo_ref_pages, job seo-backlinks: every
 *                      medium, so the Instagram bio link is there). The two are two
 *                      reports of the same sessions: per site and day the larger is
 *                      taken, never the sum. Consenting visitors only.
 *   page views         Vercel's own request records by referring site
 *                      (src/cc/vercel/drain.ts), once the log drain delivers
 *   profiles, NAP      the registry (src/cc/seo/presence.ts, job seo-presence), with
 *                      what people on the desk added and corrected, and the one true
 *                      name, address and phone once the owner recorded it
 *   needs you          the owner tasks about presence (src/cc/seo/owner.ts)
 *
 * ONE ROW PER SITE. A host is reduced to its site (l.instagram.com and
 * instagram.com are one; GA4's "ig" is instagram.com), except an AI
 * assistant, which keeps its own host (gemini.google.com is not Google
 * search). The hosts seen under a row are listed with it.
 *
 * NO INVENTED FIGURE. The board's "Domain rating" and "DR" have no free,
 * honest source and are left out. "Follow" is read from the linking page
 * itself, by the desk, and is empty where the desk read no page. "New" and
 * "lost" are the desk's own readings of a linking page (and Bing's list, once
 * connected); a page that could not be read is unknown, never lost.
 */
export const routes = new Hono<Vars>();

/* The engine's modules and the drain are loaded when asked, so one that does not load costs its part, not the page. */
const presenceMod = () => import("../../seo/presence.ts");
const ownerMod = () => import("../../seo/owner.ts");
const aiMod = () => import("../../seo/aisearch.ts");
const drainMod = () => import("../../vercel/drain.ts");
const ga4Mod = () => import("../../ga4.ts");
const linksMod = () => import("../../seo/backlinks.ts");
const auditMod = () => import("../../site/audit.ts");

type Presence = Awaited<ReturnType<typeof presenceMod>>;
type Links = Awaited<ReturnType<typeof linksMod>>;

/* ---------- the question ------------------------------------------------------------------- */

const FROMS: SitesFrom[] = ["all", "links", "google", "visits", "ai", "views", "new"];
const SORTS: SitesSort[] = ["visits", "links", "newest", "domain"];
/** Rows on one page of the table. The CSV has every matching row. */
const PER_PAGE = 50;

function askedOf(c: Context<Vars>): BacklinksQuery {
  const raw = (c.req.query("q") ?? "").trim().toLowerCase().slice(0, 300);
  /* A pasted address or a www. spelling is searched by its host: "https://chatgpt.com/" finds chatgpt.com. */
  const q = (/[/:]/.test(raw) || raw.startsWith("www.") ? hostOf(raw) : raw).slice(0, 80);
  const from = c.req.query("from") as SitesFrom;
  const sort = c.req.query("sort") as SitesSort;
  const open = hostOf(c.req.query("open") ?? "").slice(0, 120);
  return {
    q,
    from: FROMS.includes(from) ? from : "all",
    sort: SORTS.includes(sort) ? sort : "visits",
    page: int(c.req.query("page"), 1, 1, 10_000),
    open: /^[a-z0-9.-]+$/.test(open) ? open : "",
  };
}

type Window = SeoBacklinksPayload["window"];

/** Whole days ending yesterday, as GA4 and the drain count them, and the same length before. */
function windowOf(range: SeoRange): Window {
  const days = daysOf(range);
  const start = today(-days);
  return { start, end: today(-1), days, previousStart: addDays(start, -days), previousEnd: addDays(start, -1) };
}

const bad = (message: string): never => {
  throw new HTTPException(400, { message });
};

/* ---------- hosts -------------------------------------------------------------------------- */

/** The website's own addresses: a visit "from" them is a click inside the site. */
const OWN = /(^|\.)balkaris\.ch$/i;
/** Search engines: their visits are search, counted on Search Console and Traffic, not links. Hosts only: gemini.google.com is an assistant. */
const SEARCH =
  /^(?:www\.)?(?:google\.[a-z]{2,3}(?:\.[a-z]{2})?|bing\.com|cn\.bing\.com|duckduckgo\.com|search\.yahoo\.com|yahoo\.com|ecosia\.org|startpage\.com|search\.brave\.com|qwant\.com|yandex\.[a-z]{2,3}|baidu\.com|ask\.com|search\.aol\.com|seznam\.cz)$|googlequicksearchbox/i;
/** What GA4 and the drain write when there is no site to name. */
const NOT_A_SITE = /^\((?:none|direct|not set|this site|unreadable|other|data not available)\)$/i;

/** A host from an address, a host, or GA4's source: lower case, without www. and a trailing dot. */
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

/** The registrable part: l.instagram.com and instagram.com are one site. */
const siteOf = (host: string): string => {
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const two = parts.slice(-2);
  /* example.co.uk, example.com.au: the second level is part of the suffix. */
  return two[0]!.length <= 3 && two[1]!.length === 2 && ["co", "com", "org", "net", "ac", "gov"].includes(two[0]!) ? parts.slice(-3).join(".") : two.join(".");
};

/**
 * What GA4 writes as a source when a link carries a short name instead of a
 * host, and the doorways networks send their clicks through, as the site
 * they are. The Instagram bio link arrives as source "ig".
 */
const ALIAS: Record<string, string> = {
  ig: "instagram.com",
  instagram: "instagram.com",
  fb: "facebook.com",
  facebook: "facebook.com",
  li: "linkedin.com",
  linkedin: "linkedin.com",
  "lnkd.in": "linkedin.com",
  "t.co": "x.com",
  "twitter.com": "x.com",
  yt: "youtube.com",
  "youtu.be": "youtube.com",
};

/** A host a table of linking sites leaves out. */
const leftOut = (host: string): boolean => !host || NOT_A_SITE.test(host) || OWN.test(host) || SEARCH.test(host);

const LEFT_OUT = "Search engines are left out (their visits are searches, counted on Search Console), and so are the site's own addresses and visits with no referring site.";

/**
 * The AI assistants, anchored to the end of a host. The engine's own pattern
 * (aisearch.ts AI_SOURCES) is a bare search, so thankyou.com would pass as
 * You.com; here only a host that IS the assistant, or ends in it, does.
 */
interface Ai {
  host: (host: string) => boolean;
  label: (source: string) => string;
  medium: string;
}
function aiOf(m: Awaited<ReturnType<typeof aiMod>>): Ai {
  const anchored = new RegExp(`(?:^|\\.)(?:${m.AI_SOURCES.source})$`, "i");
  return { host: (h) => anchored.test(h), label: m.aiLabel, medium: m.AI_MEDIUM };
}

/** The row a host belongs to: its site, or its own host for an AI assistant. Null when the table leaves it out. */
function keyOf(raw: string, ai: Ai, aiByMedium = false): string | null {
  const h = hostOf(raw);
  const named = ALIAS[h] ?? h;
  const isAi = ai.host(named) || aiByMedium;
  if (leftOut(named) && !isAi) return null;
  return isAi ? named : siteOf(named);
}

/** An address without its scheme, www. and closing slash, to tell whether one page is another. */
const bare = (url: string): string =>
  url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");

/* ---------- Bing --------------------------------------------------------------------------- */

const BING_OFF = "Bing Webmaster Tools is not connected. Google gives no backlink figures by API: Bing's index of links is the one free source that has one.";

type BingValue = SeoBacklinksPayload["bing"] extends Reading<infer T> ? T : never;

/** Bing's counts as its daily job kept them: never a request while the page is drawn. */
function bingCounts(w: Window): Reading<BingValue> {
  if (!bing.configured()) return off("bing", BING_OFF, bing.step());
  const r = bing.linkCountsKept();
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

/* ---------- GA4 referrals ------------------------------------------------------------------ */

const GA4_NOTE =
  "GA4 sessions from other sites: by the session's source (medium referral, and AI assistants) and by the referring address (every medium, so a link in an Instagram bio counts). Two reports of the same sessions: per site and day the larger is taken, never both. Consenting visitors only (GA4 loads after the cookie banner is accepted). Read once a day.";

interface SiteVisits {
  /** Sessions per day, the larger of the two reports. */
  days: Map<string, number>;
  landing: Map<string, number>;
  /** Referring addresses GA4 named, with their sessions. */
  referrers: Map<string, number>;
  users: number;
  ai: boolean;
  /** Every host GA4 named under this site. */
  hosts: Set<string>;
}

interface Visits {
  reading: Reading<{ start: string; end: string; total: number; rows: Referrer[] }>;
  by: Map<string, SiteVisits>;
  /** Sessions per site in the window before, when GA4 measured it whole; else null. */
  before: Map<string, number> | null;
  /** Sites per day in the window, for the tile's line. */
  perDay: number[];
  sitesBefore: number | null;
  /** The first day GA4 counted a visit from each site, over everything kept. */
  first: Map<string, string>;
}

const noVisits = (reading: Visits["reading"]): Visits => ({ reading, by: new Map(), before: null, perDay: [], sitesBefore: null, first: new Map() });

/**
 * The first whole day GA4 measured (ga4.ts keeps it beside `since` in
 * cc_state; measuredSince() writes it). When it cannot be read, the day after
 * `since`: comparing with a window that began part-way through a day is what
 * Traffic refuses, and so does this page.
 */
async function measured(): Promise<{ since: string | null; fullFrom: string | null }> {
  const g = await ga4Mod();
  const s = await g.measuredSince().catch(() => null);
  if (!s) return { since: null, fullFrom: null };
  let full: string | null = null;
  try {
    for (const r of db.prepare("SELECT value FROM cc_state WHERE key LIKE ?").all(`ga4:measured:%:${g.hosts().join(",")}`) as { value: string }[]) {
      const v = JSON.parse(r.value) as { since?: unknown; fullFrom?: unknown };
      if (v.since === s && typeof v.fullFrom === "string" && /^\d{4}-\d\d-\d\d$/.test(v.fullFrom)) full = v.fullFrom;
    }
  } catch {
    full = null;
  }
  return { since: s, fullFrom: full ?? addDays(s, 1) };
}

/** Zurich's date of an instant: the jobs read "up to yesterday" in Zurich. */
const zurichDay = (iso: string): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(iso));

async function visits(w: Window, ai: Ai, L: Links | null): Promise<Visits> {
  if (!hasKey()) return noVisits(off("ga4", "The desk has no Google service-account key on this machine, so GA4 cannot be asked for referrals."));
  const jobs = jobStatus();
  const srcJob = jobs.find((j) => j.name === "seo-referrals");
  const refJob = jobs.find((j) => j.name === "seo-backlinks");
  const { referrals, referralSpan } = await aiMod();
  const span = referralSpan();
  const refTo = L ? L.referrersReadTo() : null;
  if (!span && !refTo) {
    if (!srcJob?.lastEnd && !refJob?.lastEnd) return noVisits(waiting("ga4", "GA4's referrals are read once a day (Automations: Read referrals and AI assistant visits from GA4); the first read has not run yet."));
    if (srcJob?.lastOk === false) return noVisits(waiting("ga4", `GA4's referrals could not be read: ${scrub(srcJob.lastNote ?? "no reason given")}`));
  }
  const m = await measured();
  const compared = !!m.fullFrom && m.fullFrom <= w.previousStart;

  /* Per site and day, each report on its own; then the larger of the two. */
  type Tally = Map<string, Map<string, number>>;
  const add = (t: Tally, key: string, day: string, n: number) => {
    const d = t.get(key) ?? new Map<string, number>();
    d.set(day, (d.get(day) ?? 0) + n);
    t.set(key, d);
  };
  const merged = (a: Tally, b: Tally): Map<string, Map<string, number>> => {
    const out = new Map<string, Map<string, number>>();
    for (const t of [a, b])
      for (const [k, days] of t) {
        const o = out.get(k) ?? new Map<string, number>();
        for (const [d, n] of days) o.set(d, Math.max(o.get(d) ?? 0, n));
        out.set(k, o);
      }
    return out;
  };
  const read = (start: string, end: string, keep: boolean) => {
    const src: Tally = new Map();
    const ref: Tally = new Map();
    const landSrc = new Map<string, Map<string, number>>();
    const landRef = new Map<string, Map<string, number>>();
    const meta = new Map<string, { users: number; ai: boolean; hosts: Set<string>; referrers: Map<string, number> }>();
    const metaOf = (k: string) => {
      const had = meta.get(k);
      if (had) return had;
      const x = { users: 0, ai: false, hosts: new Set<string>(), referrers: new Map<string, number>() };
      meta.set(k, x);
      return x;
    };
    const land = (t: Map<string, Map<string, number>>, k: string, path: string, n: number) => {
      const l = t.get(k) ?? new Map<string, number>();
      l.set(path, (l.get(path) ?? 0) + n);
      t.set(k, l);
    };
    for (const r of referrals(start, end)) {
      const byMedium = r.medium === ai.medium;
      const key = keyOf(r.source, ai, byMedium);
      if (!key) continue;
      add(src, key, r.day, r.sessions);
      if (!keep) continue;
      land(landSrc, key, r.landing, r.sessions);
      const x = metaOf(key);
      x.users += r.users;
      x.ai ||= byMedium || ai.host(ALIAS[hostOf(r.source)] ?? hostOf(r.source));
      x.hosts.add(hostOf(r.source));
    }
    for (const r of L ? L.refVisits(start, end) : []) {
      const key = keyOf(r.host, ai);
      if (!key) continue;
      add(ref, key, r.day, r.sessions);
      if (!keep) continue;
      land(landRef, key, r.landing, r.sessions);
      const x = metaOf(key);
      x.ai ||= ai.host(ALIAS[r.host] ?? r.host);
      x.hosts.add(r.host);
      x.referrers.set(r.referrer, (x.referrers.get(r.referrer) ?? 0) + r.sessions);
    }
    const days = merged(src, ref);
    const landing = merged(landSrc, landRef);
    return { days, landing, meta };
  };

  const now = read(w.start, w.end, true);
  const by = new Map<string, SiteVisits>();
  const daily = new Map<string, Set<string>>();
  for (const [key, days] of now.days) {
    const x = now.meta.get(key) ?? { users: 0, ai: false, hosts: new Set<string>(), referrers: new Map<string, number>() };
    by.set(key, { days, landing: now.landing.get(key) ?? new Map(), referrers: x.referrers, users: x.users, ai: x.ai, hosts: x.hosts });
    for (const [d, n] of days) if (n > 0) daily.set(d, (daily.get(d) ?? new Set<string>()).add(key));
  }
  let before: Map<string, number> | null = null;
  if (compared) {
    before = new Map();
    for (const [key, days] of read(w.previousStart, w.previousEnd, false).days) before.set(key, [...days.values()].reduce((a, b) => a + b, 0));
  }

  const first = new Map<string, string>();
  const firstAt = (raw: string, d: string, byMedium = false) => {
    const key = keyOf(raw, ai, byMedium);
    if (!key) return;
    const had = first.get(key);
    if (!had || d < had) first.set(key, d);
  };
  for (const r of db.prepare("SELECT source, medium, MIN(day) AS d FROM cc_seo_referrals WHERE sessions > 0 GROUP BY source, medium").all() as { source: string; medium: string; d: string }[]) firstAt(r.source, r.d, r.medium === ai.medium);
  if (L) for (const [host, d] of L.refFirst()) firstAt(host, d);

  /* The page most of its sessions began on; none when GA4 named no page. */
  const top = (landing: Map<string, number>): string | null =>
    [...landing.entries()].filter(([p]) => p.startsWith("/")).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  const total = (v: SiteVisits) => [...v.days.values()].reduce((a, b) => a + b, 0);
  const rows: Referrer[] = [...by.entries()]
    .map(([host, v]) => ({ host, sessions: total(v), users: v.users, previous: before ? (before.get(host) ?? 0) : null, topLanding: top(v.landing), ai: v.ai }))
    .filter((r) => r.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions || a.host.localeCompare(b.host));

  /* Read up to the day before each job's last good run, in Zurich as the jobs count; the window is whole up to the earlier of the two. */
  const reads = [srcJob?.lastOk && srcJob.lastEnd ? addDays(zurichDay(srcJob.lastEnd), -1) : (span?.to ?? null), refTo].filter((x): x is string => !!x).sort();
  const readTo = reads[0] ?? null;
  const late = readTo && readTo < w.end ? ` Read up to ${readTo}; the days after are read on the next run.` : "";
  const partly = m.since && m.since > w.start ? ` GA4 measures the website from ${m.since}, so the window counts from then.` : "";
  const noRef = L && !refTo ? " The referring addresses (every medium) are not read yet: the job “Read referring pages and check followed links” has not run." : "";
  const perDay: number[] = [];
  for (let d = m.since && m.since > w.start ? m.since : w.start; d <= w.end; d = addDays(d, 1)) perDay.push(daily.get(d)?.size ?? 0);
  const at = [srcJob?.lastOk ? srcJob.lastEnd : null, refJob?.lastOk ? refJob.lastEnd : null].filter((x): x is string => !!x).sort().at(-1) ?? new Date().toISOString();

  return {
    reading: ok({ start: w.start, end: w.end, total: rows.reduce((n, r) => n + r.sessions, 0), rows }, "ga4", at, `${GA4_NOTE}${partly}${late}${noRef}`),
    by,
    before,
    perDay,
    sitesBefore: before ? [...before.values()].filter((n) => n > 0).length : null,
    first,
  };
}

/* ---------- Vercel's request records ------------------------------------------------------- */

const DRAIN_STEP = "Run bash deploy/vercel-connect.sh on the workstation: it creates the log drain for the website's production and puts VERCEL_DRAIN_SECRET in the desk's environment (Hosting shows its state).";

type DrainValue = SeoBacklinksPayload["drain"] extends Reading<infer T> ? T : never;

async function drainRefs(w: Window, ai: Ai): Promise<{ reading: Reading<DrainValue>; first: Map<string, string> }> {
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
  const by = new Map<string, number>();
  for (const r of d.topBetween("ref", w.start, w.end, 300)) {
    const key = keyOf(r.key, ai);
    if (key) by.set(key, (by.get(key) ?? 0) + r.n);
  }
  const rows = [...by.entries()].map(([host, views]) => ({ host, views })).sort((a, b) => b.views - a.views || a.host.localeCompare(b.host));
  for (const r of db.prepare("SELECT key, MIN(day) AS d FROM cc_drain_days WHERE dim = 'ref' AND n > 0 GROUP BY key").all() as { key: string; d: string }[]) {
    const key = keyOf(r.key, ai);
    if (!key) continue;
    const had = first.get(key);
    if (!had || r.d < had) first.set(key, r.d);
  }
  const span = Math.round((Date.parse(w.end) - Date.parse(w.start)) / 86_400_000) + 1;
  return {
    first,
    reading: ok(
      { start: w.start, end: w.end, days: days.size, total: rows.reduce((n, r) => n + r.views, 0), rows },
      "vercel-drain",
      s.last ?? new Date().toISOString(),
      `Page views by referring site from Vercel's own record of every request: every visitor, no consent needed because no script runs. Counted on ${days.size} of ${span} days; a day the drain did not deliver is unknown, not zero.`,
    ),
  };
}

/* ---------- links: Bing's list, Google's export, the desk's own readings ---------------------- */

interface LinkSources {
  /** Bing's links it lists today, and the ones it no longer lists. Off until Bing is connected. */
  bing: Reading<bing.InboundLink[]>;
  bingLost: bing.InboundLink[];
  /** Every linking page the desk keeps a row for (cc_seo_backlinks). */
  desk: KnownLink[];
  /** Search Console's Links export, or null when none was imported. */
  google: GoogleLinks | null;
}

/** True when the desk has read at least one linking page itself. */
const deskRead = (s: LinkSources): boolean => s.desk.some((l) => !!l.checkedAt);
/** Whether any source of links is read at all: until then a links figure is unknown, not 0. */
const linksRead = (s: LinkSources): boolean => s.bing.state === "ok" || !!s.google || deskRead(s);

/** A link Bing lists, as one of the desk's links: what Bing says, and that the desk has not read the page. */
const fromBing = (l: bing.InboundLink): KnownLink => ({
  id: null,
  source: l.source,
  host: l.host,
  target: l.path,
  anchor: l.anchor || null,
  rel: null,
  origins: ["bing"],
  state: "not-checked",
  stateWhy: l.goneOn ? `Bing listed it until ${l.lastSeen} and no longer does (found on ${l.goneOn}); Bing's index, not proof the link was removed.` : "Listed by Bing; the desk has not read the page itself.",
  firstSeen: l.firstSeen,
  firstLive: null,
  checkedAt: null,
  lostAt: null,
  bingLastSeen: l.lastSeen,
  googleCrawled: null,
  tracked: false,
  note: null,
  addedBy: null,
});

const NOT_FOLLOWED = ["nofollow", "sponsored", "ugc"];
const followed = (l: KnownLink): boolean | null => (l.rel ? !l.rel.some((r) => NOT_FOLLOWED.includes(r)) : null);

/* ---------- the linking-sites table -------------------------------------------------------- */

interface Bucket {
  hosts: Set<string>;
  bing: bing.InboundLink[];
  bingLost: number;
  desk: KnownLink[];
  /** Linking pages Google's "Top linking sites" export gives for it. */
  googleSites: number | null;
  /** The day the desk first had the site from Google's export. */
  googleFirst: string | null;
  visits: SiteVisits | null;
  views: number | null;
}

interface Table {
  list: SitesList;
  /** Every row matching the filters, in order: the CSV's. */
  matching: LinkingSite[];
  /** Every row, unfiltered, by site. */
  all: Map<string, LinkingSite>;
  buckets: Map<string, Bucket>;
}

function sitesOf(
  s: { links: LinkSources; visits: Visits; drain: Awaited<ReturnType<typeof drainRefs>>; profiles: ProfileRow[]; w: Window },
  asked: BacklinksQuery,
  ai: Ai,
): Table {
  const by = new Map<string, Bucket>();
  const take = (key: string, host: string): Bucket => {
    let b = by.get(key);
    if (!b) {
      b = { hosts: new Set(), bing: [], bingLost: 0, desk: [], googleSites: null, googleFirst: null, visits: null, views: null };
      by.set(key, b);
    }
    if (host) b.hosts.add(host);
    return b;
  };
  const L = s.links;
  if (L.bing.state === "ok") {
    for (const l of L.bing.value) {
      const key = keyOf(l.host, ai);
      if (key) take(key, hostOf(l.host)).bing.push(l);
    }
    for (const l of L.bingLost) {
      const key = keyOf(l.host, ai);
      if (key) take(key, hostOf(l.host)).bingLost++;
    }
  }
  /* The desk's rows stand as a row of the table when they are links: read live or lost, or named by Google or Bing. A page being watched that never linked is under "Links you follow", not here. */
  for (const l of L.desk) {
    const key = keyOf(l.host, ai);
    if (!key) continue;
    if (l.state === "live" || l.state === "lost" || l.origins.includes("google") || l.origins.includes("bing")) take(key, l.host).desk.push(l);
  }
  for (const g of L.google?.sites ?? []) {
    const key = keyOf(g.host, ai);
    if (!key) continue;
    const b = take(key, g.host);
    b.googleSites = (b.googleSites ?? 0) + g.pages;
    if (g.firstSeen && (!b.googleFirst || g.firstSeen < b.googleFirst)) b.googleFirst = g.firstSeen;
  }
  if (s.visits.reading.state === "ok") {
    for (const [key, v] of s.visits.by) {
      const b = take(key, "");
      b.visits = v;
      for (const h of v.hosts) b.hosts.add(ALIAS[h] ? ALIAS[h] : h);
    }
  }
  if (s.drain.reading.state === "ok") for (const r of s.drain.reading.value.rows) take(r.host, r.host).views = r.views;

  /* The studio's profiles, by site. Google's address is search, never a profile. */
  const profileBy = new Map<string, ProfileRow>();
  for (const p of s.profiles) {
    if (!p.url) continue;
    const key = keyOf(p.url, ai);
    if (key && !profileBy.has(key)) profileBy.set(key, p);
  }

  const bingOk = L.bing.state === "ok";
  const ga4Ok = s.visits.reading.state === "ok";
  const drainOk = s.drain.reading.state === "ok";
  const anyLinks = linksRead(L);
  const deskOk = deskRead(L);
  const most = (list: (string | null)[]): string | null => {
    const n = new Map<string, number>();
    for (const x of list) if (x) n.set(x, (n.get(x) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  };
  const earliest = (list: (string | null | undefined)[]): string | null => list.filter((x): x is string => !!x).sort()[0] ?? null;

  const all = new Map<string, LinkingSite>();
  for (const [key, b] of by) {
    const sessions = b.visits ? [...b.visits.days.values()].reduce((x, y) => x + y, 0) : 0;
    const isAi = ai.host(key) || !!b.visits?.ai;
    const profile = profileBy.get(key) ?? null;
    /* A visit from the network is not the studio's profile: only a page that IS the profile's address says so. */
    const pages = [...(b.visits ? b.visits.referrers.keys() : []), ...b.bing.map((l) => l.source), ...b.desk.map((l) => l.source)];
    const fromProfile = !!profile?.url && pages.some((u) => bare(u) === bare(profile.url!) || bare(u).startsWith(`${bare(profile.url!)}/`));

    const live = b.desk.filter((l) => l.state === "live");
    const fromGoogle = b.desk.filter((l) => l.origins.includes("google")).length;
    const counts: { by: LinkSource; n: number | null }[] = [
      { by: "desk", n: deskOk ? live.length : null },
      { by: "bing", n: bingOk ? b.bing.length : null },
      { by: "google", n: L.google ? Math.max(b.googleSites ?? 0, fromGoogle) : null },
    ];
    const best = counts.filter((x) => x.n !== null).sort((a, z) => z.n! - a.n!)[0] ?? null;
    const reads = live.map(followed).filter((x): x is boolean => x !== null);
    const follow: NonNullable<LinkingSite["links"]>["follow"] = !reads.length ? null : reads.every(Boolean) ? "follow" : reads.some(Boolean) ? "mixed" : "nofollow";
    const linkFirst = earliest([...b.bing.map((l) => l.firstSeen), ...live.map((l) => l.firstLive), ...b.desk.filter((l) => l.origins.includes("google")).map((l) => l.firstSeen), b.googleFirst]);

    const seen: { day: string; by: NonNullable<LinkingSite["firstSeen"]>["by"] }[] = [];
    const bingFirst = earliest(b.bing.map((l) => l.firstSeen));
    if (bingFirst) seen.push({ day: bingFirst, by: "bing" });
    const deskFirst = earliest(live.map((l) => l.firstLive));
    if (deskFirst) seen.push({ day: deskFirst, by: "desk" });
    const googleFirst = earliest([...b.desk.filter((l) => l.origins.includes("google")).map((l) => l.firstSeen), b.googleFirst]);
    if (googleFirst) seen.push({ day: googleFirst, by: "google" });
    const g = s.visits.first.get(key);
    if (g) seen.push({ day: g, by: "ga4" });
    const v = s.drain.first.get(key);
    if (v) seen.push({ day: v, by: "vercel-drain" });
    seen.sort((a, z) => a.day.localeCompare(z.day));

    const hosts = [...b.hosts].filter(Boolean).sort();
    all.set(key, {
      host: key,
      hosts: hosts.length > 1 || (hosts.length === 1 && hosts[0] !== key) ? hosts : [],
      kind: isAi ? "ai" : fromProfile ? "profile" : "site",
      label: isAi ? ai.label(key) : fromProfile ? profile!.name : null,
      profileKey: profile?.key ?? null,
      links: anyLinks
        ? {
            count: best?.n ?? 0,
            by: best && best.n ? best.by : null,
            bing: counts[1]!.n,
            google: counts[2]!.n,
            desk: counts[0]!.n,
            lost: b.desk.filter((l) => l.state === "lost").length + b.bingLost,
            anchor: most([...b.bing.map((l) => l.anchor || null), ...live.map((l) => l.anchor)]),
            target: most([...b.bing.map((l) => l.path), ...live.map((l) => l.target)]),
            follow,
            firstSeen: linkFirst,
          }
        : null,
      visits: ga4Ok ? { sessions, previous: s.visits.before ? (s.visits.before.get(key) ?? 0) : null, landing: b.visits ? topOf(b.visits.landing) : null } : null,
      views: drainOk ? (b.views ?? 0) : null,
      firstSeen: seen[0] ?? null,
    });
  }

  const has: Record<SitesFrom, (r: LinkingSite) => boolean> = {
    all: () => true,
    links: (r) => (r.links?.count ?? 0) > 0,
    google: (r) => (r.links?.google ?? 0) > 0,
    visits: (r) => (r.visits?.sessions ?? 0) > 0,
    ai: (r) => r.kind === "ai",
    views: (r) => (r.views ?? 0) > 0,
    new: (r) => !!r.firstSeen && r.firstSeen.day >= s.w.start,
  };
  const rows = [...all.values()];
  const counts = Object.fromEntries(FROMS.map((f) => [f, rows.filter(has[f]).length])) as Record<SitesFrom, number>;
  const q = asked.q;
  const matching = rows.filter((r) => has[asked.from](r) && (!q || r.host.includes(q) || r.hosts.some((h) => h.includes(q)) || (r.label ?? "").toLowerCase().includes(q)));
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
  const pages = Math.max(1, Math.ceil(matching.length / PER_PAGE));
  const page = Math.min(asked.page, pages);
  return {
    list: { rows: matching.slice((page - 1) * PER_PAGE, page * PER_PAGE), total: matching.length, page, pages, perPage: PER_PAGE, counts, leftOut: LEFT_OUT },
    matching,
    all,
    buckets: by,
  };
}

/** The page most of a site's sessions began on; none when GA4 named no page. */
const topOf = (landing: Map<string, number>): string | null =>
  [...landing.entries()].filter(([p]) => p.startsWith("/")).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;

/* ---------- one site, opened ------------------------------------------------------------------ */

function detailOf(key: string, t: Table, s: { links: LinkSources; visits: Visits; w: Window }, ai: Ai): SiteDetail | null {
  if (!key) return null;
  const row = t.all.get(key) ?? null;
  const b = t.buckets.get(key) ?? null;
  /* Every row the desk keeps for this site, followed pages that never linked as well. */
  const desk = s.links.desk.filter((l) => keyOf(l.host, ai) === key);
  const bingNow = s.links.bing.state === "ok" ? s.links.bing.value.filter((l) => keyOf(l.host, ai) === key) : [];
  const g = s.links.google?.sites.filter((x) => keyOf(x.host, ai) === key) ?? [];
  if (!row && !desk.length && !bingNow.length && !g.length) return null;

  const byUrl = new Map(desk.map((l) => [l.source, l]));
  const links: KnownLink[] = [...desk.map((l) => ({ ...l }))];
  for (const l of bingNow) {
    const had = byUrl.get(l.source);
    if (had) {
      const i = links.findIndex((x) => x.source === l.source);
      links[i] = { ...links[i]!, bingLastSeen: l.lastSeen, origins: links[i]!.origins.includes("bing") ? links[i]!.origins : ["bing", ...links[i]!.origins] };
    } else links.push(fromBing(l));
  }
  const rank: Record<LinkState, number> = { live: 0, lost: 1, waiting: 2, unreadable: 3, "not-checked": 4 };
  links.sort((a, z) => rank[a.state] - rank[z.state] || (z.checkedAt ?? "").localeCompare(a.checkedAt ?? "") || a.source.localeCompare(z.source));

  const v = b?.visits ?? null;
  const ga4Ok = s.visits.reading.state === "ok";
  const days: SiteDetail["days"] = ga4Ok ? [] : null;
  if (days) for (let d = s.w.start; d <= s.w.end; d = addDays(d, 1)) days.push({ day: d, sessions: v?.days.get(d) ?? 0 });
  const imported = s.links.google?.imported.sites ?? null;
  const gRow = g.length ? { pages: g.reduce((n, x) => n + x.pages, 0), targets: g.reduce((n, x) => n + x.targets, 0), day: imported ? imported.at.slice(0, 10) : "" } : null;
  return {
    host: key,
    hosts: row?.hosts ?? [],
    label: row?.label ?? null,
    kind: row?.kind ?? "site",
    links: links.slice(0, 200),
    linksTotal: links.length,
    google: gRow,
    days,
    landings: v ? [...v.landing.entries()].filter(([p]) => p.startsWith("/")).map(([path, sessions]) => ({ path, sessions })).sort((a, z) => z.sessions - a.sessions || a.path.localeCompare(z.path)) : [],
    referrers: v ? [...v.referrers.entries()].map(([url, sessions]) => ({ url, sessions })).sort((a, z) => z.sessions - a.sessions || a.url.localeCompare(z.url)) : [],
  };
}

/* ---------- the links the desk follows ------------------------------------------------------- */

function trackedOf(desk: KnownLink[], w: Window): TrackedList {
  const counts: Record<LinkState, number> = { live: 0, lost: 0, waiting: 0, unreadable: 0, "not-checked": 0 };
  for (const l of desk) counts[l.state]++;
  return {
    rows: desk.filter((l) => l.tracked),
    /* The desk's own readings: a day inside the window, today included (a reading of this morning is news). */
    fresh: desk.filter((l) => l.firstLive && l.firstLive >= w.start).length,
    lost: desk.filter((l) => l.lostAt && l.lostAt >= w.start).length,
    counts,
  };
}

/* ---------- name, address and phone -------------------------------------------------------- */

const FIELDS: NapField[] = ["name", "address", "phone"];
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Each field as each profile states it, grouped into variants by the ONE
 * rule every tab uses (presence.ts sameKey), and set against the agreed
 * value once the owner recorded it.
 */
function napOf(P: Presence, rows: ProfileRow[], decision: NapView["decision"]): { view: NapView; cells: Map<string, ProfileLine["shown"]> } {
  const truth = P.napTruth();
  const cells = new Map<string, ProfileLine["shown"]>(rows.map((p) => [p.key, { name: null, address: null, phone: null }]));
  const fields: NapView["fields"] = [];
  const groups: NapView["groups"] = [];
  for (const field of FIELDS) {
    const variants: { key: string; variant: string; value: string; sources: string[] }[] = [];
    const values: NapView["fields"][number]["values"] = [];
    for (const p of rows) {
      const s = P.statedOf(p, field);
      if (!s) continue;
      const key = P.sameKey[field](s.value);
      let v = variants.find((x) => x.key === key);
      if (!v) {
        v = { key, variant: LETTERS[variants.length] ?? `#${variants.length + 1}`, value: s.value, sources: [] };
        variants.push(v);
      }
      v.sources.push(p.name);
      values.push({ source: s.read ? p.name : `${p.name} (${P.seenBy(s.by)})`, value: s.value, day: s.day });
      const cell: NapCell = { value: s.value, variant: v.variant, read: s.read, day: s.day, by: s.by, match: P.matches(field, s.value, truth) };
      cells.get(p.key)![field] = cell;
    }
    fields.push({ field, values, consistent: variants.length <= 1, distinct: variants.length });
    groups.push({ field, variants: variants.map(({ variant, value, sources }) => ({ variant, value, sources, match: P.matches(field, value, truth) })) });
  }
  const differing = truth ? rows.filter((p) => FIELDS.some((f) => cells.get(p.key)?.[f]?.match === false)).length : null;
  return { view: { fields, consistent: fields.every((f) => f.consistent), groups, decision, truth, differing, rule: P.NAP_RULE }, cells };
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

const NO_LINKS = "No source of links is read yet: Bing Webmaster is not connected, nothing is imported from Search Console's Links report, and the desk has read no linking page itself.";
const NO_LINKS_STEP =
  "Export Search Console's Links report (free, with your Google login) and import it under “Pages linked to”, or check a page that should link here with “Check a page for a link”. Bing, once connected, adds its own index of links.";

function linksTile(counts: Reading<BingValue>, s: LinkSources, t: TrackedList, w: Window): Reading<Stat> {
  const n = (x: number) => x.toLocaleString("en-GB");
  const ours = deskRead(s) ? `the desk found ${n(t.fresh)} and lost ${n(t.lost)} in the period` : null;
  if (counts.state === "ok") {
    const history = counts.value.history.filter((h) => h.day >= w.start);
    const first = since("bing.links");
    const then = first && first <= w.previousEnd ? [...counts.value.history].reverse().find((h) => h.day <= w.previousEnd) : undefined;
    let theirs: string | null = null;
    if (s.bing.state === "ok") {
      /* Bing's first read gives every link it knows that day: nothing is called new before the second. */
      const fresh = first ? s.bing.value.filter((l) => l.firstSeen > first && l.firstSeen >= w.start).length : 0;
      const gone = s.bingLost.filter((l) => (l.goneOn ?? "") >= w.start).length;
      theirs = first && first >= w.start ? `First read ${first}: nothing called new before the next` : `Bing: ${n(fresh)} first reported, ${n(gone)} no longer listed in the period`;
    }
    const sub = [theirs, ours].filter(Boolean).join("; ");
    return { ...counts, value: { value: counts.value.total, previous: then ? then.links : null, unit: "count", series: history.map((h) => h.links), ...(sub ? { sub } : {}) } };
  }
  if (!s.google && !deskRead(s)) return off("bing", NO_LINKS, NO_LINKS_STEP);
  /* Without Bing: the larger of Google's count of linking pages and the pages the desk read live. Never their sum: they see the same links. */
  const googlePages = s.google ? Math.max(s.google.sites.reduce((x, g) => x + g.pages, 0), s.desk.filter((l) => l.origins.includes("google")).length) : 0;
  const live = s.desk.filter((l) => l.state === "live").length;
  const fromGoogle = googlePages >= live && !!s.google;
  const imported = s.google ? [s.google.imported.sites, s.google.imported.links, s.google.imported.pages].filter((x): x is NonNullable<typeof x> => !!x).map((x) => x.at).sort().at(-1) : null;
  const sub = [s.google ? `${n(googlePages)} linking page${googlePages === 1 ? "" : "s"} in Google's export` : null, deskRead(s) ? `${n(live)} read live by the desk` : null, ours].filter(Boolean).join("; ");
  return ok(
    { value: fromGoogle ? googlePages : live, previous: null, unit: "count", series: [], sub },
    fromGoogle ? "gsc" : "desk",
    (fromGoogle ? imported : null) ?? new Date().toISOString(),
    "Linking pages a source names: Google's export as imported by hand, and the pages the desk read itself. The larger of the two, never their sum. Bing is not connected.",
  );
}

function sitesTile(v: Visits): Reading<Stat> {
  const r = v.reading;
  if (r.state !== "ok") return r;
  const aiSessions = r.value.rows.filter((x) => x.ai).reduce((n, x) => n + x.sessions, 0);
  const s = r.value.total;
  const sub = `${s.toLocaleString("en-GB")} session${s === 1 ? "" : "s"}${aiSessions ? `, ${aiSessions.toLocaleString("en-GB")} from AI assistants` : ""}`;
  return { ...r, value: { value: r.value.rows.length, previous: v.sitesBefore, unit: "count", series: v.perDay, sub } };
}

/* ---------- the page ------------------------------------------------------------------------ */

const jobLine = (name: string): JobLine | null => {
  const j = jobStatus().find((x) => x.name === name);
  return j ? { name: j.name, title: j.title, enabled: j.enabled, running: j.running, lastEnd: j.lastEnd, lastOk: j.lastOk, lastNote: j.lastNote === null ? null : scrub(j.lastNote), nextRun: j.nextRun, ready: j.ready } : null;
};

/** Search Console's Links report for the property the desk reads, so the export is made from the right one. */
function gscLinksUrl(): string {
  const a = gsc.access();
  const site = a.state === "ok" && a.site ? a.site : (process.env.GSC_SITE ?? "").trim();
  return `https://search.google.com/search-console/links${site ? `?resource_id=${encodeURIComponent(site)}` : ""}`;
}

const GOOGLE_STEP =
  "In Search Console open Links (the link on this card opens it for the website's property), press Export on Top linking sites, Top linked pages or Latest links (More, then Export), download CSV, and import the file here. Once a month is enough.";

async function build(c: Context<Vars>): Promise<{ payload: SeoBacklinksPayload; table: Table | null }> {
  const range = rangeFrom(c);
  const asked = askedOf(c);
  const w = windowOf(range);

  const [aiM, L] = await Promise.all([aiMod().catch(() => null), linksMod().catch(() => null)]);
  const ai = aiM ? aiOf(aiM) : null;

  /* Links: what each source kept. No request is made here. */
  const counts = await reading("bing", () => bingCounts(w));
  const bingNow = await reading("bing", () => (bing.configured() ? bing.inboundLinks(5000) : off<bing.InboundLink[]>("bing", BING_OFF, bing.step())));
  const bingLost = bing.configured() ? bing.lostLinks(5000) : null;
  let desk: KnownLink[] = [];
  let google: GoogleLinks | null = null;
  let linksFailed: string | null = null;
  if (L) {
    try {
      desk = L.knownLinks();
      google = L.googleLinks();
    } catch (e) {
      linksFailed = scrub(e instanceof Error ? e.message : String(e)).slice(0, 160);
    }
  } else linksFailed = "the desk's backlinks module did not load";
  const sources: LinkSources = { bing: bingNow, bingLost: bingLost?.state === "ok" ? bingLost.value : [], desk, google };
  const tracked = trackedOf(desk, w);

  const [v, drain] = await Promise.all([
    ai ? visits(w, ai, L).catch((e): Visits => noVisits(waiting("ga4", `The last read failed: ${scrub(e instanceof Error ? e.message : String(e)).slice(0, 160)}`))) : Promise.resolve(noVisits(waiting("ga4", "The SEO engine's AI-assistant rules did not load."))),
    ai
      ? drainRefs(w, ai).catch((e) => ({ first: new Map<string, string>(), reading: waiting<DrainValue>("vercel-drain", `The drain's records could not be read: ${scrub(e instanceof Error ? e.message : String(e)).slice(0, 160)}`) }))
      : Promise.resolve({ first: new Map<string, string>(), reading: waiting<DrainValue>("vercel-drain", "The SEO engine's AI-assistant rules did not load.") }),
  ]);

  /* The registry, the owner tasks, the name/address/phone matrix: the desk's own tables. */
  let P: Presence | null = null;
  let rows: ProfileRow[] = [];
  let registryFailed: string | null = null;
  try {
    P = await presenceMod();
    rows = P.profiles();
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
  const nap = P ? napOf(P, rows, decision) : null;
  const checkedAt = rows.map((p) => p.checkedAt).filter((x): x is string => !!x).sort().at(-1) ?? null;

  const lines: ProfileLine[] = rows.map((p) => {
    const t = taskFor(p, tasks);
    return { ...p, shown: nap?.cells.get(p.key) ?? { name: null, address: null, phone: null }, task: t ? { id: t.id, title: t.title, done: t.done } : null };
  });
  const NO_REGISTRY = "No profile or listing is recorded yet: they come in with the SEO audit's import, or add one with “Add a profile”.";
  const profiles: SeoBacklinksPayload["profiles"] = registryFailed
    ? waiting("desk", `The registry could not be read: ${registryFailed}`)
    : rows.length
      ? ok(
          { rows: lines, checkedAt },
          "desk",
          checkedAt ?? new Date().toISOString(),
          "The registry the SEO audit seeded, with what people on the desk added and corrected, checked once a week: each address is asked whether it shows the profile. A profile without an address keeps the audit's finding until somebody gives it one.",
        )
      : waiting("desk", NO_REGISTRY);
  const napReading: SeoBacklinksPayload["nap"] =
    profiles.state !== "ok" ? profiles : nap ? ok(nap.view, "desk", checkedAt ?? new Date().toISOString(), "What each profile states: read from the profile by the weekly check where it could, else what a person saw there, with the day and who.") : waiting("desk", "The registry did not load.");

  const linked = new Set(lines.map((l) => l.task?.id).filter((x): x is string => !!x));
  const needs = tasks.filter((t) => t.who === "owner" && (PRESENCE.has(t.id) || linked.has(t.id)));
  /* The one decision every listing copies comes first, done or not. */
  needs.sort((a, b) => Number(b.id === "nap-decision") - Number(a.id === "nap-decision"));
  const needsYou = needs.map(plain);

  /* The table stands while any of its sources has something; each missing one is its own column's dash. */
  let sites: SeoBacklinksPayload["sites"];
  let table: Table | null = null;
  if (!ai) sites = waiting("desk", "The SEO engine's AI-assistant rules did not load, so the table cannot be drawn.");
  else if (v.reading.state !== "ok" && !linksRead(sources) && drain.reading.state !== "ok") {
    sites = waiting(v.reading.source, `No source of linking sites can be read. GA4: ${v.reading.reason} Links: ${linksFailed ? `the desk's list could not be read (${linksFailed}).` : NO_LINKS}`);
  } else {
    table = sitesOf({ links: sources, visits: v, drain, profiles: rows, w }, asked, ai);
    /* What the page shows is what the address says: the page the rows are on, after a filter made the list shorter. */
    asked.page = table.list.page;
    const from: Reading<unknown>["source"] = v.reading.state === "ok" ? "ga4" : bingNow.state === "ok" ? "bing" : linksRead(sources) ? "desk" : "vercel-drain";
    sites = ok(table.list, from, new Date().toISOString(), LEFT_OUT);
  }
  /* ?open= names a host as a person or a notice wrote it ("blog.example.org"); the row is its site. */
  if (ai && asked.open) asked.open = keyOf(asked.open, ai) ?? asked.open;
  const open = table && ai && asked.open ? detailOf(asked.open, table, { links: sources, visits: v, w }, ai) : null;

  const googleReading: SeoBacklinksPayload["google"] = linksFailed
    ? waiting("gsc", `The imported links could not be read: ${linksFailed}`)
    : google
      ? ok(
          google,
          "gsc",
          [google.imported.sites, google.imported.pages, google.imported.texts, google.imported.links]
            .filter((x): x is NonNullable<typeof x> => !!x)
            .map((x) => x.at)
            .sort()
            .at(-1) ?? new Date().toISOString(),
          "Search Console's Links report as the owner exported and imported it: Google's own sample of the links it knows, as of the day of the export. Google gives it by no API.",
        )
      : off("gsc", "Nothing is imported from Search Console's Links report yet. Google gives its list of links by no API: it is exported by hand.", GOOGLE_STEP);

  const statedFields = nap ? nap.view.fields.filter((f) => f.values.length) : [];
  const variantsOf = (f: NapField) => nap?.view.groups.find((g) => g.field === f)?.variants.length ?? 0;
  const openTasks = needsYou.filter((t) => !t.done).length;
  const tiles: BacklinksTiles = {
    links: linksTile(counts, sources, tracked, w),
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
              sub: `${rows.filter((p) => p.state === "not-found").length} not found, ${rows.filter((p) => p.state === "unknown").length} not readable, ${rows.filter((p) => p.state === "not-checked").length} not checked`,
            },
          }
        : profiles,
    nap:
      profiles.state === "ok" && nap && statedFields.length
        ? {
            ...profiles,
            value: {
              value: statedFields.filter((f) => f.consistent).length,
              previous: null,
              unit: "count",
              series: [],
              of: statedFields.length,
              sub: `In use: ${variantsOf("name")} name${variantsOf("name") === 1 ? "" : "s"}, ${variantsOf("address")} address${variantsOf("address") === 1 ? "" : "es"}, ${variantsOf("phone")} phone${variantsOf("phone") === 1 ? "" : "s"}${nap.view.differing !== null ? `; ${nap.view.differing} profile${nap.view.differing === 1 ? "" : "s"} differ from the agreed` : ""}`,
            },
          }
        : profiles.state === "ok"
          ? waiting("desk", "No profile states a name, address or phone yet.")
          : profiles,
    needsYou: needsYou.length
      ? ok({ value: openTasks, previous: null, unit: "count", series: [], of: needsYou.length, sub: `${needsYou.length - openTasks} marked done` }, "desk", new Date().toISOString(), "Steps only the owner can take (a login, a decision, a profile), from the SEO audit. Done is a person's mark, never the desk's.")
      : waiting("desk", "No owner task about profiles or listings is recorded yet: they come in with the SEO audit's import."),
  };

  const trackedReading: SeoBacklinksPayload["tracked"] = linksFailed
    ? waiting("desk", `The desk's list of links could not be read: ${linksFailed}`)
    : ok(tracked, "desk", desk.map((l) => l.checkedAt).filter((x): x is string => !!x).sort().at(-1) ?? new Date().toISOString(), "Pages the desk reads itself, under its own name and after the site's robots.txt allowed it. “Live” is a link the desk found on the page; “lost” one it found before and no longer does. A page that could not be read is unknown, never lost.");

  return {
    payload: {
      head: head(range),
      asked,
      window: w,
      tiles,
      bing: counts,
      google: googleReading,
      referrers: v.reading,
      drain: drain.reading,
      sites,
      open,
      tracked: trackedReading,
      profiles,
      nap: napReading,
      needsYou,
      presenceJob: jobLine("seo-presence"),
      linksJob: jobLine("seo-backlinks"),
      gscLinksUrl: gscLinksUrl(),
      viewer: { owner: !!me(c)?.owner },
    },
    table,
  };
}

routes.get("/", async (c) => c.json<SeoBacklinksPayload>((await build(c)).payload));

/* ---------- GET /export.csv ------------------------------------------------------------------- */

/**
 * One cell. A cell a spreadsheet would run as a formula gets a leading quote,
 * except a phone number: digits, spaces, brackets and a leading + cannot run
 * anything, and "+41 …" must stay "+41 …".
 */
/* The number, then this export's own marks: " [A]" and " (as … entered it, day)", which hold no formula character. */
const PHONE_LIKE = /^\+?[\d\s()./-]+(?: \[[A-Z0-9#]+\])?(?: \([^=+@\t\r()]*\))*$/;
const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !PHONE_LIKE.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: unknown[][]): string => `﻿${rows.map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;

const BY_WORD: Record<NonNullable<LinkingSite["firstSeen"]>["by"], string> = { bing: "Bing", ga4: "GA4", "vercel-drain": "Vercel", google: "Google's export", desk: "The desk's reading" };
const SOURCE_WORD: Record<LinkSource, string> = { bing: "Bing", google: "Google's export", desk: "The desk's reading" };

routes.get("/export.csv", async (c) => {
  const { payload: p, table } = await build(c);
  const asked = c.req.query("list");
  const list = asked === "profiles" || asked === "links" ? asked : "sites";
  const w = `${p.window.start} to ${p.window.end}`;
  let body: string;
  if (list === "profiles") {
    if (p.profiles.state !== "ok") return c.json<ApiError>({ error: `There is nothing to export yet: ${p.profiles.reason}` }, 409);
    const shown = (x: NapCell | null) => (x ? `${x.value} [${x.variant}]${x.read ? "" : ` (${x.by && x.by !== "audit" ? `as ${x.by} entered it` : "as the audit saw it"}, ${x.day})`}${x.match === false ? " (differs from the agreed)" : ""}` : "");
    body = csv([
      ["Profile", "Kind", "Address of the profile", "State", "Why", "Checked", "Last answer", "Name [variant]", "Address [variant]", "Phone [variant]", "Owner step", "Added by"],
      ...p.profiles.value.rows.map((r) => [r.name, r.kind, r.url, r.state, r.stateWhy, r.checkedAt, r.http ?? "", shown(r.shown.name), shown(r.shown.address), shown(r.shown.phone), r.task ? `${r.task.title}${r.task.done ? " (done)" : ""}` : "", r.source === "person" ? "a person on the desk" : "the SEO audit"]),
    ]);
  } else if (list === "links") {
    if (p.tracked.state !== "ok") return c.json<ApiError>({ error: `There is nothing to export yet: ${p.tracked.reason}` }, 409);
    const L = await linksMod();
    const desk = L.knownLinks();
    const kept = new Set(desk.map((l) => l.source));
    const all = [...desk, ...(bing.configured() ? [bing.inboundLinks(5000), bing.lostLinks(5000)] : []).flatMap((r) => (r.state === "ok" ? r.value.filter((l) => !kept.has(l.source)).map(fromBing) : []))];
    if (!all.length) return c.json<ApiError>({ error: "There is no linking page to export yet: the list holds the pages a person checked or follows, the linking pages of Search Console's Latest links export, the referring pages GA4 named, and Bing's links once it is connected." }, 409);
    body = csv([
      ["Linking page", "Site", "Page linked to", "Link text", "Rel", "Followed", "Who says it links", "The desk's reading", "Why", "First known", "Found live on", "Lost on", "Last read by the desk", "Bing last listed", "Google last crawled", "Followed by a person", "Note", "Added by"],
      ...all.map((l) => [
        l.source,
        l.host,
        l.target,
        l.anchor,
        l.rel ? l.rel.join(" ") : "",
        followed(l) === null ? "" : followed(l) ? "yes" : "no",
        l.origins.join(", "),
        l.state,
        l.stateWhy,
        l.firstSeen,
        l.firstLive,
        l.lostAt,
        l.checkedAt,
        l.bingLastSeen,
        l.googleCrawled,
        l.tracked ? "yes" : "no",
        l.note,
        l.addedBy,
      ]),
    ]);
  } else {
    if (p.sites.state !== "ok" || !table) return c.json<ApiError>({ error: `There is nothing to export yet: ${p.sites.state === "ok" ? "the table could not be drawn." : p.sites.reason}` }, 409);
    body = csv([
      [
        "Site",
        "Hosts seen",
        "Kind",
        "Profile or assistant",
        "Links",
        "Counted by",
        "Links (the desk's reading)",
        "Links (Bing)",
        "Links (Google's export)",
        "Links lost",
        "Followed",
        "Link text, most used",
        "Page linked to",
        `Sessions (GA4, ${w})`,
        "Sessions in the window before (GA4)",
        "Landing page, most sessions (GA4)",
        `Page views referred (Vercel, ${w})`,
        "First seen",
        "First seen by",
      ],
      /* Every matching row, not the page on screen. */
      ...table.matching.map((r) => [
        r.host,
        r.hosts.join(" "),
        r.kind,
        r.label,
        r.links?.count,
        r.links?.by ? SOURCE_WORD[r.links.by] : "",
        r.links?.desk,
        r.links?.bing,
        r.links?.google,
        r.links?.lost,
        r.links?.follow,
        r.links?.anchor,
        r.links?.target,
        r.visits?.sessions,
        r.visits?.previous,
        r.visits?.landing,
        r.views,
        r.firstSeen?.day,
        r.firstSeen ? BY_WORD[r.firstSeen.by] : "",
      ]),
    ]);
  }
  c.header("content-type", "text/csv; charset=utf-8");
  c.header("content-disposition", `attachment; filename="balkaris-${list === "profiles" ? "profiles-and-listings" : list === "links" ? "linking-pages" : "linking-sites"}-${today()}.csv"`);
  c.header("cache-control", "no-store");
  return c.body(body);
});

/* ---------- the changes ------------------------------------------------------------------------ */

/**
 * Run one change and answer it. The libraries throw a sentence for the
 * person (presence.Said, backlinks.Said, the guard's Refused): 400 with that
 * sentence. The hour's link readings spent (Busy): 429 with when to ask again.
 */
async function act(c: Context<Vars>, run: () => Promise<object> | object): Promise<Response> {
  try {
    return c.json(await run());
  } catch (e) {
    const [P, L, A] = await Promise.all([presenceMod(), linksMod(), auditMod()]);
    if (e instanceof L.Busy) {
      c.header("retry-after", String(e.retryAfter));
      return c.json<ApiError>({ error: e.message }, 429);
    }
    if (e instanceof P.Said || e instanceof L.Said || e instanceof A.Refused) return c.json<ApiError>({ error: e.message }, 400);
    throw e;
  }
}

const idOf = (raw: string): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : bad("There is no such link on the desk.");
};

const noteOf = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || v.length > 200) return bad("A note is at most 200 characters.");
  return v;
};

routes.post("/check", async (c) => {
  const b = await body(c);
  if (typeof b.url !== "string" || !b.url.trim()) bad("Give the address of a page, or a site's name.");
  if ((b.url as string).length > 2000) bad("The address is longer than 2,000 characters.");
  if (b.fresh !== undefined && typeof b.fresh !== "boolean") bad("fresh must be true or false.");
  return act(c, async () => {
    const L = await linksMod();
    const check = await L.checkPage(b.url as string, { who: me(c).name, fresh: b.fresh === true });
    /* Reading a page changes nothing on the desk unless it found a link, which is then kept. */
    c.set("did", check.verdict === "links" && !check.cached ? { text: `Found a link to the website on ${check.host}`, href: `/seo/backlinks?open=${encodeURIComponent(check.host)}` } : null);
    return { ok: true, line: L.lineOf(check), check } satisfies LinkCheckAnswer;
  });
});

routes.post("/links", async (c) => {
  const b = await body(c);
  if (typeof b.url !== "string" || !b.url.trim()) bad("Give the address of the page that links, or should link, to the website.");
  const note = noteOf(b.note);
  return act(c, async () => {
    const L = await linksMod();
    const link = L.follow(b.url as string, me(c).name, note);
    return { ok: true, line: `Following ${link.host}: the desk reads ${link.source} once a week and says when a link appears or goes.` } satisfies BacklinksAnswer;
  });
});

routes.post("/links/:id/check", async (c) =>
  act(c, async () => {
    const L = await linksMod();
    const link = L.knownLink(idOf(c.req.param("id")));
    if (!link) throw new HTTPException(404, { message: "There is no such link on the desk." });
    const check = await L.checkPage(link.source, { who: me(c).name, fresh: true });
    c.set("did", null);
    return { ok: true, line: L.lineOf(check), check } satisfies LinkCheckAnswer;
  }),
);

routes.post("/links/:id", async (c) => {
  const id = idOf(c.req.param("id"));
  const b = await body(c);
  if (b.tracked === undefined && b.note === undefined) bad("Send tracked (true or false), a note, or both.");
  return act(c, async () => {
    const L = await linksMod();
    const r = L.changeLink(id, { tracked: b.tracked, note: b.note }, me(c).name);
    return { ok: true, line: r.line } satisfies BacklinksAnswer;
  });
});

routes.post("/import", requireOwner, async (c) => {
  const b = await body(c);
  if (typeof b.csv !== "string" || !b.csv.trim()) bad("csv must be the exported file's text.");
  if ((b.csv as string).length > 5_000_000) bad("The file is larger than 5 MB.");
  return act(c, async () => {
    const L = await linksMod();
    const r = L.importGscLinks(b.csv as string, me(c).name);
    c.set("did", { text: r.line, href: "/seo/backlinks" });
    return { ok: true, kind: r.kind, rows: r.rows, line: r.line } satisfies LinksImportAnswer;
  });
});

routes.post("/profiles", async (c) => {
  const b = await body(c);
  return act(c, async () => {
    const P = await presenceMod();
    const row = P.addProfile({ name: b.name, kind: b.kind, url: b.url }, me(c).name);
    return { ok: true, line: `Added ${row.name}.${row.url ? " Press Check on its row to ask its address now, or the weekly check will." : " Give it its address when it has one."}` } satisfies BacklinksAnswer;
  });
});

/** One person's "Check" on one profile at most once a minute: each is a request to somebody else's site. */
const lastProfileCheck = new Map<string, number>();
const PROFILE_FLOOR_MS = 60_000;

routes.post("/profiles/:key/check", async (c) => {
  const key = c.req.param("key");
  const at = lastProfileCheck.get(key) ?? 0;
  if (Date.now() - at < PROFILE_FLOOR_MS) {
    const s = Math.ceil((at + PROFILE_FLOOR_MS - Date.now()) / 1000);
    c.header("retry-after", String(s));
    return c.json<ApiError>({ error: `This profile was asked less than a minute ago; ask again in ${s} seconds.` }, 429);
  }
  return act(c, async () => {
    const P = await presenceMod();
    lastProfileCheck.set(key, Date.now());
    const r = await P.checkOne(key);
    return { ok: true, line: r.line } satisfies BacklinksAnswer;
  });
});

routes.post("/profiles/:key/found", async (c) => {
  const b = await body(c);
  if (typeof b.use !== "boolean") bad("use must be true (it is the studio's) or false (it is not).");
  return act(c, async () => {
    const P = await presenceMod();
    const row = P.settleFound(c.req.param("key"), b.use as boolean, me(c).name);
    return { ok: true, line: b.use ? `${row.name} now has the address ${row.url}; it is asked on the next check.` : `Not the studio's: the desk will not offer it again for ${row.name}.` } satisfies BacklinksAnswer;
  });
});

routes.post("/profiles/:key", async (c) => {
  const key = c.req.param("key");
  const b = await body(c);
  return act(c, async () => {
    const P = await presenceMod();
    if (b.remove === true) {
      const had = P.removeProfile(key, me(c).name);
      return { ok: true, line: `Removed ${had.name}.` } satisfies BacklinksAnswer;
    }
    const r = P.editProfile(key, { name: b.name, kind: b.kind, url: b.url, stated: b.stated }, me(c).name);
    if (!r.changed.length) c.set("did", null);
    return { ok: true, line: r.changed.length ? `${r.row.name}: changed ${r.changed.join(", ")}.${r.changed.includes("address") && r.row.url ? " Press Check to ask the new address now." : ""}` : "Nothing changed." } satisfies BacklinksAnswer;
  });
});

routes.post("/nap", requireOwner, async (c) => {
  const b = await body(c);
  return act(c, async () => {
    const P = await presenceMod();
    const t = P.setNapTruth({ name: b.name, address: b.address, phone: b.phone }, me(c).name);
    return {
      ok: true,
      line: t ? `Recorded: ${[t.name, t.address, t.phone].filter(Boolean).join(" · ")}. Every profile is now compared with it.` : "Taken back: no name, address or phone is agreed now.",
    } satisfies BacklinksAnswer;
  });
});
