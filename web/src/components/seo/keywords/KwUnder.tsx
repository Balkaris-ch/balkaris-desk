import type { KeywordRow, SeoKeywordsPayload } from "@/contract/seo/keywords";
import { Spark } from "@/components/charts";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Go } from "@/components/ui/Go";
import { Icon, type IconName } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Absent } from "@/components/ui/Read";
import { cx } from "@/lib/cx";
import { ago, DASH, num, shortDate } from "@/lib/format";
import { keywordsHref, optimizeHref, type Place } from "./href";
import { pos, trendWeeks } from "./look";

/* ---------- targets ------------------------------------------------------------------------------ */

function TargetRow({ r }: { r: KeywordRow }) {
  return (
    <li className="dk-seo-kw-tgt">
      <span className="dk-seo-kw-tgt-what">
        <span className="dk-seo-kw-phrase-text" title={r.phrase}>
          {r.phrase}
        </span>
        <span className="dk-seo-kw-tgt-sub">
          {r.page ? (
            r.pageKnown ? (
              <Go href={optimizeHref(r.page)} className="dk-seo-kw-path">
                {r.page}
              </Go>
            ) : (
              <span className="dk-seo-kw-path dk-seo-kw-path--gone">{r.page}</span>
            )
          ) : (
            <span className="dk-seo-kw-gap">No page</span>
          )}
          <span title={`Marked by ${r.target!.by}`}>
            · {r.target!.by}, {shortDate(r.target!.at)}
          </span>
        </span>
      </span>
      <span className="dk-seo-kw-tgt-fig dk-num" title="Google's average position in the window">
        {r.position === null ? <span className="dk-seo-kw-none">not shown</span> : pos(r.position)}
      </span>
      <span className="dk-seo-kw-tgt-fig dk-num" title="Impressions in the window (Search Console)">
        {r.impressions === null ? <span className="dk-seo-kw-none">{DASH}</span> : num(r.impressions)}
      </span>
      <span className="dk-seo-kw-tgt-trend">{r.trend.some((p) => p !== null) ? <Spark data={trendWeeks(r.trend)} size="row" label={`Weekly average position of “${r.phrase}”`} /> : null}</span>
    </li>
  );
}

/** The phrases a person marked as targets, with where Google has them now. */
export function TargetsCard({ data, place }: { data: SeoKeywordsPayload; place: Place }) {
  const t = data.targets;
  return (
    <Card
      title="Your targets"
      icon="target"
      count={t.state === "ok" && t.value.length ? num(t.value.length) : undefined}
      info="The phrases a person marked as ones the site should rank for, with Google's average position and impressions over the window. A target is a person's mark: no run or import sets or clears it."
      right={
        t.state === "ok" && t.value.length ? (
          <Go href={keywordsHref(place, { view: "keywords", target: true, status: "all" })} scroll={false} className="dk-seo-kw-reset">
            In the table
          </Go>
        ) : null
      }
    >
      {t.state !== "ok" ? (
        <Absent reading={t} />
      ) : !t.value.length ? (
        <Empty icon="target" title="No target yet" compact>
          Mark a phrase as a target from its row’s ⋯ menu or with Bulk actions, or track a new one. Each is then followed here with its position.
        </Empty>
      ) : (
        <>
          <div className="dk-seo-kw-tgt dk-seo-kw-tgt--head" aria-hidden>
            <span>Keyword</span>
            <span>Pos.</span>
            <span>Impr.</span>
            <span>Trend</span>
          </div>
          <ul className="dk-seo-kw-tgts">
            {t.value.slice(0, 12).map((r) => (
              <TargetRow key={r.id} r={r} />
            ))}
          </ul>
          {t.value.length > 12 ? <p className="dk-seo-kw-basis">and {num(t.value.length - 12)} more in the table.</p> : null}
        </>
      )}
    </Card>
  );
}

/* ---------- where the phrases come from ---------------------------------------------------------- */

const SOURCE_ICON: Record<string, IconName> = { gsc: "search", autocomplete: "sparkles", audit: "file-text", manual: "user" };

/** The four places a phrase comes from, and the Google Autocomplete research with its weekly budget. */
export function SourcesCard({ data, place }: { data: SeoKeywordsPayload; place: Place }) {
  const r = data.research;
  return (
    <Card title="Where the phrases come from" icon="layers" info="A phrase keeps every place it came from. Counted over the whole table, every judgement included.">
      <ul className="dk-seo-kw-srcs">
        {data.sources.map((s) => (
          <li key={s.key} className="dk-seo-kw-src">
            <span className="dk-seo-kw-src-icon" aria-hidden>
              <Icon name={SOURCE_ICON[s.key] ?? "dot"} size={14} />
            </span>
            <span className="dk-seo-kw-src-text">
              <Go href={keywordsHref(place, { view: "keywords", source: s.key, status: "all" })} scroll={false} className="dk-seo-kw-src-name">
                {s.label}
              </Go>
              <span className="dk-seo-kw-src-line">{s.line}</span>
            </span>
            <span className={cx("dk-seo-kw-src-n dk-num", !s.count && "dk-seo-kw-none")}>{num(s.count)}</span>
          </li>
        ))}
      </ul>
      <div className="dk-seo-kw-research">
        <p className="dk-seo-kw-research-head">
          <span>Google Autocomplete research</span>
          <span className="dk-num">
            {num(r.used)} / {num(r.cap)} this week
          </span>
        </p>
        <ProgressBar value={r.used} max={r.cap || 1} label="Autocomplete requests used this week" tone={r.cap && r.used >= r.cap ? "warn" : "good"} />
        <p className="dk-seo-kw-research-line">
          {r.lastRun ? `Last run ${ago(r.lastRun)}: ${r.lastNote ?? `${num(r.foundLast)} new phrases`}.` : "Not run yet."} {num(r.found)} phrase{r.found === 1 ? "" : "s"} found by the desk&apos;s research in all
          {r.nextRun ? `; next run ${shortDate(r.nextRun)}` : ""}. At most 20 requests a run, one a second, {num(r.cap)} a week ({r.week}); new phrases wait unjudged.
        </p>
      </div>
    </Card>
  );
}
