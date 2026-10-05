import { HTTPException } from "hono/http-exception";
import type { CommonCrawlFact, CruxFact, DomainFact, DomainFacts, HomeFact, PageSpeedFact, RegistrationFact, RobotsFact, SitemapFact, TrancoFact, WaybackFact, WikipediaFact } from "../../../../web/src/contract/seo/common.ts";
import { db } from "../../../db.ts";
import { ask } from "../../search/shared.ts";
import { UA } from "../../site/http.ts";
import { allowed, parseRobots, type Robots } from "../../site/sitemap.ts";
import { cached, off, ok, waiting } from "../../store.ts";
import { decode, readHtml } from "../html.ts";
import { checkAddress, resolvesPublic, siteWire, type Got } from "./guard.ts";
import { allowance, bare, clock, envInt, pace, said, spend, type Allowance } from "./shared.ts";

/**
 * LOOK UP ANY DOMAIN: what the open web says about a site a person types,
 * each fact a Reading with who said it and when, kept seven days in
 * cc_seo_domain_facts so a second look costs nothing.
 *
 *   registration  RDAP: rdap.nic.ch for .ch and .li (SWITCH), rdap.org for
 *                 the rest (it hands over to the registry's own server)
 *   robots        the site's robots.txt: its sitemaps, its rules, whether it
 *                 lets the desk in
 *   sitemap       its sitemap(s): how many pages, by section, the newest
 *                 lastmod, the languages its addresses and alternates name
 *   home          its home page, read with the desk's own polite reader
 *                 (html.ts): title, description, language, hreflang,
 *                 structured-data types, what it says it is built with, words,
 *                 whether it states a price
 *   tranco        its place in the Tranco list (a research ranking of the
 *                 world's most visited domains)
 *   wayback       the first day the Internet Archive kept a page of it
 *   commoncrawl   how many of its pages Common Crawl's newest crawl captured,
 *                 and in which languages
 *   wikipedia     articles in de, fr, it and en Wikipedia that link to it
 *   crux, pagespeed  with GOOGLE_API_KEY on the box: Chrome's field data for
 *                 its origin on phones, and one PageSpeed run of its home page
 *
 * THE SITE ITSELF IS READ BY guard.ts: public names only (no IP, no
 * localhost, no private range after DNS, checked again at connect time and on
 * every redirect), http and https on 80 and 443, robots.txt asked first and
 * obeyed for the home page and the sitemaps, one request every two seconds to
 * a host, 2 MB and twenty seconds at most a page. A fact that could not be
 * had says why ("the site refused (403)", "not in Tranco: too small or too
 * new"): never a zero.
 *
 * People's lookups have an allowance of sixty a Zurich day
 * (SEO_DOMAIN_DAILY); a lookup answered wholly from what was kept costs none.
 */

const KEEP_MS = 7 * 86_400_000;
/** A fact that failed for a passing reason (no answer, a 5xx) is asked again after an hour rather than a week. */
const RETRY_MS = 3600_000;
const COUNT_KEY = "seo:web:domain:day";
export const domainCap = (): number => envInt("SEO_DOMAIN_DAILY", 60, 1, 1000);
export const domainAllowance = (): Allowance => allowance(COUNT_KEY, domainCap());

export const FACT_KEYS = ["registration", "robots", "sitemap", "home", "tranco", "wayback", "commoncrawl", "wikipedia", "crux", "pagespeed"] as const;
export type FactKey = (typeof FACT_KEYS)[number];

const FROM: Record<FactKey, string> = {
  registration: "RDAP",
  robots: "The site's robots.txt",
  sitemap: "The site's sitemap",
  home: "The site's home page",
  tranco: "Tranco list",
  wayback: "Internet Archive (Wayback Machine)",
  commoncrawl: "Common Crawl index",
  wikipedia: "Wikipedia",
  crux: "Chrome UX Report",
  pagespeed: "PageSpeed Insights",
};

/** Requests to the public services. The check script replaces it. */
export const apiWire = {
  get: async (url: string, o: { timeoutMs?: number; accept?: string } = {}): Promise<{ status: number; text: string }> => {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: o.accept ?? "application/json,*/*;q=0.5" }, redirect: "follow", signal: AbortSignal.timeout(o.timeoutMs ?? 30_000) });
      return { status: res.status, text: (await res.text()).slice(0, 2_000_000) };
    } catch (e) {
      return { status: 0, text: said(e) };
    }
  },
  /** The Google APIs, through the desk's own client (search/shared.ts `ask`): the key travels in the address and is never logged. */
  google: (url: string, body?: unknown): Promise<{ status: number; json: unknown }> => ask("Google", url, body === undefined ? { timeout: 120_000 } : { method: "POST", body, timeout: 30_000 }),
};

/* ---------- the domain a person typed --------------------------------------------------------- */

/** Two-part public suffixes common enough here that "shop.example.co.uk" must not become "co.uk". */
const TWO_PART = new Set(["co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.at", "or.at", "com.br", "co.jp", "com.cn", "com.tr", "co.za", "com.mx"]);

/** The registered domain of a host: "shop.example.ch" is "example.ch". */
export function registrable(host: string): string {
  const parts = bare(host).split(".");
  const n = TWO_PART.has(parts.slice(-2).join(".")) ? 3 : 2;
  return parts.slice(-n).join(".");
}

/** A typed domain or address as the domain the facts are kept under, or the reason it is not read. Pure. */
export function domainOf(input: string): { ok: true; domain: string; host: string } | { ok: false; why: string } {
  const v = checkAddress(input);
  if (!v.ok) return v;
  return { ok: true, domain: bare(v.host), host: v.host };
}

/* ---------- kept facts --------------------------------------------------------------------------- */

type Fact<T> = DomainFact<T>;

function kept(domain: string): Map<string, { fact: Fact<unknown>; at: string }> {
  const out = new Map<string, { fact: Fact<unknown>; at: string }>();
  for (const r of db.prepare("SELECT fact, reading, at FROM cc_seo_domain_facts WHERE domain = ?").all(domain) as { fact: string; reading: string; at: string }[]) {
    try {
      out.set(r.fact, { fact: JSON.parse(r.reading) as Fact<unknown>, at: r.at });
    } catch {
      /* unreadable: asked again */
    }
  }
  return out;
}

const fresh = (k: { fact: Fact<unknown>; at: string } | undefined): boolean => {
  if (!k) return false;
  const age = clock.now() - Date.parse(k.at);
  return age < (k.fact.state === "waiting" ? RETRY_MS : KEEP_MS);
};

function keep(domain: string, key: FactKey, fact: Fact<unknown>, by: string): void {
  db.prepare("INSERT INTO cc_seo_domain_facts (domain, fact, reading, at, asked_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT(domain, fact) DO UPDATE SET reading = excluded.reading, at = excluded.at, asked_by = excluded.asked_by").run(
    domain,
    key,
    JSON.stringify(fact),
    new Date(clock.now()).toISOString(),
    by,
  );
}

const at = (): string => new Date(clock.now()).toISOString();
const got = <T>(key: FactKey, value: T, note?: string, from = FROM[key]): Fact<T> => ({ ...ok(value, key === "crux" ? "crux" : key === "pagespeed" ? "psi" : "desk", at(), note), from });
const none = <T>(key: FactKey, reason: string, step?: string, from = FROM[key]): Fact<T> => ({ ...off<T>(key === "crux" ? "crux" : key === "pagespeed" ? "psi" : "desk", reason, step), from });
const later = <T>(key: FactKey, reason: string, from = FROM[key]): Fact<T> => ({ ...waiting<T>(key === "crux" ? "crux" : key === "pagespeed" ? "psi" : "desk", reason), from });

/** A status as a reason a person reads. */
const refusedBy = (who: string, g: { status: number; error?: string | null }): string =>
  g.error
    ? `${who} could not be read: ${g.error}`
    : g.status === 403 || g.status === 401
      ? `${who} refused the desk (${g.status})`
      : g.status === 429
        ? `${who} said the desk asked too often (429)`
        : g.status === 404 || g.status === 410
          ? `${who} has no such page (${g.status})`
          : `${who} answered ${g.status}`;

/* ---------- the site itself: robots, home, sitemap -------------------------------------------- */

const text = (g: Got): string => {
  const charset = /charset=["']?([\w-]+)/i.exec(g.headers["content-type"] ?? "")?.[1]?.toLowerCase() ?? "utf-8";
  try {
    return new TextDecoder(charset === "iso-8859-1" ? "latin1" : charset).decode(g.body);
  } catch {
    return g.body.toString("utf8");
  }
};

const mayRead = (robots: Robots | null, path: string): boolean => !robots || (allowed(robots, path, "BalkarisDesk") && allowed(robots, path, "*"));

/** What a page says it is built with: its generator tag and the asset paths platforms leave. Only what the page states. */
export function builtWith(html: string, headers: Record<string, string> = {}): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<meta[^>]+name=["']generator["'][^>]*content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]*name=["']generator["']/gi)) {
    const g = decode((m[1] ?? m[2] ?? "").trim()).replace(/\s+[\d.]+$/, "");
    if (g) out.add(g.slice(0, 40));
  }
  const marks: [RegExp, string][] = [
    [/\/wp-content\/|\/wp-includes\//, "WordPress"],
    [/\/_next\/static\//, "Next.js"],
    [/\/_nuxt\//, "Nuxt"],
    [/cdn\.shopify\.com|Shopify\.theme/, "Shopify"],
    [/static\.wixstatic\.com|wix\.com/, "Wix"],
    [/squarespace\.com|static1\.squarespace/, "Squarespace"],
    [/website-files\.com|webflow\.(com|io)/, "Webflow"],
    [/framerusercontent\.com|framer\.com\/m\//, "Framer"],
    [/\/typo3conf\/|\/typo3temp\//, "TYPO3"],
    [/\/sites\/default\/files\/|Drupal\.settings/, "Drupal"],
    [/\/media\/jui\/|\/components\/com_/, "Joomla"],
    [/\/assets\/contao\/|\/files\/contao/, "Contao"],
    [/jimdo(cdn)?\.com/, "Jimdo"],
    [/googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/, "Google Tag Manager"],
    [/hs-scripts\.com|hubspot\.com/, "HubSpot"],
  ];
  for (const [re, name] of marks) if (re.test(html)) out.add(name);
  const server = headers["x-powered-by"] ?? "";
  if (/next\.js/i.test(server)) out.add("Next.js");
  if (/php/i.test(server)) out.add("PHP");
  if (headers["x-vercel-id"] || /vercel/i.test(headers.server ?? "")) out.add("Vercel");
  if (/cloudflare/i.test(headers.server ?? "")) out.add("Cloudflare");
  return [...out].slice(0, 12);
}

/** The home page's facts from its HTML. Pure: the check reads a fixture with it. */
export function homeFacts(html: string, url: string, status: number, headers: Record<string, string> = {}): HomeFact {
  const h = readHtml(html);
  const description = /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i.exec(html);
  const hreflang = new Set<string>();
  for (const m of html.matchAll(/<link[^>]+hreflang=["']([^"']+)["'][^>]*>/gi)) hreflang.add(m[1]!.toLowerCase());
  return {
    url,
    status,
    title: h.title,
    description: description ? decode((description[1] ?? description[2] ?? "").trim()).slice(0, 300) || null : null,
    lang: h.lang,
    hreflang: [...hreflang].sort(),
    schemaTypes: h.schemaTypes,
    builtWith: builtWith(html, headers),
    words: h.words,
    price: h.price,
  };
}

/** What a sitemap file holds: addresses with lastmod and alternates, or the child sitemaps of an index. Pure, regex only (a sitemap can be large). */
export function readSitemapXml(xml: string): { urls: { loc: string; lastmod: string | null; langs: string[] }[]; children: string[] } {
  const urls: { loc: string; lastmod: string | null; langs: string[] }[] = [];
  const children: string[] = [];
  if (/<sitemapindex\b/i.test(xml)) {
    for (const m of xml.matchAll(/<sitemap\b[\s\S]*?<loc>\s*([^<]+?)\s*<\/loc>[\s\S]*?<\/sitemap>/gi)) children.push(decode(m[1]!));
    return { urls, children };
  }
  for (const m of xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)) {
    const body = m[1]!;
    const loc = /<loc>\s*([^<]+?)\s*<\/loc>/i.exec(body)?.[1];
    if (!loc) continue;
    const lastmod = /<lastmod>\s*([^<]+?)\s*<\/lastmod>/i.exec(body)?.[1] ?? null;
    const langs = [...body.matchAll(/hreflang=["']([^"']+)["']/gi)].map((x) => x[1]!.toLowerCase());
    urls.push({ loc: decode(loc), lastmod, langs });
  }
  return { urls, children };
}

const LANG_PATH = /^\/(de|fr|it|en|rm)(?:[-_][a-z]{2})?(?:\/|$)/i;

/** The sitemap's facts from the addresses read. */
export function sitemapFacts(read: string[], urls: { loc: string; lastmod: string | null; langs: string[] }[], capped: boolean): SitemapFact {
  const sections = new Map<string, number>();
  const langs = new Set<string>();
  let newest: string | null = null;
  for (const u of urls) {
    let path = "/";
    try {
      path = new URL(u.loc).pathname;
    } catch {
      /* counted under "/" */
    }
    const lp = LANG_PATH.exec(path);
    if (lp) langs.add(lp[1]!.toLowerCase());
    const rest = lp ? path.slice(lp[0].length - (lp[0].endsWith("/") ? 1 : 0)) : path;
    const first = rest.split("/").filter(Boolean)[0];
    const section = first ? `/${first}` : "/";
    sections.set(section, (sections.get(section) ?? 0) + 1);
    for (const l of u.langs) if (l !== "x-default") langs.add(l.split("-")[0]!);
    const day = u.lastmod?.slice(0, 10) ?? null;
    if (day && /^\d{4}-\d{2}-\d{2}$/.test(day) && (!newest || day > newest)) newest = day;
  }
  return {
    read,
    pages: urls.length,
    capped,
    sections: [...sections.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([section, pages]) => ({ section, pages })),
    newest,
    languages: [...langs].sort(),
  };
}

const MAX_SITEMAPS = 12;
const MAX_URLS = 50_000;

/** robots.txt, the home page and the sitemaps, in that order, from the host the person typed (or its www. twin when the bare one does not answer). */
async function readSite(host: string): Promise<{ robots: Fact<RobotsFact>; home: Fact<HomeFact>; sitemap: Fact<SitemapFact>; homeUrl: string }> {
  const candidates = host.startsWith("www.") ? [host, host.slice(4)] : [host, `www.${host}`];
  let base = `https://${candidates[0]}`;
  let robotsGot: Got | null = null;
  for (const c of candidates) {
    const g = await siteWire.get(`https://${c}/robots.txt`, { accept: "text/plain,*/*;q=0.5", maxBytes: 500_000, timeoutMs: 15_000 });
    robotsGot = g;
    base = `https://${c}`;
    if (!g.error) break;
  }
  /* robots.txt */
  let robots: Robots | null = null;
  let robotsFact: Fact<RobotsFact>;
  const rg = robotsGot!;
  if (rg.error) robotsFact = later("robots", refusedBy("The site", rg));
  else if (rg.status === 200 && !/<html/i.test(text(rg).slice(0, 500))) {
    robots = parseRobots(text(rg));
    const all = robots.groups.get("*") ?? [];
    robotsFact = got("robots", { status: 200, sitemaps: robots.sitemaps.slice(0, 20), rules: all.length, closed: all.some((r) => !r.allow && r.pattern === "/"), deskAllowed: mayRead(robots, "/") });
  } else if (rg.status === 404 || rg.status === 410 || (rg.status === 200 && /<html/i.test(text(rg).slice(0, 500)))) {
    robotsFact = got("robots", { status: rg.status, sitemaps: [], rules: 0, closed: false, deskAllowed: true }, "The site has no robots.txt: crawlers may read everything.");
  } else robotsFact = none("robots", refusedBy("The site", rg));

  /* the home page */
  let homeFact: Fact<HomeFact>;
  let homeUrl = `${base}/`;
  if (!mayRead(robots, "/")) homeFact = none("home", "The site's robots.txt does not let the desk read its home page, so it was not read.");
  else {
    const g = await siteWire.get(`${base}/`);
    homeUrl = g.url;
    const type = g.headers["content-type"] ?? "";
    if (g.error) homeFact = later("home", refusedBy("The site", g));
    else if (g.status !== 200) homeFact = none("home", refusedBy("The site", g));
    else if (type && !/html/i.test(type)) homeFact = none("home", `The home page is not a web page (${type.split(";")[0]}).`);
    else homeFact = got("home", homeFacts(text(g), g.url, g.status, g.headers), g.cut ? "Read as a crawler gets it (no JavaScript run); the page was larger than 2 MB and was read in part." : "Read as a crawler gets it: no JavaScript is run, so a page built in the browser shows less here.");
  }

  /* the sitemaps: the ones robots.txt names, else /sitemap.xml */
  let sitemapFact: Fact<SitemapFact>;
  const queue = robots?.sitemaps.length ? [...robots.sitemaps] : [`${base}/sitemap.xml`];
  const read: string[] = [];
  const urls: { loc: string; lastmod: string | null; langs: string[] }[] = [];
  let capped = false;
  let firstRefusal: string | null = null;
  while (queue.length && read.length < MAX_SITEMAPS) {
    const address = queue.shift()!;
    let path = "/";
    try {
      path = new URL(address).pathname;
    } catch {
      continue;
    }
    if (!mayRead(robots, path)) {
      firstRefusal ??= "the site's robots.txt does not let the desk read its sitemap";
      continue;
    }
    const g = await siteWire.get(address, { accept: "application/xml,text/xml;q=0.9,*/*;q=0.5", maxBytes: 10_000_000, timeoutMs: 30_000 });
    if (g.error || g.status !== 200) {
      firstRefusal ??= refusedBy("The sitemap", g);
      continue;
    }
    read.push(g.url);
    const x = readSitemapXml(text(g));
    queue.push(...x.children);
    for (const u of x.urls) {
      if (urls.length >= MAX_URLS) {
        capped = true;
        break;
      }
      urls.push(u);
    }
    if (g.cut) capped = true;
  }
  if (queue.length) capped = true;
  if (read.length) sitemapFact = got("sitemap", sitemapFacts(read, urls, capped), capped ? `At most ${MAX_SITEMAPS} sitemaps and ${MAX_URLS.toLocaleString("en-US")} addresses are counted; the site has more.` : undefined);
  else if (firstRefusal && /refused|could not|answered|asked too often/.test(firstRefusal)) sitemapFact = (firstRefusal.includes("could not") ? later : none)("sitemap", `${firstRefusal}.`);
  else sitemapFact = none("sitemap", firstRefusal ? `${firstRefusal[0]!.toUpperCase()}${firstRefusal.slice(1)}.` : "The site has no sitemap the desk could find (none in robots.txt, none at /sitemap.xml).");
  return { robots: robotsFact, home: homeFact, sitemap: sitemapFact, homeUrl };
}

/* ---------- the public services ------------------------------------------------------------- */

function jsonOf<T>(t: string): T | null {
  try {
    return JSON.parse(t) as T;
  } catch {
    return null;
  }
}

/** RDAP's answer as the registration fact. Pure. */
export function rdapFacts(j: unknown): RegistrationFact {
  const r = (j ?? {}) as {
    events?: { eventAction?: string; eventDate?: string }[];
    entities?: { roles?: string[]; vcardArray?: unknown[]; handle?: string }[];
    status?: string[];
    nameservers?: { ldhName?: string }[];
  };
  const event = (a: string): string | null => r.events?.find((e) => e.eventAction === a)?.eventDate?.slice(0, 10) ?? null;
  const registrar = r.entities?.find((e) => e.roles?.includes("registrar"));
  let name: string | null = null;
  const card = registrar?.vcardArray?.[1];
  /* Registries write the name as "fn", SWITCH as "org" (seen 5 October 2026: ["org", {}, "text", "METANET AG"]). */
  if (Array.isArray(card)) for (const f of card as unknown[][]) if (Array.isArray(f) && (f[0] === "fn" || (f[0] === "org" && !name)) && typeof f[3] === "string" && f[3].trim()) name = f[3].trim();
  return {
    registered: event("registration"),
    expires: event("expiration"),
    registrar: name ?? registrar?.handle ?? null,
    status: (r.status ?? []).slice(0, 8),
    nameservers: (r.nameservers ?? []).map((n) => (n.ldhName ?? "").toLowerCase()).filter(Boolean).slice(0, 8),
  };
}

async function registration(domain: string): Promise<Fact<RegistrationFact>> {
  const reg = registrable(domain);
  const swiss = /\.(ch|li)$/.test(reg);
  const from = swiss ? "RDAP (SWITCH, rdap.nic.ch)" : "RDAP (rdap.org, then the registry)";
  await pace(swiss ? "rdap.nic.ch" : "rdap.org", 1500);
  const g = await apiWire.get(swiss ? `https://rdap.nic.ch/domain/${encodeURIComponent(reg)}` : `https://rdap.org/domain/${encodeURIComponent(reg)}`, { accept: "application/rdap+json,application/json" });
  if (g.status === 200) {
    const j = jsonOf(g.text);
    if (j) return got("registration", rdapFacts(j), swiss ? "SWITCH gives the registration day and the registrar; .ch has no expiry date and no owner in RDAP." : undefined, from);
  }
  if (g.status === 404) return none("registration", `The registry does not know ${reg}.`, undefined, from);
  if (g.status === 0) return later("registration", `RDAP did not answer (${g.text}).`, from);
  return later("registration", `RDAP answered ${g.status}.`, from);
}

/** Tranco's answer as its fact, or null when the domain is not in the list. Pure. */
export function trancoFacts(j: unknown): TrancoFact | null {
  const ranks = ((j as { ranks?: { date?: string; rank?: number }[] } | null)?.ranks ?? []).filter((r) => typeof r.rank === "number" && typeof r.date === "string");
  if (!ranks.length) return null;
  const newest = [...ranks].sort((a, b) => (a.date! < b.date! ? 1 : -1))[0]!;
  return { rank: newest.rank!, date: newest.date!, best: Math.min(...ranks.map((r) => r.rank!)), days: ranks.length };
}

async function tranco(domain: string): Promise<Fact<TrancoFact>> {
  const reg = registrable(domain);
  await pace("tranco-list.eu", 3000);
  const g = await apiWire.get(`https://tranco-list.eu/api/ranks/domain/${encodeURIComponent(reg)}`);
  if (g.status === 200) {
    const f = trancoFacts(jsonOf(g.text));
    return f ? got("tranco", f, "A research ranking of the world's most visited domains (it combines Chrome, Cloudflare, Majestic, Umbrella and Farsight); worldwide, not Switzerland.") : none("tranco", `${reg} is not in the Tranco list: too small or too new to be among the world's most visited domains.`);
  }
  if (g.status === 429) return later("tranco", "Tranco said it was asked too often; it is asked again in an hour.");
  return later("tranco", g.status ? `Tranco answered ${g.status}.` : `Tranco did not answer (${g.text}).`);
}

/** The Wayback CDX answer's first row as its fact, or null when nothing was archived. Pure. */
export function waybackFacts(j: unknown): WaybackFact | null {
  const rows = Array.isArray(j) ? (j as unknown[][]) : [];
  const row = rows.find((r, i) => i > 0 && Array.isArray(r) && /^\d{8}/.test(String(r[0])));
  if (!row) return null;
  const t = String(row[0]);
  return { firstSeen: `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`, address: String(row[1] ?? "") };
}

async function wayback(domain: string): Promise<Fact<WaybackFact>> {
  await pace("web.archive.org", 2000);
  const g = await apiWire.get(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}&output=json&fl=timestamp,original,statuscode&filter=statuscode:200&limit=1`, { timeoutMs: 60_000 });
  if (g.status === 200) {
    const f = waybackFacts(jsonOf(g.text));
    return f ? got("wayback", f, "The first page the Internet Archive kept: the site was public by then (its registration can be older).") : none("wayback", `The Internet Archive has never kept a page of ${domain}.`);
  }
  return later("wayback", g.status ? `The Internet Archive answered ${g.status}.` : `The Internet Archive did not answer (${g.text}).`);
}

/** Common Crawl's index answer (one JSON object per line) as its fact. Pure. */
export function commonCrawlFacts(ndjson: string, crawl: string, limit: number): CommonCrawlFact {
  const lines = ndjson.split("\n").filter((l) => l.trim().startsWith("{"));
  const langs = new Map<string, number>();
  for (const l of lines) {
    const first = (jsonOf<{ languages?: string }>(l)?.languages ?? "").split(",")[0]?.trim();
    if (first) langs.set(first, (langs.get(first) ?? 0) + 1);
  }
  return { crawl, pages: lines.length, capped: lines.length >= limit, languages: [...langs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([code, pages]) => ({ code, pages })) };
}

const CC_LIMIT = 1000;

async function commonCrawl(domain: string): Promise<Fact<CommonCrawlFact>> {
  let newest: { id: string; api: string } | null = null;
  try {
    newest = (
      await cached("seo:web:cc:newest", 24 * 3600_000, async () => {
        await pace("index.commoncrawl.org", 2000);
        const g = await apiWire.get("https://index.commoncrawl.org/collinfo.json");
        const list = jsonOf<{ id?: string; "cdx-api"?: string }[]>(g.text);
        const first = Array.isArray(list) ? list[0] : null;
        if (g.status !== 200 || !first?.id || !first["cdx-api"]) throw new Error(g.status ? `answered ${g.status}` : g.text);
        return { id: first.id, api: first["cdx-api"] };
      })
    ).value;
  } catch (e) {
    return later("commoncrawl", `Common Crawl's list of crawls could not be read (${said(e)}).`);
  }
  await pace("index.commoncrawl.org", 2000);
  const g = await apiWire.get(`${newest.api}?url=${encodeURIComponent(domain)}&matchType=domain&output=json&fl=url,languages&filter=status:200&limit=${CC_LIMIT}`, { timeoutMs: 60_000 });
  if (g.status === 404) return none("commoncrawl", `Common Crawl's newest crawl (${newest.id}) captured no page of ${domain}: a sample of the web, which a small or new site is often not in.`);
  if (g.status !== 200) return later("commoncrawl", g.status ? `Common Crawl's index answered ${g.status} (it is a shared server and is sometimes busy).` : `Common Crawl's index did not answer (${g.text}).`);
  return got("commoncrawl", commonCrawlFacts(g.text, newest.id, CC_LIMIT), `Pages its crawl ${newest.id} captured with status 200 (a sample of the web, not every page); languages as Common Crawl detected them.`);
}

/** One wiki's exturlusage answer as links. Pure. */
export function wikipediaLinks(j: unknown, wiki: string): { wiki: string; title: string; url: string }[] {
  const list = ((j as { query?: { exturlusage?: { title?: string; url?: string }[] } } | null)?.query?.exturlusage ?? []) as { title?: string; url?: string }[];
  const seen = new Set<string>();
  return list.flatMap((x) => {
    if (!x.title || seen.has(x.title)) return [];
    seen.add(x.title);
    return [{ wiki, title: x.title, url: String(x.url ?? "") }];
  });
}

async function wikipedia(domain: string): Promise<Fact<WikipediaFact>> {
  const links: { wiki: string; title: string; url: string }[] = [];
  let capped = false;
  const failed: string[] = [];
  for (const wiki of ["de", "fr", "it", "en"]) {
    await pace(`${wiki}.wikipedia.org`, 1000);
    const g = await apiWire.get(`https://${wiki}.wikipedia.org/w/api.php?action=query&list=exturlusage&euquery=${encodeURIComponent(domain)}&eunamespace=0&eulimit=50&format=json`);
    if (g.status !== 200) {
      failed.push(wiki);
      continue;
    }
    const j = jsonOf<{ continue?: unknown }>(g.text);
    if (j?.continue) capped = true;
    links.push(...wikipediaLinks(j, wiki));
  }
  if (failed.length === 4) return later("wikipedia", "Wikipedia did not answer.");
  const note = `Articles in ${["de", "fr", "it", "en"].filter((w) => !failed.includes(w)).join(", ")} Wikipedia that link to the domain${capped ? "; there are more than 50 in one language" : ""}.${failed.length ? ` ${failed.join(", ")} did not answer.` : ""}`;
  return got("wikipedia", { links, capped }, note);
}

const googleKey = (): string => (process.env.GOOGLE_API_KEY ?? "").trim();
const KEY_STEP = "Put a Google API key with the Chrome UX Report and PageSpeed Insights APIs on the box (Settings, Chrome UX Report, has the steps).";

async function crux(origin: string): Promise<Fact<CruxFact>> {
  if (!googleKey()) return none("crux", "The desk has no Google API key on this machine, so Chrome's field data was not asked.", KEY_STEP);
  try {
    const r = await apiWire.google(`https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(googleKey())}`, {
      origin,
      formFactor: "PHONE",
      metrics: ["largest_contentful_paint", "interaction_to_next_paint", "cumulative_layout_shift"],
    });
    if (r.status === 404) return none("crux", "Google has no field data for this site on phones: too few Chrome visits to be in the report (a size signal in itself).");
    if (r.status !== 200) return later("crux", `The Chrome UX Report answered ${r.status}.`);
    const rec = (r.json as { record?: { metrics?: Record<string, { percentiles?: { p75?: number | string } }>; collectionPeriod?: { firstDate?: { year: number; month: number; day: number }; lastDate?: { year: number; month: number; day: number } } } })?.record;
    const p = (k: string): number | null => {
      const v = Number(rec?.metrics?.[k]?.percentiles?.p75);
      return Number.isFinite(v) ? v : null;
    };
    const d = (x?: { year: number; month: number; day: number }) => (x ? `${x.year}-${String(x.month).padStart(2, "0")}-${String(x.day).padStart(2, "0")}` : null);
    return got("crux", { origin, formFactor: "PHONE", lcpMs: p("largest_contentful_paint"), inpMs: p("interaction_to_next_paint"), cls: p("cumulative_layout_shift"), from: d(rec?.collectionPeriod?.firstDate), to: d(rec?.collectionPeriod?.lastDate) }, "Real Chrome visits on phones over 28 days, at the 75th percentile.");
  } catch (e) {
    return later("crux", `The Chrome UX Report did not answer (${said(e)}).`);
  }
}

async function pagespeed(url: string): Promise<Fact<PageSpeedFact>> {
  if (!googleKey()) return none("pagespeed", "The desk has no Google API key on this machine, so PageSpeed was not asked (keyless runs share a quota that is usually used up).", KEY_STEP);
  try {
    const q = new URLSearchParams({ url, strategy: "MOBILE", key: googleKey() });
    q.append("category", "PERFORMANCE");
    q.append("category", "SEO");
    const r = await apiWire.google(`https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`);
    if (r.status !== 200) return later("pagespeed", r.status === 429 ? "PageSpeed said it was asked too often (429)." : `PageSpeed answered ${r.status}.`);
    const lh = (r.json as { lighthouseResult?: { categories?: Record<string, { score?: number | null }>; audits?: Record<string, { numericValue?: number }> } })?.lighthouseResult;
    const score = (k: string): number | null => (typeof lh?.categories?.[k]?.score === "number" ? Math.round(lh.categories[k].score! * 100) : null);
    const audit = (k: string): number | null => (typeof lh?.audits?.[k]?.numericValue === "number" ? Math.round(lh.audits[k].numericValue! * 1000) / 1000 : null);
    return got("pagespeed", { url, strategy: "mobile", performance: score("performance"), seo: score("seo"), lcpMs: audit("largest-contentful-paint"), cls: audit("cumulative-layout-shift"), tbtMs: audit("total-blocking-time") }, "One lab run of the home page on a simulated phone, on Google's machine: a measurement of the page, not of visitors.");
  } catch (e) {
    return later("pagespeed", `PageSpeed did not answer (${said(e)}).`);
  }
}

/* ---------- the lookup --------------------------------------------------------------------------- */

export interface LookupOptions {
  /** Ask again even what was kept in the last seven days. */
  fresh?: boolean;
  /** Only these facts (the rest come from what is kept, or say they were not asked). */
  only?: readonly FactKey[];
}

/** What is kept about a domain, without asking anything. Null when nothing is. */
export function domainFacts(input: string): DomainFacts | null {
  const d = domainOf(input);
  if (!d.ok) return null;
  const k = kept(d.domain);
  if (!k.size) return null;
  return assemble(d.domain, `https://${d.host}/`, k);
}

function assemble(domain: string, home: string, k: Map<string, { fact: Fact<unknown>; at: string }>): DomainFacts {
  const facts = {} as DomainFacts["facts"];
  let newest = "";
  for (const key of FACT_KEYS) {
    const had = k.get(key);
    (facts as Record<string, Fact<unknown>>)[key] = had ? had.fact : none(key, "Not asked yet.");
    if (had && had.at > newest) newest = had.at;
  }
  const homeUrl = facts.home.state === "ok" ? facts.home.value.url : home;
  const okCount = FACT_KEYS.filter((key) => facts[key].state === "ok").length;
  return { domain, home: homeUrl, asOf: newest || at(), facts, line: `${okCount} of ${FACT_KEYS.length} facts about ${domain} could be had.` };
}

/**
 * Look up any domain a person typed (a host or a whole address). Refuses,
 * with 400 and the reason, an address that is not a public site; with 429
 * when today's lookups are used and nothing is kept. Each fact is kept seven
 * days (one that failed for a passing reason, an hour).
 */
export async function lookupDomain(input: string, by: string, o: LookupOptions = {}): Promise<DomainFacts> {
  const d = domainOf(input);
  if (!d.ok) throw new HTTPException(400, { message: `The desk does not read that: ${d.why}.` });
  const k = kept(d.domain);
  const want = (o.only ?? FACT_KEYS).filter((key) => o.fresh || !fresh(k.get(key)));
  if (!want.length) return assemble(d.domain, `https://${d.host}/`, k);

  const pub = await resolvesPublic(d.host);
  if (!pub.ok) {
    /* A name with a www. twin that resolves is still the same site: try the twin before refusing. */
    const twin = d.host.startsWith("www.") ? d.host.slice(4) : `www.${d.host}`;
    const other = await resolvesPublic(twin);
    if (!other.ok) throw new HTTPException(400, { message: `The desk does not read that: ${pub.why}.` });
  }
  if (!spend(COUNT_KEY, domainCap())) {
    if (k.size) return { ...assemble(d.domain, `https://${d.host}/`, k), line: `Today's ${domainCap()} domain lookups are used; this is what was kept from earlier lookups.` };
    throw new HTTPException(429, { message: `Today's ${domainCap()} domain lookups are used. They start again at midnight.` });
  }
  const by_ = (by || "desk").slice(0, 80);
  const tasks: Promise<void>[] = [];
  const put = <T>(key: FactKey, fact: Fact<T>): void => {
    keep(d.domain, key, fact, by_);
    k.set(key, { fact: fact as Fact<unknown>, at: at() });
  };
  const wants = (key: FactKey): boolean => want.includes(key);
  let homeUrl = `https://${d.host}/`;
  if (wants("robots") || wants("home") || wants("sitemap") || wants("pagespeed") || wants("crux")) {
    tasks.push(
      (async () => {
        const site = wants("robots") || wants("home") || wants("sitemap") ? await readSite(d.host) : null;
        if (site) {
          homeUrl = site.homeUrl;
          if (wants("robots")) put("robots", site.robots);
          if (wants("home")) put("home", site.home);
          if (wants("sitemap")) put("sitemap", site.sitemap);
        }
        const origin = new URL(homeUrl).origin;
        const [c, p] = await Promise.all([wants("crux") ? crux(origin) : null, wants("pagespeed") ? pagespeed(homeUrl) : null]);
        if (c) put("crux", c);
        if (p) put("pagespeed", p);
      })(),
    );
  }
  const run = <T>(key: FactKey, f: () => Promise<Fact<T>>): void => {
    if (!wants(key)) return;
    tasks.push(
      f()
        .then((fact) => put(key, fact))
        .catch((e) => put(key, later(key, `It could not be read (${said(e)}).`))),
    );
  };
  run("registration", () => registration(d.domain));
  run("tranco", () => tranco(d.domain));
  run("wayback", () => wayback(d.domain));
  run("commoncrawl", () => commonCrawl(d.domain));
  run("wikipedia", () => wikipedia(d.domain));
  await Promise.all(tasks);
  return assemble(d.domain, homeUrl, k);
}

/** For the check script: forget one domain's kept facts. */
export function forgetDomain(domain: string): void {
  db.prepare("DELETE FROM cc_seo_domain_facts WHERE domain = ?").run(bare(domain));
}

