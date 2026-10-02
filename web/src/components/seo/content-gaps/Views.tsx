import type { Reading } from "@/contract/common";
import type { OwnerTaskRow } from "@/contract/seo/common";
import type { ClusterDetail, GapKeyword, GapQuery, SeoContentGapsPayload } from "@/contract/seo/content-gaps";
import { Chip } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Table } from "@/components/ui/Table";
import { cx } from "@/lib/cx";
import { DASH, fullDate, num } from "@/lib/format";
import { BriefButton, OwnerDone } from "./Act";
import { BriefMark, LangMark, PriorityMark, Words } from "./Bits";
import { PhraseTable } from "./Group";
import { bare, hrefWith, plural } from "./look";

/** Phrases of one cluster shown in its detail; Keywords has them all. */
const PHRASES = 20;

/** A row of filter chips as links. */
function Chips({ items, label }: { items: { label: string; href: string; on: boolean }[]; label: string }) {
  return (
    <nav className="dk-seo-gaps-chips" aria-label={label}>
      {items.map((i) => (
        <Go key={i.label} href={i.href} className={cx("dk-seo-gaps-list-filter", i.on && "dk-seo-gaps-list-filter--on")} scroll={false} replace>
          {i.label}
        </Go>
      ))}
    </nav>
  );
}

/** view=keywords: every relevant phrase no page of its language answers, filtered by language, price and question. */
export function KeywordView({ reading, asked, base, impressionsNote }: { reading: Reading<{ total: number; rows: GapKeyword[]; offset: number; limit: number }> | null; asked: GapQuery; base: Record<string, string>; impressionsNote: string }) {
  if (!reading) return null;
  const set = (change: Record<string, string | null>) => hrefWith(base, { ...change, offset: null });
  return (
    <Card
      className="dk-seo-gaps-wide"
      title="Phrases with no page of their language"
      icon="search"
      info="Relevant phrases of the keyword table that no page in their own language answers: in a gap cluster (no page at all) or in an answered cluster whose page does not carry their words. Ordered by Search Console impressions, then the cluster's priority and the audit's order, price and questions first."
      sub={reading.state === "ok" ? `${plural(reading.value.total, "phrase")} match` : undefined}
      flush
    >
      <div className="dk-seo-gaps-filters">
        <Chips
          label="Language"
          items={[
            { label: "All languages", href: set({ lang: null }), on: asked.lang === "all" },
            { label: "German", href: set({ lang: "de" }), on: asked.lang === "de" },
            { label: "English", href: set({ lang: "en" }), on: asked.lang === "en" },
          ]}
        />
        <Chips
          label="What they ask"
          items={[
            { label: "Price questions", href: set({ price: asked.price ? null : "1" }), on: asked.price },
            { label: "Questions", href: set({ question: asked.question ? null : "1" }), on: asked.question },
          ]}
        />
        <Chips
          label="Cluster"
          items={[
            { label: "Any cluster", href: set({ gap: null }), on: asked.gap === "all" },
            { label: "No page at all", href: set({ gap: "1" }), on: asked.gap === "1" },
            { label: "Page lacks the words", href: set({ gap: "0" }), on: asked.gap === "0" },
          ]}
        />
      </div>
      {reading.state !== "ok" ? (
        <div className="dk-seo-gaps-pad">
          <Absent reading={reading} />
        </div>
      ) : (
        <div className="dk-seo-gaps-wide-body">
          <PhraseTable rows={reading.value} here={base} kind="keywords" />
          <footer className="dk-seo-gaps-panel-foot">
            <span className="dk-seo-gaps-panel-note">{impressionsNote}</span>
            <Stamp reading={reading} />
          </footer>
        </div>
      )}
    </Card>
  );
}

/** view=competitors: the competitor pages the desk read, by the cluster they were seen for. */
export function CompetitorView({ reading }: { reading: SeoContentGapsPayload["competitors"] }) {
  if (!reading) return null;
  return (
    <Card
      className="dk-seo-gaps-wide"
      title="Who answers the searches the site does not"
      icon="target"
      info="Competitor pages the desk read (one request every two seconds per site, as BalkarisDesk/1.0) for the searches the audit captured in Google and the AI assistants: how long they are, in which language, whether they state a price, and how often their domain was seen for the cluster. No domain rating: no free source gives one."
      flush
    >
      {reading.state !== "ok" ? (
        <div className="dk-seo-gaps-pad">
          <Absent reading={reading} />
        </div>
      ) : (
        <div className="dk-seo-gaps-comp">
          {reading.value.rows.map((r) => (
            <section key={r.cluster.key} className="dk-seo-gaps-comp-block" aria-label={r.cluster.name}>
              <h3 className="dk-seo-gaps-comp-title">
                <Go href={`/seo/content-gaps?view=clusters&open=${encodeURIComponent(r.cluster.key)}`}>{bare(r.cluster.name)}</Go>
                <LangMark lang={r.cluster.key.endsWith(":de") ? "de" : r.cluster.key.endsWith(":en") ? "en" : null} />
                <span className="dk-seo-gaps-comp-n">
                  {plural(r.pages.length, "page")} · {num(r.pages.filter((p) => p.priceStated).length)} state a price · {num(r.pages.filter((p) => (p.lang ?? "").startsWith("de")).length)} in German
                </span>
              </h3>
              <Table
                caption={`Competitor pages for ${r.cluster.name}`}
                rows={r.pages}
                rowKey={(p) => p.url}
                minWidth={560}
                columns={[
                  {
                    key: "page",
                    head: "Page",
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
                  { key: "words", head: "Words", numeric: true, width: "72px", cell: (p) => <Words n={p.words} />, sort: (p) => p.words || null },
                  { key: "lang", head: "Lang", width: "60px", cell: (p) => (p.lang ? <LangMark lang={p.lang.toLowerCase().split("-")[0]!} /> : DASH) },
                  { key: "price", head: "Price", width: "96px", cell: (p) => (p.priceStated === null ? DASH : p.priceStated ? <Chip tone="warn">States one</Chip> : <span className="dk-seo-gaps-quiet">No</span>) },
                  { key: "seen", head: "Seen", numeric: true, width: "64px", cell: (p) => num(p.seen), sort: (p) => p.seen },
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
export function ClusterPanel({ reading, back }: { reading: Reading<ClusterDetail>; back: string }) {
  return (
    <section className="dk-card dk-seo-gaps-panel">
      <header className="dk-seo-gaps-panel-head">
        <div className="dk-seo-gaps-panel-titles">
          <Go href={back} className="dk-seo-gaps-back" scroll={false}>
            <Icon name="arrow-left" size={14} />
            Back to the group
          </Go>
          {reading.state === "ok" ? (
            <>
              <h2 className="dk-seo-gaps-panel-title">
                {bare(reading.value.cluster.name)}
                <LangMark lang={reading.value.cluster.lang} />
                <PriorityMark priority={reading.value.cluster.priority} />
              </h2>
              <p className="dk-seo-gaps-panel-sub">
                {reading.value.cluster.gap ? (reading.value.cluster.otherLanguage ? `Mapped to ${reading.value.cluster.page}, a page in another language: still a gap.` : "No page of its language answers it.") : `Answered by ${reading.value.cluster.page}.`}{" "}
                {num(reading.value.cluster.keywords.mapped)} of {plural(reading.value.cluster.keywords.relevant, "relevant phrase")} have a page of their language.
              </p>
            </>
          ) : null}
        </div>
        {reading.state === "ok" && reading.value.cluster.gap ? (
          reading.value.cluster.brief.available ? (
            <BriefButton cluster={reading.value.cluster.key} size="sm" title="The operator writes the brief for the page that answers this cluster, from its missing phrases. A person writes and publishes the page." under />
          ) : (
            <BriefMark brief={reading.value.cluster.brief} />
          )
        ) : null}
      </header>
      {reading.state !== "ok" ? (
        <div className="dk-seo-gaps-pad">
          <Absent reading={reading} />
        </div>
      ) : (
        (() => {
          const d = reading.value;
          const c = d.cluster;
          return (
            <div className="dk-seo-gaps-panel-body dk-seo-gaps-detail">
              {c.why || c.action ? (
                <dl className="dk-seo-gaps-said-list">
                  {c.why ? (
                    <>
                      <dt>Why, as the audit said</dt>
                      <dd>{c.why}</dd>
                    </>
                  ) : null}
                  {c.action ? (
                    <>
                      <dt>What to do, as the audit said</dt>
                      <dd>{c.action}</dd>
                    </>
                  ) : null}
                </dl>
              ) : null}
              <Table
                caption={`Phrases of ${c.name}`}
                rows={d.phrases.slice(0, PHRASES)}
                rowKey={(p) => p.id}
                minWidth={480}
                columns={[
                  { key: "phrase", head: "Phrase", cell: (p) => <span className="dk-seo-gaps-phrase-text" title={p.phrase}>{p.phrase}</span> },
                  { key: "status", head: "Judged", width: "88px", cell: (p) => <span className={cx(p.status !== "relevant" && "dk-seo-gaps-quiet")}>{p.status}</span> },
                  { key: "imp", head: "Impressions", numeric: true, width: "96px", cell: (p) => (p.impressions === null ? DASH : num(p.impressions)), sort: (p) => p.impressions },
                  { key: "page", head: "Page", width: "30%", cell: (p) => <span className="dk-seo-gaps-cell-clip">{p.page ?? DASH}</span> },
                ]}
                empty="No phrase is filed under this cluster."
              />
              {d.phrases.length > PHRASES ? (
                <p className="dk-seo-gaps-more">
                  {num(PHRASES)} of {num(d.phrases.length)} shown, most important first.{" "}
                  <Go href={`/seo/keywords?cluster=${encodeURIComponent(c.key)}`}>All of them in Keywords</Go>
                </p>
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
export function Lower({ needsYou, notes }: { needsYou: Reading<OwnerTaskRow[]>; notes: SeoContentGapsPayload["notes"] }) {
  return (
    <div className="dk-seo-gaps-lower">
      <Card title="Needs you" icon="user" tone="warn" info="Decisions and logins only the owner has: the desk cannot make them and does not pretend to. Mark one done here when it is." id="needs-you">
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
                  {t.done ? <p className="dk-seo-gaps-quiet">Done by {t.doneBy ?? "a person"}{t.doneAt ? ` on ${fullDate(t.doneAt)}` : ""}.</p> : null}
                </div>
                <OwnerDone task={t.id} done={t.done} />
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
