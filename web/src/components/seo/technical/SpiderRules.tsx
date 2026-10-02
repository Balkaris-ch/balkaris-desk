import type { ExtractResultRow, ExtractResults, ExtractRule } from "@/contract/spider";
import type { Answer } from "@/lib/api";
import { Chip } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import { ago, clock, duration, fullDate, num } from "@/lib/format";
import { PathLink, Quiet } from "./bits";
import { AddRule, DeleteRule, ToggleRule } from "./SpiderAct";

/**
 * Custom extraction, the owner's: rules the crawl runs on each page it reads
 * (GET /api/v1/spider/extract), each with what it found at the last crawl it
 * ran in. A rule's results open under it through the address (?rule=<id>,
 * read by the page in the same round as everything else), so an open rule
 * survives a reload and can be linked to. Adding, switching and deleting are
 * SpiderAct.tsx's; a rule added now runs from the next crawl.
 */

const KIND = { css: "CSS", regex: "Regex", xpath: "XPath" } as const;

const when = (iso: string): string => `${fullDate(iso)}, ${clock(iso)}`;

/** What a rule reads besides its expression, and where it runs. */
function reads(r: ExtractRule): string {
  const what = r.attribute === null ? (r.kind === "regex" ? "the whole match" : "the text") : r.kind === "regex" ? `capture group ${r.attribute}` : `the ${r.attribute} attribute`;
  return `Keeps ${what}, on ${r.scope === null ? "every page" : `the pages under ${r.scope}`}.`;
}

function ran(r: ExtractRule, nextCrawl: string | null): string {
  if (r.lastRun === null) return `Not run yet: it runs from the next crawl${nextCrawl ? `, ${ago(nextCrawl)}` : ""}.`;
  return `Found something on ${num(r.pagesMatched)} of ${num(r.pagesRun)} ${r.pagesRun === 1 ? "page" : "pages"} at the crawl ${ago(r.lastRun)}${r.slowestMs !== null ? `; slowest page ${duration(r.slowestMs)}` : ""}.`;
}

export interface ExtractionProps {
  answer: Answer<ExtractRule[]>;
  /** The rule whose results are open, from the address. */
  open: number | null;
  /** That rule's results, asked with the page; null when none is open. */
  found: Answer<ExtractResults> | null;
  /** The address with a rule's results open (or none), the page's other params kept. */
  href: (rule: number | null, hash: string) => string;
  /** When the crawl runs next, as the scheduler says. */
  nextCrawl: string | null;
}

export function ExtractionCard({ answer, open, found, href, nextCrawl }: ExtractionProps) {
  const rules = answer.ok ? answer.value : null;
  const on = rules?.filter((r) => r.enabled).length ?? 0;
  return (
    <Card
      title="Custom extraction"
      icon="filter"
      id="extraction"
      count={rules ? num(rules.length) : undefined}
      info="Rules the crawl runs on each page it reads, or on the pages under a scope: a CSS selector, a regular expression or an XPath, with what each found at the last crawl it ran in. A rule is timed on the desk’s test page before it is kept; one that runs past a page’s 10-second deadline in two crawls running is switched off. At most 20 are on at once. Only the owner keeps them, because they change what every crawl does."
      flush
      className="dk-seo-technical-rules"
    >
      {!rules ? (
        <Empty icon="alert" title="The desk did not answer for this panel" compact>
          {answer.ok ? null : answer.message}
        </Empty>
      ) : (
        <>
          <Quiet className="dk-seo-technical-pad-x">
            {rules.length
              ? `${num(rules.length)} ${rules.length === 1 ? "rule" : "rules"}, ${num(on)} on. They run at every crawl, once a day${nextCrawl ? `; the next ${ago(nextCrawl)}` : ""}.`
              : "No rules yet. A rule pulls one thing out of every page the crawl reads (a price, a link’s target, a tag), and its results are listed here after the next crawl."}
          </Quiet>
          {rules.length ? (
            <ul className="dk-seo-technical-rows" aria-label="Extraction rules">
              {rules.map((r) => (
                <Rule key={r.id} r={r} open={open === r.id} found={open === r.id ? found : null} href={href} nextCrawl={nextCrawl} />
              ))}
            </ul>
          ) : null}
          {open !== null && rules.every((r) => r.id !== open) ? (
            <Quiet className="dk-seo-technical-pad-x">
              Rule {num(open)} is not on the desk any more.{" "}
              <Go href={href(null, "extraction")} className="dk-seo-technical-path--link">
                Close it
              </Go>
            </Quiet>
          ) : null}
          <div className="dk-seo-technical-subsection dk-seo-technical-pad-x">
            <h3 className="dk-seo-technical-h3">Add a rule</h3>
            <AddRule nextCrawl={nextCrawl} />
          </div>
        </>
      )}
    </Card>
  );
}

function Rule({ r, open, found, href, nextCrawl }: { r: ExtractRule; open: boolean; found: Answer<ExtractResults> | null; href: ExtractionProps["href"]; nextCrawl: string | null }) {
  const anchor = `rule-${r.id}`;
  return (
    <li id={anchor} className={cx("dk-seo-technical-rule", !r.enabled && "dk-seo-technical-rule--off", open && "dk-seo-technical-rule--open")}>
      <div className="dk-seo-technical-rule-head">
        <span className="dk-seo-technical-rule-title">
          <span className="dk-seo-technical-rule-name">{r.name}</span>
          <Chip>{KIND[r.kind]}</Chip>
          {r.enabled ? null : <Chip tone="warn">Off</Chip>}
        </span>
        <span className="dk-seo-technical-rule-acts">
          <Go
            href={href(open ? null : r.id, anchor)}
            className={buttonClass({ variant: open ? "good" : "quiet", size: "xs" })}
            aria-expanded={open}
            aria-label={open ? `Close what “${r.name}” found` : `Open what “${r.name}” found`}
          >
            <span className="dk-btn-label">{open ? "Close" : "Results"}</span>
            <Icon name={open ? "chevron-up" : "chevron-down"} size={14} />
          </Go>
          <ToggleRule id={r.id} name={r.name} enabled={r.enabled} />
          <DeleteRule id={r.id} name={r.name} back={open ? href(null, "extraction") : null} />
        </span>
      </div>
      <code className="dk-seo-technical-rule-expr">{r.expression}</code>
      <p className="dk-seo-technical-rule-sub">
        {reads(r)} {ran(r, nextCrawl)}
      </p>
      <p className="dk-seo-technical-rule-sub dk-seo-technical-rule-by">
        Added by {r.addedBy}, {fullDate(r.addedAt)}
        {r.lastRun ? `. Last run ${when(r.lastRun)}` : ""}.
      </p>
      {open && found ? <Results found={found} rule={r} nextCrawl={nextCrawl} /> : null}
    </li>
  );
}

/** Everything one rule found at the last crawl it ran in: pages with matches first, then where it could not run, then where it found nothing. */
function Results({ found, rule, nextCrawl }: { found: Answer<ExtractResults>; rule: ExtractRule; nextCrawl: string | null }) {
  if (!found.ok) {
    return (
      <p className="dk-seo-technical-said dk-seo-technical-said--bad dk-seo-technical-rule-said" role="alert">
        {found.message}
      </p>
    );
  }
  const pages = found.value.pages;
  if (!pages.length) {
    return (
      <Quiet className="dk-seo-technical-rule-results">
        {rule.lastRun === null ? `Nothing yet: it has not run since it was added. It runs from the next crawl${nextCrawl ? `, ${ago(nextCrawl)}` : ""}.` : "No page was in its scope at the last crawl it ran in."}
      </Quiet>
    );
  }
  const hits = pages.filter((p) => p.count > 0);
  const failed = pages.filter((p) => p.count === 0 && p.error);
  const empty = pages.filter((p) => p.count === 0 && !p.error);
  return (
    <div className="dk-seo-technical-rule-results">
      <p className="dk-seo-technical-rule-results-sum">
        {num(hits.length)} {hits.length === 1 ? "page" : "pages"} with matches
        {failed.length ? `, ${num(failed.length)} where it could not run` : ""}, {num(empty.length)} with nothing
        {pages[0] ? `, at the crawl of ${when(pages[0].at)}` : ""}.
      </p>
      {hits.length ? (
        <ul className="dk-seo-technical-rule-pages dk-seo-technical-scroll" aria-label={`Pages where “${rule.name}” found something`}>
          {hits.map((p) => (
            <Hit key={p.path} p={p} />
          ))}
        </ul>
      ) : null}
      {failed.length ? (
        <ul className="dk-seo-technical-rule-pages" aria-label={`Pages where “${rule.name}” could not run`}>
          {failed.map((p) => (
            <li key={p.path} className="dk-seo-technical-rule-page">
              <span className="dk-seo-technical-rule-page-head">
                <PathLink path={p.path} />
                {p.ms !== null ? <span className="dk-seo-technical-rule-ms dk-num">{duration(p.ms)}</span> : null}
              </span>
              <span className="dk-seo-technical-rule-err">{p.error}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {empty.length ? (
        <details className="dk-seo-technical-more">
          <summary>
            Nothing found on {num(empty.length)} {empty.length === 1 ? "page" : "pages"} <Icon name="chevron-down" size={12} />
          </summary>
          <ul className="dk-seo-technical-rule-none dk-seo-technical-scroll" aria-label={`Pages where “${rule.name}” found nothing`}>
            {empty.map((p) => (
              <li key={p.path}>
                <PathLink path={p.path} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function Hit({ p }: { p: ExtractResultRow }) {
  const more = p.count - p.matches.length;
  return (
    <li className="dk-seo-technical-rule-page">
      <span className="dk-seo-technical-rule-page-head">
        <PathLink path={p.path} />
        <span className="dk-seo-technical-rule-count dk-num">
          {num(p.count)}
          {p.count >= 10_000 ? "+" : ""} {p.count === 1 ? "match" : "matches"}
        </span>
        {p.ms !== null ? <span className="dk-seo-technical-rule-ms dk-num">{duration(p.ms)}</span> : null}
      </span>
      <ol className="dk-seo-technical-rule-matches">
        {p.matches.map((m, i) => (
          <li key={i}>{m || <span className="dk-seo-technical-ink-quiet">(empty)</span>}</li>
        ))}
      </ol>
      {more > 0 ? (
        <span className="dk-seo-technical-rule-more">
          And {num(more)} more{p.count >= 10_000 ? " (counting stops at 10,000)" : ""}; the first {num(p.matches.length)} are kept.
        </span>
      ) : null}
      {p.error ? <span className="dk-seo-technical-rule-err">{p.error}</span> : null}
    </li>
  );
}
