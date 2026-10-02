import { redirect } from "next/navigation";
import type { SeoPagesPayload } from "@/contract/seo/pages";
import { ContentCard, KeywordsCard, PerformanceCard, SerpCard } from "@/components/seo/pages/Below";
import { Filters } from "@/components/seo/pages/Filters";
import { PagesList } from "@/components/seo/pages/PagesList";
import { SummaryPanel } from "@/components/seo/pages/Summary";
import { PagesTileRow } from "@/components/seo/pages/Tiles";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { ask } from "@/lib/api";
import "@/components/seo/pages/pages.css";

export const metadata = { title: "Pages · SEO" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** What the address may carry to the desk server; anything else in it is ignored. */
const PASSED = ["range", "type", "status", "score", "traffic", "q", "sort", "dir", "offset", "limit", "open"] as const;

/**
 * SEO › Pages (board 106): every page of balkaris.ch as search sees it. One
 * request (GET /api/v1/seo/pages, contract/seo/pages.ts) draws the tiles, the
 * filters, the list, the chosen page's summary and the four panels under the
 * list; the head and the tab strip come from the SEO layout.
 *
 * Everything chosen (filters, order, page of the list, the page open in the
 * summary) is in the address, so the server draws it and a view can be shared.
 * The buttons queue operator tasks; nothing here changes the website.
 */
export default async function SeoPagesPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const params = Object.fromEntries(PASSED.map((k) => [k, one(q[k])]));
  const got = await ask<SeoPagesPayload>("/api/v1/seo/pages", params);
  if (!got.ok) {
    /* redirect() works by throwing, so it stays outside any try block. */
    if (got.kind === "signed-out") redirect("/auth/google");
    return (
      <Card title="Pages" icon="pages">
        <Empty icon="alert" title={got.kind === "missing" ? "Not on this desk yet" : "The desk did not answer"}>
          {got.kind === "missing" ? "This desk server does not answer /api/v1/seo/pages yet: it is answered once the SEO section's routes are mounted (src/cc/routes/seo.ts)." : got.message}
        </Empty>
      </Card>
    );
  }
  const data = got.value;
  const place = { query: data.query, range: data.head.range };
  const total = data.list.state === "ok" ? data.facets.types.reduce((n, t) => n + t.count, 0) : 0;
  const selected = data.selected?.state === "ok" ? data.selected.value.row.page.path : data.query.open;

  return (
    <div className="dk-seo-pages">
      <PagesTileRow tiles={data.tiles} search={data.search} />
      <div className="dk-seo-pages-grid">
        <Filters facets={data.facets} total={total} place={place} search={data.search} />
        <PagesList data={data} place={place} selected={selected} />
        <SummaryPanel reading={data.selected} place={place} />
        <div className="dk-seo-pages-below">
          <PerformanceCard selected={data.selected} />
          <KeywordsCard selected={data.selected} />
          <ContentCard selected={data.selected} />
          <SerpCard selected={data.selected} />
        </div>
      </div>
    </div>
  );
}
