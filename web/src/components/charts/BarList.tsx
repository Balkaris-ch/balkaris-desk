import type { CSSProperties } from "react";
import Link from "next/link";
import type { Tone } from "@/contract/common";
import { cx } from "@/lib/cx";
import { DASH, figure } from "@/lib/format";
import type { Unit } from "@/lib/scale";
import { asColor, colorClass, r2, type ChartColor } from "./series";
import "./charts.css";
import "./bar-list.css";

export interface BarProps {
  /** How much of the bar is filled, out of `max`. Null draws the empty track: nothing was read. */
  value: number | null;
  /** The full bar. 100 by default, so a percentage can be passed as it is. */
  max?: number;
  tone?: Tone | ChartColor;
  /** What it shows, for a screen reader. Left out, the bar is decoration beside a figure that says it. */
  label?: string;
  className?: string;
}

/**
 * One horizontal bar on its track: the boards' progress bars in a table cell
 * (Top converting pages' rate, Current tasks, Infrastructure usage).
 *
 *   <Bar value={rate} />                 a percentage, read against 100
 *   <Bar value={used} max={quota} />     a part of a quota
 *
 * It takes the width of its cell. A value above `max` fills the bar and no
 * more; the figure beside it says by how much.
 */
export function Bar({ value, max = 100, tone, label, className }: BarProps) {
  const part = value !== null && Number.isFinite(value) && max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <span className={cx("dk-hbar", colorClass(asColor(tone)), className)} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {part > 0 && <i className="dk-hbar-fill" style={{ width: `${r2(part * 100)}%` } as CSSProperties} />}
    </span>
  );
}

/** One row of a BarList. The contract's `Share` fits as it is. */
export interface BarListItem {
  key?: string;
  label: string;
  /** What the bar measures. Null: the row is listed with an empty track and a dash. */
  value: number | null;
  /** Replaces the printed value (a change with its sign, a percentage), already formatted. By default the value in the list's unit. */
  text?: string;
  /** A second figure in its own column: the count behind a percentage, the number of keyword gaps. */
  second?: string;
  /** Makes the label a link. */
  href?: string;
  tone?: Tone | ChartColor;
}

export interface BarListProps {
  items: readonly BarListItem[];
  /** What the list shows, for a screen reader. */
  label: string;
  /** The value of a full bar. By default the largest value in the list, so the first row sets the scale. Pass 100 for percentages that should be read against the whole. */
  max?: number;
  /** How a value is printed when the item gives no `text`. */
  unit?: Unit;
  tone?: Tone | ChartColor;
  /**
   * The order of the columns. "bar-first": label, bar, value, second (the
   * boards' Leads by service). "value-first": label, second, value, bar
   * (Content gap, Infrastructure).
   */
  order?: "bar-first" | "value-first";
  /** A hairline between rows. */
  divided?: boolean;
  /** Shown instead of the list when it has no rows. */
  emptyNote?: string;
  className?: string;
}

/**
 * A ranked list with a bar per row: the boards' Content gap, Leads by
 * service, Leads by industry and the usage rows of Infrastructure.
 *
 *   <BarList label="Leads by service" unit="count" items={services} />
 *
 * The columns of all rows line up, whatever the labels' lengths. The bars
 * compare the rows with each other (or with `max`); they do not add up to
 * anything unless the values do.
 */
export function BarList({ items, label, max, unit = "count", tone, order = "bar-first", divided = false, emptyNote = "Nothing to list for this period yet.", className }: BarListProps) {
  if (items.length === 0) return <p className="dk-chart-note">{emptyNote}</p>;
  const full = max ?? Math.max(0, ...items.map((it) => it.value ?? 0));
  const seconds = items.some((it) => it.second !== undefined);

  return (
    <ul className={cx("dk-barlist", `dk-barlist--${order}`, className)} data-seconds={seconds ? "" : undefined} data-divided={divided ? "" : undefined} aria-label={label}>
      {items.map((it, i) => (
        <li key={it.key ?? `${it.label}-${i}`} className="dk-barlist-row">
          {it.href ? (
            <Link className="dk-barlist-label" href={it.href} title={it.label}>
              {it.label}
            </Link>
          ) : (
            <span className="dk-barlist-label" title={it.label}>
              {it.label}
            </span>
          )}
          <Bar className="dk-barlist-bar" value={it.value} max={full} tone={it.tone ?? tone} />
          <span className="dk-barlist-value">{it.text ?? (it.value === null ? DASH : figure(it.value, unit))}</span>
          {seconds && <span className="dk-barlist-second">{it.second}</span>}
        </li>
      ))}
    </ul>
  );
}
