"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A list that shows as many of its entries as fit whole in the height the
 * page gives it, and hides the rest: never an entry cut in half, never a
 * hole under the last one. Recent SEO actions uses it to fill what the AI SEO
 * Operator leaves of the right-hand column, which is as tall as the two rows
 * beside it (boards 116 and 110). Where the page does not fix its height (a
 * phone), it is as tall as its entries and hides none.
 *
 * `watch` changes when the entries do (the page was drawn again), so a new
 * list is fitted too.
 */
export function Fill({ children, className, watch }: { children: ReactNode; className?: string; watch: string }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const items = [...el.querySelectorAll<HTMLElement>("li")];
      for (const li of items) li.hidden = false;
      const bottom = el.getBoundingClientRect().bottom;
      let cut = false;
      items.forEach((li, i) => {
        /* The first entry always shows; after it, the first that does not fit whole ends the list. */
        if (!cut && i > 0 && li.getBoundingClientRect().bottom > bottom + 0.5) cut = true;
        if (cut) li.hidden = true;
      });
    };
    fit();
    const watcher = new ResizeObserver(fit);
    watcher.observe(el);
    return () => watcher.disconnect();
  }, [watch]);

  return (
    <div ref={box} className={className}>
      {children}
    </div>
  );
}
