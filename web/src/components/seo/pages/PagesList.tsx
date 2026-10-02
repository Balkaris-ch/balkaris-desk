import { Suspense } from "react";
import type { Reading } from "@/contract/common";
import type { PagesSort, SearchBasis, SeoPageRow, SeoPagesPayload } from "@/contract/seo/pages";
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
import { exportHref, firstDir, optimizeHref, pagesHref, ROWS_PER_PAGE, type Place } from "./href";
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

/** Google's index state as the INDEX column draws it. */
function IndexMark({ row }: { row: SeoPageRow }) {
  if (!row.index) {
    const why = row.inSitemap ? "Not inspected yet." : "Not inspected: the daily URL Inspection asks Google about sitemap addresses only, and this one is kept out of the sitemap.";
    return (
      <span className="dk-seo-pages-idx dk-seo-pages-idx--none" title={why}>
        <span aria-hidden>{DASH}</span>
        <span className="dk-sr">{why}</span>
      </span>
    );
  }
  const said = `${row.index.indexed ? "In Google's index" : "Not in Google's index"}${row.index.coverage ? `: ${row.index.coverage}` : ""} (URL Inspection, ${shortDate(row.index.day)})`;
  return (
    <span className={cx("dk-seo-pages-idx", row.index.indexed ? "dk-seo-pages-idx--yes" : "dk-seo-pages-idx--no")} title={said} role="img" aria-label={said}>
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

/** The window the search columns cover, for the table's foot. */
function basisLine(search: Reading<SearchBasis>): string {
  if (search.state !== "ok") return "Search figures not available: see the tiles above.";
  const b = search.value;
  return `Clicks, impressions, CTR and position: Google Search, ${shortDate(b.start)} – ${shortDate(b.end)}, ${b.by === "history" ? "from the desk's own daily copy of Search Console" : "asked from Search Console (the desk's own copy has not run yet)"}.`;
}

/**
 * The board's "All pages" table: every page the crawl reads with its Search
 * Console figures, Google's index state, the crawl's score and findings.
 * Filters, order and the page of the list live in the address; a row opens the
 * page in the summary beside it; "Optimize" opens Page Optimization.
 */
export function PagesList({ data, place, selected }: { data: SeoPagesPayload; place: Place; selected: string | null }) {
  const list = data.list;
  const total = list.state === "ok" ? list.value.total : 0;
  const exp = exportHref(place);
  return (
    <Card
      title="All pages"
      count={list.state === "ok" ? num(total) : undefined}
      className="dk-seo-pages-list"
      flush
      right={
        <div className="dk-seo-pages-list-tools">
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
                  <th scope="col" className="dk-table-center" title="Google's index at the last daily URL Inspection">
                    Index
                  </th>
                  <SortHead place={place} sort="score" label="Score" numeric title="SEO score: the desk's own, from its crawl (100 less each rule's cost). Not Google's." />
                  <SortHead place={place} sort="issues" label="Issues" numeric title="Critical and warning findings of the crawl's rules" />
                  <th scope="col" className="dk-table-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.value.rows.length === 0 ? (
                  <tr className="dk-table-none">
                    <td colSpan={11}>No page matches these filters.</td>
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
                      <td className="dk-table-right dk-num">{num(r.clicks)}</td>
                      <td className="dk-table-right dk-num">{num(r.impressions)}</td>
                      <td className="dk-table-right dk-num" title={`${num(r.ctr.num)} clicks of ${num(r.ctr.den)} impressions`}>
                        {rateCell(r.ctr)}
                      </td>
                      <td className="dk-table-right dk-num">{r.position === null ? DASH : num(r.position, 1)}</td>
                      <td className="dk-table-center">
                        <IndexMark row={r} />
                      </td>
                      <td className="dk-table-right">
                        <span title={r.score === null ? "No score: kept out of the sitemap on purpose, or not readable." : undefined}>
                          <Ring value={r.score} label={`SEO score of ${r.page.path}`} />
                        </span>
                      </td>
                      <td className="dk-table-right">
                        <IssuesCell row={r} />
                      </td>
                      <td className="dk-table-right">
                        <LinkButton href={optimizeHref(r.page.path)} size="xs" className="dk-seo-pages-opt">
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
            {data.search.state === "ok" && data.search.value.unnamed ? (
              <p>
                Google reported {num(data.search.value.unnamed.clicks)} click{data.search.value.unnamed.clicks === 1 ? "" : "s"} and {num(data.search.value.unnamed.impressions)} impression
                {data.search.value.unnamed.impressions === 1 ? "" : "s"} for the site without naming a page: they are in the tiles above and in no row here.
              </p>
            ) : null}
            {data.elsewhere.state === "ok" && data.elsewhere.value.addresses > 0 ? (
              <p title={data.elsewhere.value.top.map((t) => `${t.path}: ${num(t.impressions)} impressions, ${num(t.clicks)} clicks`).join("\n")}>
                Google also counted {num(data.elsewhere.value.impressions)} impression{data.elsewhere.value.impressions === 1 ? "" : "s"} and {num(data.elsewhere.value.clicks)} click
                {data.elsewhere.value.clicks === 1 ? "" : "s"} on {num(data.elsewhere.value.addresses)} address{data.elsewhere.value.addresses === 1 ? "" : "es"} the crawl does not read (
                {data.elsewhere.value.top
                  .slice(0, 3)
                  .map((t) => t.path)
                  .join(", ")}
                {data.elsewhere.value.addresses > 3 ? "…" : ""}).
              </p>
            ) : null}
            <Stamp reading={list} />
          </div>
        </Picker>
      )}
    </Card>
  );
}
