import type { ChipTone } from "@/components/ui/Badge";
import type { IconName } from "@/components/ui/icons";
import type { BacklinksQuery, LinkingSite, ProfileRow, ProfileState, SitesFrom, SitesSort } from "@/contract/seo/backlinks";

/**
 * How SEO › Backlinks draws what the desk gives it: the page's addresses,
 * the words of its selects, a tone per profile state and per variant. No
 * client code: server components and the page's few client components both
 * read this.
 */

export const BASE = "/seo/backlinks";

export const FROM_LABEL: Record<SitesFrom, string> = {
  all: "Every source",
  links: "Links Bing knows",
  visits: "Sent visitors (GA4)",
  ai: "AI assistants",
  views: "In Vercel's records",
};

export const SORT_LABEL: Record<SitesSort, string> = {
  visits: "Most visits",
  links: "Most links",
  newest: "Newest first",
  domain: "By name",
};

/** The search params this page reads besides the head's range, without the defaults. */
export function paramsOf(range: string, asked: BacklinksQuery, more: Record<string, string | undefined> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  if (range && range !== "30d") out.range = range;
  if (asked.q) out.q = asked.q;
  if (asked.from !== "all") out.from = asked.from;
  if (asked.sort !== "visits") out.sort = asked.sort;
  for (const [k, v] of Object.entries(more)) if (v) out[k] = v;
  return out;
}

export function hrefWith(base: Record<string, string>, change: Record<string, string | undefined>, hash?: string): string {
  const p = new URLSearchParams(base);
  for (const [k, v] of Object.entries(change)) {
    if (v === undefined || v === "") p.delete(k);
    else p.set(k, v);
  }
  const s = p.toString();
  return `${BASE}${s ? `?${s}` : ""}${hash ? `#${hash}` : ""}`;
}

/** The CSV of the table as filtered, or of the registry. */
export function exportHref(range: string, asked: BacklinksQuery, list: "sites" | "profiles"): string {
  const p = new URLSearchParams({ range: range || "30d", ...paramsOf(range, asked) });
  if (list === "profiles") p.set("list", "profiles");
  return `/api/v1/seo/backlinks/export.csv?${p.toString()}`;
}

export const STATE_LABEL: Record<ProfileState, string> = {
  exists: "Exists",
  "not-found": "Not found",
  unknown: "Not readable",
  "not-checked": "Not checked",
};

export const STATE_TONE: Record<ProfileState, ChipTone> = {
  exists: "good",
  "not-found": "bad",
  unknown: "warn",
  "not-checked": "quiet",
};

export const KIND_LABEL: Record<ProfileRow["kind"], string> = {
  website: "Website",
  listing: "Map listing",
  social: "Social",
  directory: "Directory",
  register: "Register",
};

export const KIND_ICON: Record<ProfileRow["kind"], IconName> = {
  website: "globe",
  listing: "map-pin",
  social: "users",
  directory: "list",
  register: "file-text",
};

export const SITE_KIND: Record<LinkingSite["kind"], { label: string; tone: ChipTone }> = {
  ai: { label: "AI assistant", tone: "violet" },
  profile: { label: "Your profile", tone: "info" },
  site: { label: "Site", tone: "quiet" },
};

/** A variant's tone: the first value is quiet, every other one stands out, so a second spelling is seen. */
const VARIANT_TONES: ChipTone[] = ["quiet", "warn", "violet", "info", "bad"];
export const variantTone = (variant: string, only: boolean): ChipTone => (only ? "good" : (VARIANT_TONES[(variant.charCodeAt(0) - 65) % VARIANT_TONES.length] ?? "quiet"));

/** An owner task's title, without the "in this order: 1" a numbered step leaves at the end of its first sentence. */
export const taskTitle = (title: string): string => title.replace(/(,\s*in this order)?:\s*\d+\.?$/i, "").replace(/:\s*-\s.*$/, "");

/** The anchor of a task in "Needs you". */
export const taskAnchor = (id: string): string => `bl-task-${id}`;
