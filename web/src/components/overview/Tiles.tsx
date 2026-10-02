import type { Reading, Stat } from "@/contract/common";
import type { OverviewTiles as TilesData } from "@/contract/overview";
import { Spark, SparkBars } from "@/components/charts";
import { Tile, Tiles } from "@/components/ui/Tile";
import { Delta } from "@/components/ui/Delta";
import { Stamp } from "@/components/ui/Stamp";
import { num } from "@/lib/format";

/**
 * The five tiles under the head, as the board draws them: Visitors, Leads,
 * Organic clicks, Indexed pages, Conversion rate. A tile whose source is not
 * connected keeps its place and says what is missing; the Leads tile then
 * carries GA4's form count under it, named as what it is.
 *
 * Each tile's source and age sit in its top right corner, opposite the label,
 * so the row keeps the board's height; a tile too narrow for both moves it
 * to its foot (overview.css). An absent tile has no stamp: it says what is
 * missing instead.
 */
export function OverviewTiles({ tiles }: { tiles: TilesData }) {
  return (
    <Tiles count={5} className="dk-overview-tiles">
      <Tile
        label="Visitors"
        reading={tiles.visitors}
        info="People GA4 counted on www.balkaris.ch in the period, each once. Consenting visitors only."
        chart={(s) => <Spark data={s.series} />}
        noStamp
        badge={<Stamp reading={tiles.visitors} />}
      />
      <Tile
        label="Leads"
        reading={tiles.leads}
        info="Enquiries sent through the website, counted by the engine: counts only, no names."
        chart={(s) => <SparkBars data={s.series} />}
        foot={tiles.formsSeen ? <FormsSeen reading={tiles.formsSeen} /> : undefined}
        noStamp
        badge={<Stamp reading={tiles.leads} />}
      />
      <Tile
        label="Organic clicks"
        reading={tiles.organicClicks}
        info="Clicks from Google Search results, as Search Console reports them (two to three days late)."
        chart={(s) => <Spark data={s.series} />}
        noStamp
        badge={<Stamp reading={tiles.organicClicks} />}
      />
      <Tile
        label="Indexed pages"
        reading={tiles.indexed}
        info="Addresses in the sitemap that Google reports as indexed (URL Inspection, checked once a day), out of all the sitemap's addresses."
        chart={(s) => <SparkBars data={s.series} />}
        noStamp
        badge={<Stamp reading={tiles.indexed} />}
      />
      <Tile
        label="Conversion rate"
        reading={tiles.conversion}
        info="GA4's generate_lead events (an enquiry form sent) divided by GA4 sessions, both from the same consenting visitors. The line is drawn only from days with at least 30 sessions: a day's rate from fewer is noise."
        chart={(s) => <Spark data={s.series} />}
        noStamp
        badge={<Stamp reading={tiles.conversion} />}
      />
    </Tiles>
  );
}

/** "Form submissions seen by GA4: 3", with its change: the true stand-in while the engine's count is absent. */
function FormsSeen({ reading }: { reading: Reading<Stat> }) {
  if (reading.state !== "ok") return null;
  const s = reading.value;
  return (
    <span className="dk-overview-standin">
      Form submissions seen by GA4: <b className="dk-num">{num(s.value)}</b>
      {s.previous !== null ? <Delta value={s.value} previous={s.previous} size="sm" /> : null}
    </span>
  );
}
