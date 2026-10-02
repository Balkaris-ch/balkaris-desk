import type { Range } from "@/contract/common";
import type { InsightsPayload } from "@/contract/insights";
import { AreaChart, Legend } from "@/components/charts";
import { Card } from "@/components/ui/Card";
import { Delta } from "@/components/ui/Delta";
import { Read } from "@/components/ui/Read";
import { Select } from "@/components/ui/Select";
import { Stamp } from "@/components/ui/Stamp";
import { fullDate, num, rangeLabel, RANGES } from "@/lib/format";

export const RANGE_OPTIONS = RANGES.map((r: Range) => ({ value: r, label: rangeLabel(r) }));

/**
 * Article traffic: sessions that included an article, per day, from Organic
 * Search and Direct, with the period's total beside the title. The range
 * select is the screen's range; the content-type select narrows the line to
 * the articles on one shelf.
 */
export function TrafficPanel({ data }: { data: InsightsPayload }) {
  const t = data.traffic;
  return (
    <Card
      className="dk-insights-traffic"
      title="Article traffic"
      icon="bar-chart"
      info="Sessions that included an article (/insights/<article>), by GA4's channel. The total counts every channel; the lines are the two the board draws. Consenting visitors only."
      right={
        <div className="dk-insights-selects">
          <Select param="range" label="Period" options={RANGE_OPTIONS} fallback="30d" />
          {data.types.length ? (
            <Select param="type" label="Content type" options={[{ value: "", label: "All content types" }, ...data.types]} />
          ) : null}
        </div>
      }
    >
      <Read reading={t}>
        {(v, r) => (
          <div className="dk-insights-traffic-body">
            <div className="dk-insights-traffic-top">
              <p className="dk-insights-headline dk-num">
                <b>{num(v.visits)}</b>
                <span>{v.visits === 1 ? "visit" : "visits"}</span>
                {v.previous !== null ? (
                  <>
                    <Delta value={v.visits} previous={v.previous} />
                    <span className="dk-insights-vs">vs previous period</span>
                  </>
                ) : (
                  <span className="dk-insights-vs">no earlier period measured to compare with</span>
                )}
              </p>
              <Legend
                items={[
                  { label: "Organic", color: "green" },
                  { label: "Direct", color: "blue" },
                ]}
              />
            </div>
            <div className="dk-insights-chart">
            <AreaChart
              height="fill"
              label="Article visits per day"
              series={[
                { label: "Organic", data: v.organic.map((p) => ({ date: p.date, value: p.value })), color: "green" },
                { label: "Direct", data: v.direct.map((p) => ({ date: p.date, value: p.value })), color: "blue" },
              ]}
              provisional={v.provisional}
              provisionalNote="GA4 is still counting this day. The figure will change."
              emptyNote="GA4 recorded no article visits in this period."
              zeroNote="Nobody visited an article from these two channels in this period."
            />
            </div>
            <p className="dk-insights-foot">
              <Stamp reading={r} />
              {v.since ? <span>Measured since {fullDate(v.since)}</span> : null}
            </p>
          </div>
        )}
      </Read>
    </Card>
  );
}
