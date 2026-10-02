import type { InsightsPayload } from "@/contract/insights";
import { Spark, SparkBars } from "@/components/charts";
import { Stamp } from "@/components/ui/Stamp";
import { Tile, Tiles } from "@/components/ui/Tile";

/**
 * The six figures under the head. Four are the desk's own queue, counted in
 * its database now; two are GA4's, over the range.
 *
 * As on the board, the change stands beside the figure ("4 ↑ 26%") and the
 * small line under both. The desk's four are counts of now, with no earlier
 * figure kept to compare with, so they carry no change at all rather than a
 * dash. Where each figure comes from is said once, on the line under the row.
 */
export function InsightTiles({ tiles }: { tiles: InsightsPayload["tiles"] }) {
  const ga4 = tiles.organic.state === "ok" ? tiles.organic : tiles.conversions;
  return (
    <div className="dk-insights-tilerow">
      <Tiles count={6} className="dk-insights-tiles">
        <Tile
          label="Published"
          icon="file-text"
          tone="good"
          reading={tiles.published}
          delta="none"
          noStamp
          info="Articles live on balkaris.ch and listed: in the menu, on a shelf and in the sitemap. Those written on the site itself count too. The small line is the ones the desk listed this calendar month."
          chart={(s) => <SparkBars data={s.series} tone="good" />}
        />
        <Tile
          label="Writing"
          icon="pencil"
          tone="warn"
          reading={tiles.writing}
          delta="none"
          noStamp
          info="Links whose write job is queued or running on the workstation. The bars are the write jobs it took each day."
          chart={(s) => <SparkBars data={s.series} tone="grey" />}
        />
        <Tile
          label="To read"
          icon="bookmark"
          tone="violet"
          reading={tiles.toRead}
          delta="none"
          noStamp
          info="Links shared and not written, with nothing queued for them: one the desk could not read, or one still waiting to be asked for. The bars are the links shared each day."
          chart={(s) => <SparkBars data={s.series} tone="violet" />}
        />
        <Tile
          label="Stuck"
          icon="alert"
          tone="bad"
          reading={tiles.stuck}
          delta="none"
          noStamp
          info="Jobs the workstation gave up after three attempts. The bars are the days it gave up."
          chart={(s) => <SparkBars data={s.series} tone="bad" />}
        />
        <Tile
          label="Organic entrances"
          icon="users"
          tone="good"
          reading={tiles.organic}
          delta="inline"
          noStamp
          info="Sessions that began on an /insights/ page and came from Organic Search, in GA4. Consenting visitors only."
          chart={(s) => <Spark data={s.series} tone="good" />}
        />
        <Tile
          label="Conversions"
          icon="target"
          tone="good"
          reading={tiles.conversions}
          delta="inline"
          noStamp
          info="Enquiries sent (GA4's generate_lead event) in sessions that began on an /insights/ page. Consenting visitors only."
          chart={(s) => <Spark data={s.series} tone="good" />}
        />
      </Tiles>
      <p className="dk-insights-tilestamps">
        <span className="dk-insights-tilestamp dk-insights-tilestamp--desk">
          <Stamp reading={tiles.published} />
        </span>
        {ga4.state === "ok" ? (
          <span className="dk-insights-tilestamp dk-insights-tilestamp--ga4">
            <Stamp reading={ga4} />
            <span aria-hidden>·</span>
            <span>consenting visitors only</span>
          </span>
        ) : null}
      </p>
    </div>
  );
}
