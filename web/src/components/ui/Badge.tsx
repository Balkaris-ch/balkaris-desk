import type { ReactNode } from "react";
import type { Tone } from "@/contract/common";
import { cx } from "@/lib/cx";
import { Icon, type IconName } from "./icons";
import "./tone.css";
import "./badge.css";

/** The contract's five tones, and violet, which the boards use for drafts and services. */
export type ChipTone = Tone | "violet";

export interface BadgeProps {
  tone?: ChipTone;
  /** A filled dot before the text: "● Healthy". */
  dot?: boolean;
  icon?: IconName;
  children: ReactNode;
  className?: string;
}

/**
 * A soft filled label that states a condition: "● Healthy", "Good", "High
 * impact". The ground is the tone at low strength, the text the tone itself.
 */
export function Badge({ tone = "quiet", dot, icon, children, className }: BadgeProps) {
  return (
    <span className={cx("dk-badge", `dk-tone-${tone}`, className)}>
      {dot ? <span className="dk-badge-dot" aria-hidden /> : null}
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}

export interface ChipProps {
  tone?: ChipTone;
  /** Uppercase, opened up: the area chips "SEO", "CONVERSION". */
  caps?: boolean;
  /** Round ends: a category ("Growth", "AI & Tech"). */
  pill?: boolean;
  icon?: IconName;
  children: ReactNode;
  className?: string;
}

/**
 * An outlined label that classifies: an area ("SEO"), a status ("Published"),
 * a page type ("Landing"), a category. Quiet by default.
 */
export function Chip({ tone = "quiet", caps, pill, icon, children, className }: ChipProps) {
  return (
    <span className={cx("dk-chip", `dk-tone-${tone}`, caps && "dk-chip--caps", pill && "dk-chip--pill", className)}>
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}

/** A number in a small box: a tab's count, a keyword count in a table. */
export function Count({ tone = "quiet", children, className }: { tone?: ChipTone; children: ReactNode; className?: string }) {
  return <span className={cx("dk-count", "dk-num", `dk-tone-${tone}`, className)}>{children}</span>;
}

const STATUS = {
  published: { label: "Published", tone: "good", icon: "check-circle" },
  review: { label: "In review", tone: "warn", icon: "clock" },
  draft: { label: "Draft", tone: "violet", icon: "pencil" },
  writing: { label: "Writing", tone: "info", icon: "edit" },
  toread: { label: "To read", tone: "quiet", icon: "bookmark" },
  stuck: { label: "Stuck", tone: "bad", icon: "alert" },
  scheduled: { label: "Scheduled", tone: "info", icon: "calendar" },
} satisfies Record<string, { label: string; tone: ChipTone; icon: IconName }>;

/** The article states the Insights table names. */
export type ContentStatus = keyof typeof STATUS;

/** Every article state, in the order a filter lists them. */
export const CONTENT_STATUSES = Object.keys(STATUS) as ContentStatus[];

/** An article's state as the Insights table shows it: Published, In review, Draft, Stuck. */
export function StatusChip({ status }: { status: ContentStatus }) {
  const s = (STATUS as Record<string, (typeof STATUS)[ContentStatus] | undefined>)[status];
  if (!s) return <Chip>{String(status)}</Chip>;
  return (
    <Chip tone={s.tone} icon={s.icon}>
      {s.label}
    </Chip>
  );
}

const TYPES: Record<string, ChipTone> = {
  landing: "good",
  service: "violet",
  industry: "info",
  blog: "warn",
  insight: "warn",
  standard: "quiet",
};

/** A page's type as the Pages table shows it. An unknown type is drawn quiet, never guessed. */
export function TypeChip({ type }: { type: string }) {
  return <Chip tone={TYPES[type.toLowerCase()] ?? "quiet"}>{type}</Chip>;
}
