import type { Reading } from "@/contract/common";
import type { IssueGroup, TechAsked, TechPage } from "@/contract/seo/technical";
import { Chip } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Select } from "@/components/ui/Select";
import { Stamp } from "@/components/ui/Stamp";
import { Table, type Column } from "@/components/ui/Table";
import { cx } from "@/lib/cx";
import { fullDate, num } from "@/lib/format";
import { TaskButton } from "./Act";
import { Body, PathLink, pageView, Quiet, Severity } from "./bits";

/**
 * Every finding of the last crawl by rule, worst first, and every page by its
 * score. Both are narrowed by the page's search (?q=), the findings by
 * severity (?sev=) and the pages by Google's answer (?index=); the server
 * narrows them, so what is shown is what the address says.
 */

const SEV_OPTIONS = [
  { value: "all", label: "Every severity" },
  { value: "critical", label: "Critical" },
  { value: "warning", label: "Warnings" },
  { value: "opportunity", label: "Opportunities" },
] as const;

const INDEX_OPTIONS = [
  { value: "all", label: "Google: any" },
  { value: "indexed", label: "Indexed" },
  { value: "not", label: "Not indexed" },
  { value: "unknown", label: "Not inspected" },
] as const;

const AREA: Record<string, string> = {
  status: "Status",
  indexing: "Indexing",
  canonical: "Canonical",
  title: "Title",
  description: "Description",
  headings: "Headings",
  content: "Content",
  share: "Share",
  schema: "Structured data",
  links: "Links",
  images: "Images",
  sitemap: "Sitemap",
  robots: "Robots.txt",
  redirects: "Redirects",
};

export function IssueRows({ rows, label }: { rows: IssueGroup[]; label: string }) {
  return (
    <ul className="dk-seo-technical-issues" aria-label={label}>
      {rows.map((g) => (
        <li key={g.rule} className="dk-seo-technical-issue">
          <details>
            <summary className="dk-seo-technical-issue-head">
              <Severity severity={g.severity} />
              <span className="dk-seo-technical-issue-title">
                {g.title}
                {g.area ? <span className="dk-seo-technical-issue-area">{AREA[g.area] ?? g.area}</span> : null}
                {g.fresh ? (
                  <Chip tone="info" className="dk-seo-technical-issue-new">
                    {num(g.fresh)} new
                  </Chip>
                ) : null}
              </span>
              <span className="dk-seo-technical-issue-n dk-num" title={`${g.count} finding${g.count === 1 ? "" : "s"}${g.scope === "site" ? " about the site" : `, on ${g.pages.length} page${g.pages.length === 1 ? "" : "s"}`}`}>
                {num(g.count)}
              </span>
              <span className="dk-seo-technical-issue-cost dk-num" title="Points it costs a page (or the site) in the crawl’s score">
                −{num(g.cost)}
              </span>
              <Icon name="chevron-down" size={14} className="dk-seo-technical-cov-chev" />
            </summary>
            <div className="dk-seo-technical-issue-body">
              <ul className="dk-seo-technical-issue-lines">
                {(g.lines ?? g.pages.map((p) => ({ path: p, text: "" }))).map((l, i) => (
                  <li key={`${l.path ?? "site"}-${i}`} title={"firstSeen" in l && l.firstSeen ? `First found by the crawl of ${fullDate(l.firstSeen)}` : undefined}>
                    {l.path ? <PathLink path={l.path} /> : <span className="dk-seo-technical-path">the site</span>}
                    {l.text ? <span className="dk-seo-technical-issue-text">{l.text}</span> : null}
                  </li>
                ))}
              </ul>
              {g.lines && g.count > g.lines.length ? <Quiet>And {num(g.count - g.lines.length)} more of the same rule.</Quiet> : null}
              {g.fix ? (
                <div className="dk-seo-technical-issue-fix">
                  <TaskButton task={g.fix.task} label={g.fix.label} variant="good" icon="sparkles" />
                  <Quiet>
                    {g.fix.task.paths?.length ? `For ${g.fix.task.paths.join(", ")}. ` : ""}
                    {g.fixNote ? `${g.fixNote} ` : ""}The operator writes proposals on the studio workstation; nothing on the site changes before a person approves them.
                  </Quiet>
                </div>
              ) : g.fixNote ? (
                <Quiet>
                  {g.fixNote}{" "}
                  <Go href="/operator?ap=waiting#approvals" className="dk-seo-technical-path--link">
                    Open the approvals
                  </Go>
                </Quiet>
              ) : null}
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

/** Findings of the groups, split as the crawl counts them: critical and warnings are issues, opportunities are not. */
function split(rows: IssueGroup[]): { issues: number; opportunities: number } {
  let issues = 0;
  let opportunities = 0;
  for (const g of rows) {
    if (g.severity === "opportunity") opportunities += g.count;
    else issues += g.count;
  }
  return { issues, opportunities };
}

export function IssuesCard({ reading, asked }: { reading: Reading<{ rows: IssueGroup[]; total?: number }>; asked?: TechAsked }) {
  const n = reading.state === "ok" ? split(reading.value.rows) : null;
  const narrowed = !!asked && (asked.q !== "" || asked.sev !== "all");
  const sevWord = asked?.sev === "critical" ? "critical findings" : asked?.sev === "warning" ? "warnings" : "opportunities";
  return (
    <Card
      title="Issues by rule"
      icon="list"
      id="issues"
      count={n ? num(n.issues) : undefined}
      info="Every finding of the last crawl, grouped by the rule that found it, worst first, with the points the rule costs in the score. Critical and warning findings are issues, and only they are counted beside the title; opportunities are polish, listed after them and never counted as issues. “new” marks findings the last crawl found for the first time."
      right={<Select param="sev" label="Severity" fallback="all" options={SEV_OPTIONS} />}
      flush
      className="dk-seo-technical-issues-card"
    >
      <Body reading={reading}>
        {(v) =>
          v.rows.length ? (
            <>
              <Quiet className="dk-seo-technical-pad-x dk-seo-technical-issues-sum">
                {num(n?.issues ?? 0)} {n?.issues === 1 ? "issue" : "issues"} (critical and warnings) and {num(n?.opportunities ?? 0)} {n?.opportunities === 1 ? "opportunity" : "opportunities"}, under {num(v.rows.length)} {v.rows.length === 1 ? "rule" : "rules"}
                {narrowed && v.total !== undefined ? ` of ${num(v.total)}, as narrowed${asked?.q ? ` to “${asked.q}”` : ""}` : ""}.
              </Quiet>
              <IssueRows rows={v.rows} label="Findings by rule" />
              <div className="dk-seo-technical-stampline">
                <Stamp reading={reading} />
              </div>
            </>
          ) : narrowed ? (
            <Quiet className="dk-seo-technical-pad">
              No finding of the last crawl matches{asked?.q ? ` “${asked.q}”` : ""}
              {asked && asked.sev !== "all" ? ` among the ${sevWord}` : ""}.{v.total ? ` ${num(v.total)} rules have findings in all.` : ""}
            </Quiet>
          ) : (
            <Quiet className="dk-seo-technical-pad">The last crawl found nothing against any rule.</Quiet>
          )
        }
      </Body>
    </Card>
  );
}

const PAGES_SHOWN = 12;

/** Why a cell is empty, by what the page is: outside the sitemap Google is not asked; inside it, no answer has reached the desk. */
const emptyWhy = (p: TechPage): string =>
  p.inSitemap
    ? "No answer from Google yet: the daily check has not reached this sitemap address in the last week. “Inspect now” in the index card asks about it."
    : "Not inspected: it is not in the sitemap, and the daily check asks Google about the sitemap’s addresses only.";

const indexCell = (p: TechPage) =>
  p.inIndex === null ? (
    <span className="dk-seo-technical-quiet-cell" title={emptyWhy(p)}>
      —
    </span>
  ) : p.inIndex ? (
    <span title={p.inIndexDay ? `Google’s answer of ${fullDate(p.inIndexDay)}` : undefined}>
      <Chip tone="good">Indexed</Chip>
    </span>
  ) : (
    <span title={`${p.coverage ?? "Not indexed"}${p.inIndexDay ? `, Google’s answer of ${fullDate(p.inIndexDay)}` : ""}`}>
      <Chip tone="warn">Not indexed</Chip>
    </span>
  );

const COLUMNS: Column<TechPage>[] = [
  {
    key: "page",
    head: "Page",
    cell: (p) => (
      <span className="dk-seo-technical-page-cell" title={p.path}>
        <PathLink path={p.path} plain />
        <span className="dk-seo-technical-page-sub">
          {p.kindLabel}
          {p.inSitemap ? "" : " · not in the sitemap"}
          {p.status !== 200 ? ` · answers ${p.status || "nothing"}` : ""}
        </span>
      </span>
    ),
    sort: (p) => p.path,
  },
  {
    key: "score",
    head: "Score",
    numeric: true,
    cell: (p) => (p.score === null ? <span title="Not scored: kept out of the sitemap, or could not be read">—</span> : <span className={cx(p.score < 70 ? "dk-seo-technical-ink-bad" : p.score < 90 ? "dk-seo-technical-ink-warn" : null)}>{num(p.score)}</span>),
    sort: (p) => p.score,
    width: "64px",
  },
  {
    key: "issues",
    head: "Issues",
    numeric: true,
    cell: (p) => (
      <span className="dk-seo-technical-page-issues dk-num" title={`${p.critical} critical, ${p.warning} warnings, ${p.opportunity} opportunities`}>
        <span className={p.critical ? "dk-seo-technical-ink-bad" : "dk-seo-technical-ink-quiet"}>{num(p.critical)}</span>
        <span className={p.warning ? "dk-seo-technical-ink-warn" : "dk-seo-technical-ink-quiet"}>{num(p.warning)}</span>
        <span className="dk-seo-technical-ink-quiet">{num(p.opportunity)}</span>
      </span>
    ),
    sort: (p) => p.critical * 10_000 + p.warning * 100 + p.opportunity,
    width: "92px",
  },
  { key: "index", head: "Google", cell: indexCell, sort: (p) => (p.inIndex === null ? null : p.inIndex ? 1 : 0), width: "104px" },
];

export function PagesCard({ reading, asked }: { reading: Reading<{ rows: TechPage[]; read: number; scored: number }>; asked?: TechAsked }) {
  const narrowed = !!asked && (asked.q !== "" || asked.index !== "all");
  return (
    <Card
      title="Pages by score"
      icon="pages"
      id="pages"
      count={reading.state === "ok" ? num(reading.value.read) : undefined}
      info="Every page the crawl read, lowest score first. Issues are critical, warnings and opportunities. Google’s column is its newest URL Inspection of the address, from the daily check or from “Inspect now”."
      right={
        <span className="dk-seo-technical-head-tools">
          <Select param="index" label="Google’s answer" fallback="all" options={INDEX_OPTIONS} />
          <LinkButton href="/seo/pages" size="sm">
            All pages
          </LinkButton>
        </span>
      }
      flush
      className="dk-seo-technical-pages"
    >
      <Body reading={reading}>
        {(v) => (
          <div>
            {/* One table over every page, so a sort heading sorts them all; the rows past the first dozen scroll inside the panel under its heads. */}
            <Table
              caption="Pages, lowest score first"
              rows={v.rows}
              columns={COLUMNS}
              rowKey={(p) => p.path}
              rowHref={(p) => pageView(p.path)}
              minWidth={420}
              className={cx("dk-seo-technical-pages-table", v.rows.length > PAGES_SHOWN && "dk-seo-technical-pages-table--scroll")}
            />
            <Quiet className="dk-seo-technical-pad">
              {narrowed ? `${num(v.rows.length)} of ${num(v.read)} pages, as narrowed${asked?.q ? ` to “${asked.q}”` : ""}. ` : ""}
              {num(v.scored)} of {num(v.read)} pages are scored; a page kept out of the sitemap is read but not scored.
              {v.rows.length > PAGES_SHOWN ? ` The list scrolls; the headings sort all ${num(v.rows.length)}.` : ""}
            </Quiet>
          </div>
        )}
      </Body>
    </Card>
  );
}
