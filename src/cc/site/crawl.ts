import type { DayPoint, Reading, Share, Stat } from "../../../web/src/contract/common.ts";
import type { ExtractResultRow, ExtractResults, ExtractRule, ExtractRuleInput, SpiderDuplicates } from "../../../web/src/contract/spider.ts";
import { db } from "../../db.ts";
import type { Job } from "../scheduler.ts";
import { keep, kept, note, ok, record, series, setState, state, today, waiting } from "../store.ts";
import { closeExtractor, EXTRACT, parseWithRules, trialRule, validateRule, type ExtractFound, type ExtractRuleDef } from "./extract.ts";
import { abs, get, normalPath, pathOf, pool, siteHost, twinHost, type Got } from "./http.ts";
import type { LinkFact, PageFacts } from "./parse.ts";
import { closeParser, parseIsolated } from "./parser.ts";
import { probeIfDue } from "./probes.ts";
import { issue, judge, kindOf, KIND_LABEL, LIMITS, redirectLoop, RULES, saysNoindex, type Issue, type PageKind, type PageView, type RuleId, type Severity } from "./rules.ts";
import { fingerprint, lastSitemap, refreshSitemap, type SitemapEntry } from "./sitemap.ts";
import { structure, type RedirectRule, type Structure } from "./structure.ts";

/**
 * The desk reads every page of the website, once a day and whenever the
 * sitemap changes.
 *
 * WHICH PAGES. Every address in the sitemap, plus the ones the site keeps
 * out of it on purpose and only its repository knows: page files with a
 * fixed address that the sitemap does not list (the unwritten marketing
 * placeholders, the boards held in reserve) and articles the desk published
 * that nobody has listed yet. Those are read too, because "this page should
 * be invisible to search" is a claim worth checking.
 *
 * WHAT IS KEPT. One row per address (`cc_pages`: the facts as JSON, the
 * status, a fingerprint of the content, when it was first and last seen and
 * when it last changed), every link (`cc_links`), what each distinct link
 * target answered (`cc_targets`), and what the rules concluded
 * (`cc_issues`). The page's HTML is never kept: it is parsed and dropped.
 * The facts carry a fingerprint of the page's own text (parse.ts
 * ContentPrint: an md5, its blocks, a MinHash sketch), which is how the
 * duplicate-content rules compare pages without keeping their words. When
 * the owner has custom extraction rules on (extract.ts), what each found on
 * each page in its scope is kept too (`cc_extract_results`), with how long
 * it took there. A rule that runs past a page's deadline (extract.ts) is not
 * asked again for the rest of that crawl, and is switched off when it does
 * so in `OVERRUNS_TO_SWITCH_OFF` crawls running.
 *
 * REDIRECT LOOPS are their own finding (redirect.loop, with the hops),
 * wherever the crawl follows redirects: a page it reads, a link on a page
 * (the link is then broken, not "redirected"), a redirect rule.
 *
 * HOW HARD IT LEANS ON THE SITE. Three requests at a time with a short pause,
 * so about a hundred pages take under a minute. One document is parsed at a
 * time, in a thread with a ceiling on its memory that ends with the crawl
 * (see parser.ts). Link targets are asked once each however many pages link
 * to them; other people's sites are asked at most once a week.
 *
 * WHAT A CHANGE IS. Between two crawls the desk compares what a reader or a
 * search engine would notice (title, description, heading, canonical,
 * indexing, status, the words) and writes one line in the feed per change:
 * "/seo: title changed". The markup itself changes with every deploy and is
 * not compared.
 */

db.exec(`
  CREATE TABLE IF NOT EXISTS cc_pages (
    path         TEXT PRIMARY KEY,
    kind         TEXT NOT NULL,
    /* What the address itself answered: 200, 308, 404; 0 when nothing did. */
    status       INTEGER NOT NULL,
    in_sitemap   INTEGER NOT NULL,
    /* 'sitemap', or how the repository knows it: 'route' (a page file the
       sitemap leaves out) or 'unlisted' (an article not yet in the menus). */
    listed_by    TEXT NOT NULL,
    title        TEXT,
    descr        TEXT,
    heading      TEXT,
    /* 0 to 100, or NULL for a page that is not scored. */
    score        INTEGER,
    /* How the request went: hops, times, bytes, the headers that matter. JSON. */
    fetched      TEXT NOT NULL,
    /* What parse.ts read from the HTML. JSON, or NULL when the page did not answer 200. */
    facts        TEXT,
    hash         TEXT,
    first_seen   TEXT NOT NULL,
    last_seen    TEXT NOT NULL,
    last_changed TEXT
  );

  CREATE TABLE IF NOT EXISTS cc_links (
    source   TEXT NOT NULL,
    /* Internal: the stored address. External: the absolute URL. */
    target   TEXT NOT NULL,
    text     TEXT NOT NULL DEFAULT '',
    internal INTEGER NOT NULL,
    /* 'main': in the page's own content. 'chrome': menu, header, footer. */
    place    TEXT NOT NULL,
    rel      TEXT NOT NULL DEFAULT '',
    times    INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (source, target, place)
  );
  CREATE INDEX IF NOT EXISTS cc_links_target ON cc_links (target);

  CREATE TABLE IF NOT EXISTS cc_targets (
    target   TEXT PRIMARY KEY,
    internal INTEGER NOT NULL,
    /* On the site: the first answer (a redirect is itself the finding).
       Outside: the final answer, after redirects. "landed" is always the final one. */
    status   INTEGER NOT NULL,
    landed   INTEGER NOT NULL,
    lands    TEXT,
    /* 'ok', 'redirect', 'broken', or 'unchecked' (it refused to be checked). */
    outcome  TEXT NOT NULL,
    remark   TEXT,
    checked  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cc_issues (
    id         TEXT PRIMARY KEY,
    rule       TEXT NOT NULL,
    severity   TEXT NOT NULL,
    path       TEXT,
    text       TEXT NOT NULL,
    measured   TEXT,
    bound      TEXT,
    related    TEXT,
    first_seen TEXT NOT NULL,
    last_seen  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cc_issues_path ON cc_issues (path);

  /* Custom extraction (extract.ts): the owner's rules, and what each found
     on each page in its scope at the last crawl. Nothing is seeded. */
  CREATE TABLE IF NOT EXISTS cc_extract_rules (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    /* 'css', 'regex' or 'xpath'. */
    kind       TEXT NOT NULL,
    expression TEXT NOT NULL,
    /* css and xpath: the attribute read from each match (NULL: its text).
       regex: the capture group kept (NULL: the whole match). */
    attribute  TEXT,
    /* NULL: every page. Otherwise the beginning of the stored address
       ("/insights/" is every article, "/how-to" every page beginning so). */
    scope      TEXT,
    enabled    INTEGER NOT NULL DEFAULT 1,
    added_by   TEXT NOT NULL,
    added_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cc_extract_results (
    rule    INTEGER NOT NULL,
    path    TEXT NOT NULL,
    /* JSON: the first values, each cut (EXTRACT in extract.ts). */
    matches TEXT NOT NULL,
    count   INTEGER NOT NULL,
    error   TEXT,
    at      TEXT NOT NULL,
    /* Milliseconds the rule took on the page; NULL when it was not run there. */
    ms      INTEGER,
    PRIMARY KEY (rule, path)
  );
`);
/* The first copies of cc_extract_results were made before `ms` was kept. */
if (!(db.prepare("PRAGMA table_info(cc_extract_results)").all() as { name: string }[]).some((c) => c.name === "ms")) {
  db.exec("ALTER TABLE cc_extract_results ADD COLUMN ms INTEGER");
}

/* ---------- what is stored about one request -------------------------------- */

export interface Fetched {
  /** Every redirect before the final answer. */
  hops: { url: string; status: number; location: string | null }[];
  /** Where the chain ended: a stored address when on the site, else the URL. */
  lands: string;
  /** The final answer's status. */
  landed: number;
  /** Milliseconds to the first byte of the final answer, as the desk's server measured it. */
  ttfb: number;
  /** Milliseconds until the whole body had arrived. */
  total: number;
  /** Bytes of HTML after decompression. */
  bytes: number;
  cacheControl: string | null;
  /** Vercel's x-vercel-cache: HIT, MISS, STALE, PRERENDER… */
  vercelCache: string | null;
  contentType: string | null;
  /** The X-Robots-Tag header, when sent. */
  robotsTag: string | null;
  /** Why nothing answered, when nothing did. */
  error?: string;
}

const fetchedOf = (g: Got): Fetched => ({
  hops: g.hops,
  lands: pathOf(g.url) ?? g.url,
  landed: g.status,
  ttfb: g.ttfb,
  total: g.total,
  bytes: g.bytes,
  cacheControl: g.headers["cache-control"] ?? null,
  vercelCache: g.headers["x-vercel-cache"] ?? null,
  contentType: g.headers["content-type"] ?? null,
  robotsTag: g.headers["x-robots-tag"] ?? null,
  ...(g.error ? { error: g.error } : {}),
});

interface Row {
  path: string;
  kind: PageKind;
  status: number;
  in_sitemap: number;
  listed_by: "sitemap" | "route" | "unlisted";
  title: string | null;
  descr: string | null;
  heading: string | null;
  score: number | null;
  fetched: string;
  facts: string | null;
  hash: string | null;
  first_seen: string;
  last_seen: string;
  last_changed: string | null;
}

const parse = <T>(json: string | null): T | null => {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
};

/* ---------- link targets ----------------------------------------------------- */

export type Outcome =
  /** It answers 200 (after redirects, for an outside address). */
  | "ok"
  /** An address on the site that answers with a redirect. */
  | "redirect"
  /** 404, 410, or a host that does not exist. */
  | "broken"
  /** It would not say: it refuses bots, timed out or failed on its side. NOT broken. */
  | "unchecked";

/** An address as the hop lists show it: a stored address on the canonical host, the whole URL anywhere else (the bare domain included). */
const shown = (url: string): string => {
  try {
    const u = new URL(url);
    return u.host === siteHost() ? `${normalPath(u.pathname)}${u.search}` : url;
  } catch {
    return url;
  }
};

/** The statuses of the redirects round a loop (redirectLoop's addresses), in order. */
const loopStatuses = (hops: readonly { url: string; status: number }[], round: readonly string[]): number[] => {
  const start = hops.findIndex((h) => h.url === round[0]);
  return start < 0 ? [] : hops.slice(start, start + round.length - 1).map((h) => h.status);
};

/** A redirect loop the crawl ran into, for rule redirect.loop. */
interface Loop {
  /** The addresses round the loop, the first one again at the end. */
  hops: string[];
  /** The status of each redirect on the way. */
  statuses: number[];
  /** How it was met: a page the crawl reads, a link on a page, a redirect rule (its source). */
  met: { page?: string; link?: string; rule?: string };
}

/**
 * Ask an address on the site that is not one of the crawled pages what it
 * answers: one GET, body not read.
 *
 * A REDIRECT LOOP IS BROKEN, not "a redirect": it never lands, and a
 * browser shows an error. Its hops come back in `loop` for redirect.loop.
 */
async function checkInternal(target: string): Promise<{ status: number; landed: number; lands: string; outcome: Outcome; remark: string | null; loop: Loop | null }> {
  const g = await get(abs(target), { body: false });
  const status = g.hops[0]?.status ?? g.status;
  const round = redirectLoop(g.hops, g.url, g.status);
  if (round) {
    const hops = round.map(shown);
    return { status, landed: g.status, lands: pathOf(g.url) ?? g.url, outcome: "broken", remark: `redirects in a loop and never lands: ${hops.join(" → ")}`, loop: { hops, statuses: loopStatuses(g.hops, round), met: { link: target } } };
  }
  const outcome: Outcome = status >= 300 && status < 400 ? "redirect" : status === 200 ? "ok" : "broken";
  return { status, landed: g.status, lands: pathOf(g.url) ?? g.url, outcome, remark: g.error ?? null, loop: null };
}

/**
 * Ask another site whether a link still works. HEAD first, because it costs
 * the other side nothing; GET when HEAD is refused or answers oddly, because
 * many servers do not implement HEAD honestly.
 *
 * ONLY A CLEAR "GONE" IS BROKEN: 404, 410, or a host name that does not
 * resolve. Everything else that is not a success (401, 403, 429, LinkedIn's
 * 999, a 5xx, a timeout) is "could not check": plenty of sites turn every
 * bot away, and calling their pages broken would be a false alarm about a
 * link that works in a browser.
 */
async function checkExternal(target: string): Promise<{ status: number; landed: number; lands: string; outcome: Outcome; remark: string | null }> {
  let g = await get(target, { method: "HEAD", timeout: 12_000 });
  if (!(g.status >= 200 && g.status < 300)) g = await get(target, { body: false, timeout: 12_000 });
  /* For an outside address `status` is the FINAL answer, after its
     redirects: "http://x" answering 301 and then 404 is a link that is gone,
     not one that "answers 301". (An address on the site keeps its first
     answer: there the redirect itself is the finding.) */
  const status = g.status;
  let outcome: Outcome;
  let remark: string | null = null;
  const round = redirectLoop(g.hops, g.url, g.status);
  if (g.status >= 200 && g.status < 300) outcome = "ok";
  else if (round) {
    /* Not called broken: many sites loop a client that keeps no cookies
       (this one keeps none) and land a browser fine. Said, not counted. */
    outcome = "unchecked";
    remark = `redirects in a loop for a client without cookies: ${round.join(" → ")}`.slice(0, 400);
  } else if (g.status === 404 || g.status === 410) outcome = "broken";
  else if (g.status === 0 && /ENOTFOUND|getaddrinfo/i.test(g.error ?? "")) {
    outcome = "broken";
    remark = "the host name does not exist";
  } else {
    outcome = "unchecked";
    remark = g.status === 0 ? `no answer (${g.error ?? "unknown"})` : `answered ${g.status}: it refuses automated checks or failed on its side`;
  }
  return { status, landed: g.status, lands: g.url, outcome, remark };
}

/* ---------- redirects the site promises --------------------------------------- */

export interface RedirectCheck {
  /** The rule's source as next.config writes it ("/work/:slug"), or a host ("https://balkaris.ch/"). */
  source: string;
  /** The rule's destination as written. */
  destination: string;
  /** Where the rule is written: next.config, approved on the desk, or the hosting itself (the bare domain to www). */
  by: "config" | "desk" | "hosting";
  /** The real address that was asked, or null when no example could be made for a `:param`. */
  tested: string | null;
  /** The first answer's status. */
  status: number | null;
  /** Where it ended and what that answered. */
  lands: string | null;
  landed: number | null;
  hops: number;
  /** "ok", "broken" (no redirect, wrong place, not 200, or a loop), "chain" (works in more than one hop), "untested". */
  outcome: "ok" | "broken" | "chain" | "untested";
  /** One sentence saying what happened. */
  remark: string;
  /**
   * Present when the redirect goes round in a loop and never lands: the
   * addresses round it, the first one again at the end. The outcome is then
   * "broken", and the finding is redirect.loop instead of redirect.broken.
   */
  loop?: string[];
}

/**
 * A real address for a rule with a `:param`, found by matching the rule's
 * destination against the addresses that exist. "/work/:slug" →
 * "/case-study-:slug" is tested as "/work/allumi" because
 * "/case-study-allumi" is a page.
 */
function example(rule: RedirectRule, known: string[]): { source: string; destination: string } | null {
  const names = [...rule.source.matchAll(/:(\w+)\*?/g)].map((m) => m[1] as string);
  if (!names.length) return { source: rule.source, destination: rule.destination };
  if (/[*(]/.test(rule.source.replace(/:\w+/g, ""))) return null;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const order: string[] = [];
  const re = new RegExp(
    `^${esc(rule.destination).replace(/:(\w+)/g, (_, n: string) => {
      order.push(n);
      return "([^/]+)";
    })}$`,
  );
  if (!order.length || names.some((n) => !order.includes(n))) return null;
  for (const k of known) {
    const m = re.exec(k);
    if (!m) continue;
    const bound = new Map(order.map((n, i) => [n, m[i + 1] as string]));
    return { source: rule.source.replace(/:(\w+)\*?/g, (_, n: string) => bound.get(n) ?? ""), destination: k };
  }
  return null;
}

async function checkRedirect(source: string, destination: string, by: RedirectCheck["by"], tested: string | null, expected: string | null): Promise<RedirectCheck> {
  if (!tested || !expected) {
    return { source, destination, by, tested: null, status: null, lands: null, landed: null, hops: 0, outcome: "untested", remark: "No existing page matches the rule's pattern, so there was no real address to try." };
  }
  const g = await get(tested, { body: false });
  const status = g.hops[0]?.status ?? g.status;
  const lands = pathOf(g.url) ?? g.url;
  const hops = g.hops.length;
  const round = redirectLoop(g.hops, g.url, g.status);
  let outcome: RedirectCheck["outcome"];
  let remark: string;
  if (hops === 0) {
    outcome = "broken";
    remark = status === 0 ? `Did not answer (${g.error ?? "no reply"}).` : `Answers ${status} itself and does not redirect.`;
  } else if (round) {
    outcome = "broken";
    remark = `Goes round in a loop and never lands: ${round.map(shown).join(" → ")} (${loopStatuses(g.hops, round).join(", ")}).`;
    return { source, destination, by, tested, status, lands, landed: g.status, hops, outcome, remark, loop: round.map(shown) };
  } else if (g.status !== 200) {
    outcome = "broken";
    remark = `Redirects (${status}) to ${lands}, which answers ${g.status || "nothing"}.`;
  } else if (lands !== expected) {
    outcome = "broken";
    remark = `Redirects (${status}) to ${lands}; the rule promises ${expected}.`;
  } else if (hops > 1) {
    outcome = "chain";
    remark = `Arrives at ${lands} in ${hops} hops (${g.hops.map((h) => h.status).join(", ")}); one hop is the most a redirect should take.`;
  } else {
    outcome = "ok";
    remark = `${status} to ${lands}, which answers 200.`;
  }
  return { source, destination, by, tested, status, lands, landed: g.status, hops, outcome, remark };
}

/* ---------- the crawl ----------------------------------------------------------- */

export interface CrawlSummary {
  started: string;
  finished: string;
  /** Seconds the whole crawl took. */
  seconds: number;
  pages: number;
  inSitemap: number;
  /** Pages the repository knows and the sitemap leaves out. */
  outsideSitemap: number;
  /** Addresses whose content differs from the crawl before. */
  changed: number;
  added: number;
  gone: number;
  /** Null when no page could be scored. */
  siteScore: number | null;
  issues: Record<Severity, number>;
  links: { internal: number; external: number; targetsChecked: number; externalChecked: number };
  /** True when the repository could not be read: pages outside the sitemap and redirect rules were then not checked. */
  withoutRepo: boolean;
  /**
   * The site's fallback share picture as the repository names it (lib/site.ts),
   * site-relative, or null when it could not be read: rule share.default-picture
   * could then not be applied. Absent in a summary kept before this was recorded.
   */
  defaultShare?: string | null;
}

const WEEK = 7 * 86_400_000;
/** Other people's sites asked per crawl, at most. The rest wait for the next one. */
const EXTERNAL_PER_RUN = 80;

let crawling: Promise<CrawlSummary> | null = null;

/** Read the whole site now. Two calls at once share one crawl. */
export function crawl(progress: (done: number, of: number, what?: string) => void = () => {}): Promise<CrawlSummary> {
  crawling ??= doCrawl(progress).finally(async () => {
    crawling = null;
    /* The parsing thread's memory goes back to the system with the crawl. */
    await closeParser().catch(() => {});
    await closeExtractor().catch(() => {});
  });
  return crawling;
}

async function doCrawl(progress: (done: number, of: number, what?: string) => void): Promise<CrawlSummary> {
  const started = new Date();
  const now = started.toISOString();

  /* 1. The addresses. */
  let map = lastSitemap();
  if (!map || map.status !== 200 || Date.now() - Date.parse(map.at) > 15 * 60_000) {
    try {
      map = (await refreshSitemap()).read;
    } catch (e) {
      map = lastSitemap();
      if (!map?.entries.length) throw new Error(`No sitemap to crawl from: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  /* Never crawl from an empty list. Every page known from the sitemap would
     be called gone (and new again the day after), the day's page count and
     score would be about nothing, and every repository page would be
     "missing from the sitemap". sitemap.ts keeps the last good addresses
     through a bad read, so this is a site that has never had a usable one. */
  if (!map.entries.length) throw new Error(`The sitemap lists no address to crawl from${map.issues[0] ? `: ${map.issues[0].text}` : "."}`);
  let shape: Structure | null = null;
  try {
    shape = await structure();
  } catch {
    shape = null;
  }

  const inMap = new Map<string, SitemapEntry>(map.entries.map((e) => [e.path, e]));
  const wanted = new Map<string, "sitemap" | "route" | "unlisted">();
  for (const e of map.entries) wanted.set(e.path, "sitemap");
  for (const r of shape?.routes ?? []) if (!wanted.has(r)) wanted.set(r, "route");
  for (const u of shape?.unlisted ?? []) if (!wanted.has(u)) wanted.set(u, "unlisted");
  const roster = new Map((shape?.roster ?? []).map((r) => [r.path, r.of] as const));

  const before = new Map((db.prepare("SELECT * FROM cc_pages").all() as unknown as Row[]).map((r) => [r.path, r]));
  const first = before.size === 0;

  /* The custom extraction rules that are on. With any, every page is parsed
     in extract.ts's thread, which reads the facts and runs the rules in one
     pass; with none, in parser.ts's as before. */
  const extracting = activeRules();
  /* Rules that ran past a page's deadline in this crawl, with that page:
     not asked again until the next crawl (each would cost the deadline on
     every page in its scope). */
  const overrun = new Map<number, string>();
  /* Redirect loops met on the way, by the first address of the loop: one
     finding however many ways it was met. */
  const loops = new Map<string, Loop>();
  const meet = (l: Loop): void => {
    const key = l.hops[0] as string;
    const had = loops.get(key);
    loops.set(key, had ? { ...had, met: { ...l.met, ...had.met } } : l);
  };

  /* 2. Every page: fetch, parse, store. */
  const paths = [...wanted.keys()];
  const views = new Map<string, PageView>();
  const changes: { path: string; text: string; detail?: string; tone: "info" | "good" | "warn" | "bad"; key: string }[] = [];
  let changed = 0;
  let done = 0;

  const upsert = db.prepare(`
    INSERT INTO cc_pages (path, kind, status, in_sitemap, listed_by, title, descr, heading, score, fetched, facts, hash, first_seen, last_seen, last_changed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET kind = excluded.kind, status = excluded.status, in_sitemap = excluded.in_sitemap, listed_by = excluded.listed_by,
      title = excluded.title, descr = excluded.descr, heading = excluded.heading, fetched = excluded.fetched, facts = excluded.facts,
      hash = excluded.hash, last_seen = excluded.last_seen, last_changed = excluded.last_changed
  `);
  const dropLinks = db.prepare("DELETE FROM cc_links WHERE source = ?");
  const addLink = db.prepare("INSERT OR REPLACE INTO cc_links (source, target, text, internal, place, rel, times) VALUES (?, ?, ?, ?, ?, ?, ?)");
  /* Only the rows of the rules asked of the page this time (a JSON list of
     ids): a rule switched off keeps what it found at the last crawl it ran in. */
  const dropFound = db.prepare("DELETE FROM cc_extract_results WHERE path = ? AND rule IN (SELECT value FROM json_each(?))");
  const addFound = db.prepare("INSERT OR REPLACE INTO cc_extract_results (rule, path, matches, count, error, at, ms) VALUES (?, ?, ?, ?, ?, ?, ?)");

  await pool(
    paths,
    3,
    async (path) => {
      const g = await get(abs(path));
      const status = g.hops[0]?.status ?? g.status;
      const isHtml = /html/i.test(g.headers["content-type"] ?? "");
      const old = before.get(path);
      const oldFacts = parse<PageFacts>(old?.facts ?? null);

      /* Parsed in the capped thread (parser.ts), one document at a time
         however many pages are being fetched; the HTML is dropped after. */
      let facts: PageFacts | null = null;
      let links: LinkFact[] = [];
      let hash: string | null = null;
      /* What the custom extraction rules in scope found here; null when none ran. */
      let found: ExtractFound[] | null = null;
      /* The ids of the rules in scope here, run or skipped: their rows are replaced. */
      let asked: number[] = [];
      /* Why a page that answered 200 was not read, for the rule that says so. */
      let unread: string | null = null;
      const round = redirectLoop(g.hops, g.url, g.status);
      if (round) meet({ hops: round.map(shown), statuses: loopStatuses(g.hops, round), met: { page: path } });
      if (status === 200) {
        if (!isHtml) unread = `the answer is ${g.headers["content-type"] ? `“${g.headers["content-type"]}”` : "of no stated type"}, not HTML`;
        else if (!g.body) unread = "the answer had no body";
        else {
          try {
            let read;
            if (extracting.length) {
              const mine = extracting.filter((r) => inScope(r, path));
              /* A rule that overran on an earlier page is not asked here; its answer says why. */
              const skipped = mine.filter((r) => overrun.has(r.id));
              const both = await parseWithRules(g.body, g.url, mine.filter((r) => !overrun.has(r.id)));
              for (const id of both.overran ?? []) if (!overrun.has(id)) overrun.set(id, path);
              read = both.parsed;
              found = [
                ...both.found,
                ...skipped.map((r): ExtractFound => ({ rule: r.id, matches: [], count: 0, error: `not run: it ran for more than ${EXTRACT.pageMs / 1000} seconds on ${overrun.get(r.id)} earlier in this crawl and was stopped for the rest of it` })),
              ];
              asked = mine.map((r) => r.id);
            } else {
              read = await parseIsolated(g.body, g.url);
            }
            facts = read.facts;
            links = read.links;
            hash = read.hash;
          } catch (e) {
            g.error = `the HTML could not be parsed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
            unread = g.error;
          }
        }
      }
      g.body = null;

      const entry = inMap.get(path);
      const kind = kindOf(path, { roster, priority: entry?.priority ?? null, ...(facts ? { schemaTypes: facts.schemaTypes } : {}), before: old?.kind ?? null });
      const fetched = fetchedOf(g);
      const contentChanged = Boolean(old && hash && old.hash && old.hash !== hash);
      const lastChanged = !old ? now : contentChanged || old.status !== status ? now : old.last_changed;

      db.exec("BEGIN");
      try {
        upsert.run(path, kind, status, entry ? 1 : 0, wanted.get(path) as string, facts?.title ?? null, facts?.description ?? null, facts?.h1[0] ?? null, JSON.stringify(fetched), facts ? JSON.stringify(facts) : null, hash, old?.first_seen ?? now, now, lastChanged);
        /* A page that did not answer keeps the links it had: one bad minute
           must not make its targets look like orphans. */
        if (facts) {
          dropLinks.run(path);
          for (const l of links) addLink.run(path, l.target, l.text, l.internal ? 1 : 0, l.place, l.rel, l.times);
          /* What the rules in scope found here replaces what they found
             before; a rule that is off keeps its last answers. */
          if (asked.length) dropFound.run(path, JSON.stringify(asked));
          for (const f of found ?? []) addFound.run(f.rule, path, JSON.stringify(f.matches), f.count, f.error ?? null, now, f.ms ?? null);
        }
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }

      views.set(path, {
        path,
        status,
        redirectTo: g.hops.length ? fetched.lands : null,
        inSitemap: Boolean(entry),
        kind,
        robotsHeader: fetched.robotsTag,
        facts,
        unread,
        inlinks: 0,
        broken: [],
        redirected: [],
        externalBroken: [],
      });

      /* What changed since the last crawl, in words. */
      if (!old) {
        if (!first) changes.push({ path, text: `New page: ${path}`, detail: facts?.title ?? `answers ${status}`, tone: "good", key: `new:${now.slice(0, 10)}` });
      } else {
        if (old.status !== status) {
          changes.push({ path, text: `${path}: now answers ${status || "nothing"}`, detail: `It answered ${old.status || "nothing"} at the crawl before.`, tone: status === 200 ? "good" : "bad", key: `status:${status}:${now.slice(0, 10)}` });
        }
        if (facts && oldFacts) {
          const said: string[] = [];
          const was = (label: string, a: string | null, b: string | null) => {
            if ((a ?? "") !== (b ?? "")) {
              said.push(label);
              changes.push({ path, text: `${path}: ${label} changed`, detail: `“${a ?? "none"}” → “${b ?? "none"}”`.slice(0, 400), tone: "info", key: `${label}:${hash}` });
            }
          };
          was("title", oldFacts.title, facts.title);
          was("description", oldFacts.description, facts.description);
          was("heading", oldFacts.h1[0] ?? null, facts.h1[0] ?? null);
          was("canonical", oldFacts.canonical, facts.canonical);
          const wasNo = saysNoindex(oldFacts, parse<Fetched>(old.fetched)?.robotsTag ?? null);
          const isNo = saysNoindex(facts, fetched.robotsTag);
          if (wasNo !== isNo) {
            said.push("indexing");
            changes.push({ path, text: `${path}: ${isNo ? "now says noindex" : "no longer says noindex"}`, tone: isNo ? "warn" : "good", key: `noindex:${isNo}:${hash}` });
          }
          if (contentChanged && !said.length) {
            changes.push({ path, text: `${path}: text changed`, detail: `${oldFacts.words} → ${facts.words} words`, tone: "info", key: `text:${hash}` });
          }
        }
        if (contentChanged) changed++;
      }

      progress(++done, paths.length, path);
      /* A crawl is the longest thing the scheduler runs, and it runs one job
         at a time: keep the uptime probe's two-minute beat going meanwhile. */
      await probeIfDue();
    },
    150,
  );

  /* 2b. Extraction rules that overran a page's deadline: switched off when
         they did so in the crawl before too (the count is kept in cc_state),
         with a line in the feed; a rule that ran clean starts counting again. */
  for (const r of extracting) {
    const key = `extract:overran:${r.id}`;
    const where = overrun.get(r.id);
    if (!where) {
      if (state(key)) setState(key, "");
      continue;
    }
    const times = Number(state(key) || 0) + 1;
    if (times < OVERRUNS_TO_SWITCH_OFF) {
      setState(key, String(times));
      continue;
    }
    db.prepare("UPDATE cc_extract_rules SET enabled = 0 WHERE id = ?").run(r.id);
    setState(key, "");
    note("crawl", `Extraction rule switched off: ${r.name}`, {
      tone: "warn",
      detail: `It ran for more than ${EXTRACT.pageMs / 1000} seconds on one page in ${times} crawls running (this time on ${where}) and was stopped each time. What it found before is kept; switch it on again once it is quicker.`,
      dedupe: `extract:off:${r.id}:${now}`,
    });
  }

  /* 3. Pages that left the set. A page the desk knew only from the repository
        is not "gone" because the repository could not be read this time: it
        is kept as it was, unread, until a crawl that can tell. */
  const gone = [...before.entries()].filter(([p, r]) => !wanted.has(p) && (shape !== null || r.listed_by === "sitemap")).map(([p]) => p);
  for (const p of gone) {
    db.prepare("DELETE FROM cc_pages WHERE path = ?").run(p);
    db.prepare("DELETE FROM cc_links WHERE source = ?").run(p);
    db.prepare("DELETE FROM cc_extract_results WHERE path = ?").run(p);
    changes.push({ path: p, text: `Page gone: ${p}`, detail: "It is no longer in the sitemap or the repository's page files.", tone: "warn", key: `gone:${now.slice(0, 10)}` });
  }

  /* 4. What every distinct link target answers. Crawled pages are known
        already; the rest are asked once each. */
  const targets = db.prepare("SELECT target, internal FROM cc_links GROUP BY target, internal").all() as { target: string; internal: number }[];
  const saveTarget = db.prepare(`
    INSERT INTO cc_targets (target, internal, status, landed, lands, outcome, remark, checked) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(target) DO UPDATE SET status = excluded.status, landed = excluded.landed, lands = excluded.lands, outcome = excluded.outcome, remark = excluded.remark, checked = excluded.checked
  `);

  const strays = targets.filter((t) => t.internal && !views.has(t.target)).map((t) => t.target);
  await pool(
    strays,
    3,
    async (t) => {
      const r = await checkInternal(t);
      if (r.loop) meet(r.loop);
      saveTarget.run(t, 1, r.status, r.landed, r.lands, r.outcome, r.remark, now);
    },
    150,
  );

  const lastChecked = new Map((db.prepare("SELECT target, checked FROM cc_targets WHERE internal = 0").all() as { target: string; checked: string }[]).map((r) => [r.target, Date.parse(r.checked)]));
  const outside = targets
    .filter((t) => !t.internal)
    .map((t) => t.target)
    .filter((t) => Date.now() - (lastChecked.get(t) ?? 0) > WEEK)
    .sort((a, b) => (lastChecked.get(a) ?? 0) - (lastChecked.get(b) ?? 0))
    .slice(0, EXTERNAL_PER_RUN);
  await pool(
    outside,
    2,
    async (t) => {
      const r = await checkExternal(t);
      saveTarget.run(t, 0, r.status, r.landed, r.lands, r.outcome, r.remark, now);
      await probeIfDue();
    },
    400,
  );
  /* Targets nothing links to any more. */
  db.exec("DELETE FROM cc_targets WHERE target NOT IN (SELECT target FROM cc_links)");

  /* 5. The redirects the site promises, each tried once. */
  const known = [...views.values()].filter((v) => v.status === 200).map((v) => v.path);
  const checks: RedirectCheck[] = [];
  for (const rule of shape?.redirects ?? []) {
    const ex = example(rule, known);
    checks.push(await checkRedirect(rule.source, rule.destination, rule.by, ex ? abs(ex.source) : null, ex ? pathOf(abs(ex.destination)) : null));
  }
  /* And the one no config file holds: the bare domain sends people to www. */
  checks.push(await checkRedirect(`https://${twinHost()}/`, `https://${siteHost()}/`, "hosting", `https://${twinHost()}/`, "/"));
  keep("site:redirects", checks);

  /* 6. Judge. */
  const statusOf = new Map<string, { outcome: Outcome; status: number; lands: string | null }>();
  /* A crawled page whose redirects go round in a loop is broken for whoever links to it. */
  const looping = new Set([...loops.values()].map((l) => l.met.page).filter((p): p is string => Boolean(p)));
  for (const v of views.values()) {
    statusOf.set(v.path, { outcome: v.status === 200 ? "ok" : looping.has(v.path) ? "broken" : v.status >= 300 && v.status < 400 ? "redirect" : "broken", status: v.status, lands: v.redirectTo ?? null });
  }
  for (const t of db.prepare("SELECT target, status, lands, outcome FROM cc_targets").all() as { target: string; status: number; lands: string | null; outcome: Outcome }[]) {
    if (!statusOf.has(t.target)) statusOf.set(t.target, { outcome: t.outcome, status: t.status, lands: t.lands });
  }
  for (const l of db.prepare("SELECT source, target, internal FROM cc_links GROUP BY source, target").all() as { source: string; target: string; internal: number }[]) {
    const from = views.get(l.source);
    const to = statusOf.get(l.target);
    if (l.internal && l.source !== l.target) {
      const dest = views.get(l.target);
      if (dest) dest.inlinks++;
    }
    if (!from || !to) continue;
    if (l.internal) {
      if (to.outcome === "broken") from.broken.push({ target: l.target, status: to.status });
      else if (to.outcome === "redirect") from.redirected.push({ target: l.target, to: to.lands });
    } else if (to.outcome === "broken") {
      from.externalBroken.push({ target: l.target, status: to.status });
    }
  }

  const siteIssues: Issue[] = [...map.issues];
  for (const c of checks) {
    /* A loop is its own finding (redirect.loop, below), not a broken redirect. */
    if (c.loop) meet({ hops: c.loop, statuses: [], met: { rule: c.source } });
    else if (c.outcome === "broken") siteIssues.push(issue("redirect.broken", null, `The redirect from ${c.source} to ${c.destination} does not work: ${c.remark}`, c.status, "a redirect that lands on 200", undefined, c.source));
    if (c.outcome === "chain") siteIssues.push(issue("redirect.chain", null, `The redirect from ${c.source}: ${c.remark}`, c.hops, 1, undefined, c.source));
  }
  /* Every loop once, with its hops and how the crawl met it. */
  const linkedFrom = db.prepare("SELECT DISTINCT source FROM cc_links WHERE target = ? AND internal = 1 ORDER BY source LIMIT 6");
  for (const l of loops.values()) {
    const start = l.hops[0] as string;
    const sources = (linkedFrom.all(l.met.link ?? l.met.page ?? start) as { source: string }[]).map((r) => r.source);
    const how = [
      l.met.rule ? `the redirect rule from ${l.met.rule} leads into it` : "",
      l.met.page ? `${l.met.page} is one of the pages the crawl reads` : "",
      sources.length ? `linked from ${sources.slice(0, 5).join(", ")}${sources.length > 5 ? " and more" : ""}` : "",
    ].filter(Boolean);
    siteIssues.push(
      issue(
        "redirect.loop",
        null,
        `${start} redirects in a loop and never lands: ${l.hops.join(" → ")}${l.statuses.length ? ` (${l.statuses.join(", ")})` : ""}. A browser gives up with an error.${how.length ? ` ${how.join("; ").replace(/^[a-z]/, (c) => c.toUpperCase())}.` : ""}`,
        l.hops.length - 1,
        "a redirect that lands on 200",
        l.hops,
        start,
      ),
    );
  }

  const verdict = judge([...views.values()], siteIssues, shape?.defaultShare ?? null);

  /* 7. Store the verdict. */
  db.exec("BEGIN");
  try {
    const setScore = db.prepare("UPDATE cc_pages SET score = ? WHERE path = ?");
    for (const [p, s] of verdict.scores) setScore.run(s, p);
    const save = db.prepare(`
      INSERT INTO cc_issues (id, rule, severity, path, text, measured, bound, related, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET severity = excluded.severity, text = excluded.text, measured = excluded.measured, bound = excluded.bound, related = excluded.related, last_seen = excluded.last_seen
    `);
    for (const i of verdict.issues) {
      save.run(i.id, i.rule, i.severity, i.path, i.text, JSON.stringify(i.measured), JSON.stringify(i.limit), i.related ? JSON.stringify(i.related) : null, now, now);
    }
    /* An issue this crawl did not find again is resolved, and leaves. */
    db.prepare("DELETE FROM cc_issues WHERE last_seen < ?").run(now);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  /* 8. Say what changed, and write today's line of history. */
  if (first) {
    note("crawl", `First read of the website: ${paths.length} pages`, { detail: `${map.entries.length} in the sitemap, ${paths.length - map.entries.length} kept out of it`, dedupe: "crawl:first" });
  }
  for (const c of changes.slice(0, 60)) {
    note("page", c.text, { tone: c.tone, href: abs(c.path), dedupe: `page:${c.path}:${c.key}`, ...(c.detail ? { detail: c.detail } : {}) });
  }

  const counts: Record<Severity, number> = { critical: 0, warning: 0, opportunity: 0 };
  for (const i of verdict.issues) counts[i.severity]++;
  /* The history only the desk has: nobody can ask in arrears what the site
     scored last Tuesday. */
  if (verdict.siteScore !== null) record("seo.score", verdict.siteScore);
  record("seo.pages", paths.length);
  record("seo.issues.critical", counts.critical);
  record("seo.issues.warning", counts.warning);
  record("seo.issues.opportunity", counts.opportunity);

  const finished = new Date();
  const linkCount = db.prepare("SELECT SUM(internal) AS i, SUM(1 - internal) AS e FROM cc_links").get() as { i: number | null; e: number | null };
  const summary: CrawlSummary = {
    started: now,
    finished: finished.toISOString(),
    seconds: Math.round((finished.getTime() - started.getTime()) / 100) / 10,
    pages: paths.length,
    inSitemap: map.entries.length,
    outsideSitemap: paths.length - map.entries.length,
    changed,
    added: first ? 0 : paths.filter((p) => !before.has(p)).length,
    gone: gone.length,
    siteScore: verdict.siteScore,
    issues: counts,
    links: { internal: linkCount.i ?? 0, external: linkCount.e ?? 0, targetsChecked: strays.length, externalChecked: outside.length },
    withoutRepo: shape === null,
    defaultShare: shape?.defaultShare ?? null,
  };
  keep("site:crawl", summary);
  setState("site:crawl:finished", summary.finished);
  /* Which set of sitemap addresses this crawl read: the sitemap job asks for
     a crawl until this matches what the sitemap lists now (sitemap.ts). */
  setState("site:crawl:sitemap", fingerprint(map.entries.map((e) => e.path)));
  return summary;
}

export const crawlJob: Job = {
  name: "crawl",
  title: "Read every page of the website",
  every: 24 * 3600,
  delay: 90,
  run: async ({ progress }) => {
    const s = await crawl(progress);
    return `${s.pages} pages in ${s.seconds}s, ${s.changed} changed; score ${s.siteScore ?? "none"}; ${s.issues.critical} critical, ${s.issues.warning} warnings, ${s.issues.opportunity} opportunities${s.withoutRepo ? "; repository not readable" : ""}`;
  },
};

/* ---------- reading it back ------------------------------------------------------ */

const NOT_YET = "The first crawl has not finished yet. It starts about a minute after the desk does and takes under a minute.";

/** When the last crawl finished, ISO, or null before the first. */
export const crawledAt = (): string | null => state("site:crawl:finished");

/** The last crawl in numbers. */
export function crawlSummary(): Reading<CrawlSummary> {
  const had = kept<CrawlSummary>("site:crawl");
  return had ? ok(had.value, "crawl", had.value.finished) : waiting("crawl", NOT_YET);
}

export interface PageRow {
  /** The stored address: "/seo". */
  path: string;
  /** The address on the live site. */
  url: string;
  kind: PageKind;
  /** The kind as the Pages screen prints it: "Service", "Industry"… */
  kindLabel: string;
  /** What the address answered. 0: nothing. */
  status: number;
  /** Where it redirects to, when it does. */
  redirectTo: string | null;
  inSitemap: boolean;
  /** How the desk knows the page: from the sitemap, or from the repository ("route": a page file; "unlisted": an article not yet in the menus). */
  listedBy: "sitemap" | "route" | "unlisted";
  /** Answers 200 and does not say noindex. */
  indexable: boolean;
  title: string | null;
  description: string | null;
  h1: string | null;
  /** Words of own content, or null when the page was not read. */
  words: number | null;
  /** 0 to 100 by the table in rules.ts; null for a page that is not scored (kept out of the sitemap, or answered 200 and could not be read: see its page.unreadable finding). */
  score: number | null;
  issues: Record<Severity, number>;
  /** Other pages linking here: from anywhere on them, and from their own content only (not the menu or footer). */
  inlinks: number;
  inlinksFromContent: number;
  /** Distinct addresses on the site this page links to. */
  outlinks: number | null;
  /** The share picture, as the page names it. */
  sharePicture: string | null;
  schemaTypes: string[];
  /** Milliseconds to first byte and to the last, at the last crawl, from the desk's server. One sample: a hint, not a measurement. */
  ttfb: number | null;
  total: number | null;
  /** Bytes of HTML, uncompressed. */
  bytes: number | null;
  /** Vercel's cache answer at the last crawl. */
  cache: string | null;
  /** The sitemap's own date for the page. The site gives one to articles only. */
  lastmod: string | null;
  firstSeen: string;
  lastSeen: string;
  /** When the desk last saw its content or status differ from the crawl before. */
  lastChanged: string | null;
}

function rows(): PageRow[] {
  const map = new Map((lastSitemap()?.entries ?? []).map((e) => [e.path, e]));
  const inAll = new Map((db.prepare("SELECT target, COUNT(DISTINCT source) AS n FROM cc_links WHERE internal = 1 AND source <> target GROUP BY target").all() as { target: string; n: number }[]).map((r) => [r.target, r.n]));
  const inMain = new Map((db.prepare("SELECT target, COUNT(DISTINCT source) AS n FROM cc_links WHERE internal = 1 AND place = 'main' AND source <> target GROUP BY target").all() as { target: string; n: number }[]).map((r) => [r.target, r.n]));
  const tally = new Map<string, Record<Severity, number>>();
  for (const r of db.prepare("SELECT path, severity, COUNT(*) AS n FROM cc_issues WHERE path IS NOT NULL GROUP BY path, severity").all() as { path: string; severity: Severity; n: number }[]) {
    const t = tally.get(r.path) ?? { critical: 0, warning: 0, opportunity: 0 };
    t[r.severity] = r.n;
    tally.set(r.path, t);
  }
  return (db.prepare("SELECT * FROM cc_pages ORDER BY path").all() as unknown as Row[]).map((r) => {
    const facts = parse<PageFacts>(r.facts);
    const f = parse<Fetched>(r.fetched);
    return {
      path: r.path,
      url: abs(r.path),
      kind: r.kind,
      kindLabel: KIND_LABEL[r.kind] ?? r.kind,
      status: r.status,
      redirectTo: f?.hops.length ? f.lands : null,
      inSitemap: Boolean(r.in_sitemap),
      listedBy: r.listed_by,
      indexable: r.status === 200 && !saysNoindex(facts, f?.robotsTag ?? null),
      title: r.title,
      description: r.descr,
      h1: r.heading,
      words: facts?.words ?? null,
      score: r.score,
      issues: tally.get(r.path) ?? { critical: 0, warning: 0, opportunity: 0 },
      inlinks: inAll.get(r.path) ?? 0,
      inlinksFromContent: inMain.get(r.path) ?? 0,
      outlinks: facts?.links.internal ?? null,
      sharePicture: facts?.og.image ?? null,
      schemaTypes: facts?.schemaTypes ?? [],
      ttfb: f?.ttfb ?? null,
      total: f?.total ?? null,
      bytes: f?.bytes ?? null,
      cache: f?.vercelCache ?? null,
      lastmod: map.get(r.path)?.lastmod ?? null,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      lastChanged: r.last_changed,
    };
  });
}

const read = <T>(make: () => T, noteText?: string): Reading<T> => {
  const at = crawledAt();
  return at ? ok(make(), "crawl", at, noteText) : waiting("crawl", NOT_YET);
};

/** Every page the desk knows, one row each. The Pages table. */
export const inventory = (): Reading<PageRow[]> => read(rows);

export interface PageDetail extends PageRow {
  /** Everything parse.ts read; null when the page did not answer 200. */
  facts: PageFacts | null;
  fetched: Fetched | null;
  issues: Record<Severity, number>;
  /** The page's issues, worst first. */
  findings: Issue[];
  /** Who links here. */
  linksIn: { source: string; text: string; place: "main" | "chrome" }[];
  /** Where it links, with what each target answered. */
  linksOut: { target: string; text: string; internal: boolean; place: "main" | "chrome"; rel: string; outcome: Outcome | null; status: number | null }[];
}

/** One page with everything known about it. `off` when the desk has no such address. */
export function page(path: string): Reading<PageDetail> {
  const at = crawledAt();
  if (!at) return waiting("crawl", NOT_YET);
  const row = rows().find((r) => r.path === path);
  const raw = db.prepare("SELECT facts, fetched FROM cc_pages WHERE path = ?").get(path) as { facts: string | null; fetched: string } | undefined;
  if (!row || !raw) return { state: "off", source: "crawl", reason: `The crawl knows no page at ${path}: it is not in the sitemap and not among the repository's page files.` };
  const status = targetStatus();
  return ok(
    {
      ...row,
      facts: parse<PageFacts>(raw.facts),
      fetched: parse<Fetched>(raw.fetched),
      findings: listIssues({ path }),
      linksIn: db.prepare("SELECT source, text, place FROM cc_links WHERE target = ? AND internal = 1 AND source <> ? ORDER BY place DESC, source").all(path, path) as { source: string; text: string; place: "main" | "chrome" }[],
      linksOut: (db.prepare("SELECT target, text, internal, place, rel FROM cc_links WHERE source = ? ORDER BY internal DESC, place DESC, target").all(path) as { target: string; text: string; internal: number; place: "main" | "chrome"; rel: string }[]).map((l) => ({
        ...l,
        internal: Boolean(l.internal),
        outcome: status.get(l.target)?.outcome ?? null,
        status: status.get(l.target)?.status ?? null,
      })),
    },
    "crawl",
    at,
  );
}

/** What every link target answered: crawled pages by their own status, the rest from the one check each got. */
function targetStatus(): Map<string, { outcome: Outcome; status: number; lands: string | null; remark: string | null; checked: string | null }> {
  const out = new Map<string, { outcome: Outcome; status: number; lands: string | null; remark: string | null; checked: string | null }>();
  for (const r of db.prepare("SELECT path, status, fetched, last_seen FROM cc_pages").all() as { path: string; status: number; fetched: string; last_seen: string }[]) {
    out.set(r.path, {
      outcome: r.status === 200 ? "ok" : r.status >= 300 && r.status < 400 ? "redirect" : "broken",
      status: r.status,
      lands: parse<Fetched>(r.fetched)?.lands ?? null,
      remark: null,
      checked: r.last_seen,
    });
  }
  for (const t of db.prepare("SELECT target, status, lands, outcome, remark, checked FROM cc_targets").all() as { target: string; status: number; lands: string | null; outcome: Outcome; remark: string | null; checked: string }[]) {
    if (!out.has(t.target)) out.set(t.target, t);
  }
  return out;
}

const RANK: Record<Severity, number> = { critical: 0, warning: 1, opportunity: 2 };

export interface Finding extends Issue {
  /** What the rule is called in a list. */
  title: string;
  /** The checklist line it belongs under. */
  area: (typeof RULES)[RuleId]["area"];
  /** Points it costs (the page for a page rule, the site for a site rule). */
  cost: number;
  /** When a crawl first found it. */
  firstSeen: string;
}

function listIssues(filter: { path?: string | null; rule?: RuleId; severity?: Severity; area?: Finding["area"] } = {}): Finding[] {
  const all = db.prepare("SELECT id, rule, severity, path, text, measured, bound, related, first_seen FROM cc_issues").all() as {
    id: string;
    rule: RuleId;
    severity: Severity;
    path: string | null;
    text: string;
    measured: string | null;
    bound: string | null;
    related: string | null;
    first_seen: string;
  }[];
  return all
    .filter((r) => RULES[r.rule])
    .filter((r) => (filter.path === undefined || r.path === filter.path) && (!filter.rule || r.rule === filter.rule) && (!filter.severity || r.severity === filter.severity) && (!filter.area || RULES[r.rule].area === filter.area))
    .map((r) => ({
      id: r.id,
      rule: r.rule,
      severity: r.severity,
      path: r.path,
      text: r.text,
      measured: parse<number | string>(r.measured),
      limit: parse<number | string>(r.bound),
      ...(r.related ? { related: parse<string[]>(r.related) ?? [] } : {}),
      title: RULES[r.rule].title,
      area: RULES[r.rule].area,
      cost: RULES[r.rule].cost,
      firstSeen: r.first_seen,
    }))
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || RULES[b.rule].cost - RULES[a.rule].cost || (a.path ?? "").localeCompare(b.path ?? ""));
}

/**
 * The issues the last crawl found, worst first. Filter by page (`path: null`
 * is "about the site, not a page"), by rule, by severity or by checklist area.
 */
export const issues = (filter: { path?: string | null; rule?: RuleId; severity?: Severity; area?: Finding["area"] } = {}): Reading<Finding[]> => read(() => listIssues(filter));

export interface IssueCounts {
  critical: number;
  warning: number;
  opportunity: number;
  /** One line per rule that fired: how many findings, on how many pages. */
  byRule: { rule: RuleId; title: string; area: Finding["area"]; severity: Severity; cost: number; count: number }[];
  /** The SEO screen's checklist: per area, how many findings and the worst severity among them (null: none, the line is green). */
  byArea: { area: Finding["area"]; count: number; worst: Severity | null }[];
}

/** How many issues, by severity, by rule and by checklist area. */
export function issueCounts(): Reading<IssueCounts> {
  return read(() => {
    const all = listIssues();
    const byRule = new Map<RuleId, number>();
    for (const i of all) byRule.set(i.rule, (byRule.get(i.rule) ?? 0) + 1);
    const areas = [...new Set(Object.values(RULES).map((r) => r.area))];
    return {
      critical: all.filter((i) => i.severity === "critical").length,
      warning: all.filter((i) => i.severity === "warning").length,
      opportunity: all.filter((i) => i.severity === "opportunity").length,
      byRule: [...byRule].map(([rule, count]) => ({ rule, title: RULES[rule].title, area: RULES[rule].area, severity: RULES[rule].severity, cost: RULES[rule].cost, count })).sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.count - a.count),
      byArea: areas.map((area) => {
        const mine = all.filter((i) => i.area === area);
        return { area, count: mine.length, worst: mine.length ? (mine[0] as Finding).severity : null };
      }),
    };
  });
}

/** Pages in the sitemap that no other page links to. */
export const orphans = (): Reading<PageRow[]> => read(() => rows().filter((r) => r.inSitemap && r.path !== "/" && r.inlinks === 0));

/** Pages whose own content is under the thin-page yardstick (rules.ts LIMITS.thinWords). */
export const thinPages = (): Reading<PageRow[]> => read(() => {
  const thin = new Set(listIssues({ rule: "content.thin" }).map((i) => i.path));
  return rows().filter((r) => thin.has(r.path));
});

export interface BrokenLink {
  /** The address that does not answer. */
  target: string;
  /** What it answered; 0 for nothing. On the site the first answer; for an outside address the final one, after its redirects. */
  status: number;
  internal: boolean;
  /** "broken", or "redirect" for a link that works through a redirect. */
  outcome: Outcome;
  /** Where a redirect lands. */
  lands: string | null;
  remark: string | null;
  /** The pages that carry the link, with its words. */
  sources: { path: string; text: string; place: "main" | "chrome" }[];
}

function linksWith(internal: boolean, outcomes: Outcome[]): BrokenLink[] {
  const status = targetStatus();
  const by = new Map<string, BrokenLink>();
  for (const l of db.prepare("SELECT source, target, text, place FROM cc_links WHERE internal = ? ORDER BY target, source").all(internal ? 1 : 0) as { source: string; target: string; text: string; place: "main" | "chrome" }[]) {
    const s = status.get(l.target);
    if (!s || !outcomes.includes(s.outcome)) continue;
    const hit = by.get(l.target) ?? { target: l.target, status: s.status, internal, outcome: s.outcome, lands: s.lands, remark: s.remark, sources: [] };
    hit.sources.push({ path: l.source, text: l.text, place: l.place });
    by.set(l.target, hit);
  }
  return [...by.values()];
}

/** Links to addresses on the site that do not answer. Each target once, with every page that links to it. */
export const brokenLinks = (): Reading<BrokenLink[]> => read(() => linksWith(true, ["broken"]));

/** Links on the site that work only through a redirect. */
export const redirectedLinks = (): Reading<BrokenLink[]> => read(() => linksWith(true, ["redirect"]));

/**
 * Links to other sites: the ones that are gone ("broken") and the ones that
 * would not be checked ("unchecked": refused, timed out, or failing on their
 * side, which is not the same as broken). Each is asked at most once a week.
 */
export const externalLinks = (which: "broken" | "unchecked" | "ok" | "all" = "broken"): Reading<BrokenLink[]> =>
  read(() => linksWith(false, which === "all" ? ["ok", "broken", "unchecked", "redirect"] : [which]), "Other sites are asked at most once a week; many refuse automated checks, which is reported as “could not check”, not as broken.");

/** Every redirect the site's config promises, and the bare domain's, each tried once at the last crawl. */
export function redirects(): Reading<RedirectCheck[]> {
  const had = kept<RedirectCheck[]>("site:redirects");
  return had ? ok(had.value, "crawl", had.at) : waiting("crawl", NOT_YET);
}

/** Titles or descriptions that more than one page in the sitemap carries. */
export function duplicates(): Reading<{ field: "title" | "description"; value: string; pages: string[] }[]> {
  return read(() => {
    const out: { field: "title" | "description"; value: string; pages: string[] }[] = [];
    const offered = rows().filter((r) => r.inSitemap && r.indexable);
    for (const field of ["title", "description"] as const) {
      const by = new Map<string, { value: string; pages: string[] }>();
      for (const r of offered) {
        const v = r[field]?.trim();
        if (!v) continue;
        const hit = by.get(v.toLowerCase()) ?? { value: v, pages: [] };
        hit.pages.push(r.path);
        by.set(v.toLowerCase(), hit);
      }
      for (const g of by.values()) if (g.pages.length > 1) out.push({ field, ...g });
    }
    return out;
  });
}

export interface RouteHealth {
  total: number;
  /** Answer 200. */
  healthy: number;
  /** Answer 3xx. */
  redirects: number;
  /** Answer 4xx. */
  clientErrors: number;
  /** Answer 5xx. */
  serverErrors: number;
  /** Did not answer at all. */
  unanswered: number;
}

/** How the site's addresses answered at the last crawl, by class. */
export const routeHealth = (): Reading<RouteHealth> =>
  read(() => {
    const all = rows();
    const n = (pred: (s: number) => boolean) => all.filter((r) => pred(r.status)).length;
    return {
      total: all.length,
      healthy: n((s) => s === 200),
      redirects: n((s) => s >= 300 && s < 400),
      clientErrors: n((s) => s >= 400 && s < 500),
      serverErrors: n((s) => s >= 500),
      unanswered: n((s) => s === 0),
    };
  });

export interface MetadataStatus {
  /** Pages in the sitemap that answered and were read. */
  total: number;
  /** Have a title, a description, a share picture and structured data of some kind. */
  complete: number;
  missingTitle: number;
  missingDescription: number;
  missingSharePicture: number;
  /** No structured data at all. */
  missingSchema: number;
  /**
   * On the site's default share picture: it has none of its own. Null when
   * the last crawl did not know which picture is the default (the repository
   * could not be read), so the rule could not be applied: not "none".
   */
  onDefaultSharePicture: number | null;
}

/** Which of the sitemap's pages lack a title, a description, a share picture or structured data. */
export function metadataStatus(): Reading<MetadataStatus> {
  /* A summary kept before the default picture was recorded says nothing
     either way: unknown, like a crawl that could not read it. */
  const knewDefault = Boolean(kept<CrawlSummary>("site:crawl")?.value.defaultShare);
  return read(
    () => {
      const all = rows().filter((r) => r.inSitemap && r.status === 200 && r.words !== null);
      const missing = (rule: RuleId) => new Set(listIssues({ rule }).map((i) => i.path));
      const noTitle = missing("title.missing");
      const noDesc = missing("description.missing");
      const noShare = missing("share.missing");
      const noSchema = missing("schema.none");
      return {
        total: all.length,
        complete: all.filter((r) => !noTitle.has(r.path) && !noDesc.has(r.path) && !noShare.has(r.path) && !noSchema.has(r.path)).length,
        missingTitle: all.filter((r) => noTitle.has(r.path)).length,
        missingDescription: all.filter((r) => noDesc.has(r.path)).length,
        missingSharePicture: all.filter((r) => noShare.has(r.path)).length,
        missingSchema: all.filter((r) => noSchema.has(r.path)).length,
        onDefaultSharePicture: knewDefault ? missing("share.default-picture").size : null,
      };
    },
    knewDefault ? undefined : "Which pages share the site's default picture is not known: the last crawl could not read the default from the website's repository (lib/site.ts).",
  );
}

/** How many pages of each kind, for the tabs. `key` is the PageKind. */
export const kinds = (): Reading<Share[]> =>
  read(() => {
    const all = rows();
    return (Object.keys(KIND_LABEL) as PageKind[]).map((k) => ({ key: k, label: KIND_LABEL[k], value: all.filter((r) => r.kind === k).length })).filter((s) => s.value > 0);
  });

/** Every structured-data type on the site and how many pages carry it. */
export const schemaTypes = (): Reading<Share[]> =>
  read(() => {
    const by = new Map<string, number>();
    for (const r of rows()) for (const t of r.schemaTypes) by.set(t, (by.get(t) ?? 0) + 1);
    return [...by].map(([key, value]) => ({ key, label: key, value })).sort((a, b) => b.value - a.value);
  });

const dayPoints = (metric: string, days: number): DayPoint[] => series(metric, days).map((p) => ({ date: p.day, value: p.value }));

/**
 * How far from the start of a period the comparison point may lie. The crawl
 * runs once a day, but a desk that was down misses a day; a point two days
 * off the start still says "about a month ago". Further off, it does not.
 */
const PREVIOUS_SLACK_DAYS = 2;

/** Whole days from one YYYY-MM-DD to another. */
const dayGap = (a: string, b: string): number => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000;

/**
 * One of the crawl's daily figures as a headline: today's value, the value at
 * the start of the period (`days` ago) as `previous`, and the line between.
 *
 * `previous` is the recorded point closest to that day, and only when one
 * lies within PREVIOUS_SLACK_DAYS of it. While the history is younger than
 * the period, there is no such point and `previous` is null: two days of
 * history are not a 30-day comparison. The history starts the day the desk
 * first crawled.
 */
function daily(metric: string, days: number, unit: Stat["unit"], noteText: string, of?: number): Reading<Stat> {
  const at = crawledAt();
  const line = series(metric, days);
  const last = line[line.length - 1];
  if (!at || !last) return waiting("crawl", NOT_YET);
  const start = today(-days);
  const near = series(metric, days + PREVIOUS_SLACK_DAYS)
    .filter((p) => p.day !== last.day && dayGap(p.day, start) <= PREVIOUS_SLACK_DAYS)
    /* The closest; on a tie, the earlier one. */
    .sort((a, b) => dayGap(a.day, start) - dayGap(b.day, start) || a.day.localeCompare(b.day))[0];
  return ok(
    {
      value: last.value,
      previous: near ? near.value : null,
      unit,
      series: line.map((p) => p.value),
      ...(of !== undefined ? { of } : {}),
    },
    "crawl",
    at,
    noteText,
  );
}

/** The site's SEO score out of 100, by the table in rules.ts, with its daily history. `previous` is the score `days` ago, or null while the history is younger. */
export const siteScore = (days = 30): Reading<Stat> =>
  daily("seo.score", days, "score", "The desk's own score by its own stated rules (src/cc/site/rules.ts), recorded once a day since the first crawl. It is not a figure from Google.", 100);

/** How many addresses the crawl reads, with the daily history. `previous` as for siteScore. */
export const pageCount = (days = 30): Reading<Stat> =>
  daily("seo.pages", days, "count", "Addresses the desk's crawl read each day: every address in the sitemap, and the pages the website's repository keeps out of it.");

/** How many issues of one severity, with the daily history. `previous` as for siteScore. */
export const issueTrend = (severity: Severity, days = 30): Reading<Stat> =>
  daily(`seo.issues.${severity}`, days, "count", `${severity === "critical" ? "Critical findings" : severity === "warning" ? "Warnings" : "Opportunities"} of the desk's crawl by the rules in src/cc/site/rules.ts, counted once a day since the first crawl.`);

/** The daily history of the score as dated points, for a chart with an axis. */
export const scoreHistory = (days = 90): Reading<DayPoint[]> => read(() => dayPoints("seo.score", days));

/** Pages whose address, title, description or heading contains `q`. For the top bar's search and the Pages filter. */
export function findPages(q: string, limit = 20): PageRow[] {
  const needle = q.trim().toLowerCase();
  if (!needle || !crawledAt()) return [];
  const like = `%${needle.replace(/[%_\\]/g, "\\$&")}%`;
  const hits = new Set(
    (db.prepare("SELECT path FROM cc_pages WHERE lower(path) LIKE ? ESCAPE '\\' OR lower(title) LIKE ? ESCAPE '\\' OR lower(heading) LIKE ? ESCAPE '\\' OR lower(descr) LIKE ? ESCAPE '\\' LIMIT ?").all(like, like, like, like, limit * 3) as { path: string }[]).map((r) => r.path),
  );
  const rank = (r: PageRow) => (r.path.toLowerCase().includes(needle) ? 0 : (r.title ?? "").toLowerCase().includes(needle) ? 1 : 2);
  return rows()
    .filter((r) => hits.has(r.path))
    .sort((a, b) => rank(a) - rank(b) || a.path.length - b.path.length)
    .slice(0, limit);
}

/* ---------- duplicates, as the last crawl found them ------------------------------ */

/**
 * The duplicate-content findings of the last crawl (rules.ts: content.duplicate,
 * content.near-duplicate, h1.duplicate, h2.duplicate), as groups and pairs
 * rather than one finding per page.
 */
export function contentDuplicates(): Reading<SpiderDuplicates> {
  return read(() => {
    const groups = (rule: RuleId): string[][] => {
      const seen = new Map<string, string[]>();
      for (const f of listIssues({ rule })) {
        if (!f.path) continue;
        const pages = [...new Set([f.path, ...(f.related ?? [])])].sort();
        seen.set(pages.join("\n"), pages);
      }
      return [...seen.values()];
    };
    const near = new Map<string, { a: string; b: string; similarity: number }>();
    for (const f of listIssues({ rule: "content.near-duplicate" })) {
      const other = f.related?.[0];
      if (!f.path || !other) continue;
      const [a, b] = [f.path, other].sort() as [string, string];
      near.set(`${a}\n${b}`, { a, b, similarity: typeof f.measured === "number" ? f.measured : Number(f.measured) });
    }
    const heading = new Map((db.prepare("SELECT path, heading FROM cc_pages").all() as { path: string; heading: string | null }[]).map((r) => [r.path, r.heading ?? ""]));
    return {
      exact: groups("content.duplicate").map((pages) => ({ pages })),
      near: [...near.values()].sort((x, y) => y.similarity - x.similarity),
      h1: groups("h1.duplicate").map((pages) => ({ heading: heading.get(pages[0] as string) ?? "", pages })),
      h2: groups("h2.duplicate").map((pages) => ({ pages })),
      threshold: LIMITS.nearDuplicate,
    };
  });
}

/* ---------- custom extraction rules (extract.ts) ------------------------------------- */

interface RuleRow {
  id: number;
  name: string;
  kind: "css" | "regex" | "xpath";
  expression: string;
  attribute: string | null;
  scope: string | null;
  enabled: number;
  added_by: string;
  added_at: string;
}

/** Rules kept, at most. A rule is a question asked of every page at every crawl. */
const RULES_KEPT = 50;

/**
 * Crawls running in which a rule ran past a page's deadline before it is
 * switched off. Two: once can be a machine that was busy for ten seconds;
 * twice running is the rule.
 */
const OVERRUNS_TO_SWITCH_OFF = 2;

/** Whether a rule runs on a page: every page, or those whose stored address begins with its scope. */
const inScope = (r: ExtractRuleDef & { scope: string | null }, path: string): boolean => !r.scope || path.startsWith(r.scope);

/** The rules that are on, as the crawl runs them, with their names for what the crawl says about them. */
function activeRules(): (ExtractRuleDef & { scope: string | null; name: string })[] {
  return (db.prepare("SELECT id, name, kind, expression, attribute, scope FROM cc_extract_rules WHERE enabled = 1 ORDER BY id").all() as unknown as RuleRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    expression: r.expression,
    attribute: r.attribute,
    scope: r.scope,
  }));
}

function ruleOf(r: RuleRow): ExtractRule {
  const ran = db.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN count > 0 THEN 1 ELSE 0 END) AS hit, MAX(at) AS at, MAX(ms) AS slow FROM cc_extract_results WHERE rule = ?").get(r.id) as {
    n: number;
    hit: number | null;
    at: string | null;
    slow: number | null;
  };
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    expression: r.expression,
    attribute: r.attribute,
    scope: r.scope,
    enabled: Boolean(r.enabled),
    addedBy: r.added_by,
    addedAt: r.added_at,
    pagesRun: ran.n,
    pagesMatched: ran.hit ?? 0,
    lastRun: ran.at,
    slowestMs: ran.slow,
  };
}

/** Every custom extraction rule, oldest first. */
export function extractRules(): ExtractRule[] {
  return (db.prepare("SELECT * FROM cc_extract_rules ORDER BY id").all() as unknown as RuleRow[]).map(ruleOf);
}

/** One rule, or null. */
export function extractRule(id: number): ExtractRule | null {
  const r = db.prepare("SELECT * FROM cc_extract_rules WHERE id = ?").get(id) as unknown as RuleRow | undefined;
  return r ? ruleOf(r) : null;
}

/** Why no rule can be added now (the table is full, or as many are on as a crawl runs), or null. */
function noRoom(): string | null {
  const count = db.prepare("SELECT COUNT(*) AS n, SUM(enabled) AS on_ FROM cc_extract_rules").get() as { n: number; on_: number | null };
  if (count.n >= RULES_KEPT) return `The desk keeps at most ${RULES_KEPT} rules; delete one first.`;
  if ((count.on_ ?? 0) >= EXTRACT.enabled) return `${EXTRACT.enabled} rules are on already, the most a crawl runs; switch one off first.`;
  return null;
}

/**
 * Add a rule, after extract.ts's checks: what can be seen in it
 * (`validateRule`), then how long it takes on the desk's test page, timed in
 * the extraction thread (`trialRule`, a few hundred milliseconds at most,
 * never in the desk's own thread). It runs from the next crawl on. Returns
 * the rule, or the reason it was refused.
 */
export async function addExtractRule(input: ExtractRuleInput, by: string): Promise<{ ok: true; rule: ExtractRule } | { ok: false; reason: string }> {
  const checked = validateRule({ name: input.name, kind: input.kind, expression: input.expression, attribute: input.attribute ?? null });
  if (!checked.ok) return checked;
  const scope = input.scope === undefined || input.scope === null || input.scope.trim() === "" ? null : input.scope.trim();
  if (scope !== null && (!scope.startsWith("/") || scope.length > 200 || /\s/.test(scope))) return { ok: false, reason: "A scope is the beginning of an address on the site, starting with / (\"/insights/\"), or nothing for every page." };
  const full = noRoom();
  if (full) return { ok: false, reason: full };
  const trial = await trialRule({ kind: checked.rule.kind, expression: checked.rule.expression });
  if (!trial.ok) return trial;
  /* Asked again: another rule may have been added while this one was tried. */
  const fullNow = noRoom();
  if (fullNow) return { ok: false, reason: fullNow };
  const r = checked.rule;
  const at = new Date().toISOString();
  const res = db.prepare("INSERT INTO cc_extract_rules (name, kind, expression, attribute, scope, enabled, added_by, added_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)").run(r.name, r.kind, r.expression, r.attribute, scope, by, at);
  return { ok: true, rule: extractRule(Number(res.lastInsertRowid)) as ExtractRule };
}

/** Switch a rule on or off (`enabled` absent: the other way). Null when there is no such rule; the reason when it may not be switched on. */
export function toggleExtractRule(id: number, enabled?: boolean): { ok: true; rule: ExtractRule } | { ok: false; reason: string } | null {
  const had = extractRule(id);
  if (!had) return null;
  const want = enabled ?? !had.enabled;
  if (want && !had.enabled) {
    const on = (db.prepare("SELECT COUNT(*) AS n FROM cc_extract_rules WHERE enabled = 1").get() as { n: number }).n;
    if (on >= EXTRACT.enabled) return { ok: false, reason: `${EXTRACT.enabled} rules are on already, the most a crawl runs; switch one off first.` };
  }
  db.prepare("UPDATE cc_extract_rules SET enabled = ? WHERE id = ?").run(want ? 1 : 0, id);
  return { ok: true, rule: extractRule(id) as ExtractRule };
}

/** Delete a rule and everything it found. False when there was no such rule. */
export function deleteExtractRule(id: number): boolean {
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM cc_extract_results WHERE rule = ?").run(id);
    const gone = db.prepare("DELETE FROM cc_extract_rules WHERE id = ?").run(id).changes > 0;
    db.exec("COMMIT");
    return gone;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** What one rule found at the last crawl it ran in, page by page, pages with matches first. Null when there is no such rule. */
export function extractResults(id: number): ExtractResults | null {
  const rule = extractRule(id);
  if (!rule) return null;
  const pages = (
    db.prepare("SELECT path, matches, count, error, at, ms FROM cc_extract_results WHERE rule = ? ORDER BY (count > 0) DESC, path").all(id) as { path: string; matches: string; count: number; error: string | null; at: string; ms: number | null }[]
  ).map((r): ExtractResultRow => ({ path: r.path, matches: parse<string[]>(r.matches) ?? [], count: r.count, error: r.error, at: r.at, ms: r.ms }));
  return { rule, pages };
}
