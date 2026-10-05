import Form from "next/form";
import type { Reading } from "@/contract/common";
import type { InspectionQuery, InspectionRow, InspectionTable, InspectJob } from "@/contract/seo/search-console";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Stamp } from "@/components/ui/Stamp";
import { Tooltip } from "@/components/ui/Tooltip";
import { PanelAbsent } from "@/components/seo/bits";
import { InspectAddress, InspectNowButton } from "@/components/seo/google/actions";
import { cx } from "@/lib/cx";
import { ago, clock, DASH, fullDate, num, shortDate } from "@/lib/format";
import { CheckAgain } from "./CheckAgain";
import { Pager } from "./Explorer";
import { BASE, keptFields, optimizeHref, scHref, type Place } from "./href";
import { MarkRequested } from "./MarkRequested";

const SHOW: { key: InspectionQuery["show"]; label: string }[] = [
  { key: "all", label: "All" },
  { key: "not-indexed", label: "Not indexed" },
  { key: "indexed", label: "Indexed" },
];

const SORTS: { key: InspectionQuery["sort"]; label: string; title: string }[] = [
  { key: "queue", label: "To request first", title: "Not indexed first: what still waits for Request indexing, then what was requested, then the indexed ones" },
  { key: "address", label: "Address", title: "A to Z by address" },
  { key: "crawl", label: "Last crawl", title: "Crawled by Google most recently first; never crawled last" },
];

/** Google's words for robots.txt and for its last fetch, in plain ones. */
const ROBOTS: Record<string, string> = { ALLOWED: "allows it", DISALLOWED: "blocks it" };
const FETCH: Record<string, string> = {
  SUCCESSFUL: "fetched it",
  SOFT_404: "read it as an empty page (soft 404)",
  BLOCKED_ROBOTS_TXT: "was blocked by robots.txt",
  NOT_FOUND: "got 404",
  ACCESS_DENIED: "was refused (401)",
  SERVER_ERROR: "got a server error (5xx)",
  REDIRECT_ERROR: "hit a redirect error",
  ACCESS_FORBIDDEN: "was refused (403)",
  BLOCKED_4XX: "got another 4xx",
  INTERNAL_CRAWL_ERROR: "had an error of its own",
  INVALID_URL: "found the address invalid",
};

/** What Google said of robots.txt and its last fetch, one line, or null when it said nothing. */
function fetchLine(row: InspectionRow): string | null {
  const parts = [
    row.robots && row.robots !== "ROBOTS_TXT_STATE_UNSPECIFIED" ? `robots.txt ${ROBOTS[row.robots] ?? row.robots.toLowerCase()}` : "",
    row.fetchState && row.fetchState !== "PAGE_FETCH_STATE_UNSPECIFIED" ? `at its last crawl Google ${FETCH[row.fetchState] ?? row.fetchState.toLowerCase().replace(/_/g, " ")}` : "",
  ].filter(Boolean);
  return parts.length ? `${parts.join("; ")}.` : null;
}

/** Google's state of one address: its own words, marked, with what it means, what fixes it and how its last fetch went on hover. */
function StateCell({ row }: { row: InspectionRow }) {
  const words = row.coverage ?? (row.indexed ? "Indexed" : "Not indexed");
  const fetched = fetchLine(row);
  return (
    <Tooltip
      text={
        <>
          {row.meaning}
          {fetched ? <span className="dk-absent-tip-step">{fetched.charAt(0).toUpperCase() + fetched.slice(1)}</span> : null}
          <span className="dk-absent-tip-step">{row.fix}</span>
        </>
      }
    >
      <span className={cx("dk-seo-gsc-state", row.indexed ? "dk-seo-gsc-state--yes" : "dk-seo-gsc-state--no")} tabIndex={0}>
        <Icon name={row.indexed ? "check-circle" : "x-circle"} size={14} />
        <span>{words}</span>
        <span className="dk-sr">
          . {row.meaning} {fetched ?? ""} {row.fix}
        </span>
      </span>
    </Tooltip>
  );
}

/** Whether Google took the page's own canonical, with both addresses on hover. */
function CanonicalCell({ row }: { row: InspectionRow }) {
  if (row.canonicalOk === null) {
    return (
      <span className="dk-seo-gsc-none" title={row.userCanonical ? `Google has chosen no canonical: it has not indexed the page. The page declares ${row.userCanonical}.` : "Google has chosen no canonical: it has not indexed the page."}>
        {DASH}
      </span>
    );
  }
  const said = `The page declares ${row.userCanonical ?? "no canonical"}; Google chose ${row.googleCanonical ?? "none"}.`;
  if (row.canonicalOk)
    return (
      <span className="dk-seo-gsc-canon" title={said}>
        Accepted
      </span>
    );
  return (
    <span className="dk-seo-gsc-canon dk-seo-gsc-canon--no" title={said}>
      Google chose another
      <span className="dk-sr">. {said}</span>
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

/** The address, with the day of its result when that is not the newest check's, and a mark when the sitemap does not list it. */
function AddressCell({ row, day }: { row: InspectionRow; day: string }) {
  return (
    <span className="dk-seo-gsc-iaddr-in">
      <Go href={optimizeHref(row.path)} className="dk-seo-gsc-key-link" title={`${row.url}: open in Page Optimization`}>
        {row.path}
      </Go>
      {row.day !== day ? (
        <span className="dk-seo-gsc-iday" title={`The check on ${fullDate(day)} did not reach this address: this is Google's answer from ${fullDate(row.day)}.`}>
          {row.day < day ? `from ${shortDate(row.day)}` : `asked ${shortDate(row.day)}`}
        </span>
      ) : null}
      {!row.listed ? (
        <span className="dk-seo-gsc-iday" title="The sitemap does not list this address: a person asked Google about it by hand.">
          not in the sitemap
        </span>
      ) : null}
    </span>
  );
}

/** Why the table is empty, from the counts and what was asked, never only from the view. */
function emptyLine(v: InspectionTable, ix: InspectionQuery): string {
  if (ix.q || ix.state) return "No address matches this search.";
  if (ix.show === "not-indexed") return v.notIndexed === 0 ? "Every inspected address is in Google’s index." : "No address in this view.";
  if (ix.show === "indexed") return v.indexed === 0 ? "Google has none of the inspected addresses in its index yet." : "No address in this view.";
  return "No address has been inspected yet.";
}

/**
 * The daily check's own line: its last run (Google's 500 halfway included),
 * a retry the desk planned, and the day's inspection allowance, beside the
 * button that runs it now.
 */
function CheckLine({ job }: { job: InspectJob }) {
  const j = job.job;
  const last = j.running
    ? j.progress
      ? `Checking now: ${num(j.progress.done)} of ${num(j.progress.of)} addresses.`
      : "Checking now."
    : j.lastEnd
      ? `Last check ${ago(j.lastEnd)}${j.lastOk === false ? ", stopped early" : ""}.`
      : "Not run yet on this desk.";
  return (
    <div className="dk-seo-gsc-check">
      <CheckAgain ready={j.ready} running={j.running} enabled={j.enabled} />
      <p className="dk-seo-gsc-check-said">
        <span className={cx(j.lastOk === false && !j.running && "dk-seo-gsc-check-bad")} title={j.lastNote ?? undefined}>
          {last}
          {j.lastNote ? <span className="dk-sr"> {j.lastNote}</span> : null}
        </span>
        {job.retryAt ? (
          <span>
            {" "}
            Tries again by itself at <time dateTime={job.retryAt}>{clock(job.retryAt)}</time>.
          </span>
        ) : null}
        <span className="dk-num" title="Google allows 2,000 URL inspections a day per property, counted in Pacific Time; the desk's daily check stops at 1,800 so some are left for a person.">
          {" "}
          {num(job.allowance.used)} of {num(job.allowance.of)} inspections used today.
        </span>
      </p>
    </div>
  );
}

/**
 * Google's URL Inspection of every address in the website's sitemap: the
 * newest result the desk holds for each (Search Console's URL Inspection,
 * through its API, once a day). When Google cut the newest check short, the
 * addresses it did not reach keep their last earlier result and say which day
 * it is from, so the list never shrinks to the part one check reached. Is the
 * address in the index, Google's own words for its state, when Google last
 * crawled it, whether Google accepted the page's canonical. Each row opens
 * the result in Search Console itself, where a person presses Request
 * indexing (no API offers it for an ordinary page), and "Mark requested"
 * records that they did in the desk's queue. The table searches by address,
 * filters by one of Google's states (press a state) and sorts three ways;
 * "Check again now" runs the check at once.
 *
 * "Inspect now" on a row, and the "Inspect an address" field above the
 * table, ask Google's URL Inspection API at once through the Google actions
 * (src/cc/seo/google-actions.ts, POST /api/v1/seo/google/inspect); the answer
 * is kept and shown in place, and counts against the day's 2,000.
 */
export function Inspection({ reading, place, job }: { reading: Reading<InspectionTable>; place: Place; job: InspectJob | null }) {
  const v = reading.state === "ok" ? reading.value : null;
  const ix = place.ix;
  const counts = v ? { all: v.inspected, "not-indexed": v.notIndexed, indexed: v.indexed } : null;
  const sub = v
    ? [
        `Checked ${fullDate(v.day)}${v.dayComplete ? "" : `, cut short at ${num(v.checked)} of ${v.of === null ? "the" : num(v.of)} addresses`}`,
        v.carried ? `${num(v.carried)} from ${v.carriedFrom ? fullDate(v.carriedFrom) : "an earlier day"}` : "",
        `${num(v.indexed)} indexed`,
        `${num(v.notIndexed)} not indexed`,
        v.canonicalDiffers ? `${num(v.canonicalDiffers)} with another canonical` : "",
        v.complete ? "" : `a part of the site: ${num(v.inspected)} of ${v.of === null ? "the" : num(v.of)} addresses`,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;
  return (
    <Card
      title="URL inspection"
      icon="search"
      className="dk-seo-gsc-inspect"
      count={v ? num(v.inspected) : undefined}
      info="Google’s stored state of each address in the sitemap, asked once a day through Search Console’s URL Inspection API (Google allows 2,000 a day per property). It is the indexed version Google holds, not a live test of the page. When a check is cut short, the addresses it did not reach keep their last result from the week before, and say from which day. Not Search Console’s Page indexing total, which no API gives."
      sub={sub}
      right={
        counts ? (
          <nav className="dk-seo-gsc-switch" aria-label="Which addresses">
            {SHOW.map((s) => (
              <Go key={s.key} href={scHref(place, { ix: s.key })} scroll={false} replace className={cx("dk-seo-gsc-switch-item", ix.show === s.key && "dk-seo-gsc-switch-item--on")} aria-current={ix.show === s.key ? "true" : undefined}>
                {s.label} <span className="dk-num dk-seo-gsc-switch-count">{num(counts[s.key])}</span>
              </Go>
            ))}
          </nav>
        ) : null
      }
    >
      {job ? <CheckLine job={job} /> : null}
      {!v || reading.state !== "ok" ? (
        <PanelAbsent reading={reading as Exclude<Reading<InspectionTable>, { state: "ok" }>} />
      ) : (
        <div className="dk-seo-gsc-inspect-body">
          <ul className="dk-seo-gsc-states" aria-label="Google’s states, with how many addresses carry each. Press one to list only those.">
            {v.states.map((s) => {
              const on = ix.state !== null && ix.state.toLowerCase() === s.state.toLowerCase();
              return (
                <li key={s.state}>
                  <Go
                    href={scHref(place, { ixs: on ? null : s.state })}
                    scroll={false}
                    replace
                    className={cx("dk-seo-gsc-states-item", s.indexed ? "dk-seo-gsc-states-item--yes" : "dk-seo-gsc-states-item--no", on && "dk-seo-gsc-states-item--on")}
                    aria-current={on ? "true" : undefined}
                    title={on ? "Show every state again" : `${s.meaning} Press to list only these.`}
                  >
                    <span className="dk-seo-gsc-states-dot" aria-hidden />
                    <span>{s.state}</span>
                    <span className="dk-num dk-seo-gsc-states-n">{num(s.count)}</span>
                    {on ? <Icon name="x" size={12} /> : null}
                  </Go>
                </li>
              );
            })}
          </ul>
          <div className="dk-seo-gsc-itools">
            <Form action={BASE} prefetch={false} scroll={false} replace className="dk-seo-gsc-search" role="search">
              {keptFields(place, ["ixq"]).map(([k, val]) => (
                <input key={k} type="hidden" name={k} value={val} />
              ))}
              <Icon name="search" size={15} className="dk-seo-gsc-search-icon" />
              <input type="search" name="ixq" defaultValue={ix.q} placeholder="Address contains…" aria-label="Show only the addresses that contain this" className="dk-seo-gsc-search-input" maxLength={80} />
            </Form>
            <nav className="dk-seo-gsc-switch" aria-label="Order of the addresses">
              {SORTS.map((s) => (
                <Go key={s.key} href={scHref(place, { ixsort: s.key })} scroll={false} replace className={cx("dk-seo-gsc-switch-item", ix.sort === s.key && "dk-seo-gsc-switch-item--on")} aria-current={ix.sort === s.key ? "true" : undefined} title={s.title}>
                  {s.label}
                </Go>
              ))}
            </nav>
            {ix.q || ix.state ? (
              <Go href={scHref(place, { ixq: "", ixs: null })} scroll={false} replace className="dk-seo-gsc-clear">
                <Icon name="x" size={13} />
                <span>Clear search</span>
              </Go>
            ) : null}
          </div>
          <InspectAddress />
          <div className="dk-table-wrap dk-seo-gsc-table-wrap">
            <table className="dk-table dk-table--dense dk-seo-gsc-itable">
              <caption className="dk-sr">URL Inspection of every sitemap address, newest result for each, check of {v.day}</caption>
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
                    <td colSpan={6}>{emptyLine(v, ix)}</td>
                  </tr>
                ) : (
                  v.rows.map((row) => (
                    <tr key={row.url}>
                      <td className="dk-seo-gsc-iaddr">
                        <AddressCell row={row} day={v.day} />
                      </td>
                      <td className="dk-seo-gsc-istate">
                        <StateCell row={row} />
                      </td>
                      <td className="dk-num">{row.lastCrawl ? <span title={fullDate(row.lastCrawl)}>{shortDate(row.lastCrawl)}</span> : <span className="dk-seo-gsc-none">Never</span>}</td>
                      <td>
                        <CanonicalCell row={row} />
                      </td>
                      <td>
                        <QueueCell row={row} />
                      </td>
                      <td className="dk-table-right">
                        <InspectNowButton path={row.path} compact />
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
            <Pager total={v.total} offset={ix.offset} limit={ix.limit} to={(offset) => scHref(place, { ixo: offset })} what={v.total === 1 ? "address" : "addresses"} />
            <Stamp reading={reading} />
          </div>
        </div>
      )}
    </Card>
  );
}
