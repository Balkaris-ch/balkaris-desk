import type { Reading, Stat, Tone } from "@/contract/common";
import { clock, fullDate, zurich } from "@/lib/format";

/**
 * The yardsticks behind Site Health's chips, in one place. Google's published
 * Core Web Vitals thresholds are Google's; the rest are the desk's own and are
 * said as such wherever a chip carries them.
 */

/** Google's thresholds: at or under `good` is good, over `poor` is poor. LCP in seconds here, INP in ms, CLS unitless. */
export const VITALS = {
  lcp: { good: 2.5, poor: 4, name: "Largest Contentful Paint (LCP)" },
  inp: { good: 200, poor: 500, name: "Interaction to Next Paint (INP)" },
  cls: { good: 0.1, poor: 0.25, name: "Cumulative Layout Shift (CLS)" },
} as const;

export const VITAL_WORDS: Record<Tone, string> = { good: "Good", warn: "Needs improvement", bad: "Poor", info: "", quiet: "" };

/** The desk's own lines for a rate of checks that passed (uptime, the other addresses). */
export const PASS_RULE = { good: 99.5, warn: 98 };
/** For the scheduler's runs. */
export const RUN_RULE = { good: 98, warn: 90 };
/** For the share of checks that failed. */
export const ERROR_RULE = { good: 0.5, warn: 2 };

/** A Stat's rate in percent, whether it came as a percentage or as two counts. */
export function ratePercent(s: Stat): number | null {
  if (s.unit === "percent") return s.value;
  if (s.of != null && s.of > 0) return (s.value / s.of) * 100;
  return null;
}

export function passTone(p: number, rule = PASS_RULE): Tone {
  return p >= rule.good ? "good" : p >= rule.warn ? "warn" : "bad";
}

export function errorTone(p: number): Tone {
  return p <= ERROR_RULE.good ? "good" : p <= ERROR_RULE.warn ? "warn" : "bad";
}

/** The tile chip for a rate reading, or nothing when there is no figure. */
export function rateChip(r: Reading<Stat>, kind: "pass" | "runs" | "errors"): { tone: Tone; text: string } | null {
  if (r.state !== "ok") return null;
  const p = ratePercent(r.value);
  if (p === null) return null;
  if (kind === "errors") {
    const t = errorTone(p);
    return { tone: t, text: t === "good" ? "Good" : t === "warn" ? "Elevated" : "High" };
  }
  const t = passTone(p, kind === "runs" ? RUN_RULE : PASS_RULE);
  return { tone: t, text: t === "good" ? "Healthy" : t === "warn" ? "Degraded" : "Failing" };
}

/** Where a vital falls against Google's thresholds. */
export function vitalTone(value: number, good: number, poor: number): Tone {
  return value <= good ? "good" : value <= poor ? "warn" : "bad";
}

/** "since 12:13" today, "since 2 Oct 2026" before. */
export function sinceText(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const z = zurich(iso);
  const n = zurich(new Date());
  if (!z || !n) return null;
  /* A bare day ("2026-09-30") is a calendar day, not an instant. */
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return `since ${fullDate(iso)}`;
  return z.key === n.key ? `since ${clock(iso)} today` : `since ${fullDate(iso)}`;
}

/**
 * Vercel's region codes, as Vercel publishes them, for the Infrastructure
 * panel. A code not listed is printed as it is.
 */
const REGIONS: Record<string, string> = {
  arn1: "Stockholm",
  bom1: "Mumbai",
  cdg1: "Paris",
  cle1: "Cleveland",
  cpt1: "Cape Town",
  dub1: "Dublin",
  dxb1: "Dubai",
  fra1: "Frankfurt",
  gru1: "São Paulo",
  hkg1: "Hong Kong",
  hnd1: "Tokyo",
  iad1: "Washington",
  icn1: "Seoul",
  kix1: "Osaka",
  lhr1: "London",
  pdx1: "Portland",
  sfo1: "San Francisco",
  sin1: "Singapore",
  syd1: "Sydney",
};

export const regionName = (code: string | null): string | null => (code ? (REGIONS[code] ? `${code} (${REGIONS[code]})` : code) : null);
