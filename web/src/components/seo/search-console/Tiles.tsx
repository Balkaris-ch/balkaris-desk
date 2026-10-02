import type { Reading, Stat } from "@/contract/common";
import type { Rate } from "@/contract/seo/common";
import type { ExplorerResult } from "@/contract/seo/search-console";
import { Spark, SparkBars } from "@/components/charts";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Tile, Tiles } from "@/components/ui/Tile";
import { Info } from "@/components/ui/Tooltip";
import { cx } from "@/lib/cx";
import { DASH, num, percent } from "@/lib/format";
import "@/components/ui/tile.css";
import "@/components/ui/delta.css";

/** A rate as these figures print it: "12%", "2.45%" under ten, or its two counts ("3 of 16") under 30 impressions. */
export function rateText(r: Rate): string {
  if (r.value === null) return DASH;
  return r.small ? `${num(r.num)} of ${num(r.den)}` : percent(r.value, Math.abs(r.value) < 10 ? 2 : 1);
}

/** One of the explorer's totals as a tile's reading: the figure, the window before when it was compared, the daily line. */
function stat(result: Reading<ExplorerResult>, pick: (f: { clicks: number; impressions: number; position: number | null }) => number | null, unit: Stat["unit"], line: (d: ExplorerResult["days"][number]) => number | null): Reading<Stat> {
  if (result.state !== "ok") return result;
  const r = result.value;
  const value = pick(r.totals);
  if (value === null) return { state: "waiting", source: result.source, reason: "Google showed the site in no search for this view, so there is no average position." };
  const previous = r.previousTotals ? pick(r.previousTotals) : null;
  const series = r.days.map(line);
  return { ...result, value: { value, previous, unit, series: series.every((v) => v !== null) ? (series as number[]) : [] } };
}

/**
 * The board's "Avg. CTR": a rate is compared as two rates ("25% → 12%"),
 * never as a percentage of a percentage, and always with the counts it was
 * made of; from fewer than 30 impressions it is printed as those counts.
 */
function CtrTile({ result }: { result: Reading<ExplorerResult> }) {
  const r = result.state === "ok" ? result.value : null;
  const now = r?.totals.ctr ?? null;
  const prev = r?.previousTotals?.ctr ?? null;
  const tone = now?.value != null && prev?.value != null ? (now.value > prev.value ? "good" : now.value < prev.value ? "bad" : "flat") : "flat";
  const series = r ? r.days.map((d) => (d.impressions ? (d.clicks / d.impressions) * 100 : null)) : [];
  return (
    <article className="dk-tile">
      <div className="dk-tile-main">
        <div className="dk-tile-top">
          <h3 className="dk-tile-label">
            <span className="dk-tile-label-text">Avg. CTR</span>
            <Info text="Clicks divided by impressions over the whole window, as Search Console reports them. Compared as two rates, never as a percentage of a percentage; on fewer than 30 impressions the two counts are printed instead." />
          </h3>
        </div>
        {result.state !== "ok" ? (
          <Absent reading={result} form="tile" />
        ) : now && now.value !== null ? (
          <div className="dk-tile-row">
            <div className="dk-tile-figures">
              <p className="dk-tile-figure dk-num">
                <span className="dk-tile-value">{rateText(now)}</span>
              </p>
              <p className="dk-tile-under">
                {prev && prev.value !== null ? (
                  <span className={cx("dk-delta", "dk-num", "dk-delta--md", `dk-delta--${tone}`)}>
                    {rateText(prev)} → {rateText(now)}
                  </span>
                ) : (
                  <span className="dk-delta dk-delta--md dk-delta--none" title="No earlier window to compare with.">
                    {DASH}
                  </span>
                )}
              </p>
              <p className="dk-tile-sub">
                {num(now.num)} {now.num === 1 ? "click" : "clicks"} of {num(now.den)} {now.den === 1 ? "impression" : "impressions"}
              </p>
              <Stamp reading={result} />
            </div>
            {series.filter((v) => v !== null).length > 1 ? (
              <div className="dk-tile-chart">
                <SparkBars data={series} />
              </div>
            ) : null}
          </div>
        ) : (
          <p className="dk-tile-sub">No impressions in this view, so there is no rate.</p>
        )}
      </div>
    </article>
  );
}

const bars = (s: Stat) => <SparkBars data={s.series} />;

/**
 * The board's four figures (Total clicks, Total impressions, Avg. CTR, Avg.
 * position) for the view as filtered: the same numbers the chart and the
 * table stand on, from the desk's daily copy or read live, as the stamp says.
 */
export function ScTiles({ result }: { result: Reading<ExplorerResult> }) {
  const from = result.state === "ok" && result.value.source === "live" ? "read live from Search Console" : "from the desk’s own daily copy of Search Console";
  return (
    <Tiles count={4} className="dk-seo-gsc-tiles">
      <Tile label="Total clicks" reading={stat(result, (f) => f.clicks, "count", (d) => d.clicks)} chart={bars} info={`Clicks from Google Search (web results) to the site in the window, for the view as filtered, ${from}. Final days only, two to three days behind.`} />
      <Tile label="Total impressions" compact reading={stat(result, (f) => f.impressions, "count", (d) => d.impressions)} chart={bars} info={`Times a page of the site was shown in Google Search results in the window, for the view as filtered, ${from}. Not search volume: no free source gives that.`} />
      <CtrTile result={result} />
      <Tile
        label="Avg. position"
        downIsGood
        reading={stat(result, (f) => f.position, "ratio", (d) => d.position)}
        chart={(s) => <Spark data={s.series} floor="min" tone="red" />}
        info="Google’s average position over the window, weighted by impressions, as Search Console computes it: an average over every search the site was shown for, not a tracked rank. Lower is better; under 20 the two positions are printed rather than a percentage."
      />
    </Tiles>
  );
}
