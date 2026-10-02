"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/lib/cx";
import { Icon } from "./icons";
import "./tooltip.css";

export interface TooltipProps {
  /** What the bubble says. With nothing to say, the children are drawn bare. */
  text: ReactNode;
  children: ReactNode;
  /** Where the bubble prefers to sit. It flips when there is no room. */
  side?: "top" | "bottom";
  className?: string;
}

/**
 * A short explanation shown while the pointer or the keyboard is on something:
 * the caveat that belongs to a figure, the full text of a line that was cut.
 *
 * The bubble is drawn at the end of <body> in fixed position, so a panel that
 * scrolls or clips cannot cut it off, and it is kept inside the window. It is
 * described to screen readers through aria-describedby. Children that cannot
 * take focus are made focusable so the keyboard reaches the explanation too.
 */
export function Tooltip({ text, children, side = "top", className }: TooltipProps) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ left: number; top: number; below: boolean } | null>(null);

  const place = useCallback(() => {
    const a = anchor.current?.getBoundingClientRect();
    const b = bubble.current?.getBoundingClientRect();
    if (!a || !b) return;
    const gap = 8;
    const edge = 8;
    const fitsAbove = a.top - b.height - gap >= edge;
    const fitsBelow = a.bottom + b.height + gap <= window.innerHeight - edge;
    const below = side === "bottom" ? fitsBelow || !fitsAbove : !fitsAbove && fitsBelow;
    const left = Math.min(Math.max(edge, a.left + a.width / 2 - b.width / 2), window.innerWidth - b.width - edge);
    setAt({ left, top: below ? a.bottom + gap : a.top - b.height - gap, below });
  }, [side]);

  useEffect(() => {
    if (!open) {
      setAt(null);
      return;
    }
    place();
    const shut = () => setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    /* The bubble does not follow a scroll; it goes away, as a native one does. */
    window.addEventListener("scroll", shut, true);
    window.addEventListener("resize", shut);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("scroll", shut, true);
      window.removeEventListener("resize", shut);
      window.removeEventListener("keydown", key);
    };
  }, [open, place]);

  if (text == null || text === "" || text === false) return <>{children}</>;

  return (
    <span
      ref={anchor}
      className={cx("dk-tip-anchor", className)}
      aria-describedby={open ? id : undefined}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open
        ? createPortal(
            <span
              ref={bubble}
              id={id}
              role="tooltip"
              className={cx("dk-tip", at?.below && "dk-tip--below", at && "dk-tip--on")}
              style={at ? { left: at.left, top: at.top } : undefined}
            >
              {text}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

/** The small (i) beside a panel's or a tile's title, with what it explains. */
export function Info({ text, label = "What this is" }: { text: ReactNode; label?: string }) {
  return (
    <Tooltip text={text}>
      <span className="dk-info" tabIndex={0} role="img" aria-label={label}>
        <Icon name="info" size={14} />
      </span>
    </Tooltip>
  );
}
