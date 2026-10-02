/**
 * Axis arithmetic for the desk's hand-drawn charts.
 *
 * No chart library, so the four things a library would quietly do are written
 * here once: round tick values, a straight-line scale, which points get an x
 * label when not all of them fit, and how a number is shortened beside an axis.
 *
 * WHY IT IS CAREFUL ABOUT SMALL NUMBERS. The site has been measured since late
 * September 2026, and most of what the desk counts is small: a handful of
 * enquiries, a country with a visitor or two, a history only days long. A
 * scale that works for tens of thousands and prints "0.5 visitors" for a
 * handful is wrong for this desk, so whole things get whole ticks.
 *
 * Everything here is pure: no clock, no locale lookup. The server and the
 * browser must print the same label, or React draws the chart twice.
 * How a full figure or a date is printed is lib/format.ts, not this file.
 */

/** The ticks of one axis, and the range they span (which is what is drawn). */
export interface Ticks {
  min: number;
  max: number;
  step: number;
  ticks: number[];
}

export interface TickOptions {
  /** About how many intervals to aim for. Four reads well at the boards' chart heights. */
  count?: number;
  /** The quantity is counted in whole things (visitors, leads): the step is never below 1. */
  integer?: boolean;
  /** Keep zero on the axis. True by default: an area chart cut off above zero lies about size. */
  zero?: boolean;
}

/* Floating point leaves 0.30000000000000004 on an axis; round to the step's own precision. */
function tidy(v: number, step: number): number {
  const decimals = Math.max(0, Math.min(12, -Math.floor(Math.log10(step)) + 2));
  const p = 10 ** decimals;
  return Math.round(v * p) / p;
}

/* The round steps: 1, 2, 2.5 and 5 times a power of ten. 2.5 is a fine step
   for 25 or 250 and a wrong one for whole things under ten. */
function roundStep(raw: number, integer: boolean): number {
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const half = !integer || mag >= 10;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 && half ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return integer ? Math.max(1, Math.round(step)) : step;
}

/**
 * Round tick values that cover `lo` to `hi`, and with `integer` never a
 * fraction (0, 1, 2, 3 for a series that peaks at three). A flat series still
 * gets a range, so nothing divides by zero: all zeros gives 0 to 1.
 */
export function niceTicks(lo: number, hi: number, opts: TickOptions = {}): Ticks {
  const { count = 4, integer = false, zero = true } = opts;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 1, step: 1, ticks: [0, 1] };
  if (lo > hi) [lo, hi] = [hi, lo];
  if (zero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (lo === hi) {
    /* One value and no zero to anchor it: open a little room around it. */
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.5;
    hi = lo + pad;
    if (!zero) lo = lo - pad;
  }

  const step = roundStep((hi - lo) / Math.max(1, count), integer);
  const min = tidy(Math.floor(lo / step + 1e-9) * step, step);
  const max = tidy(Math.ceil(hi / step - 1e-9) * step, step);
  const ticks: number[] = [];
  for (let i = 0; i <= Math.round((max - min) / step); i++) ticks.push(tidy(min + i * step, step));
  return { min, max, step, ticks };
}

/**
 * Ticks from zero in exactly `intervals` round steps that reach `hi`. For the
 * second axis of a chart with two: both must have the same number of steps,
 * or their grid lines would not be the same lines.
 */
export function fixedTicks(hi: number, intervals: number, integer = false): Ticks {
  intervals = Math.max(1, Math.round(intervals));
  if (!Number.isFinite(hi) || hi <= 0) hi = 1;
  let step = roundStep(hi / intervals, integer);
  /* roundStep rounds up, but guard the edge where rounding lands a hair short. */
  while (step * intervals < hi - 1e-9) step = roundStep(step * 1.01, integer);
  const ticks: number[] = [];
  for (let i = 0; i <= intervals; i++) ticks.push(tidy(i * step, step));
  return { min: 0, max: tidy(step * intervals, step), step, ticks };
}

/**
 * A straight-line scale: `linear(0, 20, 100, 0)(5)` is 75. A domain with no
 * width maps everything to the middle of the range instead of to NaN.
 */
export function linear(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0;
  if (span === 0) return () => (r0 + r1) / 2;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

/* Steps that mean something on a calendar: every day, every third day, weekly, monthly. */
const DATE_STEPS = [1, 2, 3, 5, 7, 10, 14, 21, 28, 30, 60, 90, 120, 180, 365];

/**
 * Which of `n` points get an x label when at most `max` fit. Counted back from
 * the newest point, because the latest date is the one a reader looks for;
 * the oldest is labelled only when the step happens to land on it.
 * Returns indices in ascending order.
 */
export function thinIndices(n: number, max: number): number[] {
  if (n <= 0 || max <= 0) return [];
  if (n === 1) return [0];
  max = Math.max(2, max);
  const step = DATE_STEPS.find((s) => Math.floor((n - 1) / s) + 1 <= max) ?? Math.ceil((n - 1) / (max - 1));
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i -= step) out.push(i);
  return out.reverse();
}

/**
 * The same thinning in two tiers, for a chart whose width the server cannot
 * know: tier 0 labels always show, tier 1 labels are the extra ones a wide
 * chart has room for (a stylesheet hides them in a narrow container).
 */
export function thinTiers(n: number, wide = 10, narrow = 5): { index: number; tier: 0 | 1 }[] {
  const all = thinIndices(n, wide);
  if (all.length <= narrow) return all.map((index) => ({ index, tier: 0 as const }));
  /* Every second (or third) one, counted from the newest, so the last label never disappears. */
  const every = Math.ceil(all.length / narrow);
  return all.map((index, k) => ({ index, tier: (all.length - 1 - k) % every === 0 ? (0 as const) : (1 as const) }));
}

const trim = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);

/**
 * How many decimals a step really has: 1 has none, 2.5 one, 0.25 two, 0.025
 * three. Capped at three, which is finer than any axis here is drawn.
 */
export function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  for (let d = 0; d < 3; d++) {
    const scaled = step * 10 ** d;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9 * Math.max(1, scaled)) return d;
  }
  return 3;
}

/* Digits in threes, for the rare axis tick that cannot be shortened without
   losing the digit that tells it from its neighbour. No locale: see above. */
function grouped(v: number, decimals: number): string {
  const [whole = "", frac] = Math.abs(v).toFixed(decimals).split(".");
  return (v < 0 ? "-" : "") + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac ? `.${frac}` : "");
}

/**
 * A number short enough for an axis: 999, 1.2k, 12.3k, 123k, 1.2M. Under a
 * thousand it is printed as it is, with at most two decimals. It rounds, so
 * it is for one figure on its own; ticks go through `formatTick`, which keeps
 * every digit that tells one tick from the next.
 */
export function shortNumber(v: number): string {
  if (!Number.isFinite(v)) return "";
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e9) return sign + trim((a / 1e9).toFixed(a >= 1e10 ? 0 : 1)) + "bn";
  if (a >= 1e6) return sign + trim((a / 1e6).toFixed(a >= 1e8 ? 0 : 1)) + "M";
  if (a >= 1e3) return sign + trim((a / 1e3).toFixed(a >= 1e5 ? 0 : 1)) + "k";
  return sign + trim(a.toFixed(Number.isInteger(a) ? 0 : a < 10 ? 2 : 1));
}

/** The units a figure on the desk can carry. The same list as `Stat.unit` in the contract. */
export type Unit = "count" | "percent" | "ms" | "s" | "score" | "ratio";

/**
 * A tick label. It must print the value the tick stands at (on a step of 2.5
 * the tick at 7.5 is "7.5", never "8"), and all ticks of one axis must agree
 * on their decimals (0, 0.5, 1.0 reads as three different things). So the
 * step's own precision decides the decimals, not the value's size.
 */
export function formatTick(v: number, step: number, unit: Unit = "count"): string {
  if (!Number.isFinite(v)) return "";
  const decimals = stepDecimals(step);
  if (unit === "percent") return v.toFixed(decimals) + "%";
  if (unit === "ms") {
    /* The boards switch to seconds at the top of the axis: 400ms, 800ms, 1.2s.
       In seconds the step is a thousand times finer, and so are the decimals. */
    if (v === 0) return "0";
    if (Math.abs(v) < 1000) return v.toFixed(decimals) + "ms";
    const d = stepDecimals(step / 1000);
    return d > 2 ? grouped(v, decimals) + "ms" : (v / 1000).toFixed(d) + "s";
  }
  if (unit === "s") return v === 0 ? "0" : v.toFixed(decimals) + "s";
  if (v === 0) return "0";
  if (Math.abs(v) >= 1000) {
    /* Shortened, with as many decimals as the step needs at that size: 5k and
       10k on a step of 5,000, 2.5k and 5.0k on 2,500. When the step would need
       two decimals or more, the next smaller unit is used instead (1000k
       beside 750k on a step of 250k), and below a thousand that is the number
       in full (1,000 beside 750 on a step of 250, 1,005 beside 1,010). */
    const units: [number, string][] = [
      [1e9, "bn"],
      [1e6, "M"],
      [1e3, "k"],
    ];
    for (const [div, suffix] of units) {
      if (Math.abs(v) < div) continue;
      const d = stepDecimals(step / div);
      if (d <= 1) return (v / div).toFixed(d) + suffix;
    }
    return grouped(v, decimals);
  }
  return v.toFixed(decimals);
}
