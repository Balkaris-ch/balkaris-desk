import type { KeywordsQuery, KeywordsSort } from "@/contract/seo/keywords";
import type { ResearchMode, WebLang } from "@/contract/seo/common";

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

/** The research's default ways (the web layer's DEFAULT_MODES): left out of an address. */
export const DEFAULT_MODES: ResearchMode[] = ["plain", "questions", "modifiers", "front"];

/** What may change without sending the list back to its first page. */
const STILL = ["offset", "open", "research", "rlang", "rmodes", "serp", "slang"];
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
  if (asked.where !== "all") p.push(["where", asked.where]);
  if (asked.device !== "all") p.push(["device", asked.device]);
  if (asked.moved) p.push(["moved", asked.moved]);
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
  if (asked.open) p.push(["open", String(asked.open)]);
  if (asked.research) {
    p.push(["research", asked.research]);
    p.push(["rlang", asked.rlang]);
    if (asked.rmodes.join(",") !== DEFAULT_MODES.join(",")) p.push(["rmodes", asked.rmodes.join(",")]);
  }
  if (asked.serp) {
    p.push(["serp", asked.serp]);
    p.push(["slang", asked.slang]);
  }
  return p;
}

/**
 * The address of this screen with `change` applied. A change to a filter, the
 * order or the page size goes back to the first page of the list.
 */
export function keywordsHref(place: Place, change: Partial<KeywordsQuery> = {}): string {
  /* Opening a keyword, a research or a result page is not a filter: the list stays on its page. */
  const refilter = Object.keys(change).some((k) => !STILL.includes(k));
  const asked: KeywordsQuery = { ...place.asked, ...(refilter && !("offset" in change) ? { offset: 0 } : {}), ...change };
  if ("sort" in change && !("dir" in change)) asked.dir = firstDir(asked.sort);
  const s = new URLSearchParams(paramsOf({ asked, range: place.range })).toString();
  return s ? `${BASE}?${s}` : BASE;
}

/** Every filter back to its default, the view, the range, the country, the device and the page size kept. */
export function clearedHref(place: Place, change: Partial<KeywordsQuery> = {}): string {
  return keywordsHref(place, { ...CLEARED, ...change });
}

/** The keyword list's filters at their defaults. */
export const CLEARED: Partial<KeywordsQuery> = { lang: "all", intent: "all", cluster: "", source: "all", status: "default", band: "all", shown: false, target: false, flag: "", page: "", q: "", moved: "" };

/** The filters only the keyword list reads: switching to the topics leaves them behind (the topics read language, intent and words). */
export const KEYWORD_ONLY: Partial<KeywordsQuery> = { cluster: "", source: "all", status: "default", band: "all", shown: false, target: false, flag: "", page: "", moved: "" };

/** True when any filter is set. */
export function filtered(a: KeywordsQuery): boolean {
  return a.lang !== "all" || a.intent !== "all" || !!a.cluster || a.source !== "all" || a.status !== "default" || a.band !== "all" || a.shown || a.target || !!a.flag || !!a.page || !!a.q || !!a.moved;
}

/** The hidden fields a GET form needs to keep everything but `except` (the search box keeps the filters). */
export function keptFields(place: Place, except: string[]): [string, string][] {
  return paramsOf(place).filter(([k]) => !except.includes(k) && k !== "offset" && k !== "open");
}

/** The CSV of the list as filtered (every matching row, not only this page of it). */
export function exportHref(place: Place): string {
  const p = new URLSearchParams(paramsOf(place).filter(([k]) => !["offset", "limit", "view", ...STILL].includes(k)));
  if (!p.has("range")) p.set("range", place.range || "30d");
  return `${API}/export.csv?${p.toString()}`;
}

/** Page Optimization for one address. */
export const optimizeHref = (path: string): string => `/seo/pages/view?path=${encodeURIComponent(path)}`;

/** The topics as filtered, as CSV. */
export function clustersCsvHref(place: Place): string {
  const p = new URLSearchParams(paramsOf(place).filter(([k]) => ["range", "lang", "intent", "q", "corder", "where", "device"].includes(k)));
  return `${API}/clusters.csv${p.size ? `?${p.toString()}` : ""}`;
}

/** One keyword's own view, the list as it is. */
export const openHref = (place: Place, id: number | null): string => keywordsHref(place, { open: id });

/** The research of a phrase, as it was last researched. */
export const researchHref = (place: Place, seed: string, lang: WebLang, modes: ResearchMode[] = [...DEFAULT_MODES]): string => keywordsHref(place, { research: seed, rlang: lang, rmodes: modes });

/** Who ranks for a phrase the table does not hold. */
export const serpHref = (place: Place, phrase: string, lang: WebLang): string => keywordsHref(place, { serp: phrase, slang: lang });

/** The opportunities that name a phrase, or a cluster. */
export const oppsForPhrase = (phrase: string): string => `/seo/opportunities?keyword=${encodeURIComponent(phrase)}`;
export const oppsForCluster = (key: string): string => `/seo/opportunities?cluster=${encodeURIComponent(key)}`;

/** Where a research row or a result page leads: its own keyword view when the table holds it. */
export const rowHref = (place: Place, id: number | null, phrase: string, lang: WebLang): string => (id ? openHref(place, id) : serpHref(place, phrase, lang));

/** Close a panel the address opened (?open=, ?serp=, ?research=). */
export const closeHref = (place: Place, which: "open" | "serp" | "research"): string => keywordsHref(place, which === "open" ? { open: null } : which === "serp" ? { serp: "" } : { research: "" });
