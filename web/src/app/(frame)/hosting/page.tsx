import type { HostingPayload } from "@/contract/hosting";
import { EnginePanel } from "@/components/hosting/Engine";
import { HostingTiles } from "@/components/hosting/HostingTiles";
import { BotsAnd404s, Referrers, TopPages, WhereFrom } from "@/components/hosting/Lists";
import { SpecimenRibbon } from "@/components/hosting/Specimen";
import { DashboardOnly, PlatformPanel, ProductionBuilds, ProductionDomain } from "@/components/hosting/Vercel";
import { Counting, ViewsPerDay } from "@/components/hosting/Views";
import { PageHead } from "@/components/shell/PageHead";
import { LinkButton } from "@/components/ui/Button";
import { Grid } from "@/components/ui/Grid";
import { api } from "@/lib/api";
import { parseRange } from "@/lib/format";
import "@/components/hosting/hosting.css";

export const metadata = { title: "Hosting" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

const RANGES = ["7d", "30d", "90d"] as const;

/**
 * Hosting: what only Vercel knows about the website. True page views from
 * Vercel's own request records beside GA4's, the production builds, the
 * domain and firewall, Vercel's status for the parts the site stands on, and
 * the engine behind its forms. One request (GET /api/v1/hosting). Site Health
 * is the outside view, and this screen does not repeat it.
 * `?specimen=1` is passed through; the desk server alone decides whether it
 * may answer with specimen rows.
 */
export default async function HostingPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const range = parseRange(q.range, RANGES, "30d");
  const data = await api<HostingPayload>("/api/v1/hosting", { range, specimen: one(q.specimen) === "1" ? "1" : undefined });

  return (
    <>
      <PageHead
        eyebrow="Hosting"
        title="Hosting"
        subtitle={
          <>
            What only Vercel knows about <b className="dk-hosting-domain">balkaris.ch</b>: true page views, builds, the domain, the platform, and the engine behind the forms.
          </>
        }
        ranges={RANGES}
        rangeFallback="30d"
        action={
          <LinkButton href="/site-health" size="sm" icon="shield-check">
            Site Health
          </LinkButton>
        }
      />
      {data.specimen ? <SpecimenRibbon panels={data.specimenPanels} /> : null}
      <div className="dk-hosting">
        <HostingTiles tiles={data.tiles} />
        <Grid cols="1.55fr 1fr">
          <ViewsPerDay reading={data.chart} />
          <Counting reading={data.counting} rules={data.rules} />
        </Grid>
        <Grid cols="1.2fr 1fr 1fr 1fr">
          <TopPages reading={data.pages} />
          <Referrers reading={data.referrers} />
          <WhereFrom devices={data.devices} regions={data.regions} countries={data.countries} />
          <BotsAnd404s bots={data.bots} notFound={data.notFound} />
        </Grid>
        <Grid cols="1.45fr 1fr">
          <ProductionBuilds reading={data.builds} />
          <ProductionDomain production={data.production} domains={data.domains} attacks={data.attacks} />
        </Grid>
        <Grid cols="1fr 1fr 1fr">
          <PlatformPanel reading={data.platform} />
          <EnginePanel local={data.engine.local} pub={data.engine.public} />
          <DashboardOnly links={data.dashboard} />
        </Grid>
      </div>
    </>
  );
}
