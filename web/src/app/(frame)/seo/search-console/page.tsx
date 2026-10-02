import type { SeoSearchConsolePayload } from "@/contract/seo/search-console";
import { api, ask } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { ScChart } from "@/components/seo/search-console/Chart";
import { Explorer } from "@/components/seo/search-console/Explorer";
import { ScFilters } from "@/components/seo/search-console/Filters";
import { CHART_METRICS, type ChartMetric, type Place } from "@/components/seo/search-console/href";
import { Inspection } from "@/components/seo/search-console/Inspection";
import { History, Sitemaps } from "@/components/seo/search-console/Sitemaps";
import { ScTiles } from "@/components/seo/search-console/Tiles";
import "@/components/seo/search-console/gsc.css";

export const metadata = { title: "Search Console · SEO" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** What the address may carry to the desk server (contract/seo/search-console.ts); `chart` is this page's own. */
const PASSED = ["range", "dimension", "start", "end", "country", "device", "q", "page", "sort", "dir", "offset", "limit", "source", "ix", "ixo"] as const;

/**
 * SEO › Search Console (board 113, panel 8): Google's own search figures,
 * explored. One request (GET /api/v1/seo/search-console) draws the page: the
 * filters, the four figures, the chart, the table by query, page, country,
 * device, day or search appearance, the URL Inspection of every sitemap
 * address, the sitemaps and what the desk's own copy holds. The head, the
 * period and the tab strip are the SEO layout's.
 *
 * Everything chosen is in the address, so the server draws it and a view can
 * be shared. Nothing here changes the website: "Mark requested" only records
 * in the desk's queue that a person pressed Request indexing in Search Console.
 */
export default async function SeoSearchConsolePage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const params: Record<string, string | undefined> = {};
  for (const k of PASSED) params[k] = one(q[k]);

  const got = await ask<SeoSearchConsolePayload>("/api/v1/seo/search-console", params);
  if (!got.ok) {
    /* Signed out or switched off: the usual way, through `api`, which redirects or shows the calm screen. */
    if (got.kind === "signed-out" || got.kind === "off") await api<SeoSearchConsolePayload>("/api/v1/seo/search-console", params);
    return (
      <Card title="Search Console" icon="line-chart">
        <Empty icon="alert" title="The desk did not answer for this page">
          {got.message}
        </Empty>
      </Card>
    );
  }
  const data = got.value;
  const chartAsked = one(q.chart);
  const start = one(q.start);
  const end = one(q.end);
  const place: Place = {
    asked: data.asked,
    range: data.head.range,
    chart: CHART_METRICS.includes(chartAsked as ChartMetric) ? (chartAsked as ChartMetric) : "volume",
    ix: data.inspectionAsked,
    dates: start && end && data.asked.start === start && data.asked.end === end ? { start, end } : null,
    live: one(q.source) === "live",
  };

  return (
    <div className="dk-seo-gsc">
      <ScFilters place={place} options={data.options} result={data.result} />
      <ScTiles result={data.result} />
      <ScChart result={data.result} place={place} />
      <Explorer result={data.result} place={place} consoleHref={data.href} />
      <div className="dk-seo-gsc-lower">
        <Inspection reading={data.inspection} place={place} />
        <div className="dk-seo-gsc-side">
          <Sitemaps reading={data.sitemaps} listed={data.listed} href={data.sitemapsHref} />
          <History reading={data.history} />
        </div>
      </div>
    </div>
  );
}
