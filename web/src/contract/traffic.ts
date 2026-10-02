import type { DayPoint, Range, Reading, Stat } from "./common";

/**
 * What GET /api/v1/traffic?range= answers: the whole Traffic screen in one
 * payload, each panel its own Reading so one failing source costs one panel.
 *
 * Every GA4 figure counts only visitors who accepted the cookie banner (the
 * reading's note says so). Clarity is a once-a-day snapshot. Types only: the
 * server imports this file with `import type`.
 */

/** The period the history panels cover, as GA4 cut it. */
export interface TrafficPeriod {
  /** YYYY-MM-DD, both ends included. It ends yesterday: today is still being counted. */
  start: string;
  end: string;
  /** Days in the range asked for (7, 30, 90, 365). */
  days: number;
  /** The first day the website has any GA4 data. */
  since: string;
  /** True when the range starts before `since`: its figures cover `since` to `end` only. */
  partial: boolean;
  /** The period the changes are measured against, or null when it was not measured whole. */
  previous: { start: string; end: string } | null;
  /** From this day on GA4 may still change the figures. */
  provisionalFrom: string;
}

/** The six headline figures. */
export interface TrafficTiles {
  visitors: Reading<Stat>;
  sessions: Reading<Stat>;
  views: Reading<Stat>;
  /** Engaged sessions; `sub` carries the engagement rate (or its two counts under 30 sessions). */
  engaged: Reading<Stat>;
  /** Seconds in the foreground per visitor (GA4's average engagement time). */
  engagementTime: Reading<TrafficTimeStat>;
  newVisitors: Reading<Stat>;
}

/**
 * The engagement-time figure. Its spark is `daily`, not `series` (left
 * empty): an average over nobody is not zero, so a day without visitors is a
 * gap (null), which a Stat's series cannot hold.
 */
export interface TrafficTimeStat extends Stat {
  /** Seconds per visitor on each day of the period, oldest first; null on a day nobody visited. Empty when the day report could not be read. */
  daily: (number | null)[];
}

/** The large chart: visitors per day, with the same day one period earlier. */
export interface TrafficPerDay {
  /** A point's `previous` is set only when the whole earlier period was measured (`previous` below is not null); until then every one is null. */
  points: DayPoint[];
  /** Visitors over the whole period (people once, not a sum of days). */
  total: number;
  /** The same for the period before, or null when it was not measured whole. */
  previous: number | null;
  /** How many of the newest points GA4 may still change. */
  provisional: number;
}

/** One of our channel groups (Google's, with LinkedIn as its own). */
export interface TrafficChannel {
  key: string;
  label: string;
  sessions: number;
  users: number;
  /** Sessions in the period before, or null when it was not measured. */
  previous: number | null;
}

export interface TrafficChannels {
  /** Largest first. Sessions add up to `sessions`. */
  rows: TrafficChannel[];
  sessions: number;
  /** How the groups are made: say it where they are drawn. */
  note: string;
}

/** One source and medium pair ("google / organic"). */
export interface TrafficSourceRow {
  source: string;
  medium: string;
  sessions: number;
  engagedSessions: number;
  users: number;
  /** Sessions in the period before, or null. */
  previous: number | null;
}

/** One address sessions began on. */
export interface TrafficLandingRow {
  path: string;
  /** From the desk's crawl, when it knows the page. */
  title: string | null;
  /** The page's share picture, an absolute address, when it has one. */
  picture: string | null;
  sessions: number;
  engagedSessions: number;
  /** generate_lead events in sessions that began here, per GA4; null when that report could not be read. */
  enquiries: number | null;
  /** Sessions in the period before, or null. */
  previous: number | null;
}

/** One address that was seen. */
export interface TrafficPageRow {
  path: string;
  title: string | null;
  users: number;
  views: number;
  engagementSeconds: number;
  /** Visitors in the period before, or null. */
  previous: number | null;
}

export interface TrafficDeviceRow {
  /** GA4's word: "desktop", "mobile", "tablet", "smart tv". */
  key: string;
  users: number;
  sessions: number;
  previous: number | null;
}

export interface TrafficCountryRow {
  /** ISO alpha-2, or null when GA4 could not place the visitor. */
  code: string | null;
  name: string;
  users: number;
  sessions: number;
}

export interface TrafficCityRow {
  city: string;
  country: string;
  code: string | null;
  users: number;
}

export interface TrafficCities {
  /** Most visitors first, at most 25. */
  rows: TrafficCityRow[];
  /** How many cities GA4 has for the period, including those past the 25 listed. */
  total: number;
}

/** People active in the last 30 minutes, on every site in the GA4 property. */
export interface TrafficLive {
  total: number;
  /** Oldest first: 30 values, the last one is the current minute. */
  minutes: number[];
  /** By page TITLE (realtime has no address); `path` is the crawl's page with that exact title, when exactly one has it. */
  screens: {
    title: string;
    path: string | null;
    users: number;
    views: number;
  }[];
  countries: { code: string | null; name: string; users: number }[];
  devices: { key: string; users: number }[];
  /** Seconds since GA4 answered. */
  age: number;
}

/** One event name GA4 recorded. */
export interface TrafficEventRow {
  name: string;
  /** What it means, in a few words: the website's own description for its five, GA4's for its own. Null when nobody wrote one down. */
  what: string | null;
  /** One of the five the website sends itself. */
  ours: boolean;
  /** Marked as a key event in GA4 Admin. */
  key: boolean;
  count: number;
  users: number;
  previous: number | null;
  /** Count per day of the period, oldest first, zeros included. */
  daily: number[];
}

/** Clarity's view of one address, from the newest daily snapshot. Any figure may be null when Clarity did not send it. */
export interface TrafficClarityRow {
  path: string;
  sessions: number | null;
  /** Average scroll depth, percent of the page. */
  scrollDepth: number | null;
  /** Seconds actively engaged, as Clarity sends it. */
  activeTime: number | null;
  rageClicks: number | null;
  deadClicks: number | null;
  quickBacks: number | null;
  scriptErrors: number | null;
}

export interface TrafficClarity {
  /** The UTC day the snapshot was taken, and how many days it covers (1, or 2 to 3 after missed days). */
  day: string;
  span: number;
  /** Site-wide sums over devices. */
  sessions: number | null;
  rageClicks: number | null;
  deadClicks: number | null;
  quickBacks: number | null;
  scriptErrors: number | null;
  /** Most sessions first. */
  rows: TrafficClarityRow[];
  /** Requests the desk may still send Clarity today, of ten. */
  callsLeft: number;
}

/** Where a person goes for what no API gives. */
export interface TrafficLinks {
  /** The GA4 property's own reports. */
  analytics: string;
  /** GA4's realtime report for the same property: what the live panel reads. */
  realtime: string;
  /**
   * Clarity's dashboard, recordings and heatmaps for the website's project.
   * `project` is false while CLARITY_PROJECT_ID is not set: then all three
   * open Clarity's list of projects, and the project is chosen there.
   */
  clarity: { project: boolean; dashboard: string; recordings: string; heatmaps: string };
}

/** The whole screen. */
export interface TrafficPayload {
  range: Range;
  /** True when artificial specimen rows stand in for a source that is not connected (development only). */
  specimen: boolean;
  period: Reading<TrafficPeriod>;
  tiles: TrafficTiles;
  perDay: Reading<TrafficPerDay>;
  channels: Reading<TrafficChannels>;
  sources: Reading<TrafficSourceRow[]>;
  landing: Reading<TrafficLandingRow[]>;
  pages: Reading<TrafficPageRow[]>;
  devices: Reading<TrafficDeviceRow[]>;
  countries: Reading<TrafficCountryRow[]>;
  cities: Reading<TrafficCities>;
  live: Reading<TrafficLive>;
  events: Reading<TrafficEventRow[]>;
  clarity: Reading<TrafficClarity>;
  links: TrafficLinks;
}
