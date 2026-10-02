import type { ChipTone } from "@/components/ui/Badge";
import type { OpportunityType, Priority, Rate } from "@/contract/seo/common";
import { cx } from "@/lib/cx";
import { DASH, num, percent } from "@/lib/format";
import "./overview.css";

/**
 * Small things the Overview's panels share: how a rate is printed, the
 * priority mark, the tone of an opportunity's type.
 */

/**
 * A rate as the desk prints it: "12.4%", or, on fewer than 30 events, its two
 * counts ("3 of 23"), because a percentage of a handful is noise.
 */
export function rateText(r: Rate): string {
  if (r.small || r.value === null) return r.den ? `${num(r.num)} of ${num(r.den)}` : DASH;
  return percent(r.value, Math.abs(r.value) < 10 ? 2 : 1);
}

export const PRIORITY_TONE: Record<Priority, ChipTone> = { high: "bad", medium: "warn", low: "quiet" };
export const PRIORITY_WORD: Record<Priority, string> = { high: "High", medium: "Medium", low: "Low" };

export const TYPE_TONE: Record<OpportunityType, ChipTone> = {
  "not-indexed": "bad",
  "near-page-one": "info",
  "low-ctr": "info",
  "ranking-drop": "bad",
  "keyword-gap": "violet",
  "german-missing": "violet",
  "thin-content": "warn",
  "missing-answer": "warn",
  technical: "warn",
  "internal-links": "warn",
  entity: "quiet",
};

/** A priority as a dot and its word. */
export function PriorityMark({ priority, className }: { priority: Priority; className?: string }) {
  return (
    <span className={cx("dk-seo-overview-prio", `dk-tone-${PRIORITY_TONE[priority]}`, className)}>
      <span className="dk-seo-overview-prio-dot" aria-hidden />
      {PRIORITY_WORD[priority]}
      <span className="dk-sr"> priority</span>
    </span>
  );
}

/** "de" / "en" as a small mark beside a phrase. */
export function LangMark({ lang }: { lang: string | null }) {
  if (!lang) return null;
  return <span className={cx("dk-seo-overview-lang", lang === "de" && "dk-seo-overview-lang--de")}>{lang.toUpperCase()}</span>;
}

/** Plural by count: "1 page", "3 pages". */
export const plural = (n: number, one: string, many = `${one}s`): string => `${num(n)} ${n === 1 ? one : many}`;
