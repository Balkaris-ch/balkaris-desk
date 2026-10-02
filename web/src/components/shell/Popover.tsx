"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx } from "@/lib/cx";

export interface PopoverProps {
  /** What the button shows. */
  button: ReactNode;
  /** Names the button when what it shows is not words. */
  label?: string;
  buttonClass?: string;
  /** The panel's heading, read out when it opens. */
  title: string;
  /** The panel. A function gets `close`, for a row that should shut it. */
  children: ReactNode | ((close: () => void) => ReactNode);
  panelClass?: string;
  /** Called each time the panel opens: the bell marks its notices as seen. */
  onOpen?: () => void;
}

/**
 * A top-bar button and the small panel that hangs under it: the status
 * checks, the notices, the person's menu. One open at a time is not enforced
 * by code; it follows from the rule that a click outside closes it. It also
 * closes on Escape (focus goes back to the button) and when the address
 * changes.
 */
export function Popover({ button, label, buttonClass, title, children, panelClass, onOpen }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div className="dk-pop" ref={box}>
      <button
        ref={trigger}
        type="button"
        className={cx("dk-pop-button", buttonClass)}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
      >
        {button}
      </button>
      {open ? (
        <div id={id} className={cx("dk-pop-panel", panelClass)} role="group" aria-label={title}>
          {typeof children === "function" ? children(() => setOpen(false)) : children}
        </div>
      ) : null}
    </div>
  );
}
