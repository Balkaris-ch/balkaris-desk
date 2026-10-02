import type { SeoReport } from "@/contract/seo";
import { api } from "@/lib/api";
import { PageHead } from "@/components/shell/PageHead";
import { LinkButton } from "@/components/ui/Button";
import { ReportView } from "@/components/seo/ReportView";
import "@/components/seo/seo.css";

export const metadata = { title: "SEO report" };

/**
 * "View full report": every finding of the desk's last crawl, by check (in the
 * order of the SEO screen's Indexation & technical panel, then the rest) and
 * by rule, each with what was measured and the limit it was held against.
 */
export default async function SeoReportPage() {
  const report = await api<SeoReport>("/api/v1/seo/report");
  return (
    <>
      <PageHead
        eyebrow="SEO"
        title="Full report"
        subtitle="Every finding of the desk’s last crawl, by check and by rule, with what was measured and the limit it was held against."
        action={
          <LinkButton href="/seo" size="sm" icon="arrow-left">
            SEO
          </LinkButton>
        }
      />
      <ReportView report={report} />
    </>
  );
}
