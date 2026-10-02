import type { ChangeRow, ExperimentsPayload } from "@/contract/experiments";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Badge";
import { Go } from "@/components/ui/Go";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Table } from "@/components/ui/Table";
import { Tooltip } from "@/components/ui/Tooltip";
import { clock, fullDate, num, rangeLabel } from "@/lib/format";
import { FRESH, to, type Here } from "./href";

/** How many addresses a row names before it says "+3 more". */
const NAMED = 2;

/** The Pages screen's address for one page (the same one the top bar's search uses). */
const pageHref = (path: string) => `/pages?open=${encodeURIComponent(path)}`;

function Touched({ row }: { row: ChangeRow }) {
  const named = [...row.pages.slice(0, NAMED)];
  const more = row.pages.length - named.length;
  const rest = row.pages.slice(NAMED);
  if (!row.pages.length && !row.templates.length) {
    return (
      <span className="dk-experiments-touched dk-experiments-quiet">
        {row.otherFiles ? `No page by name · ${num(row.otherFiles)} shared file${row.otherFiles === 1 ? "" : "s"}` : "No files"}
      </span>
    );
  }
  return (
    <span className="dk-experiments-touched">
      {named.map((p) => (
        <Go key={p} href={pageHref(p)} className="dk-experiments-path" title={p}>
          {p}
        </Go>
      ))}
      {more > 0 ? (
        <Tooltip text={rest.join(", ")}>
          <span className="dk-experiments-more" tabIndex={0}>
            +{num(more)} more
          </span>
        </Tooltip>
      ) : null}
      {row.templates.map((t) => (
        <Tooltip key={t} text={`A page template: every address of the shape ${t}.`}>
          <span className="dk-experiments-path dk-experiments-path--template" tabIndex={0}>
            {t}
          </span>
        </Tooltip>
      ))}
      {row.otherFiles ? <span className="dk-experiments-quiet">· {num(row.otherFiles)} shared</span> : null}
    </span>
  );
}

function Sha({ row }: { row: ChangeRow }) {
  return row.url ? (
    <Go href={row.url} className="dk-experiments-sha" title="The commit on GitHub (the repository is private)">
      {row.short}
    </Go>
  ) : (
    <span className="dk-experiments-sha">{row.short}</span>
  );
}

function Kind({ row }: { row: ChangeRow }) {
  return row.kind === "publish" ? <Chip tone="good">Article listed</Chip> : <Chip tone="quiet">Deploy</Chip>;
}

/**
 * Recent changes: every commit to the website's main branch in the range,
 * newest first, each with a button that opens the comparison around it.
 * A table while the panel is wide; under a phone's width the same rows as a
 * stacked list, so the Compare button is never scrolled out of sight.
 */
export function ChangesCard({ data, now }: { data: ExperimentsPayload; now: Here }) {
  const r = data.changes;
  const v = r.state === "ok" ? r.value : null;
  const total = v ? v.total : null;
  const all = !!v?.all;
  const compareHref = (row: ChangeRow) => to(now, { ...FRESH, change: row.sha, window: now.window ?? null }, "compare");
  /* When the read stops inside the range, the count is a floor, and says so. */
  const counted = v && total !== null ? (v.complete ? num(total) : `at least ${num(total)}`) : undefined;

  return (
    <Card
      title="Recent changes"
      icon="branch"
      className="dk-experiments-changes"
      count={counted}
      sub={`Every push to the website's main branch is a production deployment · ${rangeLabel(data.range)}${v && !v.complete && v.readFrom ? ` · read back to ${fullDate(v.readFrom)}` : ""}`}
      info="Commits to main, read from the website's repository, each on the day it was committed. Pages are named only where a file says which page it is: the page's own file, a file in its folder, or its article's file. A shared component, style or picture is counted as a shared file, not guessed onto a page."
      right={
        v && total !== null && total > v.rows.length && !all ? (
          <LinkButton href={to(now, { changes: "all" })} size="sm">
            Show all {num(total)}
          </LinkButton>
        ) : v && all && total !== null && total > v.limit ? (
          <LinkButton href={to(now, { changes: null })} size="sm">
            Show the newest {num(v.limit)}
          </LinkButton>
        ) : undefined
      }
      flush
      footer={
        r.state === "ok" ? (
          <div className="dk-experiments-foot">
            <Stamp reading={r} />
          </div>
        ) : undefined
      }
    >
      <Read reading={r}>
        {(v) => (
          <>
            <div className="dk-experiments-wide">
              <Table
                caption="Recent changes to the website"
                rows={v.rows}
                rowKey={(row) => row.sha}
                density="roomy"
                minWidth={820}
                empty={`Nothing was pushed to main in the ${rangeLabel(data.range).toLowerCase()}.`}
                columns={[
                  {
                    key: "change",
                    head: "Change",
                    width: "38%",
                    cell: (row) => (
                      <span className="dk-experiments-change">
                        <span className="dk-experiments-subject" title={row.subject}>
                          {row.subject}
                        </span>
                        <span className="dk-experiments-meta">
                          <Sha row={row} />
                          <span aria-hidden>·</span>
                          <span title={row.authorFull}>{row.author}</span>
                        </span>
                      </span>
                    ),
                  },
                  { key: "kind", head: "Kind", width: "9%", cell: (row) => <Kind row={row} /> },
                  {
                    key: "when",
                    head: "Committed",
                    width: "12%",
                    cell: (row) => (
                      <span className="dk-experiments-when dk-num">
                        {fullDate(row.at)}
                        <span className="dk-experiments-quiet">{clock(row.at)}</span>
                      </span>
                    ),
                  },
                  { key: "pages", head: "Pages touched", cell: (row) => <Touched row={row} /> },
                  {
                    key: "compare",
                    head: <span className="dk-sr">Compare</span>,
                    align: "right",
                    width: "112px",
                    cell: (row) => (
                      <LinkButton href={compareHref(row)} size="xs" variant="good" icon="flask">
                        Compare
                      </LinkButton>
                    ),
                  },
                ]}
              />
            </div>
            {v.rows.length ? (
              <ul className="dk-experiments-narrow" aria-label="Recent changes to the website">
                {v.rows.map((row) => (
                  <li key={row.sha} className="dk-experiments-item">
                    <div className="dk-experiments-item-head">
                      <span className="dk-experiments-item-subject">{row.subject}</span>
                      <LinkButton href={compareHref(row)} size="xs" variant="good" icon="flask">
                        Compare
                      </LinkButton>
                    </div>
                    <span className="dk-experiments-meta">
                      <Kind row={row} />
                      <span className="dk-num">
                        {fullDate(row.at)} {clock(row.at)}
                      </span>
                      <span aria-hidden>·</span>
                      <Sha row={row} />
                      <span aria-hidden>·</span>
                      <span title={row.authorFull}>{row.author}</span>
                    </span>
                    <Touched row={row} />
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </Read>
    </Card>
  );
}
