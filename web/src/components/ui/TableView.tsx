"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import { Go } from "./Go";
import { Icon } from "./icons";
import "./table.css";

/** A column as the browser needs it: no functions, only what was already drawn. */
export interface ViewHead {
  key: string;
  head: ReactNode;
  align: "left" | "right" | "center";
  numeric: boolean;
  sortable: boolean;
  width?: string;
}

/** A row as the browser needs it: its cells drawn, and the values its columns sort by. */
export interface ViewRow {
  key: string;
  href: string | null;
  /** The checkbox's label, or null when the table has no checkbox column. */
  pick: string | null;
  cells: ReactNode[];
  sorts: (number | string | null)[];
}

interface Props {
  heads: ViewHead[];
  rows: ViewRow[];
  caption: string;
  selectName: string | null;
  empty: ReactNode;
  defaultSort: { key: string; dir: "asc" | "desc" } | null;
  density: "dense" | "roomy";
  headStyle: "caps" | "plain";
  minWidth: number | null;
  /** The row link keeps the scroll position (a search-param change on this page). */
  keepScroll?: boolean;
  className?: string;
}

/**
 * The part of `Table` that runs in the browser: the sort and the checkboxes.
 * Screens use `Table`; this is its other half and takes rows already drawn.
 */
export function TableView({ heads, rows, caption, selectName, empty, defaultSort, density, headStyle, minWidth, keepScroll, className }: Props) {
  const [sort, setSort] = useState(defaultSort);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const all = useRef<HTMLInputElement>(null);

  const ordered = useMemo(() => {
    if (!sort) return rows;
    const at = heads.findIndex((h) => h.key === sort.key);
    if (at < 0) return rows;
    const flip = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = a.sorts[at] ?? null;
      const y = b.sorts[at] ?? null;
      /* A row with no value is last whichever way the column runs. */
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      if (typeof x === "number" && typeof y === "number") return (x - y) * flip;
      return String(x).localeCompare(String(y), "en", { numeric: true, sensitivity: "base" }) * flip;
    });
  }, [rows, heads, sort]);

  /* Rows that left the page (a new range, a filter) must not stay ticked. */
  useEffect(() => {
    setPicked((had) => {
      const here = new Set(rows.map((r) => r.key));
      const kept = [...had].filter((k) => here.has(k));
      return kept.length === had.size ? had : new Set(kept);
    });
  }, [rows]);

  const some = picked.size > 0 && picked.size < rows.length;
  useEffect(() => {
    if (all.current) all.current.indeterminate = some;
  }, [some]);

  const turn = (key: string, numeric: boolean) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: numeric ? "desc" : "asc" }));

  const toggle = (key: string) =>
    setPicked((had) => {
      const next = new Set(had);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const span = heads.length + (selectName ? 1 : 0);

  return (
    <div className={cx("dk-table-wrap", className)}>
      <table className={cx("dk-table", `dk-table--${density}`, `dk-table--${headStyle}`)} style={minWidth ? { minWidth } : undefined}>
        <caption className="dk-sr">{caption}</caption>
        <thead>
          <tr>
            {selectName ? (
              <th scope="col" className="dk-table-pick">
                <input
                  ref={all}
                  type="checkbox"
                  className="dk-check"
                  aria-label="Select every row"
                  checked={rows.length > 0 && picked.size === rows.length}
                  disabled={rows.length === 0}
                  onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.key)) : new Set())}
                />
              </th>
            ) : null}
            {heads.map((h) => {
              const on = sort?.key === h.key ? sort.dir : null;
              return (
                <th
                  key={h.key}
                  scope="col"
                  className={cx(`dk-table-${h.align}`)}
                  style={h.width ? { width: h.width } : undefined}
                  aria-sort={h.sortable ? (on === "asc" ? "ascending" : on === "desc" ? "descending" : "none") : undefined}
                >
                  {h.sortable ? (
                    <button type="button" className={cx("dk-table-sort", on && "dk-table-sort--on")} onClick={() => turn(h.key, h.numeric)}>
                      <span>{h.head}</span>
                      <Icon name={on === "asc" ? "arrow-up" : on === "desc" ? "arrow-down" : "sort"} size={12} />
                    </button>
                  ) : (
                    h.head
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {ordered.length === 0 ? (
            <tr className="dk-table-none">
              <td colSpan={span}>{empty}</td>
            </tr>
          ) : (
            ordered.map((row) => (
              <tr key={row.key} className={cx(row.href && "dk-table-linked", picked.has(row.key) && "dk-table-picked")}>
                {selectName ? (
                  <td className="dk-table-pick">
                    <input
                      type="checkbox"
                      className="dk-check"
                      name={selectName}
                      value={row.key}
                      aria-label={`Select ${row.pick ?? row.key}`}
                      checked={picked.has(row.key)}
                      onChange={() => toggle(row.key)}
                    />
                  </td>
                ) : null}
                {row.cells.map((cell, i) => {
                  const h = heads[i]!;
                  return (
                    <td key={h.key} className={cx(`dk-table-${h.align}`, h.numeric && "dk-num")}>
                      {i === 0 && row.href ? (
                        <Go href={row.href} className="dk-table-go" scroll={keepScroll ? false : undefined}>
                          {cell}
                        </Go>
                      ) : (
                        cell
                      )}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
