import type { Reading } from "@/contract/common";
import type { RankingTrend as Trend } from "@/contract/seo";
import { AreaChart, Legend } from "@/components/charts";
import { Card } from "@/components/ui/Card";
import { Delta } from "@/components/ui/Delta";
import { Select } from "@/components/ui/Select";
import { Stamp } from "@/components/ui/Stamp";
import { num, rangeLabel, RANGES } from "@/lib/format";
import { SeoRead } from "./bits";
import "./seo.css";

const PERIODS = RANGES.map((r) => ({ value: r, label: rangeLabel(r) }));

/**
 * Ranking trend: per day, how many queries Google showed the site for in the
 * top 3, the top 10 and the top 50. The board's "avg. keyword positions" is
 * not a measure anything reports; the headline here is the number of queries
 * whose average position over the period is 50 or better.
 */
export function RankingTrend({ reading, className }: { reading: Reading<Trend>; className?: string }) {
  return (
    <Card
      className={className}
      title="Ranking trend"
      icon="bar-chart"
      info="Counts of the queries Google showed the site for, per day, by their average position that day: 3 or better, 10 or better, 50 or better (each band includes the ones above it). Google’s average position, not a tracked rank; rare queries are withheld by Google."
      right={<Select label="Period" param="range" fallback="30d" options={PERIODS} />}
    >
      <SeoRead reading={reading}>
        {(t, r) => (
          <div className="dk-seo-trend">
            <div className="dk-seo-trend-head">
              <p className="dk-seo-trend-figure">
                <b className="dk-num">{num(t.top50)}</b>
                <span>{`${t.complete ? "" : "or more "}${t.top50 === 1 ? "query" : "queries"} in the top 50`}</span>
                {t.previousTop50 !== null ? (
                  <>
                    <Delta value={t.top50} previous={t.previousTop50} />
                    <span className="dk-seo-trend-vs">vs previous period</span>
                  </>
                ) : (
                  /* No lone dash: say why there is no comparison. */
                  <span className="dk-seo-trend-vs">no earlier period with Google’s queries to compare</span>
                )}
              </p>
              <Legend
                className="dk-seo-trend-legend"
                items={[
                  { label: "Top 3", color: "green" },
                  { label: "Top 10", color: "blue" },
                  { label: "Top 50", color: "grey" },
                ]}
              />
            </div>
            <div className="dk-seo-trend-plot">
              <AreaChart
                label="Queries in the top 3, top 10 and top 50 per day"
                height="fill"
                series={[
                  { label: "Top 50", data: t.days.map((d) => ({ date: d.date, value: d.top50 })), color: "grey" },
                  { label: "Top 10", data: t.days.map((d) => ({ date: d.date, value: d.top10 })), color: "blue" },
                  { label: "Top 3", data: t.days.map((d) => ({ date: d.date, value: d.top3 })), color: "green" },
                ]}
              />
            </div>
            <Stamp reading={r} />
          </div>
        )}
      </SeoRead>
    </Card>
  );
}
