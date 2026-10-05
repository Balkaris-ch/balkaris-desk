import type { KeywordClusterRow, SeoKeywordsPayload } from "@/contract/seo/keywords";
import { Chip } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { Select } from "@/components/ui/Select";
import { Stamp } from "@/components/ui/Stamp";
import { Table, type Column } from "@/components/ui/Table";
import { cx } from "@/lib/cx";
import { DASH, num, shortDate } from "@/lib/format";
import { LinkButton } from "@/components/ui/Button";
import { BASE, clustersCsvHref, keptFields, keywordsHref, oppsForCluster, optimizeHref, type Place } from "./href";
import { BriefButton, ClusterMenu, TrackPhrase } from "./KwAct";
import { Topics } from "./KwWeb";
import { KwHead } from "./KwBar";
import { Pager } from "./Pager";
import { INTENT_LABEL, INTENT_TONE, langLabel, pos, PRIORITY_LABEL, PRIORITY_TONE } from "./look";

const FIND = "dk-seo-kw-cfind";

const ORDERS = [
  { value: "rank", label: "The audit's order" },
  { value: "impressions", label: "Most impressions" },
  { value: "relevant", label: "Most relevant phrases" },
  { value: "opportunities", label: "Most opportunities" },
];

function Topic({ c }: { c: KeywordClusterRow }) {
  return (
    <span className="dk-seo-kw-cl">
      <span className="dk-seo-kw-cl-top">
        {c.rank !== null ? (
          <span className="dk-seo-kw-cl-rank dk-num" title="The SEO audit's order of attack">
            #{c.rank}
          </span>
        ) : null}
        <span className="dk-seo-kw-cl-name" title={c.why ?? c.name}>
          {c.name}
        </span>
      </span>
      <span className="dk-seo-kw-phrase-sub">
        <span className="dk-seo-kw-lang" title={langLabel(c.lang)}>
          {c.lang.toUpperCase()}
        </span>
        <Chip tone={PRIORITY_TONE[c.priority]}>{PRIORITY_LABEL[c.priority]}</Chip>
        {c.flags.price ? <span className="dk-seo-kw-flag">{num(c.flags.price)} ask a price</span> : null}
        {c.targets ? (
          <span className="dk-seo-kw-flag dk-seo-kw-flag--on">
            {num(c.targets)} target{c.targets === 1 ? "" : "s"}
          </span>
        ) : null}
      </span>
      {c.top.length ? (
        <span className="dk-seo-kw-cl-top-phrases" title={c.top.join("\n")}>
          {c.top.slice(0, 3).join(" · ")}
        </span>
      ) : null}
    </span>
  );
}

function ClusterPage({ c }: { c: KeywordClusterRow }) {
  const said = c.pageSaid ? `The audit: ${c.pageSaid}.` : "";
  if (!c.page) {
    return (
      <span className="dk-seo-kw-page">
        <span className="dk-seo-kw-gap" title={`No ${langLabel(c.lang)} page answers it. ${said}`}>
          Gap: no page
        </span>
      </span>
    );
  }
  return (
    <span className="dk-seo-kw-page">
      <Go href={optimizeHref(c.page)} className="dk-seo-kw-path" title={`${c.pageTitle ? `${c.pageTitle} · ` : ""}${c.page}: open Page Optimization. ${said}`}>
        {c.page}
      </Go>
      {c.gap ? (
        <span className="dk-seo-kw-page-sub dk-seo-kw-page-sub--warn" title={`The page is not ${langLabel(c.lang)}: a ${langLabel(c.lang)} page is still missing. ${said}`}>
          Gap: no {langLabel(c.lang)} page
        </span>
      ) : c.mappedBy ? (
        <span className="dk-seo-kw-page-sub">{c.mappedBy === "audit" ? "by the audit" : c.mappedBy === "rule" ? "by the desk's rule" : "by a person"}</span>
      ) : null}
    </span>
  );
}

function columns(place: Place): Column<KeywordClusterRow>[] {
  return [
    { key: "topic", head: "Topic", cell: (c) => <Topic c={c} /> },
    { key: "intent", head: "Intent", cell: (c) => (c.intent ? <Chip tone={INTENT_TONE[c.intent]}>{INTENT_LABEL[c.intent]}</Chip> : <span className="dk-seo-kw-none">{DASH}</span>) },
    {
      key: "phrases",
      head: <span title="Phrases judged relevant, of all the topic's phrases">Phrases</span>,
      numeric: true,
      cell: (c) => (
        <Go href={keywordsHref(place, { view: "keywords", cluster: c.key, lang: "all", intent: "all", q: "" })} className="dk-seo-kw-cl-n" title="See its phrases">
          {num(c.relevant)} <span className="dk-seo-kw-of">of {num(c.phrases)}</span>
        </Go>
      ),
    },
    { key: "shown", head: <span title="Its phrases Google showed the site for in the window (Search Console)">Shown</span>, numeric: true, cell: (c) => (c.shown ? num(c.shown) : <span className="dk-seo-kw-none">0</span>) },
    { key: "impressions", head: <span title="Search Console impressions of its phrases together, in the window. Not search volume.">Impressions</span>, numeric: true, cell: (c) => (c.impressions ? num(c.impressions) : <span className="dk-seo-kw-none">0</span>) },
    { key: "best", head: <span title="The best average position among its phrases in the window">Best pos.</span>, numeric: true, cell: (c) => <span className={cx(c.bestPosition === null && "dk-seo-kw-none")}>{pos(c.bestPosition)}</span> },
    { key: "page", head: "Page", cell: (c) => <ClusterPage c={c} /> },
    {
      key: "opps",
      head: <span title="Open opportunities the engine found for the topic">Opps</span>,
      numeric: true,
      cell: (c) =>
        c.opportunities ? (
          <Go href={oppsForCluster(c.key)} className="dk-seo-kw-cl-n">
            {num(c.opportunities)}
          </Go>
        ) : (
          <span className="dk-seo-kw-none">0</span>
        ),
    },
    {
      key: "action",
      head: "Action",
      align: "right",
      cell: (c) => (
        <span className="dk-seo-kw-actions">
          <BriefButton
            url={`/api/v1/seo/keywords/clusters/${encodeURIComponent(c.key)}/brief`}
            label={c.gap ? "Create brief" : "Brief"}
            className={c.gap ? "dk-seo-kw-btn-warn" : undefined}
            title={`The operator (the studio workstation's model) writes a brief for a ${langLabel(c.lang)} page answering this topic's searches. A person writes and publishes; nothing reaches the site by itself.`}
          />
          <ClusterMenu
            clusterKey={c.key}
            name={c.name}
            lang={c.lang}
            page={c.page}
            mappedByPerson={c.mappedBy === "person"}
            phrasesHref={keywordsHref(place, { view: "keywords", cluster: c.key, lang: "all", intent: "all", q: "" })}
            opportunities={c.opportunities}
            oppsHref={oppsForCluster(c.key)}
          />
        </span>
      ),
    },
  ];
}

/**
 * The second mode: the topic clusters the phrases form, in the audit's order
 * of attack, each with what Google shows for its phrases, the page that
 * answers it or the gap, and a brief for it. A German topic is a gap while
 * the site is English only.
 */
export function KwClusters({ data, place }: { data: SeoKeywordsPayload; place: Place }) {
  const r = data.clusters;
  const a = data.asked;
  return (
    <>
      <form id={FIND} method="get" action={BASE} hidden>
        {keptFields(place, ["q"]).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
      </form>
      <Card
        className="dk-seo-kw-list"
        flush
        footer={
          <div className="dk-seo-kw-foot">
            {r?.state === "ok" ? <Pager place={place} total={r.value.total} noun={{ one: "topic", many: "topics" }} /> : null}
            <p className="dk-seo-kw-basis">
              {data.search.state === "ok"
                ? `Shown, impressions and best position: Google Search, all countries, ${shortDate(data.search.value.start)} – ${shortDate(data.search.value.end)}, from the desk's own daily copy of Search Console. Not search volume: no free source gives it.`
                : "Search figures are not available: see the tiles above."}
            </p>
            {r?.state === "ok" ? <Stamp reading={r} /> : null}
          </div>
        }
      >
        <KwHead
          data={data}
          place={place}
          title={`Topic clusters${r?.state === "ok" ? ` (${num(r.value.total)})` : ""}`}
          info="The topics the SEO audit grouped the searches into, one per language, with its priority and order of attack. A topic with no page of its language is a gap: every German topic while the site is English only. Mapping a topic to a page is kept as a person's choice. Impressions are Search Console's for the site, not search volume: no free source gives volume."
          middle={
            <>
              {r?.state === "ok" && r.value.total ? (
                <span className="dk-seo-kw-head-line">
                  {num(r.value.gaps)} of {num(r.value.total)} {r.value.total === 1 ? "has" : "have"} no page of {r.value.total === 1 ? "its" : "their"} language
                </span>
              ) : null}
              {a.q || a.lang !== "all" || a.intent !== "all" ? (
                <Go href={keywordsHref(place, { q: "", lang: "all", intent: "all" })} scroll={false} replace className="dk-seo-kw-reset">
                  Clear filters
                </Go>
              ) : null}
            </>
          }
          actions={
            <>
              <TrackPhrase />
              <Topics />
              <LinkButton href={clustersCsvHref(place)} icon="download" size="sm" title="Download the topics as filtered, every matching one, as CSV">
                Export
              </LinkButton>
            </>
          }
        />
        <div className="dk-seo-kw-filters dk-seo-kw-filters--clusters">
          <label className="dk-seo-kw-find">
            <Icon name="search" size={14} />
            <input form={FIND} type="search" name="q" defaultValue={a.q} placeholder="Search topics and their phrases…" aria-label="Search topics" maxLength={80} />
          </label>
          <Select
            param="lang"
            label="Language"
            fallback="all"
            resets={["offset"]}
            options={[
              { value: "all", label: "All languages" },
              { value: "de", label: "German" },
              { value: "en", label: "English" },
              { value: "fr", label: "French" },
              { value: "it", label: "Italian" },
            ]}
          />
          <Select
            param="intent"
            label="Intent"
            fallback="all"
            resets={["offset"]}
            options={[{ value: "all", label: "All intent" }, ...(Object.keys(INTENT_LABEL) as (keyof typeof INTENT_LABEL)[]).map((k) => ({ value: k, label: INTENT_LABEL[k] }))]}
          />
          <Select param="corder" label="Order" fallback="rank" resets={["offset"]} options={ORDERS} />
        </div>
        {!r ? null : r.state === "ok" ? (
          <Table
            caption="Topic clusters"
            className="dk-seo-kw-table"
            rows={r.value.rows}
            rowKey={(c) => c.key}
            density="roomy"
            minWidth={940}
            empty={a.q || a.lang !== "all" || a.intent !== "all" ? "No topic matches these filters." : "No topic cluster is known yet: they come from the SEO audit's table."}
            columns={columns(place)}
          />
        ) : (
          <Absent reading={r} className="dk-seo-kw-absent" />
        )}
      </Card>
    </>
  );
}
