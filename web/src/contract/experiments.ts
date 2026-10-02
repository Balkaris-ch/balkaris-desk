/**
 * The Experiments screen: what GET /api/v1/experiments answers.
 *
 * THE HONEST PROBLEM THIS SCREEN IS SHAPED BY. The website has no split-test
 * machinery, and at its traffic a split test on enquiries could not reach a
 * result for many months. So nothing here is called a test result. What the
 * desk can say truthfully is a BEFORE / AFTER comparison: every push to the
 * website's main branch is a deployment, so for one change (a commit, or a
 * date a person types) and one page (or the whole site) it puts the same
 * number of whole days before and after side by side, with the raw numbers,
 * a simple interval, and what such a comparison cannot conclude.
 *
 * The figures of a comparison are recomputed every time it is opened. A
 * saved comparison keeps only what was asked: who, when, the change, the
 * page and the window.
 *
 * Types only, as common.ts: the server imports this file with `import type`.
 */
import type { Range, Reading, Stat } from "./common.ts";

/** How many whole days each side of a comparison holds, at most. */
export type CompareWindow = 7 | 14 | 28;

/** The four figures a comparison puts side by side. */
export type MetricKey = "visitors" | "engagement" | "forms" | "enquiries";

/** One commit to the website's main branch: one production deployment. */
export interface ChangeRow {
  sha: string;
  /** The first seven characters, as git prints them. */
  short: string;
  /** When it was committed, ISO. */
  at: string;
  /** Its day in the GA4 property's time zone, YYYY-MM-DD: the day a comparison leaves out. */
  day: string;
  subject: string;
  /** The author's first name: from the desk's people table when the address matches somebody, else git's own name. */
  author: string;
  /** The name exactly as git has it, for the tooltip. */
  authorFull: string;
  /** "publish" when the desk's publisher wrote it (an article went into the menus), else "deploy". */
  kind: "deploy" | "publish";
  /**
   * Addresses this commit changed, where a file names one truthfully: a page
   * file with a fixed address, a file in that page's own folder, or an
   * article's own file. Shared components, styles and content are not
   * guessed onto a page.
   */
  pages: string[];
  /** Page templates it changed, written as the route ("/insights/[slug]"): every address of that shape. */
  templates: string[];
  /** Files no single address can be named for: shared components, styles, content, pictures, settings. */
  otherFiles: number;
  /** Files changed in all; null only for the repository's first commit. */
  files: number | null;
  /** The commit on GitHub (the repository is private: it opens for the team). */
  url: string | null;
}

/** What was asked of a comparison, as it can be put back in an address or saved. */
export interface CompareAsk {
  /** A commit, or a day a person typed. */
  change: { kind: "commit"; sha: string; short: string; subject: string; at: string; author: string } | { kind: "date"; day: string };
  /** An address on the site, or null for the whole site. */
  page: string | null;
  window: CompareWindow;
  /** The figure the chart draws. */
  metric: MetricKey;
}

/** A stretch of whole days, both ends included. */
export interface DayStretch {
  start: string;
  end: string;
}

/**
 * What a comparison says about one figure.
 *
 *   higher / lower   the interval leaves no room for "no change": the after
 *                    window is above (below) the before window by more than
 *                    the spread of these days explains. Not a cause.
 *   unclear          the interval holds "no change": these days cannot tell
 *                    the two windows apart.
 *   too-few          too few days or too few events to say anything; the
 *                    raw numbers are shown and nothing is concluded.
 */
export type Verdict = "higher" | "lower" | "unclear" | "too-few";

export interface MetricResult {
  key: MetricKey;
  /** "Visitors", "Engagement time per visitor", "Forms started", "Enquiries sent". */
  label: string;
  /** What the figure is, in one sentence, with its source's caveat. */
  definition: string;
  unit: "count" | "s";
  /** The figure for each window: people (GA4 counts each once per window), seconds per visitor, or events. */
  before: number;
  after: number;
  /** Per day, for the two daily figures; null for the counted events. */
  perDayBefore: number | null;
  perDayAfter: number | null;
  verdict: Verdict;
  /** The verdict in a sentence, with the raw numbers. Never "significant", never a percentage from small counts. */
  says: string;
  /** The interval, already in words ("+1.2 to +5.8 a day"), or null when nothing was estimated. */
  interval: string | null;
  /** A percentage change, only when both figures are 20 or more. Null otherwise. */
  percent: number | null;
  /** How the interval was worked out, for the tooltip. */
  method: string;
}

/** A day of the comparison's chart. */
export interface ComparePoint {
  /** YYYY-MM-DD */
  date: string;
  /** Null where the figure does not exist that day: time per visitor on a day nobody visited. */
  value: number | null;
  side: "before" | "change" | "after";
}

export interface CompareResult {
  /** Whole days on each side, after shortening to what was measured. */
  days: number;
  /** What was asked for, when more than `days`. */
  asked: CompareWindow;
  /** Why the windows are shorter than asked, in a sentence; null when they are not. */
  shortened: string | null;
  before: DayStretch;
  after: DayStretch;
  /** The day of the change itself, left out of both windows: part of it was before and part after. */
  changeDay: string;
  metrics: MetricResult[];
  /** One line per figure, the change day included, oldest first. */
  series: Record<MetricKey, ComparePoint[]>;
  /** How many of the newest days GA4 may still change. */
  provisional: number;
  /** Other commits on the days of the two windows (not the change's own day): each moves the figures too. */
  others: { sha: string; short: string; subject: string; day: string; samePage: boolean }[];
  /** Other commits made on the change's own day, which is in neither window. */
  onTheDay: number;
  /** True when both windows hold the same weekdays (a multiple of seven days). */
  sameWeekdays: boolean;
}

export interface Comparison {
  ask: CompareAsk;
  /** The saved comparison this was opened from, if any. */
  saved: { id: number; name: string; note: string | null } | null;
  /** The figures, recomputed now, or why there are none. */
  result: Reading<CompareResult>;
}

/** A saved comparison: what was asked, never its figures. */
export interface SavedRow {
  id: number;
  name: string;
  note: string | null;
  /** Who saved it: a first name from the people table. */
  by: string;
  /** When it was saved, ISO. */
  at: string;
  change: CompareAsk["change"];
  page: string | null;
  window: CompareWindow;
  /** The person asking may remove it: they saved it, or they are the owner. */
  mine: boolean;
}

/** "What a real experiment needs": the one figure it rests on, from GA4. */
export interface Readiness {
  /** The last 30 days (or since measurement began, when that is shorter). */
  days: number;
  visitors: number;
  enquiries: number;
  /**
   * People needed in EACH version to tell apart a version that brings half as
   * many enquiries again (a 50% rise) from no change, at the usual 5% and 80%.
   * Null when no enquiry was recorded, so there is no rate to plan from.
   */
  perVersion: number | null;
  /** Days of today's traffic that would take, both versions together. */
  daysNeeded: number | null;
  /** How the estimate was made, for the tooltip. */
  method: string;
}

/** A page a comparison can be narrowed to. */
export interface PageOption {
  path: string;
  /** True when the chosen change touched it. */
  touched: boolean;
}

/** GET /api/v1/experiments?range=&change=&date=&page=&window=&metric=&saved=&changes= */
export interface ExperimentsPayload {
  range: Range;
  /** Always false: both sources this screen reads (the repository and GA4) exist on the desk, so it offers no specimen. */
  specimen: false;
  tiles: {
    /** Commits to main in the range. */
    shipped: Reading<Stat>;
    /** Addresses whose own files changed in the range. */
    pagesChanged: Reading<Stat>;
    /** Comparisons saved, all time. */
    saved: Reading<Stat>;
    /** Whole days GA4 has measured the site. */
    measured: Reading<Stat>;
  };
  /**
   * Commits in the range, newest first, at most `limit` unless all were asked
   * for. `complete` is false when the desk's read of the history stops inside
   * the range (it reads the newest few thousand commits): then `total` counts
   * only the commits since `readFrom`, and is shown as "at least".
   */
  changes: Reading<{ rows: ChangeRow[]; total: number; all: boolean; limit: number; complete: boolean; readFrom: string | null }>;
  /**
   * Commits a comparison can be made around, for the form's list: the newest
   * 200 of the last 90 days, and always the commit being compared, so a form
   * sent again never loses it.
   */
  choices: { sha: string; label: string }[];
  /** The comparison asked for, or null when none was. */
  comparison: Comparison | null;
  /** Addresses the crawl knows, for the page list. */
  pages: Reading<PageOption[]>;
  saved: Reading<SavedRow[]>;
  readiness: Reading<Readiness>;
  /** The first whole day GA4 measured, YYYY-MM-DD, or null. */
  measuredFrom: string | null;
}

/** POST /api/v1/experiments/saved */
export interface SaveComparison {
  name: string;
  note?: string;
  /** A commit (its full id) or a day, one of the two. */
  sha?: string;
  day?: string;
  page?: string | null;
  window: CompareWindow;
}

/** What POST /api/v1/experiments/saved answers (201). */
export interface SavedAnswer {
  ok: true;
  id: number;
}
