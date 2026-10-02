import type { SearchHit } from "../../../web/src/contract/common.ts";
import { registerSearch } from "../find.ts";
import type { Job } from "../scheduler.ts";
import { registerSource } from "../sources.ts";
import { kept } from "../store.ts";
import * as leads from "../leads.ts";
import * as bing from "./bing.ts";
import * as clarity from "./clarity.ts";
import * as crux from "./crux.ts";
import * as gsc from "./gsc.ts";

/**
 * The sources that wait for a credential: Search Console, Bing Webmaster,
 * Clarity, the Chrome UX Report, and the engine's enquiries.
 *
 * None of them is connected the day this is written. Each is built so that
 * the day a person connects it, nothing else has to happen: its job becomes
 * ready, its panels fill. Until then each one
 *
 *   - says it is off, with the one step that connects it (Settings lists
 *     these; `ownerSteps` below is the same list in one place),
 *   - makes no request (Search Console alone asks one cheap question every
 *     half hour once the desk has its Google key, "may I read yet?", because
 *     a grant made in Google's console cannot be seen any other way),
 *   - is never counted as failing: `off` is not red.
 *
 * The readers are the modules themselves:
 *
 *   gsc      queries, pages, totals by day, position buckets, movers,
 *            opportunities, CTR outliers, gaps, sitemaps, index status
 *   bing     inbound links with anchor text, Bing's search and crawl figures
 *   clarity  the daily snapshot: sessions, scroll, time, friction per page
 *   crux     field Core Web Vitals and their weekly history
 *   leads    website enquiries from the engine (src/cc/leads.ts)
 */
export { bing, clarity, crux, gsc, leads };

/** Every scheduled job of this slice. Each has `ready()`, so the scheduler lists it and leaves it alone until its source is connected. */
export const jobs: Job[] = [...gsc.jobs, ...bing.jobs, ...clarity.jobs, ...crux.jobs];

registerSource(gsc.status, bing.status, clarity.status, crux.status, leads.status);

/**
 * What a person still has to do, one line per source that is not connected
 * (or that refuses the desk with a step a person can take). Empty when
 * everything answers. The same sentences the sources report, gathered so a
 * screen or a hand-over note can show them as one list.
 */
export function ownerSteps(): { source: string; name: string; step: string }[] {
  return [gsc.status(), bing.status(), clarity.status(), crux.status(), leads.status()].flatMap((s) =>
    s.step && s.state !== "connected" ? [{ source: s.id, name: s.name, step: s.step }] : [],
  );
}

/* ---------- the search box ------------------------------------------------- */

const wordsOf = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);

/**
 * Where a search hit leads inside the desk. The SEO and Leads screens are
 * built in the next stage; these are the addresses this file assumes for
 * them, written the way src/cc/site/index.ts writes its own (`?open=`), and
 * in one place so they are changed in one place.
 */
export const deskHref = {
  keyword: (query: string): string => `/seo?open=${encodeURIComponent(query)}`,
  enquiry: (id: string): string => `/leads?open=${encodeURIComponent(id)}`,
};

/**
 * Keywords: the queries Google showed the site for over the last thirty days,
 * from the answer the scheduled refresh kept. It asks Google nothing, so a
 * keystroke costs no quota.
 */
function keywords(q: string): SearchHit[] {
  if (!gsc.configured()) return [];
  const had = kept<gsc.Listed<gsc.QueryRow>>("gsc:queries:30d");
  if (!had) return [];
  const words = wordsOf(q);
  return had.value.rows
    .filter((r) => words.every((w) => r.query.toLowerCase().includes(w)))
    .slice(0, 8)
    .map((r) => ({
      kind: "keyword",
      title: r.query,
      sub: `Google Search, ${had.value.window.start} to ${had.value.window.end}: ${r.clicks} clicks, ${r.impressions} impressions, average position ${r.position}`,
      href: deskHref.keyword(r.query),
    }));
}

/**
 * Enquiries by name, company, address or reference. Only for a person who
 * may see leads: for anyone else the engine is not even asked. (find.ts drops
 * every "lead" hit for such a person as well, so this is the second lock.)
 */
async function enquiries(q: string, who: { seesLeads: boolean }): Promise<SearchHit[]> {
  if (!who.seesLeads || !leads.configured()) return [];
  const found = await leads.search(q, 8);
  return found.flatMap((r) =>
    r.id
      ? [
          {
            kind: "lead" as const,
            title: r.name ?? r.company ?? r.ref ?? "Enquiry",
            sub: [r.ref, r.company && r.name ? r.company : null, r.capturedAt ? `came in ${r.capturedAt.slice(0, 10)}` : null].filter(Boolean).join(", "),
            href: deskHref.enquiry(r.id),
          },
        ]
      : [],
  );
}

registerSearch(keywords, enquiries);
