import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import { formatTick, linear, thinTiers, type Ticks, type Unit } from "@/lib/scale";
import { ChartHover, type HoverPoint } from "./ChartHover";
import { r2 } from "./series";
import "./charts.css";
import "./frame.css";

/**
 * The plot every chart with an x and a y stands in: tick labels, grid lines,
 * x labels, and the hover layer. AreaChart, LineChart and ComboChart draw
 * their marks inside it; a screen never uses it directly.
 *
 * HOW IT STAYS SHARP AT ANY WIDTH. Lines are an SVG stretched over the plot
 * (viewBox 0 0 100 100, no aspect ratio kept, strokes that do not scale), so
 * geometry is percentages and needs no measuring. Everything that is type is
 * HTML laid over it by percentage, so a tick label is never stretched.
 */

/** One y axis: its ticks and how they are printed. */
export interface Axis {
  ticks: Ticks;
  unit: Unit;
}

export interface FrameProps {
  /** What the chart shows, for a screen reader. */
  label: string;
  /** The plot's height in px, or "fill" to take what the parent gives. Default: the `--chart-h` token. */
  height?: number | "fill";
  /** The left axis. Null when there is nothing to scale (no readings). */
  left: Axis | null;
  /** A second axis on the right, for a chart of two different quantities. */
  right?: Axis | null;
  /** Where each point stands, percent from the left. */
  xs: readonly number[];
  /** The short label of each point ("Sep 3"), or null when the points are not dated. */
  xText: readonly string[] | null;
  /** What the tooltip says at each point. Left out, the chart has no hover. */
  hover?: readonly HoverPoint[];
  /** A sentence shown in the plot instead of marks. */
  note?: string | null;
  /**
   * Which points keep their dot: every one; every second one (counted from
   * the newest) while the chart is wide and only the newest when it is
   * narrow; or only the newest. A reading with no neighbour always keeps its
   * dot, since it has no line.
   */
  dots?: "all" | "wide" | "last";
  className?: string;
  children?: ReactNode;
}

function TickColumn({ axis, side }: { axis: Axis; side: "left" | "right" }) {
  const { ticks, unit } = axis;
  const y = linear(ticks.min, ticks.max, 100, 0);
  const labels = ticks.ticks.map((t) => formatTick(t, ticks.step, unit));
  /* The labels hang at their heights and so have no width of their own. The
     longest one, printed unseen, gives the column its width. */
  const widest = labels.reduce((a, b) => (b.length > a.length ? b : a), "");
  return (
    <div className={cx("dk-frame-y", side === "right" && "dk-frame-y--right")} aria-hidden="true">
      <span className="dk-frame-y-size">{widest}</span>
      {ticks.ticks.map((t, i) => (
        <span key={t} className="dk-frame-y-tick" style={{ top: `${r2(y(t))}%` }}>
          {labels[i]}
        </span>
      ))}
    </div>
  );
}

export function Frame({ label, height, left, right = null, xs, xText, hover, note, dots = "wide", className, children }: FrameProps) {
  const axis = left ?? right;
  const y = axis ? linear(axis.ticks.min, axis.ticks.max, 100, 0) : null;
  /* The solid line is zero when zero is on the axis, and the axis' foot when it is not. */
  const base = axis && y && axis.ticks.min < 0 && axis.ticks.max > 0 ? r2(y(0)) : 100;
  const tiers = xText ? thinTiers(xs.length) : [];

  let grid = "";
  if (axis && y) for (const t of axis.ticks.ticks) if (r2(y(t)) !== base) grid += `M0 ${r2(y(t))}H100`;
  for (const { index } of tiers) if (xs[index] !== 0) grid += `M${xs[index]} 0V100`;

  return (
    <figure className={cx("dk-frame", right && "dk-frame--right", height === "fill" && "dk-frame--fill", className)} data-dots={dots} aria-label={label}>
      {left && <TickColumn axis={left} side="left" />}
      <div className="dk-frame-plot" style={typeof height === "number" ? { height } : undefined}>
        {grid && (
          <svg className="dk-frame-grid" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <path className="dk-frame-gridline" d={grid} />
          </svg>
        )}
        {children}
        {/* The axes are drawn after the marks: an area must not paint over its own baseline. */}
        <svg className="dk-frame-grid dk-frame-axes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path className="dk-frame-axis" d={`M0 0V100M0 ${base}H100`} />
        </svg>
        {note && <p className="dk-chart-note dk-frame-note">{note}</p>}
        {hover && hover.length > 0 && !note && <ChartHover points={hover} label={label} />}
      </div>
      {right && <TickColumn axis={right} side="right" />}
      {xText && (
        <div className="dk-frame-x" aria-hidden="true">
          {tiers.map(({ index, tier }) => (
            <span key={index} data-tier={tier} style={{ left: `${xs[index]}%` }}>
              {xText[index]}
            </span>
          ))}
        </div>
      )}
    </figure>
  );
}
