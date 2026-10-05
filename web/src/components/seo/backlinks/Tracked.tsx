import type { KnownLink, LinkState, SeoBacklinksPayload } from "@/contract/seo/backlinks";
import { Badge, Chip } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Table, type Column } from "@/components/ui/Table";
import { Tooltip } from "@/components/ui/Tooltip";
import { DASH, ago, fullDate, num, shortDate } from "@/lib/format";
import { LinkActions, RunJob } from "./Act";
import { CheckLink } from "./Check";
import { FollowLink } from "./Forms";
import { exportHref, LINK_STATE, ORIGIN_LABEL, shortUrl } from "./look";

const ORDER: LinkState[] = ["live", "lost", "waiting", "unreadable", "not-checked"];

/**
 * "Links you follow": the link building the owner steps describe (a client's
 * credit, a directory profile, a page that promised a link), read by the desk
 * itself once a week. At the top, "Check a page for a link" reads any public
 * page now. "New" and "lost" are the desk's own readings: the link was on the
 * page, and a later reading no longer found it. A page that could not be read
 * is unknown, never lost.
 */
export function Tracked({ data, range }: { data: SeoBacklinksPayload; range: string }) {
  const t = data.tracked;
  const job = data.linksJob;
  const blocked = !job ? "The desk has no such job on this machine." : !job.ready ? "The job cannot run yet." : !job.enabled ? "The owner switched it off in Automations." : job.running ? "It is running now." : null;
  const every = t.state === "ok" ? ORDER.reduce((n, s) => n + t.value.counts[s], 0) : 0;
  return (
    <Card
      id="bl-links"
      title="Links you follow"
      icon="eye"
      count={t.state === "ok" ? num(t.value.rows.length) : undefined}
      sub="Check any page for a link to the website, and follow the ones you are working on: the desk reads them every week."
      info="The desk reads a page as a search engine would without JavaScript: after the site's robots.txt allowed it, under the desk's name, at most 20 pages an hour for one person and 60 for the whole desk. Every link to the website on it is listed with its words and whether it is followed (the link's rel, and the page's robots tag). A page it cannot read is said to be unreadable, never lost."
      className="dk-seo-bl-links"
      flush
      right={
        <div className="dk-seo-bl-tools">
          <FollowLink />
          {every ? (
            <LinkButton href={exportHref(range, data.asked, "links")} icon="download" size="sm" title="Every linking page any source names, with what the desk's reading found, as CSV">
              Export
            </LinkButton>
          ) : null}
        </div>
      }
      footer={
        <div className="dk-seo-bl-foot">
          {t.state === "ok" ? <Stamp reading={t} /> : null}
          {job ? (
            <span className="dk-seo-bl-quiet">
              {job.running ? "Reading now." : job.lastEnd ? `Last read ${ago(job.lastEnd)}${job.lastNote ? `: ${job.lastNote}` : ""}.` : "Not run yet."}
              {job.nextRun && job.enabled && !job.running ? ` Next ${fullDate(job.nextRun)}.` : ""}
            </span>
          ) : null}
          <RunJob
            job="seo-backlinks"
            label="Read links now"
            title="Read GA4's referring addresses, and read again every followed or known linking page not read this week (at most 40, robots.txt first). Takes a minute or two."
            disabled={!!blocked}
            why={blocked}
          />
        </div>
      }
    >
      <div className="dk-seo-bl-links-check">
        <CheckLink />
      </div>
      {t.state === "ok" ? (
        <>
          {every ? (
            <p className="dk-seo-bl-links-counts">
              {ORDER.filter((s) => t.value.counts[s]).map((s) => (
                <Chip key={s} tone={LINK_STATE[s].tone}>
                  {LINK_STATE[s].label}: {num(t.value.counts[s])}
                </Chip>
              ))}
              <span className="dk-seo-bl-quiet">
                over every linking page the desk keeps ({num(every)}); in the period {num(t.value.fresh)} found, {num(t.value.lost)} lost
              </span>
            </p>
          ) : null}
          <Table
            caption="Links you follow"
            className="dk-seo-bl-table"
            rows={t.value.rows}
            rowKey={(l) => String(l.id)}
            density="roomy"
            minWidth={880}
            empty="You follow no link yet. Check a page above and follow it, or add one with “Follow a link”: a client's credits, a directory profile, a page that promised a link."
            columns={columns}
          />
        </>
      ) : (
        <Absent reading={t} className="dk-seo-bl-absent" />
      )}
    </Card>
  );
}

const columns: Column<KnownLink>[] = [
  {
    key: "page",
    head: "Page",
    cell: (l) => (
      <span className="dk-seo-bl-site-text">
        <Go href={l.source} className="dk-seo-bl-host dk-seo-bl-clip" title={l.source}>
          {shortUrl(l.source)}
        </Go>
        <span className="dk-seo-bl-quiet">{l.note ?? l.origins.map((o) => ORIGIN_LABEL[o]).join(" · ")}</span>
      </span>
    ),
  },
  {
    key: "state",
    head: "State",
    width: "150px",
    cell: (l) => (
      <span className="dk-seo-bl-state">
        <Tooltip text={l.stateWhy ?? (l.state === "live" ? "The desk found the link on the page." : LINK_STATE[l.state].label)}>
          <span tabIndex={0}>
            <Badge tone={LINK_STATE[l.state].tone} dot>
              {LINK_STATE[l.state].label}
            </Badge>
          </span>
        </Tooltip>
        <span className="dk-seo-bl-quiet">{l.checkedAt ? `read ${shortDate(l.checkedAt)}` : "not read yet"}</span>
      </span>
    ),
  },
  {
    key: "link",
    head: "Link",
    width: "26%",
    cell: (l) =>
      l.state === "live" || l.state === "lost" ? (
        <span className="dk-seo-bl-site-text">
          <span className="dk-seo-bl-clip" title={l.anchor ?? undefined}>
            {l.anchor ? `“${l.anchor}”` : "no words"}
          </span>
          <span className="dk-seo-bl-quiet">
            to {l.target ?? DASH}
            {l.rel ? (l.rel.some((r) => r === "nofollow" || r === "sponsored" || r === "ugc") ? ` · ${l.rel.join(", ")}` : " · followed") : ""}
          </span>
        </span>
      ) : (
        <span className="dk-seo-bl-quiet">{DASH}</span>
      ),
  },
  {
    key: "dates",
    head: "Found · lost",
    width: "120px",
    cell: (l) => (
      <span className="dk-seo-bl-first">
        <span>{l.firstLive ? shortDate(l.firstLive) : DASH}</span>
        <span className="dk-seo-bl-quiet">{l.lostAt ? `lost ${shortDate(l.lostAt)}` : `since ${shortDate(l.firstSeen)}`}</span>
      </span>
    ),
  },
  { key: "act", head: "Action", align: "right", width: "220px", cell: (l) => (l.id !== null ? <LinkActions id={l.id} tracked={l.tracked} /> : null) },
];
