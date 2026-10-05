import { db } from "../../db.ts";
import type { GoogleLinks, GscLinksKind, KnownLink, LinkCheck, LinkState } from "../../../web/src/contract/seo/backlinks.ts";
import * as ga4 from "../ga4.ts";
import { hasKey } from "../gauth.ts";
import * as bing from "../search/bing.ts";
import { addDays } from "../search/shared.ts";
import { fetchGuarded, guardUrl, nodeTransport, Refused, type GuardedFetch, type Transport } from "../site/audit.ts";
import { normalPath, siteHost } from "../site/http.ts";
import { allowed, parseRobots, type Robots } from "../site/sitemap.ts";
import { keep, kept, note, setState, state, today } from "../store.ts";
import { parseCsv } from "./aisearch.ts";
import { decode } from "./html.ts";
import { json, now } from "./tables.ts";

/**
 * BACKLINKS the desk can know without a paid index.
 *
 * Google gives no backlink API and Bing's waits for a key, so three things
 * are done here that need neither:
 *
 *   READ A PAGE FOR A LINK. Any public page a person names is fetched once,
 *   behind the spider's guard (src/cc/site/audit.ts: public addresses only,
 *   every redirect checked, two seconds between requests to a host, 2 MB,
 *   fifteen seconds), after its site's robots.txt allowed it, under the
 *   desk's name. Every <a> that points at the website is read with its words
 *   and its rel, so "followed or not" is what the page says, not a guess. A
 *   page that names the studio without linking is said to.
 *
 *   FOLLOW LINKS. A link a person is working on (a client's credit, a
 *   directory profile), a link a check found, a linking page from Search
 *   Console's export, a referring page GA4 named: each is one row of
 *   cc_seo_backlinks, read again once a week by the job seo-backlinks.
 *   "New" is the day the desk first found the link on the page; "lost" is
 *   the day a later reading no longer did. A page that could not be read is
 *   unknown, never lost.
 *
 *   KEEP WHAT GOOGLE SHOWS. Search Console's Links report exists on its
 *   screen only. The owner exports a table there and imports the file here;
 *   which of the four tables it is, is told from its cells, not its header
 *   (the header is in the account's language).
 *
 * And one read of GA4 that the session's source cannot give: sessions by the
 * referring ADDRESS (pageReferrer), which names instagram.com where the
 * source says "ig", and the linking page itself when the browser sent it.
 *
 * NOTHING HERE IS A RATING. No authority, no "toxic", no estimate.
 */

/* ---------- hosts -------------------------------------------------------------------------- */

const apex = (): string => siteHost().replace(/^www\./, "");

/** One of the website's own hosts: a link from there is an internal link. */
export const ownHost = (host: string): boolean => {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === apex() || h.endsWith(`.${apex()}`);
};

/** A page's host without www., or "" when the text is not an address. */
export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** The studio's name as a page would write it: the first label of the website's host. */
const brand = (): string => apex().split(".")[0]!;

/* ---------- where requests go ---------------------------------------------------------------- */

/**
 * robots.txt is text/plain, and the guarded fetch reads a body only when it
 * is HTML or XML. So the same guarded fetch is used with a transport that
 * presents a plain-text answer as readable: every check of the guard still
 * runs (the address, each redirect, the pause between requests to a host).
 */
const asText: Transport = async (u, to, signal) => {
  const a = await nodeTransport(u, to, signal);
  return /\btext\/plain\b/i.test(a.headers["content-type"] ?? "") ? { ...a, headers: { ...a.headers, "content-type": "text/html" } } : a;
};

/** Where the reads go. The check script replaces every one, so nothing leaves the machine there. */
export const wire = {
  /** One page of the web, behind the guard. Throws `Refused` for an address the desk does not fetch. */
  page: (url: string): Promise<GuardedFetch> => fetchGuarded(url),
  /** A site's robots.txt, or null when it has none the desk can read. */
  robots: async (origin: string): Promise<string | null> => {
    const g = await fetchGuarded(`${origin}/robots.txt`, { transport: asText });
    return g.status === 200 && g.body && !/<html/i.test(g.body.slice(0, 500)) ? g.body : null;
  },
  sleep: (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)),
  ga4Ready: (): boolean => hasKey(),
  measuredSince: (): Promise<string | null> => ga4.measuredSince(),
  report: (spec: ga4.ReportSpec) => ga4.report(spec, { wait: true, ttl: 60_000 }),
};

/* ---------- reading a page for links to the website -------------------------------------------- */

const attr = (attrs: string, name: string): string | null => {
  const m = new RegExp(`(?:^|[\\s"'])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
  return m ? decode(m[1] ?? m[2] ?? m[3] ?? "").trim() : null;
};

const textOf = (html: string): string =>
  decode(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

type FoundLink = LinkCheck["links"][number];

const NOT_FOLLOWED = ["nofollow", "sponsored", "ugc"];

/**
 * Every link on a page that points at the website, as a crawler without
 * JavaScript reads it: the address, the page of the website it leads to, its
 * words (the text, else a picture's alt, else its label), its rel, and
 * whether a search engine is asked to follow it (the link's own rel, and the
 * page's robots meta tag or header). Also how often the page names the
 * studio outside those links. Comments, scripts and styles are not the page.
 */
export function linksIn(html: string, pageUrl: string, robotsHeader = ""): { links: FoundLink[]; mentions: number; pageNofollow: boolean; title: string | null } {
  const clean = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, " ");
  let base = pageUrl;
  const baseHref = attr(/<base\b([^>]*)>/i.exec(clean)?.[1] ?? "", "href");
  if (baseHref) {
    try {
      base = new URL(baseHref, pageUrl).toString();
    } catch {
      /* a base that is not an address is ignored, as a browser ignores it */
    }
  }
  const metaRobots = [...clean.matchAll(/<meta\b([^>]*)>/gi)]
    .filter((m) => /^(robots|googlebot)$/i.test(attr(m[1]!, "name") ?? ""))
    .map((m) => attr(m[1]!, "content") ?? "")
    .join(",");
  const pageNofollow = /\b(nofollow|none)\b/i.test(`${metaRobots},${robotsHeader}`);

  const by = new Map<string, FoundLink>();
  const rest = clean.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (whole, attrs: string, inner: string) => {
    const href = attr(attrs, "href");
    if (!href) return whole;
    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      return whole;
    }
    if ((u.protocol !== "http:" && u.protocol !== "https:") || !ownHost(u.hostname)) return whole;
    const rel = (attr(attrs, "rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean).sort();
    const alt = attr(/<img\b([^>]*)>/i.exec(inner)?.[1] ?? "", "alt");
    const anchor = (textOf(inner) || alt || attr(attrs, "aria-label") || attr(attrs, "title") || "").slice(0, 200);
    const path = normalPath(u.pathname);
    const key = `${path}\n${anchor}\n${rel.join(" ")}`;
    const had = by.get(key);
    if (had) had.times++;
    else by.set(key, { href: u.toString(), path, anchor, rel, follow: !pageNofollow && !rel.some((r) => NOT_FOLLOWED.includes(r)), times: 1 });
    /* The link's own words are not a mention beside it. */
    return " ";
  });
  const mentions = (textOf(/<body\b[^>]*>([\s\S]*)/i.exec(rest)?.[1] ?? rest).match(new RegExp(`\\b${brand()}`, "gi")) ?? []).length;
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(clean)?.[1] ?? "").replace(/\s+/g, " ").trim() || null;
  return { links: [...by.values()], mentions, pageNofollow, title };
}

/* ---------- how often the desk reads other people's pages -------------------------------------- */

export const CHECKS = {
  /** A reading is kept and answered from for this long. */
  keepMs: 86_400_000,
  /** Pages a person's checks may fetch in an hour, the whole desk together, and one person alone. */
  perHour: 60,
  perPersonHour: 20,
  /** Pages one run of the job reads, and how many days pass before a page is read again. */
  jobPages: 40,
  recheckDays: 7,
} as const;

/** The hour's readings are spent; `retryAfter` is seconds. */
export class Busy extends Error {
  constructor(
    message: string,
    readonly retryAfter: number,
  ) {
    super(message);
  }
}

const HOUR = 3_600_000;
const turns: { at: number; who: string }[] = [];

/** Take one of the hour's readings, or throw `Busy`. Returns how to give it back when no request was sent. */
function takeTurn(who: string): () => void {
  const hourAgo = Date.now() - HOUR;
  while (turns.length && turns[0]!.at < hourAgo) turns.shift();
  const wait = (at: number): number => Math.max(1, Math.ceil((at + HOUR - Date.now()) / 1000));
  if (turns.length >= CHECKS.perHour) {
    const s = wait(turns[0]!.at);
    throw new Busy(`${CHECKS.perHour} pages were read in the last hour, the most the desk fetches for link checks; the next can be asked in ${Math.ceil(s / 60)} minutes.`, s);
  }
  const mine = turns.filter((t) => t.who === who);
  if (mine.length >= CHECKS.perPersonHour) {
    const s = wait(mine[0]!.at);
    throw new Busy(`You had ${CHECKS.perPersonHour} pages read in the last hour, the most one person may; your next can be asked in ${Math.ceil(s / 60)} minutes.`, s);
  }
  const turn = { at: Date.now(), who };
  turns.push(turn);
  return () => {
    const i = turns.indexOf(turn);
    if (i >= 0) turns.splice(i, 1);
  };
}

/* A site's robots.txt, kept an hour, so a run that reads several of its pages asks for it once. */
const robotsKept = new Map<string, { at: number; robots: Robots | null }>();

async function mayRead(u: URL): Promise<boolean> {
  const had = robotsKept.get(u.origin);
  let robots = had && Date.now() - had.at < HOUR ? had.robots : undefined;
  if (robots === undefined) {
    const text = await wire.robots(u.origin).catch(() => null);
    robots = text ? parseRobots(text) : null;
    if (robotsKept.size > 500) robotsKept.clear();
    robotsKept.set(u.origin, { at: Date.now(), robots });
  }
  const path = `${u.pathname}${u.search}`;
  return !robots || (allowed(robots, path, "BalkarisDesk") && allowed(robots, path, "*"));
}

/** For the check script: forget the hour's readings and every kept robots.txt. */
export function forgetForCheck(): void {
  turns.length = 0;
  robotsKept.clear();
}

/* ---------- the desk's own rows ------------------------------------------------------------------ */

interface LinkDb {
  id: number;
  source_url: string;
  source_host: string;
  target: string | null;
  anchor: string | null;
  rel: string | null;
  origins: string;
  state: LinkState;
  state_why: string | null;
  http: number | null;
  tracked: number;
  note: string | null;
  first_seen: string;
  first_live: string | null;
  last_live: string | null;
  lost_at: string | null;
  checked_at: string | null;
  gsc_crawled: string | null;
  added_by: string | null;
  updated_at: string;
}

type Origin = KnownLink["origins"][number];
const ORIGINS: Origin[] = ["bing", "google", "check", "manual", "ga4"];
const withOrigin = (had: string, o: Origin): string => ORIGINS.filter((x) => x === o || had.split(",").includes(x)).join(",");

const toKnown = (r: LinkDb): KnownLink => ({
  id: r.id,
  source: r.source_url,
  host: r.source_host,
  target: r.target,
  anchor: r.anchor,
  rel: json<string[] | null>(r.rel, null),
  origins: r.origins.split(",").filter((o): o is Origin => (ORIGINS as string[]).includes(o)),
  state: r.state,
  stateWhy: r.state_why,
  firstSeen: r.first_seen,
  firstLive: r.first_live,
  checkedAt: r.checked_at,
  lostAt: r.lost_at,
  bingLastSeen: null,
  googleCrawled: r.gsc_crawled,
  tracked: !!r.tracked,
  note: r.note,
  addedBy: r.added_by,
});

const rowOf = (url: string): LinkDb | undefined => db.prepare("SELECT * FROM cc_seo_backlinks WHERE source_url = ?").get(url) as LinkDb | undefined;
const rowById = (id: number): LinkDb | undefined => db.prepare("SELECT * FROM cc_seo_backlinks WHERE id = ?").get(id) as LinkDb | undefined;

/** Every linking page the desk keeps a row for, followed ones first, then the newest. */
export function knownLinks(): KnownLink[] {
  return (db.prepare("SELECT * FROM cc_seo_backlinks ORDER BY tracked DESC, first_seen DESC, id DESC").all() as unknown as LinkDb[]).map(toKnown);
}

export function knownLink(id: number): KnownLink | null {
  const r = rowById(id);
  return r ? toKnown(r) : null;
}

/** Add a row for a linking page, or add an origin to the one that is there. Never resets what a reading found. */
function upsert(url: string, origin: Origin, more: { target?: string | null; anchor?: string | null; crawled?: string | null; by?: string | null } = {}): LinkDb {
  const had = rowOf(url);
  const at = now();
  if (!had) {
    db.prepare("INSERT INTO cc_seo_backlinks (source_url, source_host, target, anchor, origins, first_seen, gsc_crawled, added_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      url,
      hostOf(url),
      more.target ?? null,
      more.anchor ?? null,
      origin,
      today(),
      more.crawled ?? null,
      more.by ?? null,
      at,
    );
    return rowOf(url)!;
  }
  const origins = withOrigin(had.origins, origin);
  const crawled = more.crawled && (!had.gsc_crawled || more.crawled > had.gsc_crawled) ? more.crawled : had.gsc_crawled;
  if (origins !== had.origins || crawled !== had.gsc_crawled || (!had.target && more.target) || (!had.anchor && more.anchor)) {
    db.prepare("UPDATE cc_seo_backlinks SET origins = ?, gsc_crawled = ?, target = COALESCE(target, ?), anchor = COALESCE(anchor, ?), updated_at = ? WHERE id = ?").run(origins, crawled, more.target ?? null, more.anchor ?? null, at, had.id);
  }
  return rowOf(url)!;
}

/* ---------- one reading -------------------------------------------------------------------------- */

const KEY = "seo:bl:check:";

/** The guard's refusals, in this screen's words: it reads a page, it does not audit it. */
const reworded = (message: string): string =>
  message
    .replace(/\bto audit\b/g, "to read")
    .replace(/\bare audited\b/g, "are read")
    .replace(/\bis not audited\b/g, "is not read")
    .replace(/\bdesk audits\b/g, "desk reads");

/** The address a person typed, tidied and allowed, or a `Refused` saying why not. A bare site name means its front page. */
export function linkUrl(raw: string): URL {
  const text = (raw ?? "").trim();
  if (!text) throw new Refused("Give the address of a page, or a site's name.");
  let u: URL;
  try {
    u = guardUrl(text);
  } catch (e) {
    throw e instanceof Refused ? new Refused(reworded(e.message)) : e;
  }
  if (ownHost(u.hostname)) throw new Refused("That is the website itself. A link between its own pages is an internal link: SEO › Pages shows those.");
  return u;
}

function unreadable(url: string, final: string, status: number, why: string): LinkCheck {
  return { url, final, host: hostOf(url), status, checkedAt: now(), cached: false, verdict: "unreadable", why, links: [], mentions: 0, pageNofollow: false, title: null, linkId: null, tracked: false };
}

function read(url: string, g: GuardedFetch): LinkCheck {
  const host = hostOf(url);
  if (g.status === 0) return unreadable(url, g.url, 0, `It did not answer: ${g.error ?? "the request failed"}.`);
  if (g.error) return unreadable(url, g.url, g.status, `${g.error} The last answer was ${g.status}.`);
  if (g.status === 404 || g.status === 410) return unreadable(url, g.url, g.status, `There is no page at this address (it answered ${g.status}).`);
  if (g.status !== 200) {
    const shut = [401, 403, 429, 999].includes(g.status);
    return unreadable(url, g.url, g.status, shut ? `${host} refuses the desk's request (it answered ${g.status}), so the page cannot be read from here. Open it in a browser to see the link.` : `It answered ${g.status}, not a page.`);
  }
  if (g.body === null) return unreadable(url, g.url, 200, "The address answered, but not with an HTML page.");
  if (ownHost(new URL(g.url).hostname)) return unreadable(url, g.url, 200, `It redirects to the website itself (${new URL(g.url).pathname}), so there is no other site's page to read.`);
  const found = linksIn(g.body, g.url, g.headers["x-robots-tag"] ?? "");
  return {
    url,
    final: g.url,
    host,
    status: 200,
    checkedAt: now(),
    cached: false,
    verdict: found.links.length ? "links" : found.mentions ? "mentions" : "nothing",
    why: g.truncated ? "The page is larger than 2 MB; only its first 2 MB were read." : null,
    links: found.links.slice(0, 50),
    mentions: found.mentions,
    pageNofollow: found.pageNofollow,
    title: found.title,
    linkId: null,
    tracked: false,
  };
}

/** What a reading found, in one sentence. */
export function lineOf(c: LinkCheck): string {
  const name = brand().replace(/^./, (x) => x.toUpperCase());
  if (c.verdict === "unreadable") return c.why ?? "The page could not be read.";
  if (c.verdict === "nothing") return `${c.host} was read and this page has no link to the website, and does not name ${name}.`;
  if (c.verdict === "mentions") return `This page names ${name} ${c.mentions === 1 ? "once" : `${c.mentions} times`} and does not link to the website: a link to ask for.`;
  const n = c.links.reduce((t, l) => t + l.times, 0);
  const closed = c.links.filter((l) => !l.follow).length;
  const pages = [...new Set(c.links.map((l) => l.path))];
  const to = pages.length <= 3 ? pages.join(", ") : `${pages.slice(0, 3).join(", ")} and ${pages.length - 3} more`;
  const how = c.pageNofollow ? "; the page asks search engines to follow none of its links" : closed === 0 ? "; followed" : closed === c.links.length ? "; marked nofollow, sponsored or ugc" : `; ${closed} of ${c.links.length} marked nofollow, sponsored or ugc`;
  return `${c.host} links to the website: ${n} link${n === 1 ? "" : "s"} on this page, to ${to}${how}.`;
}

/**
 * Write a reading into the desk's row for that page, when there is one or the
 * reading found a link (a link the desk has seen with its own eyes is kept).
 * Returns the row. A page that could not be read changes no day: unknown is
 * not lost.
 */
function apply(c: LinkCheck): LinkDb | null {
  let r = rowOf(c.url);
  if (!r && c.verdict !== "links") return null;
  if (!r) r = upsert(c.url, "check");
  const day = today();
  const name = brand().replace(/^./, (x) => x.toUpperCase());
  let st: LinkState;
  let why: string | null = null;
  let firstLive = r.first_live;
  let lastLive = r.last_live;
  let lostAt = r.lost_at;
  let target = r.target;
  let anchor = r.anchor;
  let rel = r.rel;
  if (c.verdict === "links") {
    const best = c.links.find((l) => l.follow) ?? c.links[0]!;
    st = "live";
    firstLive ??= day;
    lastLive = day;
    lostAt = null;
    target = best.path;
    anchor = best.anchor || null;
    rel = JSON.stringify(c.pageNofollow ? [...new Set([...best.rel, "nofollow"])] : best.rel);
  } else if (c.verdict === "unreadable") {
    st = "unreadable";
    why = c.why;
  } else if (r.first_live) {
    st = "lost";
    lostAt ??= day;
    why = `The page was read on ${day} and no longer links to the website; the link was last found on ${r.last_live ?? r.first_live}.${c.mentions ? ` It still names ${name}.` : ""}`;
  } else {
    st = "waiting";
    why = c.mentions ? `The page names ${name} ${c.mentions === 1 ? "once" : `${c.mentions} times`} and does not link to the website yet.` : "The page is there and does not link to the website yet.";
  }
  db.prepare("UPDATE cc_seo_backlinks SET state = ?, state_why = ?, http = ?, first_live = ?, last_live = ?, lost_at = ?, target = ?, anchor = ?, rel = ?, checked_at = ?, origins = ?, updated_at = ? WHERE id = ?").run(
    st,
    why,
    c.status || null,
    firstLive,
    lastLive,
    lostAt,
    target,
    anchor,
    rel,
    c.checkedAt,
    c.verdict === "links" ? withOrigin(r.origins, "check") : r.origins,
    now(),
    r.id,
  );
  if (st === "lost" && r.state !== "lost") {
    note("seo-backlinks", `A link to the website is gone: ${r.source_host}`, { tone: "warn", detail: `${r.source_url} no longer links${r.target ? ` to ${r.target}` : ""}. Read by the desk on ${day}.`, href: `/seo/backlinks?open=${encodeURIComponent(r.source_host)}`, dedupe: `seo:bl:lost:${r.id}:${day}` });
  } else if (st === "live" && r.state !== "live" && (r.tracked || r.state === "lost")) {
    note("seo-backlinks", `${r.state === "lost" ? "A link to the website is back" : "A link you follow is live"}: ${r.source_host}`, {
      tone: "good",
      detail: `${r.source_url} links to ${target ?? "the website"}${anchor ? ` with the words “${anchor}”` : ""}.`,
      href: `/seo/backlinks?open=${encodeURIComponent(r.source_host)}`,
      dedupe: `seo:bl:live:${r.id}:${day}`,
    });
  }
  return rowById(r.id)!;
}

/**
 * Read one page for a link to the website: from the reading kept within the
 * day, or fetched now. Throws `Refused` (the address is not one the desk
 * fetches) or `Busy` (the hour's readings are spent). `job`: the weekly
 * re-reading, which has its own cap and turns a refusal into "unreadable".
 */
export async function checkPage(raw: string, o: { who: string; fresh?: boolean; job?: boolean }): Promise<LinkCheck> {
  const u = linkUrl(raw);
  const url = u.toString();
  const withRow = (c: LinkCheck): LinkCheck => {
    const r = rowOf(url);
    return { ...c, linkId: r?.id ?? null, tracked: !!r?.tracked };
  };
  if (!o.fresh) {
    const had = kept<LinkCheck>(`${KEY}${url}`);
    if (had && Date.now() - had.at < CHECKS.keepMs) return withRow({ ...had.value, cached: true });
  }
  const giveBack = o.job ? () => {} : takeTurn(o.who);
  let c: LinkCheck;
  try {
    if (!(await mayRead(u))) {
      giveBack();
      c = unreadable(url, url, 0, `${u.hostname}'s robots.txt asks robots not to read this address, so the desk does not. Open it in a browser to see the link.`);
    } else {
      const g = await wire.page(url);
      if (!g.sent) giveBack();
      c = read(url, g);
    }
  } catch (e) {
    giveBack();
    if (!(e instanceof Refused) || !o.job) throw e instanceof Refused ? new Refused(reworded(e.message)) : e;
    c = unreadable(url, url, 0, reworded(e.message));
  }
  apply(c);
  db.prepare("DELETE FROM cc_cache WHERE key LIKE ? AND at < ?").run(`${KEY}%`, Date.now() - CHECKS.keepMs);
  keep(`${KEY}${url}`, c);
  return withRow(c);
}

/* ---------- following a link ----------------------------------------------------------------------- */

/** A sentence for the person: thrown by the changes below. */
export class Said extends Error {}

/** A person follows a link, or a page a link is expected on. The row is made if there is none; nothing is fetched here. */
export function follow(raw: string, by: string, noteText?: string | null): KnownLink {
  const url = linkUrl(raw).toString();
  const text = (noteText ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null;
  const r = upsert(url, "manual", { by });
  db.prepare("UPDATE cc_seo_backlinks SET tracked = 1, note = COALESCE(?, note), added_by = COALESCE(added_by, ?), updated_at = ? WHERE id = ?").run(text, by, now(), r.id);
  if (!r.tracked) note("seo-backlinks", `Following a link from ${r.source_host}`, { tone: "info", actor: by, detail: url, href: "/seo/backlinks#bl-links", dedupe: `seo:bl:follow:${r.id}:${now()}` });
  return toKnown(rowById(r.id)!);
}

/** Change a followed link: stop or start following it, or its note. A row only a person made, that never linked, goes when it is no longer followed. */
export function changeLink(id: number, c: { tracked?: unknown; note?: unknown }, by: string): { link: KnownLink | null; line: string } {
  const r = rowById(id);
  if (!r) throw new Said("There is no such link on the desk.");
  if (c.note !== undefined && c.note !== null && (typeof c.note !== "string" || c.note.length > 200)) throw new Said("A note is at most 200 characters.");
  if (c.tracked !== undefined && typeof c.tracked !== "boolean") throw new Said("tracked must be true or false.");
  const noteText = c.note === undefined ? r.note : ((c.note as string | null) ?? "").replace(/\s+/g, " ").trim() || null;
  const tracked = c.tracked === undefined ? !!r.tracked : (c.tracked as boolean);
  if (!tracked && r.origins === "manual" && !r.first_live) {
    db.prepare("DELETE FROM cc_seo_backlinks WHERE id = ?").run(id);
    db.prepare("DELETE FROM cc_cache WHERE key = ?").run(`${KEY}${r.source_url}`);
    note("seo-backlinks", `Stopped following ${r.source_host}`, { tone: "info", actor: by, detail: r.source_url, href: "/seo/backlinks#bl-links", dedupe: `seo:bl:unfollow:${id}:${now()}` });
    return { link: null, line: `No longer followed, and taken off the list: ${r.source_host} never linked to the website.` };
  }
  db.prepare("UPDATE cc_seo_backlinks SET tracked = ?, note = ?, updated_at = ? WHERE id = ?").run(tracked ? 1 : 0, noteText, now(), id);
  const line = tracked !== !!r.tracked ? (tracked ? `Following ${r.source_host}: the desk reads the page again every week.` : `No longer followed. The link stays in the list of ${r.source_host}.`) : "Note kept.";
  return { link: toKnown(rowById(id)!), line };
}

/* ---------- the job: read the linking pages again -------------------------------------------------- */

/** Bing's linking pages get a row too, so the desk reads them itself: followed or not, still there or not. */
export function syncBing(): number {
  if (!bing.configured()) return 0;
  const r = bing.inboundLinks(5000);
  if (r.state !== "ok") return 0;
  let added = 0;
  for (const l of r.value) {
    let u: URL;
    try {
      u = linkUrl(l.source);
    } catch {
      continue;
    }
    const had = rowOf(u.toString());
    upsert(u.toString(), "bing", { target: l.path, anchor: l.anchor || null });
    if (!had) added++;
  }
  return added;
}

/**
 * Read again every linking page that is due: never read, or last read more
 * than a week ago; the followed ones first. At most `most` pages a run, half
 * a second between two (and two seconds between two of one site, by the
 * guard), robots.txt obeyed.
 */
export async function recheckDue(progress: (done: number, of: number, what?: string) => void = () => {}, most: number = CHECKS.jobPages): Promise<string> {
  const due = new Date(Date.now() - CHECKS.recheckDays * 86_400_000).toISOString();
  const rows = db.prepare("SELECT * FROM cc_seo_backlinks WHERE checked_at IS NULL OR checked_at < ? ORDER BY tracked DESC, checked_at IS NOT NULL, checked_at, id LIMIT ?").all(due, most) as unknown as LinkDb[];
  if (!rows.length) {
    const n = (db.prepare("SELECT COUNT(*) AS n FROM cc_seo_backlinks").get() as { n: number }).n;
    return n ? `every one of the ${n} linking pages was read in the last ${CHECKS.recheckDays} days` : "no linking page is kept yet";
  }
  const tally: Record<LinkState, number> = { live: 0, lost: 0, waiting: 0, unreadable: 0, "not-checked": 0 };
  let fresh = 0;
  let gone = 0;
  for (const [i, r] of rows.entries()) {
    if (i) await wire.sleep(500);
    progress(i, rows.length, r.source_host);
    let st: LinkState = "unreadable";
    try {
      await checkPage(r.source_url, { who: "desk", fresh: true, job: true });
      st = rowById(r.id)?.state ?? "unreadable";
    } catch (e) {
      db.prepare("UPDATE cc_seo_backlinks SET state = 'unreadable', state_why = ?, checked_at = ?, updated_at = ? WHERE id = ?").run((e instanceof Error ? e.message : String(e)).slice(0, 200), now(), now(), r.id);
    }
    tally[st]++;
    if (st === "live" && r.state !== "live") fresh++;
    if (st === "lost" && r.state !== "lost") gone++;
  }
  progress(rows.length, rows.length);
  return `${rows.length} linking page${rows.length === 1 ? "" : "s"} read: ${tally.live} link, ${tally.waiting} do not yet, ${tally.lost} no longer do, ${tally.unreadable} could not be read${fresh ? `; ${fresh} newly found` : ""}${gone ? `; ${gone} newly gone` : ""}`;
}

/* ---------- GA4: sessions by the referring address ------------------------------------------------ */

const REF_TO = "seo:bl:ref:to";

/** The day up to which the referring addresses are read, or null before the first read. */
export const referrersReadTo = (): string | null => state(REF_TO);

/**
 * Read GA4's sessions by day, referring address and landing page, from the
 * day after the last one kept (re-reading the last two, which GA4 may still
 * change) up to yesterday. The website's own pages are left out in the
 * question itself; everything else is kept, and a screen decides what a
 * linking site is. A referring address with a path of its own is a page that
 * linked: it gets a row to be read (twenty new ones a run at most).
 */
export async function readReferrers(): Promise<string> {
  const since = await wire.measuredSince();
  if (!since) throw new Error("GA4 has recorded nothing for the website yet, or cannot be asked.");
  const yesterday = addDays(today(), -1);
  const last = (db.prepare("SELECT MAX(day) AS d FROM cc_seo_ref_pages").get() as { d: string | null }).d ?? state(REF_TO);
  const start = last ? (addDays(last, -2) > since ? addDays(last, -2) : since) : since;
  if (start > yesterday) return "referring addresses are up to date";
  const own = `^https?://([^/]*\\.)?${apex().replace(/\./g, "\\.")}(/|:|$)`;
  const r = await wire.report({
    dimensions: ["date", "pageReferrer", "landingPage"],
    metrics: ["sessions"],
    dateRanges: [{ startDate: start, endDate: yesterday }],
    dimensionFilter: ga4.where.not(ga4.where.matches("pageReferrer", own)),
    limit: 10_000,
  });
  if (!r.data) throw new Error(r.error ?? "GA4 did not answer.");
  const rows: { day: string; referrer: string; host: string; landing: string; sessions: number }[] = [];
  for (const row of r.data.rows) {
    const referrer = String(row.pageReferrer ?? "").slice(0, 500);
    const host = hostOf(referrer);
    if (!host || ownHost(host)) continue;
    rows.push({ day: String(row.date), referrer, host, landing: ga4.normalPath(String(row.landingPage)), sessions: Number(row.sessions) || 0 });
  }
  const put = db.prepare("INSERT INTO cc_seo_ref_pages (day, referrer, host, landing, sessions) VALUES (?, ?, ?, ?, ?) ON CONFLICT(day, referrer, landing) DO UPDATE SET sessions = sessions + excluded.sessions");
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM cc_seo_ref_pages WHERE day >= ? AND day <= ?").run(start, yesterday);
    for (const x of rows) put.run(x.day, x.referrer, x.host, x.landing, x.sessions);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  setState(REF_TO, yesterday);

  /* A referring address with a path is the page that linked: worth reading. A front door ("https://site/") names only the site. */
  let pages = 0;
  for (const x of rows) {
    if (pages >= 20 || x.sessions < 1) continue;
    let u: URL;
    try {
      u = linkUrl(x.referrer);
    } catch {
      continue;
    }
    if (u.pathname === "/" || u.pathname === "" || SEARCHING.test(u.hostname)) continue;
    u.search = "";
    if (!rowOf(u.toString())) pages++;
    upsert(u.toString(), "ga4", { target: x.landing.startsWith("/") ? x.landing : null });
  }
  const sites = new Set(rows.filter((x) => x.sessions > 0).map((x) => x.host)).size;
  return `${rows.length} referring-address rows for ${start} to ${yesterday} from ${sites} site${sites === 1 ? "" : "s"}${pages ? `; ${pages} linking page${pages === 1 ? "" : "s"} to read` : ""}`;
}

/** Hosts whose "referring page" is a search or a chat, never a page that links. */
const SEARCHING = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|yahoo\.com|ecosia\.org|startpage\.com|brave\.com|qwant\.com|yandex\.[a-z.]+|baidu\.com|chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|copilot\.microsoft\.com|you\.com)$/i;

export interface RefRow {
  day: string;
  referrer: string;
  host: string;
  landing: string;
  sessions: number;
}

export function refVisits(start: string, end: string): RefRow[] {
  return db.prepare("SELECT day, referrer, host, landing, sessions FROM cc_seo_ref_pages WHERE day >= ? AND day <= ? ORDER BY day").all(start, end) as unknown as RefRow[];
}

/** The first day each host referred a session, over everything kept. */
export function refFirst(): Map<string, string> {
  return new Map((db.prepare("SELECT host, MIN(day) AS d FROM cc_seo_ref_pages WHERE sessions > 0 GROUP BY host").all() as { host: string; d: string }[]).map((r) => [r.host, r.d]));
}

/** The daily job: GA4's referring addresses, Bing's linking pages into the list, and the linking pages that are due read again. */
export async function dailyRead(progress: (done: number, of: number, what?: string) => void = () => {}): Promise<string> {
  const parts: string[] = [];
  let failed = false;
  if (wire.ga4Ready()) {
    try {
      parts.push(await readReferrers());
    } catch (e) {
      failed = true;
      parts.push(`GA4's referring addresses could not be read (${(e instanceof Error ? e.message : String(e)).slice(0, 100)})`);
    }
  } else parts.push("GA4 is not connected, so no referring address was read");
  try {
    syncBing();
  } catch {
    /* Bing's list is read by its own job; a failure there costs nothing here. */
  }
  parts.push(await recheckDue(progress));
  const line = parts.join("; ").replace(/^./, (x) => x.toUpperCase());
  if (failed) throw new Error(line);
  return line;
}

/* ---------- Search Console's Links export ------------------------------------------------------ */

const IMPORTED = "seo:bl:gsc:";
/** The day the desk first had each site from a "Top linking sites" export: { host: day }. */
const SITES_FIRST = "seo:bl:gsc-first:sites";
const KINDS: GscLinksKind[] = ["sites", "pages", "texts", "links"];
const KIND_NAME: Record<GscLinksKind, string> = { sites: "Top linking sites", pages: "Top linked pages", texts: "Top linking text", links: "Latest links (or More sample links)" };

const isAddress = (s: string): boolean => /^https?:\/\/\S+$/i.test(s);
const isHost = (s: string): boolean => /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(s);
const isCount = (s: string): boolean => /^\d[\d\s.,'’]*$/.test(s);
const count = (s: string | undefined): number | null => {
  const d = (s ?? "").replace(/[^\d]/g, "");
  return d ? Number(d) : null;
};
const share = (cells: string[], test: (s: string) => boolean): number => (cells.length ? cells.filter(test).length / cells.length : 0);

/**
 * Which of Search Console's Links tables a file is, told from its cells: the
 * header is in the account's language ("Website", "Verweisende Seiten"), the
 * cells are not.
 *
 *   addresses on other sites (and maybe a date)   Latest links, More sample links
 *   addresses on the website, then two counts      Top linked pages
 *   bare site names, then two counts               Top linking sites
 *   a rank, then words                             Top linking text
 */
function kindOf(body: string[][]): GscLinksKind | null {
  const first = body.map((r) => (r[0] ?? "").trim()).filter(Boolean);
  const second = body.map((r) => (r[1] ?? "").trim()).filter(Boolean);
  if (!first.length) return null;
  if (share(first, isAddress) >= 0.8) return share(first, (s) => ownHost(hostOf(s))) >= 0.8 ? "pages" : share(first, (s) => ownHost(hostOf(s))) <= 0.2 ? "links" : null;
  if (share(first, isHost) >= 0.8) return "sites";
  if (share(first, isCount) >= 0.8 && second.length && share(second, isCount) < 0.5) return "texts";
  return null;
}

/**
 * Keep one exported table. Sites, pages and texts replace the import before
 * (the export is the whole table); linking pages are added to the desk's own
 * list, where the weekly job reads them. Throws with a sentence when the file
 * is not one of the four.
 */
export function importGscLinks(csv: string, by: string): { kind: GscLinksKind; rows: number; line: string } {
  const cells = parseCsv(csv).map((r) => r.map((c) => c.trim()));
  if (!cells.length) throw new Said("The file is empty.");
  if (cells.length > 20_001) throw new Said("The file has more than 20,000 rows.");
  /* The first row is a header unless it already looks like the rows under it. */
  const headed = !(isAddress(cells[0]![0] ?? "") || isHost(cells[0]![0] ?? "") || isCount(cells[0]![0] ?? ""));
  const body = headed ? cells.slice(1) : cells;
  const kind = kindOf(body);
  if (!kind) {
    throw new Said(
      "The desk could not tell which Links table this is. It reads the four exports of Search Console › Links: Top linking sites (a site and two counts), Top linked pages (an address of the website and two counts), Top linking text (a rank and the words), and Latest links or More sample links (the linking pages' addresses).",
    );
  }
  let rows = 0;
  db.exec("BEGIN");
  try {
    if (kind === "links") {
      for (const r of body) {
        let u: URL;
        try {
          u = linkUrl(r[0] ?? "");
        } catch {
          continue;
        }
        const crawled = /^\d{4}-\d\d-\d\d/.exec(r[1] ?? "")?.[0] ?? null;
        upsert(u.toString(), "google", { crawled });
        rows++;
      }
    } else {
      db.prepare("DELETE FROM cc_seo_gsc_links WHERE kind = ?").run(kind);
      const put = db.prepare("INSERT OR REPLACE INTO cc_seo_gsc_links (kind, key, n1, n2) VALUES (?, ?, ?, ?)");
      for (const r of body) {
        const a = (r[0] ?? "").trim();
        if (!a) continue;
        if (kind === "sites") {
          if (!isHost(a) || ownHost(a)) continue;
          put.run(kind, a.toLowerCase().replace(/^www\./, ""), count(r[1]), count(r[2]));
        } else if (kind === "pages") {
          if (!isAddress(a) || !ownHost(hostOf(a))) continue;
          put.run(kind, normalPath(new URL(a).pathname), count(r[1]), count(r[2]));
        } else {
          const words = (r[1] ?? "").trim().slice(0, 200);
          if (!words) continue;
          put.run(kind, words, count(a), null);
        }
        rows++;
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  if (!rows) throw new Said(`The file reads as Search Console's ${KIND_NAME[kind]}, but none of its rows could be kept.`);
  if (kind === "sites") {
    /* The export replaces its table each time; the day the desk first had each site from it is kept beside it, so a site is "new" once. */
    const first = json<Record<string, string>>(state(SITES_FIRST), {});
    for (const r of db.prepare("SELECT key FROM cc_seo_gsc_links WHERE kind = 'sites'").all() as { key: string }[]) first[r.key] ??= today();
    setState(SITES_FIRST, JSON.stringify(first));
  }
  setState(`${IMPORTED}${kind}`, JSON.stringify({ at: now(), by, rows }));
  note("seo-import", `Imported Search Console's ${KIND_NAME[kind]}`, { tone: "info", actor: by, detail: `${rows.toLocaleString("en-GB")} row${rows === 1 ? "" : "s"}`, href: "/seo/backlinks", dedupe: `seo:bl:gsc:${kind}:${now()}` });
  const what: Record<GscLinksKind, string> = { sites: "site", pages: "page", texts: "link text", links: "linking page" };
  return {
    kind,
    rows,
    line: `Read as Search Console's ${KIND_NAME[kind]}: ${rows.toLocaleString("en-GB")} ${what[kind]}${rows === 1 ? "" : "s"} kept.${kind === "links" ? " The desk reads each of them over the next runs, to see the link and whether it is followed." : ""}`,
  };
}

/** What was imported from Search Console's Links report, or null when nothing ever was. */
export function googleLinks(): GoogleLinks | null {
  const imported = Object.fromEntries(KINDS.map((k) => [k, json<{ at: string; by: string; rows: number } | null>(state(`${IMPORTED}${k}`), null)])) as GoogleLinks["imported"];
  if (!KINDS.some((k) => imported[k])) return null;
  const of = (kind: string) => db.prepare("SELECT key, n1, n2 FROM cc_seo_gsc_links WHERE kind = ?").all(kind) as { key: string; n1: number | null; n2: number | null }[];
  const first = json<Record<string, string>>(state(SITES_FIRST), {});
  return {
    sites: of("sites")
      .map((r) => ({ host: r.key, pages: r.n1 ?? 0, targets: r.n2 ?? 0, firstSeen: first[r.key] ?? null }))
      .sort((a, b) => b.pages - a.pages || a.host.localeCompare(b.host)),
    pages: of("pages")
      .map((r) => ({ path: r.key, links: r.n1 ?? 0, sites: r.n2 ?? 0 }))
      .sort((a, b) => b.links - a.links || a.path.localeCompare(b.path)),
    texts: of("texts")
      .sort((a, b) => (a.n1 ?? 1e9) - (b.n1 ?? 1e9))
      .map((r) => r.key),
    samples: (db.prepare("SELECT COUNT(*) AS n FROM cc_seo_backlinks WHERE origins LIKE '%google%'").get() as { n: number }).n,
    imported,
  };
}
