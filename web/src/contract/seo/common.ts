/**
 * What every page of the SEO section shares: the head (range, audit, the tab
 * strip's counts), a page as a row names it, an opportunity, an owner task,
 * an honest rate, a job.
 *
 * Types only, like ../common.ts: the server imports these files with
 * `import type`, so nothing here may exist at runtime.
 *
 * THE RULE ABOVE ALL. Every figure is read from a real source or it is absent
 * with its reason (a `Reading` that is not ok). The boards carry invented
 * numbers, domains and "estimated traffic gain" figures: they are layout, not
 * data. Where a board shows a figure that has no free, honest source, these
 * types carry the nearest true thing under its own name (impressions, not
 * "search volume"; "strong competitors seen in the captured results", not
 * "difficulty"), or leave it out. The one estimate is `Potential`: our own
 * computation from Search Console impressions and a CTR curve stated in one
 * place (`CtrCurve`), always labelled "our estimate", and absent where there
 * are no impressions.
 *
 * SMALL NUMBERS. A count under 20 is shown as "3 → 5" (`Stat.previous`), never
 * as a percentage change; a rate from fewer than 30 events carries its raw
 * counts (`Rate.small`), so "2 of 14" can be printed instead of "14.3%".
 */
import type { ActivityItem, EarlySignals, JobListed, Reading, SourceId, Stat } from "../common";
import type { NewTask, RunnerState, TaskState } from "../operator";

/* ---------- ranges and the head every page carries ------------------------------- */

/** The SEO pages' ranges. Search figures are whole Search Console days, two to three days behind. */
export type SeoRange = "7d" | "30d" | "90d" | "1y";

/** A window of whole days (YYYY-MM-DD, both ends included) and the window of the same length before it. */
export interface SeoSpan {
  start: string;
  end: string;
  days: number;
  previousStart: string;
  previousEnd: string;
  /**
   * True when the desk's own Search Console history covers the window before
   * from its first day. Only then is anything compared with it; otherwise every
   * `previous` is null and a page says "not compared: history begins …".
   */
  compared: boolean;
  /** The first day of the desk's own Search Console history (the back-fill's first day), or null before the first snapshot. */
  historyFrom: string | null;
}

/** The tab strip's live counts, the sidebar submenu's too (GET /api/v1/seo/nav). */
export interface SeoNav {
  /** Open opportunities the rules still find. */
  opportunities: number;
  /** Owner tasks not yet marked done. */
  needsYou: number;
  /** Pages queued for "Request indexing" that nobody has marked as submitted. */
  indexRequests: number;
  /** One entry per page of the section, in the tab strip's order. */
  tabs: SeoTab[];
  /**
   * The figures more than one page shows, counted once (src/cc/routes/seo/shared.ts
   * `figures`): every page's head carries them, so two pages cannot disagree.
   * Absent on an answer from a desk older than this field.
   */
  figures?: SeoFigures;
}

/**
 * THE FIGURES TWO PAGES BOTH SHOW, each counted in one place and by one rule.
 * A page that prints "tracked keywords", "indexed pages" or "open
 * opportunities" prints these, never a count of its own.
 */
export interface SeoFigures {
  /** Open opportunities the rules still find (the same number as `SeoNav.opportunities`). */
  opportunities: number;
  keywords: KeywordFigures;
  /** Null before the first index check, or while Search Console is not connected. */
  index: IndexFigures | null;
}

/** The keyword table, counted once. "Tracked" is every phrase nobody judged irrelevant. */
export interface KeywordFigures {
  /** Every phrase the desk knows, irrelevant ones included. */
  all: number;
  /** relevant + weak + unjudged: what the Keywords page lists by default. */
  tracked: number;
  relevant: number;
  weak: number;
  unjudged: number;
  irrelevant: number;
  /** Phrases a person marked as a target; null on a desk that has no targets yet. */
  targets: number | null;
  clusters: number;
}

/**
 * What Google has indexed, from the daily URL Inspection of every sitemap
 * address: EACH ADDRESS'S NEWEST RESULT (src/cc/seo/indexation.ts), so a day
 * whose check was cut short changes only the addresses it reached.
 */
export interface IndexFigures {
  indexed: number;
  notIndexed: number;
  /** Addresses with a result: indexed + notIndexed. */
  inspected: number;
  /** Sitemap addresses on the newest check's day; null when that was not kept. */
  of: number | null;
  /** The newest day any address was checked on, YYYY-MM-DD. */
  day: string;
  /** True when that day's check reached every sitemap address. */
  complete: boolean;
  /** Results carried from an earlier day because the newest check did not reach the address. */
  carried: number;
  /** One sentence saying all of the above, for a tile's note. */
  line: string;
}

export type SeoTabKey =
  | "overview"
  | "opportunities"
  | "pages"
  | "keywords"
  | "content-gaps"
  | "backlinks"
  | "technical"
  | "search-console"
  | "competitors"
  | "ai-search"
  | "automations";

export interface SeoTab {
  key: SeoTabKey;
  label: string;
  href: string;
  /** A count shown beside the label (Opportunities carries its open count); null for none. */
  count: number | null;
  /**
   * What the count is of, read out after the number ("open", "steps need
   * you", "pages wait for Request indexing", "phrases to judge"). Absent with
   * no count.
   */
  countSays?: string;
  /** True for a count that is work waiting on a person, not a total: drawn as a quiet chip. */
  todo?: boolean;
}

/**
 * "Run full SEO audit": every job the section's figures come from, one after
 * the other on the desk's one scheduler (src/cc/seo/audit.ts lists them: the
 * sitemap, the crawl, Search Console's figures, Google's index check, the
 * rank history, PageSpeed, AI readiness, referrals, profiles, and the
 * opportunity engine last; a deep audit also researches phrases and reads
 * competitors' pages).
 */
export interface AuditRun {
  /** Stable for one run: the ISO time it was asked. */
  id: string;
  startedAt: string;
  by: string;
  /** done when every step is done or skipped; failed when one failed (the rest still ran). */
  state: "running" | "done" | "failed";
  finishedAt: string | null;
  steps: AuditStep[];
  /** True for a deep audit (keyword research and competitors' pages as well). */
  deep?: boolean;
}

export interface AuditStep {
  /** The scheduler's job name: "sitemap", "crawl", "gsc-daily", "gsc-inspect", "seo-snapshot", "speed", "seo-readiness", "seo-referrals", "seo-presence", "seo-research", "seo-competitors", "seo-engine". */
  job: string;
  title: string;
  state: "queued" | "running" | "done" | "failed" | "skipped";
  /** What the run said, or why it was skipped ("the crawl of 4 minutes ago is fresh"). */
  note: string | null;
  progress: { done: number; of: number; what?: string } | null;
  startedAt: string | null;
  endedAt: string | null;
}

/** What every SEO page payload begins with. */
export interface SeoHead {
  range: SeoRange;
  span: SeoSpan | null;
  /** The last audit asked for, while it runs and for an hour after; null otherwise. */
  audit: AuditRun | null;
  nav: SeoNav;
  /** ISO time the payload was made. */
  at: string;
}

/* ---------- honest figures ---------------------------------------------------------- */

/**
 * A rate with what it was made of. `value` is a percentage (2.4 is 2.4%).
 * `small` is true when `den` is under 30: print "num of den" rather than the
 * percentage. Null `value` when `den` is 0: there is nothing to divide.
 */
export interface Rate {
  value: number | null;
  num: number;
  den: number;
  small: boolean;
}

/** A rate with the same rate in the window before (null when not compared). */
export interface RateStat {
  now: Rate;
  previous: Rate | null;
  /** One point per day, oldest first, null on a day with nothing to divide. */
  series: (number | null)[];
}

/** One figure with where it came from, printed in an opportunity's evidence. */
export interface Evidence {
  /** "Impressions (Search Console, 30 days)". */
  label: string;
  /** As printed: "41", "8.2", "Crawled - currently not indexed". */
  value: string;
  source: SourceId;
  /** ISO time or YYYY-MM-DD of the reading it came from. */
  asOf: string | null;
}

/** A page as a row names it. */
export interface PageRef {
  path: string;
  /** The page's own title as the crawl read it (the part before " | Balkaris"), or null when the crawl does not know the page. */
  title: string | null;
  /** The crawl's kind ("service", "segment", "article"…) and its label, or null. */
  kind: string | null;
  kindLabel: string | null;
  /** The share picture, for a thumbnail. */
  picture: string | null;
  /** html lang as the crawl read it ("en"); null when unknown. */
  lang: string | null;
}

/* ---------- opportunities --------------------------------------------------------------- */

export type OpportunityType =
  | "not-indexed" /* in the sitemap, not in Google's index (URL Inspection) */
  | "near-page-one" /* a query at average position 4 to 20 */
  | "low-ctr" /* clicks well under our CTR curve at its position */
  | "ranking-drop" /* average position fell by 3 or more between two windows */
  | "keyword-gap" /* a cluster of searches no page answers: a new page */
  | "german-missing" /* a German cluster: the site is English only */
  | "thin-content" /* under the crawl's word yardstick */
  | "missing-answer" /* AI readiness: no direct answer up top, or no FAQ */
  | "technical" /* a finding of the crawl's rules, or a site-wide check */
  | "internal-links" /* a page few others link to */
  | "entity"; /* off-site presence: only the owner can do it */

export type Priority = "high" | "medium" | "low";

/** What a person does about an opportunity. */
export type ActionKind =
  | "proposal" /* the operator writes a title/description or redirect; it waits in the approval queue */
  | "brief" /* the operator writes a brief (a page, a section, a fix to plan) */
  | "owner" /* only the owner can: a login, a decision; see the owner task */
  | "chrome" /* the lead does it by hand in the owner's browser (e.g. Request indexing) */
  | "code"; /* a change to the website's code, made in the website's repository */

export type OpportunityState = "open" | "queued" | "in-progress" | "done" | "dismissed";

export interface OpportunityAction {
  kind: ActionKind;
  /** The button's words: "Request indexing", "Write a brief", "Propose a title". */
  label: string;
  /** The exact step in plain words: what happens, or what a person does, and where. */
  step: string;
  /** For proposal and brief: the operator task the button queues (POST /api/v1/seo/opportunities/:id/act sends it). */
  operator: NewTask | null;
  /** For owner: the owner task it waits on. */
  ownerTaskId: string | null;
  /** A link that helps do it (Search Console's inspection of the address, the profile's page). */
  href: string | null;
  /** False when the action cannot be taken now; `why` says why (the page is not on the crawl, a task is already queued). */
  available: boolean;
  why: string | null;
}

/** "Our estimate": clicks a month the opportunity could add, from real impressions and our stated CTR curve. */
export interface Potential {
  clicksPerMonth: number;
  /** Search Console impressions in the window, scaled to 30 days. */
  impressionsPerMonth: number;
  /** Our curve's CTR at the target position, and the CTR now (percentages). */
  targetCtr: number;
  currentCtr: number;
  targetPosition: number;
  /** The computation in words: "34 impressions a month × (10.0% at position 3 − 0% now)". */
  basis: string;
}

export interface OpportunityStateInfo {
  state: OpportunityState;
  /** Who set the state ("Fini", "the operator", "the desk"), and when; null for an opportunity nobody touched. */
  by: string | null;
  at: string | null;
  note: string | null;
  /** The operator task its action queued, with that task's own state. */
  task: { id: number; state: TaskState; title: string; href: string } | null;
  /** The proposals that task made, each with its own state in the approval queue. */
  proposals: { id: number; state: "waiting" | "approved" | "applied" | "rejected" | "withdrawn"; address: string; href: string }[];
}

export interface OpportunityRow {
  /** Stable across runs: "<type>:<subject>". */
  id: string;
  type: OpportunityType;
  typeLabel: string;
  /** One line: "Not in Google's index: Excluded by 'noindex' tag". */
  title: string;
  subject: { page: PageRef | null; keyword: string | null; cluster: { key: string; name: string } | null };
  /** The real figures the rule read. */
  evidence: Evidence[];
  priority: Priority;
  /** The priority rule that placed it, in one sentence (the rules are in src/cc/seo/rules.ts). */
  priorityWhy: string;
  /** Our estimate, only from impressions; null when there are none to estimate from. */
  potential: Potential | null;
  action: OpportunityAction;
  state: OpportunityStateInfo;
  /** False when the rules no longer find it (the page was indexed, the query moved): kept with the person's decision. */
  active: boolean;
  clearedAt: string | null;
  clearedWhy: string | null;
  firstSeen: string;
  lastSeen: string;
  /** Read from an early window (Search Console's early signals): figures under the standard floors. */
  early: boolean;
}

/** The click-through curve "our estimate" uses. OUR ASSUMPTION, stated in one place (src/cc/seo/ctr.ts), not Google's. */
export interface CtrCurve {
  /** Percent by whole position, 1 to 20; beyond 20 the last value. */
  points: { position: number; ctr: number }[];
  beyond: number;
  /** Where the numbers come from and what they are not. */
  note: string;
}

/* ---------- owner tasks ("Needs you") -------------------------------------------------- */

export interface OwnerTaskRow {
  /** Stable: "<topic>", e.g. "bing-webmaster". */
  id: string;
  /** The first sentence of the step. */
  title: string;
  /** The exact step, as the audit wrote it. */
  step: string;
  why: string;
  impact: Priority;
  /** "hours", "days", "weeks", as the audit judged it. */
  effort: string;
  /** "owner": only the owner can (a login, a decision). "lead-chrome": the lead does it in the owner's browser. */
  who: "owner" | "lead-chrome";
  /** Where it came from: "SEO audit, 2 Oct 2026". */
  from: string;
  done: boolean;
  /** A person marked it; never the desk by itself. */
  doneBy: string | null;
  doneAt: string | null;
  note: string | null;
  /** Opportunities waiting on it. */
  opportunities: number;
}

/* ---------- jobs ----------------------------------------------------------------------- */

/** An SEO job as Automations and the Overview's running tasks list it. */
export interface SeoJob extends JobListed {
  /** What it does, in one or two sentences, with its budget when it has one. */
  what: string;
  /** "seo" for the engine's own jobs, "desk" for the desk's jobs the SEO section depends on. */
  group: "seo" | "desk";
  /** A request budget it keeps, when it has one ("Google Autocomplete: 37 of 120 this week"). */
  budget: { used: number; cap: number; period: "day" | "week"; line: string } | null;
}

/* ---------- the AI SEO operator panel ------------------------------------------------- */

/**
 * The boards' "AI SEO Operator" is the desk's existing operator: tasks are
 * queued and answered by the studio workstation's local model when it is on.
 * A page posts a suggestion's `task` to POST /api/v1/operator/tasks.
 */
export interface OperatorPanel {
  runner: RunnerState;
  /** Said truthfully on the panel: where it runs and what that means for waiting. */
  line: string;
  suggestions: { label: string; task: NewTask }[];
}

/* ---------- answers to changes ----------------------------------------------------------- */

export interface OpportunityAnswer {
  ok: true;
  opportunity: OpportunityRow;
}

export interface OpportunitiesActed {
  ok: true;
  /** One line per opportunity asked about: what was queued, or why not. */
  results: { id: string; ok: boolean; line: string }[];
  opportunities: OpportunityRow[];
}

export interface OwnerTaskAnswer {
  ok: true;
  task: OwnerTaskRow;
}

export interface AuditAnswer {
  ok: true;
  audit: AuditRun;
}

/** What an import (owner only) did. Importing the same file twice changes nothing the second time. */
export interface ImportAnswer {
  ok: true;
  kind: string;
  /** One line per table touched: "keywords: 2,342 read, 0 added, 0 changed". */
  lines: string[];
}

/** Lists that carry early signals use the shared type. */
export type { EarlySignals, ActivityItem };

/* ---------- the audits kept (GET /api/v1/seo/audits, /audits/:id) ------------------------- */

/** The section's headline counts at one moment: taken as an audit is asked for and as it ends. Null where nothing has been read yet. */
export interface AuditCounts {
  /** The crawl's site score out of 100, and the pages it read. */
  score: number | null;
  pages: number | null;
  /** The crawl's critical and warning findings. */
  critical: number | null;
  warning: number | null;
  /** Open opportunities (`SeoFigures.opportunities`). */
  opportunities: number;
  /** Sitemap addresses in Google's index and not (`IndexFigures`). */
  indexed: number | null;
  notIndexed: number | null;
  /** Tracked phrases (`KeywordFigures.tracked`). */
  keywords: number;
}

/** What appeared in the desk's tables between an audit's start and its end. */
export interface AuditChanges {
  opportunitiesNew: number;
  /** Opportunities the rules stopped finding. */
  opportunitiesCleared: number;
  /** Crawl findings first seen. */
  findingsNew: number;
  /** Pages Google newly reports as indexed, and pages it dropped. */
  indexedNew: number;
  indexedLost: number;
  keywordsNew: number;
}

/** One audit as the history keeps it. */
export interface AuditKept extends AuditRun {
  deep: boolean;
  before: AuditCounts;
  /** Null while it runs. */
  after: AuditCounts | null;
  changes: AuditChanges | null;
  /** Its own address in the interface. */
  href: string;
}

/** One audit with what it found, row by row (fifty of each at most). */
export interface AuditDetail extends AuditKept {
  found: {
    opportunities: AuditFound[];
    cleared: AuditFound[];
    findings: { rule: string; severity: string; path: string | null; text: string }[];
    index: { indexed: boolean; text: string; at: string }[];
  };
}

export interface AuditFound {
  id: string;
  title: string;
  /** The page, the phrase or the cluster it is about. */
  subject: string | null;
  /** For a cleared one: why the rules stopped finding it. */
  why: string | null;
  href: string;
}

/** GET /api/v1/seo/audits */
export interface AuditsAnswer {
  audits: AuditKept[];
  /** The steps an audit is made of, in order; `deep` for those only a deep audit runs. */
  steps: { job: string; title: string; deep: boolean }[];
  /** ?open=<id>: that audit with what it found; null when none was asked or none is kept under it. */
  open: AuditDetail | null;
}

/* ---------- every SEO task in one list (GET /api/v1/seo/owner-tasks) ---------------------- */

/** Who does a task: the owner (a login, a decision), the lead in the owner's browser, the website's code, or content. */
export type TaskDoer = "owner" | "lead-chrome" | "code" | "content";

export interface SeoTask extends OwnerTaskRow {
  doer: TaskDoer;
  /** Added by a person on the desk, not by the audit's import. */
  byHand: boolean;
  /** False for the owner's own step when somebody else is looking. */
  mayMark: boolean;
  /** Where its work is done or shown: the opportunity waiting on it, or the page that lists it. */
  href: string;
}

export interface SeoTasksAnswer {
  asked: { who: TaskDoer | "all"; done: "open" | "done" | "all"; q: string };
  tasks: SeoTask[];
  /** Counts over every task, whatever was asked. */
  counts: { all: number; open: number; done: number; by: Record<TaskDoer, { open: number; done: number }> };
  /** What this person may do here: add a task (anyone who may change this page), close the owner's own steps (the owner). */
  can: { ownerSteps: boolean };
}

/** POST /api/v1/seo/owner-tasks: a task written by hand. */
export interface NewSeoTask {
  step: string;
  why?: string;
  impact?: Priority;
  who?: TaskDoer;
}
