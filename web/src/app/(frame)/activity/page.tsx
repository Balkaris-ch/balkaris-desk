import type { ActivityItem } from "@/contract/common";
import { PageHead } from "@/components/shell/PageHead";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Timeline } from "@/components/ui/Timeline";
import { activityRows } from "@/components/overview/Activity";
import { api } from "@/lib/api";
import { clock, fullDate } from "@/lib/format";
import "@/components/overview/overview.css";

export const metadata = { title: "Recent activity" };

/**
 * Everything the desk recorded about the website, newest first: the full list
 * behind the Command Center's "Recent activity". The latest hundred rows of
 * the activity log (GET /api/v1/activity), each with its date.
 */
export default async function ActivityPage() {
  const items = await api<ActivityItem[]>("/api/v1/activity", { limit: 100 });
  /* The clock in the time column and the day under the text: a long list spans many days. */
  const rows = activityRows(items).map((row, i) => ({ ...row, time: clock(items[i]!.at), detail: fullDate(items[i]!.at) }));

  return (
    <>
      <PageHead eyebrow="Command Center" title="Recent activity" subtitle="Everything the desk has recorded: deployments, published insights, sitemap and crawl changes, incidents and changes made in the desk, newest first." />
      <Card title="Activity" icon="pulse" count={items.length} sub={items.length === 100 ? "The latest hundred." : undefined}>
        {rows.length ? (
          <Timeline label="Recent activity" items={rows} />
        ) : (
          <Empty icon="clock" title="Nothing recorded yet">
            The desk writes a row here when the website is deployed, an insight is published, the sitemap or a page changes, or the site stops answering.
          </Empty>
        )}
      </Card>
    </>
  );
}
