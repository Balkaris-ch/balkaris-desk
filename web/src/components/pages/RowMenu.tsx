"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { buttonClass } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icons";

/**
 * The "…" at the end of a row: the things that can really be done with one
 * page from here. Drawn at the end of <body> in fixed position, because the
 * table scrolls sideways inside its panel on a narrow screen and would clip a
 * menu that hung inside it. Follows the row when the page scrolls, and closes
 * on a click outside, Escape, Tab, or when the row leaves the screen.
 *
 * The keyboard as a menu button works: Enter, Space or ArrowDown opens it on
 * the first item (ArrowUp on the last), ArrowUp and ArrowDown move between
 * the items, Home and End go to the ends, Escape closes it back on the
 * button, and Tab closes it and moves on from the button.
 *
 * Not offered, because nothing would happen: a speed test of one page (the
 * daily speed job measures its own fixed list and takes no address).
 */
export function RowMenu({ path, url, name }: { path: string; url: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  /* Which item takes the focus once the menu is placed; null once it has. */
  const landing = useRef<"first" | "last" | null>(null);
  const id = useId();

  const items = () => [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  const place = useCallback(() => {
    const b = button.current?.getBoundingClientRect();
    if (!b) return;
    /* The row scrolled out of sight: the menu has nothing to hang from. */
    if (b.bottom < 0 || b.top > window.innerHeight || b.right < 0 || b.left > window.innerWidth) {
      setOpen(false);
      return;
    }
    const p = panel.current?.getBoundingClientRect();
    const w = p?.width || 208;
    const h = p?.height || 160;
    const below = b.bottom + 6 + h <= window.innerHeight - 8;
    const next = { top: below ? b.bottom + 6 : Math.max(8, b.top - 6 - h), left: Math.min(Math.max(8, b.right - w), window.innerWidth - w - 8) };
    setAt((had) => (had && had.top === next.top && had.left === next.left ? had : next));
  }, []);

  useEffect(() => {
    if (!open) {
      setAt(null);
      return;
    }
    place();
    /* Once more when the panel has its real size. */
    const frame = requestAnimationFrame(place);
    const away = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    /* Escape closes it wherever the focus is, and gives the focus back to the button. */
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close(true);
    };
    /* A scroll or a resize moves the button: the menu follows it. */
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place, close]);

  /* Once placed, the focus moves into the menu. */
  useEffect(() => {
    if (!open || !at || !landing.current) return;
    const list = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    (landing.current === "last" ? list[list.length - 1] : list[0])?.focus();
    landing.current = null;
  }, [open, at]);

  const show = (on: "first" | "last") => {
    landing.current = on;
    setOpen(true);
  };

  const onButtonKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      show(e.key === "ArrowUp" ? "last" : "first");
    }
  };

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const now = list.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    switch (e.key) {
      case "ArrowDown":
        return go(now + 1);
      case "ArrowUp":
        return go(now < 0 ? list.length - 1 : now - 1);
      case "Home":
        return go(0);
      case "End":
        return go(list.length - 1);
      case "Tab":
        /* Back on the button first, so the browser's own Tab moves on from there. */
        return close(true);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("yes");
    } catch {
      setCopied("no");
    }
    setTimeout(() => setCopied(null), 1600);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className={buttonClass({ variant: "quiet", size: "xs" }, "dk-btn--icon dk-pages-menu-button")}
        aria-label={`Actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close(false) : show("first"))}
        onKeyDown={onButtonKey}
      >
        <Icon name="more" size={14} />
      </button>
      {open
        ? createPortal(
            <div
              ref={panel}
              id={id}
              role="menu"
              aria-label={`Actions for ${name}`}
              className="dk-pages-menu"
              style={at ? { top: at.top, left: at.left } : { top: -9999, left: -9999 }}
              onKeyDown={onMenuKey}
            >
              <a role="menuitem" tabIndex={-1} className="dk-pages-menu-item" href={url} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
                <Icon name="external" size={14} />
                Open live page
              </a>
              <Link role="menuitem" tabIndex={-1} className="dk-pages-menu-item" href={`/pages/view?path=${encodeURIComponent(path)}`} prefetch={false} onClick={() => setOpen(false)}>
                <Icon name="eye" size={14} />
                View details
              </Link>
              <button role="menuitem" tabIndex={-1} type="button" className="dk-pages-menu-item" onClick={copy}>
                <Icon name={copied === "yes" ? "check" : "copy"} size={14} />
                <span aria-live="polite">{copied === "yes" ? "Address copied" : copied === "no" ? "The browser refused the copy" : "Copy address"}</span>
              </button>
              <Link role="menuitem" tabIndex={-1} className="dk-pages-menu-item" href={`/operator?do=metadata&path=${encodeURIComponent(path)}`} prefetch={false} onClick={() => setOpen(false)}>
                <Icon name="sparkles" size={14} />
                Propose metadata
              </Link>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
