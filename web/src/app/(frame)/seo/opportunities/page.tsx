import { KeywordOpportunities } from "@/components/seo/KeywordOpportunities";
import { Movements } from "@/components/seo/Movements";
import { QuickActions } from "@/components/seo/QuickActions";
import { seoPayload, type Search } from "@/components/seo/interim";
import "@/components/seo/seo.css";
import "@/components/seo/interim.css";

export const metadata = { title: "Opportunities · SEO" };

/**
 * SEO › Opportunities. The head and the tab strip come from the SEO layout; this
 * page draws the real panels of the SEO screen that belong here, each from its
 * own reading, until the page built to its board replaces it.
 */
export default async function SeoOpportunitiesPage({ searchParams }: { searchParams: Search }) {
  const { data, qs } = await seoPayload(searchParams);
  return (
    <div className="dk-seo-stack">
        <div className="dk-seo-pair">
          <KeywordOpportunities reading={data.opportunities} qs={qs} className="dk-seo-panel" />
          <Movements reading={data.movements} qs={qs} className="dk-seo-panel" />
        </div>
        <QuickActions audit={data.audit} rules={data.scoreRule?.rules ?? null} className="dk-seo-panel" />
    </div>
  );
}
