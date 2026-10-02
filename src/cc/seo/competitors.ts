import { db } from "../../db.ts";
import { allowed, parseRobots, type Robots } from "../site/sitemap.ts";
import { note } from "../store.ts";
import { fetchPage, readHtml } from "./html.ts";
import { json, now } from "./tables.ts";

/**
 * COMPETITORS: the domains seen beside or instead of Balkaris.
 *
 * Where each was seen is an observation with its day and who made it: a
 * Google result the audit read in the owner's Chrome (organic position, the
 * map pack, an AI Overview's names and sources), or an AI assistant's answer
 * (aisearch.ts records those as checks and their names and sources as
 * sightings here). Nothing is estimated: no domain rating, no backlink
 * count, no traffic.
 *
 * Their pages for our clusters are read once a week, politely: at most one
 * request every two seconds to a host, robots.txt asked first and obeyed, the
 * desk's own name on every request. What is kept is what the page itself
 * says: title, first heading, words, language, structured-data types, and
 * whether it states a price.
 */

/**
 * Sites that are platforms or directories rather than studios: their
 * sightings are kept (a directory ranking is a finding), their pages are not
 * read as a competitor's.
 */
export const PLATFORMS = new Set([
  "reddit.com",
  "linkedin.com",
  "youtube.com",
  "wikipedia.org",
  "quora.com",
  "facebook.com",
  "instagram.com",
  "immoscout24.ch",
  "postfinance.ch",
  "search.ch",
  "local.ch",
  "sortlist.ch",
  "sortlist.com",
  "clutch.co",
  "designrush.com",
  "themanifest.com",
  "goodfirms.co",
  "startups.ch",
  "supsi.ch",
  "lam.unisg.ch",
  "sav-fsa.ch",
  "beck-stellenmarkt.de",
  /* law directories: a listing of firms, not a firm */
  "bestlawyers.com",
  "globallawexperts.com",
]);

const isPlatform = (domain: string): boolean => [...PLATFORMS].some((p) => domain === p || domain.endsWith(`.${p}`));

export const ENGINE_LABEL: Record<string, string> = {
  google: "Google",
  "google-local": "Google map pack",
  "google-aio": "Google AI Overview",
  "google-ai-mode": "Google AI Mode",
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
  copilot: "Copilot",
  claude: "Claude",
};

/** A host as a key: lower case, no "www.", no path. A company named without a site is "name:<name>". */
export function domainKey(domainOrName: string | null | undefined, name?: string | null): string | null {
  const d = (domainOrName ?? "").trim().toLowerCase();
  if (d && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d.replace(/^www\./, ""))) return d.replace(/^www\./, "");
  const n = (name ?? domainOrName ?? "").trim();
  return n ? `name:${n}` : null;
}

export function upsertCompetitor(domain: string, name: string | null, at = now()): void {
  db.prepare(
    "INSERT INTO cc_seo_competitors (domain, name, first_seen, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(domain) DO UPDATE SET name = COALESCE(cc_seo_competitors.name, excluded.name), updated_at = excluded.updated_at",
  ).run(domain, name, at, at);
}

export interface SightingInput {
  domain: string;
  name: string | null;
  engine: string;
  kind: "organic" | "local-pack" | "named" | "cited";
  query: string;
  lang: string | null;
  cluster: string | null;
  position: number | null;
  day: string;
  by: string;
  note?: string | null;
}

/** Keep one observation. Returns whether it was new. */
export function addSighting(s: SightingInput): boolean {
  upsertCompetitor(s.domain, s.name);
  const r = db
    .prepare("INSERT OR IGNORE INTO cc_seo_sightings (domain, name, engine, kind, query, lang, cluster, position, day, by, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(s.domain, s.name, s.engine, s.kind, s.query, s.lang, s.cluster, s.position, s.day, s.by, s.note ?? null);
  return r.changes > 0;
}

/** A competitor page to read (its fetched figures are never reset by adding it again). */
export function addCompetitorPage(p: { url: string; domain: string; address: "ranking" | "home"; cluster: string | null; query: string | null }): boolean {
  const r = db
    .prepare("INSERT OR IGNORE INTO cc_seo_comp_pages (url, domain, address, cluster, query, added_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(p.url, p.domain, p.address, p.cluster, p.query, now());
  return r.changes > 0;
}

/** Whether a domain's pages are read as a competitor's (not a platform, not a bare name). */
export const readable = (domain: string): boolean => !domain.startsWith("name:") && !isPlatform(domain);

/* ---------- the weekly read of their pages ---------------------------------------------------- */

const HOST_GAP_MS = 2000;
const REREAD_DAYS = 6;

/** Where the reads go. The check script replaces it. */
export const wire = { fetchPage, sleep: (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)) };

/**
 * Read every competitor page due (never read, or read more than six days
 * ago). Hosts are taken one at a time, robots.txt first, two seconds between
 * any two requests to a host and one second between hosts.
 */
export async function refreshPages(progress: (done: number, of: number, what?: string) => void = () => {}, o: { most?: number } = {}): Promise<string> {
  const due = new Date(Date.now() - REREAD_DAYS * 86_400_000).toISOString();
  const rows = db.prepare("SELECT url, domain FROM cc_seo_comp_pages WHERE fetched_at IS NULL OR fetched_at < ? ORDER BY domain, url").all(due) as { url: string; domain: string }[];
  const list = rows.slice(0, o.most ?? 80);
  if (!list.length) {
    const known = (db.prepare("SELECT COUNT(*) AS n FROM cc_seo_comp_pages").get() as { n: number }).n;
    return known
      ? `Every one of the ${known} competitor pages was read in the last six days.`
      : "No competitor page is known yet: they come from the audit's captured search results (scripts/seo-import.ts, or POST /api/v1/seo/imports/audit).";
  }
  const byHost = new Map<string, string[]>();
  for (const r of list) {
    const host = new URL(r.url).host;
    byHost.set(host, [...(byHost.get(host) ?? []), r.url]);
  }
  const put = db.prepare("UPDATE cc_seo_comp_pages SET status = ?, title = ?, h1 = ?, words = ?, lang = ?, schema = ?, price = ?, price_text = ?, fetched_at = ?, error = ? WHERE url = ?");
  let done = 0;
  let read = 0;
  let refused = 0;
  let first = true;
  for (const [host, urls] of byHost) {
    if (!first) await wire.sleep(1000);
    first = false;
    let robots: Robots | null = null;
    const r = await wire.fetchPage(`https://${host}/robots.txt`, { timeout: 15_000, accept: "text/plain,*/*;q=0.5" });
    if (r.status === 200 && r.html && !/<html/i.test(r.html.slice(0, 500))) robots = parseRobots(r.html);
    for (const url of urls) {
      await wire.sleep(HOST_GAP_MS);
      progress(done, list.length, url);
      const path = new URL(url).pathname || "/";
      if (robots && !(allowed(robots, path, "BalkarisDesk") && allowed(robots, path, "*"))) {
        put.run(null, null, null, null, null, "[]", null, null, now(), "robots.txt disallows the desk from reading this address", url);
        refused++;
        done++;
        continue;
      }
      const got = await wire.fetchPage(url);
      if (got.status !== 200 || !got.html) {
        put.run(got.status || null, null, null, null, null, "[]", null, null, now(), got.error ?? `answered ${got.status}`, url);
      } else {
        const h = readHtml(got.html);
        put.run(got.status, h.title, h.h1, h.words, h.lang, JSON.stringify(h.schemaTypes), h.price.stated ? 1 : 0, h.price.text, now(), null, url);
        read++;
      }
      done++;
    }
  }
  progress(list.length, list.length);
  if (read) note("seo-competitors", `Read ${read} competitor page${read === 1 ? "" : "s"}`, { tone: "quiet", detail: `${byHost.size} sites, two seconds apart per site${refused ? `; ${refused} refused by robots.txt` : ""}.`, href: "/seo/competitors", dedupe: `seo:comp:${today10()}` });
  return `${read} of ${list.length} pages read from ${byHost.size} sites${refused ? `, ${refused} refused by robots.txt` : ""}`;
}

const today10 = (): string => new Date().toISOString().slice(0, 10);

/* ---------- reading it back ----------------------------------------------------------------- */

export interface SightingRow {
  domain: string;
  name: string | null;
  engine: string;
  kind: "organic" | "local-pack" | "named" | "cited";
  query: string;
  lang: string | null;
  cluster: string | null;
  position: number | null;
  day: string;
  by: string;
  note: string | null;
}

export function sightings(filter: { domain?: string; cluster?: string } = {}): SightingRow[] {
  const where: string[] = [];
  const args: string[] = [];
  if (filter.domain) {
    where.push("domain = ?");
    args.push(filter.domain);
  }
  if (filter.cluster) {
    where.push("cluster = ?");
    args.push(filter.cluster);
  }
  return db.prepare(`SELECT domain, name, engine, kind, query, lang, cluster, position, day, by, note FROM cc_seo_sightings ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY day DESC, engine, query, position`).all(...args) as unknown as SightingRow[];
}

export interface CompPageRow {
  url: string;
  domain: string;
  address: "ranking" | "home";
  cluster: string | null;
  query: string | null;
  status: number | null;
  title: string | null;
  h1: string | null;
  words: number | null;
  lang: string | null;
  schemaTypes: string[];
  priceStated: boolean | null;
  priceText: string | null;
  fetchedAt: string | null;
  error: string | null;
}

export function competitorPages(filter: { domain?: string; cluster?: string; query?: string } = {}): CompPageRow[] {
  const where: string[] = [];
  const args: string[] = [];
  for (const [k, v] of Object.entries(filter)) {
    if (!v) continue;
    where.push(`${k} = ?`);
    args.push(v);
  }
  return (
    db.prepare(`SELECT * FROM cc_seo_comp_pages ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY domain, url`).all(...args) as {
      url: string;
      domain: string;
      address: string;
      cluster: string | null;
      query: string | null;
      status: number | null;
      title: string | null;
      h1: string | null;
      words: number | null;
      lang: string | null;
      schema: string;
      price: number | null;
      price_text: string | null;
      fetched_at: string | null;
      error: string | null;
    }[]
  ).map((r) => ({
    url: r.url,
    domain: r.domain,
    address: r.address === "ranking" ? "ranking" : "home",
    cluster: r.cluster,
    query: r.query,
    status: r.status,
    title: r.title,
    h1: r.h1,
    words: r.words,
    lang: r.lang,
    schemaTypes: json<string[]>(r.schema, []),
    priceStated: r.price === null ? null : !!r.price,
    priceText: r.price_text,
    fetchedAt: r.fetched_at,
    error: r.error,
  }));
}

export function competitorNames(): Map<string, string | null> {
  return new Map((db.prepare("SELECT domain, name FROM cc_seo_competitors").all() as { domain: string; name: string | null }[]).map((r) => [r.domain, r.name]));
}
