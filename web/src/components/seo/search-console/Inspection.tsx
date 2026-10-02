import type { Reading } from "@/contract/common";
import type { InspectionRow, InspectionTable } from "@/contract/seo/search-console";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Stamp } from "@/components/ui/Stamp";
import { Tooltip } from "@/components/ui/Tooltip";
import { PanelAbsent } from "@/components/seo/bits";
import { cx } from "@/lib/cx";
import { DASH, fullDate, num, shortDate } from "@/lib/format";
import { Pager } from "./Explorer";
import { optimizeHref, scHref, type Place } from "./href";
import { MarkRequested } from "./MarkRequested";

const SHOW: { key: "all" | "not-indexed" | "indexed"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "not-indexed", label: "Not indexed" },
  { key: "indexed", label: "Indexed" },
];

/** Google's state of one address: its own words, marked, with what it means and what fixes it on hover. */
function StateCell({ row }: { row: InspectionRow }) {
  const words = row.coverage ?? (row.indexed ? "Indexed" : "Not indexed");
  return (
    <Tooltip
      text={
        <>
          {row.meaning}
          <span className="dk-absent-tip-step">{row.fix}</span>
        </>
      }
    >
      <span className={cx("dk-seo-gsc-state", row.indexed ? "dk-seo-gsc-state--yes" : "dk-seo-gsc-state--no")} tabIndex={0}>
        <Icon name={row.indexed ? "check-circle" : "x-circle"} size={14} />
        <span>{words}</span>
        <span className="dk-sr">
          . {row.meaning} {row.fix}
        </span>
      </span>
    </Tooltip>
  );
}

function CanonicalCell({ row }: { row: InspectionRow }) {
  if (row.canonicalOk === null) {
    return (
      <span className="dk-seo-gsc-none" title="Google has chosen no canonical: it has not indexed the page.">
        {DASH}
      </span>
    );
  }
  if (row.canonicalOk) return <span className="dk-seo-gsc-canon">Accepted</span>;
  return (
    <span className="dk-seo-gsc-canon dk-seo-gsc-canon--no" title={`The page declares ${row.userCanonical ?? "none"}; Google chose ${row.googleCanonical ?? "none"}.`}>
      Google chose another
    </span>
  );
}

/**
 * Where the address stands in the desk's Request indexing queue, with the
 * button that records a request: "Mark requested" while it waits, the name
 * and day once a person marked it (with Undo), nothing for an indexed page.
 */
function QueueCell({ row }: { row: InspectionRow }) {
  const q = row.queue;
  if (row.indexed) return <span className="dk-seo-gsc-none">{DASH}</span>;
  if (!q) {
    return (
      <span className="dk-seo-gsc-queue dk-seo-gsc-queue--out" title="Not in the desk's Request indexing queue: the opportunity engine has not listed it (a page kept out of search on purpose, or not yet looked at).">
        Not queued
      </span>
    );
  }
  if (q.state === "requested") {
    return (
      <span className="dk-seo-gsc-queue-cell">
        <span className="dk-seo-gsc-queue dk-seo-gsc-queue--done" title={`Request indexing pressed in Search Console${q.by ? ` by ${q.by}` : ""}${q.at ? ` on ${fullDate(q.at)}` : ""}, as marked on the desk.`}>
          <Icon name="check" size={12} />
          {q.by ?? "Requested"}
          {q.at ? `, ${shortDate(q.at)}` : ""}
        </span>
        <MarkRequested path={row.path} requested />
      </span>
    );
  }
  if (q.state === "open") return <MarkRequested path={row.path} requested={false} />;
  return <span className="dk-seo-gsc-queue">In hand</span>;
}

/**
 * Google's URL Inspection of every address in the website's sitemap, the
 * newest daily check (Search Console's URL Inspection, through its API): is
 * the address in the index, Google's own words for its state, when Google last
 * crawled it, whether Google accepted the page's canonical. Each row opens the
 * result in Search Console itself, where a person presses Request indexing
 * (no API offers it for an ordinary page), and "Mark requested" records that
 * they did in the desk's queue.
 */
export function Inspection({ reading, place }: { reading: Reading<InspectionTable>; place: Place }) {
  const v = reading.state === "ok" ? reading.value : null;
  const counts = v ? { all: v.inspected, "not-indexed": v.notIndexed, indexed: v.indexed } : null;
  return (
    <Card
      title="URL inspection"
      icon="search"
      className="dk-seo-gsc-inspect"
      count={v ? num(v.inspected) : undefined}
      info="Google’s stored state of each address in the sitemap, asked once a day through Search Console’s URL Inspection API (Google allows 2,000 a day per property). It is the indexed version Google holds, not a live test of the page. Not Search Console’s Page indexing total, which no API gives."
      sub={v ? `Checked ${fullDate(v.day)} · ${num(v.indexed)} indexed · ${num(v.notIndexed)} not indexed${v.canonicalDiffers ? ` · ${num(v.canonicalDiffers)} with another canonical` : ""}${v.complete ? "" : ` · a part of the site: ${num(v.inspected)} of ${v.of === null ? "the" : num(v.of)} addresses`}` : undefined}
      right={
        counts ? (
          <nav className="dk-seo-gsc-switch" aria-label="Which addresses">
            {SHOW.map((s) => (
              <Go key={s.key} href={scHref(place, { ix: s.key })} scroll={false} replace className={cx("dk-seo-gsc-switch-item", place.ix.show === s.key && "dk-seo-gsc-switch-item--on")} aria-current={place.ix.show === s.key ? "true" : undefined}>
                {s.label} <span className="dk-num dk-seo-gsc-switch-count">{num(counts[s.key])}</span>
              </Go>
            ))}
          </nav>
        ) : null
      }
    >
      {!v || reading.state !== "ok" ? (
        <PanelAbsent reading={reading as Exclude<Reading<InspectionTable>, { state: "ok" }>} />
      ) : (
        <div className="dk-seo-gsc-inspect-body">
          <ul className="dk-seo-gsc-states" aria-label="Google’s states, with how many addresses carry each">
            {v.states.map((s) => (
              <li key={s.state} className={cx("dk-seo-gsc-states-item", s.indexed ? "dk-seo-gsc-states-item--yes" : "dk-seo-gsc-states-item--no")} title={s.meaning}>
                <span className="dk-seo-gsc-states-dot" aria-hidden />
                <span>{s.state}</span>
                <span className="dk-num dk-seo-gsc-states-n">{num(s.count)}</span>
              </li>
            ))}
          </ul>
          <div className="dk-table-wrap dk-seo-gsc-table-wrap">
            <table className="dk-table dk-table--dense dk-seo-gsc-itable">
              <caption className="dk-sr">URL Inspection of every sitemap address, {v.day}</caption>
              <thead>
                <tr>
                  <th scope="col">Address</th>
                  <th scope="col">Google’s state</th>
                  <th scope="col">Last crawl</th>
                  <th scope="col">Canonical</th>
                  <th scope="col" title="Request indexing is pressed by a person in Search Console (no API offers it); the desk records that it was done">
                    Request indexing
                  </th>
                  <th scope="col" className="dk-table-right">
                    <span className="dk-sr">In Search Console</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {v.rows.length === 0 ? (
                  <tr className="dk-table-none">
                    <td colSpan={6}>{place.ix.show === "not-indexed" ? "Every inspected address is in Google’s index." : "No address in this view."}</td>
                  </tr>
                ) : (
                  v.rows.map((row) => (
                    <tr key={row.url}>
                      <td className="dk-seo-gsc-iaddr">
                        <Go href={optimizeHref(row.path)} className="dk-seo-gsc-key-link" title={`${row.url}: open in Page Optimization`}>
                          {row.path}
                        </Go>
                      </td>
                      <td className="dk-seo-gsc-istate">
                        <StateCell row={row} />
                      </td>
                      <td className="dk-num">{row.lastCrawl ? shortDate(row.lastCrawl) : <span className="dk-seo-gsc-none">Never</span>}</td>
                      <td>
                        <CanonicalCell row={row} />
                      </td>
                      <td>
                        <QueueCell row={row} />
                      </td>
                      <td className="dk-table-right">
                        {row.link ? (
                          <LinkButton href={row.link} size="xs" iconRight="external" title="This address in Search Console’s URL Inspection, where Request indexing is">
                            Inspect
                          </LinkButton>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="dk-seo-gsc-foot">
            <Pager total={v.total} offset={place.ix.offset} limit={place.ix.limit} to={(offset) => scHref(place, { ixo: offset })} what={v.total === 1 ? "address" : "addresses"} />
            <Stamp reading={reading} />
          </div>
        </div>
      )}
    </Card>
  );
}
