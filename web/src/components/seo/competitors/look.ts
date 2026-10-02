import type { ChipTone } from "@/components/ui/Badge";
import type { IconName } from "@/components/ui/icons";
import type { Priority } from "@/contract/seo/common";
import type { CompetitorsAsked, Sighting, TaskRef } from "@/contract/seo/competitors";
import { DASH, fullDate, num } from "@/lib/format";

/**
 * How SEO › Competitors draws what the desk gives it: its address and links,
 * the words for an observation, a tone per priority. No client code: the
 * page's server components and its two buttons both read this.
 */

export const BASE = "/seo/competitors";

/** The page's search params as the server applied them, as a flat record for links. */
export function paramsOf(asked: CompetitorsAsked, range: string, extra: Record<string, string | undefined> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  if (range !== "30d") out.range = range;
  if (asked.engine !== "all") out.engine = asked.engine;
  if (asked.type !== "all") out.type = asked.type;
  if (asked.cluster) out.cluster = asked.cluster;
  if (asked.q) out.q = asked.q;
  if (asked.sort !== "seen") out.sort = asked.sort;
  if (asked.offset) out.offset = String(asked.offset);
  if (asked.limit !== 15) out.limit = String(asked.limit);
  if (asked.open) out.open = asked.open;
  for (const [k, v] of Object.entries(extra)) if (v) out[k] = v;
  return out;
}

/**
 * This page with some params changed; `undefined` or "" removes one. A change
 * to the list's filters drops the paging and the one in detail, so the list's
 * first row is shown.
 */
export function hrefWith(base: Record<string, string>, change: Record<string, string | undefined | null>): string {
  const next = new URLSearchParams(base);
  const filters = ["engine", "type", "cluster", "q", "sort", "limit"];
  if (Object.keys(change).some((k) => filters.includes(k))) {
    next.delete("offset");
    next.delete("open");
  }
  for (const [k, v] of Object.entries(change)) {
    if (v === undefined || v === null || v === "") next.delete(k);
    else next.set(k, v);
  }
  const q = next.toString();
  return q ? `${BASE}?${q}` : BASE;
}

/** "name:Example Studio" → "Example Studio"; a host stays a host. */
export const shownName = (domain: string, name: string | null): string => name ?? (domain.startsWith("name:") ? domain.slice(5) : domain);

/** The host, or "named without a site". */
export const shownHost = (domain: string): string | null => (domain.startsWith("name:") ? null : domain);

/** An observation in a few words: "organic 3", "map pack 2", "named", "cited". */
export function seenAs(s: Pick<Sighting, "kind" | "position">): string {
  switch (s.kind) {
    case "organic":
      return s.position !== null ? `#${s.position}` : "in the results";
    case "local-pack":
      return s.position !== null ? `map pack #${s.position}` : "map pack";
    case "named":
      return "named";
    default:
      return "cited";
  }
}

export const KIND_LABEL: Record<Sighting["kind"], string> = {
  organic: "Organic result",
  "local-pack": "Google map pack",
  named: "Named in the answer",
  cited: "Cited as a source",
};

/** Who made an observation, as the person reading wants it said. */
export function byLabel(by: string): string {
  if (by === "audit") return "the SEO audit, in the owner's Chrome";
  if (by === "lead-chrome") return "the lead, in the owner's Chrome";
  if (by === "api") return "an API";
  return by;
}

/** The engine's mark in a list. */
export function engineIcon(engine: string): IconName {
  if (engine === "google") return "search";
  if (engine === "google-local") return "map-pin";
  return "sparkles";
}

export const PRIORITY_TONE: Record<Priority, ChipTone> = { high: "bad", medium: "warn", low: "quiet" };
export const PRIORITY_LABEL: Record<Priority, string> = { high: "High", medium: "Medium", low: "Low" };

/** A day as a table writes it. */
export const day = (d: string | null | undefined): string => (d ? fullDate(d) : DASH);

/** "1 page", "4 pages". */
export const count = (n: number, one: string, many = `${one}s`): string => `${num(n)} ${n === 1 ? one : many}`;

/** A language as a short chip: "DE", "EN", "FR". */
export const langChip = (lang: string | null): string => (lang ? lang.split("-")[0]!.toUpperCase() : "?");

/** Whose step a task is, in words. */
export function taskWho(t: TaskRef): string {
  switch (t.who) {
    case "owner":
      return "Needs you";
    case "lead-chrome":
      return "Needs you (in your browser)";
    case "code":
      return "Website code";
    default:
      return "Content";
  }
}

/** An external address the desk shows as a link, only when it is https or http. */
export const safeHref = (url: string | null | undefined): string | null => (url && /^https?:\/\//i.test(url) ? url : null);

/** "https://example-studio.ch/services/web" → "example-studio.ch/services/web". */
export const shortUrl = (url: string): string => url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
