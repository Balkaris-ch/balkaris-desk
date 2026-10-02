"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "@/components/ui/icons";

/**
 * The "Filters" button and the panel it opens. A <details>, so it opens and
 * closes without script; with script it also closes on a click outside and on
 * Escape. The selects inside write the address themselves.
 */
export function FilterMenu({ active, children }: { active: number; children: ReactNode }) {
  const box = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const shut = (e: Event) => {
      const d = box.current;
      if (!d?.open) return;
      if (e instanceof KeyboardEvent) {
        if (e.key !== "Escape") return;
        d.open = false;
        d.querySelector("summary")?.focus();
        return;
      }
      if (!d.contains(e.target as Node)) d.open = false;
    };
    document.addEventListener("pointerdown", shut);
    document.addEventListener("keydown", shut);
    return () => {
      document.removeEventListener("pointerdown", shut);
      document.removeEventListener("keydown", shut);
    };
  }, []);

  return (
    <details ref={box} className="dk-assets-filters">
      <summary className="dk-assets-filters-button">
        <Icon name="filter" size={16} />
        <span>Filters</span>
        {active ? <span className="dk-assets-filters-n dk-num">{active}</span> : null}
      </summary>
      <div className="dk-assets-filters-panel">{children}</div>
    </details>
  );
}
