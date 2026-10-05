import type { PagesColumn, PagesQuery, PagesSort } from "@/contract/seo/pages";

/**
 * SEO › Pages keeps everything it shows in its address: the filters, the
 * order, the page of the list, the columns and the page open in the summary.
 * One function writes those addresses, leaving out every value that is the
 * default, so a plain /seo/pages is the default view and a link can be shared.
 *
 * Pure: the server components and the client ones both build their links here.
 */

export const BASE = "/seo/pages";

/** The direction a sort starts in: figures from the most, the address and the position from the least. */
export const firstDir = (sort: PagesSort): "asc" | "desc" => (sort === "path" || sort === "position" ? "asc" : "desc");

export const ROWS_PER_PAGE = [10, 25, 50, 100] as const;

export interface Place {
  query: PagesQuery;
  /** The range the frame's select wrote ("30d" is the default and is left out). */
  range: string;
}

/** The filters that narrow the list: any change to one goes back to the first page, and Reset clears them all. */
export const FILTERS = ["type", "status", "score", "traffic", "sitemap", "links", "finding", "proposal", "lang", "moved"] as const;
export type FilterField = (typeof FILTERS)[number];

/** Every filter at its default, for the Reset link. */
export const CLEARED: Partial<PagesQuery> = { type: "all", status: "all", score: "all", traffic: "all", sitemap: "all", links: "all", finding: "all", proposal: "all", lang: "all", moved: "all", q: "", open: null };

/** True when any filter or the search narrows the list. */
export const narrowed = (q: PagesQuery): boolean => FILTERS.some((f) => q[f] !== "all") || q.q !== "";

/** The query's values as address fields, defaults left out. */
function fields(q: PagesQuery, range: string): [string, string][] {
  const out: [string, string][] = [];
  if (range && range !== "30d") out.push(["range", range]);
  for (const f of FILTERS) if (q[f] !== "all") out.push([f, q[f]]);
  if (q.country !== "all") out.push(["country", q.country]);
  if (q.device !== "all") out.push(["device", q.device]);
  if (q.q) out.push(["q", q.q]);
  if (q.sort !== "impressions") out.push(["sort", q.sort]);
  if (q.dir !== firstDir(q.sort)) out.push(["dir", q.dir]);
  if (q.limit !== 10) out.push(["limit", String(q.limit)]);
  if (q.cols.length) out.push(["cols", q.cols.join(",")]);
  return out;
}

/**
 * The address of this screen with `change` applied. A change to a filter, the
 * part of search, the order or the page size goes back to the first page; the
 * summary keeps its page unless the change names another (`open: null` drops it).
 */
export function pagesHref({ query, range }: Place, change: Partial<PagesQuery> = {}): string {
  const refilter = [...FILTERS, "country", "device", "q", "sort", "dir", "limit"].some((k) => k in change);
  const next: PagesQuery = { ...query, ...(refilter && !("offset" in change) ? { offset: 0 } : {}), ...change };
  const p = new URLSearchParams(fields(next, range));
  if (next.offset > 0) p.set("offset", String(next.offset));
  if (next.open) p.set("open", next.open);
  const s = p.toString();
  return s ? `${BASE}?${s}` : BASE;
}

/** The hidden fields a GET form needs to keep everything but `except` (the search box keeps the filters). */
export function keptFields({ query, range }: Place, except: string[]): [string, string][] {
  return fields(query, range).filter(([k]) => !except.includes(k));
}

/** The table with one optional column switched on or off. */
export function columnHref(place: Place, column: PagesColumn): string {
  const on = place.query.cols.includes(column);
  return pagesHref(place, { cols: on ? place.query.cols.filter((c) => c !== column) : [...place.query.cols, column] });
}

/** The tabs of Page Optimization a link from here may open (web/src/components/seo/optimize/bits.tsx). */
export type OptimizeTab = "overview" | "optimize" | "keywords" | "content" | "links" | "technical" | "performance";

/**
 * Page Optimization for one address, in the period this screen shows and on
 * the tab the link promises ("View all keywords" opens Keywords). The period
 * is left out when it is the default, as that screen's own links do.
 */
export function optimizeHref(path: string, range: string = "30d", tab: OptimizeTab = "overview"): string {
  let q = `path=${encodeURIComponent(path).replace(/%2F/gi, "/")}`;
  if (range && range !== "30d") q += `&range=${encodeURIComponent(range)}`;
  if (tab !== "overview") q += `&tab=${tab}`;
  return `${BASE}/view?${q}`;
}

/** Another screen of the SEO section, in the period this one shows. */
function seoHref(screen: string, params: Record<string, string>, range: string): string {
  const p = new URLSearchParams(params);
  if (range && range !== "30d") p.set("range", range);
  return `/seo/${screen}?${p.toString()}`;
}

/** The open opportunities of one page, or one opportunity opened. */
export const opportunitiesHref = (range: string, o: { page: string } | { open: string }): string => seoHref("opportunities", o, range);

/** One search on the Keywords screen. */
export const keywordHref = (range: string, query: string): string => seoHref("keywords", { q: query }, range);

/** The CSV of the list as filtered (every matching row, not only this page of it). */
export function exportHref({ query, range }: Place): string {
  const p = new URLSearchParams();
  p.set("range", range || "30d");
  for (const [k, v] of fields(query, range)) if (k !== "range" && k !== "limit" && k !== "cols") p.set(k, v);
  return `/api/v1/seo/pages/export.csv?${p.toString()}`;
}
