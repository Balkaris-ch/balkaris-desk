import type { ChipTone } from "@/components/ui/Badge";
import type { IconName } from "@/components/ui/icons";
import type { Priority } from "@/contract/seo/common";
import type { GapQuery, GapSort, GapTab, GapView } from "@/contract/seo/content-gaps";
import type { Intent, KeywordSource } from "@/contract/seo/keywords";
import { DASH, num, percent } from "@/lib/format";

/**
 * What the Content Gaps page's parts share: its address and how a link
 * changes it, the words and tones of a priority, an intent and a source,
 * and how a coverage is printed.
 */

export const BASE = "/seo/content-gaps";
export const API = "/api/v1/seo/content-gaps";

/** The rows a table shows unless asked (the server's own default). */
export const LIMIT = 12;
/** The sizes a paged table offers; the server takes any from 5 to 200. */
export const LIMITS = [12, 50, 200] as const;

/** The id of the search box's own form (a GET form outside the tables' forms: forms do not nest). */
export const FIND = "dk-seo-gaps-find";

/**
 * The id of the page's one list of the site's addresses (page.tsx draws it),
 * offered by every "which page" field. Here and not in Act.tsx: a server
 * component that imports a value from a "use client" file gets a reference,
 * not the string.
 */
export const PAGES_LIST = "dk-seo-gaps-pages";

/** The params the search box's form carries over: the view and its filters, not the place in it. */
export const FIND_KEEPS = ["range", "view", "tab", "lang", "price", "question", "gap", "priority", "sort", "dir", "limit"] as const;

export const VIEW_ICON: Record<GapView, IconName> = {
  topic: "layers",
  industry: "users",
  language: "globe",
  clusters: "grid",
  keywords: "search",
  console: "line-chart",
  competitors: "target",
};

/** The views whose page is the coverage list with the open group beside it. */
export const LISTED: readonly GapView[] = ["topic", "industry", "language", "clusters"];

/** The head of the coverage list, as board 113 writes "INDUSTRY COVERAGE". */
export const LIST_HEAD: Partial<Record<GapView, string>> = {
  topic: "Topic coverage",
  industry: "Industry coverage",
  language: "Language coverage",
  clusters: "Cluster coverage",
};

/** What a search looks through, by the view: the placeholder of the search box. */
export const FIND_HINT: Record<GapView, string> = {
  topic: "Search topics and their phrases…",
  industry: "Search industries and their phrases…",
  language: "Search phrases…",
  clusters: "Search clusters and their phrases…",
  keywords: "Search phrases and clusters…",
  console: "Search the searches Google reports…",
  competitors: "Search sites, names and page titles…",
};

export const TAB_LABEL: Record<GapTab, string> = {
  missing: "Missing",
  partial: "Partly answered",
  suggested: "Suggested pages",
  competitors: "Competitors",
};

export const PRIORITY_TONE: Record<Priority, ChipTone> = { high: "bad", medium: "warn", low: "quiet" };
export const PRIORITY_WORD: Record<Priority, string> = { high: "High", medium: "Medium", low: "Low" };

export const INTENT_TONE: Record<Intent, ChipTone> = {
  commercial: "info",
  transactional: "good",
  informational: "violet",
  local: "warn",
  navigational: "quiet",
};
export const INTENT_WORD: Record<Intent, string> = {
  commercial: "Commercial",
  transactional: "Transactional",
  informational: "Informational",
  local: "Local",
  navigational: "Navigational",
};

export const SOURCE_WORD: Record<KeywordSource, string> = { gsc: "Search Console", autocomplete: "Autocomplete", audit: "Audit", manual: "Added by hand" };
export const SOURCE_TIP: Record<KeywordSource, string> = {
  gsc: "Google showed the site for it (Search Console).",
  autocomplete: "Google Autocomplete completes it: people search it. Not how often.",
  audit: "In the SEO audit's keyword table (2 Oct 2026).",
  manual: "A person added it.",
};

/** The way a column runs when it is first chosen (the server's own rule): figures from the most, names from A, a position from the best. */
export const FIRST_DIR: Record<GapSort, "asc" | "desc"> = { impressions: "desc", phrase: "asc", cluster: "asc", priority: "desc", "first-seen": "desc", position: "asc", seen: "desc", words: "desc", domain: "asc" };

/** The query as the address carries it: defaults left out. */
export function paramsOf(q: GapQuery, range: string | undefined): Record<string, string> {
  const p: Record<string, string> = {};
  if (range && range !== "30d") p.range = range;
  if (q.view !== "topic") p.view = q.view;
  if (q.open) p.open = q.open;
  if (q.tab !== "missing") p.tab = q.tab;
  if (q.q) p.q = q.q;
  if (q.lang !== "all") p.lang = q.lang;
  if (q.price) p.price = "1";
  if (q.question) p.question = "1";
  if (q.gap !== "all") p.gap = q.gap;
  if (q.priority !== "all") p.priority = q.priority;
  if (q.sort) {
    p.sort = q.sort;
    if (q.dir !== FIRST_DIR[q.sort]) p.dir = q.dir;
  }
  if (q.cluster) p.cluster = q.cluster;
  if (q.offset) p.offset = String(q.offset);
  if (q.limit !== LIMIT) p.limit = String(q.limit);
  return p;
}

const withChange = (base: Record<string, string>, change: Record<string, string | null | undefined>): string => {
  const p = new URLSearchParams(base);
  for (const [k, v] of Object.entries(change)) {
    if (v === null || v === undefined || v === "") p.delete(k);
    else p.set(k, v);
  }
  return p.toString();
};

/** This page with some params changed; null or "" takes one away. */
export function hrefWith(base: Record<string, string>, change: Record<string, string | null | undefined>): string {
  const s = withChange(base, change);
  return s ? `${BASE}?${s}` : BASE;
}

/**
 * Another place on this page: only the period is carried over, then the
 * params given. For a link that leaves the view it is drawn in ("German
 * gaps", "Start with"), where the filters of this view would mean nothing.
 */
export function hrefFresh(base: Record<string, string>, to: Record<string, string>): string {
  return hrefWith(base.range ? { range: base.range } : {}, to);
}

/** The CSV of the table the address shows: the same filters, search and order, without the paging. */
export function exportHref(base: Record<string, string>, change: Record<string, string | null | undefined> = {}): string {
  const s = withChange(base, { offset: null, limit: null, cluster: null, ...change });
  return s ? `${API}/export.csv?${s}` : `${API}/export.csv`;
}

/**
 * The link of a column's head in a table the server orders: the first press
 * orders by the column its own way, the next turns it round. `on` is the
 * column the rows are ordered by now (the table's own first column when the
 * address names none).
 */
export function sortHref(base: Record<string, string>, asked: GapQuery, key: GapSort, on: boolean): string {
  const dir = on ? (asked.dir === "asc" ? "desc" : "asc") : FIRST_DIR[key];
  return hrefWith(base, { sort: key, dir: dir === FIRST_DIR[key] ? null : dir, offset: null });
}

/**
 * A coverage as the desk prints it: "12 of 40" always, and the percentage
 * beside it only from 30 phrases up: a share of a handful is noise.
 */
export function coverText(covered: number, of: number): { main: string; share: string | null } {
  if (!of) return { main: DASH, share: null };
  return { main: `${num(covered)} of ${num(of)}`, share: of >= 30 ? percent((covered / of) * 100, 0) : null };
}

/** The bar's tone: none answered is the gap, some answered is partial. */
export const coverTone = (covered: number, of: number): ChipTone => (!of ? "quiet" : covered === 0 ? "bad" : covered / of < 0.6 ? "warn" : "good");

/** A cluster's name without the "(DE)" the audit put after it: the language has its own mark. */
export const bare = (name: string): string => name.replace(/\s*\((DE|EN)\)$/i, "");

export const plural = (n: number, one: string, many = `${one}s`): string => `${num(n)} ${n === 1 ? one : many}`;

/** A share of a whole, for the two big cards: "40%" from 30 up, else "3 of 14". */
export function shareText(part: number, whole: number): string {
  if (!whole) return DASH;
  return whole >= 30 ? percent((part / whole) * 100, 0) : `${num(part)} of ${num(whole)}`;
}

/** An address of another site as its path alone, for a narrow cell: "/preise" and "/" for a home page. */
export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return url;
  }
}

/** Page Optimization for one of the site's own addresses. */
export const pageHref = (path: string): string => `/seo/pages/view?path=${encodeURIComponent(path)}`;
