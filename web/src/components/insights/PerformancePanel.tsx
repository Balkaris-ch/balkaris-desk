import type { ArticleFigures, InsightRow, InsightsPayload } from "@/contract/insights";
import { Chip } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Delta } from "@/components/ui/Delta";
import { Read } from "@/components/ui/Read";
import { Select } from "@/components/ui/Select";
import { Stamp } from "@/components/ui/Stamp";
import { Table } from "@/components/ui/Table";
import { Thumb } from "@/components/ui/Thumb";
import { DASH, duration, num } from "@/lib/format";
import { RowStatus } from "./status";
import { RANGE_OPTIONS } from "./TrafficPanel";

type Row = InsightRow & { f: ArticleFigures };

/**
 * Performance: every article on the site, most viewed first, with what GA4
 * knows about it over the range. A live article GA4 has no row for had no
 * views: that is a real zero.
 */
export function PerformancePanel({ data, rows }: { data: InsightsPayload; rows: InsightRow[] }) {
  return (
    <Card
      title="Performance"
      count={rows.length}
      flush={data.table.ga4.state === "ok"}
      info="Every article live on balkaris.ch, by GA4's views in the range. Entrances are sessions that began on the article. Consenting visitors only."
      right={<Select param="range" label="Period" options={RANGE_OPTIONS} fallback="30d" />}
    >
      <Read reading={data.table.ga4}>
        {(byPath, r) => {
          /* A live article GA4 has no row for had no views; its conversions are none too, unless GA4's leads read failed. */
          const zero = (prev: boolean): ArticleFigures => ({ views: 0, previousViews: prev ? 0 : null, users: 0, engagementSeconds: 0, entrances: 0, organic: 0, conversions: data.table.conversionsRead ? 0 : null });
          const measured = Object.values(byPath).some((f) => f.previousViews !== null);
          const list: Row[] = rows.map((row) => ({ ...row, f: byPath[row.path!] ?? zero(measured) }));
          return (
            <>
              <Table
                caption="Articles by views"
                rows={list}
                rowKey={(x) => x.key}
                rowHref={(x) => x.href}
                defaultSort={{ key: "views", dir: "desc" }}
                minWidth={900}
                empty="No article is live on the site yet."
                columns={[
                  {
                    key: "title",
                    head: "Article",
                    sort: (x) => x.title.toLowerCase(),
                    cell: (x) => (
                      <span className="dk-insights-cell-title">
                        <Thumb src={x.cover} size="sm" icon="article" />
                        <span className="dk-insights-cell-name">{x.title}</span>
                      </span>
                    ),
                  },
                  { key: "status", head: "Status", width: "112px", cell: (x) => <RowStatus row={x} /> },
                  { key: "category", head: "Category", width: "120px", cell: (x) => (x.category ? <Chip pill>{x.category.label}</Chip> : DASH) },
                  { key: "views", head: "Views", numeric: true, width: "70px", sort: (x) => x.f.views, cell: (x) => num(x.f.views) },
                  { key: "users", head: "Readers", numeric: true, width: "74px", sort: (x) => x.f.users, cell: (x) => num(x.f.users) },
                  {
                    key: "time",
                    head: "Time per reader",
                    numeric: true,
                    width: "104px",
                    sort: (x) => (x.f.users ? x.f.engagementSeconds / x.f.users : null),
                    cell: (x) => (x.f.users ? duration((x.f.engagementSeconds / x.f.users) * 1000) : DASH),
                  },
                  { key: "entrances", head: "Entrances", numeric: true, width: "80px", sort: (x) => x.f.entrances, cell: (x) => num(x.f.entrances) },
                  { key: "organic", head: "From search", numeric: true, width: "90px", sort: (x) => x.f.organic, cell: (x) => num(x.f.organic) },
                  { key: "conversions", head: "Conversions", numeric: true, width: "90px", sort: (x) => x.f.conversions, cell: (x) => (x.f.conversions === null ? DASH : num(x.f.conversions)) },
                  { key: "trend", head: "Views vs before", numeric: true, width: "104px", cell: (x) => <Delta value={x.f.views} previous={x.f.previousViews} size="sm" /> },
                ]}
              />
              <p className="dk-insights-foot dk-insights-foot--pad">
                <Stamp reading={r} showNote />
              </p>
            </>
          );
        }}
      </Read>
    </Card>
  );
}
