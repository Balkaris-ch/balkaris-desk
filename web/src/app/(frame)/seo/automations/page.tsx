import { redirect } from "next/navigation";
import type { SeoAutomationsPayload } from "@/contract/seo/automations";
import { ask, me } from "@/lib/api";
import { parseRange, rangeLabel } from "@/lib/format";
import { Watch } from "@/components/automations/Watch";
import { SeoRefused } from "@/components/seo/nav/Refused";
import { Browser } from "@/components/seo/automations/Browser";
import { Digest } from "@/components/seo/automations/Digest";
import { JobTable } from "@/components/seo/automations/JobTable";
import { OnTime } from "@/components/seo/automations/OnTime";
import { Period } from "@/components/seo/automations/Period";
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

/** A job's name as the address may carry it (?open=): the scheduler's names are short words and dashes. */
const JOB = /^[\w.-]{1,40}$/;

/**
 * SEO › Automations (board 113, panel 9): the jobs the SEO section runs on,
 * with their schedule, last run (and what it said), next run (and why then:
 * its regular time, a retry, a run again after a restart) and status,
 * including "Late" for a job that did not start when its time came; Run now
 * for anybody the server lets and the on/off switch for the owner. Then
 * whether the jobs are kept on time here, what they did in the head's
 * period, plainly what the SEO tools do by themselves, what waits for a
 * person's approval and what only a person can do, the steps done by hand,
 * and the log. The head and the tabs come from the SEO layout
 * (app/(frame)/seo/layout.tsx).
 *
 * One request draws it (GET /api/v1/seo/automations, contract/seo/
 * automations.ts). The address keeps the period (?range=) and the opened job
 * (?open=<job>, so the log and other tabs can link straight to one). The page
 * keeps itself current: every four seconds while a job runs or was just asked
 * for, once a minute otherwise (the desk-wide Automations screen's Watch), all
 * from the desk's own database.
 */
export default async function SeoAutomationsPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const range = parseRange(q.range);
  const rawOpen = Array.isArray(q.open) ? q.open[0] : q.open;
  const open = rawOpen && JOB.test(rawOpen) ? rawOpen : null;
  const [answer, who] = await Promise.all([ask<SeoAutomationsPayload>("/api/v1/seo/automations", { range }), me()]);

  if (!answer.ok) {
    if (answer.kind === "signed-out") redirect("/auth/google");
    /* A page the owner has not given this person: the server did answer, with a refusal, and the gate says so. */
    if (answer.kind === "forbidden") return <SeoRefused message={answer.message} />;
    return (
      <Card title="Automations" icon="clock">
        <Empty icon="alert" title="The SEO automations could not be read">
          {answer.kind === "missing" ? "This desk has no SEO Automations address yet: its server code is not mounted." : answer.message} Every job is also on the desk-wide Automations screen.
        </Empty>
      </Card>
    );
  }

  const d = answer.value;
  const seoRange = d.head.range;
  /* "Write it now" on the summary is Run now on its job, offered when the job's row would offer it. */
  const digestRow = d.runs.state === "ok" ? d.runs.value["seo-digest"] : undefined;
  const digestAskable = !!digestRow?.askableFrom && Date.parse(digestRow.askableFrom) <= Date.parse(d.head.at);
  return (
    <div className="dk-seo-automations">
      <Watch busy={d.running > 0} />
      <AutomationTiles d={d} />

      <Card
        title="SEO automations"
        icon="clock"
        count={d.jobs.length || undefined}
        sub="The desk’s scheduler runs them one at a time. View opens what a job reads, writes and found, when it runs next and why, and its last runs."
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
            <JobTable jobs={d.jobs} runs={d.runs} owner={who.owner} at={d.head.at} scheduler={d.scheduler} open={open} periodLabel={rangeLabel(seoRange)} />
          </>
        ) : (
          <Empty icon="alert" title="No SEO job is listed">
            {d.jobsWhy ?? "No SEO job is registered on this desk yet."}
          </Empty>
        )}
      </Card>

      <Grid cols="1fr 1fr">
        <Period reading={d.period} range={seoRange} at={d.head.at} logLines={d.recentInPeriod} />
        <OnTime scheduler={d.scheduler} at={d.head.at} range={seoRange} />
      </Grid>

      <Digest reading={d.digest} owner={who.owner} at={d.head.at} canAsk={digestAskable} />

      <Split reading={d.split} />

      <Grid cols="1fr 1fr">
        <Browser tasks={d.chromeTasks} at={d.head.at} links={d.stepLinks ?? {}} />
        <Recent items={d.recent} at={d.head.at} kinds={d.recentKinds} total={d.recentInPeriod} period={rangeLabel(seoRange)} />
      </Grid>
    </div>
  );
}
