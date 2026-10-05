import type { Reading } from "@/contract/common";
import type { OwnerTaskRow, Priority } from "@/contract/seo/common";
import type { ClusterDetail, ConsoleGap, GapKeyword, GapQuery, GapSort, Paged, SeoContentGapsPayload } from "@/contract/seo/content-gaps";
import { Chip } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Table } from "@/components/ui/Table";
import { cx } from "@/lib/cx";
import { DASH, fullDate, num } from "@/lib/format";
import { JudgeButton, MapCluster, OwnerDone } from "./Act";
import { BriefCell, Found, Impressions, LangMark, PageKind, Pager, PriorityMark, SortHead, Words } from "./Bits";
import { PhraseTable } from "./Group";
import { bare, exportHref, hrefWith, pageHref, pathOf, plural, PRIORITY_WORD } from "./look";

/** Phrases of one cluster shown in its detail; Keywords has them all. */
const PHRASES = 20;

/** A row of filter chips as links. */
function Chips({ items, label }: { items: { label: string; href: string; on: boolean; title?: string }[]; label: string }) {
  return (
    <nav className="dk-seo-gaps-chips" aria-label={label}>
      <span className="dk-seo-gaps-chips-label">{label}</span>
      {items.map((i) => (
        <Go key={i.label} href={i.href} className={cx("dk-seo-gaps-list-filter", i.on && "dk-seo-gaps-list-filter--on")} title={i.title} scroll={false} replace>
          {i.label}
        </Go>
      ))}
    </nav>
  );
}

/** "CSV": every row of the table the address shows, the same search, filters and order. */
function Export({ href, what }: { href: string; what: string }) {
  return (
    <a className="dk-seo-gaps-export" href={href} title={`${what} as a CSV file: every row, the same search, filters and order`} download>
      <Icon name="download" size={13} />
      CSV
    </a>
  );
}

const ORDERS: { key: GapSort; label: string }[] = [
  { key: "impressions", label: "Impressions" },
  { key: "phrase", label: "A to Z" },
  { key: "cluster", label: "Cluster" },
  { key: "priority", label: "Priority" },
  { key: "first-seen", label: "Newest found" },
];

/** view=keywords: every relevant phrase no page of its language answers, filtered by language, price, question, cluster and priority, in the order asked. */
export function KeywordView({ reading, asked, base, impressionsNote }: { reading: Reading<Paged<GapKeyword>> | null; asked: GapQuery; base: Record<string, string>; impressionsNote: string }) {
  if (!reading) return null;
  const set = (change: Record<string, string | null>) => hrefWith(base, { ...change, offset: null });
  const order = asked.sort ?? "impressions";
  return (
    <Card
      className="dk-seo-gaps-wide"
      title="Phrases with no page of their language"
      icon="search"
      info="Relevant phrases of the keyword table that no page in their own language answers: in a gap cluster (no page at all) or in an answered cluster whose page does not carry their words. Ordered by Search Console impressions, then the cluster's priority and the audit's order, price and questions first, unless another order is chosen. Every order runs over the whole list."
      sub={reading.state === "ok" ? `${plural(reading.value.total, "phrase")} match` : undefined}
      right={<Export href={exportHref(base)} what="These phrases" />}
      flush
    >
      <div className="dk-seo-gaps-filters">
        <Chips
          label="Language"
          items={[
            { label: "All", href: set({ lang: null }), on: asked.lang === "all" },
            { label: "German", href: set({ lang: "de" }), on: asked.lang === "de" },
            { label: "English", href: set({ lang: "en" }), on: asked.lang === "en" },
          ]}
        />
        <Chips
          label="Asks"
          items={[
            { label: "The price", href: set({ price: asked.price ? null : "1" }), on: asked.price },
            { label: "A question", href: set({ question: asked.question ? null : "1" }), on: asked.question },
          ]}
        />
        <Chips
          label="Cluster"
          items={[
            { label: "Any", href: set({ gap: null }), on: asked.gap === "all" },
            { label: "No page at all", href: set({ gap: "1" }), on: asked.gap === "1" },
            { label: "Page lacks the words", href: set({ gap: "0" }), on: asked.gap === "0" },
          ]}
        />
        <Chips
          label="Priority"
          items={(["all", "high", "medium", "low"] as (Priority | "all")[]).map((p) => ({
            label: p === "all" ? "Any" : PRIORITY_WORD[p],
            href: set({ priority: p === "all" ? null : p }),
            on: asked.priority === p,
            title: p === "all" ? undefined : "The cluster's priority: the audit's judgement of whether a young site can win it, or a person's",
          }))}
        />
        <Chips
          label="Order"
          items={ORDERS.map((o) => ({
            label: o.label,
            href: set({ sort: o.key === "impressions" ? null : o.key, dir: null }),
            on: order === o.key,
          }))}
        />
      </div>
      <Found q={asked.q} base={base} what="phrases (and phrases of clusters named so)" />
      {reading.state !== "ok" ? (
        <div className="dk-seo-gaps-pad">
          <Absent reading={reading} />
        </div>
      ) : (
        <div className="dk-seo-gaps-wide-body">
          <PhraseTable rows={reading.value} here={base} asked={asked} kind="keywords" />
          <footer className="dk-seo-gaps-panel-foot">
            <span className="dk-seo-gaps-panel-note">{impressionsNote}</span>
            <Stamp reading={reading} />
          </footer>
        </div>
      )}
    </Card>
  );
}

/** A search Google reports: what a person can do with it here. */
function ConsoleAct({ r, base }: { r: ConsoleGap; base: Record<string, string> }) {
  const k = r.keyword;
  if (!k) {
    return (
      <span className="dk-seo-gaps-quiet" title="The desk's keyword table takes Search Console's searches in on its next sync; then it can be judged here.">
        Not in the keyword table yet
      </span>
    );
  }
  const brief = r.brief && k.cluster ? <BriefCell brief={r.brief} cluster={k.cluster.key} phrases={[k.id]} label={r.why === "words-missing" ? "Brief the page" : "Create brief"} title={`The brief for the page that answers “${k.cluster.name}”, with “${r.query}” named first. The operator writes it on the studio workstation; a person writes and publishes the page.`} /> : null;
  return (
    <span className="dk-seo-gaps-console-act">
      {k.status !== "relevant" ? (
        <>
          <JudgeButton id={k.id} status="relevant" label="Relevant" variant="good" title="Your judgement: a search the studio wants to answer. It then counts on this page: a gap until a page of its language answers it." />
          {k.status !== "irrelevant" ? <JudgeButton id={k.id} status="irrelevant" label="Not relevant" title="Your judgement: not a search the studio wants. Keywords keeps it; no run changes your word." /> : null}
        </>
      ) : null}
      {k.status === "relevant" ? (
        brief ?? (
          <Go className="dk-seo-gaps-phrase-link" href={`/seo/keywords?q=${encodeURIComponent(r.query)}`} title="It belongs to no cluster: file it under one in Keywords to brief the page that answers it.">
            File it in Keywords
          </Go>
        )
      ) : null}
      {k.cluster ? (
        <Go className="dk-seo-gaps-phrase-link" href={hrefWith(base, { cluster: k.cluster.key })} scroll={false} title={`Open the cluster “${k.cluster.name}”`}>
          {bare(k.cluster.name)}
        </Go>
      ) : null}
    </span>
  );
}

const JUDGED: Record<string, string> = { relevant: "Relevant", weak: "Weak", irrelevant: "Not relevant", unjudged: "Not judged" };

/**
 * view=console: the searches Google already shows the site for where no page
 * it showed carries their words, from the desk's own Search Console history:
 * the cheapest real gaps. Listed judged or not (a search judged not relevant
 * is left out), with the way to judge one and to brief the page that should
 * answer it.
 */
export function ConsoleView({ reading, asked, base }: { reading: SeoContentGapsPayload["console"]; asked: GapQuery; base: Record<string, string> }) {
  if (!reading) return null;
  const set = (change: Record<string, string | null>) => hrefWith(base, { ...change, offset: null });
  return (
    <Card
      className="dk-seo-gaps-wide"
      title="Searches Google shows the site for, that no page carries"
      icon="line-chart"
      info="From the desk's own daily snapshots of Search Console, the period chosen above: each search Google showed the site for where the history names no page, or the page it showed does not carry every word of the search (places aside) in its title, heading or address. Google withholds rare searches. Listed whether judged or not (a search nobody judged yet is exactly the gap this view is for); a search a person judged not relevant is left out."
      sub={reading.state === "ok" ? `${plural(reading.value.total, "search", "searches")}` : undefined}
      right={reading.state === "ok" ? <Export href={exportHref(base)} what="These searches" /> : undefined}
      flush
    >
      <div className="dk-seo-gaps-filters">
        <Chips
          label="Language"
          items={[
            { label: "All", href: set({ lang: null }), on: asked.lang === "all" },
            { label: "German", href: set({ lang: "de" }), on: asked.lang === "de" },
            { label: "English", href: set({ lang: "en" }), on: asked.lang === "en" },
          ]}
        />
      </div>
      <Found q={asked.q} base={base} what="searches (or pages shown)" />
      {reading.state !== "ok" ? (
        <div className="dk-seo-gaps-pad">
          <Absent reading={reading} />
        </div>
      ) : (
        <div className="dk-seo-gaps-wide-body">
          <Table
            caption="Searches no page carries"
            rows={reading.value.rows}
            rowKey={(r) => r.query}
            minWidth={760}
            columns={[
              {
                key: "query",
                head: <SortHead label="Search" sort="phrase" asked={asked} base={base} title="Order A to Z" />,
                cell: (r) => (
                  <span className="dk-seo-gaps-phrase">
                    <span className="dk-seo-gaps-phrase-text" title={r.query}>
                      {r.query}
                    </span>
                    <span className="dk-seo-gaps-phrase-meta">
                      <LangMark lang={r.lang} />
                      <span title={r.keyword ? `In the keyword table, judged ${JUDGED[r.keyword.status]?.toLowerCase() ?? r.keyword.status}` : "Not in the keyword table yet"}>{r.keyword ? JUDGED[r.keyword.status] ?? r.keyword.status : "Not in the table"}</span>
                    </span>
                  </span>
                ),
              },
              { key: "impressions", head: <SortHead label="Impressions" sort="impressions" asked={asked} base={base} first />, numeric: true, width: "112px", cell: (r) => <Impressions n={r.impressions} /> },
              { key: "position", head: <SortHead label="Position" sort="position" asked={asked} base={base} title="Order by average position, best first" />, numeric: true, width: "96px", cell: (r) => (r.position === null ? DASH : num(r.position, 1)) },
              {
                key: "shown",
                head: "Page Google showed",
                width: "24%",
                cell: (r) =>
                  r.shown ? (
                    <span className="dk-seo-gaps-phrase">
                      <Go href={pageHref(r.shown)} className="dk-seo-gaps-phrase-text dk-seo-gaps-phrase-link" title={`${r.shownTitle ?? r.shown}: open it in Page Optimization`}>
                        {r.shown}
                      </Go>
                      <span className="dk-seo-gaps-phrase-meta">Its title, heading and address lack some words</span>
                    </span>
                  ) : (
                    <span className="dk-seo-gaps-quiet" title="The history names no page for it: Google withholds the page for rare searches.">
                      No page named
                    </span>
                  ),
              },
              { key: "act", head: "Action", width: "250px", align: "right", cell: (r) => <ConsoleAct r={r} base={base} /> },
            ]}
            empty={asked.q ? `No search here carries “${asked.q}”.` : "None: every search Google showed the site for in the period is carried by the page it showed."}
          />
          <Pager total={reading.value.total} offset={reading.value.offset} limit={reading.value.limit} href={(o) => hrefWith(base, { offset: o ? String(o) : null })} base={base} />
          <footer className="dk-seo-gaps-panel-foot">
            <span className="dk-seo-gaps-panel-note">{reading.note}</span>
            <Stamp reading={reading} />
          </footer>
        </div>
      )}
    </Card>
  );
}

/** view=competitors: one row per competitor site the desk read a page of, the topics it was seen for, and what its pages say. */
export function CompetitorView({ reading, asked, base }: { reading: SeoContentGapsPayload["competitors"]; asked: GapQuery; base: Record<string, string> }) {
  if (!reading) return null;
  return (
    <Card
      className="dk-seo-gaps-wide"
      title="Who answers the searches the site does not"
      icon="target"
      info="Competitor sites the desk read a page of (one request every two seconds per site, robots.txt obeyed), most seen first, with the topics each was seen for in the captured results and whether the site has a page of that topic's language. A ranking page is the address that was in the results; a home page was read because the capture named only the site, and says what the site is, not how it answers the search. No domain rating: no free source gives one."
      sub={reading.state === "ok" ? `${plural(reading.value.sites, "site")} · ${plural(reading.value.pages.ranking, "ranking page")}, ${plural(reading.value.pages.home, "home page")} read` : undefined}
      right={reading.state === "ok" ? <Export href={exportHref(base)} what="These sites and their pages" /> : undefined}
      flush
    >
      <Found q={asked.q} base={base} what="sites whose name, pages or topics carry the words" />
      {reading.state !== "ok" ? (
        <div className="dk-seo-gaps-pad">
          <Absent reading={reading} />
        </div>
      ) : !reading.value.rows.length ? (
        <p className="dk-seo-gaps-none">{asked.q ? `No competitor site carries “${asked.q}”.` : "No competitor site read yet."}</p>
      ) : (
        <div className="dk-seo-gaps-comp">
          {reading.value.rows.map((s) => (
            <section key={s.domain} className="dk-seo-gaps-comp-block" aria-label={s.domain}>
              <h3 className="dk-seo-gaps-comp-title">
                <Go href={`/seo/competitors?open=${encodeURIComponent(s.domain)}`} title="Everything the desk knows of this site, in Competitors">
                  {s.name ?? s.domain}
                </Go>
                {s.name ? <span className="dk-seo-gaps-comp-n">{s.domain}</span> : null}
                <span className="dk-seo-gaps-comp-n" title="How often it appeared in the captured results (Google, its local pack, AI answers), over every topic">
                  seen {plural(s.seen, "time")}
                </span>
              </h3>
              {s.topics.length ? (
                <ul className="dk-seo-gaps-clusters" aria-label={`Topics ${s.domain} was seen for`}>
                  {s.topics.map((t) => (
                    <li key={t.key} className={cx("dk-seo-gaps-cluster", t.gap && "dk-seo-gaps-cluster--gap")}>
                      <LangMark lang={t.lang} />
                      <Go href={hrefWith(base, { view: "clusters", open: t.key, q: null, offset: null, sort: null, dir: null })} className="dk-seo-gaps-cluster-name" title={t.name}>
                        {bare(t.name)}
                      </Go>
                      <span className="dk-seo-gaps-cluster-page">{t.gap ? "we have no page" : "we have a page"}</span>
                      {t.seen ? <span className="dk-seo-gaps-cluster-n dk-num">{num(t.seen)}×</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              <Table
                caption={`Pages of ${s.domain} the desk read`}
                rows={s.pages}
                rowKey={(p) => p.url}
                minWidth={560}
                columns={[
                  {
                    key: "page",
                    head: "Page",
                    cell: (p) => (
                      <span className="dk-seo-gaps-phrase">
                        <span className="dk-seo-gaps-phrase-meta">
                          <a className="dk-seo-gaps-phrase-text" href={p.url} target="_blank" rel="noreferrer" title={p.url}>
                            {pathOf(p.url)}
                          </a>
                          <PageKind address={p.address} />
                        </span>
                        <span className="dk-seo-gaps-phrase-meta">
                          <span className="dk-seo-gaps-phrase-cluster" title={p.title ?? undefined}>
                            {p.title ?? "No title read"}
                          </span>
                        </span>
                      </span>
                    ),
                  },
                  { key: "words", head: "Words", numeric: true, width: "72px", cell: (p) => <Words n={p.words} />, sort: (p) => p.words || null },
                  { key: "lang", head: "Lang", width: "60px", cell: (p) => (p.lang ? <LangMark lang={p.lang} /> : DASH) },
                  {
                    key: "price",
                    head: "Price",
                    width: "96px",
                    cell: (p) =>
                      p.priceStated === null ? (
                        DASH
                      ) : p.priceStated ? (
                        <span title={p.address === "home" ? "Its home page states a price: not how it answers a search." : undefined}>
                          <Chip tone={p.address === "home" ? "quiet" : "warn"}>States one</Chip>
                        </span>
                      ) : (
                        <span className="dk-seo-gaps-quiet">No</span>
                      ),
                  },
                  { key: "read", head: "Read", width: "96px", cell: (p) => (p.fetchedAt ? fullDate(p.fetchedAt) : DASH) },
                ]}
              />
            </section>
          ))}
          <div className="dk-seo-gaps-pad">
            <Stamp reading={reading} />
          </div>
        </div>
      )}
    </Card>
  );
}

/** ?cluster=: one cluster in detail, in the place of the group's panel. */
export function ClusterPanel({ reading, back, base }: { reading: Reading<ClusterDetail>; back: string; base: Record<string, string> }) {
  const c = reading.state === "ok" ? reading.value.cluster : null;
  return (
    <section className="dk-card dk-seo-gaps-panel">
      <header className="dk-seo-gaps-panel-head">
        <div className="dk-seo-gaps-panel-titles">
          <Go href={back} className="dk-seo-gaps-back" scroll={false}>
            <Icon name="arrow-left" size={14} />
            Back
          </Go>
          {c ? (
            <>
              <h2 className="dk-seo-gaps-panel-title">
                {bare(c.name)}
                <LangMark lang={c.lang} />
                <PriorityMark priority={c.priority} />
              </h2>
              <p className="dk-seo-gaps-panel-sub">
                {c.gap ? (c.otherLanguage ? `Mapped to ${c.page}, a page in another language: still a gap.` : "No page of its language answers it.") : `Answered by ${c.page}.`} {num(c.keywords.mapped)} of {plural(c.keywords.relevant, "relevant phrase")} have a page of their language.
                {c.mappedBy === "person" ? " Its page is a person's word." : ""}
              </p>
            </>
          ) : null}
        </div>
        {c && c.gap ? <BriefCell brief={c.brief} cluster={c.key} size="sm" under title="The operator writes the brief for the page that answers this cluster, from its missing phrases. A person writes and publishes the page." /> : null}
      </header>
      {reading.state !== "ok" ? (
        <div className="dk-seo-gaps-pad">
          <Absent reading={reading} />
        </div>
      ) : (
        (() => {
          const d = reading.value;
          const cl = d.cluster;
          return (
            <div className="dk-seo-gaps-panel-body dk-seo-gaps-detail">
              {/* How a gap is closed: once the page a brief led to is published and crawled, a person says it answers the cluster. */}
              <div className="dk-seo-gaps-detail-map">
                <MapCluster cluster={cl.key} page={cl.page} />
                {d.opportunity ? (
                  <Go className="dk-seo-gaps-phrase-link" href={`/seo/opportunities?open=${encodeURIComponent(d.opportunity.id)}`} title={`${d.opportunity.title} · ${d.opportunity.state.state}${d.opportunity.state.note ? `: ${d.opportunity.state.note}` : ""}`}>
                    Its opportunity: {d.opportunity.state.state === "in-progress" ? "in progress" : d.opportunity.state.state}
                    <Icon name="arrow-right" size={12} />
                  </Go>
                ) : (
                  <span className="dk-seo-gaps-quiet" title="The engine files a gap opportunity for a cluster with no page at all; a cluster mapped to a page of another language, or one a page answers, has none.">
                    No opportunity for it
                  </span>
                )}
                {cl.page ? (
                  <Go className="dk-seo-gaps-phrase-link" href={pageHref(cl.page)} title="Its page in Page Optimization: title, description, headings">
                    {cl.page} in Page Optimization
                  </Go>
                ) : null}
                {(() => {
                  /* Its most shown phrase, on the web: who ranks for it, and Google's and Bing's suggestions around it. Both links only open Keywords; nothing is asked until a button there is pressed. */
                  const top = [...d.phrases].sort((a, b) => (b.impressions ?? -1) - (a.impressions ?? -1))[0];
                  if (!top) return null;
                  const lang = ["de", "en", "fr", "it"].includes(cl.lang) ? cl.lang : "de";
                  return (
                    <>
                      <Go className="dk-seo-gaps-phrase-link" href={`/seo/keywords?serp=${encodeURIComponent(top.phrase)}&slang=${lang}`} title="Who ranks on Google for its most shown phrase, on Keywords">
                        Who ranks for “{top.phrase}”
                      </Go>
                      <Go className="dk-seo-gaps-phrase-link" href={`/seo/keywords?research=${encodeURIComponent(top.phrase)}&rlang=${lang}`} title="Google’s and Bing’s suggestions around it, on Keywords">
                        Research it on the web
                      </Go>
                    </>
                  );
                })()}
              </div>
              {cl.why || cl.action ? (
                <dl className="dk-seo-gaps-said-list">
                  {cl.why ? (
                    <>
                      <dt>Why, as the audit said</dt>
                      <dd>{cl.why}</dd>
                    </>
                  ) : null}
                  {cl.action ? (
                    <>
                      <dt>What to do, as the audit said</dt>
                      <dd>{cl.action}</dd>
                    </>
                  ) : null}
                </dl>
              ) : null}
              <Table
                caption={`Phrases of ${cl.name}`}
                rows={d.phrases.slice(0, PHRASES)}
                rowKey={(p) => p.id}
                minWidth={480}
                columns={[
                  { key: "phrase", head: "Phrase", cell: (p) => <span className="dk-seo-gaps-phrase-text" title={p.phrase}>{p.phrase}</span> },
                  { key: "status", head: "Judged", width: "104px", cell: (p) => <span className={cx(p.status !== "relevant" && "dk-seo-gaps-quiet")}>{JUDGED[p.status] ?? p.status}</span> },
                  { key: "imp", head: "Impressions", numeric: true, width: "104px", cell: (p) => <Impressions n={p.impressions} position={p.position} />, sort: (p) => p.impressions },
                  { key: "page", head: "Page", width: "30%", cell: (p) => (p.page ? <Go href={pageHref(p.page)} className="dk-seo-gaps-cell-clip dk-seo-gaps-phrase-link">{p.page}</Go> : <span className="dk-seo-gaps-quiet">{DASH}</span>) },
                ]}
                empty="No phrase is filed under this cluster."
              />
              {d.phrases.length > PHRASES ? (
                <p className="dk-seo-gaps-more">
                  {num(PHRASES)} of {num(d.phrases.length)} shown, most important first. <Go href={`/seo/keywords?cluster=${encodeURIComponent(cl.key)}`}>All of them in Keywords</Go>
                </p>
              ) : (
                <p className="dk-seo-gaps-more">
                  <Go href={`/seo/keywords?cluster=${encodeURIComponent(cl.key)}`}>Its phrases in Keywords</Go>, to judge them or file new ones.
                </p>
              )}
              {d.competitors.length ? (
                <div className="dk-seo-gaps-seen">
                  <h3 className="dk-seo-gaps-sub-title">Competitor pages read for it</h3>
                  <Table
                    caption={`Competitor pages read for ${cl.name}`}
                    rows={d.competitors}
                    rowKey={(p) => p.url}
                    minWidth={560}
                    columns={[
                      {
                        key: "page",
                        head: "Page",
                        cell: (p) => (
                          <span className="dk-seo-gaps-phrase">
                            <span className="dk-seo-gaps-phrase-meta">
                              <a className="dk-seo-gaps-phrase-text" href={p.url} target="_blank" rel="noreferrer" title={p.url}>
                                {p.domain}
                                <span className="dk-seo-gaps-quiet">{pathOf(p.url) === "/" ? "" : pathOf(p.url)}</span>
                              </a>
                              <PageKind address={p.address} />
                            </span>
                            <span className="dk-seo-gaps-phrase-meta">
                              <span className="dk-seo-gaps-phrase-cluster" title={p.h1 ? `Heading: ${p.h1}` : undefined}>
                                {p.title ?? "No title read"}
                              </span>
                              {p.schemaTypes.length ? <span title="Structured data the page declares">{p.schemaTypes.slice(0, 3).join(", ")}</span> : null}
                            </span>
                          </span>
                        ),
                      },
                      { key: "words", head: "Words", numeric: true, width: "72px", cell: (p) => <Words n={p.words} />, sort: (p) => p.words || null },
                      { key: "lang", head: "Lang", width: "56px", cell: (p) => (p.lang ? <LangMark lang={p.lang} /> : DASH) },
                      {
                        key: "price",
                        head: "Price",
                        width: "96px",
                        cell: (p) =>
                          p.priceStated === null ? (
                            DASH
                          ) : p.priceStated ? (
                            <Chip tone={p.address === "home" ? "quiet" : "warn"}>States one</Chip>
                          ) : (
                            <span className="dk-seo-gaps-quiet">No</span>
                          ),
                      },
                    ]}
                  />
                </div>
              ) : null}
              {d.sightings.length ? (
                <div className="dk-seo-gaps-seen">
                  <h3 className="dk-seo-gaps-sub-title">Seen instead of Balkaris</h3>
                  <ul>
                    {d.sightings.slice(0, 12).map((s, i) => (
                      <li key={`${s.domain}-${s.engine}-${s.query}-${i}`}>
                        <b>{s.domain}</b>
                        <span className="dk-seo-gaps-quiet">
                          {s.engine}
                          {s.position ? ` #${s.position}` : ""} · “{s.query}” · {fullDate(s.day)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="dk-seo-gaps-more">
                    <Go href={`/seo/competitors?cluster=${encodeURIComponent(cl.key)}`}>Every competitor seen for it, in Competitors</Go>
                  </p>
                </div>
              ) : null}
              <div className="dk-seo-gaps-stamp">
                <Stamp reading={reading} />
              </div>
            </div>
          );
        })()
      )}
    </section>
  );
}

/** What only the owner can do, and how the page counts. */
export function Lower({ needsYou, notes, you }: { needsYou: Reading<OwnerTaskRow[]>; notes: SeoContentGapsPayload["notes"]; you: SeoContentGapsPayload["you"] }) {
  return (
    <div className="dk-seo-gaps-lower">
      <Card title="Needs you" icon="user" tone="warn" info="Decisions and logins only the owner has: the desk cannot make them and does not pretend to. The owner marks one done here when it is." id="needs-you">
        {needsYou.state !== "ok" ? (
          <Absent reading={needsYou} />
        ) : !needsYou.value.length ? (
          <p className="dk-seo-gaps-none">Nothing waits on the owner for the content gaps.</p>
        ) : (
          <ul className="dk-seo-gaps-needs">
            {needsYou.value.map((t) => (
              <li key={t.id} className={cx("dk-seo-gaps-need", t.done && "dk-seo-gaps-need--done")}>
                <div className="dk-seo-gaps-need-text">
                  <p className="dk-seo-gaps-need-title">
                    <Chip tone={t.impact === "high" ? "bad" : t.impact === "medium" ? "warn" : "quiet"}>{t.impact}</Chip>
                    {t.title}
                  </p>
                  <details className="dk-seo-gaps-owner-step">
                    <summary>The exact step</summary>
                    <p>{t.step}</p>
                    {t.why ? <p className="dk-seo-gaps-owner-why">{t.why}</p> : null}
                  </details>
                  {t.done ? (
                    <p className="dk-seo-gaps-quiet">
                      Done by {t.doneBy ?? "a person"}
                      {t.doneAt ? ` on ${fullDate(t.doneAt)}` : ""}.
                    </p>
                  ) : null}
                </div>
                {/* The owner's own steps are his to close: the page says so instead of offering a button that is refused. */}
                {you.owner || t.who !== "owner" ? (
                  <OwnerDone task={t.id} done={t.done} />
                ) : (
                  <span className="dk-seo-gaps-quiet dk-seo-gaps-need-who" title="Only the owner marks his own steps done.">
                    The owner marks it
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="How this page counts" icon="info" info="Stated once, so every figure on the page can be checked against it.">
        <dl className="dk-seo-gaps-method">
          <dt>Coverage</dt>
          <dd>{notes.coverage}</dd>
          <dt>Impressions</dt>
          <dd>{notes.impressions}</dd>
          <dt>Volume and difficulty</dt>
          <dd>{notes.volume}</dd>
        </dl>
      </Card>
    </div>
  );
}
