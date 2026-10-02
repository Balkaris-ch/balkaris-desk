import type { DayPoint, EarlySignals, Range, Reading, Stat } from "./common";

/**
 * What GET /api/v1/insights answers: the whole Insights screen in one call.
 *
 * The screen is the desk's own life of a shared link (shared, queued, written
 * on the workstation, a draft, live at its address but unlisted, listed) laid
 * beside what GA4, Search Console and the desk's crawl say about the articles
 * that reached balkaris.ch. Every figure is a `Reading` or sits inside one;
 * the desk's own records are read from its database and say so ("desk").
 *
 * Types only: the server imports this file with `import type`.
 */

/** The strip under the tiles. Radar is the overview; every other tab is a filter of the same rows. */
export type InsightTab = "radar" | "inbox" | "drafts" | "review" | "published" | "performance" | "opportunities" | "archive";

/**
 * Where a piece stands. The first six are `ContentStatus` keys of the Badge
 * primitive; `archived` is a piece taken off the site or a draft deleted.
 *
 *   published  live at its address and listed (menus, shelves, sitemap)
 *   review     live at its address, not listed: "In review"
 *   draft      written, not on the site
 *   writing    its write job is queued or running on the workstation
 *   toread     shared and not written, with nothing queued: read failed, or nothing asked yet
 *   stuck      the workstation gave its job up after three attempts
 */
export type InsightStatus = "published" | "review" | "draft" | "writing" | "toread" | "stuck" | "archived";

/** Where a piece came from: the platform it was shared from, a web page, or the website itself. */
export interface InsightSource {
  /** tiktok | instagram | youtube | web | site */
  key: string;
  label: string;
}

/** One row of "All insights": a shared link, its article if it has one, or an article written on the website itself. */
export interface InsightRow {
  key: string;
  /** Where the row leads: /insights/<draft id>, /insights/link/<link id>, or the live article for one written on the site. */
  href: string;
  title: string;
  /** The article's picture: the desk's drawn cover, or the page's share picture. Null when there is none. */
  cover: string | null;
  status: InsightStatus;
  /** Only for `archived`: taken off the site, or the draft deleted. */
  archived?: "taken-down" | "removed";
  source: InsightSource;
  /** The shelf: the topic the desk matched, or the topic page that lists it on the site. */
  category: { id: string; label: string } | null;
  /** When it was first listed (published), or went live unlisted (review), YYYY-MM-DD in Zurich. Null when the desk has no record. */
  published: string | null;
  /** /insights/<slug> once the article has an address on the site, else null. */
  path: string | null;
  /** The live address, for a piece that is on the site. */
  liveUrl: string | null;
  /** When the link was shared (ISO); for a site article, null. */
  shared: string | null;
  /** The sharer's handle or the page's site ("@legaltech", "techcrunch.com"). */
  handle: string | null;
  linkId: number | null;
  draftId: number | null;
  /** The existing retry action applies: a stuck job, or a link that could not be read. */
  canRetry: boolean;
  /**
   * Why it is stuck or could not be read, in one line: the most informative
   * line of the error (src/cc/system.ts `whyLine`), not its first.
   */
  problem: string | null;
  /** The whole error, scrubbed, for the hover and the row's detail. Null when there is no problem. */
  problemFull: string | null;
}

/** An article's GA4 figures over the range, by its path. */
export interface ArticleFigures {
  views: number;
  /** The same over the period before, or null when that period was not measured whole. */
  previousViews: number | null;
  users: number;
  engagementSeconds: number;
  /** Sessions that began on the article. */
  entrances: number;
  /** Of those, from Organic Search. */
  organic: number;
  /** generate_lead events in sessions that began on the article; null when that read failed. */
  conversions: number | null;
}

/** An article's Search Console figures over the range, by its path. */
export interface SearchFigures {
  clicks: number;
  impressions: number;
  /** Percent, or null when it had no impressions. */
  ctr: number | null;
  /** Google's average position (not a tracked rank). */
  position: number | null;
  /** Distinct queries Google showed the article for; null when that read failed. */
  keywords: number | null;
  /** The window is early and the article was shown fewer times than the standard floor: its CTR and keywords are early signals (`table.searchEarly`). */
  early?: boolean;
}

/** A query Search Console shows the site for that no article's title or heading answers. */
export interface Opportunity {
  query: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
  /** The page Google shows for it today, when known. */
  path: string | null;
  /** Listed by the early mode: shown fewer times than the standard floor (`opportunities.early`). */
  early?: boolean;
}

/** The Article traffic chart and its headline. */
export interface ArticleTraffic {
  organic: DayPoint[];
  direct: DayPoint[];
  /** Sessions that included an article, any channel, over the range. */
  visits: number;
  /** The same over the period before, or null when it was not measured whole. */
  previous: number | null;
  /** How many of the newest points GA4 is still counting. */
  provisional: number;
  /** The first day measured, when the range starts before it. */
  since: string | null;
}

/** One of the three most-read articles. */
export interface TopInsight {
  path: string;
  title: string;
  href: string;
  cover: string | null;
  views: number;
  previousViews: number | null;
}

export interface CalendarDot {
  /** YYYY-MM-DD, Zurich. */
  date: string;
  /** published | unlisted | draft | shared */
  kind: string;
  title: string;
}

export interface InboxRow {
  linkId: number;
  title: string;
  handle: string | null;
  /** ISO, when it was shared. */
  shared: string;
  cover: string | null;
  href: string;
  status: InsightStatus;
  canRetry: boolean;
  /** As in `InsightRow`: the most informative line, and the whole text for the hover. */
  problem: string | null;
  problemFull: string | null;
}

/** A finding of one of the stated rules. Never a prediction. */
export interface Recommendation {
  id: string;
  /** What to do, in a few words: "Shorten the title". */
  action: string;
  /** The article's title. */
  subject: string;
  /** The figure the rule measured, short: "64 characters", "3 days". */
  measure: string;
  href: string;
  /** Title | Description | Links | Cover | Content | Stuck | Freshness */
  kind: string;
  /** The whole finding, with the figure and the line it crossed. */
  text: string;
  tone: "warn" | "bad" | "info";
}

/** What the Create insight dialog must say, and whether this person may use it. GET /api/v1/insights/state. */
export interface InsightsState {
  /** DESK_AUTOPUBLISH: a written article goes to balkaris.ch, listed, with no review step. */
  autopublish: boolean;
  /** The workstation's runner: when it last asked for work, ISO, and whether that was in the last five minutes. */
  runner: { lastSeen: string | null; awake: boolean };
  canCreate: boolean;
  /** The four ways of writing, as the desk's templates name them. */
  formats: { key: string; label: string; as: string }[];
  /** Write jobs waiting before a new one. */
  queued: number;
}

/** POST /api/v1/insights/create { url, format } answers this. */
export interface CreateAnswer {
  linkId: number;
  /** The link was already on the desk: nothing new was queued. */
  already: boolean;
  href: string;
  /** In the desk's words: what happens next. */
  said: string;
}

export interface InsightsPayload {
  range: Range;
  /** Fed from obviously artificial rows (?specimen=1 on a workstation): the page shows a ribbon. */
  specimen: boolean;
  tiles: {
    published: Reading<Stat>;
    writing: Reading<Stat>;
    toRead: Reading<Stat>;
    stuck: Reading<Stat>;
    organic: Reading<Stat>;
    conversions: Reading<Stat>;
  };
  /** How many rows each filtering tab holds; opportunities (all of them, not only the ones listed) is null until Search Console answers. */
  counts: { inbox: number; drafts: number; review: number; published: number; archive: number; opportunities: number | null };
  traffic: Reading<ArticleTraffic>;
  /** Shelves that live articles are on: the content-type select. */
  types: { value: string; label: string }[];
  /** The shelf the traffic chart is narrowed to, or null for all articles. */
  type: string | null;
  top: Reading<TopInsight[]>;
  calendar: { month: string; today: string; dots: CalendarDot[] };
  /**
   * The links not yet written (the Inbox tab's rows), by where they were shared from. Every source the
   * desk has had a link from has an entry: `count` of its links wait, `shared` is all it ever sent.
   * `rows` are the newest four waiting from `source`.
   */
  inbox: { sources: { key: string; label: string; count: number; shared: number }[]; source: string | null; rows: InboxRow[]; asOf: string };
  table: {
    rows: InsightRow[];
    asOf: string;
    ga4: Reading<Record<string, ArticleFigures>>;
    gsc: Reading<Record<string, SearchFigures>>;
    /**
     * Set when Search Console's window is early (src/cc/search/gsc.ts, EARLY): the line for the
     * table, and the floor under which an article's CTR and keywords are marked early. Else null.
     */
    searchEarly: EarlySignals | null;
    /**
     * GA4's generate_lead read answered, so a live article it has no row for had no conversions (a
     * real zero). False when that read failed while the views did not: Conversions are then unknown.
     */
    conversionsRead: boolean;
  };
  /**
   * `rows` are the first ones Search Console shows most; `total` is how many there are in all.
   * `floor` is the standard floor, or 1 in an early window, when `early` says what that means.
   */
  opportunities: Reading<{ rows: Opportunity[]; floor: number; early: EarlySignals | null; total: number }>;
  recommendations: Reading<Recommendation[]>;
  state: InsightsState;
}
