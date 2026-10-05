import type { KnownLink, SeoBacklinksPayload } from "@/contract/seo/backlinks";
import { SparkBars } from "@/components/charts";
import { Badge, Chip } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Go } from "@/components/ui/Go";
import { Table, type Column } from "@/components/ui/Table";
import { Tooltip } from "@/components/ui/Tooltip";
import { DASH, num, shortDate } from "@/lib/format";
import { LinkActions } from "./Act";
import { LINK_STATE, OPEN_ANCHOR, openHref, ORIGIN_LABEL, paramsOf, shortUrl, SITE_KIND } from "./look";

/**
 * One site, opened from its row (?open=<site>): every link any source knows
 * from it, each with what the desk's own reading of the page found, what
 * Google's export says, and the visits it sent by day, by landing page and by
 * referring address. A site nothing knows about says so, with the way back.
 */
export function Detail({ data, range }: { data: SeoBacklinksPayload; range: string }) {
  const asked = data.asked.open;
  if (!asked) return null;
  const base = paramsOf(range, data.asked);
  const close = (
    <LinkButton href={openHref(base, null)} size="sm" variant="ghost" icon="x">
      Close
    </LinkButton>
  );
  const d = data.open;
  if (!d) {
    return (
      <Card id={OPEN_ANCHOR} title={asked} icon="globe" right={close} className="dk-seo-bl-detail">
        <Empty icon="search" title="Nothing is known about this site" compact>
          No source names a link from {asked} or a visit from it in this period. “Check a page for a link” reads one of its pages now.
        </Empty>
      </Card>
    );
  }
  const sessions = d.days ? d.days.reduce((n, x) => n + x.sessions, 0) : null;
  return (
    <Card
      id={OPEN_ANCHOR}
      title={d.host}
      icon="globe"
      count={num(d.linksTotal)}
      sub={`${d.label ? `${d.label} · ` : ""}${SITE_KIND[d.kind].label}${d.hosts.length ? ` · seen as ${d.hosts.join(", ")}` : ""}`}
      info="Every link the desk knows from this site, the desk's own reading of each page first, and the visits GA4 counted from it in the period. A link the desk has not read itself says who names it."
      right={
        <div className="dk-seo-bl-tools">
          <LinkButton href={`https://${d.host}`} size="sm" variant="quiet" icon="external">
            Open the site
          </LinkButton>
          {close}
        </div>
      }
      className="dk-seo-bl-detail"
      flush
    >
      <div className="dk-seo-bl-detail-facts">
        {d.google ? (
          <p>
            <Badge tone="info">Google's export</Badge> {num(d.google.pages)} linking page{d.google.pages === 1 ? "" : "s"} to {num(d.google.targets)} page{d.google.targets === 1 ? "" : "s"} of the website
            {d.google.day ? <span className="dk-seo-bl-quiet"> (imported {shortDate(d.google.day)})</span> : null}
          </p>
        ) : null}
        {d.days ? (
          <div className="dk-seo-bl-detail-visits">
            <p>
              <b className="dk-num">{num(sessions ?? 0)}</b> session{sessions === 1 ? "" : "s"} from it in the period <span className="dk-seo-bl-quiet">(GA4, consenting visitors)</span>
            </p>
            {sessions ? (
              <div className="dk-seo-bl-bing-spark">
                <SparkBars data={d.days.map((x) => x.sessions)} />
              </div>
            ) : null}
            {d.landings.length ? (
              <p className="dk-seo-bl-quiet">
                Landed on:{" "}
                {d.landings.slice(0, 5).map((l, i) => (
                  <span key={l.path}>
                    {i ? ", " : ""}
                    <Go href={`/seo/pages/view?path=${encodeURIComponent(l.path)}`} className="dk-seo-bl-link">
                      {l.path}
                    </Go>{" "}
                    ({num(l.sessions)})
                  </span>
                ))}
              </p>
            ) : null}
            {d.referrers.length ? (
              <p className="dk-seo-bl-quiet">
                Referring addresses GA4 named: {d.referrers.slice(0, 5).map((r) => `${shortUrl(r.url)} (${num(r.sessions)})`).join(", ")}
                {d.referrers.every((r) => /^https?:\/\/[^/]+\/?$/.test(r.url)) ? ". Browsers send only the site's front door, not the page that linked." : ""}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <Table
        caption={`Links from ${d.host}`}
        className="dk-seo-bl-table"
        rows={d.links}
        rowKey={(l) => `${l.id ?? "b"}:${l.source}`}
        density="roomy"
        minWidth={980}
        empty="No link from this site is known: no source names one, and the desk has not read one of its pages. “Check a page for a link” reads one now."
        columns={columns}
      />
      {d.linksTotal > d.links.length ? <p className="dk-seo-bl-few">The first {num(d.links.length)} of {num(d.linksTotal)}; the CSV of every linking page has them all.</p> : null}
    </Card>
  );
}

const followWord = (l: KnownLink): { label: string; tone: "good" | "warn" } | null => {
  if (!l.rel) return null;
  const closed = l.rel.filter((r) => r === "nofollow" || r === "sponsored" || r === "ugc");
  return closed.length ? { label: closed.join(", "), tone: "warn" } : { label: "Followed", tone: "good" };
};

const columns: Column<KnownLink>[] = [
  {
    key: "page",
    head: "Linking page",
    cell: (l) => (
      <span className="dk-seo-bl-site-text">
        <Go href={l.source} className="dk-seo-bl-host dk-seo-bl-clip" title={l.source}>
          {shortUrl(l.source)}
        </Go>
        <span className="dk-seo-bl-quiet">
          {l.origins.map((o) => ORIGIN_LABEL[o]).join(" · ")}
          {l.note ? ` · ${l.note}` : ""}
        </span>
      </span>
    ),
  },
  {
    key: "state",
    head: "The desk's reading",
    width: "150px",
    cell: (l) => (
      <span className="dk-seo-bl-state">
        <Tooltip text={l.stateWhy ?? (l.state === "live" ? `The desk found the link on the page${l.checkedAt ? ` on ${shortDate(l.checkedAt)}` : ""}.` : LINK_STATE[l.state].label)}>
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
    key: "follow",
    head: "Follow",
    width: "112px",
    cell: (l) => {
      const f = followWord(l);
      return f ? <Chip tone={f.tone}>{f.label}</Chip> : <span className="dk-seo-bl-quiet">{DASH}</span>;
    },
  },
  {
    key: "anchor",
    head: "Link text",
    width: "16%",
    cell: (l) =>
      l.anchor ? (
        <span className="dk-seo-bl-clip" title={l.anchor}>
          “{l.anchor}”
        </span>
      ) : (
        <span className="dk-seo-bl-quiet">{DASH}</span>
      ),
  },
  {
    key: "target",
    head: "Page on the site",
    width: "16%",
    cell: (l) =>
      l.target ? (
        <Go href={`/seo/pages/view?path=${encodeURIComponent(l.target)}`} className="dk-seo-bl-clip dk-seo-bl-path" title={l.target}>
          {l.target}
        </Go>
      ) : (
        <span className="dk-seo-bl-quiet">{DASH}</span>
      ),
  },
  {
    key: "dates",
    head: "Found · lost",
    width: "128px",
    cell: (l) => (
      <span className="dk-seo-bl-first">
        <span>{l.firstLive ? shortDate(l.firstLive) : DASH}</span>
        <span className="dk-seo-bl-quiet">{l.lostAt ? `lost ${shortDate(l.lostAt)}` : l.bingLastSeen ? `Bing ${shortDate(l.bingLastSeen)}` : l.googleCrawled ? `Google ${shortDate(l.googleCrawled)}` : `known ${shortDate(l.firstSeen)}`}</span>
      </span>
    ),
  },
  {
    key: "act",
    head: "Action",
    align: "right",
    width: "220px",
    cell: (l) => (l.id !== null ? <LinkActions id={l.id} tracked={l.tracked} /> : <span className="dk-seo-bl-quiet">Bing's; read with the next run</span>),
  },
];
