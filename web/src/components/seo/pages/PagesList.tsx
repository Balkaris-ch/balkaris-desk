import { Suspense } from "react";
import type { Reading } from "@/contract/common";
import type { IndexBasis, PagesColumn, PagesSort, SearchBasis, SeoPageRow, SeoPagesPayload } from "@/contract/seo/pages";
import { Ring } from "@/components/charts";
import { Chip, type ChipTone } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { Select } from "@/components/ui/Select";
import { Stamp } from "@/components/ui/Stamp";
import { Thumb } from "@/components/ui/Thumb";
import { cx } from "@/lib/cx";
import { DASH, num, percent, shortDate } from "@/lib/format";
import { columnHref, exportHref, firstDir, optimizeHref, pagesHref, ROWS_PER_PAGE, type Place } from "./href";
import { Picker } from "./Picker";
import { QueueButton } from "./QueueButton";
import "@/components/ui/table.css";

/** The crawl's kinds as the type chips print them, and their colours (the board: services blue, industries amber). */
export const KIND_CHIP: Record<string, { label: string; tone: ChipTone }> = {
  home: { label: "Home", tone: "quiet" },
  service: { label: "Service", tone: "info" },
  landing: { label: "Landing", tone: "violet" },
  segment: { label: "Industry", tone: "warn" },
  article: { label: "Insight", tone: "quiet" },
  case: { label: "Case study", tone: "good" },
  insights: { label: "Insights", tone: "quiet" },
  standard: { label: "Standard", tone: "quiet" },
  legal: { label: "Legal", tone: "quiet" },
};

export function KindChip({ kind, label }: { kind: string | null; label: string | null }) {
  const k = kind ? KIND_CHIP[kind] : undefined;
  return <Chip tone={k?.tone ?? "quiet"}>{k?.label ?? label ?? "Other"}</Chip>;
}

/** A rate as a cell prints it: "2.8%", or "1 of 6" when there are fewer than 30 impressions to divide. */
export function rateCell(r: SeoPageRow["ctr"]): string {
  if (r.value === null) return DASH;
  return r.small ? `${num(r.num)} of ${num(r.den)}` : percent(r.value, r.value < 10 ? 1 : 0);
}

/** Why a row has no index answer, in one sentence: kept out of the sitemap, or a listed page no recent check reached. */
function notInspected(row: SeoPageRow, index: Reading<IndexBasis>): string {
  if (!row.inSitemap) return "Not inspected: the daily URL Inspection asks Google about sitemap addresses only, and this one is kept out of the sitemap.";
  if (index.state !== "ok") return `Not inspected: ${index.reason}`;
  const b = index.value;
  return `Not inspected yet: none of the last ${b.days} daily checks reached it${b.complete ? "" : ` (the newest, ${shortDate(b.newest)}, was cut short)`}. The next daily check asks again.`;
}

/** Google's index state as the INDEX column draws it, with the day of the answer when it is older than the newest check. */
function IndexMark({ row, index }: { row: SeoPageRow; index: Reading<IndexBasis> }) {
  if (!row.index) {
    const why = notInspected(row, index);
    return (
      <span className="dk-seo-pages-idx dk-seo-pages-idx--none" title={why}>
        <span aria-hidden>{DASH}</span>
        <span className="dk-sr">{why}</span>
      </span>
    );
  }
  const newest = index.state === "ok" ? index.value.newest : null;
  const older = newest !== null && row.index.day < newest;
  const said = `${row.index.indexed ? "In Google's index" : "Not in Google's index"}${row.index.coverage ? `: ${row.index.coverage}` : ""} (URL Inspection, ${shortDate(row.index.day)}${older ? `; the check of ${shortDate(newest!)} did not reach it` : ""})`;
  return (
    <span className={cx("dk-seo-pages-idx", row.index.indexed ? "dk-seo-pages-idx--yes" : "dk-seo-pages-idx--no", older && "dk-seo-pages-idx--older")} title={said} role="img" aria-label={said}>
      <Icon name={row.index.indexed ? "check" : "x"} size={14} />
    </span>
  );
}

function IssuesCell({ row }: { row: SeoPageRow }) {
  const { critical, warning, opportunity } = row.issues;
  const n = critical + warning;
  const said = `${critical} critical, ${warning} warning${warning === 1 ? "" : "s"}, ${opportunity} smaller finding${opportunity === 1 ? "" : "s"} of the crawl's rules`;
  return (
    <span className={cx("dk-seo-pages-issues dk-num", critical ? "dk-seo-pages-issues--bad" : warning ? "dk-seo-pages-issues--warn" : "dk-seo-pages-issues--none")} title={said}>
      {num(n)}
      <span className="dk-sr">{said}</span>
    </span>
  );
}

/** Impressions against the window before: "+12" or "−3", with the three measures in its tooltip. */
function ChangeCell({ row, search }: { row: SeoPageRow; search: Reading<SearchBasis> }) {
  const was = row.previous;
  if (!was || row.impressions === null) {
    const why = search.state !== "ok" ? "Search Console is not available." : "Not compared: the window before is not covered by Google's page figures.";
    return (
      <span className="dk-seo-pages-delta dk-seo-pages-delta--flat" title={why}>
        {DASH}
      </span>
    );
  }
  const d = row.impressions - was.impressions;
  const said = `Impressions ${num(was.impressions)} → ${num(row.impressions)}, clicks ${num(was.clicks)} → ${num(row.clicks)}, position ${was.position === null ? DASH : num(was.position, 1)} → ${row.position === null ? DASH : num(row.position, 1)} (the window before → this one)`;
  return (
    <span className={cx("dk-seo-pages-delta dk-num", d > 0 ? "dk-seo-pages-delta--up" : d < 0 ? "dk-seo-pages-delta--down" : "dk-seo-pages-delta--flat")} title={said}>
      {d > 0 ? `+${num(d)}` : d < 0 ? `−${num(-d)}` : "0"}
      <span className="dk-sr">{said}</span>
    </span>
  );
}

/** A column head that sorts: a link to the same list in that order (the server sorts every page of it). */
function SortHead({ place, sort, label, numeric, title }: { place: Place; sort: PagesSort; label: string; numeric?: boolean; title?: string }) {
  const on = place.query.sort === sort;
  const dir = on ? (place.query.dir === "asc" ? "desc" : "asc") : firstDir(sort);
  return (
    <th scope="col" className={numeric ? "dk-table-right" : undefined} aria-sort={on ? (place.query.dir === "asc" ? "ascending" : "descending") : "none"} title={title}>
      <Go href={pagesHref(place, { sort, dir })} scroll={false} replace className={cx("dk-table-sort", "dk-seo-pages-sort", on && "dk-table-sort--on")} aria-label={`${title ? `${label}: ${title}` : label}. Sort ${dir === "asc" ? "ascending" : "descending"}`}>
        <span>{label}</span>
        {/* Only the column the list is in order of carries its arrow, as on the board; the others show it on hover. */}
        <Icon name={on ? (place.query.dir === "asc" ? "arrow-up" : "arrow-down") : "sort"} size={12} />
      </Go>
    </th>
  );
}

/**
 * The optional columns, in the order the table draws them (the server's own
 * order, src/cc/routes/seo/pages.ts COLUMNS). Each says what it is and, when
 * the list can be put in its order, by which sort.
 */
const COLUMN: Record<PagesColumn, { label: string; title: string; sort?: PagesSort; numeric?: boolean }> = {
  title: { label: "Title", title: "The page's own title, as the crawl read it" },
  status: { label: "HTTP", title: "What the page answered at the last crawl", numeric: true },
  change: { label: "Change", title: "Impressions against the window before (Search Console)", sort: "change", numeric: true },
  sessions: { label: "Organic sessions", title: "Sessions that began on the page from organic search, GA4 (consenting visitors only)", sort: "sessions", numeric: true },
  opportunities: { label: "Opps", title: "Open opportunities the engine found for the page", sort: "opportunities", numeric: true },
  readiness: { label: "AI ready", title: "AI-readiness checks the page passes, of those that apply" },
  words: { label: "Words", title: "Words of the page's own content", sort: "words", numeric: true },
  links: { label: "Links in", title: "Pages linking here from their own content, and from anywhere (menus and footer too)", sort: "links", numeric: true },
  updated: { label: "Updated", title: "When the desk last saw the content change, or the sitemap's own date", sort: "updated" },
};
const COLUMN_ORDER = Object.keys(COLUMN) as PagesColumn[];

function ExtraHead({ col, place }: { col: PagesColumn; place: Place }) {
  const c = COLUMN[col];
  if (c.sort) return <SortHead place={place} sort={c.sort} label={c.label} numeric={c.numeric} title={c.title} />;
  return (
    <th scope="col" className={c.numeric ? "dk-table-right" : undefined} title={c.title}>
      {c.label}
    </th>
  );
}

function ExtraCell({ col, r, data }: { col: PagesColumn; r: SeoPageRow; data: SeoPagesPayload }) {
  switch (col) {
    case "title":
      return (
        <td className="dk-seo-pages-cell-title" title={r.title ?? undefined}>
          {r.title ?? <span className="dk-seo-pages-small">none</span>}
        </td>
      );
    case "status":
      return <td className={cx("dk-table-right dk-num", r.status !== 200 && "dk-seo-pages-cell-bad")}>{r.status || DASH}</td>;
    case "change":
      return (
        <td className="dk-table-right">
          <ChangeCell row={r} search={data.search} />
        </td>
      );
    case "sessions":
      return (
        <td className="dk-table-right dk-num" title={r.organic ? `${num(r.organic.engaged)} of them engaged` : data.organic.state !== "ok" ? data.organic.reason : undefined}>
          {r.organic ? num(r.organic.sessions) : DASH}
        </td>
      );
    case "opportunities":
      return <td className="dk-table-right dk-num">{num(r.opportunities)}</td>;
    case "readiness":
      return <td className="dk-num">{r.readiness ? `${num(r.readiness.pass)} of ${num(r.readiness.of)}` : <span title={r.inSitemap ? "Not read by the AI-readiness check yet" : "The AI-readiness check reads sitemap pages only"}>{DASH}</span>}</td>;
    case "words":
      return <td className="dk-table-right dk-num">{num(r.words)}</td>;
    case "links":
      return (
        <td className="dk-table-right dk-num" title={`${num(r.inlinksFromContent)} from their content, ${num(r.inlinks)} from anywhere`}>
          {num(r.inlinksFromContent)}
          <span className="dk-seo-pages-small"> / {num(r.inlinks)}</span>
        </td>
      );
    case "updated":
      return <td className="dk-num">{r.updated ? shortDate(r.updated) : DASH}</td>;
  }
}

/** The column chooser: each optional column a link that shows or hides it; the choice is in the address. */
function Columns({ place }: { place: Place }) {
  const on = place.query.cols;
  return (
    <details className="dk-seo-pages-cols">
      <summary className="dk-seo-pages-cols-btn" title="Show more columns">
        <Icon name="sliders" size={14} />
        <span>Columns{on.length ? ` (${on.length})` : ""}</span>
      </summary>
      <ul className="dk-seo-pages-cols-menu" aria-label="Optional columns">
        {COLUMN_ORDER.map((k) => {
          const shown = on.includes(k);
          return (
            <li key={k}>
              <Go href={columnHref(place, k)} scroll={false} replace className={cx("dk-seo-pages-fopt", shown && "dk-seo-pages-fopt--on")} aria-current={shown ? "true" : undefined} title={COLUMN[k].title}>
                <span className="dk-seo-pages-fbox" aria-hidden>
                  {shown ? <Icon name="check" size={11} /> : null}
                </span>
                <span className="dk-seo-pages-flabel">{COLUMN[k].label}</span>
              </Go>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** The page numbers with gaps: 1 … 4 5 6 … 11. */
function pages(at: number, count: number): (number | "gap")[] {
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

function Pager({ place, total }: { place: Place; total: number }) {
  const { offset, limit } = place.query;
  const count = Math.max(1, Math.ceil(total / limit));
  const at = Math.floor(offset / limit) + 1;
  const to = (n: number) => pagesHref(place, { offset: (n - 1) * limit });
  return (
    <div className="dk-seo-pages-pager">
      <p className="dk-seo-pages-showing dk-num">
        {total ? `Showing ${num(offset + 1)}–${num(Math.min(total, offset + limit))} of ${num(total)} pages` : "No page matches"}
      </p>
      {count > 1 ? (
        <nav className="dk-seo-pages-pages" aria-label="Pages of the list">
          {at > 1 ? (
            <Go href={to(at - 1)} scroll={false} className="dk-seo-pages-pg" aria-label="Previous page">
              <Icon name="chevron-left" size={14} />
            </Go>
          ) : (
            <span className="dk-seo-pages-pg dk-seo-pages-pg--off" aria-hidden>
              <Icon name="chevron-left" size={14} />
            </span>
          )}
          {pages(at, count).map((n, i) =>
            n === "gap" ? (
              <span key={`g${i}`} className="dk-seo-pages-pg dk-seo-pages-pg--gap" aria-hidden>
                …
              </span>
            ) : (
              <Go key={n} href={to(n)} scroll={false} className={cx("dk-seo-pages-pg dk-num", n === at && "dk-seo-pages-pg--on")} aria-current={n === at ? "page" : undefined}>
                {n}
              </Go>
            ),
          )}
          {at < count ? (
            <Go href={to(at + 1)} scroll={false} className="dk-seo-pages-pg" aria-label="Next page">
              <Icon name="chevron-right" size={14} />
            </Go>
          ) : (
            <span className="dk-seo-pages-pg dk-seo-pages-pg--off" aria-hidden>
              <Icon name="chevron-right" size={14} />
            </span>
          )}
        </nav>
      ) : null}
      <div className="dk-seo-pages-perpage">
        <span aria-hidden>Rows per page</span>
        {/* The select reads the address in the browser; until it has, its place is kept. */}
        <Suspense fallback={<span className="dk-seo-pages-perpage-space" />}>
          <Select param="limit" fallback="10" resets={["offset"]} label="Rows per page" options={ROWS_PER_PAGE.map((n) => ({ value: String(n), label: String(n) }))} />
        </Suspense>
      </div>
    </div>
  );
}

const PART: Record<string, string> = { che: "Switzerland only", mobile: "phones only", desktop: "desktop computers only", tablet: "tablets only" };

/** The window the search columns cover, for the table's foot. */
function basisLine(search: Reading<SearchBasis>): string {
  if (search.state !== "ok") return "Search figures not available: see the tiles above. Without them the Clicks and Impr. columns are empty, not zero.";
  const b = search.value;
  const part = [b.country !== "all" ? PART[b.country] : null, b.device !== "all" ? PART[b.device] : null].filter(Boolean).join(", ");
  return `Clicks, impressions, CTR and position: Google Search, ${shortDate(b.start)} – ${shortDate(b.end)}${part ? ` (${part})` : ""}, ${b.by === "history" ? "from the desk's own daily copy of Search Console" : "asked from Search Console (the desk's own copy has not run yet)"}.`;
}

/**
 * The window the Organic sessions column covers. GA4 is a day behind where
 * Search Console is two to three, so its window is not the search columns'
 * one, and the foot says both rather than let the two read as one period.
 */
function organicLine(organic: SeoPagesPayload["organic"]): string {
  if (organic.state !== "ok") return `Organic sessions not available: ${organic.reason}`;
  const o = organic.value;
  return `Organic sessions: GA4, ${shortDate(o.start)} – ${shortDate(o.end)}, sessions that began on the page from organic search (${num(o.sessions)} on ${num(o.pages)} page${o.pages === 1 ? "" : "s"}). Consenting visitors only, so fewer than came.`;
}

/**
 * The addresses Google counted that the crawl does not read: each opens in the
 * summary's place, where the desk asks the live site what it answers now and
 * a redirect can be proposed for it.
 */
function Elsewhere({ data, place }: { data: SeoPagesPayload; place: Place }) {
  const e = data.elsewhere;
  if (e.state !== "ok" || e.value.addresses === 0) return null;
  const v = e.value;
  return (
    <details className="dk-seo-pages-elsewhere">
      <summary>
        Google also counted {num(v.impressions)} impression{v.impressions === 1 ? "" : "s"} and {num(v.clicks)} click{v.clicks === 1 ? "" : "s"} on {num(v.addresses)} address{v.addresses === 1 ? "" : "es"} the crawl does not read. Show them
      </summary>
      <ul className="dk-seo-pages-elsewhere-list">
        {v.top.map((t) => (
          <li key={t.path}>
            <Go href={pagesHref(place, { open: t.path })} scroll={false} replace title="Look it up: what the live site answers there now, and what Google holds">
              {t.path}
            </Go>
            <span className="dk-seo-pages-small dk-num">
              {num(t.impressions)} impr. · {num(t.clicks)} click{t.clicks === 1 ? "" : "s"}
            </span>
          </li>
        ))}
      </ul>
      {v.addresses > v.top.length ? <p className="dk-seo-pages-small">The {num(v.top.length)} with the most impressions of {num(v.addresses)}.</p> : null}
    </details>
  );
}

/**
 * The board's "All pages" table: every page the crawl reads with its Search
 * Console figures, Google's index state, the crawl's score and findings, and
 * the optional columns ticked under Columns. Filters, order, columns and the
 * page of the list live in the address; a row opens the page in the summary
 * beside it; "Optimize" opens Page Optimization.
 */
export function PagesList({ data, place, selected }: { data: SeoPagesPayload; place: Place; selected: string | null }) {
  const list = data.list;
  const total = list.state === "ok" ? list.value.total : 0;
  const exp = exportHref(place);
  const cols = place.query.cols;
  const span = 11 + cols.length;
  return (
    <Card
      title="All pages"
      count={list.state === "ok" ? num(total) : undefined}
      className="dk-seo-pages-list"
      flush
      right={
        <div className="dk-seo-pages-list-tools">
          <Columns place={place} />
          <LinkButton href={exp} icon="download" size="sm" title="Download the list as filtered, every matching row, as CSV">
            Export
          </LinkButton>
          <QueueButton
            task={{ kind: "metadata", depth: "deep" }}
            label="Propose metadata fixes"
            variant="primary"
            step="The operator (the studio workstation's model) writes new titles and descriptions for the pages whose title or description breaks a rule at the last crawl, five at a time. Each waits in AI Operator › Approvals; nothing changes on the live site until a person approves."
          />
        </div>
      }
    >
      {list.state !== "ok" ? (
        <div className="dk-seo-pages-pad">
          <Absent reading={list} />
        </div>
      ) : (
        <Picker key={list.value.rows.map((r) => r.page.path).join("|")} exportBase={exp}>
          <div className="dk-table-wrap">
            <table className="dk-table dk-table--roomy dk-table--caps dk-seo-pages-table">
              <caption className="dk-sr">Pages of balkaris.ch with their search figures</caption>
              <thead>
                <tr>
                  <th scope="col" className="dk-table-pick">
                    <input type="checkbox" name="pick-all" className="dk-check" aria-label="Select every row on this page of the list" />
                  </th>
                  <SortHead place={place} sort="path" label="Page" />
                  <th scope="col">Type</th>
                  <SortHead place={place} sort="clicks" label="Clicks" numeric title="Clicks from Google Search (Search Console)" />
                  <SortHead place={place} sort="impressions" label="Impr." numeric title="Impressions in Google Search (Search Console): the board's traffic column. No free source gives search volume." />
                  <SortHead place={place} sort="ctr" label="CTR" numeric />
                  <SortHead place={place} sort="position" label="Pos." numeric title="Average position in Google, weighted by impressions (lower is better)" />
                  <th scope="col" className="dk-table-center" title="Google's index at each address's newest daily URL Inspection">
                    Index
                  </th>
                  <SortHead place={place} sort="score" label="Score" numeric title="SEO score: the desk's own, from its crawl (100 less each rule's cost). Not Google's." />
                  <SortHead place={place} sort="issues" label="Issues" numeric title="Critical and warning findings of the crawl's rules" />
                  {cols.map((k) => (
                    <ExtraHead key={k} col={k} place={place} />
                  ))}
                  <th scope="col" className="dk-table-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.value.rows.length === 0 ? (
                  <tr className="dk-table-none">
                    <td colSpan={span}>
                      No page matches these filters.
                      {list.value.searchedIn ? ` “${place.query.q}” was looked for in ${list.value.searchedIn}.` : ""}
                    </td>
                  </tr>
                ) : (
                  list.value.rows.map((r) => (
                    <tr key={r.page.path} className={cx("dk-table-linked", r.page.path === selected && "dk-seo-pages-row--on")}>
                      <td className="dk-table-pick">
                        <input type="checkbox" name="pick" value={r.page.path} className="dk-check" aria-label={`Select ${r.page.path}`} />
                      </td>
                      <td className="dk-seo-pages-cell-page">
                        <Go href={pagesHref(place, { open: r.page.path })} scroll={false} replace className="dk-table-go" title={r.page.title ? `${r.page.title} · ${r.page.path}` : r.page.path}>
                          <Thumb src={r.page.picture} size="sm" icon="file" />
                          <span className="dk-seo-pages-path">{r.page.path}</span>
                        </Go>
                      </td>
                      <td>
                        <KindChip kind={r.page.kind} label={r.page.kindLabel} />
                      </td>
                      {/* Null when Search Console is not available: nothing is known, which is not a zero. */}
                      <td className="dk-table-right dk-num">{num(r.clicks)}</td>
                      <td className="dk-table-right dk-num">{num(r.impressions)}</td>
                      <td className="dk-table-right dk-num" title={r.impressions === null ? undefined : `${num(r.ctr.num)} clicks of ${num(r.ctr.den)} impressions`}>
                        {r.impressions === null ? DASH : rateCell(r.ctr)}
                      </td>
                      <td className="dk-table-right dk-num">{r.position === null ? DASH : num(r.position, 1)}</td>
                      <td className="dk-table-center">
                        <IndexMark row={r} index={data.index} />
                      </td>
                      <td className="dk-table-right">
                        <span title={r.score === null ? "No score: kept out of the sitemap on purpose, or not readable." : undefined}>
                          <Ring value={r.score} label={`SEO score of ${r.page.path}`} />
                        </span>
                      </td>
                      <td className="dk-table-right">
                        <IssuesCell row={r} />
                      </td>
                      {cols.map((k) => (
                        <ExtraCell key={k} col={k} r={r} data={data} />
                      ))}
                      <td className="dk-table-right">
                        <LinkButton href={optimizeHref(r.page.path, place.range)} size="xs" className="dk-seo-pages-opt">
                          Optimize
                        </LinkButton>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pager place={place} total={total} />
          <div className="dk-seo-pages-list-foot">
            <p>{basisLine(data.search)}</p>
            {cols.includes("sessions") || place.query.sort === "sessions" ? <p>{organicLine(data.organic)}</p> : null}
            {data.index.state === "ok" && (!data.index.value.complete || data.index.value.carried > 0) ? <p>{data.index.note}</p> : null}
            {data.search.state === "ok" && data.search.value.unnamed ? (
              <p>
                Google reported {num(data.search.value.unnamed.clicks)} click{data.search.value.unnamed.clicks === 1 ? "" : "s"} and {num(data.search.value.unnamed.impressions)} impression
                {data.search.value.unnamed.impressions === 1 ? "" : "s"} for the site without naming a page: they are in the tiles above and in no row here.
              </p>
            ) : null}
            <Elsewhere data={data} place={place} />
            <Stamp reading={list} />
          </div>
        </Picker>
      )}
    </Card>
  );
}
