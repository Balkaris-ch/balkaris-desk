import type { Reading } from "@/contract/common";
import type { TopPagesPanel } from "@/contract/seo/overview";
import { Spark } from "@/components/charts";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Stamp } from "@/components/ui/Stamp";
import { Thumb } from "@/components/ui/Thumb";
import { PanelAbsent } from "@/components/seo/bits";
import { compact, DASH, num } from "@/lib/format";
import { rateText } from "./bits";
import "./overview.css";

/**
 * Top Performing Pages: the pages Google sent most people to in the period,
 * from the desk's own copy of Search Console, with the impressions per day as
 * the trend. A click-through rate on fewer than 30 impressions is printed as
 * its two counts. Each page opens its Page Optimization.
 */
export function TopPages({ reading }: { reading: Reading<TopPagesPanel> }) {
  return (
    <Card
      title="Top Performing Pages"
      icon="file-text"
      className="dk-seo-overview-panel dk-seo-overview-a-pages"
      info="Google Search, web results, from the desk’s own daily copy of Search Console: most clicks first, then most impressions. Position is Google’s average weighted by impressions. The trend is impressions per day over the period."
      right={<LinkButton href="/seo/pages" size="sm">View all pages</LinkButton>}
      flush
    >
      {reading.state === "ok" ? (
        <div className="dk-seo-overview-scroll">
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
                    <Go href={`/seo/pages/view?path=${encodeURIComponent(r.page.path)}`} className="dk-seo-overview-page">
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
                    <Spark data={r.trend} size="row" />
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
