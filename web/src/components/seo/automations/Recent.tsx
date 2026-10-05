import type { ActivityItem } from "@/contract/common";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Go } from "@/components/ui/Go";
import { StatusDot } from "@/components/ui/StatusDot";
import { clock, feedTime, num } from "@/lib/format";

/**
 * What the SEO jobs, and the people acting on what they found, wrote to the
 * desk's log in the head's period, the newest twelve, with the owner
 * switching one of these jobs off or on. "View all" opens the desk-wide log
 * filtered to the same kinds.
 */
export function Recent({ items, at, kinds, total, period }: { items: ActivityItem[]; at: string; kinds: string[]; total: number; period: string }) {
  return (
    <Card
      title="What they did lately"
      icon="clock"
      sub={total > items.length ? `The newest ${num(items.length)} of ${num(total)} lines, ${period.toLowerCase()}.` : `${period}.`}
      right={<LinkButton href={`/automations?kinds=${encodeURIComponent(kinds.join(","))}#log`} size="xs">View all</LinkButton>}
    >
      {items.length ? (
        <ol className="dk-seo-automations-log">
          {items.map((a) => {
            const body = (
              <>
                <span className="dk-seo-automations-log-text">{a.text}</span>
                {a.detail ? <span className="dk-seo-automations-log-detail">{a.detail}</span> : null}
              </>
            );
            return (
              <li key={a.id}>
                <time className="dk-num" dateTime={a.at} title={`${feedTime(a.at, at)} ${clock(a.at)}`}>
                  {feedTime(a.at, at)}
                </time>
                <StatusDot tone={a.tone} title={a.tone} />
                {a.href ? (
                  <Go href={a.href} className="dk-seo-automations-log-body dk-seo-automations-log-link">
                    {body}
                  </Go>
                ) : (
                  <span className="dk-seo-automations-log-body">{body}</span>
                )}
                {a.actor && a.actor !== "desk" ? <span className="dk-seo-automations-log-actor">{a.actor}</span> : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <Empty icon="inbox" title="Nothing yet" compact>
          The SEO jobs wrote nothing to the log in this period. A longer period at the top shows older lines.
        </Empty>
      )}
    </Card>
  );
}
