import type { Reading } from "@/contract/common";
import type { SeoTechnicalPayload } from "@/contract/seo/technical";
import type { ExtractResults, ExtractRule, SpiderAudit, SpiderAuditListed, SpiderDuplicates } from "@/contract/spider";
import { api, ask, askMe } from "@/lib/api";
import { parseRange } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Grid, Stack } from "@/components/ui/Grid";
import { SeoRefused } from "@/components/seo/nav/Refused";
import { GooglePanel } from "@/components/seo/google/GooglePanel";
import { TechFilters } from "@/components/seo/technical/Filters";
import { keptOf, techHref } from "@/components/seo/technical/href";
import { ChecksCard, HealthCard } from "@/components/seo/technical/Health";
import { IndexationCard } from "@/components/seo/technical/Indexation";
import { IssuesCard, PagesCard } from "@/components/seo/technical/Issues";
import { OppsCard } from "@/components/seo/technical/Opps";
import { BrokenCard, RedirectsCard, RobotsCard, SchemaCard, SitemapCard } from "@/components/seo/technical/Site";
import { SpeedCard, VitalsCard } from "@/components/seo/technical/Speed";
import { AuditCard } from "@/components/seo/technical/SpiderAudit";
import { DuplicatesCard } from "@/components/seo/technical/SpiderDuplicates";
import { ExtractionCard } from "@/components/seo/technical/SpiderRules";
import "@/components/seo/technical/tech.css";
import "@/components/seo/technical/spider.css";

export const metadata = { title: "Technical · SEO" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * SEO › Technical (board 113, panel 7). The head, the period and the tab
 * strip are the SEO layout's (app/(frame)/seo/layout.tsx).
 *
 * One request (GET /api/v1/seo/technical, contract/seo/technical.ts) draws
 * the page. First the board: Technical SEO Health and its checklist on the
 * left, Core Web Vitals and Page speed issues on the right. Then what the
 * board's lines lead to: Google's index with each state's meaning and its
 * fix ("Check now", "Inspect now"); what the desk does at Google and the
 * other engines (#google: the Request indexing queue, sitemaps submitted,
 * IndexNow); every finding by rule and every page by score, with one search
 * box and the lists as files; the sitemap, robots.txt and the crawlers it
 * lets in, structured data; redirects and broken links; and the technical
 * opportunities.
 *
 * The address holds the state: ?range, ?q (the search), ?sev (findings by
 * severity), ?index (pages by Google's answer), ?device (the speed runs) and
 * ?rule (one extraction rule's results). Only those are passed on.
 *
 * Each panel is its own reading: a source that is not connected costs its
 * panel and says what connects it. The buttons queue operator proposals
 * (which wait for approval), ask for a measurement, or record a person's step;
 * nothing here changes the live website.
 *
 * Last, the crawler's tools (contract/spider.ts): an audit of one page of any
 * public website, the duplicate content the last crawl found, and the owner's
 * custom extraction rules with what each found (?rule=<id> opens one). Their
 * readings are asked beside the page's own request, in the same round, and a
 * failure costs only its own panel.
 */
export default async function SeoTechnicalPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const range = parseRange(q.range, undefined, "30d");
  const open = typeof q.rule === "string" && /^\d{1,9}$/.test(q.rule) ? Number(q.rule) : null;
  /* Only the params this page reads go to the server (the filters: the server reads an unknown value as "all"). */
  const base = keptOf(q);
  const filters: Record<string, string> = { range };
  for (const k of ["q", "sev", "index", "device"] as const) if (base[k]) filters[k] = base[k] as string;
  /* The rules are the owner's alone (the server refuses them to anybody else). Who is looking was asked by the frame already; askMe answers from that. */
  const owners = <T,>(path: string) => askMe().then((who) => (who.ok && who.value.owner ? ask<T>(path) : null));
  const [got, duplicates, rules, found, audits, audited] = await Promise.all([
    ask<SeoTechnicalPayload>("/api/v1/seo/technical", filters),
    ask<Reading<SpiderDuplicates>>("/api/v1/spider/duplicates"),
    owners<ExtractRule[]>("/api/v1/spider/extract"),
    open === null ? null : owners<ExtractResults>(`/api/v1/spider/extract/${open}/results`),
    /* The day's audits, and one of them reopened by ?audit=<url>: a failure costs only the audit card its list. */
    ask<SpiderAuditListed[]>("/api/v1/spider/audits"),
    base.audit ? ask<SpiderAudit>("/api/v1/spider/audits", { url: base.audit }) : null,
  ]);
  if (!got.ok) {
    /* Signed out or switched off: the usual way, through `api`, which redirects or shows the calm screen. */
    if (got.kind === "signed-out" || got.kind === "off") await api<SeoTechnicalPayload>("/api/v1/seo/technical", filters);
    /* A page the owner has not given this person: the server did answer, with a refusal, and the gate says so. */
    if (got.kind === "forbidden") return <SeoRefused message={got.message} />;
    return (
      <Card title="Technical" icon="wrench">
        <Empty icon="alert" title="The desk did not answer for this page">
          {got.message} The other SEO pages are in the tabs above.
        </Empty>
      </Card>
    );
  }
  const d = got.value;

  /* This page's address with one rule's results open, or none; the period and the filters kept. */
  const ruleHref = (rule: number | null, hash: string): string => techHref(base, { rule: rule === null ? null : String(rule) }, hash);

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
      {/* What the desk does at Google and the other engines: the Request indexing queue, sitemaps, IndexNow. An older server without it: the panel is left out. */}
      {d.google ? <GooglePanel panel={d.google} /> : null}
      {d.asked ? <TechFilters asked={d.asked} base={base} /> : null}
      <Grid cols="1fr 1fr">
        <Stack>
          <IssuesCard reading={d.issues} asked={d.asked} />
          <BrokenCard reading={d.broken} />
        </Stack>
        <PagesCard reading={d.pages} asked={d.asked} />
      </Grid>
      <Grid cols="1fr 1fr 1fr" mid="1fr 1fr">
        <SitemapCard sitemap={d.sitemap} checks={d.siteChecks} submitted={d.submitted} sitemapsHref={d.sitemapsHref} />
        <RobotsCard robots={d.robots} llms={d.llms} />
        <Stack>
          <SchemaCard reading={d.schema} />
          <RedirectsCard reading={d.redirects} />
        </Stack>
      </Grid>
      <OppsCard rows={d.opportunities} owner={d.viewer?.owner ?? false} />
      <section className="dk-seo-technical-spider" aria-label="The crawler’s tools">
        <AuditCard
          recent={audits.ok ? audits.value.map((a) => ({ ...a, href: techHref(base, { audit: a.url }, "audit") })) : []}
          opened={audited?.ok ? audited.value : null}
          prefill={base.audit ?? ""}
          key={base.audit ?? ""}
        />
        {rules ? (
          <Grid cols="1fr 1fr">
            <DuplicatesCard answer={duplicates} />
            <ExtractionCard answer={rules} open={open} found={found} href={ruleHref} nextCrawl={d.jobs.crawl?.nextRun ?? null} />
          </Grid>
        ) : (
          <DuplicatesCard answer={duplicates} />
        )}
      </section>
    </div>
  );
}
