import type { CSSProperties } from "react";
import type { Reading } from "@/contract/common";
import type { ExplorerResult } from "@/contract/seo/search-console";
import { ComboChart, Legend, LineChart } from "@/components/charts";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Stamp } from "@/components/ui/Stamp";
import { PanelAbsent } from "@/components/seo/bits";
import { cx } from "@/lib/cx";
import { fullDate, num, shortDate } from "@/lib/format";
import { CHART_METRICS, scHref, type ChartMetric, type Place } from "./href";

const METRIC_LABEL: Record<ChartMetric, string> = { volume: "Clicks & impressions", ctr: "CTR", position: "Position" };

/* ---------- Google's average position, drawn the way a position reads ------------------------------ */

/** The bottom of the axis: the first round depth past every reading. */
function depth(deepest: number): { max: number; ticks: number[] } {
  for (const [max, ticks] of [
    [5, [1, 3, 5]],
    [10, [1, 5, 10]],
    [20, [1, 5, 10, 15, 20]],
    [30, [1, 10, 20, 30]],
    [50, [1, 10, 20, 30, 40, 50]],
    [100, [1, 25, 50, 75, 100]],
  ] as const) {
    if (deepest <= max) return { max, ticks: [...ticks] };
  }
  const max = Math.ceil(deepest / 50) * 50;
  return { max, ticks: [1, Math.round(max / 2), max] };
}

const at = (x: number, y: number): CSSProperties => ({ left: `${x}%`, top: `${y}%` });

/**
 * Average position per day with 1 at the top. The desk's time charts put the
 * larger number higher, which for a position is upside down, so this one is
 * drawn here in the charts' manner: straight segments, a dot on each reading
 * (up to three months of them), a gap on a day Google did not show the site,
 * never a zero. The lines are an SVG stretched over the plot; the dots and the
 * labels are HTML placed in percent, so neither is stretched with it.
 */
function PositionPlot({ days, label }: { days: ExplorerResult["days"]; label: string }) {
  const ranked = days.filter((d) => d.position !== null);
  if (!ranked.length) return <p className="dk-seo-gsc-chart-none">Google showed the site in no search in this window, so there is no position to draw.</p>;
  const axis = depth(Math.max(...ranked.map((d) => d.position as number)));
  const x = (i: number): number => (days.length === 1 ? 50 : (i / (days.length - 1)) * 100);
  const y = (p: number): number => ((Math.min(p, axis.max) - 1) / (axis.max - 1)) * 100;

  const runs: string[] = [];
  let run: string[] = [];
  days.forEach((d, i) => {
    if (d.position === null) {
      if (run.length > 1) runs.push(run.join(" "));
      run = [];
      return;
    }
    run.push(`${run.length ? "L" : "M"}${x(i).toFixed(2)} ${y(d.position).toFixed(2)}`);
  });
  if (run.length > 1) runs.push(run.join(" "));
  const labelled = days.length === 1 ? [0] : [...new Set([0, Math.floor((days.length - 1) / 2), days.length - 1])];
  const dots = days.length <= 92;
  /* Past three months only a reading with no line through it keeps its dot: without one it would not be drawn at all. */
  const alone = (i: number): boolean => (days[i - 1]?.position ?? null) === null && (days[i + 1]?.position ?? null) === null;

  return (
    <div className="dk-seo-gsc-pos" role="img" aria-label={label}>
      <div className="dk-seo-gsc-pos-plot">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          {axis.ticks.map((t) => (
            <line key={t} className="dk-seo-gsc-pos-grid" x1={0} x2={100} y1={y(t)} y2={y(t)} />
          ))}
          {runs.map((d, i) => (
            <path key={i} className="dk-seo-gsc-pos-line" d={d} />
          ))}
        </svg>
        {axis.ticks.map((t) => (
          <span key={t} className="dk-seo-gsc-pos-y" style={{ top: `${y(t)}%` }} aria-hidden>
            {t}
          </span>
        ))}
        {days.map((d, i) =>
          d.position === null || (!dots && !alone(i)) ? null : (
            <i
              key={d.date}
              className="dk-seo-gsc-pos-dot"
              style={at(x(i), y(d.position))}
              title={`${fullDate(d.date)}: position ${num(d.position, 1)}, shown ${num(d.impressions)} ${d.impressions === 1 ? "time" : "times"}, ${num(d.clicks)} ${d.clicks === 1 ? "click" : "clicks"}`}
            />
          ),
        )}
        {labelled.map((i) => (
          <span key={i} className="dk-seo-gsc-pos-x" data-edge={days.length === 1 ? undefined : i === 0 ? "start" : i === days.length - 1 ? "end" : undefined} style={{ left: `${x(i)}%` }} aria-hidden>
            {shortDate(days[i]!.date)}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------- the card ---------------------------------------------------------------------------------- */

/**
 * A window in one date order: "31 Aug – 29 Sep 2026", or with both years when
 * it crosses one ("30 Sep 2025 – 29 Sep 2026"), so it never reads backwards.
 * One day is that day.
 */
export function spanText(start: string, end: string): string {
  if (start === end) return fullDate(end);
  const from = fullDate(start);
  return `${start.slice(0, 4) === end.slice(0, 4) ? from.replace(/ \d{4}$/, "") : from} – ${fullDate(end)}`;
}

/**
 * Search Console's performance chart for the view as filtered: clicks as
 * columns under impressions as a line (each on its own axis), or the day's
 * CTR, or Google's average position with 1 at the top. The three are links,
 * so the server draws the one asked for and the view can be shared.
 */
export function ScChart({ result, place }: { result: Reading<ExplorerResult>; place: Place }) {
  const r = result.state === "ok" ? result.value : null;
  const metric = place.chart;
  return (
    <Card
      title="Performance"
      icon="line-chart"
      className="dk-seo-gsc-chart"
      info="Per day for the view as filtered, the same days the four figures above add up. Google Search, web results, final days only (two to three days behind). A day Google did not show the site is a real zero for clicks and impressions, and a gap for CTR and position."
      sub={r ? `${spanText(r.start, r.end)}${r.days.length && r.days[0]!.date > r.start ? ` · figures from ${fullDate(r.days[0]!.date)}` : ""}` : undefined}
      right={
        <nav className="dk-seo-gsc-switch" aria-label="What the chart shows">
          {CHART_METRICS.map((m) => (
            <Go key={m} href={scHref(place, { chart: m })} scroll={false} replace className={cx("dk-seo-gsc-switch-item", m === metric && "dk-seo-gsc-switch-item--on")} aria-current={m === metric ? "true" : undefined}>
              {METRIC_LABEL[m]}
            </Go>
          ))}
        </nav>
      }
    >
      {result.state !== "ok" || !r ? (
        <PanelAbsent reading={result as Exclude<Reading<ExplorerResult>, { state: "ok" }>} />
      ) : (
        <div className="dk-seo-gsc-chart-body">
          <div className="dk-seo-gsc-chart-plot">
            {metric === "volume" ? (
              <ComboChart
                label="Clicks and impressions per day"
                bars={{ label: "Clicks", data: r.days.map((d) => ({ date: d.date, value: d.clicks })), color: "green" }}
                line={{ label: "Impressions", data: r.days.map((d) => ({ date: d.date, value: d.impressions })), color: "ink" }}
              />
            ) : metric === "ctr" ? (
              <LineChart
                label="CTR per day"
                unit="percent"
                series={[{ label: "CTR", data: r.days.map((d) => ({ date: d.date, value: d.impressions ? Math.round((d.clicks / d.impressions) * 10000) / 100 : null })), color: "green" }]}
                emptyNote="No impressions in this window, so there is no rate to draw."
              />
            ) : (
              <PositionPlot days={r.days} label="Average position per day, 1 at the top" />
            )}
          </div>
          <div className="dk-seo-gsc-chart-foot">
            {metric === "volume" ? (
              <Legend
                items={[
                  { label: "Clicks", color: "green" },
                  { label: "Impressions", color: "ink" },
                ]}
              />
            ) : metric === "ctr" ? (
              <p className="dk-seo-gsc-chart-said">Each day’s clicks over that day’s impressions: on a handful of impressions a day it jumps between 0% and 100%.</p>
            ) : (
              <p className="dk-seo-gsc-chart-said">Google’s average position each day, weighted by impressions; 1 is the top. Hover a dot for the day’s figures.</p>
            )}
            <Stamp reading={result} />
          </div>
        </div>
      )}
    </Card>
  );
}
