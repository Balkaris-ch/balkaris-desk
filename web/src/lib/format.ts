import type { Range, SourceId, Stat } from "@/contract/common";

/**
 * How the desk prints things: figures, times, dates, ranges.
 *
 * One file so that "12,429" is written the same way on every screen, on the
 * server and in the browser. Dates are the studio's (Europe/Zurich) wherever
 * the reader sits, and month and weekday names come from the lists below, not
 * from the machine: Node 22, Node 24 and Edge disagree about "Sep" and "Sept",
 * and a name that differs between the server's HTML and the browser's is a
 * hydration error.
 *
 * Nothing here invents a value. A function given `null` prints the dash the
 * boards use for "no figure" and never a zero.
 */

export const DASH = "—";
const ZONE = "Europe/Zurich";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/* ---------- figures ------------------------------------------------------ */

const whole = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

/** "12,429". Up to `digits` decimals, trailing zeros dropped. */
export function num(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  if (digits === 0) return whole.format(n);
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: digits }).format(n);
}

/** "12.4k", "1.2M". Under a thousand it is the number itself. */
export function compact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  const a = Math.abs(n);
  if (a < 1000) return num(n, a < 10 && !Number.isInteger(n) ? 1 : 0);
  const [div, unit] = a < 1e6 ? [1e3, "k"] : a < 1e9 ? [1e6, "M"] : [1e9, "bn"];
  const v = n / div;
  /* 12.4k but 124k: one decimal only while there is room for it. */
  return `${trim(v, Math.abs(v) < 100 ? 1 : 0)}${unit}`;
}

/** A value that is already in percent: 2.4 prints "2.4%". */
export function percent(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return `${trim(n, digits)}%`;
}

/** Milliseconds as a person says them: "82ms", "1.3s", "2m 14s", "3h 05m". */
export function duration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return DASH;
  const a = Math.abs(ms);
  if (a < 1000) return `${Math.round(ms)}ms`;
  if (a < 60_000) return `${trim(ms / 1000, a < 10_000 ? 1 : 0)}s`;
  const s = Math.round(a / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  const m = Math.round(s / 60);
  if (m < 1440) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
  const h = Math.round(m / 60);
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** "640 B", "1.2 MB", "312 GB". Powers of 1024, as file systems count. */
export function bytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = Math.abs(n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${n < 0 ? "-" : ""}${trim(v, i === 0 || v >= 100 ? 0 : 1)} ${units[i]}`;
}

/**
 * A `Stat`'s value in its own unit.
 *
 *   count    "12,429"
 *   percent  "2.4%"     the value is already in percent
 *   ms       "82ms"     whole milliseconds, as measured
 *   s        "1.3s"
 *   score    "86"
 *   ratio    "0.02"     a plain decimal (a layout shift, a share of one)
 */
export function figure(value: number | null | undefined, unit: Stat["unit"] = "count"): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  switch (unit) {
    case "percent":
      return percent(value, Math.abs(value) < 10 ? 2 : 1);
    case "ms":
      return `${num(Math.round(value))}ms`;
    case "s":
      return `${trim(value, Math.abs(value) < 10 ? 1 : 0)}s`;
    case "ratio":
      return trim(value, 2);
    case "score":
      return num(Math.round(value));
    default:
      return num(value, Number.isInteger(value) ? 0 : 1);
  }
}

/**
 * The change from `previous` to `value` in percent of `previous`, or null when
 * it cannot be said: no previous figure, or a previous figure of zero (a rise
 * from nothing has no percentage).
 */
export function change(value: number, previous: number | null | undefined): number | null {
  if (previous == null || !Number.isFinite(previous) || previous === 0 || !Number.isFinite(value)) return null;
  return ((value - previous) / Math.abs(previous)) * 100;
}

function trim(n: number, digits: number): string {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: digits, useGrouping: false }).format(n);
}

/* ---------- time --------------------------------------------------------- */

type When = string | number | Date;

const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "long",
  hourCycle: "h23",
});

interface Zurich {
  year: number;
  /** 1 to 12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 is Sunday */
  weekday: number;
  /** YYYY-MM-DD */
  key: string;
}

/** The moment as the studio's wall clock shows it, or null for a bad date. */
export function zurich(when: When): Zurich | null {
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) return null;
  const got: Record<string, string> = {};
  for (const p of parts.formatToParts(d)) got[p.type] = p.value;
  const year = Number(got.year);
  const month = Number(got.month);
  const day = Number(got.day);
  return {
    year,
    month,
    day,
    hour: Number(got.hour),
    minute: Number(got.minute),
    weekday: Math.max(0, DAYS.indexOf(got.weekday as (typeof DAYS)[number])),
    key: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

/** A chart's axis: "Sep 3". A bare YYYY-MM-DD is taken as that calendar day. */
export function shortDate(when: When): string {
  const z = day(when);
  return z ? `${MONTHS[z.month - 1]} ${z.day}` : DASH;
}

/** A table's date: "1 Oct 2026". */
export function fullDate(when: When): string {
  const z = day(when);
  return z ? `${z.day} ${MONTHS[z.month - 1]} ${z.year}` : DASH;
}

/** The page head's date: "Friday, 2 Oct 2026". */
export function longDate(when: When = new Date()): string {
  const z = day(when);
  return z ? `${DAYS[z.weekday]}, ${z.day} ${MONTHS[z.month - 1]} ${z.year}` : DASH;
}

/** "09:31", the studio's clock. */
export function clock(when: When): string {
  const z = zurich(when);
  return z ? `${String(z.hour).padStart(2, "0")}:${String(z.minute).padStart(2, "0")}` : DASH;
}

/** A feed's left column: the time today, "Yesterday", else "28 Sep". */
export function feedTime(when: When, now: When = new Date()): string {
  const z = zurich(when);
  const n = zurich(now);
  if (!z || !n) return DASH;
  if (z.key === n.key) return clock(when);
  const y = zurich(new Date(new Date(now).getTime() - 86_400_000));
  if (y && z.key === y.key) return "Yesterday";
  return `${z.day} ${MONTHS[z.month - 1]}${z.year === n.year ? "" : ` ${z.year}`}`;
}

/**
 * "just now", "12 min ago", "3 hours ago", "2 days ago", and the same forward:
 * "in 22 hours". Past three weeks it is the date, because "47 days ago" makes
 * the reader count.
 */
export function ago(when: When, now: When = new Date()): string {
  const t = new Date(when).getTime();
  const n = new Date(now).getTime();
  if (Number.isNaN(t) || Number.isNaN(n)) return DASH;
  const diff = t - n;
  const a = Math.abs(diff);
  const say = (count: number, one: string, many: string) => {
    const unit = count === 1 ? one : many;
    return diff < 0 ? `${count} ${unit} ago` : `in ${count} ${unit}`;
  };
  if (a < 45_000) return diff <= 0 ? "just now" : "in a moment";
  if (a < 3_600_000) return say(Math.max(1, Math.round(a / 60_000)), "min", "min");
  if (a < 86_400_000) return say(Math.round(a / 3_600_000), "hour", "hours");
  if (a < 7 * 86_400_000) return say(Math.round(a / 86_400_000), "day", "days");
  if (a < 21 * 86_400_000) return say(Math.round(a / (7 * 86_400_000)), "week", "weeks");
  return fullDate(when);
}

/** "Good morning", by the studio's clock. */
export function greeting(now: When = new Date()): string {
  const h = zurich(now)?.hour ?? 12;
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/* A date with no time ("2026-09-03") names a calendar day. Read as an instant
   it is midnight UTC, which in Zurich is still that day, but only by luck of
   the offset's sign: take the digits as they are written. */
function day(when: When): Pick<Zurich, "year" | "month" | "day" | "weekday"> | null {
  if (typeof when === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(when);
    if (m) {
      const [year, month, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      return { year, month, day: d, weekday: new Date(Date.UTC(year, month - 1, d)).getUTCDay() };
    }
  }
  return zurich(when);
}

/* ---------- ranges ------------------------------------------------------- */

/** The four every screen offers, in the order the switch shows them. */
export const RANGES = ["7d", "30d", "90d", "1y"] as const satisfies readonly Range[];
/** Site Health's four. */
export const SHORT_RANGES = ["1h", "24h", "7d", "30d"] as const satisfies readonly Range[];

const RANGE_TEXT: Record<Range, { short: string; label: string; days: number }> = {
  "1h": { short: "1H", label: "Last hour", days: 1 / 24 },
  "24h": { short: "24H", label: "Last 24 hours", days: 1 },
  "7d": { short: "7D", label: "Last 7 days", days: 7 },
  "30d": { short: "30D", label: "Last 30 days", days: 30 },
  "90d": { short: "90D", label: "Last 90 days", days: 90 },
  "1y": { short: "1Y", label: "Last 12 months", days: 365 },
};

/**
 * The range a screen was asked for. `raw` is the page's `range` search param
 * as Next hands it over. Anything not in `allowed` is the fallback, so a typed
 * or stale address never reaches the server as a range it does not know.
 */
export function parseRange(raw: string | string[] | undefined, allowed: readonly Range[] = RANGES, fallback: Range = "30d"): Range {
  const one = (Array.isArray(raw) ? raw[0] : raw)?.toLowerCase();
  const hit = allowed.find((r) => r === one);
  return hit ?? (allowed.includes(fallback) ? fallback : allowed[0]!);
}

/** "Last 30 days". */
export const rangeLabel = (r: Range): string => RANGE_TEXT[r].label;
/** "30D", as the switch prints it. */
export const rangeShort = (r: Range): string => RANGE_TEXT[r].short;
/** How many days the range covers (an hour is 1/24). */
export const rangeDays = (r: Range): number => RANGE_TEXT[r].days;

/* ---------- names -------------------------------------------------------- */

const SOURCES: Record<SourceId, string> = {
  ga4: "GA4",
  "ga4-live": "GA4 realtime",
  gsc: "Search Console",
  bing: "Bing Webmaster",
  clarity: "Clarity",
  psi: "PageSpeed",
  crux: "Chrome UX Report",
  crawl: "Desk crawl",
  probe: "Desk probe",
  repo: "Website repo",
  engine: "Engine",
  desk: "Desk",
  runner: "Workstation",
  "vercel-drain": "Vercel request records",
  "vercel-api": "Vercel API",
  "vercel-status": "Vercel status page",
  none: "No source",
};

/** A source as it is named beside a figure. */
export const sourceLabel = (id: SourceId): string => SOURCES[id] ?? id;

/** "MF" for "Miron Fini", "F" for "Fini". At most two letters. */
export function initials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = [...words[0]!][0] ?? "";
  const last = words.length > 1 ? ([...words[words.length - 1]!][0] ?? "") : "";
  return (first + last).toUpperCase();
}
