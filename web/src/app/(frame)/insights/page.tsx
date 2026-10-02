import type { InsightRow, InsightsPayload, InsightStatus, InsightTab } from "@/contract/insights";
import { PageHead } from "@/components/shell/PageHead";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { CalendarPanel } from "@/components/insights/CalendarPanel";
import { CreateInsight } from "@/components/insights/CreateInsight";
import { hrefOf, viewOf, type View } from "@/components/insights/href";
import { InboxPanel } from "@/components/insights/InboxPanel";
import { InsightsTable } from "@/components/insights/InsightsTable";
import { InsightTiles } from "@/components/insights/InsightTiles";
import { OpportunitiesPanel } from "@/components/insights/OpportunitiesPanel";
import { PerformancePanel } from "@/components/insights/PerformancePanel";
import { QuickActions, RecommendationsPanel } from "@/components/insights/RecommendationsPanel";
import { TopPanel } from "@/components/insights/TopPanel";
import { TrafficPanel } from "@/components/insights/TrafficPanel";
import { api } from "@/lib/api";
import { parseRange } from "@/lib/format";
import "@/components/insights/insights.css";

export const metadata = { title: "Insights" };

const TABS: InsightTab[] = ["radar", "inbox", "drafts", "review", "published", "performance", "opportunities", "archive"];

/** Which statuses each filtering tab holds. */
const TAB_STATUS: Partial<Record<InsightTab, InsightStatus[]>> = {
  inbox: ["writing", "toread", "stuck"],
  drafts: ["draft"],
  review: ["review"],
  published: ["published"],
  archive: ["archived"],
};

const TAB_TITLE: Partial<Record<InsightTab, string>> = { inbox: "Inbox", drafts: "Drafts", review: "In review", published: "Published", archive: "Archive" };

const TAB_EMPTY: Partial<Record<InsightTab, string>> = {
  inbox: "Every shared link has been written.",
  drafts: "No draft is waiting: everything written is on the site.",
  review: "Nothing is live and unlisted.",
  published: "No article is published yet.",
  archive: "Nothing has been taken off the site or deleted.",
};

/** On the overview the table shows this many rows until it is asked for all of them: the board's eight. */
const RADAR_ROWS = 8;

function filtered(rows: InsightRow[], view: View, statuses: InsightStatus[] | undefined): InsightRow[] {
  const words = (view.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (statuses && !statuses.includes(r.status)) return false;
    if (!statuses && view.status && r.status !== view.status) return false;
    if (view.category && r.category?.id !== view.category) return false;
    if (words.length) {
      const hay = `${r.title} ${r.source.label} ${r.category?.label ?? ""} ${r.handle ?? ""} ${r.path ?? ""}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

/**
 * Insights: the desk's queue and the articles it put on balkaris.ch, beside
 * what GA4, Search Console and the crawl say about them. One request to the
 * desk server; every tab and filter is an address.
 */
export default async function InsightsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const view = viewOf(await searchParams);
  const tab: InsightTab = TABS.includes(view.tab as InsightTab) ? (view.tab as InsightTab) : "radar";
  const range = parseRange(view.range);
  const data = await api<InsightsPayload>("/api/v1/insights", { range, month: view.month, source: view.source, type: view.type, specimen: view.specimen });

  const c = data.counts;
  const tabs: TabItem[] = [
    { key: "radar", label: "Radar", icon: "pulse", href: hrefOf(view, { tab: undefined }) },
    { key: "inbox", label: "Inbox", count: c.inbox, countTone: c.inbox > 0 ? "bad" : "quiet", href: hrefOf(view, { tab: "inbox", status: undefined }) },
    { key: "drafts", label: "Drafts", count: c.drafts, href: hrefOf(view, { tab: "drafts", status: undefined }) },
    { key: "review", label: "Review", count: c.review, href: hrefOf(view, { tab: "review", status: undefined }) },
    { key: "published", label: "Published", href: hrefOf(view, { tab: "published", status: undefined }) },
    { key: "performance", label: "Performance", href: hrefOf(view, { tab: "performance" }) },
    { key: "opportunities", label: "Opportunities", count: c.opportunities, href: hrefOf(view, { tab: "opportunities" }) },
    { key: "archive", label: "Archive", href: hrefOf(view, { tab: "archive", status: undefined }) },
  ];

  const categories = [...new Map(data.table.rows.filter((r) => r.category).map((r) => [r.category!.id, r.category!.label])).entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const statuses = TAB_STATUS[tab];
  const rows = filtered(data.table.rows, view, statuses);
  const narrowed = Boolean(view.q || view.status || view.category);

  return (
    <div className="dk-insights">
      <PageHead
        eyebrow="Insights"
        title="Insights"
        subtitle="Plan, create and grow content that drives traffic, leads and business for balkaris.ch."
        action={data.state.canCreate ? <CreateInsight initial={data.state} /> : undefined}
      />

      {data.specimen ? (
        <p className="dk-insights-specimen" role="note">
          <b>Specimen data.</b> The Search Console figures on this screen (CTR, keywords, opportunities) are made up, to show the connected state. Only a workstation copy of the
          desk can show this.
        </p>
      ) : null}

      <InsightTiles tiles={data.tiles} />

      <Tabs items={tabs} active={tab} label="Insight views" className="dk-insights-tabs" />

      {tab === "radar" ? (
        <div className="dk-insights-radar">
          <div className="dk-insights-main">
            <div className="dk-insights-row1">
              <TrafficPanel data={data} />
              <TopPanel data={data} view={view} />
            </div>
            <div className="dk-insights-row2">
              <InboxPanel data={data} view={view} />
              <InsightsTable
                className="dk-insights-all"
                title="All insights"
                total={data.table.rows.length}
                rows={narrowed || view.rows === "all" ? rows : rows.slice(0, RADAR_ROWS)}
                ga4={data.table.ga4}
                gsc={data.table.gsc}
                searchEarly={data.table.searchEarly}
                conversionsRead={data.table.conversionsRead}
                categories={categories}
                statusFilter
                narrow
                asOf={data.table.asOf}
                empty={narrowed ? "Nothing matches the search and filters." : "Nothing shared yet. Send the bot a link, or use Create insight."}
                more={
                  !narrowed && rows.length > RADAR_ROWS
                    ? view.rows === "all"
                      ? { href: hrefOf(view, { rows: undefined }), label: `Show the first ${RADAR_ROWS}` }
                      : { href: hrefOf(view, { rows: "all" }), label: `Show all ${rows.length}` }
                    : undefined
                }
              />
            </div>
          </div>
          <div className="dk-insights-side">
            <CalendarPanel data={data} view={view} />
            <RecommendationsPanel data={data} view={view} />
            <QuickActions view={view} canCreate={data.state.canCreate} drafts={c.drafts} />
          </div>
        </div>
      ) : tab === "performance" ? (
        <PerformancePanel data={data} rows={filtered(data.table.rows, view, ["published", "review"])} />
      ) : tab === "opportunities" ? (
        <OpportunitiesPanel data={data} />
      ) : (
        <InsightsTable
          title={TAB_TITLE[tab] ?? "Insights"}
          total={data.table.rows.filter((r) => statuses?.includes(r.status)).length}
          rows={rows}
          ga4={data.table.ga4}
          gsc={data.table.gsc}
          searchEarly={data.table.searchEarly}
          conversionsRead={data.table.conversionsRead}
          columns={tab === "review" || tab === "published" ? "site" : "queue"}
          why={tab === "inbox"}
          categories={categories}
          statusFilter={false}
          asOf={data.table.asOf}
          empty={narrowed ? "Nothing matches the search and filters." : (TAB_EMPTY[tab] ?? "Nothing here.")}
        />
      )}
    </div>
  );
}
