import type { ReactNode } from "react";
import type { Stat } from "@/contract/common";
import type { CtrCurve } from "@/contract/seo/common";
import type { OpportunityQuery, OpportunityTiles } from "@/contract/seo/opportunities";
import { SparkBars } from "@/components/charts";
import { Go } from "@/components/ui/Go";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Tile, Tiles } from "@/components/ui/Tile";
import { Info, Tooltip } from "@/components/ui/Tooltip";
import { num } from "@/lib/format";
import { gain, hrefWith, viewOf } from "./look";

const bars = (s: Stat) => <SparkBars data={s.series} />;

/**
 * The six figures under the head, in board 111's order. Every count is the
 * engine's open opportunities of a kind, counted now; the bars are its count
 * once a day from the day it began. "Estimated traffic gain" is the one
 * estimate on the page and is named as ours.
 *
 * Each tile leads to the list it counts: the to-do opportunities the rules
 * still find, of its kind, with no other filter (the period and the country
 * kept), so the list's length is the tile's figure.
 */
export function OppTiles({ tiles, curve, asked }: { tiles: OpportunityTiles; curve: CtrCurve; asked: OpportunityQuery }) {
  const view = viewOf(asked);
  const list = (change: Record<string, string>, words: string) => (
    <Go href={hrefWith(view, change)} scroll={false} className="dk-seo-opps-tile-go">
      {words}
    </Go>
  );
  return (
    <Tiles count={6} className="dk-seo-opps-tiles">
      <Tile label="Total opportunities" reading={tiles.total} chart={bars} info="Every opportunity the rules still find that nobody has marked done or dismissed: open, queued and in progress." foot={list({}, "List them")} />
      <GainTile reading={tiles.estimatedGain} curve={curve} foot={list({ sort: "potential" }, "Largest estimate first")} />
      <Tile
        label="CTR opportunities"
        reading={tiles.ctr}
        chart={bars}
        info="Pages Google shows at position 20 or better whose clicks are under half of what our CTR curve expects at that position (our assumption, stated in one place). None while Google shows the site too rarely for the curve to expect a few clicks."
        foot={list({ type: "low-ctr" }, "List them")}
      />
      <Tile label="Near page one" reading={tiles.nearPageOne} chart={bars} info="Searches the site shows for at Google average position 4 to 20: a better title or page can lift them onto the first results." foot={list({ type: "near-page-one" }, "List them")} />
      <Tile
        label="Technical issues"
        reading={tiles.technical}
        chart={bars}
        info="Findings of the desk's crawl rules and failed site-wide checks, pages slow on a phone in PageSpeed's lab test, and website changes the SEO audit named."
        foot={list({ type: "technical" }, "List them")}
      />
      <Tile label="Content gaps" reading={tiles.gaps} chart={bars} info="Topics people search for that no page of the site answers, German ones included: the site is English only." foot={list({ type: "keyword-gap,german-missing" }, "List them")} />
    </Tiles>
  );
}

/**
 * The board's "Estimated traffic gain". Ours, and said so: the open
 * opportunities' estimates, each from the impressions Search Console counted
 * and our stated CTR curve, added with each search counted once (the server's
 * rule is in the line under the figure, on hover). Absent when no opportunity
 * has impressions: then there is nothing honest to add up.
 */
function GainTile({ reading, curve, foot }: { reading: OpportunityTiles["estimatedGain"]; curve: CtrCurve; foot: ReactNode }) {
  const g = reading.state === "ok" ? reading.value : null;
  return (
    <article className="dk-tile dk-seo-opps-gain">
      <div className="dk-tile-main">
        <div className="dk-tile-top">
          <h3 className="dk-tile-label">
            <span className="dk-tile-label-text">Estimated traffic gain</span>
            <Info text={curve.note} label="How the estimate is made" />
          </h3>
        </div>
        {g && reading.state === "ok" ? (
          <>
            <p className="dk-tile-figure dk-num">
              <span className="dk-tile-value">{gain(g.clicksPerMonth)}</span>
              <span className="dk-tile-of">clicks / month</span>
            </p>
            <Tooltip text={g.line}>
              <p className="dk-tile-sub" tabIndex={0}>
                Our estimate, from {num(g.from)} opportunit{g.from === 1 ? "y" : "ies"}, each search once
              </p>
            </Tooltip>
            <Stamp reading={reading} />
          </>
        ) : reading.state !== "ok" ? (
          <Absent reading={reading} form="tile" />
        ) : null}
        {/* As Tile draws its own foot: whether the figure is there or not. */}
        <div className="dk-tile-foot">{foot}</div>
      </div>
    </article>
  );
}
