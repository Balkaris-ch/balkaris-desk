import type { ProposalRow } from "@/contract/operator";
import type { PageQuery, SeoPageViewPayload } from "@/contract/seo/page-view";
import { AreaChart, Legend, LineChart } from "@/components/charts";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent, Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Table } from "@/components/ui/Table";
import { cx } from "@/lib/cx";
import { ago, DASH, duration, num, shortDate } from "@/lib/format";
import { rateText } from "./bits";
import { MetaEditor } from "./MetaEditor";

const PROPOSAL_WORD: Record<ProposalRow["state"], { word: string; tone: "warn" | "good" | "quiet" | "bad" | "info" }> = {
  waiting: { word: "Waiting for approval", tone: "warn" },
  approved: { word: "Approved", tone: "info" },
  applied: { word: "Live", tone: "good" },
  rejected: { word: "Rejected", tone: "quiet" },
  withdrawn: { word: "Withdrawn", tone: "quiet" },
};

/** The proposals for this address, newest first, each with its state in the approval queue. */
function Proposals({ rows }: { rows: ProposalRow[] }) {
  return (
    <Card title="Changes proposed for this page" count={rows.length || undefined} className="dk-seo-optimize-panel" info="Titles, descriptions and redirects proposed for this address, by the operator or a person. A proposal changes the live site only when someone who can publish approves it in AI Operator › Approvals." right={<Go href="/operator?ap=waiting#approvals" className="dk-seo-optimize-headlink">Approvals</Go>}>
      {rows.length ? (
        <ul className="dk-seo-optimize-props">
          {rows.map((p) => (
            <li key={p.id}>
              <span className="dk-seo-optimize-props-top">
                <Badge tone={PROPOSAL_WORD[p.state].tone} dot>
                  {PROPOSAL_WORD[p.state].word}
                </Badge>
                <span className="dk-seo-optimize-quiet">
                  #{p.id} · {p.source === "operator" ? `the operator (task #${p.taskId ?? "?"})` : (p.proposedBy ?? "a person")} · {ago(p.createdAt)}
                </span>
              </span>
              {p.kind === "meta" ? (
                <>
                  {p.shownTitle ? (
                    <span className="dk-seo-optimize-props-line">
                      <b>Title</b> {p.before.title ?? "(none)"} <Icon name="arrow-right" size={12} /> {p.shownTitle}
                    </span>
                  ) : null}
                  {p.after.description !== undefined ? (
                    <span className="dk-seo-optimize-props-line">
                      <b>Description</b> {p.after.description}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="dk-seo-optimize-props-line">
                  <b>Redirect</b> to {p.after.to}
                </span>
              )}
              {p.drift ? <span className="dk-seo-optimize-props-line dk-tone-warn">The page has changed since it was proposed: ask the operator again.</span> : null}
              {p.error ? <span className="dk-seo-optimize-props-line dk-tone-bad">{p.error}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon="edit" title="Nothing proposed yet">
          Propose a title and description above, or let the operator write them.
        </Empty>
      )}
    </Card>
  );
}

/** "Optimize": the editor and what waits. */
export function OptimizeView({ data }: { data: SeoPageViewPayload }) {
  const c = data.crawl.state === "ok" ? data.crawl.value : null;
  const page = data.page.state === "ok" ? data.page.value : null;
  return (
    <>
      <Card title="Title and description" className="dk-seo-optimize-panel" info="What Google and a shared link show for the page. The website appends “| Balkaris” to every title itself.">
        {c && page && data.serp ? (
          <MetaEditor path={data.path!} url={page.url} title={c.title} description={c.description} titleLimit={data.serp.titleLimit} descriptionLimit={data.serp.descriptionLimit} answers200={c.status === 200} />
        ) : (
          <Absent reading={data.crawl.state === "ok" ? { state: "waiting", source: "crawl", reason: "The crawl has no title for this page." } : data.crawl} />
        )}
      </Card>
      <Proposals rows={data.proposals} />
    </>
  );
}

/** "Keywords": every query Google showed the page for, with its cluster and our estimate where it stands at 4 to 20. */
export function KeywordsView({ data }: { data: SeoPageViewPayload }) {
  return (
    <>
      <Card title="Queries Google showed this page for" flush className="dk-seo-optimize-panel" info="From Search Console over the period. Impressions are what Search Console counted: there is no free source of search volume. “Our estimate” is ours, from those impressions and our stated curve, only for a query at position 4 to 20.">
        <Read reading={data.queries}>
          {(q, r) => (
            <>
              <Table<PageQuery>
                caption="Queries"
                rows={q.rows}
                rowKey={(x) => x.query}
                minWidth={640}
                defaultSort={{ key: "impressions", dir: "desc" }}
                empty={q.withheld}
                columns={[
                  { key: "query", head: "Query", cell: (x) => x.query, sort: (x) => x.query },
                  { key: "cluster", head: "Topic", width: "22%", cell: (x) => (x.cluster ? <span className="dk-seo-optimize-quiet">{x.cluster.name}</span> : DASH) },
                  { key: "impressions", head: "Impressions", numeric: true, width: "96px", cell: (x) => num(x.impressions), sort: (x) => x.impressions },
                  { key: "clicks", head: "Clicks", numeric: true, width: "64px", cell: (x) => num(x.clicks), sort: (x) => x.clicks },
                  { key: "ctr", head: "CTR", numeric: true, width: "80px", cell: (x) => rateText(x.ctr), sort: (x) => x.ctr.value },
                  { key: "position", head: "Position", numeric: true, width: "72px", cell: (x) => num(x.position, 1), sort: (x) => x.position },
                  { key: "potential", head: "Our estimate", numeric: true, width: "104px", cell: (x) => (x.potential ? <span title={x.potential.basis}>+{num(x.potential.clicksPerMonth, 1)}/mo</span> : DASH), sort: (x) => x.potential?.clicksPerMonth ?? null },
                ]}
              />
              <p className="dk-seo-optimize-note dk-seo-optimize-pad">{q.withheld}</p>
              <div className="dk-seo-optimize-pad">
                <Stamp reading={r} />
              </div>
            </>
          )}
        </Read>
      </Card>
      <Card title="Topics this page answers" className="dk-seo-optimize-panel" info="The keyword table's clusters mapped to this page: by the audit, by a person, or by the desk's rule (every word of the phrase in the page's title, heading or address).">
        {data.clusters.length ? (
          <ul className="dk-seo-optimize-tags">
            {data.clusters.map((c) => (
              <li key={c.key}>
                <span>{c.name}</span>
                <span className="dk-seo-optimize-quiet">
                  {c.lang.toUpperCase()} · mapped by {c.mappedBy === "rule" ? "the desk's rule" : c.mappedBy === "audit" ? "the audit" : "a person"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon="tag" title="No topic is mapped to this page">
            The keyword table maps no cluster here. On SEO › Keywords a cluster can be given its page.
          </Empty>
        )}
      </Card>
    </>
  );
}

/** "Content": what the page says as the crawl read it, and its AI-readiness checks. */
export function ContentView({ data }: { data: SeoPageViewPayload }) {
  return (
    <>
      <Card title="On the page" className="dk-seo-optimize-panel" info="The desk's own read of the live page at the last crawl.">
        <Read reading={data.crawl}>
          {(c, r) => (
            <>
              <dl className="dk-seo-optimize-facts">
                <dt>Main heading</dt>
                <dd>{c.h1s.length ? c.h1s.join(" · ") : <span className="dk-tone-warn">None</span>}</dd>
                <dt>Second-level headings</dt>
                <dd className="dk-num">{num(c.h2)}</dd>
                <dt>Words of its own</dt>
                <dd className="dk-num">{c.words === null ? DASH : num(c.words)}</dd>
                <dt>Language</dt>
                <dd>{c.lang ?? <span className="dk-tone-warn">Not declared</span>}</dd>
                <dt>Pictures</dt>
                <dd>
                  {num(c.images.shown)} shown{c.images.altAbsent ? <span className="dk-tone-warn">, {num(c.images.altAbsent)} with no alt attribute</span> : ", every one named or marked as decoration"}
                </dd>
                {c.images.files.length ? (
                  <>
                    <dt>Without alt</dt>
                    <dd className="dk-seo-optimize-mono">{c.images.files.join(", ")}</dd>
                  </>
                ) : null}
              </dl>
              <Stamp reading={r} />
            </>
          )}
        </Read>
      </Card>
      <Card title="AI readiness" className="dk-seo-optimize-panel" info="What an AI search engine needs to find, understand and quote the page, read on the page as a crawler gets it (no JavaScript), once a day. Each check says what it read; none is a score of ours.">
        <Read reading={data.readiness}>
          {(rd, r) => (
            <>
              <ul className="dk-seo-optimize-checks">
                {rd.checks.map((c) => (
                  <li key={c.key} className={cx(c.state === "n/a" && "dk-seo-optimize-check--na")}>
                    <span className={cx("dk-seo-optimize-check-mark", c.state === "pass" ? "dk-tone-good" : c.state === "fail" ? "dk-tone-bad" : "dk-tone-quiet")} aria-hidden>
                      <Icon name={c.state === "pass" ? "check" : c.state === "fail" ? "x" : "minus"} size={12} />
                    </span>
                    <span className="dk-seo-optimize-check-text">
                      <b>{c.label}</b>
                      <span>{c.detail}</span>
                      {c.fix ? <span className="dk-seo-optimize-quiet">Fix ({c.who === "owner" ? "needs you" : c.who === "code" ? "the website's code" : "content"}): {c.fix}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
              <Stamp reading={r} />
            </>
          )}
        </Read>
      </Card>
    </>
  );
}

/** "Internal Links": who links here (from their text or only the menu and footer), and where it links from its own text. */
export function LinksView({ data }: { data: SeoPageViewPayload }) {
  return (
    <Read reading={data.links}>
      {(l, r) => {
        const fromText = l.in.filter((x) => x.place === "main");
        const sources = new Set(l.in.map((x) => x.source));
        const chromeOnly = [...sources].filter((s) => !fromText.some((x) => x.source === s)).length;
        const bySource = new Map<string, string[]>();
        for (const x of fromText) bySource.set(x.source, [...(bySource.get(x.source) ?? []), x.text]);
        const inRows = [...bySource.entries()].map(([source, texts]) => ({ source, texts: [...new Set(texts.filter(Boolean))] }));
        const out = l.out.filter((x) => x.place === "main");
        const chromeOut = new Set(l.out.filter((x) => x.place === "chrome").map((x) => x.target)).size;
        return (
          <>
            <Card title="Links to this page" count={sources.size} flush className="dk-seo-optimize-panel" info="Other pages that link here, as the crawl read them. Links from a page's own text tell search engines more than the menu and footer every page shares.">
              <p className="dk-seo-optimize-note dk-seo-optimize-pad">
                From the text of <b className="dk-num">{num(bySource.size)}</b> page{bySource.size === 1 ? "" : "s"}; only from the menu or footer of <b className="dk-num">{num(chromeOnly)}</b> more.
              </p>
              {inRows.length ? (
                <div className="dk-seo-optimize-scroll">
                  <Table
                    caption="Pages that link here from their text"
                    rows={inRows}
                    rowKey={(x) => x.source}
                    columns={[
                      { key: "page", head: "Page", width: "46%", cell: (x) => <Go href={`/seo/pages/view?path=${encodeURIComponent(x.source)}`} className="dk-seo-optimize-link">{x.source}</Go>, sort: (x) => x.source },
                      { key: "words", head: "With the words", cell: (x) => <span className="dk-seo-optimize-quiet dk-seo-optimize-wrap">{x.texts.length ? `“${x.texts.slice(0, 2).join("”, “")}”` : DASH}</span> },
                    ]}
                  />
                </div>
              ) : (
                <Empty icon="link" title="No page links here from its own text">
                  Only the menu or footer reach this page. Linking it from the text of related pages helps Google find and value it.
                </Empty>
              )}
              <div className="dk-seo-optimize-pad">
                <Stamp reading={r} />
              </div>
            </Card>
            <Card title="Links in this page's text" count={out.length} flush className="dk-seo-optimize-panel">
              <p className="dk-seo-optimize-note dk-seo-optimize-pad">Plus {num(chromeOut)} address{chromeOut === 1 ? "" : "es"} in the menu and footer every page shares.</p>
              <div className="dk-seo-optimize-scroll">
                <Table
                  caption="Links in this page's text"
                  rows={out}
                  rowKey={(x) => `${x.target}|${x.text}`}
                  minWidth={520}
                  empty="The page's text links nowhere."
                  columns={[
                    { key: "target", head: "Address", cell: (x) => <span className="dk-seo-optimize-mono">{x.target}</span>, sort: (x) => x.target },
                    { key: "text", head: "Words", width: "34%", cell: (x) => <span className="dk-seo-optimize-wrap">{x.text || DASH}</span> },
                    { key: "status", head: "Answers", numeric: true, width: "80px", cell: (x) => (x.status === null ? DASH : <span className={x.outcome === "ok" ? "" : "dk-tone-warn"}>{x.status}</span>), sort: (x) => x.status },
                  ]}
                />
              </div>
            </Card>
          </>
        );
      }}
    </Read>
  );
}

/** "Technical": Google's stored state of the address, what the crawl read, and every finding with its cost. */
export function TechnicalView({ data }: { data: SeoPageViewPayload }) {
  return (
    <>
      <Card title="In Google's index" className="dk-seo-optimize-panel" info="Google's URL Inspection of the address, asked once a day. Google's stored state, which can lag the live page by days.">
        <Read reading={data.index}>
          {(ix, r) => (
            <>
              <p className="dk-seo-optimize-index">
                <Badge tone={ix.now.indexed ? "good" : "bad"} dot>
                  {ix.now.indexed ? "Indexed" : "Not indexed"}
                </Badge>
                <span>{ix.now.coverage ?? "No reason given"}</span>
              </p>
              <p className="dk-seo-optimize-note">{ix.meaning}</p>
              {!ix.now.indexed ? <p className="dk-seo-optimize-note"><b>Fix.</b> {ix.fix}</p> : null}
              <dl className="dk-seo-optimize-facts">
                <dt>Last crawled by Google</dt>
                <dd>{ix.now.lastCrawl ? shortDate(ix.now.lastCrawl) : "Never"}</dd>
                <dt>Google's canonical</dt>
                <dd className="dk-seo-optimize-mono">{ix.now.googleCanonical ?? DASH}</dd>
                <dt>The page's canonical</dt>
                <dd className="dk-seo-optimize-mono">{ix.now.userCanonical ?? DASH}</dd>
                {ix.request ? (
                  <>
                    <dt>Request indexing</dt>
                    <dd>{ix.request.submittedBy ? `Marked requested by ${ix.request.submittedBy}${ix.request.submittedAt ? `, ${shortDate(ix.request.submittedAt)}` : ""}` : "In the queue: done by hand in Search Console"}</dd>
                  </>
                ) : null}
                {ix.changes.length > 1 ? (
                  <>
                    <dt>Changes</dt>
                    <dd>{ix.changes.map((c) => `${shortDate(c.day)}: ${c.coverage ?? (c.indexed ? "indexed" : "not indexed")}`).join(" · ")}</dd>
                  </>
                ) : null}
              </dl>
              {ix.now.link ? (
                <Go href={ix.now.link} className="dk-seo-optimize-link">
                  Open URL Inspection in Search Console
                </Go>
              ) : null}
              <Stamp reading={r} />
            </>
          )}
        </Read>
      </Card>
      <Card title="What the crawl read" className="dk-seo-optimize-panel">
        <Read reading={data.crawl}>
          {(c, r) => (
            <>
              <dl className="dk-seo-optimize-facts">
                <dt>Answers</dt>
                <dd className="dk-num">{c.status}</dd>
                <dt>Canonical</dt>
                <dd className="dk-seo-optimize-mono">{c.canonical ?? <span className="dk-tone-warn">None</span>}</dd>
                <dt>Robots</dt>
                <dd className="dk-seo-optimize-mono">{c.robots ?? "Not set (index, follow)"}</dd>
                <dt>Structured data</dt>
                <dd>{c.schemaTypes.length ? c.schemaTypes.join(", ") : <span className="dk-tone-warn">None</span>}</dd>
                <dt>Share card</dt>
                <dd>
                  {c.og.title ? "og:title" : "no og:title"}, {c.og.image ? "its own picture" : c.defaultPicture ? "the site's default picture" : "no picture"}, {c.twitterCard ? `twitter:${c.twitterCard}` : "no twitter card"}
                </dd>
              </dl>
              <Stamp reading={r} />
            </>
          )}
        </Read>
      </Card>
      <Card title="The crawl's findings" count={data.crawl.state === "ok" ? data.crawl.value.findings.length : undefined} flush className="dk-seo-optimize-panel" info="Each finding with the points it takes from the page's score, by the rules in src/cc/site/rules.ts.">
        {data.crawl.state === "ok" ? (
          <Table
            caption="Findings"
            rows={data.crawl.value.findings}
            rowKey={(f) => f.rule}
            minWidth={480}
            empty="The crawl's rules found nothing on this page."
            columns={[
              { key: "sev", head: "Severity", width: "96px", cell: (f) => <Badge tone={f.severity === "critical" ? "bad" : f.severity === "warning" ? "warn" : "info"}>{f.severity === "critical" ? "Critical" : f.severity === "warning" ? "Warning" : "Opportunity"}</Badge> },
              { key: "title", head: "Rule", width: "24%", cell: (f) => <span className="dk-seo-optimize-wrap">{f.title}</span> },
              { key: "text", head: "What it found", cell: (f) => <span className="dk-seo-optimize-quiet dk-seo-optimize-wrap">{f.text}</span> },
              { key: "cost", head: "Points", numeric: true, width: "64px", cell: (f) => (f.cost ? `−${f.cost}` : "0"), sort: (f) => f.cost },
            ]}
          />
        ) : (
          <Absent reading={data.crawl} />
        )}
      </Card>
    </>
  );
}

/** "Performance": the page's search figures per day, and its visitors from GA4. */
export function PerformanceView({ data }: { data: SeoPageViewPayload }) {
  const v = data.visitors;
  return (
    <>
      <Card title="In Google Search, per day" className="dk-seo-optimize-panel" info={data.searchFrom?.line ?? "Search Console."}>
        <Read reading={data.performance}>
          {(p, r) => (
            <>
              <Legend
                items={[
                  { label: "Impressions", color: "s1", mark: "line" },
                  { label: "Clicks", color: "s2", mark: "line" },
                ]}
              />
              <AreaChart
                label="Impressions and clicks per day"
                series={[
                  { label: "Impressions", data: p.days.map((d) => ({ date: d.date, value: d.impressions })), color: "s1" },
                  { label: "Clicks", data: p.days.map((d) => ({ date: d.date, value: d.clicks })), color: "s2" },
                ]}
                unit="count"
                height={180}
                zeroNote="Not shown in Google on any day of the period."
              />
              <p className="dk-seo-optimize-subhead">Average position (lower is better; a gap is a day Google did not show it)</p>
              <LineChart label="Average position per day" series={p.days.map((d) => ({ date: d.date, value: d.position }))} unit="ratio" height={120} emptyNote="No position on any day: Google did not show the page." />
              <Stamp reading={r} />
            </>
          )}
        </Read>
      </Card>
      <Card title="Visitors (GA4)" className="dk-seo-optimize-panel" info="Consenting visitors only: GA4 loads after the cookie banner is accepted, so this is an undercount.">
        {v.state === "ok" ? (
          <>
            <dl className="dk-seo-optimize-facts">
              <dt>Visitors</dt>
              <dd className="dk-num">
                {num(v.value.users)}
                {v.value.previous ? <span className="dk-seo-optimize-quiet"> (before: {num(v.value.previous.users)})</span> : null}
              </dd>
              <dt>Views</dt>
              <dd className="dk-num">{num(v.value.views)}</dd>
              <dt>Engaged time, all visitors</dt>
              <dd className="dk-num">{duration(v.value.engagementSeconds * 1000)}</dd>
              <dt>Sessions begun here from Google</dt>
              <dd className="dk-num">{v.value.organicSessions === null ? DASH : num(v.value.organicSessions)}</dd>
            </dl>
            <p className="dk-seo-optimize-note">
              {shortDate(v.value.start)} – {shortDate(v.value.end)}
            </p>
            <Stamp reading={v} />
          </>
        ) : (
          <Absent reading={v} />
        )}
      </Card>
    </>
  );
}
