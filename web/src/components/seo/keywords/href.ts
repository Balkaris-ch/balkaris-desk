import type { KeywordsQuery, KeywordsSort } from "@/contract/seo/keywords";

/**
 * SEO › Keywords keeps everything it shows in its address: the view, the
 * filters, the order and the page of the list. One function writes those
 * addresses, leaving out every value that is the default, so a plain
 * /seo/keywords is the default view and a link can be shared.
 *
 * Pure: the server components and the client ones both build their links here.
 */

export const BASE = "/seo/keywords";
export const API = "/api/v1/seo/keywords";

/** The direction a sort starts in: figures from the most, the position, the phrase and the cluster from the least. */
export const firstDir = (sort: KeywordsSort): "asc" | "desc" => (sort === "position" || sort === "phrase" || sort === "cluster" ? "asc" : "desc");

export const ROWS_PER_PAGE = [25, 50, 100, 200] as const;
/** The rows a page of the list shows unless the address says otherwise (the server's default too). */
export const DEFAULT_LIMIT = 25;

export interface Place {
  asked: KeywordsQuery;
  /** The range the frame's select wrote ("30d" is the default and is left out). */
  range: string;
}

/** The address's values for `asked`, defaults left out: what a link or a GET form carries. */
export function paramsOf({ asked, range }: Place): [string, string][] {
  const p: [string, string][] = [];
  if (range && range !== "30d") p.push(["range", range]);
  if (asked.view !== "keywords") p.push(["view", asked.view]);
  if (asked.lang !== "all") p.push(["lang", asked.lang]);
  if (asked.intent !== "all") p.push(["intent", asked.intent]);
  if (asked.cluster) p.push(["cluster", asked.cluster]);
  if (asked.source !== "all") p.push(["source", asked.source]);
  if (asked.status !== "default") p.push(["status", asked.status]);
  if (asked.band !== "all") p.push(["band", asked.band]);
  if (asked.shown) p.push(["shown", "1"]);
  if (asked.target) p.push(["target", "1"]);
  if (asked.flag) p.push(["flag", asked.flag]);
  if (asked.page) p.push(["page", asked.page]);
  if (asked.q) p.push(["q", asked.q]);
  if (asked.sort !== "impressions") p.push(["sort", asked.sort]);
  if (asked.dir !== firstDir(asked.sort)) p.push(["dir", asked.dir]);
  if (asked.clusterSort !== "rank") p.push(["corder", asked.clusterSort]);
  if (asked.limit !== DEFAULT_LIMIT) p.push(["limit", String(asked.limit)]);
  if (asked.offset > 0) p.push(["offset", String(asked.offset)]);
  return p;
}

/**
 * The address of this screen with `change` applied. A change to a filter, the
 * order or the page size goes back to the first page of the list.
 */
export function keywordsHref(place: Place, change: Partial<KeywordsQuery> = {}): string {
  const refilter = Object.keys(change).some((k) => k !== "offset");
  const asked: KeywordsQuery = { ...place.asked, ...(refilter && !("offset" in change) ? { offset: 0 } : {}), ...change };
  if ("sort" in change && !("dir" in change)) asked.dir = firstDir(asked.sort);
  const s = new URLSearchParams(paramsOf({ asked, range: place.range })).toString();
  return s ? `${BASE}?${s}` : BASE;
}

/** Every filter back to its default, the view, the range and the page size kept. */
export function clearedHref(place: Place): string {
  return keywordsHref(place, { lang: "all", intent: "all", cluster: "", source: "all", status: "default", band: "all", shown: false, target: false, flag: "", page: "", q: "" });
}

/** True when any filter is set. */
export function filtered(a: KeywordsQuery): boolean {
  return a.lang !== "all" || a.intent !== "all" || !!a.cluster || a.source !== "all" || a.status !== "default" || a.band !== "all" || a.shown || a.target || !!a.flag || !!a.page || !!a.q;
}

/** The hidden fields a GET form needs to keep everything but `except` (the search box keeps the filters). */
export function keptFields(place: Place, except: string[]): [string, string][] {
  return paramsOf(place).filter(([k]) => !except.includes(k) && k !== "offset");
}

/** The CSV of the list as filtered (every matching row, not only this page of it). */
export function exportHref(place: Place): string {
  const p = new URLSearchParams(paramsOf(place).filter(([k]) => k !== "offset" && k !== "limit" && k !== "view"));
  if (!p.has("range")) p.set("range", place.range || "30d");
  return `${API}/export.csv?${p.toString()}`;
}

/** Page Optimization for one address. */
export const optimizeHref = (path: string): string => `/seo/pages/view?path=${encodeURIComponent(path)}`;

/** The opportunities that name a phrase, or a cluster. */
export const oppsForPhrase = (phrase: string): string => `/seo/opportunities?q=${encodeURIComponent(phrase)}`;
export const oppsForCluster = (key: string): string => `/seo/opportunities?cluster=${encodeURIComponent(key)}`;
