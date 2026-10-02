"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cx } from "@/lib/cx";

/**
 * The one part of a chart that runs in the browser: the rule under the
 * pointer and the tooltip beside it.
 *
 * The chart itself is drawn on the server and is complete without this. The
 * server also prints every tooltip's words (the date, each value in its unit)
 * and hands them over as plain strings, so no formatting code, no locale and
 * no clock is shipped to the browser, and the two can never disagree.
 *
 * Reachable without a mouse: the layer takes focus, the arrow keys walk the
 * points, and what the tooltip says is also said to a screen reader.
 */

/** One line of a tooltip: a series at this point. */
export interface HoverRow {
  label: string;
  /** The value as it should be read, already formatted in its unit by the server; the dash for no reading. */
  text: string;
  /** The class that sets the mark's colour, as `colorClass()` gives it. */
  color: string;
  /** Where the series is at this point, percent from the plot's top; null when it has no reading here. */
  y: number | null;
  /** The swatch is a dashed line instead of a dot (the previous period). */
  dashed?: boolean;
}

/** Everything the tooltip says at one x. */
export interface HoverPoint {
  /** Percent from the plot's left edge. */
  x: number;
  /** The tooltip's heading: the date in full. */
  title: string;
  rows: HoverRow[];
  /** A caveat that belongs to this point ("still being counted"). */
  note?: string;
}

export function ChartHover({ points, label }: { points: readonly HoverPoint[]; label: string }) {
  const [at, setAt] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  if (points.length === 0) return null;

  /* The nearest point to the pointer. A few hundred points at most, so a walk is enough. */
  const nearest = (clientX: number): number | null => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i]!.x - pct) < Math.abs(points[best]!.x - pct)) best = i;
    }
    return best;
  };

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const i = nearest(e.clientX);
    if (i !== at) setAt(i);
  };

  /* A finger has no hover: lifting it must not take away what was just asked for. */
  const leave = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") setAt(null);
  };

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = points.length - 1;
    const from = at ?? last;
    const to = e.key === "ArrowLeft" ? Math.max(0, from - 1) : e.key === "ArrowRight" ? Math.min(last, from + 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (e.key === "Escape") setAt(null);
    if (to === null) return;
    e.preventDefault();
    setAt(to);
  };

  const p = at === null ? null : points[at];

  return (
    <div
      ref={box}
      className="dk-hover"
      tabIndex={0}
      role="group"
      aria-label={`${label}. Arrow keys read the values.`}
      onPointerMove={move}
      onPointerDown={move}
      onPointerLeave={leave}
      onFocus={() => setAt((i) => i ?? points.length - 1)}
      onBlur={() => setAt(null)}
      onKeyDown={key}
    >
      {p && (
        <>
          <i className="dk-hover-rule" style={{ left: `${p.x}%` }} />
          {p.rows.map((r, i) => (r.y === null || r.dashed ? null : <i key={i} className={cx("dk-hover-mark", r.color)} style={{ left: `${p.x}%`, top: `${r.y}%` }} />))}
          <div className="dk-hover-tip" data-side={p.x > 55 ? "left" : "right"} style={{ left: `${p.x}%` }}>
            <p className="dk-hover-title">{p.title}</p>
            {p.rows.map((r, i) => (
              <p key={i} className="dk-hover-row">
                <i className={cx("dk-hover-key", r.color)} data-dashed={r.dashed ? "" : undefined} />
                <span className="dk-hover-label">{r.label}</span>
                <b className="dk-hover-value">{r.text}</b>
              </p>
            ))}
            {p.note && <p className="dk-hover-note">{p.note}</p>}
          </div>
        </>
      )}
      <span className="dk-chart-sr" aria-live="polite">
        {p ? `${p.title}. ${p.rows.map((r) => `${r.label} ${r.text}`).join(", ")}${p.note ? `. ${p.note}` : ""}` : ""}
      </span>
    </div>
  );
}
