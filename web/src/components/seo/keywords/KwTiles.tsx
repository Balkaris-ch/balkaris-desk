import type { Reading, Stat } from "@/contract/common";
import type { KeywordTiles } from "@/contract/seo/keywords";
import { SparkBars } from "@/components/charts";
import { Tile, Tiles } from "@/components/ui/Tile";

const bars = (tone?: "bad") => (s: Stat) => <SparkBars data={s.series} tone={tone} />;

/** No change line when the window before is not compared: the (i) and the New and Lost tiles say why, so no lone dash stands under the figure. */
const change = (r: Reading<Stat>): "under" | "none" => (r.state === "ok" && r.value.previous === null ? "none" : "under");

/**
 * The figures under the tabs (board 113, panel 4: total, ranking, new and
 * lost keywords), with "in the top 10" added as the task asks. Each says where
 * it came from in its (i) and its stamp. "Ranking" is a phrase Google showed
 * the site for (Search Console impressions): no tool measures a position
 * Google did not show.
 */
export function KwTileRow({ tiles }: { tiles: KeywordTiles }) {
  return (
    <Tiles count={5} className="dk-seo-kw-tiles">
      <Tile
        label="Keywords tracked"
        reading={tiles.total}
        delta="none"
        info={
          tiles.total.state === "ok"
            ? tiles.total.note
            : "The keyword store: Search Console queries, Google Autocomplete research, the SEO audit's table and phrases people add."
        }
      />
      <Tile
        label="Ranking keywords"
        reading={tiles.shown}
        delta={change(tiles.shown)}
        chart={bars()}
        info={`Phrases Google showed the site for in the window, with at least one impression in Search Console, whatever their judgement. ${
          tiles.shown.state === "ok" && tiles.shown.note ? tiles.shown.note : "The bars: queries shown each day. Rare queries are withheld by Google."
        }`}
      />
      <Tile
        label="In the top 10"
        reading={tiles.topTen}
        delta={change(tiles.topTen)}
        chart={bars()}
        info={`${
          tiles.topTen.state === "ok" && tiles.topTen.note ? tiles.topTen.note : "Phrases at an average position of 1 to 10 over the window, weighted by impressions, as Search Console computes it."
        } The bars: such queries each day.`}
      />
      <Tile
        label="New keywords"
        reading={tiles.newQueries}
        delta="none"
        info="Queries Google showed the site for in this window and not in the window of the same length before it. Only when the desk's own history covers that window from its first day and Search Console reported its queries: a window whose queries Google withheld is not a window of zero queries."
      />
      <Tile
        label="Lost keywords"
        reading={tiles.lostQueries}
        delta="none"
        downIsGood
        info="Queries Google showed the site for in the window before and not in this one. Only when the desk's own history covers that window and Search Console reported its queries."
      />
    </Tiles>
  );
}
