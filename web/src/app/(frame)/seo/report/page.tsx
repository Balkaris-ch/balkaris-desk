import type { SeoReport } from "@/contract/seo";
import { api } from "@/lib/api";
import { ReportView } from "@/components/seo/ReportView";
import "@/components/seo/seo.css";

export const metadata = { title: "Full report · SEO" };

/**
 * "View full report": every finding of the desk's last crawl, by check (in the
 * order of the earlier SEO screen's Indexation & technical panel, then the
 * rest) and by rule, each with what was measured and the limit it was held
 * against. Technical's long form: it has the SEO head with Technical lit and
 * a breadcrumb back to it (components/seo/nav/pages.ts, LISTS), so no head of
 * its own; nothing on it follows the period, so the head draws none.
 */
export default async function SeoReportPage() {
  const report = await api<SeoReport>("/api/v1/seo/report");
  return <ReportView report={report} />;
}
