import type { ChipTone } from "@/components/ui/Badge";
import type { IconName } from "@/components/ui/icons";
import type { BacklinksQuery, KnownLink, LinkingSite, LinkSource, LinkState, ProfileRow, ProfileState, SitesFrom, SitesSort } from "@/contract/seo/backlinks";

/**
 * How SEO › Backlinks draws what the desk gives it: the page's addresses,
 * the words of its selects, a tone per profile state, per link state and per
 * variant. No client code: server components and the page's few client
 * components both read this.
 */

export const BASE = "/seo/backlinks";

export const FROMS: SitesFrom[] = ["all", "links", "google", "visits", "ai", "views", "new"];
export const SORTS: SitesSort[] = ["visits", "links", "newest", "domain"];

export const FROM_LABEL: Record<SitesFrom, string> = {
  all: "Every source",
  links: "Links known",
  google: "In Google's export",
  visits: "Sent visitors (GA4)",
  ai: "AI assistants",
  views: "In Vercel's records",
  new: "First seen in the period",
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
  if (asked.page > 1) out.page = String(asked.page);
  if (asked.open) out.open = asked.open;
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

/** The CSV of the table as filtered (every matching row, not the page on screen), of the registry, or of every linking page. */
export function exportHref(range: string, asked: BacklinksQuery, list: "sites" | "profiles" | "links"): string {
  const { page: _page, open: _open, ...keep } = paramsOf(range, asked);
  const p = new URLSearchParams({ range: range || "30d", ...keep });
  if (list !== "sites") p.set("list", list);
  return `/api/v1/seo/backlinks/export.csv?${p.toString()}`;
}

/** Where one site's detail opens: the address keeps the filters, and the anchor brings the panel into view. */
export const OPEN_ANCHOR = "bl-open";
export const openHref = (base: Record<string, string>, host: string | null): string => hrefWith(base, { open: host ?? undefined }, host ? OPEN_ANCHOR : "bl-sites");

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

/** What the desk's own reading of a linking page found. */
export const LINK_STATE: Record<LinkState, { label: string; tone: ChipTone }> = {
  live: { label: "Links", tone: "good" },
  lost: { label: "Lost", tone: "bad" },
  waiting: { label: "No link yet", tone: "warn" },
  unreadable: { label: "Not readable", tone: "quiet" },
  "not-checked": { label: "Not read yet", tone: "quiet" },
};

/** Who says a link exists. */
export const ORIGIN_LABEL: Record<KnownLink["origins"][number], string> = {
  bing: "Bing",
  google: "Google's export",
  check: "A check",
  manual: "Followed by hand",
  ga4: "GA4 referrer",
};

/** Whose count is in the Links column. */
export const SOURCE_LABEL: Record<LinkSource, string> = {
  desk: "the desk's own reading",
  bing: "Bing's index",
  google: "Google's export",
};

/** Who saw a site first. */
export const FIRST_BY: Record<NonNullable<LinkingSite["firstSeen"]>["by"], string> = {
  bing: "Bing",
  ga4: "GA4",
  "vercel-drain": "Vercel",
  google: "Google's export",
  desk: "The desk",
};

export const FOLLOW: Record<NonNullable<NonNullable<LinkingSite["links"]>["follow"]>, { label: string; tone: ChipTone; says: string }> = {
  follow: { label: "Followed", tone: "good", says: "Every link the desk read from this site asks search engines to follow it." },
  nofollow: { label: "Nofollow", tone: "warn", says: "Every link the desk read from this site is marked nofollow, sponsored or ugc, or its page asks search engines to follow none." },
  mixed: { label: "Mixed", tone: "info", says: "Some links the desk read from this site are followed, some are marked nofollow, sponsored or ugc." },
};

/** A variant's tone: the first value is quiet, every other one stands out, so a second spelling is seen. Against an agreed value: same is good, different is bad. */
const VARIANT_TONES: ChipTone[] = ["quiet", "warn", "violet", "info", "bad"];
export const variantTone = (variant: string, only: boolean, match: boolean | null = null): ChipTone =>
  match === true ? "good" : match === false ? "bad" : only ? "good" : (VARIANT_TONES[(variant.charCodeAt(0) - 65) % VARIANT_TONES.length] ?? "quiet");

/** An owner task's title, without the "in this order: 1" a numbered step leaves at the end of its first sentence. */
export const taskTitle = (title: string): string => title.replace(/(,\s*in this order)?:\s*\d+\.?$/i, "").replace(/:\s*-\s.*$/, "");

/** The anchor of a task in "Needs you". */
export const taskAnchor = (id: string): string => `bl-task-${id}`;

/** A link's host and path, short, for a cell. */
export const shortUrl = (url: string): string => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
