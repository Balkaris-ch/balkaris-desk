import type { SeoKeywordsPayload } from "@/contract/seo/keywords";
import { api, ask } from "@/lib/api";
import { parseRange } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Grid } from "@/components/ui/Grid";
import { SeoRefused } from "@/components/seo/nav/Refused";
import { KwClusters } from "@/components/seo/keywords/KwClusters";
import { KwKit } from "@/components/seo/keywords/KwAct";
import { KwList } from "@/components/seo/keywords/KwList";
import { KwTileRow } from "@/components/seo/keywords/KwTiles";
import { SourcesCard, TargetsCard } from "@/components/seo/keywords/KwUnder";
import "@/components/seo/keywords/keywords.css";

export const metadata = { title: "Keywords · SEO" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** What the address may carry to the desk server; anything else in it is ignored. */
const PASSED = ["view", "lang", "intent", "cluster", "source", "status", "band", "shown", "target", "flag", "page", "q", "sort", "dir", "corder", "offset", "limit"] as const;

/**
 * SEO › Keywords (board 113, panel 4): every phrase the desk knows, from
 * Search Console, Google Autocomplete research, the SEO audit and people,
 * with what Google shows for it, the page that answers it and what to do; or,
 * as a second mode (?view=clusters), the topic clusters they form. The head,
 * the period and the tab strip are the SEO layout's.
 *
 * One request (GET /api/v1/seo/keywords, contract/seo/keywords.ts) draws the
 * page. Everything chosen is in the address, so the server draws it and a
 * view can be shared. The buttons record a person's mapping, judgement or
 * target, or queue an operator brief; nothing here changes the website.
 */
export default async function SeoKeywordsPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const range = parseRange(q.range, undefined, "30d");
  const params: Record<string, string | undefined> = { range };
  for (const k of PASSED) params[k] = one(q[k]);

  const got = await ask<SeoKeywordsPayload>("/api/v1/seo/keywords", params);
  if (!got.ok) {
    /* Signed out or switched off: the usual way, through `api`, which redirects or shows the calm screen. */
    if (got.kind === "signed-out" || got.kind === "off") await api<SeoKeywordsPayload>("/api/v1/seo/keywords", params);
    /* A page the owner has not given this person: the server did answer, with a refusal, and the gate says so. */
    if (got.kind === "forbidden") return <SeoRefused message={got.message} />;
    return (
      <Card title="Keywords" icon="key">
        <Empty icon="alert" title="The desk did not answer for this page">
          {got.message}
        </Empty>
      </Card>
    );
  }
  const data = got.value;
  const place = { asked: data.asked, range: data.head.range };
  const pages = data.sitePages.state === "ok" ? data.sitePages.value : null;

  return (
    <KwKit pages={pages} pagesWhy={data.sitePages.state === "ok" ? null : data.sitePages.reason} clusters={data.topics}>
      <div className="dk-seo-kw">
        <KwTileRow tiles={data.tiles} />
        {data.asked.view === "clusters" ? <KwClusters data={data} place={place} /> : <KwList data={data} place={place} />}
        <Grid cols="1.5fr 1fr" mid="1fr 1fr">
          <TargetsCard data={data} place={place} />
          <SourcesCard data={data} place={place} />
        </Grid>
      </div>
    </KwKit>
  );
}
