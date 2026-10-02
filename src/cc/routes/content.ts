import { Hono } from "hono";
import { db } from "../../db.ts";
import { me, type Vars } from "../access.ts";
import { status as jobStatus } from "../scheduler.ts";
import { specimenAllowed } from "../specimen.ts";
import { keep, kept, ok, reading, today, waiting } from "../store.ts";
import type { Range, Reading, Stat } from "../../../web/src/contract/common.ts";
import type {
  ArticleRow,
  BingKeywordRow,
  ChangeRow,
  ContentKind,
  ContentLimits,
  ContentPayload,
  CoverageRow,
  EngagementRow,
  GapList,
  ImageCoverage,
  Linking,
  LinkingRow,
  MetaField,
  MetaProblem,
  MetaRow,
  SchemaCoverage,
  ThinRow,
  VisitSpan,
} from "../../../web/src/contract/content.ts";
import type { Finding, PageRow } from "../site/index.ts";
import type { PageRow as GaPageRow, Span } from "../ga4.ts";

/**
 * /api/v1/content — the Content screen: the quality and coverage of what is
 * written on balkaris.ch.
 *
 * ONE GET answers the whole screen. Each panel is its own reading, made
 * inside `reading()`, so one source that fails costs one panel and never the
 * screen. The collectors are loaded with import() inside those readings for
 * the same reason: a collector whose module will not load becomes one absent
 * panel here, not a screen that answers 503.
 *
 * WHERE EACH FIGURE COMES FROM
 *   crawl   words, titles, descriptions, kinds, structured data, links: the
 *           desk's own read of every served page (src/cc/site/crawl.ts)
 *   repo    article dates (the articles' own files) and when each page file
 *           last changed (git), read through the desk's read copy
 *   assets  the alt-text picture, joined from the crawl by the asset
 *           collector (its rule: alt="" is decoration and correct; only a
 *           missing alt attribute is a fault)
 *   desk    drafts waiting at the desk
 *   ga4     visitors and engagement time per page: consenting visitors only
 *   gsc     content gaps, once Search Console is connected
 *   bing    keyword statistics, once the Bing key exists
 *
 * Nothing here is invented to fill a gap. `?specimen=1` (development only,
 * decided by specimenAllowed) feeds the two panels whose keys do not exist
 * yet from the SPECIMEN_ rows at the bottom of this file, and says so.
 */
export const routes = new Hono<Vars>();

/* ---------- yardsticks --------------------------------------------------------- */

/**
 * The two "too short" lengths are this screen's own yardstick, stated here
 * and printed on the screen: Google publishes no minimum. A title under 30
 * characters rarely says both what the page is and whose it is; a
 * description under 70 leaves most of the snippet to whatever Google picks.
 * The long limits and the thin-page limit are the crawl's (rules.ts LIMITS).
 */
const SHORT = { title: 30, description: 70 } as const;
/** Words a minute an adult reads a web page at: the usual working figure. */
const WPM = 230;

/* ---------- small helpers ------------------------------------------------------ */

type Absent = Exclude<Reading<unknown>, { state: "ok" }>;
/** A reading with no value, passed on as the reading of something else. */
const pass = <T>(r: Absent): Reading<T> => r;

const chars = (s: string): number => [...s].length;

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : Math.round(((s[mid - 1] as number) + (s[mid] as number)) / 2);
}

const fmt = (n: number): string => new Intl.NumberFormat("en-GB").format(n);

/** Whole days from a date or an ISO time to today, in Zurich. */
function daysSince(when: string): number | null {
  const day = /^\d{4}-\d\d-\d\d$/.test(when) ? when : new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(when));
  const a = Date.parse(`${day}T12:00:00Z`);
  const b = Date.parse(`${today()}T12:00:00Z`);
  return Number.isFinite(a) ? Math.max(0, Math.round((b - a) / 86_400_000)) : null;
}

const RANGES: readonly Range[] = ["7d", "30d", "90d", "1y"];
const rangeOf = (asked: string | undefined): Range => (RANGES.includes(asked as Range) ? (asked as Range) : "30d");

/* ---------- the crawl, read once per crawl ---------------------------------------- */

interface CrawlView {
  at: string;
  /** Every page the crawl knows. */
  all: PageRow[];
  /** In the sitemap and answering 200: the pages offered to readers and search. */
  offered: PageRow[];
  /** The rules that fired, by page. */
  rules: Map<string, Set<string>>;
  findings: Finding[];
  /** Titles and descriptions shared by more than one offered page. */
  shared: { title: Map<string, string[]>; description: Map<string, string[]> };
}

let memo: { key: string; view: CrawlView } | null = null;

async function crawlView(): Promise<Reading<CrawlView>> {
  const site = await import("../site/index.ts");
  const inv = site.inventory();
  if (inv.state !== "ok") return pass(inv);
  if (memo && memo.key === inv.asOf) return ok(memo.view, "crawl", inv.asOf);
  const found = site.issues();
  if (found.state !== "ok") return pass(found);
  const dupes = site.duplicates();
  const rules = new Map<string, Set<string>>();
  for (const f of found.value) if (f.path) rules.set(f.path, (rules.get(f.path) ?? new Set()).add(f.rule));
  const shared = { title: new Map<string, string[]>(), description: new Map<string, string[]>() };
  if (dupes.state === "ok") {
    for (const g of dupes.value) for (const p of g.pages) shared[g.field].set(p, g.pages.filter((q) => q !== p));
  }
  const view: CrawlView = {
    at: inv.asOf,
    all: inv.value,
    offered: inv.value.filter((r) => r.inSitemap && r.status === 200),
    rules,
    findings: found.value,
    shared,
  };
  memo = { key: inv.asOf, view };
  return ok(view, "crawl", inv.asOf);
}

const has = (v: CrawlView, path: string, rule: string): boolean => v.rules.get(path)?.has(rule) ?? false;

const CRAWL_NOTE = "The desk's own read of every served page, once a day and whenever the sitemap changes. Scripts are not run: this is what a search engine's first read sees.";

/* ---------- the website's repository, read once per commit ------------------------- */

interface RepoArticle {
  slug: string;
  title: string | null;
  date: string;
  updated: string | null;
  listed: boolean;
  byDesk: boolean;
}

interface RepoFacts {
  /** The newest commit the desk had recorded when this was read. */
  sha: string;
  articles: RepoArticle[];
  /** Each page file with a fixed address, and the last commit that touched it. */
  files: { route: string; file: string; at: string | null; subject: string | null; author: string | null }[];
}

const REPO_KEY = "content:repo:1";
let building: Promise<RepoFacts> | null = null;
let buildError: string | null = null;

/** A page file's address, as structure.ts reads it: route groups vanish, a [param] or private folder has no single address. */
function routeOf(file: string): string | null {
  const m = /^app\/(?:(.*)\/)?page\.(?:tsx|ts|jsx|js|mdx)$/.exec(file);
  if (!m) return null;
  const parts = (m[1] ?? "").split("/").filter((s) => s && !/^\(.*\)$/.test(s));
  if (parts.some((s) => s.includes("[") || s.startsWith("@") || s.startsWith("_"))) return null;
  return `/${parts.join("/")}`;
}

/**
 * Articles written in a content file: each `slug: "…"` followed, before the
 * next slug, by a `date: "YYYY-MM-DD"`. Read as text, because the desk cannot
 * run the website's TypeScript; a slug with no date after it (a reference to
 * another article) is not an article and is skipped.
 */
function articlesIn(text: string, byDesk: boolean): RepoArticle[] {
  const hits = [...text.matchAll(/\bslug:\s*"([^"]+)"/g)];
  const out: RepoArticle[] = [];
  hits.forEach((m, i) => {
    const chunk = text.slice(m.index ?? 0, hits[i + 1]?.index ?? text.length);
    const date = /\bdate:\s*"(\d{4}-\d\d-\d\d)"/.exec(chunk)?.[1];
    if (!date) return;
    const title = /\btitle:\s*"((?:[^"\\]|\\.)*)"/.exec(chunk)?.[1] ?? null;
    out.push({
      slug: m[1] as string,
      title: title ? title.replace(/\\(.)/g, "$1") : null,
      date,
      updated: /\bupdated:\s*"(\d{4}-\d\d-\d\d)"/.exec(chunk)?.[1] ?? null,
      listed: !/\blisted:\s*false\b/.test(chunk),
      byDesk,
    });
  });
  return out;
}

async function buildRepoFacts(sha: string): Promise<RepoFacts> {
  const site = await import("../site/index.ts");
  const files: RepoFacts["files"] = [];
  for (const f of await site.repoFiles("app")) {
    const route = routeOf(f.path);
    if (route === null) continue;
    const c = await site.lastChange(f.path);
    files.push({ route, file: f.path, at: c?.at ?? null, subject: c?.subject ?? null, author: c?.author ?? null });
  }
  const articles: RepoArticle[] = [];
  for (const f of await site.repoFiles("content/posts")) {
    if (!f.path.endsWith(".ts") || f.path.endsWith("/index.ts")) continue;
    const text = await site.repoRead(f.path);
    if (text) articles.push(...articlesIn(text, true));
  }
  const journal = await site.repoRead("content/journal.ts");
  if (journal) articles.push(...articlesIn(journal, false));
  return { sha, files, articles };
}

const REPO_NOTE = "From the website's repository: the articles' own files for their dates, and git for when each page file last changed.";

/**
 * The repository facts at the newest recorded commit. Read in the background
 * the first time after each commit (about fifty small git questions), so a
 * request waits for it three seconds at most; until then it is the answer
 * read at the commit before, labelled, or `waiting`.
 */
async function repoFacts(): Promise<Reading<RepoFacts>> {
  const site = await import("../site/index.ts");
  const dep = site.deployments(1);
  if (dep.state !== "ok") return pass(dep);
  const sha = dep.value[0]?.sha;
  if (!sha) return waiting("repo", "The desk has not recorded a commit of the website yet.");
  const had = kept<RepoFacts>(REPO_KEY);
  if (had && had.value.sha === sha) return ok(had.value, "repo", had.at, REPO_NOTE);

  if (!building) {
    buildError = null;
    building = buildRepoFacts(sha)
      .then((v) => keep(REPO_KEY, v).value)
      .finally(() => {
        building = null;
      });
    building.catch((e: unknown) => {
      buildError = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    });
  }
  const quick = await Promise.race([building.then((v) => v).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 3_000))]);
  if (quick) return ok(quick, "repo", Date.now(), REPO_NOTE);
  if (had) return ok(had.value, "repo", had.at, `${REPO_NOTE} Read at an earlier commit; the newest is being read now.`);
  if (buildError) return waiting("repo", `Reading the website's history failed: ${buildError}`);
  return waiting("repo", "The desk is reading the website's history for the first time; it takes a few seconds. Reload in a moment.");
}

/* ---------- GA4, per page ---------------------------------------------------------- */

interface Visits {
  span: Span;
  byPath: Map<string, GaPageRow>;
}

async function visitsIn(range: Range): Promise<Reading<Visits>> {
  const ga = await import("../ga4.ts");
  const read = await ga.pages(ga.gaRange(range), { screen: true });
  const r = ga.asReading(read, (d) => ({ span: d.span, byPath: new Map(d.rows.map((row) => [row.path, row])) }));
  if (r.state !== "ok") return r;
  const s = r.value.span;
  const covers = s.partial ? `GA4 measured the website from ${s.since}, so this covers ${s.since} to ${s.end}.` : `Covers ${s.start} to ${s.end}.`;
  return { ...r, note: `${r.note ?? ""} ${covers}`.trim() };
}

/* ---------- the panels ----------------------------------------------------------- */

function tiles(v: CrawlView, repo: Reading<RepoFacts>, metadata: MetaRow[], lim: ContentLimits): ContentPayload["tiles"] {
  const judged = v.offered.filter((r) => r.indexable);
  const words = v.offered.map((r) => r.words).filter((w): w is number => w !== null);
  const total = words.reduce((a, b) => a + b, 0);
  const at = v.at;
  const stat = (value: number, extra: Partial<Stat> = {}): Stat => ({ value, previous: null, unit: "count", series: [], ...extra });

  const thin = v.offered.filter((r) => has(v, r.path, "content.thin")).length;
  const count = (field: MetaField) => {
    const rows = metadata.filter((m) => m.field === field);
    const n = (p: MetaProblem) => rows.filter((m) => m.problems.includes(p)).length;
    const parts = [n("missing") ? `${n("missing")} missing` : "", n("long") ? `${n("long")} long` : "", n("short") ? `${n("short")} short` : "", n("duplicate") ? `${n("duplicate")} shared` : ""].filter(Boolean);
    return stat(new Set(rows.map((m) => m.path)).size, { of: judged.length, sub: parts.join(" · ") || "None to fix" });
  };
  const faq = v.offered.filter((r) => r.schemaTypes.includes("FAQPage")).length;

  return {
    words: ok(stat(total, { sub: `Median ${fmt(median(words))} a page` }), "crawl", at, "Words of each page's own content (inside <main>, without the menu and footer), over the pages in the sitemap that answered."),
    thin: ok(stat(thin, { of: v.offered.length, sub: `Under ${lim.thinWords} words each` }), "crawl", at, `Under ${lim.thinWords} words is thin by the desk's yardstick; Google names no number. Pages kept out of search are not counted.`),
    titles: ok(count("title"), "crawl", at, `Titles missing, over ${lim.title} characters (cut in results), under ${lim.titleShort} (the desk's yardstick) or shared with another page. Of the pages offered to search.`),
    descriptions: ok(count("description"), "crawl", at, `Descriptions missing, over ${lim.description} characters (cut in results), under ${lim.descriptionShort} (the desk's yardstick) or shared with another page. Of the pages offered to search.`),
    questions: ok(stat(faq, { of: v.offered.length, sub: "FAQPage structured data" }), "crawl", at, "Pages whose structured data holds an FAQPage. A questions block drawn without that structured data is not counted: the crawl cannot see it."),
    articles: articleTile(repo),
  };
}

/** The crawl's limits, read when the site module is loaded (rules.ts LIMITS). */
const memoLimits: ContentLimits = { title: 60, titleShort: SHORT.title, description: 160, descriptionShort: SHORT.description, thinWords: 250, readingWpm: WPM };

async function limits(): Promise<ContentLimits> {
  try {
    const site = await import("../site/index.ts");
    memoLimits.title = site.LIMITS.title;
    memoLimits.description = site.LIMITS.description;
    memoLimits.thinWords = site.LIMITS.thinWords;
  } catch {
    /* the crawl module did not load: every crawl panel says so, and these defaults (the same values) only word the tooltips */
  }
  return { ...memoLimits };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function articleTile(repo: Reading<RepoFacts>): Reading<Stat> {
  if (repo.state !== "ok") return pass(repo);
  const now = today();
  const [y, m, d] = now.split("-").map(Number) as [number, number, number];
  const month = (back: number) => {
    const t = new Date(Date.UTC(y, m - 1 - back, 1));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const dates = repo.value.articles.map((a) => a.date);
  const inMonth = (key: string) => dates.filter((x) => x.startsWith(key)).length;
  const last = month(1);
  /* The same days of last month, so day 2 of a month is not set against all of the one before. */
  const sameDays = dates.filter((x) => x.startsWith(last) && Number(x.slice(8, 10)) <= d).length;
  const series = [5, 4, 3, 2, 1, 0].map((b) => inMonth(month(b)));
  const drafts = (db.prepare("SELECT COUNT(*) AS n FROM drafts WHERE state = 'draft'").get() as { n: number }).n;
  const lastName = MONTHS[Number(last.slice(5, 7)) - 1] ?? last;
  return ok(
    {
      value: inMonth(month(0)),
      previous: sameDays,
      unit: "count",
      series,
      sub: `${inMonth(last)} in ${lastName.slice(0, 3)}${drafts ? ` · ${drafts} draft${drafts === 1 ? "" : "s"} waiting` : ""}`,
    },
    "repo",
    repo.asOf,
    `Articles dated this month in their own files, listed or not, against the same days of ${lastName}. The bars are the last six months. Drafts are the desk's own, not yet approved.`,
  );
}

function coverage(v: CrawlView, kindLabel: Record<string, string>): CoverageRow[] {
  const by = new Map<ContentKind, PageRow[]>();
  for (const r of v.offered) by.set(r.kind as ContentKind, [...(by.get(r.kind as ContentKind) ?? []), r]);
  return [...by.entries()]
    .map(([kind, rows]) => {
      /* A page the crawl could not read has no word count: it is left out of the median, never counted as 0. */
      const read = rows.map((r) => r.words).filter((w): w is number => w !== null);
      return {
        kind,
        label: kindLabel[kind] ?? kind,
        pages: rows.length,
        medianWords: read.length ? median(read) : null,
        complete: rows.filter((r) => !["title.missing", "description.missing", "share.missing", "schema.none"].some((rule) => has(v, r.path, rule))).length,
        /* The same rule as Structured data coverage (ownTypes), so the two panels agree page for page. */
        ownSchema: rows.filter((r) => ownTypes(r).length > 0).length,
      };
    })
    .sort((a, b) => b.pages - a.pages || a.label.localeCompare(b.label));
}

const PROBLEM_RANK: Record<MetaProblem, number> = { missing: 0, duplicate: 1, long: 2, short: 3 };

function metadata(v: CrawlView, lim: ContentLimits): MetaRow[] {
  const out: MetaRow[] = [];
  for (const r of v.offered.filter((p) => p.indexable)) {
    for (const field of ["title", "description"] as const) {
      const text = (field === "title" ? r.title : r.description)?.trim() || null;
      const length = text ? chars(text) : 0;
      const long = field === "title" ? lim.title : lim.description;
      const short = field === "title" ? lim.titleShort : lim.descriptionShort;
      const sharedWith = v.shared[field].get(r.path) ?? [];
      const problems: MetaProblem[] = [];
      if (!text) problems.push("missing");
      if (sharedWith.length) problems.push("duplicate");
      if (text && length > long) problems.push("long");
      if (text && length < short) problems.push("short");
      if (!problems.length) continue;
      out.push({ path: r.path, kind: r.kind as ContentKind, kindLabel: r.kindLabel, field, problems, text, length, sharedWith });
    }
  }
  const over = (m: MetaRow) => (m.problems.includes("long") ? m.length - (m.field === "title" ? lim.title : lim.description) : 0);
  return out.sort((a, b) => PROBLEM_RANK[a.problems[0] as MetaProblem] - PROBLEM_RANK[b.problems[0] as MetaProblem] || over(b) - over(a) || a.path.localeCompare(b.path));
}

function thin(v: CrawlView, visits: Reading<Visits>): ThinRow[] {
  const byPath = visits.state === "ok" ? visits.value.byPath : null;
  return v.offered
    .filter((r) => has(v, r.path, "content.thin"))
    .map((r) => ({
      path: r.path,
      title: r.title ?? r.h1,
      kind: r.kind as ContentKind,
      kindLabel: r.kindLabel,
      words: r.words ?? 0,
      /* GA4 lists every address that had a visitor; an address it does not list had none it could count. */
      visitors: byPath ? (byPath.get(r.path)?.users ?? 0) : null,
    }))
    .sort((a, b) => (b.visitors ?? 0) - (a.visitors ?? 0) || a.words - b.words || a.path.localeCompare(b.path));
}

function articles(v: CrawlView, repo: Reading<RepoFacts>): ArticleRow[] {
  const facts = repo.state === "ok" ? new Map(repo.value.articles.map((a) => [a.slug, a])) : null;
  return v.all
    .filter((r) => r.kind === "article" && r.status === 200)
    .map((r) => {
      const slug = r.path.replace(/^\/insights\//, "");
      const a = facts?.get(slug);
      const date = a?.date ?? r.lastmod?.slice(0, 10) ?? null;
      return {
        path: r.path,
        title: a?.title ?? r.h1 ?? r.title ?? r.path,
        date,
        dateFrom: a ? "repo" : r.lastmod ? "sitemap" : null,
        updated: a?.updated ?? null,
        ageDays: date ? daysSince(date) : null,
        listed: a ? a.listed : r.inSitemap,
        byDesk: a?.byDesk ?? false,
      } satisfies ArticleRow;
    })
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.path.localeCompare(b.path));
}

function changes(v: CrawlView, repo: Reading<RepoFacts>): ChangeRow[] {
  const files = repo.state === "ok" ? new Map(repo.value.files.map((f) => [f.route, f])) : null;
  return v.all
    .filter((r) => r.kind !== "article" && r.status === 200)
    .map((r) => {
      const f = files?.get(r.path);
      /* The first crawl stamps every page as changed when it first saw it; only a later stamp is a change it observed. */
      const seen = r.lastChanged && r.lastChanged !== r.firstSeen ? r.lastChanged : null;
      const git = f?.at ?? null;
      const useGit = git !== null && (seen === null || git >= seen);
      const changed = useGit ? git : seen;
      return {
        path: r.path,
        title: r.title ?? r.h1,
        kind: r.kind as ContentKind,
        kindLabel: r.kindLabel,
        changed,
        changedFrom: useGit ? "repo" : seen ? "crawl" : null,
        ...(useGit && f?.subject ? { subject: f.subject } : {}),
        ...(useGit && f?.author ? { author: f.author } : {}),
        firstSeen: r.firstSeen,
        ageDays: changed ? daysSince(changed) : null,
      } satisfies ChangeRow;
    })
    .sort((a, b) => (a.changed === null ? 1 : 0) - (b.changed === null ? 1 : 0) || (a.changed ?? "").localeCompare(b.changed ?? "") || a.path.localeCompare(b.path));
}

/**
 * Types the website's layout prints on its pages: they describe the company
 * and the breadcrumb, not the page. The same list as SITE_WIDE in
 * src/cc/site/rules.ts, which decides the crawl's "schema.site-only" rule
 * (not exported there, so written again here; keep the two alike).
 */
const LAYOUT_TYPES = new Set(["Organization", "ProfessionalService", "LocalBusiness", "WebSite", "BreadcrumbList"]);

/**
 * The structured-data types that describe the page itself. Everywhere but the
 * home page, the types other than the layout's. On the home page the
 * company's own types ARE about the page (the crawl excuses it from
 * "schema.site-only" for that reason, rules.ts), so they count there; the
 * breadcrumb never does. Coverage by section and Structured data coverage
 * both count with this one rule, so they cannot disagree.
 */
function ownTypes(r: PageRow): string[] {
  return r.kind === "home" ? r.schemaTypes.filter((t) => t !== "BreadcrumbList") : r.schemaTypes.filter((t) => !LAYOUT_TYPES.has(t));
}

function schema(v: CrawlView, kindLabel: Record<string, string>): SchemaCoverage {
  const offered = v.offered;
  const layoutCount = new Map<string, number>();
  for (const r of offered) for (const t of r.schemaTypes) if (LAYOUT_TYPES.has(t)) layoutCount.set(t, (layoutCount.get(t) ?? 0) + 1);
  const by = new Map<ContentKind, PageRow[]>();
  for (const r of offered) by.set(r.kind as ContentKind, [...(by.get(r.kind as ContentKind) ?? []), r]);
  const kinds = [...by.entries()]
    .map(([kind, rows]) => {
      const types = new Map<string, number>();
      for (const r of rows) for (const t of ownTypes(r)) types.set(t, (types.get(t) ?? 0) + 1);
      const none = rows.filter((r) => has(v, r.path, "schema.none"));
      return {
        kind,
        label: kindLabel[kind] ?? kind,
        pages: rows.length,
        types: [...types].map(([type, pages]) => ({ type, pages })).sort((a, b) => b.pages - a.pages || a.type.localeCompare(b.type)),
        none: none.length,
        /* Structured data, but none of it about the page: by ownTypes, the same rule Coverage by section counts with. */
        siteOnly: rows.filter((r) => !none.includes(r) && r.schemaTypes.length > 0 && ownTypes(r).length === 0).length,
        companyIsOwn: kind === "home",
      };
    })
    .sort((a, b) => b.pages - a.pages || a.label.localeCompare(b.label));
  const none = offered.filter((r) => has(v, r.path, "schema.none")).map((r) => r.path);
  const invalid = v.findings
    .filter((f) => f.path && (f.rule === "schema.unreadable" || f.rule === "schema.incomplete"))
    .map((f) => ({ path: f.path as string, problem: f.rule === "schema.unreadable" ? ("unreadable" as const) : ("incomplete" as const), reason: f.text }));
  const layout = [...layoutCount].map(([type, pages]) => ({ type, pages })).sort((a, b) => b.pages - a.pages || a.type.localeCompare(b.type));
  return { layout, pages: offered.length, kinds, none, invalid };
}

async function images(): Promise<Reading<ImageCoverage>> {
  const site = await import("../site/index.ts");
  const all = site.assets();
  if (all.state !== "ok") return pass(all);
  const by = new Map<string, { path: string; uses: number; written: number; empty: number; absent: number }>();
  const totals = { uses: 0, written: 0, empty: 0, absent: 0 };
  for (const a of all.value) {
    for (const u of a.uses) {
      if (u.how !== "img" || !u.alt) continue;
      const row = by.get(u.page) ?? { path: u.page, uses: 0, written: 0, empty: 0, absent: 0 };
      row.uses++;
      row[u.alt]++;
      totals.uses++;
      totals[u.alt]++;
      by.set(u.page, row);
    }
  }
  const rows = [...by.values()].sort((a, b) => b.absent - a.absent || b.uses - a.uses || a.path.localeCompare(b.path));
  return ok(
    { totals, rows },
    all.source,
    all.asOf,
    'Every <img> of a file in the website\'s public folder, on every crawled page, counted per use. alt="" says "decoration" and is correct; only a missing alt attribute is a fault. Pictures from other hosts are counted on Assets.',
  );
}

function linking(v: CrawlView): Linking {
  const RANK = { "no-inlinks": 0, "one-inlink": 1, "no-outlinks": 2 } as const;
  const rows: LinkingRow[] = v.offered.map((r) => {
    const reasons: LinkingRow["reasons"] = [];
    if (r.path !== "/" && r.inlinks === 0) reasons.push("no-inlinks");
    if (r.inlinks === 1) reasons.push("one-inlink");
    if (r.outlinks === 0) reasons.push("no-outlinks");
    /* null: the crawl could not read the page, so its links out are unknown, not zero. */
    return { path: r.path, title: r.title ?? r.h1, kind: r.kind as ContentKind, kindLabel: r.kindLabel, inlinks: r.inlinks, inlinksFromContent: r.inlinksFromContent, outlinks: r.outlinks, reasons };
  });
  return {
    pages: rows.length,
    flagged: rows
      .filter((r) => r.reasons.length)
      .sort((a, b) => RANK[a.reasons[0] as keyof typeof RANK] - RANK[b.reasons[0] as keyof typeof RANK] || a.inlinks - b.inlinks || a.path.localeCompare(b.path)),
    fewest: (() => {
      const sorted = rows.filter((r) => r.path !== "/").sort((a, b) => a.inlinksFromContent - b.inlinksFromContent || a.inlinks - b.inlinks || a.path.localeCompare(b.path));
      /* Every page that no other page's own text links to; when there is none, the few with the fewest such links. */
      const none = sorted.filter((r) => r.inlinksFromContent === 0);
      return none.length ? none : sorted.slice(0, 8);
    })(),
  };
}

function engagement(v: CrawlView, visits: Visits): EngagementRow[] {
  return v.offered
    .filter((r) => r.words !== null)
    .map((r) => {
      const g = visits.byPath.get(r.path);
      const words = r.words as number;
      return {
        path: r.path,
        title: r.title ?? r.h1,
        kindLabel: r.kindLabel,
        words,
        readingSeconds: Math.round((words / WPM) * 60),
        visitors: g?.users ?? 0,
        engagementSeconds: Math.round(g?.engagementSeconds ?? 0),
      };
    })
    .sort((a, b) => b.words - a.words || a.path.localeCompare(b.path));
}

async function gaps(range: Range, v: Reading<CrawlView>): Promise<Reading<GapList>> {
  const { gsc } = await import("../search/index.ts");
  const titles = v.state === "ok" ? v.value.offered.filter((r) => r.title).map((r) => ({ path: r.path, title: r.title as string, h1: r.h1 })) : [];
  /* Without the crawl every query would look like a gap; say so instead. */
  if (v.state !== "ok" && gsc.configured()) return pass(v);
  const r = await gsc.gaps(range, titles);
  if (r.state !== "ok") return pass(r);
  return {
    ...r,
    value: {
      floor: r.value.floor,
      early: r.value.early,
      rows: r.value.rows.map((g) => ({ query: g.query, impressions: g.impressions, clicks: g.clicks, position: g.position, path: g.path, ...(g.early ? { early: true } : {}) })),
    },
    note: `${r.note ?? ""} Positions are Google's average position, not a tracked rank. Only queries Google already shows the site for can be found this way.`.trim(),
  };
}

async function bingKeywords(range: Range): Promise<Reading<BingKeywordRow[]>> {
  const { bing } = await import("../search/index.ts");
  const r = await bing.queryStats(range);
  if (r.state !== "ok") return pass(r);
  return { ...r, value: r.value.rows.map((b) => ({ query: b.key, clicks: b.clicks, impressions: b.impressions, position: b.avgImpressionPosition })) };
}

/* ---------- the route ------------------------------------------------------------ */

routes.get("/", async (c) => {
  const range = rangeOf(c.req.query("range"));
  const specimen = specimenAllowed(c);
  const lim = await limits();

  /* The three shared reads, in parallel: the crawl, the repository, GA4. */
  const [view, repo, visits] = await Promise.all([reading("crawl", crawlView), reading("repo", repoFacts), reading("ga4", () => visitsIn(range))]);

  let kindLabel: Record<string, string> = {};
  try {
    kindLabel = (await import("../site/index.ts")).KIND_LABEL;
  } catch {
    /* labels fall back to the kind's own name */
  }

  const fromView = async <T>(make: (v: CrawlView) => T, note = CRAWL_NOTE): Promise<Reading<T>> =>
    reading("crawl", () => (view.state === "ok" ? ok(make(view.value), "crawl", view.value.at, note) : pass<T>(view)));

  /* Titles and descriptions first: the two tiles count its rows. */
  const metaPanel = await fromView(
    (v) => metadata(v, lim),
    `Lengths in characters, as a reader counts them. Over ${lim.title} (title) or ${lim.description} (description) is cut in results; under ${lim.titleShort} or ${lim.descriptionShort} is the desk's own yardstick. Google publishes no limits.`,
  );
  let crawlRunning = false;
  try {
    crawlRunning = jobStatus().find((j) => j.name === "crawl")?.running ?? false;
  } catch {
    /* the scheduler could not say; the button still asks, and the server answers for itself */
  }

  const [tileSet, cov, thinPanel, arts, chg, sch, img, lnk, eng, gap, bng] = await Promise.all([
    reading("crawl", () =>
      view.state !== "ok" ? pass<ContentPayload["tiles"]>(view) : metaPanel.state !== "ok" ? pass<ContentPayload["tiles"]>(metaPanel) : ok(tiles(view.value, repo, metaPanel.value, lim), "crawl", view.value.at),
    ),
    fromView(
      (v) => coverage(v, kindLabel),
      `${CRAWL_NOTE} Complete metadata: a title, a description, a share picture and structured data are there; whether they are good is Titles and descriptions. Own structured data: something that describes the page itself, not only the company; on the home page the company's own types count.`,
    ),
    fromView((v) => thin(v, visits), `Under ${lim.thinWords} words of own content: the desk's yardstick, Google names no number. Visitors: GA4, consenting visitors only.`),
    reading("crawl", () => (view.state === "ok" ? ok(articles(view.value, repo), repo.state === "ok" ? "repo" : "crawl", repo.state === "ok" ? repo.asOf : view.value.at, repo.state === "ok" ? "Dates from each article's own file in the website's repository." : `The article files could not be read (${repo.reason}); dates are the sitemap's, which gives the update date when there is one.`) : pass<ArticleRow[]>(view))),
    reading("repo", () => (view.state !== "ok" ? pass<ChangeRow[]>(view) : repo.state !== "ok" ? pass<ChangeRow[]>(repo) : ok(changes(view.value, repo), "repo", repo.asOf, "When each page's own file last changed in git, or when the crawl last saw its words change, whichever is later. Pages drawn from shared files (services, industries) have no file of their own, so only the crawl can say."))),
    fromView((v) => schema(v, kindLabel), `${CRAWL_NOTE} Required fields are Google's for the rich results it documents, and the least each other type needs; Google's Rich Results Test remains the last word.`),
    reading("repo", images),
    fromView(linking, `${CRAWL_NOTE} Links in count every link on other pages, menus included; "from content" leaves the menu and footer out.`),
    reading("ga4", () => (view.state !== "ok" ? pass<EngagementRow[]>(view) : visits.state !== "ok" ? pass<EngagementRow[]>(visits) : { ...visits, value: engagement(view.value, visits.value), note: `${visits.note ?? ""} Reading time at ${WPM} words a minute.`.trim() })),
    specimen ? Promise.resolve(SPECIMEN_GAPS()) : reading("gsc", () => gaps(range, view)),
    specimen ? Promise.resolve(SPECIMEN_BING()) : reading("bing", () => bingKeywords(range)),
  ]);

  /* Without the crawl, the five crawl tiles say why; the articles tile stands on the repository alone. */
  const absentTiles = async (r: Absent): Promise<ContentPayload["tiles"]> => ({ words: r, thin: r, titles: r, descriptions: r, questions: r, articles: await reading("repo", () => articleTile(repo)) });

  const payload: ContentPayload = {
    range,
    specimen,
    limits: lim,
    tiles: tileSet.state === "ok" ? tileSet.value : await absentTiles(tileSet),
    coverage: cov,
    metadata: metaPanel,
    thin: thinPanel,
    visits: visits.state === "ok" ? { ...visits, value: visitSpan(visits.value.span) } : pass<VisitSpan>(visits),
    articles: arts,
    changes: chg,
    schema: sch,
    images: img,
    linking: lnk,
    engagement: eng,
    gaps: gap,
    bing: bng,
    crawl: { finished: view.state === "ok" ? view.value.at : null, running: crawlRunning },
    /* The Insights screen's own rule (routes/insights.ts): its create dialog exists only for this person. */
    canCreate: (() => {
      const who = me(c);
      return who.canPublish && !who.revoked;
    })(),
  };
  return c.json(payload);
});

const visitSpan = (s: Span): VisitSpan => ({ start: s.partial ? s.since : s.start, end: s.end, partial: s.partial, since: s.since });

/* ---------- specimen rows (development only, ?specimen=1) -------------------------- */

/*
 * Obviously artificial: "specimen" queries, round figures, no real page. Shown
 * only when specimenAllowed() says so, which it never does on the real desk.
 */
const SPECIMEN_NOTE = "SPECIMEN: artificial rows to see the connected panel. Not from any source.";

const SPECIMEN_GAPS = (): Reading<GapList> =>
  ok(
    {
      floor: 10,
      early: null,
      rows: [
        { query: "specimen query alpha", impressions: 400, clicks: 4, position: 12.5, path: "/specimen-page-a" },
        { query: "specimen query beta", impressions: 300, clicks: 3, position: 18, path: "/specimen-page-b" },
        { query: "specimen query gamma", impressions: 200, clicks: 0, position: 24.5, path: null },
        { query: "specimen query delta", impressions: 100, clicks: 1, position: 31, path: "/specimen-page-c" },
        { query: "specimen query epsilon", impressions: 50, clicks: 0, position: 45, path: null },
      ],
    },
    "gsc",
    Date.now(),
    SPECIMEN_NOTE,
  );

const SPECIMEN_BING = (): Reading<BingKeywordRow[]> =>
  ok(
    [
      { query: "specimen keyword one", clicks: 10, impressions: 100, position: 5 },
      { query: "specimen keyword two", clicks: 5, impressions: 80, position: 8.5 },
      { query: "specimen keyword three", clicks: 2, impressions: 60, position: 12 },
      { query: "specimen keyword four", clicks: 0, impressions: 40, position: null },
    ],
    "bing",
    Date.now(),
    SPECIMEN_NOTE,
  );
