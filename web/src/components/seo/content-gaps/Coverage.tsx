import type { Reading } from "@/contract/common";
import type { Priority } from "@/contract/seo/common";
import type { GapGroup, GapQuery, GapView } from "@/contract/seo/content-gaps";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Absent } from "@/components/ui/Read";
import { cx } from "@/lib/cx";
import { num } from "@/lib/format";
import { Found, LangMark } from "./Bits";
import { bare, coverText, coverTone, exportHref, FIND, FIND_HINT, hrefWith, LIST_HEAD, plural, PRIORITY_WORD, VIEW_ICON } from "./look";

/**
 * The view switch (board 113: "By industry · By topic · By keyword · By
 * competitor", with by language, by cluster and from Search Console added),
 * the search beside it, and the coverage list on the left: each group's
 * answered phrases of its relevant phrases, as a bar, gaps first. Every row
 * is a link that opens the group beside it.
 */
export function ViewSwitch({ views, active, base }: { views: { key: GapView; label: string; count: number | null }[]; active: GapView; base: Record<string, string> }) {
  return (
    <nav className="dk-seo-gaps-switch" aria-label="Group the gaps">
      {views.map((v) => {
        const on = v.key === active;
        return (
          <Go
            key={v.key}
            /* The search goes with the reader to the next view; the filters and the order belong to this one. */
            href={hrefWith(base, { view: v.key === "topic" ? null : v.key, open: null, tab: null, offset: null, cluster: null, lang: null, price: null, question: null, gap: null, priority: null, sort: null, dir: null })}
            className={cx("dk-seo-gaps-switch-item", on && "dk-seo-gaps-switch-item--on")}
            aria-current={on ? "page" : undefined}
            title={v.key === "competitors" ? "Competitor sites the desk read a page of" : v.key === "console" ? "Searches Google already shows the site for that no page carries" : undefined}
            scroll={false}
          >
            <Icon name={VIEW_ICON[v.key]} size={15} />
            <span>{v.label}</span>
            {v.count !== null ? <span className="dk-seo-gaps-switch-count dk-num">{num(v.count)}</span> : null}
          </Go>
        );
      })}
    </nav>
  );
}

/**
 * The search box. Its field belongs to the page's hidden GET form (page.tsx),
 * which carries the view and its filters, so Enter reloads the page with ?q=
 * and the server narrows every table of the view: a search is part of the
 * address like every other filter here.
 */
export function Find({ view, q }: { view: GapView; q: string }) {
  return (
    <label className="dk-seo-gaps-find">
      <Icon name="search" size={14} />
      {/* Keyed by the search: a link that changes it ("Show all", another view) is a client navigation, and an uncontrolled field would keep the old words. */}
      <input key={`${view}:${q}`} form={FIND} type="search" name="q" defaultValue={q} placeholder={FIND_HINT[view]} aria-label={FIND_HINT[view].replace(/…$/, "")} maxLength={80} />
    </label>
  );
}

const GAP_FILTERS: { key: GapQuery["gap"]; label: string; title: string }[] = [
  { key: "all", label: "All", title: "Every group with a relevant phrase" },
  { key: "1", label: "Not fully answered", title: "Groups where at least one relevant phrase has no page of its language" },
  { key: "0", label: "Fully answered", title: "Groups where every relevant phrase has a page of its language" },
];

const PRIORITIES: (Priority | "all")[] = ["all", "high", "medium", "low"];

export function CoverageList({ reading, view, open, asked, base }: { reading: Reading<{ rows: GapGroup[]; of: number }>; view: GapView; open: string | null; asked: GapQuery; base: Record<string, string> }) {
  const shown = reading.state === "ok" ? reading.value.rows.length : 0;
  const of = reading.state === "ok" ? reading.value.of : 0;
  const narrowed = asked.q || asked.gap !== "all" || asked.priority !== "all" || asked.lang !== "all";
  return (
    <section className="dk-card dk-seo-gaps-list" aria-label={LIST_HEAD[view] ?? "Coverage"}>
      <header className="dk-seo-gaps-list-head">
        <h2 className="dk-seo-gaps-list-title">
          {LIST_HEAD[view] ?? "Coverage"}
          {reading.state === "ok" && narrowed ? <span className="dk-seo-gaps-list-count dk-num"> {num(shown)} of {num(of)}</span> : null}
        </h2>
        <a className="dk-seo-gaps-export" href={exportHref(base, { table: "groups", open: null, tab: null })} title="This list as a CSV file, the same search and filters" download>
          <Icon name="download" size={13} />
          CSV
        </a>
        <nav className="dk-seo-gaps-list-filters" aria-label="Show">
          {GAP_FILTERS.map((f) => (
            <Go
              key={f.key}
              href={hrefWith(base, { gap: f.key === "all" ? null : f.key, open: null, offset: null, tab: null })}
              className={cx("dk-seo-gaps-list-filter", asked.gap === f.key && "dk-seo-gaps-list-filter--on")}
              title={f.title}
              scroll={false}
              replace
            >
              {f.label}
            </Go>
          ))}
        </nav>
        {/* The audit's judgement of whether a young site can win the group, or a person's; By language holds every priority in one group. */}
        {view !== "language" ? (
          <nav className="dk-seo-gaps-list-filters" aria-label="Priority">
            {PRIORITIES.map((p) => (
              <Go
                key={p}
                href={hrefWith(base, { priority: p === "all" ? null : p, open: null, offset: null, tab: null })}
                className={cx("dk-seo-gaps-list-filter", asked.priority === p && "dk-seo-gaps-list-filter--on")}
                title={p === "all" ? "Every priority" : `${PRIORITY_WORD[p]} priority: the audit's judgement, or a person's`}
                scroll={false}
                replace
              >
                {p === "all" ? "Any priority" : PRIORITY_WORD[p]}
              </Go>
            ))}
          </nav>
        ) : null}
        {view === "clusters" ? (
          <nav className="dk-seo-gaps-list-filters" aria-label="Language">
            {(["all", "de", "en"] as const).map((l) => (
              <Go
                key={l}
                href={hrefWith(base, { lang: l === "all" ? null : l, open: null, offset: null, tab: null })}
                className={cx("dk-seo-gaps-list-filter", asked.lang === l && "dk-seo-gaps-list-filter--on")}
                scroll={false}
                replace
              >
                {l === "all" ? "Both languages" : l === "de" ? "German" : "English"}
              </Go>
            ))}
          </nav>
        ) : null}
      </header>
      <Found q={asked.q} base={base} what={view === "language" ? "languages with phrases" : "groups named so or holding phrases"} />
      {reading.state !== "ok" ? (
        <div className="dk-seo-gaps-pad">
          <Absent reading={reading} />
        </div>
      ) : !reading.value.rows.length ? (
        <p className="dk-seo-gaps-none">
          {asked.q
            ? `No group of this view is named so or holds a phrase carrying “${asked.q}”.`
            : asked.gap === "0"
              ? "No group is answered whole yet."
              : asked.gap === "1"
                ? "Every group is answered."
                : narrowed
                  ? "No group matches these filters."
                  : "Nothing in this view yet."}
        </p>
      ) : (
        <ol className="dk-seo-gaps-list-rows">
          {reading.value.rows.map((g, i) => {
            const on = open ? g.key === open : i === 0;
            const t = coverText(g.coverage.covered, g.coverage.of);
            return (
              <li key={g.key}>
                <Go
                  href={hrefWith(base, { open: g.key, offset: null, cluster: null })}
                  className={cx("dk-seo-gaps-group", on && "dk-seo-gaps-group--on")}
                  aria-current={on ? "true" : undefined}
                  scroll={false}
                >
                  <span className="dk-seo-gaps-group-top">
                    <span className="dk-seo-gaps-group-name" title={g.name}>
                      {bare(g.name)}
                    </span>
                    <span className="dk-seo-gaps-group-langs">
                      {g.langs.map((l) => (
                        <span key={l.cluster} className={cx("dk-seo-gaps-group-lang", l.gap ? "dk-seo-gaps-group-lang--gap" : "dk-seo-gaps-group-lang--ok")} title={l.gap ? `${l.lang.toUpperCase()}: no page of its language` : `${l.lang.toUpperCase()}: ${l.page ?? "answered"}`}>
                          <LangMark lang={l.lang} />
                          <Icon name={l.gap ? "x" : "check"} size={11} />
                        </span>
                      ))}
                    </span>
                    <span className="dk-seo-gaps-group-figure">
                      {t.share ? <b className="dk-num">{t.share}</b> : null}
                      <span className="dk-num">{t.main}</span>
                    </span>
                  </span>
                  <ProgressBar value={g.coverage.covered} max={g.coverage.of} tone={coverTone(g.coverage.covered, g.coverage.of)} label={`${g.name}: ${num(g.coverage.covered)} of ${num(g.coverage.of)} relevant phrases have a page of their language`} />
                  <span className="dk-seo-gaps-group-meta">
                    {view !== "clusters" && g.clusters.of > 1 ? `${num(g.clusters.gaps)} of ${plural(g.clusters.of, "cluster")} without a page` : g.clusters.gaps ? "No page of its language" : "Has its page"}
                    {g.price ? <span className="dk-seo-gaps-group-price"> · {num(g.price)} price</span> : null}
                    {g.impressions !== null ? ` · ${plural(g.impressions, "impression")}` : ""}
                  </span>
                </Go>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
