import type { Reading } from "@/contract/common";
import type { SeoAiSearchPayload } from "@/contract/seo/ai-search";
import type { OwnerTaskRow } from "@/contract/seo/common";
import { api, ask, me } from "@/lib/api";
import { parseRange } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Grid } from "@/components/ui/Grid";
import { SeoRefused } from "@/components/seo/nav/Refused";
import { Answers, type ListedAt } from "@/components/seo/ai-search/Answers";
import { Engines } from "@/components/seo/ai-search/Engines";
import { ImportPanel } from "@/components/seo/ai-search/Imports";
import { Levers } from "@/components/seo/ai-search/Levers";
import { Directories, Named } from "@/components/seo/ai-search/Listings";
import { Opps } from "@/components/seo/ai-search/Opps";
import { ReadinessChecks, ReadinessSite } from "@/components/seo/ai-search/Readiness";
import { ReadinessPages } from "@/components/seo/ai-search/ReadinessPages";
import { AiTiles } from "@/components/seo/ai-search/Tiles";
import { Crawlers, Visits } from "@/components/seo/ai-search/Traffic";
import { NeedsYou } from "@/components/seo/overview/NeedsYou";
import { Operator } from "@/components/seo/overview/Operator";
import "@/components/seo/ai-search/ai-search.css";

export const metadata = { title: "AI Search · SEO" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * SEO › AI Search: whether AI assistants name Balkaris, and what would make
 * them. No board: drawn in the language of the SEO boards (tiles, panels,
 * the Opportunities board's table beside its detail). The head, the period
 * and the tab strip are the SEO layout's (app/(frame)/seo/layout.tsx).
 *
 * One request draws it (GET /api/v1/seo/ai-search, contract/seo/ai-search.ts);
 * each panel is its own reading, so a source that is not connected costs its
 * panel and says what connects it. From the top: the figures; what moves the
 * share beside the answers by assistant; every question with what each
 * assistant said; where the answers look and who they named; visits and
 * crawlers; readiness, site-wide and page by page; what to change on the
 * site and what needs the owner; the two monthly imports.
 *
 * Recording answers and importing are the owner's; the opportunity buttons
 * queue operator tasks whose proposals wait for approval; nothing here
 * changes the live website.
 */
export default async function SeoAiSearchPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const range = parseRange(q.range);
  const [got, who] = await Promise.all([ask<SeoAiSearchPayload>("/api/v1/seo/ai-search", { range }), me()]);

  if (!got.ok) {
    /* Signed out or switched off: the usual way, through `api`, which redirects or shows the calm screen. */
    if (got.kind === "signed-out" || got.kind === "off") await api<SeoAiSearchPayload>("/api/v1/seo/ai-search", { range });
    /* A page the owner has not given this person: the server did answer, with a refusal, and the gate says so. */
    if (got.kind === "forbidden") return <SeoRefused message={got.message} />;
    return (
      <Card title="AI Search" icon="sparkles">
        <Empty icon="alert" title="The desk did not answer for this page">
          {got.message} The other SEO pages are in the tabs above.
        </Empty>
      </Card>
    );
  }

  const d = got.value;
  const listed: ListedAt[] = d.listings.state === "ok" ? d.listings.value.directories.map((x) => ({ source: x.source, state: x.profile?.state ?? null, wanted: !!x.ownerTask })) : [];
  const owner: Reading<{ open: number; done: number; rows: OwnerTaskRow[] }> = d.needsYou.length
    ? {
        state: "ok",
        value: { open: d.needsYou.filter((t) => !t.done).length, done: d.needsYou.filter((t) => t.done).length, rows: d.needsYou },
        source: "desk",
        asOf: d.head.at,
        note: "The owner's steps that decide whether AI answers can find and trust Balkaris: profiles, reviews, Bing, one address, indexing. Marked done by a person, never by the desk.",
      }
    : { state: "waiting", source: "desk", reason: "No owner step about AI visibility is recorded: the audit's owner tasks come in with the SEO import (scripts/seo-import.ts)." };
  const robots = d.readiness.state === "ok" ? d.readiness.value.robots : null;

  return (
    <div className="dk-seo-ai-search">
      <AiTiles d={d} />
      <Grid cols="1.1fr 1fr">
        <Levers reading={d.levers} />
        <Engines reading={d.checks} engines={d.engines} owner={who.owner} />
      </Grid>
      <Answers reading={d.checks} engines={d.engines} listed={listed} />
      <Grid cols="1.15fr 0.85fr 0.9fr" mid="minmax(0, 1fr) minmax(0, 1fr)">
        <Directories reading={d.listings} />
        <Named reading={d.listings} />
        <Operator panel={d.operator} />
      </Grid>
      <Grid cols="1fr 1fr">
        <Visits reading={d.referrals} />
        <Crawlers reading={d.crawlers} robots={robots} />
      </Grid>
      <Grid cols="1fr 1fr">
        <ReadinessSite reading={d.readiness} />
        <ReadinessChecks reading={d.readiness} />
      </Grid>
      {d.readiness.state === "ok" && d.readiness.value.pages.length ? <ReadinessPages pages={d.readiness.value.pages} checks={d.readiness.value.byCheck} checkedAt={d.readiness.value.checkedAt} /> : null}
      <Grid cols="1.35fr 1fr">
        <Opps rows={d.opportunities} types={d.opportunityTypes} />
        <NeedsYou reading={owner} />
      </Grid>
      <Grid cols="1fr 1fr">
        <ImportPanel reading={d.imports.gscGenerativeAi} step={d.importSteps.gscGenerativeAi} owner={who.owner} />
        <ImportPanel reading={d.imports.bingAiPerformance} step={d.importSteps.bingAiPerformance} owner={who.owner} />
      </Grid>
    </div>
  );
}
