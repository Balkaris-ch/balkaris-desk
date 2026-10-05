import type { ReactNode } from "react";
import type { Reading, Stat } from "@/contract/common";
import type { RateStat } from "@/contract/seo/common";
import type { PagesTiles, SearchBasis } from "@/contract/seo/pages";
import { Spark, SparkBars } from "@/components/charts";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Tile, Tiles } from "@/components/ui/Tile";
import { Info } from "@/components/ui/Tooltip";
import { cx } from "@/lib/cx";
import { DASH, num, percent, shortDate } from "@/lib/format";

/** "12%", or "2.45%" under ten, as the tiles print a rate. */
const rateText = (v: number): string => percent(v, Math.abs(v) < 10 ? 2 : 1);

/** Why the search tiles carry no change, in one sentence; null when they are compared or not comparable at all. */
export function uncomparedText(search: Reading<SearchBasis>): string | null {
  const u = search.state === "ok" ? search.value.uncompared : null;
  if (!u || search.state !== "ok") return null;
  const first = search.value.pagesFrom ? shortDate(search.value.pagesFrom) : null;
  const why =
    u.why === "before-pages"
      ? `it is from before Google reported any page of this site (the first is on ${first})`
      : u.why === "starts-before-pages"
        ? `it starts before Google reported any page of this site (the first is on ${first})`
        : "Google named no page of this site in it";
  return `Organic clicks, position and CTR are not compared with the window before (${shortDate(u.start)} – ${shortDate(u.end)}): ${why}.`;
}

/** The clicks tile's (i): what it counts, and the part of it no row of the list can show. */
function clicksInfo(search: Reading<SearchBasis>): string {
  const base = "The board’s “organic traffic”: clicks from Google Search to the site in the window, Search Console’s total for the property. Visitors as GA4 counts them are on the Traffic screen.";
  const u = search.state === "ok" ? search.value.unnamed : null;
  if (!u) return base;
  return `${base} Google counted ${num(u.clicks)} of these clicks and ${num(u.impressions)} impressions for the site without naming a page, so they are in no row of the list.`;
}

/**
 * The board's "Avg. CTR" tile. A rate is compared as two rates ("25% → 12%"),
 * never as a percentage of a percentage, and it always carries the counts it
 * was made of; from fewer than 30 impressions it is printed as those counts.
 */
function CtrTile({ reading, uncompared }: { reading: Reading<RateStat>; uncompared: string | null }) {
  const r = reading.state === "ok" ? reading.value : null;
  const now = r?.now ?? null;
  const prev = r?.previous ?? null;
  const tone = now?.value != null && prev?.value != null ? (now.value > prev.value ? "good" : now.value < prev.value ? "bad" : "flat") : "flat";
  const series = r ? r.series : [];
  return (
    <article className="dk-tile">
      <div className="dk-tile-main">
        <div className="dk-tile-top">
          <h3 className="dk-tile-label">
            <span className="dk-tile-label-text">Avg. CTR</span>
            <Info text="Clicks divided by impressions over the whole window, from Search Console. Compared as two rates, not as a percentage of a percentage." />
          </h3>
        </div>
        {reading.state !== "ok" ? (
          <Absent reading={reading} form="tile" />
        ) : now && now.value !== null ? (
          <div className="dk-tile-row">
            <div className="dk-tile-figures">
              <p className="dk-tile-figure dk-num">
                <span className="dk-tile-value">{now.small ? `${num(now.num)} of ${num(now.den)}` : rateText(now.value)}</span>
              </p>
              <p className="dk-tile-under">
                {prev && prev.value !== null ? (
                  <span className={cx("dk-delta", "dk-num", "dk-delta--md", `dk-delta--${tone}`)}>
                    {rateText(prev.value)} → {rateText(now.value)}
                  </span>
                ) : (
                  <span className="dk-delta dk-delta--md dk-delta--flat" title={uncompared ?? "No earlier window to compare with."}>
                    {DASH}
                  </span>
                )}
              </p>
              <p className="dk-tile-sub">
                {num(now.num)} clicks of {num(now.den)} impressions
              </p>
              <Stamp reading={reading} />
            </div>
            {series.filter((v) => v !== null).length > 1 ? (
              <div className="dk-tile-chart">
                <Spark data={series} floor="zero" />
              </div>
            ) : null}
          </div>
        ) : (
          <p className="dk-tile-sub">No impressions in the window, so there is no rate.</p>
        )}
      </div>
    </article>
  );
}

const bars = (tone?: "bad") => (s: Stat) => <SparkBars data={s.series} tone={tone} />;
const line = (s: Stat) => <Spark data={s.series} />;

/**
 * The position tile's reading with its line. The server leaves the stat's own
 * series empty whenever a day of the window had no impressions (a series that
 * skipped the day would put every later point on the wrong date), so the line
 * is drawn from `positionDays`, one point a day with a gap where there is no
 * position. The tile draws a chart only beside a series of two or more, so
 * the stat it is given carries one as long as the days, which nothing else reads.
 */
function positionTile(tiles: PagesTiles): { reading: Reading<Stat>; chart: (s: Stat) => ReactNode } {
  const r = tiles.position;
  const days = tiles.positionDays;
  if (r.state !== "ok" || r.value.series.length > 1 || days.filter((v) => v !== null).length < 2) return { reading: r, chart: (s) => <Spark data={s.series} floor="min" /> };
  return { reading: { ...r, value: { ...r.value, series: days.map((v) => v ?? 0) } }, chart: () => <Spark data={days} floor="min" /> };
}

/**
 * The six figures under the tabs, in the board's order, each with its source
 * in its (i) and stamp. When the search tiles are not compared with the window
 * before, one line under the row says why, in words a touch screen shows.
 */
export function PagesTileRow({ tiles, search }: { tiles: PagesTiles; search: Reading<SearchBasis> }) {
  const uncompared = uncomparedText(search);
  const position = positionTile(tiles);
  return (
    <div className="dk-seo-pages-tilerow">
      <Tiles count={6} className="dk-seo-pages-tiles">
        <Tile label="Total pages" reading={tiles.pages} chart={bars()} info={tiles.pages.state === "ok" ? tiles.pages.note : undefined} />
        <Tile label="Indexed pages" reading={tiles.indexed} chart={bars()} info={tiles.indexed.state === "ok" ? tiles.indexed.note : "Google's URL Inspection of every sitemap address, once a day."} />
        <Tile label="Pages with issues" reading={tiles.withIssues} downIsGood info={tiles.withIssues.state === "ok" ? tiles.withIssues.note : undefined} />
        <Tile label="Organic clicks" reading={tiles.clicks} chart={line} info={clicksInfo(search)} />
        <Tile label="Avg. position" reading={position.reading} downIsGood chart={position.chart} info="Google's average position over the window, weighted by impressions, as Search Console computes it for the site. Lower is better." />
        <CtrTile reading={tiles.ctr} uncompared={uncompared} />
      </Tiles>
      {uncompared ? (
        <p className="dk-seo-pages-small dk-seo-pages-tiles-note">
          <Icon name="info" size={13} /> {uncompared}
        </p>
      ) : null}
    </div>
  );
}
