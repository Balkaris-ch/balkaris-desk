import type { SearchHit, SourceStatus } from "../../../web/src/contract/common.ts";
import { registerSearch } from "../find.ts";
import type { Job } from "../scheduler.ts";
import { registerCheck, registerSource } from "../sources.ts";
import { setState, state } from "../store.ts";
import { assetsJob, findAssets } from "./assets.ts";
import { crawledAt, crawlJob, findPages } from "./crawl.ts";
import { certificate, lastHome, probeJob } from "./probes.ts";
import { lastSweep, speedJob, speedPausedUntil, speedQuota, speedTestedAt } from "./psi.ts";
import { readCopyExists, repoJob } from "./repo.ts";
import { lastSitemap, sitemapJob } from "./sitemap.ts";

/**
 * The desk's own read of the website. No credential is needed for any of it.
 *
 * Six jobs keep it fresh, and everything a screen may ask is re-exported
 * from this file, so a route imports from here and nowhere deeper:
 *
 *   probe    every 2 min   is the site answering, how fast        probes.ts
 *   repo     every 5 min   the website's git history              repo.ts
 *   sitemap  every 15 min  sitemap.xml and robots.txt             sitemap.ts
 *   crawl    every 24 h    every page: facts, links, issues, score  crawl.ts
 *            and whenever the sitemap lists other addresses than the
 *            last finished crawl read (asked again hourly until one has)
 *   assets   every 24 h    every file in public/, measured          assets.ts
 *            and whenever public/ on the branch differs from what was
 *            last measured (the same way)
 *   speed    every 24 h    PageSpeed Insights, lab and field        psi.ts
 *            (after Google answers 429: not ready for 24 hours)
 *
 * Most read functions return a `Reading`: the figure with its source and
 * time, or `waiting` (first run not finished), or `off` with the reason.
 * None returns a bare zero for "not known".
 *
 * SOME RETURN RAW VALUES, and a screen wraps them itself, in
 * `reading("repo", async () => ok(…))` or similar, so a throw costs one panel:
 *
 *   repoFiles, repoRead, lastChange, siteVersions, commitFiles, structure
 *                       async, read git; MAY THROW (no read copy yet, git
 *                       failing). commitFiles and structure answer [] and
 *                       null before the first fetch; repoRead null for a
 *                       file that is not there
 *   commits, commitsSince, repoFetchedAt, readCopyExists, commitUrl
 *                       the desk's own table or state; never throw
 *   findPages, findAssets, searchPages, searchAssets
 *                       plain lists, empty before the first crawl or scan
 *   lastHome, lastSitemap, crawledAt, lastSweep, speedQuota,
 *   speedTestedAt, speedPausedUntil, speedPages, probeTargets
 *                       a value or null; for the top bar's light and for
 *                       this file's own reports
 *
 * NEVER CALL THE WORKING FUNCTIONS FROM A ROUTE: crawl, sweep, scanAssets,
 * fetchRepo, refreshSitemap and probe are exported for the check script.
 * Called from a request they would run beside whatever the scheduler is
 * running, and the scheduler's one-job-at-a-time rule is what keeps the desk
 * inside its 768 MB. A screen that wants fresh work asks the scheduler:
 * runNow("crawl" | "speed" | "assets" | "repo" | "sitemap" | "probe").
 *
 * WHAT THESE JOBS WRITE TO THE ACTIVITY FEED, by `kind`:
 *
 *   "deploy"    a commit on the site's main branch (a production deployment)
 *   "insight"   a commit whose subject begins "Publish": an article listed
 *   "sitemap"   the sitemap's set of addresses changed
 *   "page"      a page is new, gone, or its title, description, heading,
 *               canonical, indexing, status or text changed between crawls
 *   "crawl"     the first crawl
 *   "incident"  the home page stopped answering, or answers again
 *   "probe"     the function probe stopped itself (its route began to
 *               answer GET with a success; see probes.ts)
 *
 * THE WEBSITE'S REPOSITORY is read through a git directory of the desk's own
 * (SITE_READ_REPO, see repo.ts). Nothing in this folder runs git in, or reads,
 * the article publisher's working tree (SITE_REPO).
 */

/* When each job last succeeded, and what its last failure said: the scheduler
   keeps the last run only, and Settings wants "last answered at". */
const tracked = (job: Job): Job => ({
  ...job,
  run: async (ctx) => {
    try {
      const said = await job.run(ctx);
      setState(`site:ok:${job.name}`, new Date().toISOString());
      setState(`site:err:${job.name}`, "");
      return said;
    } catch (e) {
      setState(`site:err:${job.name}`, (e instanceof Error ? e.message : String(e)).slice(0, 300));
      throw e;
    }
  },
});

/** The six jobs, in the order a fresh desk should run them: the probe first, the slow speed test last. */
export const jobs: Job[] = [probeJob, repoJob, sitemapJob, crawlJob, assetsJob, speedJob].map(tracked);

/* ---------- Settings: the four sources ------------------------------------------ */

const report = (id: "crawl" | "probe" | "repo" | "psi", job: string, name: string, feeds: string, extra: () => Partial<SourceStatus> = () => ({})): (() => SourceStatus) => {
  return () => {
    const lastOk = state(`site:ok:${job}`) || null;
    const error = state(`site:err:${job}`) || "";
    return {
      id,
      name,
      feeds,
      lastOk,
      state: error ? "failing" : lastOk ? "connected" : "waiting",
      ...(error ? { error } : {}),
      ...extra(),
    };
  };
};

registerSource(
  report("crawl", "crawl", "The desk's crawl of the website", "Pages, SEO checks and score, links, share pictures"),
  report("probe", "probe", "The desk's uptime checks", "Uptime, response times, certificate, DNS, incidents"),
  report("repo", "repo", "The website's repository", "Deployments, files and their sizes, redirects, pages kept out of the sitemap", () =>
    readCopyExists() || state("site:err:repo")
      ? {}
      : { state: "off", step: "Nothing to set up: the repository job makes the desk's own read copy on its next run, with the deploy key the publisher already uses." },
  ),
  /* PageSpeed's "last answered" is the last sweep that MEASURED something
     (psi:ok), never merely the last run that returned: a run Google turned
     away for quota answered nothing. */
  report("psi", "speed", "PageSpeed Insights", "Lab speed (LCP, CLS, TBT), Lighthouse scores, field data when Google has any", () => {
    const lastOk = speedTestedAt();
    const q = speedQuota();
    const paused = speedPausedUntil();
    const last = lastSweep();
    const refusedLast = Boolean(last?.stopped && last.runs - last.failed === 0);
    /* Nothing ever measured, and Google turned the desk away without a key
       of its own: waiting will not change that, a key will. */
    if (!lastOk && q && !q.keyed && !process.env.GOOGLE_API_KEY && q.measuredBefore === 0) {
      return {
        state: "off",
        lastOk: null,
        error: q.said,
        step: "One Google Cloud API key with the PageSpeed Insights API enabled, set as GOOGLE_API_KEY in the desk's environment: keyless requests share Google's quota with everybody else.",
      };
    }
    /* Google said stop: waiting out the pause, or the last sweep measured
       nothing for that reason. Not failing: the next run is already set. */
    if (paused || refusedLast) {
      const when = paused ? `The desk asks again after ${paused.slice(0, 16).replace("T", " ")} UTC.` : "The desk asks again at the next run.";
      return { state: "waiting", lastOk, error: `${q?.said ?? "Google answered 429 (quota)"}. ${when}` };
    }
    const error = state("site:err:speed") || "";
    if (error) return { state: "failing", lastOk, error };
    return { state: lastOk ? "connected" : "waiting", lastOk };
  }),
);

/* ---------- the top bar's light ---------------------------------------------------- */

const ago = (iso: string): string => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 1 ? "just now" : m < 90 ? `${m} minute${m === 1 ? "" : "s"} ago` : m < 2880 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`;
};

registerCheck(
  () => {
    const s = lastHome();
    if (!s) return null;
    /* A check that is itself old cannot vouch for anything. */
    const stale = Date.now() - Date.parse(s.at) > 10 * 60_000;
    return {
      name: "The website answers",
      ok: s.ok && !stale,
      detail: stale ? `Last checked ${ago(s.at)}; the check should run every two minutes.` : s.ok ? `${s.status} in ${s.ttfbMs} ms, ${ago(s.at)}` : `${s.failure ?? "no answer"}, ${ago(s.at)}`,
    };
  },
  () => {
    const c = certificate();
    if (c.state !== "ok" || !c.value.length) return null;
    const unreadable = c.value.find((x) => x.daysLeft === null);
    if (unreadable) return { name: "The certificate is valid", ok: false, detail: `${unreadable.host}: could not be read (${unreadable.problem ?? "no answer"})` };
    const soonest = c.value.reduce((a, b) => ((a.daysLeft as number) <= (b.daysLeft as number) ? a : b));
    const days = soonest.daysLeft as number;
    const untrusted = c.value.find((x) => !x.trusted);
    return {
      name: days >= 0 ? `The certificate is valid for ${days} more day${days === 1 ? "" : "s"}` : "The certificate has expired",
      /* Vercel renews about a month ahead; under two weeks means renewal is not happening. */
      ok: days > 14 && !untrusted,
      detail: untrusted ? `${untrusted.host}: ${untrusted.problem}` : c.value.map((x) => `${x.host} until ${x.validTo?.slice(0, 10)}`).join("; "),
    };
  },
  () => {
    const at = crawledAt();
    if (!at) return null;
    const error = state("site:err:crawl") || "";
    const old = Date.now() - Date.parse(at) > 36 * 3_600_000;
    return { name: "The last crawl finished", ok: !error && !old, detail: error ? error : old ? `It finished ${ago(at)}; it should run every day.` : `Finished ${ago(at)}` };
  },
  () => {
    const s = lastSitemap();
    if (!s) return null;
    const critical = s.issues.filter((i) => i.severity === "critical");
    return {
      name: "The sitemap is valid",
      ok: s.status === 200 && critical.length === 0,
      detail: critical.length ? (critical[0]?.text ?? "") : `${s.entries.length} addresses, read ${ago(s.at)}`,
    };
  },
);

/* ---------- the top bar's search ----------------------------------------------------- */

/**
 * Where a search hit leads inside the desk. The Pages and Assets screens are
 * built in the next stage; these are the addresses this file assumes for
 * them, in one place so they are changed in one place.
 */
export const deskHref = {
  page: (path: string): string => `/pages?open=${encodeURIComponent(path)}`,
  asset: (path: string): string => `/assets?open=${encodeURIComponent(path)}`,
};

/** Pages matching `q` by address, title, heading or description. Articles come back as kind "insight". */
export function searchPages(q: string, limit = 8): SearchHit[] {
  return findPages(q, limit).map((p) => ({
    kind: p.kind === "article" ? "insight" : "page",
    title: p.title ?? p.h1 ?? p.path,
    sub: `${p.path} · ${p.kindLabel}${p.status === 200 ? "" : ` · answers ${p.status || "nothing"}`}`,
    href: deskHref.page(p.path),
  }));
}

/** Files in the website's public/ folder matching `q` by path or alt text. */
export function searchAssets(q: string, limit = 8): SearchHit[] {
  return findAssets(q, limit).map((a) => ({
    kind: "asset",
    title: a.path,
    sub: `${a.bytes >= 1_000_000 ? `${(a.bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(a.bytes / 1000)} kB`}${a.width && a.height ? ` · ${a.width} × ${a.height}` : ""} · ${a.pages.length ? `on ${a.pages.length} page${a.pages.length === 1 ? "" : "s"}` : "not found on any page"}`,
    href: deskHref.asset(a.path),
  }));
}

/* Into the top bar's search box (src/cc/find.ts). Neither carries anything
   about a person, so neither needs to know who is asking. */
registerSearch(
  (q) => searchPages(q),
  (q) => searchAssets(q),
);

/* ---------- everything a screen may ask ---------------------------------------------- */

/* The crawl: pages, links, issues, score. */
export {
  brokenLinks,
  crawl,
  crawledAt,
  crawlSummary,
  duplicates,
  externalLinks,
  findPages,
  inventory,
  issueCounts,
  issues,
  issueTrend,
  kinds,
  metadataStatus,
  orphans,
  page,
  pageCount,
  redirectedLinks,
  redirects,
  routeHealth,
  schemaTypes,
  scoreHistory,
  siteScore,
  thinPages,
} from "./crawl.ts";
export type { BrokenLink, CrawlSummary, Fetched, Finding, IssueCounts, MetadataStatus, Outcome, PageDetail, PageRow, RedirectCheck, RouteHealth } from "./crawl.ts";

/* The rules behind the issues and the score. */
export { KIND_LABEL, LIMITS, RULES } from "./rules.ts";
export type { Issue, PageKind, RuleId, Severity } from "./rules.ts";
export type { AltState, ImageFact, LinkFact, PageFacts, SchemaBlock, SchemaNode, VideoFact } from "./parse.ts";

/* The sitemap and robots.txt. */
export { lastSitemap, refreshSitemap, sitemap } from "./sitemap.ts";
export type { SitemapEntry, SitemapRead } from "./sitemap.ts";

/* The files in public/. */
export { asset, ASSET_KIND_LABEL, ASSET_LIMITS, assets, assetTotals, findAssets, folders, remoteImages, scanAssets, sharePictures } from "./assets.ts";
export type { AssetFlag, AssetFlagId, AssetKind, AssetRow, AssetScan, AssetTotals, AssetUse, FolderCache, RemoteImage, SharePicture } from "./assets.ts";

/* Uptime and response. */
export { cacheHitRate, certificate, dns, functionProbe, incidents, lastHome, latest, probe, regionsOf, responseTimes, targets as probeTargets, uptime } from "./probes.ts";
export type { CacheHits, Certificate, DnsAnswer, Incident, ProbeTarget, ResponseTimes, Sample, Uptime } from "./probes.ts";

/* Speed: lab and field, always labelled. */
export {
  fieldData,
  LAB_DESKTOP_LIMITS,
  labRuns,
  labScores,
  lastSweep,
  limitsFor,
  pageFieldData,
  rate,
  speedPages,
  speedPausedUntil,
  speedQuota,
  speedStoppedToday,
  speedTestedAt,
  sweep,
  vital,
  VITAL_LIMITS,
} from "./psi.ts";
export type { FieldData, LabRun, LabScores, Metric, SpeedSweep, Strategy, Vital } from "./psi.ts";

/* The website's repository, through the desk's own read copy. */
export {
  commitFiles,
  commits,
  commitUrl,
  deployments,
  fetchedAt as repoFetchedAt,
  fetchRepo,
  filesUnder as repoFiles,
  historySince as commitsSince,
  lastChange,
  read as repoRead,
  readCopyExists,
  siteVersions,
} from "./repo.ts";
export type { Change, Commit, CommitFiles, PackageVersion, RepoFile } from "./repo.ts";
export { structure } from "./structure.ts";
export type { RedirectRule, RosterEntry, Structure } from "./structure.ts";

/* The desk's own server. */
export { box } from "./box.ts";
export type { Box } from "./box.ts";
