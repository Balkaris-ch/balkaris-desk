/* A relative path, not "@/contract": scripts/check-cc-seo-search-console.ts imports this file from the server's
   side, where "@/" means nothing, to prove the addresses it writes are the ones the server answers. */
import type { ExplorerDimension, ExplorerQuery, InspectionQuery } from "../../../contract/seo/search-console";

/**
 * SEO › Search Console keeps everything it shows in its address: the
 * dimension, the filters, the order, the page of the list, the chart's
 * figure and the inspection table's view. One function writes those
 * addresses and leaves out every value that is the default, so a plain
 * /seo/search-console is the default view and a view can be shared.
 *
 * Pure: the server components and the client ones both build their links here.
 */

export const BASE = "/seo/search-console";

/** The chart's figure: clicks with impressions, the day's CTR, or Google's average position. */
export type ChartMetric = "volume" | "ctr" | "position";
export const CHART_METRICS: readonly ChartMetric[] = ["volume", "ctr", "position"];

export const ROWS_PER_PAGE = [25, 50, 100] as const;

export interface Place {
  asked: ExplorerQuery;
  /** The range the frame's select wrote ("30d" is the default and is left out). */
  range: string;
  chart: ChartMetric;
  ix: InspectionQuery;
  /** A window given by its dates (?start=&end=), as the address gave it (the server's `asked.window`). */
  dates: { start: string; end: string } | null;
  /** ?source=live as the address asked it (a view the snapshots cannot answer goes live by itself). */
  live: boolean;
}

/** The sort a dimension starts in: dates newest first, everything else by clicks. */
export const firstSort = (d: ExplorerDimension): ExplorerQuery["sort"] => (d === "date" ? "key" : "clicks");

/** The direction a sort starts in: figures from the most, the position and a name from the least, dates from the newest. */
export const firstDir = (sort: ExplorerQuery["sort"], d: ExplorerDimension): "asc" | "desc" => (sort === "position" ? "asc" : sort === "key" ? (d === "date" ? "desc" : "asc") : "desc");

export type Change = Partial<Pick<ExplorerQuery, "dimension" | "q" | "page" | "part" | "offsite" | "country" | "device" | "sort" | "dir" | "offset" | "limit">> & {
  chart?: ChartMetric;
  /** A window by its dates; null goes back to the period chosen in the head. */
  dates?: { start: string; end: string } | null;
  ix?: InspectionQuery["show"];
  ixq?: string;
  ixs?: string | null;
  ixsort?: InspectionQuery["sort"];
  ixo?: number;
};

/** What changes the explorer's rows, so its list starts again from the first page. */
const REFILTER = ["q", "page", "part", "offsite", "country", "device", "limit", "dimension", "dates"];
/** What changes the inspection table's rows, so it starts again from its first page. */
const REINSPECT = ["ix", "ixq", "ixs", "ixsort"];

/** The pairs of the address for a place with `change` applied, defaults left out. */
function pairs(place: Place, change: Change): [string, string][] {
  const a = place.asked;
  const dimension = change.dimension ?? a.dimension;
  const newDimension = dimension !== a.dimension;
  const refilter = REFILTER.some((k) => k in change);
  const sort = change.sort ?? (newDimension ? firstSort(dimension) : a.sort);
  const dir = change.dir ?? (newDimension || "sort" in change ? firstDir(sort, dimension) : a.dir);
  const offset = change.offset ?? (refilter || "sort" in change || "dir" in change ? 0 : a.offset);
  const limit = change.limit ?? a.limit;
  const q = change.q ?? a.q;
  const page = "page" in change ? (change.page ?? null) : a.page;
  const part = "part" in change ? (change.part ?? null) : a.part;
  /* "Not on the site" is the Pages list's own filter: another dimension leaves it behind. */
  const offsite = dimension === "page" && (change.offsite ?? a.offsite);
  const country = change.country ?? a.country;
  const device = change.device ?? a.device;
  const dates = "dates" in change ? (change.dates ?? null) : place.dates;
  const chart = change.chart ?? place.chart;
  const ix = change.ix ?? place.ix.show;
  const ixq = change.ixq ?? place.ix.q;
  const ixs = "ixs" in change ? (change.ixs ?? null) : place.ix.state;
  const ixsort = change.ixsort ?? place.ix.sort;
  const ixo = change.ixo ?? (REINSPECT.some((k) => k in change) ? 0 : place.ix.offset);

  const out: [string, string][] = [];
  if (place.range && place.range !== "30d") out.push(["range", place.range]);
  if (dates) out.push(["start", dates.start], ["end", dates.end]);
  if (dimension !== "query") out.push(["dimension", dimension]);
  if (q) out.push(["q", q]);
  if (page) out.push(["page", page]);
  if (part) out.push(["pagepart", part]);
  if (offsite) out.push(["offsite", "1"]);
  if (country !== "all") out.push(["country", country]);
  if (device !== "all") out.push(["device", device]);
  if (place.live) out.push(["source", "live"]);
  if (sort !== firstSort(dimension)) out.push(["sort", sort]);
  if (dir !== firstDir(sort, dimension)) out.push(["dir", dir]);
  if (limit !== 25) out.push(["limit", String(limit)]);
  if (offset > 0) out.push(["offset", String(offset)]);
  if (chart !== "volume") out.push(["chart", chart]);
  if (ix !== "all") out.push(["ix", ix]);
  if (ixq) out.push(["ixq", ixq]);
  if (ixs) out.push(["ixs", ixs]);
  if (ixsort !== "queue") out.push(["ixsort", ixsort]);
  if (ixo > 0) out.push(["ixo", String(ixo)]);
  return out;
}

/** The address of this screen with `change` applied. */
export function scHref(place: Place, change: Change = {}): string {
  const s = new URLSearchParams(pairs(place, change)).toString();
  return s ? `${BASE}?${s}` : BASE;
}

/**
 * The hidden fields a GET form needs to keep everything but `except` (the
 * search box keeps the rest). A form's own fields start their list again
 * from its first page, so no offset of the list it changes is kept.
 */
export function keptFields(place: Place, except: string[]): [string, string][] {
  const inspection = except.some((k) => k.startsWith("ix"));
  return pairs(place, inspection ? { ixo: 0 } : { offset: 0 }).filter(([k]) => !except.includes(k) && k !== (inspection ? "ixo" : "offset"));
}

/** The CSV of the explorer as filtered: every row, not only this page of it. */
export function exportHref(place: Place): string {
  const p = new URLSearchParams(pairs(place, { offset: 0 }).filter(([k]) => !["offset", "limit", "chart", "ix", "ixq", "ixs", "ixsort", "ixo", "sort", "dir"].includes(k)));
  p.set("range", place.range || "30d");
  p.set("sort", place.asked.sort);
  p.set("dir", place.asked.dir);
  return `/api/v1/seo/search-console/export.csv?${p.toString()}`;
}

/** Page Optimization for one address. */
export const optimizeHref = (path: string): string => `/seo/pages/view?path=${encodeURIComponent(path)}`;

/**
 * The query on Google itself, as a searcher in Switzerland sees it: German
 * interface, Swiss results, no personal history (pws=0). Only a link: the
 * desk fetches nothing from Google's result page.
 */
export const googleHref = (query: string): string => `https://www.google.com/search?q=${encodeURIComponent(query)}&gl=ch&hl=de&pws=0`;

/** The query on the Keywords tab, every status shown, where it can be tracked and judged. */
export const keywordsHref = (query: string): string => `/seo/keywords?q=${encodeURIComponent(query)}&status=all`;

/** The search box's words for "exactly this query": what the server reads as the exact query. */
export const exactly = (query: string): string => `"${query.replace(/"/g, "")}"`;
