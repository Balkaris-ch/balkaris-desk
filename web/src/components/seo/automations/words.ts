import type { SeoJobState } from "@/contract/seo/automations";
import { STATE } from "@/components/automations/words";
import type { ChipTone } from "@/components/ui/Badge";
import type { IconName } from "@/components/ui/icons";
import { clock, feedTime } from "@/lib/format";

/**
 * How SEO › Automations says things. Plain functions and tables, so the
 * server's components and the browser's print a job the same way. A job's
 * state words and a run's length are the desk-wide Automations screen's own
 * (components/automations/words.ts), so the two screens never disagree; this
 * tab adds one word, "Late".
 */

/** The board's schedule column: "Every 15 min", "Every 6 hours", "Daily", "Weekly". */
export function scheduleText(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s % (7 * 86_400) === 0) return s === 7 * 86_400 ? "Weekly" : `Every ${s / (7 * 86_400)} weeks`;
  if (s % 86_400 === 0) return s === 86_400 ? "Daily" : `Every ${s / 86_400} days`;
  if (s % 3600 === 0) return s === 3600 ? "Hourly" : `Every ${s / 3600} hours`;
  if (s % 60 === 0) return s === 60 ? "Every minute" : `Every ${s / 60} min`;
  return `Every ${s} s`;
}

/**
 * A job's state as a word and a tone: the desk-wide words, and "Late" for a
 * job that is on and ready and more than ten minutes past its time without a
 * start. Amber, not red: nothing failed, but nothing new came in either.
 */
export const SEO_STATE: Record<SeoJobState, { label: string; tone: ChipTone }> = {
  ...STATE,
  late: { label: "Late", tone: "warn" },
};

/** The icon beside each job, by what it does. A job not named here gets the clock. */
export const JOB_ICON: Record<string, IconName> = {
  "seo-snapshot": "line-chart",
  "seo-engine": "lightbulb",
  "seo-readiness": "robot",
  "seo-referrals": "users",
  "seo-research": "tag",
  "seo-competitors": "target",
  "seo-presence": "map-pin",
  "seo-backlinks": "link",
  "seo-rank-check": "bar-chart",
  "seo-digest": "file-text",
  crawl: "file-text",
  sitemap: "sitemap",
  "gsc-daily": "search",
  "gsc-inspect": "eye",
  speed: "gauge",
  "crux-daily": "heart-pulse",
  "bing-daily": "link",
};

/**
 * Where on the desk each job's results are seen, for "What it found" in the
 * opened row. Each address is a page of the SEO section that reads what the
 * job writes; a job not named here has no such place of its own.
 */
export const SHOWN_ON: Record<string, { href: string; label: string }> = {
  "seo-snapshot": { href: "/seo/search-console", label: "Search Console" },
  "seo-engine": { href: "/seo/opportunities", label: "Opportunities" },
  "seo-readiness": { href: "/seo/ai-search", label: "AI Search" },
  "seo-referrals": { href: "/seo/ai-search", label: "AI Search" },
  "seo-research": { href: "/seo/keywords?source=autocomplete&sort=first-seen", label: "Keywords, newest from Autocomplete first" },
  "seo-competitors": { href: "/seo/competitors", label: "Competitors" },
  "seo-presence": { href: "/seo/backlinks", label: "Backlinks, profiles and listings" },
  "seo-backlinks": { href: "/seo/backlinks", label: "Backlinks" },
  "seo-rank-check": { href: "/seo/competitors", label: "Competitors" },
  "seo-digest": { href: "/seo/automations#digest", label: "The week, in short, on this page" },
  crawl: { href: "/seo/technical", label: "Technical" },
  sitemap: { href: "/seo/technical", label: "Technical" },
  "gsc-daily": { href: "/seo/search-console", label: "Search Console" },
  "gsc-inspect": { href: "/seo/technical#indexing", label: "Technical, indexing" },
  speed: { href: "/seo/technical", label: "Technical" },
  "crux-daily": { href: "/seo/technical", label: "Technical" },
  "bing-daily": { href: "/seo/backlinks", label: "Backlinks" },
};

/** The two groups of the table, in order. */
export const GROUPS: { key: "seo" | "desk"; title: string; sub: string }[] = [
  { key: "seo", title: "The SEO engine", sub: "Its own jobs: the search history, the opportunities, AI readiness, referrals, research, competitors and profiles." },
  { key: "desk", title: "Desk jobs the SEO section reads", sub: "The desk's own collectors, shared with the other screens." },
];

/** "a run", "3 runs". */
export const runs = (n: number): string => `${n.toLocaleString("en-GB")} run${n === 1 ? "" : "s"}`;

/** "13:32" today, "Yesterday 13:32", "30 Sep 13:32": a moment, by the studio's clock, counted from the page's own time. */
export const when = (iso: string, at: string): string => {
  const day = feedTime(iso, at);
  return day === clock(iso) ? day : `${day} ${clock(iso)}`;
};

/** Why the watch asked for a job, as the log and the card say it. */
export const ASK_WHY: Record<"late" | "retry" | "again", string> = {
  late: "late",
  retry: "trying a failed run again",
  again: "running again after a restart cut it off",
};

/** The export of the period's runs (GET /api/v1/seo/automations/export.csv): the address, built in one place. */
export const exportHref = (range: string): string => `/api/v1/seo/automations/export.csv?range=${encodeURIComponent(range)}`;

/** This tab with one job's row opened: the address the log's lines and other tabs link to. */
export const jobHref = (name: string, range?: string): string => {
  const p = new URLSearchParams();
  if (range && range !== "30d") p.set("range", range);
  p.set("open", name);
  return `/seo/automations?${p.toString()}`;
};
