"use client";

import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";

/** What can take the keyboard's focus inside the panel. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * One file opened beside the list. It is an address (?file=), drawn by the
 * server like the rest of the screen, so it can be shared and the back button
 * closes it. The page behind is dimmed, so it is modal: focus moves into it
 * when it opens, Tab and Shift+Tab stay inside it, Escape closes it, and on
 * closing focus goes back to what opened it (the row) when that is still on
 * the screen. This part only adds what needs the browser.
 */
export function Drawer({ title, closeHref, children }: { title: string; closeHref: string; children: ReactNode }) {
  const router = useRouter();
  const panel = useRef<HTMLElement>(null);
  const heading = useId();

  /* Focus in on opening; back to the opener on closing. Kept across a switch from one file to another. */
  useEffect(() => {
    const was = document.activeElement;
    const opener = was instanceof HTMLElement && was !== document.body && !panel.current?.contains(was) ? was : null;
    panel.current?.focus({ preventScroll: true });
    return () => {
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) router.replace(closeHref, { scroll: false });
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [closeHref, router]);

  /* The focus loop: past the last control back to the first, and the other way. */
  const loop = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== "Tab" || !panel.current) return;
    const all = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!all.length) {
      e.preventDefault();
      return;
    }
    const first = all[0] as HTMLElement;
    const last = all[all.length - 1] as HTMLElement;
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === panel.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dk-assets-drawer">
      <Go href={closeHref} replace scroll={false} className="dk-assets-scrim" aria-label="Close the file" tabIndex={-1} />
      <aside ref={panel} className="dk-assets-drawer-panel" role="dialog" aria-modal="true" aria-labelledby={heading} tabIndex={-1} onKeyDown={loop}>
        <header className="dk-assets-drawer-head">
          <h2 id={heading} className="dk-assets-drawer-title">
            {title}
          </h2>
          <Go href={closeHref} replace scroll={false} className="dk-assets-drawer-x" aria-label="Close">
            <Icon name="x" size={16} />
          </Go>
        </header>
        <div className="dk-assets-drawer-body">{children}</div>
      </aside>
    </div>
  );
}
