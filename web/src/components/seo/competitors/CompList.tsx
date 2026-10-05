import type { CompetitorRow, CompetitorSort, SeoCompetitorsPayload } from "@/contract/seo/competitors";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Badge";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { Select } from "@/components/ui/Select";
import { Table, type Column } from "@/components/ui/Table";
import { Tooltip } from "@/components/ui/Tooltip";
import { cx } from "@/lib/cx";
import { DASH, num, shortDate } from "@/lib/format";
import { API, BASE, count, hrefWith, lookHref, serpHref, shownHost, shownName } from "./look";

const FIND = "dk-seo-competitors-find-form";
const RESETS = ["offset", "open"] as const;
/* The export carries the list's filters, not its paging or the row opened. */
const EXPORTED = ["engine", "type", "cluster", "q", "sort", "search", "shown"];
const SORTS = [
  { value: "seen", label: "Most seen" },
  { value: "position", label: "Best Google position" },
  { value: "ai", label: "Most AI mentions" },
  { value: "name", label: "By name" },
];

/**
 * "Competitors": every site and company seen beside or instead of Balkaris,
 * with where (Google's results, the map pack, AI answers) and what its pages
 * show. Chips by where it was seen, then the search, the kind and the cluster;
 * each row opens in the detail beside it (?open=).
 */
export function CompList({ data, base, openKey }: { data: SeoCompetitorsPayload; base: Record<string, string>; openKey: string | null }) {
  const asked = data.asked;
  const list = data.list;
  return (
    <>
      {/* The search box's own form: its field sits among the filters (form="…"). */}
      <form id={FIND} method="get" action={BASE} hidden>
        {Object.entries(base)
          .filter(([k]) => k !== "q" && k !== "offset" && k !== "open")
          .map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
      </form>
      <Card
        className="dk-seo-competitors-list"
        title="Competitors"
        sub="Who appears for the searches we want, in Google and in AI answers, and what their pages show."
        info={
          <span className="dk-seo-competitors-rules">
            <span>{data.rules.observed}</span>
            <span>{data.rules.joining}</span>
          </span>
        }
        right={
          <span className="dk-seo-competitors-right">
            <Select param="sort" label="Order" fallback="seen" resets={RESETS} options={SORTS} />
            <a className="dk-seo-competitors-task-link" href={exportHref(base)} download title="The list as filtered, every page of it, as a CSV file">
              <Icon name="download" size={13} /> CSV
            </a>
          </span>
        }
        flush
        footer={list.state === "ok" ? <Pager total={list.value.total} offset={list.value.offset} limit={list.value.limit} base={base} /> : undefined}
      >
        {list.state === "ok" ? (
          <>
            <nav className="dk-seo-competitors-chips" aria-label="Where they were seen">
              {list.value.engines.map((e) => {
                const on = asked.engine === e.key;
                return (
                  <Go key={e.key} href={hrefWith(base, { engine: e.key === "all" ? undefined : e.key })} scroll={false} className={cx("dk-seo-competitors-chip", on && "dk-seo-competitors-chip--on")} aria-current={on ? "true" : undefined}>
                    <span>{e.label}</span>
                    <span className="dk-seo-competitors-chip-n dk-num">{num(e.count)}</span>
                  </Go>
                );
              })}
            </nav>
            <div className="dk-seo-competitors-filters">
              <label className="dk-seo-competitors-find">
                <Icon name="search" size={14} />
                <input form={FIND} type="search" name="q" defaultValue={asked.q} placeholder="A name, a site or a search" aria-label="Search competitors by name, site, or a search they were seen for" />
              </label>
              <Select param="type" label="Kind" fallback="all" resets={RESETS} options={list.value.types.map((t) => ({ value: t.key, label: `${t.label} (${t.count})` }))} />
              <Select param="cluster" label="Cluster" fallback="" resets={RESETS} options={[{ value: "", label: "All clusters" }, ...list.value.clusters.map((c) => ({ value: c.key, label: `${c.name} (${c.count})` }))]} />
              {list.value.shown ? <Select param="shown" label="Shown" fallback="active" resets={RESETS} options={list.value.shown.map((x) => ({ value: x.key, label: `${x.label} (${x.count})` }))} /> : null}
            </div>
            {asked.search ? (
              <p className="dk-seo-competitors-note dk-seo-competitors-pad">
                Seen for “{asked.search}”.{" "}
                <Go href={hrefWith(base, { search: undefined })} scroll={false} className="dk-seo-competitors-task-link">
                  Show all searches
                </Go>
              </p>
            ) : null}
            <Table
              caption="Competitors"
              className="dk-seo-competitors-table"
              rows={list.value.rows}
              rowKey={(r) => r.domain}
              rowHref={(r) => hrefWith(base, { open: r.domain })}
              keepScroll
              density="roomy"
              minWidth={820}
              empty={
                list.value.lookFor ? (
                  <span>
                    No competitor matches “{asked.q}”.{" "}
                    <Go href={lookHref(base, list.value.lookFor)} scroll={false} className="dk-seo-competitors-task-link">
                      Look up {list.value.lookFor}
                    </Go>
                  </span>
                ) : list.value.checkFor ? (
                  <span>
                    No competitor was seen for “{asked.q}”.{" "}
                    <Go href={serpHref(base, list.value.checkFor)} scroll={false} className="dk-seo-competitors-task-link">
                      Check who ranks for it
                    </Go>
                  </span>
                ) : asked.q || asked.cluster || asked.search || asked.type !== "all" || asked.engine !== "all" ? (
                  "No competitor matches these filters."
                ) : (
                  "No competitor is recorded."
                )
              }
              columns={columns(openKey, base, asked.sort)}
            />
          </>
        ) : (
          <Absent reading={list} className="dk-seo-competitors-absent" />
        )}
      </Card>
    </>
  );
}

/**
 * A heading that orders the WHOLE list (the server sorts every page of it, as
 * the Order select does): a link to ?sort=. The list is paged on the server,
 * so a browser-side sort over the rows on screen would leave the rest unseen;
 * the columns with no server order have no sort.
 */
function SortHead({ base, sort, label, on, said }: { base: Record<string, string>; sort: CompetitorSort; label: string; on: boolean; said: string }) {
  const desc = sort === "ai" || sort === "seen";
  return (
    <Go
      href={hrefWith(base, { sort: sort === "seen" ? undefined : sort })}
      scroll={false}
      className={cx("dk-table-sort", "dk-seo-competitors-sort", on && "dk-table-sort--on")}
      aria-label={`${label}: order the whole list ${said}`}
      aria-current={on ? "true" : undefined}
      title={`Order the whole list ${said}`}
    >
      <span>{label}</span>
      <Icon name={on ? (desc ? "arrow-down" : "arrow-up") : "sort"} size={12} />
    </Go>
  );
}

function columns(openKey: string | null, base: Record<string, string>, sort: CompetitorSort): Column<CompetitorRow>[] {
  return [
    {
      key: "who",
      head: <SortHead base={base} sort="name" label="Competitor" on={sort === "name"} said="by name" />,
      cell: (r) => {
        const host = shownHost(r.domain);
        const name = shownName(r.domain, r.name);
        const also = r.alsoNamed.length ? ` Also named: ${r.alsoNamed.join(", ")}.` : "";
        return (
          <span className="dk-seo-competitors-who" data-comp-on={r.domain === openKey ? "" : undefined} title={`${name}${host && host !== name ? ` (${host})` : ""}.${also}`}>
            <span className="dk-seo-competitors-mark" aria-hidden>
              {name.slice(0, 1).toUpperCase()}
            </span>
            <span className="dk-seo-competitors-who-text">
              <span className="dk-seo-competitors-name">{name}</span>
              <span className="dk-seo-competitors-host">
                <span className="dk-seo-competitors-host-text">{host ?? "named without a site"}</span>
                {r.platform ? <Chip className="dk-seo-competitors-mini">platform</Chip> : null}
                {r.decision?.watch ? <Chip tone="good" className="dk-seo-competitors-mini">watched</Chip> : null}
                {r.decision?.ignore ? <Chip className="dk-seo-competitors-mini">ignored</Chip> : null}
              </span>
            </span>
          </span>
        );
      },
    },
    {
      key: "google",
      head: <SortHead base={base} sort="position" label="Google" on={sort === "position"} said="by best Google position" />,
      numeric: true,
      width: "78px",
      cell: (r) =>
        r.bestPosition !== null ? (
          <Tooltip text={`Its best organic position for one of our searches, as the audit counted it (ads not counted).`}>
            <span className="dk-seo-competitors-pos" tabIndex={0}>
              #{r.bestPosition}
            </span>
          </Tooltip>
        ) : (
          <span className="dk-seo-competitors-none">{DASH}</span>
        ),
    },
    {
      key: "map",
      head: "Map pack",
      numeric: true,
      width: "80px",
      cell: (r) => (r.mapPack !== null ? <span className="dk-seo-competitors-pos">#{r.mapPack}</span> : <span className="dk-seo-competitors-none">{DASH}</span>),
    },
    {
      key: "ai",
      head: <SortHead base={base} sort="ai" label="AI answers" on={sort === "ai"} said="by most AI mentions" />,
      width: "128px",
      cell: (r) =>
        r.named + r.cited ? (
          <Tooltip text={`Named in ${count(r.named, "AI answer")} and cited as a source in ${count(r.cited, "answer")}: ${r.engines.filter((e) => !e.key.startsWith("google") || e.key === "google-aio" || e.key === "google-ai-mode").map((e) => e.label).join(", ")}.`}>
            <span className="dk-seo-competitors-ai" tabIndex={0}>
              {r.named ? <span>{num(r.named)} named</span> : null}
              {r.cited ? <span className="dk-seo-competitors-quiet">{num(r.cited)} cited</span> : null}
            </span>
          </Tooltip>
        ) : (
          <span className="dk-seo-competitors-none">{DASH}</span>
        ),
    },
    {
      key: "searches",
      head: "Searches",
      numeric: true,
      width: "78px",
      cell: (r) => (
        <Tooltip text={r.queries.map((q) => `“${q}”`).join(", ")}>
          <span tabIndex={0}>{num(r.queries.length)}</span>
        </Tooltip>
      ),
    },
    {
      key: "shows",
      head: "Their pages show",
      width: "172px",
      cell: (r) => <Shows r={r} />,
    },
    {
      key: "seen",
      head: "Seen",
      width: "64px",
      cell: (r) => <span className="dk-seo-competitors-quiet">{r.lastSeen ? shortDate(r.lastSeen) : DASH}</span>,
    },
  ];
}

/** What its pages read show, as small marks: German, a price, FAQ markup, business markup, review markup. */
function Shows({ r }: { r: CompetitorRow }) {
  if (r.platform) return <span className="dk-seo-competitors-none">a platform: not read</span>;
  if (!r.has) return <span className="dk-seo-competitors-none">{r.domain.startsWith("name:") ? "no site to read" : "not read"}</span>;
  const h = r.has;
  const marks: [boolean, string, string][] = [
    [h.german, "DE", "A page read is in German"],
    [h.price, "CHF", "A page read states a price"],
    [h.faq, "FAQ", "FAQPage in its structured data"],
    [h.business, "Org", "A business type in its structured data (Organization, LocalBusiness…)"],
    [h.reviews, "★", "Review or AggregateRating in its structured data"],
  ];
  const on = marks.filter((m) => m[0]);
  return (
    <span className="dk-seo-competitors-shows" title={`${count(h.pages, "page")} read. ${on.map((m) => m[2]).join(". ") || "None of German, a price, FAQ, business or review markup"}.`}>
      {on.length ? on.map((m) => <Chip key={m[1]} tone={m[1] === "DE" || m[1] === "CHF" ? "good" : "quiet"} className="dk-seo-competitors-mini">{m[1]}</Chip>) : <span className="dk-seo-competitors-none">none of these</span>}
    </span>
  );
}

function Pager({ total, offset, limit, base }: { total: number; offset: number; limit: number; base: Record<string, string> }) {
  const from = total ? offset + 1 : 0;
  const to = Math.min(total, offset + limit);
  const prev = offset > 0 ? hrefWith(base, { offset: offset - limit > 0 ? String(offset - limit) : undefined, open: undefined }) : null;
  const next = offset + limit < total ? hrefWith(base, { offset: String(offset + limit), open: undefined }) : null;
  return (
    <div className="dk-seo-competitors-pager">
      <span className="dk-seo-competitors-quiet dk-num">
        {num(from)}–{num(to)} of {num(total)}
      </span>
      <span className="dk-seo-competitors-pages">
        {prev ? (
          <Go href={prev} scroll={false} className="dk-seo-competitors-page" aria-label="Earlier rows">
            <Icon name="chevron-left" size={14} />
          </Go>
        ) : (
          <span className="dk-seo-competitors-page dk-seo-competitors-page--off" aria-hidden>
            <Icon name="chevron-left" size={14} />
          </span>
        )}
        {next ? (
          <Go href={next} scroll={false} className="dk-seo-competitors-page" aria-label="Later rows">
            <Icon name="chevron-right" size={14} />
          </Go>
        ) : (
          <span className="dk-seo-competitors-page dk-seo-competitors-page--off" aria-hidden>
            <Icon name="chevron-right" size={14} />
          </span>
        )}
      </span>
    </div>
  );
}

/** The export's address: the desk server's CSV of the list as filtered (GET /api/v1/seo/competitors/export.csv). */
function exportHref(base: Record<string, string>): string {
  const q = new URLSearchParams(Object.entries(base).filter(([k]) => EXPORTED.includes(k)));
  const s = q.toString();
  return `${API}/export.csv${s ? `?${s}` : ""}`;
}
