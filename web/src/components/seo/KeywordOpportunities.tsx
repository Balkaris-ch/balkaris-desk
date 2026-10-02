import type { Reading } from "@/contract/common";
import type { Opportunities, OpportunityRow } from "@/contract/seo";
import { Card } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { EarlyFigure, EarlyLine } from "@/components/ui/Early";
import { Stamp } from "@/components/ui/Stamp";
import { Table, type Column } from "@/components/ui/Table";
import { ctrText } from "@/components/insights/rate";
import { num } from "@/lib/format";
import { position, PositionChange, SeoRead } from "./bits";
import "./seo.css";

/** Where "Optimize" leads: the AI operator, with the query chosen for a page brief. */
export const briefHref = (query: string): string => `/operator?do=brief&q=${encodeURIComponent(query)}`;

/** Under this width the table scrolls inside its panel, so the keyword keeps about 190px of its own. */
export const OPPORTUNITY_MIN_WIDTH = 640;

/** What the list holds, for the empty table: the genuinely empty case of an early list says it plainly. */
export const opportunitiesEmpty = (o: { floor: number; early: unknown }): string =>
  o.early ? "Google has not shown the site for any query at an average position of 4 to 20 in this period yet." : `No query sits at position 4 to 20 with at least ${o.floor} impressions in this period.`;

/**
 * The columns, for the panel and the full list. `compared` is the list's: only
 * then is a query without an earlier position "new". `standard` is the early
 * list's standard floor: a row under it carries the early mark beside its
 * impressions. A click-through rate on fewer than thirty impressions is
 * printed as its two counts.
 */
export function opportunityColumns(compared: boolean, standard?: number): Column<OpportunityRow>[] {
  return [
    { key: "keyword", head: "Keyword", cell: (r) => <span className="dk-seo-cell-text" title={r.query}>{r.query}</span>, sort: (r) => r.query },
    { key: "position", head: "Position", numeric: true, cell: (r) => position(r.position), sort: (r) => r.position, width: "76px" },
    {
      key: "change",
      head: <span className="dk-sr">Change</span>,
      cell: (r) => <PositionChange previous={r.previousPosition} current={r.position} compared={compared} early={r.early} changeFloor={r.changeFloor} />,
      width: "56px",
    },
    {
      key: "impressions",
      head: "Impressions",
      numeric: true,
      cell: (r) => (
        <EarlyFigure early={r.early} standard={standard}>
          {num(r.impressions)}
        </EarlyFigure>
      ),
      sort: (r) => r.impressions,
      width: standard ? "112px" : "96px",
    },
    { key: "ctr", head: "CTR", numeric: true, cell: (r) => ctrText(r.clicks, r.impressions, r.ctr), sort: (r) => r.ctr, width: "64px" },
    { key: "clicks", head: "Clicks", numeric: true, cell: (r) => num(r.clicks), sort: (r) => r.clicks, width: "64px" },
    {
      key: "action",
      head: "Action",
      align: "right",
      width: "96px",
      cell: (r) => (
        <LinkButton href={briefHref(r.query)} variant="good" size="xs" aria-label={`Optimize for “${r.query}”: a page brief in the AI operator`}>
          Optimize
        </LinkButton>
      ),
    },
  ];
}

/**
 * Keyword opportunities: queries already on Google's first two pages. Search
 * volume has no free source, so its column is left out; Clicks, which Search
 * Console does give, stands in its place. In an early window the list starts
 * at one impression and says so at its head (gsc.ts, EARLY).
 */
export function KeywordOpportunities({ reading, qs, className }: { reading: Reading<Opportunities>; qs: string; className?: string }) {
  const listHref = `/seo/list/opportunities${qs}`;
  const shown =
    reading.state !== "ok"
      ? ""
      : reading.value.early
        ? `, shown at least once (early signals: the standard floor of ${reading.value.early.standard} impressions returns by itself once enough data exists)`
        : `, shown at least ${reading.value.floor} times`;
  return (
    <Card
      className={className}
      title="Keyword opportunities"
      icon="search"
      flush
      info={`Queries Google shows the site for at an average position of 4 to 20 over the period${shown}, most impressions first: the ones a better page can move. Search Console, Google Search only. Search volume has no free source, so Clicks is shown instead.`}
      right={reading.state === "ok" && reading.value.total > 0 ? <LinkButton href={listHref} size="sm">View all</LinkButton> : null}
    >
      <SeoRead reading={reading}>
        {(o, r) => (
          <div className="dk-seo-flush">
            {o.early ? <EarlyLine early={o.early} rows="Queries" className="dk-seo-early" /> : null}
            {/* No rows: the sentence as a paragraph the width of the panel, not an empty row of a table wider than a phone. */}
            {o.rows.length ? (
              <Table
                caption="Keyword opportunities"
                rows={o.rows}
                rowKey={(row) => row.query}
                /* The panel shows the rows as ranked; the full list sorts. */
                columns={opportunityColumns(o.compared, o.early?.standard).map(({ sort: _sort, ...c }) => c)}
                minWidth={OPPORTUNITY_MIN_WIDTH}
              />
            ) : (
              <p className="dk-seo-none">{opportunitiesEmpty(o)}</p>
            )}
            <div className="dk-seo-flush-foot">
              <Stamp reading={r} />
            </div>
          </div>
        )}
      </SeoRead>
    </Card>
  );
}
