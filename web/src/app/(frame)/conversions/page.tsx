import type { ConversionsPayload, ConversionsRange } from "@/contract/conversions";
import { PageHead } from "@/components/shell/PageHead";
import { Tile, Tiles } from "@/components/ui/Tile";
import { Grid } from "@/components/ui/Grid";
import { Spark } from "@/components/charts/Spark";
import { SparkBars } from "@/components/charts/SparkBars";
import { EngineTile } from "@/components/conversions/EngineTile";
import { ChannelsPanel, FunnelPanel, GroupPanel, QuickActions, RecentPanel, StartsPanel, TopPagesPanel, TrendPanel } from "@/components/conversions/Panels";
import { SpecimenRibbon } from "@/components/conversions/parts";
import { api } from "@/lib/api";
import { parseRange, RANGES } from "@/lib/format";

export const metadata = { title: "Conversions" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * Conversions: visitors to enquiries to booked calls.
 *
 * One request for the whole screen. Two sources are drawn side by side and
 * never added together: GA4's events (consenting visitors, tied to pages,
 * channels and days) and the engine's enquiries (every one that was stored,
 * absent until the engine's key exists). `?range=` is the page's period;
 * `?funnel=`, `?channels=` and `?trend=` are the panels' own selects.
 */
export default async function ConversionsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const range = parseRange(sp.range, RANGES, "30d") as ConversionsRange;
  const own = (k: "funnel" | "channels" | "trend") => {
    const asked = one(sp[k]);
    return asked && RANGES.some((r) => r === asked) ? asked : null;
  };
  const specimen = one(sp.specimen) === "1";

  const data = await api<ConversionsPayload>("/api/v1/conversions", {
    range,
    funnel: own("funnel"),
    channels: own("channels"),
    trend: own("trend"),
    specimen: specimen ? 1 : null,
  });
  const t = data.tiles;

  /* The ribbon's way back: the same address without the specimen. */
  const back = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (k !== "specimen" && typeof v === "string") back.set(k, v);
  const real = back.toString() ? `/conversions?${back}` : "/conversions";

  return (
    <>
      <PageHead eyebrow="Conversions" title="Conversions" subtitle="Turn more visitors into valuable conversations. Track, analyse and grow your pipeline." ranges />

      {data.specimen ? <SpecimenRibbon href={real} /> : null}

      <Tiles count={6} className="dk-conversions-tiles">
        <EngineTile
          label="Leads generated"
          reading={t.leads}
          standIn={t.leadsGa4}
          event="generate_lead"
          info="Enquiries the engine stored in this period, from every form on the website, the AI guide and the video page's dock. Read live from the engine; nothing is kept on the desk. While the engine is not connected, GA4's generate_lead count is shown under it as a stand-in, by its name."
          chart={(s) => <Spark data={s.series} />}
        />
        <EngineTile
          label="Booked calls"
          reading={t.booked}
          standIn={t.bookedGa4}
          event="book_meeting"
          info="Enquiries in this period with a booked call that was not cancelled, from the engine. While the engine is not connected, GA4's book_meeting count is shown under it as a stand-in, by its name."
          chart={(s) => <Spark data={s.series} />}
        />
        <Tile
          label="Form starts"
          reading={t.formStarts}
          info="GA4's own form_start: the first time in a session a visitor uses any form on the site, the search and the AI guide included. Consenting visitors only."
          chart={(s) => <SparkBars data={s.series} />}
        />
        <Tile
          label="Form submissions"
          reading={t.submissions}
          info="GA4's generate_lead: an enquiry sent from the contact page, the sheet on a marketing page, the AI guide or the video page's dock. Consenting visitors only, so fewer than the enquiries stored."
          chart={(s) => <SparkBars data={s.series} />}
        />
        <Tile label="Conversion rate" reading={t.rate} info="generate_lead events divided by sessions, both from GA4. Under the figure, the two counts: enquiries sent (generate_lead) in that many sessions." chart={(s) => <Spark data={s.series} />} />
        <Tile label="Pipeline value" reading={t.pipeline} info="What the enquiries are worth. No source records a value for an enquiry, so there is no figure." />
      </Tiles>

      <Grid cols="1.75fr 1fr 1.07fr" mid="minmax(0, 1fr) minmax(0, 1fr)" className="dk-conversions-row2">
        <FunnelPanel reading={data.funnel} page={data.range} />
        <ChannelsPanel reading={data.channels} page={data.range} />
        <TopPagesPanel reading={data.topPages} />
      </Grid>

      <Grid cols="1.9fr 1fr 1fr 1fr">
        <TrendPanel reading={data.trend} page={data.range} />
        <GroupPanel
          reading={data.services}
          title="Leads by service"
          icon="bar-chart"
          dialogTitle="Enquiries by service"
          empty="No enquiry in this period named a service."
        />
        <GroupPanel
          reading={data.pageGroups}
          title="Enquiries by page group"
          icon="layout"
          dialogTitle="Enquiries by page group"
          empty="No enquiry in this period."
        />
        <StartsPanel reading={data.starts} heatmaps={data.heatmaps} direct={data.heatmapsDirect} />
      </Grid>

      <Grid cols="3.1fr 1fr" mid="minmax(0, 1fr)">
        <RecentPanel reading={data.recent} />
        <QuickActions />
      </Grid>
    </>
  );
}
