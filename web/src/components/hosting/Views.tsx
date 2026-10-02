import type { ReactNode } from "react";
import type { Reading } from "@/contract/common";
import type { DrainCounting, ViewRule, ViewsChart } from "@/contract/hosting";
import { LineChart } from "@/components/charts";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";
import { Absent, Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { StatusDot } from "@/components/ui/StatusDot";
import { Tooltip } from "@/components/ui/Tooltip";
import { ago, clock, fullDate, num, shortDate } from "@/lib/format";
import { KIND_NAME } from "./words";

/** A figure over the chart, with its line's colour key before its name. */
function Fig({ value, name, color }: { value: string; name: ReactNode; color?: "green" | "blue" }) {
  return (
    <div className="dk-hosting-fig">
      <p className="dk-hosting-fig-value dk-num">{value}</p>
      <p className="dk-hosting-fig-name">
        {color ? <i className={`dk-hosting-key dk-c-${color}`} aria-hidden /> : null}
        <span>{name}</span>
      </p>
    </div>
  );
}

const PLOT = 150;

/**
 * Page views per day from Vercel's records, with GA4's on the same days
 * beside them. It begins on the first day the drain delivered and is never
 * back-filled: before that day nothing was counted, and the chart says so.
 */
export function ViewsPerDay({ reading }: { reading: Reading<ViewsChart> }) {
  return (
    <Card
      title="Page views per day"
      icon="line-chart"
      className="dk-hosting-card"
      info="Server: Vercel's own record of every request, counted by the rules beside this panel. GA4: page views of visitors who accepted the cookie banner. A day the drain delivered nothing is a gap, not a zero."
    >
      <Read reading={reading}>
        {(c, r) => {
          const server = c.views.reduce<number>((a, v) => a + (v ?? 0), 0);
          const ga = c.ga4 ? c.ga4.reduce<number>((a, v) => a + (v ?? 0), 0) : null;
          return (
            <div className="dk-hosting-chartbox">
              <div className="dk-hosting-figs">
                <Fig value={num(server)} name="Server, page views" color="green" />
                {ga !== null ? <Fig value={num(ga)} name="GA4, page views" color="blue" /> : null}
              </div>
              <LineChart
                label="Page views per day: the server's count and GA4's"
                x={c.days}
                unit="count"
                integer
                height={PLOT}
                provisional={1}
                provisionalNote="Today is still being counted."
                series={[
                  { label: "Server (Vercel's records)", data: c.views, color: "green" },
                  ...(c.ga4 ? [{ label: "GA4 (consenting visitors)", data: c.ga4, color: "blue" as const }] : []),
                ]}
                emptyNote="No page view counted in this range yet."
              />
              <p className="dk-hosting-foot">
                <Stamp reading={r} />
                <span className="dk-hosting-since" title={`The first signed delivery arrived at ${clock(c.firstAt)} on ${fullDate(c.firstAt)}; that day is counted from then on, and nothing before it is.`}>
                  since {shortDate(c.firstDay)}, {clock(c.firstAt)}
                </span>
                {c.ga4Why ? <span className="dk-hosting-since" title={c.ga4Why}>GA4 line absent: {c.ga4Why}</span> : null}
              </p>
            </div>
          );
        }}
      </Read>
    </Card>
  );
}

/** One kind of record and how many the rules gave it, with the rule and its reason on hover. */
function KindRow({ r, strong }: { r: ViewRule; strong?: boolean }) {
  return (
    <li className={strong ? "dk-hosting-kind dk-hosting-kind--view" : "dk-hosting-kind"}>
      <Tooltip
        text={
          <>
            {r.rule}
            <span className="dk-hosting-tip-why">{r.why}</span>
          </>
        }
      >
        <span className="dk-hosting-kind-name" tabIndex={0}>
          {KIND_NAME[r.kind]}
        </span>
      </Tooltip>
      <span className="dk-hosting-kind-n dk-num">{r.count === null ? "—" : num(r.count)}</span>
    </li>
  );
}

/**
 * Days whose page views stood without a single router record: Vercel's
 * records carried no marker that day, so prefetches may be in the count.
 */
function MarkerGaps({ markers }: { markers: DrainCounting["markers"] }) {
  const days = markers.gaps.map((g) => shortDate(g.day)).join(", ");
  return (
    <p className="dk-hosting-markers">
      <Tooltip
        text={`On ${markers.gaps.map((g) => `${shortDate(g.day)} (${num(g.views)} page views)`).join(", ")}: ${num(markers.minViews)} or more page views and not one prefetch, router request or navigation beside them. A person on a page always brings those with them, so Vercel's records carried neither ?_rsc= nor the .segments/.rsc matched path, and prefetches may be counted as page views.`}
      >
        <span tabIndex={0}>
          <StatusDot tone="bad" tint>
            Router markers absent on {days}: page views may include prefetches
          </StatusDot>
        </span>
      </Tooltip>
    </p>
  );
}

/**
 * The rules that turn Vercel's records into page views, with what each
 * decided in the range: every record received is accounted for here. The
 * rules are shown even before the drain delivers: they are what WILL count.
 */
export function Counting({ reading, rules }: { reading: Reading<DrainCounting>; rules: ViewRule[] }) {
  /* Page loads first: they are most of it. The rest keep the order the rules are applied in. */
  const views = ["view", "navigation"].map((k) => rules.find((r) => r.kind === k)).filter((r): r is ViewRule => !!r);
  const aside = rules.filter((r) => r.kind !== "view" && r.kind !== "navigation");
  const total = views.every((r) => r.count !== null) ? views.reduce((a, r) => a + (r.count ?? 0), 0) : null;
  return (
    <Card
      title="How page views are counted"
      icon="filter"
      className="dk-hosting-card"
      right={<Stamp reading={reading} />}
      info="Each record Vercel sends is decided by the first rule that fits it, in the order of the source (src/cc/vercel/drain.ts). Hover a name for the rule and its reason. No IP address and no user agent is kept: only these counts, per day."
    >
      {reading.state !== "ok" ? (
        /* Short: the chart beside it says the same in full, with the step; here the rules are the point. */
        <Absent reading={reading} form="tile" className="dk-hosting-absent-short" />
      ) : (
        <dl className="dk-hosting-deliv">
          <div>
            <dt>Last delivery</dt>
            <dd>
              {reading.value.quietHours !== null ? (
                <StatusDot tone="bad" tint>
                  {reading.value.quietHours} hours ago
                </StatusDot>
              ) : (
                <time dateTime={reading.value.lastDelivery} suppressHydrationWarning>
                  {ago(reading.value.lastDelivery)}
                </time>
              )}
            </dd>
          </div>
          <div>
            <dt>Today</dt>
            <dd className="dk-num">
              {num(reading.value.today.deliveries)} deliveries, {num(reading.value.today.records)} records
            </dd>
          </div>
          <div>
            <dt>Refused</dt>
            <dd className="dk-num">
              <Tooltip
                text={
                  reading.value.lastRefused
                    ? `Deliveries whose signature did not match. The last at ${clock(reading.value.lastRefused)} on ${fullDate(reading.value.lastRefused)}. Nothing in them was counted.`
                    : "No delivery has been refused: every one carried the drain's signature."
                }
              >
                <span tabIndex={0}>{num(reading.value.today.refused)} today</span>
              </Tooltip>
            </dd>
          </div>
          <div>
            <dt>In the range</dt>
            <dd className="dk-num">{num(reading.value.records)} records decided</dd>
          </div>
        </dl>
      )}
      {reading.state === "ok" && reading.value.markers.gaps.length ? <MarkerGaps markers={reading.value.markers} /> : null}
      <p className="dk-hosting-subhead dk-hosting-subhead--gap">
        Page views <span className="dk-num dk-hosting-subhead-n">{total === null ? "" : num(total)}</span>
      </p>
      <ul className="dk-hosting-kinds dk-hosting-kinds--grid">
        {views.map((r) => (
          <KindRow key={r.kind} r={r} strong />
        ))}
      </ul>
      <p className="dk-hosting-subhead dk-hosting-subhead--gap">Set aside</p>
      <ul className="dk-hosting-kinds dk-hosting-kinds--grid">
        {aside.map((r) => (
          <KindRow key={r.kind} r={r} />
        ))}
      </ul>
      <p className="dk-hosting-note">
        <Icon name="lock" size={12} /> No visitor count: a record tells people apart only by IP address and browser, which the desk does not keep.
      </p>
    </Card>
  );
}
