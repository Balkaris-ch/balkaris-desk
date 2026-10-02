import type { ReactNode } from "react";
import type { Reading } from "@/contract/common";
import type { RateStat } from "@/contract/seo/common";
import type { OptimizeSiteTiles } from "@/contract/seo/page-view";
import { Spark, SparkBars } from "@/components/charts";
import { Delta } from "@/components/ui/Delta";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Tile, Tiles } from "@/components/ui/Tile";
import { Info } from "@/components/ui/Tooltip";
import { change, num } from "@/lib/format";
import { rateText } from "./bits";
import "@/components/ui/tile.css";

/**
 * A tile laid out with the Tile primitive's own classes, for a figure the
 * primitive cannot print: a rate in counts, our estimate with its words.
 */
function OwnTile({ label, info, reading, chart }: { label: string; info: ReactNode; reading: Reading<{ figure: string; under: ReactNode; sub?: string }>; chart?: ReactNode }) {
  const v = reading.state === "ok" ? reading.value : null;
  return (
    <article className="dk-tile">
      <div className="dk-tile-main">
        <div className="dk-tile-top">
          <h3 className="dk-tile-label">
            <span className="dk-tile-label-text">{label}</span>
            <Info text={info} />
          </h3>
        </div>
        {v ? (
          <div className="dk-tile-row">
            <div className="dk-tile-figures">
              <p className="dk-tile-figure dk-num">
                <span className="dk-tile-value">{v.figure}</span>
              </p>
              <p className="dk-tile-under">{v.under}</p>
              {v.sub ? <p className="dk-tile-sub">{v.sub}</p> : null}
            </div>
            {chart ? <div className="dk-tile-chart">{chart}</div> : null}
          </div>
        ) : reading.state !== "ok" ? (
          <Absent reading={reading} form="tile" />
        ) : null}
      </div>
    </article>
  );
}

/** CTR: a percentage on 30 impressions or more, else its two counts; the change printed the same way. */
export function ctrFigure(r: Reading<RateStat>): Reading<{ figure: string; under: ReactNode }> {
  if (r.state !== "ok") return r;
  const { now, previous } = r.value;
  const both = previous && !now.small && !previous.small && now.value !== null && previous.value !== null;
  const under = !previous ? (
    <Delta value={0} previous={null} size="md" />
  ) : both ? (
    <Delta percent={change(now.value!, previous.value!)} size="md" />
  ) : (
    <span className="dk-delta dk-delta--md dk-delta--flat dk-num">
      <span>
        {rateText(previous)} → {rateText(now)}
      </span>
    </span>
  );
  return { ...r, value: { figure: rateText(now), under } };
}

/**
 * The board's tile row, for the site as a whole: pages, pages to optimize,
 * average position, CTR, and the estimated gain, which is OUR estimate and
 * says so on its face. Where each comes from is printed once under the row.
 */
export function SiteTiles({ site }: { site: OptimizeSiteTiles }) {
  const gain: Reading<{ figure: string; under: ReactNode; sub?: string }> =
    site.gain.state === "ok"
      ? {
          ...site.gain,
          value: {
            figure: `+${num(site.gain.value.clicksPerMonth, 1)}`,
            under: <span className="dk-seo-optimize-tile-said">clicks a month · our estimate</span>,
            sub: `${num(site.gain.value.queries)} quer${site.gain.value.queries === 1 ? "y" : "ies"} at position 4 to 20`,
          },
        }
      : site.gain;
  const ctr = ctrFigure(site.ctr);
  const ctrLine = site.ctr.state === "ok" ? site.ctr.value.series.filter((x): x is number => x !== null) : [];
  return (
    <div className="dk-seo-optimize-tilerow">
      <Tiles count={5}>
        <Tile
          noStamp
          label="Pages"
          reading={site.pages}
          info="Sitemap pages that answer 200 and do not say noindex, out of every sitemap address the desk’s crawl read."
          delta="none"
        />
        <Tile
          noStamp
          label="Pages to optimize"
          reading={site.toOptimize}
          info="Pages with at least one open opportunity the engine’s stated rules found (src/cc/seo/rules.ts). The line is its daily count since the engine began."
          chart={(s) => <SparkBars data={s.series} tone="warn" />}
        />
        <Tile
          noStamp
          label="Avg. position"
          reading={site.position}
          downIsGood
          info="Google’s average position for the whole site over the period, weighted by impressions: lower is better. An average over every query, not a tracked rank."
          chart={(s) => <Spark data={s.series} floor="min" />}
        />
        <OwnTile
          label="CTR"
          reading={ctr}
          info="Clicks over impressions for the whole site in the period. On fewer than 30 impressions the two counts are printed instead of a percentage."
          chart={ctrLine.length > 1 ? <Spark data={ctrLine} /> : undefined}
        />
        <OwnTile
          label="Estimated traffic gain"
          reading={gain}
          info="OUR ESTIMATE, not a figure from Google: every query at average position 4 to 20, from its real Search Console impressions, as if it reached position 3, by our stated click-through curve (src/cc/seo/ctr.ts). Absent when no query stands there."
        />
      </Tiles>
      <p className="dk-seo-optimize-tilestamps">
        <Stamp reading={site.pages} />
        <Stamp reading={site.toOptimize} />
        <Stamp reading={site.position} />
      </p>
    </div>
  );
}
