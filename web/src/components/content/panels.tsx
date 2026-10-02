import type { ReactNode } from "react";
import type { Reading } from "@/contract/common";
import type {
  ArticleRow,
  BingKeywordRow,
  ChangeRow,
  ContentLimits,
  CoverageRow,
  EngagementRow,
  GapList,
  GapRow,
  ImageCoverage,
  Linking,
  LinkingRow,
  MetaProblem,
  MetaRow,
  SchemaCoverage,
  ThinRow,
  VisitSpan,
} from "@/contract/content";
import { Bar } from "@/components/charts";
import { Chip, Count } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EarlyFigure, EarlyLine } from "@/components/ui/Early";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Table, type Column } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { Tooltip } from "@/components/ui/Tooltip";
import { cx } from "@/lib/cx";
import { DASH, num, rangeShort, shortDate } from "@/lib/format";
import { age, hrefFor, part, seconds, shortPath, type ContentView, type Panel } from "./view";

/* ---------- pieces every panel uses ------------------------------------------------- */

/**
 * A panel's body: the value, or the absent state with the panel's own
 * padding (the panels here are flush, so their tables run edge to edge).
 */
function Body<T>({ reading, children }: { reading: Reading<T>; children: (value: T) => ReactNode }) {
  if (reading.state === "ok") return <>{children(reading.value)}</>;
  return (
    <div className="dk-content-absent">
      <Absent reading={reading} />
    </div>
  );
}

/**
 * The quiet line at the bottom of a panel: where its figures come from and
 * how old they are, and "Show all". A panel built from two sources passes
 * both readings and shows a stamp for each that answered.
 */
function Foot({ reading, extra }: { reading: Reading<unknown> | readonly Reading<unknown>[]; extra?: ReactNode }) {
  const list: readonly Reading<unknown>[] = Array.isArray(reading) ? reading : [reading as Reading<unknown>];
  if (!list.some((r) => r.state === "ok") && !extra) return null;
  return (
    <div className="dk-content-stamp">
      {list.length === 1 ? (
        <Stamp reading={list[0] as Reading<unknown>} />
      ) : (
        <span className="dk-content-stamps">
          {list.map((r, i) => (
            <Stamp key={i} reading={r} />
          ))}
        </span>
      )}
      {extra ? <span className="dk-content-stamp-extra">{extra}</span> : null}
    </div>
  );
}

/** "Show all 23" or "Show fewer": a link that opens one panel in full, keeping everything else in the address. */
function More({ view, panel, total, shown, label }: { view: ContentView; panel: Panel; total: number; shown: number; label?: string }) {
  const open = view.open.has(panel);
  if (!open && total <= shown) return null;
  return (
    <Go href={hrefFor(view, { toggle: panel }, panel)} className="dk-content-more" scroll={false}>
      <span>{open ? "Show fewer" : `Show all ${num(total)}${label ? ` ${label}` : ""}`}</span>
      <Icon name={open ? "chevron-up" : "chevron-down"} size={14} />
    </Go>
  );
}

/** A page's address in a cell, shortened in the middle when long (the whole of it on hover), with a quiet second line. */
function PagePath({ path, sub, max = 34 }: { path: string; sub?: ReactNode; max?: number }) {
  return (
    <span className="dk-content-page" title={path}>
      <span className="dk-content-page-path">{shortPath(path, max)}</span>
      {sub ? <span className="dk-content-page-title">{sub}</span> : null}
    </span>
  );
}

/** A bar with its "n / of" beside it, for a share of pages. */
function Share({ n, of }: { n: number; of: number }) {
  const whole = of > 0 && n === of;
  return (
    <span className="dk-content-share">
      <Bar value={n} max={Math.max(of, 1)} tone={whole ? "good" : n === 0 ? "bad" : "warn"} label={`${n} of ${of}`} />
      <span className={cx("dk-num", !whole && "dk-content-share-short")}>{part(n, of)}</span>
    </span>
  );
}

/** One figure in a panel's summary strip. */
function Figure({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: "good" | "warn" | "bad" | "quiet"; hint?: string }) {
  return (
    <div className={cx("dk-content-figure", tone && `dk-content-figure--${tone}`)} title={hint}>
      <span className="dk-content-figure-value dk-num">{value}</span>
      <span className="dk-content-figure-label">{label}</span>
    </div>
  );
}

/** The period a GA4 figure covers: the range, or "since 21 Sep" when measurement began inside it. */
const period = (view: ContentView, visits: Reading<VisitSpan>): string => (visits.state === "ok" && visits.value.partial ? `since ${shortDate(visits.value.since)}` : rangeShort(view.range));

/** A table opened in full scrolls inside its panel, so one long list does not stretch the whole row. */
function Scroll({ open, children }: { open: boolean; children: ReactNode }) {
  return open ? <div className="dk-content-scroll">{children}</div> : <>{children}</>;
}

const rows = <T,>(list: readonly T[], view: ContentView, panel: Panel, first: number): readonly T[] => (view.open.has(panel) ? list : list.slice(0, first));

/* ---------- Coverage by section ----------------------------------------------------- */

export function CoveragePanel({ reading, limits }: { reading: Reading<CoverageRow[]>; limits: ContentLimits }) {
  const columns: Column<CoverageRow>[] = [
    { key: "section", head: "Section", cell: (r) => <span className="dk-content-strong">{r.label}</span> },
    { key: "pages", head: "Pages", numeric: true, cell: (r) => num(r.pages) },
    {
      key: "words",
      head: "Median words",
      numeric: true,
      cell: (r) =>
        r.medianWords === null ? (
          <span className="dk-content-quiet" title="The crawl could not read any page of this kind.">
            {DASH}
          </span>
        ) : (
          <span className={cx(r.medianWords < limits.thinWords && "dk-content-warn")}>{num(r.medianWords)}</span>
        ),
    },
    { key: "meta", head: "Complete metadata", cell: (r) => <Share n={r.complete} of={r.pages} /> },
    { key: "schema", head: "Own structured data", cell: (r) => <Share n={r.ownSchema} of={r.pages} /> },
  ];
  return (
    <Card
      title="Coverage by section"
      icon="layers"
      info={`Each kind of page in the sitemap. Median words: of each page's own content, over the pages the crawl could read; under ${limits.thinWords} in amber. Complete metadata: pages that have a title, a description, a share picture and structured data; it counts that they are there, not whether they are good (that is Titles and descriptions). Own structured data: pages whose structured data describes the page itself, not only the company; on the home page the company's own types count, as in Structured data coverage.`}
      flush
      footer={<Foot reading={reading} />}
    >
      <Body reading={reading}>
        {(list) => <Table caption="Coverage by section" rows={list} columns={columns} rowKey={(r) => r.kind} empty="The crawl read no pages in the sitemap." minWidth={460} />}
      </Body>
    </Card>
  );
}

/* ---------- Titles and descriptions --------------------------------------------------- */

/** Each problem's chip, and its rank for sorting: worst first, the server's own order (PROBLEM_RANK in routes/content.ts). */
const PROBLEM: Record<MetaProblem, { label: string; tone: "bad" | "warn" | "info"; rank: number }> = {
  missing: { label: "Missing", tone: "bad", rank: 0 },
  duplicate: { label: "Shared", tone: "warn", rank: 1 },
  long: { label: "Too long", tone: "warn", rank: 2 },
  short: { label: "Too short", tone: "info", rank: 3 },
};

export function MetadataPanel({ reading, limits, view }: { reading: Reading<MetaRow[]>; limits: ContentLimits; view: ContentView }) {
  const all = reading.state === "ok" ? reading.value : [];
  const titles = all.filter((m) => m.field === "title").length;
  const descriptions = all.length - titles;
  const list = view.meta === "all" ? all : all.filter((m) => m.field === view.meta);

  const columns: Column<MetaRow>[] = [
    { key: "page", head: "Page", cell: (m) => <PagePath path={m.path} max={30} sub={`${m.field === "title" ? "Title" : "Description"} · ${m.kindLabel}`} />, sort: (m) => m.path },
    {
      key: "text",
      head: "As served",
      cell: (m) =>
        m.text ? (
          <span className="dk-content-served" title={m.text}>
            {m.text}
          </span>
        ) : (
          <span className="dk-content-none">None</span>
        ),
      width: "44%",
    },
    {
      key: "length",
      head: "Length",
      numeric: true,
      cell: (m) => {
        const long = m.field === "title" ? limits.title : limits.description;
        const short = m.field === "title" ? limits.titleShort : limits.descriptionShort;
        const over = m.problems.includes("long");
        const under = m.problems.includes("short");
        return (
          <span className="dk-content-length" title={over ? `Over ${long} characters is cut in results.` : under ? `Under ${short} characters is short by the desk's yardstick.` : `${m.length} characters.`}>
            <b className={cx(over && "dk-content-bad", under && "dk-content-info")}>{num(m.length)}</b>
            <span>{under ? `min ${short}` : `/ ${long}`}</span>
          </span>
        );
      },
      sort: (m) => m.length,
    },
    {
      key: "problem",
      head: "Problem",
      cell: (m) => (
        <span className="dk-content-chips" title={m.sharedWith.length ? `Also on ${m.sharedWith.join(", ")}` : undefined}>
          {m.problems.map((p) => (
            <Chip key={p} tone={PROBLEM[p].tone}>
              {PROBLEM[p].label}
            </Chip>
          ))}
        </span>
      ),
      sort: (m) => (m.problems[0] ? PROBLEM[m.problems[0]].rank : null),
    },
    {
      key: "act",
      head: <span className="dk-sr">Action</span>,
      align: "right",
      cell: (m) => (
        /* The Operator's metadata task takes a page, not a field: it writes the title and the description together. */
        <LinkButton href={`/operator?do=metadata&path=${encodeURIComponent(m.path)}`} variant="good" size="xs" aria-label={`Ask the AI Operator for metadata for ${m.path}`} title="Opens the AI Operator on this page, to propose its title and description">
          Propose
        </LinkButton>
      ),
    },
  ];

  return (
    <Card
      id="meta"
      title="Titles and descriptions"
      icon="tag"
      count={reading.state === "ok" ? num(all.length) : undefined}
      info={`Pages offered to search whose title or description is missing, shared with another page, over the length a result shows (${limits.title} and ${limits.description} characters) or under the desk's own minimum (${limits.titleShort} and ${limits.descriptionShort}). "Propose" opens the AI Operator on that page, to propose its title and description.`}
      right={
        reading.state === "ok" ? (
          <Tabs
            size="sm"
            label="Which field"
            active={view.meta}
            items={[
              { key: "all", label: "All", count: all.length, href: hrefFor(view, { meta: "all" }, "meta") },
              { key: "title", label: "Titles", count: titles, href: hrefFor(view, { meta: "title" }, "meta") },
              { key: "description", label: "Descriptions", count: descriptions, href: hrefFor(view, { meta: "description" }, "meta") },
            ]}
          />
        ) : undefined
      }
      flush
      footer={<Foot reading={reading} extra={<More view={view} panel="meta" total={list.length} shown={7} />} />}
    >
      <Body reading={reading}>
        {() => (
          <Scroll open={view.open.has("meta")}>
          <Table
            caption="Titles and descriptions to fix"
            rows={rows(list, view, "meta", 7)}
            columns={columns}
            rowKey={(m) => `${m.path}|${m.field}`}
            empty={view.meta === "all" ? "Every page offered to search has a title and a description of a good length, and none is shared." : "None of these needs work."}
            density="roomy"
            minWidth={640}
          />
          </Scroll>
        )}
      </Body>
    </Card>
  );
}

/* ---------- Thin pages --------------------------------------------------------------- */

export function ThinPanel({ reading, visits, limits, view }: { reading: Reading<ThinRow[]>; visits: Reading<VisitSpan>; limits: ContentLimits; view: ContentView }) {
  const columns: Column<ThinRow>[] = [
    { key: "page", head: "Page", cell: (r) => <PagePath path={r.path} max={28} sub={r.kindLabel} /> },
    {
      key: "words",
      head: "Words",
      numeric: true,
      cell: (r) => (
        <span className="dk-content-words">
          <Bar value={r.words} max={limits.thinWords} tone="warn" label={`${r.words} of ${limits.thinWords} words`} />
          <span className="dk-num">{num(r.words)}</span>
        </span>
      ),
    },
    {
      key: "visitors",
      head: "Visitors",
      numeric: true,
      cell: (r) => (visits.state !== "ok" ? <Absent reading={visits} form="inline" /> : <span className={cx(r.visitors === 0 && "dk-content-none")}>{num(r.visitors)}</span>),
    },
  ];
  const list = reading.state === "ok" ? reading.value : [];
  /* The server puts the most visited first only when GA4 answered; without it, the fewest words first. */
  const byVisits = visits.state === "ok";
  return (
    <Card
      id="thin"
      title="Thin pages"
      icon="file-text"
      count={reading.state === "ok" ? num(list.length) : undefined}
      info={`Pages offered to search with under ${limits.thinWords} words of their own content (the menu and footer are not counted). The desk's yardstick: Google names no number. ${byVisits ? "The most visited come first: a thin page people open is the one to write up. Visitors: GA4, consenting visitors only." : "GA4 did not answer, so the fewest words come first and visitors are not shown."}`}
      sub={byVisits ? `Under ${limits.thinWords} words · most visited first · ${period(view, visits)}` : `Under ${limits.thinWords} words · fewest words first`}
      flush
      footer={<Foot reading={[reading, visits]} extra={<More view={view} panel="thin" total={list.length} shown={7} />} />}
    >
      <Body reading={reading}>
        {() => <Scroll open={view.open.has("thin")}><Table caption="Thin pages" rows={rows(list, view, "thin", 7)} columns={columns} rowKey={(r) => r.path} empty={`No page offered to search is under ${limits.thinWords} words.`} density="roomy" minWidth={340} /></Scroll>}
      </Body>
    </Card>
  );
}

/* ---------- Engagement ---------------------------------------------------------------- */

/** Under this many visitors an average says little: the two raw figures are shown instead. */
const FEW = 30;

function Engaged({ r }: { r: EngagementRow }) {
  if (r.visitors === 0) return <span className="dk-content-none">No visitors</span>;
  if (r.visitors < FEW) {
    return (
      <Tooltip text={`${r.visitors} visitor${r.visitors === 1 ? "" : "s"} spent ${seconds(r.engagementSeconds)} on it in all. Under ${FEW} visitors an average would say little, so the total is shown.`}>
        <span className="dk-content-engaged dk-content-engaged--few" tabIndex={0}>
          {seconds(r.engagementSeconds)} <i>in all</i>
        </span>
      </Tooltip>
    );
  }
  const each = r.engagementSeconds / r.visitors;
  const share = r.readingSeconds > 0 ? each / r.readingSeconds : 0;
  return (
    <span className="dk-content-engaged" title={`${seconds(Math.round(each))} a visitor against ${seconds(r.readingSeconds)} to read it`}>
      <Bar value={Math.min(share, 1)} max={1} tone={share >= 0.5 ? "good" : share >= 0.2 ? "warn" : "bad"} />
      <span>
        {seconds(Math.round(each))} <i>each</i>
      </span>
    </span>
  );
}

export function EngagementPanel({ reading, visits, limits, view }: { reading: Reading<EngagementRow[]>; visits: Reading<VisitSpan>; limits: ContentLimits; view: ContentView }) {
  const columns: Column<EngagementRow>[] = [
    { key: "page", head: "Page", cell: (r) => <PagePath path={r.path} max={26} sub={r.kindLabel} /> },
    {
      key: "words",
      head: "Words",
      numeric: true,
      cell: (r) => (
        <span className="dk-content-stack">
          <span>{num(r.words)}</span>
          <span className="dk-content-page-title">{seconds(r.readingSeconds)} to read</span>
        </span>
      ),
      sort: (r) => r.words,
    },
    { key: "visitors", head: "Visitors", numeric: true, cell: (r) => <span className={cx(r.visitors === 0 && "dk-content-none")}>{num(r.visitors)}</span>, sort: (r) => r.visitors },
    { key: "engaged", head: "Engagement", align: "right", cell: (r) => <Engaged r={r} />, sort: (r) => r.engagementSeconds },
  ];
  const list = reading.state === "ok" ? reading.value : [];
  return (
    <Card
      id="eng"
      title="Engagement"
      icon="clock"
      info={`GA4's engagement time on each page against how long its own content takes to read at ${limits.readingWpm} words a minute. Longest pages first, so a long page nobody reads is at the top. Consenting visitors only: GA4 loads after the cookie banner is accepted, so every figure here is an undercount. Under ${FEW} visitors the total time is shown, not an average.`}
      sub={`Time on the page against its length · ${period(view, visits)} · consenting visitors only`}
      flush
      footer={<Foot reading={reading} extra={<More view={view} panel="eng" total={list.length} shown={7} label="pages" />} />}
    >
      <Body reading={reading}>
        {() => <Scroll open={view.open.has("eng")}><Table caption="Engagement against length" rows={rows(list, view, "eng", 7)} columns={columns} rowKey={(r) => r.path} empty="The crawl read no pages in the sitemap." density="roomy" minWidth={420} /></Scroll>}
      </Body>
    </Card>
  );
}

/* ---------- Freshness ------------------------------------------------------------------ */

export function FreshnessPanel({ articles, changes, view }: { articles: Reading<ArticleRow[]>; changes: Reading<ChangeRow[]>; view: ContentView }) {
  const onArticles = view.fresh === "articles";
  const reading = onArticles ? articles : changes;
  const total = reading.state === "ok" ? reading.value.length : 0;

  const articleColumns: Column<ArticleRow>[] = [
    {
      key: "article",
      head: "Article",
      cell: (a) => (
        <span className="dk-content-page" title={a.path}>
          <span className="dk-content-clip dk-content-clip--title">{a.title}</span>
          <span className="dk-content-page-title">
            {a.listed ? (a.byDesk ? "Written at the desk" : "Written by hand") : "Live, not listed yet"}
            {a.updated ? ` · updated ${shortDate(a.updated)}` : ""}
          </span>
        </span>
      ),
    },
    {
      key: "date",
      head: "Published",
      cell: (a) =>
        a.date ? (
          <span title={a.dateFrom === "sitemap" ? "The sitemap's date, which is the update date when there is one: the article's file could not be read." : "The date in the article's own file."}>
            {shortDate(a.date)}
            {a.dateFrom === "sitemap" ? <i className="dk-content-src"> sitemap</i> : null}
          </span>
        ) : (
          DASH
        ),
    },
    { key: "age", head: "Age", numeric: true, cell: (a) => <span className={cx((a.ageDays ?? 0) > 180 && "dk-content-warn")}>{age(a.ageDays)}</span> },
  ];

  const pageColumns: Column<ChangeRow>[] = [
    { key: "page", head: "Page", cell: (p) => <PagePath path={p.path} max={30} sub={p.kindLabel} /> },
    {
      key: "changed",
      head: "Last change",
      cell: (p) =>
        p.changed ? (
          <span className="dk-content-stack" title={p.changedFrom === "repo" ? `${p.subject ?? "A commit"}${p.author ? `, by ${p.author}` : ""}` : "When the desk's crawl last saw its words, title or status change."}>
            <span>{shortDate(p.changed)}</span>
            <span className="dk-content-page-title">{p.changedFrom === "repo" ? `git${p.author ? ` · ${p.author}` : ""}` : "seen by the crawl"}</span>
          </span>
        ) : (
          <span className="dk-content-stack" title="The page has no file of its own in the repository, and the crawl has not seen it change since it began reading it.">
            <span className="dk-content-quiet">Not seen changing</span>
            <span className="dk-content-page-title">read since {shortDate(p.firstSeen)}</span>
          </span>
        ),
    },
    { key: "age", head: "Age", numeric: true, cell: (p) => <span className={cx((p.ageDays ?? 0) > 180 && "dk-content-warn")}>{age(p.ageDays)}</span> },
  ];

  return (
    <Card
      id="fresh"
      title="Freshness"
      icon="calendar"
      info="Articles by the date in their own file, newest first. Pages by the last commit to their own page file, or the last change the crawl saw in their words, whichever is later, oldest first. Pages drawn from shared files (services, industries) have no page file of their own: for them only the crawl can say, and it has been reading only since its first run."
      right={
        <Tabs
          size="sm"
          label="Articles or pages"
          active={view.fresh}
          items={[
            { key: "articles", label: "Articles", count: articles.state === "ok" ? articles.value.length : null, href: hrefFor(view, { fresh: "articles" }, "fresh") },
            { key: "pages", label: "Pages", count: changes.state === "ok" ? changes.value.length : null, href: hrefFor(view, { fresh: "pages" }, "fresh") },
          ]}
        />
      }
      flush
      footer={<Foot reading={reading} extra={<More view={view} panel="fresh" total={total} shown={7} />} />}
    >
      {onArticles ? (
        <Body reading={articles}>
          {(list) => <Scroll open={view.open.has("fresh")}><Table caption="Articles by publish date" rows={rows(list, view, "fresh", 7)} columns={articleColumns} rowKey={(a) => a.path} empty="The crawl found no article on the site." density="roomy" minWidth={380} /></Scroll>}
        </Body>
      ) : (
        <Body reading={changes}>
          {(list) => <Scroll open={view.open.has("fresh")}><Table caption="Pages by last change" rows={rows(list, view, "fresh", 7)} columns={pageColumns} rowKey={(p) => p.path} empty="The crawl found no page." density="roomy" minWidth={380} /></Scroll>}
        </Body>
      )}
    </Card>
  );
}

/* ---------- Structured data coverage ------------------------------------------------------ */

export function SchemaPanel({ reading }: { reading: Reading<SchemaCoverage> }) {
  type Kind = SchemaCoverage["kinds"][number];
  const columns: Column<Kind>[] = [
    { key: "section", head: "Section", cell: (k) => <span className="dk-content-strong">{k.label}</span> },
    { key: "pages", head: "Pages", numeric: true, cell: (k) => num(k.pages) },
    {
      key: "types",
      head: "Describing the page",
      cell: (k) =>
        k.companyIsOwn && k.types.length ? (
          /* The home page: its types are the layout's (listed above), which on this one page describe the page itself. One line, not the chips again. */
          <span
            className="dk-content-type"
            title={`${k.types.map((t) => t.type).join(", ")}: the company's own types. On the home page they describe the page itself, so they count as its own (the crawl's rule). The breadcrumb never does.`}
          >
            Company&rsquo;s own
            {/* Pages carrying them, as every other chip counts. */}
            <Count tone={Math.max(...k.types.map((t) => t.pages)) === k.pages ? "good" : "quiet"}>{Math.max(...k.types.map((t) => t.pages))}</Count>
          </span>
        ) : k.types.length ? (
          <span className="dk-content-types">
            {k.types.map((t) => (
              <span key={t.type} className="dk-content-type">
                {t.type}
                <Count tone={t.pages === k.pages ? "good" : "quiet"}>{t.pages}</Count>
              </span>
            ))}
          </span>
        ) : (
          <span className="dk-content-none">Only the layout&rsquo;s types</span>
        ),
    },
    {
      key: "gaps",
      head: "Company only",
      numeric: true,
      cell: (k) => (
        <span className={cx(k.siteOnly + k.none > 0 && "dk-content-warn")}>
          {k.none ? `${num(k.none)} none · ` : ""}
          {num(k.siteOnly)}
        </span>
      ),
    },
  ];
  return (
    <Card
      id="schema"
      title="Structured data coverage"
      icon="code"
      info={'The structured data (JSON-LD) each kind of page carries. The layout prints the company and the breadcrumb on most pages; "Describing the page" are the types about the page itself. On the home page the company\'s own types are about the page, so they count there (the crawl\'s rule, and Coverage by section counts the same way). "Company only": pages whose structured data says nothing about the page. Invalid: a block that is not JSON, or a node missing a field Google requires for that type.'}
      flush
      footer={<Foot reading={reading} />}
    >
      <Body reading={reading}>
        {(s) => (
          <>
            <p className="dk-content-line">
              <span className="dk-content-line-label">From the layout</span>
              <span className="dk-content-types">
                {s.layout.map((t) => (
                  <span key={t.type} className="dk-content-type" title={`On ${t.pages} of ${s.pages} pages`}>
                    {t.type}
                    <Count tone={t.pages === s.pages ? "good" : "quiet"}>{t.pages === s.pages ? "all" : t.pages}</Count>
                  </span>
                ))}
              </span>
            </p>
            <Table caption="Structured data by section" rows={s.kinds} columns={columns} rowKey={(k) => k.kind} empty="The crawl read no pages in the sitemap." minWidth={440} />
            <div className="dk-content-verdict">
              {s.invalid.length || s.none.length ? (
                <ul className="dk-content-problems">
                  {s.none.length ? (
                    <li>
                      <Icon name="alert" size={14} className="dk-content-warn" />
                      <span>
                        <b>No structured data at all</b> on {s.none.slice(0, 4).join(", ")}
                        {s.none.length > 4 ? ` and ${s.none.length - 4} more` : ""}
                      </span>
                    </li>
                  ) : null}
                  {s.invalid.slice(0, 5).map((p) => (
                    <li key={`${p.path}|${p.problem}`}>
                      <Icon name="x-circle" size={14} className="dk-content-bad" />
                      <span>
                        <b>{p.path}</b> {p.reason}
                      </span>
                    </li>
                  ))}
                  {s.invalid.length > 5 ? <li className="dk-content-quiet">and {s.invalid.length - 5} more on SEO</li> : null}
                </ul>
              ) : (
                <p className="dk-content-fine">
                  <Icon name="check-circle" size={14} />
                  <span>No invalid blocks: every block parses and carries the fields the desk checks for.</span>
                </p>
              )}
            </div>
          </>
        )}
      </Body>
    </Card>
  );
}

/* ---------- Images and alt text ----------------------------------------------------------- */

function Mix({ r }: { r: ImageCoverage["rows"][number] }) {
  return (
    <span className="dk-content-mix" role="img" aria-label={`${r.written} described, ${r.empty} decorative, ${r.absent} with no alt attribute`}>
      {r.written ? <i className="dk-content-mix-written" style={{ flexGrow: r.written }} /> : null}
      {r.empty ? <i className="dk-content-mix-empty" style={{ flexGrow: r.empty }} /> : null}
      {r.absent ? <i className="dk-content-mix-absent" style={{ flexGrow: r.absent }} /> : null}
    </span>
  );
}

export function ImagesPanel({ reading, view }: { reading: Reading<ImageCoverage>; view: ContentView }) {
  type Row = ImageCoverage["rows"][number];
  const columns: Column<Row>[] = [
    { key: "page", head: "Page", cell: (r) => <PagePath path={r.path} max={24} sub={<Mix r={r} />} /> },
    { key: "written", head: "Described", numeric: true, cell: (r) => num(r.written) },
    { key: "empty", head: "Decorative", numeric: true, cell: (r) => <span className="dk-content-quiet">{num(r.empty)}</span> },
    { key: "absent", head: "No alt", numeric: true, cell: (r) => <span className={cx(r.absent > 0 ? "dk-content-bad" : "dk-content-quiet")}>{num(r.absent)}</span> },
  ];
  const list = reading.state === "ok" ? reading.value.rows : [];
  return (
    <Card
      id="img"
      title="Images and alt text"
      icon="image"
      info={'Every picture from the site\'s own files on every crawled page, counted per use. alt="" says "this is decoration" and is correct for decoration; only a missing alt attribute is a fault, because a screen reader then reads out the file name. Pictures from other hosts, and every file in full, are on Assets.'}
      flush
      footer={
        <div className="dk-content-foot">
          <Foot reading={reading} extra={<More view={view} panel="img" total={list.length} shown={7} label="pages" />} />
          <Go href="/assets" className="dk-content-more">
            <span>Assets</span>
            <Icon name="chevron-right" size={14} />
          </Go>
        </div>
      }
    >
      <Body reading={reading}>
        {(c) => (
          <>
            <div className="dk-content-figures">
              <Figure label="Described" value={num(c.totals.written)} hint="Pictures with alt text written for them." />
              <Figure label={'Decorative, alt=""'} value={num(c.totals.empty)} tone="quiet" hint="Marked as decoration on purpose: correct, and skipped by screen readers." />
              <Figure label="No alt attribute" value={num(c.totals.absent)} tone={c.totals.absent ? "bad" : "good"} hint="A fault: a screen reader reads out the file name." />
            </div>
            <Scroll open={view.open.has("img")}><Table caption="Alt text by page" rows={rows(list, view, "img", 7)} columns={columns} rowKey={(r) => r.path} empty="The crawl found no picture from the site's own files on any page." density="roomy" minWidth={360} /></Scroll>
          </>
        )}
      </Body>
    </Card>
  );
}

/* ---------- Internal linking ------------------------------------------------------------- */

const REASON: Record<LinkingRow["reasons"][number], string> = { "no-inlinks": "No link in", "one-inlink": "One link in", "no-outlinks": "Links nowhere" };

/** Rows each of Internal linking's two lists shows before "Show all". */
const LINKS_FIRST = 5;

/**
 * Internal linking's "Show all": one link opens both its lists. It counts
 * the list that is cut, or says only "Show all" when both are.
 */
function LinksMore({ view, linking }: { view: ContentView; linking: Linking }) {
  const cut = [linking.flagged.length, linking.fewest.length].filter((n) => n > LINKS_FIRST);
  if (!view.open.has("links") && !cut.length) return null;
  return cut.length === 1 || view.open.has("links") ? (
    <More view={view} panel="links" total={cut[0] ?? 0} shown={LINKS_FIRST} />
  ) : (
    <Go href={hrefFor(view, { toggle: "links" }, "links")} className="dk-content-more" scroll={false}>
      <span>Show all</span>
      <Icon name="chevron-down" size={14} />
    </Go>
  );
}

export function LinkingPanel({ reading, view }: { reading: Reading<Linking>; view: ContentView }) {
  const columns = (flagged: boolean): Column<LinkingRow>[] => [
    { key: "page", head: "Page", cell: (r) => <PagePath path={r.path} max={24} sub={flagged ? r.reasons.map((x) => REASON[x]).join(" · ") : r.kindLabel} /> },
    { key: "content", head: "From content", numeric: true, cell: (r) => <span className={cx(r.inlinksFromContent === 0 && "dk-content-warn")}>{num(r.inlinksFromContent)}</span> },
    { key: "in", head: "All in", numeric: true, cell: (r) => <span className={cx(r.inlinks <= 1 && "dk-content-bad")}>{num(r.inlinks)}</span> },
    {
      key: "out",
      head: "Out",
      numeric: true,
      cell: (r) =>
        r.outlinks === null ? (
          <span className="dk-content-quiet" title="Not read: the crawl could not read this page, so its links out are unknown.">
            {DASH}
          </span>
        ) : (
          <span className={cx(r.outlinks === 0 && "dk-content-bad")}>{num(r.outlinks)}</span>
        ),
    },
  ];
  return (
    <Card
      id="links"
      title="Internal linking"
      icon="link"
      info={'Pages in the sitemap that no other page links to, that only one page links to, or that link to no other page. "From content" counts links in other pages\' own text, leaving out the menu and footer every page shares: a page reached only through the menu has no page vouching for it. "All in" counts every link, menus included.'}
      flush
      footer={<Foot reading={reading} extra={reading.state === "ok" ? <LinksMore view={view} linking={reading.value} /> : null} />}
    >
      <Body reading={reading}>
        {(l) => {
          const n = (r: LinkingRow["reasons"][number]) => l.flagged.filter((f) => f.reasons.includes(r)).length;
          return (
            <>
              <div className="dk-content-figures">
                <Figure label="No link in" value={num(n("no-inlinks"))} tone={n("no-inlinks") ? "bad" : "good"} />
                <Figure label="One link in" value={num(n("one-inlink"))} tone={n("one-inlink") ? "warn" : "good"} />
                <Figure label="Links nowhere" value={num(n("no-outlinks"))} tone={n("no-outlinks") ? "bad" : "good"} />
              </div>
              {l.flagged.length ? (
                /* Bounded like every list here: a bad crawl could flag every page. "Show all" opens both lists. */
                <Scroll open={view.open.has("links")}>
                  <Table caption="Pages with too few links" rows={rows(l.flagged, view, "links", LINKS_FIRST)} columns={columns(true)} rowKey={(r) => r.path} density="roomy" minWidth={340} />
                </Scroll>
              ) : (
                <p className="dk-content-fine dk-content-fine--row">
                  <Icon name="check-circle" size={14} />
                  <span>All {num(l.pages)} pages have at least two links in and one out.</span>
                </p>
              )}
              <p className="dk-content-sublabel">{l.fewest.every((r) => r.inlinksFromContent === 0) ? `Linked only from the menu and footer (${num(l.fewest.length)})` : "Fewest links from other pages’ content"}</p>
              <Scroll open={view.open.has("links")}><Table caption="Pages with the fewest links from content" rows={rows(l.fewest, view, "links", LINKS_FIRST)} columns={columns(false)} rowKey={(r) => r.path} density="roomy" minWidth={340} /></Scroll>
            </>
          );
        }}
      </Body>
    </Card>
  );
}

/* ---------- Content gaps and Bing ------------------------------------------------------------ */

export function GapsPanel({ reading, view }: { reading: Reading<GapList>; view: ContentView }) {
  const standard = reading.state === "ok" ? reading.value.early?.standard : undefined;
  const columns: Column<GapRow>[] = [
    { key: "query", head: "Query", cell: (g) => <span className="dk-content-served dk-content-query" title={g.query}>{g.query}</span> },
    {
      key: "impr",
      head: "Impressions",
      numeric: true,
      cell: (g) => (
        <EarlyFigure early={g.early} standard={standard}>
          <span title={`${num(g.clicks)} click${g.clicks === 1 ? "" : "s"}`}>{num(g.impressions)}</span>
        </EarlyFigure>
      ),
    },
    { key: "pos", head: "Position", numeric: true, cell: (g) => num(g.position, 1) },
    { key: "page", head: "Nearest page", cell: (g) => (g.path ? <span className="dk-content-quiet" title={g.path}>{shortPath(g.path, 22)}</span> : <span className="dk-content-none">None shown</span>) },
  ];
  const floor =
    reading.state !== "ok"
      ? "often enough to count"
      : reading.value.early
        ? `at least once (early signals: the standard floor of ${reading.value.early.standard} returns by itself once enough data exists)`
        : `at least ${num(reading.value.floor)} times`;
  return (
    <Card
      id="gaps"
      title="Content gaps"
      icon="target"
      info={`Queries Google showed the site for, ${floor} in the period, for which no page's title or main heading carries every word of the query: something people look for that no page is about. It finds gaps only among queries Google already shows the site for; what people search and never see the site for is not knowable for free. Positions are Google's average position, not a tracked rank.`}
      sub={`Search Console queries no page answers · ${rangeShort(view.range)}`}
      flush
      footer={<Foot reading={reading} />}
    >
      <Body reading={reading}>
        {(g) => (
          <>
            {g.early ? <EarlyLine early={g.early} rows="Queries" className="dk-content-early" /> : null}
            <Table
              caption="Content gaps"
              rows={g.rows.slice(0, 8)}
              columns={columns}
              rowKey={(x) => x.query}
              empty={
                g.early
                  ? "Every query Google has shown the site for so far has a page whose title or heading carries all its words."
                  : `Every query shown at least ${num(g.floor)} times has a page whose title or heading carries all its words.`
              }
              minWidth={520}
            />
          </>
        )}
      </Body>
    </Card>
  );
}

export function BingPanel({ reading, view }: { reading: Reading<BingKeywordRow[]>; view: ContentView }) {
  const columns: Column<BingKeywordRow>[] = [
    { key: "query", head: "Query", cell: (b) => <span className="dk-content-served dk-content-query" title={b.query}>{b.query}</span> },
    { key: "clicks", head: "Clicks", numeric: true, cell: (b) => num(b.clicks) },
    { key: "impr", head: "Impressions", numeric: true, cell: (b) => num(b.impressions) },
    { key: "pos", head: "Position", numeric: true, cell: (b) => (b.position === null ? DASH : num(b.position, 1)) },
  ];
  return (
    <Card
      id="bing"
      title="Bing keyword statistics"
      icon="bar-chart"
      info="The queries Bing showed the site for, from Bing Webmaster Tools, most clicks first. Bing updates these figures about once a week; positions are Bing's own averages."
      sub={`Queries from Bing Webmaster Tools · ${rangeShort(view.range)}`}
      flush
      footer={<Foot reading={reading} />}
    >
      <Body reading={reading}>
        {(list) => <Table caption="Bing keyword statistics" rows={list.slice(0, 8)} columns={columns} rowKey={(b) => b.query} empty="Bing reports no searches for the site in this period." minWidth={400} />}
      </Body>
    </Card>
  );
}
