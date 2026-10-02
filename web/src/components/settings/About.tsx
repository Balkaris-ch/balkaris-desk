import type { Reading } from "@/contract/common";
import type { SettingsServer, SettingsVersions } from "@/contract/settings";
import { ActionList } from "@/components/ui/ActionList";
import { Card } from "@/components/ui/Card";
import { Grid } from "@/components/ui/Grid";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { ago, bytes, duration, fullDate, num, percent } from "@/lib/format";
import { Code, Facts } from "./parts";

function VersionsCard({ versions }: { versions: Reading<SettingsVersions> }) {
  return (
    <Card title="Versions" icon="package" right={<Stamp reading={versions} />}>
      <Read reading={versions}>
        {(v) => (
          <Facts
            items={[
              v.desk
                ? {
                    label: "The desk",
                    value: <Code>{v.desk.commit}</Code>,
                    note:
                      v.desk.from === "release"
                        ? `The release the server runs${v.desk.at ? `, installed ${ago(v.desk.at)} (${fullDate(v.desk.at)})` : ""}.`
                        : `A checkout on this machine${v.desk.at ? `, committed ${ago(v.desk.at)}` : ""}${v.desk.dirty ? ", with changes not committed yet" : ""}.`,
                  }
                : { label: "The desk", value: <span className="dk-settings-quiet">Not known</span>, note: "Neither a release folder nor a git checkout was found beside the server." },
              { label: "Node", value: <Code>{v.node}</Code>, note: "The desk server's." },
              v.next
                ? { label: "Next.js", value: <Code>{v.next.version}</Code>, note: v.next.installed ? "Installed, drawing these screens." : "Declared by the interface; not installed beside the server." }
                : null,
              v.react ? { label: "React", value: <Code>{v.react.version}</Code> } : null,
              v.hono ? { label: "Hono", value: <Code>{v.hono}</Code>, note: "The desk server's web framework." } : null,
              v.sqlite ? { label: "SQLite", value: <Code>{v.sqlite}</Code>, note: "The desk's one database file." } : null,
            ]}
          />
        )}
      </Read>
    </Card>
  );
}

function Used({ share, label }: { share: number; label: string }) {
  return <ProgressBar value={share} max={100} tone={share >= 90 ? "bad" : share >= 75 ? "warn" : "good"} label={label} />;
}

function ServerCard({ server }: { server: Reading<SettingsServer> }) {
  return (
    <Card
      title="Desk server"
      icon="server"
      sub="The machine the desk runs on, shared with the engine. Not the website's hosting: Vercel's machines are not visible from here."
      right={<Stamp reading={server} />}
    >
      <Read reading={server}>
        {(s) => (
          <Facts
            items={[
              { label: "Machine", value: `${s.hostname} · ${s.platform}`, note: `${num(s.cpus)} CPUs, up ${duration(s.uptime * 1000)}` },
              s.load
                ? {
                    label: "Load",
                    value: <span className="dk-num">{`${num(s.load.one, 2)} · ${num(s.load.five, 2)} · ${num(s.load.fifteen, 2)}`}</span>,
                    note: `Processes wanting a CPU over 1, 5 and 15 minutes, on ${num(s.cpus)} CPUs.`,
                  }
                : { label: "Load", value: <span className="dk-settings-quiet">Not kept here</span>, note: "Windows keeps no load average." },
              {
                label: "Memory",
                value: <span className="dk-num">{`${percent(s.memory.usedPercent, 0)} used`}</span>,
                note: (
                  <>
                    <Used share={s.memory.usedPercent} label="Memory used" />
                    {`${bytes(s.memory.available)} free of ${bytes(s.memory.total)}`}
                  </>
                ),
              },
              s.disk
                ? {
                    label: "Disk",
                    value: <span className="dk-num">{`${percent(s.disk.usedPercent, 0)} used`}</span>,
                    note: (
                      <>
                        <Used share={s.disk.usedPercent} label="Disk used" />
                        {`${bytes(s.disk.free)} free of ${bytes(s.disk.total)}, where the database lives`}
                      </>
                    ),
                  }
                : { label: "Disk", value: <span className="dk-settings-quiet">Not known</span>, note: "The system would not say." },
              {
                label: "The desk process",
                value: <span className="dk-num">{bytes(s.process.rss)}</span>,
                note: s.process.limit ? (
                  <>
                    <Used share={(s.process.rss / s.process.limit) * 100} label="Desk process memory against its limit" />
                    {`Of a ${bytes(s.process.limit)} limit. Running for ${duration(s.process.uptime * 1000)}; every deploy restarts it.`}
                  </>
                ) : (
                  `No memory limit set. Running for ${duration(s.process.uptime * 1000)}.`
                ),
              },
            ]}
          />
        )}
      </Read>
    </Card>
  );
}

function ConsoleCard() {
  return (
    <Card title="The old console" icon="terminal" sub="The pages the desk server draws itself, still there.">
      <ActionList
        columns={2}
        label="The old console"
        items={[
          { icon: "list", label: "The console", description: "Shared links, drafts and the queue, in plain HTML", href: "/console" },
          {
            icon: "users",
            label: "The old people page",
            description: "Address, byline, link and switch off in plain HTML, without the checks or the enquiry right this screen has",
            href: "/people",
          },
        ]}
      />
    </Card>
  );
}

/** ABOUT: what is running, and on what. */
export function AboutSection({ versions, server }: { versions: Reading<SettingsVersions>; server: Reading<SettingsServer> }) {
  return (
    <>
      <Grid cols="1fr 1.25fr">
        <VersionsCard versions={versions} />
        <ServerCard server={server} />
      </Grid>
      <ConsoleCard />
    </>
  );
}
