import { db } from "../../db.ts";
import { allowed, parseRobots, type Robots } from "../site/sitemap.ts";
import { note } from "../store.ts";
import { fetchGuarded, readHtml } from "./html.ts";
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
  /* DuckDuckGo's own result page (src/cc/seo/web/serp.ts): a second opinion, never Google's ranking. */
  duckduckgo: "DuckDuckGo",
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
export function addCompetitorPage(p: { url: string; domain: string; address: "ranking" | "home" | "topic"; cluster: string | null; query: string | null }): boolean {
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
/* A page that could not be read (a timeout, a 429, a 5xx) is asked again after a day, not a week: the failure is usually passing. */
const RETRY_DAYS = 1;

/**
 * Where the reads go. The check script replaces it. Every read goes through
 * the web layer's guard, because a person can now name any site to watch:
 * a typed host must never make the desk read the box it runs on.
 */
export const wire = { fetchPage: fetchGuarded, sleep: (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)) };

/** The pages the weekly read would take now: never read, read well more than six days ago, or failed more than a day ago; platforms' never. */
export function duePages(domain?: string): { url: string; domain: string }[] {
  const week = new Date(Date.now() - REREAD_DAYS * 86_400_000).toISOString();
  const day = new Date(Date.now() - RETRY_DAYS * 86_400_000).toISOString();
  const rows = db
    .prepare(`SELECT url, domain FROM cc_seo_comp_pages WHERE (fetched_at IS NULL OR (error IS NULL AND fetched_at < ?) OR (error IS NOT NULL AND fetched_at < ?))${domain ? " AND domain = ?" : ""} ORDER BY domain, url`)
    .all(...(domain ? [week, day, domain] : [week, day])) as { url: string; domain: string }[];
  const kinds = decisions();
  return rows.filter((r) => {
    const d = kinds.get(r.domain);
    if (d?.ignore) return false;
    return d?.kind === "studio" ? true : d?.kind === "platform" ? false : !isPlatform(r.domain);
  });
}

/**
 * Read every competitor page due (`duePages`). Hosts are taken one at a
 * time, robots.txt first, two seconds between any two requests to a host and
 * one second between hosts. `domain` reads one site's due pages only (a
 * person pressed "Read its pages" or chose to watch it).
 */
export async function refreshPages(progress: (done: number, of: number, what?: string) => void = () => {}, o: { most?: number; domain?: string } = {}): Promise<string> {
  const rows = duePages(o.domain);
  const list = rows.slice(0, o.most ?? 80);
  if (!list.length) {
    const known = (db.prepare(`SELECT COUNT(*) AS n FROM cc_seo_comp_pages${o.domain ? " WHERE domain = ?" : ""}`).get(...(o.domain ? [o.domain] : [])) as { n: number }).n;
    return known
      ? `Every one of the ${known} competitor page${known === 1 ? "" : "s"}${o.domain ? ` of ${o.domain}` : ""} was read in the last six days (one that failed, in the last day).`
      : "No competitor page is known yet: they come from captured search results, a result-page check, or a site a person chose to watch.";
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
  /** The result's own title and address, where a result page or a person recorded them. */
  title?: string | null;
  url?: string | null;
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
  return db.prepare(`SELECT domain, name, engine, kind, query, lang, cluster, position, day, by, note, title, url FROM cc_seo_sightings ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY day DESC, engine, query, position`).all(...args) as unknown as SightingRow[];
}

export interface CompPageRow {
  url: string;
  domain: string;
  /** A "topic" page (its sitemap's page for one of our clusters) reads as "ranking" here, so the other tabs keep their two kinds; `topic` says which it is. */
  address: "ranking" | "home";
  topic: boolean;
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
    address: r.address === "ranking" || r.address === "topic" ? "ranking" : "home",
    topic: r.address === "topic",
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

/* ---------- a person's decisions: watch, ignore, platform or studio, the same company ------------- */

export interface Decision {
  domain: string;
  /** Watched: on the list without a sighting, its pages read weekly. */
  watch: boolean;
  /** Ignored: hidden from the list and its counts, its pages not read; the observations are kept. */
  ignore: boolean;
  /** A person's word over the platform list; null = the list decides. */
  kind: "platform" | "studio" | null;
  /** Counted as this other key (a name and its site, two spellings). */
  mergedInto: string | null;
  by: string;
  at: string;
}

export function decisions(): Map<string, Decision> {
  const rows = db.prepare("SELECT domain, watch, ignore, kind, merged_into, by, at FROM cc_seo_comp_decisions").all() as { domain: string; watch: number; ignore: number; kind: string | null; merged_into: string | null; by: string; at: string }[];
  return new Map(rows.map((r) => [r.domain, { domain: r.domain, watch: !!r.watch, ignore: !!r.ignore, kind: r.kind === "platform" || r.kind === "studio" ? r.kind : null, mergedInto: r.merged_into, by: r.by, at: r.at }]));
}

/** Change one decision; the fields left out stay as they were. Returns the decision as it now stands. */
export function decide(domain: string, change: Partial<Pick<Decision, "watch" | "ignore" | "kind" | "mergedInto">>, by: string): Decision {
  const had = decisions().get(domain);
  const next: Decision = {
    domain,
    watch: change.watch ?? had?.watch ?? false,
    ignore: change.ignore ?? had?.ignore ?? false,
    kind: change.kind !== undefined ? change.kind : (had?.kind ?? null),
    mergedInto: change.mergedInto !== undefined ? change.mergedInto : (had?.mergedInto ?? null),
    by,
    at: now(),
  };
  /* Watching and ignoring exclude each other: the newer word wins. */
  if (change.watch) next.ignore = false;
  if (change.ignore) next.watch = false;
  db.prepare(
    "INSERT INTO cc_seo_comp_decisions (domain, watch, ignore, kind, merged_into, by, at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(domain) DO UPDATE SET watch = excluded.watch, ignore = excluded.ignore, kind = excluded.kind, merged_into = excluded.merged_into, by = excluded.by, at = excluded.at",
  ).run(domain, next.watch ? 1 : 0, next.ignore ? 1 : 0, next.kind, next.mergedInto, by, next.at);
  return next;
}

/* ---------- a search filed by hand ---------------------------------------------------------------- */

/** Searches a person filed under a cluster (or under none), by the search as stored. */
export function handFiling(): Map<string, { cluster: string | null; by: string; at: string }> {
  const rows = db.prepare("SELECT query, cluster, by, at FROM cc_seo_comp_filing").all() as { query: string; cluster: string | null; by: string; at: string }[];
  return new Map(rows.map((r) => [r.query, { cluster: r.cluster, by: r.by, at: r.at }]));
}

/**
 * File a captured search under a cluster by hand (null: under none). The
 * cluster is written into its observations and its pages too, so Content Gaps
 * and Page Optimization, which read the stored cluster, file it the same way.
 */
export function fileSearch(query: string, cluster: string | null, by: string): { sightings: number; pages: number } {
  db.prepare("INSERT INTO cc_seo_comp_filing (query, cluster, by, at) VALUES (?, ?, ?, ?) ON CONFLICT(query) DO UPDATE SET cluster = excluded.cluster, by = excluded.by, at = excluded.at").run(query, cluster, by, now());
  const s = db.prepare("UPDATE cc_seo_sightings SET cluster = ? WHERE query = ?").run(cluster, query).changes;
  const p = db.prepare("UPDATE cc_seo_comp_pages SET cluster = ? WHERE query = ?").run(cluster, query).changes;
  return { sightings: Number(s), pages: Number(p) };
}

/* ---------- a Google result recorded by hand -------------------------------------------------------- */

export interface HandResult {
  phrase: string;
  lang: string | null;
  cluster: string | null;
  /** YYYY-MM-DD: the day the person looked. */
  day: string;
  organic: { position: number; domain: string; url: string | null }[];
  mapPack: { position: number; name: string }[];
  /** Balkaris's own organic place on that page; null when it was not in what was recorded. */
  ours: number | null;
  by: string;
}

/**
 * A Google result page a person looked at in their own browser, kept as
 * observations under their name. Recording the same search and day again
 * replaces that person's record for the day (a correction is not ignored as
 * a duplicate); the audit's and the checks' observations are never touched.
 */
export function recordByHand(r: HandResult): { kept: number; line: string } {
  const by = r.by.slice(0, 80) || "a person";
  db.prepare("DELETE FROM cc_seo_sightings WHERE query = ? AND day = ? AND by = ? AND engine IN ('google', 'google-local')").run(r.phrase, r.day, by);
  let kept = 0;
  const why = "Recorded by hand from a Google result page seen in a browser";
  for (const o of r.organic) {
    if (addSighting({ domain: o.domain, name: null, engine: "google", kind: "organic", query: r.phrase, lang: r.lang, cluster: r.cluster, position: o.position, day: r.day, by, note: why })) kept++;
    if (o.url) db.prepare("UPDATE cc_seo_sightings SET url = ? WHERE domain = ? AND engine = 'google' AND kind = 'organic' AND query = ? AND day = ? AND by = ?").run(o.url.slice(0, 500), o.domain, r.phrase, r.day, by);
    if (o.url && readable(o.domain)) addCompetitorPage({ url: o.url, domain: o.domain, address: "ranking", cluster: r.cluster, query: r.phrase });
  }
  for (const m of r.mapPack) {
    const domain = domainKey(null, m.name);
    if (domain && addSighting({ domain, name: m.name, engine: "google-local", kind: "local-pack", query: r.phrase, lang: r.lang, cluster: r.cluster, position: m.position, day: r.day, by, note: why })) kept++;
  }
  if (r.ours !== null) addSighting({ domain: "balkaris.ch", name: "Balkaris", engine: "google", kind: "organic", query: r.phrase, lang: r.lang, cluster: r.cluster, position: r.ours, day: r.day, by, note: why });
  const line = `Kept ${kept} result${kept === 1 ? "" : "s"} for “${r.phrase}” on ${r.day}${r.ours !== null ? `, Balkaris at ${r.ours}` : ", Balkaris not among them"}.`;
  note("seo-competitors", `Google result recorded by hand: “${r.phrase}”`, { tone: "info", detail: line, href: `/seo/competitors?search=${encodeURIComponent(r.phrase)}`, actor: by, dedupe: `seo:comp:hand:${r.phrase}:${r.day}:${by}` });
  return { kept, line };
}

/* ---------- a site a person chose to watch ------------------------------------------------------------ */

/**
 * Put a site on the list as a person's choice, without a sighting: it is a
 * competitor because somebody said so, and the list says who. Its home page
 * joins the weekly read. Returns whether the home page was new to the list.
 */
export function watchSite(domain: string, name: string | null, by: string, home: string): { added: boolean; decision: Decision } {
  upsertCompetitor(domain, name);
  const decision = decide(domain, { watch: true, ignore: false }, by);
  const added = addCompetitorPage({ url: home, domain, address: "home", cluster: null, query: null });
  note("seo-competitors", `${by} watches ${domain} as a competitor`, { tone: "info", detail: "Added by a person, not seen in a result yet. Its home page is read now and every week.", href: `/seo/competitors?open=${encodeURIComponent(domain)}`, actor: by, dedupe: `seo:comp:watch:${domain}:${now().slice(0, 10)}` });
  return { added, decision };
}
