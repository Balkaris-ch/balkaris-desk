import type { KeywordRow, KeywordWindow, SeoKeywordsPayload } from "@/contract/seo/keywords";
import type { Reading } from "@/contract/common";
import { Spark } from "@/components/charts";
import { Chip } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { Select } from "@/components/ui/Select";
import { Stamp } from "@/components/ui/Stamp";
import { Table, type Column } from "@/components/ui/Table";
import { Tooltip } from "@/components/ui/Tooltip";
import { cx } from "@/lib/cx";
import { DASH, num, shortDate } from "@/lib/format";
import { BASE, clearedHref, exportHref, filtered, keptFields, keywordsHref, openHref, optimizeHref, oppsForPhrase, researchHref, type Place } from "./href";
import { BriefButton, KeywordMenu, KwBulk, KwBulkForm, KwBulkMenu, TrackPhrase } from "./KwAct";
import { AddMany, Topics } from "./KwWeb";
import { KwHead } from "./KwBar";
import { BAND_LABEL, BANDS, byWhom, FLAG_LABEL, INTENT_LABEL, INTENT_TONE, langLabel, pos, primaryOf, rateCell, SOURCE_LABEL, STATUS_LABEL, trendWeeks, volumeCell, webLang } from "./look";
import { Pager } from "./Pager";

const FIND = "dk-seo-kw-find";
const RESETS = ["offset"] as const;

const SORTS = [
  { value: "impressions", label: "By impressions" },
  { value: "position", label: "By position" },
  { value: "clicks", label: "By clicks" },
  { value: "ctr", label: "By CTR" },
  { value: "change", label: "By position change" },
  { value: "cluster", label: "By topic (audit's order)" },
  { value: "phrase", label: "By phrase" },
  { value: "first-seen", label: "Newest first" },
];

/* ---------- the quick filters in the head: two toggles, and clearing them all ---------------------- */

function QuickChips({ data, place }: { data: SeoKeywordsPayload; place: Place }) {
  const a = data.asked;
  const f = data.facets;
  const chip = (key: string, label: string, count: number, href: string, on: boolean, title?: string) => (
    <Go key={key} href={href} scroll={false} replace className={cx("dk-seo-kw-chip", on && "dk-seo-kw-chip--on")} aria-current={on ? "true" : undefined} title={title}>
      <span>{label}</span>
      <span className="dk-seo-kw-chip-n dk-num">{num(count)}</span>
    </Go>
  );
  return (
    <nav className="dk-seo-kw-chips" aria-label="Quick filters">
      {chip("shown", "Shown in Google", f.shown, keywordsHref(place, { shown: !a.shown }), a.shown, "Phrases Google showed the site for in the window (Search Console), among those the judgement filter lets through. The Ranking tile counts every judgement.")}
      {chip("target", "Targets", f.targets, keywordsHref(place, { target: !a.target }), a.target, "Phrases a person marked as a target.")}
      {filtered(a) ? (
        <Go href={clearedHref(place)} scroll={false} replace className="dk-seo-kw-reset">
          Clear filters
        </Go>
      ) : null}
    </nav>
  );
}

/* ---------- the filters' row (board: search, positions, pages, intent, sort) -------------------- */

function Filters({ data, place }: { data: SeoKeywordsPayload; place: Place }) {
  const a = data.asked;
  const f = data.facets;
  const statusTotal = f.statuses.reduce((n, s) => n + s.count, 0);
  return (
    <div className="dk-seo-kw-filters">
      <label className="dk-seo-kw-find">
        <Icon name="search" size={14} />
        <input form={FIND} type="search" name="q" defaultValue={a.q} placeholder="Search keywords…" aria-label="Search keywords by their words" maxLength={80} />
      </label>
      <Select
        param="lang"
        label="Language"
        fallback="all"
        resets={RESETS}
        options={[
          { value: "all", label: "All languages" },
          ...f.langs.filter((l) => ["de", "en", "fr", "it"].includes(l.key)).map((l) => ({ value: l.key, label: `${langLabel(l.key)} (${num(l.count)})` })),
          ...(a.lang !== "all" && !f.langs.some((l) => l.key === a.lang) ? [{ value: a.lang, label: `${langLabel(a.lang)} (0)` }] : []),
        ]}
      />
      <Select
        param="band"
        label="Position"
        fallback="all"
        resets={RESETS}
        options={[{ value: "all", label: "All positions" }, ...BANDS.map((b) => ({ value: b, label: `${BAND_LABEL[b]} (${num(f.bands.find((x) => x.key === b)?.count ?? 0)})` }))]}
      />
      <Select
        param="page"
        label="Page"
        fallback=""
        resets={RESETS}
        options={[
          { value: "", label: "All pages" },
          ...f.pages.map((p) => ({ value: p.path, label: p.path === "none" ? `No page: a gap (${num(p.count)})` : `${p.path} (${num(p.count)})` })),
          ...(a.page && !f.pages.some((p) => p.path === a.page) ? [{ value: a.page, label: `${a.page} (0)` }] : []),
        ]}
      />
      <Select
        param="intent"
        label="Intent"
        fallback="all"
        resets={RESETS}
        options={[
          { value: "all", label: "All intent" },
          ...f.intents.map((i) => ({ value: i.key, label: `${INTENT_LABEL[i.key]} (${num(i.count)})` })),
          ...(a.intent !== "all" && !f.intents.some((i) => i.key === a.intent) ? [{ value: a.intent, label: `${INTENT_LABEL[a.intent]} (0)` }] : []),
        ]}
      />
      <Select
        param="cluster"
        label="Topic"
        fallback=""
        resets={RESETS}
        options={[
          { value: "", label: "All topics" },
          { value: "none", label: "No topic" },
          ...f.clusters.map((c) => ({ value: c.key, label: `${c.name} (${num(c.count)})` })),
          ...(a.cluster && a.cluster !== "none" && !f.clusters.some((c) => c.key === a.cluster) ? [{ value: a.cluster, label: `${data.topics.find((t) => t.key === a.cluster)?.name ?? a.cluster} (0)` }] : []),
        ]}
      />
      <Select
        param="source"
        label="Where it came from"
        fallback="all"
        resets={RESETS}
        options={[
          { value: "all", label: "All sources" },
          ...f.sources.map((s) => ({ value: s.key, label: `${SOURCE_LABEL[s.key]} (${num(s.count)})` })),
          ...(a.source !== "all" && !f.sources.some((s) => s.key === a.source) ? [{ value: a.source, label: `${SOURCE_LABEL[a.source]} (0)` }] : []),
        ]}
      />
      <Select
        param="flag"
        label="What the phrase says (by its own words)"
        fallback=""
        resets={RESETS}
        options={[
          { value: "", label: "Any wording" },
          ...(["price", "question", "local"] as const).map((k) => ({ value: k, label: `${FLAG_LABEL[k]} (${num(f.flags[k])})` })),
        ]}
      />
      <Select
        param="status"
        label="Judged"
        fallback="default"
        resets={RESETS}
        options={[
          { value: "default", label: "Not irrelevant" },
          ...f.statuses.map((s) => ({ value: s.key, label: `${STATUS_LABEL[s.key]} (${num(s.count)})` })),
          ...(a.status !== "all" && a.status !== "default" && !f.statuses.some((s) => s.key === a.status) ? [{ value: a.status, label: `${STATUS_LABEL[a.status]} (0)` }] : []),
          { value: "all", label: `Every judgement (${num(statusTotal)})` },
        ]}
      />
      <Select
        param="where"
        label="Searches from"
        fallback="all"
        resets={RESETS}
        options={[
          { value: "all", label: "Every country" },
          { value: "che", label: "Switzerland only" },
        ]}
      />
      <Select
        param="device"
        label="Device"
        fallback="all"
        resets={RESETS}
        options={[
          { value: "all", label: "Every device" },
          { value: "desktop", label: "Desktop" },
          { value: "mobile", label: "Mobile" },
          { value: "tablet", label: "Tablet" },
        ]}
      />
      <span className="dk-seo-kw-sort">
        <Select param="sort" label="Order" fallback="impressions" resets={["offset", "dir"]} options={SORTS} />
        <Go
          href={keywordsHref(place, { dir: a.dir === "asc" ? "desc" : "asc" })}
          scroll={false}
          replace
          className="dk-seo-kw-dir"
          aria-label={a.dir === "asc" ? "Ascending: turn to descending" : "Descending: turn to ascending"}
          title={a.dir === "asc" ? "Ascending: turn to descending" : "Descending: turn to ascending"}
        >
          <Icon name={a.dir === "asc" ? "arrow-up" : "arrow-down"} size={14} />
        </Go>
      </span>
    </div>
  );
}

/* ---------- the cells -------------------------------------------------------------------------- */

function Phrase({ r, place }: { r: KeywordRow; place: Place }) {
  return (
    <span className="dk-seo-kw-phrase">
      <span className="dk-seo-kw-phrase-top">
        {r.target ? (
          <span className="dk-seo-kw-target" title={`A target: marked by ${r.target.by}, ${shortDate(r.target.at)}`} role="img" aria-label="A target">
            <Icon name="target" size={13} />
          </span>
        ) : null}
        <Go href={openHref(place, r.id)} scroll={false} className="dk-seo-kw-phrase-text" title={`${r.phrase}: open its own view`} aria-current={place.asked.open === r.id ? "true" : undefined}>
          {r.phrase}
        </Go>
      </span>
      <span className="dk-seo-kw-phrase-sub">
        {r.cluster ? (
          <Go href={keywordsHref(place, { cluster: r.cluster.key })} scroll={false} replace className="dk-seo-kw-topic" title={`Only the topic “${r.cluster.name}”`}>
            {r.cluster.name}
          </Go>
        ) : (
          <span className="dk-seo-kw-topic dk-seo-kw-topic--none">No topic</span>
        )}
        <span className="dk-seo-kw-lang" title={langLabel(r.lang)}>
          {r.lang ? r.lang.toUpperCase() : "?"}
        </span>
        {r.flags.price ? <span className="dk-seo-kw-flag">price</span> : null}
        {r.flags.question ? <span className="dk-seo-kw-flag">question</span> : null}
        {r.brief ? (
          <span className="dk-seo-kw-flag" title={`Operator task #${r.brief.task}, asked ${shortDate(r.brief.at)}`}>
            brief {r.brief.state === "done" ? "ready" : r.brief.state === "queued" || r.brief.state === "running" ? "on its way" : r.brief.state}
          </span>
        ) : null}
        {r.status !== "relevant" ? (
          <span className={cx("dk-seo-kw-flag", r.status === "irrelevant" && "dk-seo-kw-flag--off")} title={`Judged by ${byWhom(r.statusBy)}`}>
            {STATUS_LABEL[r.status].toLowerCase()}
          </span>
        ) : null}
      </span>
    </span>
  );
}

function Position({ r, compared, win }: { r: KeywordRow; compared: boolean; win: string }) {
  if (r.position === null) {
    return (
      <span className="dk-seo-kw-none" title={`Google did not show the site for it, ${win}.`}>
        {DASH}
      </span>
    );
  }
  let moved = null;
  if (compared) {
    if (r.previousPosition === null) {
      moved = (
        <span className="dk-seo-kw-moved dk-seo-kw-moved--new" title="Search Console reported no impression for it in the window before. Google withholds rare queries, so a rare one may have been shown then unreported.">
          new
        </span>
      );
    } else {
      const d = Math.round((r.previousPosition - r.position) * 10) / 10;
      moved =
        Math.abs(d) < 0.1 ? null : (
          <span className={cx("dk-seo-kw-moved", d > 0 ? "dk-seo-kw-moved--up" : "dk-seo-kw-moved--down")} title={`Average position ${num(r.previousPosition, 1)} in the window before`}>
            <Icon name={d > 0 ? "arrow-up" : "arrow-down"} size={11} />
            {num(Math.abs(d), 1)}
          </span>
        );
    }
  }
  return (
    <span className="dk-seo-kw-pos" title={`Google's average position, ${win}, weighted by impressions`}>
      <span className="dk-num">{pos(r.position)}</span>
      {moved}
    </span>
  );
}

function Trend({ r }: { r: KeywordRow }) {
  const seen = r.trend.filter((p) => p !== null).length;
  if (!seen) return <span className="dk-seo-kw-none">{DASH}</span>;
  return (
    <Tooltip text={`Average position week by week, on the ${seen} day${seen === 1 ? "" : "s"} of the window Google showed it; a week it never showed it is a gap. A higher line is a better position.`}>
      <span className="dk-seo-kw-trend" tabIndex={0}>
        <Spark data={trendWeeks(r.trend)} size="row" label={`Weekly average position of “${r.phrase}”`} />
      </span>
    </Tooltip>
  );
}

function PageCell({ r }: { r: KeywordRow }) {
  const by = r.mappedBy === "audit" ? "by the audit" : r.mappedBy === "rule" ? "by the desk's rule" : r.mappedBy === "person" ? "by a person" : null;
  const other = r.shownPage && r.shownPage !== r.page ? r.shownPage : null;
  return (
    <span className="dk-seo-kw-page">
      {r.page ? (
        r.pageKnown ? (
          <Go href={optimizeHref(r.page)} className="dk-seo-kw-path" title={`${r.pageTitle ? `${r.pageTitle} · ` : ""}${r.page}: open Page Optimization. Mapped ${by ?? ""}.`}>
            {r.page}
          </Go>
        ) : (
          <span className="dk-seo-kw-path dk-seo-kw-path--gone" title={`Mapped ${by ?? ""}, but the crawl reads no page at ${r.page}.`}>
            {r.page}
          </span>
        )
      ) : (
        <span className="dk-seo-kw-gap" title={r.mappedBy === "person" ? "A person said no page answers it." : "No page of the site answers it yet: a gap."}>
          No page
        </span>
      )}
      {other ? (
        <span className="dk-seo-kw-page-sub" title="The page Google showed most for it in the window">
          Google showed {other}
        </span>
      ) : r.page && !r.pageKnown ? (
        <span className="dk-seo-kw-page-sub">not on the crawl</span>
      ) : null}
    </span>
  );
}

function Action({ r, place }: { r: KeywordRow; place: Place }) {
  const p = primaryOf(r);
  return (
    <span className="dk-seo-kw-actions">
      {p === "brief" ? (
        <BriefButton
          url={`/api/v1/seo/keywords/${r.id}/brief`}
          label="Create brief"
          variant="quiet"
          className="dk-seo-kw-btn-warn"
          title="No page answers it: the operator (the studio workstation's model) writes a brief for one. A person writes and publishes; nothing reaches the site by itself."
        />
      ) : (
        <LinkButton
          href={optimizeHref(r.page!)}
          size="xs"
          variant={p === "optimize" ? "good" : "quiet"}
          title={p === "optimize" ? `Open Page Optimization for ${r.page}: its title, content and links for this search.` : `Already in the top 3: open ${r.page} in Page Optimization.`}
        >
          {p === "optimize" ? "Optimize" : "View"}
        </LinkButton>
      )}
      <KeywordMenu
        id={r.id}
        phrase={r.phrase}
        lang={r.lang}
        target={!!r.target}
        status={r.status}
        page={r.page}
        opportunities={r.opportunities}
        oppsHref={oppsForPhrase(r.phrase)}
        mappedByPerson={r.mappedBy === "person"}
        removable={r.removable}
        briefBusy={r.brief && (r.brief.state === "queued" || r.brief.state === "running") ? r.brief.task : null}
        hrefs={{ open: openHref(place, r.id), research: researchHref(place, r.phrase, webLang(r.lang)) }}
      />
    </span>
  );
}

function columns(place: Place, search: Reading<KeywordWindow>, rows: KeywordRow[]): Column<KeywordRow>[] {
  /* Demand columns only when a row of this page has a number: never a column of dashes standing for "not available". */
  const vol = rows.some((r) => r.volume && (r.volume.volume !== null || r.volume.low !== null));
  const diff = rows.some((r) => r.volume?.difficulty);
  const comp = rows.some((r) => r.kept);
  /* The "new" mark and the arrows only when the window before was compared query by query: never against a window whose queries Google withheld. */
  const compared = search.state === "ok" && search.value.queriesCompared;
  const win = search.state === "ok" ? `${shortDate(search.value.start)} – ${shortDate(search.value.end)}` : "in the window";
  return [
    { key: "phrase", head: "Keyword", cell: (r) => <Phrase r={r} place={place} /> },
    { key: "position", head: "Position", numeric: true, cell: (r) => <Position r={r} compared={compared} win={win} /> },
    {
      key: "impressions",
      head: (
        <span title="Impressions in Google Search for the site (Search Console), where the board has search volume: no free source gives volume.">Impressions</span>
      ),
      numeric: true,
      cell: (r) => (r.impressions === null ? <span className="dk-seo-kw-none">{DASH}</span> : num(r.impressions)),
    },
    { key: "clicks", head: "Clicks", numeric: true, cell: (r) => (r.clicks === null ? <span className="dk-seo-kw-none">{DASH}</span> : num(r.clicks)) },
    {
      key: "ctr",
      head: "CTR",
      numeric: true,
      cell: (r) => (r.ctr ? <span title={`${num(r.ctr.num)} clicks of ${num(r.ctr.den)} impressions`}>{rateCell(r.ctr)}</span> : <span className="dk-seo-kw-none">{DASH}</span>),
    },
    ...(vol
      ? [
          {
            key: "volume",
            head: <span title="Average monthly searches in Google, where somebody gave a number: a Keyword Planner export or DataForSEO. Each cell names its source.">Searches / month</span>,
            numeric: true,
            cell: (r: KeywordRow) => volumeCell(r.volume),
          } as Column<KeywordRow>,
        ]
      : []),
    ...(diff
      ? [
          {
            key: "difficulty",
            head: <span title="DataForSEO Labs' keyword difficulty, 0 to 100, where one was bought.">Difficulty</span>,
            numeric: true,
            cell: (r: KeywordRow) =>
              r.volume?.difficulty ? <span title={`DataForSEO, ${shortDate(r.volume.difficulty.at)}`}>{num(r.volume.difficulty.value)}</span> : <span className="dk-seo-kw-none">{DASH}</span>,
          } as Column<KeywordRow>,
        ]
      : []),
    ...(comp
      ? [
          {
            key: "competition",
            head: <span title="The desk's own reading of the newest Google result page it kept: ads and a map pack above the results make a harder page. Not a vendor's score.">Competition</span>,
            cell: (r: KeywordRow) => (r.kept ? <span title={r.kept.line}>{r.kept.competition}</span> : <span className="dk-seo-kw-none">{DASH}</span>),
          } as Column<KeywordRow>,
        ]
      : []),
    { key: "trend", head: "Trend", cell: (r) => <Trend r={r} /> },
    { key: "intent", head: "Intent", cell: (r) => (r.intent ? <Chip tone={INTENT_TONE[r.intent]}>{INTENT_LABEL[r.intent]}</Chip> : <span className="dk-seo-kw-none">{DASH}</span>) },
    { key: "page", head: "Page", cell: (r) => <PageCell r={r} /> },
    { key: "action", head: "Action", align: "right", cell: (r) => <Action r={r} place={place} /> },
  ];
}

/** What the search columns are, for the table's foot. */
function basisLine(search: Reading<KeywordWindow>, a: SeoKeywordsPayload["asked"]): string {
  if (search.state !== "ok") return "Search figures are not available: see the tiles above.";
  const w = search.value;
  const compare = w.queriesCompared && w.previousStart
    ? `; the arrows compare with ${shortDate(w.previousStart)} – ${shortDate(w.previousEnd!)}`
    : w.notCompared
      ? `; no arrows: ${w.notCompared.replace(/\.$/, "")}`
      : "";
  const scope = `${a.where === "che" ? "searches from Switzerland" : "all countries"}, ${a.device === "all" ? "every device" : `${a.device} only`}`;
  return `Position, impressions, clicks and CTR: Google Search, ${scope}, ${shortDate(w.start)} – ${shortDate(w.end)}, from the desk's own daily copy of Search Console, for the queries Google reports (the property had ${num(w.impressions)} impressions in all; rare queries are withheld)${compare}. Search volume is shown only where somebody gave a number (the owner's Keyword Planner import, or DataForSEO once connected), with its source.`;
}

/**
 * The board's keyword table: every phrase of the keyword store with what
 * Google shows for it, its intent, the page that answers it, and what to do.
 * Filters, order and the page of the list live in the address; the boxes
 * feed "Bulk actions".
 */
export function KwList({ data, place }: { data: SeoKeywordsPayload; place: Place }) {
  const list = data.list;
  const total = list.state === "ok" ? list.value.total : 0;
  const exp = exportHref(place);
  return (
    <>
      {/* The search box's own form, outside the list's form: forms do not nest. Its field is in the filters (form="…"). */}
      <form id={FIND} method="get" action={BASE} hidden>
        {keptFields(place, ["q"]).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
      </form>
      <KwBulk exportBase={exp}>
        <Card
          className="dk-seo-kw-list"
          flush
          footer={
            <div className="dk-seo-kw-foot">
              <Pager place={place} total={total} noun={{ one: "keyword", many: "keywords" }} />
              <p className="dk-seo-kw-basis">{basisLine(data.search, data.asked)}</p>
              {list.state === "ok" ? <Stamp reading={list} /> : null}
            </div>
          }
        >
          <KwHead
            data={data}
            place={place}
            title={`All keywords${list.state === "ok" ? ` (${num(total)})` : ""}`}
            info="Every phrase of the keyword store: Search Console's queries, research of Google's and Bing's suggestions, the SEO audit's table and the phrases people track. A phrase's page is the audit's, the desk's rule's or a person's mapping; a person's is never changed by a run. Impressions stand where the board has search volume: no free source gives volume. A target, a page mapping and a judgement are the desk's own records; nothing here changes the website."
            middle={<QuickChips data={data} place={place} />}
            actions={
              <>
                <TrackPhrase />
                <AddMany />
                <Topics />
                <KwBulkMenu />
                <LinkButton href={exp} icon="download" size="sm" title="Download the list as filtered, every matching row, as CSV">
                  Export
                </LinkButton>
              </>
            }
          />
          <Filters data={data} place={place} />
          <KwBulkForm className="dk-seo-kw-listform">
            {list.state === "ok" ? (
              <Table
                caption="Keywords"
                className="dk-seo-kw-table"
                rows={list.value.rows}
                rowKey={(r) => r.id}
                select={{ name: "ids", label: (r) => r.phrase }}
                density="roomy"
                minWidth={940}
                empty={filtered(data.asked) ? "No keyword matches these filters." : "The keyword table is empty."}
                columns={columns(place, data.search, list.value.rows)}
              />
            ) : (
              <Absent reading={list} className="dk-seo-kw-absent" />
            )}
          </KwBulkForm>
        </Card>
      </KwBulk>
    </>
  );
}
