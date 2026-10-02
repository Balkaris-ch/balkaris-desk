import type { InsightsPayload } from "@/contract/insights";
import { Card } from "@/components/ui/Card";
import { EarlyFigure, EarlyLine } from "@/components/ui/Early";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Table } from "@/components/ui/Table";
import { DASH, num } from "@/lib/format";
import { ctrText } from "./rate";

/**
 * Opportunities: queries Search Console shows balkaris.ch for that no
 * article's title or heading answers. Only queries Google already shows the
 * site for: what people search and never see the site for cannot be known
 * for free. Absent, with the step that connects it, until Search Console is.
 * In an early window (src/cc/search/gsc.ts, EARLY) the list starts at one
 * impression, says so at its head and marks the rows under the standard floor.
 */
export function OpportunitiesPanel({ data }: { data: InsightsPayload }) {
  return (
    <Card
      title="Opportunities"
      icon="lightbulb"
      sub="Queries Google shows balkaris.ch for that no article answers: none of the articles carries every word of the query in its title or heading."
      flush={data.opportunities.state === "ok"}
      count={data.opportunities.state === "ok" ? num(data.opportunities.value.total) : undefined}
    >
      <Read reading={data.opportunities}>
        {(v, r) => (
          <>
            {v.early ? <EarlyLine early={v.early} rows="Queries" className="dk-insights-early" /> : null}
            <Table
              caption="Queries no article answers"
              rows={v.rows}
              rowKey={(q) => q.query}
              defaultSort={{ key: "impressions", dir: "desc" }}
              minWidth={640}
              empty={v.early ? "Every query Google has shown the site for so far is answered by an article's title or heading." : `No query shown at least ${v.floor} times is left unanswered.`}
              columns={[
                { key: "query", head: "Query", sort: (q) => q.query, cell: (q) => q.query },
                {
                  key: "impressions",
                  head: "Impressions",
                  numeric: true,
                  width: "116px",
                  sort: (q) => q.impressions,
                  cell: (q) => (
                    <EarlyFigure early={q.early} standard={v.early?.standard}>
                      {num(q.impressions)}
                    </EarlyFigure>
                  ),
                },
                { key: "clicks", head: "Clicks", numeric: true, width: "70px", sort: (q) => q.clicks, cell: (q) => num(q.clicks) },
                { key: "ctr", head: "CTR", numeric: true, width: "70px", sort: (q) => q.ctr, cell: (q) => ctrText(q.clicks, q.impressions, q.ctr) },
                { key: "position", head: "Avg. position", numeric: true, width: "100px", sort: (q) => q.position, cell: (q) => num(q.position, 1) },
                { key: "page", head: "Page Google shows", width: "34%", cell: (q) => q.path ?? DASH },
              ]}
            />
            <p className="dk-insights-foot dk-insights-foot--pad">
              {v.total > v.rows.length ? (
                <span>
                  The first {num(v.rows.length)} of {num(v.total)}, the most shown first.
                </span>
              ) : null}
              {/* Read early, the note repeats the line at the head: it stays on hover. */}
              <Stamp reading={r} showNote={!v.early} />
            </p>
          </>
        )}
      </Read>
    </Card>
  );
}
