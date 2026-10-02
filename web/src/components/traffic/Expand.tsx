"use client";

import { useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icons";
import "./traffic.css";

export interface ExpandProps {
  /** Rows in the table it holds. */
  total: number;
  /** Rows shown while it is closed: 5, 6, 8 or 10 (traffic.css names these four). */
  shown: 5 | 6 | 8 | 10;
  /** What the rows are, for the button: "landing pages". */
  noun: string;
  children: ReactNode;
}

/**
 * A table panel that shows its first rows and opens to all of them. The rows
 * are all in the page already (sorted in the browser by the table itself), so
 * the closed state only hides the ones past `shown`, and a sort still picks
 * from all of them. With no more rows than `shown` there is no button.
 */
export function Expand({ total, shown, noun, children }: ExpandProps) {
  const [open, setOpen] = useState(false);
  const more = total > shown;
  return (
    <div className="dk-traffic-expand" data-shown={shown} data-open={open || !more ? "" : undefined}>
      {children}
      {more ? (
        <button type="button" className="dk-traffic-expand-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span>{open ? `Show the first ${shown}` : `Show all ${total} ${noun}`}</span>
          <Icon name={open ? "chevron-up" : "chevron-down"} size={14} />
        </button>
      ) : null}
    </div>
  );
}
