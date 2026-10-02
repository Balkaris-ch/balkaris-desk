import { db } from "../../db.ts";
import { pathOf } from "../search/shared.ts";
import type { CoverageGroup } from "../../../web/src/contract/seo/technical.ts";

/**
 * THE INDEXATION DRIVER, read from what the desk already keeps: Google's URL
 * Inspection of every sitemap address, once a day (src/cc/search/gsc.ts
 * `inspectAll`, table cc_inspect). Nothing here asks Google anything.
 *
 * Each coverage state Google reports is grouped with what Google means by it
 * and what fixes it, in plain words (MEANING). The "Request indexing" queue is
 * the not-indexed opportunities (engine.ts), which the lead submits by hand in
 * Search Console: no API offers it.
 */

/** Google's coverage states, matched by their words, with the meaning and the fix. The first that matches. */
export const MEANING: { match: RegExp; indexed: boolean; meaning: string; fix: string }[] = [
  { match: /^submitted and indexed/i, indexed: true, meaning: "In Google's index and listed in the sitemap.", fix: "Nothing to fix." },
  { match: /indexed, not submitted/i, indexed: true, meaning: "In Google's index, but not listed in the sitemap.", fix: "List it in the sitemap if it should be found, or let it go if it should not." },
  {
    match: /noindex/i,
    indexed: false,
    meaning: "The last time Google crawled it, the page said noindex, so Google left it out. If the page now says index, Google's record is stale.",
    fix: "Check the live page says index (the crawl shows it), then in Search Console: Indexing › Pages › “Excluded by ‘noindex’ tag” › Validate fix, and Request indexing for the most important pages.",
  },
  {
    match: /unknown to google/i,
    indexed: false,
    meaning: "Google has never seen the address: not from the sitemap, not from a link.",
    fix: "Request indexing in URL Inspection, link the page from related pages' content, and give the sitemap a real lastmod so Google notices new pages.",
  },
  {
    match: /discovered.*not indexed/i,
    indexed: false,
    meaning: "Google knows the address and has not crawled it yet: it chose to wait, usually because it does not yet expect much from the site.",
    fix: "Link it from strong pages' content, earn outside signals (profiles, listings, credits), then Request indexing.",
  },
  {
    match: /crawled.*not indexed/i,
    indexed: false,
    meaning: "Google crawled the page and chose not to index it for now: it did not find enough in it that is not already elsewhere.",
    fix: "Make the page more substantial and specific (a direct answer, real detail, proof), link it from related pages, then Request indexing.",
  },
  { match: /page with redirect/i, indexed: false, meaning: "The address redirects, so Google indexes where it leads instead.", fix: "Nothing, if the redirect is meant; the sitemap should list only the address it leads to." },
  { match: /duplicate.*canonical|chose different canonical/i, indexed: false, meaning: "Google treats the page as a copy of another and indexes that one.", fix: "Make the page distinct or point its canonical at the page Google chose." },
  { match: /alternate page/i, indexed: false, meaning: "An alternate of another page (a language or a variant) that points at it correctly.", fix: "Nothing to fix." },
  { match: /blocked by robots/i, indexed: false, meaning: "robots.txt tells Google not to crawl it.", fix: "Allow it in robots.txt if it should be found." },
  { match: /soft 404/i, indexed: false, meaning: "The page answers 200 but looks empty or like an error to Google.", fix: "Give the page real content, or answer 404 if it is gone." },
  { match: /not found|404/i, indexed: false, meaning: "The address answered 404 when Google asked.", fix: "Restore the page or redirect the address to the right one." },
  { match: /server error|5xx/i, indexed: false, meaning: "The site answered an error when Google asked.", fix: "Find the failing route; Google retries by itself." },
];

const OTHER = { indexed: false, meaning: "Google's own words for the address's state.", fix: "See Search Console's URL Inspection for the address." };

export function meaningOf(coverage: string | null, indexed: boolean): { meaning: string; fix: string } {
  const m = coverage ? MEANING.find((x) => x.match.test(coverage)) : undefined;
  if (m) return { meaning: m.meaning, fix: m.fix };
  return indexed ? { meaning: "In Google's index.", fix: "Nothing to fix." } : OTHER;
}

export interface InspectRow {
  day: string;
  url: string;
  path: string;
  coverage: string | null;
  indexed: boolean;
  lastCrawl: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  robots: string | null;
  indexing: string | null;
  link: string | null;
}

const toRow = (r: Record<string, unknown>): InspectRow => ({
  day: String(r.day),
  url: String(r.url),
  path: pathOf(String(r.url)),
  coverage: (r.coverage as string | null) ?? null,
  indexed: !!r.is_indexed,
  lastCrawl: (r.last_crawl as string | null) ?? null,
  googleCanonical: (r.google_canonical as string | null) ?? null,
  userCanonical: (r.user_canonical as string | null) ?? null,
  robots: (r.robots_state as string | null) ?? null,
  indexing: (r.indexing_state as string | null) ?? null,
  link: (r.link as string | null) ?? null,
});

/** The newest day's inspection of every address, or null before the first. */
export function latestInspection(): { day: string; rows: InspectRow[]; of: number | null } | null {
  let last: { d: string | null };
  try {
    last = db.prepare("SELECT MAX(day) AS d FROM cc_inspect").get() as { d: string | null };
  } catch {
    return null;
  }
  if (!last.d) return null;
  const rows = (db.prepare("SELECT * FROM cc_inspect WHERE day = ? ORDER BY is_indexed, url").all(last.d) as Record<string, unknown>[]).map(toRow);
  const size = db.prepare("SELECT value FROM cc_series WHERE metric = 'gsc.sitemap_addresses' AND day = ?").get(last.d) as { value: number } | undefined;
  return { day: last.d, rows, of: size ? size.value : null };
}

/** Coverage groups of the newest day, not indexed first, then by size. */
export function coverageGroups(rows: InspectRow[], liveSaysIndex: (path: string) => boolean | null): CoverageGroup[] {
  const by = new Map<string, InspectRow[]>();
  for (const r of rows) {
    const k = r.coverage ?? (r.indexed ? "Indexed" : "Not indexed (no reason given)");
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return [...by.entries()]
    .map(([state, list]) => {
      const indexed = list.every((r) => r.indexed);
      const m = meaningOf(state, indexed);
      return {
        state,
        indexed,
        meaning: m.meaning,
        fix: m.fix,
        pages: list.map((r) => ({ path: r.path, lastCrawl: r.lastCrawl, robots: r.robots, indexing: r.indexing, livePageSaysIndex: liveSaysIndex(r.path), link: r.link })),
      };
    })
    .sort((a, b) => Number(a.indexed) - Number(b.indexed) || b.pages.length - a.pages.length);
}

/** One address over time: each day its state changed, newest first, and the newest inspection. */
export function inspectionHistory(path: string): { now: InspectRow; changes: { day: string; coverage: string | null; indexed: boolean }[] } | null {
  /* Narrowed in SQL by the address's end (the apex, www and a trailing slash are one path), exactly by path here. */
  const all = path === "/" || path.includes("%") || path.includes("_");
  const read = all
    ? (db.prepare("SELECT * FROM cc_inspect ORDER BY day").all() as Record<string, unknown>[])
    : (db.prepare("SELECT * FROM cc_inspect WHERE url LIKE ? OR url LIKE ? ORDER BY day").all(`%${path}`, `%${path}/`) as Record<string, unknown>[]);
  const rows = read.map(toRow).filter((r) => r.path === path);
  if (!rows.length) return null;
  const changes: { day: string; coverage: string | null; indexed: boolean }[] = [];
  let before: string | null | undefined;
  for (const r of rows) {
    const k = `${r.indexed}|${r.coverage}`;
    if (k !== before) changes.push({ day: r.day, coverage: r.coverage, indexed: r.indexed });
    before = k;
  }
  return { now: rows.at(-1)!, changes: changes.reverse() };
}
