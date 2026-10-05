import type { ReactNode } from "react";
import type { Reading } from "@/contract/common";
import type { RateStat } from "@/contract/seo/common";
import type { AiTile, OverviewTiles } from "@/contract/seo/overview";
import { Spark, SparkBars } from "@/components/charts";
import { Delta } from "@/components/ui/Delta";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Tile, Tiles } from "@/components/ui/Tile";
import { Info } from "@/components/ui/Tooltip";
import { change, DASH, num } from "@/lib/format";
import { rateText } from "./bits";
import { DEFAULT_RANGE, seoHref } from "./href";
import "@/components/ui/tile.css";
import "./overview.css";

/**
 * The small arrow in a tile's top right corner: the page that shows the
 * figure whole. A link of its own, not the whole tile, because the tile holds
 * the (i) button and a button may not sit inside a link.
 */
function TileGo({ href, page }: { href: string; page: string }) {
  return (
    <Go href={href} className="dk-seo-overview-tilego" aria-label={`Open ${page}`} title={`Open ${page}`}>
      <Icon name="arrow-right" size={14} />
    </Go>
  );
}

/**
 * A tile for a rate: the share when it stands on 30 events or more, its two
 * counts under that ("5 of 31"), with the change against the period before
 * printed the same way. Laid out with the Tile primitive's own classes.
 */
function RateTile({ label, info, reading, chartTone = "green", foot, badge }: { label: string; info: string; reading: Reading<{ figure: string; under: ReactNode; sub?: string; series: (number | null)[] }>; chartTone?: "green" | "red"; foot?: ReactNode; badge?: ReactNode }) {
  const v = reading.state === "ok" ? reading.value : null;
  /* A line needs two days with a rate; a day without one (under 30 events) is a gap in it, never a zero. */
  const drawn = v ? v.series.filter((x) => x !== null).length : 0;
  return (
    <article className="dk-tile">
      <div className="dk-tile-main">
        <div className="dk-tile-top">
          <h3 className="dk-tile-label">
            <span className="dk-tile-label-text">{label}</span>
            <Info text={info} />
          </h3>
          {badge ? <span className="dk-tile-badge">{badge}</span> : null}
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
            {drawn > 1 ? (
              <div className="dk-tile-chart">
                <Spark data={v.series} tone={chartTone} />
              </div>
            ) : null}
          </div>
        ) : reading.state !== "ok" ? (
          <Absent reading={reading} form="tile" />
        ) : null}
        {foot ? <div className="dk-tile-foot">{foot}</div> : null}
      </div>
    </article>
  );
}

/**
 * CTR as a rate tile: compared as a percentage only when both periods stand on
 * 30 impressions or more. Its line has a point only on days Google showed the
 * site 30 times or more (the server leaves the others null).
 */
function ctrReading(r: Reading<RateStat>): Reading<{ figure: string; under: ReactNode; series: (number | null)[] }> {
  if (r.state !== "ok") return r;
  const { now, previous, series } = r.value;
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
  return { ...r, value: { figure: rateText(now), under, series } };
}

/**
 * The AI tile. The headline is the measure of AI visibility: answers that
 * named Balkaris when the question did not (no brand, no domain in it). The
 * count with those questions included is printed under it, named as such,
 * because a question that names Balkaris is answered with Balkaris anyway.
 */
function aiReading(r: Reading<AiTile>): Reading<{ figure: string; under: ReactNode; sub?: string; series: (number | null)[] }> {
  if (r.state !== "ok") return r;
  const v = r.value;
  /* Always the two counts: a share of a few dozen recorded answers is not a rate to compare. */
  const figure = `${num(v.unprompted.mentioned)} of ${num(v.unprompted.asked)}`;
  return {
    ...r,
    value: {
      figure,
      under: <span className="dk-seo-overview-ai-under">answers to questions without the name</span>,
      sub: `${num(v.mentioned)} of ${num(v.asked)} counting questions that name Balkaris`,
      series: v.series,
    },
  };
}

/**
 * The seven figures under the head: the board's six (SEO Health, Indexed
 * pages, Organic clicks, Impressions, Avg. position, CTR) and the AI-search
 * baseline, the owner's "0% on that side". Where each comes from is printed
 * once under the row. Each tile's arrow opens the page that shows its figure
 * whole, keeping the chosen period.
 */
export function OverviewTileRow({ tiles, range = DEFAULT_RANGE }: { tiles: OverviewTiles; range?: string }) {
  const health = tiles.health;
  const stamps: [string, Reading<unknown>][] = [
    ["SEO Health", health],
    ["Indexed pages", tiles.indexed],
    ["clicks, impressions, position, CTR", tiles.clicks],
    ["AI answers", tiles.ai],
  ];
  const console = <TileGo href={seoHref("/seo/search-console", range)} page="SEO › Search Console" />;
  const brand = tiles.brand;
  return (
    <div className="dk-seo-overview-tilerow">
      <Tiles count={7} className="dk-seo-overview-tiles">
        <Tile
          noStamp
          label="SEO Health"
          reading={health}
          badge={<TileGo href={seoHref("/seo/technical", range)} page="SEO › Technical" />}
          info="The desk’s own score from its crawl, by its stated rules (src/cc/site/rules.ts): every sitemap page starts at 100 and loses a rule’s points when the rule finds something on it. Not a figure from Google."
          foot={health.state === "ok" ? <ProgressBar value={health.value.value} max={100} label="SEO Health out of 100" tone={health.value.value >= 80 ? "good" : health.value.value >= 50 ? "warn" : "bad"} className="dk-seo-overview-healthbar" /> : undefined}
        />
        <Tile
          noStamp
          label="Indexed pages"
          reading={tiles.indexed}
          badge={<TileGo href={seoHref("/seo/technical#indexing", range)} page="the index on SEO › Technical" />}
          info={
            tiles.indexed.state === "ok" && tiles.indexed.note
              ? `${tiles.indexed.note} The bars are the daily counts since the desk began checking.`
              : "Sitemap addresses Google’s URL Inspection reports as indexed, each address’s newest result, out of the sitemap’s addresses. Not Search Console’s Page indexing total, which no API gives."
          }
          chart={(s) => <SparkBars data={s.series} />}
        />
        <Tile
          noStamp
          label="Organic clicks"
          reading={tiles.clicks}
          badge={console}
          info={`Clicks from Google Search (web results) in the period, from the desk’s own daily copy of Search Console. Two to three days behind.${
            brand && brand.named
              ? ` Non-brand: of the ${num(brand.named)} clicks Google names a query for, ${num(brand.nonBrand)} came from searches without “${brand.word}” in them. Google withholds rare queries, so most clicks of a young site have no query at all: the split is of the named ones only.`
              : ""
          }`}
          chart={(s) => <SparkBars data={s.series} />}
        />
        <Tile noStamp label="Impressions" reading={tiles.impressions} compact badge={console} info="Times a page of the site was shown in Google Search results in the period, from the desk’s own daily copy of Search Console." chart={(s) => <SparkBars data={s.series} />} />
        <Tile
          noStamp
          label="Avg. position"
          reading={tiles.position}
          downIsGood
          badge={console}
          info="Google’s average position over the period, weighted by impressions: lower is better. An average over every query, not a tracked rank."
          chart={(s) => <Spark data={s.series} floor="min" tone="red" />}
        />
        <RateTile
          label="CTR"
          reading={ctrReading(tiles.ctr)}
          badge={console}
          info="Clicks over impressions for the whole period. On fewer than 30 impressions the two counts are printed instead of a percentage."
        />
        <RateTile
          label="Named by AI"
          reading={aiReading(tiles.ai)}
          badge={<TileGo href={seoHref("/seo/ai-search", range)} page="SEO › AI Search" />}
          info={
            tiles.ai.state === "ok"
              ? `Questions asked of ${tiles.ai.value.engines.join(", ")} that do not contain the name Balkaris or its domain, and how many answers named Balkaris anyway: each assistant’s newest round (${tiles.ai.value.lastDay}). Recorded by the audit and by hand, not a sample of what people ask. The line under counts every question, those that name Balkaris included.`
              : "Questions asked of AI assistants that do not contain the name Balkaris, and whether the answer named it anyway, as recorded. Not a sample of what people ask."
          }
        />
      </Tiles>
      <p className="dk-seo-overview-stamps">
        {stamps.map(([label, r]) =>
          r.state === "ok" ? (
            <span key={label} className="dk-seo-overview-stamp">
              <Stamp reading={r} />
              <span>{label}</span>
            </span>
          ) : null,
        )}
        {tiles.clicks.state !== "ok" && tiles.health.state !== "ok" ? <span>{DASH}</span> : null}
      </p>
    </div>
  );
}
