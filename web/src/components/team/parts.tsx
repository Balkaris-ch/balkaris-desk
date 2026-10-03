import type { ReactNode } from "react";
import type { Me } from "@/contract/common";
import type { MemberStatus, TeamRole } from "@/contract/team";
import { Avatar } from "@/components/ui/Avatar";
import { Badge, Chip, type ChipTone } from "@/components/ui/Badge";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { mayOpen, TEAM_PAGES } from "@/components/shell/nav";
import type { Said } from "./actions";

/**
 * The Team section's own small parts: its tab strip, a person in a row, a
 * status, a role, and a form's answer.
 */

/** The strip under each Team page's head: only the pages this person may open, and none at all when that is one. */
export function TeamTabs({ me, active, counts }: { me: Me; active: string; counts?: Partial<Record<string, number | null>> }) {
  const items: TabItem[] = TEAM_PAGES.filter((p) => mayOpen(me.access?.pages, p.href)).map((p) => ({
    key: p.key,
    label: p.label,
    href: p.href,
    icon: p.icon,
    count: counts?.[p.key] ?? null,
  }));
  if (items.length < 2) return null;
  return <Tabs items={items} active={active} label="Team pages" className="dk-team-tabs" />;
}

const STATUS: Record<MemberStatus, { label: string; tone: ChipTone }> = {
  online: { label: "Online", tone: "good" },
  away: { label: "Away", tone: "quiet" },
  invited: { label: "Invited", tone: "info" },
  waiting: { label: "Waiting for access", tone: "warn" },
  off: { label: "Switched off", tone: "bad" },
  bot: { label: "Telegram only", tone: "quiet" },
};

export function StatusBadge({ status }: { status: MemberStatus }) {
  const s = STATUS[status];
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

const ROLE_TONE: Record<string, ChipTone> = {
  owner: "violet",
  administrator: "good",
  custom: "warn",
  waiting: "warn",
};

export function RoleChip({ role }: { role: TeamRole }) {
  return <Chip tone={ROLE_TONE[role.key] ?? "info"}>{role.label}</Chip>;
}

/** A person in a row: initials, name, and a line under it. */
export function Who({ name, sub, chips, size = "sm" }: { name: string; sub?: ReactNode; chips?: ReactNode; size?: "sm" | "md" | "lg" }) {
  return (
    <span className="dk-team-who">
      <Avatar name={name} size={size} />
      <span className="dk-team-who-text">
        <span className="dk-team-who-name">
          {name}
          {chips}
        </span>
        {sub ? <span className="dk-team-who-sub">{sub}</span> : null}
      </span>
    </span>
  );
}

/** What the server said about a change, beside the button that sent it. */
export function Answer({ said }: { said: Said | null }) {
  if (!said) return null;
  return (
    <p key={said.at} className={said.ok ? "dk-team-said dk-team-said--ok" : "dk-team-said dk-team-said--bad"} role={said.ok ? "status" : "alert"}>
      {said.text}
    </p>
  );
}

/** Initials of a few people, overlapping, with "+n" for the rest. */
export function Faces({ names, max = 4 }: { names: string[]; max?: number }) {
  if (!names.length) return null;
  const shown = names.slice(0, max);
  return (
    <span className="dk-team-faces" aria-label={names.join(", ")}>
      {shown.map((n, i) => (
        <Avatar key={`${n}-${i}`} name={n} size="sm" className="dk-team-face" />
      ))}
      {names.length > max ? <span className="dk-team-face dk-team-face--more">+{names.length - max}</span> : null}
    </span>
  );
}
