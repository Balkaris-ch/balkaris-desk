import type { CSSProperties } from "react";
import type { Tone } from "@/contract/common";
import { cx } from "@/lib/cx";
import { DASH, figure } from "@/lib/format";
import type { Unit } from "@/lib/scale";
import { asColor, colorClass, r2, type ChartColor } from "./series";
import "./charts.css";
import "./funnel.css";

/** One step of a funnel, in the order visitors take them. */
export interface FunnelStep {
  label: string;
  /** How many reached this step. Null when the step is not measured: a dash and no column, and no rate into or out of it. */
  value: number | null;
  /** Optional: a quieter second line under the label, such as the event the step is counted from ("generate_lead"). */
  note?: string;
}

export interface FunnelProps {
  steps: readonly FunnelStep[];
  /** What the funnel shows, for a screen reader. */
  label: string;
  /**
   * How a column's height follows its figure. "log" by default: real funnels
   * here fall by a factor of ten or more per step, and on a straight scale
   * every column after the first would be a line on the floor. The figures
   * and the rates are printed, so the columns only have to show the order of
   * magnitude, and a caption under the funnel says the scale is logarithmic.
   * "linear" when the steps are close enough to compare by eye. On a narrow
   * screen, where the columns become bars beside their printed shares, the
   * bars are always linear, so a bar is as long as the share beside it says.
   */
  scale?: "log" | "linear";
  /** How the figures are printed. */
  unit?: Unit;
  tone?: Tone | ChartColor;
  /**
   * Optional: the fewest a percentage may be worked out from. Below it no
   * percentage is printed, as the desk's rule for small numbers asks: while
   * the first step is under it a column's share reads "5 of 21", and while
   * the step before is under it the gap keeps its arrow and no rate, the two
   * figures either side of the arrow being the counts. Left out, every share
   * and rate is a percentage, as before.
   */
  small?: number;
  className?: string;
}

/* A share or a rate as the boards print it: whole at a hundred, one decimal
   from one percent, two below that. One that is not nothing never prints as
   nothing: under 0.005% it is "<0.01%", since somebody did take the step. */
function pct(part: number, whole: number): string {
  const v = (part / whole) * 100;
  if (v === 0) return "0%";
  if (v > 0 && v < 0.005) return "<0.01%";
  const digits = v >= 99.95 ? 0 : v >= 1 ? 1 : 2;
  const s = v.toFixed(digits);
  return `${digits > 0 ? s.replace(/\.?0+$/, "") : s}%`;
}

/**
 * The boards' Conversion funnel: a column per step with its figure above, its
 * share of the first step below, and between two columns the rate at which
 * one became the other.
 *
 *   <Funnel label="Visitor to booked call" steps={[
 *     { label: "Visitors", value: visitors },
 *     { label: "Contact open", value: opens }, …]} />
 *
 * Every percentage is worked out here from the figures given, so none can
 * disagree with them. The funnel is one of event counts, not of one visitor
 * followed through: a later step can be larger than an earlier one, and then
 * the rate is printed above 100% rather than hidden. On a narrow screen the
 * columns become rows.
 */
export function Funnel({ steps, label, scale = "log", unit = "count", tone, small, className }: FunnelProps) {
  const first = steps[0]?.value ?? null;
  /* Under `small` a percentage would be noise: the counts are printed instead. */
  const few = (base: number) => small !== undefined && base < small;
  const top = Math.max(0, ...steps.map((s) => s.value ?? 0));
  /* A column's height (on the chosen scale, with a floor so a small step is
     still a column) and a row bar's length (always straight, no floor). */
  const height = (v: number) => {
    if (top <= 0 || v <= 0) return 0;
    const h = scale === "log" ? Math.log1p(v) / Math.log1p(top) : v / top;
    return r2(Math.max(0.04, Math.min(1, h)));
  };
  const length = (v: number) => (top <= 0 || v <= 0 ? 0 : Math.min(1, v / top));
  const log = scale === "log" && steps.some((s) => s.value !== null && s.value > 0);

  return (
    <div className={cx("dk-funnel", colorClass(asColor(tone)), className)}>
      <ol className="dk-funnel-list" aria-label={label}>
        {steps.map((s, i) => {
          const before = i > 0 ? (steps[i - 1]?.value ?? null) : null;
          const measured = i > 0 && s.value !== null && before !== null && before > 0;
          const counted = measured && few(before!);
          const rate = measured && !counted ? pct(s.value!, before!) : null;
          const share = s.value !== null && first !== null && first > 0 ? (few(first) ? `${figure(s.value, unit)} of ${figure(first, unit)}` : pct(s.value, first)) : null;
          return (
            <li key={`${s.label}-${i}`} className="dk-funnel-step">
              {i > 0 && (
                <span className="dk-funnel-rate" data-none={rate === null && !counted ? "" : undefined} title={counted ? `${figure(before!, unit)} → ${figure(s.value!, unit)}` : undefined}>
                  <svg className="dk-funnel-arrow" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                    <path d="M1.5 6h9M7 2.5 10.5 6 7 9.5" />
                  </svg>
                  {rate !== null && (
                    <>
                      <b>{rate}</b>
                      <span className="dk-chart-sr"> of the step before</span>
                    </>
                  )}
                  {counted && <span className="dk-chart-sr">{`${figure(s.value!, unit)} after ${figure(before!, unit)} in the step before`}</span>}
                </span>
              )}
              <span className="dk-funnel-label">
                {s.label}
                {s.note ? (
                  <small className="dk-funnel-note" title={s.note}>
                    {s.note}
                  </small>
                ) : null}
              </span>
              <b className="dk-funnel-figure">{s.value === null ? DASH : figure(s.value, unit)}</b>
              <span className="dk-funnel-col" aria-hidden="true">
                {s.value !== null && s.value > 0 && (
                  <>
                    {/* A column that nearly fills its room leaves the stem no length for a head. */}
                    <i className="dk-funnel-stem" data-room={height(s.value) < 0.8 ? "" : undefined} />
                    <i className="dk-funnel-bar" style={{ "--h": height(s.value), "--w": length(s.value) } as CSSProperties} />
                  </>
                )}
              </span>
              <span className="dk-funnel-share">
                {share ?? DASH}
                {share !== null && !few(first ?? 0) && <span className="dk-chart-sr"> of the first step</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {log && <p className="dk-funnel-scale">Column heights on a logarithmic scale.</p>}
    </div>
  );
}
