import type { PageState, PageType } from "@/contract/pages";

/**
 * What the Pages table can be asked to show, as its address says it. Shared by
 * the server page (which reads the address) and the table (which writes it),
 * so it is a plain module, not a client one.
 */

export const TABS = [
  { key: "all", label: "All pages" },
  { key: "service", label: "Services" },
  { key: "segment", label: "Industries" },
  { key: "insights", label: "Insights" },
  { key: "landing", label: "Landing pages" },
  { key: "new", label: "New pages" },
  { key: "attention", label: "Needs attention" },
] as const;
export type Tab = (typeof TABS)[number]["key"];

/** The lists the bottom panels and the Filters' last field open. Each is a stated rule (contract/pages.ts, PageFlags). */
export const SHOWS = [
  { key: "route", label: "Route issues: redirects and errors" },
  { key: "metadata", label: "Metadata issues" },
  { key: "picture", label: "On the default share picture" },
  { key: "meta", label: "Missing or long title or description" },
  { key: "schema", label: "No structured data" },
  { key: "orphan", label: "Orphan pages" },
  { key: "drafts", label: "Drafts: kept out of search" },
  { key: "top", label: "Top performers" },
] as const;
export type Show = (typeof SHOWS)[number]["key"];

export const ISSUES = [
  { key: "any", label: "Has a critical issue or a warning" },
  { key: "critical", label: "Has a critical issue" },
  { key: "none", label: "No critical issue or warning" },
] as const;
export type IssueFilter = (typeof ISSUES)[number]["key"];

export interface Filters {
  tab: Tab;
  q: string;
  status: PageState | "";
  type: PageType | "";
  issues: IssueFilter | "";
  show: Show | "";
}

const STATE_KEYS: readonly PageState[] = ["live", "noindex", "redirect", "error"];
const TYPE_KEYS: readonly PageType[] = ["home", "service", "segment", "article", "insights", "landing", "case", "legal", "standard"];

/** The filters an address asks for; anything unknown is no filter. */
export function filtersOf(get: (name: string) => string | undefined): Filters {
  const pick = <T extends string>(v: string | undefined, list: readonly T[]): T | "" => list.find((x) => x === v) ?? "";
  return {
    tab: pick(get("tab"), TABS.map((t) => t.key)) || "all",
    q: (get("q") ?? "").slice(0, 120),
    status: pick(get("status"), STATE_KEYS),
    type: pick(get("type"), TYPE_KEYS),
    issues: pick(get("issues"), ISSUES.map((i) => i.key)),
    show: pick(get("show"), SHOWS.map((s) => s.key)),
  };
}
