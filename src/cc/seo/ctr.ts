import type { CtrCurve, Potential } from "../../../web/src/contract/seo/common.ts";
import { round } from "../search/shared.ts";

/**
 * THE ONE ESTIMATE, AND ITS ASSUMPTION, IN ONE PLACE.
 *
 * The boards show an "estimated traffic gain" next to every opportunity. No
 * source gives that for free, so the desk makes it itself and says so every
 * time: "our estimate". It is computed from one real figure and one stated
 * assumption, and from nothing else:
 *
 *   real        the impressions Search Console counted for the query or page
 *               over the window, scaled to thirty days;
 *   assumption  the click-through rate a result gets at a position: CURVE
 *               below. It is ours, rounded from published click-through
 *               studies of organic results, and it is not Google's (Google
 *               publishes no expected CTR). A result page with ads, maps or
 *               an AI Overview above it gets fewer clicks than this.
 *
 *   potential = impressions a month × (CURVE at the target position − the CTR now)
 *
 * With no impressions there is nothing to estimate from, and the potential is
 * null: a page Google does not show is never given a number.
 */

/** Percent of impressions that become clicks, by whole position 1 to 20. OUR ASSUMPTION. */
const CURVE: readonly number[] = [27, 15, 10, 7, 5, 4, 3, 2.5, 2, 1.6, 1.2, 1.1, 1, 0.9, 0.8, 0.8, 0.7, 0.7, 0.6, 0.6];
/** Beyond position 20. */
const BEYOND = 0.3;

/** The position "near page one" opportunities aim at. */
export const TARGET_POSITION = 3;

export const CURVE_NOTE =
  "Our assumption, not Google's: the share of impressions that become clicks at each position, rounded from published click-through studies of organic results. Ads, maps and AI Overviews above the results lower it. Used for one thing only: the opportunities' 'our estimate'.";

export function curve(): CtrCurve {
  return { points: CURVE.map((ctr, i) => ({ position: i + 1, ctr })), beyond: BEYOND, note: CURVE_NOTE };
}

/** Our curve's CTR (percent) at an average position; positions between two whole numbers are read between them. */
export function expectedCtr(position: number): number {
  if (!Number.isFinite(position) || position <= 1) return CURVE[0]!;
  if (position > CURVE.length) return BEYOND;
  const lo = Math.floor(position);
  const hi = Math.min(CURVE.length, lo + 1);
  const t = position - lo;
  const a = CURVE[lo - 1]!;
  const b = hi === lo ? a : CURVE[hi - 1]!;
  return round(a + (b - a) * t, 2);
}

/**
 * Our estimate for a query or page shown `impressions` times over `days` days
 * with `clicks` clicks, if it reached `target`. Null without impressions, or
 * when the CTR now is already at or above the curve's at the target.
 */
export function potential(o: { impressions: number; clicks: number; days: number; target: number }): Potential | null {
  if (!o.impressions || o.days <= 0) return null;
  const perMonth = (o.impressions * 30) / o.days;
  const currentCtr = round((o.clicks / o.impressions) * 100, 2);
  const targetCtr = expectedCtr(o.target);
  if (targetCtr <= currentCtr) return null;
  const clicks = (perMonth * (targetCtr - currentCtr)) / 100;
  const shown = Math.round(perMonth);
  return {
    clicksPerMonth: round(clicks, 1),
    impressionsPerMonth: shown,
    targetCtr,
    currentCtr,
    targetPosition: o.target,
    basis: `${shown.toLocaleString("en-GB")} impression${shown === 1 ? "" : "s"} a month × (${targetCtr}% at position ${o.target} − ${currentCtr}% now), our estimate`,
  };
}
