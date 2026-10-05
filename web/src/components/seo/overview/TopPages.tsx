import type { Reading } from "@/contract/common";
import type { TopPagesPanel } from "@/contract/seo/overview";
import { Spark } from "@/components/charts";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Stamp } from "@/components/ui/Stamp";
import { Thumb } from "@/components/ui/Thumb";
import { Tooltip } from "@/components/ui/Tooltip";
import { PanelAbsent, windowText } from "@/components/seo/bits";
import { compact, DASH, num } from "@/lib/format";
import { rateText } from "./bits";
import { DEFAULT_RANGE, pageHref, seoHref } from "./href";
import "./overview.css";

/** Why a row has no trend line: the day-by-day history holds less of the page than the row states. */
const NO_TREND = "No line: the desk’s day-by-day page history holds fewer of this page’s impressions than Google’s figure for the period, so a line through it would draw a fall that never happened.";

/**
 * Top Performing Pages: the pages Google sent most people to in the period,
 * with the impressions per day as the trend. The figures are Search
 * Console's own per page for its window (`basis` "google"), or the desk's
 * day-by-day history when no such answer is kept or a country or device is
 * chosen ("history"); the sub line names which, and `short` says when the
 * history holds only part of the clicks. A click-through rate on fewer than 30
 * impressions is printed as its two counts. Each page opens its Page
 * Optimization.
 */
export function TopPages({ reading, range = DEFAULT_RANGE }: { reading: Reading<TopPagesPanel>; range?: string }) {
  const v = reading.state === "ok" ? reading.value : null;
  return (
    <Card
      title="Top Performing Pages"
      icon="file-text"
      className="dk-seo-overview-panel dk-seo-overview-a-pages"
      info={`Google Search, web results: most clicks first, then most impressions. Position is Google’s average weighted by impressions. The trend is impressions per day, from the desk’s own day-by-day copy, drawn only where that copy holds the page whole.${reading.state === "ok" && reading.note ? ` ${reading.note}` : ""}`}
      sub={v ? `${v.basis === "google" ? "Google’s figure per page" : "The desk’s page history"}, ${windowText(v.window)}` : undefined}
      right={<LinkButton href={seoHref("/seo/pages", range)} size="sm">View all pages</LinkButton>}
      flush
    >
      {reading.state === "ok" ? (
        <div className="dk-seo-overview-scroll">
          {reading.value.short ? (
            <p className="dk-seo-overview-short" role="note">
              The page history holds {num(reading.value.short.pageClicks)} of the {num(reading.value.short.propertyClicks)} clicks Google counts for these days: each row is part of the page’s figure.
            </p>
          ) : null}
          <table className="dk-seo-overview-table dk-seo-overview-pages-table">
            <caption className="dk-sr">The pages Google sent most people to</caption>
            <thead>
              <tr>
                <th scope="col">Page</th>
                <th scope="col" className="dk-seo-overview-num">
                  Clicks
                </th>
                <th scope="col" className="dk-seo-overview-num">
                  Impr.
                </th>
                <th scope="col" className="dk-seo-overview-num">
                  CTR
                </th>
                <th scope="col" className="dk-seo-overview-num">
                  Pos.
                </th>
                <th scope="col" className="dk-seo-overview-trend">
                  Trend
                </th>
              </tr>
            </thead>
            <tbody>
              {reading.value.rows.map((r) => (
                <tr key={r.page.path}>
                  <td>
                    <Go href={pageHref(r.page.path, range)} className="dk-seo-overview-page">
                      <Thumb src={r.page.picture} size="sm" icon="file-text" className="dk-seo-overview-thumb" />
                      <span className="dk-seo-overview-page-text" title={r.page.title ? `${r.page.title} (${r.page.path})` : r.page.path}>
                        {r.page.path}
                      </span>
                    </Go>
                  </td>
                  <td className="dk-seo-overview-num dk-num">{num(r.clicks)}</td>
                  <td className="dk-seo-overview-num dk-num">{compact(r.impressions)}</td>
                  <td className="dk-seo-overview-num dk-num">{rateText(r.ctr)}</td>
                  <td className="dk-seo-overview-num dk-num">{r.position === null ? DASH : num(r.position, 1)}</td>
                  <td className="dk-seo-overview-trend">
                    {r.trend ? (
                      <Spark data={r.trend} size="row" />
                    ) : (
                      <Tooltip text={NO_TREND}>
                        <span className="dk-seo-overview-quiet" tabIndex={0}>
                          {DASH}
                          <span className="dk-sr">{NO_TREND}</span>
                        </span>
                      </Tooltip>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="dk-seo-overview-stampline">
            <Stamp reading={reading} />
          </div>
        </div>
      ) : (
        <div className="dk-seo-overview-pad">
          <PanelAbsent reading={reading} />
        </div>
      )}
    </Card>
  );
}
