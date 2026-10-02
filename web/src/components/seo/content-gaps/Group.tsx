import type { Reading } from "@/contract/common";
import type { CompetitorPage, GapKeyword, GapTab, GroupDetail, Suggestion } from "@/contract/seo/content-gaps";
import { Chip } from "@/components/ui/Badge";
import { Go } from "@/components/ui/Go";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Table } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { cx } from "@/lib/cx";
import { DASH, num } from "@/lib/format";
import { BriefButton, BriefForm, BriefsButton } from "./Act";
import { BriefMark, Flags, Impressions, IntentChip, LangMark, Pager, PriorityMark, RowBrief, Sources, Words } from "./Bits";
import { bare, coverText, hrefWith, plural, TAB_LABEL } from "./look";

/** The clusters shown as pills under the group's name; the rest are one link away. */
const PILLS = 8;

/**
 * The open group (board 113's right panel): its name, "Generate all briefs",
 * and four tables: the phrases no page of their language answers (Missing),
 * the phrases of answered clusters their page does not carry (Partly
 * answered), the pages to make (Suggested pages), and the competitor pages
 * the desk read for the group's searches.
 *
 * The board's "Volume" column is Search Console's impressions here, named as
 * such: no free source gives a search volume. "Found in" is the proof a
 * phrase is searched: Google Autocomplete completes it.
 */
export function GroupPanel({ reading, base, impressionsNote }: { reading: Reading<GroupDetail> | null; base: Record<string, string>; impressionsNote: string }) {
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
  const tabs = (["missing", "partial", "suggested", "competitors"] as GapTab[]).map((k) => ({
    key: k,
    label: TAB_LABEL[k],
    href: hrefWith(here, { tab: k === "missing" ? null : k, offset: null, cluster: null }),
    count: d.counts[k],
    countTone: k === "missing" && d.counts[k] ? ("bad" as const) : undefined,
  }));

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
            most={10}
            title={`One brief for each of this group's ${plural(d.briefs.total, "cluster")} with no page of its language${d.briefs.queued ? ` (${num(d.briefs.queued)} already queued)` : ""}, at most ten at once. The operator writes them on the studio workstation; a person writes and publishes each page.`}
          />
        ) : null}
      </header>
      {d.clusters.length ? (
        <ul className="dk-seo-gaps-clusters" aria-label="Its clusters">
          {d.clusters.slice(0, PILLS).map((c) => (
            <li key={c.key} className={cx("dk-seo-gaps-cluster", c.gap && "dk-seo-gaps-cluster--gap")}>
              <LangMark lang={c.lang} />
              <Go href={hrefWith(here, { cluster: c.key })} className="dk-seo-gaps-cluster-name" scroll={false} title={c.name}>
                {bare(c.name)}
              </Go>
              <span className="dk-seo-gaps-cluster-page">
                {c.gap ? (c.otherLanguage ? `mapped to ${c.page}, another language` : "no page") : c.page}
              </span>
              <span className="dk-seo-gaps-cluster-n dk-num">
                {num(c.keywords.mapped)}/{num(c.keywords.relevant)}
              </span>
              {c.gap ? c.brief.available ? null : <BriefMark brief={c.brief} /> : null}
            </li>
          ))}
          {d.clusters.length > PILLS ? (
            <li>
              <Go href={hrefWith(base, { view: "clusters", open: null, tab: null, offset: null, gap: "1" })} className="dk-seo-gaps-cluster dk-seo-gaps-cluster--more" scroll={false}>
                +{num(d.clusters.length - PILLS)} more in By cluster
              </Go>
            </li>
          ) : null}
        </ul>
      ) : null}
      <Tabs items={tabs} active={d.tab} label="What the group lacks" size="sm" className="dk-seo-gaps-tabs" />
      <div className="dk-seo-gaps-panel-body">
        {d.tab === "missing" && d.missing ? <PhraseTable rows={d.missing} here={here} kind="missing" /> : null}
        {d.tab === "partial" && d.partial ? <PhraseTable rows={d.partial} here={here} kind="partial" /> : null}
        {d.tab === "suggested" && d.suggested ? (
          <>
            <Suggested rows={d.suggested.rows} here={here} />
            <Pager total={d.suggested.total} offset={d.suggested.offset} limit={d.suggested.limit} href={(o) => hrefWith(here, { offset: o ? String(o) : null })} />
          </>
        ) : null}
        {d.tab === "competitors" && d.competitors ? (
          <>
            <Competitors rows={d.competitors.rows} />
            <Pager total={d.competitors.total} offset={d.competitors.offset} limit={d.competitors.limit} href={(o) => hrefWith(here, { offset: o ? String(o) : null })} />
          </>
        ) : null}
      </div>
      <footer className="dk-seo-gaps-panel-foot">
        <span className="dk-seo-gaps-panel-note">{impressionsNote}</span>
        <Stamp reading={reading} />
      </footer>
    </section>
  );
}

/** Missing or partly answered phrases, as a form: tick and brief. */
export function PhraseTable({ rows, here, kind, showCluster = true }: { rows: { total: number; offset: number; limit: number; rows: GapKeyword[] }; here: Record<string, string>; kind: "missing" | "partial" | "keywords"; showCluster?: boolean }) {
  const empty =
    kind === "missing"
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
        select={{ name: "phrases", label: (k) => `Brief “${k.phrase}”` }}
        /* Its least width is in gaps.css: on a phone "Found in" and "Intent" give way, so the phrase, its impressions and its action stay in sight. */
        className="dk-seo-gaps-phrases"
        columns={[
          {
            key: "phrase",
            head: "Keyword",
            cell: (k) => (
              <span className="dk-seo-gaps-phrase">
                <span className="dk-seo-gaps-phrase-text" title={k.phrase}>
                  {k.phrase}
                </span>
                <span className="dk-seo-gaps-phrase-meta">
                  <LangMark lang={k.lang} />
                  <Flags flags={k.flags} />
                  {showCluster && k.cluster ? <span className="dk-seo-gaps-phrase-cluster">{bare(k.cluster.name)}</span> : null}
                  {kind === "partial" && k.page ? <span className="dk-seo-gaps-phrase-cluster">page {k.page}</span> : null}
                  {k.impressions !== null ? <span className="dk-seo-gaps-phrase-imp dk-num">{plural(k.impressions, "impression")}</span> : null}
                </span>
              </span>
            ),
          },
          { key: "impressions", head: <span title="Search Console: how often Google showed the site for it in the period. Not a search volume.">Impressions</span>, numeric: true, width: "92px", cell: (k) => <Impressions n={k.impressions} position={k.position} />, sort: (k) => k.impressions },
          { key: "found", head: "Found in", width: "150px", cell: (k) => <Sources sources={k.sources} /> },
          { key: "intent", head: "Intent", width: "112px", cell: (k) => <IntentChip intent={k.intent} /> },
          { key: "action", head: "Action", width: "128px", align: "right", cell: (k) => <RowBrief k={k} label={kind === "partial" ? "Brief the page" : "Create brief"} /> },
        ]}
        empty={empty}
      />
      <Pager total={rows.total} offset={rows.offset} limit={rows.limit} href={(o) => hrefWith(here, { offset: o ? String(o) : null })} />
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
      <span className="dk-seo-gaps-quiet" title="Our estimate belongs to a gap's opportunity (SEO › Opportunities), and the engine holds none for this cluster.">
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

function Suggested({ rows, here }: { rows: Suggestion[]; here: Record<string, string> }) {
  if (!rows.length) return <p className="dk-seo-gaps-none">No page to make: every cluster of this group has a page of its language.</p>;
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
                {s.competitors.pages ? (
                  <span>
                    Competitor pages read: {num(s.competitors.pages)} · {num(s.competitors.german)} in German · {num(s.competitors.priced)} state a price
                  </span>
                ) : (
                  <span className="dk-seo-gaps-quiet">No competitor page read for it yet</span>
                )}
                <Estimate s={s} />
              </p>
              {c.examples.length ? <p className="dk-seo-gaps-suggest-examples">“{c.examples.slice(0, 3).join("”, “")}”</p> : null}
            </div>
            <div className="dk-seo-gaps-suggest-act">
              {c.brief.available ? (
                <BriefButton cluster={c.key} title={`The operator writes the brief for the page that answers “${c.name}”, from its missing phrases. A person writes and publishes the page.`} />
              ) : (
                <BriefMark brief={c.brief} />
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Competitors({ rows }: { rows: CompetitorPage[] }) {
  return (
    <Table
      caption="Competitor pages read for the group's searches"
      rows={rows}
      rowKey={(p) => p.url}
      minWidth={620}
      columns={[
        {
          key: "page",
          head: "Competitor page",
          cell: (p) => (
            <span className="dk-seo-gaps-phrase">
              <a className="dk-seo-gaps-phrase-text" href={p.url} target="_blank" rel="noreferrer" title={p.url}>
                {p.domain}
              </a>
              <span className="dk-seo-gaps-phrase-meta">
                <span className="dk-seo-gaps-phrase-cluster" title={p.title ?? undefined}>
                  {p.title ?? "No title read"}
                </span>
              </span>
            </span>
          ),
        },
        { key: "for", head: "Seen for", width: "160px", cell: (p) => <span className="dk-seo-gaps-cell-clip" title={p.query ?? undefined}>{p.query ?? (p.cluster ? bare(p.cluster.name) : DASH)}</span> },
        { key: "words", head: "Words", numeric: true, width: "70px", cell: (p) => <Words n={p.words} />, sort: (p) => p.words || null },
        { key: "lang", head: "Lang", width: "56px", cell: (p) => (p.lang ? <LangMark lang={p.lang} /> : DASH) },
        { key: "price", head: "Price", width: "70px", cell: (p) => (p.priceStated === null ? DASH : p.priceStated ? <Chip tone="warn">States one</Chip> : <span className="dk-seo-gaps-quiet">No</span>) },
        { key: "seen", head: <span title="How often the domain appeared in the captured results for these searches (Google, its local pack, AI answers).">Seen</span>, numeric: true, width: "60px", cell: (p) => num(p.seen), sort: (p) => p.seen },
      ]}
      empty="No competitor page has been read for this group's searches yet: the competitor job reads the pages the audit saw beside Balkaris, one request every two seconds per site."
    />
  );
}

