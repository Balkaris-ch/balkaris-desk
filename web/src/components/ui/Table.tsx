import { Fragment, type ReactNode } from "react";
import { TableView, type ViewHead, type ViewRow } from "./TableView";

export interface Column<Row> {
  /** Unique in the table. Names the column for `defaultSort`. */
  key: string;
  /** The column's heading. */
  head: ReactNode;
  /** What the column shows for a row. */
  cell: (row: Row) => ReactNode;
  /** Figures: right-aligned, tabular, so a column of numbers lines up. */
  numeric?: boolean;
  align?: "left" | "right" | "center";
  /**
   * The value the column sorts by. Giving it makes the heading a sort button
   * (in the browser, over the rows already on the page). Null sorts last.
   */
  sort?: (row: Row) => number | string | null | undefined;
  /** A CSS width for the column ("32%", "120px"). The first column takes what is left. */
  width?: string;
}

export interface TableProps<Row> {
  rows: readonly Row[];
  columns: readonly Column<Row>[];
  rowKey: (row: Row) => string | number;
  /** What the table lists, for a screen reader: "Pages". */
  caption: string;
  /** Makes the whole row a link. The first column's content becomes the link itself. */
  rowHref?: (row: Row) => string | null | undefined;
  /**
   * A checkbox column. The boxes are real form fields named `name` whose value
   * is the row's key, so the table must sit inside a <form> whose button does
   * something with the ticked rows. Without such a form, leave this out.
   */
  select?: { name: string; label: (row: Row) => string };
  /** The line shown instead of rows when there are none. Say why, if it is known. */
  empty?: ReactNode;
  /** The column and direction the rows start in, when the server did not order them. */
  defaultSort?: { key: string; dir: "asc" | "desc" };
  /** dense is the boards' list (34px rows); roomy has a picture or two lines per row (44px). */
  density?: "dense" | "roomy";
  /** caps is the boards' uppercase label heads; plain is the Pages board's sentence-case heads. */
  heads?: "caps" | "plain";
  /** Under this many pixels the table scrolls sideways inside its panel instead of crushing its columns. */
  minWidth?: number;
  /** A row link that only changes this page's search params (opening a side panel): stay where the reader has scrolled to. */
  keepScroll?: boolean;
  className?: string;
}

/**
 * The boards' table: dense rows, label heads, right-aligned figures, optional
 * row link, checkbox column and browser-side sort, and a plain line when
 * there are no rows.
 *
 * Put it in a `<Card flush>`. Cells are drawn here, on the server, from the
 * `cell` functions; only the sort and the checkboxes run in the browser.
 *
 *   <Table caption="Top pages" rows={pages} rowKey={(p) => p.path}
 *     columns={[
 *       { key: "page", head: "Page", cell: (p) => p.path },
 *       { key: "visitors", head: "Visitors", numeric: true, cell: (p) => num(p.visitors), sort: (p) => p.visitors },
 *     ]} />
 */
export function Table<Row>({ rows, columns, rowKey, caption, rowHref, select, empty, defaultSort, density = "dense", heads = "caps", minWidth, keepScroll, className }: TableProps<Row>) {
  const viewHeads: ViewHead[] = columns.map((c) => ({
    key: c.key,
    head: c.head,
    align: c.align ?? (c.numeric ? "right" : "left"),
    numeric: Boolean(c.numeric),
    sortable: Boolean(c.sort),
    width: c.width,
  }));

  const viewRows: ViewRow[] = rows.map((row) => ({
    key: String(rowKey(row)),
    href: rowHref?.(row) ?? null,
    pick: select ? select.label(row) : null,
    /* Keyed: an array of elements sent to the browser is checked for keys as if it were a list. */
    cells: columns.map((c) => <Fragment key={c.key}>{c.cell(row)}</Fragment>),
    sorts: columns.map((c) => (c.sort ? (c.sort(row) ?? null) : null)),
  }));

  return (
    <TableView
      heads={viewHeads}
      rows={viewRows}
      caption={caption}
      selectName={select?.name ?? null}
      empty={empty ?? "No rows."}
      defaultSort={defaultSort ?? null}
      density={density}
      headStyle={heads}
      minWidth={minWidth ?? null}
      keepScroll={keepScroll}
      className={className}
    />
  );
}
