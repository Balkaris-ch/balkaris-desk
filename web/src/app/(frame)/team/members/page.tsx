import type { Stat } from "@/contract/common";
import type { TeamInvitations, TeamMembers } from "@/contract/team";
import { PageHead } from "@/components/shell/PageHead";
import { InviteForm } from "@/components/team/Forms";
import { MemberSearch } from "@/components/team/MemberSearch";
import { MembersTable } from "@/components/team/Members";
import { TeamTabs } from "@/components/team/parts";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Grid } from "@/components/ui/Grid";
import { Select } from "@/components/ui/Select";
import { Tile, Tiles } from "@/components/ui/Tile";
import { api, ask, me } from "@/lib/api";
import "@/components/team/team.css";

export const metadata = { title: "Team members" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * Team › Members: everyone on the desk, their role (the template their access
 * matches, or Custom) and their status. Everybody given Team reads it; the
 * owner also sees who is online, when each was last here and where, and adds
 * people from here. ?q= searches names and addresses, ?role= keeps one role.
 */
export default async function TeamMembersPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const [who, data] = await Promise.all([me(), api<TeamMembers>("/api/v1/team/members")]);
  const invites = who.owner ? await ask<TeamInvitations>("/api/v1/team/invitations") : null;

  const words = (one(q.q) ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const role = one(q.role) ?? "";
  const shown = data.members.filter(
    (m) => words.every((w) => `${m.name} ${m.email ?? ""}`.toLowerCase().includes(w)) && (!role || m.role.key === role),
  );

  const at = new Date().toISOString();
  const stat = (value: number, sub: string): { state: "ok"; value: Stat; source: "desk"; asOf: string } => ({
    state: "ok",
    value: { value, previous: null, unit: "count", series: [], sub },
    source: "desk",
    asOf: at,
  });
  /* The most common roles after the owner, so the row says what kinds of access the team has. */
  const roles = data.roles.filter((r) => r.key !== "owner").sort((a, b) => b.count - a.count).slice(0, 4);

  return (
    <>
      <PageHead
        eyebrow="Team"
        title="Team & Access"
        subtitle="Manage team members, their roles and what each can see and change across the desk."
        action={
          who.owner ? (
            <LinkButton href="/team/invitations" variant="primary" icon="plus">
              Add team member
            </LinkButton>
          ) : undefined
        }
      />
      <TeamTabs me={who} active="members" counts={{ members: data.counts.total, invitations: data.counts.invited || null }} />

      <Tiles count={(Math.min(6, Math.max(3, roles.length + 1)) as 3 | 4 | 5 | 6)}>
        <Tile
          label="Total members"
          icon="users"
          delta="none"
          noStamp
          reading={stat(data.counts.total, data.canEdit ? `${data.counts.online} online now` : "on the desk")}
          info="Everybody who can sign in to the desk, invited people included. People known only from the Telegram bot are not counted."
        />
        {roles.map((r) => (
          <Tile key={r.key} label={r.label} delta="none" noStamp reading={stat(r.count, r.count === 1 ? "person" : "people")} />
        ))}
        {roles.length < 2 ? <Tile label="Invited" icon="mail" tone="info" delta="none" noStamp reading={stat(data.counts.invited, "not signed in yet")} /> : null}
      </Tiles>

      <Card
        title="Members"
        icon="users"
        count={shown.length}
        sub={data.canEdit ? "Manage changes what a person may see; Activity shows what they did." : "Only the owner changes access."}
        right={
          <span className="dk-team-filters">
            <MemberSearch />
            <Select param="role" label="Role" options={[{ value: "", label: "All roles" }, ...data.roles.map((r) => ({ value: r.key, label: r.label }))]} />
          </span>
        }
        flush
      >
        <MembersTable data={{ ...data, members: shown }} at={at} />
      </Card>

      {invites?.ok ? (
        <Grid cols="1fr 1.25fr">
          <Card id="invite" title="Add team member" icon="plus" sub="Give somebody access before they sign in for the first time.">
            <InviteForm domain={invites.value.domain} presets={invites.value.presets} preset={one(q.preset)} />
          </Card>
          <Card title="Quick role templates" icon="key" sub="A template sets every area at once. Choose one to invite somebody with it, or apply it to a person under Access & Roles.">
            <ul className="dk-team-presets">
              {invites.value.presets.map((p) => (
                <li key={p.key} className="dk-team-presetcard">
                  <span className="dk-team-presetcard-name">{p.label}</span>
                  <span className="dk-team-presetcard-about">{p.about}</span>
                  <LinkButton href={`/team/members?preset=${p.key}#invite`} size="xs" variant="quiet">
                    Select
                  </LinkButton>
                </li>
              ))}
            </ul>
          </Card>
        </Grid>
      ) : null}
    </>
  );
}
