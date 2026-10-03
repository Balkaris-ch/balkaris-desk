import Link from "next/link";
import type { Reading } from "@/contract/common";
import type { SettingsPeople, SettingsPerson } from "@/contract/settings";
import { Avatar } from "@/components/ui/Avatar";
import { Badge, Chip } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Grid } from "@/components/ui/Grid";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Table, type Column } from "@/components/ui/Table";
import { ago, fullDate } from "@/lib/format";
import { Code, Facts, Prose } from "./parts";
import { PersonEdit } from "./PersonEdit";

const KNOWN: Record<SettingsPerson["knownBy"], string> = {
  google: "Google sign-in",
  telegram: "Telegram bot",
  both: "Google and Telegram",
};

function enquiries(p: SettingsPerson) {
  if (p.owner) return <Badge tone="good">Always, owner</Badge>;
  if (p.seesLeads) return <Badge tone="good">May see</Badge>;
  if (p.revoked && p.leadsGranted) return <Chip>Granted, while off: no</Chip>;
  /* The right is given and their access does not include Leads, where it would show (Team › Access & Roles). */
  if (p.leadsGranted) return <Chip>Granted, needs Leads</Chip>;
  return <span className="dk-settings-quiet">Counts only</span>;
}

function columns(view: SettingsPeople): Column<SettingsPerson>[] {
  const list: Column<SettingsPerson>[] = [
    {
      key: "person",
      head: "Person",
      sort: (p) => p.name.toLowerCase(),
      cell: (p) => (
        <span className="dk-settings-who">
          <Avatar name={p.name} size="sm" />
          <span className="dk-settings-who-text">
            <span className="dk-settings-who-name">
              {p.name}
              {p.you ? <Chip tone="good">You</Chip> : null}
              {p.owner ? <Chip tone="violet">Owner</Chip> : null}
            </span>
            <span className="dk-settings-who-sub">{p.email ?? "No address yet"}</span>
          </span>
        </span>
      ),
    },
    { key: "byline", head: "Byline", sort: (p) => p.byline, cell: (p) => <Code>{p.byline}</Code> },
    {
      key: "known",
      head: "Known through",
      sort: (p) => p.knownBy,
      cell: (p) => (
        <span className="dk-settings-who-text">
          <span>{KNOWN[p.knownBy]}</span>
          <span className="dk-settings-who-sub">{p.telegram ? <span className="dk-num">Telegram {p.telegram}</span> : "No Telegram id linked"}</span>
        </span>
      ),
    },
    {
      /* Access and publishing in one: a switched-off person cannot publish; anybody else can with an address and edit on Insights. With an address and still not publishing, it is the access, which is the owner's choice and no warning. */
      key: "status",
      head: "Access",
      sort: (p) => (p.revoked ? 0 : p.canPublish ? 2 : 1),
      cell: (p) =>
        p.revoked ? (
          <Badge tone="bad" dot>
            Switched off
          </Badge>
        ) : p.canPublish ? (
          <Badge tone="good" dot>
            Can publish
          </Badge>
        ) : p.email ? (
          <Badge tone="quiet" dot>
            Active, does not publish
          </Badge>
        ) : (
          <Badge tone="warn" dot>
            Active, no address
          </Badge>
        ),
    },
    { key: "leads", head: "Enquiries", sort: (p) => (p.seesLeads ? 1 : 0), cell: enquiries },
  ];
  if (view.canEdit) {
    list.push(
      {
        key: "seen",
        head: "Last sign-in",
        sort: (p) => p.lastSignIn,
        cell: (p) =>
          p.lastSignIn ? (
            <time dateTime={p.lastSignIn} title={fullDate(p.lastSignIn)} suppressHydrationWarning>
              {ago(p.lastSignIn)}
            </time>
          ) : (
            <span className="dk-settings-quiet">Not in the log</span>
          ),
      },
      { key: "edit", head: <span className="dk-sr">Change</span>, align: "right", cell: (p) => <PersonEdit person={p} linkable={view.linkable} /> },
    );
  }
  return list;
}

/** PEOPLE: everyone the desk knows, and who may do what. The owner edits in place; everyone else reads. */
export function PeopleSection({ people, domain }: { people: Reading<SettingsPeople>; domain: string }) {
  return (
    <>
      <Card
        title="Team"
        icon="users"
        count={people.state === "ok" ? people.value.people.length : undefined}
        sub="Everyone the desk knows, from signing in with Google and from writing to the Telegram bot."
        right={<Stamp reading={people} />}
        flush
        footer={
          people.state === "ok" ? (
            <p className="dk-settings-foot">
              {people.value.canEdit ? (
                <>
                  You are the owner: Edit changes a person&apos;s address, byline, enquiry right and access. What each person may see, area by area, is under{" "}
                  <Link href="/team/access" prefetch={false} className="dk-settings-strong">
                    Team › Access &amp; Roles
                  </Link>
                  . Every change is checked on the server and written to the activity feed. Google sign-in finds a person by their address, so a switched-off person&apos;s address stays as it is.
                </>
              ) : (
                "You can see the team. Only the owner changes addresses, bylines and access."
              )}
            </p>
          ) : undefined
        }
      >
        <Read reading={people}>
          {(v) => (
            <Table
              caption="People"
              rows={v.people}
              rowKey={(p) => p.id}
              columns={columns(v)}
              density="roomy"
              minWidth={v.canEdit ? 900 : 760}
              empty="Nobody has signed in or written to the bot yet."
              className={v.canEdit ? "dk-settings-people dk-settings-people--edit" : "dk-settings-people"}
            />
          )}
        </Read>
      </Card>

      <Grid cols="1fr 1fr 1fr">
        <Card title="Owner" icon="shield" right={<Stamp reading={people} />}>
          <Read reading={people}>
            {(v) => (
              <>
                <div className="dk-settings-owner">
                  <Avatar name={v.owner.name ?? v.owner.email} size="lg" />
                  <span className="dk-settings-who-text">
                    <span className="dk-settings-owner-name">{v.owner.name ?? "Not signed in yet"}</span>
                    <span className="dk-settings-who-sub">{v.owner.email}</span>
                  </span>
                </div>
                <Prose>
                  <p>
                    Only the owner changes addresses, bylines, access and who may see enquiries. Ownership is the <Code>DESK_OWNER</Code> line in the server&apos;s configuration, the file <Code>/opt/balkaris-desk/.env</Code> on the box. It moves only by changing that file: never from the desk, and not even the owner can hand it over here.
                  </p>
                  <p>{v.canEdit ? "You are the owner." : "You can see the team and change nothing about it."}</p>
                </Prose>
              </>
            )}
          </Read>
        </Card>

        <Card title="Publishing needs an address" icon="send">
          <Prose>
            <p>
              Signing in is a <b>@{domain}</b> Google account and nothing else. Publishing commits to the website under the person&apos;s address, and that is what makes Vercel
              build it: the address must be the one on their Vercel account, or the deployment is refused and the article sits on main doing nothing.
            </p>
            <p>
              A person can appear twice, once from signing in and once from writing to the bot, until the owner links the two. The byline on an article is whoever <b>shared</b>{" "}
              it on Telegram.
            </p>
          </Prose>
        </Card>

        <Card title="May see enquiries" icon="lock">
          <Prose>
            <p>
              An enquiry is a stranger&apos;s personal data. Everybody with the Command Center, Conversions or Leads sees how many came in; the names, contact details and messages
              of people who wrote through the website are shown only to the owner and to the people the owner allows here, once they also have Leads. A switched-off person never
              sees them, and the desk stores nothing about an enquiry.
            </p>
          </Prose>
          <Read reading={people} form="inline">
            {(v) => (
              <Facts
                items={[
                  { label: "May see them now", value: `${v.people.filter((p) => p.seesLeads).length} of ${v.people.length}` },
                  { label: "Counts only", value: `${v.people.filter((p) => !p.seesLeads && !p.revoked).length}` },
                ]}
              />
            )}
          </Read>
        </Card>
      </Grid>
    </>
  );
}
