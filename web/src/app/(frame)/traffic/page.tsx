import type { TrafficPayload } from "@/contract/traffic";
import { PageHead } from "@/components/shell/PageHead";
import { Card } from "@/components/ui/Card";
import { Grid } from "@/components/ui/Grid";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { LivePanel } from "@/components/traffic/LivePanel";
import { PagesTable } from "@/components/traffic/PagesTable";
import {
  ChannelsPanel,
  ClarityPanel,
  CountriesPanel,
  DevicesPanel,
  EventsPanel,
  LandingPanel,
  SourcesPanel,
  SpecimenRibbon,
  TrafficActions,
  TrafficNote,
  TrafficTileRow,
  UnmeasuredPanel,
  VisitorsPanel,
} from "@/components/traffic/panels";
import { api } from "@/lib/api";
import { parseRange } from "@/lib/format";

export const metadata = { title: "Traffic" };

/**
 * Traffic: who visits balkaris.ch, how they arrive and what they read.
 *
 * There is no board for this screen; it is laid out in the Command Center's
 * and Conversions' language (tiles, a large chart beside a donut and the live
 * panel, tables with pictures, a quick-actions column). One request: the desk
 * server answers the whole screen, each panel a reading of its own, so a
 * source that fails empties its panel and nothing else.
 */
export default async function TrafficPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const specimen = (Array.isArray(sp.specimen) ? sp.specimen[0] : sp.specimen) === "1";
  const data = await api<TrafficPayload>("/api/v1/traffic", {
    range,
    specimen: specimen ? 1 : null,
  });

  return (
    <>
      <PageHead eyebrow="Traffic" title="Traffic" subtitle="Who visits balkaris.ch, how they find it and what they read there." ranges />
      <TrafficNote period={data.period} />
      {data.specimen ? <SpecimenRibbon /> : null}

      <TrafficTileRow tiles={data.tiles} />

      <Grid cols="2.1fr 1fr 1.16fr" className="dk-traffic-lead">
        <VisitorsPanel reading={data.perDay} />
        <ChannelsPanel reading={data.channels} />
        <LivePanel initial={data.live} realtime={data.links.realtime} />
      </Grid>

      <Grid cols="1.45fr 1.1fr 0.85fr" className="dk-traffic-lead">
        <LandingPanel reading={data.landing} />
        <SourcesPanel reading={data.sources} />
        <DevicesPanel reading={data.devices} />
      </Grid>

      <Grid cols="1fr 1.35fr" mid="minmax(0, 1fr)">
        <CountriesPanel countries={data.countries} cities={data.cities} />
        <EventsPanel reading={data.events} />
      </Grid>

      <Grid cols="2.1fr 1fr">
        <ClarityPanel reading={data.clarity} links={data.links.clarity} specimen={data.specimen} />
        <UnmeasuredPanel period={data.period} />
      </Grid>

      <Grid cols="2.1fr 1fr" mid="minmax(0, 1fr)">
        <Card
          title="All pages"
          icon="pages"
          flush
          className="dk-traffic-all"
          count={data.pages.state === "ok" ? data.pages.value.length : undefined}
          info="Every address GA4 saw a page view on in the period, most visitors first. Time per visitor is the page's engagement time divided by its visitors."
          right={<Stamp reading={data.pages} />}
        >
          <Read reading={data.pages}>{(rows) => <PagesTable rows={rows} />}</Read>
        </Card>
        <TrafficActions links={data.links} />
      </Grid>
    </>
  );
}
