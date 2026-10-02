import type { Me, Reading } from "@/contract/common";
import type { SettingsAccess, SettingsPeople } from "@/contract/settings";
import { Avatar } from "@/components/ui/Avatar";
import { Badge, Chip } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Grid } from "@/components/ui/Grid";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Table } from "@/components/ui/Table";
import { Facts } from "./parts";

const KNOWN = { google: "Google sign-in", telegram: "the Telegram bot", both: "Google sign-in and the Telegram bot" } as const;

function YouCard({ me, people, access }: { me: Me; people: Reading<SettingsPeople>; access: Reading<SettingsAccess> }) {
  const mine = people.state === "ok" ? people.value.people.find((p) => p.you) : undefined;
  const dev = access.state === "ok" && access.value.devDoor;
  return (
    <Card title="Signed in" icon="user" right={<Stamp reading={people} />}>
      <div className="dk-settings-owner">
        <Avatar name={me.name} size="lg" />
        <span className="dk-settings-who-text">
          <span className="dk-settings-owner-name">{me.name}</span>
          <span className="dk-settings-who-sub">{me.email ?? "No address yet"}</span>
        </span>
      </div>
      <div className="dk-settings-chips">
        {me.owner ? <Chip tone="violet">Owner</Chip> : null}
        {me.canPublish ? <Chip tone="good">Can publish</Chip> : <Chip tone="warn">Cannot publish: no address</Chip>}
        {me.seesLeads ? <Chip tone="good">Sees enquiries</Chip> : <Chip>Enquiry counts only</Chip>}
      </div>
      <Facts
        items={[
          dev
            ? {
                label: "Signed in by",
                value: "This development copy, by itself",
                note: "A copy on a workstation lets a visitor in as the address in DESK_DEV_USER. The real desk has no such door: there it is Google every time.",
              }
            : {
                label: "Signing in",
                value: "With Google",
                note: `The only way in. A session started with the retired one-time Telegram link still runs out its ${access.state === "ok" ? `${access.value.sessionDays} days` : "time"}.`,
              },
          mine ? { label: "The desk knows you through", value: KNOWN[mine.knownBy] } : null,
          mine?.telegram ? { label: "Telegram id", value: <span className="dk-num">{mine.telegram}</span> } : null,
        ]}
      />
      <form method="post" action="/logout" className="dk-settings-signout">
        <Button type="submit" icon="logout" size="sm">
          Sign out
        </Button>
      </form>
    </Card>
  );
}

function HowCard({ access }: { access: Reading<SettingsAccess> }) {
  return (
    <Card title="How signing in works" icon="lock" right={<Stamp reading={access} />}>
      <Read reading={access}>
        {(a) => (
          <Facts
            items={[
              {
                label: "Who gets in",
                value: `Google accounts of @${a.domain}, nothing else`,
                note: "The domain is checked on the claim Google signs, not on the button, so a personal account cannot be carried through the account picker.",
              },
              a.googleClient
                ? { label: "Google sign-in", value: <Badge tone="good" dot>Set up on this server</Badge> }
                : {
                    label: "Google sign-in",
                    value: <Badge tone={a.devDoor ? "quiet" : "bad"} dot>Not set up on this server</Badge>,
                    note: a.devDoor
                      ? "This development copy signs a visitor in by itself instead."
                      : "Nobody can sign in until GOOGLE_OAUTH_FILE in the server's configuration points at the Web client file Google gives.",
                  },
              { label: "A session lasts", value: `${a.sessionDays} days`, note: "Then Google again. There are no passwords anywhere on the desk." },
              a.sessionSecret === "own"
                ? { label: "Sessions are signed with", value: "The desk's own secret" }
                : {
                    label: "Sessions are signed with",
                    value: <Badge tone="warn" dot>The runner&apos;s secret</Badge>,
                    note: "Until the owner gives the desk a secret of its own: the step is under Sources.",
                  },
              {
                label: "Switched off",
                value: "Refused everywhere",
                note: "Every page and every API answer refuses a switched-off person, whatever their session. Only signing out still works. Google sign-in finds a person by their address, so a switched-off person's address cannot be changed or removed here.",
              },
              {
                label: "Changes",
                value: "Only from the desk's own pages",
                note: "A request that changes something and names another site, even another balkaris.ch one, or none, is refused.",
              },
            ]}
          />
        )}
      </Read>
    </Card>
  );
}

interface Right {
  what: string;
  who: string;
  how: string;
}

function RightsCard({ access }: { access: Reading<SettingsAccess> }) {
  return (
    <Card title="Who may do what" icon="key" sub="As the server enforces it on every request, not as a page shows it." right={<Stamp reading={access} />} flush>
      <Read reading={access}>
        {(a) => {
          const n = a.counts;
          const rows: Right[] = [
            { what: "Open every screen and its figures", who: "Everyone signed in who is not switched off", how: `${n.active} of ${n.people}` },
            { what: "Refresh a source now", who: "Everyone signed in; a second ask within minutes is refused, so a source is not hammered", how: `${n.active} of ${n.people}` },
            { what: "Publish an article", who: "Everyone with an address for publishing", how: `${n.publish} of ${n.people}` },
            { what: "Read enquiries: names, contact details, messages", who: "The owner, and the people the owner allows", how: `${n.leads} of ${n.people}` },
            { what: "Change people, access and enquiry rights", who: "The owner only", how: "1" },
            { what: "Switch scheduled jobs off or on", who: "The owner only", how: "1" },
            { what: "Become the owner", who: "Nobody from the desk: DESK_OWNER in the server's configuration", how: "—" },
          ];
          return (
            <Table
              caption="Rights"
              rows={rows}
              rowKey={(r) => r.what}
              minWidth={640}
              columns={[
                { key: "what", head: "What", cell: (r) => <span className="dk-settings-wrap dk-settings-strong">{r.what}</span> },
                { key: "who", head: "Who", cell: (r) => <span className="dk-settings-wrap">{r.who}</span> },
                { key: "how", head: "People", numeric: true, width: "90px", cell: (r) => r.how },
              ]}
            />
          );
        }}
      </Read>
      {access.state === "ok" && access.value.counts.off ? (
        <p className="dk-settings-foot dk-settings-foot--inset">
          {access.value.counts.off} switched off: they can sign in and nothing opens for them.
        </p>
      ) : null}
    </Card>
  );
}

/** SESSION AND ACCESS: who is looking, how anybody gets in, and who may do what. */
export function AccessSection({ me, people, access }: { me: Me; people: Reading<SettingsPeople>; access: Reading<SettingsAccess> }) {
  return (
    <>
      <Grid cols="1fr 1.35fr">
        <YouCard me={me} people={people} access={access} />
        <HowCard access={access} />
      </Grid>
      <RightsCard access={access} />
    </>
  );
}

