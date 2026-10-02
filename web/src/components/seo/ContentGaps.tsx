import type { Reading } from "@/contract/common";
import type { ContentGaps as Gaps } from "@/contract/seo";
import { Bar } from "@/components/charts";
import { Card } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { EarlyFigure, EarlyLine } from "@/components/ui/Early";
import { Stamp } from "@/components/ui/Stamp";
import { Table } from "@/components/ui/Table";
import { num } from "@/lib/format";
import { SeoRead } from "./bits";
import "./seo.css";

/**
 * Content gap analysis, by the site's own services and industries (the crawl's
 * page types). The board grouped by a law firm's practice areas and promised
 * "potential traffic"; what is true is the impressions Google already gave
 * queries that no page of the site answers, grouped by the service or
 * industry page Google showed for them.
 */
export function ContentGaps({ reading, qs, className }: { reading: Reading<Gaps>; qs: string; className?: string }) {
  const listHref = `/seo/list/gaps${qs}`;
  const shown =
    reading.state !== "ok"
      ? "often enough to count"
      : reading.value.early
        ? `at least once (early signals: the standard floor of ${reading.value.early.standard} returns by itself once enough data exists)`
        : `at least ${reading.value.floor} times`;
  return (
    <Card
      className={className}
      title="Content gap analysis"
      icon="target"
      flush
      info={`Queries Google showed the site for, ${shown} in the period, for which no page of the site carries every word of the query in its title or main heading: a question the site is seen for and does not answer. Each is counted under the service or industry page Google showed most for it. Our own rule; it can only find gaps among queries Google already shows the site for.`}
      right={reading.state === "ok" ? <LinkButton href={listHref} size="sm">View opportunities</LinkButton> : null}
    >
      <SeoRead reading={reading}>
        {(g, r) => {
          const top = Math.max(1, ...g.groups.map((x) => x.impressions));
          return (
            <div className="dk-seo-flush">
              {g.early ? <EarlyLine early={g.early} rows="Groups whose queries are all" className="dk-seo-early" /> : null}
              <Table
                caption="Content gaps by service and industry"
                rows={g.groups}
                rowKey={(x) => x.path}
                minWidth={460}
                columns={[
                  {
                    key: "group",
                    head: "Industry / Service",
                    cell: (x) => (
                      <span className="dk-seo-cell-text" title={`${x.label} (${x.path})${x.top ? `. Largest: “${x.top}”` : ""}`}>
                        {x.label}
                      </span>
                    ),
                  },
                  { key: "gaps", head: "Keyword gaps", numeric: true, cell: (x) => num(x.queries), width: "112px" },
                  {
                    key: "impressions",
                    head: <span className="dk-seo-wraphead">Impressions without a matching page</span>,
                    cell: (x) => (
                      <span className="dk-seo-gapbar">
                        <EarlyFigure early={x.early} standard={g.early?.standard}>
                          <b className="dk-num">{num(x.impressions)}</b>
                        </EarlyFigure>
                        <Bar value={x.impressions} max={top} label={`${num(x.impressions)} impressions`} />
                      </span>
                    ),
                    width: "42%",
                  },
                ]}
                empty={
                  g.elsewhere.queries
                    ? `No gap lands on a service or industry page; ${num(g.elsewhere.queries)} land on other pages (see View opportunities).`
                    : g.early
                      ? "Every query Google has shown the site for so far has a page whose title or heading carries its words."
                      : `Every query Google showed the site for at least ${g.floor} times has a page whose title or heading carries its words.`
                }
              />
              <div className="dk-seo-flush-foot">
                <Stamp reading={r} />
                {g.elsewhere.queries ? (
                  <span className="dk-seo-foot-note">
                    {num(g.elsewhere.queries)} more on other pages, {num(g.elsewhere.impressions)} impressions
                  </span>
                ) : null}
              </div>
            </div>
          );
        }}
      </SeoRead>
    </Card>
  );
}
