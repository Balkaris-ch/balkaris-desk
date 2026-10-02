import { num, percent } from "@/lib/format";

/** Below this many impressions a click-through rate is noise: the two counts are shown instead. */
export const RATE_FLOOR = 30;

/** "4.8%", or "2 of 11" when the rate rests on fewer than thirty impressions. */
export function ctrText(clicks: number, impressions: number, ctr: number | null): string {
  if (ctr === null || impressions === 0) return "—";
  return impressions < RATE_FLOOR ? `${num(clicks)} of ${num(impressions)}` : percent(ctr);
}
