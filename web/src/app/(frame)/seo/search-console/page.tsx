import { ConsoleOverview } from "@/components/seo/ConsoleOverview";
import { RankingTrend } from "@/components/seo/RankingTrend";
import { Landing } from "@/components/seo/Landing";
import { seoPayload, type Search } from "@/components/seo/interim";
import "@/components/seo/seo.css";
import "@/components/seo/interim.css";

export const metadata = { title: "Search Console · SEO" };

/**
 * SEO › Search Console. The head and the tab strip come from the SEO layout; this
 * page draws the real panels of the SEO screen that belong here, each from its
 * own reading, until the page built to its board replaces it.
 */
export default async function SeoSearchConsolePage({ searchParams }: { searchParams: Search }) {
  const { data, qs } = await seoPayload(searchParams);
  return (
    <div className="dk-seo-stack">
        <ConsoleOverview reading={data.console} className="dk-seo-panel" />
        <div className="dk-seo-pair">
          <RankingTrend reading={data.ranking} className="dk-seo-panel" />
          <Landing reading={data.landing} qs={qs} className="dk-seo-panel" />
        </div>
    </div>
  );
}
