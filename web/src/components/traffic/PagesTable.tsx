"use client";

import { useId, useMemo, useState } from "react";
import type { TrafficPageRow } from "@/contract/traffic";
import { Delta } from "@/components/ui/Delta";
import { Icon } from "@/components/ui/icons";
import { TableView, type ViewHead, type ViewRow } from "@/components/ui/TableView";
import { duration, num } from "@/lib/format";
import "./traffic.css";

const SHOWN = 10;

const HEADS: ViewHead[] = [
  { key: "page", head: "Page", align: "left", numeric: false, sortable: true },
  {
    key: "users",
    head: "Visitors",
    align: "right",
    numeric: true,
    sortable: true,
    width: "12%",
  },
  {
    key: "views",
    head: "Views",
    align: "right",
    numeric: true,
    sortable: true,
    width: "12%",
  },
  {
    key: "time",
    head: "Time per visitor",
    align: "right",
    numeric: true,
    sortable: true,
    width: "16%",
  },
  {
    key: "change",
    head: "Change",
    align: "right",
    numeric: true,
    sortable: false,
    width: "12%",
  },
];

/**
 * Every address GA4 saw in the period, with a search over address and title.
 * The rows are all here; the search and the sort run in the browser, and the
 * list shows its first ten until it is opened.
 */
export function PagesTable({ rows }: { rows: TrafficPageRow[] }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const id = useId();

  const hits = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return rows;
    return rows.filter((r) => {
      const hay = `${r.path} ${r.title ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [rows, q]);

  const view: ViewRow[] = hits.map((r) => {
    const perVisitor = r.users > 0 ? r.engagementSeconds / r.users : null;
    return {
      key: r.path,
      href: null,
      pick: null,
      cells: [
        <span key="page" className="dk-traffic-page">
          <span className="dk-traffic-page-path">{r.path}</span>
          {r.title ? <span className="dk-traffic-page-title">{r.title}</span> : null}
        </span>,
        <span key="users">{num(r.users)}</span>,
        <span key="views">{num(r.views)}</span>,
        <span key="time">{perVisitor === null ? "—" : duration(perVisitor * 1000)}</span>,
        <Delta key="change" size="sm" value={r.users} previous={r.previous} />,
      ],
      sorts: [r.path, r.users, r.views, perVisitor, null],
    };
  });

  const more = hits.length > SHOWN;

  return (
    <div className="dk-traffic-pages">
      <div className="dk-traffic-search">
        <label htmlFor={id} className="dk-sr">
          Search the pages
        </label>
        <span className="dk-traffic-search-box">
          <Icon name="search" size={14} />
          <input
            id={id}
            type="search"
            className="dk-traffic-search-input"
            placeholder="Search address or title"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
          />
        </span>
        <span className="dk-traffic-search-count dk-num" aria-live="polite">
          {q.trim() ? `${num(hits.length)} of ${num(rows.length)}` : `${num(rows.length)} addresses`}
        </span>
      </div>
      <div className="dk-traffic-expand" data-shown={SHOWN} data-open={open || !more ? "" : undefined}>
        <TableView
          heads={HEADS}
          rows={view}
          caption="Every page visitors saw in the period"
          selectName={null}
          empty={q.trim() ? `No address or title contains “${q.trim()}”.` : "GA4 recorded no page views in this period."}
          defaultSort={null}
          density="roomy"
          headStyle="caps"
          minWidth={560}
        />
        {more ? (
          <button type="button" className="dk-traffic-expand-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <span>{open ? `Show the first ${SHOWN}` : `Show all ${num(hits.length)} addresses`}</span>
            <Icon name={open ? "chevron-up" : "chevron-down"} size={14} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
