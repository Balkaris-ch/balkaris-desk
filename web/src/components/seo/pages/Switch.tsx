"use client";

import { Children, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "@/lib/cx";

export interface SwitchProps {
  /** What the switch chooses between, for a screen reader: "Summary views". */
  label: string;
  /** One per pane, in the panes' order. */
  options: readonly { key: string; label: string }[];
  /** The option showing first. Default: the first. */
  initial?: string;
  /** "tabs" is the summary's underlined strip; "dots" the chart's radio row; "seg" two buttons side by side. */
  look?: "tabs" | "dots" | "seg";
  /** Drawn at the strip's right end (a select, a note). */
  aside?: ReactNode;
  /** The panes, drawn by the server; only the chosen one is shown. */
  children: ReactNode;
  className?: string;
}

/**
 * Switches between panes the server has already drawn: the summary's tabs,
 * the chart's measure, the result preview's device. Nothing is fetched: every
 * pane is in the page, the others are hidden. Arrow keys move along the strip.
 */
export function Switch({ label, options, initial, look = "tabs", aside, children, className }: SwitchProps) {
  const [on, setOn] = useState(initial && options.some((o) => o.key === initial) ? initial : (options[0]?.key ?? ""));
  const id = useId();
  const panes = Children.toArray(children);
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = options.findIndex((o) => o.key === on);
    const next = e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const o = options[(next + options.length) % options.length]!;
    setOn(o.key);
    document.getElementById(`${id}-t-${o.key}`)?.focus();
  };
  return (
    <div className={cx("dk-seo-pages-sw", `dk-seo-pages-sw--${look}`, className)}>
      <div className="dk-seo-pages-sw-bar">
        <div className="dk-seo-pages-sw-strip" role="tablist" aria-label={label} onKeyDown={move}>
          {options.map((o) => {
            const sel = o.key === on;
            return (
              <button
                key={o.key}
                id={`${id}-t-${o.key}`}
                type="button"
                role="tab"
                aria-selected={sel}
                aria-controls={`${id}-p-${o.key}`}
                tabIndex={sel ? 0 : -1}
                className={cx("dk-seo-pages-sw-tab", sel && "dk-seo-pages-sw-tab--on")}
                onClick={() => setOn(o.key)}
              >
                {look === "dots" ? <span className="dk-seo-pages-sw-dot" aria-hidden /> : null}
                {o.label}
              </button>
            );
          })}
        </div>
        {aside ? <div className="dk-seo-pages-sw-aside">{aside}</div> : null}
      </div>
      {options.map((o, i) => (
        <div key={o.key} id={`${id}-p-${o.key}`} role="tabpanel" aria-labelledby={`${id}-t-${o.key}`} hidden={o.key !== on} className="dk-seo-pages-sw-pane">
          {panes[i] ?? null}
        </div>
      ))}
    </div>
  );
}
