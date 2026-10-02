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
import { CheckProfiles } from "./Act";
import { exportHref, hrefWith, KIND_ICON, KIND_LABEL, paramsOf, STATE_LABEL, STATE_TONE, taskAnchor, taskTitle, variantTone } from "./look";

/**
 * "Profiles and listings": the registry the SEO audit seeded, with what the
 * weekly check found at each address, and the name, address and phone each
 * one states side by side. The point is consistency: a letter marks each
 * value, the same letter the same value, so a second spelling of the address
 * stands out in its column. A listing that does not exist yet carries the
 * owner step that creates it.
 */
export function Profiles({ data, range }: { data: SeoBacklinksPayload; range: string }) {
  const p = data.profiles;
  const job = data.presenceJob;
  const base = paramsOf(range, data.asked);
  const only = (field: "name" | "address" | "phone"): boolean => (data.nap.state === "ok" ? (data.nap.value.groups.find((g) => g.field === field)?.variants.length ?? 0) <= 1 : true);
  const blocked = !job ? "The desk has no profile check on this machine." : !job.ready ? "The check cannot run yet." : !job.enabled ? "The owner switched the weekly check off in Automations." : job.running ? "The check is running now." : null;

  return (
    <Card
      title="Profiles and listings"
      count={p.state === "ok" ? p.value.rows.length : undefined}
      sub="Where the studio exists off its own site, and the name, address and phone each place states."
      info="The registry comes from the SEO audit. Once a week the desk asks every address it knows, politely and under its own name: it answered with the profile (exists), answered 404 (not found), or could not be read (Google Maps and some networks refuse plain requests). A listing with no address keeps the audit's finding until it has one. Name, address and phone are read from the profile where the check can; otherwise they are what the audit saw, marked with its day."
      className="dk-seo-bl-profiles"
      flush
      right={
        <div className="dk-seo-bl-tools">
          <CheckProfiles disabled={!!blocked} why={blocked} />
          <LinkButton href={exportHref(range, data.asked, "profiles")} icon="download" size="sm" title="Download every profile with what it states, as CSV">
            Export
          </LinkButton>
        </div>
      }
      footer={
        p.state === "ok" ? (
          <div className="dk-seo-bl-foot">
            <Stamp reading={p} />
            {job ? (
              <span className="dk-seo-bl-quiet">
                {job.lastEnd ? `Last check ${ago(job.lastEnd)}${job.lastNote ? `: ${job.lastNote}` : ""}.` : "Not checked yet."}
                {job.nextRun && job.enabled ? ` Next ${fullDate(job.nextRun)}.` : ""}
              </span>
            ) : null}
          </div>
        ) : undefined
      }
    >
      {p.state === "ok" ? (
        <Table
          caption="Profiles and listings"
          className="dk-seo-bl-table dk-seo-bl-ptable"
          rows={p.value.rows}
          rowKey={(r) => r.key}
          density="roomy"
          minWidth={1040}
          columns={columns(base, only)}
        />
      ) : (
        <Absent reading={p} className="dk-seo-bl-absent" />
      )}
    </Card>
  );
}

function Cell({ cell, only }: { cell: NapCell | null; only: boolean }) {
  if (!cell) return <span className="dk-seo-bl-quiet">{DASH}</span>;
  return (
    <span className="dk-seo-bl-nap">
      <Chip tone={variantTone(cell.variant, only)} className="dk-seo-bl-variant">
        {cell.variant}
      </Chip>
      <span className="dk-seo-bl-nap-value" title={cell.value}>
        {cell.value}
      </span>
      {cell.read ? null : (
        <Tooltip text={`What the SEO audit saw on the profile on ${fullDate(cell.day)}. The weekly check could not read this field from the profile itself.`}>
          <span className="dk-seo-bl-seen" tabIndex={0}>
            audit
          </span>
        </Tooltip>
      )}
    </span>
  );
}

function columns(base: Record<string, string>, only: (f: "name" | "address" | "phone") => boolean): Column<ProfileLine>[] {
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
            <span className="dk-seo-bl-quiet">{KIND_LABEL[r.kind]}</span>
          </span>
        </span>
      ),
    },
    {
      key: "state",
      head: "Status",
      width: "128px",
      cell: (r) => (
        <span className="dk-seo-bl-state">
          <Tooltip text={r.stateWhy || STATE_LABEL[r.state]}>
            <span tabIndex={0}>
              <Badge tone={STATE_TONE[r.state]} dot>
                {STATE_LABEL[r.state]}
              </Badge>
            </span>
          </Tooltip>
          <span className="dk-seo-bl-quiet">{r.checkedAt ? `checked ${shortDate(r.checkedAt)}` : r.url ? "not checked yet" : "no address to check"}</span>
        </span>
      ),
    },
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
  ];
}
