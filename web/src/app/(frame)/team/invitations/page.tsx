import { redirect } from "next/navigation";
import type { Invitation, TeamInvitations } from "@/contract/team";
import { CopyButton } from "@/components/assets/CopyButton";
import { PageHead } from "@/components/shell/PageHead";
import { InviteForm, WithdrawButton } from "@/components/team/Forms";
import { RoleChip, TeamTabs, Who } from "@/components/team/parts";
import { Badge } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Grid } from "@/components/ui/Grid";
import { Table, type Column } from "@/components/ui/Table";
import { ago, fullDate } from "@/lib/format";
import { api, me } from "@/lib/api";
import "@/components/team/team.css";

export const metadata = { title: "Invitations" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * Team › Invitations, the owner's alone: give somebody access before they
 * ever sign in. The desk's identity is a studio Google account and Google
 * sign-in finds a person by address, so an invitation is the row their first
 * sign-in will find, with the access chosen here. Nothing is emailed: the
 * desk has no mail of its own, and the address of the desk is all they need.
 */
export default async function TeamInvitationsPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const who = await me();
  if (!who.owner) redirect("/team/members");
  const data = await api<TeamInvitations>("/api/v1/team/invitations");
  const open = data.invitations.filter((i) => !i.joinedAt).length;
  const at = new Date().toISOString();

  const columns: Column<Invitation>[] = [
    { key: "who", head: "Person", sort: (i) => i.name.toLowerCase(), cell: (i) => <Who name={i.name} sub={i.email} /> },
    { key: "role", head: "Role", sort: (i) => i.role.label, cell: (i) => <RoleChip role={i.role} /> },
    {
      key: "invited",
      head: "Invited",
      sort: (i) => i.invitedAt,
      cell: (i) => (
        <span className="dk-team-who-text">
          <time dateTime={i.invitedAt} title={fullDate(i.invitedAt)} suppressHydrationWarning>
            {ago(i.invitedAt, at)}
          </time>
          {i.invitedBy ? <span className="dk-team-who-sub">by {i.invitedBy}</span> : null}
        </span>
      ),
    },
    {
      key: "state",
      head: "Status",
      sort: (i) => (i.joinedAt ? 1 : 0),
      cell: (i) =>
        i.revoked ? (
          <Badge tone="bad" dot>
            Switched off
          </Badge>
        ) : i.joinedAt ? (
          <Badge tone="good" dot>
            <span suppressHydrationWarning>Joined {ago(i.joinedAt, at)}</span>
          </Badge>
        ) : i.linked ? (
          <Badge tone="info" dot>
            Linked to Telegram, not signed in yet
          </Badge>
        ) : (
          <Badge tone="info" dot>
            Not signed in yet
          </Badge>
        ),
    },
    {
      key: "do",
      head: <span className="dk-sr">Actions</span>,
      align: "right",
      cell: (i) => (
        <span className="dk-team-rowbtns">
          <LinkButton href={`/team/access?person=${i.id}`} size="xs" variant="quiet">
            Access
          </LinkButton>
          {/* The server refuses to withdraw a linked or a switched-off invitation (contract/team.ts): no button that could only be refused. */}
          {i.joinedAt || i.linked || i.revoked ? null : <WithdrawButton id={i.id} name={i.name} />}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHead eyebrow="Team" title="Invitations" subtitle="Give somebody access before they sign in for the first time, with exactly the areas you choose." />
      <TeamTabs me={who} active="invitations" counts={{ invitations: open || null }} />

      <Grid cols="1.2fr 1fr">
        <Card id="invite" title="Invite a team member" icon="mail" sub="They are on the team the moment you add them, with the access the role gives.">
          <InviteForm domain={data.domain} presets={data.presets} preset={one(q.preset)} />
        </Card>
        <Card title="Then send them the desk" icon="send" sub="The desk sends no email of its own.">
          <ol className="dk-team-steps">
            <li>
              <span className="dk-team-strong">Send them this address</span>, in Slack, Telegram or an email of yours:
              <span className="dk-team-copyline">
                <code className="dk-team-code">{data.link}</code>
                <CopyButton text={data.link} label="Copy the address" bare={false} />
              </span>
            </li>
            <li>
              <span className="dk-team-strong">They sign in with Google</span> as the address you gave, an @{data.domain} account. Nothing else gets in.
            </li>
            <li>
              <span className="dk-team-strong">The desk finds their invitation</span> by that address and opens exactly what you chose. Their status here turns to Joined.
            </li>
          </ol>
          <p className="dk-team-note">Change what they may do at any time under Access & Roles, before or after they sign in. Withdrawing an unused invitation removes it; once they have signed in, switch them off in Settings › People instead. An invitation that was linked to a Telegram account, or switched off, is not withdrawn either: it is managed under Access & Roles and Settings › People.</p>
        </Card>
      </Grid>

      <Card title="Invitations" icon="mail" count={data.invitations.length || undefined} sub={!data.invitations.length ? undefined : open ? `${open} not used yet.` : "Everybody invited has signed in."} flush>
        <Table caption="Invitations" rows={data.invitations} rowKey={(i) => i.id} columns={columns} density="roomy" minWidth={760} empty="Nobody has been invited yet. People who sign in by themselves are under Members." />
      </Card>
    </>
  );
}
