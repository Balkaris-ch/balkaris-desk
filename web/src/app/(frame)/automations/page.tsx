import type { AutomationsPayload } from "@/contract/automations";
import { SparkBars } from "@/components/charts/SparkBars";
import { PageHead } from "@/components/shell/PageHead";
import { ActivityLog } from "@/components/automations/ActivityLog";
import { JobsTable } from "@/components/automations/JobsTable";
import { NextTile } from "@/components/automations/NextTile";
import { QuickActions, type Upcoming } from "@/components/automations/QuickActions";
import { RulesPanel } from "@/components/automations/RulesPanel";
import { RunnerPanel } from "@/components/automations/RunnerPanel";
import { Watch } from "@/components/automations/Watch";
import { WorkflowPanel } from "@/components/automations/WorkflowPanel";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Grid } from "@/components/ui/Grid";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Tile, Tiles } from "@/components/ui/Tile";
import { api, me } from "@/lib/api";
import "@/components/automations/automations.css";

export const metadata = { title: "Automations" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * Automations: what runs on its own. The desk's scheduled jobs, the article
 * writer on the workstation, the website's announcements to search engines,
 * the rules that raise an alert, and the log of everything that happened.
 *
 * One request for the whole screen. ?kinds= and ?tone= filter the log (the
 * "View all" links of other screens land here with them set) and ?page=
 * pages it. There is no period switch: the scheduler keeps a week of runs and
 * the tiles speak of the last 24 hours, so a 90-day range would have nothing
 * true to show.
 */
export default async function AutomationsPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const [data, who] = await Promise.all([
    api<AutomationsPayload>("/api/v1/automations", { kinds: one(q.kinds), tone: one(q.tone), page: one(q.page) }),
    me(),
  ]);

  const jobs = data.jobs.state === "ok" ? data.jobs.value : [];
  const byName = (name: string) => jobs.find((j) => j.name === name) ?? null;
  const running = jobs.filter((j) => j.running);
  const runnerBusy = data.runner.state === "ok" && data.runner.value.doing.length > 0;
  const next = data.tiles.next.state === "ok" ? { title: data.tiles.next.value.title, at: data.tiles.next.value.at } : null;
  /* The scheduler's order: the job running now, then the next five starts. */
  const upcoming: Upcoming[] = [
    ...running.filter((j) => j.lastStart).map((j) => ({ name: j.name, title: j.title, at: j.lastStart as string, running: true, paused: false })),
    ...jobs
      .filter((j) => j.enabled && !j.running && j.nextRun && (j.ready || j.state === "paused"))
      .sort((a, b) => Date.parse(a.nextRun as string) - Date.parse(b.nextRun as string))
      .slice(0, 5)
      .map((j) => ({ name: j.name, title: j.title, at: j.nextRun as string, running: false, paused: j.state === "paused" })),
  ];

  return (
    <>
      <Watch busy={running.length > 0 || runnerBusy} />
      <PageHead
        eyebrow="Automations"
        title="Automations"
        subtitle="What runs on its own: the desk's scheduled jobs, the article writer on the workstation, and the website's announcements to search engines."
      />

      <Tiles count={5}>
        <Tile
          label="Jobs"
          reading={data.tiles.jobs}
          info="Every job the desk's scheduler knows, switched on or off, connected or waiting for access."
          badge={running.length ? <Badge tone="info" dot>Running</Badge> : null}
        />
        <Tile
          label="Succeeded"
          reading={data.tiles.succeeded}
          info="Runs that finished in the last 24 hours, out of all that ran. A job that skipped because nobody was looking finished too."
          chart={(s) => <SparkBars data={s.series} label="Runs that finished, hour by hour" />}
        />
        <Tile
          label="Failed"
          reading={data.tiles.failed}
          downIsGood
          info="Runs that threw in the last 24 hours. A job waiting for a credential does not run, so it never fails; a run a restart cut off counts as neither."
          badge={data.failing ? <Badge tone="bad" dot>{data.failing} failing</Badge> : data.tiles.failed.state === "ok" ? <Badge tone="good" dot>Healthy</Badge> : null}
          chart={(s) => <SparkBars data={s.series} tone="bad" label="Runs that failed, hour by hour" />}
        />
        <Tile
          label="Waiting for a credential"
          reading={data.tiles.waiting}
          info="Jobs whose source is not connected yet: a key to create, an API to enable or an account to add. A job its source paused is not counted: it runs again by itself."
        />
        <NextTile reading={data.tiles.next} at={data.at} />
      </Tiles>

      <Card
        title="Background jobs & automations"
        icon="clock"
        count={jobs.length || undefined}
        sub="The desk's own scheduler runs them one at a time. Open a row for what it reads and its last runs."
        right={data.jobs.state === "ok" ? <Stamp reading={data.jobs} /> : null}
        flush
      >
        <Read reading={data.jobs}>{(list) => <JobsTable jobs={list} owner={who.owner} at={data.at} />}</Read>
      </Card>

      <Grid cols="1fr 1fr 1fr">
        <RunnerPanel reading={data.runner} at={data.at} />
        <WorkflowPanel reading={data.workflow} at={data.at} />
        <Card title="Quick actions" icon="bolt" sub="Ask for work ahead of the schedule">
          <QuickActions due={data.due.map((n) => byName(n)?.title ?? n)} next={next} crawl={byName("crawl")} speed={byName("speed")} upcoming={upcoming} at={data.at} />
        </Card>
      </Grid>

      <Grid cols="1.75fr 1fr" mid="minmax(0, 1fr)">
        <ActivityLog reading={data.activity} at={data.at} />
        <RulesPanel reading={data.rules} />
      </Grid>
    </>
  );
}
