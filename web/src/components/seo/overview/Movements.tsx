import type { Reading } from "@/contract/common";
import type { MovedQuery, MovementsPanel, SpreadCounts } from "@/contract/seo/overview";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Stamp } from "@/components/ui/Stamp";
import { PanelAbsent, PositionChange, position, windowText } from "@/components/seo/bits";
import { num, shortDate } from "@/lib/format";
import { plural } from "./bits";
import { DEFAULT_RANGE, keywordHref, pageHref, seoHref } from "./href";
import "./overview.css";

/** Google reports a query as typed, quotation marks and all; the Keywords page finds it without them. */
const bare = (q: string): string => q.replace(/^["“](.*)["”]$/, "$1");

const BANDS: { key: keyof Omit<SpreadCounts, "queries">; label: string }[] = [
  { key: "top3", label: "Top 3" },
  { key: "top10", label: "4 to 10" },
  { key: "top20", label: "11 to 20" },
  { key: "beyond", label: "Beyond 20" },
];

/** How many reported queries stood where, now and (when the windows compare) before. */
function Spread({ now, before }: { now: SpreadCounts; before: SpreadCounts | null }) {
  return (
    <dl className="dk-seo-overview-spread" aria-label="Reported queries by average position">
      {BANDS.map((b) => (
        <div key={b.key} className="dk-seo-overview-spread-band">
          <dt>{b.label}</dt>
          <dd className="dk-num">
            {num(now[b.key])}
            {before ? <span className="dk-seo-overview-spread-was"> was {num(before[b.key])}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A short list of queries: each opens on Keywords; its figures, and for a moved one the change. */
function Queries({ title, total, rows, range, moved }: { title: string; total: number; rows: MovedQuery[]; range: string; moved?: boolean }) {
  return (
    <div className="dk-seo-overview-moved">
      <p className="dk-seo-overview-sublabel">
        {title} <span className="dk-num">{num(total)}</span>
      </p>
      {rows.length ? (
        <ul className="dk-seo-overview-moved-list">
          {rows.map((q) => (
            <li key={q.query}>
              <Go href={keywordHref(bare(q.query), range)} className="dk-seo-overview-moved-q" title={q.query}>
                {q.query}
              </Go>
              <span className="dk-seo-overview-moved-n dk-num">
                {moved && q.position !== null ? (
                  <PositionChange previous={q.previousPosition} current={q.position} compared />
                ) : (
                  <span title={`${num(q.impressions)} impressions, ${num(q.clicks)} clicks`}>{num(q.impressions)} impr.</span>
                )}
                <span className="dk-seo-overview-moved-pos">pos. {position(q.position ?? q.previousPosition)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dk-seo-overview-quiet">None.</p>
      )}
    </div>
  );
}

/** Pages the daily index check saw enter or leave Google's index. */
function Pages({ title, list, range }: { title: string; list: MovementsPanel["indexed"]; range: string }) {
  return (
    <div className="dk-seo-overview-moved">
      <p className="dk-seo-overview-sublabel">
        {title} <span className="dk-num">{num(list.total)}</span>
      </p>
      {list.rows.length ? (
        <ul className="dk-seo-overview-moved-list">
          {list.rows.map((p) => (
            <li key={`${p.path}-${p.at}`}>
              <Go href={pageHref(p.path, range)} className="dk-seo-overview-moved-q" title={p.path}>
                {p.path}
              </Go>
              <span className="dk-seo-overview-moved-pos" suppressHydrationWarning>
                {shortDate(p.at)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dk-seo-overview-quiet">None.</p>
      )}
    </div>
  );
}

/**
 * What moved: the queries Google reports now and not in the window before
 * (and the other way), the largest changes of average position among queries
 * shown often enough in both windows, how the reported queries spread over the
 * positions, and the pages the daily index check saw enter or leave Google's
 * index. Nothing is called new, lost or moved when the two windows cannot be
 * compared: the panel says why instead. From the desk's own Search Console
 * history and its log of the index check.
 */
export function Movements({ reading, range = DEFAULT_RANGE }: { reading: Reading<MovementsPanel>; range?: string }) {
  const v = reading.state === "ok" ? reading.value : null;
  return (
    <Card
      title="What moved"
      icon="trending-up"
      className="dk-seo-overview-panel dk-seo-overview-a-moved"
      info={`Queries Google reports in one window and not in the other, and the largest changes of average position among queries shown at least ${v ? num(v.floor) : "30"} times in both windows (a change on fewer impressions is noise). Google withholds rare queries, so “new” means newly reported. Pages entering or leaving the index are seen by the desk’s daily URL Inspection, on the next check.${reading.state === "ok" && reading.note ? ` ${reading.note}` : ""}`}
      sub={v ? `${windowText(v.window)} against ${windowText({ start: v.window.previousStart, end: v.window.previousEnd })}` : undefined}
      right={<LinkButton href={seoHref("/seo/search-console", range)} size="sm">View</LinkButton>}
    >
      {v ? (
        <div className="dk-seo-overview-movements">
          <p className="dk-seo-overview-sublabel">Where the {plural(v.spread.now.queries, "reported query", "reported queries")} stand</p>
          <Spread now={v.spread.now} before={v.compared ? v.spread.before : null} />
          {v.compared && v.added && v.lost ? (
            <div className="dk-seo-overview-moved-grid">
              <Queries title="New" total={v.added.total} rows={v.added.rows} range={range} />
              <Queries title="Lost" total={v.lost.total} rows={v.lost.rows} range={range} />
              <Queries title={`Moved (${num(v.floor)}+ impressions)`} total={v.moved.length} rows={v.moved} range={range} moved />
            </div>
          ) : (
            <p className="dk-seo-overview-quiet dk-seo-overview-moved-why">{v.reason ?? "The two windows cannot be compared yet."}</p>
          )}
          <div className="dk-seo-overview-moved-grid dk-seo-overview-moved-grid--two">
            <Pages title="Entered the index" list={v.indexed} range={range} />
            <Pages title="Left the index" list={v.dropped} range={range} />
          </div>
          <div className="dk-seo-overview-moved-stamp">
            <Stamp reading={reading} />
          </div>
        </div>
      ) : reading.state !== "ok" ? (
        <PanelAbsent reading={reading} />
      ) : null}
    </Card>
  );
}
