import type { TeamMember, TeamMembers } from "@/contract/team";
import { Chip } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Table, type Column } from "@/components/ui/Table";
import { ago, fullDate } from "@/lib/format";
import { RoleChip, StatusBadge, Who } from "./parts";

/**
 * Team › Members: everyone the desk knows, their role and what it opens.
 * The owner also sees who is online, when each was last here and where, and
 * the doors to change their access or read their activity.
 */
export function MembersTable({ data, at }: { data: TeamMembers; at: string }) {
  const columns: Column<TeamMember>[] = [
    {
      key: "member",
      head: "Member",
      sort: (m) => m.name.toLowerCase(),
      cell: (m) => (
        <Who
          name={m.name}
          sub={m.email ?? "No address: known from the Telegram bot"}
          chips={
            <>
              {m.you ? <Chip tone="good">You</Chip> : null}
              {m.owner ? <Chip tone="violet">Owner</Chip> : null}
            </>
          }
        />
      ),
    },
    {
      key: "role",
      head: "Role",
      sort: (m) => m.role.label,
      cell: (m) =>
        m.status === "bot" ? (
          <span className="dk-team-who-text">
            <Chip>Not on the desk</Chip>
            <span className="dk-team-who-sub">Shares links with the bot; cannot sign in</span>
          </span>
        ) : (
          <span className="dk-team-who-text">
            <RoleChip role={m.role} />
            <span className="dk-team-who-sub">
              {m.owner ? "Every page, always" : `${m.pages.open} of ${m.pages.of} pages`}
              {m.canPublish ? " · publishes" : ""}
              {m.seesLeads ? " · sees enquiries" : ""}
            </span>
          </span>
        ),
    },
    {
      key: "status",
      head: "Status",
      sort: (m) => m.status,
      /* Online or away is the owner's to know: anybody else sees only what is not an ordinary member. */
      cell: (m) => (data.canEdit || m.status !== "away" ? <StatusBadge status={m.status} /> : <span className="dk-team-quiet">Member</span>),
    },
  ];
  if (data.canEdit) {
    columns.push(
      {
        key: "last",
        head: "Last active",
        sort: (m) => m.lastActive,
        cell: (m) =>
          m.lastActive ? (
            <span className="dk-team-who-text">
              <time dateTime={m.lastActive} title={fullDate(m.lastActive)} suppressHydrationWarning>
                {m.status === "online" ? "Now" : ago(m.lastActive, at)}
              </time>
              {m.place ? <span className="dk-team-who-sub">{m.place.label}</span> : null}
            </span>
          ) : (
            <span className="dk-team-quiet">{m.invitedAt ? `Invited ${ago(m.invitedAt, at)}` : "Never"}</span>
          ),
      },
      {
        key: "actions",
        head: <span className="dk-sr">Actions</span>,
        align: "right",
        cell: (m) =>
          m.status === "bot" ? (
            <span className="dk-team-quiet">Link in Settings</span>
          ) : (
            <span className="dk-team-rowbtns">
              {m.owner ? null : (
                <LinkButton href={`/team/access?person=${m.id}`} size="xs" variant="quiet">
                  Manage
                </LinkButton>
              )}
              <LinkButton href={`/team?member=${m.id}`} size="xs" variant="ghost" icon="pulse">
                Activity
              </LinkButton>
            </span>
          ),
      },
    );
  }
  return (
    <Table
      caption="Team members"
      rows={data.members}
      rowKey={(m) => m.id}
      columns={columns}
      density="roomy"
      minWidth={data.canEdit ? 860 : 620}
      empty="Nobody matches."
    />
  );
}
