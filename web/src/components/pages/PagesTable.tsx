"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Range, Reading } from "@/contract/common";
import type { ConversionColumn, PageListRow, PageState, PageType, PageUpdate, TrafficColumn } from "@/contract/pages";
import { Ring } from "@/components/charts/Ring";
import { Chip, Count, type ChipTone } from "@/components/ui/Badge";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Delta } from "@/components/ui/Delta";
import { Input } from "@/components/ui/Field";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { StatusDot } from "@/components/ui/StatusDot";
import { Thumb } from "@/components/ui/Thumb";
import { Info } from "@/components/ui/Tooltip";
import { cx } from "@/lib/cx";
import { ago, DASH, fullDate, num, percent, rangeLabel } from "@/lib/format";
import { ISSUES, SHOWS, TABS, type Filters, type IssueFilter, type Show, type Tab } from "./filters";
import { RowMenu } from "./RowMenu";
import "@/components/ui/table.css";
import "@/components/ui/tabs.css";
import "@/components/ui/select.css";
import "./pages.css";

/* ---------- what the address can say ----------------------------------------- */

const STATES: { key: PageState; label: string; tone: ChipTone }[] = [
  { key: "live", label: "Live", tone: "good" },
  { key: "noindex", label: "Noindex", tone: "quiet" },
  { key: "redirect", label: "Redirect", tone: "warn" },
  { key: "error", label: "Error", tone: "bad" },
];

const TYPE_TONE: Record<PageType, ChipTone> = {
  home: "good",
  landing: "good",
  service: "violet",
  segment: "info",
  article: "warn",
  insights: "warn",
  case: "quiet",
  legal: "quiet",
  standard: "quiet",
};

const inTab = (tab: Tab, r: PageListRow): boolean =>
  tab === "all" ||
  (tab === "service" && r.type === "service") ||
  (tab === "segment" && r.type === "segment") ||
  (tab === "insights" && (r.type === "article" || r.type === "insights")) ||
  (tab === "landing" && r.type === "landing") ||
  (tab === "new" && r.isNew) ||
  (tab === "attention" && r.flags.attention);

function inShow(show: Show, r: PageListRow, top: ReadonlySet<string>): boolean {
  switch (show) {
    case "route":
      return r.flags.route;
    case "metadata":
      return r.flags.metadata;
    case "picture":
      return r.flags.picture;
    case "meta":
      return r.flags.meta;
    case "schema":
      return r.flags.schema;
    case "orphan":
      return r.flags.orphan;
    case "drafts":
      return r.draft;
    case "top":
      return top.has(r.path);
  }
}

/* ---------- sorting ------------------------------------------------------------- */

type SortKey = "page" | "traffic" | "score" | "conv" | "links" | "updated";
interface Sort {
  key: SortKey;
  dir: "asc" | "desc";
}

const FIRST = 8;
const MORE = 25;

export interface PagesTableProps {
  rows: PageListRow[];
  inventory: Reading<PageListRow[]>;
  traffic: Reading<TrafficColumn>;
  conversions: Reading<ConversionColumn>;
  updates: Reading<Record<string, PageUpdate>>;
  /** The addresses the Top performers rule picked. */
  top: string[];
  range: Range;
  initial: Filters;
}

/**
 * The inventory: tabs with counts, search, filters, the table with its
 * browser-side sort over every page (not only the ones showing), show more,
 * and the ticked rows exported as CSV.
 *
 * The whole inventory (about a hundred rows) is in the page already, so
 * nothing here asks the server. What is chosen is written into the address
 * (history.replaceState), so a filtered view can be shared or reloaded.
 */
export function PagesTable({ rows, inventory, traffic, conversions, updates, top, range, initial }: PagesTableProps) {
  const [f, setF] = useState<Filters>(initial);
  const [sort, setSort] = useState<Sort>(traffic.state === "ok" ? { key: "traffic", dir: "desc" } : { key: "page", dir: "asc" });
  const [shown, setShown] = useState(FIRST);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const all = useRef<HTMLInputElement>(null);
  const filterBox = useRef<HTMLDivElement>(null);
  const topSet = useMemo(() => new Set(top), [top]);

  /* Into the address, without asking the server for the page again. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const set = (k: string, v: string, none = "") => (v && v !== none ? params.set(k, v) : params.delete(k));
    set("tab", f.tab, "all");
    set("q", f.q.trim());
    set("status", f.status);
    set("type", f.type);
    set("issues", f.issues);
    set("show", f.show);
    /* What the crawl action answered belongs to the moment it was pressed, not to a reload. */
    params.delete("crawl");
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", next);
  }, [f]);

  useEffect(() => {
    if (!filtersOpen) return;
    const away = (e: PointerEvent) => {
      if (!filterBox.current?.contains(e.target as Node)) setFiltersOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setFiltersOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [filtersOpen]);

  const change = (patch: Partial<Filters>) => {
    setF((had) => ({ ...had, ...patch }));
    setShown(FIRST);
  };

  const t = traffic.state === "ok" ? traffic.value : null;
  const c = conversions.state === "ok" ? conversions.value : null;
  const u = updates.state === "ok" ? updates.value : null;

  const visitorsOf = (r: PageListRow) => (t ? (t.rows[r.path]?.visitors ?? 0) : null);
  const convOf = (r: PageListRow) => (c ? (c.rows[r.path]?.count ?? 0) : null);
  const updatedOf = (r: PageListRow) => {
    const x = u?.[r.path];
    return x ? Date.parse(x.at) : null;
  };

  /* Every filter but the tab: the tabs count what the other filters leave. */
  const filtered = useMemo(() => {
    const needle = f.q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!needle || r.path.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle) || (r.title ?? "").toLowerCase().includes(needle)) &&
        (!f.status || r.state === f.status) &&
        (!f.type || r.type === f.type) &&
        (!f.issues || (f.issues === "any" ? r.flags.attention : f.issues === "critical" ? r.issues.critical > 0 : !r.flags.attention)) &&
        (!f.show || inShow(f.show, r, topSet)),
    );
  }, [rows, f.q, f.status, f.type, f.issues, f.show, topSet]);

  const counts = useMemo(() => Object.fromEntries(TABS.map((tab) => [tab.key, filtered.filter((r) => inTab(tab.key, r)).length])) as Record<Tab, number>, [filtered]);

  const listed = useMemo(() => {
    const list = filtered.filter((r) => inTab(f.tab, r));
    const value = (r: PageListRow): number | string | null => {
      switch (sort.key) {
        case "page":
          return r.name.toLowerCase();
        case "traffic":
          return visitorsOf(r);
        case "score":
          return r.score;
        case "conv":
          return convOf(r);
        case "links":
          return r.inlinks;
        case "updated":
          return updatedOf(r);
      }
    };
    const flip = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      if (x === null || y === null) {
        if (x !== y) return x === null ? 1 : -1;
      } else if (x !== y) {
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en", { numeric: true })) * flip;
      }
      return a.name.localeCompare(b.name, "en", { numeric: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, f.tab, sort, t, c, u]);

  const visible = listed.slice(0, shown);

  /* Ticks on rows that left the list are dropped. */
  useEffect(() => {
    setPicked((had) => {
      const here = new Set(listed.map((r) => r.path));
      const kept = [...had].filter((p) => here.has(p));
      return kept.length === had.size ? had : new Set(kept);
    });
  }, [listed]);

  const pickedVisible = visible.filter((r) => picked.has(r.path)).length;
  const some = pickedVisible > 0 && pickedVisible < visible.length;
  useEffect(() => {
    if (all.current) all.current.indeterminate = some;
  }, [some]);

  const turn = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "page" ? "asc" : "desc" }));

  const active = [f.status, f.type, f.issues, f.show].filter(Boolean).length;
  const exportHref = `/api/v1/pages/export.csv?${new URLSearchParams([["range", range], ...[...picked].map((p) => ["path", p] as [string, string])]).toString()}`;

  const head = (key: SortKey, label: ReactNode, info?: ReactNode, sub?: ReactNode) => {
    const on = sort.key === key ? sort.dir : null;
    return (
      <th scope="col" aria-sort={on === "asc" ? "ascending" : on === "desc" ? "descending" : "none"}>
        <span className="dk-pages-head">
          <button type="button" className={cx("dk-table-sort", on && "dk-table-sort--on")} onClick={() => turn(key)}>
            <span>
              {label}
              {sub ? <span className="dk-pages-head-sub">{sub}</span> : null}
            </span>
            <Icon name={on === "asc" ? "arrow-up" : on === "desc" ? "arrow-down" : "sort"} size={12} />
          </button>
          {info ? <Info text={info} /> : null}
        </span>
      </th>
    );
  };

  const statusLabel = STATES;

  return (
    <>
      <div className="dk-pages-bar" id="dk-pages-table">
        <nav className="dk-tabs dk-tabs--md" aria-label="Kinds of page">
          {TABS.map((tab) => (
            <button key={tab.key} type="button" className={cx("dk-tab", f.tab === tab.key && "dk-tab--on")} aria-pressed={f.tab === tab.key} onClick={() => change({ tab: tab.key })}>
              <span>{tab.label}</span>
              <Count>{counts[tab.key]}</Count>
            </button>
          ))}
        </nav>
        <div className="dk-pages-tools">
          {picked.size ? (
            <LinkButton href={exportHref} variant="good" size="md" icon="download">
              Export {picked.size} selected
            </LinkButton>
          ) : null}
          <label className="dk-pages-search">
            <Icon name="search" size={16} />
            <span className="dk-sr">Search pages by title or address</span>
            <Input type="search" placeholder="Search pages, routes or titles..." value={f.q} onChange={(e) => change({ q: e.target.value })} />
          </label>
          <div className="dk-pages-filter" ref={filterBox}>
            <Button variant="quiet" icon="filter" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
              Filters{active ? <span className="dk-pages-filter-n">{active}</span> : null}
            </Button>
            {filtersOpen ? (
              <div className="dk-pages-filter-panel" role="group" aria-label="Filters">
                <Choice label="Status" value={f.status} options={statusLabel.map((s) => ({ value: s.key, label: s.label }))} any="Every status" onChange={(v) => change({ status: v as PageState | "" })} />
                <Choice
                  label="Type"
                  value={f.type}
                  options={[...new Map(rows.map((r) => [r.type, r.typeLabel])).entries()].map(([value, label]) => ({ value, label }))}
                  any="Every type"
                  onChange={(v) => change({ type: v as PageType | "" })}
                />
                <Choice label="Issues" value={f.issues} options={ISSUES.map((i) => ({ value: i.key, label: i.label }))} any="With or without issues" onChange={(v) => change({ issues: v as IssueFilter | "" })} />
                <Choice label="List" value={f.show} options={SHOWS.map((s) => ({ value: s.key, label: s.label }))} any="Every page" onChange={(v) => change({ show: v as Show | "" })} />
                <div className="dk-pages-filter-foot">
                  <Button variant="ghost" size="sm" disabled={!active} onClick={() => change({ status: "", type: "", issues: "", show: "" })}>
                    Clear filters
                  </Button>
                  <Button variant="quiet" size="sm" onClick={() => setFiltersOpen(false)}>
                    Done
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* The columns give way by the panel's width (pages.css): under the
          full width the route moves under the page's name, then the status
          keeps its dot and the heads wrap, so a 1280 screen shows every column. */}
      <Card flush className="dk-pages-table">
        <div className="dk-table-wrap">
          <table className="dk-table dk-table--roomy dk-table--plain">
            <caption className="dk-sr">Pages of balkaris.ch</caption>
            <thead>
              <tr>
                <th scope="col" className="dk-table-pick">
                  <input
                    ref={all}
                    type="checkbox"
                    className="dk-check"
                    aria-label="Select every page showing"
                    checked={visible.length > 0 && pickedVisible === visible.length}
                    disabled={visible.length === 0}
                    onChange={(e) =>
                      setPicked((had) => {
                        const next = new Set(had);
                        for (const r of visible) {
                          if (e.target.checked) next.add(r.path);
                          else next.delete(r.path);
                        }
                        return next;
                      })
                    }
                  />
                </th>
                {head("page", "Page")}
                <th scope="col" className="dk-pages-col-route">
                  <span className="dk-pages-head">
                    Route <Icon name="external" size={12} />
                  </span>
                </th>
                <th scope="col">Type</th>
                <th scope="col">Status</th>
                {head(
                  "traffic",
                  "Traffic",
                  "Visitors (GA4 active users) who viewed the page in the range, with the change against the period before when that period was measured whole. Consenting visitors only.",
                  rangeLabel(range),
                )}
                {head("score", "SEO score", "The desk's own score out of 100: 100 less the cost of each rule that fired on the page (src/cc/site/rules.ts). Pages kept out of the sitemap are not scored. Not a figure from Google.")}
                {head(
                  "conv",
                  "Conversions",
                  <>
                    {c ? c.counts : "Enquiries sent from the page."} A rate is shown only when the page had at least 100 sessions, and under 30 enquiries with its two counts.
                  </>,
                )}
                {head("links", "Internal links", "Other pages of the site that link here, from anywhere on them, menus and footers included.")}
                {head(
                  "updated",
                  "Last updated",
                  "The newest commit to the files only this page uses (its page file and what only it imports; a case study's or an article's own content file), with who made it. An article no single file holds shows its own date. “–”: no file belongs to this page alone, so it cannot be known.",
                )}
                <th scope="col" className="dk-table-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr className="dk-table-none">
                  <td colSpan={11}>
                    <div className="dk-pages-none">
                      <span>No page matches {describe(f)}.</span>
                      <Button variant="quiet" size="sm" onClick={() => change({ tab: "all", q: "", status: "", type: "", issues: "", show: "" })}>
                        Show every page
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : (
                visible.map((r) => (
                  <tr key={r.path} className={cx("dk-table-linked", picked.has(r.path) && "dk-table-picked")}>
                    <td className="dk-table-pick">
                      <input
                        type="checkbox"
                        className="dk-check"
                        aria-label={`Select ${r.name}`}
                        checked={picked.has(r.path)}
                        onChange={() =>
                          setPicked((had) => {
                            const next = new Set(had);
                            if (next.has(r.path)) next.delete(r.path);
                            else next.add(r.path);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td>
                      <span className="dk-pages-pagecell">
                        <Link href={`/pages/view?path=${encodeURIComponent(r.path)}`} prefetch={false} className="dk-table-go dk-pages-page">
                          <Thumb src={r.picture} size="sm" icon="file" />
                          <span className="dk-pages-name">
                            <b>{r.name}</b>
                            <span className="dk-pages-name-section">{r.section}</span>
                            {/* Holds the width of the route line below while the Route column is folded in. */}
                            <span className="dk-pages-name-path" aria-hidden>
                              {r.path}
                            </span>
                          </span>
                        </Link>
                        {/* The Route column's content, shown here when that column is folded away. */}
                        <span className="dk-pages-folded">
                          <span title={r.path}>{r.path}</span>
                          <a href={r.url} target="_blank" rel="noreferrer" aria-label={`Open ${r.path} on the live site`}>
                            <Icon name="external" size={12} />
                          </a>
                        </span>
                      </span>
                    </td>
                    <td className="dk-pages-col-route">
                      <span className="dk-pages-route">
                        <span title={r.path}>{r.path}</span>
                        <a href={r.url} target="_blank" rel="noreferrer" aria-label={`Open ${r.path} on the live site`}>
                          <Icon name="external" size={13} />
                        </a>
                      </span>
                    </td>
                    <td>
                      <Chip tone={TYPE_TONE[r.type] ?? "quiet"}>{r.typeLabel}</Chip>
                    </td>
                    <td>
                      <StateCell row={r} />
                    </td>
                    <td>
                      <TrafficCell row={r} traffic={traffic} />
                    </td>
                    <td>
                      <Ring value={r.score} label={`SEO score of ${r.path}`} />
                    </td>
                    <td>
                      <ConvCell row={r} conversions={conversions} traffic={traffic} />
                    </td>
                    <td>
                      <span className="dk-pages-figure dk-num">
                        <b>{num(r.inlinks)}</b>
                      </span>
                    </td>
                    <td>
                      <UpdatedCell row={r} updates={updates} />
                    </td>
                    <td className="dk-table-right">
                      <RowMenu path={r.path} url={r.url} name={r.name} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {/* One low row: how many are showing, where each column comes from, show more. */}
        <div className="dk-pages-foot">
          <div className="dk-pages-stamps">
            <span className="dk-pages-showing">
              Showing {num(visible.length)} of {num(listed.length)}
              {listed.length !== rows.length ? ` (${num(rows.length)} in all)` : ""}
            </span>
            {picked.size ? <span className="dk-pages-selected">{picked.size} selected</span> : null}
            <Stamp reading={inventory} />
            <Stamp reading={traffic} />
            <Stamp reading={conversions} />
            <Stamp reading={updates} />
          </div>
          <div className="dk-pages-more">
            {shown < listed.length ? (
              <>
                <Button variant="quiet" size="xs" onClick={() => setShown((n) => n + MORE)}>
                  Show {Math.min(MORE, listed.length - shown)} more
                </Button>
                <Button variant="ghost" size="xs" onClick={() => setShown(listed.length)}>
                  Show all
                </Button>
              </>
            ) : listed.length > FIRST ? (
              <Button variant="ghost" size="xs" onClick={() => setShown(FIRST)}>
                Show fewer
              </Button>
            ) : null}
          </div>
        </div>
      </Card>
    </>
  );
}

/* ---------- cells ---------------------------------------------------------------- */

function StateCell({ row }: { row: PageListRow }) {
  const s = STATES.find((x) => x.key === row.state) ?? STATES[3]!;
  const why =
    row.state === "redirect"
      ? `Answers ${row.status} and sends readers to ${row.redirectTo ?? "another address"}.`
      : row.state === "error"
        ? row.status
          ? `Answers ${row.status}.`
          : "Did not answer at the last crawl."
        : row.state === "noindex"
          ? `Answers 200 and tells search engines to stay away${row.listedBy === "route" ? "; kept out of the sitemap on purpose" : ""}.`
          : row.listedBy === "unlisted"
            ? "Answers 200; an article not listed yet."
            : undefined;
  /* Where the column keeps only the dot (pages.css), the word is in the tooltip. */
  return (
    <span title={why ? `${s.label}: ${why}` : s.label}>
      <StatusDot tone={s.tone} tint={row.state === "live"}>
        {s.label}
      </StatusDot>
    </span>
  );
}

function TrafficCell({ row, traffic }: { row: PageListRow; traffic: Reading<TrafficColumn> }) {
  if (traffic.state !== "ok") return <Absent reading={traffic} form="inline" />;
  const t = traffic.value.rows[row.path];
  const value = t?.visitors ?? 0;
  const previous = t ? t.previous : traffic.value.period.previous ? 0 : null;
  return (
    <span className="dk-pages-figure dk-num">
      <b>{num(value)}</b>
      {previous !== null && (value > 0 || previous > 0) ? <Delta value={value} previous={previous} size="sm" /> : null}
    </span>
  );
}

function ConvCell({ row, conversions, traffic }: { row: PageListRow; conversions: Reading<ConversionColumn>; traffic: Reading<TrafficColumn> }) {
  if (conversions.state !== "ok") return <Absent reading={conversions} form="inline" />;
  const c = conversions.value.rows[row.path];
  const count = c?.count ?? 0;
  const comparable = traffic.state === "ok" ? Boolean(traffic.value.period.previous) : false;
  const previous = c ? c.previous : comparable ? 0 : null;
  const sessions = traffic.state === "ok" ? (traffic.value.rows[row.path]?.sessions ?? (traffic.value.rows[row.path] ? null : 0)) : null;
  const rate = conversions.value.source === "ga4" && sessions !== null && sessions >= 100 ? (count / sessions) * 100 : null;
  return (
    <span className="dk-pages-figure dk-num">
      <b>{num(count)}</b>
      {rate !== null ? (
        <span className="dk-pages-rate">
          {percent(rate, rate < 10 ? 1 : 0)}
          {count < 30 ? ` · ${count} of ${num(sessions)}` : ""}
        </span>
      ) : null}
      {previous !== null && (count > 0 || previous > 0) ? <Delta value={count} previous={previous} size="sm" /> : null}
    </span>
  );
}

function UpdatedCell({ row, updates }: { row: PageListRow; updates: Reading<Record<string, PageUpdate>> }) {
  if (updates.state !== "ok") return <Absent reading={updates} form="inline" />;
  const x = updates.value[row.path];
  if (!x) {
    return (
      <span className="dk-pages-two" title="No file of the website's code belongs to this page alone (it is drawn by a shared route from content other pages share), so when it last changed cannot be known.">
        <span>{DASH}</span>
      </span>
    );
  }
  return (
    <span className="dk-pages-two" title={x.subject ?? undefined}>
      <span suppressHydrationWarning>{x.how === "dated" ? fullDate(x.at) : ago(x.at)}</span>
      <span>{x.who ?? "article date"}</span>
    </span>
  );
}

/* ---------- the filters' fields ------------------------------------------------------ */

function Choice({ label, value, options, any, onChange }: { label: string; value: string; options: { value: string; label: string }[]; any: string; onChange: (v: string) => void }) {
  return (
    <label className="dk-field">
      <span className="dk-field-label">{label}</span>
      <span className="dk-select dk-select--md">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{any}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={14} />
      </span>
    </label>
  );
}

function describe(f: Filters): string {
  const parts: string[] = [];
  if (f.tab !== "all") parts.push(`the tab “${TABS.find((t) => t.key === f.tab)?.label}”`);
  if (f.q.trim()) parts.push(`“${f.q.trim()}”`);
  if (f.status) parts.push(`status ${STATES.find((s) => s.key === f.status)?.label}`);
  if (f.type) parts.push(`the type chosen`);
  if (f.issues) parts.push(ISSUES.find((i) => i.key === f.issues)?.label.toLowerCase() ?? "");
  if (f.show) parts.push(`the list “${SHOWS.find((s) => s.key === f.show)?.label}”`);
  return parts.length ? parts.join(", ") : "these filters";
}
