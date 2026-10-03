import type { SeoCompetitorsPayload } from "@/contract/seo/competitors";
import { api, ask } from "@/lib/api";
import { parseRange } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { SeoRefused } from "@/components/seo/nav/Refused";
import { CompDetail } from "@/components/seo/competitors/CompDetail";
import { CompList } from "@/components/seo/competitors/CompList";
import { CompTiles } from "@/components/seo/competitors/CompTiles";
import { Clusters } from "@/components/seo/competitors/Clusters";
import { Directories, Refresh } from "@/components/seo/competitors/Directories";
import { Lacks } from "@/components/seo/competitors/Lacks";
import { hrefWith, paramsOf } from "@/components/seo/competitors/look";
import "@/components/seo/competitors/competitors.css";

export const metadata = { title: "Competitors · SEO" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** What the address may carry to the desk server; anything else in it is ignored. */
const PASSED = ["engine", "type", "cluster", "q", "sort", "offset", "limit", "open"] as const;

/**
 * SEO › Competitors. No board of its own: drawn in the SEO boards' manner
 * (tiles, a list with the chosen row in detail beside it, panels under it).
 * One request (GET /api/v1/seo/competitors, contract/seo/competitors.ts)
 * draws the page; the head, the period and the tab strip are the SEO
 * layout's.
 *
 * Who appears for our clusters in Google and in AI answers, what each has
 * that Balkaris lacks (German pages, prices, structured data, the map pack,
 * AI answers, directories), and for each cluster who ranks beside our own
 * page. No domain rating and no traffic estimate: no free, honest source
 * gives either. Every filter is in the address, so the server draws it and a
 * view can be shared. The buttons queue a brief for the AI Operator or ask
 * for the weekly read of their pages; nothing here changes the website.
 */
export default async function SeoCompetitorsPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const range = parseRange(q.range, undefined, "30d");
  const params: Record<string, string | undefined> = { range };
  for (const k of PASSED) params[k] = one(q[k]);

  const got = await ask<SeoCompetitorsPayload>("/api/v1/seo/competitors", params);
  if (!got.ok) {
    /* Signed out or switched off: the usual way, through `api`, which redirects or shows the calm screen. */
    if (got.kind === "signed-out" || got.kind === "off") await api<SeoCompetitorsPayload>("/api/v1/seo/competitors", params);
    /* A page the owner has not given this person: the server did answer, with a refusal, and the gate says so. */
    if (got.kind === "forbidden") return <SeoRefused message={got.message} />;
    return (
      <Card title="Competitors" icon="users">
        <Empty icon="alert" title="The desk did not answer for this page">
          {got.message}
        </Empty>
      </Card>
    );
  }
  const data = got.value;
  const openKey = data.selected?.state === "ok" ? data.selected.value.competitor.domain : null;
  const base = paramsOf(data.asked, data.head.range);
  const a = data.asked;
  /* The same list with its filters taken off (the order and the period kept): offered when the filters leave no row. */
  const clear = a.q || a.cluster || a.type !== "all" || a.engine !== "all" ? hrefWith(base, { engine: undefined, type: undefined, cluster: undefined, q: undefined }) : null;

  return (
    <div className="dk-seo-competitors">
      <CompTiles tiles={data.tiles} />
      <div className="dk-seo-competitors-main">
        <div className="dk-seo-competitors-main-grid">
          <div className="dk-seo-competitors-area-list">
            <CompList data={data} base={base} openKey={openKey} />
          </div>
          <div className="dk-seo-competitors-area-detail">
            <CompDetail reading={data.selected} list={data.list} clear={clear} />
          </div>
        </div>
      </div>
      <div className="dk-seo-competitors-under">
        <Lacks reading={data.lacks} />
        <div className="dk-seo-competitors-under-side">
          <Directories reading={data.directories} />
          <Refresh refresh={data.refresh} />
        </div>
      </div>
      <Clusters reading={data.clusters} rules={data.rules} range={data.head.range} />
    </div>
  );
}
