import type { Reading } from "@/contract/common";
import type { DeployRow, DeployState, EndpointRow, JobRow } from "@/contract/health";
import { Spark } from "@/components/charts";
import { Badge } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon, type IconName } from "@/components/ui/icons";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { StatusDot } from "@/components/ui/StatusDot";
import { Table } from "@/components/ui/Table";
import { Tooltip } from "@/components/ui/Tooltip";
import { ago, clock, DASH, fullDate, num } from "@/lib/format";

/* A row's last column (a link out, a chevron): the icon and the panel's right padding, nothing more. */
const GO_COLUMN = "var(--x40)";

/* ---------- Endpoint health ------------------------------------------------------- */

/**
 * The board's "API routes health". The desk calls only addresses that are
 * safe to call every two minutes, and only one of them is an API route, so
 * the panel is named for what it lists: the probed addresses.
 */
export function EndpointHealth({ reading }: { reading: Reading<EndpointRow[]> }) {
  return (
    <Card title="Endpoint health" icon="branch" flush className="dk-health-card" info="The addresses the desk checks every two minutes, over the last 24 hours. The website's own form, enquiry, booking and guide routes are never called by a robot, so they are not here; visitor traffic to any address only Vercel knows.">
      <Read reading={reading}>
        {(rows, r) => (
          <>
            <Table
              caption="Probed addresses, last 24 hours"
              rows={rows}
              rowKey={(e) => e.id}
              minWidth={420}
              className="dk-health-table"
              columns={[
                { key: "route", head: "Route", cell: (e) => <span className="dk-health-path" title={e.label}>{e.path}</span> },
                {
                  key: "status",
                  head: "Status",
                  width: "13%",
                  cell: (e) =>
                    e.status === null ? (
                      DASH
                    ) : (
                      <Tooltip text={e.expect !== 200 ? `${e.expect} is this route's healthy answer: it accepts only POST, so a GET is turned away before any of its code runs.` : e.ok ? "The newest check got the healthy answer." : `The newest check got ${e.status || "no answer"}; ${e.expect} is healthy.`}>
                        <Badge tone={e.ok ? "good" : "bad"} className="dk-health-code">
                          {e.status || "none"}
                        </Badge>
                      </Tooltip>
                    ),
                },
                { key: "avg", head: "Avg. response", width: "23%", cell: (e) => (e.avgMs === null ? DASH : `${num(e.avgMs)}ms`) },
                {
                  key: "checks",
                  head: "Checks (24h)",
                  width: "21%",
                  cell: (e) => (
                    <span className="dk-num">
                      {num(e.checks)}
                      {e.failed ? <span className="dk-health-failed"> · {num(e.failed)} failed</span> : null}
                    </span>
                  ),
                },
                { key: "spark", head: <span className="dk-sr">Response time, by hour</span>, width: "13%", align: "right", cell: (e) => <Spark data={e.spark} size="row" label={`${e.path}: response time by hour`} /> },
              ]}
            />
            <p className="dk-health-foot dk-health-foot--pad">
              <Stamp reading={r} />
            </p>
          </>
        )}
      </Read>
    </Card>
  );
}

/* ---------- Deployment history ----------------------------------------------------- */

const DEPLOY_STATE: Record<DeployState, { tone: "good" | "bad" | "quiet"; text: string }> = {
  live: { tone: "good", text: "Live" },
  answered: { tone: "good", text: "Answered" },
  failed: { tone: "bad", text: "Check failed" },
  pending: { tone: "quiet", text: "Not checked yet" },
  unchecked: { tone: "quiet", text: "Not checked" },
  before: { tone: "quiet", text: "Before checks" },
  unkept: { tone: "quiet", text: "Checks not kept" },
};

const when = (isoTime: string): string => `${clock(isoTime)} on ${fullDate(isoTime)}`;

/** What stands behind a row's status, in words: the check, and from when a check counted for the commit. */
export function deployTip(d: DeployRow): string {
  const check = d.check ? `The home page answered ${d.check.status || "nothing"} at ${when(d.check.at)}.` : "";
  const from = `Checks count for it from ${when(d.checkFrom)}: three minutes after the desk saw it, so Vercel's build has had time.`;
  const vercel = "Whether Vercel's build of it succeeded only Vercel knows.";
  switch (d.state) {
    case "live":
      return `${check} ${from} This is the newest commit on main. ${vercel}`;
    case "answered":
      return `${check} The first check that counted for this commit, before the next one. ${vercel}`;
    case "failed":
      return `${check} The first check that counted for this commit failed.`;
    case "pending":
      return `No check counts for it yet. ${from} The desk checks every two minutes.`;
    case "unchecked":
      return `No check counted for it. ${from} The next commit came before one ran.`;
    case "unkept":
      return "The desk keeps its checks for 35 days; those from this commit's time are gone.";
    default:
      return "The next commit came before the desk's first check ever, so nothing could be verified about this one.";
  }
}

/**
 * Commits on main as a table: the version (short sha), the environment, what
 * the desk verified, the age, and the commit on GitHub. `subjects` adds the
 * commit's subject as its own column, where there is room (the full list).
 */
export function DeployTable({ rows, caption, subjects }: { rows: readonly DeployRow[]; caption: string; subjects?: boolean }) {
  return (
    <Table
      caption={caption}
      rows={rows}
      rowKey={(d) => d.sha}
      minWidth={subjects ? 720 : 420}
      className="dk-health-table"
      empty="No commit recorded on main yet."
      columns={[
        {
          key: "version",
          head: "Version",
          /* Seven characters of mono type and the cell's padding, whatever the table's width. */
          width: subjects ? "calc(var(--x56) + var(--x32))" : "18%",
          cell: (d) =>
            subjects ? (
              <span className="dk-health-mono">{d.short}</span>
            ) : (
              <Tooltip text={d.subject}>
                <span className="dk-health-mono">{d.short}</span>
              </Tooltip>
            ),
        },
        ...(subjects ? [{ key: "subject", head: "Change", width: "40%", cell: (d: DeployRow) => <span className="dk-health-subject" title={d.subject}>{d.subject}</span> }] : []),
        { key: "env", head: "Environment", cell: () => "Production" },
        {
          key: "status",
          head: "Status",
          width: subjects ? "15%" : "27%",
          cell: (d) => (
            <Tooltip text={deployTip(d)}>
              <StatusDot tone={DEPLOY_STATE[d.state].tone}>{DEPLOY_STATE[d.state].text}</StatusDot>
            </Tooltip>
          ),
        },
        {
          key: "at",
          head: "Deployed",
          width: subjects ? "14%" : "21%",
          cell: (d) => (
            <time dateTime={d.at} suppressHydrationWarning title={`Committed ${when(d.at)}`}>
              {ago(d.at)}
            </time>
          ),
        },
        {
          key: "go",
          head: <span className="dk-sr">On GitHub</span>,
          width: GO_COLUMN,
          align: "right",
          cell: (d) =>
            d.url ? (
              <Go href={d.url} className="dk-health-iconlink" aria-label={`${d.short} on GitHub (opens for people with access to the repository)`} title="On GitHub: the repository is private and opens for people with access.">
                <Icon name="external" size={15} />
              </Go>
            ) : null,
        },
      ]}
    />
  );
}

/** Commits on main: every push there is a production build on Vercel. The status is only what the desk verified. */
export function DeploymentHistory({ reading }: { reading: Reading<DeployRow[]> }) {
  return (
    <Card
      title="Deployment history"
      icon="package"
      flush
      className="dk-health-card"
      right={
        <LinkButton href="/site-health/deployments" size="xs">
          View all
        </LinkButton>
      }
    >
      <Read reading={reading}>
        {(rows, r) => (
          <>
            <DeployTable rows={rows} caption="Commits to the website's main branch" />
            <p className="dk-health-foot dk-health-foot--pad">
              <Stamp reading={r} />
            </p>
          </>
        )}
      </Read>
    </Card>
  );
}

/* ---------- Background jobs & automations -------------------------------------------- */

const JOB_ICON: Record<string, IconName> = {
  probe: "heart-pulse",
  repo: "branch",
  sitemap: "sitemap",
  crawl: "globe",
  assets: "image",
  speed: "gauge",
  "ga4-live": "pulse",
  "ga4-warm": "bar-chart",
};

function jobState(j: JobRow): { tone: "good" | "bad" | "warn" | "info" | "quiet"; text: string } {
  if (!j.ready) return { tone: "quiet", text: "Not connected" };
  if (!j.enabled) return { tone: "quiet", text: "Switched off" };
  if (j.running) return { tone: "info", text: j.progress ? `Running ${j.progress.done}/${j.progress.of}` : "Running" };
  if (j.lastOk === true) return { tone: "good", text: "Success" };
  if (j.lastOk === false) return { tone: "bad", text: "Failed" };
  return { tone: "quiet", text: "Not run yet" };
}

/** The desk's scheduler: what each job last did and when it runs next. Each row opens Automations. */
export function BackgroundJobs({ reading }: { reading: Reading<JobRow[]> }) {
  return (
    <Card
      title="Background jobs & automations"
      icon="bolt"
      flush
      className="dk-health-card"
      right={
        <LinkButton href="/automations" size="xs">
          View all
        </LinkButton>
      }
    >
      <Read reading={reading}>
        {(rows, r) => (
          <>
            <Table
              caption="Scheduled jobs"
              rows={rows.slice(0, 6)}
              rowKey={(j) => j.name}
              rowHref={() => "/automations"}
              minWidth={460}
              className="dk-health-table dk-health-jobs"
              columns={[
                {
                  key: "job",
                  head: "Job",
                  cell: (j) => (
                    <span className="dk-health-job">
                      <Icon name={JOB_ICON[j.name] ?? "clock"} size={15} />
                      {/* Above the row's link layer, so the full name shows on hover; a click still opens the row. */}
                      <span className="dk-health-job-name" title={j.title}>
                        {j.title}
                      </span>
                    </span>
                  ),
                },
                {
                  key: "status",
                  head: "Status",
                  width: "18%",
                  cell: (j) => {
                    const s = jobState(j);
                    const dot = <StatusDot tone={s.tone}>{s.text}</StatusDot>;
                    return j.lastNote ? <Tooltip text={`Last run: ${j.lastNote}`}>{dot}</Tooltip> : dot;
                  },
                },
                {
                  key: "last",
                  head: "Last run",
                  width: "17%",
                  cell: (j) =>
                    j.lastStart ? (
                      <time dateTime={j.lastStart} suppressHydrationWarning>
                        {ago(j.lastStart)}
                      </time>
                    ) : (
                      DASH
                    ),
                },
                {
                  key: "next",
                  head: "Next run",
                  width: "18%",
                  cell: (j) =>
                    j.nextRun ? (
                      <time dateTime={j.nextRun} suppressHydrationWarning>
                        {Date.parse(j.nextRun) <= Date.now() ? "due now" : ago(j.nextRun)}
                      </time>
                    ) : (
                      DASH
                    ),
                },
                { key: "go", head: <span className="dk-sr">Open</span>, width: GO_COLUMN, align: "right", cell: () => <Icon name="chevron-right" size={14} className="dk-health-chev" /> },
              ]}
            />
            <p className="dk-health-foot dk-health-foot--pad">
              <Stamp reading={r} />
              <span className="dk-health-since">{rows.length > 6 ? `6 of ${rows.length} jobs` : `${rows.length} jobs`}</span>
            </p>
          </>
        )}
      </Read>
    </Card>
  );
}
