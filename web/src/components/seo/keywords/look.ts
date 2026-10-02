import type { ChipTone } from "@/components/ui/Badge";
import type { Priority, Rate } from "@/contract/seo/common";
import type { Intent, KeywordFlag, KeywordRow, KeywordSource, KeywordStatus, PositionBand } from "@/contract/seo/keywords";
import { DASH, num, percent } from "@/lib/format";

/**
 * How SEO › Keywords names and colours what the keyword store gives it. No
 * client code: the page's server components and its client ones both read it.
 */

export const INTENT_LABEL: Record<Intent, string> = {
  commercial: "Commercial",
  transactional: "Transactional",
  informational: "Informational",
  local: "Local",
  navigational: "Navigational",
};

/** The board draws Commercial violet and Informational blue. */
export const INTENT_TONE: Record<Intent, ChipTone> = {
  commercial: "violet",
  transactional: "good",
  informational: "info",
  local: "warn",
  navigational: "quiet",
};

export const LANG_LABEL: Record<string, string> = { de: "German", en: "English" };
export const langLabel = (l: string | null): string => (l ? (LANG_LABEL[l] ?? l.toUpperCase()) : "Language not known");

export const SOURCE_LABEL: Record<KeywordSource, string> = {
  gsc: "Search Console",
  autocomplete: "Google Autocomplete",
  audit: "SEO audit",
  manual: "Added by a person",
};

export const STATUS_LABEL: Record<KeywordStatus, string> = {
  relevant: "Relevant",
  weak: "Weak",
  irrelevant: "Irrelevant",
  unjudged: "Not judged",
};

export const BAND_LABEL: Record<PositionBand, string> = {
  "1-3": "Positions 1–3",
  "4-10": "Positions 4–10",
  "11-20": "Positions 11–20",
  "21-50": "Positions 21–50",
  "51+": "Position 51 and lower",
  none: "Not shown in Google",
};
export const BANDS: PositionBand[] = ["1-3", "4-10", "11-20", "21-50", "51+", "none"];

export const FLAG_LABEL: Record<KeywordFlag, string> = { price: "Asks a price", question: "A question", local: "Names a place" };

export const PRIORITY_TONE: Record<Priority, ChipTone> = { high: "bad", medium: "warn", low: "quiet" };
export const PRIORITY_LABEL: Record<Priority, string> = { high: "High", medium: "Medium", low: "Low" };

/** Who made a mapping or a judgement, as a person reads it. */
export function byWhom(by: string | null): string {
  if (!by) return "nobody yet";
  if (by === "audit") return "the SEO audit";
  if (by === "rule") return "the desk's rule (every word of the phrase in the page's title, heading or address)";
  if (by === "research") return "the research";
  if (by === "gsc") return "Search Console's arrival";
  return by;
}

/** Google's average position as a cell prints it. */
export const pos = (p: number | null): string => (p === null ? DASH : num(p, 1));

/** A rate as a cell prints it: "2.8%", or "1 of 6" when there are fewer than 30 impressions to divide. */
export function rateCell(r: Rate | null): string {
  if (!r || r.value === null) return DASH;
  return r.small ? `${num(r.num)} of ${num(r.den)}` : percent(r.value, r.value < 10 ? 1 : 0);
}

/**
 * The daily positions folded into weeks counted back from the newest day, each
 * the mean of the days Google showed the phrase in it (a week it never showed
 * it is a gap), drawn so that up is better. A row's line is a few pixels wide:
 * thirty daily points with gaps read as noise, five weekly ones as a direction.
 */
export function trendWeeks(t: (number | null)[]): (number | null)[] {
  const out: (number | null)[] = [];
  for (let end = t.length; end > 0; end -= 7) {
    const week = t.slice(Math.max(0, end - 7), end).filter((p): p is number => p !== null);
    out.unshift(week.length ? -(week.reduce((a, b) => a + b, 0) / week.length) : null);
  }
  return out;
}

/** The row's main button, by what is true of it (board 113: Optimize, Improve, View, Create content). */
export function primaryOf(r: KeywordRow): "optimize" | "view" | "brief" {
  if (!r.page || !r.pageKnown) return "brief";
  if (r.position !== null && r.position <= 3) return "view";
  return "optimize";
}
