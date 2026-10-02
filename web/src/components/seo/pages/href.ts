import type { PagesQuery, PagesSort } from "@/contract/seo/pages";

/**
 * SEO › Pages keeps everything it shows in its address: the filters, the
 * order, the page of the list and the page open in the summary. One function
 * writes those addresses, leaving out every value that is the default, so a
 * plain /seo/pages is the default view and a link can be shared.
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

/**
 * The address of this screen with `change` applied. A change to a filter, the
 * order or the page size goes back to the first page; the summary keeps its
 * page unless the change names another (`open: null` drops it).
 */
export function pagesHref({ query, range }: Place, change: Partial<PagesQuery> = {}): string {
  const refilter = ["type", "status", "score", "traffic", "q", "sort", "dir", "limit"].some((k) => k in change);
  const next: PagesQuery = { ...query, ...(refilter && !("offset" in change) ? { offset: 0 } : {}), ...change };
  const p = new URLSearchParams();
  if (range && range !== "30d") p.set("range", range);
  if (next.type !== "all") p.set("type", next.type);
  if (next.status !== "all") p.set("status", next.status);
  if (next.score !== "all") p.set("score", next.score);
  if (next.traffic !== "all") p.set("traffic", next.traffic);
  if (next.q) p.set("q", next.q);
  if (next.sort !== "impressions") p.set("sort", next.sort);
  if (next.dir !== firstDir(next.sort)) p.set("dir", next.dir);
  if (next.limit !== 10) p.set("limit", String(next.limit));
  if (next.offset > 0) p.set("offset", String(next.offset));
  if (next.open) p.set("open", next.open);
  const s = p.toString();
  return s ? `${BASE}?${s}` : BASE;
}

/** The hidden fields a GET form needs to keep everything but `except` (the search box keeps the filters). */
export function keptFields({ query, range }: Place, except: (keyof PagesQuery)[]): [string, string][] {
  const out: [string, string][] = [];
  const add = (k: keyof PagesQuery, v: string, skip: boolean) => {
    if (!skip && !except.includes(k)) out.push([k, v]);
  };
  if (range && range !== "30d") out.push(["range", range]);
  add("type", query.type, query.type === "all");
  add("status", query.status, query.status === "all");
  add("score", query.score, query.score === "all");
  add("traffic", query.traffic, query.traffic === "all");
  add("sort", query.sort, query.sort === "impressions");
  add("dir", query.dir, query.dir === firstDir(query.sort));
  add("limit", String(query.limit), query.limit === 10);
  return out;
}

/** Page Optimization for one address. */
export const optimizeHref = (path: string): string => `${BASE}/view?path=${encodeURIComponent(path)}`;

/** The CSV of the list as filtered (every matching row, not only this page of it). */
export function exportHref({ query, range }: Place): string {
  const p = new URLSearchParams();
  p.set("range", range || "30d");
  for (const [k, v] of keptFields({ query, range }, [])) if (k !== "range" && k !== "limit") p.set(k, v);
  if (query.q) p.set("q", query.q);
  return `/api/v1/seo/pages/export.csv?${p.toString()}`;
}
