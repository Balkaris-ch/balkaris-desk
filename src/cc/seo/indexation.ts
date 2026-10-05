import { db } from "../../db.ts";
import { addDays, pathOf } from "../search/shared.ts";
import { lastSitemap } from "../site/sitemap.ts";
import type { CoverageGroup } from "../../../web/src/contract/seo/technical.ts";

/**
 * THE INDEXATION DRIVER, read from what the desk already keeps: Google's URL
 * Inspection of every sitemap address, once a day (src/cc/search/gsc.ts
 * `inspectAll`, table cc_inspect), and of one address when a person asks
 * ("Inspect now": kept in the same table under the day it was asked). Nothing
 * here asks Google anything.
 *
 * Each coverage state Google reports is grouped with what Google means by it
 * and what fixes it, in plain words (MEANING). The "Request indexing" queue is
 * the not-indexed opportunities (engine.ts), which the lead submits by hand in
 * Search Console: no API offers it.
 *
 * A DAY'S CHECK MAY BE CUT SHORT (Google answering 500, the allowance used
 * up). The 17 addresses it reached are then not the site: on 3 October 2026
 * that fragment was shown as "11 of 98 indexed" on four screens. So
 * `latestInspection` answers with EACH ADDRESS'S NEWEST RESULT: the newest
 * check's where it reached the address, the last earlier day's where it did
 * not, and says which (`complete`, `checked`, `carried`, and the day on each
 * row). Every screen that reads it (Technical, the SEO Overview, AI Search,
 * Page Optimization) is corrected by that one change.
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
  /** When Google gave this answer, ISO; absent on a row built elsewhere. */
  at?: string | null;
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
  at: (r.checked_at as string | null) ?? null,
});

/**
 * How far back an address's last result is still carried when the newest check did not reach it. A week,
 * as Search Console's own screen carries them (gsc.ts `indexStand`), so the two pages count alike.
 */
const CARRY_DAYS = 7;

export interface LatestInspection {
  /** The day of the newest daily check. */
  day: string;
  /** Each sitemap address's newest result, not indexed first. A row's own `day` says which day it is from. */
  rows: InspectRow[];
  /** How many addresses the sitemap listed at that check; null for a day checked before that was kept. */
  of: number | null;
  /** True when the check on `day` reached every sitemap address. */
  complete: boolean;
  /** Rows from `day` itself, or newer (one address asked by a person since). */
  checked: number;
  /** Rows carried from an earlier day because the check on `day` did not reach the address. */
  carried: number;
  /** The newest day whose check reached every address, or null when none has yet. */
  wholeDay: string | null;
  /** Sitemap addresses with no result at all in the last week: unknown, never counted as not indexed. */
  missing: number;
}

const rowsWhere = (where: string, ...args: string[]): InspectRow[] => (db.prepare(`SELECT * FROM cc_inspect WHERE ${where}`).all(...args) as Record<string, unknown>[]).map(toRow);

/**
 * The day of the newest DAILY CHECK: the newest day the check wrote the
 * sitemap's size for. One address a person asked about on a later day
 * ("Inspect now") is a result, not a check of the site, and must not make
 * that day look like a check that reached one address of ninety-eight. For
 * results kept before sizes were, the newest day with any result.
 */
function checkDay(): string | null {
  const sized = db.prepare("SELECT MAX(s.day) AS d FROM cc_series s WHERE s.metric = 'gsc.sitemap_addresses' AND EXISTS (SELECT 1 FROM cc_inspect i WHERE i.day = s.day)").get() as { d: string | null };
  if (sized.d) return sized.d;
  return (db.prepare("SELECT MAX(day) AS d FROM cc_inspect").get() as { d: string | null }).d;
}

/**
 * Each sitemap address's newest inspection, or null before the first check.
 *
 * The newest check's rows as they are; where that check was cut short, the
 * addresses it did not reach keep their last earlier result (at most a week
 * old, and only while the sitemap still lists them); and an address a person
 * asked Google about since ("Inspect now", kept in the same table under the
 * day it was asked) shows that newer answer.
 */
export function latestInspection(): LatestInspection | null {
  let day: string | null;
  try {
    day = checkDay();
  } catch {
    return null;
  }
  if (!day) return null;
  /* What the sitemap lists now. The whole these figures are a part of is the sitemap: an address that has
     left it is not carried, and one a person inspected that was never in it is not counted. Not known
     (the sitemap not read yet): every row counts. */
  let listed: Set<string> | null = null;
  try {
    const m = lastSitemap();
    listed = m?.entries.length ? new Set(m.entries.map((e) => e.path)) : null;
  } catch {
    listed = null;
  }
  const inList = (r: InspectRow): boolean => !listed || listed.has(r.path);

  const own = rowsWhere("day = ?", day).filter(inList);
  const size = db.prepare("SELECT value FROM cc_series WHERE metric = 'gsc.sitemap_addresses' AND day = ?").get(day) as { value: number } | undefined;
  const of = size ? size.value : null;
  const complete = of !== null && own.length >= of;
  const whole = db.prepare("SELECT MAX(day) AS d FROM cc_series WHERE metric = 'gsc.inspected' AND day <= ?").get(day) as { d: string | null } | undefined;

  const by = new Map(own.map((r) => [r.path, r]));
  if (!complete) {
    for (const r of rowsWhere("day < ? AND day >= ? ORDER BY day DESC", day, addDays(day, -CARRY_DAYS))) {
      if (!by.has(r.path) && inList(r)) by.set(r.path, r);
    }
  }
  /* Asked by a person since the check: Google's newest word on that address. Oldest first, so the newest stays. */
  for (const r of rowsWhere("day > ? ORDER BY day", day)) if (inList(r)) by.set(r.path, r);

  const rows = [...by.values()].sort((a, b) => Number(a.indexed) - Number(b.indexed) || a.url.localeCompare(b.url));
  const carried = rows.filter((r) => r.day < day).length;
  return { day, rows, of, complete, checked: rows.length - carried, carried, wholeDay: whole?.d ?? null, missing: of === null ? 0 : Math.max(0, of - rows.length) };
}

/** Coverage groups of the rows given (each address's newest result), not indexed first, then by size. */
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
        pages: list.map((r) => ({ path: r.path, lastCrawl: r.lastCrawl, robots: r.robots, indexing: r.indexing, livePageSaysIndex: liveSaysIndex(r.path), link: r.link, day: r.day })),
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
