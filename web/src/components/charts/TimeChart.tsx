import type { CSSProperties } from "react";
import { cx } from "@/lib/cx";
import { DASH, figure } from "@/lib/format";
import { linear, niceTicks, type Unit } from "@/lib/scale";
import type { HoverPoint, HoverRow } from "./ChartHover";
import { Frame } from "./Frame";
import { align, areaPolygons, colorClass, linePath, r2, runs, slotColor, summarise, xAt, xLabel, type ChartColor, type ChartData } from "./series";
import "./time-chart.css";

/**
 * Lines over time: the drawing behind AreaChart and LineChart.
 *
 * Straight segments with round joins and a small ringed dot on each point, as
 * the boards draw them. Nothing is smoothed: a curve between two readings
 * would show values nobody measured.
 *
 * THE EDGE CASES ARE THE NORMAL CASES HERE. Measurement began in late
 * September 2026, so for months a "30 day" series is only days long, the
 * previous period is mostly empty, and counts are a handful.
 *   no reading at all   the frame and one sentence; no axis numbers, no line
 *   every reading zero  the baseline and one sentence; a flat line along the
 *                       floor of an empty plot would look like a chart of
 *                       something
 *   one reading         its dot, in the middle, on a real axis
 *   a null              a gap in the line, "—" in the tooltip; never a zero
 *   whole things        whole ticks: no "0.5 visitors"
 */

/** One line on the chart. */
export interface ChartSeries {
  /** Its name in the tooltip (and in the legend the screen places beside the chart). */
  label: string;
  /** Oldest first: numbers, or dated points such as the contract's `DayPoint[]`. */
  data: ChartData;
  /** Its colour. By default the series slots in order: s1, s2, s3. */
  color?: ChartColor;
}

export interface TimeChartProps {
  /**
   * One to three series. A bare `number[]` or `DayPoint[]` is taken as one
   * series named by `label`. All series share the one y axis and the one
   * `unit`, so they must be the same quantity in the same unit; two
   * quantities are a ComboChart, and three units (Site Health's Performance
   * trend: LCP in s, INP in ms, CLS as a ratio) are three LineCharts, one per
   * metric, never one axis stretched to fit them all.
   */
  series: readonly ChartSeries[] | ChartData;
  /** What the chart shows ("Visitors per day"): the screen reader's name for it, and a lone series' name. */
  label: string;
  /**
   * The x axis: days (YYYY-MM-DD), timestamps, or labels, oldest first.
   * With plain numbers it labels the points, the newest number at the last
   * entry (and numbers older than its first entry are not drawn). With dated
   * points it is the window shown: each point stands on its own date, and a
   * point whose date is not on `x` is left out. Left out with dated points,
   * the axis is every date the series carry, every day from the oldest to
   * the newest, so series that end on different days (Search Console lags
   * GA4) each end on their own day.
   */
  x?: readonly string[];
  /**
   * The first series one period earlier, drawn as a dashed line; nulls are
   * gaps, and a previous period with no reading at all is not drawn (nor
   * listed in the tooltip). `DayPoint.previous` is picked up by itself, so
   * this is only for plain numbers.
   */
  previous?: readonly (number | null)[];
  /** What the dashed line is called in the tooltip. */
  previousLabel?: string;
  /**
   * The newest `n` points are still being counted (GA4's last day or two,
   * Search Console's last three). They are drawn dashed and dimmer and the
   * tooltip says so.
   */
  provisional?: number;
  /** The tooltip's sentence on a provisional point. */
  provisionalNote?: string;
  /** How a value is printed: in full in the tooltip, shortened on the axis. */
  unit?: Unit;
  /** The values are whole things. By default true when the unit is a count and every value is whole. */
  integer?: boolean;
  /** The plot's height in px, or "fill". Default: the `--chart-h` token. */
  height?: number | "fill";
  /** What is under a line: the boards' gradient, a faint wash, or nothing. */
  fill?: "area" | "soft" | "none";
  /** Shown in the plot when there is not one reading. */
  emptyNote?: string;
  /** Shown in the plot when every reading is zero. */
  zeroNote?: string;
  className?: string;
}

const isSeriesList = (s: TimeChartProps["series"]): s is readonly ChartSeries[] => s.length > 0 && typeof s[0] === "object" && s[0] !== null && "data" in s[0];

/* The `previous` prop is plain numbers: lined up at the newest point, like the series. */
function padStart<T>(list: readonly T[], n: number, fill: T): T[] {
  return list.length >= n ? list.slice(list.length - n) : [...Array<T>(n - list.length).fill(fill), ...list];
}

export function TimeChart({
  series,
  label,
  x,
  previous,
  previousLabel = "Previous period",
  provisional = 0,
  provisionalNote = "Still being counted. This figure may still change.",
  unit = "count",
  integer,
  height,
  fill = "area",
  emptyNote = "No readings in this period yet.",
  zeroNote = "Nothing was recorded in this period: every reading is zero.",
  className,
}: TimeChartProps) {
  const given: readonly ChartSeries[] = isSeriesList(series) ? series : series.length > 0 ? [{ label, data: series as ChartData }] : [];
  /* Every series on one axis, each value on its own date (see `align`). */
  const lined = align(
    given.map((s) => s.data),
    x,
  );
  const n = lined.x?.length ?? lined.values[0]?.length ?? 0;

  const lines = given.map((s, i) => ({
    label: s.label,
    color: colorClass(s.color ?? slotColor(i)),
    values: lined.values[i]!,
  }));
  const padded = previous ? padStart(previous.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null)), n, null) : (lined.previous[0] ?? null);
  /* While the period before was never measured (GA4's `previous` is null on
     every day for the first weeks), there is no previous period to draw or to
     list in the tooltip: a row of dashes on every point would only be noise. */
  const prev = padded && padded.some((v) => v !== null) ? padded : null;

  const xs = Array.from({ length: n }, (_, i) => xAt(i, n));
  const names = lined.x ? lined.x.map(xLabel) : null;
  const xText = names ? names.map((l) => l.short) : null;

  const sum = summarise([...lines.map((l) => l.values), ...(prev ? [prev] : [])]);
  const own = summarise(lines.map((l) => l.values));

  /* Nothing was read: say so, and draw no scale for values that do not exist. */
  if (own.count === 0) {
    return <Frame label={label} height={height} left={null} xs={xs} xText={xText} note={emptyNote} className={className} />;
  }

  const whole = integer ?? (unit === "count" && sum.whole);
  const ticks = niceTicks(sum.lo, sum.hi, { integer: whole });
  const axis = { ticks, unit };

  /* Every reading is zero: the baseline is the whole truth. */
  if (own.allZero && (!prev || summarise([prev]).allZero || summarise([prev]).count === 0)) {
    return <Frame label={label} height={height} left={{ ticks: { ...ticks, max: ticks.step, ticks: [0] }, unit }} xs={xs} xText={xText} note={zeroNote} className={className} />;
  }

  const y = linear(ticks.min, ticks.max, 100, 0);
  const base = r2(y(Math.max(ticks.min, Math.min(0, ticks.max))));
  const soft = Math.max(0, Math.min(provisional, n - 1));
  /* The provisional stretch begins at the last settled point, so the dashed part joins the solid one. */
  const settled = n - 1 - soft;

  const drawn = lines.map((l) => {
    const ys = l.values.map((v) => (v === null ? null : r2(y(v))));
    return { ...l, ys };
  });
  const prevYs = prev ? prev.map((v) => (v === null ? null : r2(y(v)))) : null;

  const dots = n <= 16 ? "all" : n <= 45 ? "wide" : "last";

  const hover: HoverPoint[] = xs.map((px, i) => {
    const rows: HoverRow[] = drawn.map((l) => ({ label: l.label, text: l.values[i] === null ? DASH : figure(l.values[i], unit), color: l.color, y: l.ys[i] ?? null }));
    if (prev) rows.push({ label: previousLabel, text: prev[i] === null ? DASH : figure(prev[i], unit), color: "dk-tc-prev-key", y: null, dashed: true });
    return { x: px, title: names ? names[i]!.long : `${i + 1} of ${n}`, rows, note: soft > 0 && i > settled ? provisionalNote : undefined };
  });

  return (
    <Frame label={label} height={height} left={axis} xs={xs} xText={xText} hover={hover} dots={dots} className={cx("dk-tc", className)}>
      {fill !== "none" &&
        drawn.flatMap((l, k) => [
          ...areaPolygons(xs, l.ys, base, 0, settled).map((p, j) => <div key={`a${k}-${j}`} className={cx("dk-tc-area", l.color)} data-fill={fill} style={{ clipPath: p } as CSSProperties} />),
          ...(soft > 0 ? areaPolygons(xs, l.ys, base, settled, n - 1).map((p, j) => <div key={`p${k}-${j}`} className={cx("dk-tc-area", l.color)} data-fill={fill} data-provisional="" style={{ clipPath: p } as CSSProperties} />) : []),
        ])}
      <svg className="dk-tc-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        {prevYs && <path className="dk-tc-prev" d={linePath(xs, prevYs)} />}
        {drawn.map((l, k) => (
          <g key={k} className={l.color}>
            <path className="dk-tc-line" d={linePath(xs, l.ys, 0, settled)} />
            {soft > 0 && <path className="dk-tc-line" data-provisional="" d={linePath(xs, l.ys, settled, n - 1)} />}
          </g>
        ))}
      </svg>
      {drawn.flatMap((l, k) => {
        const alone = new Set(runs(l.ys).filter(([a, b]) => a === b).map(([a]) => a));
        const newest = l.ys.findLastIndex((v) => v !== null);
        return l.ys.map((py, i) =>
          py === null ? null : (
            <i
              key={`d${k}-${i}`}
              className={cx("dk-tc-dot", l.color)}
              /* A reading with no neighbour has no line: its dot is all there is, so it always shows. */
              data-keep={i === newest || alone.has(i) ? "" : undefined}
              data-alt={(newest - i) % 2 === 1 ? "" : undefined}
              data-provisional={soft > 0 && i > settled ? "" : undefined}
              style={{ left: `${xs[i]}%`, top: `${py}%` }}
            />
          ),
        );
      })}
    </Frame>
  );
}
