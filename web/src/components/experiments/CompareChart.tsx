import type { ComparePoint } from "@/contract/experiments";
import type { HoverPoint } from "@/components/charts/ChartHover";
import { Frame } from "@/components/charts/Frame";
import { colorClass, linePath, r2, xAt, xLabel, type ChartColor } from "@/components/charts/series";
import { cx } from "@/lib/cx";
import { DASH, duration, num } from "@/lib/format";
import { linear, niceTicks } from "@/lib/scale";

/**
 * One figure, day by day, across a before/after comparison.
 *
 * Composed from the charts' own Frame (axes, x labels, the hover layer), so
 * it reads like every other chart on the desk, with three things a time chart
 * has no words for:
 *
 *   the two windows   a faint band behind each, before in blue, after in green
 *   the change        a dashed vertical rule on its day, which belongs to
 *                     neither window and so has no colour of its own
 *   the averages      a dashed level across each window: the figure the
 *                     comparison compares, so the eye compares the same thing
 *
 * Nothing is smoothed and nothing is filled in: a day with no figure (time
 * per visitor on a day nobody came) is a gap.
 */

const BEFORE: ChartColor = "s2";
const AFTER: ChartColor = "s1";
const CHANGE: ChartColor = "grey";

export interface CompareChartProps {
  points: readonly ComparePoint[];
  unit: "count" | "s";
  /** What the chart shows, for a screen reader and the tooltip. */
  label: string;
  /** The level drawn across each window, in the figure's unit, or null for none. */
  means: { before: number | null; after: number | null };
  /** How many of the newest days GA4 may still change. */
  provisional: number;
  height?: number;
}

const say = (v: number | null, unit: "count" | "s"): string => (v === null ? DASH : unit === "s" ? duration(v * 1000) : num(v, Number.isInteger(v) ? 0 : 1));

export function CompareChart({ points, unit, label, means, provisional, height = 196 }: CompareChartProps) {
  const n = points.length;
  const xs = points.map((_, i) => xAt(i, n));
  const xText = points.map((p) => xLabel(p.date).short);
  const values = points.map((p) => p.value);
  const real = values.filter((v): v is number => v !== null);

  if (real.length === 0) {
    return <Frame label={label} height={height} left={null} xs={xs} xText={xText} note="No figure on any of these days." />;
  }

  const levels = [means.before, means.after].filter((v): v is number => v !== null && Number.isFinite(v));
  const whole = unit === "count" && real.every((v) => Number.isInteger(v));
  const ticks = niceTicks(Math.min(0, ...real, ...levels), Math.max(...real, ...levels), { integer: whole });
  const y = linear(ticks.min, ticks.max, 100, 0);
  const ys = values.map((v) => (v === null ? null : r2(y(v))));
  /* Every day zero: the baseline and one sentence, as the desk's other charts say it; a flat line on an empty plot would look like a chart of something. */
  const allZero = real.every((v) => v === 0);

  const first = (side: ComparePoint["side"]) => points.findIndex((p) => p.side === side);
  const last = (side: ComparePoint["side"]) => points.findLastIndex((p) => p.side === side);
  const half = n > 1 ? 50 / (n - 1) : 50;
  const band = (side: "before" | "after") => {
    const a = first(side);
    const b = last(side);
    if (a < 0) return null;
    const left = Math.max(0, (xs[a] as number) - half);
    const right = Math.min(100, (xs[b] as number) + half);
    return { a, b, left: r2(left), width: r2(right - left) };
  };
  const bands = { before: band("before"), after: band("after") };
  const change = first("change");
  const soft = Math.max(0, Math.min(provisional, n));

  const colorOf = (side: ComparePoint["side"]) => (side === "before" ? BEFORE : side === "after" ? AFTER : CHANGE);
  const sideName = (side: ComparePoint["side"]) => (side === "before" ? "Before" : side === "after" ? "After" : "Day of the change");

  const hover: HoverPoint[] = points.map((p, i) => ({
    x: xs[i] as number,
    title: xLabel(p.date).long,
    rows: [{ label: sideName(p.side), text: say(p.value, unit), color: colorClass(colorOf(p.side)), y: ys[i] ?? null }],
    note:
      p.side === "change"
        ? "The change was made on this day, so it belongs to neither window."
        : i >= n - soft
          ? "Still being processed by GA4. This figure may change."
          : undefined,
  }));

  const marks = (
    <>
      {(["before", "after"] as const).map((side) => {
        const b = bands[side];
        return b ? <div key={side} className={cx("dk-experiments-band", colorClass(colorOf(side)))} style={{ left: `${b.left}%`, width: `${b.width}%` }} /> : null;
      })}
      {change >= 0 ? (
        <div className="dk-experiments-rule" style={{ left: `${xs[change]}%` }}>
          <span className="dk-experiments-rule-label">Change</span>
        </div>
      ) : null}
    </>
  );

  if (allZero) {
    return (
      <Frame
        label={label}
        height={height}
        left={{ ticks: { ...ticks, max: ticks.step, ticks: [0] }, unit }}
        xs={xs}
        xText={xText}
        note="Nothing was recorded on any of these days: every day is zero."
        className="dk-experiments-chart"
      >
        {marks}
      </Frame>
    );
  }

  return (
    <Frame label={label} height={height} left={{ ticks, unit }} xs={xs} xText={xText} hover={hover} dots="all" className="dk-experiments-chart">
      {marks}
      <svg className="dk-experiments-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        {/* The whole stretch, faint, so the days around the change still read as one line. */}
        <path className="dk-experiments-bridge" d={linePath(xs, ys)} />
        {(["before", "after"] as const).map((side) => {
          const b = bands[side];
          if (!b) return null;
          const level = means[side];
          const ly = level !== null && Number.isFinite(level) ? r2(y(level)) : null;
          return (
            <g key={side} className={colorClass(colorOf(side))}>
              <path className="dk-experiments-line" d={linePath(xs, ys, b.a, b.b)} />
              {ly !== null ? <path className="dk-experiments-mean" d={`M${b.left} ${ly}H${r2(b.left + b.width)}`} /> : null}
            </g>
          );
        })}
      </svg>
      {points.map((p, i) =>
        ys[i] === null || ys[i] === undefined ? null : (
          <i
            key={p.date}
            className={cx("dk-experiments-dot", colorClass(colorOf(p.side)))}
            data-side={p.side}
            data-provisional={i >= n - soft ? "" : undefined}
            style={{ left: `${xs[i]}%`, top: `${ys[i]}%` }}
          />
        ),
      )}
    </Frame>
  );
}
