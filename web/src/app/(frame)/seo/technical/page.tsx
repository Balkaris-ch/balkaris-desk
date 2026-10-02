import type { SeoTechnicalPayload } from "@/contract/seo/technical";
import { api, ask } from "@/lib/api";
import { parseRange } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Grid, Stack } from "@/components/ui/Grid";
import { ChecksCard, HealthCard } from "@/components/seo/technical/Health";
import { IndexationCard } from "@/components/seo/technical/Indexation";
import { IssuesCard, PagesCard } from "@/components/seo/technical/Issues";
import { OppsCard } from "@/components/seo/technical/Opps";
import { BrokenCard, RedirectsCard, RobotsCard, SchemaCard, SitemapCard } from "@/components/seo/technical/Site";
import { SpeedCard, VitalsCard } from "@/components/seo/technical/Speed";
import "@/components/seo/technical/tech.css";

export const metadata = { title: "Technical · SEO" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * SEO › Technical (board 113, panel 7). The head, the period and the tab
 * strip are the SEO layout's (app/(frame)/seo/layout.tsx).
 *
 * One request (GET /api/v1/seo/technical, contract/seo/technical.ts) draws
 * the page. First the board: Technical SEO Health and its checklist on the
 * left, Core Web Vitals and Page speed issues on the right. Then what the
 * board's lines lead to: Google's index with each state's meaning, its fix
 * and the Request indexing queue; every finding by rule and every page by
 * score; the sitemap, robots.txt and the crawlers it lets in, structured
 * data; redirects and broken links; and the technical opportunities.
 *
 * Each panel is its own reading: a source that is not connected costs its
 * panel and says what connects it. The buttons queue operator proposals
 * (which wait for approval), ask for a measurement, or record a person's step;
 * nothing here changes the live website.
 */
export default async function SeoTechnicalPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const range = parseRange(q.range, undefined, "30d");
  const got = await ask<SeoTechnicalPayload>("/api/v1/seo/technical", { range });
  if (!got.ok) {
    /* Signed out or switched off: the usual way, through `api`, which redirects or shows the calm screen. */
    if (got.kind === "signed-out" || got.kind === "off") await api<SeoTechnicalPayload>("/api/v1/seo/technical", { range });
    return (
      <Card title="Technical" icon="wrench">
        <Empty icon="alert" title="The desk did not answer for this page">
          {got.message} The other SEO pages are in the tabs above.
        </Empty>
      </Card>
    );
  }
  const d = got.value;

  return (
    <div className="dk-seo-technical">
      <Grid cols="1fr 1fr" mid="1fr 1fr">
        <Stack>
          <HealthCard score={d.score} crawl={d.crawl} indexation={d.indexation} />
          <ChecksCard lines={d.checks} />
        </Stack>
        <Stack>
          <VitalsCard vitals={d.vitals} />
          <SpeedCard speed={d.speed} job={d.jobs.speed} />
        </Stack>
      </Grid>
      <IndexationCard reading={d.indexation} job={d.jobs.inspect} />
      <Grid cols="1fr 1fr">
        <Stack>
          <IssuesCard reading={d.issues} />
          <BrokenCard reading={d.broken} />
        </Stack>
        <PagesCard reading={d.pages} />
      </Grid>
      <Grid cols="1fr 1fr 1fr" mid="1fr 1fr">
        <SitemapCard sitemap={d.sitemap} checks={d.siteChecks} submitted={d.submitted} />
        <RobotsCard robots={d.robots} llms={d.llms} />
        <Stack>
          <SchemaCard reading={d.schema} />
          <RedirectsCard reading={d.redirects} />
        </Stack>
      </Grid>
      <OppsCard rows={d.opportunities} owner={d.viewer?.owner ?? false} />
    </div>
  );
}
