import type { ReactNode } from "react";
import type { Reading } from "@/contract/common";
import type { AttackStatus, BuildRow, DashboardLink, DomainRow, PlatformStatus, ProductionNow } from "@/contract/hosting";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { StatusDot } from "@/components/ui/StatusDot";
import { Table } from "@/components/ui/Table";
import { Tooltip } from "@/components/ui/Tooltip";
import { ago, clock, DASH, duration, fullDate } from "@/lib/format";
import { BUILD_STATE, componentTone, componentWord } from "./words";

const GO_COLUMN = "var(--x56)";

/* ---------- Production builds ---------------------------------------------------------- */

/** One build's reason for failing, in Vercel's words, for the tooltip. */
const failedWhy = (b: BuildRow): string => (b.error ? `${b.error.message ?? b.error.code ?? "Vercel gave no reason."}${b.error.step ? ` (step: ${b.error.step})` : ""}${b.error.code ? ` [${b.error.code}]` : ""}` : "");

/** The production builds Vercel lists, newest first. A failed one opens its log lines. */
export function ProductionBuilds({ reading }: { reading: Reading<BuildRow[]> }) {
  return (
    <Card title="Production builds" icon="package" flush className="dk-hosting-card" right={<Stamp reading={reading} />} info="Vercel's production deployments of the website, newest first: whether each built, how long the build took, the commit and who started it. A failed build opens its last log lines.">
      <Read reading={reading}>
        {(rows) => (
          <Table
            caption="Production builds, newest first"
            rows={rows.slice(0, 8)}
            rowKey={(b) => b.uid}
            minWidth={560}
            className="dk-hosting-table"
            empty="Vercel lists no production build for the project."
            columns={[
              {
                key: "state",
                head: "State",
                width: "21%",
                cell: (b) => {
                  const s = BUILD_STATE[b.state];
                  const dot = (
                    <StatusDot tone={s.tone}>
                      {s.text}
                      {b.current ? <span className="dk-hosting-live"> · live</span> : null}
                    </StatusDot>
                  );
                  return <Tooltip text={b.error ? failedWhy(b) : `${s.tip}${b.current ? " The production domain serves this one now." : ""}`}>{dot}</Tooltip>;
                },
              },
              { key: "took", head: "Build time", width: "14%", cell: (b) => <span className="dk-num">{b.durationMs === null ? DASH : duration(b.durationMs)}</span> },
              {
                key: "sha",
                head: "Commit",
                width: "13%",
                cell: (b) => (b.sha ? <span className="dk-hosting-mono" title={`${b.sha}${b.ref ? ` on ${b.ref}` : ""}`}>{b.sha.slice(0, 7)}</span> : DASH),
              },
              { key: "who", head: "Started by", cell: (b) => <span className="dk-hosting-cell" title={b.creator ?? ""}>{b.creator ?? DASH}</span> },
              {
                key: "age",
                head: "Created",
                width: "17%",
                cell: (b) => (
                  <time dateTime={b.createdAt} suppressHydrationWarning title={`${clock(b.createdAt)} on ${fullDate(b.createdAt)}`}>
                    {ago(b.createdAt)}
                  </time>
                ),
              },
              {
                key: "go",
                head: <span className="dk-sr">Log or Vercel</span>,
                width: GO_COLUMN,
                align: "right",
                cell: (b) =>
                  b.state === "ERROR" ? (
                    <Go href={`/hosting/builds/${b.uid}`} className="dk-hosting-loglink" title="The build's last log lines">
                      Log
                    </Go>
                  ) : b.inspectorUrl ? (
                    <Go href={b.inspectorUrl} className="dk-hosting-iconlink" aria-label="The deployment in Vercel's dashboard" title="In Vercel's dashboard">
                      <Icon name="external" size={15} />
                    </Go>
                  ) : null,
              },
            ]}
          />
        )}
      </Read>
    </Card>
  );
}

/* ---------- Production domain and firewall ------------------------------------------------ */

function KV({ k, children, tip }: { k: string; children: ReactNode; tip?: string }) {
  return (
    <div className="dk-hosting-kv">
      <dt>{tip ? <Tooltip text={tip}><span tabIndex={0}>{k}</span></Tooltip> : k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const onOff = (v: boolean | null, on: string, off: string, tone: "good" | "warn" | "quiet" = "good") =>
  v === null ? <span className="dk-hosting-quiet">Not said</span> : <StatusDot tone={v ? tone : "quiet"}>{v ? on : off}</StatusDot>;

/** What the production domain serves, the domains, and the firewall's state and last day. */
export function ProductionDomain({ production, domains, attacks }: { production: Reading<ProductionNow>; domains: Reading<DomainRow[]>; attacks: Reading<AttackStatus> }) {
  return (
    <Card title="Production domain and firewall" icon="shield" className="dk-hosting-card" right={<Stamp reading={production} />} info="From Vercel's project: the deployment production serves, its addresses, the project's domains and the firewall. Certificates and DNS, as the desk reads them from outside, are on Site Health.">
      {/* One token behind all three: when it is missing, one absent state says so. */}
      <Read reading={production}>
        {(p) => (
          <>
            <dl className="dk-hosting-kvs">
              <KV k="Serving">
                {p.readyState ? <StatusDot tone={p.readyState === "READY" ? "good" : "warn"}>{p.readyState === "READY" ? "Ready" : p.readyState}</StatusDot> : DASH}
                {p.deploymentUrl ? <span className="dk-hosting-mono dk-hosting-after">{p.deploymentUrl}</span> : null}
              </KV>
              <KV k="Addresses" tip="The addresses Vercel lists for production.">
                <span className="dk-hosting-cell" title={p.aliases.join(", ")}>
                  {p.aliases.length ? p.aliases.join(", ") : DASH}
                </span>
              </KV>
              <KV k="Paused" tip="Spend Management can pause every production deployment; then the site answers 503.">
                {p.paused === null ? <span className="dk-hosting-quiet">Not said</span> : p.paused ? <StatusDot tone="bad" tint>Paused</StatusDot> : <StatusDot tone="good">No</StatusDot>}
              </KV>
              <KV k="Firewall">{onOff(p.firewall.enabled, "On", "Off")}</KV>
              <KV k="Attack mode" tip="Vercel's Attack Challenge Mode: every visitor is challenged while it is on.">
                {p.firewall.attackMode ? <StatusDot tone="warn" tint>On{p.firewall.attackModeUntil ? ` until ${clock(p.firewall.attackModeUntil)}` : ""}</StatusDot> : onOff(p.firewall.attackMode, "On", "Off", "warn")}
              </KV>
              <KV k="Bot protection" tip="Vercel BotID on the project.">{onOff(p.firewall.botId, "On", "Off")}</KV>
            </dl>
            <p className="dk-hosting-subhead dk-hosting-subhead--gap">Anomalies, last 24 hours</p>
            <Read reading={attacks} form="inline">
              {(a) => (
                <p className="dk-hosting-line">
                  {a.total === 0 ? (
                    <StatusDot tone="good">None detected</StatusDot>
                  ) : (
                    <StatusDot tone={a.active ? "bad" : "warn"} tint>
                      {a.total} detected{a.active ? `, ${a.active} still going` : ""}
                      {a.newest ? `, newest ${ago(a.newest)}` : ""}
                    </StatusDot>
                  )}
                </p>
              )}
            </Read>
            <p className="dk-hosting-subhead dk-hosting-subhead--gap">Domains</p>
            <Read reading={domains} form="inline">
              {(list) => (
                <ul className="dk-hosting-domains">
                  {list.map((d) => (
                    <li key={d.name}>
                      <StatusDot tone={d.verified ? "good" : "bad"} title={d.verified ? "Verified" : "Not verified"} />
                      <span className="dk-hosting-cell">{d.name}</span>
                      <span className="dk-hosting-quiet">{d.redirect ? `→ ${d.redirect}${d.redirectStatus ? ` (${d.redirectStatus})` : ""}` : d.verified ? "serves" : "not verified"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Read>
          </>
        )}
      </Read>
    </Card>
  );
}

/* ---------- Vercel's status ----------------------------------------------------------------- */

/** The parts of Vercel this site stands on, by component id, and the incidents on Vercel's page. */
export function PlatformPanel({ reading }: { reading: Reading<PlatformStatus> }) {
  return (
    <Card
      title="Vercel platform status"
      icon="cloud"
      className="dk-hosting-card"
      right={
        <>
          <Stamp reading={reading} />
          <Go href="https://www.vercel-status.com" className="dk-hosting-iconlink" aria-label="Vercel's status page">
            <Icon name="external" size={15} />
          </Go>
        </>
      }
    >
      <Read reading={reading}>
        {(p) => (
          <>
            <ul className="dk-hosting-parts">
              {p.components.map((c) => (
                <li key={c.id}>
                  <Tooltip text={c.why}>
                    <span className="dk-hosting-cell" tabIndex={0}>
                      {c.name}
                    </span>
                  </Tooltip>
                  <StatusDot tone={componentTone(c.status)} tint={componentTone(c.status) !== "good"}>
                    {componentWord(c.status)}
                  </StatusDot>
                </li>
              ))}
            </ul>
            <p className="dk-hosting-subhead dk-hosting-subhead--gap">Unresolved incidents</p>
            {p.incidents.length ? (
              <ul className="dk-hosting-incidents">
                {p.incidents.slice(0, 4).map((i) => (
                  <li key={i.id}>
                    <Badge tone={i.touches.length ? (i.impact === "major" || i.impact === "critical" ? "bad" : "warn") : "quiet"}>{i.touches.length ? "Ours" : "Other"}</Badge>
                    {i.link ? (
                      <Go href={i.link} className="dk-hosting-cell dk-hosting-incident" title={`${i.name}: ${i.status}, impact ${i.impact}${i.touches.length ? `. Touches ${i.touches.join(", ")}` : ""}`}>
                        {i.name}
                      </Go>
                    ) : (
                      <span className="dk-hosting-cell">{i.name}</span>
                    )}
                    <span className="dk-hosting-quiet">{ago(i.startedAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dk-hosting-line">
                <StatusDot tone="good">None on the page</StatusDot>
              </p>
            )}
          </>
        )}
      </Read>
    </Card>
  );
}

/* ---------- Only in Vercel's dashboard ------------------------------------------------------ */

/** What the desk cannot read, with the way to it and the reason. */
export function DashboardOnly({ links }: { links: DashboardLink[] }) {
  return (
    <Card title="Only in Vercel's dashboard" icon="external" className="dk-hosting-card" info="Figures Vercel shows in its dashboard and offers no documented way to read for a project-scoped token. Each opens in Vercel.">
      <ul className="dk-hosting-dash">
        {links.map((l) => (
          <li key={l.key}>
            <Go href={l.href} className="dk-hosting-dash-link">
              <span>{l.label}</span>
              <Icon name="external" size={13} />
            </Go>
            <p className="dk-hosting-dash-why">{l.why}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
