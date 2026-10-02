/**
 * The Command Center ("/"): what GET /api/v1/overview answers, in one call.
 *
 * Every panel is its own `Reading`, produced on the server independently of
 * the others, so a source that fails costs its panel and never the screen.
 * Types only: the server imports this file with `import type`.
 */
import type { ActivityItem, AttentionItem, DayPoint, JobListed, Range, Reading, Share, SourceId, Stat } from "./common";

/** The five tiles under the head. */
export interface OverviewTiles {
  /** GA4 active users over the range, with the day line as its spark. */
  visitors: Reading<Stat>;
  /** Enquiries counted by the engine (counts only, no personal field). Off until the engine key exists. */
  leads: Reading<Stat>;
  /**
   * The true stand-in printed under an absent Leads tile: GA4's generate_lead
   * count, named "form submissions seen by GA4". Null while `leads` is ok.
   */
  formsSeen: Reading<Stat> | null;
  /** Search Console clicks from Google Search. Off until Search Console is connected. */
  organicClicks: Reading<Stat>;
  /**
   * Sitemap addresses Google reports as indexed (URL Inspection, once a day),
   * `of` the sitemap's count, `sub` "n issues". Never the crawl's page count.
   */
  indexed: Reading<Stat>;
  /** GA4 generate_lead events over GA4 sessions, in percent; `sub` carries the two raw counts. */
  conversion: Reading<Stat>;
}

/** "Website traffic": people per day, with the same day one period earlier where it was measured. */
export interface TrafficPanel {
  days: DayPoint[];
  /** People over the whole range, counted once each (not a sum of the days). */
  total: number;
  /** The same for the period before, or null when it was not measured whole. */
  previous: number | null;
  /** How many of the newest points GA4 may still change. */
  provisional: number;
  /** The first day GA4 has data for the website. */
  since: string;
  /** True when the range starts before measurement began, so it covers fewer days than it names. */
  partial: boolean;
}

/** "Traffic sources": sessions by our six channel groups, largest first. */
export interface SourcesPanel {
  slices: Share[];
  /** Sessions in the range; the slices add up to it. */
  total: number;
}

/** One row of "Live visitors": a page as GA4 realtime names it. */
export interface LivePage {
  /** The address when exactly one crawled page carries this title, else the title itself. */
  label: string;
  /** The page's address in the desk when it is known. */
  href: string | null;
  /** "address" when the title was matched to one page, "title" when it was not. */
  shown: "address" | "title";
  users: number;
}

/** "Live visitors": people active in the last 30 minutes, as GA4 realtime defines it. */
export interface LivePanel {
  total: number;
  /** At most five, most people first. */
  pages: LivePage[];
  /** Titles past the fifth. */
  more: number;
  /** Seconds since GA4 answered. */
  age: number | null;
  /** GA4's own realtime report for the property. */
  report: string;
}

/** One rule behind "Attention required", and whether it could run. */
export interface AttentionRuleState {
  id: string;
  title: string;
  area: AttentionItem["area"];
  source: SourceId;
  /** The rule in one sentence, with its yardstick. */
  rule: string;
  state: "ok" | "waiting" | "off";
  /** Rows it produced. */
  found: number;
  reason?: string;
  step?: string;
}

/** "Attention required": rows from stated rules only, worst first. */
export interface AttentionPanel {
  items: AttentionItem[];
  /** All rows the rules produced; `items` may be the first few of them. */
  total: number;
  rules: AttentionRuleState[];
}

/**
 * The crawl job as "Run SEO audit" needs to know it. `every` (seconds between
 * runs) says how soon it may be asked for again: the desk refuses a second
 * request within min(every, 10 minutes) of the last start or request.
 */
export type AuditJob = Pick<JobListed, "name" | "title" | "every" | "ready" | "enabled" | "running" | "lastStart" | "lastEnd" | "lastOk" | "progress">;

/** One cell of "Performance overview". */
export interface VitalCell {
  /** Printed beside the figure, always. */
  kind: "lab" | "field";
  value: number;
  unit: "ms" | "score";
  rating: "good" | "needs-improvement" | "poor";
  strategy: "mobile" | "desktop";
  /** Lab: how many tested pages the median is taken over. */
  pages: number;
  /** One value per day from the desk's own history, oldest first. */
  history: number[];
}

/** Uptime of the home page from the desk's own probes. */
export interface UptimeCell {
  percent: number;
  checks: number;
  failed: number;
  /** ISO time of the oldest check in the range: where the figure begins. */
  since: string;
  history: number[];
}

export interface PerformancePanel {
  lcp: Reading<VitalCell>;
  /** Field only: off with the reason until Google has field data. */
  inp: Reading<VitalCell>;
  /** Lab Total Blocking Time, offered under its own name while INP is absent. */
  tbt: Reading<VitalCell>;
  cls: Reading<VitalCell>;
  uptime: Reading<UptimeCell>;
}

/** One row of "Top pages". */
export interface TopPageRow {
  path: string;
  /** The page's share picture (og:image) from the crawl, or null. */
  picture: string | null;
  users: number;
  /** The period before, or null when it was not measured. */
  previous: number | null;
}

/** The last column of "Top pages": enquiries from the engine, or GA4's form submissions standing in, labelled. */
export interface PageSends {
  /** The column's heading. */
  label: string;
  /** The tooltip under the heading: what is counted and where it comes from. */
  note: string;
  /** Count per address, for the range. An address missing here had none. */
  byPath: Record<string, number>;
}

export interface TopPagesPanel {
  rows: TopPageRow[];
  sends: Reading<PageSends>;
}

/** "Countries": people by country, most first. */
export interface CountriesPanel {
  rows: { code: string | null; name: string; users: number }[];
  /** People over all rows, for the shares. */
  total: number;
}

/** GET /api/v1/overview?range=7d|30d|90d|1y */
export interface Overview {
  range: Range;
  /** True only when the dev copy was asked for ?specimen=1: some panels hold made-up rows. */
  specimen: boolean;
  tiles: OverviewTiles;
  traffic: Reading<TrafficPanel>;
  sources: Reading<SourcesPanel>;
  live: Reading<LivePanel>;
  attention: Reading<AttentionPanel>;
  activity: Reading<ActivityItem[]>;
  /** Null when the crawl job is not registered. */
  audit: AuditJob | null;
  performance: PerformancePanel;
  topPages: Reading<TopPagesPanel>;
  countries: Reading<CountriesPanel>;
}

/** GET /api/v1/overview/live: the Live visitors panel alone, polled about once a minute. */
export type OverviewLive = Reading<LivePanel> & { specimen?: boolean };

/** GET /api/v1/overview/attention?range=: every row and every rule. */
export interface OverviewAttention {
  range: Range;
  specimen: boolean;
  attention: Reading<AttentionPanel>;
}
