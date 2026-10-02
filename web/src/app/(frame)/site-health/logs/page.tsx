import type { HealthLogs } from "@/contract/health";
import { PageHead } from "@/components/shell/PageHead";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Select } from "@/components/ui/Select";
import { activityItems, Timeline } from "@/components/ui/Timeline";
import { api } from "@/lib/api";
import { num } from "@/lib/format";
import "@/components/health/health.css";

export const metadata = { title: "Incidents & logs · Site Health" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** What each kind of row is, as the filter names it. */
const KIND_LABEL: Record<string, string> = {
  incident: "Incidents",
  probe: "The function probe",
  deploy: "Deployments",
  sitemap: "Sitemap changes",
  crawl: "Crawls",
  automation: "Automations",
  job: "Failed jobs",
};
const label = (kind: string): string => KIND_LABEL[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);

/**
 * Site Health's "View all" and "View logs": everything "Recent incidents &
 * logs" draws from, newest first, one kind at a time if asked (?kind=). The
 * activity log's rows about the website and the desk's failed scheduled runs;
 * the desk's other activity is on Recent activity. One request.
 */
export default async function HealthLogsPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const data = await api<HealthLogs>("/api/v1/health/logs", { kind: one(q.kind), limit: 200 });
  const total = data.kinds.reduce((a, k) => a + k.n, 0);
  const options = [{ value: "", label: `Everything (${num(total)})` }, ...data.kinds.map((k) => ({ value: k.kind, label: `${label(k.kind)} (${num(k.n)})` }))];

  return (
    <>
      <PageHead
        eyebrow="Site Health"
        title="Incidents & logs"
        subtitle="Incidents, deployments, sitemap changes, crawls, automations and failed jobs, newest first. Failed jobs are kept a week."
        action={
          <LinkButton href="/site-health" size="md" icon="arrow-left">
            Site Health
          </LinkButton>
        }
      />
      <Card
        title={data.kind ? label(data.kind) : "Everything"}
        icon="file-text"
        count={num(data.items.length)}
        right={data.kinds.length > 1 ? <Select param="kind" label="Kind" options={options} fallback="" /> : null}
        sub={data.more ? `The newest ${num(data.items.length)} rows.` : undefined}
      >
        {data.items.length ? (
          <Timeline items={activityItems(data.items)} label="Incidents and logs" />
        ) : (
          <Empty title="Nothing in the log yet">The desk writes here when something happens to the website: an incident, a deployment, a sitemap change, a crawl, a failed job.</Empty>
        )}
      </Card>
    </>
  );
}
