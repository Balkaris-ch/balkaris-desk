import type { ReactNode } from "react";
import type { ActivityItem, Reading } from "@/contract/common";
import type { AuditJob } from "@/contract/overview";
import { ActionList } from "@/components/ui/ActionList";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Timeline } from "@/components/ui/Timeline";
import { ago, clock, feedTime } from "@/lib/format";
import { runAudit } from "./actions";
import type { AuditSaid } from "./audit";

/** The rows as the board draws them: time, toned dot, one line. Where it leads, when it leads somewhere. */
export function activityRows(items: readonly ActivityItem[], now = new Date()) {
  return items.map((a) => ({ key: a.id, time: feedTime(a.at, now), at: a.at, tone: a.tone, text: a.text, href: a.href }));
}

/** "Recent activity": the five latest things the desk recorded about the website. */
export function ActivityCard({ reading }: { reading: Reading<ActivityItem[]> }) {
  return (
    <Card
      title="Recent activity"
      icon="pulse"
      className="dk-overview-activity"
      right={
        <LinkButton href="/activity" size="sm">
          View all
        </LinkButton>
      }
    >
      <Read reading={reading}>
        {(items, r) => (
          <>
            {items.length ? (
              <Timeline label="Recent activity" items={activityRows(items)} />
            ) : (
              <Empty compact icon="clock" title="Nothing recorded yet">
                Deployments, published insights, sitemap and crawl changes, incidents and changes made in the desk appear here as they happen.
              </Empty>
            )}
            <p className="dk-overview-foot">
              <Stamp reading={r} />
            </p>
          </>
        )}
      </Read>
    </Card>
  );
}

/**
 * "Quick actions", each real: four go where the thing is done, and "Run SEO
 * audit" asks the desk to crawl the website now. When the last audit ran sits
 * quietly in the head; a line under the actions appears only when there is
 * something to say (running, asked for, refused, cannot run). Both are read
 * from the crawl job itself; the address carries only a fixed code for the
 * last press (`said`, see audit.ts).
 */
export function QuickActions({ audit, said, range, specimen }: { audit: AuditJob | null; said: AuditSaid | null; range: string; specimen: boolean }) {
  const canAudit = audit !== null && audit.ready && audit.enabled;
  const line = auditLine(audit, said);
  return (
    <Card title="Quick actions" icon="target" className="dk-overview-actions" id="quick-actions" right={lastAudit(audit)}>
      <ActionList
        label="Quick actions"
        items={[
          { icon: "edit", label: "Create new insight", href: "/insights?create=1" },
          { icon: "file-text", label: "Generate page brief", href: "/operator?do=brief" },
          ...(canAudit
            ? [{ icon: "search" as const, label: "Run SEO audit", action: runAudit, fields: { range, ...(specimen ? { specimen: "1" } : {}) } }]
            : []),
          { icon: "funnel", label: "Analyse conversion funnel", href: "/conversions" },
          { icon: "pages", label: "View all pages", href: "/pages" },
        ]}
      />
      {line ? (
        <p className={`dk-overview-auditline dk-overview-${line.tone}`} role="status">
          {line.text}
        </p>
      ) : null}
    </Card>
  );
}

/** Started and never ended: the desk restarted under it. */
const cutShort = (a: AuditJob): boolean => a.lastStart !== null && (a.lastEnd === null || a.lastStart > a.lastEnd);

/**
 * "Last audit 13:42" in the head: when the last audit that came to an end
 * ended. A run the desk's restart cut short is said on the pointer, not in a
 * line of its own; it runs again when it is next due.
 */
function lastAudit(audit: AuditJob | null): ReactNode {
  if (!audit || audit.running || !audit.ready || !audit.enabled) return null;
  const cut = audit.lastStart !== null && cutShort(audit) ? ` The run started at ${clock(audit.lastStart)} did not finish (the desk restarted under it); it runs again when it is next due.` : "";
  if (!audit.lastEnd) return <span className="dk-overview-lastaudit" title={`No SEO audit has finished yet.${cut}`}>No audit yet</span>;
  const failed = audit.lastOk === false;
  const when = feedTime(audit.lastEnd);
  return (
    <span className={`dk-overview-lastaudit${failed ? " dk-overview-warn" : ""}`} title={`The last SEO audit (the crawl) ${failed ? "failed" : "finished"} ${ago(audit.lastEnd)}, at ${clock(audit.lastEnd)}.${cut}`}>
      Last audit {failed ? "failed " : ""}
      <time dateTime={audit.lastEnd} suppressHydrationWarning>
        {when === "Yesterday" ? "yesterday" : when}
      </time>
    </span>
  );
}

/**
 * The line under the actions, or null when the head says enough. Every
 * sentence is fixed here; the press's code only chooses one, and every
 * detail in it comes from the crawl job.
 */
function auditLine(audit: AuditJob | null, said: AuditSaid | null, now = Date.now()): { text: string; tone: "good" | "warn" | "quiet" } | null {
  if (!audit) return null;
  if (audit.running) {
    const p = audit.progress;
    return { text: p && p.of ? `SEO audit running: ${p.done} of ${p.of} pages read.` : "SEO audit running.", tone: "good" };
  }
  if (!audit.enabled) return { text: "The SEO audit (the crawl) is switched off in Automations.", tone: "quiet" };
  if (!audit.ready) return { text: "The SEO audit cannot run yet: what it reads is not connected.", tone: "quiet" };

  /* A run that began after the press answers it: the head then says when it finished. */
  const ranSince = said !== null && audit.lastStart !== null && Date.parse(audit.lastStart) >= said.at - 5_000;
  if (said && !ranSince) {
    if (said.code === "started") return { text: "SEO audit asked for: it starts as soon as the job running now has finished.", tone: "good" };
    if (said.code === "busy") {
      const floor = Math.min(audit.every, 600) * 1000;
      const again = audit.lastStart ? Date.parse(audit.lastStart) + floor : null;
      return {
        text: `Not started: the SEO audit ran or was asked for less than ${Math.round(floor / 60_000)} minutes before.${again !== null && again > now ? ` It can be asked for again at ${clock(new Date(again))}.` : ""}`,
        tone: "warn",
      };
    }
    if (said.code === "down") return { text: "The desk server did not answer, so no SEO audit was asked for. Try again in a moment.", tone: "warn" };
    if (said.code === "failed") return { text: "The desk did not take the request for an SEO audit.", tone: "warn" };
    /* "off": the job may run again now; the head says when it last did. */
  }
  return null;
}
