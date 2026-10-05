import type { Reading } from "@/contract/common";
import type { ContentCheck, SeoPageSummary, SerpPreview } from "@/contract/seo/pages";
import { AreaChart, LineChart } from "@/components/charts";
import { Chip, type ChipTone } from "@/components/ui/Badge";
import { Card, CardFoot } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Go } from "@/components/ui/Go";
import { Icon, type IconName } from "@/components/ui/icons";
import { Absent } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { cx } from "@/lib/cx";
import { num, shortDate } from "@/lib/format";
import { keywordHref, optimizeHref } from "./href";
import { rateCell } from "./PagesList";
import { QueueButton } from "./QueueButton";
import { Switch } from "./Switch";

/** The part of the summary a panel needs, or why there is none (no page chosen, the summary absent). */
function part<T>(sel: Reading<SeoPageSummary> | null, take: (s: SeoPageSummary) => Reading<T>): Reading<T> | null {
  if (!sel) return null;
  if (sel.state !== "ok") return sel as Reading<never>;
  return take(sel.value);
}

function NoPage() {
  return (
    <Empty icon="pages" title="No page chosen" compact>
      Choose a page in the list.
    </Empty>
  );
}

/** "Page performance": the chosen page's clicks, impressions and position per day, one measure at a time. */
export function PerformanceCard({ selected }: { selected: Reading<SeoPageSummary> | null }) {
  const r = part(selected, (s) => s.performance);
  const path = selected?.state === "ok" ? selected.value.row.page.path : null;
  return (
    <Card title="Page performance" className="dk-seo-pages-perf" sub={path ?? undefined} right={r && r.state === "ok" ? <span className="dk-seo-pages-small dk-num">{`${shortDate(r.value.start)} – ${shortDate(r.value.end)}`}</span> : null}>
      {!r ? (
        <NoPage />
      ) : r.state !== "ok" ? (
        <Absent reading={r} />
      ) : (
        <>
          <Switch
            label="Measure"
            look="dots"
            className="dk-seo-pages-perf-sw"
            options={[
              { key: "clicks", label: "Clicks" },
              { key: "impressions", label: "Impressions" },
              { key: "position", label: "Position (lower is better)" },
            ]}
          >
            <AreaChart
              height="fill"
              label="Clicks from Google per day"
              unit="count"
              series={r.value.days.map((d) => ({ date: d.date, value: d.clicks }))}
              zeroNote="No click from Google in the window."
              emptyNote="No day in the window."
            />
            <AreaChart
              height="fill"
              label="Impressions in Google per day"
              unit="count"
              series={r.value.days.map((d) => ({ date: d.date, value: d.impressions }))}
              zeroNote="Google did not show the page in the window."
              emptyNote="No day in the window."
            />
            {/* A position is better the lower it is, and the shared chart's axis rises upward: so a line
                without a filled area, which would read as volume, and the reading said under it. One
                element, not a fragment: the server sends a fragment as a list, and the switch would
                count its two parts as two panes. */}
            <div className="dk-seo-pages-perf-pos">
              <LineChart
                height="fill"
                fill="none"
                label="Average position per day (lower is better)"
                unit="ratio"
                series={[{ label: "Average position (lower is better)", data: r.value.days.map((d) => ({ date: d.date, value: d.position })) }]}
                emptyNote="No impressions, so no position, in the window."
              />
              <p className="dk-seo-pages-small dk-seo-pages-perf-note">Lower is better: 1 is the first result. A rise in this line is a fall in Google’s results.</p>
            </div>
          </Switch>
          <Stamp reading={r} />
        </>
      )}
    </Card>
  );
}

/**
 * "Keywords": the searches Google showed the chosen page for. The board's
 * volume column is impressions: no free source gives search volume. Each
 * search opens on the Keywords screen; the foot opens every one of them on
 * Page Optimization's Keywords tab, in the period this screen shows.
 */
export function KeywordsCard({ selected, range }: { selected: Reading<SeoPageSummary> | null; range: string }) {
  const r = part(selected, (s) => s.keywords);
  const path = selected?.state === "ok" ? selected.value.row.page.path : null;
  return (
    <Card
      title="Keywords"
      count={r && r.state === "ok" ? num(r.value.total) : undefined}
      className="dk-seo-pages-kw"
      flush
      footer={path ? <CardFoot href={optimizeHref(path, range, "keywords")}>View all keywords</CardFoot> : undefined}
    >
      {!r ? (
        <div className="dk-seo-pages-pad">
          <NoPage />
        </div>
      ) : r.state !== "ok" ? (
        <div className="dk-seo-pages-pad">
          <Absent reading={r} />
        </div>
      ) : r.value.rows.length === 0 ? (
        <div className="dk-seo-pages-pad">
          <Empty icon="search" title="No searches yet" compact>
            Google showed this page for no search in the window.
          </Empty>
        </div>
      ) : (
        <div className="dk-table-wrap">
          <table className="dk-table dk-table--dense dk-table--caps dk-seo-pages-kw-table">
            <caption className="dk-sr">Searches Google showed the page for</caption>
            <thead>
              <tr>
                <th scope="col">Keyword</th>
                <th scope="col" className="dk-table-right" title="Average position in Google (lower is better)">
                  Pos.
                </th>
                <th scope="col" className="dk-table-right" title="Impressions in Google Search (Search Console), not search volume">
                  Impr.
                </th>
                <th scope="col" className="dk-table-right">
                  CTR
                </th>
              </tr>
            </thead>
            <tbody>
              {r.value.rows.slice(0, 6).map((k) => (
                <tr key={k.query}>
                  <td className="dk-seo-pages-kw-q" title={`${k.query}: open it on the Keywords screen`}>
                    <Go href={keywordHref(range, k.query)}>{k.query}</Go>
                  </td>
                  <td className="dk-table-right dk-num">{num(k.position, 1)}</td>
                  <td className="dk-table-right dk-num">{num(k.impressions)}</td>
                  <td className="dk-table-right dk-num" title={`${num(k.clicks)} clicks of ${num(k.impressions)} impressions`}>
                    {rateCell(k.ctr)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const STATE: Record<ContentCheck["state"], { icon: IconName; tone: ChipTone }> = {
  good: { icon: "check", tone: "good" },
  work: { icon: "alert", tone: "warn" },
  missing: { icon: "x", tone: "bad" },
  unknown: { icon: "minus", tone: "quiet" },
};

/** "Content optimization": the checklist read from the page, and the operator's advice on it. */
export function ContentCard({ selected }: { selected: Reading<SeoPageSummary> | null }) {
  const r = part(selected, (s) => s.content);
  const s = selected?.state === "ok" ? selected.value : null;
  const ask = s?.actions.find((a) => a.key === "content");
  return (
    <Card title="Content optimization" className="dk-seo-pages-content">
      {!r ? (
        <NoPage />
      ) : r.state !== "ok" ? (
        <Absent reading={r} />
      ) : (
        <>
          <ul className="dk-seo-pages-checklist">
            {r.value.map((c) => {
              const k = STATE[c.state];
              return (
                <li key={c.key} title={c.rule}>
                  <span className={cx("dk-seo-pages-check-mark", `dk-tone-${k.tone}`)} aria-hidden>
                    <Icon name={k.icon} size={11} />
                  </span>
                  <span className="dk-seo-pages-check-two">
                    <span className="dk-seo-pages-check-label">{c.label}</span>
                    <span className="dk-seo-pages-check-value dk-num">{c.value}</span>
                  </span>
                  <Chip tone={k.tone} className="dk-seo-pages-check-chip">
                    {c.verdict}
                  </Chip>
                </li>
              );
            })}
          </ul>
          {ask?.task && s ? (
            <div className="dk-seo-pages-content-act">
              {/* Keyed by the page: what pressing said for one page is not shown for the next. */}
              <QueueButton key={s.row.page.path} task={ask.task} label="Optimize content with AI" step={ask.step} blocked={ask.available ? null : ask.why} />
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

/** A title or description cut where a result would cut it, by the desk's yardstick. */
const cut = (s: string | null, limit: number): string => (!s ? "" : [...s].length > limit ? `${[...s].slice(0, limit - 1).join("").trimEnd()}…` : s);

/**
 * One result as Google may draw it, from the page's own tags. The address is
 * the host the crawl fetched. Google also prints the site's name and icon
 * above it; the crawl reads neither, so neither is drawn rather than made up.
 */
function Result({ v, mobile }: { v: SerpPreview; mobile: boolean }) {
  return (
    <div className={cx("dk-seo-pages-serp-card", mobile && "dk-seo-pages-serp-card--mobile")}>
      <div className="dk-seo-pages-serp-text">
        <p className="dk-seo-pages-serp-site">
          <span className="dk-seo-pages-serp-url">
            https://{v.host}
            {v.crumbs.map((c) => ` › ${c}`).join("")}
          </span>
        </p>
        <p className="dk-seo-pages-serp-title">{v.title ? cut(v.title, v.titleLimit) : "(no title: Google picks one)"}</p>
        <p className="dk-seo-pages-serp-desc">{v.description ? cut(v.description, v.descriptionLimit) : "(no description: Google shows a fragment of the page)"}</p>
      </div>
      {v.picture ? (
        // The page's own share picture, as the crawl read it.
        <img src={v.picture} alt="" className="dk-seo-pages-serp-pic" loading="lazy" />
      ) : null}
    </div>
  );
}

/** "SERP preview": the chosen page as a Google result might show it, from its own tags. An approximation: Google may rewrite either line. */
export function SerpCard({ selected }: { selected: Reading<SeoPageSummary> | null }) {
  const r = part(selected, (s) => s.serp);
  return (
    <Card title="SERP preview" className="dk-seo-pages-serp">
      {!r ? (
        <NoPage />
      ) : r.state !== "ok" ? (
        <Absent reading={r} />
      ) : (
        <>
          <Switch
            label="Device"
            look="seg"
            options={[
              { key: "google", label: "Google" },
              { key: "mobile", label: "Mobile" },
            ]}
          >
            <Result v={r.value} mobile={false} />
            <Result v={r.value} mobile />
          </Switch>
          <p className="dk-seo-pages-small">
            Title {r.value.titleLength} of {r.value.titleLimit} characters, description {r.value.descriptionLength} of {r.value.descriptionLimit}. Cut at the desk’s yardsticks; Google cuts by width and may rewrite either. The site’s name and icon, which Google prints above the address, are not read by the crawl and are left out.
          </p>
        </>
      )}
    </Card>
  );
}
