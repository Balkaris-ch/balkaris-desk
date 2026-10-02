import type { Reading, Stat } from "@/contract/common";
import type { ConsolePanel } from "@/contract/seo/overview";
import { ComboChart, Legend } from "@/components/charts";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Delta } from "@/components/ui/Delta";
import { Stamp } from "@/components/ui/Stamp";
import { PanelAbsent } from "@/components/seo/bits";
import { DASH, figure, num } from "@/lib/format";
import "./overview.css";

function Figure({ label, stat, downIsGood, digits }: { label: string; stat: Stat | null; downIsGood?: boolean; digits?: number }) {
  return (
    <div className="dk-seo-overview-fig">
      <p className="dk-seo-overview-sublabel">{label}</p>
      <p className="dk-seo-overview-fig-row">
        <span className="dk-seo-overview-fig-value dk-num">{stat ? (digits !== undefined ? num(stat.value, digits) : figure(stat.value, stat.unit)) : DASH}</span>
        {stat ? <Delta value={stat.value} previous={stat.previous} unit={stat.unit} downIsGood={downIsGood} size="sm" /> : null}
      </p>
    </div>
  );
}

/**
 * Search Console (board 104): clicks, impressions and average position for
 * the period, with clicks as columns under impressions as a line, from the
 * desk's own daily copy. "Open" is Search Console's own performance report.
 */
export function Console({ reading }: { reading: Reading<ConsolePanel> }) {
  const href = reading.state === "ok" ? reading.value.href : null;
  return (
    <Card
      title="Search Console"
      icon="line-chart"
      className="dk-seo-overview-panel dk-seo-overview-a-sc"
      info="Google Search, web results, final days (two to three days behind), from the desk’s own daily copy of Search Console. Compared with the period before only when the copy covers it whole."
      right={
        <>
          <LinkButton href="/seo/search-console" size="sm">
            View
          </LinkButton>
          {href ? (
            <LinkButton href={href} size="sm" iconRight="external">
              Open
            </LinkButton>
          ) : null}
        </>
      }
    >
      {reading.state === "ok" ? (
        <div className="dk-seo-overview-sc">
          <div className="dk-seo-overview-figs">
            <Figure label="Clicks" stat={reading.value.clicks} />
            <Figure label="Impressions" stat={reading.value.impressions} />
            <Figure label="Avg. position" stat={reading.value.position} downIsGood digits={1} />
          </div>
          <div className="dk-seo-overview-sc-plot">
            <ComboChart
              label="Clicks and impressions per day"
              height="fill"
              bars={{ label: "Clicks", data: reading.value.days.map((d) => ({ date: d.date, value: d.clicks })), color: "green" }}
              line={{ label: "Impressions", data: reading.value.days.map((d) => ({ date: d.date, value: d.impressions })), color: "ink" }}
            />
          </div>
          <div className="dk-seo-overview-sc-foot">
            <Legend
              items={[
                { label: "Clicks", color: "green" },
                { label: "Impressions", color: "ink" },
              ]}
            />
            <Stamp reading={reading} />
          </div>
        </div>
      ) : (
        <PanelAbsent reading={reading} />
      )}
    </Card>
  );
}
