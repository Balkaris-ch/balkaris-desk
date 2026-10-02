import type { ChipTone } from "@/components/ui/Badge";
import type { IconName } from "@/components/ui/icons";
import type { Priority } from "@/contract/seo/common";
import type { GapQuery, GapTab, GapView } from "@/contract/seo/content-gaps";
import type { Intent, KeywordSource } from "@/contract/seo/keywords";
import { DASH, num, percent } from "@/lib/format";

/**
 * What the Content Gaps page's parts share: its address and how a link
 * changes it, the words and tones of a priority, an intent and a source,
 * and how a coverage is printed.
 */

export const BASE = "/seo/content-gaps";

/** The rows a table shows unless asked (the server's own default). */
export const LIMIT = 12;

export const VIEW_ICON: Record<GapView, IconName> = {
  topic: "layers",
  industry: "users",
  language: "globe",
  clusters: "grid",
  keywords: "search",
  competitors: "target",
};

/** The head of the coverage list, as board 113 writes "INDUSTRY COVERAGE". */
export const LIST_HEAD: Partial<Record<GapView, string>> = {
  topic: "Topic coverage",
  industry: "Industry coverage",
  language: "Language coverage",
  clusters: "Cluster coverage",
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

/** The query as the address carries it: defaults left out. */
export function paramsOf(q: GapQuery, range: string | undefined): Record<string, string> {
  const p: Record<string, string> = {};
  if (range && range !== "30d") p.range = range;
  if (q.view !== "topic") p.view = q.view;
  if (q.open) p.open = q.open;
  if (q.tab !== "missing") p.tab = q.tab;
  if (q.lang !== "all") p.lang = q.lang;
  if (q.price) p.price = "1";
  if (q.question) p.question = "1";
  if (q.gap !== "all") p.gap = q.gap;
  if (q.priority !== "all") p.priority = q.priority;
  if (q.cluster) p.cluster = q.cluster;
  if (q.offset) p.offset = String(q.offset);
  if (q.limit !== LIMIT) p.limit = String(q.limit);
  return p;
}

/** This page with some params changed; null or "" takes one away. */
export function hrefWith(base: Record<string, string>, change: Record<string, string | null | undefined>): string {
  const p = new URLSearchParams(base);
  for (const [k, v] of Object.entries(change)) {
    if (v === null || v === undefined || v === "") p.delete(k);
    else p.set(k, v);
  }
  const s = p.toString();
  return s ? `${BASE}?${s}` : BASE;
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
