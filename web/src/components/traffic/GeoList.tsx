"use client";

import { useState } from "react";
import { cx } from "@/lib/cx";
import { num } from "@/lib/format";
import "./traffic.css";

export interface GeoRow {
  key: string;
  /** ISO alpha-2, or null when GA4 could not place the visitor. */
  code: string | null;
  name: string;
  /** The share column (countries from thirty visitors on); left out, the row has none. */
  share?: string;
  users: number;
}

export interface GeoListProps {
  /** For a screen reader: "Countries". */
  label: string;
  rows: GeoRow[];
  /** How many exist, including any past the rows sent (GA4 lists 25 cities at most). */
  total: number;
  /** "country", "countries". */
  noun: [string, string];
  /** Rows shown while closed. */
  shown?: number;
  /** The narrower row with no share column. */
  plain?: boolean;
}

/**
 * The Countries panel's two lists: the first few rows, and a quiet "and 4 more
 * countries" that opens the rest. When GA4 has more than the desk asked it
 * for (cities stop at 25), the open list says how many it does not show.
 */
export function GeoList({ label, rows, total, noun, shown = 6, plain = false }: GeoListProps) {
  const [open, setOpen] = useState(false);
  const all = Math.max(total, rows.length);
  const visible = open ? rows : rows.slice(0, shown);
  const hidden = all - visible.length;
  const word = (n: number) => (n === 1 ? noun[0] : noun[1]);
  const canOpen = rows.length > shown;

  return (
    <>
      <ul className="dk-traffic-geo-list" aria-label={label}>
        {visible.map((r) => (
          <li key={r.key} className={cx("dk-traffic-geo-row", plain && "dk-traffic-geo-row--city")}>
            <span className="dk-traffic-geo-code">{r.code ?? "··"}</span>
            <span className="dk-traffic-geo-name">{r.name}</span>
            {plain ? null : <span className="dk-traffic-geo-share dk-num">{r.share ?? ""}</span>}
            <span className="dk-traffic-geo-n dk-num">{num(r.users)}</span>
          </li>
        ))}
      </ul>
      {canOpen ? (
        <button type="button" className="dk-traffic-geo-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? `Show the first ${shown}` : `and ${num(hidden)} more ${word(hidden)}`}
        </button>
      ) : null}
      {open && hidden > 0 ? (
        <p className="dk-traffic-quiet">
          and {num(hidden)} more {word(hidden)}, not listed here
        </p>
      ) : !canOpen && hidden > 0 ? (
        <p className="dk-traffic-quiet">
          and {num(hidden)} more {word(hidden)}
        </p>
      ) : null}
    </>
  );
}
