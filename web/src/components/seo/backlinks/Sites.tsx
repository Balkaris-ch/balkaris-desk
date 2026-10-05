import type { Reading } from "@/contract/common";
import type { LinkingSite, SeoBacklinksPayload, SitesFrom } from "@/contract/seo/backlinks";
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
import { BASE, exportHref, FIRST_BY, FOLLOW, FROM_LABEL, FROMS, hrefWith, openHref, paramsOf, SITE_KIND, SORT_LABEL, SORTS, SOURCE_LABEL } from "./look";

const FIND = "dk-seo-bl-find";

type Absentable = Exclude<Reading<unknown>, { state: "ok" }>;

/**
 * "Linking sites" (board 113, panel 6): one row per site that links to the
 * website or sent it visitors, with what each source says about it, the
 * search, the source and order selects, a pager, and the CSV of every
 * matching row. "Details" opens one site (?open=) with every link and visit
 * behind its row.
 *
 * The board's columns, with what is true in them: Links is the largest count
 * any one source gives (the desk's own reading of the linking pages, Bing's
 * index, Google's export as imported), never a sum; Follow is read from the
 * linking pages themselves, by the desk; Visits are GA4's sessions in the
 * period (consenting visitors only); Page views are Vercel's own records.
 * There is no "DR": no free source gives an honest domain rating.
 */
export function Sites({ data, range }: { data: SeoBacklinksPayload; range: string }) {
  const asked = data.asked;
  const base = paramsOf(range, asked);
  const sites = data.sites;
  const counts = sites.state === "ok" ? sites.value.counts : null;
  const linksAbsent: Absentable | null = data.tiles.links.state === "ok" ? null : data.tiles.links;
  const drainAbsent: Absentable | null = data.drain.state === "ok" ? null : data.drain;
  const ga4Absent: Absentable | null = data.referrers.state === "ok" ? null : data.referrers;
  const fromLabel = (f: SitesFrom): string => {
    if ((f === "links" || f === "google") && linksAbsent && !counts?.[f]) return `${FROM_LABEL[f]} (none read yet)`;
    if (f === "views" && drainAbsent) return `${FROM_LABEL.views} (not delivering)`;
    return counts ? `${FROM_LABEL[f]} (${num(counts[f])})` : FROM_LABEL[f];
  };
  const filtered = !!asked.q || asked.from !== "all";
  const w = data.window;

  return (
    <>
      {/* The search box's own form; its field sits in the filter row (form="…"). A new search starts on the first page. */}
      <form id={FIND} method="get" action={BASE} hidden>
        {Object.entries(base)
          .filter(([k]) => k !== "q" && k !== "page")
          .map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
      </form>
      <Card
        id="bl-sites"
        title="Linking sites"
        count={sites.state === "ok" ? num(sites.value.total) : undefined}
        sub={`Sites that link to the website or sent it visitors, ${shortDate(w.start)} – ${shortDate(w.end)}. One row per site.`}
        info={
          <>
            Every row is a site a source named; none is a sample. Links come from the desk's own reading of the linking pages, Google's export (Search Console › Links, imported by hand) and Bing's index once connected: the largest count of the
            three, never a sum. {sites.state === "ok" ? sites.value.leftOut : null} There is no domain rating: no free source gives one honestly.
          </>
        }
        className="dk-seo-bl-sites"
        flush
        right={
          sites.state === "ok" && sites.value.total > 0 ? (
            <LinkButton href={exportHref(range, asked, "sites")} icon="download" size="sm" title={`Download every matching row (${num(sites.value.total)}), not only this page, as CSV`}>
              Export
            </LinkButton>
          ) : undefined
        }
        footer={sites.state === "ok" ? <Foot data={data} /> : undefined}
      >
        <div className="dk-seo-bl-filters">
          <label className="dk-seo-bl-find">
            <Icon name="search" size={14} />
            <input form={FIND} type="search" name="q" defaultValue={asked.q} placeholder="Search sites…" aria-label="Search sites by name or address" maxLength={300} />
          </label>
          <Select param="from" label="Which sites, by source" fallback="all" options={FROMS.map((f) => ({ value: f, label: fromLabel(f) }))} />
          <Select param="sort" label="Order" fallback="visits" options={SORTS.map((s) => ({ value: s, label: SORT_LABEL[s] }))} />
        </div>
        {sites.state === "ok" ? (
          <>
            <Table
              caption="Sites that link to the website or sent it visitors"
              className="dk-seo-bl-table"
              rows={sites.value.rows}
              rowKey={(r) => r.host}
              density="roomy"
              minWidth={1040}
              empty={
                (asked.from === "links" || asked.from === "google") && linksAbsent
                  ? "No link is known yet: import Search Console's Links export under “Pages linked to”, or check a page under “Links you follow”."
                  : asked.from === "views" && drainAbsent
                    ? "Vercel’s log drain does not deliver to the desk yet, so no page view by referring site is counted."
                    : filtered
                      ? "No site matches these filters."
                      : "No site linked to the website or sent it a visitor in this period, as far as the connected sources can tell. The steps under “Needs you” are how links begin."
              }
              columns={columns(base, { linksAbsent, ga4Absent, drainAbsent }, asked.open)}
            />
            <Pager data={data} base={base} />
          </>
        ) : (
          <Absent reading={sites} className="dk-seo-bl-absent" />
        )}
        {sites.state === "ok" && !filtered && sites.value.total > 0 && sites.value.total < 5 ? (
          <p className="dk-seo-bl-few">
            <Icon name="info" size={14} />
            <span>
              {sites.value.total === 1 ? "One site so far." : `${num(sites.value.total)} sites so far.`} Links begin off the site: the listings, profiles and client credits under “Needs you”.
              {linksAbsent ? " Import Search Console's Links export to list every site Google knows links from." : ""}
              {drainAbsent ? " Once Vercel’s log drain delivers, page views count too, from visitors who declined cookies as well." : ""}
            </span>
          </p>
        ) : null}
      </Card>
    </>
  );
}

function Pager({ data, base }: { data: SeoBacklinksPayload; base: Record<string, string> }) {
  if (data.sites.state !== "ok" || data.sites.value.pages <= 1) return null;
  const { page, pages, perPage, total } = data.sites.value;
  /* A new page of rows lands on the table, not the top of the screen. */
  const at = (n: number) => hrefWith(base, { page: n > 1 ? String(n) : undefined, open: undefined }, "bl-sites");
  return (
    <nav className="dk-seo-bl-pager" aria-label="Pages of the table">
      <span className="dk-seo-bl-quiet">
        {num((page - 1) * perPage + 1)}–{num(Math.min(page * perPage, total))} of {num(total)}
      </span>
      <span className="dk-seo-bl-pair">
        {page > 1 ? (
          <LinkButton href={at(page - 1)} size="xs" variant="ghost" icon="chevron-left">
            Previous
          </LinkButton>
        ) : null}
        <span className="dk-seo-bl-quiet">
          Page {num(page)} of {num(pages)}
        </span>
        {page < pages ? (
          <LinkButton href={at(page + 1)} size="xs" variant="ghost" iconRight="chevron-right">
            Next
          </LinkButton>
        ) : null}
      </span>
    </nav>
  );
}

function LinksCell({ r, absent }: { r: LinkingSite; absent: Absentable | null }) {
  if (!r.links) return absent ? <Absent reading={absent} form="inline" /> : <>{DASH}</>;
  const l = r.links;
  const per = [l.desk !== null ? `the desk's reading ${num(l.desk)}` : null, l.bing !== null ? `Bing ${num(l.bing)}` : null, l.google !== null ? `Google's export ${num(l.google)}` : null].filter(Boolean).join(", ");
  const says = l.count ? `${num(l.count)} by ${l.by ? SOURCE_LABEL[l.by] : "no source"}. Each source: ${per}.` : `No source names a link from ${r.host}. Each source: ${per}.`;
  return (
    <Tooltip text={`${says}${l.lost ? ` ${num(l.lost)} lost: found once, no longer.` : ""}`}>
      <span tabIndex={0} className="dk-seo-bl-figure">
        <span>{l.count ? num(l.count) : DASH}</span>
        {l.lost ? <span className="dk-seo-bl-bad">−{num(l.lost)}</span> : null}
      </span>
    </Tooltip>
  );
}

function columns(base: Record<string, string>, absent: { linksAbsent: Absentable | null; ga4Absent: Absentable | null; drainAbsent: Absentable | null }, open: string): Column<LinkingSite>[] {
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
            {r.hosts.length ? <span className="dk-seo-bl-quiet dk-seo-bl-clip" title={r.hosts.join(", ")}>via {r.hosts.join(", ")}</span> : null}
            {r.profileKey && r.kind !== "profile" ? (
              <Tooltip text="The studio has a profile on this site, but no source named the profile's own address: the visit may have come from somebody else's post there.">
                <span className="dk-seo-bl-quiet" tabIndex={0}>
                  your profile is on this site
                </span>
              </Tooltip>
            ) : null}
          </span>
        </span>
      ),
    },
    { key: "kind", head: "Kind", width: "112px", cell: (r) => <Chip tone={SITE_KIND[r.kind].tone}>{SITE_KIND[r.kind].label}</Chip> },
    { key: "links", head: "Links", numeric: true, width: "76px", cell: (r) => <LinksCell r={r} absent={absent.linksAbsent} /> },
    {
      key: "follow",
      head: "Follow",
      width: "96px",
      cell: (r) =>
        r.links?.follow ? (
          <Tooltip text={FOLLOW[r.links.follow].says}>
            <span tabIndex={0}>
              <Chip tone={FOLLOW[r.links.follow].tone}>{FOLLOW[r.links.follow].label}</Chip>
            </span>
          </Tooltip>
        ) : (
          <span className="dk-seo-bl-quiet" title="The desk has read no linking page of this site: only a page it read says whether a link is followed.">
            {DASH}
          </span>
        ),
    },
    {
      key: "anchor",
      head: "Link text",
      width: "14%",
      cell: (r) =>
        r.links?.anchor ? (
          <span className="dk-seo-bl-clip" title={r.links.anchor}>
            “{r.links.anchor}”
          </span>
        ) : r.links?.count ? (
          <span className="dk-seo-bl-quiet">no words known</span>
        ) : (
          <span className="dk-seo-bl-quiet">{DASH}</span>
        ),
    },
    {
      key: "page",
      head: "Page on the site",
      width: "18%",
      cell: (r) => {
        const path = r.links?.target ?? r.visits?.landing ?? null;
        if (!path) return <span className="dk-seo-bl-quiet">{DASH}</span>;
        const what = r.links?.target ? "linked to" : "landed on (GA4, most sessions)";
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
      width: "100px",
      cell: (r) =>
        r.visits ? (
          <span className="dk-seo-bl-figure">
            <span>{num(r.visits.sessions)}</span>
            {r.visits.previous !== null ? <Delta value={r.visits.sessions} previous={r.visits.previous} size="sm" /> : null}
          </span>
        ) : absent.ga4Absent ? (
          <Absent reading={absent.ga4Absent} form="inline" />
        ) : (
          DASH
        ),
    },
    {
      key: "views",
      head: "Page views",
      numeric: true,
      width: "88px",
      cell: (r) => (r.views !== null ? num(r.views) : absent.drainAbsent ? <Absent reading={absent.drainAbsent} form="inline" /> : DASH),
    },
    {
      key: "first",
      head: "First seen",
      width: "112px",
      cell: (r) =>
        r.firstSeen ? (
          <span className="dk-seo-bl-first" title={`First counted by ${FIRST_BY[r.firstSeen.by]} on ${fullDate(r.firstSeen.day)}`}>
            <span>{shortDate(r.firstSeen.day)}</span>
            <span className="dk-seo-bl-quiet">{FIRST_BY[r.firstSeen.by]}</span>
          </span>
        ) : (
          DASH
        ),
    },
    {
      key: "action",
      head: "Action",
      align: "right",
      width: "104px",
      cell: (r) =>
        open === r.host ? (
          <LinkButton href={openHref(base, null)} size="xs" variant="ghost" icon="x" title="Close the details">
            Close
          </LinkButton>
        ) : (
          <LinkButton href={openHref(base, r.host)} size="xs" icon="eye" title={`Every link and visit behind ${r.host}`}>
            Details
          </LinkButton>
        ),
    },
  ];
}

/** Where the table's figures come from, each with its age. */
function Foot({ data }: { data: SeoBacklinksPayload }) {
  const l = data.tiles.links;
  return (
    <div className="dk-seo-bl-foot">
      <span className="dk-seo-bl-foot-part">Links: {l.state === "ok" ? <Stamp reading={l} /> : <span className="dk-seo-bl-quiet">no source of links read yet</span>}</span>
      <span className="dk-seo-bl-foot-part">Visits: {data.referrers.state === "ok" ? <Stamp reading={data.referrers} /> : <span className="dk-seo-bl-quiet">{data.referrers.reason}</span>}</span>
      <span className="dk-seo-bl-foot-part">
        Page views: {data.drain.state === "ok" ? <Stamp reading={data.drain} /> : <span className="dk-seo-bl-quiet">Vercel’s log drain does not deliver yet</span>}
      </span>
    </div>
  );
}
