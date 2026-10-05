import { db } from "../../db.ts";
import * as gsc from "../search/gsc.ts";
import type { IndexFigures, KeywordFigures, SeoFigures } from "../../../web/src/contract/seo/common.ts";
import { latestInspection } from "./indexation.ts";

/**
 * THE FIGURES MORE THAN ONE SEO PAGE SHOWS, each counted here and nowhere
 * else: open opportunities, the keyword table, what Google has indexed.
 *
 * WHY ONE PLACE. On 3 October 2026 the Overview said "11 / 98 indexed", the
 * Search Console page "11 indexed, 6 not" and the earlier screen "17 of 98
 * addresses checked", all from the same seventeen rows of a check that was
 * cut short, each page having counted for itself. A page that prints one of
 * these figures takes it from `figures()` (every page's head carries it:
 * `head.nav.figures`, src/cc/routes/seo/shared.ts), so two pages cannot
 * disagree, and a change of rule is made once.
 *
 * THE RULES.
 *   open opportunities  the rules still find it (active) and nobody closed it:
 *                       open, queued or in progress.
 *   tracked keywords    every phrase nobody judged irrelevant: relevant, weak
 *                       and not yet judged. What the Keywords page lists
 *                       before a filter is touched.
 *   indexed pages       each sitemap address's NEWEST result of Google's URL
 *                       Inspection (indexation.ts `latestInspection`): a day
 *                       whose check was cut short changes only the addresses
 *                       it reached, and the rest keep their last result.
 *
 * Nothing here asks anybody anything: counts in the desk's own tables.
 */

const one = (sql: string, ...args: (string | number)[]): number | null => {
  try {
    const r = db.prepare(sql).get(...args) as { n: number | null } | undefined;
    return r?.n ?? null;
  } catch {
    return null;
  }
};

/** The states that mean "still to do". */
export const OPEN_STATES = ["open", "queued", "in-progress"] as const;

/** Open opportunities: the rules still find them and nobody closed them. 0 before the engine's first run. */
export function openOpportunities(): number {
  return one("SELECT COUNT(*) AS n FROM cc_seo_opps WHERE active = 1 AND state IN ('open', 'queued', 'in-progress')") ?? 0;
}

/** The keyword table by a person's judgement, the clusters, and the phrases marked as targets. */
export function keywordFigures(): KeywordFigures {
  const by = new Map<string, number>();
  try {
    for (const r of db.prepare("SELECT status, COUNT(*) AS n FROM cc_seo_keywords GROUP BY status").all() as { status: string; n: number }[]) by.set(r.status, r.n);
  } catch {
    /* before the engine's tables exist: every count is 0 */
  }
  const relevant = by.get("relevant") ?? 0;
  const weak = by.get("weak") ?? 0;
  const unjudged = by.get("unjudged") ?? 0;
  const irrelevant = by.get("irrelevant") ?? 0;
  return {
    all: [...by.values()].reduce((a, b) => a + b, 0),
    tracked: relevant + weak + unjudged,
    relevant,
    weak,
    unjudged,
    irrelevant,
    /* The targets table is the Keywords page's own; a desk without it has no targets to count. */
    targets: one("SELECT COUNT(*) AS n FROM cc_seo_kw_targets t JOIN cc_seo_keywords k ON k.id = t.keyword_id"),
    clusters: one("SELECT COUNT(*) AS n FROM cc_seo_clusters") ?? 0,
  };
}

const n = (v: number): string => v.toLocaleString("en-GB");

/**
 * What Google has indexed of the sitemap, or null before the first index
 * check (or when its rows cannot be read). Each address's newest result; the
 * sentence says when a check was cut short and how many results are older.
 */
export function indexFigures(): IndexFigures | null {
  let ins: { day: string; rows: { indexed: boolean; day: string }[]; of: number | null; complete?: boolean; carried?: number } | null;
  try {
    ins = latestInspection();
  } catch {
    ins = null;
  }
  if (!ins || !ins.rows.length) return null;
  const indexed = ins.rows.filter((r) => r.indexed).length;
  const inspected = ins.rows.length;
  const carried = ins.carried ?? ins.rows.filter((r) => r.day < ins.day).length;
  const complete = ins.complete ?? (ins.of !== null && inspected - carried >= ins.of);
  const whole = ins.of ?? inspected;
  const base = `${n(indexed)} of ${n(whole)} sitemap addresses are in Google's index, by Google's URL Inspection`;
  const line = complete
    ? `${base} on ${gsc.dayText(ins.day)}.`
    : carried > 0
      ? `${base}. The check of ${gsc.dayText(ins.day)} was cut short: it reached ${n(inspected - carried)} ${inspected - carried === 1 ? "address" : "addresses"}, and the other ${n(carried)} keep their last earlier result. Run the full SEO audit to finish it.`
      : `${base}. The check of ${gsc.dayText(ins.day)} reached ${n(inspected)} of ${n(whole)} addresses; the rest have no result yet. Run the full SEO audit to finish it.`;
  return { indexed, notIndexed: inspected - indexed, inspected, of: ins.of, day: ins.day, complete, carried, line };
}

/** All of them in one answer, as every page's head carries them. */
export function figures(): SeoFigures {
  return { opportunities: openOpportunities(), keywords: keywordFigures(), index: indexFigures() };
}

/**
 * Whether the newest day of the index check holds a result for every sitemap
 * address. False when it was cut short, null when there has been no check.
 * The full audit asks this: a cut-short day is finished whatever the hour.
 */
export function indexCheckWhole(): boolean | null {
  const f = indexFigures();
  return f ? f.complete : null;
}
