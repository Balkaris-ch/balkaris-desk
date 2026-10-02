import { redirect } from "next/navigation";
import type { SeoAutomationsPayload } from "@/contract/seo/automations";
import { ask, me } from "@/lib/api";
import { parseRange } from "@/lib/format";
import { Watch } from "@/components/automations/Watch";
import { Browser } from "@/components/seo/automations/Browser";
import { JobTable } from "@/components/seo/automations/JobTable";
import { Recent } from "@/components/seo/automations/Recent";
import { Split } from "@/components/seo/automations/Split";
import { AutomationTiles } from "@/components/seo/automations/Tiles";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Grid } from "@/components/ui/Grid";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import "@/components/seo/automations/automations.css";

export const metadata = { title: "Automations · SEO" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * SEO › Automations (board 113, panel 9): the jobs the SEO section runs on,
 * with their schedule, last run, next run and status, Run now for anybody
 * signed in and the on/off switch for the owner; then, stated plainly, what
 * the SEO tools do by themselves, what waits for a person's approval and
 * what only a person can do. The head and the tabs come from the SEO layout
 * (app/(frame)/seo/layout.tsx).
 *
 * One request draws it (GET /api/v1/seo/automations, contract/seo/
 * automations.ts). The page keeps itself current: every four seconds while a
 * job runs or was just asked for, once a minute otherwise (the desk-wide
 * Automations screen's Watch), all from the desk's own database.
 */
export default async function SeoAutomationsPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const range = parseRange(q.range);
  const [answer, who] = await Promise.all([ask<SeoAutomationsPayload>("/api/v1/seo/automations", { range }), me()]);

  if (!answer.ok) {
    if (answer.kind === "signed-out") redirect("/auth/google");
    return (
      <Card title="Automations" icon="clock">
        <Empty icon="alert" title="The SEO automations could not be read">
          {answer.kind === "missing" ? "This desk has no SEO Automations address yet: its server code is not mounted." : answer.message} Every job is also on the desk-wide Automations screen.
        </Empty>
      </Card>
    );
  }

  const d = answer.value;
  return (
    <div className="dk-seo-automations">
      <Watch busy={d.running > 0} />
      <AutomationTiles d={d} />

      <Card
        title="SEO automations"
        icon="clock"
        count={d.jobs.length || undefined}
        sub="The desk’s scheduler runs them one at a time. View opens what a job reads, what it writes and its last runs."
        right={
          <span className="dk-seo-automations-card-right">
            {d.runs.state === "ok" ? <Stamp reading={d.runs} /> : null}
            <LinkButton href="/automations" size="sm" icon="layers">
              All desk automations
            </LinkButton>
          </span>
        }
        flush
      >
        {d.jobs.length ? (
          <>
            {d.runs.state !== "ok" ? <Absent reading={d.runs} form="inline" className="dk-seo-automations-runs-absent" /> : null}
            <JobTable jobs={d.jobs} runs={d.runs} owner={who.owner} at={d.head.at} />
          </>
        ) : (
          <Empty icon="alert" title="No SEO job is listed">
            {d.jobsWhy ?? "No SEO job is registered on this desk yet."}
          </Empty>
        )}
      </Card>

      <Split reading={d.split} />

      <Grid cols="1fr 1fr">
        <Browser tasks={d.chromeTasks} at={d.head.at} />
        <Recent items={d.recent} at={d.head.at} kinds={d.recentKinds} />
      </Grid>
    </div>
  );
}
