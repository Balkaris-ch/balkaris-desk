import Link from "next/link";
import { redirect } from "next/navigation";
import type { AccessLevel } from "@/contract/common";
import type { AccessPerson, TeamAccess } from "@/contract/team";
import { PageHead } from "@/components/shell/PageHead";
import { AccessEditor } from "@/components/team/AccessEditor";
import { NewcomersForm } from "@/components/team/Forms";
import { RoleChip, TeamTabs, Who } from "@/components/team/parts";
import { Badge, Chip } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Grid } from "@/components/ui/Grid";
import { Table, type Column } from "@/components/ui/Table";
import { cx } from "@/lib/cx";
import { api, me } from "@/lib/api";
import "@/components/team/team.css";

export const metadata = { title: "Access & roles" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

const GLYPH: Record<AccessLevel, string> = { none: "—", view: "View", edit: "Edit" };

/**
 * Team › Access & Roles, the owner's alone: what each person may see and
 * change, area by area, as the engine's access matrix does it. Choose a person
 * (?person=), start from a template or set each area, save. Below, what a
 * newcomer starts with, and everybody at a glance.
 *
 * The owner is not on the list: grants never apply to the owner, so a row of
 * switches for that account would be switches that do nothing.
 */
export default async function TeamAccessPage({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const who = await me();
  if (!who.owner) redirect("/team/members");
  const data = await api<TeamAccess>("/api/v1/team/access");

  const asked = Number(one(q.person));
  const people = [...data.people].sort((a, b) => Number(a.revoked) - Number(b.revoked) || a.name.localeCompare(b.name));
  const person = people.find((p) => p.id === asked) ?? people.find((p) => !p.revoked) ?? people[0] ?? null;

  return (
    <>
      <PageHead
        eyebrow="Team"
        title="Access & Roles"
        subtitle="Choose what each person may see and change, area by area. The desk refuses everything else on the server, whatever a page shows."
        action={
          <LinkButton href="/team/invitations" variant="primary" icon="plus">
            Add team member
          </LinkButton>
        }
      />
      <TeamTabs me={who} active="access" />

      {people.length ? (
        <Grid cols="minmax(240px, 0.8fr) 2.2fr" mid="minmax(0, 1fr)">
          <Card title="People" icon="users" count={people.length} sub="Everybody but the owner." flush>
            <ul className="dk-team-people">
              {people.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/team/access?person=${p.id}`}
                    prefetch={false}
                    scroll={false}
                    className={cx("dk-team-person-link", p.id === person?.id && "dk-team-person-link--on")}
                    aria-current={p.id === person?.id ? "true" : undefined}
                  >
                    <Who name={p.name} sub={p.email ?? "No address"} />
                    <span className="dk-team-person-link-role">
                      {p.revoked ? <Badge tone="bad">Off</Badge> : p.invited ? <Badge tone="info">Invited</Badge> : null}
                      <RoleChip role={p.role} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          {person ? <PersonPanel person={person} data={data} /> : null}
        </Grid>
      ) : (
        <Card title="People" icon="users">
          <Empty icon="users" title="Nobody but the owner yet" action={<LinkButton href="/team/invitations" variant="primary" icon="plus">Add team member</LinkButton>}>
            Invite somebody, or let them sign in with their studio Google account: they appear here, and their access is set here.
          </Empty>
        </Card>
      )}

      <Grid cols="1fr 1.4fr">
        <Card title="Who gets in" icon="lock" sub={`Anybody with an @${data.domain} Google account can sign in.`}>
          <NewcomersForm value={data.newcomers} presets={data.presets} />
        </Card>
        <Card title="Templates" icon="key" sub="A template sets every area at once; nothing applies one by itself. None of them gives Leads: an enquiry is a stranger's personal data." flush>
          <Table
            caption="Templates"
            rows={data.presets}
            rowKey={(p) => p.key}
            minWidth={520}
            columns={[
              { key: "name", head: "Template", cell: (p) => <span className="dk-team-strong">{p.label}</span> },
              { key: "about", head: "Gives", cell: (p) => <span className="dk-team-wrap">{p.about}</span> },
              { key: "count", head: "People", numeric: true, width: "80px", cell: (p) => p.count },
            ]}
          />
        </Card>
      </Grid>

      {people.length ? <Glance data={data} people={people} /> : null}
    </>
  );
}

function PersonPanel({ person, data }: { person: AccessPerson; data: TeamAccess }) {
  return (
    <Card
      title={person.name}
      icon="key"
      sub={person.email ?? "Known from the Telegram bot: no address, so they cannot sign in until one is linked in Settings › People."}
      right={
        <span className="dk-team-person-right">
          <RoleChip role={person.role} />
          {person.revoked ? <Badge tone="bad" dot>Switched off</Badge> : person.invited ? <Badge tone="info" dot>Invited</Badge> : null}
          <LinkButton href={`/team?member=${person.id}`} size="xs" variant="ghost" icon="pulse">
            Activity
          </LinkButton>
        </span>
      }
    >
      {person.revoked ? (
        <p className="dk-team-note dk-team-note--warn">Switched off: every page refuses them whatever is set here. What you set takes effect if they are let in again (Settings › People).</p>
      ) : null}
      <div className="dk-team-chips">
        {person.restricted ? <Chip tone="warn">Restricted</Chip> : <Chip tone="good">Every area</Chip>}
        {person.canPublish ? <Chip tone="good">Publishes as themselves</Chip> : <Chip>Does not publish</Chip>}
        {person.seesLeads ? <Chip tone="warn">Sees enquiries</Chip> : <Chip>Enquiry counts only</Chip>}
      </div>
      <AccessEditor key={person.id} person={person} areas={data.areas} presets={data.presets} />
    </Card>
  );
}

/** Everybody at a glance: one row per person, one column per area, the level in each cell. */
function Glance({ data, people }: { data: TeamAccess; people: AccessPerson[] }) {
  const columns: Column<AccessPerson>[] = [
    {
      key: "who",
      head: "Person",
      sort: (p) => p.name.toLowerCase(),
      /* The cells show the access stored for them, a switched-off person's too: the row says it does not apply today. */
      cell: (p) => <Who name={p.name} sub={p.revoked ? `Switched off · ${p.role.label}` : p.role.label} />,
    },
    ...data.areas.map(
      (a): Column<AccessPerson> => ({
        key: a.key,
        head: <span title={a.label}>{a.label}</span>,
        align: "center",
        cell: (p) => {
          const l = p.areas[a.key] ?? "none";
          const partly = a.pages.some((pg) => p.overridden.includes(pg.key));
          return <span className={`dk-team-cell dk-team-cell--${l}`}>{GLYPH[l]}{partly ? "*" : ""}</span>;
        },
      }),
    ),
  ];
  return (
    <Card title="Everyone at a glance" icon="grid" sub="Each person's level in each area. * means some of that area's pages are set on their own." flush>
      <Table caption="Access by person and area" rows={people} rowKey={(p) => p.id} rowHref={(p) => `/team/access?person=${p.id}`} keepScroll columns={columns} minWidth={1400} className="dk-team-glance" />
    </Card>
  );
}
