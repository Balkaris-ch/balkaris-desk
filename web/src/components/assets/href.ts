import type { AssetsQuery, CheckId } from "@/contract/assets";

/**
 * Addresses of the Assets screen. Every tab, filter, page and opened file is
 * a search param, so the server draws the view, the back button works and a
 * view can be shared. Defaults are left out, so the plain address is the
 * default view.
 */

const DEFAULTS: AssetsQuery = { tab: "all", q: "", folder: null, format: null, flag: null, sort: "heaviest", page: 1, per: 8, file: null };

/** The query as search params, defaults left out. */
export function assetsParams(q: AssetsQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.tab !== DEFAULTS.tab) p.set("tab", q.tab);
  if (q.q) p.set("q", q.q);
  if (q.folder !== null) p.set("folder", q.folder);
  if (q.format !== null) p.set("format", q.format);
  if (q.flag !== null) p.set("flag", q.flag);
  if (q.sort !== DEFAULTS.sort) p.set("sort", q.sort);
  if (q.page !== DEFAULTS.page) p.set("page", String(q.page));
  if (q.per !== DEFAULTS.per) p.set("per", String(q.per));
  if (q.file !== null) p.set("file", q.file);
  return p;
}

/**
 * The screen with `change` applied. Changing what is listed (tab, search,
 * filters, sort, rows per page) goes back to the first page and closes the
 * opened file; changing the page or the file keeps the rest.
 */
export function assetsHref(q: AssetsQuery, change: Partial<AssetsQuery> = {}): string {
  const listing = ["tab", "q", "folder", "format", "flag", "sort", "per"].some((k) => k in change);
  const next: AssetsQuery = { ...q, ...(listing ? { page: 1, file: null } : {}), ...change };
  const s = assetsParams(next).toString();
  return s ? `/assets?${s}` : "/assets";
}

/** The opened file's address, keeping the view behind it. */
export const openHref = (q: AssetsQuery, file: string): string => assetsHref(q, { file });

/** The view with nothing opened. */
export const closeHref = (q: AssetsQuery): string => assetsHref(q, { file: null });

/** One files-only view, from the plain screen: the Quick actions and the panels' links. */
export const viewHref = (change: Partial<AssetsQuery>): string => assetsHref(DEFAULTS, change);

/** A page of the website on the Pages screen. */
export const pageHref = (path: string): string => `/pages/view?path=${encodeURIComponent(path)}`;

/** The file on the live website. */
export const liveHref = (site: string, path: string): string => `${site}${encodeURI(path)}`;

/** The CSV of what the current view selects (every page of it). */
export function csvHref(q: AssetsQuery): string {
  const p = assetsParams({ ...q, page: 1, per: DEFAULTS.per, file: null });
  const s = p.toString();
  return `/api/v1/assets/export.csv${s ? `?${s}` : ""}`;
}

/** Flags that a filter link may name. */
export const flagHref = (flag: CheckId): string => viewHref({ flag });

/** The search params the Rescan form carries back, so the screen returns to the same view. */
export const backOf = (q: AssetsQuery): string => assetsParams({ ...q, file: null }).toString();
