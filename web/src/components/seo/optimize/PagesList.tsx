"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { OptimizeList, OptimizeListRow } from "@/contract/seo/page-view";
import type { Priority } from "@/contract/seo/common";
import { Icon } from "@/components/ui/icons";
import { Thumb } from "@/components/ui/Thumb";
import { cx } from "@/lib/cx";
import { DASH, num } from "@/lib/format";
import { optimizeHref, PriorityChip, rateText, scoreTone, type OptimizeTab } from "./bits";
import "@/components/ui/field.css";
import "@/components/ui/select.css";

type Filter = "all" | Priority | "none";
type Sort = "priority" | "score" | "impressions" | "views" | "path";

const SORTS: { value: Sort; label: string }[] = [
  { value: "priority", label: "Priority" },
  { value: "score", label: "Score, lowest first" },
  { value: "impressions", label: "Impressions" },
  { value: "views", label: "Views" },
  { value: "path", label: "Address" },
];

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "high", label: "High" },
  { key: "medium", label: "Medium" },
  { key: "low", label: "Low" },
  { key: "none", label: "None" },
];

const PRIO: Record<Priority | "none", number> = { high: 0, medium: 1, low: 2, none: 3 };

function sorted(rows: OptimizeListRow[], sort: Sort): OptimizeListRow[] {
  if (sort === "priority") return rows; /* the server's order, stated under the list */
  const out = [...rows];
  const by = {
    score: (a: OptimizeListRow, b: OptimizeListRow) => (a.score ?? 101) - (b.score ?? 101),
    impressions: (a: OptimizeListRow, b: OptimizeListRow) => (b.impressions ?? -1) - (a.impressions ?? -1),
    views: (a: OptimizeListRow, b: OptimizeListRow) => (b.views ?? -1) - (a.views ?? -1),
    path: (a: OptimizeListRow, b: OptimizeListRow) => a.page.path.localeCompare(b.page.path),
  }[sort];
  return out.sort((a, b) => by(a, b) || PRIO[a.priority ?? "none"] - PRIO[b.priority ?? "none"] || a.page.path.localeCompare(b.page.path));
}

/**
 * The board's "Pages" column: every page of the sitemap, by priority (the
 * highest among its open opportunities), with a search box, the priority
 * chips with their real counts, and another order on request. Each row opens
 * that page in the middle. Filtering and sorting happen here, over the rows
 * the server sent; nothing is asked again.
 */
export function PagesList({ list, selected, range, tab }: { list: OptimizeList; selected: string | null; range: string | null; tab: OptimizeTab }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("priority");
  const box = useRef<HTMLUListElement>(null);

  const rows = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const kept = list.rows.filter((r) => {
      if (filter !== "all" && (r.priority ?? "none") !== filter) return false;
      const hay = `${r.page.path} ${r.page.title ?? ""} ${r.page.kindLabel ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    return sorted(kept, sort);
  }, [list.rows, q, filter, sort]);

  /* The open page in view inside the list, without moving the screen. */
  useEffect(() => {
    const ul = box.current;
    const on = ul?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!ul || !on) return;
    const top = on.offsetTop - ul.offsetTop;
    if (top < ul.scrollTop || top + on.offsetHeight > ul.scrollTop + ul.clientHeight) ul.scrollTop = Math.max(0, top - ul.clientHeight / 3);
  }, [selected]);

  const counts = list.counts;
  return (
    <section className="dk-card dk-seo-optimize-list" aria-label="Pages">
      <header className="dk-seo-optimize-list-head">
        <h2 className="dk-card-title">
          <span className="dk-card-title-text">Pages</span>
        </h2>
        <label className="dk-select dk-select--sm dk-seo-optimize-sort">
          <span className="dk-sr">Sort by</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                Sort by: {s.label}
              </option>
            ))}
          </select>
          <Icon name="chevron-down" size={14} />
        </label>
      </header>
      <div className="dk-seo-optimize-list-tools">
        <label className="dk-seo-optimize-search">
          <Icon name="search" size={14} />
          <span className="dk-sr">Search pages</span>
          <input type="search" className="dk-input" placeholder="Search pages…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="dk-seo-optimize-chips" role="group" aria-label="Priority">
          {FILTERS.filter((f) => f.key === "all" || counts[f.key] > 0 || filter === f.key).map((f) => (
            <button
              key={f.key}
              type="button"
              className={cx("dk-seo-optimize-chip", filter === f.key && "dk-seo-optimize-chip--on", f.key !== "all" && f.key !== "none" && `dk-seo-optimize-chip--${f.key}`)}
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <span className="dk-num">{num(counts[f.key])}</span>
            </button>
          ))}
        </div>
      </div>
      <ul ref={box} className="dk-seo-optimize-rows">
        {rows.map((r) => {
          const on = r.page.path === selected;
          const second = [r.page.kindLabel, r.views !== null ? `${num(r.views)} view${r.views === 1 ? "" : "s"}` : null, r.ctr && r.ctr.den ? `CTR ${rateText(r.ctr)}` : r.impressions === 0 ? "not shown in Google" : null]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={r.page.path}>
              <Link href={optimizeHref(r.page.path, range, tab)} prefetch={false} scroll={false} className={cx("dk-seo-optimize-row", on && "dk-seo-optimize-row--on")} aria-current={on ? "page" : undefined}>
                <Thumb src={r.page.picture} size="sm" icon="file" className="dk-seo-optimize-row-thumb" />
                <span className="dk-seo-optimize-row-text">
                  <span className="dk-seo-optimize-row-path">{r.page.path}</span>
                  <span className="dk-seo-optimize-row-sub">{second || DASH}</span>
                </span>
                <span className="dk-seo-optimize-row-end">
                  {r.priority ? <PriorityChip priority={r.priority} /> : <span className="dk-seo-optimize-row-none">{r.opportunities ? "" : "No open item"}</span>}
                  <span className={cx("dk-seo-optimize-row-score dk-num", `dk-tone-${scoreTone(r.score)}`)} title={r.score === null ? "Not scored by the crawl" : `The crawl's score: ${r.score} of 100`}>
                    {r.score === null ? DASH : r.score}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
        {rows.length === 0 ? <li className="dk-seo-optimize-rows-empty">No page matches{q ? ` “${q}”` : ""}.</li> : null}
      </ul>
      <p className="dk-seo-optimize-list-foot">
        {num(rows.length)} of {num(list.rows.length)} · {sort === "priority" ? list.order : `By ${(SORTS.find((s) => s.value === sort)?.label ?? sort).toLowerCase()}.`} The figure on the right is the crawl’s score.
      </p>
    </section>
  );
}
