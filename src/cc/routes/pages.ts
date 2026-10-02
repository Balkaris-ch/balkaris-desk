import { Hono } from "hono";
import type { Vars } from "../access.ts";
import { status as jobStatus } from "../scheduler.ts";
import { specimenAllowed } from "../specimen.ts";
import { activity, keep, kept, ok, off, reading, series, state, today, waiting } from "../store.ts";
import { everyone } from "../../people.ts";
import type { Range, Reading, Stat } from "../../../web/src/contract/common.ts";
import type {
  ConversionColumn,
  MetadataPanel,
  PageActivityItem,
  PageEventRow,
  PageFactsView,
  PageFinding,
  PageFlags,
  PageHistoryItem,
  PageImage,
  PageInspectionView,
  PageListRow,
  PagesPayload,
  PagesPeriod,
  PageScoreView,
  PageSearchView,
  PageSpeedView,
  PageState,
  PagesTiles,
  PageTrafficView,
  PageType,
  PageUpdate,
  PageViewPayload,
  RouteHealthPanel,
  TrafficColumn,
} from "../../../web/src/contract/pages.ts";
import type { Ask, Span } from "../ga4.ts";
import type { CommitFiles, Finding, PageRow } from "../site/index.ts";

/**
 * /api/v1/pages: every page of www.balkaris.ch, and one page in full.
 *
 *   GET /?range=7d|30d|90d|1y            the Pages screen, one payload
 *   GET /view?path=/seo&range=30d        one page's detail
 *   GET /export.csv?range=&path=…        the table as CSV (every page, or the `path`s given)
 *
 * WHERE EACH COLUMN COMES FROM, each a reading of its own so a source that is
 * missing costs its column and nothing else:
 *
 *   the rows, status, score, links, issues   the desk's crawl (src/cc/site)
 *   traffic                                  GA4 visitors per address (consenting visitors only)
 *   conversions                              the engine's enquiries per page when it is connected,
 *                                            GA4's generate_lead events until then
 *   last updated                             the website's git history, read through which files
 *                                            belong to which page (below, OWN FILES)
 *
 * Nothing here asks a slow source without its cache: GA4 reads are kept by
 * ga4.ts, the crawl and the history are what their jobs stored, and the one
 * expensive thing this file does itself (reading the website's import graph)
 * is done once per commit, in the background, and kept.
 *
 * `?specimen=1` (development only, decided by specimenAllowed) feeds the
 * detail's two Search Console panels from SPECIMEN_SEARCH and
 * SPECIMEN_INSPECTION below while Search Console has no key.
 */

export const routes = new Hono<Vars>();

const ga4 = () => import("../ga4.ts");
const site = () => import("../site/index.ts");
const leads = () => import("../leads.ts");
const gsc = () => import("../search/gsc.ts");

const RANGES = ["7d", "30d", "90d", "1y"] as const satisfies readonly Range[];
type PagesRange = (typeof RANGES)[number];
const rangeOf = (asked: string | undefined): PagesRange => RANGES.find((r) => r === asked?.toLowerCase()) ?? "30d";
const DAYS: Record<PagesRange, number> = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };

/** Every read here is a person looking (ga4.ts, `touch`). */
const ASK: Ask = { screen: true };

/** The screen is drawn within this, whatever GA4 is doing; a column that misses it says so and fills on the next load. */
const PATIENCE_MS = 12_000;
const SLOW = "GA4 is still answering this one. It is kept as soon as it arrives: reload in a moment.";

function inTime<T>(work: Promise<Reading<T>>, until: number, source: Reading<T>["source"] = "ga4"): Promise<Reading<T>> {
  const left = Math.max(0, until - Date.now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Reading<T>>((resolve) => {
    timer = setTimeout(() => resolve(waiting(source, SLOW)), left);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** A reading that has no value, passed on as one of another type. */
const absent = <T>(r: Reading<unknown>): Reading<T> => (r.state === "ok" ? waiting<T>(r.source, "Nothing to show.") : (r as Reading<T>));

const DAY_MS = 86_400_000;
const shift = (day: string, by: number): string => new Date(Date.parse(`${day}T12:00:00Z`) + by * DAY_MS).toISOString().slice(0, 10);
const siteBase = (): string => (process.env.SITE_BASE ?? "https://www.balkaris.ch").replace(/\/+$/, "");
const absUrl = (path: string): string => new URL(path, `${siteBase()}/`).toString();

/** An https address for a picture the page names, or null. */
function pictureOf(src: string | null): string | null {
  if (!src) return null;
  try {
    const u = new URL(src, `${siteBase()}/`);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/* ---------- the inventory: the crawl's rows, as the table shows them ---------- */

const CHIP: Record<PageType, string> = {
  home: "Home",
  service: "Service",
  segment: "Industry",
  article: "Insight",
  insights: "Insights",
  landing: "Landing",
  case: "Case study",
  legal: "Legal",
  standard: "Standard",
};

const SECTION: Record<PageType, string> = {
  home: "Home",
  service: "Services",
  segment: "Industries",
  article: "Insights",
  insights: "Insights",
  landing: "Landing pages",
  case: "Case studies",
  legal: "Legal",
  standard: "Site pages",
};

/* The rules each flag stands on (src/cc/site/rules.ts). */
const META_RULES = ["title.missing", "title.long", "description.missing", "description.long"];
const PICTURE_RULES = ["share.missing", "share.default-picture"];

function stateOf(r: PageRow): PageState {
  if (r.status === 200) return r.indexable ? "live" : "noindex";
  if (r.status >= 300 && r.status < 400) return "redirect";
  return "error";
}

/** The page's title without the site's name after it ("SEO for Google | Balkaris" → "SEO for Google"). */
function nameOf(r: { title: string | null; h1: string | null; path: string }): string {
  const t = r.title?.replace(/\s*[|—–-]\s*Balkaris\s*$/i, "").trim();
  return t || r.h1?.trim() || r.path;
}

interface Inventory {
  rows: PageListRow[];
  asOf: string;
  /** The crawl's own rows, by address, for what the table does not carry. */
  raw: Map<string, PageRow>;
  rules: Map<string, Set<string>>;
}

const FORTNIGHT = 14 * DAY_MS;

async function inventory(): Promise<Reading<Inventory>> {
  const s = await site();
  const inv = s.inventory();
  if (inv.state !== "ok") return absent(inv);
  const found = s.issues();
  const rules = new Map<string, Set<string>>();
  if (found.state === "ok") {
    for (const f of found.value as Finding[]) {
      if (!f.path) continue;
      const set = rules.get(f.path) ?? new Set<string>();
      set.add(f.rule);
      rules.set(f.path, set);
    }
  }
  /* The desk's first crawl read every page at once: "first seen" then says
     when the desk started looking, not when a page appeared. */
  const firstCrawl = inv.value.reduce((a, r) => (r.firstSeen < a ? r.firstSeen : a), inv.value[0]?.firstSeen ?? "");
  const now = Date.now();
  /* An article's publish date is its own content file's `date:`. The
     sitemap's lastmod is the date it was last updated, so it is not used for
     "new": an old article updated today did not appear today. */
  const published = ownership().value?.dates ?? {};
  const rows = inv.value.map((r): PageListRow => {
    const fired = rules.get(r.path) ?? new Set<string>();
    const has = (list: string[]) => list.some((x) => fired.has(x));
    const state = stateOf(r);
    const flags: PageFlags = {
      meta: has(META_RULES),
      schema: fired.has("schema.none"),
      orphan: fired.has("links.orphan"),
      picture: has(PICTURE_RULES),
      metadata: has([...META_RULES, ...PICTURE_RULES, "schema.none"]),
      attention: r.issues.critical + r.issues.warning > 0,
      route: state === "redirect" || state === "error",
    };
    const dated = r.kind === "article" ? (published[r.path] ?? null) : null;
    const seenLate = r.firstSeen > firstCrawl && now - Date.parse(r.firstSeen) <= FORTNIGHT;
    const datedLate = dated !== null && Number.isFinite(Date.parse(dated)) && now - Date.parse(dated) <= FORTNIGHT;
    const type = r.kind as PageType;
    return {
      path: r.path,
      url: r.url,
      name: nameOf(r),
      title: r.title,
      type,
      typeLabel: CHIP[type] ?? r.kindLabel,
      section: SECTION[type] ?? r.kindLabel,
      state,
      status: r.status,
      redirectTo: r.redirectTo,
      inSitemap: r.inSitemap,
      listedBy: r.listedBy,
      draft: r.status === 200 && (!r.indexable || r.listedBy === "unlisted"),
      picture: pictureOf(r.sharePicture),
      score: r.score,
      issues: r.issues,
      flags,
      inlinks: r.inlinks,
      inlinksFromContent: r.inlinksFromContent,
      firstSeen: r.firstSeen,
      isNew: seenLate || datedLate,
      dated,
      lastmod: r.kind === "article" ? r.lastmod : null,
    };
  });
  return ok({ rows, asOf: inv.asOf, raw: new Map(inv.value.map((r) => [r.path, r])), rules }, "crawl", inv.asOf, inv.state === "ok" ? inv.note : undefined);
}

/* ---------- GA4: visitors and enquiries per address ----------------------------- */

function periodOf(span: Span): PagesPeriod {
  return {
    start: span.start,
    end: span.end,
    since: span.since,
    partial: span.partial,
    previous: span.previous,
    /* The period ends yesterday, so the first day both it and the one before
       it are measured whole is fullFrom plus two periods. */
    comparableFrom: shift(span.fullFrom, 2 * span.days),
  };
}

async function trafficColumn(range: PagesRange): Promise<Reading<TrafficColumn>> {
  const g = await ga4();
  const read = await g.pages(range, ASK);
  if (read.data === null) return g.asReading(read, () => null as never);
  const span = read.data.span;
  /* Sessions per address, only for the conversion rate's floor. */
  const sess = await g.report({ dimensions: ["pagePath"], metrics: ["sessions"], dateRanges: [{ startDate: span.since > span.start ? span.since : span.start, endDate: span.end }], limit: 5000 }, ASK);
  const sessions = new Map<string, number>();
  for (const row of sess.data?.rows ?? []) {
    const p = g.normalPath(String(row.pagePath ?? ""));
    sessions.set(p, (sessions.get(p) ?? 0) + Number(row.sessions ?? 0));
  }
  const known = sess.data !== null;
  return g.asReading(read, (d) => ({
    period: periodOf(d.span),
    rows: Object.fromEntries(d.rows.map((r) => [r.path, { visitors: r.users, previous: r.previous ? r.previous.users : null, views: r.views, sessions: known ? (sessions.get(r.path) ?? 0) : null }])),
  }));
}

const ENGINE_COUNTS = "Enquiries the engine received from a form on this page, every enquiry, whether or not the visitor accepted cookies.";
const GA4_COUNTS = "GA4's generate_lead events on this page: one per enquiry sent, consenting visitors only. The engine's own count replaces it once the desk has the engine's key.";

async function conversionColumn(range: PagesRange): Promise<Reading<ConversionColumn>> {
  const l = await leads();
  if (l.configured()) {
    const r = await l.byPage(range);
    if (r.state !== "ok") return absent(r);
    return { ...r, value: { source: "engine", counts: ENGINE_COUNTS, rows: Object.fromEntries(r.value.filter((x) => x.key).map((x) => [x.key, { count: x.count, previous: x.previous }])) } };
  }
  const g = await ga4();
  const read = await g.eventByPage("generate_lead", range, ASK);
  return g.asReading(read, (d) => ({ source: "ga4" as const, counts: GA4_COUNTS, rows: Object.fromEntries(d.rows.map((r) => [r.path, { count: r.count, previous: r.previous ? r.previous.count : null }])) }));
}

/* ---------- OWN FILES: which source files belong to which page ------------------ */

/*
 * "Last updated" must not be guessed, and a page of this website is not one
 * file: /about is app/(site)/about/page.tsx, the components only it imports,
 * and content it shares with /team. So the desk reads the website's import
 * graph once per commit and calls a file a page's OWN when that page is the
 * only entry point that reaches it. Every other file under app/ (the layout,
 * the dynamic routes, the route handlers) is an entry point too, so a file the
 * layout also reaches belongs to nobody.
 *
 * Then a page's last update is the newest commit that touched one of its own
 * files. Two kinds of page get a mapping the graph cannot give, each one
 * file that is that page's content and nothing else's: a case study
 * (content/cases/<slug>.ts) and an article (content/posts/<file>.ts whose
 * slug is the article's). Pages drawn by a shared dynamic route from a file
 * holding several pages (the services) map to nothing, and say "–".
 */

interface Ownership {
  head: string;
  /** Page address → its own files. */
  files: Record<string, string[]>;
  /** Article address → its post file. */
  posts: Record<string, string>;
  /**
   * Article address → its publish date as the post file states it (`date:`).
   * The sitemap's lastmod is `updated ?? date` (the website's app/sitemap.ts),
   * so it says when an article was last updated, not when it appeared.
   * Absent in an ownership kept before this was read.
   */
  dates?: Record<string, string>;
}

const OWN_KEY = "pages:own:1";
let owning: Promise<Ownership> | null = null;
let owned: Ownership | null = null;
let failedAt = 0;

const CODE = /\.(tsx|ts|jsx|js|mjs)$/;
const ENTRY = /(?:^|\/)(?:page|layout|template|error|global-error|loading|not-found|forbidden|unauthorized|default|route|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.(?:tsx|ts|jsx|js|mjs)$/;

/** A page file's fixed address, or null for a dynamic one ("[entity]"). The same rule as src/cc/site/structure.ts. */
function routeOf(file: string): string | null {
  const m = /^app\/(?:(.*)\/)?page\.(?:tsx|ts|jsx|js|mdx)$/.exec(file);
  if (!m) return null;
  const parts = (m[1] ?? "").split("/").filter((p) => p && !/^\(.*\)$/.test(p));
  if (parts.some((p) => p.includes("[") || p.startsWith("@") || p.startsWith("_"))) return null;
  return `/${parts.join("/")}`;
}

function resolver(all: Set<string>) {
  const tries = ["", ".tsx", ".ts", ".jsx", ".js", ".mjs", "/index.tsx", "/index.ts", "/index.js"];
  return (from: string, spec: string): string | null => {
    let base: string;
    if (spec.startsWith("@/")) base = spec.slice(2);
    else if (spec.startsWith("./") || spec.startsWith("../")) {
      const dir = from.split("/").slice(0, -1);
      for (const part of spec.split("/")) {
        if (part === "." || part === "") continue;
        if (part === "..") dir.pop();
        else dir.push(part);
      }
      base = dir.join("/");
    } else return null;
    for (const t of tries) if (all.has(base + t)) return base + t;
    return null;
  };
}

const IMPORTS = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

async function buildOwnership(head: string): Promise<Ownership> {
  const s = await site();
  const listed = (await Promise.all(["app", "components", "content", "lib", "styles"].map((p) => s.repoFiles(p).catch(() => [])))).flat().map((f) => f.path);
  const all = new Set(listed);
  const resolve = resolver(all);
  const graph = new Map<string, string[]>();
  const posts: Record<string, string> = {};
  const dates: Record<string, string> = {};

  for (const file of listed) {
    if (!CODE.test(file)) continue;
    const text = await s.repoRead(file).catch(() => null);
    if (text === null) continue;
    const deps: string[] = [];
    for (const m of text.matchAll(IMPORTS)) {
      const to = resolve(file, (m[1] ?? m[2]) as string);
      if (to) deps.push(to);
    }
    graph.set(file, [...new Set(deps)]);
    if (/^content\/posts\/[^/]+\.ts$/.test(file) && !file.endsWith("/index.ts")) {
      const slug = /\bslug:\s*"([^"]+)"/.exec(text)?.[1];
      if (slug) {
        posts[`/insights/${slug}`] = file;
        const date = /^\s*date:\s*["'](\d{4}-\d{2}-\d{2})/m.exec(text)?.[1];
        if (date) dates[`/insights/${slug}`] = date;
      }
    }
  }

  /* Every file Next loads by its name under app/ is an entry point (pages,
     layouts, route handlers, error and loading screens…); a fixed-route page
     file is named by its address. A component kept beside a page is not. */
  const entries = listed.filter((f) => f.startsWith("app/") && ENTRY.test(f));
  const reachedBy = new Map<string, Set<string>>();
  for (const entry of entries) {
    const name = routeOf(entry) ?? `entry:${entry}`;
    const seen = new Set<string>([entry]);
    const queue = [entry];
    while (queue.length) {
      const at = queue.pop() as string;
      for (const to of graph.get(at) ?? []) if (!seen.has(to)) (seen.add(to), queue.push(to));
    }
    for (const f of seen) (reachedBy.get(f) ?? reachedBy.set(f, new Set()).get(f)!).add(name);
  }

  const files: Record<string, string[]> = {};
  for (const [file, by] of reachedBy) {
    if (by.size !== 1) continue;
    const only = [...by][0] as string;
    if (only.startsWith("entry:")) continue;
    (files[only] ??= []).push(file);
  }
  for (const f of listed) {
    const m = /^content\/cases\/([^/]+)\.ts$/.exec(f);
    if (m) files[`/case-study-${m[1]}`] = [f];
  }
  for (const [path, file] of Object.entries(posts)) files[path] = [file];
  for (const k of Object.keys(files)) files[k]!.sort();
  return { head, files, posts, dates };
}

/** The ownership for the current commit, or the last one while it is being read again. Null before the first. */
function ownership(): { value: Ownership | null; fresh: boolean } {
  const head = state("site:repo:head");
  owned ??= kept<Ownership>(OWN_KEY)?.value ?? null;
  if (!head) return { value: owned, fresh: false };
  /* One kept before the publish dates were read is served while it is read again. */
  if (owned?.head === head && owned.dates) return { value: owned, fresh: true };
  /* A read that failed is not tried again on every request: once in ten minutes. */
  if (!owning && Date.now() - failedAt < 10 * 60_000) return { value: owned, fresh: false };
  owning ??= site()
    .then((s) => (s.readCopyExists() ? buildOwnership(head) : Promise.reject(new Error("no read copy"))))
    .then((o) => {
      owned = o;
      keep(OWN_KEY, o);
      return o;
    })
    .finally(() => {
      owning = null;
    });
  owning.catch(() => {
    failedAt = Date.now();
  });
  return { value: owned, fresh: false };
}

/** The whole history with the files each commit changed, kept per commit of the branch. */
let commitsAt: { head: string; list: CommitFiles[] } | null = null;
async function history(): Promise<CommitFiles[]> {
  const head = state("site:repo:head");
  if (!head) return [];
  if (commitsAt?.head === head) return commitsAt.list;
  const s = await site();
  const list = await s.commitFiles(5000);
  commitsAt = { head, list };
  return list;
}

/** A person's first name: the desk's people table when the commit's address is a person's, else the name as git has it. */
function namer(): (c: { author: string; email?: string }) => string {
  const by = new Map(
    everyone()
      .filter((p) => p.email)
      .map((p) => [(p.email as string).toLowerCase(), p.name.trim().split(/\s+/)[0] ?? p.name]),
  );
  return (c) => by.get((c.email ?? "").toLowerCase()) ?? c.author;
}

/** Address → file → owner, inverted, for walking commits. */
function ownerOf(o: Ownership): Map<string, string> {
  const m = new Map<string, string>();
  for (const [page, files] of Object.entries(o.files)) for (const f of files) m.set(f, page);
  return m;
}

const READING_GRAPH = "Reading which of the website's files belong to which page, once for this commit: about half a minute. Reload in a moment.";

async function updates(inv: Inventory | null): Promise<Reading<Record<string, PageUpdate>>> {
  const s = await site();
  if (!s.readCopyExists()) return off("repo", "The desk has no read copy of the website's repository yet.", "Nothing to set up: the repository job makes the copy itself on its next run. If it keeps failing, its reason is under Automations.");
  const at = s.repoFetchedAt();
  if (!at) return waiting("repo", "The repository has not been fetched yet; the first fetch runs within a minute of the desk starting.");
  const o = ownership();
  if (!o.value) return waiting("repo", READING_GRAPH);
  const list = await history();
  const owner = ownerOf(o.value);
  const name = namer();
  const out: Record<string, PageUpdate> = {};
  for (const c of list) {
    for (const p of c.paths) {
      const page = owner.get(p);
      if (!page || out[page]) continue;
      out[page] = { at: c.at, who: name(c), subject: c.subject, sha: c.sha, how: "commit" };
    }
  }
  /* An article no single file holds: its own date is what is known. */
  for (const r of inv?.rows ?? []) {
    if (!out[r.path] && r.type === "article" && r.dated) out[r.path] = { at: r.dated, who: null, subject: null, sha: null, how: "dated" };
  }
  return ok(
    out,
    "repo",
    at,
    `The newest commit to the files only this page uses (its page file and what only it imports; a case study's or an article's own content file). Shared components and content are not counted.${o.fresh ? "" : " The map of files was read at an earlier commit and is being read again."}`,
  );
}

/* ---------- the tiles ------------------------------------------------------------- */

function plainStat(value: number, o: Partial<Stat> = {}): Stat {
  return { value, previous: null, unit: "count", series: [], ...o };
}

/** The crawl's daily count of pages, with the value at the start of the range only when the history reaches that far. */
function totalStat(range: PagesRange, inv: Inventory): Stat {
  const days = DAYS[range];
  const line = series("seo.pages", days);
  const first = line[0];
  const reaches = first !== undefined && first.day <= today(-days + 1);
  const inMap = inv.rows.filter((r) => r.inSitemap).length;
  return {
    value: inv.rows.length,
    previous: reaches && line.length > 1 ? (first as { value: number }).value : null,
    unit: "count",
    series: line.map((p) => p.value),
    sub: `${inMap} in the sitemap, ${inv.rows.length - inMap} kept out`,
  };
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

const fmtDay = (day: string): string => {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][(m ?? 1) - 1]} ${y}`;
};

/** Pages above the median in visitors whose visitors rose against the period before. */
function topPerformers(inv: Reading<Inventory>, traffic: Reading<TrafficColumn>): { reading: Reading<Stat>; paths: string[] } {
  if (inv.state !== "ok") return { reading: absent(inv), paths: [] };
  if (traffic.state !== "ok") return { reading: absent(traffic), paths: [] };
  const t = traffic.value;
  if (!t.period.previous) {
    return {
      reading: waiting(
        "ga4",
        `Possible from ${fmtDay(t.period.comparableFrom)}: GA4 began on ${fmtDay(t.period.since)}, so the period before this one was not measured and no page can be said to have risen.`,
      ),
      paths: [],
    };
  }
  const visitors = inv.value.rows.map((r) => t.rows[r.path]?.visitors ?? 0);
  const mid = median(visitors);
  const picked = inv.value.rows.filter((r) => {
    const row = t.rows[r.path];
    return row !== undefined && row.visitors > mid && row.previous !== null && row.visitors > row.previous;
  });
  return {
    reading: ok(plainStat(picked.length, { sub: `above the median of ${Math.round(mid * 10) / 10} visitors, and rising` }), "ga4", traffic.asOf, traffic.note),
    paths: picked.map((r) => r.path),
  };
}

function tiles(range: PagesRange, inv: Reading<Inventory>, traffic: Reading<TrafficColumn>): { tiles: PagesTiles; top: string[] } {
  const top = topPerformers(inv, traffic);
  if (inv.state !== "ok") {
    const a = absent<Stat>(inv);
    return { tiles: { total: a, missingMeta: a, missingSchema: a, orphans: a, topPerformers: top.reading, drafts: a }, top: [] };
  }
  const v = inv.value;
  const read = v.rows.filter((r) => r.inSitemap && r.status === 200).length;
  const count = (pick: (r: PageListRow) => boolean) => v.rows.filter(pick).length;
  const at = (stat: Stat, note?: string): Reading<Stat> => ok(stat, "crawl", v.asOf, note);
  const noindex = count((r) => r.draft && r.state === "noindex");
  const unlisted = count((r) => r.draft && r.listedBy === "unlisted" && r.state !== "noindex");
  return {
    top: top.paths,
    tiles: {
      total: at(totalStat(range, v), "Pages the desk's crawl reads: every address in the sitemap and the page files the website keeps out of it. The line is the crawl's own daily count, from its first day."),
      missingMeta: at(plainStat(count((r) => r.flags.meta), { of: read }), "Sitemap pages with no title or description, or one longer than the limit (60 and 160 characters)."),
      missingSchema: at(plainStat(count((r) => r.flags.schema), { of: read }), "Sitemap pages that carry no structured data at all."),
      orphans: at(plainStat(count((r) => r.flags.orphan)), "Sitemap pages that no other page links to, the home page aside."),
      topPerformers: top.reading,
      drafts: at(plainStat(noindex + unlisted, { sub: `${noindex} noindex${unlisted ? `, ${unlisted} unlisted` : ""}` }), "Pages that answer but are kept out of search: they say noindex, or they are articles not listed yet."),
    },
  };
}

/* ---------- the bottom row ---------------------------------------------------------- */

async function routeHealth(inv: Reading<Inventory>): Promise<Reading<RouteHealthPanel>> {
  if (inv.state !== "ok") return absent(inv);
  const s = await site();
  const p: RouteHealthPanel = { total: 0, healthy: 0, redirects: 0, brokenRules: 0, clientErrors: 0, serverErrors: 0, unanswered: 0, pages: 0, rules: 0, routePages: 0, untested: 0 };
  for (const r of inv.value.rows) {
    p.total++;
    p.pages++;
    if (r.flags.route) p.routePages++;
    if (r.status >= 300 && r.status < 400) p.redirects++;
    else if (r.status >= 400 && r.status < 500) p.clientErrors++;
    else if (r.status >= 500) p.serverErrors++;
    else if (r.status === 0) p.unanswered++;
    else p.healthy++;
  }
  const rules = s.redirects();
  if (rules.state === "ok") {
    for (const c of rules.value) {
      if (c.outcome === "untested") {
        p.untested++;
        continue;
      }
      p.total++;
      p.rules++;
      /* A rule that does not work is a broken redirect wherever it ended,
         even on a page that answers 200: it answered without redirecting,
         or sent the reader somewhere the rule does not promise. */
      if (c.outcome === "broken") p.brokenRules++;
      else p.redirects++;
    }
  }
  return ok(
    p,
    "crawl",
    inv.value.asOf,
    `Every page the crawl read (${p.pages}) and every redirect rule the site promises that could be tried (${p.rules}), as each answered at the last crawl. A rule is a broken redirect when it does not redirect, lands somewhere it does not promise, or lands on a page that does not answer 200.${p.untested ? ` ${p.untested} rule${p.untested === 1 ? "" : "s"} with a pattern no page fits could not be tried.` : ""}${rules.state === "ok" ? "" : " The redirect rules have not been tried yet."}`,
  );
}

function metadata(inv: Reading<Inventory>): Reading<MetadataPanel> {
  if (inv.state !== "ok") return absent(inv);
  const rows = inv.value.rows.filter((r) => r.inSitemap && r.status === 200);
  const has = (r: PageListRow, rule: string) => inv.value.rules.get(r.path)?.has(rule) ?? false;
  const missingPicture = (r: PageListRow) => r.flags.picture;
  return ok(
    {
      total: rows.length,
      /* The same rules as the "Missing metadata" tile, and the rest of the head: over the limit is not complete either. */
      complete: rows.filter((r) => !r.flags.meta && !missingPicture(r) && !has(r, "schema.none")).length,
      missingTitle: rows.filter((r) => has(r, "title.missing")).length,
      longTitle: rows.filter((r) => has(r, "title.long")).length,
      missingDescription: rows.filter((r) => has(r, "description.missing")).length,
      longDescription: rows.filter((r) => has(r, "description.long")).length,
      missingPicture: rows.filter(missingPicture).length,
      missingSchema: rows.filter((r) => has(r, "schema.none")).length,
    },
    "crawl",
    inv.value.asOf,
    `The ${rows.length} sitemap pages the crawl read. Complete: a title and a description within the limits (60 and 160 characters), a share picture of their own and structured data. "Missing OG image" counts pages still on the site's default share picture or with none.`,
  );
}

/* Rewords what the crawl wrote into the feed ("/seo: title changed") the way the panel says it. */
function crawlLine(text: string): { text: string; path: string | null } {
  let m = /^New page: (\/\S*)$/.exec(text);
  if (m) return { text: `New page ${m[1]}`, path: m[1] as string };
  m = /^Page gone: (\/\S*)$/.exec(text);
  if (m) return { text: `Page gone ${m[1]}`, path: m[1] as string };
  m = /^(\/\S*): (title|description|heading|canonical|text) changed$/.exec(text);
  if (m) return { text: `${(m[2] as string)[0]!.toUpperCase()}${(m[2] as string).slice(1)} changed on ${m[1]}`, path: m[1] as string };
  m = /^(\/\S*): (now says noindex|no longer says noindex|now answers .+)$/.exec(text);
  if (m) return { text: `${m[1]} ${m[2]}`, path: m[1] as string };
  return { text, path: null };
}

async function recentActivity(inv: Reading<Inventory>, limit = 6): Promise<Reading<PageActivityItem[]>> {
  const items: PageActivityItem[] = [];
  const s = await site();
  const known = new Set(inv.state === "ok" ? inv.value.rows.map((r) => r.path) : []);

  /* What the crawl noticed between two crawls. */
  for (const a of activity(40, ["page"])) {
    const line = crawlLine(a.text);
    items.push({ id: `a${a.id}`, at: a.at, tone: a.tone, text: line.text, path: line.path, who: null, detail: a.detail ?? null, kind: "crawl" });
  }

  /* What the git history says, mapped to pages through their own files. */
  let gitOk = false;
  if (s.readCopyExists() && s.repoFetchedAt()) {
    const o = ownership().value;
    const list = (await history()).slice(0, 60);
    gitOk = true;
    const owner = o ? ownerOf(o) : new Map<string, string>();
    const name = namer();
    for (const c of list) {
      if (/^Publish\b/.test(c.subject)) {
        const post = c.paths.find((p) => /^content\/posts\/[^/]+\.ts$/.test(p) && !p.endsWith("/index.ts"));
        const path = post && o ? (Object.entries(o.posts).find(([, f]) => f === post)?.[0] ?? null) : null;
        items.push({ id: c.sha, at: c.at, tone: "good", text: path ? `Published ${path}` : c.subject, path, who: name(c), detail: path ? c.subject : null, kind: "publish" });
        continue;
      }
      const pages = [...new Set(c.paths.map((p) => owner.get(p)).filter((p): p is string => Boolean(p) && known.has(p as string)))];
      if (!pages.length) continue;
      items.push({
        id: c.sha,
        at: c.at,
        tone: "info",
        text: `Updated ${pages[0]}${pages.length > 1 ? ` and ${pages.length - 1} other page${pages.length === 2 ? "" : "s"}` : ""}`,
        path: pages[0] as string,
        who: name(c),
        detail: c.subject,
        kind: "commit",
      });
    }
  }
  if (!items.length && inv.state !== "ok") return absent(inv);
  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return ok(
    items.slice(0, limit),
    gitOk ? "repo" : "crawl",
    olderOf(gitOk ? s.repoFetchedAt() : null, inv.state === "ok" ? inv.value.asOf : null) ?? new Date().toISOString(),
    "Commits to the website mapped to the pages whose own files they changed, articles published, and what the crawl saw change between two crawls. The age is the older of the repository's last fetch and the last crawl.",
  );
}

/** The older of two ISO times, either of which may be missing: a list fed by both is only as fresh as the staler. */
function olderOf(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function crawlJob(): PagesPayload["crawl"] {
  const j = jobStatus().find((x) => x.name === "crawl");
  return { running: Boolean(j?.running), lastEnd: j?.lastEnd ?? null, ready: Boolean(j?.ready && j?.enabled) };
}

/* ---------- GET / --------------------------------------------------------------------- */

async function screen(range: PagesRange): Promise<PagesPayload & { _inv: Reading<Inventory> }> {
  const until = Date.now() + PATIENCE_MS;
  const inv = await reading("crawl", inventory);
  const [traffic, conversions, upd] = await Promise.all([
    inTime(reading("ga4", () => trafficColumn(range)), until),
    inTime(reading("ga4", () => conversionColumn(range)), until),
    reading("repo", () => updates(inv.state === "ok" ? inv.value : null)),
  ]);
  const t = tiles(range, inv, traffic);
  const [rh, act] = await Promise.all([reading("crawl", () => routeHealth(inv)), reading("crawl", () => recentActivity(inv))]);
  return {
    range,
    specimen: false,
    tiles: t.tiles,
    inventory: inv.state === "ok" ? ok(inv.value.rows, "crawl", inv.value.asOf, "The desk's crawl: one read of every page a day, and whenever the sitemap changes.") : absent(inv),
    traffic,
    conversions,
    updates: upd,
    top: t.top,
    routeHealth: rh,
    metadata: metadata(inv),
    activity: act,
    crawl: crawlJob(),
    _inv: inv,
  };
}

routes.get("/", async (c) => {
  const range = rangeOf(c.req.query("range"));
  const { _inv, ...payload } = await screen(range);
  void _inv;
  return c.json<PagesPayload>(payload);
});

/* ---------- GET /export.csv ------------------------------------------------------------- */

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  let s = String(v);
  /* A spreadsheet runs a cell that starts like a formula. */
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const STATE_WORD: Record<PageState, string> = { live: "Live", noindex: "Noindex", redirect: "Redirect", error: "Error" };

routes.get("/export.csv", async (c) => {
  const range = rangeOf(c.req.query("range"));
  const wanted = new Set(c.req.queries("path") ?? []);
  const p = await screen(range);
  if (p.inventory.state !== "ok") return c.json({ error: `There is nothing to export yet: ${p.inventory.reason}` }, 409);
  const traffic = p.traffic.state === "ok" ? p.traffic.value : null;
  const conv = p.conversions.state === "ok" ? p.conversions.value : null;
  const upd = p.updates.state === "ok" ? p.updates.value : null;
  const head = [
    "Page",
    "Title",
    "Section",
    "Address",
    "URL",
    "Type",
    "Status",
    "HTTP status",
    "In sitemap",
    `Visitors (${range}, GA4)`,
    "Visitors, period before",
    "Sessions",
    "SEO score",
    conv?.source === "engine" ? "Enquiries (engine)" : "Enquiries (GA4 generate_lead)",
    "Internal links in",
    "Critical issues",
    "Warnings",
    "Last updated",
    "Updated by",
  ];
  const lines = [head.map(cell).join(",")];
  for (const r of p.inventory.value) {
    if (wanted.size && !wanted.has(r.path)) continue;
    const t = traffic?.rows[r.path];
    const u = upd?.[r.path];
    lines.push(
      [
        r.name,
        r.title,
        r.section,
        r.path,
        r.url,
        r.typeLabel,
        STATE_WORD[r.state],
        r.status,
        r.inSitemap ? "yes" : "no",
        traffic ? (t?.visitors ?? 0) : "",
        traffic ? (t ? t.previous : traffic.period.previous ? 0 : "") : "",
        traffic ? (t ? t.sessions : 0) : "",
        r.score,
        conv ? (conv.rows[r.path]?.count ?? 0) : "",
        r.inlinks,
        r.issues.critical,
        r.issues.warning,
        u ? u.at.slice(0, 10) : "",
        u?.who ?? "",
      ]
        .map(cell)
        .join(","),
    );
  }
  c.header("content-type", "text/csv; charset=utf-8");
  c.header("content-disposition", `attachment; filename="balkaris-pages-${today()}-${range}${wanted.size ? "-selected" : ""}.csv"`);
  c.header("cache-control", "no-store");
  return c.body(`﻿${lines.join("\r\n")}\r\n`);
});

/* ---------- GET /view: one page ----------------------------------------------------------- */

/* Obviously artificial, for looking at the connected state before Search Console has a key. */
const SPECIMEN_SEARCH: PageSearchView = {
  start: "2000-01-01",
  end: "2000-01-30",
  totals: { clicks: 66, impressions: 666, ctr: 9.91, position: 6.6 },
  queries: [
    { query: "specimen query one", clicks: 33, impressions: 333, ctr: 9.91, position: 3.3 },
    { query: "specimen query two", clicks: 22, impressions: 222, ctr: 9.91, position: 7.7 },
    { query: "specimen query three", clicks: 11, impressions: 111, ctr: 9.91, position: 11.1 },
  ],
};
const SPECIMEN_INSPECTION: PageInspectionView = {
  day: "2000-01-31",
  indexed: true,
  verdict: "PASS",
  coverage: "Specimen: submitted and indexed",
  lastCrawl: "2000-01-30T00:00:00.000Z",
  googleCanonical: null,
  canonicalOk: null,
  link: null,
};

const LIMIT_NOTE = "The desk's yardsticks (src/cc/site/rules.ts): a title over 60 characters and a description over 160 are cut in results.";

async function factsView(path: string, inv: Reading<Inventory>): Promise<Reading<PageFactsView>> {
  const s = await site();
  const one = s.page(path);
  if (one.state !== "ok") return absent(one);
  const d = one.value;
  const row = inv.state === "ok" ? inv.value.rows.find((r) => r.path === path) : undefined;
  if (!row) return waiting("crawl", "The crawl has this page but not in its list yet; reload in a moment.");
  const f = d.facts;
  const shape = await s.structure().catch(() => null);
  const canonicalPath = f?.canonical ? (() => { try { const u = new URL(f.canonical, `${siteBase()}/`); return u.pathname.replace(/\/+$/, "") || "/"; } catch { return null; } })() : null;
  const images: PageImage[] = (f?.images ?? []).map((i) => ({
    src: i.file ?? i.remoteUrl ?? i.remote ?? "?",
    url: pictureOf(i.file ?? i.remoteUrl ?? null),
    alt: i.alt,
    altText: i.altText ?? null,
    width: i.width,
    height: i.height,
    place: i.place,
    hidden: i.hidden,
    unnamedLink: i.unnamedLink,
  }));
  /* page() lists the findings with their titles and costs (crawl.ts listIssues), though its type says Issue. */
  const findings: PageFinding[] = (d.findings as Finding[]).map((x) => ({ id: x.id, rule: x.rule, title: x.title, severity: x.severity, text: x.text, measured: x.measured, limit: x.limit, cost: x.cost, firstSeen: x.firstSeen }));
  return ok(
    {
      row,
      limits: { title: s.LIMITS.title, description: s.LIMITS.description, thinWords: s.LIMITS.thinWords },
      titleLength: f?.title ? [...f.title].length : null,
      description: f?.description ?? null,
      descriptionLength: f?.description ? [...f.description].length : null,
      canonical: f?.canonical ?? null,
      canonicalSelf: canonicalPath === null ? null : canonicalPath === path,
      robots: f?.robots ?? null,
      robotsHeader: d.fetched?.robotsTag ?? null,
      lang: f?.lang ?? null,
      h1: f?.h1 ?? [],
      h2: f?.h2 ?? 0,
      og: { title: f?.og.title ?? null, description: f?.og.description ?? null, image: pictureOf(f?.og.image ?? null), type: f?.og.type ?? null },
      twitterCard: f?.twitter.card ?? null,
      defaultPicture: pictureOf(shape?.defaultShare ?? null),
      schema: (f?.schema ?? []).map((b) => ({ parses: b.parses, ...(b.error ? { error: b.error } : {}), nodes: b.nodes.map((n) => ({ type: n.type, missing: n.missing, known: n.known })) })),
      schemaTypes: f?.schemaTypes ?? [],
      words: f?.words ?? null,
      fetch: {
        hops: (d.fetched?.hops ?? []).map((h) => ({ url: h.url, status: h.status })),
        ttfbMs: d.fetched?.ttfb ?? null,
        totalMs: d.fetched?.total ?? null,
        bytes: d.fetched?.bytes ?? null,
        cache: d.fetched?.vercelCache ?? null,
        cacheControl: d.fetched?.cacheControl ?? null,
        contentType: d.fetched?.contentType ?? null,
        error: d.fetched?.error ?? null,
      },
      lastSeen: d.lastSeen,
      lastChanged: d.lastChanged && d.lastChanged !== d.firstSeen ? d.lastChanged : null,
      findings,
      linksIn: d.linksIn,
      linksOut: d.linksOut,
      outlinks: d.outlinks,
      images,
    },
    "crawl",
    one.asOf,
    LIMIT_NOTE,
  );
}

function scoreView(facts: Reading<PageFactsView>): Reading<PageScoreView> {
  if (facts.state !== "ok") return absent(facts);
  const f = facts.value;
  const seen = new Set<string>();
  const lines: PageScoreView["lines"] = [];
  for (const x of f.findings) {
    if (seen.has(x.rule)) continue;
    seen.add(x.rule);
    lines.push({ rule: x.rule, title: x.title, severity: x.severity, cost: x.cost });
  }
  lines.sort((a, b) => b.cost - a.cost);
  return ok(
    {
      score: f.row.score,
      unscored: f.row.score === null ? "Kept out of the sitemap on purpose, so it has no SEO score: the crawl only checks that it really is kept out of search." : null,
      lines,
    },
    "crawl",
    facts.asOf,
    "100, less the cost of each rule that fired on the page, once per rule (src/cc/site/rules.ts). The desk's own score, not a figure from Google.",
  );
}

/** The page's addresses as GA4 may record them. */
const gaPaths = (path: string): string[] => (path === "/" ? ["/"] : [path, `${path}/`]);

async function pageTraffic(path: string, range: PagesRange): Promise<Reading<PageTrafficView>> {
  const g = await ga4();
  const base = await g.pages(range, ASK);
  if (base.data === null) return g.asReading(base, () => null as never);
  const span = base.data.span;
  const filter = g.where.among("pagePath", gaPaths(path));
  const from = span.since > span.start ? span.since : span.start;
  const totals = await g.report(
    { metrics: ["activeUsers", "screenPageViews", "sessions"], dateRanges: [{ startDate: from, endDate: span.end }, ...(span.previous ? [{ startDate: span.previous.start, endDate: span.previous.end }] : [])], dimensionFilter: filter },
    ASK,
  );
  const stretchFrom = span.previous ? span.previous.start : from;
  const daily = await g.report({ dimensions: ["date"], metrics: ["activeUsers"], dateRanges: [{ startDate: stretchFrom < span.since ? span.since : stretchFrom, endDate: span.end }], dimensionFilter: filter, limit: 1000 }, ASK);
  if (totals.data === null) return g.asReading(totals, () => null as never);
  if (daily.data === null) return g.asReading(daily, () => null as never);
  const n = (rows: Record<string, string | number>[] | undefined, k: string) => (rows ?? []).reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const now = totals.data.ranges[0] ?? [];
  const before = span.previous ? (totals.data.ranges[1] ?? []) : null;
  const byDay = new Map(daily.data.rows.map((r) => [String(r.date), Number(r.activeUsers ?? 0)]));
  const days: PageTrafficView["days"] = [];
  for (let day = from; day <= span.end; day = shift(day, 1)) {
    const prior = shift(day, -span.days);
    days.push({ date: day, value: byDay.get(day) ?? 0, previous: span.previous && prior >= span.fullFrom ? (byDay.get(prior) ?? 0) : null });
  }
  const stat = (k: string): Stat => ({ value: n(now, k), previous: before ? n(before, k) : null, unit: "count", series: days.map((d) => (k === "activeUsers" ? d.value : 0)) });
  const provisional = days.filter((d) => d.date >= span.provisionalFrom).length;
  return g.asReading({ ...totals, at: Math.min(totals.at ?? Date.now(), daily.at ?? Date.now()) }, () => ({
    period: periodOf(span),
    visitors: stat("activeUsers"),
    views: { ...stat("screenPageViews"), series: [] },
    sessions: { ...stat("sessions"), series: [] },
    days,
    provisional,
  }));
}

async function pageEvents(path: string, range: PagesRange): Promise<Reading<PageEventRow[]>> {
  const g = await ga4();
  const base = await g.pages(range, ASK);
  if (base.data === null) return g.asReading(base, () => null as never);
  const span = base.data.span;
  const from = span.since > span.start ? span.since : span.start;
  const r = await g.report(
    {
      dimensions: ["eventName"],
      metrics: ["eventCount"],
      dateRanges: [{ startDate: from, endDate: span.end }, ...(span.previous ? [{ startDate: span.previous.start, endDate: span.previous.end }] : [])],
      dimensionFilter: g.where.among("pagePath", gaPaths(path)),
      orderBys: [{ by: "eventCount", desc: true }],
      limit: 200,
    },
    ASK,
  );
  const known = g.SITE_EVENTS as Record<string, { what: string }>;
  return g.asReading(r, (d) => {
    const before = new Map((d.ranges[1] ?? []).map((x) => [String(x.eventName), Number(x.eventCount ?? 0)]));
    const now = new Map<string, number>();
    for (const x of d.ranges[0] ?? []) now.set(String(x.eventName), (now.get(String(x.eventName)) ?? 0) + Number(x.eventCount ?? 0));
    return [...now]
      .map(([name, count]) => ({ name, what: known[name]?.what ?? null, count, previous: span.previous ? (before.get(name) ?? 0) : null, ours: name in known }))
      .sort((a, b) => Number(b.ours) - Number(a.ours) || b.count - a.count);
  });
}

async function pageEnquiries(path: string, range: PagesRange): Promise<Reading<{ count: number; previous: number | null; counts: string }>> {
  const l = await leads();
  const r = await l.byPage(range);
  if (r.state !== "ok") return absent(r);
  const hit = r.value.find((x) => x.key === path);
  return { ...r, value: { count: hit?.count ?? 0, previous: hit ? hit.previous : r.value.some((x) => x.previous !== null) ? 0 : null, counts: ENGINE_COUNTS } };
}

async function pageSpeed(path: string): Promise<Reading<PageSpeedView>> {
  const s = await site();
  const mobile = s.labRuns("mobile");
  const desktop = s.labRuns("desktop");
  if (mobile.state !== "ok" && desktop.state !== "ok") return absent(mobile);
  const runs = [...(mobile.state === "ok" ? mobile.value : []), ...(desktop.state === "ok" ? desktop.value : [])].filter((r) => r.path === path);
  if (!runs.length) {
    const list = s.speedPages();
    return off("psi", `The daily speed test measures a fixed list of ${list.length} pages (${list.join(", ")}), and this page is not on it.`, "The list is chosen in src/cc/site/psi.ts (speedPages); CC_PSI_PAGES in the desk's environment replaces it with up to eight addresses.");
  }
  const at = runs.reduce((a, r) => (r.at > a ? r.at : a), "");
  return ok(
    {
      runs: runs.map((r) => ({
        strategy: r.strategy,
        at: r.at,
        performance: r.scores.performance,
        seo: r.scores.seo,
        accessibility: r.scores.accessibility,
        bestPractices: r.scores.bestPractices,
        lcpMs: r.lcpMs,
        cls: r.cls,
        tbtMs: r.tbtMs,
        failure: r.failure,
      })),
    },
    "psi",
    at,
    (mobile.state === "ok" ? mobile.note : desktop.state === "ok" ? desktop.note : undefined) ?? "Lab: one Lighthouse load on Google's machines.",
  );
}

async function pageSearch(path: string, range: PagesRange): Promise<Reading<PageSearchView>> {
  const g = await gsc();
  const url = absUrl(path);
  const [q, t] = await Promise.all([
    g.query({ range, dimensions: ["query"], filters: [{ dimension: "page", expression: url }], rowLimit: 25 }),
    g.query({ range, dimensions: [], filters: [{ dimension: "page", expression: url }], rowLimit: 1 }),
  ]);
  if (q.state !== "ok") return absent(q);
  if (t.state !== "ok") return absent(t);
  const total = t.value.rows[0];
  return {
    ...q,
    value: {
      start: q.value.startDate,
      end: q.value.endDate,
      totals: total
        ? { clicks: total.clicks, impressions: total.impressions, ctr: total.impressions ? total.ctr : null, position: total.impressions ? total.position : null }
        : { clicks: 0, impressions: 0, ctr: null, position: null },
      queries: q.value.rows.map((r) => ({ query: r.keys[0] ?? "", clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
    },
  };
}

async function pageInspection(path: string): Promise<Reading<PageInspectionView>> {
  const g = await gsc();
  const r = await g.indexing();
  if (r.state !== "ok") return absent(r);
  const row = r.value.rows.find((x) => x.path === path);
  if (!row) return waiting("gsc", `The daily index check of ${r.value.day} has no result for this address: only addresses in the sitemap are inspected.`);
  return {
    ...r,
    value: { day: r.value.day, indexed: row.indexed, verdict: row.verdict, coverage: row.coverage, lastCrawl: row.lastCrawl, googleCanonical: row.googleCanonical, canonicalOk: row.canonicalOk, link: row.link },
  };
}

async function pageHistory(path: string, crawledAt: string | null): Promise<{ reading: Reading<PageHistoryItem[]>; files: string[] }> {
  const s = await site();
  const items: PageHistoryItem[] = [];
  const url = absUrl(path);
  for (const a of activity(500, ["page"])) {
    if (a.href !== url && !a.text.startsWith(`${path}:`) && !a.text.endsWith(`: ${path}`)) continue;
    const line = crawlLine(a.text);
    items.push({ id: `a${a.id}`, at: a.at, tone: a.tone, text: line.text, detail: a.detail ?? null, who: null, href: null, kind: "crawl" });
  }
  let files: string[] = [];
  let note = "What the crawl saw change between two crawls.";
  if (s.readCopyExists() && s.repoFetchedAt()) {
    const o = ownership();
    files = o.value?.files[path] ?? [];
    const own = new Set(files);
    const name = namer();
    if (own.size) {
      for (const c of await history()) {
        if (!c.paths.some((p) => own.has(p))) continue;
        items.push({ id: c.sha, at: c.at, tone: /^Publish\b/.test(c.subject) ? "good" : "info", text: c.subject, detail: `${c.paths.filter((p) => own.has(p)).length} of its own files · ${c.sha.slice(0, 7)}`, who: name(c), href: s.commitUrl(c.sha), kind: "commit" });
        if (items.filter((i) => i.kind === "commit").length >= 12) break;
      }
      note = "Commits to the files only this page uses, and what the crawl saw change between two crawls.";
    } else if (!o.value) {
      note = `What the crawl saw change. ${READING_GRAPH}`;
    } else {
      note = "What the crawl saw change. No file of the website's code belongs to this page alone (it is drawn by a shared route from content other pages share), so no commit can be said to have changed it.";
    }
  }
  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const asOf = olderOf(files.length ? s.repoFetchedAt() : null, crawledAt) ?? new Date().toISOString();
  return { reading: ok(items, files.length ? "repo" : "crawl", asOf, note), files };
}

routes.get("/view", async (c) => {
  const range = rangeOf(c.req.query("range"));
  const raw = (c.req.query("path") ?? "").trim();
  const specimen = specimenAllowed(c);
  let path = raw;
  try {
    path = raw.startsWith("/") ? raw : new URL(raw).pathname;
  } catch {
    path = "";
  }
  path = path.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  if (!raw || !path.startsWith("/") || path.length > 400) return c.json({ error: "Name the page by its address, for example ?path=/seo." }, 400);

  const until = Date.now() + PATIENCE_MS;
  const inv = await reading("crawl", inventory);
  const facts = await reading("crawl", () => factsView(path, inv));
  const [traffic, events, enquiries, speed, search, inspection, hist] = await Promise.all([
    inTime(reading("ga4", () => pageTraffic(path, range)), until),
    inTime(reading("ga4", () => pageEvents(path, range)), until),
    reading("engine", () => pageEnquiries(path, range)),
    reading("psi", () => pageSpeed(path)),
    reading("gsc", () => pageSearch(path, range)),
    reading("gsc", () => pageInspection(path)),
    pageHistory(path, inv.state === "ok" ? inv.value.asOf : null).catch((e: unknown) => ({ reading: waiting<PageHistoryItem[]>("repo", `The last read failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200)), files: [] as string[] })),
  ]);
  const fed = specimen && (search.state !== "ok" || inspection.state !== "ok");
  const stamp = new Date().toISOString();
  return c.json<PageViewPayload>({
    path,
    range,
    specimen: fed,
    facts,
    score: scoreView(facts),
    traffic,
    events,
    enquiries,
    speed,
    search: specimen && search.state !== "ok" ? ok(SPECIMEN_SEARCH, "gsc", stamp, "Specimen data: made up, shown only on the workstation with ?specimen=1.") : search,
    inspection: specimen && inspection.state !== "ok" ? ok(SPECIMEN_INSPECTION, "gsc", stamp, "Specimen data: made up, shown only on the workstation with ?specimen=1.") : inspection,
    history: hist.reading,
    ownFiles: hist.files,
    crawl: crawlJob(),
  });
});
