import type { HealthPayload } from "@/contract/health";
import { HealthTiles } from "@/components/health/HealthTiles";
import { BackgroundJobs, DeploymentHistory, EndpointHealth } from "@/components/health/Tables";
import { InfrastructurePanel, RecentIncidents, TechnicalChecks } from "@/components/health/Lists";
import { CoreWebVitals, PerformanceTrend, ResponseTime } from "@/components/health/PerfPanels";
import { QuickActions, SpecimenRibbon } from "@/components/health/QuickActions";
import { PageHead } from "@/components/shell/PageHead";
import { Grid, Stack } from "@/components/ui/Grid";
import { api } from "@/lib/api";
import { parseRange, SHORT_RANGES } from "@/lib/format";
import "@/components/health/health.css";

export const metadata = { title: "Site Health" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * Site Health: the website as the desk sees it from outside. One request
 * (GET /api/v1/health) draws the whole screen; the page head's range, the
 * Performance trend's period (?trend=) and the Response time window (?rt=)
 * travel with it. `?specimen=1` is passed through, and the desk server alone
 * decides whether it may answer with specimen rows.
 */
export default async function SiteHealthPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const range = parseRange(q.range, SHORT_RANGES, "30d");
  const data = await api<HealthPayload>("/api/v1/health", {
    range,
    trend: one(q.trend),
    rt: one(q.rt),
    specimen: one(q.specimen) === "1" ? "1" : undefined,
  });
  const home = data.endpoints.state === "ok" ? (data.endpoints.value.find((e) => e.id === "home") ?? null) : null;

  return (
    <>
      <PageHead
        eyebrow="Site Health"
        title="Site Health"
        subtitle={
          <>
            Monitor the performance, stability and technical health of <b className="dk-health-domain">balkaris.ch</b>.
          </>
        }
        ranges={SHORT_RANGES}
        rangeFallback="30d"
      />
      {data.specimen ? <SpecimenRibbon /> : null}
      {/* The board's panels sit closer than the frame's default gap: the screen keeps its own. */}
      <div className="dk-health">
        <HealthTiles tiles={data.tiles} />
        <Grid cols="1.36fr 1.07fr 1fr">
          <PerformanceTrend reading={data.trend} range={data.trendRange} />
          <ResponseTime reading={data.response} range={data.responseRange} />
          <CoreWebVitals vitals={data.vitals} />
        </Grid>
        <Grid cols="1.04fr 1fr 1.07fr">
          <EndpointHealth reading={data.endpoints} />
          <DeploymentHistory reading={data.deployments} />
          <BackgroundJobs reading={data.jobs} />
        </Grid>
        <Grid cols="1fr 1.21fr 1.17fr">
          <TechnicalChecks checks={data.checks} site={data.siteUrl} />
          <InfrastructurePanel infra={data.infra} home={home} />
          <Stack>
            <RecentIncidents reading={data.incidents} />
            <QuickActions />
          </Stack>
        </Grid>
      </div>
    </>
  );
}
