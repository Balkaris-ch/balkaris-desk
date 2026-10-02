import type { SeoPageViewPayload } from "@/contract/seo/page-view";
import { api, ask } from "@/lib/api";
import { parseRange } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Absent } from "@/components/ui/Read";
import { isTab, optimizeHref, type OptimizeTab } from "@/components/seo/optimize/bits";
import { OperatorColumn } from "@/components/seo/optimize/OperatorColumn";
import { CompetitorsPanel, PerformancePanel, PotentialPanel, StatusPanel } from "@/components/seo/optimize/Overview";
import { PageHeadCard } from "@/components/seo/optimize/PageHeadCard";
import { PagesList } from "@/components/seo/optimize/PagesList";
import { QuickActions } from "@/components/seo/optimize/QuickActions";
import { SearchPreview } from "@/components/seo/optimize/SearchPreview";
import { SiteTiles } from "@/components/seo/optimize/SiteTiles";
import { ContentView, KeywordsView, LinksView, OptimizeView, PerformanceView, TechnicalView } from "@/components/seo/optimize/TabViews";
import "@/components/seo/optimize/optimize.css";

export const metadata = { title: "Page Optimization · SEO" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * SEO › Page Optimization (board 115), /seo/pages/view?path=<address>.
 *
 * One request (GET /api/v1/seo/optimize, contract/seo/page-view.ts) draws the
 * screen: the site's tile row, the pages list on the left by priority, the
 * chosen page in the middle (its status ring, its Search Console figures, our
 * estimate of its potential, quick actions, its search preview, the
 * competitors seen for its topics, and six more tabs: Optimize, Keywords,
 * Content, Internal Links, Technical, Performance), and the AI SEO Operator's
 * suggestions for it on the right. Without ?path= the list's first page opens.
 *
 * The head ("Page Optimization", the period, "Run full SEO audit") and the
 * SEO tab strip are the SEO layout's (app/(frame)/seo/layout.tsx). Should the
 * desk not answer for this page, it says so in place and the head stays.
 * Nothing on this screen changes the live site without a person's approval.
 */
export default async function SeoPageOptimizationPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const asked = one(q.range);
  const range = parseRange(asked, undefined, "30d");
  /* The address keeps the period only when one was chosen. */
  const keep = asked && asked === range ? range : null;
  const tabAsked = one(q.tab);
  const tab: OptimizeTab = isTab(tabAsked) ? tabAsked : "overview";
  const params = { path: one(q.path), range };

  const got = await ask<SeoPageViewPayload>("/api/v1/seo/optimize", params);
  if (!got.ok) {
    /* Signed out or switched off: the usual way, through `api`, which redirects or shows the calm screen. */
    if (got.kind === "signed-out" || got.kind === "off") await api<SeoPageViewPayload>("/api/v1/seo/optimize", params);
    return (
      <Card title="Page Optimization" icon="pages">
        <Empty icon="alert" title="The desk did not answer for this page">
          {got.message}
        </Empty>
      </Card>
    );
  }
  const data = got.value;
  const path = data.path;
  const serp = data.serp;
  const crawl = data.crawl.state === "ok" ? data.crawl.value : null;
  const topQuery = data.queries.state === "ok" ? ([...data.queries.value.rows].sort((a, b) => b.impressions - a.impressions)[0]?.query ?? null) : null;

  return (
    <div className="dk-seo-optimize">
      <SiteTiles site={data.site} />
      <div className="dk-seo-optimize-grid">
        <div className="dk-seo-optimize-side">
          {data.list.state === "ok" ? (
            <PagesList list={data.list.value} selected={path} range={keep} tab={tab} />
          ) : (
            <Card title="Pages" className="dk-seo-optimize-list">
              <Absent reading={data.list} />
            </Card>
          )}
        </div>

        <div className="dk-seo-optimize-main">
          {path ? (
            <>
              <PageHeadCard data={data} range={keep} tab={tab} />
              {data.page.state !== "ok" ? (
                <Card title="This page">
                  <Absent reading={data.page} />
                </Card>
              ) : tab === "overview" ? (
                <>
                  <div className="dk-seo-optimize-trio">
                    <StatusPanel reading={data.status} path={path} range={keep} />
                    <PerformancePanel data={data} />
                    <PotentialPanel reading={data.potential} data={data} path={path} range={keep} />
                  </div>
                  <QuickActions actions={data.quick} runnerLine={data.operator.runner.line} />
                  {serp ? <SearchPreview serp={serp} crawl={crawl} query={topQuery} editHref={optimizeHref(path, keep, "optimize")} /> : null}
                  <CompetitorsPanel data={data} />
                </>
              ) : tab === "optimize" ? (
                <OptimizeView data={data} />
              ) : tab === "keywords" ? (
                <KeywordsView data={data} />
              ) : tab === "content" ? (
                <ContentView data={data} />
              ) : tab === "links" ? (
                <LinksView data={data} />
              ) : tab === "technical" ? (
                <TechnicalView data={data} />
              ) : (
                <PerformanceView data={data} />
              )}
            </>
          ) : (
            <Card title="Page Optimization" icon="pages">
              <Empty icon="pages" title="No page to show">
                {data.list.state === "ok" ? "The list has no page yet." : data.list.reason}
              </Empty>
            </Card>
          )}
        </div>

        {path && data.page.state === "ok" ? (
          <div className="dk-seo-optimize-aside">
            <OperatorColumn operator={data.operator} suggestions={data.suggestions} asked={data.asked} proposals={data.proposals} path={path} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
