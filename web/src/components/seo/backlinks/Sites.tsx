import type { Reading } from "@/contract/common";
import type { LinkingSite, SeoBacklinksPayload, SitesFrom, SitesSort } from "@/contract/seo/backlinks";
import { Chip } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Delta } from "@/components/ui/Delta";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { Select } from "@/components/ui/Select";
import { Stamp } from "@/components/ui/Stamp";
import { Table, type Column } from "@/components/ui/Table";
import { Tooltip } from "@/components/ui/Tooltip";
import { cx } from "@/lib/cx";
import { DASH, fullDate, num, shortDate } from "@/lib/format";
import { BASE, exportHref, FROM_LABEL, paramsOf, SITE_KIND, SORT_LABEL } from "./look";

const FIND = "dk-seo-bl-find";
const FROMS: SitesFrom[] = ["all", "links", "visits", "ai", "views"];
const SORTS: SitesSort[] = ["visits", "links", "newest", "domain"];
const BY: Record<NonNullable<LinkingSite["firstSeen"]>["by"], string> = { bing: "Bing", ga4: "GA4", "vercel-drain": "Vercel" };

type Absentable = Exclude<Reading<unknown>, { state: "ok" }>;

/**
 * "Linking sites" (board 113, panel 6): one row per site that links to the
 * website or sent it visitors, with what each source says about it, the
 * search, the source and order selects, and the CSV.
 *
 * The board's columns, with what is true in them: Links and Anchor text are
 * Bing's (absent with the step until Bing Webmaster is connected); Visits
 * are GA4's sessions in the period (consenting visitors only); Page views
 * are Vercel's own records (every visitor, once the log drain delivers).
 * There is no "DR" and no "Follow" column: no free source gives an honest
 * domain rating, and Bing's link list does not say whether a link is
 * followed.
 */
export function Sites({ data, range }: { data: SeoBacklinksPayload; range: string }) {
  const asked = data.asked;
  const base = paramsOf(range, asked);
  const sites = data.sites;
  const counts = sites.state === "ok" ? sites.value.counts : null;
  const bingAbsent: Absentable | null = data.bing.state === "ok" ? null : data.bing;
  const drainAbsent: Absentable | null = data.drain.state === "ok" ? null : data.drain;
  const ga4Absent: Absentable | null = data.referrers.state === "ok" ? null : data.referrers;
  const fromLabel = (f: SitesFrom): string => {
    if (f === "links" && bingAbsent) return `${FROM_LABEL.links} (not connected)`;
    if (f === "views" && drainAbsent) return `${FROM_LABEL.views} (not delivering)`;
    return counts ? `${FROM_LABEL[f]} (${num(counts[f])})` : FROM_LABEL[f];
  };
  const filtered = !!asked.q || asked.from !== "all";
  const w = data.window;

  return (
    <>
      {/* The search box's own form; its field sits in the filter row (form="…"). */}
      <form id={FIND} method="get" action={BASE} hidden>
        {Object.entries(base)
          .filter(([k]) => k !== "q")
          .map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
      </form>
      <Card
        title="Linking sites"
        count={sites.state === "ok" ? num(sites.value.total) : undefined}
        sub={`Sites that link to the website (Bing) or sent it visitors (GA4, Vercel), ${shortDate(w.start)} – ${shortDate(w.end)}. One row per site.`}
        info={
          <>
            Every row is a site a source named; none is a sample. {sites.state === "ok" ? sites.value.leftOut : null} There is no domain rating and no follow or nofollow
            column: no free source gives either honestly.
          </>
        }
        className="dk-seo-bl-sites"
        flush
        right={
          <LinkButton href={exportHref(range, asked, "sites")} icon="download" size="sm" title="Download the table as filtered, every matching row, as CSV">
            Export
          </LinkButton>
        }
        footer={sites.state === "ok" ? <Foot data={data} /> : undefined}
      >
        <div className="dk-seo-bl-filters">
          <label className="dk-seo-bl-find">
            <Icon name="search" size={14} />
            <input form={FIND} type="search" name="q" defaultValue={asked.q} placeholder="Search sites…" aria-label="Search sites by address or name" maxLength={80} />
          </label>
          <Select param="from" label="Which sites, by source" fallback="all" options={FROMS.map((f) => ({ value: f, label: fromLabel(f) }))} />
          <Select param="sort" label="Order" fallback="visits" options={SORTS.map((s) => ({ value: s, label: SORT_LABEL[s] }))} />
        </div>
        {sites.state === "ok" ? (
          <Table
            caption="Sites that link to the website or sent it visitors"
            className="dk-seo-bl-table"
            rows={sites.value.rows}
            rowKey={(r) => r.host}
            density="roomy"
            minWidth={920}
            empty={
              asked.from === "links" && bingAbsent
                ? "Bing Webmaster is not connected, so no link is known yet: “Pages linked to” has the step that connects it."
                : asked.from === "views" && drainAbsent
                  ? "Vercel’s log drain does not deliver to the desk yet, so no page view by referring site is counted."
                  : filtered
                    ? "No site matches these filters."
                    : "No site linked to the website or sent it a visitor in this period, as far as the connected sources can tell. The steps under “Needs you” are how links begin."
            }
            columns={columns({ bingAbsent, ga4Absent, drainAbsent })}
          />
        ) : (
          <Absent reading={sites} className="dk-seo-bl-absent" />
        )}
        {sites.state === "ok" && !filtered && sites.value.total > 0 && sites.value.total < 5 ? (
          <p className="dk-seo-bl-few">
            <Icon name="info" size={14} />
            <span>
              {sites.value.total === 1 ? "One site so far." : `${num(sites.value.total)} sites so far.`} Links begin off the site: the listings, profiles and client credits under “Needs you”.
              {bingAbsent ? " Once Bing Webmaster is connected, every link Bing knows is listed here as well." : ""}
              {drainAbsent ? " Once Vercel’s log drain delivers, page views count too, from visitors who declined cookies as well." : ""}
            </span>
          </p>
        ) : null}
      </Card>
    </>
  );
}

function columns({ bingAbsent, ga4Absent, drainAbsent }: { bingAbsent: Absentable | null; ga4Absent: Absentable | null; drainAbsent: Absentable | null }): Column<LinkingSite>[] {
  return [
    {
      key: "site",
      head: "Site",
      cell: (r) => (
        <span className="dk-seo-bl-site">
          <span className={cx("dk-seo-bl-mono", `dk-seo-bl-mono--${r.kind}`)} aria-hidden>
            {r.host.charAt(0).toUpperCase()}
          </span>
          <span className="dk-seo-bl-site-text">
            <Go href={`https://${r.host}`} className="dk-seo-bl-host" title={`Open ${r.host} in a new tab`}>
              {r.host}
            </Go>
            {r.label ? <span className="dk-seo-bl-quiet">{r.label}</span> : null}
          </span>
        </span>
      ),
    },
    { key: "kind", head: "Kind", width: "120px", cell: (r) => <Chip tone={SITE_KIND[r.kind].tone}>{SITE_KIND[r.kind].label}</Chip> },
    {
      key: "links",
      head: "Links",
      numeric: true,
      width: "72px",
      cell: (r) =>
        r.links ? (
          <Tooltip text={`${num(r.links.count)} link${r.links.count === 1 ? "" : "s"} from ${num(r.links.pages)} page${r.links.pages === 1 ? "" : "s"} of ${r.host}, in Bing's index.`}>
            <span tabIndex={0}>{num(r.links.count)}</span>
          </Tooltip>
        ) : bingAbsent ? (
          <Absent reading={bingAbsent} form="inline" />
        ) : (
          DASH
        ),
    },
    {
      key: "anchor",
      head: "Anchor text",
      width: "15%",
      cell: (r) =>
        r.links?.anchor ? (
          <span className="dk-seo-bl-clip" title={r.links.anchor}>
            “{r.links.anchor}”
          </span>
        ) : r.links ? (
          <span className="dk-seo-bl-quiet">{r.links.count ? "no words" : DASH}</span>
        ) : bingAbsent ? (
          <Absent reading={bingAbsent} form="inline" />
        ) : (
          DASH
        ),
    },
    {
      key: "page",
      head: "Page on the site",
      width: "20%",
      cell: (r) => {
        const path = r.links?.target ?? r.visits?.landing ?? null;
        if (!path) return <span className="dk-seo-bl-quiet">{DASH}</span>;
        const what = r.links?.target ? "linked to (Bing)" : "landed on (GA4, most sessions)";
        return (
          <span className="dk-seo-bl-page">
            <Go href={`/seo/pages/view?path=${encodeURIComponent(path)}`} className="dk-seo-bl-clip dk-seo-bl-path" title={`${path}: ${what}. Open it in Page Optimization.`}>
              {path}
            </Go>
            <span className="dk-seo-bl-quiet">{what}</span>
          </span>
        );
      },
    },
    {
      key: "visits",
      head: "Visits",
      numeric: true,
      width: "104px",
      cell: (r) =>
        r.visits ? (
          <span className="dk-seo-bl-figure">
            <span>{num(r.visits.sessions)}</span>
            {r.visits.previous !== null ? <Delta value={r.visits.sessions} previous={r.visits.previous} size="sm" /> : null}
          </span>
        ) : ga4Absent ? (
          <Absent reading={ga4Absent} form="inline" />
        ) : (
          DASH
        ),
    },
    {
      key: "views",
      head: "Page views",
      numeric: true,
      width: "92px",
      cell: (r) => (r.views !== null ? num(r.views) : drainAbsent ? <Absent reading={drainAbsent} form="inline" /> : DASH),
    },
    {
      key: "first",
      head: "First seen",
      width: "112px",
      cell: (r) =>
        r.firstSeen ? (
          <span className="dk-seo-bl-first" title={`First counted by ${BY[r.firstSeen.by]} on ${fullDate(r.firstSeen.day)}`}>
            <span>{shortDate(r.firstSeen.day)}</span>
            <span className="dk-seo-bl-quiet">{BY[r.firstSeen.by]}</span>
          </span>
        ) : (
          DASH
        ),
    },
    {
      key: "action",
      head: "Action",
      align: "right",
      width: "84px",
      cell: (r) => (
        <LinkButton href={`https://${r.host}`} size="xs" icon="external" title={`Open ${r.host} in a new tab`}>
          View
        </LinkButton>
      ),
    },
  ];
}

/** Where the table's figures come from, each with its age. */
function Foot({ data }: { data: SeoBacklinksPayload }) {
  return (
    <div className="dk-seo-bl-foot">
      <span className="dk-seo-bl-foot-part">
        Links: {data.bing.state === "ok" ? <Stamp reading={data.bing} /> : <span className="dk-seo-bl-quiet">Bing Webmaster is not connected</span>}
      </span>
      <span className="dk-seo-bl-foot-part">
        Visits: {data.referrers.state === "ok" ? <Stamp reading={data.referrers} /> : <span className="dk-seo-bl-quiet">{data.referrers.reason}</span>}
      </span>
      <span className="dk-seo-bl-foot-part">
        Page views: {data.drain.state === "ok" ? <Stamp reading={data.drain} /> : <span className="dk-seo-bl-quiet">Vercel’s log drain does not deliver yet</span>}
      </span>
    </div>
  );
}
