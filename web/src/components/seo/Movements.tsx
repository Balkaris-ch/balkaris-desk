import type { Reading } from "@/contract/common";
import type { MovementRow, Movements as Moves, SeoWindow } from "@/contract/seo";
import { cx } from "@/lib/cx";
import { Card } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { Stamp } from "@/components/ui/Stamp";
import { Table, type Column } from "@/components/ui/Table";
import { day, position, PositionChange, SeoRead } from "./bits";
import "./seo.css";

/** Under this width the table scrolls inside its panel, so the query or page keeps about 135px of text. */
export const MOVEMENT_MIN_WIDTH = 480;

export function movementColumns(window: SeoWindow): Column<MovementRow>[] {
  return [
    {
      key: "keyword",
      head: "Keyword or page",
      cell: (m) => (
        <span className="dk-seo-moved">
          <i className={cx("dk-seo-moved-dot", m.change > 0 ? "dk-seo-moved-dot--up" : "dk-seo-moved-dot--down")} aria-hidden />
          <span className="dk-seo-cell-text" title={m.label}>
            {m.label}
          </span>
        </span>
      ),
      sort: (m) => m.label,
    },
    { key: "previous", head: "Previous", numeric: true, cell: (m) => position(m.previous), sort: (m) => m.previous, width: "72px" },
    { key: "current", head: "Current", numeric: true, cell: (m) => position(m.current), sort: (m) => m.current, width: "68px" },
    { key: "change", head: "Change", cell: (m) => <PositionChange previous={m.previous} current={m.current} compared />, sort: (m) => m.change, width: "64px" },
    { key: "date", head: "Date", width: "100px", cell: () => <span title={`Average position ${window.start} to ${window.end}, against ${window.previousStart} to ${window.previousEnd}`}>{day(window.end)}</span> },
  ];
}

/**
 * Recent ranking movements: queries and pages whose average position moved
 * between this period and the one before, largest move first. The date is the
 * last day of the period the move was read over.
 */
export function Movements({ reading, qs, className }: { reading: Reading<Moves>; qs: string; className?: string }) {
  const listHref = `/seo/list/movements${qs}`;
  return (
    <Card
      className={className}
      title="Recent ranking movements"
      icon="sort"
      flush
      info={`Queries and pages whose average position changed between this period and the one before, by at least one position, counting only what Google showed ${reading.state === "ok" ? `at least ${reading.value.floor} times` : "often enough to count"} in both. Google’s average position, not a tracked rank.`}
      right={reading.state === "ok" && reading.value.total > 0 ? <LinkButton href={listHref} size="sm">View all</LinkButton> : null}
    >
      <SeoRead reading={reading}>
        {(m, r) => (
          <div className="dk-seo-flush">
            <Table
              caption="Recent ranking movements"
              rows={m.rows}
              rowKey={(x) => x.key}
              columns={movementColumns(m.window).map(({ sort: _sort, ...c }) => c)}
              minWidth={MOVEMENT_MIN_WIDTH}
              className="dk-seo-tight"
              empty={`Nothing moved by a whole position among what Google showed at least ${m.floor} times in both periods.`}
            />
            <div className="dk-seo-flush-foot">
              <Stamp reading={r} />
            </div>
          </div>
        )}
      </SeoRead>
    </Card>
  );
}
