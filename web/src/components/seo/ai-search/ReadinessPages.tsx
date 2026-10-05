import { Fragment } from "react";
import type { AiSearchAsked, PageReadinessAnswer, Readiness, ReadinessCheck } from "@/contract/seo/ai-search";
import { Chip } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Select } from "@/components/ui/Select";
import { cx } from "@/lib/cx";
import { fullDate, num } from "@/lib/format";
import { AiTaskButton, PostButton } from "./Act";
import { BASE, CHECK_STATE, exportHref, hrefWith, paramsOf, WHO_FIX } from "./look";
import "@/components/ui/table.css";
import "./ai-search.css";

/** Short heads for the check columns, in the checks' own order. */
const SHORT: Record<string, string> = {
  answer: "Answer",
  faq: "FAQ",
  "faq-schema": "FAQ data",
  org: "Who, where",
  price: "Price",
  timeline: "Time",
  german: "German",
  updated: "Date",
};

/** The filter's words for the pages that fail a check. */
const FAILING: Record<string, string> = {
  answer: "No direct answer",
  faq: "No questions",
  "faq-schema": "FAQ not in data",
  org: "Not who and where",
  price: "No price",
  timeline: "No timeline",
  german: "No German",
  updated: "No date",
};

const SORTS: { value: AiSearchAsked["psort"]; label: string }[] = [
  { value: "fails", label: "Most failing first" },
  { value: "pass", label: "Most passing first" },
  { value: "path", label: "By address" },
];

const FIND = "dk-seo-ai-search-find-pages";

function Cell({ state, label }: { state: ReadinessCheck["state"] | undefined; label: string }) {
  if (!state || state === "n/a")
    return (
      <span className="dk-seo-ai-search-cell dk-seo-ai-search-cell--none" title={`${label}: does not apply to this kind of page`}>
        ·
      </span>
    );
  const icon = state === "pass" ? "check" : state === "fail" ? "x" : "help";
  const tone = state === "pass" ? "good" : state === "fail" ? "bad" : "warn";
  return (
    <span className={cx("dk-seo-ai-search-cell", `dk-tone-${tone}`)} title={`${label}: ${CHECK_STATE[state].word.toLowerCase()}`}>
      <Icon name={icon} size={14} />
      <span className="dk-sr">
        {label}: {CHECK_STATE[state].word.toLowerCase()}.
      </span>
    </span>
  );
}

/** What each check read on the page the address opens, with "Check again" and the operator's tasks for what it fails. */
function PageDetail({ opened, path }: { opened: PageReadinessAnswer; path: string }) {
  const page = opened.page;
  if (!page)
    return (
      <p className="dk-seo-ai-search-quiet">
        The readiness check has no read of {path}: it left the sitemap, or the next read has not reached it. <PostButton path="/page/check" body={{ path }} label="Read it now" busyLabel="Reading…" icon="refresh" />
      </p>
    );
  return (
    <>
      {page.unread ? (
        <p className="dk-seo-ai-search-unread">
          <Icon name="alert" size={14} />
          <span>
            The newest read, {fullDate(page.unread.at)}, failed: the page {page.unread.why}. These marks are its last good read.
          </span>
        </p>
      ) : null}
      <ul className="dk-seo-ai-search-checks dk-seo-ai-search-page-checks">
        {page.checks.map((c) => {
          const s = CHECK_STATE[c.state];
          return (
            <li key={c.key} className="dk-seo-ai-search-check">
              <span className={cx("dk-seo-ai-search-check-mark", `dk-tone-${s.tone}`)} title={s.word}>
                <Icon name={s.icon} size={16} />
                <span className="dk-sr">{s.word}: </span>
              </span>
              <div className="dk-seo-ai-search-check-text">
                <p className="dk-seo-ai-search-strong">{c.label}</p>
                <p className="dk-seo-ai-search-quiet">{c.detail}</p>
                {c.fix ? (
                  <p className="dk-seo-ai-search-check-fix">
                    <Icon name="arrow-right" size={12} />
                    <span>{c.fix}</span>
                  </p>
                ) : null}
              </div>
              {c.who && c.state === "fail" ? <Chip tone={WHO_FIX[c.who].tone}>{WHO_FIX[c.who].word}</Chip> : null}
            </li>
          );
        })}
      </ul>
      <div className="dk-seo-ai-search-detail-acts">
        <PostButton path="/page/check" body={{ path: page.path }} label="Check again" busyLabel="Reading the page…" icon="refresh" title="Read this page from the website now and judge it again" />
        {(opened.tasks ?? []).map((t) => (
          <AiTaskButton key={t.label} task={t.task} label={t.label} icon={t.task.kind === "brief" ? "file-text" : "message"} />
        ))}
      </div>
      <p className="dk-seo-ai-search-quiet dk-seo-ai-search-page-checks-foot">
        {opened.checkedAt ? `Read ${fullDate(opened.checkedAt)}. ` : ""}
        <Go href={`/seo/pages/view?path=${encodeURIComponent(page.path)}`} className="dk-seo-ai-search-link">
          Open in Page Optimization
        </Go>
        {" · the operator's tasks run on the studio workstation's own model."}
      </p>
    </>
  );
}

/** The readiness job as it stands, in one line, and the button that asks for it now. */
function RunLine({ job }: { job: Readiness["job"] }) {
  if (!job) return null;
  return (
    <span className="dk-seo-ai-search-run">
      {job.running ? (
        <span className="dk-seo-ai-search-quiet">Reading now{job.progress ? `: ${job.progress}` : ""}. Reload to follow it.</span>
      ) : job.ready ? (
        <PostButton path="/readiness/run" label="Run the check" busyLabel="Asking…" icon="play" title="Read every sitemap page now, a second apart" />
      ) : (
        <span className="dk-seo-ai-search-quiet">The check cannot run on this machine; Automations says why.</span>
      )}
    </span>
  );
}

/**
 * Every sitemap page the readiness check read, with its checks. The address
 * says which (failing one check, a search, one kind of page), in what order,
 * the first twelve or all, and the page opened with what each check read;
 * the server draws it, so a view can be shared. "Check again" reads one page
 * now; "Run the check" asks for every page now (the daily slot rarely comes).
 */
export function ReadinessPages({ r, asked, range }: { r: Readiness; asked: AiSearchAsked; range: string }) {
  const base = paramsOf(range, asked);
  const keys = r.byCheck.map((c) => c.key);
  const labelOf = (k: string) => r.byCheck.find((c) => c.key === k)?.label ?? k;
  const filtered = !!(asked.fail || asked.find || asked.kind);
  const lastRun = r.job?.lastStart ? `Last run ${fullDate(r.job.lastStart)}${r.job.lastOk === false ? ", failed" : ""}` : null;

  return (
    <>
      <form id={FIND} method="get" action={BASE} hidden>
        {Object.entries(base)
          .filter(([k]) => k !== "find" && k !== "page")
          .map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
      </form>
      <Card
        id="pages"
        title="Pages and their readiness"
        icon="pages"
        flush
        className="dk-seo-ai-search-panel"
        info="Every sitemap page the readiness check read, the pages with the most failing checks first unless another order is chosen. Open a row to see what each check read on that page and the step that fixes it; a dot means the check does not apply to that kind of page. A page whose newest read failed keeps its last good read, marked."
        sub={`${num(r.list.total)} pages read, ${fullDate(r.checkedAt)} · ${filtered ? `${num(r.list.matching)} match` : `${num(r.list.matching)} with checks that apply`}${lastRun ? ` · ${lastRun}` : ""}`}
        right={
          <span className="dk-seo-ai-search-head-acts">
            <RunLine job={r.job} />
            <LinkButton href={exportHref("readiness")} size="sm" icon="download" title="Every page with each check's state, as CSV">
              CSV
            </LinkButton>
          </span>
        }
      >
        {r.unread ? (
          <p className="dk-seo-ai-search-unread dk-seo-ai-search-pad-x">
            <Icon name="alert" size={14} />
            <span>{r.unread.line}</span>
          </p>
        ) : null}
        <div className="dk-seo-ai-search-toolbar dk-seo-ai-search-pad-x">
          <label className="dk-seo-ai-search-find">
            <Icon name="search" size={14} />
            <input form={FIND} type="search" name="find" defaultValue={asked.find} placeholder="Search pages…" aria-label="Search the pages by address or title" maxLength={80} />
          </label>
          <Select param="kind" label="Which kind of page" fallback="" resets={["page", "pages"]} options={[{ value: "", label: "Every kind of page" }, ...r.list.kinds.map((k) => ({ value: k.kind, label: `${k.kind} (${num(k.count)})` }))]} />
          <Select param="psort" label="Order" fallback="fails" options={SORTS} />
        </div>
        <div className="dk-seo-ai-search-filters dk-seo-ai-search-pad-x" role="group" aria-label="Show pages that fail one check">
          <Go href={hrefWith(base, { fail: undefined, page: undefined }, "pages")} scroll={false} replace className={cx("dk-seo-ai-search-filter", !asked.fail && "dk-seo-ai-search-filter--on")} aria-current={!asked.fail ? "true" : undefined}>
            All pages
          </Go>
          {r.byCheck
            .filter((c) => c.fail > 0 || asked.fail === c.key)
            .map((c) => (
              <Go
                key={c.key}
                href={hrefWith(base, { fail: c.key, page: undefined }, "pages")}
                scroll={false}
                replace
                className={cx("dk-seo-ai-search-filter", asked.fail === c.key && "dk-seo-ai-search-filter--on")}
                aria-current={asked.fail === c.key ? "true" : undefined}
              >
                {FAILING[c.key] ?? `Fails: ${c.label}`}
                <span className="dk-num dk-seo-ai-search-filter-n">{num(c.fail)}</span>
              </Go>
            ))}
          {filtered ? (
            <Go href={hrefWith(base, { fail: undefined, find: undefined, kind: undefined, page: undefined }, "pages")} scroll={false} replace className="dk-seo-ai-search-link dk-seo-ai-search-clear">
              Clear
            </Go>
          ) : null}
        </div>
        <div className="dk-table-wrap">
          <table className="dk-table dk-table--dense dk-table--caps dk-seo-ai-search-pages">
            <caption className="dk-sr">Pages and their AI readiness checks, checked {r.checkedAt.slice(0, 10)}</caption>
            <thead>
              <tr>
                <th scope="col">Page</th>
                <th scope="col">Kind</th>
                {keys.map((k) => (
                  <th key={k} scope="col" className="dk-table-center">
                    {SHORT[k] ?? k}
                  </th>
                ))}
                <th scope="col" className="dk-table-right">
                  Pass
                </th>
                <th scope="col">
                  <span className="dk-sr">Open what each check read</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {r.pages.map((p) => {
                const isOpen = asked.page === p.path;
                return (
                  <Fragment key={p.path}>
                    <tr className={cx(isOpen && "dk-table-picked")}>
                      <td className="dk-seo-ai-search-page">
                        <Go href={`/seo/pages/view?path=${encodeURIComponent(p.path)}`} className="dk-seo-ai-search-page-link">
                          <span className="dk-seo-ai-search-page-title">
                            {p.unread ? <Icon name="alert" size={12} className="dk-seo-ai-search-bad" title="The newest read of this page failed: these marks are its last good read" /> : null}
                            {p.title ?? p.path}
                          </span>
                          <span className="dk-seo-ai-search-quiet">{p.path}</span>
                        </Go>
                      </td>
                      <td className="dk-seo-ai-search-quiet">
                        {p.kind ?? "—"}
                        {p.lang ? ` · ${p.lang.toUpperCase()}` : ""}
                      </td>
                      {keys.map((k) => (
                        <td key={k} className="dk-table-center">
                          <Cell state={p.states[k]} label={labelOf(k)} />
                        </td>
                      ))}
                      <td className={cx("dk-table-right", "dk-num", p.pass === p.of ? "dk-seo-ai-search-good" : p.pass === 0 ? "dk-seo-ai-search-bad" : undefined)}>
                        {num(p.pass)} <span className="dk-seo-ai-search-quiet">of {num(p.of)}</span>
                      </td>
                      <td className="dk-seo-ai-search-page-open">
                        <Go
                          href={hrefWith(base, { page: isOpen ? undefined : p.path }, "pages")}
                          scroll={false}
                          replace
                          className="dk-seo-ai-search-page-toggle"
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? "Close" : "Open"} what each check read on ${p.path}`}
                        >
                          <Icon name={isOpen ? "chevron-up" : "chevron-down"} size={14} />
                        </Go>
                      </td>
                    </tr>
                    {isOpen && r.opened ? (
                      <tr className="dk-seo-ai-search-page-more">
                        <td colSpan={keys.length + 4}>
                          <div className="dk-seo-ai-search-page-detail" aria-live="polite">
                            <PageDetail opened={r.opened} path={p.path} />
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {!r.pages.length ? (
                <tr className="dk-table-none">
                  <td colSpan={keys.length + 4}>{filtered ? "No page matches these filters." : "No page has a check that applies to it."}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {/* A page opened by its address that the table's filters leave out is still shown, under the table. */}
        {asked.page && r.opened && !r.pages.some((p) => p.path === asked.page) ? (
          <div className="dk-seo-ai-search-page-detail dk-seo-ai-search-pad-x" aria-live="polite">
            <p className="dk-seo-ai-search-strong">{r.opened.page?.title ?? asked.page}</p>
            <PageDetail opened={r.opened} path={asked.page} />
          </div>
        ) : null}
        {r.list.matching > r.pages.length || asked.pages === "all" ? (
          <Go href={hrefWith(base, { pages: asked.pages === "all" ? undefined : "all" }, "pages")} scroll={false} replace className="dk-seo-ai-search-more">
            {asked.pages === "all" ? "Show the first twelve" : `Show all ${num(r.list.matching)} pages`}
            <Icon name={asked.pages === "all" ? "chevron-up" : "chevron-down"} size={14} />
          </Go>
        ) : null}
      </Card>
    </>
  );
}
