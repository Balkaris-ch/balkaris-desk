import type { ReactNode } from "react";
import type { Reading } from "@/contract/common";
import type { ArticleFigures, InsightRow, SearchFigures } from "@/contract/insights";
import { LinkButton } from "@/components/ui/Button";
import { Chip, Count } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Delta } from "@/components/ui/Delta";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { Select } from "@/components/ui/Select";
import { Stamp } from "@/components/ui/Stamp";
import { Table, type Column } from "@/components/ui/Table";
import { Thumb } from "@/components/ui/Thumb";
import { Info } from "@/components/ui/Tooltip";
import { cx } from "@/lib/cx";
import { compact, DASH, fullDate, num, sourceLabel } from "@/lib/format";
import { SOURCE_ICON } from "./InboxPanel";
import { ctrText } from "./rate";
import { RetryButton } from "./RetryButton";
import { RowStatus, STATUS_OPTIONS } from "./status";
import { TableSearch } from "./TableSearch";

export interface InsightsTableProps {
  title: string;
  rows: InsightRow[];
  /** Before the search and the filters: the "(48)" beside the title. */
  total: number;
  ga4: Reading<Record<string, ArticleFigures>>;
  gsc: Reading<Record<string, SearchFigures>>;
  /** GA4's conversions read answered: a live article with no GA4 row had none. False: they are unknown. */
  conversionsRead: boolean;
  /** The shelves the category filter offers. */
  categories: { value: string; label: string }[];
  /** False on a tab that is itself a status. */
  statusFilter: boolean;
  asOf: string;
  empty: ReactNode;
  /**
   * Which columns. "site" is for pieces on balkaris.ch (the overview, Review, Published): the publish
   * date and GA4's and Search Console's figures. "queue" is for pieces not on the site (Inbox,
   * Drafts, Archive), where those could only ever be dashes: the day it was shared instead.
   */
  columns?: "site" | "queue";
  /** The Inbox tab: why a link is stuck or could not be read. */
  why?: boolean;
  /** The overview's narrow panel: the board's eleven columns in 715px, set tighter. */
  narrow?: boolean;
  /** At the end of the line under the table: the overview's "Show all". */
  more?: { href: string; label: string };
  className?: string;
}

/** Why a column is a dash: its source is not connected or did not answer. Said once, under the table, with the step on hover. */
function AbsentNote({ what, r }: { what: string; r: Reading<unknown> }) {
  if (r.state === "ok") return null;
  return (
    <span className="dk-insights-foot-absent">
      {what}: {r.state === "waiting" ? "nothing yet from" : "not available,"} {sourceLabel(r.source)} {r.state === "waiting" ? "" : "is not connected"}
      <Info text={`${r.reason}${r.state === "off" && r.step ? ` ${r.step}` : ""}`} />
    </span>
  );
}

/**
 * "All insights": every shared link, its article, and the articles written on
 * the website itself, with GA4's views and conversions and Search Console's
 * CTR and keywords beside the ones that are live. Search, status and
 * category filters write the address; the server draws only what matches.
 */
export function InsightsTable({ title, rows, total, ga4, gsc, conversionsRead, categories, statusFilter, asOf, empty, columns: set = "site", why, narrow, more, className }: InsightsTableProps) {
  const g = ga4.state === "ok" ? ga4.value : null;
  const s = gsc.state === "ok" ? gsc.value : null;
  const none = <span className="dk-insights-none">{DASH}</span>;

  /* A figure for a live article: GA4's (a missing row is a real zero when `zero` says so), or the reason there is none. Nothing for a piece not on the site. */
  const gaCell = (r: InsightRow, pick: (f: ArticleFigures) => ReactNode, zero: ReactNode = "0"): ReactNode => {
    if (!r.path) return none;
    if (ga4.state !== "ok") return <Absent reading={ga4} form="inline" />;
    const f = g![r.path];
    return f ? pick(f) : zero;
  };
  const gscCell = (r: InsightRow, pick: (f: SearchFigures) => ReactNode): ReactNode => {
    if (!r.path || !s) return none;
    const f = s[r.path];
    return f ? pick(f) : none;
  };

  const head: Column<InsightRow>[] = [
    {
      key: "title",
      head: "Title",
      cell: (r) => (
        <span className="dk-insights-cell-title">
          <Thumb src={r.cover} size="sm" icon={SOURCE_ICON[r.source.key] ?? "article"} />
          <span className="dk-insights-cell-name">{r.title}</span>
        </span>
      ),
    },
    { key: "status", head: "Status", cell: (r) => <RowStatus row={r} /> },
    { key: "source", head: "Source", cell: (r) => <span className="dk-insights-quiet">{r.source.label}</span> },
    {
      key: "category",
      head: "Category",
      cell: (r) =>
        r.category ? (
          <Chip pill className="dk-insights-shelf">
            <span title={r.category.label}>{r.category.label}</span>
          </Chip>
        ) : (
          none
        ),
    },
  ];

  const site: Column<InsightRow>[] = [
    {
      key: "date",
      head: "Publish date",
      sort: narrow ? undefined : (r) => r.published,
      cell: (r) =>
        r.published ? (
          <time className="dk-num" dateTime={r.published} title={narrow ? fullDate(r.published) : undefined}>
            {narrow ? (
              /* The narrow panel prints "30 Sep", and the year too once the panel has the room (insights.css). */
              <>
                <span className="dk-insights-date-day">{fullDate(r.published).replace(/ \d{4}$/, "")}</span>
                <span className="dk-insights-date-year"> {r.published.slice(0, 4)}</span>
              </>
            ) : (
              fullDate(r.published)
            )}
          </time>
        ) : (
          none
        ),
    },
    { key: "views", head: "Views", numeric: true, sort: (r) => (r.path && g ? (g[r.path]?.views ?? 0) : null), cell: (r) => gaCell(r, (f) => compact(f.views)) },
    { key: "ctr", head: "CTR", numeric: true, cell: (r) => gscCell(r, (f) => ctrText(f.clicks, f.impressions, f.ctr)) },
    {
      key: "keywords",
      head: "Keywords",
      align: "center",
      cell: (r) => gscCell(r, (f) => (f.keywords === null ? DASH : <Count>{num(f.keywords)}</Count>)),
    },
    {
      key: "conversions",
      head: "Conversions",
      numeric: true,
      sort: narrow ? undefined : (r) => (r.path && g && conversionsRead ? (g[r.path]?.conversions ?? 0) : null),
      /* A live article GA4 has no row for: no conversions if GA4's leads read answered, unknown if it did not. */
      cell: (r) => gaCell(r, (f) => (f.conversions === null ? none : num(f.conversions)), conversionsRead ? "0" : none),
    },
    {
      key: "trend",
      head: <span className="dk-sr">Trend</span>,
      numeric: true,
      cell: (r) => gaCell(r, (f) => <Delta value={f.views} previous={f.previousViews} size="sm" />, none),
    },
  ];

  const queue: Column<InsightRow>[] = [
    {
      key: "shared",
      head: "Shared",
      sort: (r) => r.shared,
      cell: (r) => (r.shared ? <time className="dk-num" dateTime={r.shared}>{fullDate(r.shared)}</time> : none),
    },
    ...(why
      ? [
          {
            key: "why",
            head: "Why",
            width: "34%",
            cell: (r: InsightRow) => (r.problem ? <span className="dk-insights-why" title={r.problem}>{r.problem}</span> : none),
          },
        ]
      : []),
  ];

  const act: Column<InsightRow> = {
    key: "do",
    head: <span className="dk-sr">Actions</span>,
    align: "right",
    cell: (r) =>
      r.canRetry && r.linkId !== null ? (
        <RetryButton linkId={r.linkId} compact />
      ) : r.liveUrl && r.source.key !== "site" ? (
        <LinkButton href={r.liveUrl} variant="ghost" size="xs" icon="external" aria-label={`Read “${r.title}” on balkaris.ch`} title="Read it on balkaris.ch" />
      ) : null,
  };

  /* The overview's panel is narrow: its rows open the article, and the inbox beside it carries the retry. */
  const columns = [...head, ...(set === "site" ? site : queue), ...(narrow ? [] : [act])];
  const figures = set === "site";

  return (
    <Card
      className={cx("dk-insights-tablecard", narrow && "dk-insights-dense", className)}
      title={title}
      count={total}
      flush
      right={
        <div className="dk-insights-filters">
          <TableSearch />
          {statusFilter ? <Select param="status" label="Status" options={[{ value: "", label: "All status" }, ...STATUS_OPTIONS]} /> : null}
          {categories.length ? <Select param="category" label="Category" options={[{ value: "", label: "All categories" }, ...categories]} /> : null}
        </div>
      }
    >
      <Table caption={title} rows={rows} rowKey={(r) => r.key} rowHref={(r) => r.href} columns={columns} minWidth={narrow ? undefined : 700} empty={empty} />
      <p className="dk-insights-foot dk-insights-foot--pad">
        <Stamp source="desk" asOf={asOf} />
        {figures ? (
          <>
            <Stamp reading={ga4} />
            <Stamp reading={gsc} />
            <AbsentNote what="Views and conversions" r={ga4} />
            {ga4.state === "ok" && !conversionsRead ? (
              <span className="dk-insights-foot-absent">
                Conversions: GA4 did not answer
                <Info text="GA4's read of enquiries (generate_lead) failed this time, so conversions show a dash where they are not known. The views came through." />
              </span>
            ) : null}
            <AbsentNote what="CTR and keywords" r={gsc} />
          </>
        ) : null}
        {more ? (
          <Go href={more.href} className="dk-insights-more">
            {more.label}
            <Icon name="chevron-right" size={14} />
          </Go>
        ) : null}
      </p>
    </Card>
  );
}
