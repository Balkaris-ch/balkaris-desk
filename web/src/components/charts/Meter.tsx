import type { CSSProperties } from "react";
import type { Tone } from "@/contract/common";
import { cx } from "@/lib/cx";
import { figure } from "@/lib/format";
import type { Unit } from "@/lib/scale";
import { colorClass, r2, toneColor } from "./series";
import "./charts.css";
import "./meter.css";

export interface MeterProps {
  /** The measured value. Null draws the scale and its thresholds with no fill: nothing was measured. */
  value: number | null;
  /** The edge of "good": 2.5 for LCP in seconds, 200 for INP in ms, 0.1 for CLS. */
  good: number;
  /** The edge of "poor": 4 for LCP, 500 for INP, 0.25 for CLS. */
  poor: number;
  /** What is measured, for a screen reader: "Largest Contentful Paint". */
  label: string;
  /** The end of the scale. By default a quarter past `poor`, so all three zones can be seen. */
  max?: number;
  /** More is better (a score out of 100): good is at or above `good`, poor is below `poor`. */
  higherIsBetter?: boolean;
  /** How the thresholds are printed under their marks. */
  unit?: Unit;
  /** Print the thresholds under their marks. On by default; off for a row too tight for them. */
  ticks?: boolean;
  className?: string;
}

/**
 * Which zone a value is in, as a tone: good, warn (needs improvement) or bad
 * (poor); quiet when there is no value. The chip beside a meter takes its
 * tone from the same call, so the two cannot disagree.
 */
export function meterTone(value: number | null, good: number, poor: number, higherIsBetter = false): Tone {
  if (value === null || !Number.isFinite(value)) return "quiet";
  if (higherIsBetter) return value >= good ? "good" : value >= poor ? "warn" : "bad";
  return value <= good ? "good" : value <= poor ? "warn" : "bad";
}

/**
 * A threshold meter: the boards' Core Web Vitals rows. A bar filled to the
 * measured value, in the colour of the zone it falls in, with a dashed mark
 * at the edge of "good" and a red one at the edge of "poor".
 *
 *   <Meter label="Largest Contentful Paint" value={lcp} good={2.5} poor={4} unit="s" />
 *   <Meter label="Interaction to Next Paint" value={inp} good={200} poor={500} unit="ms" />
 *   <Meter label="Cumulative Layout Shift" value={cls} good={0.1} poor={0.25} unit="ratio" />
 *
 * The thresholds are Google's published ones and are passed in, not kept
 * here: they differ per metric and they are part of what the screen states.
 * The figure and the "Good" chip are the screen's; `meterTone` gives the chip
 * its tone.
 */
export function Meter({ value, good, poor, label, max, higherIsBetter = false, unit = "count", ticks = true, className }: MeterProps) {
  const end = max ?? (higherIsBetter ? Math.max(good, poor) : poor * 1.25);
  const at = (v: number) => r2(Math.max(0, Math.min(1, end > 0 ? v / end : 0)) * 100);
  const v = value !== null && Number.isFinite(value) ? value : null;
  const tone = meterTone(v, good, poor, higherIsBetter);
  const said = v !== null ? `${figure(v, unit)}, ${tone === "good" ? "good" : tone === "warn" ? "needs improvement" : "poor"}` : "not measured";

  return (
    <span className={cx("dk-meter", colorClass(toneColor(tone)), className)} data-ticks={ticks ? "" : undefined} role="img" aria-label={`${label}: ${said}. Good ${higherIsBetter ? "from" : "up to"} ${figure(good, unit)}, poor ${higherIsBetter ? "below" : "above"} ${figure(poor, unit)}.`}>
      <span className="dk-meter-track">{v !== null && <i className="dk-meter-fill" data-over={v > end ? "" : undefined} style={{ width: `${at(v)}%` } as CSSProperties} />}</span>
      <i className="dk-meter-mark" data-edge="good" style={{ left: `${at(good)}%` }} />
      <i className="dk-meter-mark" data-edge="poor" style={{ left: `${at(poor)}%` }} />
      {ticks && (
        <>
          <span className="dk-meter-tick" style={{ left: `${at(good)}%` }}>
            {figure(good, unit)}
          </span>
          <span className="dk-meter-tick" data-edge="poor" style={{ left: `${at(poor)}%` }}>
            {figure(poor, unit)}
          </span>
        </>
      )}
    </span>
  );
}
