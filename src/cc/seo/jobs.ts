import { db } from "../../db.ts";
import { hasKey } from "../gauth.ts";
import type { Job } from "../scheduler.ts";
import { status as jobStatus } from "../scheduler.ts";
import * as gsc from "../search/gsc.ts";
import { countOn, dayIn } from "../search/shared.ts";
import { crawledAt } from "../site/index.ts";
import { setState, state } from "../store.ts";
import { scrub } from "../system.ts";
import type { SeoJob } from "../../../web/src/contract/seo/common.ts";
import { readReferrals } from "./aisearch.ts";
import { refreshPages } from "./competitors.ts";
import { runEngine, syncLinks } from "./engine.ts";
import { AUTOCOMPLETE_CAP, budget, research, syncFromSearch } from "./keywords.ts";
import { checkProfiles } from "./presence.ts";
import { runSnapshot } from "./rank.ts";
import { checkReadiness } from "./readiness.ts";
import { json } from "./tables.ts";

/**
 * The SEO engine's scheduled jobs. Exported as a collector by ./index.ts and
 * registered by src/cc/index.ts with every other collector, so they run on the
 * desk's one scheduler, one job at a time (src/cc/scheduler.ts).
 *
 *   seo-snapshot     every 6 h    Search Console's newest final days into the history
 *                                (the first run back-fills from the property's first day)
 *   seo-engine       every 15 min the opportunity rules, over everything kept, whenever
 *                                something it reads has changed (a crawl, a Search
 *                                Console refresh, the index check, a snapshot, the
 *                                readiness check, a person's decision), and at least
 *                                every 6 h; in between it only follows its tasks
 *   seo-readiness    every 24 h   AI readiness of every sitemap page, and the site
 *   seo-referrals    every 24 h   GA4 referrals and AI-assistant sessions
 *   seo-research     every 24 h   Google Autocomplete for the clusters' seeds:
 *                                20 requests a run, 120 a week at most
 *   seo-competitors  every 7 d    competitors' pages for our clusters, politely
 *   seo-presence     every 7 d    the studio's profiles and listings
 *
 * The index check's history is the desk's own gsc-inspect job (src/cc/search/
 * gsc.ts): it keeps every sitemap address's URL Inspection result per day for
 * 400 days, and indexation.ts reads it.
 */

/** Requests to Autocomplete one run may make: the week's 120 spread over the days. */
const RESEARCH_PER_RUN = 20;

/**
 * The jobs whose results the engine reads: a run of any of them is new input.
 * Not the quarter-hourly sitemap read: the crawl and the readiness check carry
 * what the engine takes from the sitemap, and four whole runs an hour would
 * make "only on news" mean nothing.
 */
export const ENGINE_INPUTS = ["crawl", "gsc-daily", "gsc-inspect", "seo-snapshot", "seo-readiness", "seo-research", "seo-competitors", "seo-presence"];
/** The engine runs whole at least this often, new input or not. */
const ENGINE_WHOLE_MS = 6 * 3600_000;
const ENGINE_LAST = "seo:engine:last";

/** The newest decision a person (or the operator) made in the engine's tables: a status, a mapping, a state, a done mark. */
function lastDecision(): string | null {
  const r = db
    .prepare(
      `SELECT MAX(at) AS at FROM (
         SELECT MAX(state_at) AS at FROM cc_seo_opps
         UNION ALL SELECT MAX(status_at) FROM cc_seo_keywords
         UNION ALL SELECT MAX(updated_at) FROM cc_seo_clusters
         UNION ALL SELECT MAX(COALESCE(done_at, updated_at)) FROM cc_seo_owner_tasks
         UNION ALL SELECT MAX(updated_at) FROM cc_seo_profiles
       )`,
    )
    .get() as { at: string | null };
  return r.at;
}

/**
 * Why the engine should run whole now, or null when nothing it reads changed
 * since its last whole run (and that run is under six hours old).
 */
export function engineDue(nowMs = Date.now()): string | null {
  const last = json<{ at: string; line: string } | null>(state(ENGINE_LAST), null);
  if (!last) return "its first run";
  if (nowMs - Date.parse(last.at) >= ENGINE_WHOLE_MS) return "six hours since its last whole run";
  const fresh = jobStatus().filter((j) => ENGINE_INPUTS.includes(j.name) && j.lastEnd && j.lastOk && j.lastEnd > last.at);
  if (fresh.length) return `new input from ${fresh.map((j) => j.name).join(", ")}`;
  const decided = lastDecision();
  if (decided && decided > last.at) return "a decision made since its last run";
  return null;
}

/** The engine's job: whole when something changed, else only following its operator tasks. */
async function engineJob(progress: (done: number, of: number, what?: string) => void): Promise<string> {
  const why = engineDue();
  if (!why) {
    const moved = syncLinks();
    const last = json<{ at: string; line: string } | null>(state(ENGINE_LAST), null);
    return `Nothing it reads changed since its run at ${last?.at.slice(11, 16) ?? "?"} UTC${moved ? `; ${moved} opportunit${moved === 1 ? "y" : "ies"} moved with their operator tasks` : ""}. That run: ${last?.line ?? "?"}`;
  }
  const line = await runEngine(progress);
  setState(ENGINE_LAST, JSON.stringify({ at: new Date().toISOString(), line }));
  return line;
}

export const jobs: Job[] = [
  {
    name: "seo-snapshot",
    title: "Keep Search Console's daily rankings",
    every: 6 * 3600,
    delay: 150,
    ready: gsc.configured,
    run: async ({ progress }) => {
      const said = await runSnapshot(progress);
      const s = syncFromSearch();
      return `${said}${s.added ? `; ${s.added} new search queries in the keyword table` : ""}`;
    },
  },
  {
    name: "seo-engine",
    title: "Find SEO opportunities",
    every: 15 * 60,
    delay: 240,
    run: ({ progress }) => engineJob(progress),
  },
  {
    name: "seo-readiness",
    title: "Check every page for AI search readiness",
    every: 24 * 3600,
    delay: 600,
    ready: () => !!crawledAt(),
    run: ({ progress }) => checkReadiness(progress),
  },
  {
    name: "seo-referrals",
    title: "Read referrals and AI assistant visits from GA4",
    every: 24 * 3600,
    delay: 420,
    ready: hasKey,
    run: () => readReferrals(),
  },
  {
    name: "seo-research",
    title: "Research search phrases in Google Autocomplete",
    every: 24 * 3600,
    delay: 1800,
    run: ({ progress }) => research({ most: RESEARCH_PER_RUN, progress }),
  },
  {
    name: "seo-competitors",
    title: "Read competitors' pages for our topics",
    every: 7 * 24 * 3600,
    delay: 1200,
    run: ({ progress }) => refreshPages(progress),
  },
  {
    name: "seo-presence",
    title: "Check the studio's profiles and listings",
    every: 7 * 24 * 3600,
    delay: 1500,
    run: ({ progress }) => checkProfiles(progress),
  },
];

/** What each job the SEO section depends on does, in a sentence or two. */
const WHAT: Record<string, { what: string; group: "seo" | "desk" }> = {
  "seo-snapshot": { what: "Asks Search Console for each day it has finished counting (two to three days behind) and keeps every query, page, device and country row, for all countries and for Switzerland. The first run went back to the property's first day; the history outlives Google's sixteen months.", group: "seo" },
  "seo-engine": {
    what: "Runs the opportunity rules (src/cc/seo/rules.ts) over the history, the crawl, the index check, the readiness check and the owner tasks whenever one of them has news (looked at every quarter of an hour, whole at least every six hours), and moves each opportunity along with its operator task. Keeps every person's decision.",
    group: "seo",
  },
  "seo-readiness": { what: "Reads every sitemap page as a crawler gets it, one at a time, and checks what AI search needs: a direct answer, questions, structured data, a price, a date, a German version; and robots.txt, llms.txt, lastmod, Bing, the Business Profile, the address.", group: "seo" },
  "seo-referrals": { what: "Reads GA4 sessions from referring sites and AI assistants by day and landing page (consenting visitors only). One report a day.", group: "seo" },
  "seo-research": { what: `Expands the clusters' seed phrases through Google Autocomplete, one request a second, ${RESEARCH_PER_RUN} a run and never more than ${AUTOCOMPLETE_CAP} a week (the counter refuses beyond it). New phrases are kept unjudged.`, group: "seo" },
  "seo-competitors": { what: "Reads the competitor pages captured for our clusters: robots.txt first and obeyed, two seconds between requests to a site, the desk's name on every request. Keeps title, heading, words, language, structured data and whether a price is stated.", group: "seo" },
  "seo-presence": { what: "Asks each known profile and listing address once a week: exists, not found, or could not be read, with the reason.", group: "seo" },
  crawl: { what: "Reads every page of the website: facts, links, findings and the site score. The engine's technical, thin-content and internal-link rules read it.", group: "desk" },
  sitemap: { what: "Reads sitemap.xml and robots.txt every quarter of an hour.", group: "desk" },
  "gsc-daily": { what: "Refreshes the Search Console figures the screens show, twice a day.", group: "desk" },
  "gsc-inspect": { what: "Asks Google's URL Inspection about every sitemap address once a day and keeps each day's answer for 400 days: the index history the indexation driver groups and follows.", group: "desk" },
  speed: { what: "PageSpeed lab runs of the most important pages, once a day.", group: "desk" },
  "bing-daily": { what: "Bing Webmaster's links and figures: waits for its key.", group: "desk" },
};

/** The jobs the SEO section runs on, as Automations and the Overview list them. */
export function seoJobs(): SeoJob[] {
  const all = jobStatus();
  const b = budget();
  /* gsc.ts keeps its own count of inspections per Pacific day. */
  const inspected = countOn("gsc.inspect.used", dayIn("America/Los_Angeles"));
  return Object.keys(WHAT).flatMap((name) => {
    const j = all.find((x) => x.name === name);
    if (!j) return [];
    return [
      {
        ...j,
        lastNote: j.lastNote === null ? null : scrub(j.lastNote),
        progress: j.progress?.what ? { ...j.progress, what: scrub(j.progress.what) } : j.progress,
        what: WHAT[name]!.what,
        group: WHAT[name]!.group,
        budget:
          name === "seo-research"
            ? { used: b.used, cap: b.cap, period: "week" as const, line: `Google Autocomplete: ${b.used} of ${b.cap} requests this week (${b.week})` }
            : name === "gsc-inspect"
              ? { used: inspected, cap: 1800, period: "day" as const, line: `URL Inspection: ${inspected} of the desk's 1,800 today (Google allows 2,000 a day per property)` }
              : null,
      },
    ];
  });
}
