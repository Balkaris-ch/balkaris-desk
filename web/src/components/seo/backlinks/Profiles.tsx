import type { NapCell, ProfileLine, SeoBacklinksPayload } from "@/contract/seo/backlinks";
import { Badge, Chip } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Table, type Column } from "@/components/ui/Table";
import { Tooltip } from "@/components/ui/Tooltip";
import { DASH, ago, fullDate, shortDate } from "@/lib/format";
import { CheckProfile, FoundChoice, RunJob } from "./Act";
import { AddProfile, EditProfile } from "./Forms";
import { exportHref, hrefWith, KIND_ICON, KIND_LABEL, paramsOf, STATE_LABEL, STATE_TONE, taskAnchor, taskTitle, variantTone } from "./look";

type Field = "name" | "address" | "phone";

/**
 * "Profiles and listings": the registry the SEO audit seeded, with what
 * people on the desk added and corrected, what the weekly check found at each
 * address, and the name, address and phone each one states side by side. The
 * point is consistency: a letter marks each value, the same letter the same
 * value, so a second spelling of the address stands out in its column; once
 * the owner recorded the one true values, each cell says whether it is the
 * same. A row can be changed (its address, what it states), asked now, or,
 * when the weekly check found an address for it, confirmed or dismissed.
 */
export function Profiles({ data, range }: { data: SeoBacklinksPayload; range: string }) {
  const p = data.profiles;
  const job = data.presenceJob;
  const base = paramsOf(range, data.asked);
  const groups = data.nap.state === "ok" ? data.nap.value.groups : [];
  const only = (field: Field): boolean => (groups.find((g) => g.field === field)?.variants.length ?? 0) <= 1;
  const blocked = !job ? "The desk has no profile check on this machine." : !job.ready ? "The check cannot run yet." : !job.enabled ? "The owner switched the weekly check off in Automations." : job.running ? "The check is running now." : null;

  return (
    <Card
      title="Profiles and listings"
      count={p.state === "ok" ? p.value.rows.length : undefined}
      sub="Where the studio exists off its own site, and the name, address and phone each place states."
      info="The registry comes from the SEO audit; people on the desk add rows and correct them. Once a week the desk asks every address it knows, politely and under its own name: the page names the profile (exists), answers 404 or the network's own “not available” screen (not found), or cannot be read (Google Maps and some networks refuse plain requests). Name, address and phone are read from the profile where the check can; otherwise they are what a person saw there, marked with who and the day."
      className="dk-seo-bl-profiles"
      flush
      right={
        <div className="dk-seo-bl-tools">
          <AddProfile />
          <RunJob job="seo-presence" label="Check profiles now" title="Ask each known profile address now whether it shows the profile, three seconds apart, under the desk's name. Takes about a minute." disabled={!!blocked} why={blocked} />
          {p.state === "ok" ? (
            <LinkButton href={exportHref(range, data.asked, "profiles")} icon="download" size="sm" title="Download every profile with what it states, as CSV">
              Export
            </LinkButton>
          ) : null}
        </div>
      }
      footer={
        p.state === "ok" ? (
          <div className="dk-seo-bl-foot">
            <Stamp reading={p} />
            {job ? (
              <span className="dk-seo-bl-quiet">
                {job.running ? "Checking now." : job.lastEnd ? `Last check ${ago(job.lastEnd)}${job.lastNote ? `: ${job.lastNote}` : ""}.` : "Not checked yet."}
                {job.nextRun && job.enabled && !job.running ? ` Next ${fullDate(job.nextRun)}.` : ""}
              </span>
            ) : null}
          </div>
        ) : undefined
      }
    >
      {p.state === "ok" ? (
        <Table caption="Profiles and listings" className="dk-seo-bl-table dk-seo-bl-ptable" rows={p.value.rows} rowKey={(r) => r.key} density="roomy" minWidth={1180} columns={columns(base, only)} />
      ) : (
        <Absent reading={p} className="dk-seo-bl-absent" />
      )}
    </Card>
  );
}

function Cell({ cell, only }: { cell: NapCell | null; only: boolean }) {
  if (!cell) return <span className="dk-seo-bl-quiet">{DASH}</span>;
  const whose = cell.read ? null : cell.by && cell.by !== "audit" ? cell.by : "audit";
  return (
    <span className="dk-seo-bl-nap">
      <Chip tone={variantTone(cell.variant, only, cell.match)} className="dk-seo-bl-variant">
        {cell.variant}
      </Chip>
      <span className="dk-seo-bl-nap-value" title={cell.value}>
        {cell.value}
      </span>
      {cell.match === false ? (
        <Tooltip text="Not the agreed value: this place should be changed to it.">
          <span className="dk-seo-bl-seen dk-seo-bl-seen--bad" tabIndex={0}>
            differs
          </span>
        </Tooltip>
      ) : null}
      {whose ? (
        <Tooltip text={whose === "audit" ? `What the SEO audit saw on the profile on ${fullDate(cell.day)}. The weekly check could not read this field from the profile itself.` : `As ${whose} entered it on ${fullDate(cell.day)}: what a person saw on the profile, not a reading.`}>
          <span className="dk-seo-bl-seen" tabIndex={0}>
            {whose === "audit" ? "audit" : "entered"}
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}

function Status({ r }: { r: ProfileLine }) {
  return (
    <span className="dk-seo-bl-state">
      <Tooltip text={`${r.stateWhy || STATE_LABEL[r.state]}${r.http ? ` (last answer ${r.http})` : ""}`}>
        <span tabIndex={0}>
          <Badge tone={STATE_TONE[r.state]} dot>
            {STATE_LABEL[r.state]}
          </Badge>
        </span>
      </Tooltip>
      <span className="dk-seo-bl-quiet">{r.checkedAt ? `checked ${shortDate(r.checkedAt)}` : r.url ? "not checked yet" : "no address to check"}</span>
      {r.found ? (
        <span className="dk-seo-bl-found">
          <span className="dk-seo-bl-quiet">
            Found {shortDate(r.found.day)}: {r.found.what}{" "}
            <Go href={r.found.url} className="dk-seo-bl-link">
              Open it
            </Go>
          </span>
          <FoundChoice profileKey={r.key} />
        </span>
      ) : null}
    </span>
  );
}

function columns(base: Record<string, string>, only: (f: Field) => boolean): Column<ProfileLine>[] {
  return [
    {
      key: "profile",
      head: "Profile",
      cell: (r) => (
        <span className="dk-seo-bl-site">
          <span className="dk-seo-bl-kind" aria-hidden>
            <Icon name={KIND_ICON[r.kind]} size={15} />
          </span>
          <span className="dk-seo-bl-site-text">
            {r.url ? (
              <Go href={r.url} className="dk-seo-bl-host dk-seo-bl-host--out" title={`Open ${r.url} in a new tab`}>
                <span>{r.name}</span>
                <Icon name="external" size={12} />
              </Go>
            ) : (
              <span className="dk-seo-bl-host dk-seo-bl-host--none">{r.name}</span>
            )}
            <span className="dk-seo-bl-quiet">
              {KIND_LABEL[r.kind]}
              {r.source === "person" ? " · added on the desk" : ""}
            </span>
          </span>
        </span>
      ),
    },
    { key: "state", head: "Status", width: "168px", cell: (r) => <Status r={r} /> },
    { key: "name", head: "Name", cell: (r) => <Cell cell={r.shown.name} only={only("name")} /> },
    { key: "address", head: "Address", cell: (r) => <Cell cell={r.shown.address} only={only("address")} /> },
    { key: "phone", head: "Phone", cell: (r) => <Cell cell={r.shown.phone} only={only("phone")} /> },
    {
      key: "task",
      head: "Owner step",
      cell: (r) =>
        r.task ? (
          <Go href={hrefWith(base, { task: r.task.id }, taskAnchor(r.task.id))} className="dk-seo-bl-step" title="Open this step under “Needs you”">
            {r.task.done ? <Icon name="check-circle" size={13} /> : <Icon name="arrow-right" size={13} />}
            <span className="dk-seo-bl-clip">{taskTitle(r.task.title)}</span>
          </Go>
        ) : (
          <span className="dk-seo-bl-quiet">{DASH}</span>
        ),
    },
    {
      key: "act",
      head: "Action",
      align: "right",
      width: "164px",
      cell: (r) => (
        <span className="dk-seo-bl-pair">
          <CheckProfile profileKey={r.key} name={r.name} disabled={r.url ? null : "No address to ask: give it one with Change."} />
          <EditProfile row={r} />
        </span>
      ),
    },
  ];
}
