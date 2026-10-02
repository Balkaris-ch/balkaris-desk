import type { CSSProperties } from "react";
import type { Tone } from "@/contract/common";
import { cx } from "@/lib/cx";
import { asColor, colorClass, normalise, r2, summarise, type ChartColor, type ChartData } from "./series";
import "./charts.css";
import "./spark-bars.css";

export interface SparkBarsProps {
  /**
   * Oldest first: numbers, `Stat.series`, or dated points. Values from zero
   * up. Any length: a series longer than the bars that fit (32 in a tile, 21
   * in a row) is folded into equal buckets of consecutive days counted back
   * from the newest, one bar each (see `foldBars`).
   */
  data: ChartData;
  /** Green by default. The boards also draw them red (a count of problems), violet and grey. */
  tone?: Tone | ChartColor;
  /** "tile" beside a tile's figure; "row" in a table row or under a small figure. */
  size?: "tile" | "row";
  /** Older bars sink toward grey and the newest are in full colour, as on the boards. On by default. */
  fade?: boolean;
  /** What it shows, for a screen reader. Left out, the bars are decoration beside a figure that says it. */
  label?: string;
  className?: string;
}

/* How many bars fit, and from how many the gaps narrow, so that every bar
   keeps at least two pixels at the `--spark-w` and `--spark-row-w` widths:
   a tile is 96px (19 bars with 3px gaps, 32 with 1px), a row 64px (16 with
   2px gaps, 21 with 1px). Change these with those tokens. */
const SLOTS = { tile: 32, row: 21 } as const;
const DENSE = { tile: 19, row: 16 } as const;

/**
 * A series folded to at most `slots` bars. Buckets hold the same number of
 * consecutive values, counted back from the newest, so the newest bar is
 * always whole days and only the oldest bucket may be short.
 *
 * Each bar is its bucket's average over the days that were read. For counts
 * that is the sum drawn at a scale (the bars have no axis, only their
 * heights against each other), and it keeps the short oldest bucket, or one
 * with unread days in it, from looking like a fall that did not happen. A
 * bucket is null (an empty slot) only when none of its days was read.
 * Returns the values unchanged when they fit.
 */
export function foldBars(values: readonly (number | null)[], slots: number): (number | null)[] {
  const n = values.length;
  if (n <= slots || slots < 1) return [...values];
  const size = Math.ceil(n / slots);
  const out: (number | null)[] = [];
  for (let end = n; end > 0; end -= size) {
    let total = 0;
    let read = 0;
    for (let i = Math.max(0, end - size); i < end; i++) {
      const v = values[i];
      if (v === null || v === undefined) continue;
      total += v;
      read++;
    }
    out.push(read === 0 ? null : total / read);
  }
  return out.reverse();
}

/**
 * Thin bars: a figure's recent history where each day is its own count
 * (leads, issues) rather than a level. The boards' second kind of tile spark,
 * and the bars under Performance overview.
 *
 *   <SparkBars data={stat.series} tone="bad" />
 *
 * A zero is a stub on the floor: the day was read and there was nothing.
 * A null leaves its slot empty: the day was not read. With no readings at all
 * the floor is dashed. A quarter or a year of days is folded into buckets
 * (`foldBars`), never squeezed past the box.
 */
export function SparkBars({ data, tone, size = "tile", fade = true, label, className }: SparkBarsProps) {
  const values = foldBars(normalise(data).values, SLOTS[size]);
  const sum = summarise([values]);
  const n = values.length;
  const top = Math.max(sum.hi, 0);

  return (
    <span
      className={cx("dk-bars", `dk-bars--${size}`, colorClass(asColor(tone)), className)}
      data-state={sum.count === 0 ? "empty" : undefined}
      data-dense={n > DENSE[size] ? "" : undefined}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {values.map((v, i) => {
        if (v === null) return <i key={i} data-gap="" />;
        if (v <= 0 || top === 0) return <i key={i} data-zero="" />;
        /* --k is how recent the bar is, 0 to 1; the stylesheet turns it into colour. */
        const style = { height: `${r2((v / top) * 100)}%`, "--k": fade && n > 1 ? r2(i / (n - 1)) : 1 } as CSSProperties;
        return <i key={i} style={style} />;
      })}
    </span>
  );
}
