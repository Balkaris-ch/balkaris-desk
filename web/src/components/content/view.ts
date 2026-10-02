import type { Range } from "@/contract/common";
import { duration, num, parseRange, RANGES } from "@/lib/format";

/**
 * What the Content screen's address says: the range, the specimen switch,
 * which view a panel with tabs is on, and which panels are opened in full.
 * Every tab, "Show all" and the range switch is a link that changes one of
 * these, so the server draws the view and the back button works.
 */
export interface ContentView {
  range: Range;
  specimen: boolean;
  /** Titles and descriptions: which field. */
  meta: "all" | "title" | "description";
  /** Freshness: articles or pages. */
  fresh: "articles" | "pages";
  /** Panels shown in full instead of their first rows. */
  open: ReadonlySet<Panel>;
  /** What "Run the crawl now" answered, as a code and when it was asked, sent back through the address by the server action. */
  crawl: { said: CrawlSaid; at: number } | null;
}

export type Panel = "meta" | "thin" | "eng" | "fresh" | "img" | "links";

/** The answers "Run the crawl now" can bring back (actions.ts). Only these: the screen words them itself. */
export const CRAWL_SAID = ["asked", "recent", "off", "out", "down", "failed"] as const;
export type CrawlSaid = (typeof CRAWL_SAID)[number];

/** "recent.1759400000000" → { said: "recent", at: 1759400000000 }; anything else is ignored. */
function readCrawl(v: string | undefined): ContentView["crawl"] {
  const m = /^([a-z]+)\.(\d{12,14})$/.exec(v ?? "");
  if (!m) return null;
  const said = CRAWL_SAID.find((s) => s === m[1]);
  return said ? { said, at: Number(m[2]) } : null;
}

type Search = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export function readView(sp: Search): ContentView {
  const meta = one(sp.meta);
  const panels: Panel[] = ["meta", "thin", "eng", "fresh", "img", "links"];
  return {
    range: parseRange(sp.range, RANGES, "30d"),
    specimen: one(sp.specimen) === "1",
    meta: meta === "title" || meta === "description" ? meta : "all",
    fresh: one(sp.fresh) === "pages" ? "pages" : "articles",
    open: new Set((one(sp.all) ?? "").split(",").filter((p): p is Panel => (panels as string[]).includes(p))),
    crawl: readCrawl(one(sp.crawl)),
  };
}

/** This screen's address with one thing changed; the crawl's answer is never carried on. */
export function hrefFor(v: ContentView, change: Partial<Omit<ContentView, "open" | "crawl">> & { toggle?: Panel } = {}, hash?: string): string {
  const next = { ...v, ...change };
  const open = new Set(v.open);
  if (change.toggle) {
    if (open.has(change.toggle)) open.delete(change.toggle);
    else open.add(change.toggle);
  }
  const q = new URLSearchParams();
  if (next.range !== "30d") q.set("range", next.range);
  if (next.specimen) q.set("specimen", "1");
  if (next.meta !== "all") q.set("meta", next.meta);
  if (next.fresh !== "articles") q.set("fresh", next.fresh);
  if (open.size) q.set("all", [...open].sort().join(","));
  const s = q.toString();
  return `/content${s ? `?${s}` : ""}${hash ? `#${hash}` : ""}`;
}

/** "today", "1 day", "12 days", "3 months". */
export function age(days: number | null): string {
  if (days === null) return "—";
  if (days === 0) return "today";
  if (days < 60) return `${days} day${days === 1 ? "" : "s"}`;
  const months = Math.round(days / 30.4);
  if (months < 24) return `${months} months`;
  return `${Math.round(days / 365)} years`;
}

/** Seconds as a person says them: "45s", "2m 05s". */
export const seconds = (s: number): string => duration(s * 1000);

/** "33 / 33". */
export const part = (n: number, of: number): string => `${num(n)} / ${num(of)}`;

/** A page's path, shortened in the middle when it would not fit a cell. */
export function shortPath(path: string, max = 46): string {
  if (path.length <= max) return path;
  const keep = max - 1;
  return `${path.slice(0, Math.ceil(keep * 0.6))}…${path.slice(path.length - Math.floor(keep * 0.4))}`;
}
