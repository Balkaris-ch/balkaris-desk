import type { InsightsPayload } from "@/contract/insights";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Delta } from "@/components/ui/Delta";
import { Empty } from "@/components/ui/Empty";
import { Go } from "@/components/ui/Go";
import { Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Thumb } from "@/components/ui/Thumb";
import { compact } from "@/lib/format";
import { ctrText } from "./rate";
import { hrefOf, type View } from "./href";

/**
 * The three articles read most in the range, by GA4's views. Search
 * Console's click-through rate joins them when it is connected; the change
 * badge appears only when the period before was measured.
 */
export function TopPanel({ data, view }: { data: InsightsPayload; view: View }) {
  const ctr = data.table.gsc.state === "ok" ? data.table.gsc.value : null;
  return (
    <Card
      className="dk-insights-top"
      title="Top performing insights"
      info="The three articles with the most views in the range (GA4, consenting visitors only). CTR is Search Console's, once it is connected."
      right={
        <LinkButton href={hrefOf(view, { tab: "performance" })} size="sm" variant="quiet">
          View all
        </LinkButton>
      }
    >
      <Read reading={data.top}>
        {(rows, r) =>
          rows.length === 0 ? (
            <Empty compact icon="article" title="No article was read in this period">
              GA4 recorded no views of an article in the range.
            </Empty>
          ) : (
            <>
              <ol className="dk-insights-top-list">
                {rows.map((a) => {
                  const c = ctr?.[a.path];
                  return (
                    <li key={a.path} className="dk-insights-top-row">
                      <Thumb src={a.cover} size="lg" icon="article" />
                      <div className="dk-insights-top-text">
                        <Go href={a.href} className="dk-insights-top-title">
                          {a.title}
                        </Go>
                        <p className="dk-insights-top-meta dk-num">
                          {compact(a.views)} {a.views === 1 ? "view" : "views"}
                          {c && c.ctr !== null ? (
                            <>
                              <span aria-hidden> • </span>
                              {ctrText(c.clicks, c.impressions, c.ctr)} CTR
                            </>
                          ) : null}
                        </p>
                      </div>
                      {a.previousViews !== null ? (
                        <span className="dk-insights-badge">
                          <Delta value={a.views} previous={a.previousViews} size="sm" />
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
              <p className="dk-insights-foot">
                <Stamp reading={r} />
              </p>
            </>
          )
        }
      </Read>
    </Card>
  );
}
