import { Hono } from "hono";
import { db } from "../../../db.ts";
import { me, type Vars } from "../../access.ts";
import { status as jobStatus } from "../../scheduler.ts";
import * as crux from "../../search/crux.ts";
import * as gsc from "../../search/gsc.ts";
import * as site from "../../site/index.ts";
import { off, ok, reading, series, waiting } from "../../store.ts";
import { scrub } from "../../system.ts";
import type { JobListed, Reading } from "../../../../web/src/contract/common.ts";
import type { NewTask } from "../../../../web/src/contract/operator.ts";
import type { ReadinessCheck } from "../../../../web/src/contract/seo/ai-search.ts";
import type {
  BrokenCheck,
  Indexation,
  IndexRequest,
  IssueGroup,
  LinkRow,
  RedirectsCheck,
  RobotsFile,
  SchemaCheck,
  SeoTechnicalPayload,
  SitemapCheck,
  SpeedRun,
  SpeedSweepInfo,
  TechLine,
  TechPage,
  TechVitals,
  VitalFigure,
} from "../../../../web/src/contract/seo/technical.ts";
import { allOpportunities, clusterNames, rank, toRow } from "../../seo/engine.ts";
import { coverageGroups, latestInspection, type InspectRow } from "../../seo/indexation.ts";
import { daysOf } from "../../seo/rank.ts";
import { siteReadiness } from "../../seo/readiness.ts";
import { ownTitle, siteView, type SiteView } from "../../seo/site.ts";
import { head, rangeFrom } from "./shared.ts";

/**
 * /api/v1/seo/technical — SEO › Technical (board 113, panel 7): the site's
 * technical health by the crawl's rules, Core Web Vitals, Google's index
 * state with what each state means and what fixes it, the sitemap and
 * robots.txt, structured data, redirects and broken links.
 *
 *   GET /?range=7d|30d|90d|1y   the whole page (SeoTechnicalPayload)
 *
 * The page changes nothing here. Its buttons use doors that exist already:
 * POST /api/v1/seo/indexing/requested (a person marks a page submitted in
 * Search Console's URL Inspection, by hand), POST /api/v1/jobs/speed/run (the
 * PageSpeed test now), POST /api/v1/operator/tasks (the operator proposes
 * titles, descriptions or redirects; they wait for a person's approval),
 * POST /api/v1/seo/opportunities/act { id } (one technical opportunity's own
 * action: an operator task, the to-do list for the website's code, or Request
 * indexing marked) and POST /api/v1/seo/opportunities/owner-task { task } (a
 * step from the audit marked done by whoever took it; the owner's own steps
 * by the owner only, which is why the payload says who is looking).
 *
 * WHERE EACH PANEL COMES FROM, and none asks anybody anything while the page
 * is drawn (the Chrome UX Report is read from the desk's own copy, kept a day):
 *
 *   the desk's crawl         score, checklist, issues by rule, pages, schema,
 *                            redirects, broken links (src/cc/site)
 *   the sitemap job          sitemap.xml and robots.txt, every quarter hour
 *   the AI-readiness job     robots.txt for each named crawler, /llms.txt,
 *                            Bing Webmaster (src/cc/seo/readiness.ts)
 *   Google's URL Inspection  the index state of every sitemap address, daily
 *                            (src/cc/seo/indexation.ts, from gsc.ts)
 *   PageSpeed Insights       lab runs (LCP, CLS, TBT); field data when Google
 *                            has any, and the Chrome UX Report for the origin
 *   the opportunity engine   the technical opportunities and the
 *                            Request indexing queue (src/cc/seo/engine.ts)
 *
 * Every panel is its own reading, so one source that fails costs one panel.
 * Every checklist line is read on its own, for the same reason.
 */
export const routes = new Hono<Vars>();

/* ---------- small helpers ------------------------------------------------------------------- */

const NOT_CRAWLED = "The first crawl has not finished yet. It starts about a minute after the desk does and takes under a minute.";
const NO_READINESS =
  "The AI-readiness check has not run yet. It reads robots.txt for each named crawler, /llms.txt and every page once a day (Automations: Check AI readiness), or now with Run full SEO audit.";

const failed = (e: unknown): string => `The last read failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`;
const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

/** Each line, panel or list read on its own: a throw becomes the reason, never a broken page. */
function quiet<T>(source: Reading<T>["source"], make: () => Reading<T>): Reading<T> {
  try {
    return make();
  } catch (e) {
    return waiting(source, failed(e));
  }
}

const METADATA_TASK: NewTask = { kind: "metadata", depth: "deep" };
const REDIRECT_TASK: NewTask = { kind: "redirect", depth: "deep" };

/** The rule ids, typed: a rule that is renamed in rules.ts breaks the type check here, not the page. */
const R = <T extends site.RuleId[]>(...ids: T): T => ids;

/** The checklist's rules, by line. Only critical and warning findings count, as on every line of the crawl. */
const LINE_RULES = {
  descriptions: R("description.missing"),
  titles: R("title.missing"),
  schema: R("schema.none", "schema.incomplete", "schema.unreadable"),
  /* The text comparison and the loop check come with the crawler upgrade (the next release). */
  duplicates: ["content.duplicate", "content.near-duplicate"] as unknown as site.RuleId[],
  alt: R("images.alt-absent"),
  redirects: ["redirect.broken", "redirect.chain", "redirect.loop", "page.redirects"] as unknown as site.RuleId[],
};

/** The operator's fix for a rule, where it has one: titles and descriptions, and redirects for what no longer answers. */
function fixFor(rule: string): { label: string; task: NewTask } | null {
  if (rule.startsWith("title.") || rule.startsWith("description.")) return { label: "Propose titles and descriptions", task: METADATA_TASK };
  if (rule === "links.broken" || rule === "redirect.broken" || rule === "page.status") return { label: "Propose redirects", task: REDIRECT_TASK };
  return null;
}

const SEV_RANK: Record<site.Severity, number> = { critical: 0, warning: 1, opportunity: 2 };

/** Findings grouped by rule, worst first, each group with its pages and the crawl's own words. */
function groups(list: site.Finding[]): IssueGroup[] {
  const by = new Map<string, IssueGroup & { lines: { path: string | null; text: string }[] }>();
  for (const f of list) {
    const rule = site.RULES[f.rule];
    const g = by.get(f.rule) ?? { rule: f.rule, title: rule.title, severity: f.severity, cost: rule.cost, count: 0, pages: [], area: rule.area, scope: rule.scope, lines: [], fix: fixFor(f.rule) };
    g.count++;
    if (f.path && !g.pages.includes(f.path)) g.pages.push(f.path);
    if (g.lines.length < 60) g.lines.push({ path: f.path, text: f.text });
    by.set(f.rule, g);
  }
  return [...by.values()].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.count - a.count || b.cost - a.cost);
}

/** A job as the page shows it: the scheduler's record, notes scrubbed. Null when the job is not on this desk. */
function job(name: string): JobListed | null {
  try {
    const j = jobStatus().find((x) => x.name === name);
    if (!j) return null;
    return { ...j, lastNote: j.lastNote === null ? null : scrub(j.lastNote), progress: j.progress?.what ? { ...j.progress, what: scrub(j.progress.what) } : j.progress };
  } catch {
    return null;
  }
}

/** "30 Sep" */
const dayWords = (d: string): string => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * When the newest day's inspection was really read: the last answer Google
 * gave that day (cc_inspect.checked_at), else the inspection job's last end,
 * else only the day itself. Never a time of day the desk did not record.
 */
function inspectedAt(day: string): string {
  try {
    const r = db.prepare("SELECT MAX(checked_at) AS at FROM cc_inspect WHERE day = ?").get(day) as { at: string | null } | undefined;
    if (r?.at) return r.at;
  } catch {
    /* the job's record below */
  }
  const end = job("gsc-inspect")?.lastEnd ?? null;
  return end && end.slice(0, 10) === day ? end : day;
}

/** Search Console's state, or why it has none: not connected (off, with the step) or not inspected yet. */
function inspection(): { ok: true; day: string; at: string; rows: InspectRow[]; of: number | null } | { ok: false; why: Reading<never> } {
  const a = gsc.access();
  if (a.state !== "ok") return { ok: false, why: off("gsc", gsc.reasonFor(a), gsc.stepFor(a)) };
  const ins = latestInspection();
  if (!ins || !ins.rows.length) {
    return {
      ok: false,
      why: waiting("gsc", "Google's URL Inspection of every sitemap address runs once a day (Automations: Inspect sitemap addresses in Google); it has not finished a first round on this desk yet."),
    };
  }
  return { ok: true, ...ins, at: inspectedAt(ins.day) };
}

/* ---------- the board's checklist ----------------------------------------------------------- */

function checklist(view: SiteView, findings: Reading<site.Finding[]>, days: number): TechLine[] {
  const at = site.crawledAt();
  const issueCount = (rules: readonly string[]): { count: number; worst: site.Severity | null } => {
    if (findings.state !== "ok") return { count: 0, worst: null };
    const mine = findings.value.filter((f) => rules.includes(f.rule) && f.severity !== "opportunity");
    return { count: mine.length, worst: mine.length ? mine.reduce<site.Severity>((w, f) => (SEV_RANK[f.severity] < SEV_RANK[w] ? f.severity : w), "warning") : null };
  };
  const crawled = (count: number, o: { of?: number | null; previous?: number | null; tone: "good" | "warn" | "bad" | "info" }, noteText?: string): TechLine["reading"] =>
    at ? ok({ count, of: o.of ?? null, previous: o.previous ?? null, tone: o.tone }, "crawl", at, noteText) : waiting("crawl", NOT_CRAWLED);
  const byRules = (rules: readonly string[]): TechLine["reading"] => {
    if (findings.state !== "ok") return findings;
    const { count, worst } = issueCount(rules);
    return crawled(count, { tone: count === 0 ? "good" : worst === "critical" ? "bad" : "warn" });
  };
  const line = (key: TechLine["key"], label: string, rule: string, href: string, make: () => TechLine["reading"], fix: (r: TechLine["reading"]) => TechLine["fix"] = () => null): TechLine => {
    const r = quiet(key === "in-index" ? "gsc" : key === "slow" ? "psi" : "crawl", make);
    return { key, label, reading: r, rule, href, fix: r.state === "ok" && r.value.count > 0 ? fix(r) : null };
  };
  /* Broken links on the site itself, as the Broken links line read them: only those can a redirect repair. */
  let brokenInside = 0;

  return [
    line("crawled", "Crawled pages", "Addresses the desk's crawl read: every address in the sitemap and the pages the website's repository keeps out of it. The change is against the start of the period, once the daily history reaches back that far.", "#pages", () => {
      const s = site.crawlSummary();
      if (s.state !== "ok") return s;
      const stat = site.pageCount(days);
      return crawled(s.value.pages, { previous: stat.state === "ok" ? stat.value.previous : null, tone: "info" });
    }),
    line("indexable", "Indexable pages", "Sitemap addresses whose live page answers 200 and does not say noindex, of all sitemap addresses, by the crawl. A sitemap page that says noindex is a critical finding.", "#pages", () => {
      const listed = view.pages.filter((p) => p.inSitemap);
      const yes = listed.filter((p) => p.indexable).length;
      return crawled(yes, { of: listed.length, tone: yes === listed.length ? "good" : "bad" });
    }),
    line("in-index", "In Google's index", "Sitemap addresses Google's URL Inspection reported as indexed at its newest daily check. Not Search Console's Page indexing total, which no API gives.", "#indexing", () => {
      const ins = inspection();
      if (!ins.ok) return ins.why;
      const indexed = ins.rows.filter((r) => r.indexed).length;
      const of = ins.of ?? ins.rows.length;
      const hist = series("gsc.indexed", days + 1);
      const before = hist.length > 1 && hist[0]!.day <= new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10) ? hist[0]!.value : null;
      return ok({ count: indexed, of, previous: before, tone: indexed >= of ? "good" : "bad" }, "gsc", ins.at, `URL Inspection, ${ins.day}.`);
    }),
    line(
      "broken",
      "Broken links",
      "Addresses that links on the site point to and that do not answer: on the site (critical) and other sites' pages that are gone (a warning). Other sites are asked at most once a week; one that refuses automated checks is not counted.",
      "#broken",
      () => {
        if (!at) return waiting("crawl", NOT_CRAWLED);
        const inside = site.brokenLinks();
        const outside = site.externalLinks("broken");
        if (inside.state !== "ok") return inside;
        if (outside.state !== "ok") return outside;
        brokenInside = inside.value.length;
        const n = inside.value.length + outside.value.length;
        return crawled(
          n,
          { tone: inside.value.length ? "bad" : outside.value.length ? "warn" : "good" },
          n ? `${plural(inside.value.length, "address", "addresses")} on the site, ${plural(outside.value.length, "page")} on other sites.` : undefined,
        );
      },
      /* A redirect repairs an address on the site; another site's dead page is fixed by changing or removing the link (listed under Broken links). */
      () => (brokenInside > 0 ? { label: "Propose redirects", task: REDIRECT_TASK } : null),
    ),
    line("descriptions", "Missing meta descriptions", "Pages without a meta description, by the crawl.", "#issues", () => byRules(LINE_RULES.descriptions), () => ({ label: "Propose", task: METADATA_TASK })),
    line("titles", "Missing title tags", "Pages without a title, by the crawl.", "#issues", () => byRules(LINE_RULES.titles), () => ({ label: "Propose", task: METADATA_TASK })),
    line("schema", "Missing structured data", "Pages with no structured data, structured data missing a required field, or structured data that is not valid JSON, by the crawl. Pages with only the site's own are listed under Structured data, not counted here.", "#schema", () => byRules(LINE_RULES.schema)),
    line("duplicates", "Duplicate content", "Pages whose own text is the same as, or nearly the same as, another page's, by the crawl's comparison of each page's text.", "#issues", () =>
      "content.duplicate" in site.RULES ? byRules(LINE_RULES.duplicates) : waiting("crawl", "The crawl does not compare page texts yet: that check arrives with the crawler upgrade.")),
    line("slow", "Slow pages (LCP > 2.5 s)", "Pages of the daily PageSpeed test whose mobile lab Largest Contentful Paint is over 2.5 s, of the pages it measured. A lab run on Google's machines, not visitors' field data.", "#speed", () => {
      const runs = site.labRuns("mobile");
      if (runs.state !== "ok") return runs;
      const limit = site.limitsFor("lcp", "lab", "mobile").good;
      const measured = runs.value.filter((r) => r.lcpMs !== null);
      if (!measured.length) return waiting("psi", "The newest speed test measured no page: every run failed. The reasons are under Page speed.");
      const slow = measured.filter((r) => (r.lcpMs as number) > limit).length;
      return ok({ count: slow, of: measured.length, previous: null, tone: slow ? "warn" : "good" }, "psi", runs.asOf, runs.note);
    }),
    line(
      "alt",
      "Missing alt text",
      "Pictures without an alt attribute, by the crawl, counted picture by picture (the crawl's finding is one per page, carrying how many). A picture with an empty alt (decoration) is not counted.",
      "#issues",
      () => {
        if (findings.state !== "ok") return findings;
        const mine = findings.value.filter((f) => (LINE_RULES.alt as readonly string[]).includes(f.rule) && f.severity !== "opportunity");
        const pictures = mine.reduce((s, f) => s + (typeof f.measured === "number" && f.measured > 0 ? f.measured : 1), 0);
        const onPages = new Set(mine.map((f) => f.path ?? "")).size;
        const { worst } = issueCount(LINE_RULES.alt);
        return crawled(pictures, { tone: pictures === 0 ? "good" : worst === "critical" ? "bad" : "warn" }, pictures ? `${plural(pictures, "picture")} on ${plural(onPages, "page")}.` : undefined);
      },
    ),
    line(
      "redirects",
      "Redirect issues",
      "Promised redirects that do not work or loop, and sitemap addresses that redirect, by the crawl. Redirects of more than one hop are listed under Redirects, not counted here.",
      "#redirects",
      () => byRules(LINE_RULES.redirects),
      () => (issueCount(R("redirect.broken")).count ? { label: "Propose redirects", task: REDIRECT_TASK } : null),
    ),
  ];
}

/* ---------- Core Web Vitals and page speed ----------------------------------------------------- */

const INP_STEP =
  "Nothing to connect: Google publishes INP once enough real Chrome visits have been measured. Until then Total Blocking Time, the lab's stand-in, is shown under its own name.";

function fromSite(r: Reading<site.Vital>): Reading<VitalFigure> {
  if (r.state !== "ok") return r;
  const v = r.value;
  return ok(
    { metric: v.metric as VitalFigure["metric"], name: v.name, value: v.value, unit: v.unit, kind: v.kind, rating: v.rating, limits: v.limits, scope: v.scope, pages: v.pages, window: v.kind === "field" ? "28 days" : r.asOf },
    r.source,
    r.asOf,
    r.note,
  );
}

async function vitals(): Promise<TechVitals> {
  const tbt = quiet<VitalFigure>("psi", () => fromSite(site.vital("tbt", "mobile")));
  /* The Chrome UX Report first, when the desk has its key: the whole site's real visits. */
  const field = crux.configured() ? await reading("crux", () => crux.vitals("ALL")) : null;
  if (field?.state === "ok") {
    const v = field.value;
    const asOf = field.asOf;
    const noteText = field.note;
    const win = v.from && v.to ? `28 days to ${dayWords(v.to)}` : "28 days";
    const one = (metric: "lcp" | "inp" | "cls", x: { p75: number } | null): Reading<VitalFigure> => {
      const limits = site.limitsFor(metric, "field");
      const name = site.VITAL_LIMITS[metric].name;
      if (!x) return off("crux", `Google's field data for this site does not include ${name}.`, metric === "inp" ? INP_STEP : undefined);
      return ok(
        { metric, name, value: x.p75, unit: site.VITAL_LIMITS[metric].unit, kind: "field", rating: site.rate(metric, x.p75, { kind: "field" }), limits, scope: "origin", pages: 0, window: win },
        "crux",
        asOf,
        noteText,
      );
    };
    return { lcp: one("lcp", v.lcp), inp: one("inp", v.inp), cls: one("cls", v.cls), tbt };
  }
  /* Otherwise PageSpeed: its field data when its answer carried any, else the lab. INP has no lab version. */
  const now = (metric: "lcp" | "inp" | "cls"): Reading<VitalFigure> =>
    quiet<VitalFigure>("psi", () => {
      const f = site.vital(metric, "mobile", { from: "field" });
      const r = f.state === "ok" || metric === "inp" ? f : site.vital(metric, "mobile");
      if (r.state !== "ok" && metric === "inp" && r.state === "off" && r.source === "crux") return off("crux", r.reason, INP_STEP);
      return fromSite(r);
    });
  return { lcp: now("lcp"), inp: now("inp"), cls: now("cls"), tbt };
}

function speed(): SeoTechnicalPayload["speed"] {
  const runs = site.labRuns("mobile");
  if (runs.state !== "ok") return runs;
  const rated = (metric: "lcp" | "cls" | "tbt", v: number | null) => (v === null ? null : site.rate(metric, v, { kind: "lab", strategy: "mobile" }));
  const rows: SpeedRun[] = runs.value
    .map((r) => ({
      path: r.path,
      lcpMs: r.lcpMs,
      cls: r.cls,
      tbtMs: r.tbtMs,
      at: r.at,
      strategy: r.strategy,
      performance: r.scores.performance,
      rating: { lcp: rated("lcp", r.lcpMs), cls: rated("cls", r.cls), tbt: rated("tbt", r.tbtMs) },
      failure: r.failure,
    }))
    .sort((a, b) => (b.lcpMs ?? -1) - (a.lcpMs ?? -1) || a.path.localeCompare(b.path));
  const lcpLimits = site.limitsFor("lcp", "lab", "mobile");
  const measured = rows.filter((r) => r.lcpMs !== null);
  const info: SpeedSweepInfo = { strategy: "mobile", lcpLimits, measured: measured.length, slow: measured.filter((r) => (r.lcpMs as number) > lcpLimits.good).length, failed: rows.filter((r) => r.failure || r.lcpMs === null).length };
  return ok({ rows, ...info }, runs.source, runs.asOf, runs.note);
}

/* ---------- Google's index ------------------------------------------------------------------- */

const canon = (u: string | null): string | null => (u ? u.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "").toLowerCase() : null);

function indexation(view: SiteView): Reading<Indexation> {
  const ins = inspection();
  if (!ins.ok) return ins.why;
  const groups = coverageGroups(ins.rows, (p) => {
    const page = view.byPath.get(p);
    return page ? page.indexable : null;
  });
  const indexedLine = series("gsc.indexed", 120);
  const notLine = new Map(series("gsc.not_indexed", 120).map((p) => [p.day, p.value]));
  const history = indexedLine.map((p) => ({ day: p.day, indexed: p.value, notIndexed: notLine.get(p.day) ?? 0 })).filter((p) => notLine.has(p.day));

  const coverage = new Map(ins.rows.map((r) => [r.path, r.coverage]));
  const names = clusterNames();
  const queue: IndexRequest[] = allOpportunities()
    .filter((o) => o.type === "not-indexed" && o.active)
    .map((o) => toRow(o, view, names))
    .filter((o) => o.state.state !== "dismissed" && o.state.state !== "done")
    .map((o) => {
      const path = o.subject.page?.path ?? o.id.replace(/^not-indexed:/, "");
      const submitted = o.state.state === "in-progress";
      return {
        path,
        coverage: coverage.get(path) ?? null,
        priority: o.priority,
        opportunityId: o.id,
        submitted,
        submittedBy: submitted ? o.state.by : null,
        submittedAt: submitted ? o.state.at : null,
        href: o.action.href,
      };
    })
    .sort((a, b) => Number(a.submitted) - Number(b.submitted) || ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority]) || a.path.localeCompare(b.path));

  const canonicalDiffers = ins.rows
    .filter((r) => r.googleCanonical && r.userCanonical && canon(r.googleCanonical) !== canon(r.userCanonical))
    .map((r) => ({ path: r.path, declared: r.userCanonical, chosen: r.googleCanonical }));

  return ok(
    { day: ins.day, inspected: ins.rows.length, of: ins.of, indexed: ins.rows.filter((r) => r.indexed).length, groups, history, queue, canonicalDiffers },
    "gsc",
    ins.at,
    `Google's URL Inspection of every sitemap address, once a day (newest: ${ins.day}). Google's stored state: it changes when Google crawls the page again, not when the page changes.`,
  );
}

/* ---------- sitemap, robots.txt, llms.txt, site-wide checks ------------------------------------- */

const LASTMOD_TASK = "Give every sitemap entry the date its content last changed (app/sitemap.ts), not the build time: Google uses a real lastmod to notice new and changed pages.";

const ruleFinding = (i: site.Issue) => ({ rule: i.rule, title: site.RULES[i.rule].title, severity: i.severity, text: i.text });

function sitemapCheck(view: SiteView): Reading<SitemapCheck> {
  const m = site.lastSitemap();
  if (!m) return waiting("crawl", "The sitemap has not been read yet; the first read happens within a minute of the desk starting, then every quarter of an hour.");
  const entries = m.entries;
  const withLastmod = entries.filter((e) => e.lastmod).length;
  const allDated = withLastmod === entries.length && entries.length > 0;
  const kinds = new Map<string, { kind: string; label: string; addresses: number; withLastmod: number }>();
  for (const e of entries) {
    const p = view.byPath.get(e.path);
    const kind = p?.kind ?? "unknown";
    const k = kinds.get(kind) ?? { kind, label: p?.kindLabel ?? "Not crawled", addresses: 0, withLastmod: 0 };
    k.addresses++;
    if (e.lastmod) k.withLastmod++;
    kinds.set(kind, k);
  }
  const named = m.robots.sitemaps.some((s) => /\/sitemap\.xml$/i.test(s.trim()));
  return ok(
    {
      addresses: entries.length,
      withLastmod,
      ok: allDated,
      line:
        m.status !== 200
          ? `sitemap.xml ${m.status ? `answers ${m.status}` : "does not answer"}${m.entriesAt ? `; the addresses are from the last read that worked (${m.entriesAt.slice(0, 10)})` : ""}.`
          : `sitemap.xml answers 200 and lists ${plural(entries.length, "address", "addresses")}; ${allDated ? "every one carries a lastmod" : `${withLastmod.toLocaleString("en-GB")} carry a lastmod`}.`,
      codeTask: allDated ? null : LASTMOD_TASK,
      status: m.status,
      readAt: m.at,
      findings: m.issues.filter((i) => i.rule.startsWith("sitemap.") && i.rule !== "sitemap.blocked").map(ruleFinding),
      named,
      byKind: [...kinds.values()].sort((a, b) => b.addresses - a.addresses),
    },
    "crawl",
    m.at,
    "Read from the live website every quarter of an hour by the desk's sitemap job.",
  );
}

function robots(): SeoTechnicalPayload["robots"] {
  const m = site.lastSitemap();
  if (!m) return waiting("crawl", "robots.txt has not been read yet; the sitemap job reads it within a minute of the desk starting, then every quarter of an hour.");
  const ready = siteReadiness();
  const file: RobotsFile = {
    sitemaps: m.robots.sitemaps,
    rules: m.robots.rules,
    readAt: m.at,
    findings: m.issues.filter((i) => i.rule.startsWith("robots.") || i.rule === "sitemap.blocked").map(ruleFinding),
    agentsAt: ready?.at ?? null,
  };
  return ok(
    { status: m.robots.status, agents: ready?.robots.agents ?? [], ...file },
    "crawl",
    m.at,
    ready ? `The file as the sitemap job read it; each crawler's access as the AI-readiness check read it (${ready.at.slice(0, 10)}).` : `The file as the sitemap job read it. ${NO_READINESS}`,
  );
}

function llms(): SeoTechnicalPayload["llms"] {
  const ready = siteReadiness();
  if (!ready) return waiting("crawl", NO_READINESS);
  return ok(ready.llms, "crawl", ready.at, "Optional: Google says it is not needed, and no AI company's crawler documentation asks for it.");
}

/** The sitemaps Search Console knows: its own record, kept a day and read fresh by the daily inspection. */
async function submitted(): Promise<SeoTechnicalPayload["submitted"]> {
  const r = await gsc.sitemaps();
  if (r.state !== "ok") return r;
  return ok(
    { rows: r.value.map((s) => ({ path: s.path, lastSubmitted: s.lastSubmitted, lastDownloaded: s.lastDownloaded, isPending: s.isPending, isIndex: s.isIndex, warnings: s.warnings, errors: s.errors, submitted: s.submitted })) },
    r.source,
    r.asOf,
    "Search Console's own record of the sitemaps submitted to it: when Google last fetched each and how many addresses it counted. It is not how many are indexed.",
  );
}

const SITE_KEYS = ["robots", "lastmod", "llms", "bing"];

function siteChecks(): Reading<{ rows: ReadinessCheck[] }> {
  const ready = siteReadiness();
  if (!ready) return waiting("crawl", NO_READINESS);
  return ok({ rows: SITE_KEYS.map((k) => ready.checks.find((c) => c.key === k)).filter((c): c is ReadinessCheck => !!c) }, "crawl", ready.at, "The AI-readiness check's site-wide items that belong to the technical side.");
}

/* ---------- the crawl's panels -------------------------------------------------------------------- */

function schema(view: SiteView, findings: Reading<site.Finding[]>): Reading<SchemaCheck> {
  if (findings.state !== "ok") return findings;
  const types = site.schemaTypes();
  if (types.state !== "ok") return types;
  const answering = view.pages.filter((p) => p.status === 200);
  const mine = findings.value.filter((f) => site.RULES[f.rule].area === "schema");
  const invalid = new Set(mine.filter((f) => f.rule === "schema.unreadable" || f.rule === "schema.incomplete").map((f) => f.path)).size;
  return ok(
    { types: types.value, withSchema: answering.filter((p) => p.schemaTypes.length > 0).length, read: answering.length, invalid, rows: groups(mine) },
    "crawl",
    findings.asOf,
    "The JSON-LD on each page as the crawl read it, held against the fields Google requires for each type. Google's own Rich Results test is not asked.",
  );
}

const linkRow = (l: site.BrokenLink): LinkRow => ({ target: l.target, status: l.status, lands: l.lands, remark: l.remark, sources: l.sources.slice(0, 20) });

function redirectsCheck(view: SiteView, findings: Reading<site.Finding[]>): Reading<RedirectsCheck> {
  const tried = site.redirects();
  if (tried.state !== "ok") return tried;
  const through = site.redirectedLinks();
  const sitemapRedirects =
    findings.state === "ok"
      ? findings.value.filter((f) => f.rule === "page.redirects" && f.path).map((f) => ({ path: f.path as string, to: view.byPath.get(f.path as string)?.redirectTo ?? null }))
      : [];
  const rows = tried.value.map((r) => ({ source: r.source, destination: r.destination, by: r.by, tested: r.tested, status: r.status, lands: r.lands, landed: r.landed, hops: r.hops, outcome: r.outcome, remark: r.remark }));
  return ok(
    {
      rows: rows.sort((a, b) => ({ broken: 0, chain: 1, untested: 2, ok: 3 })[a.outcome] - ({ broken: 0, chain: 1, untested: 2, ok: 3 })[b.outcome] || a.source.localeCompare(b.source)),
      working: rows.filter((r) => r.outcome === "ok").length,
      broken: rows.filter((r) => r.outcome === "broken").length,
      chains: rows.filter((r) => r.outcome === "chain").length,
      linksThrough: through.state === "ok" ? through.value.map(linkRow) : [],
      sitemapRedirects,
    },
    "crawl",
    tried.asOf,
    "Every redirect the website's config promises, those approved on the desk, and the bare domain's, each tried once at the last crawl.",
  );
}

function brokenCheck(view: SiteView): Reading<BrokenCheck> {
  const inside = site.brokenLinks();
  if (inside.state !== "ok") return inside;
  const outside = site.externalLinks("broken");
  const unchecked = site.externalLinks("unchecked");
  return ok(
    {
      inside: inside.value.map(linkRow),
      outside: outside.state === "ok" ? outside.value.map(linkRow) : [],
      unchecked: unchecked.state === "ok" ? unchecked.value.length : 0,
      pagesDown: view.pages.filter((p) => p.status !== 200 && !(p.status >= 300 && p.status < 400)).map((p) => ({ path: p.path, status: p.status })),
    },
    "crawl",
    inside.asOf,
    "Links on the site to its own addresses are checked at every crawl; other sites are asked at most once a week, and one that refuses automated checks is “could not check”, not broken.",
  );
}

function pages(view: SiteView): Reading<{ rows: TechPage[]; read: number; scored: number }> {
  if (!view.at) return waiting("crawl", NOT_CRAWLED);
  let index = new Map<string, InspectRow>();
  try {
    index = new Map((latestInspection()?.rows ?? []).map((r) => [r.path, r]));
  } catch {
    /* the index column stays empty: said by the column's head */
  }
  const rows: TechPage[] = view.pages.map((p) => {
    const g = index.get(p.path);
    return {
      path: p.path,
      title: ownTitle(p.title),
      kindLabel: p.kindLabel,
      status: p.status,
      inSitemap: p.inSitemap,
      indexable: p.indexable,
      score: p.score,
      critical: p.issues.critical,
      warning: p.issues.warning,
      opportunity: p.issues.opportunity,
      inIndex: g ? g.indexed : null,
      coverage: g?.coverage ?? null,
    };
  });
  rows.sort((a, b) => (a.score ?? 101) - (b.score ?? 101) || b.critical - a.critical || b.warning - a.warning || b.opportunity - a.opportunity || a.path.localeCompare(b.path));
  return ok({ rows, read: rows.length, scored: rows.filter((r) => r.score !== null).length }, "crawl", view.at, "Each page's score by the crawl's stated rules (src/cc/site/rules.ts). Google's index state from its newest URL Inspection.");
}

/* ---------- the page -------------------------------------------------------------------------------- */

routes.get("/", async (c) => {
  const range = rangeFrom(c);
  const days = daysOf(range);
  const view = siteView();
  const findings = quiet<site.Finding[]>("crawl", () => site.issues());

  const vit = await vitals().catch((e: unknown): TechVitals => {
    const w = waiting<VitalFigure>("psi", failed(e));
    return { lcp: w, inp: w, cls: w, tbt: w };
  });

  let checks: TechLine[];
  try {
    checks = checklist(view, findings, days);
  } catch (e) {
    checks = [{ key: "crawled", label: "Crawled pages", reading: waiting("crawl", failed(e)), rule: "The checklist could not be read.", href: "#pages", fix: null }];
  }

  let opportunities: SeoTechnicalPayload["opportunities"] = [];
  try {
    const names = clusterNames();
    opportunities = allOpportunities()
      .filter((o) => o.type === "technical" && o.active)
      .map((o) => toRow(o, view, names))
      .sort(rank);
  } catch {
    opportunities = [];
  }

  const body: SeoTechnicalPayload = {
    head: head(range),
    score: quiet("crawl", () => site.siteScore(days)),
    crawl: quiet("crawl", () => {
      const s = site.crawlSummary();
      if (s.state !== "ok") return s;
      const v = s.value;
      return ok({ finished: v.finished, pages: v.pages, inSitemap: v.inSitemap, critical: v.issues.critical, warning: v.issues.warning, opportunity: v.issues.opportunity }, "crawl", s.asOf, s.note);
    }),
    issues: quiet("crawl", () => (findings.state === "ok" ? ok({ rows: groups(findings.value) }, "crawl", findings.asOf, "Every finding of the last crawl by the rules in src/cc/site/rules.ts, worst first.") : findings)),
    indexation: quiet("gsc", () => indexation(view)),
    sitemap: quiet("crawl", () => sitemapCheck(view)),
    robots: quiet("crawl", () => robots()),
    llms: quiet("crawl", () => llms()),
    speed: quiet("psi", () => speed()),
    opportunities,
    checks,
    vitals: vit,
    pages: quiet("crawl", () => pages(view)),
    schema: quiet("crawl", () => schema(view, findings)),
    redirects: quiet("crawl", () => redirectsCheck(view, findings)),
    broken: quiet("crawl", () => brokenCheck(view)),
    siteChecks: quiet("crawl", () => siteChecks()),
    submitted: await reading("gsc", () => submitted()),
    jobs: { crawl: job("crawl"), sitemap: job("sitemap"), speed: job("speed"), inspect: job("gsc-inspect"), readiness: job("seo-readiness") },
    viewer: { owner: !!me(c)?.owner },
  };
  return c.json(body);
});
