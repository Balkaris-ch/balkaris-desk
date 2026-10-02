import type { Overview } from "@/contract/overview";
import { PageHead } from "@/components/shell/PageHead";
import { Grid } from "@/components/ui/Grid";
import { ActivityCard, QuickActions } from "@/components/overview/Activity";
import { AttentionCard } from "@/components/overview/Attention";
import { LiveCard } from "@/components/overview/Live";
import { PerformanceCard } from "@/components/overview/Performance";
import { SpecimenRibbon } from "@/components/overview/Ribbon";
import { OverviewTiles } from "@/components/overview/Tiles";
import { CountriesCard, TopPagesCard } from "@/components/overview/TopPages";
import { SourcesCard, TrafficCard } from "@/components/overview/Traffic";
import { readAudit } from "@/components/overview/audit";
import { firstName, greetingAt } from "@/components/overview/greeting";
import { api, askMe } from "@/lib/api";
import { parseRange } from "@/lib/format";
import "@/components/overview/overview.css";

export const metadata = { title: "Command Center" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * The Command Center: balkaris.ch today, on one screen, as the board draws it.
 *
 * One request to the desk (GET /api/v1/overview) for every panel; each panel
 * is a reading of its own, so a source that is not connected shows its place,
 * why it is empty and the step that fills it. The Live visitors panel then
 * keeps itself current in the browser.
 */
export default async function CommandCenterPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const range = parseRange(q.range);
  const specimen = first(q.specimen) === "1";
  /* Only a fixed code and a recent time are taken from the address; anything else is ignored. */
  const said = readAudit(first(q.audit));

  const [who, data] = await Promise.all([askMe(), api<Overview>("/api/v1/overview", { range, ...(specimen ? { specimen: "1" } : {}) })]);
  const name = who.ok ? firstName(who.value.name) : "";
  const keep = new URLSearchParams({ ...(range !== "30d" ? { range } : {}), ...(data.specimen ? { specimen: "1" } : {}) }).toString();

  return (
    <>
      <PageHead eyebrow="Command Center" title={`${greetingAt()}${name ? `, ${name}` : ""}.`} subtitle="Here's what's happening with balkaris.ch today." ranges />
      {data.specimen ? <SpecimenRibbon /> : null}

      <OverviewTiles tiles={data.tiles} />

      <Grid cols="2.1fr 1fr 1.16fr" mid="1.6fr 1fr">
        <TrafficCard reading={data.traffic} range={data.range} />
        <SourcesCard reading={data.sources} />
        <LiveCard initial={data.live} specimen={data.specimen} />
      </Grid>

      <Grid cols="1.6fr 1.4fr 1fr" mid="1fr 1fr">
        <AttentionCard reading={data.attention} allHref={`/attention${keep ? `?${keep}` : ""}`} />
        <ActivityCard reading={data.activity} />
        <QuickActions audit={data.audit} said={said} range={data.range} specimen={data.specimen} />
      </Grid>

      <Grid cols="1.6fr 1.5fr 0.95fr" mid="1fr 1fr">
        <PerformanceCard panel={data.performance} />
        <TopPagesCard reading={data.topPages} />
        <CountriesCard reading={data.countries} />
      </Grid>
    </>
  );
}
