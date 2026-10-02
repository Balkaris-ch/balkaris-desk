import type { Range, Reading } from "@/contract/common";
import type { SourcesPanel, TrafficPanel } from "@/contract/overview";
import { AreaChart, Donut, Legend, shareTexts } from "@/components/charts";
import { Card } from "@/components/ui/Card";
import { Delta } from "@/components/ui/Delta";
import { Read } from "@/components/ui/Read";
import { Select } from "@/components/ui/Select";
import { Stamp } from "@/components/ui/Stamp";
import { compact, num, RANGES, rangeLabel } from "@/lib/format";
import { dayMonth } from "./greeting";

const PERIODS = RANGES.map((r) => ({ value: r, label: rangeLabel(r) }));

/** "Website traffic": people per day over the range, the headline with its change, the previous period dashed where it was measured. */
export function TrafficCard({ reading, range }: { reading: Reading<TrafficPanel>; range: Range }) {
  return (
    <Card
      title="Website traffic"
      icon="line-chart"
      className="dk-overview-traffic"
      right={<Select label="Period" param="range" fallback="30d" options={PERIODS} />}
    >
      <Read reading={reading}>
        {(t, r) => (
          <>
            <p className="dk-overview-headline">
              <span className="dk-overview-big dk-num">{num(t.total)}</span>
              <span className="dk-overview-unit">visitors</span>
              {t.previous !== null ? (
                <span className="dk-overview-versus">
                  <Delta value={t.total} previous={t.previous} />
                  <span>vs previous period</span>
                </span>
              ) : (
                <span className="dk-overview-versus dk-overview-quiet">No earlier period to compare: GA4 has measured since {dayMonth(t.since)}</span>
              )}
              {/* The source line sits at the end of the headline, so the chart keeps the board's height. */}
              <span className="dk-overview-stampend">
                <Stamp reading={r} />
              </span>
            </p>
            <AreaChart
              label={`Visitors per day, ${rangeLabel(range).toLowerCase()}`}
              series={[{ label: "Visitors", data: t.days }]}
              previousLabel="Previous period"
              provisional={t.provisional}
              provisionalNote="GA4 may still change this day's figure."
              unit="count"
              emptyNote="GA4 has no day in this range yet."
              zeroNote="GA4 counted nobody on these days."
            />
          </>
        )}
      </Read>
    </Card>
  );
}

/** "Traffic sources": sessions by our six channel groups, the total in the middle. */
export function SourcesCard({ reading }: { reading: Reading<SourcesPanel> }) {
  return (
    <Card title="Traffic sources" className="dk-overview-sources" right={reading.state === "ok" ? <Stamp reading={reading} /> : null}>
      <Read reading={reading}>
        {(s) => {
          /* Shares of fewer than 30 sessions are noise: the counts are shown instead. */
          const shares = s.total < 30 ? s.slices.map((x) => num(x.value)) : shareTexts(s.slices.map((x) => x.value));
          return (
            <div className="dk-overview-donut">
              <Donut label="Sessions by source" slices={s.slices} figure={compact(s.total)} caption="Sessions" />
              <Legend layout="column" items={s.slices.map((x, i) => ({ label: x.label, share: s.total > 0 ? shares[i] : "" }))} />
            </div>
          );
        }}
      </Read>
    </Card>
  );
}
