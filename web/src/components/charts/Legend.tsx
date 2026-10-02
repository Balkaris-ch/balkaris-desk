import Link from "next/link";
import { cx } from "@/lib/cx";
import { colorClass, slotColor, type ChartColor } from "./series";
import "./charts.css";
import "./legend.css";

/** One entry of a legend. */
export interface LegendItem {
  label: string;
  /** Its mark's colour. By default the series slots in order, the same order a chart gives its series. */
  color?: ChartColor;
  /** A dot (a series, a slice), a line, or a dashed line (the previous period). */
  mark?: "dot" | "line" | "dash";
  /** Printed right of the label in a column legend: the share, as `shareTexts` prints it. */
  share?: string;
  /** Printed right of that: the count behind the share, already formatted. */
  value?: string;
  /** Makes the row a link (to the list filtered by this entry). */
  href?: string;
}

export interface LegendProps {
  items: readonly LegendItem[];
  /** "row": names side by side over a chart. "column": names with their figures beside a donut. */
  layout?: "row" | "column";
  className?: string;
}

/**
 * The names of a chart's colours, placed by the screen: in a row over an area
 * chart, in a column beside a donut (with each slice's share and count), or
 * under a calendar.
 *
 *   <Legend items={[{ label: "Organic" }, { label: "Direct" }]} />
 *   <Legend layout="column" items={sliceLegend(slices)} />
 *
 * Colours follow the same order as the chart's series, so a legend built from
 * the same list needs no colours named.
 */
export function Legend({ items, layout = "row", className }: LegendProps) {
  if (items.length === 0) return null;
  return (
    <ul className={cx("dk-legend", `dk-legend--${layout}`, className)}>
      {items.map((item, i) => {
        const body = (
          <>
            <i className={cx("dk-legend-mark", colorClass(item.color ?? slotColor(i)))} data-mark={item.mark ?? "dot"} />
            <span className="dk-legend-label">{item.label}</span>
            {layout === "column" && <span className="dk-legend-share">{item.share}</span>}
            {layout === "column" && items.some((it) => it.value !== undefined) && <span className="dk-legend-value">{item.value}</span>}
          </>
        );
        return (
          <li key={`${item.label}-${i}`} className="dk-legend-item">
            {item.href ? (
              <Link className="dk-legend-link" href={item.href}>
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Each value's share of the whole, as a legend prints it: a whole percent. A
 * share that rounds to nothing but is not nothing is "<1%", and with no total
 * there are no shares to print.
 */
export function shareTexts(values: readonly number[]): string[] {
  const total = values.reduce((a, v) => a + (v > 0 ? v : 0), 0);
  return values.map((v) => {
    if (total <= 0) return "";
    const pct = (Math.max(0, v) / total) * 100;
    return pct > 0 && pct < 1 ? "<1%" : `${Math.round(pct)}%`;
  });
}
