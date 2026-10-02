import type { Reading } from "@/contract/common";
import type { GapGroup, GapQuery, GapView } from "@/contract/seo/content-gaps";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Absent } from "@/components/ui/Read";
import { cx } from "@/lib/cx";
import { num } from "@/lib/format";
import { LangMark } from "./Bits";
import { bare, coverText, coverTone, hrefWith, LIST_HEAD, plural, VIEW_ICON } from "./look";

/**
 * The view switch (board 113: "By industry · By topic · By keyword · By
 * competitor", with by language and by cluster added) and the coverage list
 * on the left: each group's answered phrases of its relevant phrases, as a
 * bar, gaps first. Every row is a link that opens the group beside it.
 */
export function ViewSwitch({ views, active, base }: { views: { key: GapView; label: string; count: number | null }[]; active: GapView; base: Record<string, string> }) {
  return (
    <nav className="dk-seo-gaps-switch" aria-label="Group the gaps">
      {views.map((v) => {
        const on = v.key === active;
        return (
          <Go
            key={v.key}
            href={hrefWith(base, { view: v.key === "topic" ? null : v.key, open: null, tab: null, offset: null, cluster: null, lang: null, price: null, question: null, gap: null, priority: null })}
            className={cx("dk-seo-gaps-switch-item", on && "dk-seo-gaps-switch-item--on")}
            aria-current={on ? "page" : undefined}
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

const GAP_FILTERS: { key: GapQuery["gap"]; label: string }[] = [
  { key: "all", label: "All" },
  { key: "1", label: "With gaps" },
  { key: "0", label: "Answered" },
];

export function CoverageList({ reading, view, open, asked, base }: { reading: Reading<{ rows: GapGroup[] }>; view: GapView; open: string | null; asked: GapQuery; base: Record<string, string> }) {
  return (
    <section className="dk-card dk-seo-gaps-list" aria-label={LIST_HEAD[view] ?? "Coverage"}>
      <header className="dk-seo-gaps-list-head">
        <h2 className="dk-seo-gaps-list-title">{LIST_HEAD[view] ?? "Coverage"}</h2>
        <nav className="dk-seo-gaps-list-filters" aria-label="Show">
          {GAP_FILTERS.map((f) => (
            <Go
              key={f.key}
              href={hrefWith(base, { gap: f.key === "all" ? null : f.key, open: null, offset: null, tab: null })}
              className={cx("dk-seo-gaps-list-filter", asked.gap === f.key && "dk-seo-gaps-list-filter--on")}
              scroll={false}
              replace
            >
              {f.label}
            </Go>
          ))}
        </nav>
      </header>
      {reading.state !== "ok" ? (
        <div className="dk-seo-gaps-pad">
          <Absent reading={reading} />
        </div>
      ) : !reading.value.rows.length ? (
        <p className="dk-seo-gaps-none">{asked.gap === "0" ? "No group is answered whole yet." : asked.gap === "1" ? "Every group is answered." : "Nothing in this view yet."}</p>
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
                    {view !== "clusters" && g.clusters.of > 1 ? `${num(g.clusters.gaps)} of ${plural(g.clusters.of, "cluster")} without a page` : g.clusters.gaps ? "No page of its language" : "Answered"}
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
