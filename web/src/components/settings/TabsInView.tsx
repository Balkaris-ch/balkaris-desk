"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Keeps the open tab in sight when the strip is wider than a phone and scrolls
 * sideways: on ?tab=about the strip would otherwise show People and Sources,
 * and not which section is open. It only moves the strip, never the page.
 *
 * `display: contents`, so the wrapper adds nothing to the layout.
 */
export function TabsInView({ active, children }: { active: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = ref.current?.querySelector<HTMLElement>(".dk-tabs");
    const on = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!strip || !on || strip.scrollWidth <= strip.clientWidth) return;
    const s = strip.getBoundingClientRect();
    const t = on.getBoundingClientRect();
    if (t.left >= s.left && t.right <= s.right) return;
    strip.scrollLeft += t.left - s.left - (s.width - t.width) / 2;
  }, [active]);
  return (
    <div ref={ref} className="dk-settings-tabwrap">
      {children}
    </div>
  );
}
