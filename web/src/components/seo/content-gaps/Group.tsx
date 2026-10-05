import type { Reading } from "@/contract/common";
import type { ClusterRow, CompetitorPage, GapKeyword, GapQuery, GapTab, GapView, GroupDetail, Paged, Suggestion } from "@/contract/seo/content-gaps";
import { Chip } from "@/components/ui/Badge";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Table } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { cx } from "@/lib/cx";
import { DASH, num } from "@/lib/format";
import { BriefForm, BriefsButton } from "./Act";
import { BriefCell, BriefMark, Flags, Found, Impressions, IntentChip, LangMark, PageKind, Pager, PriorityMark, RowBrief, SortHead, Sources, Words } from "./Bits";
import { bare, coverText, exportHref, hrefWith, pageHref, pathOf, plural, TAB_LABEL } from "./look";

/** The clusters shown as pills under the group's name; the rest fold out under them. */
const PILLS = 8;

/** "Generate all briefs" asks this many at once, as the server takes them. */
const BRIEFS_MOST = 10;

/**
 * The open group (board 113's right panel): its name, "Generate all briefs",
 * and four tables: the phrases no page of their language answers (Missing),
 * the phrases of answered clusters their page does not carry (Partly
 * answered), the pages to make (Suggested pages), and the competitor pages
 * the desk read for the group's searches.
 *
 * The board's "Volume" column is Search Console's impressions here, named as
 * such: no free source gives a search volume. "Found in" is the proof a
 * phrase is searched: Google Autocomplete completes it. Every order is the
 * server's, over every row of the table, and part of the address.
 */
export function GroupPanel({ reading, view, asked, base, impressionsNote }: { reading: Reading<GroupDetail> | null; view: GapView; asked: GapQuery; base: Record<string, string>; impressionsNote: string }) {
  if (!reading) return null;
  if (reading.state !== "ok") {
    return (
      <section className="dk-card dk-seo-gaps-panel">
        <div className="dk-seo-gaps-pad">
          <Absent reading={reading} />
        </div>
      </section>
    );
  }
  const d = reading.value;
  const g = d.group;
  const t = coverText(g.coverage.covered, g.coverage.of);
  const here = { ...base, open: g.key };
  /* Each table has its own orders: a tab starts in its own. */
  const tabs = (["missing", "partial", "suggested", "competitors"] as GapTab[]).map((k) => ({
    key: k,
    label: TAB_LABEL[k],
    href: hrefWith(here, { tab: k === "missing" ? null : k, offset: null, cluster: null, sort: null, dir: null }),
    count: d.counts[k],
    countTone: k === "missing" && d.counts[k] ? ("bad" as const) : undefined,
  }));
  const busy = d.briefs.queued ? `${num(d.briefs.queued)} queued or running` : "";
  const written = d.briefs.written ? `${num(d.briefs.written)} written already (each can be asked again from its row)` : "";

  return (
    <section className="dk-card dk-seo-gaps-panel" aria-label={g.name}>
      <header className="dk-seo-gaps-panel-head">
        <div className="dk-seo-gaps-panel-titles">
          <h2 className="dk-seo-gaps-panel-title">
            {bare(g.name)}
            {d.clusters.length ? <PriorityMark priority={g.priority} /> : null}
          </h2>
          <p className="dk-seo-gaps-panel-sub">
            <span className="dk-num">{t.main}</span> relevant phrases have a page of their language{t.share ? ` (${t.share})` : ""}
            {g.price ? ` · ${num(g.price)} ask the price` : ""}
            {g.questions ? ` · ${num(g.questions)} are questions` : ""}
            {g.rank ? ` · #${g.rank} in the audit's order` : ""}
          </p>
        </div>
        {d.briefs.total ? (
          <BriefsButton
            clusters={d.briefs.ready}
            most={BRIEFS_MOST}
            title={`One brief for each of this group's ${plural(d.briefs.total, "cluster")} with no page of its language that has none asked yet${busy || written ? ` (${[busy, written].filter(Boolean).join("; ")})` : ""}, at most ${BRIEFS_MOST} at once. The operator writes them on the studio workstation; a person writes and publishes each page.`}
          />
        ) : null}
      </header>
      {d.clusters.length ? <ClusterPills clusters={d.clusters} here={here} /> : null}
      <Tabs items={tabs} active={d.tab} label="What the group lacks" size="sm" className="dk-seo-gaps-tabs" />
      <div className="dk-seo-gaps-panel-body">
        <Found q={asked.q} base={here} what={d.tab === "competitors" ? "competitor pages" : d.tab === "suggested" ? "pages to make for clusters named so or holding phrases" : "phrases"} />
        {d.tab === "missing" && d.missing ? <PhraseTable rows={d.missing} here={here} asked={asked} kind="missing" showCluster={view !== "clusters"} /> : null}
        {d.tab === "partial" && d.partial ? <PhraseTable rows={d.partial} here={here} asked={asked} kind="partial" showCluster={view !== "clusters"} /> : null}
        {d.tab === "suggested" && d.suggested ? (
          <>
            <Suggested rows={d.suggested.rows} here={here} q={asked.q} />
            <Pager total={d.suggested.total} offset={d.suggested.offset} limit={d.suggested.limit} href={(o) => hrefWith(here, { offset: o ? String(o) : null })} base={here} />
          </>
        ) : null}
        {d.tab === "competitors" && d.competitors ? (
          <>
            <Competitors rows={d.competitors.rows} here={here} asked={asked} />
            <Pager total={d.competitors.total} offset={d.competitors.offset} limit={d.competitors.limit} href={(o) => hrefWith(here, { offset: o ? String(o) : null })} base={here} />
          </>
        ) : null}
      </div>
      <footer className="dk-seo-gaps-panel-foot">
        <span className="dk-seo-gaps-panel-note">{impressionsNote}</span>
        <a className="dk-seo-gaps-export" href={exportHref(here)} title={`Every row of “${TAB_LABEL[d.tab]}” as a CSV file, the same search and order`} download>
          <Icon name="download" size={13} />
          CSV
        </a>
        <Stamp reading={reading} />
      </footer>
    </section>
  );
}

/** The group's clusters as pills: the first few in sight, the rest folded under them, each opening the cluster in place of the group. */
function ClusterPills({ clusters, here }: { clusters: ClusterRow[]; here: Record<string, string> }) {
  const pill = (c: ClusterRow) => (
    <li key={c.key} className={cx("dk-seo-gaps-cluster", c.gap && "dk-seo-gaps-cluster--gap")}>
      <LangMark lang={c.lang} />
      <Go href={hrefWith(here, { cluster: c.key })} className="dk-seo-gaps-cluster-name" scroll={false} title={c.name}>
        {bare(c.name)}
      </Go>
      <span className="dk-seo-gaps-cluster-page">{c.gap ? (c.otherLanguage ? `mapped to ${c.page}, another language` : "no page") : c.page}</span>
      <span className="dk-seo-gaps-cluster-n dk-num" title={`${num(c.keywords.mapped)} of ${plural(c.keywords.relevant, "relevant phrase")} have a page of their language`}>
        {num(c.keywords.mapped)}/{num(c.keywords.relevant)}
      </span>
      {/* Where its brief stands, once one was asked: waiting, written (a link to read it), or failed. */}
      {c.gap && c.brief.task ? <BriefMark brief={c.brief} /> : null}
    </li>
  );
  return (
    <div className="dk-seo-gaps-clusterbox">
      <ul className="dk-seo-gaps-clusters" aria-label="Its clusters">
        {clusters.slice(0, PILLS).map(pill)}
      </ul>
      {clusters.length > PILLS ? (
        <details className="dk-seo-gaps-more-clusters">
          <summary className="dk-seo-gaps-cluster dk-seo-gaps-cluster--more">
            <Icon name="chevron-right" size={12} />+{num(clusters.length - PILLS)} more clusters in this group
          </summary>
          <ul className="dk-seo-gaps-clusters" aria-label="Its other clusters">
            {clusters.slice(PILLS).map(pill)}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** Missing or partly answered phrases, as a form: tick, then brief, judge or say which page answers them. */
export function PhraseTable({
  rows,
  here,
  asked,
  kind,
  showCluster = true,
}: {
  rows: Paged<GapKeyword>;
  here: Record<string, string>;
  asked: GapQuery;
  kind: "missing" | "partial" | "keywords";
  showCluster?: boolean;
}) {
  const empty = asked.q
    ? `No phrase here carries “${asked.q}”.`
    : kind === "missing"
      ? "No phrase is missing: every relevant phrase here has a page of its language, or belongs to a cluster a page answers."
      : kind === "partial"
        ? "None: every phrase of the answered clusters is carried by its page's title, heading or address."
        : "No phrase matches.";
  return (
    <BriefForm
      head={
        <span className="dk-seo-gaps-formbar-text">
          {kind === "partial" ? "Phrases of answered clusters whose page's title, heading and address do not carry their words." : "Relevant phrases with no page of their language."}
        </span>
      }
    >
      <Table
        caption={kind === "partial" ? "Partly answered phrases" : "Missing phrases"}
        rows={rows.rows}
        rowKey={(k) => k.id}
        select={{ name: "phrases", label: (k) => `Tick “${k.phrase}”` }}
        /* Its least width is in gaps.css: on a phone "Found in" and "Intent" give way, so the phrase, its impressions and its action stay in sight. */
        className="dk-seo-gaps-phrases"
        columns={[
          {
            key: "phrase",
            head: <SortHead label="Keyword" sort="phrase" asked={asked} base={here} title="Order the whole list A to Z" />,
            cell: (k) => (
              <span className="dk-seo-gaps-phrase">
                <span className="dk-seo-gaps-phrase-text" title={k.phrase}>
                  {k.phrase}
                </span>
                <span className="dk-seo-gaps-phrase-meta">
                  <LangMark lang={k.lang} />
                  <Flags flags={k.flags} />
                  {showCluster && k.cluster ? (
                    <Go href={hrefWith(here, { cluster: k.cluster.key })} scroll={false} className="dk-seo-gaps-phrase-cluster dk-seo-gaps-phrase-link" title={`Open the cluster “${k.cluster.name}”`}>
                      {bare(k.cluster.name)}
                    </Go>
                  ) : null}
                  {kind !== "missing" && k.page ? (
                    <Go href={pageHref(k.page)} className="dk-seo-gaps-phrase-cluster dk-seo-gaps-phrase-link" title="The page mapped to it, in Page Optimization">
                      page {k.page}
                    </Go>
                  ) : null}
                  {k.impressions !== null ? <span className="dk-seo-gaps-phrase-imp dk-num">{plural(k.impressions, "impression")}</span> : null}
                </span>
              </span>
            ),
          },
          {
            key: "impressions",
            head: <SortHead label={<span title="Search Console: how often Google showed the site for it in the period. Not a search volume.">Impressions</span>} sort="impressions" asked={asked} base={here} first />,
            numeric: true,
            width: "112px",
            cell: (k) => <Impressions n={k.impressions} position={k.position} />,
          },
          { key: "found", head: "Found in", width: "150px", cell: (k) => <Sources sources={k.sources} /> },
          { key: "intent", head: "Intent", width: "112px", cell: (k) => <IntentChip intent={k.intent} /> },
          { key: "action", head: "Action", width: "150px", align: "right", cell: (k) => <RowBrief k={k} label={kind === "partial" ? "Brief the page" : "Create brief"} /> },
        ]}
        empty={empty}
      />
      <Pager total={rows.total} offset={rows.offset} limit={rows.limit} href={(o) => hrefWith(here, { offset: o ? String(o) : null })} base={here} />
    </BriefForm>
  );
}

/**
 * Our estimate of the clicks a page could add (the opportunity's own, made
 * only from Search Console impressions: src/cc/seo/ctr.ts). Under this many
 * impressions a month it is not printed as a figure: a tenth of a click from
 * one impression is noise, so the raw count is shown instead.
 */
const ESTIMATE_FROM = 30;

function Estimate({ s }: { s: Suggestion }) {
  const p = s.potential;
  if (!s.cluster.opportunityId) {
    return (
      <span
        className="dk-seo-gaps-quiet"
        title={
          s.cluster.otherLanguage
            ? "The engine counts a cluster with any page as answered, and this one is mapped to a page in another language: it holds no opportunity, so no estimate. This page counts it as a gap because no page of its own language answers it."
            : "Our estimate belongs to a gap's opportunity (SEO › Opportunities), and the engine holds none for this cluster."
        }
      >
        No estimate: no opportunity for this cluster
      </span>
    );
  }
  if (!p) {
    return (
      <span className="dk-seo-gaps-quiet" title="Our estimate is made only from Search Console impressions, and Google has shown the site for none of its phrases in the window.">
        No estimate: no impressions
      </span>
    );
  }
  const imp = Math.round(p.impressionsPerMonth);
  if (imp < ESTIMATE_FROM) {
    return (
      <span className="dk-seo-gaps-quiet" title={`Our estimate is printed from ${ESTIMATE_FROM} impressions a month; below that it is noise. ${p.basis}`}>
        No estimate: {plural(imp, "impression")} a month, too few
      </span>
    );
  }
  return (
    <span title={p.basis}>
      Our estimate +{num(p.clicksPerMonth, p.clicksPerMonth < 10 ? 1 : 0)} clicks a month, from {plural(imp, "impression")} a month
    </span>
  );
}

/** What the desk read of the competitors for a page to make: ranking pages are how they answer; home pages only say who they are. */
function Rivals({ s }: { s: Suggestion }) {
  const r = s.competitors;
  if (!r.ranking && !r.home) return <span className="dk-seo-gaps-quiet">No competitor page read for it yet</span>;
  if (!r.ranking) {
    return (
      <span className="dk-seo-gaps-quiet" title="The capture named these sites without the address that ranked, so the desk read their home pages: what a home page says is not how the site answers the search.">
        {plural(r.home, "competitor home page")} read; no ranking page yet
      </span>
    );
  }
  return (
    <span title="Counted over the pages that ranked for the searches. A home page, read when the capture named only the site, is left out of the language and the price.">
      Ranking competitor pages: {num(r.ranking)} · {num(r.german)} in German · {num(r.priced)} state a price
      {r.home ? <span className="dk-seo-gaps-quiet"> · {plural(r.home, "home page")} not counted</span> : null}
    </span>
  );
}

function Suggested({ rows, here, q }: { rows: Suggestion[]; here: Record<string, string>; q: string }) {
  if (!rows.length) return <p className="dk-seo-gaps-none">{q ? `No page to make for a cluster named so or holding a phrase carrying “${q}”.` : "No page to make: every cluster of this group has a page of its language."}</p>;
  return (
    <ol className="dk-seo-gaps-suggest">
      {rows.map((s) => {
        const c = s.cluster;
        return (
          <li key={c.key} className="dk-seo-gaps-suggest-row">
            <div className="dk-seo-gaps-suggest-text">
              <p className="dk-seo-gaps-suggest-page" title={s.page}>
                {s.page}
              </p>
              <p className="dk-seo-gaps-suggest-meta">
                <LangMark lang={c.lang} />
                <PriorityMark priority={c.priority} />
                <Go href={hrefWith(here, { cluster: c.key })} scroll={false} className="dk-seo-gaps-suggest-link">
                  {bare(c.name)}
                </Go>
                <span>{plural(c.keywords.relevant, "relevant phrase")}</span>
                {c.price ? <span>{num(c.price)} ask the price</span> : null}
                {c.rank ? <span>#{c.rank} in the audit's order</span> : null}
              </p>
              <p className="dk-seo-gaps-suggest-meta">
                {s.twin ? (
                  <span>
                    {c.lang === "de" ? "German" : c.lang === "en" ? "English" : c.lang.toUpperCase()} twin of{" "}
                    <Go href={pageHref(s.twin.page)} className="dk-seo-gaps-suggest-link" title={`The ${s.twin.lang === "en" ? "English" : s.twin.lang.toUpperCase()} page that answers the same topic: translate and adapt it, and link the two by hreflang.`}>
                      {s.twin.page}
                    </Go>
                  </span>
                ) : (
                  <span className="dk-seo-gaps-quiet" title="No page of the other language answers the same topic: this is a new page, not a translation.">
                    No twin in the other language
                  </span>
                )}
                <Rivals s={s} />
                <Estimate s={s} />
              </p>
              {c.examples.length ? <p className="dk-seo-gaps-suggest-examples">“{c.examples.slice(0, 3).join("”, “")}”</p> : null}
            </div>
            <div className="dk-seo-gaps-suggest-act">
              <BriefCell brief={c.brief} cluster={c.key} under title={`The operator writes the brief for the page that answers “${c.name}”, from its missing phrases. A person writes and publishes the page.`} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Competitors({ rows, here, asked }: { rows: CompetitorPage[]; here: Record<string, string>; asked: GapQuery }) {
  return (
    <Table
      caption="Competitor pages read for the group's searches"
      rows={rows}
      rowKey={(p) => p.url}
      minWidth={680}
      columns={[
        {
          key: "page",
          head: <SortHead label="Competitor page" sort="domain" asked={asked} base={here} title="Order by site, A to Z" />,
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
                <span className="dk-seo-gaps-phrase-cluster" title={p.title ?? undefined}>
                  {p.title ?? "No title read"}
                </span>
                <Go href={`/seo/competitors?open=${encodeURIComponent(p.domain)}`} className="dk-seo-gaps-phrase-link" title="Everything the desk knows of this site, in Competitors">
                  In Competitors
                </Go>
              </span>
            </span>
          ),
        },
        { key: "for", head: "Seen for", width: "160px", cell: (p) => <span className="dk-seo-gaps-cell-clip" title={p.query ?? undefined}>{p.query ?? (p.cluster ? bare(p.cluster.name) : DASH)}</span> },
        { key: "words", head: <SortHead label="Words" sort="words" asked={asked} base={here} />, numeric: true, width: "84px", cell: (p) => <Words n={p.words} /> },
        { key: "lang", head: "Lang", width: "56px", cell: (p) => (p.lang ? <LangMark lang={p.lang} /> : DASH) },
        {
          key: "price",
          head: "Price",
          width: "96px",
          cell: (p) =>
            p.priceStated === null ? (
              DASH
            ) : p.priceStated ? (
              <span title={p.address === "home" ? "Its home page states a price: not how it answers the search." : undefined}>
                <Chip tone={p.address === "home" ? "quiet" : "warn"}>States one</Chip>
              </span>
            ) : (
              <span className="dk-seo-gaps-quiet">No</span>
            ),
        },
        {
          key: "seen",
          head: <SortHead label={<span title="How often the domain appeared in the captured results for these searches (Google, its local pack, AI answers).">Seen</span>} sort="seen" asked={asked} base={here} first />,
          numeric: true,
          width: "72px",
          cell: (p) => num(p.seen),
        },
      ]}
      empty={asked.q ? `No competitor page here carries “${asked.q}”.` : "No competitor page has been read for this group's searches yet: the competitor job reads the pages the audit saw beside Balkaris, one request every two seconds per site."}
    />
  );
}
