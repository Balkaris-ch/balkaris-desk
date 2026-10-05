import { Suspense } from "react";
import type { Reading } from "@/contract/common";
import type { ExplorerDimension, ExplorerQuery, ExplorerResult, ExplorerRow, PageStanding } from "@/contract/seo/search-console";
import { Chip } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Delta } from "@/components/ui/Delta";
import { EarlyLine, EarlyMark } from "@/components/ui/Early";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Select } from "@/components/ui/Select";
import { Stamp } from "@/components/ui/Stamp";
import { PanelAbsent, PositionChange } from "@/components/seo/bits";
import { cx } from "@/lib/cx";
import { DASH, fullDate, num } from "@/lib/format";
import { exactly, exportHref, firstDir, googleHref, keywordsHref, optimizeHref, ROWS_PER_PAGE, scHref, type Place } from "./href";
import { rateText } from "./Tiles";
import "@/components/ui/table.css";

/** The board's dimension tabs, in its order, with Dates and Search appearance after them. */
const DIMENSIONS: { key: ExplorerDimension; label: string; live?: string }[] = [
  { key: "query", label: "Queries" },
  { key: "page", label: "Pages", live: "Read live from Search Console: Google’s own page figures, with the impressions of withheld queries." },
  { key: "country", label: "Countries", live: "Read live from Search Console: the desk’s daily copy keeps every country together and Switzerland alone." },
  { key: "device", label: "Devices" },
  { key: "date", label: "Dates" },
  { key: "searchAppearance", label: "Search appearance", live: "Read live from Search Console: rich results, videos, FAQ and other special forms of a result." },
];

const HEAD: Record<ExplorerDimension, string> = { query: "Search query", page: "Page", country: "Country", device: "Device", date: "Date", searchAppearance: "Search appearance" };

/** The floor under which a change in position is noise, the same as the opportunity lists' (gsc.ts FLOOR). */
const MOVE_FLOOR = 30;

/** Where a row leads: the same view narrowed to it, one level down, as Search Console's own table does. */
function drill(place: Place, d: ExplorerDimension, row: ExplorerRow): { href: string; title: string } | null {
  switch (d) {
    case "query":
      /* The exact query, in quotes: "seo" alone would also take every longer query containing it. */
      return { href: scHref(place, { q: exactly(row.key), dimension: "page" }), title: "The pages Google showed for this query" };
    case "page":
      return { href: scHref(place, { page: row.key, dimension: "query" }), title: "The queries Google showed this page for" };
    case "country":
      return { href: scHref(place, { country: row.key, dimension: "query" }), title: "The queries searched from this country" };
    case "device":
      return { href: scHref(place, { device: row.key, dimension: "query" }), title: "The queries searched on this kind of device" };
    case "date":
      return { href: scHref(place, { dates: { start: row.key, end: row.key }, dimension: "query" }), title: "The queries of this one day, compared with the day before" };
    default:
      return null;
  }
}

/** The "Top page" or "Top query" beside a row, as a link to that one page's queries or that one query's pages. */
function topHref(place: Place, d: ExplorerDimension, top: string): { href: string; title: string } | null {
  if (d === "query") return { href: scHref(place, { page: top, q: "", dimension: "query" }), title: "Every query Google showed this page for" };
  if (d === "page") return { href: scHref(place, { q: exactly(top), page: null, dimension: "page" }), title: "Every page Google showed for this query" };
  return null;
}

function SortHead({ place, sort, label, numeric, title }: { place: Place; sort: ExplorerQuery["sort"]; label: string; numeric?: boolean; title?: string }) {
  const a = place.asked;
  const on = a.sort === sort;
  const dir = on ? (a.dir === "asc" ? "desc" : "asc") : firstDir(sort, a.dimension);
  return (
    <th scope="col" className={numeric ? "dk-table-right" : undefined} aria-sort={on ? (a.dir === "asc" ? "ascending" : "descending") : "none"} title={title}>
      <Go href={scHref(place, { sort, dir })} scroll={false} replace className={cx("dk-table-sort", "dk-seo-gsc-sort", on && "dk-table-sort--on")} aria-label={`${label}. Sort ${dir === "asc" ? "ascending" : "descending"}`}>
        <span>{label}</span>
        <Icon name={on ? (a.dir === "asc" ? "arrow-up" : "arrow-down") : "sort"} size={12} />
      </Go>
    </th>
  );
}

/** The page numbers with gaps: 1 … 4 5 6 … 11. */
function pageNumbers(at: number, count: number): (number | "gap")[] {
  const want = new Set([1, count, at - 1, at, at + 1].filter((n) => n >= 1 && n <= count));
  const out: (number | "gap")[] = [];
  let last = 0;
  for (const n of [...want].sort((a, b) => a - b)) {
    if (n - last > 1) out.push("gap");
    out.push(n);
    last = n;
  }
  return out;
}

export function Pager({ total, offset, limit, to, what }: { total: number; offset: number; limit: number; to: (offset: number) => string; what: string }) {
  const count = Math.max(1, Math.ceil(total / limit));
  const at = Math.floor(offset / limit) + 1;
  const go = (n: number) => to((n - 1) * limit);
  return (
    <div className="dk-seo-gsc-pager">
      <p className="dk-seo-gsc-showing dk-num">{total ? `Showing ${num(Math.min(total, offset + 1))}–${num(Math.min(total, offset + limit))} of ${num(total)} ${what}` : `No ${what}`}</p>
      {count > 1 ? (
        <nav className="dk-seo-gsc-pages" aria-label={`Pages of the ${what}`}>
          {at > 1 ? (
            <Go href={go(at - 1)} scroll={false} replace className="dk-seo-gsc-pg" aria-label="Previous page">
              <Icon name="chevron-left" size={14} />
            </Go>
          ) : (
            <span className="dk-seo-gsc-pg dk-seo-gsc-pg--off" aria-hidden>
              <Icon name="chevron-left" size={14} />
            </span>
          )}
          {pageNumbers(at, count).map((n, i) =>
            n === "gap" ? (
              <span key={`g${i}`} className="dk-seo-gsc-pg dk-seo-gsc-pg--gap" aria-hidden>
                …
              </span>
            ) : (
              <Go key={n} href={go(n)} scroll={false} replace className={cx("dk-seo-gsc-pg dk-num", n === at && "dk-seo-gsc-pg--on")} aria-current={n === at ? "page" : undefined}>
                {n}
              </Go>
            ),
          )}
          {at < count ? (
            <Go href={go(at + 1)} scroll={false} replace className="dk-seo-gsc-pg" aria-label="Next page">
              <Icon name="chevron-right" size={14} />
            </Go>
          ) : (
            <span className="dk-seo-gsc-pg dk-seo-gsc-pg--off" aria-hidden>
              <Icon name="chevron-right" size={14} />
            </span>
          )}
        </nav>
      ) : null}
    </div>
  );
}

/** What a missing earlier figure means for this row. */
function notBefore(d: ExplorerDimension): string {
  return d === "query"
    ? "Google reported no figure for this query in the window before. It withholds rare queries, so that does not mean it was not shown: no change is printed."
    : "No figure for the window before.";
}

function Before({ row, d }: { row: ExplorerRow; d: ExplorerDimension }) {
  const p = row.previous;
  if (!p) {
    const why = notBefore(d);
    return (
      <span className="dk-seo-gsc-none" title={why}>
        <span aria-hidden>{DASH}</span>
        <span className="dk-sr">{why}</span>
      </span>
    );
  }
  const said = `Window before: ${num(p.clicks)} ${p.clicks === 1 ? "click" : "clicks"}, ${num(p.impressions)} ${p.impressions === 1 ? "impression" : "impressions"}${p.position !== null ? `, position ${num(p.position, 1)}` : ""}`;
  return (
    <span title={said}>
      <Delta value={row.impressions} previous={p.impressions} size="sm" />
      <span className="dk-sr">{said}</span>
    </span>
  );
}

const STANDING: Record<PageStanding["state"], { label: string; tone: "warn" | "bad" | "quiet"; title: string } | null> = {
  listed: null,
  "not-listed": { label: "Not in the sitemap", tone: "quiet", title: "A page of the website that its sitemap does not list, by the desk's last crawl." },
  redirects: { label: "Redirects", tone: "warn", title: "The address redirects on the website now, by the desk's last crawl: Google still shows the old address." },
  gone: { label: "Gone", tone: "bad", title: "The address answered 404 or 410 at the desk's last crawl: Google still shows a page the website no longer has." },
  unknown: { label: "Not on the site", tone: "warn", title: "The desk's crawl knows no page at this address: an old address Google still shows, or a page nothing on the site links to." },
};

/** What the website has at a page Google shows, when that is not simply "a page of the site, in its sitemap and in the index". */
function Standing({ s }: { s: PageStanding }) {
  const look = STANDING[s.state];
  const title = look ? `${look.title}${s.to ? ` It leads to ${s.to}.` : ""}` : "";
  return (
    <>
      {look ? (
        <span title={title}>
          <Chip tone={look.tone} icon={s.state === "redirects" ? "redirect" : undefined} className="dk-seo-gsc-standing">
            {look.label}
          </Chip>
          <span className="dk-sr">. {title}</span>
        </span>
      ) : null}
      {s.indexed === false ? (
        <span title="Google's newest URL Inspection of the address has it out of the index, though it still showed it in this window.">
          <Chip tone="warn" className="dk-seo-gsc-standing">
            Not indexed
          </Chip>
        </span>
      ) : null}
    </>
  );
}

/**
 * A query taken out of the desk: to Google itself as a searcher in
 * Switzerland sees it, and to the Keywords tab, where it can be tracked and
 * judged. Both are links; nothing is fetched from Google's result page.
 */
function QueryOut({ query }: { query: string }) {
  return (
    <span className="dk-seo-gsc-key-tools">
      <Go href={googleHref(query)} className="dk-seo-gsc-key-go" title="Search this on Google, as a searcher in Switzerland sees it (opens Google)" aria-label={`Search “${query}” on Google Switzerland`}>
        <Icon name="globe" size={12} />
      </Go>
      <Go href={keywordsHref(query)} className="dk-seo-gsc-key-go" title="Open this query on the Keywords tab, where it can be tracked" aria-label={`Open “${query}” on the Keywords tab`}>
        <Icon name="key" size={12} />
      </Go>
    </span>
  );
}

function KeyCell({ row, d, place }: { row: ExplorerRow; d: ExplorerDimension; place: Place }) {
  const to = drill(place, d, row);
  const text = d === "date" ? fullDate(row.key) : row.label;
  return (
    <span className="dk-seo-gsc-key">
      {to ? (
        <Go href={to.href} scroll={false} className="dk-seo-gsc-key-link" title={to.title}>
          {text}
        </Go>
      ) : (
        <span className="dk-seo-gsc-key-text">{text}</span>
      )}
      {d === "query" ? <QueryOut query={row.key} /> : null}
      {d === "page" ? (
        <Go href={optimizeHref(row.key)} className="dk-seo-gsc-key-go" title="Open this page in Page Optimization" aria-label={`Open ${row.key} in Page Optimization`}>
          <Icon name="arrow-up-right" size={12} />
        </Go>
      ) : null}
      {d === "page" && row.site ? <Standing s={row.site} /> : null}
    </span>
  );
}

/**
 * The Pages list's own filter: every page, or only the addresses the website
 * no longer has (it redirects, is gone, or the crawl knows no page there),
 * which Google keeps showing long after a relaunch.
 */
function OffSiteSwitch({ place, count }: { place: Place; count: number | null }) {
  const on = place.asked.offsite;
  return (
    <nav className="dk-seo-gsc-switch" aria-label="Which pages">
      <Go href={scHref(place, { offsite: false })} scroll={false} replace className={cx("dk-seo-gsc-switch-item", !on && "dk-seo-gsc-switch-item--on")} aria-current={!on ? "true" : undefined}>
        All pages
      </Go>
      <Go
        href={scHref(place, { offsite: true })}
        scroll={false}
        replace
        className={cx("dk-seo-gsc-switch-item", on && "dk-seo-gsc-switch-item--on")}
        aria-current={on ? "true" : undefined}
        title="Only addresses Google shows that the website no longer has as a page: it redirects, answered 404, or the crawl knows no page there"
      >
        Not on the site {count !== null ? <span className="dk-num dk-seo-gsc-switch-count">{num(count)}</span> : null}
      </Go>
    </nav>
  );
}

/**
 * The board's table under the dimension tabs: one row per query, page,
 * country, device, day or search appearance, with clicks, impressions, CTR
 * and Google's average position, the window before beside them when it was
 * compared, and beside a query the page Google showed most for it (beside a
 * page, its query). Every head sorts and a row opens the same view narrowed
 * to it, one level down (a day opens that one day). A query also goes out to
 * Google and to the Keywords tab; a page to Page Optimization, with what the
 * website has at the address when Google shows one it no longer has. Export
 * takes every row as filtered.
 */
export function Explorer({ result, place, consoleHref }: { result: Reading<ExplorerResult>; place: Place; consoleHref: string | null }) {
  const a = place.asked;
  const r = result.state === "ok" ? result.value : null;
  /* A day has no window before (the server gives none): the chart is where days are compared, so Dates draws no empty column. */
  const compared = !!r?.previous && a.dimension !== "date";
  /* A limit typed into the address (?limit=5) is offered too, so the select says what the table shows. */
  const perPage = (ROWS_PER_PAGE as readonly number[]).includes(a.limit) ? [...ROWS_PER_PAGE] : [...ROWS_PER_PAGE, a.limit].sort((x, y) => x - y);
  return (
    <section className="dk-card dk-card--flush dk-seo-gsc-explorer" aria-label="Search Console explorer">
      <div className="dk-seo-gsc-bar">
        <nav className="dk-seo-gsc-dims" aria-label="Show the figures by">
          {DIMENSIONS.map((x) => {
            const on = x.key === a.dimension;
            return (
              <Go key={x.key} href={scHref(place, { dimension: x.key })} scroll={false} replace className={cx("dk-seo-gsc-dim", on && "dk-seo-gsc-dim--on")} aria-current={on ? "true" : undefined} title={x.live}>
                {x.label}
              </Go>
            );
          })}
        </nav>
        <div className="dk-seo-gsc-bar-tools">
          {a.dimension === "page" && r && (r.offsite !== null || a.offsite) ? <OffSiteSwitch place={place} count={r.offsite} /> : null}
          {r && r.total ? (
            <LinkButton href={exportHref(place)} size="sm" icon="download" title="Every row of this view, as filtered, as a CSV file">
              Export
            </LinkButton>
          ) : null}
          {consoleHref ? (
            <LinkButton href={consoleHref} size="sm" iconRight="external" title="Search Console’s own performance report for the property">
              Open Search Console
            </LinkButton>
          ) : null}
        </div>
      </div>

      {result.state !== "ok" || !r ? (
        <div className="dk-seo-gsc-explorer-absent">
          <PanelAbsent reading={result as Exclude<Reading<ExplorerResult>, { state: "ok" }>} />
        </div>
      ) : (
        <>
          {r.early ? <EarlyLine early={r.early} rows="Rows" className="dk-seo-gsc-early" /> : null}
          <div className="dk-table-wrap dk-seo-gsc-table-wrap">
            <table className="dk-table dk-table--dense dk-seo-gsc-table">
              <caption className="dk-sr">
                Search Console by {HEAD[a.dimension].toLowerCase()}, {r.start} to {r.end}
              </caption>
              <thead>
                <tr>
                  <SortHead place={place} sort="key" label={HEAD[a.dimension]} />
                  <SortHead place={place} sort="clicks" label="Clicks" numeric />
                  <SortHead place={place} sort="impressions" label="Impressions" numeric />
                  <SortHead place={place} sort="ctr" label="CTR" numeric title="Clicks over impressions; on fewer than 30 impressions the two counts" />
                  <SortHead place={place} sort="position" label="Position" numeric title="Google’s average position, weighted by impressions; lower is better" />
                  {compared ? (
                    <th scope="col" className="dk-table-right" title="Impressions in the window before against this one: under 20 both are printed">
                      vs before
                    </th>
                  ) : null}
                  {r.topLabel ? <th scope="col">{r.topLabel}</th> : null}
                </tr>
              </thead>
              <tbody>
                {r.rows.length === 0 ? (
                  <tr className="dk-table-none">
                    <td colSpan={5 + (compared ? 1 : 0) + (r.topLabel ? 1 : 0)}>
                      {a.offsite
                        ? r.offsite === null
                          ? "The desk’s crawler has not read the website yet, so it cannot tell which addresses the site no longer has."
                          : "Every address Google showed in this view is a page of the website."
                        : a.dimension === "searchAppearance"
                          ? "Google reports no special search appearance (rich results, videos, FAQ and the like) for the site in this view."
                          : a.q || a.page || a.part || a.country !== "all" || a.device !== "all"
                            ? "Google reports nothing for this view. Clear a filter to see more."
                            : "Google reports nothing for this window."}
                    </td>
                  </tr>
                ) : (
                  r.rows.map((row) => {
                    const p = row.previous;
                    const moved = p && p.position !== null && row.position !== null && row.impressions >= MOVE_FLOOR && p.impressions >= MOVE_FLOOR;
                    const topTo = row.top ? topHref(place, a.dimension, row.top) : null;
                    return (
                      <tr key={row.key}>
                        <td>
                          <KeyCell row={row} d={a.dimension} place={place} />
                        </td>
                        <td className="dk-table-right dk-num">{num(row.clicks)}</td>
                        <td className="dk-table-right dk-num">{num(row.impressions)}</td>
                        <td className="dk-table-right dk-num">{rateText(row.ctr)}</td>
                        <td className="dk-table-right dk-num">
                          <span className="dk-seo-gsc-pos-cell">
                            {row.early && r.early ? <EarlyMark standard={r.early.standard} /> : null}
                            <span>{row.position === null ? DASH : num(row.position, 1)}</span>
                            {moved ? <PositionChange previous={p.position} current={row.position as number} compared /> : null}
                          </span>
                        </td>
                        {compared ? (
                          <td className="dk-table-right">
                            <Before row={row} d={a.dimension} />
                          </td>
                        ) : null}
                        {r.topLabel ? (
                          <td className="dk-seo-gsc-top">
                            {row.top && topTo ? (
                              <Go href={topTo.href} scroll={false} className="dk-seo-gsc-key-link" title={`${row.top}: ${topTo.title.toLowerCase()}`}>
                                {row.top}
                              </Go>
                            ) : (
                              (row.top ?? <span className="dk-seo-gsc-none">{DASH}</span>)
                            )}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="dk-seo-gsc-foot">
            <Pager total={r.total} offset={a.offset} limit={a.limit} to={(offset) => scHref(place, { offset })} what={r.total === 1 ? "row" : "rows"} />
            <div className="dk-seo-gsc-foot-tools">
              <Suspense fallback={null}>
                <Select param="limit" fallback="25" resets={["offset"]} label="Rows per page" options={perPage.map((n) => ({ value: String(n), label: `${n} rows` }))} />
              </Suspense>
              <Stamp reading={result} />
            </div>
          </div>
          <p className="dk-seo-gsc-note">
            {r.note}
            {r.complete ? "" : " Google’s row limit cut this answer at 5,000 rows."}
          </p>
        </>
      )}
    </section>
  );
}
