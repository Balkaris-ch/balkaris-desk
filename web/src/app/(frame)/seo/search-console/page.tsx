import { redirect } from "next/navigation";
import type { ExplorerQuery, SeoSearchConsolePayload } from "@/contract/seo/search-console";
import { api, ask } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { SeoRefused } from "@/components/seo/nav/Refused";
import { ScChart } from "@/components/seo/search-console/Chart";
import { Explorer } from "@/components/seo/search-console/Explorer";
import { ScFilters } from "@/components/seo/search-console/Filters";
import { CHART_METRICS, scHref, type ChartMetric, type Place } from "@/components/seo/search-console/href";
import { Inspection } from "@/components/seo/search-console/Inspection";
import { History, Sitemaps } from "@/components/seo/search-console/Sitemaps";
import { ScTiles } from "@/components/seo/search-console/Tiles";
import "@/components/seo/search-console/gsc.css";

export const metadata = { title: "Search Console · SEO" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** What the address may carry to the desk server (contract/seo/search-console.ts); `chart` is this page's own. */
const PASSED = ["range", "dimension", "start", "end", "country", "device", "q", "page", "pagepart", "offsite", "sort", "dir", "offset", "limit", "source", "ix", "ixq", "ixs", "ixsort", "ixo"] as const;

/**
 * The values the filter selects read straight from the address, as the
 * server answered them: "mobile" is MOBILE, "CHE" is che, "work" is /work, a
 * limit that is not a number is the default. A select shows the option equal
 * to the address, so an address typed by hand that the server normalised would
 * otherwise apply a filter while its select says "All".
 */
function selectsDiffer(q: Record<string, string | string[] | undefined>, a: ExplorerQuery): boolean {
  const raw = (k: string): string | undefined => {
    const v = one(q[k])?.trim();
    return v ? v : undefined;
  };
  const want: Record<string, string | undefined> = {
    device: a.device === "all" ? undefined : a.device,
    country: a.country === "all" ? undefined : a.country,
    page: a.page ?? undefined,
    limit: a.limit === 25 ? undefined : String(a.limit),
  };
  return Object.entries(want).some(([k, v]) => {
    const got = raw(k);
    /* "all" written out is the default left out. */
    return (got === "all" ? undefined : got) !== v;
  });
}

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
 * in the desk's queue that a person pressed Request indexing in Search
 * Console, and "Check again now" asks Google again about the sitemap's
 * addresses (it reads, and counts against the day's inspection allowance).
 */
export default async function SeoSearchConsolePage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const params: Record<string, string | undefined> = {};
  for (const k of PASSED) params[k] = one(q[k]);

  const got = await ask<SeoSearchConsolePayload>("/api/v1/seo/search-console", params);
  if (!got.ok) {
    /* Signed out or switched off: the usual way, through `api`, which redirects or shows the calm screen. */
    if (got.kind === "signed-out" || got.kind === "off") await api<SeoSearchConsolePayload>("/api/v1/seo/search-console", params);
    /* A page the owner has not given this person: the server did answer, with a refusal, and the gate says so. */
    if (got.kind === "forbidden") return <SeoRefused message={got.message} />;
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
  const place: Place = {
    asked: data.asked,
    range: data.head.range,
    chart: CHART_METRICS.includes(chartAsked as ChartMetric) ? (chartAsked as ChartMetric) : "volume",
    ix: data.inspectionAsked,
    dates: data.asked.window,
    live: one(q.source) === "live",
  };
  /* The address the server answered, written out, when a select would otherwise contradict it. Its own links are
     always written that way, so this happens once, for an address typed or pasted by hand. */
  if (selectsDiffer(q, data.asked)) redirect(scHref(place));
  /* Dates were given and the server could not take them as a window: the period is shown, and the dates field says why. */
  const datesIgnored = !!(one(q.start) || one(q.end)) && data.asked.window === null;

  return (
    <div className="dk-seo-gsc">
      <ScFilters place={place} options={data.options} result={data.result} datesIgnored={datesIgnored} />
      <ScTiles result={data.result} />
      <ScChart result={data.result} place={place} />
      <Explorer result={data.result} place={place} consoleHref={data.href} />
      <div className="dk-seo-gsc-lower">
        <Inspection reading={data.inspection} place={place} job={data.inspectJob} />
        <div className="dk-seo-gsc-side">
          <Sitemaps reading={data.sitemaps} listed={data.listed} own={data.ownSitemap} href={data.sitemapsHref} />
          <History reading={data.history} />
        </div>
      </div>
    </div>
  );
}
