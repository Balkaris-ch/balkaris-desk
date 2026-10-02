import type { PageViewPayload } from "@/contract/pages";
import { PageHead } from "@/components/shell/PageHead";
import { crawlSaid } from "@/components/pages/crawl-said";
import {
  AppearanceCard,
  DetailActions,
  DetailTiles,
  EventsCard,
  HistoryCard,
  ImagesCard,
  IssuesCard,
  LinksInCard,
  LinksOutCard,
  ResponseCard,
  SchemaCard,
  ScoreCard,
  SearchCard,
  ShareCard,
  SpecimenRibbon,
  SpeedCard,
  TrafficCard,
} from "@/components/pages/Detail";
import { Chip } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Go } from "@/components/ui/Go";
import { Grid } from "@/components/ui/Grid";
import { Icon } from "@/components/ui/icons";
import { StatusDot } from "@/components/ui/StatusDot";
import { Empty } from "@/components/ui/Empty";
import { Card } from "@/components/ui/Card";
import { api } from "@/lib/api";
import { parseRange } from "@/lib/format";
import "@/components/pages/pages.css";

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

const STATE = { live: { label: "Live", tone: "good" }, noindex: { label: "Noindex", tone: "quiet" }, redirect: { label: "Redirect", tone: "warn" }, error: { label: "Error", tone: "bad" } } as const;

export async function generateMetadata({ searchParams }: { searchParams: Search }) {
  const path = one((await searchParams).path);
  return { title: path ? `${path} · Pages` : "Page" };
}

/**
 * One page of the website: everything the desk knows about one address, in
 * one request (GET /api/v1/pages/view?path=). The Command Center's attention
 * rows, the SEO checks and the Pages table link here.
 */
export default async function PageViewScreen({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const asked = (one(q.path) ?? "").trim();
  const range = parseRange(q.range);

  if (!asked) {
    return (
      <>
        <PageHead eyebrow="Pages" title="One page" subtitle="Choose a page in the table to see everything the desk knows about it." />
        <Card>
          <Empty icon="pages" title="No page named" action={<LinkButton href="/pages" icon="pages">Every page</LinkButton>}>
            This screen shows one address at a time: /pages/view?path=/seo.
          </Empty>
        </Card>
      </>
    );
  }

  const specimen = one(q.specimen) === "1";
  const data = await api<PageViewPayload>("/api/v1/pages/view", { path: asked, range, ...(specimen ? { specimen: 1 } : {}) });
  const f = data.facts.state === "ok" ? data.facts.value : null;
  const url = f?.row.url ?? `https://www.balkaris.ch${data.path === "/" ? "/" : data.path}`;
  /* A code from the crawl action; anything else in the address is ignored. */
  const said = crawlSaid(one(q.crawl));
  const back = `/pages/view?${new URLSearchParams({ path: data.path, ...(range !== "30d" ? { range } : {}) }).toString()}`;

  return (
    <>
      {data.specimen ? <SpecimenRibbon /> : null}
      <PageHead
        eyebrow="Pages"
        title={f?.row.name ?? data.path}
        subtitle={
          <span className="dk-pages-sub">
            <Go href="/pages" className="dk-pages-crumb">
              <Icon name="chevron-left" size={14} />
              Pages
            </Go>
            <Go href={url}>
              {data.path}
              <Icon name="external" size={13} />
            </Go>
            {f ? (
              <>
                <StatusDot tone={STATE[f.row.state].tone} tint={f.row.state === "live"}>
                  {STATE[f.row.state].label}
                </StatusDot>
                <Chip>{f.row.typeLabel}</Chip>
              </>
            ) : null}
          </span>
        }
        ranges
        action={
          <LinkButton href={url} variant="primary" iconRight="external">
            Open live page
          </LinkButton>
        }
      />
      <DetailTiles data={data} />
      <Grid cols="1.5fr 1fr">
        <AppearanceCard facts={data.facts} />
        <ShareCard facts={data.facts} />
      </Grid>
      <Grid cols="1.5fr 1fr">
        <IssuesCard facts={data.facts} />
        <ScoreCard score={data.score} />
      </Grid>
      <Grid cols="1.5fr 1fr">
        <TrafficCard traffic={data.traffic} range={range} />
        <EventsCard events={data.events} enquiries={data.enquiries} />
      </Grid>
      <Grid cols="1fr 1fr 1fr" mid="1fr 1fr">
        <ResponseCard facts={data.facts} />
        <SchemaCard facts={data.facts} />
        <SpeedCard speed={data.speed} />
      </Grid>
      <Grid cols="1fr 1fr">
        <LinksInCard facts={data.facts} />
        <LinksOutCard facts={data.facts} />
      </Grid>
      <Grid cols="1fr 1fr">
        <ImagesCard facts={data.facts} />
        <SearchCard search={data.search} inspection={data.inspection} />
      </Grid>
      <Grid cols="1.5fr 1fr">
        <HistoryCard history={data.history} ownFiles={data.ownFiles} />
        <DetailActions path={data.path} url={url} crawl={data.crawl} said={said} back={back} />
      </Grid>
    </>
  );
}
