import type { CSSProperties } from "react";
import type { Tone } from "@/contract/common";
import { cx } from "@/lib/cx";
import { linear } from "@/lib/scale";
import { areaPolygons, asColor, colorClass, linePath, normalise, r2, runs, summarise, xAt, type ChartColor, type ChartData } from "./series";
import "./charts.css";
import "./spark.css";

export interface SparkProps {
  /** Oldest first: numbers, `Stat.series`, or dated points. A null is a gap. */
  data: ChartData;
  /** Green by default. Pass the figure's tone ("bad" for a rising error count) or a series colour. */
  tone?: Tone | ChartColor;
  /** "tile" is the line beside a tile's figure; "row" is the small one in a table row. */
  size?: "tile" | "row";
  /**
   * Where the bottom of the spark is. "zero": the line's height is the size
   * of the value, so 100 to 105 looks as flat as it is. "min": the lowest
   * reading, for figures that never come near zero (an uptime close to 100%).
   */
  floor?: "zero" | "min";
  /** The soft area under the line. On by default, as the boards draw it. */
  area?: boolean;
  /** What it shows, for a screen reader. Left out, the spark is decoration beside a figure that says it. */
  label?: string;
  className?: string;
}

/**
 * A sparkline: the shape of a figure's recent history, with no axis and no
 * numbers. The boards' tile sparks and the tiny ones in the API routes table.
 *
 *   <Spark data={stat.series} />
 *   <Spark data={row.requests} size="row" />
 *
 * With no readings it is a dashed baseline, with one reading a single dot,
 * and when every reading is zero a grey line along the floor with no area:
 * none of the three can be mistaken for a trend.
 */
export function Spark({ data, tone, size = "tile", floor = "zero", area = true, label, className }: SparkProps) {
  const { values } = normalise(data);
  const sum = summarise([values]);
  const n = values.length;
  const state = sum.count === 0 ? "empty" : sum.allZero ? "zero" : sum.count === 1 ? "one" : "line";

  const lo = floor === "zero" ? Math.min(0, sum.lo) : sum.lo;
  const hi = floor === "zero" ? Math.max(0, sum.hi) : sum.hi;
  const y = linear(lo, hi, 100, 0);
  const xs = values.map((_, i) => xAt(i, n));
  const ys = values.map((v) => (v === null ? null : r2(y(v))));
  /* A reading with no neighbour has no line to be on; it gets a dot. */
  const alone = state === "line" || state === "one" ? runs(ys).filter(([a, b]) => a === b).map(([a]) => a) : [];

  return (
    <span className={cx("dk-spark", `dk-spark--${size}`, colorClass(asColor(tone)), className)} data-state={state} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {state === "line" && area && areaPolygons(xs, ys, 100).map((p, i) => <span key={i} className="dk-spark-area" style={{ clipPath: p } as CSSProperties} />)}
      {state === "line" && (
        <svg className="dk-spark-svg" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
          <path className="dk-spark-line" d={linePath(xs, ys)} />
        </svg>
      )}
      {alone.map((i) => (
        <i key={i} className="dk-spark-dot" style={{ left: `${xs[i]}%`, top: `${ys[i]}%` }} />
      ))}
    </span>
  );
}
