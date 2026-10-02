import type { ContentPayload } from "@/contract/content";
import { PageHead } from "@/components/shell/PageHead";
import { SparkBars } from "@/components/charts";
import { Grid } from "@/components/ui/Grid";
import { Icon } from "@/components/ui/icons";
import { Tile, Tiles } from "@/components/ui/Tile";
import { api } from "@/lib/api";
import {
  BingPanel,
  CoveragePanel,
  EngagementPanel,
  FreshnessPanel,
  GapsPanel,
  ImagesPanel,
  LinkingPanel,
  MetadataPanel,
  SchemaPanel,
  ThinPanel,
} from "@/components/content/panels";
import { QuickActions } from "@/components/content/QuickActions";
import { readView } from "@/components/content/view";
import "@/components/content/content.css";

export const metadata = { title: "Content" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * Content: the quality and coverage of what is written on balkaris.ch. One
 * request for the whole screen; every panel draws its own reading, so a
 * source that is not connected is an absent panel in its place, never a gap.
 */
export default async function ContentPage({ searchParams }: { searchParams: Search }) {
  const view = readView(await searchParams);
  const data = await api<ContentPayload>("/api/v1/content", { range: view.range, specimen: view.specimen ? 1 : null });
  const t = data.tiles;
  const lim = data.limits;

  return (
    <>
      <PageHead eyebrow="Content" title="Content" subtitle="Measure, fix and keep fresh everything written on balkaris.ch." ranges />

      {data.specimen ? (
        <p className="dk-content-ribbon" role="note">
          <Icon name="flask" size={16} />
          <span>
            <b>Specimen data.</b> Content gaps and Bing keyword statistics show artificial rows, to see them connected before their keys exist. Development copy only.
          </span>
        </p>
      ) : null}

      {/* The first five are read from the latest crawl alone, with no earlier figure to set them against: no change line (delta="none"), so no lone dash stands under them. */}
      <Tiles count={6}>
        <Tile label="Words on the site" reading={t.words} delta="none" info="Words of each page's own content (inside <main>, without the menu and footer), over the pages in the sitemap that answered." />
        <Tile label="Thin pages" reading={t.thin} delta="none" downIsGood info={`Pages offered to search with under ${lim.thinWords} words of their own content. The desk's yardstick; Google names no number.`} />
        <Tile label="Titles to fix" reading={t.titles} delta="none" downIsGood info={`Titles missing, over ${lim.title} characters, under ${lim.titleShort} or shared with another page.`} />
        <Tile label="Descriptions to fix" reading={t.descriptions} delta="none" downIsGood info={`Descriptions missing, over ${lim.description} characters, under ${lim.descriptionShort} or shared with another page.`} />
        <Tile
          label="Pages with FAQ data"
          reading={t.questions}
          delta="none"
          info="Pages whose structured data holds an FAQPage: questions and answers search engines can read. A questions block drawn on a page without that structured data is not counted: the crawl cannot see it."
        />
        <Tile
          label="Articles this month"
          reading={t.articles}
          info="Articles dated this month in their own files, against the same days of last month. The bars are the last six months."
          chart={(s) => <SparkBars data={s.series} label="Articles a month, the last six months" />}
        />
      </Tiles>

      <Grid cols="1.05fr 1.5fr" mid="minmax(0, 1fr)">
        <CoveragePanel reading={data.coverage} limits={lim} />
        <MetadataPanel reading={data.metadata} limits={lim} view={view} />
      </Grid>

      <Grid cols="1fr 1.3fr 1.1fr" mid="minmax(0, 0.8fr) minmax(0, 1.2fr)">
        <ThinPanel reading={data.thin} visits={data.visits} limits={lim} view={view} />
        <EngagementPanel reading={data.engagement} visits={data.visits} limits={lim} view={view} />
        <FreshnessPanel articles={data.articles} changes={data.changes} view={view} />
      </Grid>

      <Grid cols="1.25fr 1fr 1fr">
        <SchemaPanel reading={data.schema} />
        <ImagesPanel reading={data.images} view={view} />
        <LinkingPanel reading={data.linking} view={view} />
      </Grid>

      <Grid cols="1.3fr 1fr 0.85fr" mid="minmax(0, 1fr)">
        <GapsPanel reading={data.gaps} view={view} />
        <BingPanel reading={data.bing} view={view} />
        <QuickActions crawl={data.crawl} canCreate={data.canCreate} view={view} />
      </Grid>
    </>
  );
}
