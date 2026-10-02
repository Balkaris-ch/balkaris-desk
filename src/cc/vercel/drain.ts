import { createHmac, timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { db } from "../../db.ts";
import type { Vars } from "../access.ts";
import { registerCheck, registerSource } from "../sources.ts";
import { record, setState, state, today } from "../store.ts";
import type { DrainKind } from "../../../web/src/contract/hosting.ts";

/**
 * Vercel's own record of every request, turned into page views.
 *
 *   POST /drain/vercel    Vercel's log drain delivers here (public, like the
 *                         runner's and Telegram's doors: src/server.ts lets
 *                         exactly this address past sign-in, and
 *                         deploy/Caddyfile.desk routes exactly it to the desk
 *                         server). Proven by its signature only.
 *   GET  /drain/vercel    says whether the door is ready; nothing else.
 *
 * WHY A DRAIN. The site's pages are served from Vercel's cache: a page view
 * never runs a function, so no function log and no API sees it. A Log Drain
 * delivers the CDN's own record of each request, cached ones included, with
 * no script in the visitor's browser. The site's privacy promise ("nothing
 * measures you before you agree") stays true: these are the server's own
 * request records, which the privacy policy already discloses.
 *
 * NOTHING PERSONAL IS KEPT. Each record is decided by the rules below the
 * moment it arrives, and only counts per day survive: page views, per
 * address, per referring site (host only), per edge region, per device class
 * (mobile, tablet, desktop, other), robots per family, 404s per address. The
 * IP address, the user agent and the full referrer are read, used for that
 * decision, and dropped with the request. Record ids are kept 48 hours to
 * refuse a second delivery of the same record; they identify a log line, not
 * a person.
 *
 * NO VISITOR COUNT. A record tells visitors apart only by IP address and
 * browser fingerprint (user agent, JA3/JA4). Counting distinct visitors would
 * mean processing exactly those per person, so the desk does not: it shows
 * page views and says why there is no visitor figure.
 *
 * THE RULES ARE IN ONE PLACE: `RULES` (what each says and why, in the order
 * they are applied) and `classify` (which applies them). The screen prints
 * RULES with how many records each decided, so every count is accounted for.
 */

/* ---------- configuration ----------------------------------------------------- */

const secret = (): string => (process.env.VERCEL_DRAIN_SECRET ?? "").trim();
/** An ownership code Vercel may ask the endpoint to echo (x-vercel-verify). Optional: see the door. */
const verifyCode = (): string => (process.env.VERCEL_DRAIN_VERIFY ?? "").trim();

/** The hosts whose requests are the website's visitors. preview.balkaris.ch is the same deployment, and not the website's address. */
const SITE_HOSTS = new Set(["www.balkaris.ch", "balkaris.ch"]);
/** A referrer from one of these is the site itself: a click inside it. */
const OWN_HOSTS = new Set(["www.balkaris.ch", "balkaris.ch", "preview.balkaris.ch"]);

/** Vercel batches up to 5 MB; a little room above that, and nothing larger is read. */
export const MAX_BODY = 6 * 1024 * 1024;
/**
 * What a gzip delivery may unpack to: a bomb stops here. Only a delivery whose
 * signature already matched is ever unpacked (see the door), and
 * deploy/vercel-connect.mjs asks Vercel for no compression at all.
 */
export const MAX_UNPACKED = 12 * 1024 * 1024;
/**
 * The header deploy/vercel-connect.mjs puts on Vercel's test delivery
 * (POST /v1/drains/test, `delivery.headers`) and never on the drain itself.
 * That batch is Vercel's sample, not the website's: it is answered and never
 * counted, so a drain that was then not created cannot look delivered.
 */
export const TEST_HEADER = "x-desk-drain-test";
/** Distinct addresses, referrers or bots kept per day and list; the rest are summed as "(other)". Scanners try thousands of addresses. */
const MAX_KEYS = 300;
/** How long a record id is remembered to refuse it a second time. */
const SEEN_MS = 48 * 3_600_000;
/** Without a signed delivery for this long, the top bar's check turns red. The desk's own probes alone cause a record every two minutes. */
export const QUIET_MS = 2 * 3_600_000;
/** Without one for this long, the source is failing in Settings. */
const SILENT_MS = 24 * 3_600_000;

/* ---------- tables ----------------------------------------------------------------- */

db.exec(`
  CREATE TABLE IF NOT EXISTS cc_drain_days (
    /* The studio's day (Zurich), of the record's own time. */
    day  TEXT NOT NULL,
    /* kind | path | ref | device | region | bot | 404 | delivery */
    dim  TEXT NOT NULL,
    key  TEXT NOT NULL,
    n    INTEGER NOT NULL,
    PRIMARY KEY (day, dim, key)
  );

  CREATE TABLE IF NOT EXISTS cc_drain_seen (
    /* "r:<record id>" or "q:<request id>". A log line's id, never a person's. */
    id  TEXT PRIMARY KEY,
    at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cc_drain_seen_at ON cc_drain_seen (at);
`);

/* ---------- the rules ------------------------------------------------------------------ */

/**
 * The rules, in the order they are applied. A record stops at the first rule
 * that decides it, so each record lands in exactly one kind. "view" and
 * "navigation" are the page views.
 */
export const RULES: { kind: DrainKind; rule: string; why: string }[] = [
  {
    kind: "duplicate",
    rule: "A record whose id was already received, or another record of a request already counted (the same requestId), counts once.",
    why: "Vercel documents no delivery guarantee and may send a request's own log lines beside it: nothing may be counted twice.",
  },
  {
    kind: "noRequest",
    rule: "A record with no request in it (no proxy part: build output, a function's own log line) is not a request.",
    why: "Only a request can be a page view.",
  },
  {
    kind: "otherHost",
    rule: "Only requests to www.balkaris.ch and balkaris.ch count.",
    why: "preview.balkaris.ch is the same deployment under the team's own address, and *.vercel.app addresses are Vercel's: neither is a visit to the website.",
  },
  {
    kind: "method",
    rule: "Only GET requests count.",
    why: "HEAD, POST and the rest fetch no page: they are forms, checks and the site's AI answers.",
  },
  {
    kind: "prefetch",
    rule: "A router prefetch is set aside: its matched path is <page>.segments/…segment.rsc or <page>.prefetch.rsc.",
    why: "Next.js fetches the links in view ahead of a click, about ninety a page; counting them would count pages nobody opened. This rule and the next two need Vercel's records to carry the router's markers; whether they do is checked every day (routerMarkers below).",
  },
  {
    kind: "navigation",
    rule: "An App Router navigation is a page view: its matched path is <page>.rsc (not a segment prefetch), a GET answered 200 or 304 from a user agent that is not a robot.",
    why: "A click inside the site that reaches Vercel. A click to a page already prefetched is served from the browser and never reaches Vercel, so clicks inside a visit are undercounted; arrivals, reloads and new tabs are all counted.",
  },
  {
    kind: "rsc",
    rule: "Any other router request (?_rsc= in the address) is set aside.",
    why: "Without its matched path a record cannot tell a navigation from a prefetch. Set aside, it can only undercount, never inflate.",
  },
  {
    kind: "file",
    rule: "Files are set aside: /_next/, /_vercel/, /.well-known/, anything whose last part has an extension (pictures, video, fonts, .xml, .txt, .ico, .json …), the favicon, the feed and the icon and share-image routes.",
    why: "A page brings thirty or more files with it. They are its parts, not views.",
  },
  {
    kind: "api",
    rule: "The site's /api routes are set aside.",
    why: "They are the enquiry form, the booking calendar and the AI's answers, not pages.",
  },
  {
    kind: "bot",
    rule: "A page request whose user agent names a robot, or that has none, is a bot hit, counted apart by family: search engines, AI crawlers, link previews, SEO tools, monitors, scripts and the desk's own checks.",
    why: "Robots read pages nobody looks at. The list is BOTS in src/cc/vercel/drain.ts, a comment per family.",
  },
  {
    kind: "view",
    rule: "A page request (a document) answered 200 or 304 is a page view.",
    why: "200 is the page itself; 304 is the browser re-using its copy after asking, which is still a page somebody opened.",
  },
  {
    kind: "notFound",
    rule: "A person's page request answered 404 is counted apart, by address.",
    why: "Old addresses and mistyped links: visitors who found nothing.",
  },
  {
    kind: "redirect",
    rule: "Answered 3xx other than 304: the visitor was sent on, and the request that follows is the one counted.",
    why: "balkaris.ch sends every visitor to www.balkaris.ch; counting both would count each arrival twice.",
  },
  {
    kind: "serverError",
    rule: "Answered 5xx: counted apart.",
    why: "A page that failed is not a page seen.",
  },
  {
    kind: "otherStatus",
    rule: "Any other answer (401, 410, 429, a revalidation in the background, no status) is counted apart.",
    why: "None of them is a page somebody saw.",
  },
];

export const VIEW_KINDS: readonly DrainKind[] = ["view", "navigation"];

/**
 * Robots by user agent, in order: the first pattern that matches names the
 * family. The desk's own checks come first: they ask for the home page every
 * two minutes and are the steadiest source of records.
 */
const BOTS: [RegExp, string][] = [
  /* The desk itself: site/http.ts sends "BalkarisDesk/1.0". */
  [/BalkarisDesk/i, "The desk's own checks"],
  /* Vercel's screenshot and favicon fetchers for its dashboard. */
  [/vercel-(screenshot|favicon|og)|vercelbot/i, "Vercel"],
  /* Google's crawlers, its ads and inspection tools; Lighthouse is apart below. */
  [/Googlebot|Google-InspectionTool|GoogleOther|Storebot-Google|AdsBot-Google|Mediapartners-Google|APIs-Google|Google-Extended|FeedFetcher-Google|Google-Read-Aloud|Google-Site-Verification|Google-PageRenderer/i, "Google"],
  /* PageSpeed, Lighthouse and WebPageTest: lab speed tests, the desk's own included. */
  [/Chrome-Lighthouse|Lighthouse|PageSpeed|PTST|GTmetrix|WebPageTest/i, "Speed tests"],
  [/bingbot|BingPreview|msnbot|adidxbot/i, "Bing"],
  /* AI assistants and their crawlers. */
  [/GPTBot|ChatGPT-User|OAI-SearchBot/i, "OpenAI"],
  [/ClaudeBot|Claude-Web|Claude-User|Claude-SearchBot|anthropic-ai/i, "Anthropic"],
  [/PerplexityBot|Perplexity-User/i, "Perplexity"],
  [/Applebot/i, "Apple"],
  /* Link previews: a link pasted in a chat or a post is fetched once by the platform. */
  [/meta-externalagent|meta-externalfetcher|facebookexternalhit|facebookcatalog|Facebot/i, "Meta"],
  [/LinkedInBot/i, "LinkedIn"],
  [/Twitterbot/i, "X"],
  [/Slackbot|Slack-ImgProxy|Discordbot|TelegramBot|WhatsApp|SkypeUriPreview|Iframely|Embedly|redditbot|Pinterest|Mastodon|Bluesky|vkShare|Viber/i, "Link previews"],
  [/YandexBot|YandexImages|Baiduspider|DuckDuckBot|SeznamBot|PetalBot|Sogou|Qwantify|Exabot|MojeekBot|Yeti\//i, "Other search engines"],
  /* SEO tools crawl for their own indexes. */
  [/AhrefsBot|SemrushBot|MJ12bot|DotBot|DataForSeoBot|BLEXBot|serpstatbot|Screaming Frog|SiteAuditBot|rogerbot|barkrowler|SEOkicks|Seekport/i, "SEO tools"],
  /* Data and AI crawlers that are neither search nor an assistant. */
  [/CCBot|Bytespider|Amazonbot|Diffbot|ImagesiftBot|cohere-ai|YouBot|omgili|Timpibot|AI2Bot|FacebookBot|Kangaroo Bot|PanguBot/i, "AI and data crawlers"],
  [/UptimeRobot|Pingdom|StatusCake|Site24x7|BetterUptime|Better Stack|Uptime-Kuma|checkly|Datadog|NewRelicPinger|HetrixTools|Freshping|Updown/i, "Uptime monitors"],
  /* A browser driven by a program. */
  [/HeadlessChrome|PhantomJS|Puppeteer|Playwright|Selenium|Cypress/i, "Headless browsers"],
  /* Command-line tools and HTTP libraries: never a person reading a page. */
  [/curl\/|Wget|python-requests|Python-urllib|aiohttp|httpx|Go-http-client|Java\/|okhttp|axios|node-fetch|undici|libwww-perl|Ruby|PHP\/|Apache-HttpClient|Scrapy|Faraday|reqwest|Dart\/|Deno\//i, "Scripts and libraries"],
  /* What announces itself as a robot under any other name. Not "Cubot", a phone maker whose browsers say so. */
  [/(?<!cu)bot\b|bot\/|crawl|spider|slurp|scrape|fetcher|monitor|checker|archiver|ia_archiver/i, "Other robots"],
];

/** The family of a robot, or null for a browser. No user agent at all is a robot: every browser sends one. */
export function botOf(ua: string): string | null {
  if (!ua.trim()) return "No user agent";
  for (const [re, name] of BOTS) if (re.test(ua)) return name;
  return null;
}

/**
 * THE AI AND SEARCH CRAWLERS BY NAME, for the SEO section's AI search page
 * (src/cc/seo/aisearch.ts). Added beside the families above, never instead of
 * them: a bot hit is still counted once under its family, and when its user
 * agent names one of these, its name is counted too, per day and per page.
 * Only the name is kept, never the user agent string.
 *
 * Google-Extended is not here on purpose: it is a robots.txt token, never a
 * user agent; Google's crawling for AI Overviews and AI Mode is Googlebot's.
 * Purposes as the companies document them: training (a model learns from the
 * page), search (the page can be shown or cited in AI search answers), user (a
 * person's question made the assistant fetch the page now).
 */
export const AI_AGENTS: { agent: string; re: RegExp; company: string; purpose: "training" | "search" | "user" | "search-engine" | "other" }[] = [
  { agent: "OAI-SearchBot", re: /OAI-SearchBot/i, company: "OpenAI", purpose: "search" },
  { agent: "ChatGPT-User", re: /ChatGPT-User/i, company: "OpenAI", purpose: "user" },
  { agent: "GPTBot", re: /GPTBot/i, company: "OpenAI", purpose: "training" },
  { agent: "Perplexity-User", re: /Perplexity-User/i, company: "Perplexity", purpose: "user" },
  { agent: "PerplexityBot", re: /PerplexityBot/i, company: "Perplexity", purpose: "search" },
  { agent: "Claude-SearchBot", re: /Claude-SearchBot/i, company: "Anthropic", purpose: "search" },
  { agent: "Claude-User", re: /Claude-User/i, company: "Anthropic", purpose: "user" },
  { agent: "ClaudeBot", re: /ClaudeBot/i, company: "Anthropic", purpose: "training" },
  { agent: "Googlebot", re: /Googlebot/i, company: "Google", purpose: "search-engine" },
  { agent: "Bingbot", re: /bingbot/i, company: "Microsoft", purpose: "search-engine" },
  { agent: "Applebot", re: /Applebot/i, company: "Apple", purpose: "search" },
  { agent: "Amazonbot", re: /Amazonbot/i, company: "Amazon", purpose: "other" },
  { agent: "CCBot", re: /CCBot/i, company: "Common Crawl", purpose: "training" },
  { agent: "meta-externalagent", re: /meta-externalagent/i, company: "Meta", purpose: "training" },
];

/** The named AI or search crawler a user agent announces, or null. */
export function agentOf(ua: string): string | null {
  for (const a of AI_AGENTS) if (a.re.test(ua)) return a.agent;
  return null;
}

/**
 * A device class from the user agent, the only part of it that is kept.
 * iPads since iPadOS 13 say "Macintosh", so they count as desktop.
 */
export function deviceOf(ua: string): "mobile" | "tablet" | "desktop" | "other" {
  if (/iPad|Tablet|PlayBook|Silk\/|Kindle|SM-T\d|Android(?!.*Mobile)/i.test(ua)) return "tablet";
  if (/Mobi|iPhone|iPod|Windows Phone|BlackBerry|BB10|Opera Mini|IEMobile/i.test(ua)) return "mobile";
  if (/Windows NT|Macintosh|Mac OS X|X11|CrOS|Linux x86_64/i.test(ua)) return "desktop";
  return "other";
}

/** The referring site, as a host and nothing more; the site itself and none at all are named as such. */
export function refHost(referer: unknown): string {
  const r = typeof referer === "string" ? referer.trim() : "";
  if (!r) return "(none)";
  try {
    const host = new URL(r.includes("://") ? r : `https://${r}`).hostname.toLowerCase().replace(/\.$/, "");
    if (OWN_HOSTS.has(host)) return "(this site)";
    return host.replace(/^www\./, "") || "(unreadable)";
  } catch {
    return "(unreadable)";
  }
}

/* Router requests, by the matched path or the address. */
const PREFETCH = /\.segments\/|\.prefetch\.rsc$|segment\.rsc$/i;
const NAVIGATION = /\.rsc$/i;
const RSC_QUERY = /(?:^|&)_rsc=/;
/* Files: the framework's and Vercel's own folders, anything with an extension, and the routes Next serves pictures and icons from. */
const FILE_PREFIX = /^\/(?:_next|_vercel|\.well-known|cdn-cgi)(?:\/|$)/i;
const FILE_EXT = /\.[a-z0-9]{1,8}$/i;
const FILE_ROUTE = /(?:^|\/)(?:favicon|icon|apple-icon|opengraph-image|twitter-image|feed|rss)(?:-[\w-]+)?$/i;
const API = /^\/api(?:\/|$)/i;

/** "/a/b/" → "/a/b"; the home page stays "/". At most 200 characters. */
function cleanPath(p: string): string {
  const bare = p.replace(/\/+$/, "") || "/";
  return bare.length > 200 ? `${bare.slice(0, 199)}…` : bare;
}

/** The studio's day for a time in ms. */
const zurichDay = (ms: number): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(ms));

export interface Decided {
  kind: DrainKind;
  day: string;
  /** The record's own time in ms, when it carried one. */
  at: number | null;
  /** The record's request id, for "the same request counts once". */
  requestId: string | null;
  /** For a view or a navigation: the address, referring site, device class and edge region. For a 404: the address. */
  path?: string;
  ref?: string;
  device?: string;
  region?: string;
  /** For a bot hit: its family. */
  bot?: string;
  /** For a bot hit by a named AI or search crawler (AI_AGENTS): its name; `path` is then the page it asked for. */
  agent?: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/**
 * Apply the rules (all but "duplicate", which needs memory) to one record.
 * Pure: the same record always gets the same answer. The record is read and
 * forgotten: nothing personal leaves this function except a device class.
 */
export function classify(raw: unknown, now = Date.now()): Decided {
  const r = isObj(raw) ? raw : {};
  const p = isObj(r.proxy) ? r.proxy : null;
  const ts = Number(p?.timestamp ?? r.timestamp);
  const at = Number.isFinite(ts) && ts > 0 ? ts : null;
  const day = zurichDay(at ?? now);
  const requestId = str(r.requestId) || null;
  const base = { day, at, requestId };

  if (!p) return { ...base, kind: "noRequest" };

  const host = str(p.host || r.host).toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  if (!SITE_HOSTS.has(host)) return { ...base, kind: "otherHost" };

  if (str(p.method).toUpperCase() !== "GET") return { ...base, kind: "method" };

  const address = str(p.path) || "/";
  const q = address.indexOf("?");
  const pathname = q === -1 ? address : address.slice(0, q);
  const query = q === -1 ? "" : address.slice(q + 1);
  /* The top-level path is "the function or dynamic path": where Vercel matched the request, e.g. "/page.rsc". */
  const matched = str(r.path).split("?")[0] ?? "";

  if (PREFETCH.test(pathname) || PREFETCH.test(matched)) return { ...base, kind: "prefetch" };
  const navigation = NAVIGATION.test(matched) || NAVIGATION.test(pathname);
  if (!navigation && RSC_QUERY.test(query)) return { ...base, kind: "rsc" };
  if (!navigation) {
    if (FILE_PREFIX.test(pathname) || FILE_EXT.test(pathname) || FILE_ROUTE.test(pathname)) return { ...base, kind: "file" };
    if (API.test(pathname)) return { ...base, kind: "api" };
  }

  const ua = Array.isArray(p.userAgent) ? p.userAgent.map(str).join(" ") : str(p.userAgent);
  const bot = botOf(ua);
  if (bot) {
    const agent = agentOf(ua);
    return agent
      ? { ...base, kind: "bot", bot, agent, path: cleanPath(navigation && NAVIGATION.test(pathname) ? pathname.replace(NAVIGATION, "") : pathname) }
      : { ...base, kind: "bot", bot };
  }

  /* The page a navigation opened: its address, or its matched path without ".rsc". */
  const page = cleanPath(navigation && NAVIGATION.test(pathname) ? pathname.replace(NAVIGATION, "") : pathname);
  const status = Number(p.statusCode ?? r.statusCode);
  if (status === 200 || status === 304) {
    return {
      ...base,
      kind: navigation ? "navigation" : "view",
      path: page,
      ref: navigation ? "(this site)" : refHost(p.referer),
      device: deviceOf(ua),
      region: str(p.region).toLowerCase() || "(unknown)",
    };
  }
  if (status === 404) return { ...base, kind: "notFound", path: page };
  if (status >= 300 && status < 400) return { ...base, kind: "redirect" };
  if (status >= 500 && status < 600) return { ...base, kind: "serverError" };
  return { ...base, kind: "otherStatus" };
}

/* ---------- reading a delivery -------------------------------------------------------------- */

/** HMAC-SHA1 of the raw body with the drain's secret, compared in constant time. */
export function signedBy(body: Buffer, header: string, key: string): boolean {
  const said = header.trim().toLowerCase();
  if (!key || !/^[0-9a-f]{40}$/.test(said)) return false;
  const want = createHmac("sha1", key).update(body).digest();
  const got = Buffer.from(said, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A delivery's records: a JSON array, NDJSON, or one object. Lines that are not JSON are counted, not thrown. */
export function parseRecords(text: string): { records: unknown[]; unreadable: number } {
  const t = text.trim();
  if (!t) return { records: [], unreadable: 0 };
  if (t.startsWith("[")) {
    const v: unknown = JSON.parse(t);
    return { records: Array.isArray(v) ? v : [], unreadable: 0 };
  }
  try {
    const one: unknown = JSON.parse(t);
    if (isObj(one)) return { records: [one], unreadable: 0 };
  } catch {
    /* several lines: NDJSON */
  }
  const records: unknown[] = [];
  let unreadable = 0;
  for (const line of t.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      unreadable++;
    }
  }
  return { records, unreadable };
}

/* ---------- counting ---------------------------------------------------------------------- */

export interface Ingested {
  records: number;
  byKind: Partial<Record<DrainKind, number>>;
  views: number;
  days: string[];
}

const upsert = db.prepare("INSERT INTO cc_drain_days (day, dim, key, n) VALUES (?, ?, ?, ?) ON CONFLICT(day, dim, key) DO UPDATE SET n = n + excluded.n");
const keysOf = db.prepare("SELECT COUNT(*) AS n FROM cc_drain_days WHERE day = ? AND dim = ?");
const hasKey = db.prepare("SELECT 1 AS x FROM cc_drain_days WHERE day = ? AND dim = ? AND key = ?");
const seenId = db.prepare("SELECT 1 AS x FROM cc_drain_seen WHERE id = ?");
const markId = db.prepare("INSERT OR IGNORE INTO cc_drain_seen (id, at) VALUES (?, ?)");
const viewsOn = db.prepare("SELECT COALESCE(SUM(n), 0) AS n FROM cc_drain_days WHERE day = ? AND dim = 'kind' AND key IN ('view', 'navigation')");

/** Dims whose keys are many and are capped at MAX_KEYS a day. */
const CAPPED = new Set(["path", "ref", "404", "bot", "region", "agent", "agent-path"]);

/**
 * Count a delivery's records. Everything in one transaction: a delivery is
 * counted whole or not at all. `delivery` adds it to the day's deliveries.
 */
export function ingest(records: unknown[], o: { now?: number; delivery?: boolean } = {}): Ingested {
  const now = o.now ?? Date.now();
  const sums = new Map<string, number>();
  const add = (day: string, dim: string, key: string, n = 1) => {
    const k = `${day}\t${dim}\t${key}`;
    sums.set(k, (sums.get(k) ?? 0) + n);
  };
  const seen = new Set<string>();
  const already = (id: string): boolean => seen.has(id) || !!seenId.get(id);
  const remember = (id: string) => {
    seen.add(id);
    markId.run(id, now);
  };
  const byKind: Partial<Record<DrainKind, number>> = {};
  let newest = 0;

  db.exec("BEGIN");
  try {
    for (const raw of records) {
      const r = isObj(raw) ? raw : {};
      const id = str(r.id);
      let d = classify(raw, now);
      if (id && already(`r:${id}`)) d = { ...d, kind: "duplicate" };
      else {
        if (id) remember(`r:${id}`);
        /* A request's other records (its function's log lines) carry the same request: counted once. */
        if (d.kind !== "noRequest" && d.requestId) {
          if (already(`q:${d.requestId}`)) d = { ...d, kind: "duplicate" };
          else remember(`q:${d.requestId}`);
        }
      }
      if (d.at && d.at > newest) newest = d.at;
      byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;
      add(d.day, "kind", d.kind);
      if (d.kind === "view" || d.kind === "navigation") {
        add(d.day, "path", d.path ?? "/");
        add(d.day, "ref", d.ref ?? "(none)");
        add(d.day, "device", d.device ?? "other");
        add(d.day, "region", d.region ?? "(unknown)");
      } else if (d.kind === "bot") {
        add(d.day, "bot", d.bot ?? "Other robots");
        /* A named AI or search crawler, by name and by name and page (AI_AGENTS). */
        if (d.agent) {
          add(d.day, "agent", d.agent);
          add(d.day, "agent-path", `${d.agent} ${d.path ?? "/"}`);
        }
      } else if (d.kind === "notFound") add(d.day, "404", d.path ?? "/");
    }
    if (o.delivery) {
      add(zurichDay(now), "delivery", "signed");
      add(zurichDay(now), "delivery", "records", records.length);
    }

    /* Into the table, a capped list's new keys beyond MAX_KEYS summed as "(other)". */
    const fresh = new Map<string, number>();
    for (const [k, n] of sums) {
      const [day, dim, key] = k.split("\t") as [string, string, string];
      if (CAPPED.has(dim) && key !== "(other)" && !hasKey.get(day, dim, key)) {
        const group = `${day}\t${dim}`;
        const had = fresh.get(group) ?? (keysOf.get(day, dim) as { n: number }).n;
        if (had >= MAX_KEYS) {
          upsert.run(day, dim, "(other)", n);
          continue;
        }
        fresh.set(group, had + 1);
      }
      upsert.run(day, dim, key, n);
    }

    /* Each day touched: its page views into the kept history, which outlives everything else here. */
    const days = [...new Set([...sums.keys()].map((k) => k.split("\t")[0]!))].sort();
    for (const day of days) record("vercel.views", (viewsOn.get(day) as { n: number }).n, day);

    if (o.delivery) {
      const at = new Date(now).toISOString();
      if (!state("drain:first")) setState("drain:first", at);
      setState("drain:last", at);
    }
    const had = Date.parse(state("drain:newest") ?? "");
    if (newest && !(had >= newest)) setState("drain:newest", new Date(newest).toISOString());
    prune(now);
    db.exec("COMMIT");
    return { records: records.length, byKind, views: (byKind.view ?? 0) + (byKind.navigation ?? 0), days };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** A delivery that was refused: counted, so a forger or a wrong secret shows on the screen. */
export function refused(now = Date.now()): void {
  upsert.run(zurichDay(now), "delivery", "refused", 1);
  setState("drain:refused", new Date(now).toISOString());
}

/** At most hourly: record ids older than two days, and counts older than 400 days. The daily page views stay in cc_series. */
function prune(now: number): void {
  if (now - Number(state("drain:pruned") ?? "0") < 3_600_000) return;
  db.prepare("DELETE FROM cc_drain_seen WHERE at < ?").run(now - SEEN_MS);
  db.prepare("DELETE FROM cc_drain_days WHERE day < ?").run(today(-400));
  setState("drain:pruned", String(now));
}

/* ---------- reading it back ------------------------------------------------------------------- */

export interface DrainState {
  /** The secret is set: the door can verify a delivery. */
  ready: boolean;
  /** The first and the last signed delivery, the newest record's own time, the last refused delivery; ISO or null. */
  first: string | null;
  last: string | null;
  newest: string | null;
  lastRefused: string | null;
}

export function drainState(): DrainState {
  return {
    ready: !!secret(),
    first: state("drain:first") || null,
    last: state("drain:last") || null,
    newest: state("drain:newest") || null,
    lastRefused: state("drain:refused") || null,
  };
}

/** Records per kind between two days, both included. Every kind is present, zero when none. */
export function kindsBetween(from: string, to: string): Record<DrainKind, number> {
  const out = Object.fromEntries(RULES.map((r) => [r.kind, 0])) as Record<DrainKind, number>;
  const rows = db.prepare("SELECT key, SUM(n) AS n FROM cc_drain_days WHERE dim = 'kind' AND day >= ? AND day <= ? GROUP BY key").all(from, to) as { key: string; n: number }[];
  for (const r of rows) if (r.key in out) out[r.key as DrainKind] = r.n;
  return out;
}

/** The biggest keys of one list between two days, biggest first. */
export function topBetween(dim: "path" | "ref" | "device" | "region" | "bot" | "404", from: string, to: string, limit = 10): { key: string; n: number }[] {
  return db
    .prepare("SELECT key, SUM(n) AS n FROM cc_drain_days WHERE dim = ? AND day >= ? AND day <= ? GROUP BY key ORDER BY n DESC, key LIMIT ?")
    .all(dim, from, to, limit) as { key: string; n: number }[];
}

/** Page views per day between two days; a day with no record is absent. */
export function viewsPerDay(from: string, to: string): Map<string, number> {
  const rows = db
    .prepare("SELECT day, SUM(n) AS n FROM cc_drain_days WHERE dim = 'kind' AND key IN ('view', 'navigation') AND day >= ? AND day <= ? GROUP BY day")
    .all(from, to) as { day: string; n: number }[];
  return new Map(rows.map((r) => [r.day, r.n]));
}

/**
 * The days the drain delivered for: a signed delivery arrived, or records of
 * that day were counted. A day with neither is unknown, never zero. (The
 * desk's own checks make a record every two minutes, so a working drain has
 * records every day.)
 */
export function deliveredDays(from: string, to: string): Set<string> {
  const rows = db.prepare("SELECT DISTINCT day FROM cc_drain_days WHERE (dim = 'kind' OR (dim = 'delivery' AND key = 'signed')) AND n > 0 AND day >= ? AND day <= ?").all(from, to) as { day: string }[];
  return new Set(rows.map((r) => r.day));
}

/**
 * THE ROUTER'S MARKERS, CHECKED. The prefetch, navigation and rsc rules can
 * only tell a router request from a page load by what Vercel puts in the
 * record: `?_rsc=` kept in proxy.path, or the matched path (<page>.rsc,
 * <page>.segments/…) in the top-level path. Vercel's docs say proxy.path
 * carries the query; nobody has yet seen it for these requests. If neither
 * marker arrived, every prefetch of a page answered 200 would pass as a page
 * view, about ninety per page actually opened, and nothing else would show it.
 *
 * A person on a page always brings router requests with them: the links in
 * view are prefetched, and a click to one not yet fetched is a navigation.
 * So a day with MARKER_MIN_VIEWS page views or more and not one prefetch,
 * router request or navigation is a day whose records carried no marker: its
 * page views may include prefetches. The screen and the top bar's light say
 * so; it is never silently corrected.
 */
export const MARKER_MIN_VIEWS = 25;

/** The days between two days (both included) whose page views stand without a single router record, oldest first. */
export function markerGaps(from: string, to: string): { day: string; views: number }[] {
  const rows = db
    .prepare(
      `SELECT day,
              SUM(CASE WHEN key IN ('view', 'navigation') THEN n ELSE 0 END) AS views,
              SUM(CASE WHEN key IN ('prefetch', 'rsc', 'navigation') THEN n ELSE 0 END) AS router
         FROM cc_drain_days WHERE dim = 'kind' AND day >= ? AND day <= ? GROUP BY day ORDER BY day`,
    )
    .all(from, to) as { day: string; views: number; router: number }[];
  return rows.filter((r) => r.views >= MARKER_MIN_VIEWS && r.router === 0).map((r) => ({ day: r.day, views: r.views }));
}

/** One day's deliveries: signed, the records in them, refused. */
export function deliveriesOn(day: string): { deliveries: number; records: number; refused: number } {
  const rows = db.prepare("SELECT key, n FROM cc_drain_days WHERE dim = 'delivery' AND day = ?").all(day) as { key: string; n: number }[];
  const get = (k: string) => rows.find((r) => r.key === k)?.n ?? 0;
  return { deliveries: get("signed"), records: get("records"), refused: get("refused") };
}

/* ---------- the door ------------------------------------------------------------------------- */

/** An unsigned request with nothing in it: a reachability check, answered 200, counted nowhere. */
const EMPTY = /^\s*(?:\[\s*\]|\{\s*\})?\s*$/;
/** The largest unsigned body the door reads: room for an empty check, nothing to hash. */
const UNSIGNED_MAX = 64;
/** What x-vercel-signature looks like: a hex HMAC-SHA1. */
const SIGNATURE_SHAPE = /^[0-9a-f]{40}$/i;

const refuse = (c: Parameters<MiddlewareHandler<Vars>>[0]) => {
  refused();
  return c.json({ code: "invalid_signature", error: "signature didn't match" }, 403);
};

/**
 * POST /drain/vercel, mounted by src/cc/index.ts.
 *
 *   signed with VERCEL_DRAIN_SECRET   200, and the records are counted
 *   signed, and marked as Vercel's    200 { test: true }, nothing counted and
 *     test (TEST_HEADER)              no delivery recorded
 *   signature wrong                   403, nothing counted, the refusal is
 *                                     counted (so a wrong secret shows)
 *   unsigned AND empty                200, nothing counted: a reachability
 *                                     check carries nothing to sign
 *   unsigned, marked as the test      200 { test: true, signed: false },
 *                                     unread: Vercel may send its sample
 *                                     unsigned; it proves the door answers
 *   anything else unsigned            403, counted as refused
 *   no secret on the desk             503: the door is not open yet
 *   over MAX_BODY                     413
 *
 * READ ONLY WHAT COULD BE SIGNED. The guard below answers from the headers
 * alone, before a byte of the body is read (and before bodyLimit, which reads
 * a body sent without a length to measure it): no secret, no signature of the
 * right shape and no tiny announced length, and the request is answered.
 * A request that carries a signature of the right shape is read, up to
 * MAX_BODY, because only its body can prove it. Its signature is checked on
 * the body exactly as sent, and only a body whose signature matched is ever
 * unpacked (a gzip delivery), at most to MAX_UNPACKED: a stranger cannot make
 * the desk inflate anything. A drain set to gzip whose signature Vercel
 * computed over the unpacked body would therefore be refused, and the
 * refusals show on the screen; deploy/vercel-connect.mjs asks for none.
 *
 * Vercel's docs (drains/using-drains, 2026-09-17) ask only for "200 OK" and
 * test a custom endpoint when the drain is created. Vercel's own Terraform
 * provider documents an older ownership check: a 200 carrying x-vercel-verify
 * with the team's verification code. Both are answered: when
 * VERCEL_DRAIN_VERIFY is set, every answer of this door carries it.
 */
/* Typed like the app it is mounted on. No person ever reaches it: `who` is never set here, and nothing here reads it. */
export const door = new Hono<Vars>();

door.use("*", async (c, next) => {
  await next();
  const code = verifyCode();
  if (code) c.res.headers.set("x-vercel-verify", code);
  c.res.headers.set("cache-control", "no-store");
});

door.get("/vercel", (c) => c.json({ door: "vercel-drain", ready: !!secret() }));

/** From the headers alone, before anything reads the body. */
const guard: MiddlewareHandler<Vars> = async (c, next) => {
  if (!secret()) return c.json({ error: "The desk has no VERCEL_DRAIN_SECRET yet: the drain's door is not open." }, 503);
  const said = (c.req.header("x-vercel-signature") ?? "").trim();
  if (said) return SIGNATURE_SHAPE.test(said) ? next() : refuse(c);
  if (c.req.header(TEST_HEADER) === "1") return c.json({ ok: true, test: true, signed: false, counted: 0 });
  const length = c.req.header("content-length") ?? "";
  const tiny = /^\d+$/.test(length) && Number(length) <= UNSIGNED_MAX && !c.req.header("transfer-encoding");
  return tiny ? next() : refuse(c);
};

door.post(
  "/vercel",
  guard,
  bodyLimit({ maxSize: MAX_BODY, onError: (c) => c.json({ error: `A delivery is at most ${MAX_BODY / 1024 / 1024} MB.` }, 413) }),
  async (c) => {
    const said = (c.req.header("x-vercel-signature") ?? "").trim();
    const raw = Buffer.from(await c.req.arrayBuffer());

    /* Unsigned: the guard let only a tiny announced body through. */
    if (!said) return EMPTY.test(raw.toString("utf8")) ? c.json({ ok: true, counted: 0 }) : refuse(c);
    /* The signature is over the body exactly as sent. Nothing is unpacked before it matched. */
    if (!signedBy(raw, said, secret())) return refuse(c);
    if (c.req.header(TEST_HEADER) === "1") return c.json({ ok: true, test: true, signed: true, counted: 0 });

    let body = raw;
    if (/gzip/i.test(c.req.header("content-encoding") ?? "")) {
      try {
        body = gunzipSync(raw, { maxOutputLength: MAX_UNPACKED });
      } catch {
        return c.json({ error: `The delivery is signed, says gzip, and does not unpack within ${MAX_UNPACKED / 1024 / 1024} MB.` }, 400);
      }
    }

    let parsed: { records: unknown[]; unreadable: number };
    try {
      parsed = parseRecords(body.toString("utf8"));
    } catch {
      return c.json({ error: "The delivery is signed but is neither JSON nor NDJSON." }, 400);
    }
    try {
      const done = ingest(parsed.records, { delivery: true });
      return c.json({ ok: true, received: done.records, views: done.views, unreadable: parsed.unreadable });
    } catch (e) {
      console.error("drain: a signed delivery could not be stored:", e);
      return c.json({ error: "The desk could not store that delivery. The reason is in its log." }, 500);
    }
  },
);

/* ---------- Settings and the top bar's light ---------------------------------------------------- */

const STEP = "Run bash deploy/vercel-connect.sh on the workstation: it creates the drain for the website's production and puts VERCEL_DRAIN_SECRET in the desk's environment.";

const hoursSince = (iso: string): number => Math.round((Date.now() - Date.parse(iso)) / 3_600_000);

registerSource(() => {
  const s = drainState();
  const base = { id: "vercel-drain" as const, name: "Vercel request records (log drain)", feeds: "Hosting: true page views, top pages, referrers, devices, bots and 404s" };
  if (!s.ready) return { ...base, state: "off", lastOk: null, step: STEP };
  if (!s.last) return { ...base, state: "waiting", lastOk: null, error: "The secret is set and no signed delivery has arrived yet. The drain is created by deploy/vercel-connect.sh." };
  if (Date.now() - Date.parse(s.last) > SILENT_MS) {
    return { ...base, state: "failing", lastOk: s.last, error: `No signed delivery for ${hoursSince(s.last)} hours. Vercel may have paused or disabled the drain (Team Settings > Drains says why).` };
  }
  return { ...base, state: "connected", lastOk: s.last };
});

registerCheck(() => {
  const s = drainState();
  if (!s.ready || !s.last) return null;
  const quiet = Date.now() - Date.parse(s.last);
  return {
    name: "Vercel's request records arrive",
    ok: quiet < QUIET_MS,
    detail:
      quiet < QUIET_MS
        ? `The last signed delivery came ${Math.max(0, Math.round(quiet / 60_000))} minutes ago.`
        : `No signed delivery for ${hoursSince(s.last)} hours: page views are not being counted. Vercel marks a drain errored or disables it, and says why in Team Settings > Drains.`,
  };
});

/* The router's markers (markerGaps), over the last seven days: red when a day's page views stood without a single router record. */
registerCheck(() => {
  const s = drainState();
  if (!s.last) return null;
  const gaps = markerGaps(today(-6), today());
  const days = gaps.map((g) => `${g.day} (${g.views} page views)`).join(", ");
  return {
    name: "Vercel's records carry the router's markers",
    ok: gaps.length === 0,
    detail: gaps.length
      ? `Router markers absent on ${days}: not one prefetch, router request or navigation beside them, so those page views may include prefetches. Vercel's records for those days carried neither ?_rsc= in proxy.path nor the .segments/.rsc matched path (src/cc/vercel/drain.ts, markerGaps).`
      : `No day of the last seven has ${MARKER_MIN_VIEWS} or more page views without router records beside them: prefetches are told apart.`,
  };
});
