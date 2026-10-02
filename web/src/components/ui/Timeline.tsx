import type { ReactNode } from "react";
import type { ActivityItem } from "@/contract/common";
import type { ChipTone } from "./Badge";
import { cx } from "@/lib/cx";
import { feedTime } from "@/lib/format";
import { Go } from "./Go";
import { Icon } from "./icons";
import "./tone.css";
import "./timeline.css";

export interface TimelineItem {
  key: string | number;
  /** Already written as it should read: "09:31", "Yesterday", "28 Sep". */
  time: string;
  /** The machine time, when there is one, for the <time> element. */
  at?: string;
  tone?: ChipTone;
  text: ReactNode;
  /** A second, quieter line: who did it, what it touched. */
  detail?: ReactNode;
  /** Makes the row a link and draws the chevron. */
  href?: string;
}

export interface TimelineProps {
  items: readonly TimelineItem[];
  /** What the list is, for a screen reader: "Recent activity". */
  label: string;
  className?: string;
}

/**
 * Things that happened, newest first: time, a toned dot, the text, an optional
 * second line and chevron. The "Recent activity" list, the incident log.
 *
 * It draws what it is given. When there is nothing to list, the screen shows
 * an `Empty` instead and says why.
 */
export function Timeline({ items, label, className }: TimelineProps) {
  return (
    <ol className={cx("dk-timeline", className)} aria-label={label}>
      {items.map((it) => {
        const inner = (
          <>
            <span className="dk-timeline-node" aria-hidden />
            <time className="dk-timeline-time dk-num" dateTime={it.at} suppressHydrationWarning>
              {it.time}
            </time>
            <span className={cx("dk-timeline-dot", `dk-tone-${it.tone ?? "quiet"}`)} aria-hidden />
            <span className="dk-timeline-body">
              <span className="dk-timeline-text">{it.text}</span>
              {it.detail ? <span className="dk-timeline-detail">{it.detail}</span> : null}
            </span>
            {it.href ? <Icon name="chevron-right" size={14} className="dk-timeline-go" /> : null}
          </>
        );
        return (
          <li key={it.key} className="dk-timeline-item">
            {it.href ? (
              <Go href={it.href} className="dk-timeline-row dk-timeline-row--link">
                {inner}
              </Go>
            ) : (
              <div className="dk-timeline-row">{inner}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The contract's activity rows as timeline rows: the time is the clock today,
 * "Yesterday", or the date; the actor, when there is one, joins the detail.
 */
export function activityItems(items: readonly ActivityItem[], now: Date = new Date()): TimelineItem[] {
  return items.map((a) => ({
    key: a.id,
    time: feedTime(a.at, now),
    at: a.at,
    tone: a.tone,
    text: a.text,
    detail: a.detail && a.actor ? `${a.detail} · ${a.actor}` : (a.detail ?? (a.actor ? `by ${a.actor}` : undefined)),
    href: a.href,
  }));
}
