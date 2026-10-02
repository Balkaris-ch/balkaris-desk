import type { ReactNode } from "react";
import type { ActivityItem, Reading, Tone } from "@/contract/common";
import type { CheckRow, EndpointRow, Infrastructure, TechChecks } from "@/contract/health";
import { Badge } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon, type IconName } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Absent, Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { StatusDot } from "@/components/ui/StatusDot";
import { Tooltip } from "@/components/ui/Tooltip";
import { ago, bytes, duration, feedTime, percent, sourceLabel } from "@/lib/format";
import { regionName } from "./rules";

/* ---------- Technical checks -------------------------------------------------------- */

interface CheckLine {
  key: string;
  icon: IconName;
  label: string;
  reading: Reading<CheckRow>;
  /** Where the row leads, when there is somewhere to look further. */
  href?: string;
  /** A "View" link beside the value, when the row counts problems that are listed elsewhere. */
  view?: string;
}

function CheckItem({ line }: { line: CheckLine }) {
  const r = line.reading;
  const body = (
    <>
      <Icon name={line.icon} size={15} className="dk-health-check-icon" />
      <span className="dk-health-check-label">{line.label}</span>
      <span className="dk-health-check-value">
        {r.state === "ok" ? (
          <Tooltip
            text={
              <>
                {r.value.detail}
                {/* The row's own source and age: the panel's foot names each read once. */}
                <span className="dk-health-tip-stamp">
                  {sourceLabel(r.source)} · {ago(r.asOf)}
                </span>
              </>
            }
          >
            <StatusDot tone={r.value.tone} tint={r.value.tone === "warn" || r.value.tone === "bad"}>
              {r.value.value}
            </StatusDot>
          </Tooltip>
        ) : (
          <Absent reading={r} form="inline" />
        )}
      </span>
    </>
  );
  return (
    <li className="dk-health-check">
      {body}
      <span className="dk-health-check-view">
        {line.view && r.state === "ok" && "count" in r.value && (r.value as { count: number }).count > 0 ? (
          <Go href={line.view} className="dk-health-view">
            View
          </Go>
        ) : null}
      </span>
      {line.href ? (
        <Go href={line.href} className="dk-health-check-go" aria-label={`${line.label}: open`}>
          <Icon name="chevron-right" size={14} />
        </Go>
      ) : (
        <span className="dk-health-check-go" aria-hidden />
      )}
    </li>
  );
}

/**
 * Eight checks, every one read by the desk: the certificate, DNS, the sitemap
 * and robots.txt (every 15 minutes), links and redirects (the daily crawl),
 * the files in public/ (the daily asset scan). The board's "Failed forms" is
 * not among them: the desk cannot see a form fail, so the row is Redirects.
 */
export function TechnicalChecks({ checks, site }: { checks: TechChecks; site: string }) {
  const lines: CheckLine[] = [
    { key: "ssl", icon: "lock", label: "SSL certificate", reading: checks.ssl },
    { key: "dns", icon: "globe", label: "DNS health", reading: checks.dns },
    { key: "sitemap", icon: "sitemap", label: "Sitemap status", reading: checks.sitemap, href: `${site}/sitemap.xml` },
    { key: "robots", icon: "robot", label: "Robots.txt", reading: checks.robots, href: `${site}/robots.txt` },
    { key: "links", icon: "link", label: "Broken links", reading: checks.brokenLinks, href: "/seo", view: "/seo" },
    { key: "redirects", icon: "redirect", label: "Redirects", reading: checks.redirects, href: "/seo" },
    { key: "oversized", icon: "package", label: "Oversized assets", reading: checks.oversized, href: "/assets", view: "/assets" },
    { key: "alt", icon: "image", label: "Images without alt", reading: checks.missingAlt, href: "/assets", view: "/assets" },
  ];
  const all = lines.every((l) => l.reading.state === "ok" && l.reading.value.tone === "good");
  return (
    <Card title="Technical checks" icon={all ? "check-circle" : "alert"} tone={all ? "good" : "warn"} className="dk-health-card">
      <ul className="dk-health-checks">
        {lines.map((l) => (
          <CheckItem key={l.key} line={l} />
        ))}
      </ul>
      {/* One stamp per read behind the rows, named for the read: the certificate and DNS (SSL, DNS), the sitemap read (sitemap, robots.txt), the crawl (links, redirects), the asset scan (the two file rows). */}
      <p className="dk-health-foot dk-health-foot--wrap">
        <ReadStamp what="SSL & DNS read" covers="SSL certificate and DNS health" reading={checks.ssl} />
        <ReadStamp what="Sitemap read" covers="Sitemap status and Robots.txt" reading={checks.sitemap} />
        <ReadStamp what="Crawl" covers="Broken links and Redirects" reading={checks.brokenLinks} />
        <ReadStamp what="Asset scan" covers="Oversized assets and Images without alt" reading={checks.oversized} />
      </p>
    </Card>
  );
}

/**
 * A stamp named for the read it stands for ("Sitemap read · 7 min ago"), in
 * the Stamp's own quiet type; the source, the rows it covers and the caveat on
 * hover. Two reads here share a source (the sitemap read and the crawl are
 * both the desk's crawler), so the source alone would not say which age is
 * whose. Nothing when the reading has no value.
 */
function ReadStamp({ what, covers, reading }: { what: string; covers: string; reading: Reading<unknown> }) {
  if (reading.state !== "ok") return null;
  return (
    <Tooltip text={`${sourceLabel(reading.source)}: ${covers}.${reading.note ? ` ${reading.note}` : ""}`}>
      <span className="dk-stamp dk-stamp--noted">
        <span>{what}</span>
        <span aria-hidden>·</span>
        <time dateTime={reading.asOf} suppressHydrationWarning>
          {ago(reading.asOf)}
        </time>
      </span>
    </Tooltip>
  );
}

/* ---------- Infrastructure ----------------------------------------------------------- */

function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="dk-health-kv">
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Gauge({ k, value, text, label }: { k: string; value: number | null; text: ReactNode; label: string }) {
  return (
    <div className="dk-health-kv dk-health-kv--bar">
      <dt>{k}</dt>
      <dd>
        <span className="dk-health-kv-figure dk-num" title={label}>{text}</span>
        {value !== null ? <ProgressBar value={value} max={100} tone={value >= 90 ? "bad" : value >= 75 ? "warn" : "good"} label={label} /> : <span />}
      </dd>
    </div>
  );
}

/**
 * Left: what is true about the website's hosting, as seen from outside.
 * Right: the desk's OWN server, under its own heading, because Vercel's usage
 * figures need a token the desk does not have.
 */
export function InfrastructurePanel({ infra, home }: { infra: Infrastructure; home: EndpointRow | null }) {
  const answering = home?.ok === true;
  const chip = home === null ? null : answering ? <Badge tone="good" dot>Healthy</Badge> : <Badge tone="bad" dot>Not answering</Badge>;
  const site = infra.site;
  const desk = infra.desk;
  return (
    <Card
      title="Infrastructure"
      icon="server"
      className="dk-health-card"
      right={
        site.state === "ok" || chip ? (
          <>
            {/* The website's side is read from the probes: its stamp sits by the chip they decide. */}
            <Stamp reading={site} />
            {chip ? <Tooltip text={answering ? "The home page answered its newest check." : "The home page's newest check failed."}>{chip}</Tooltip> : null}
          </>
        ) : null
      }
    >
      <div className="dk-health-infra">
        <div className="dk-health-infra-col">
          <Read reading={site} form="panel">
            {(s) => (
              <>
                <dl className="dk-health-kvs">
                  <KV k="Hosting">{s.hosting ?? "Not seen in the answers"}</KV>
                  <KV k="Edge region">{regionName(s.edgeRegion) ?? "—"}</KV>
                  <KV k="Function region">{regionName(s.functionRegion) ?? "—"}</KV>
                  <KV k="Runtime">{s.next?.installed ? `Next.js ${s.next.installed}` : s.next?.declared ? `Next.js ${s.next.declared}` : "—"}</KV>
                  <KV k="Node.js">{s.node ?? <span title="The website's package.json names no Node version (engines); Vercel then uses its project default, which only Vercel knows.">Not stated</span>}</KV>
                  <KV k="CDN">{s.hosting === "Vercel" ? "Vercel Edge Network" : "—"}</KV>
                  <KV k="Edge cache hits">
                    <Read reading={infra.cache} form="inline">
                      {(c) => (
                        <Tooltip text={`${c.hits} of ${c.answered} of the desk's checks in the last 24 hours were answered from Vercel's cache. Not the hit rate visitors get, which only Vercel knows.`}>
                          <span className="dk-num" tabIndex={0}>
                            {c.answered < 30 ? `${c.hits} / ${c.answered}` : percent(c.percent)}
                          </span>
                        </Tooltip>
                      )}
                    </Read>
                  </KV>
                  <KV k="Environment">
                    <Tooltip text={`Every push to ${s.branch} is a production build on Vercel.`}>
                      <StatusDot tone="good">Production ({s.branch})</StatusDot>
                    </Tooltip>
                  </KV>
                </dl>
              </>
            )}
          </Read>
        </div>
        <div className="dk-health-infra-col dk-health-infra-col--desk">
          <p className="dk-health-subhead">
            <Tooltip text="The desk's own server, not the website's hosting. Vercel's usage figures (CPU, memory, function invocations, bandwidth, build minutes) need a Vercel API token, which the desk does not have.">
              <span tabIndex={0}>Desk server</span>
            </Tooltip>
            <Stamp reading={desk} />
          </p>
          <Read reading={desk} form="panel">
            {(d) => (
              <>
                <dl className="dk-health-kvs">
                  <Gauge
                    k="CPU load"
                    value={d.loadPercent}
                    label="Desk server CPU load"
                    text={d.loadPercent === null ? <Tooltip text="Windows keeps no load average; the desk on its Linux server reports one."><span tabIndex={0}>—</span></Tooltip> : percent(d.loadPercent, 0)}
                  />
                  <Gauge k="Memory usage" value={d.memoryPercent} label={`Desk server memory in use, of ${bytes(d.memoryTotal)}`} text={percent(d.memoryPercent, 0)} />
                  <Gauge k="Disk usage" value={d.diskPercent} label={`Desk server disk in use, of ${bytes(d.diskTotal)}`} text={d.diskPercent === null ? "—" : percent(d.diskPercent, 0)} />
                  <Gauge
                    k="Desk process"
                    value={d.processLimit ? (d.processBytes / d.processLimit) * 100 : null}
                    label="Desk process memory against its ceiling"
                    text={d.processLimit ? `${bytes(d.processBytes)} of ${bytes(d.processLimit)}` : bytes(d.processBytes)}
                  />
                  <KV k="CPUs">{d.cpus}</KV>
                  <KV k="Running for">{duration(d.processUptime * 1000)}</KV>
                  <KV k="Node.js">{d.node}</KV>
                </dl>
              </>
            )}
          </Read>
        </div>
      </div>
      <p className="dk-health-note">Vercel&rsquo;s own usage figures need a Vercel API token, which the desk does not have.</p>
    </Card>
  );
}

/* ---------- Recent incidents & logs -------------------------------------------------- */

const TONE_WORD: Record<Tone, string> = { bad: "Error", warn: "Warning", info: "Info", good: "Success", quiet: "Note" };

/** Incidents, failed jobs, sitemap changes and deployments, newest first, with the board's tone chips. */
export function RecentIncidents({ reading }: { reading: Reading<ActivityItem[]> }) {
  return (
    <Card
      title="Recent incidents & logs"
      icon="alert"
      tone="bad"
      className="dk-health-card dk-health-incidents"
      right={
        <>
          <Stamp reading={reading} />
          <LinkButton href="/site-health/logs" size="xs">
            View all
          </LinkButton>
        </>
      }
    >
      <Read reading={reading}>
        {(items) =>
          items.length ? (
            <>
              <ol className="dk-health-log">
                {items.slice(0, 6).map((a) => {
                  const inner = (
                    <>
                      <time className="dk-health-log-time dk-num" dateTime={a.at} suppressHydrationWarning>
                        {feedTime(a.at)}
                      </time>
                      <span className="dk-health-log-tone">
                        <StatusDot tone={a.tone} tint>
                          {TONE_WORD[a.tone]}
                        </StatusDot>
                      </span>
                      <span className="dk-health-log-text" title={a.detail ? `${a.text}. ${a.detail}` : a.text}>
                        {a.text}
                      </span>
                      {a.href ? <Icon name="chevron-right" size={14} className="dk-health-chev" /> : <span />}
                    </>
                  );
                  return (
                    <li key={a.id}>
                      {a.href ? (
                        <Go href={a.href} className="dk-health-log-row dk-health-log-row--link">
                          {inner}
                        </Go>
                      ) : (
                        <div className="dk-health-log-row">{inner}</div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </>
          ) : (
            <p className="dk-health-quiet dk-health-pad">Nothing has happened yet: no incident, failed job, sitemap change or deployment is in the log.</p>
          )
        }
      </Read>
    </Card>
  );
}
