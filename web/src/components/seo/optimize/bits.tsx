import type { ChipTone } from "@/components/ui/Badge";
import type { Priority, Rate } from "@/contract/seo/common";
import { cx } from "@/lib/cx";
import { DASH, num, percent } from "@/lib/format";

/**
 * Small things Page Optimization's parts share: its addresses, how a rate is
 * printed, the priority chip. No client code and no server-only code, so a
 * server component and a client component can both import it.
 */

/** The tabs of the page in the middle (board 115), in order. */
export const OPTIMIZE_TABS = ["overview", "optimize", "keywords", "content", "links", "technical", "performance"] as const;
export type OptimizeTab = (typeof OPTIMIZE_TABS)[number];
export const isTab = (v: string | undefined): v is OptimizeTab => !!v && (OPTIMIZE_TABS as readonly string[]).includes(v);

/**
 * The address of one page on this screen. It keeps the period only when one
 * was chosen (`range`, as the address had it) and the tab only when it is not
 * the Overview, so the plain address stays plain.
 */
export function optimizeHref(path: string, range: string | null, tab: OptimizeTab = "overview"): string {
  /* The address's slashes stay readable: /seo/pages/view?path=/logistics. */
  let q = `path=${encodeURIComponent(path).replace(/%2F/gi, "/")}`;
  if (range) q += `&range=${encodeURIComponent(range)}`;
  if (tab !== "overview") q += `&tab=${tab}`;
  return `/seo/pages/view?${q}`;
}

/**
 * A rate as the desk prints it: "12.4%", or, from fewer than 30 events, its
 * two counts ("3 of 23"), because a percentage of a handful is noise.
 */
export function rateText(r: Rate | null | undefined): string {
  if (!r) return DASH;
  if (r.small || r.value === null) return r.den ? `${num(r.num)} of ${num(r.den)}` : DASH;
  return percent(r.value, Math.abs(r.value) < 10 ? 2 : 1);
}

/** The board's colours: high red, medium amber, low green. */
export const PRIORITY_TONE: Record<Priority, ChipTone> = { high: "bad", medium: "warn", low: "good" };
export const PRIORITY_WORD: Record<Priority, string> = { high: "High", medium: "Medium", low: "Low" };

/** A priority as the board's outlined chip. */
export function PriorityChip({ priority, className }: { priority: Priority; className?: string }) {
  return (
    <span className={cx("dk-seo-optimize-prio", `dk-tone-${PRIORITY_TONE[priority]}`, className)}>
      {PRIORITY_WORD[priority]}
      <span className="dk-sr"> priority</span>
    </span>
  );
}

/** Plural by count: "1 page", "3 pages". */
export const plural = (n: number, one: string, many = `${one}s`): string => `${num(n)} ${n === 1 ? one : many}`;

/** A score's tone by the bands the server states (90 good, 70 fair, 50 needs work). */
export const scoreTone = (score: number | null): ChipTone => (score === null ? "quiet" : score >= 90 ? "good" : score >= 50 ? "warn" : "bad");

/** "/how-to-get-more-clients" without the leading slash's company: the home page is named. */
export const pathLabel = (path: string): string => (path === "/" ? "/ (home page)" : path);
