import { SpecimenRibbon } from "@/components/seo/bits";
import { ContentGaps } from "@/components/seo/ContentGaps";
import { ConsoleOverview } from "@/components/seo/ConsoleOverview";
import { KeywordOpportunities } from "@/components/seo/KeywordOpportunities";
import { Landing } from "@/components/seo/Landing";
import { Movements } from "@/components/seo/Movements";
import { OpenQuery } from "@/components/seo/OpenQuery";
import { QuickActions } from "@/components/seo/QuickActions";
import { RankingTrend } from "@/components/seo/RankingTrend";
import { SeoTiles } from "@/components/seo/SeoTiles";
import { TechChecks } from "@/components/seo/TechChecks";
import { seoPayload, type Search } from "@/components/seo/interim";
import "@/components/seo/seo.css";

export const metadata = { title: "Overview · SEO" };

/**
 * SEO › Overview. The head and the tab strip come from the SEO layout; this
 * page draws every panel of the SEO screen, each from its own reading, until
 * the Overview built to its board replaces it.
 */
export default async function SeoOverviewPage({ searchParams }: { searchParams: Search }) {
  const { data, qs } = await seoPayload(searchParams);
  return (
    <>
      {data.specimen ? <SpecimenRibbon realHref="/seo" /> : null}
      {data.open ? <OpenQuery open={data.open} closeHref="/seo" /> : null}
      <SeoTiles data={data} />
      <div className="dk-seo-board">
        <div className="dk-seo-grid">
          <RankingTrend reading={data.ranking} className="dk-seo-panel dk-seo-a-trend" />
          <KeywordOpportunities reading={data.opportunities} qs={qs} className="dk-seo-panel dk-seo-a-kw" />
          <ContentGaps reading={data.gaps} qs={qs} className="dk-seo-panel dk-seo-a-gap" />
          <TechChecks checks={data.checks} className="dk-seo-panel dk-seo-a-tech" />
          <ConsoleOverview reading={data.console} className="dk-seo-panel dk-seo-a-sc" />
          <Movements reading={data.movements} qs={qs} className="dk-seo-panel dk-seo-a-move" />
          <Landing reading={data.landing} qs={qs} className="dk-seo-panel dk-seo-a-land" />
          <QuickActions audit={data.audit} rules={data.scoreRule?.rules ?? null} className="dk-seo-panel dk-seo-a-quick" />
        </div>
      </div>
    </>
  );
}
