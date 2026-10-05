import type { ReactNode } from "react";
import type { Reading, Stat } from "@/contract/common";
import type { PagePotential, PageStatus, SeoPageViewPayload } from "@/contract/seo/page-view";
import { AreaChart, Ring, SparkBars } from "@/components/charts";
import { Card } from "@/components/ui/Card";
import { Delta } from "@/components/ui/Delta";
import { Empty } from "@/components/ui/Empty";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { Absent, Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Table } from "@/components/ui/Table";
import { cx } from "@/lib/cx";
import { DASH, num, percent, shortDate } from "@/lib/format";
import { ctrFigure } from "./SiteTiles";
import { curveAt } from "./PageHeadCard";
import { optimizeHref, scoreTone, type OptimizeTab } from "./bits";

/** Where each area of the ring is worked on. */
const AREA_TAB: Record<string, OptimizeTab> = { metadata: "optimize", content: "content", schema: "technical", links: "links", technical: "technical", images: "content" };

/**
 * "Current status": the crawl's score as the ring, and each area of its rules
 * as a line, 100 less what that area's rules took. The points lost add up to
 * the ring's. The desk's own yardsticks, stated in the (i).
 */
export function StatusPanel({ reading, path, range }: { reading: Reading<PageStatus>; path: string; range: string | null }) {
  return (
    <Card title="Current status" className="dk-seo-optimize-panel" info={reading.state === "ok" ? reading.value.rule : "The crawl's score of the page and its parts."}>
      <Read reading={reading}>
        {(s, r) => (
          <>
            <div className="dk-seo-optimize-status">
              <Ring size="panel" value={s.score} label="The crawl's score" good={90} warn={50} caption={s.band?.label ?? "Not scored"} />
              <ul className="dk-seo-optimize-areas">
                {s.areas.map((a) => (
                  <li key={a.key}>
                    <Go href={optimizeHref(path, range, AREA_TAB[a.key] ?? "technical")} className="dk-seo-optimize-area" title={a.rules.length ? a.rules.map((x) => `−${x.cost}: ${x.text}`).join("\n") : "Nothing found by this area's rules."}>
                      <span className={cx("dk-seo-optimize-dot", `dk-tone-${scoreTone(a.score)}`)} aria-hidden />
                      <span className="dk-seo-optimize-area-name">{a.label}</span>
                      <span className="dk-seo-optimize-area-score dk-num">
                        {a.score}
                        <span>/100</span>
                      </span>
                    </Go>
                  </li>
                ))}
              </ul>
            </div>
            {s.unscored ? <p className="dk-seo-optimize-note">{s.unscored}</p> : null}
            <p className="dk-seo-optimize-note">
              {s.readiness ? (
                <>
                  AI readiness: <b className="dk-num">{num(s.readiness.pass)}</b> of <b className="dk-num">{num(s.readiness.of)}</b> checks pass ({shortDate(s.readiness.checkedAt)})
                </>
              ) : (
                "AI readiness: the daily check has not read this page yet."
              )}
            </p>
            <Stamp reading={r} />
          </>
        )}
      </Read>
    </Card>
  );
}

function Row({ label, reading, render }: { label: string; reading: Reading<Stat>; render?: (s: Stat) => ReactNode }) {
  return (
    <div className="dk-seo-optimize-perf-row">
      <dt>{label}</dt>
      {reading.state === "ok" ? (
        <dd>
          <b className="dk-num">{render ? render(reading.value) : num(reading.value.value, 1)}</b>
          <Delta value={reading.value.value} previous={reading.value.previous} unit={reading.value.unit} downIsGood={label === "Position"} size="sm" />
        </dd>
      ) : (
        <dd>
          <Absent reading={reading} form="inline" />
        </dd>
      )}
    </div>
  );
}

/**
 * "SEO Performance": the page's position, impressions, clicks and CTR from
 * Search Console, each against the window before when that was measured
 * whole, and its impressions per day. CTR beside what our curve expects at
 * its position, said as ours.
 */
export function PerformancePanel({ data }: { data: SeoPageViewPayload }) {
  const t = data.tiles;
  const ctr = ctrFigure(t.ctr);
  const position = t.position.state === "ok" ? t.position.value.value : null;
  const expected = position !== null ? curveAt(data.curve.points, data.curve.beyond, position) : null;
  const days = data.performance.state === "ok" ? data.performance.value.days : [];
  const shown = t.impressions;
  return (
    <Card title="SEO Performance" className="dk-seo-optimize-panel" info={`Google Search, web results, ${data.searchFrom ? `${shortDate(data.searchFrom.start)} – ${shortDate(data.searchFrom.end)}` : "the period"}. ${data.searchFrom?.line ?? ""} Changes are against the period before, only when it was measured whole; under 20 they are printed as “3 → 5”.`}>
      {shown.state === "ok" ? (
        <>
          <dl className="dk-seo-optimize-perf">
            <Row label="Position" reading={t.position} render={(s) => num(s.value, 1)} />
            <Row label="Impressions" reading={t.impressions} render={(s) => num(s.value)} />
            <Row label="Clicks" reading={t.clicks} render={(s) => num(s.value)} />
            <div className="dk-seo-optimize-perf-row">
              <dt>CTR</dt>
              {ctr.state === "ok" ? (
                <dd>
                  <b className="dk-num">{ctr.value.figure}</b>
                  {expected !== null ? <span className="dk-seo-optimize-perf-said">our curve: {percent(expected, 2)}</span> : null}
                </dd>
              ) : (
                <dd>
                  <Absent reading={ctr} form="inline" />
                </dd>
              )}
            </div>
          </dl>
          <div className="dk-seo-optimize-perf-chart">
            <AreaChart label="Impressions per day" series={days.map((d) => ({ date: d.date, value: d.impressions }))} unit="count" height={112} zeroNote="Not shown in Google on any day of the period." emptyNote="No day of the period is in the history yet." />
          </div>
          <Stamp reading={shown} />
        </>
      ) : (
        <Absent reading={shown} />
      )}
    </Card>
  );
}

/**
 * "Traffic potential": OUR ESTIMATE, from the page's real impressions only
 * (queries at position 4 to 20 brought to position 3 by our stated curve),
 * the page's impressions per day as bars, and its queries with their
 * impressions, which are labelled as impressions: there is no free source of
 * search volume.
 */
export function PotentialPanel({ reading, data, path, range }: { reading: Reading<PagePotential>; data: SeoPageViewPayload; path: string; range: string | null }) {
  const queries = data.queries.state === "ok" ? data.queries.value.rows : [];
  const top = [...queries].sort((a, b) => b.impressions - a.impressions).slice(0, 5);
  return (
    <Card title="Traffic potential" className="dk-seo-optimize-panel" info={`OUR ESTIMATE, not a figure from Google. ${data.curve.note}`}>
      {reading.state === "ok" ? (
        <div className="dk-seo-optimize-pot">
          <p className="dk-seo-optimize-pot-figure dk-num">+{num(reading.value.clicksPerMonth, 1)}</p>
          <p className="dk-seo-optimize-pot-said">clicks a month · our estimate</p>
          {reading.value.days.length > 1 ? <SparkBars data={reading.value.days.map((d) => d.impressions)} label="Impressions per day" className="dk-seo-optimize-pot-bars" /> : null}
          <p className="dk-seo-optimize-note">{reading.value.basis}</p>
        </div>
      ) : (
        <Absent reading={reading} />
      )}
      {top.length ? <p className="dk-seo-optimize-pot-head">Its queries, by impressions</p> : null}
      {top.length ? (
        <ul className="dk-seo-optimize-pot-list" aria-label="The page's queries by impressions">
          {top.map((q, i) => (
            <li key={q.query}>
              <span className="dk-seo-optimize-dot" style={{ background: `var(--s${(i % 6) + 1})` }} aria-hidden />
              <span className="dk-seo-optimize-pot-q">{q.query}</span>
              <span className="dk-num" title="Impressions in Search Console over the period">
                {num(q.impressions)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {queries.length ? (
        <Go href={optimizeHref(path, range, "keywords")} className="dk-seo-optimize-more">
          <span>View all keywords ({num(queries.length)})</span>
          <Icon name="arrow-right" size={14} />
        </Go>
      ) : null}
    </Card>
  );
}

/**
 * "Top ranking competitors": the competitor pages captured for this page's
 * clusters (and the same topic in German), as fetched: no backlinks, domain
 * rating or traffic, which have no free source. Where each was seen, in the
 * Google result the audit read, is its own column.
 */
export function CompetitorsPanel({ data }: { data: SeoPageViewPayload }) {
  const rows = data.competitors;
  return (
    <Card
      title="Top ranking competitors"
      flush
      className="dk-seo-optimize-panel"
      info="Sites seen in Google's results for this page's topics (the audit's capture in a real browser), with what their page says as the desk read it, politely, once a week. No backlink count, domain rating or traffic: no free source gives them, so they are not shown."
      right={rows.length ? <Go href="/seo/competitors" className="dk-seo-optimize-headlink">All competitors</Go> : undefined}
    >
      {rows.length ? (
        <Table
          caption="Competitors for this page's topics"
          rows={rows}
          rowKey={(r) => r.url}
          minWidth={620}
          columns={[
            { key: "pos", head: "#", numeric: true, width: "44px", cell: (r) => (r.position === null ? DASH : num(r.position)) },
            {
              key: "site",
              head: "Website",
              width: "20%",
              cell: (r) => (
                <Go href={r.url} className="dk-seo-optimize-comp-site">
                  {r.domain}
                </Go>
              ),
            },
            { key: "title", head: "Title", cell: (r) => (r.title ? <span className="dk-seo-optimize-wrap">{r.title}</span> : <span className="dk-seo-optimize-quiet" title={r.unread ?? undefined}>{r.unread ? "Not read yet" : DASH}</span>) },
            { key: "words", head: "Words", numeric: true, width: "72px", cell: (r) => (r.words === null ? DASH : num(r.words)) },
            { key: "price", head: "Price", width: "64px", cell: (r) => (r.priceStated === null ? DASH : r.priceStated ? "Stated" : "None") },
            { key: "seen", head: "Seen for", width: "24%", cell: (r) => (r.query ? <span className="dk-seo-optimize-quiet dk-seo-optimize-wrap">{r.query}</span> : DASH) },
            /* The day the position was seen: one import, not refreshed, so an ageing snapshot says its age. */
            { key: "day", head: "Seen on", width: "88px", cell: (r) => (r.seen ? <span className="dk-seo-optimize-quiet dk-num">{shortDate(r.seen)}</span> : DASH) },
          ]}
        />
      ) : (
        <Empty icon="users" title="None observed for this page's topics">
          {data.clusters.length
            ? `No competitor was captured for ${data.clusters.map((c) => `“${c.name}”`).join(", ")} yet. The audit's captures and the weekly read fill this.`
            : "The keyword table maps no topic to this page yet, so there is no result to read competitors from."}
        </Empty>
      )}
    </Card>
  );
}
