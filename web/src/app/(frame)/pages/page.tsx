import { redirect } from "next/navigation";
import type { PagesPayload } from "@/contract/pages";
import { PageHead } from "@/components/shell/PageHead";
import { crawlSaid } from "@/components/pages/crawl-said";
import { filtersOf } from "@/components/pages/filters";
import { PagesTable } from "@/components/pages/PagesTable";
import { ActivityCard, MetadataCard, PagesTileRow, QuickActionsCard, RouteHealthCard } from "@/components/pages/Panels";
import { Card } from "@/components/ui/Card";
import { Grid } from "@/components/ui/Grid";
import { Absent } from "@/components/ui/Read";
import { api } from "@/lib/api";
import { parseRange } from "@/lib/format";

export const metadata = { title: "Pages" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * Pages: every page of www.balkaris.ch. One request (GET /api/v1/pages)
 * draws the whole screen; the table filters, sorts and pages in the browser
 * over the inventory it was given, and writes what is chosen into the address.
 */
export default async function PagesPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;

  /* The top bar's search sends a page here as ?open=<address> (src/cc/site/index.ts, deskHref). */
  const open = one(q.open);
  if (open) redirect(`/pages/view?path=${encodeURIComponent(open)}`);

  const range = parseRange(q.range);
  const initial = filtersOf((name) => one(q[name]));
  const data = await api<PagesPayload>("/api/v1/pages", { range });
  /* A code from the crawl action; anything else in the address is ignored. */
  const said = crawlSaid(one(q.crawl));
  const back = `/pages${range !== "30d" ? `?range=${range}` : ""}`;

  return (
    <>
      <PageHead eyebrow="Pages" title="Pages" subtitle="Manage and optimize every page on balkaris.ch." ranges />
      <PagesTileRow tiles={data.tiles} />
      {data.inventory.state === "ok" ? (
        <PagesTable
          /* A link that changes the filters (View route issues…) draws the table again from its address. */
          key={JSON.stringify(initial)}
          rows={data.inventory.value}
          inventory={data.inventory}
          traffic={data.traffic}
          conversions={data.conversions}
          updates={data.updates}
          top={data.top}
          range={range}
          initial={initial}
        />
      ) : (
        <Card title="All pages" icon="pages" id="dk-pages-table">
          <Absent reading={data.inventory} />
        </Card>
      )}
      <Grid cols="1.09fr 1fr 1.19fr 1fr">
        <RouteHealthCard reading={data.routeHealth} range={range} />
        <MetadataCard reading={data.metadata} range={range} />
        <ActivityCard reading={data.activity} />
        <QuickActionsCard range={range} crawl={data.crawl} said={said} back={back} />
      </Grid>
    </>
  );
}
