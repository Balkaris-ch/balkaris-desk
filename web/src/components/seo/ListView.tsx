import type { SeoList } from "@/contract/seo";
import { Card } from "@/components/ui/Card";
import { EarlyFigure, EarlyLine } from "@/components/ui/Early";
import { Stamp } from "@/components/ui/Stamp";
import { Table } from "@/components/ui/Table";
import { num } from "@/lib/format";
import { position, windowText, SeoRead } from "./bits";
import { opportunitiesEmpty, opportunityColumns } from "./KeywordOpportunities";
import { organicLandingColumns, searchLandingColumns } from "./Landing";
import { movementColumns, movementsEmpty } from "./Movements";
import "./seo.css";

export const LIST_TITLES = {
  opportunities: { title: "Keyword opportunities", sub: "Every query Google shows the site for at an average position of 4 to 20, most impressions first." },
  gaps: { title: "Content gaps", sub: "Every query Google shows the site for that no page of the site answers in its title or main heading, most impressions first." },
  movements: { title: "Ranking movements", sub: "Every query and page whose average position moved by a whole position against the period before, largest move first." },
  landing: { title: "Top landing pages (SEO)", sub: "Every page people arrived on from search in the period." },
} as const;

/** One of the SEO screen's lists, whole and sortable. */
export function ListView({ list }: { list: SeoList }) {
  const meta = LIST_TITLES[list.name];
  return (
    <Card title={meta.title} icon="list" flush className="dk-seo-panel dk-seo-list" sub={list.reading.state === "ok" ? listSub(list) : undefined}>
      <SeoRead reading={list.reading}>
        {(b, r) => (
          <div className="dk-seo-flush">
            {(b.name === "opportunities" || b.name === "gaps") && b.early ? <EarlyLine early={b.early} rows="Queries" className="dk-seo-early" /> : null}
            {b.name === "opportunities" ? (
              <Table
                caption={meta.title}
                rows={b.rows}
                rowKey={(x) => x.query}
                columns={opportunityColumns(b.compared, b.early?.standard)}
                minWidth={640}
                defaultSort={{ key: "impressions", dir: "desc" }}
                empty={opportunitiesEmpty(b)}
              />
            ) : b.name === "gaps" ? (
              <Table
                caption={meta.title}
                rows={b.rows}
                rowKey={(x) => x.query}
                minWidth={640}
                defaultSort={{ key: "impressions", dir: "desc" }}
                columns={[
                  { key: "query", head: "Query", cell: (x) => <span className="dk-seo-cell-text">{x.query}</span>, sort: (x) => x.query },
                  {
                    key: "impressions",
                    head: "Impressions",
                    numeric: true,
                    cell: (x) => (
                      <EarlyFigure early={x.early} standard={b.early?.standard}>
                        {num(x.impressions)}
                      </EarlyFigure>
                    ),
                    sort: (x) => x.impressions,
                  },
                  { key: "clicks", head: "Clicks", numeric: true, cell: (x) => num(x.clicks), sort: (x) => x.clicks },
                  { key: "position", head: "Position", numeric: true, cell: (x) => position(x.position), sort: (x) => x.position },
                  { key: "page", head: "Page Google shows", cell: (x) => <span className="dk-seo-cell-text">{x.path ?? "not known"}</span>, sort: (x) => x.path ?? "" },
                  { key: "group", head: "Service or industry", cell: (x) => <span className="dk-seo-cell-text">{x.group ?? "Another page"}</span>, sort: (x) => x.group ?? "" },
                ]}
                empty={b.early ? "Every query Google has shown the site for so far has a page whose title or heading carries its words." : "No query in this period lacks a page that answers it."}
              />
            ) : b.name === "movements" ? (
              /* No rows: the sentence as a paragraph the width of the panel, as on the screen's own panel (Movements.tsx). */
              b.rows.length ? (
                <Table caption={meta.title} rows={b.rows} rowKey={(x) => x.key} columns={movementColumns(b.window)} minWidth={560} className="dk-seo-tight" />
              ) : (
                <p className="dk-seo-none">{movementsEmpty(b)}</p>
              )
            ) : b.landings.source === "gsc" ? (
              <Table caption={meta.title} rows={b.landings.rows} rowKey={(x) => x.page} columns={searchLandingColumns(b.landings.compared)} minWidth={640} className="dk-seo-tight" empty="Google sent nobody to any page in this period." />
            ) : (
              <Table caption={meta.title} rows={b.landings.rows} rowKey={(x) => x.path} columns={organicLandingColumns} minWidth={480} className="dk-seo-tight" empty="GA4 saw no session begin from Organic Search in this period." />
            )}
            <div className="dk-seo-flush-foot">
              <Stamp reading={r} />
              {b.name === "landing" && b.landings.source === "ga4" ? <span className="dk-seo-foot-note">Organic landings (GA4). Search Console: {b.landings.why}</span> : null}
            </div>
          </div>
        )}
      </SeoRead>
    </Card>
  );
}

function listSub(list: SeoList): string {
  if (list.reading.state !== "ok") return "";
  const b = list.reading.value;
  const meta = LIST_TITLES[list.name];
  if (b.name === "landing") {
    const l = b.landings;
    return l.source === "gsc" ? `${meta.sub} ${windowText(l.window)}, ${num(l.total)} pages.` : `${meta.sub} ${windowText(l)}, ${num(l.total)} pages, from GA4.`;
  }
  const early = (b.name === "opportunities" || b.name === "gaps") && b.early;
  return `${meta.sub} ${windowText(b.window)}, ${num(b.rows.length)} ${b.rows.length === 1 ? "row" : "rows"}; ${early ? `each shown at least once (early signals; the standard floor is ${early.standard})` : `each shown at least ${b.floor} times`}.`;
}
