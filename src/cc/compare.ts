/**
 * Before / after, in plain arithmetic. No library.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT. The website has no split testing: every
 * visitor sees the same site, and it changes when somebody pushes to main.
 * So the Experiments screen compares the days before a change with the same
 * number of days after it. That is not an experiment. Season, a campaign, a
 * LinkedIn post and the mix of weekdays move the figures too, and nothing
 * here can separate them from the change. What this file CAN do is say how
 * far apart the two windows are compared with how much the days inside them
 * already vary, and refuse to say anything when there are too few days or
 * too few events. It never claims a cause, and the screen never says
 * "significant".
 *
 * Three pieces:
 *
 *   windowsAround   the two windows: the change's own day is left out (part of
 *                   it was before and part after), each side holds the same
 *                   number of WHOLE measured days, and both are shortened to
 *                   what GA4 has measured, saying so.
 *   dailyInterval   for figures that exist every day (visitors, time per
 *                   visitor): a bootstrap over the days of each window.
 *   countInterval   for events counted in single or double digits (forms
 *                   started, enquiries sent): the exact test for two counts.
 *
 * Everything here is pure: the same numbers always give the same answer
 * (the bootstrap's random draws are seeded from the numbers themselves), so
 * a comparison opened twice does not move.
 */

/* ---------- days ------------------------------------------------------------ */

const DAY_MS = 86_400_000;

/** A YYYY-MM-DD moved by whole days. Noon, so a clock change cannot move the day. */
export function shiftDay(day: string, by: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + by * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY_MS);
}

/** The day an instant falls on in a time zone, YYYY-MM-DD. */
export function dayIn(iso: string, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date(iso));
}

/** Every day from `start` to `end`, both included. */
export function daysFrom(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = shiftDay(d, 1)) out.push(d);
  return out;
}

export const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\d$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));

/* ---------- the two windows ------------------------------------------------- */

export interface Windows {
  /** Whole days on each side. */
  days: number;
  asked: number;
  shortened: string | null;
  before: { start: string; end: string };
  after: { start: string; end: string };
  changeDay: string;
}

export type WindowsAnswer = { ok: true; value: Windows } | { ok: false; state: "waiting" | "off"; reason: string };

/**
 * The windows around a change made on `changeDay`.
 *
 * `fullFrom` is the first day GA4 measured from midnight; `lastWhole` is the
 * last finished day (yesterday). Each side gets `asked` days, or fewer when
 * fewer were measured on one side, and then both sides get that many: a
 * comparison of seven days with three is not like with like.
 */
export function windowsAround(changeDay: string, asked: number, fullFrom: string, lastWhole: string, words: (day: string) => string = (d) => d): WindowsAnswer {
  const afterHas = daysBetween(changeDay, lastWhole);
  const beforeHas = daysBetween(fullFrom, changeDay);
  if (afterHas < 1) {
    return {
      ok: false,
      state: "waiting",
      reason:
        changeDay > lastWhole
          ? `No whole day after ${words(changeDay)} has been measured yet: the first one, ${words(shiftDay(changeDay, 1))}, can be compared the day after it ends.`
          : `No whole day after this change has been measured yet: the first one, ${words(shiftDay(changeDay, 1))}, can be compared once it has ended.`,
    };
  }
  if (beforeHas < 1) {
    return {
      ok: false,
      state: "off",
      reason: `GA4 measured its first whole day of the website on ${words(fullFrom)}. This change was made on ${words(changeDay)}, so there is no measured day before it to compare with, and there never will be.`,
    };
  }
  const days = Math.min(asked, afterHas, beforeHas);
  let shortened: string | null = null;
  if (days < asked) {
    shortened =
      afterHas <= beforeHas
        ? `Only ${days} whole day${days === 1 ? " has" : "s have"} been measured since the change, so each window holds ${days}, not ${asked}.`
        : `GA4 began measuring whole days on ${words(fullFrom)}, ${beforeHas} day${beforeHas === 1 ? "" : "s"} before the change, so each window holds ${days}, not ${asked}.`;
  }
  return {
    ok: true,
    value: {
      days,
      asked,
      shortened,
      changeDay,
      before: { start: shiftDay(changeDay, -days), end: shiftDay(changeDay, -1) },
      after: { start: shiftDay(changeDay, 1), end: shiftDay(changeDay, days) },
    },
  };
}

/* ---------- seeded draws ---------------------------------------------------- */

/** A 32-bit seed from numbers: the same days give the same draws. */
function seedOf(values: readonly number[]): number {
  let h = 0x811c9dc5;
  for (const v of values) {
    const s = String(Math.round(v * 1000));
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0x2c;
  }
  return h >>> 0;
}

/** mulberry32: small, fast, and good enough for resampling a few dozen days. */
function draws(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The value below which `q` of the sorted list lies (linear between neighbours). */
function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return Number.NaN;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (at - lo);
}

/* ---------- figures that exist every day ------------------------------------ */

/** Rounds of the bootstrap. Enough that the interval's ends do not move in the first decimal. */
export const ROUNDS = 5000;
/** The fewest whole days on each side before a daily figure is compared at all. */
export const MIN_DAYS = 7;

export interface Interval {
  /** After minus before, in the figure's unit. */
  diff: number;
  /** The middle 95% of the resampled differences. */
  lo: number;
  hi: number;
}

/**
 * The difference of a ratio of sums between the two windows, with a
 * bootstrap interval.
 *
 * Each window is a list of days, each day a numerator and a denominator
 * (visitors that day and 1; or engagement seconds and visitors). The figure
 * of a window is the sum of its numerators over the sum of its denominators.
 * Each round draws as many days as the window has, at random and with
 * replacement, from that window alone, and works the figure out again; the
 * interval is the middle 95% of the after-minus-before differences over
 * ROUNDS rounds. A round in which a window drew no denominator at all (no
 * visitor on any drawn day) has no figure and is left out.
 *
 * Null when either window has no denominator at all.
 */
export function dailyInterval(before: readonly { num: number; den: number }[], after: readonly { num: number; den: number }[]): Interval | null {
  const figure = (days: readonly { num: number; den: number }[]): number | null => {
    let n = 0;
    let d = 0;
    for (const x of days) {
      n += x.num;
      d += x.den;
    }
    return d > 0 ? n / d : null;
  };
  const b0 = figure(before);
  const a0 = figure(after);
  if (b0 === null || a0 === null || !before.length || !after.length) return null;

  const rand = draws(seedOf([...before.flatMap((x) => [x.num, x.den]), -1, ...after.flatMap((x) => [x.num, x.den])]));
  const pick = (days: readonly { num: number; den: number }[]): number | null => {
    let n = 0;
    let d = 0;
    for (let i = 0; i < days.length; i++) {
      const x = days[Math.floor(rand() * days.length)] as { num: number; den: number };
      n += x.num;
      d += x.den;
    }
    return d > 0 ? n / d : null;
  };
  const diffs: number[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    const b = pick(before);
    const a = pick(after);
    if (a !== null && b !== null) diffs.push(a - b);
  }
  if (diffs.length < ROUNDS / 2) return null;
  diffs.sort((x, y) => x - y);
  return { diff: a0 - b0, lo: quantile(diffs, 0.025), hi: quantile(diffs, 0.975) };
}

export const DAILY_METHOD = (what: string): string =>
  `Bootstrap over days, ${ROUNDS.toLocaleString("en-GB")} rounds: each window's days are drawn again at random, with replacement, ${what}, and the after-minus-before difference is worked out each time. The interval holds the middle 95% of those differences. It needs ${MIN_DAYS} whole days on each side. With so few days it is narrower than it should be, and it knows nothing of season, campaigns or other changes inside the windows.`;

/* ---------- counted events -------------------------------------------------- */

/** The fewest events in both windows together before two counts are compared at all. */
export const MIN_EVENTS = 10;

/** log Γ(x), Lanczos (g = 7, n = 9): exact to about 15 digits, which binomial terms need. */
function logGamma(x: number): number {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = c[0] as number;
  const t = z + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += (c[i] as number) / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** P(X <= x) for X ~ Binomial(n, p). */
function binomCdf(x: number, n: number, p: number): number {
  if (x < 0) return 0;
  if (x >= n) return 1;
  if (p <= 0) return 1;
  if (p >= 1) return 0;
  const lc = logGamma(n + 1);
  const lp = Math.log(p);
  const lq = Math.log1p(-p);
  let s = 0;
  for (let i = 0; i <= x; i++) s += Math.exp(lc - logGamma(i + 1) - logGamma(n - i + 1) + i * lp + (n - i) * lq);
  return Math.min(1, s);
}

/** The p in [0, 1] at which a monotonic g(p) crosses `target`, by halving: 60 steps is far below any digit shown. */
function bisect(g: (p: number) => number, target: number, increasing: boolean): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (g(mid) < target === increasing) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface CountInterval {
  /** After over before, or null when there was nothing before. */
  ratio: number | null;
  /** The exact 95% interval for that ratio; `hi` is Infinity when nothing before rules out any rise. */
  lo: number;
  hi: number;
}

/**
 * Two counts over windows of the same length, compared exactly.
 *
 * If the rate had not changed, each of the n = before + after events would
 * be as likely to fall in one window as the other: the after count would be
 * Binomial(n, ½). The exact (Clopper–Pearson) 95% interval for the share p
 * that fell after is turned into one for the ratio after/before, p / (1 − p).
 * It assumes events arrive at a steady rate inside each window; days that
 * vary more than that make the true interval wider than this one.
 */
export function countInterval(before: number, after: number): CountInterval {
  const n = before + after;
  const k = after;
  /* Lower end: the p at which seeing k or more is just 2.5% likely (that chance rises with p). */
  const pLo = k === 0 ? 0 : bisect((p) => 1 - binomCdf(k - 1, n, p), 0.025, true);
  /* Upper end: the p at which seeing k or fewer is just 2.5% likely (that chance falls with p). */
  const pHi = k === n ? 1 : bisect((p) => binomCdf(k, n, p), 0.025, false);
  const toRatio = (p: number) => (p >= 1 ? Infinity : p / (1 - p));
  return { ratio: before > 0 ? after / before : null, lo: toRatio(pLo), hi: toRatio(pHi) };
}

export const COUNT_METHOD = `Exact test for two counts: if nothing had changed, each event would be as likely to fall in the window before as in the window after, like a coin toss. The interval is the exact (Clopper–Pearson) 95% interval of that split, given as after ÷ before. It needs ${MIN_EVENTS} events in both windows together, and it assumes a steady rate inside each window: days that vary more than that make the true interval wider.`;

/* ---------- planning a real test --------------------------------------------- */

/**
 * People needed in EACH of two versions to tell a rate `p` from `p × lift`
 * at 5% (two-sided) and 80% power: the usual normal-approximation formula
 * for two proportions. Null when there is no rate to plan from.
 */
export function perVersion(p: number, lift = 1.5): number | null {
  if (!(p > 0) || p * lift >= 1) return null;
  const za = 1.959964;
  const zb = 0.841621;
  const p2 = p * lift;
  const bar = (p + p2) / 2;
  const top = za * Math.sqrt(2 * bar * (1 - bar)) + zb * Math.sqrt(p * (1 - p) + p2 * (1 - p2));
  return Math.ceil((top * top) / ((p2 - p) * (p2 - p)));
}

export const PLAN_METHOD =
  "Sample size for comparing two proportions (normal approximation): 5% two-sided, 80% power, to tell an enquiry rate half as high again from no change. The rate is enquiries sent (GA4 generate_lead) over visitors in the period, consenting visitors only; from this few enquiries the rate is itself rough, so read the answer as an order of size.";
