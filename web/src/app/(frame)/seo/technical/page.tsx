import { TechChecks } from "@/components/seo/TechChecks";
import { QuickActions } from "@/components/seo/QuickActions";
import { seoPayload, type Search } from "@/components/seo/interim";
import "@/components/seo/seo.css";
import "@/components/seo/interim.css";

export const metadata = { title: "Technical · SEO" };

/**
 * SEO › Technical. The head and the tab strip come from the SEO layout; this
 * page draws the real panels of the SEO screen that belong here, each from its
 * own reading, until the page built to its board replaces it.
 */
export default async function SeoTechnicalPage({ searchParams }: { searchParams: Search }) {
  const { data, qs } = await seoPayload(searchParams);
  return (
    <div className="dk-seo-stack">
        <div className="dk-seo-pair">
          <TechChecks checks={data.checks} className="dk-seo-panel" />
          <QuickActions audit={data.audit} rules={data.scoreRule?.rules ?? null} className="dk-seo-panel" />
        </div>
    </div>
  );
}
