import type { IconName } from "@/components/ui/icons";

/**
 * How SEO › Automations says things. Plain functions and tables, so the
 * server's components and the browser's print a job the same way. A job's
 * state words and a run's length are the desk-wide Automations screen's own
 * (components/automations/words.ts), so the two screens never disagree.
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

/** The icon beside each job, by what it does. A job not named here gets the clock. */
export const JOB_ICON: Record<string, IconName> = {
  "seo-snapshot": "line-chart",
  "seo-engine": "lightbulb",
  "seo-readiness": "robot",
  "seo-referrals": "users",
  "seo-research": "tag",
  "seo-competitors": "target",
  "seo-presence": "map-pin",
  crawl: "file-text",
  sitemap: "sitemap",
  "gsc-daily": "search",
  "gsc-inspect": "eye",
  speed: "gauge",
  "bing-daily": "link",
};

/** The two groups of the table, in order. */
export const GROUPS: { key: "seo" | "desk"; title: string; sub: string }[] = [
  { key: "seo", title: "The SEO engine", sub: "Its own jobs: the search history, the opportunities, AI readiness, referrals, research, competitors and profiles." },
  { key: "desk", title: "Desk jobs the SEO section reads", sub: "The desk's own collectors, shared with the other screens." },
];

/** "a run", "3 runs". */
export const runs = (n: number): string => `${n.toLocaleString("en-GB")} run${n === 1 ? "" : "s"}`;
