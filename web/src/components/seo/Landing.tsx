import type { Reading } from "@/contract/common";
import type { Landings, OrganicLanding, SearchLanding } from "@/contract/seo";
import { Card } from "@/components/ui/Card";
import { LinkButton } from "@/components/ui/Button";
import { Delta } from "@/components/ui/Delta";
import { Stamp } from "@/components/ui/Stamp";
import { Table, type Column } from "@/components/ui/Table";
import { Thumb } from "@/components/ui/Thumb";
import { ctrText } from "@/components/insights/rate";
import { num } from "@/lib/format";
import { position, PositionChange, SeoRead } from "./bits";
import "./seo.css";

/**
 * Under these widths the table scrolls inside its panel instead of crushing
 * the page column. Both fit the panel at the board's own size (533px), where
 * the page column keeps about 140px of text beside its picture.
 */
export const SEARCH_LANDING_MIN_WIDTH = 530;
export const ORGANIC_LANDING_MIN_WIDTH = 440;

/** The page, with the board's slim picture (the CSS draws it at the board's size). */
function PageCell({ label, path, title, picture }: { label: string; path: string; title: string | null; picture: string | null }) {
  return (
    <span className="dk-seo-page">
      <Thumb src={picture} alt="" size="sm" icon="file-text" className="dk-seo-page-thumb" />
      <span className="dk-seo-cell-text" title={title ? `${title} (${path})` : label}>
        {label}
      </span>
    </span>
  );
}

/** Search Console's columns. `compared` is the list's: only then is a page without an earlier position "new". */
export function searchLandingColumns(compared: boolean): Column<SearchLanding>[] {
  return [
    { key: "page", head: "Page", cell: (r) => <PageCell {...r} />, sort: (r) => r.label },
    { key: "clicks", head: "Clicks", numeric: true, cell: (r) => num(r.clicks), sort: (r) => r.clicks, width: "60px" },
    { key: "impressions", head: "Impressions", numeric: true, cell: (r) => num(r.impressions), sort: (r) => r.impressions, width: "90px" },
    /* A rate on fewer than thirty impressions is noise: its two counts are printed instead ("1 of 2"). */
    { key: "ctr", head: "CTR", numeric: true, cell: (r) => ctrText(r.clicks, r.impressions, r.ctr), sort: (r) => r.ctr, width: "60px" },
    { key: "position", head: "Position", numeric: true, cell: (r) => position(r.position), sort: (r) => r.position, width: "68px" },
    {
      key: "change",
      head: <span className="dk-sr">Change in position</span>,
      /* Under the movements floor in either period no arrow is drawn: the Movements panel beside it would call that move noise. */
      cell: (r) => <PositionChange previous={r.previousPosition} current={r.position} compared={compared} changeFloor={r.changeFloor} />,
      width: "60px",
    },
  ];
}

export const organicLandingColumns: Column<OrganicLanding>[] = [
  { key: "page", head: "Page", cell: (r) => <PageCell label={r.path} {...r} />, sort: (r) => r.path },
  { key: "sessions", head: <span className="dk-seo-wraphead">Organic sessions</span>, numeric: true, cell: (r) => num(r.sessions), sort: (r) => r.sessions, width: "80px" },
  { key: "users", head: "Users", numeric: true, cell: (r) => num(r.users), sort: (r) => r.users, width: "60px" },
  { key: "change", head: "Change", numeric: true, cell: (r) => <Delta value={r.sessions} previous={r.previousSessions} size="sm" />, width: "84px" },
];

/**
 * Top landing pages from search. With Search Console: Google's clicks,
 * impressions, CTR and position per page. Until then the true stand-in: the
 * sessions GA4 saw begin on each page from the Organic Search channel, named
 * as GA4's, with the reason clicks and positions are not here yet.
 */
export function Landing({ reading, qs, className }: { reading: Reading<Landings>; qs: string; className?: string }) {
  const listHref = `/seo/list/landing${qs}`;
  const ga4 = reading.state === "ok" && reading.value.source === "ga4";
  return (
    <Card
      className={className}
      title="Top landing pages (SEO)"
      icon="file-text"
      flush
      sub={ga4 ? "Organic landings (GA4): clicks and positions arrive with Search Console" : undefined}
      info={
        ga4
          ? "Until Search Console is connected: sessions that GA4 saw begin on each page from the Organic Search channel. GA4 counts consenting visitors only, so this is an undercount, and it knows nothing of impressions or positions."
          : "The pages Google sent people to, most clicks first, with Google’s average position and its change against the period before, drawn only for a page shown often enough in both periods to measure it (the floor of Recent ranking movements). A click-through rate on fewer than 30 impressions is noise, so it is shown as its two counts (“1 of 2”). Search Console, Google Search only."
      }
      right={reading.state === "ok" && reading.value.total > 0 ? <LinkButton href={listHref} size="sm">View all</LinkButton> : null}
    >
      <SeoRead reading={reading}>
        {(l, r) => (
          <div className="dk-seo-flush">
            {l.source === "gsc" ? (
              <Table
                caption="Top landing pages from Google Search"
                rows={l.rows}
                rowKey={(x) => x.page}
                columns={searchLandingColumns(l.compared).map(({ sort: _sort, ...c }) => c)}
                minWidth={SEARCH_LANDING_MIN_WIDTH}
                className="dk-seo-tight"
                empty="Google sent nobody to any page in this period."
              />
            ) : (
              <Table
                caption="Top organic landing pages, from GA4"
                rows={l.rows}
                rowKey={(x) => x.path}
                columns={organicLandingColumns.map(({ sort: _sort, ...c }) => c)}
                minWidth={ORGANIC_LANDING_MIN_WIDTH}
                className="dk-seo-tight"
                empty="GA4 saw no session begin from Organic Search in this period."
              />
            )}
            <div className="dk-seo-flush-foot">
              <Stamp reading={r} />
              {l.source === "ga4" ? <span className="dk-seo-foot-note">Search Console: {l.why}</span> : null}
            </div>
          </div>
        )}
      </SeoRead>
    </Card>
  );
}
