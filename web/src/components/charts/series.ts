import type { Tone } from "@/contract/common";
import { clock, fullDate, shortDate } from "@/lib/format";

/**
 * What a chart is given, and the arithmetic that turns it into marks.
 *
 * A screen hands over what the server sent: an array of numbers, or the
 * contract's `DayPoint[]`. It does not reshape anything. A `null` is a day
 * with no reading, and it is drawn as a gap: never as a zero, because on this
 * desk a zero means the source said zero.
 *
 * Geometry is in percent of the plot (x 0 to 100 from the left, y 0 to 100
 * from the top), so the same marks are right at any width and nothing is
 * measured in the browser.
 */

/** A colour a mark can take: a series slot (the order a legend lists them) or a named tone. */
export type ChartColor = "s1" | "s2" | "s3" | "s4" | "s5" | "s6" | "green" | "red" | "amber" | "blue" | "violet" | "pink" | "sand" | "grey" | "ink";

/** One dated value. The contract's `DayPoint` fits; so does a point with no reading (`null`). */
export interface ChartPoint {
  /** YYYY-MM-DD for a day, an ISO timestamp for an hour, or any label. */
  date: string;
  value: number | null;
  /** The same point one period earlier, when the server sent it. */
  previous?: number | null;
}

/** Oldest first: plain numbers, or dated points. */
export type ChartData = readonly (number | null)[] | readonly ChartPoint[];

const SLOTS: ChartColor[] = ["s1", "s2", "s3", "s4", "s5", "s6"];

/** The series colour for position `i` in a legend: s1 to s6, then round again. */
export function slotColor(i: number): ChartColor {
  return SLOTS[((i % SLOTS.length) + SLOTS.length) % SLOTS.length]!;
}

/** The colour that says a tone: good is green, warn amber, bad red, info blue, quiet grey. */
export function toneColor(tone: Tone): ChartColor {
  return tone === "good" ? "green" : tone === "warn" ? "amber" : tone === "bad" ? "red" : tone === "info" ? "blue" : "grey";
}

/** A `Tone` or a `ChartColor`, whichever the caller has, as a colour. */
export function asColor(c: Tone | ChartColor | undefined, fallback: ChartColor = "green"): ChartColor {
  if (!c) return fallback;
  return c === "good" || c === "warn" || c === "bad" || c === "info" || c === "quiet" ? toneColor(c) : c;
}

/** The class that sets `--c`, the one custom property every mark is painted with. */
export const colorClass = (c: ChartColor): string => `dk-c-${c}`;

const isPoints = (d: ChartData): d is readonly ChartPoint[] => d.length > 0 && typeof d[0] === "object" && d[0] !== null;

const clean = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Either shape of input as three parallel lists. `dates` and `previous` are null when the input had none. */
export function normalise(data: ChartData): { values: (number | null)[]; dates: string[] | null; previous: (number | null)[] | null } {
  if (isPoints(data)) {
    const values = data.map((p) => clean(p.value));
    const hasPrev = data.some((p) => p.previous !== undefined);
    return { values, dates: data.map((p) => p.date), previous: hasPrev ? data.map((p) => clean(p.previous)) : null };
  }
  return { values: (data as readonly (number | null)[]).map(clean), dates: null, previous: null };
}

/** Several inputs on one x axis: what `align` returns. */
export interface Aligned {
  /** The x value of each point, oldest first. Null when nothing says what the points are (plain numbers and no `x`). */
  x: string[] | null;
  /** Each input's values on that axis, in the order given; null where it has no reading. */
  values: (number | null)[][];
  /** Each input's previous period on that axis, when it carried one (`DayPoint.previous`); otherwise null. */
  previous: ((number | null)[] | null)[];
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const ZONED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/;
const UNZONED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
/* The longest run of days filled in between two dates: ten years. Past that
   the input is not a daily series, and its dates are kept as they are. */
const MAX_DAYS = 3660;

/* Lined up at the newest point: the shorter list has no readings for the oldest days. */
function padTo<T>(list: readonly T[], n: number, fill: T): T[] {
  return list.length >= n ? list.slice(list.length - n) : [...Array<T>(n - list.length).fill(fill), ...list];
}

/**
 * Every date the inputs carry, oldest first, each once. Days are sorted and
 * the days between them filled in, so a day no input has is a gap on the
 * chart rather than a day that silently vanished. Timestamps are sorted (by
 * the instant when they say their zone, as written when none does); any other
 * labels keep the order they first appear in.
 */
function unionDates(lists: readonly (readonly string[])[]): string[] {
  const all = [...new Set(lists.flat())];
  if (all.length === 0) return all;
  if (all.every((d) => DAY_KEY.test(d))) {
    all.sort();
    const first = Date.parse(`${all[0]}T00:00:00Z`);
    const last = Date.parse(`${all[all.length - 1]}T00:00:00Z`);
    const span = Math.round((last - first) / 86_400_000);
    if (!Number.isFinite(span) || span > MAX_DAYS) return all;
    return Array.from({ length: span + 1 }, (_, i) => new Date(first + i * 86_400_000).toISOString().slice(0, 10));
  }
  if (all.every((d) => ZONED.test(d) && Number.isFinite(Date.parse(d)))) return all.sort((a, b) => Date.parse(a) - Date.parse(b));
  if (all.every((d) => UNZONED.test(d))) return all.sort();
  return all;
}

/**
 * Lines several inputs up on one x axis, so a screen can hand over each
 * source's series as it came.
 *
 * Dated points are placed on their own dates. Without `x` the axis is every
 * date the inputs carry (for days, every day from the oldest to the newest);
 * with `x` it is exactly `x`, and a point whose date is not on it is left
 * out. So a Search Console series that ends two days before GA4's ends two
 * days early on the chart, instead of being slid along to end on the same day.
 * If one date occurs twice in an input, its later point is the one drawn.
 *
 * Plain numbers have no dates: they are lined up at the newest point, and
 * `x` (when given) labels the points from the newest back. Where `x` is
 * shorter than a list of numbers, the list's oldest values are not drawn.
 */
export function align(inputs: readonly ChartData[], x?: readonly string[]): Aligned {
  const parsed = inputs.map(normalise);
  const axisGiven = x && x.length > 0 ? [...x] : null;

  if (!parsed.some((p) => p.dates)) {
    const n = axisGiven ? axisGiven.length : Math.max(0, ...parsed.map((p) => p.values.length));
    return {
      x: axisGiven,
      values: parsed.map((p) => padTo(p.values, n, null)),
      previous: parsed.map(() => null),
    };
  }

  const axis = axisGiven ?? unionDates(parsed.map((p) => p.dates ?? []));
  const n = axis.length;
  const at = new Map<string, number>();
  axis.forEach((d, i) => {
    if (!at.has(d)) at.set(d, i);
  });
  const place = (dates: string[] | null, list: readonly (number | null)[]): (number | null)[] => {
    if (!dates) return padTo(list, n, null);
    const out = Array<number | null>(n).fill(null);
    dates.forEach((d, i) => {
      const k = at.get(d);
      if (k !== undefined) out[k] = list[i] ?? null;
    });
    return out;
  };
  return {
    x: axis,
    values: parsed.map((p) => place(p.dates, p.values)),
    previous: parsed.map((p) => (p.previous ? place(p.dates, p.previous) : null)),
  };
}

/** What a list of series holds: how many real values, their range, and whether they are all whole or all zero. */
export function summarise(lists: readonly (readonly (number | null)[])[]): { count: number; lo: number; hi: number; whole: boolean; allZero: boolean } {
  let count = 0;
  let lo = Infinity;
  let hi = -Infinity;
  let whole = true;
  let allZero = true;
  for (const list of lists) {
    for (const v of list) {
      if (v === null) continue;
      count++;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      if (!Number.isInteger(v)) whole = false;
      if (v !== 0) allZero = false;
    }
  }
  if (count === 0) return { count, lo: 0, hi: 0, whole: true, allZero: false };
  return { count, lo, hi, whole, allZero };
}

/** Two decimals are a twentieth of a pixel at 500 wide: enough, and half the markup. */
export const r2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Where point `i` of `n` stands across the plot, in percent. A line runs edge
 * to edge; with `band` (bars) every point has a column and stands in its
 * middle. One point alone stands in the centre.
 */
export function xAt(i: number, n: number, band = false): number {
  if (band) return r2(((i + 0.5) / Math.max(1, n)) * 100);
  return n <= 1 ? 50 : r2((i / (n - 1)) * 100);
}

/** The stretches of a series that have readings, as [first, last] index pairs. */
export function runs(values: readonly (number | null)[], from = 0, to = values.length - 1): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = from; i <= to; i++) {
    if (values[i] !== null && values[i] !== undefined) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0) out.push([start, to]);
  return out;
}

/**
 * The line through a series as an SVG path in the plot's 100 by 100 box:
 * straight segments, broken where there is no reading. A reading with none
 * beside it draws no segment (its dot is drawn separately).
 */
export function linePath(xs: readonly number[], ys: readonly (number | null)[], from = 0, to = ys.length - 1): string {
  let d = "";
  for (const [a, b] of runs(ys, from, to)) {
    if (a === b) continue;
    for (let i = a; i <= b; i++) d += `${i === a ? "M" : "L"}${xs[i]} ${r2(ys[i]!)}`;
  }
  return d;
}

/**
 * The areas under a series as CSS `polygon()` values, one per unbroken
 * stretch, each closed down to `base` (the y of zero, in percent).
 */
export function areaPolygons(xs: readonly number[], ys: readonly (number | null)[], base: number, from = 0, to = ys.length - 1): string[] {
  const out: string[] = [];
  for (const [a, b] of runs(ys, from, to)) {
    if (a === b) continue;
    const pts: string[] = [];
    for (let i = a; i <= b; i++) pts.push(`${xs[i]}% ${r2(ys[i]!)}%`);
    pts.push(`${xs[b]}% ${r2(base)}%`, `${xs[a]}% ${r2(base)}%`);
    out.push(`polygon(${pts.join(",")})`);
  }
  return out;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * How an x value is printed under the axis and in the tooltip. A day becomes
 * "Sep 3" and "Thu, 3 Sep 2026" (the weekday matters: weekends dip). A
 * timestamp becomes its hour, "08:00": by the studio's clock when it says
 * which zone it is in, and exactly as written when it does not (so a stamp
 * with no zone never moves with the machine that prints it). Any other label
 * is left as it is.
 */
export function xLabel(x: string): { short: string; long: string } {
  if (DAY.test(x)) {
    const weekday = WEEKDAYS[new Date(`${x}T00:00:00Z`).getUTCDay()];
    return { short: shortDate(x), long: `${weekday}, ${fullDate(x)}` };
  }
  const m = STAMP.exec(x);
  if (m) {
    const time = m[3] ? clock(x) : m[2]!;
    const day = m[3] ? fullDate(x) : fullDate(m[1]!);
    return { short: time, long: `${day}, ${time}` };
  }
  return { short: x, long: x };
}
