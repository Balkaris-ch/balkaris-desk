import type { ActivityItem } from "@/contract/common";
import { Card } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Go } from "@/components/ui/Go";
import { Icon, type IconName } from "@/components/ui/icons";
import type { ChipTone } from "@/components/ui/Badge";
import { feedTime } from "@/lib/format";
import { cx } from "@/lib/cx";

/** The icon a line gets, from what it says it did. */
function lookOf(a: ActivityItem): { icon: IconName; tone: ChipTone } {
  const t = a.text.toLowerCase();
  if (a.tone === "bad") return { icon: "alert", tone: "bad" };
  if (t.includes("traffic")) return { icon: "bar-chart", tone: "good" };
  if (t.includes("opportunit")) return { icon: "lightbulb", tone: "bad" };
  if (t.includes("redirect")) return { icon: "link", tone: "warn" };
  if (t.includes("title") || t.includes("description") || t.includes("metadata")) return { icon: "tag", tone: "info" };
  if (t.includes("brief")) return { icon: "file-text", tone: "good" };
  if (t.includes("audit")) return { icon: "search", tone: "warn" };
  if (a.kind === "operator-change") return { icon: "check-circle", tone: a.tone === "warn" ? "warn" : "good" };
  if (a.kind === "operator-proposal") return { icon: "hourglass", tone: "warn" };
  return { icon: "message", tone: "good" };
}

/**
 * Where a line leads, with the panel it changes as its anchor, so the link
 * scrolls there: on a phone the answer and the approvals are far from this
 * list. Lines written before the anchors were stored get theirs here.
 */
function anchored(href: string): string {
  if (href.includes("#") || !href.startsWith("/operator?")) return href;
  const q = new URLSearchParams(href.slice("/operator?".length));
  if (q.has("result")) return `${href}#response`;
  if (q.has("ap")) return `${href}#approvals`;
  if (q.has("ctx")) return `${href}#context`;
  return href;
}

/**
 * Recent actions: what the operator did, from the activity log. Tasks it
 * finished or could not, changes it proposed, and what people applied,
 * withdrew or rejected.
 */
export function Feed({ actions }: { actions: ActivityItem[] }) {
  return (
    <Card title="Recent actions" icon="pulse" right={<LinkButton href="/operator/results?tab=actions" size="xs">View all</LinkButton>} className="dk-operator-panel dk-operator-feed-card">
      {actions.length ? (
        <ol className="dk-operator-feed" aria-label="Recent actions">
          {actions.map((a) => {
            const l = lookOf(a);
            const inner = (
              <>
                <span className="dk-operator-feed-node" aria-hidden />
                <time className="dk-operator-feed-time dk-num" dateTime={a.at} suppressHydrationWarning>
                  {feedTime(a.at)}
                </time>
                <span className={cx("dk-operator-tile", "dk-operator-tile--xs", `dk-tone-${l.tone}`)} aria-hidden>
                  <Icon name={l.icon} size={16} />
                </span>
                <span className="dk-operator-feed-text">
                  <span className="dk-operator-feed-title">{a.text}</span>
                  {a.detail ? <span className="dk-operator-feed-sub">{a.detail}</span> : null}
                </span>
                {a.href ? <Icon name="chevron-right" size={16} className="dk-operator-feed-go" /> : null}
              </>
            );
            return (
              <li key={a.id} className="dk-operator-feed-item">
                {a.href ? (
                  <Go href={anchored(a.href)} className="dk-operator-feed-row dk-operator-feed-row--link">
                    {inner}
                  </Go>
                ) : (
                  <div className="dk-operator-feed-row">{inner}</div>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <Empty icon="pulse" title="Nothing yet" compact>
          What the operator does appears here: answers, the changes it proposes, and what is applied or withdrawn.
        </Empty>
      )}
    </Card>
  );
}
