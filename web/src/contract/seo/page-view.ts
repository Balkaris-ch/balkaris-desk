/**
 * GET /api/v1/seo/optimize?path=/how-to-get-more-clients-for-my-law-firm&range=30d
 * — Page Optimization (board 115, at /seo/pages/view?path=): the pages list on
 * the left by priority, one page in the middle (its search figures over time,
 * its queries, what Google and the crawl say about it, its AI readiness, its
 * opportunities, what waits for approval) and the operator's suggestions for
 * it on the right. Without `path` the list's first page is opened.
 *
 * `page` is `off` (from the crawl) when the desk knows no page at that address.
 *
 * Changes (a signed-in person; the desk's own pages only). Nothing here
 * changes the live site: a title or description becomes a proposal in the
 * approval queue, an action becomes an operator task or a person's step.
 *   POST /api/v1/seo/optimize/act      { id }                               → OpportunityAnswer
 *        takes one of this page's opportunities' action (src/cc/seo/engine.ts `act`)
 *   POST /api/v1/seo/optimize/propose  { path, title?, description?, why? } → ProposalAnswer
 *        a person's own title or description, waiting in AI Operator › Approvals
 * The operator tasks and to-dos the page's buttons queue go to the existing
 * doors: POST /api/v1/operator/tasks (`NewTask`) and POST /api/v1/operator/todos.
 *
 * Types only.
 */
import type { Reading, Stat } from "../common";
import type { NewTask, ProposalRow, TaskRow } from "../operator";
import type { CtrCurve, OperatorPanel, OpportunityRow, OpportunityStateInfo, PageRef, Potential, Priority, Rate, RateStat, SeoHead } from "./common";
import type { Serp } from "./opportunities";
import type { ReadinessCheck } from "./ai-search";

export interface SeoPageViewPayload {
  head: SeoHead;
  /** The address shown, as the desk keeps it ("/" for the home page): the one asked for, or the list's first. Null when there is none to show. */
  path: string | null;
  /** The board's tile row: the site as a whole. */
  site: OptimizeSiteTiles;
  /** The list on the left: every page of the sitemap the crawl knows, by priority. */
  list: Reading<OptimizeList>;
  /** Where the search figures on this payload were read, or null when neither source could be. */
  searchFrom: SearchFrom | null;
  /** "Current status": the crawl's score as a ring and its parts. */
  status: Reading<PageStatus>;
  /** "Traffic potential": OUR ESTIMATE from this page's real impressions, absent without them. */
  potential: Reading<PagePotential>;
  /** The curve the estimates assume, stated once (src/cc/seo/ctr.ts). */
  curve: CtrCurve;
  /** The AI SEO Operator column: what the rules and the crawl found on this page, each with its real action. */
  suggestions: PageSuggestion[];
  /** "Quick actions": operator tasks for this page, each a real task kind. */
  quick: QuickAction[];
  /** Operator tasks asked about this page, newest first (at most 12). */
  asked: Reading<AskedTask[]>;
  /** Links in and out, from the crawl. */
  links: Reading<PageLinks>;
  /** GA4 for this page over the window: consenting visitors only. */
  visitors: Reading<PageVisitors>;
  page: Reading<PageSummary>;
  tiles: PageTiles;
  /** Clicks, impressions and position per day from the desk's Search Console history. */
  performance: Reading<{ days: { date: string; clicks: number; impressions: number; position: number | null }[] }>;
  /** The queries Google showed this page for in the window. */
  queries: Reading<{ rows: PageQuery[]; withheld: string }>;
  /** Google's stored state of the address (URL Inspection), the newest first, one row per day the state changed. */
  index: Reading<IndexHistory>;
  crawl: Reading<PageCrawl>;
  readiness: Reading<{ checkedAt: string; checks: ReadinessCheck[] }>;
  opportunities: OpportunityRow[];
  /** Title, description and redirect proposals for this address, waiting or decided. */
  proposals: ProposalRow[];
  serp: Serp | null;
  /** The clusters this page answers (by the audit's mapping or the desk's rule). */
  clusters: { key: string; name: string; lang: string; mappedBy: "audit" | "rule" | "person" }[];
  /**
   * Competitor pages captured for those clusters. No invented metrics: what
   * the page says, as fetched, and where it was seen (`position` in the
   * Google result the audit read for `query` on `seen`, null when only its
   * domain was seen). Highest seen first; empty when none was observed.
   */
  competitors: {
    domain: string;
    url: string;
    title: string | null;
    h1: string | null;
    words: number | null;
    lang: string | null;
    schemaTypes: string[];
    priceStated: boolean | null;
    fetchedAt: string | null;
    position: number | null;
    query: string | null;
    seen: string | null;
    /** Why the page has no figures yet: not read yet, robots.txt refused, it failed. */
    unread: string | null;
  }[];
  /** The operator's actions for this page, as tasks a button posts to POST /api/v1/operator/tasks. */
  operator: OperatorPanel;
  /** The page's settings on the Optimize tab: search, sharing, index, structured data. */
  settings: Reading<PageSettings>;
  /** The keyword store's phrases mapped to this page, with where the page carries them. */
  phrases: Reading<PagePhrase[]>;
}

/**
 * THE PAGE'S SETTINGS. Each field three ways, side by side: what the live
 * page says (the crawl), what the desk has had approved and committed (the
 * override in content/desk/overrides.json), and what waits for approval.
 * Changes go through the operator's one door, POST /api/v1/operator/proposals
 * (a title and description through POST /api/v1/seo/optimize/propose, which
 * names the page's own part); approve, reject, withdraw and check through
 * /api/v1/operator/proposals/:id/…; a share picture is uploaded first with
 * POST /api/v1/operator/pictures and named by its `sitePath`.
 */
export type SettingKey = "title" | "description" | "ogTitle" | "ogDescription" | "ogImage" | "noindex" | "canonical";

/** One proposal's value for a field. */
export interface SettingSide {
  value: string;
  /** The proposal (AI Operator › Approvals). */
  id: number;
  /** For a share picture: where it can be seen now (the desk's copy of an upload, or the live site's). */
  picture: string | null;
  by: string | null;
  at: string;
}

export interface SettingField {
  key: SettingKey;
  label: string;
  /** What the live page says, as the crawl read it; null when it says nothing. */
  live: string | null;
  /** For a share picture: its address on the live site. */
  livePicture: string | null;
  /** The newest approved and committed value; null when the desk set none. */
  approved: SettingSide | null;
  /** The newest value waiting for approval; null when none waits. */
  waiting: SettingSide | null;
  /** The characters a result or card shows before it cuts; null when there is no such limit. */
  limit: number | null;
}

/** A draft the studio workstation's local model makes (POST /api/v1/operator/tasks). */
export interface AiDraft {
  label: string;
  task: NewTask;
  /** "proposal": it arrives in the approval queue; "advice": an answer in words, nothing changes by it. */
  gives: "proposal" | "advice";
  step: string;
  available: boolean;
  unavailable: string | null;
  pending: { id: number; running: boolean; href: string } | null;
}

export interface SettingGroup {
  key: "search" | "sharing" | "index" | "schema";
  fields: SettingField[];
  /** This group's proposals for the page that wait, are approved or are live, newest first. */
  proposals: ProposalRow[];
  ai: AiDraft[];
}

export interface SchemaBlock {
  id: number;
  type: string;
  state: ProposalRow["state"];
  json: string;
  /** Why the desk would refuse it now, in a sentence; null when it passes the desk's own records (approval checks the live site again). */
  problem: string | null;
}

export interface PageSettings {
  /** Why nothing may be proposed for this page, in a sentence; null when it may. */
  locked: string | null;
  search: SettingGroup;
  sharing: SettingGroup;
  index: SettingGroup;
  schema: SettingGroup;
  /** The page's own part of its live title (the website appends " | Balkaris" where it fits). */
  ownTitle: string | null;
  /** Share pictures that can be picked: the site's default, the page's own, ones uploaded for it before. */
  sharePictures: { label: string; sitePath: string; url: string }[];
  /** The site's default share picture, absolute; null when unknown. */
  defaultPicture: string | null;
  twitterCard: string | null;
  /** The structured-data types the live page prints (the crawl). */
  schemaTypes: string[];
  /** What the crawl's rules say about the page's structured data, in plain words. */
  schemaProblems: string[];
  /** The desk's own blocks for the page, waiting or live. */
  schemaBlocks: SchemaBlock[];
  /** Why the page may not be taken out of search, or null. */
  noindexRefused: string | null;
}

/** A phrase of the keyword store mapped to this page (SEO › Keywords), and where the page carries it. */
export interface PagePhrase {
  id: number;
  phrase: string;
  lang: string | null;
  status: "relevant" | "weak" | "irrelevant" | "unjudged";
  sources: string[];
  /** Every word of the phrase (3 letters or more) in the title, main heading, description, address. */
  inTitle: boolean;
  inH1: boolean;
  inDescription: boolean;
  inAddress: boolean;
  /** From Search Console over the period, when Google showed the page for exactly this phrase; null otherwise. */
  impressions: number | null;
  position: number | null;
}

export interface PageSummary extends PageRef {
  url: string;
  status: number;
  inSitemap: boolean;
  indexable: boolean;
  /** When the desk last saw it change, or the sitemap's date. */
  updated: string | null;
  /** Visitors who began a session here from Google, GA4 (consenting visitors only); null when GA4 is not readable. */
  organicSessions: number | null;
}

export interface PageTiles {
  position: Reading<Stat>;
  impressions: Reading<Stat>;
  clicks: Reading<Stat>;
  ctr: Reading<RateStat>;
  /** The crawl's score out of 100 for this page. */
  score: Reading<Stat>;
}

export interface PageQuery {
  query: string;
  clicks: number;
  impressions: number;
  ctr: Rate;
  position: number;
  /** The cluster the keyword table puts it in, when it knows it. */
  cluster: { key: string; name: string } | null;
  /** Our estimate for the query at position 3, when it stands at 4 to 20; null otherwise. */
  potential: Potential | null;
}

export interface IndexHistory {
  /** The newest inspection. */
  now: { day: string; indexed: boolean; coverage: string | null; lastCrawl: string | null; googleCanonical: string | null; userCanonical: string | null; robots: string | null; indexing: string | null; link: string | null };
  /** Google's meaning of that state and the fix, in plain words (src/cc/seo/indexation.ts). */
  meaning: string;
  fix: string;
  /** Each day the state changed, newest first. */
  changes: { day: string; coverage: string | null; indexed: boolean }[];
  /** In the "Request indexing" queue, and whether someone marked it submitted. */
  request: { queued: boolean; submittedBy: string | null; submittedAt: string | null } | null;
}

export interface PageCrawl {
  at: string;
  title: string | null;
  titleLength: number;
  description: string | null;
  descriptionLength: number;
  h1: string | null;
  words: number | null;
  canonical: string | null;
  robots: string | null;
  schemaTypes: string[];
  linksIn: number;
  linksInFromContent: number;
  linksOut: number | null;
  /** The crawl's findings for the page, worst first, with the points each takes and the checklist area it is filed under. */
  findings: { rule: string; title: string; severity: "critical" | "warning" | "opportunity"; text: string; cost: number; area: string }[];
  /** What the address answered at the crawl. */
  status: number;
  lang: string | null;
  /** The share card as the page declares it (og:, twitter:); the picture as an https address or null. */
  og: { title: string | null; description: string | null; image: string | null };
  twitterCard: string | null;
  /** The site's fallback share picture, so a preview can say the page uses it. */
  defaultPicture: string | null;
  /** Main headings, and how many second-level ones. */
  h1s: string[];
  h2: number;
  /** Pictures on the page that a reader sees, and of them those with no alt attribute at all. */
  images: { shown: number; altAbsent: number; files: string[] };
}

/* ---------- Page Optimization (board 115) ------------------------------------------------- */

/** Where the search figures were read. */
export interface SearchFrom {
  /**
   * history         the desk's own daily snapshots of Search Console (src/cc/seo/rank.ts)
   * search-console  asked of Search Console now and kept six hours, while the desk's history has no snapshot yet
   */
  from: "history" | "search-console";
  start: string;
  end: string;
  days: number;
  line: string;
}

/** The board's tile row, for the site as a whole. */
export interface OptimizeSiteTiles {
  /**
   * Sitemap pages that answer 200 and may be indexed (`of`: all sitemap
   * addresses the crawl read). `sub` counts the sitemap pages that answer
   * something other than 200 or say noindex; absent when every one answers.
   */
  pages: Reading<Stat>;
  /** Pages with at least one open opportunity; `sub` says how many carry a high one. Waiting before the engine's first run. */
  toOptimize: Reading<Stat>;
  /** Google's average position for the site (lower is better). */
  position: Reading<Stat>;
  ctr: Reading<RateStat>;
  /**
   * OUR ESTIMATE, in clicks a month: every query at average position 4 to 20
   * brought to position 3, by our stated CTR curve, from its real impressions.
   * Off when no query stands there: then there is nothing honest to add up.
   */
  gain: Reading<{ clicksPerMonth: number; queries: number; impressionsPerMonth: number; line: string }>;
}

export interface OptimizeList {
  rows: OptimizeListRow[];
  counts: { all: number; high: number; medium: number; low: number; none: number };
  /** How the rows are ordered, in one sentence. */
  order: string;
  /** False before the opportunity engine's first run: no row has a priority then, and the order is the crawl's score. */
  ranked: boolean;
}

export interface OptimizeListRow {
  page: PageRef;
  /** The highest priority among the page's open opportunities; null for none, or before the engine's first run. */
  priority: Priority | null;
  /** Open opportunities for the page. */
  opportunities: number;
  /** The crawl's score; null for a page it does not score. */
  score: number | null;
  /** GA4 page views in the window (consenting visitors only); null when GA4 could not be read. */
  views: number | null;
  /** Search Console over the window; null when it could not be read. */
  impressions: number | null;
  ctr: Rate | null;
}

export interface PageStatusArea {
  key: "metadata" | "content" | "schema" | "links" | "technical" | "images";
  label: string;
  /** 100 less the cost of each of the area's rules that fired on the page, once per rule (floor 0). */
  score: number;
  lost: number;
  rules: { rule: string; title: string; severity: "critical" | "warning" | "opportunity"; cost: number; text: string }[];
}

export interface PageStatus {
  /** The crawl's score: 100 less each rule's cost (src/cc/site/rules.ts). Null for a page it does not score; `unscored` says why. */
  score: number | null;
  unscored: string | null;
  /** The band the score falls in: 90 and up good, 70 to 89 fair, 50 to 69 needs work, under 50 poor. */
  band: { key: "good" | "fair" | "needs-work" | "poor"; label: string } | null;
  areas: PageStatusArea[];
  /** AI-readiness checks the page passes, of those that apply; null before the first readiness check. */
  readiness: { pass: number; of: number; checkedAt: string } | null;
  /** How the parts are made, said once. */
  rule: string;
}

/** OUR ESTIMATE for one page, from its real impressions and the stated curve. */
export interface PagePotential {
  /** Clicks a month the page could add if each of its queries at position 4 to 20 reached position 3. */
  clicksPerMonth: number;
  impressionsPerMonth: number;
  /** The queries it is made of, largest first. */
  queries: { query: string; impressions: number; position: number; clicksPerMonth: number; basis: string }[];
  /** The page's impressions per day over the window, for the bars under the figure. */
  days: { date: string; impressions: number }[];
  /** The computation in one sentence. */
  basis: string;
}

/** What a suggestion's button does. */
export type SuggestionAct =
  /* One of the page's opportunities: POST /api/v1/seo/optimize/act { id }. */
  | { kind: "opportunity"; id: string }
  /* An operator task: POST /api/v1/operator/tasks with `task`. */
  | { kind: "task"; task: NewTask }
  /* A line on the operator's to-do list: POST /api/v1/operator/todos { title, note }. */
  | { kind: "todo"; title: string; note: string }
  /* Only a person can: no button, the step is the text. */
  | { kind: "person" };

/** One line of the AI SEO Operator column. */
export interface PageSuggestion {
  /** Stable: the opportunity's id, or "finding:<rule>", "readiness:<check>". */
  key: string;
  /** What to do: "Propose a title and description". */
  label: string;
  /** The real figure or finding that makes it. */
  why: string;
  priority: Priority | null;
  /** engine: an opportunity the rules found; crawl: a finding of the crawl no opportunity carries; readiness: an AI-readiness check that failed. */
  from: "engine" | "crawl" | "readiness";
  act: SuggestionAct;
  /** The button's word ("Apply", "Write", "Queue", "Add"), or null when there is no button. */
  button: string | null;
  /** What pressing it does, or the person's step, in plain words. */
  step: string;
  /** A link that helps do it (Search Console's inspection of the address), or null. */
  href: string | null;
  /** False while the same thing is already asked (an operator task queued or running, an open to-do, proposals waiting), or when it cannot be done now. */
  available: boolean;
  /** Why the button cannot be pressed now. */
  unavailable: string | null;
  /**
   * The opportunity's state, for one from the engine; for a crawl or
   * readiness line, the operator task or to-do already in hand for it.
   */
  state: OpportunityStateInfo | null;
  /** Our estimate, for one from the engine that has impressions. */
  potential: Potential | null;
  /**
   * True when the button queues an operator task (a task, or an engine
   * opportunity whose action is a proposal or a brief): only these are taken
   * by "Queue all". "Mark requested" and "Hand to code" record a person's
   * step, to-dos and a person's own steps are not tasks: one press each.
   */
  queueable: boolean;
}

/** One of the "Quick actions": an operator task for this page. */
export interface QuickAction {
  key: "optimize" | "meta" | "og" | "schema" | "links" | "alt" | "expand";
  label: string;
  /** What the task does and where its answer appears. */
  step: string;
  task: NewTask;
  /** False while the same task is queued or running (`pending`), or the page cannot take it. */
  available: boolean;
  unavailable: string | null;
  /** The operator task already doing it, queued or running; null when none is. */
  pending: { id: number; running: boolean; href: string } | null;
}

/** An operator task about this page. */
export interface AskedTask {
  task: TaskRow;
  /** Where its answer is read. */
  href: string;
  /** Proposals it made, and how many of them still wait. */
  proposals: number;
  waiting: number;
}

export interface PageLinks {
  /** Pages that link here: from their own text ("main") or from the menu and footer ("chrome"). */
  in: { source: string; text: string; place: "main" | "chrome" }[];
  /** Where it links, with what each address answered. */
  out: { target: string; text: string; internal: boolean; place: "main" | "chrome"; status: number | null; outcome: string | null }[];
}

export interface PageVisitors {
  start: string;
  end: string;
  /** People, views and seconds of engagement in the window, and the window before when GA4 measured it whole. */
  users: number;
  views: number;
  engagementSeconds: number;
  previous: { users: number; views: number; engagementSeconds: number } | null;
  /** Sessions that began on this page from Google's organic results ("Organic Search"); null when GA4 could not be read for it. */
  organicSessions: number | null;
}
