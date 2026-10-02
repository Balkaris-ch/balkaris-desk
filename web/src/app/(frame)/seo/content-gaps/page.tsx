import { ContentGaps } from "@/components/seo/ContentGaps";
import { KeywordOpportunities } from "@/components/seo/KeywordOpportunities";
import { seoPayload, type Search } from "@/components/seo/interim";
import "@/components/seo/seo.css";
import "@/components/seo/interim.css";

export const metadata = { title: "Content Gaps · SEO" };

/**
 * SEO › Content Gaps. The head and the tab strip come from the SEO layout; this
 * page draws the real panels of the SEO screen that belong here, each from its
 * own reading, until the page built to its board replaces it.
 */
export default async function SeoContentGapsPage({ searchParams }: { searchParams: Search }) {
  const { data, qs } = await seoPayload(searchParams);
  return (
    <div className="dk-seo-stack">
        <div className="dk-seo-pair">
          <ContentGaps reading={data.gaps} qs={qs} className="dk-seo-panel" />
          <KeywordOpportunities reading={data.opportunities} qs={qs} className="dk-seo-panel" />
        </div>
    </div>
  );
}
