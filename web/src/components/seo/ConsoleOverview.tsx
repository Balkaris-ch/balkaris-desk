import type { Reading, Stat } from "@/contract/common";
import type { ConsoleOverview as Overview } from "@/contract/seo";
import { ComboChart, Legend, Spark } from "@/components/charts";
import { Card } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { Delta } from "@/components/ui/Delta";
import { Stamp } from "@/components/ui/Stamp";
import { change, DASH, figure, num } from "@/lib/format";
import { SeoRead } from "./bits";
import "./seo.css";

/**
 * One of the four totals. A rate (CTR) is compared as a percentage only when
 * it stands on at least 30 clicks; under that its two values are printed,
 * which is what the Delta does for any figure under 20.
 */
function Mini({ label, stat, downIsGood, digits, events }: { label: string; stat: Stat | null; downIsGood?: boolean; digits?: number; events?: number }) {
  const rate = stat && events !== undefined && events >= 30 ? change(stat.value, stat.previous) : undefined;
  return (
    <div className="dk-seo-mini">
      <p className="dk-seo-mini-label">{label}</p>
      <div className="dk-seo-mini-row">
        <div>
          <p className="dk-seo-mini-value dk-num">{stat ? (digits !== undefined ? num(stat.value, digits) : figure(stat.value, stat.unit)) : DASH}</p>
          {!stat ? (
            <span className="dk-seo-mini-none">no impressions to divide by</span>
          ) : rate !== undefined ? (
            <Delta percent={rate} downIsGood={downIsGood} size="sm" />
          ) : (
            <Delta value={stat.value} previous={stat.previous} unit={stat.unit} downIsGood={downIsGood} size="sm" />
          )}
        </div>
        {stat && stat.series.length > 1 ? <Spark data={stat.series} size="row" floor="min" tone={downIsGood ? "red" : "green"} className="dk-seo-mini-spark" /> : null}
      </div>
    </div>
  );
}

/**
 * Search Console overview: the four totals with their lines, and clicks as
 * columns under impressions as a line. "View details" opens Search Console's
 * own performance report for the property.
 */
export function ConsoleOverview({ reading, className }: { reading: Reading<Overview>; className?: string }) {
  const href = reading.state === "ok" ? reading.value.href : null;
  return (
    <Card
      className={className}
      title="Search Console overview"
      icon="search"
      info="Google Search only, final figures, two to three days behind. CTR is clicks over impressions for the whole period; position is Google’s average position weighted by impressions, not a tracked rank. Compared with the period before only when Google counted it whole."
      right={href ? <LinkButton href={href} size="sm" iconRight="external">View details</LinkButton> : null}
    >
      <SeoRead reading={reading}>
        {(o, r) => (
          <div className="dk-seo-console">
            <div className="dk-seo-minis">
              <Mini label="Total clicks" stat={o.clicks} />
              <Mini label="Total impressions" stat={o.impressions} />
              <Mini label="Avg. CTR" stat={o.ctr} events={o.clicks.value} />
              <Mini label="Avg. position" stat={o.position} downIsGood digits={1} />
            </div>
            <div className="dk-seo-console-plot">
              <ComboChart
                label="Clicks and impressions per day"
                height="fill"
                bars={{ label: "Clicks", data: o.days.map((d) => ({ date: d.date, value: d.clicks })), color: "green" }}
                line={{ label: "Impressions", data: o.days.map((d) => ({ date: d.date, value: d.impressions })), color: "ink" }}
              />
            </div>
            <div className="dk-seo-console-foot">
              <Legend
                items={[
                  { label: "Clicks", color: "green" },
                  { label: "Impressions", color: "ink" },
                ]}
              />
              <Stamp reading={r} />
            </div>
          </div>
        )}
      </SeoRead>
    </Card>
  );
}
