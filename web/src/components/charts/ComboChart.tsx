import { cx } from "@/lib/cx";
import { DASH, figure } from "@/lib/format";
import { fixedTicks, linear, niceTicks, type Unit } from "@/lib/scale";
import type { HoverPoint } from "./ChartHover";
import { Frame, type Axis } from "./Frame";
import { align, areaPolygons, colorClass, linePath, r2, runs, summarise, xAt, xLabel, type ChartColor, type ChartData } from "./series";
import "./time-chart.css";
import "./combo-chart.css";

/** One of the two quantities on a ComboChart. */
export interface ComboSeries {
  /** Its name in the tooltip and the legend. */
  label: string;
  /** Oldest first: numbers, or dated points such as `DayPoint[]`. */
  data: ChartData;
  color?: ChartColor;
  /** How its values are printed. Default "count". */
  unit?: Unit;
}

export interface ComboChartProps {
  /** What the chart shows, for a screen reader. */
  label: string;
  /** The columns. Read on the left axis. Counts or other values from zero up. */
  bars: ComboSeries;
  /** The line over them. Read on the right axis, or on the same one with `axes="shared"`. */
  line: ComboSeries;
  /**
   * The x axis, oldest first. With plain numbers it labels the points (the
   * newest number at the last entry); with dated points it is the window
   * shown, each point on its own date. Left out with dated points, the axis
   * is every day the two series carry, so columns that end two days before
   * the line (Search Console beside GA4) end on their own day. See `align`.
   */
  x?: readonly string[];
  /**
   * "two": the bars and the line are different quantities (clicks and
   * impressions), each with its own axis and the same grid lines.
   * "shared": the same quantity (form submissions and booked calls), one axis.
   */
  axes?: "two" | "shared";
  /** The boards' gradient under the line (Conversions over time). */
  lineFill?: boolean;
  /** The newest `n` points are still being counted: drawn dimmer, and the tooltip says so. */
  provisional?: number;
  provisionalNote?: string;
  /** The plot's height in px, or "fill". */
  height?: number | "fill";
  emptyNote?: string;
  zeroNote?: string;
  className?: string;
}

/**
 * Columns and a line in one plot: the boards' Search Console overview (clicks
 * as columns, impressions as a line, an axis on each side) and Conversions
 * over time (a line with its area, columns under it, one axis).
 *
 *   <ComboChart label="Clicks and impressions" x={days} provisional={3}
 *     bars={{ label: "Clicks", data: clicks }}
 *     line={{ label: "Impressions", data: impressions, color: "ink" }} />
 *
 * With two axes both have the same number of steps, so one set of grid lines
 * serves both and neither series is squeezed to fit the other's numbers.
 */
export function ComboChart({
  label,
  bars,
  line,
  x,
  axes = "two",
  lineFill = false,
  provisional = 0,
  provisionalNote = "Still being counted. This figure may still change.",
  height,
  emptyNote = "No readings in this period yet.",
  zeroNote = "Nothing was recorded in this period: every reading is zero.",
  className,
}: ComboChartProps) {
  /* Both series on one axis, each value on its own date. */
  const lined = align([bars.data, line.data], x);
  const barValues = lined.values[0]!;
  const lineValues = lined.values[1]!;
  const n = lined.x?.length ?? barValues.length;

  const xs = Array.from({ length: n }, (_, i) => xAt(i, n, true));
  const names = lined.x ? lined.x.map(xLabel) : null;
  const xText = names ? names.map((d) => d.short) : null;

  const barSum = summarise([barValues]);
  const lineSum = summarise([lineValues]);
  const barUnit = bars.unit ?? "count";
  const lineUnit = axes === "shared" ? barUnit : (line.unit ?? "count");

  if (barSum.count + lineSum.count === 0) {
    return <Frame label={label} height={height} left={null} xs={xs} xText={xText} note={emptyNote} className={className} />;
  }
  if ((barSum.count === 0 || barSum.allZero) && (lineSum.count === 0 || lineSum.allZero)) {
    return <Frame label={label} height={height} left={{ ticks: { min: 0, max: 1, step: 1, ticks: [0] }, unit: barUnit }} xs={xs} xText={xText} note={zeroNote} className={className} />;
  }

  let left: Axis;
  let right: Axis | null = null;
  if (axes === "shared") {
    const both = summarise([barValues, lineValues]);
    left = { ticks: niceTicks(0, both.hi, { integer: barUnit === "count" && both.whole }), unit: barUnit };
  } else {
    left = { ticks: niceTicks(0, barSum.count ? barSum.hi : 1, { integer: barUnit === "count" && barSum.whole }), unit: barUnit };
    if (lineSum.count > 0) {
      right = { ticks: fixedTicks(lineSum.hi, left.ticks.ticks.length - 1, lineUnit === "count" && lineSum.whole), unit: lineUnit };
    }
  }

  const yBar = linear(left.ticks.min, left.ticks.max, 100, 0);
  const yLine = right ? linear(right.ticks.min, right.ticks.max, 100, 0) : yBar;
  const lineYs = lineValues.map((v) => (v === null ? null : r2(yLine(v))));
  const barColor = colorClass(bars.color ?? "s1");
  const lineColor = colorClass(line.color ?? (lineFill ? "s1" : "ink"));
  const width = r2((100 / Math.max(1, n)) * 0.66);
  const soft = Math.max(0, Math.min(provisional, n - 1));
  const settled = n - 1 - soft;

  const hover: HoverPoint[] = xs.map((px, i) => ({
    x: px,
    title: names ? names[i]!.long : `${i + 1} of ${n}`,
    rows: [
      { label: bars.label, text: barValues[i] === null ? DASH : figure(barValues[i], barUnit), color: barColor, y: barValues[i] === null ? null : r2(yBar(barValues[i]!)) },
      { label: line.label, text: lineValues[i] === null ? DASH : figure(lineValues[i], lineUnit), color: lineColor, y: lineYs[i] ?? null },
    ],
    note: soft > 0 && i > settled ? provisionalNote : undefined,
  }));

  const alone = new Set(runs(lineYs).filter(([a, z]) => a === z).map(([a]) => a));
  const newest = lineYs.findLastIndex((v) => v !== null);

  return (
    <Frame label={label} height={height} left={left} right={right} xs={xs} xText={xText} hover={hover} dots={n <= 16 ? "all" : n <= 45 ? "wide" : "last"} className={cx("dk-combo", className)}>
      {lineFill && areaPolygons(xs, lineYs, 100).map((p, j) => <div key={`a${j}`} className={cx("dk-tc-area", lineColor)} data-fill="area" style={{ clipPath: p }} />)}
      {barValues.map((v, i) =>
        v === null || v <= 0 ? null : (
          <i
            key={`b${i}`}
            className={cx("dk-combo-bar", barColor)}
            data-provisional={soft > 0 && i > settled ? "" : undefined}
            style={{ left: `${r2(xs[i]! - width / 2)}%`, width: `${width}%`, height: `${r2(100 - yBar(v))}%` }}
          />
        ),
      )}
      <svg className={cx("dk-tc-lines", lineColor)} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path className="dk-tc-line" d={linePath(xs, lineYs, 0, settled)} />
        {soft > 0 && <path className="dk-tc-line" data-provisional="" d={linePath(xs, lineYs, settled, n - 1)} />}
      </svg>
      {lineYs.map((py, i) =>
        py === null ? null : (
          <i
            key={`d${i}`}
            className={cx("dk-tc-dot", lineColor)}
            data-keep={i === newest || alone.has(i) ? "" : undefined}
            data-alt={(newest - i) % 2 === 1 ? "" : undefined}
            data-provisional={soft > 0 && i > settled ? "" : undefined}
            style={{ left: `${xs[i]}%`, top: `${py}%` }}
          />
        ),
      )}
    </Frame>
  );
}
