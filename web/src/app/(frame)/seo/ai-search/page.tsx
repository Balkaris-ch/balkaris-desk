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
import { Asking } from "@/components/seo/ai-search/Asking";
import { Engines } from "@/components/seo/ai-search/Engines";
import { ImportPanel } from "@/components/seo/ai-search/Imports";
import { Levers } from "@/components/seo/ai-search/Levers";
import { Directories, Named } from "@/components/seo/ai-search/Listings";
import { AiNeedsYou } from "@/components/seo/ai-search/NeedsYou";
import { AiOperator } from "@/components/seo/ai-search/Operator";
import { Opps } from "@/components/seo/ai-search/Opps";
import { ReadinessChecks, ReadinessSite } from "@/components/seo/ai-search/Readiness";
import { ReadinessPages } from "@/components/seo/ai-search/ReadinessPages";
import { AiTiles } from "@/components/seo/ai-search/Tiles";
import { Crawlers, Visits } from "@/components/seo/ai-search/Traffic";
import "@/components/seo/ai-search/ai-search.css";

export const metadata = { title: "AI Search · SEO" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** The search params this page reads besides the head's range: each is checked again by the server (AiSearchAsked). */
const PASSED = ["q", "show", "engine", "open", "named", "who", "fail", "find", "kind", "pages", "page", "psort", "asking"] as const;

/**
 * SEO › AI Search: whether AI assistants name Balkaris, and what would make
 * them. No board: drawn in the language of the SEO boards (tiles, panels,
 * the Opportunities board's table beside its detail). The head, the period
 * and the tab strip are the SEO layout's (app/(frame)/seo/layout.tsx).
 *
 * One request draws it (GET /api/v1/seo/ai-search, contract/seo/ai-search.ts),
 * with every filter, search and opened row of the address passed on, so the
 * server draws the view and it can be reloaded and shared. Each panel is its
 * own reading, so a source that is not connected costs its panel and says
 * what connects it. From the top: the figures; what moves the share beside
 * the answers by assistant; every tracked question with what each assistant
 * said; the questions people search; where the answers look and who they
 * named; visits and crawlers; readiness, site-wide and page by page; what to
 * change on the site and what needs the owner; the operator; the two monthly
 * imports.
 *
 * Recording answers, rounds and the list of questions are the owner's; every
 * other button posts to this page's own addresses, so the owner's switch for
 * AI Search decides who may press it. The operator's tasks run on the studio
 * workstation's own model and what they propose waits for approval; nothing
 * here changes the live website.
 */
export default async function SeoAiSearchPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const range = parseRange(q.range);
  const params: Record<string, string | undefined> = { range };
  for (const k of PASSED) params[k] = one(q[k]);
  const [got, who] = await Promise.all([ask<SeoAiSearchPayload>("/api/v1/seo/ai-search", params), me()]);

  if (!got.ok) {
    /* Signed out or switched off: the usual way, through `api`, which redirects or shows the calm screen. */
    if (got.kind === "signed-out" || got.kind === "off") await api<SeoAiSearchPayload>("/api/v1/seo/ai-search", params);
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
  const asked = d.asked;
  const listed: ListedAt[] = d.listings.state === "ok" ? d.listings.value.directories.map((x) => ({ source: x.source, state: x.profile?.state ?? null, wanted: !!x.ownerTask })) : [];
  const known = d.answers.state === "ok" ? d.answers.value.all.map((x) => ({ question: x.question, lang: x.lang, kind: x.kind })) : [];
  const owner: Reading<{ open: number; done: number; rows: OwnerTaskRow[] }> = d.needsYou.length
    ? {
        state: "ok",
        value: { open: d.needsYou.filter((t) => !t.done).length, done: d.needsYou.filter((t) => t.done).length, rows: d.needsYou },
        source: "desk",
        asOf: d.head.at,
        note: "The owner's steps that decide whether AI answers can find and trust Balkaris: profiles, reviews, Bing, one address, indexing. Marked done by a person, never by the desk.",
      }
    : { state: "waiting", source: "desk", reason: "No owner step about AI visibility is recorded: the audit's owner tasks come in with the SEO import (scripts/seo-import.ts)." };
  const r = d.readiness.state === "ok" ? d.readiness.value : null;

  return (
    <div className="dk-seo-ai-search">
      <AiTiles d={d} />
      <Grid cols="1.1fr 1fr">
        <Levers reading={d.levers} />
        <Engines reading={d.checks} engines={d.engines} owner={who.owner} known={known} />
      </Grid>
      <Answers reading={d.answers} asked={asked} range={range} engines={d.engines} listed={listed} owner={who.owner} />
      <Asking reading={d.asking} asked={asked} range={range} owner={who.owner} />
      <Grid cols="1.15fr 0.85fr 0.9fr" mid="minmax(0, 1fr) minmax(0, 1fr)">
        <Directories reading={d.listings} asked={asked} range={range} />
        <Named reading={d.listings} asked={asked} range={range} />
        <AiOperator panel={d.operator} />
      </Grid>
      <Grid cols="1fr 1fr">
        <Visits reading={d.referrals} job={d.visitsJob} />
        <Crawlers reading={d.crawlers} robots={r?.robots ?? null} robotsNote={r?.robotsNote ?? null} />
      </Grid>
      <Grid cols="1fr 1fr">
        <ReadinessSite reading={d.readiness} />
        <ReadinessChecks reading={d.readiness} />
      </Grid>
      {r && r.list.total ? <ReadinessPages r={r} asked={asked} range={range} /> : null}
      <Grid cols="1.35fr 1fr">
        <Opps rows={d.opportunities} types={d.opportunityTypes} />
        <AiNeedsYou reading={owner} />
      </Grid>
      <Grid cols="1fr 1fr">
        <ImportPanel reading={d.imports.gscGenerativeAi} step={d.importSteps.gscGenerativeAi} owner={who.owner} />
        <ImportPanel reading={d.imports.bingAiPerformance} step={d.importSteps.bingAiPerformance} owner={who.owner} />
      </Grid>
    </div>
  );
}
