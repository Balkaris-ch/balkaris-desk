import type { ReactNode } from "react";
import type { Reading } from "@/contract/common";
import type {
  TrafficChannels,
  TrafficClarity,
  TrafficCountryRow,
  TrafficDeviceRow,
  TrafficEventRow,
  TrafficLandingRow,
  TrafficLinks,
  TrafficPerDay,
  TrafficPeriod,
  TrafficSourceRow,
  TrafficTiles,
  TrafficTimeStat,
  TrafficCities,
} from "@/contract/traffic";
import { AreaChart, Donut, Legend, shareTexts, sliceLegend, Spark, SparkBars, WorldMap, type DonutSlice, type LegendItem } from "@/components/charts";
import { ActionList, type ActionItem } from "@/components/ui/ActionList";
import { Chip } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Delta } from "@/components/ui/Delta";
import { Icon, type IconName } from "@/components/ui/icons";
import { Absent, Read } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { Table } from "@/components/ui/Table";
import { Thumb } from "@/components/ui/Thumb";
import { Tile, Tiles } from "@/components/ui/Tile";
import { Info } from "@/components/ui/Tooltip";
import { DASH, duration, fullDate, num, percent } from "@/lib/format";
import { Expand } from "./Expand";
import { GeoList } from "./GeoList";
import { deviceLabel, engagedSort, engagedText, gaWord } from "./words";
import "./traffic.css";

/* ---------- the head's note and the specimen ribbon ----------------------- */

/** The one quiet line under the head: whose visits these are, and from when. */
export function TrafficNote({ period }: { period: Reading<TrafficPeriod> }) {
  const p = period.state === "ok" ? period.value : null;
  /* "21 Sep" inside a sentence that already names the year once. */
  const day = (d: string) => fullDate(d).replace(/ \d{4}$/, "");
  return (
    <p className="dk-traffic-note">
      <Icon name="info" size={14} />
      <span>
        GA4 counts only visitors who accepted the cookie banner, so every figure here is an undercount.
        {p ? (
          <>
            {" "}
            Measured since {fullDate(p.since)}
            {p.partial ? `: this range covers ${day(p.since > p.start ? p.since : p.start)} to ${day(p.end)} only` : ""}
            {p.previous ? `. Changes are against ${day(p.previous.start)} to ${day(p.previous.end)}.` : ". Changes show once a whole earlier period is measured."}
          </>
        ) : null}
      </span>
    </p>
  );
}

/** Says, where nobody can miss it, that some rows on the screen are made up. */
export function SpecimenRibbon() {
  return (
    <p className="dk-traffic-ribbon" role="note">
      <Icon name="flask" size={14} />
      <b>Specimen data</b>
      <span>The Clarity panel shows artificial rows because Clarity is not connected. None of its figures is real; everything else on the screen is.</span>
    </p>
  );
}

/* ---------- tiles ----------------------------------------------------------- */

/**
 * The engagement-time tile. Tile prints seconds as "426s"; a person reads
 * "7m 06s". Same anatomy and classes as Tile, with the figure printed as a
 * duration.
 */
function DurationTile({ label, reading, info }: { label: string; reading: Reading<TrafficTimeStat>; info: ReactNode }) {
  if (reading.state !== "ok") return <Tile label={label} reading={reading} info={info} />;
  const s = reading.value;
  /* Days nobody visited are gaps in the line, never zeros. */
  const drawn = s.daily.filter((v) => v !== null).length;
  return (
    <article className="dk-tile">
      <div className="dk-tile-main">
        <div className="dk-tile-top">
          <h3 className="dk-tile-label">
            <span className="dk-tile-label-text">{label}</span>
            <Info text={info} />
          </h3>
        </div>
        <div className="dk-tile-row">
          <div className="dk-tile-figures">
            <p className="dk-tile-figure dk-num">
              <span className="dk-tile-value">{duration(s.value * 1000)}</span>
            </p>
            <p className="dk-tile-under">
              <Delta value={s.value} previous={s.previous} unit="s" />
            </p>
            <Stamp reading={reading} />
          </div>
          {drawn > 1 ? (
            <div className="dk-tile-chart">
              <Spark data={s.daily} />
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function TrafficTileRow({ tiles }: { tiles: TrafficTiles }) {
  return (
    <Tiles count={6} className="dk-traffic-tiles">
      <Tile
        label="Visitors"
        reading={tiles.visitors}
        info="People who opened the website in the period, each counted once however often they came (GA4 active users)."
        chart={(s) => <Spark data={s.series} />}
      />
      <Tile label="Sessions" reading={tiles.sessions} info="Visits: a session ends after 30 minutes without activity." chart={(s) => <Spark data={s.series} />} />
      <Tile label="Page views" reading={tiles.views} info="Every page shown, reloads and repeat views included." chart={(s) => <Spark data={s.series} />} />
      <Tile
        label="Engaged sessions"
        reading={tiles.engaged}
        info="Sessions that lasted ten seconds or more, saw two pages or more, or sent a key event, as GA4 defines engagement. The line under the figure is the share of all sessions; under thirty sessions it is the two counts."
        chart={(s) => <SparkBars data={s.series} />}
      />
      <DurationTile
        label="Avg. engagement time"
        reading={tiles.engagementTime}
        info="Time a page of the website was in the foreground, added up over everyone and divided by visitors (GA4's average engagement time per active user)."
      />
      <Tile
        label="New visitors"
        reading={tiles.newVisitors}
        info="Browsers GA4 had not seen before. Clearing cookies or a new device counts as new."
        chart={(s) => <SparkBars data={s.series} />}
      />
    </Tiles>
  );
}

/* ---------- visitors per day ---------------------------------------------- */

export function VisitorsPanel({ reading }: { reading: Reading<TrafficPerDay> }) {
  return (
    <Card title="Visitors per day" icon="line-chart" className="dk-traffic-visitors" right={<Stamp reading={reading} />}>
      <Read reading={reading}>
        {(v) => (
          <div className="dk-traffic-chart">
            <div className="dk-traffic-headline">
              <p className="dk-traffic-headline-figure dk-num">
                <b>{num(v.total)}</b>
                <span>{v.total === 1 ? "visitor" : "visitors"}</span>
              </p>
              {v.previous !== null ? (
                <p className="dk-traffic-headline-delta">
                  <Delta value={v.total} previous={v.previous} />
                  <span>vs previous period</span>
                </p>
              ) : (
                <p className="dk-traffic-headline-delta dk-traffic-quiet">No earlier period measured yet</p>
              )}
              <Legend
                className="dk-traffic-headline-legend"
                items={[
                  { label: "Visitors" },
                  ...(v.previous !== null
                    ? [
                        {
                          label: "Previous period",
                          mark: "dash" as const,
                          color: "grey" as const,
                        },
                      ]
                    : []),
                ]}
              />
            </div>
            <AreaChart
              label="Visitors per day"
              series={v.points}
              previousLabel="Same day, previous period"
              provisional={v.provisional}
              provisionalNote="GA4 may still change this day's figure."
              height="fill"
              className="dk-traffic-area"
            />
          </div>
        )}
      </Read>
    </Card>
  );
}

/* ---------- channels ---------------------------------------------------- */

/** Under this many in the whole, a share is noise: the legend gives the two counts instead ("3 of 5"). */
const SHARE_FLOOR = 30;

/** Under thirty in all, each part as "n of total"; from thirty on, undefined (the percentages stand). */
function smallShares(slices: DonutSlice[]): string[] | undefined {
  const total = slices.reduce((n, s) => n + s.value, 0);
  return total >= SHARE_FLOOR ? undefined : slices.map((s) => `${num(s.value)} of ${num(total)}`);
}

/** A donut's legend: shares and counts, or under thirty in all, each part as "n of total". */
function legendOf(slices: DonutSlice[]): LegendItem[] {
  const small = smallShares(slices);
  if (!small) return sliceLegend(slices);
  return sliceLegend(slices).map((item, i) => ({ ...item, share: small[i], value: undefined }));
}

/** Six colours: a seventh group and after are folded into one "Other" slice. */
function slicesOf(rows: { key: string; label: string; value: number }[]): DonutSlice[] {
  if (rows.length <= 6) return rows.map((r) => ({ key: r.key, label: r.label, value: r.value }));
  const head = rows.slice(0, 5).map((r) => ({ key: r.key, label: r.label, value: r.value }));
  const rest = rows.slice(5).reduce((n, r) => n + r.value, 0);
  return [...head, { key: "other", label: "Other", value: rest }];
}

export function ChannelsPanel({ reading }: { reading: Reading<TrafficChannels> }) {
  return (
    <Card
      title="Channels"
      icon="pie"
      className="dk-traffic-channels"
      info={reading.state === "ok" ? reading.value.note : "How sessions arrived: Google's default channel groups, with LinkedIn as its own."}
      right={<Stamp reading={reading} />}
    >
      <Read reading={reading}>
        {(v) => {
          const slices = slicesOf(
            v.rows.map((r) => ({
              key: r.key,
              label: r.label,
              value: r.sessions,
            })),
          );
          return v.sessions === 0 ? (
            <p className="dk-traffic-quiet">GA4 recorded no sessions in this period.</p>
          ) : (
            <div className="dk-traffic-donut">
              <Donut label="Sessions by channel" slices={slices} shares={smallShares(slices)} caption={v.sessions === 1 ? "Session" : "Sessions"} />
              <Legend layout="column" items={legendOf(slices)} className="dk-traffic-donut-legend" />
            </div>
          );
        }}
      </Read>
    </Card>
  );
}

/* ---------- sources and mediums ------------------------------------------ */

export function SourcesPanel({ reading }: { reading: Reading<TrafficSourceRow[]> }) {
  return (
    <Card
      title="Sources and mediums"
      icon="link"
      flush
      className="dk-traffic-sources"
      count={reading.state === "ok" ? reading.value.length : undefined}
      info="Where each session came from as GA4 reads it: the referring site or search engine (source) and the kind of link (medium). Direct is a visit with no referrer, which also takes in every visit whose referrer was lost."
      right={<Stamp reading={reading} />}
    >
      <Read reading={reading}>
        {(rows) => (
          <Expand total={rows.length} shown={6} noun="pairs">
            <Table
              caption="Sessions by source and medium"
              rows={rows}
              rowKey={(r) => `${r.source} / ${r.medium}`}
              empty="GA4 recorded no sessions in this period."
              minWidth={360}
              columns={[
                {
                  key: "pair",
                  head: "Source / medium",
                  cell: (r) => (
                    <span className="dk-traffic-pair">
                      <span>{gaWord(r.source)}</span>
                      <span className="dk-traffic-pair-medium">/ {gaWord(r.medium)}</span>
                    </span>
                  ),
                  sort: (r) => `${r.source} ${r.medium}`,
                },
                {
                  key: "sessions",
                  head: "Sessions",
                  numeric: true,
                  cell: (r) => num(r.sessions),
                  sort: (r) => r.sessions,
                  width: "18%",
                },
                {
                  key: "engaged",
                  head: "Engaged",
                  numeric: true,
                  cell: (r) => engagedText(r.engagedSessions, r.sessions),
                  sort: (r) => engagedSort(r.engagedSessions, r.sessions),
                  width: "18%",
                },
                {
                  key: "change",
                  head: "Change",
                  numeric: true,
                  cell: (r) => <Delta size="sm" value={r.sessions} previous={r.previous} />,
                  width: "16%",
                },
              ]}
            />
          </Expand>
        )}
      </Read>
    </Card>
  );
}

/* ---------- landing pages ------------------------------------------------- */

export function LandingPanel({ reading }: { reading: Reading<TrafficLandingRow[]> }) {
  const missingEnquiries = reading.state === "ok" && reading.value.some((r) => r.enquiries === null);
  return (
    <Card
      title="Landing pages"
      icon="target"
      flush
      className="dk-traffic-landing"
      count={reading.state === "ok" ? reading.value.length : undefined}
      info="The page each session began on. Enquiries are the website's generate_lead events in sessions that began on that page, as GA4 counts them: consenting visitors only, so the engine's own count on Conversions is the complete one."
      right={<Stamp reading={reading} />}
    >
      <Read reading={reading}>
        {(rows) => (
          <Expand total={rows.length} shown={6} noun="landing pages">
            <Table
              caption="Where sessions began"
              rows={rows}
              rowKey={(r) => r.path}
              density="roomy"
              empty="GA4 recorded no sessions in this period."
              minWidth={520}
              columns={[
                {
                  key: "page",
                  head: "Page",
                  cell: (r) => (
                    <span className="dk-traffic-landing-cell">
                      <Thumb src={r.picture} icon="file" />
                      <span className="dk-traffic-page">
                        <span className="dk-traffic-page-path">{r.path === "(not set)" ? "No page recorded" : r.path}</span>
                        {r.title ? <span className="dk-traffic-page-title">{r.title}</span> : null}
                      </span>
                    </span>
                  ),
                  sort: (r) => r.path,
                },
                {
                  key: "sessions",
                  head: "Sessions",
                  numeric: true,
                  cell: (r) => num(r.sessions),
                  sort: (r) => r.sessions,
                  width: "13%",
                },
                {
                  key: "engaged",
                  head: "Engaged",
                  numeric: true,
                  cell: (r) => engagedText(r.engagedSessions, r.sessions),
                  sort: (r) => engagedSort(r.engagedSessions, r.sessions),
                  width: "13%",
                },
                {
                  key: "enquiries",
                  head: "Enquiries",
                  numeric: true,
                  cell: (r) => (r.enquiries === null ? DASH : num(r.enquiries)),
                  sort: (r) => r.enquiries,
                  width: "13%",
                },
                {
                  key: "change",
                  head: "Change",
                  numeric: true,
                  cell: (r) => <Delta size="sm" value={r.sessions} previous={r.previous} />,
                  width: "13%",
                },
              ]}
            />
          </Expand>
        )}
      </Read>
      {missingEnquiries ? <p className="dk-traffic-foot-note">The enquiry column could not be read this time; reload to try again.</p> : null}
    </Card>
  );
}

/* ---------- devices ------------------------------------------------------- */

export function DevicesPanel({ reading }: { reading: Reading<TrafficDeviceRow[]> }) {
  return (
    <Card
      title="Devices"
      icon="layers"
      className="dk-traffic-devices"
      info="Visitors by the kind of device GA4 saw them on. Somebody who came on two devices is counted on both."
      right={<Stamp reading={reading} />}
    >
      <Read reading={reading}>
        {(rows) => {
          const slices = rows.map((r) => ({
            key: r.key,
            label: deviceLabel(r.key),
            value: r.users,
          }));
          const total = slices.reduce((n, s) => n + s.value, 0);
          return total === 0 ? (
            <p className="dk-traffic-quiet">GA4 recorded no visitors in this period.</p>
          ) : (
            <div className="dk-traffic-donut dk-traffic-donut--small">
              <Donut label="Visitors by device" slices={slices} shares={smallShares(slices)} size="small" caption={total === 1 ? "Visitor" : "Visitors"} />
              <Legend layout="column" items={legendOf(slices)} className="dk-traffic-donut-legend" />
            </div>
          );
        }}
      </Read>
    </Card>
  );
}

/* ---------- countries and cities -------------------------------------------- */

export function CountriesPanel({ countries, cities }: { countries: Reading<TrafficCountryRow[]>; cities: Reading<TrafficCities> }) {
  return (
    <Card
      title="Countries"
      icon="globe"
      className="dk-traffic-countries"
      info="Visitors by the country and city GA4 places them in, from their connection. A visitor GA4 could not place is listed as unknown."
      right={<Stamp reading={countries} />}
    >
      <Read reading={countries}>
        {(rows) => {
          /* Shares only from thirty visitors on; under that the counts say it. */
          const total = rows.reduce((n, r) => n + r.users, 0);
          const shares = total >= SHARE_FLOOR ? shareTexts(rows.map((r) => r.users)) : rows.map(() => "");
          return rows.length === 0 ? (
            <p className="dk-traffic-quiet">GA4 recorded no visitors in this period.</p>
          ) : (
            <div className="dk-traffic-geo">
              <WorldMap
                label="Visitors by country"
                countries={rows.map((r) => ({
                  code: r.code,
                  value: r.users,
                  name: r.name,
                }))}
                className="dk-traffic-map"
              />
              <div className="dk-traffic-geo-lists">
                <div className="dk-traffic-geo-col">
                  <h3 className="dk-traffic-sub-head">Countries</h3>
                  <GeoList
                    label="Countries"
                    noun={["country", "countries"]}
                    total={rows.length}
                    rows={rows.map((r, i) => ({ key: r.code ?? r.name, code: r.code, name: gaWord(r.name), share: shares[i], users: r.users }))}
                  />
                </div>
                <div className="dk-traffic-geo-col">
                  <h3 className="dk-traffic-sub-head">Cities</h3>
                  {cities.state !== "ok" ? (
                    <Absent reading={cities} form="tile" />
                  ) : cities.value.rows.length === 0 ? (
                    <p className="dk-traffic-quiet">No city recorded.</p>
                  ) : (
                    <GeoList
                      label="Cities"
                      noun={["city", "cities"]}
                      plain
                      total={cities.value.total}
                      rows={cities.value.rows.map((c) => ({ key: `${c.city} ${c.code}`, code: c.code, name: gaWord(c.city, "Unknown city"), users: c.users }))}
                    />
                  )}
                </div>
              </div>
            </div>
          );
        }}
      </Read>
    </Card>
  );
}

/* ---------- events ---------------------------------------------------------- */

export function EventsPanel({ reading }: { reading: Reading<TrafficEventRow[]> }) {
  return (
    <Card
      title="Events the website sends"
      icon="flag"
      flush
      className="dk-traffic-events"
      count={reading.state === "ok" ? reading.value.length : undefined}
      info="Everything GA4 recorded in the period, so you can see what is measured at all. Marked Website: the five events the website's own code sends. The rest GA4 collects by itself. Key: marked as a key event in GA4 Admin."
      right={<Stamp reading={reading} />}
    >
      <Read reading={reading}>
        {(rows) => (
          <Expand total={rows.length} shown={8} noun="events">
            <Table
              caption="Events GA4 recorded"
              rows={rows}
              rowKey={(r) => r.name}
              density="roomy"
              empty="GA4 recorded no events in this period."
              minWidth={540}
              columns={[
                {
                  key: "event",
                  head: "Event",
                  cell: (r) => (
                    <span className="dk-traffic-event">
                      <span className="dk-traffic-event-name">
                        <code>{r.name}</code>
                        {r.ours ? <Chip tone="good">Website</Chip> : null}
                        {r.key ? <Chip tone="info">Key</Chip> : null}
                      </span>
                      <span className="dk-traffic-page-title">{r.what ?? "Not described"}</span>
                    </span>
                  ),
                  sort: (r) => r.name,
                },
                {
                  key: "count",
                  head: "Count",
                  numeric: true,
                  cell: (r) => num(r.count),
                  sort: (r) => r.count,
                  width: "12%",
                },
                {
                  key: "users",
                  head: "Visitors",
                  numeric: true,
                  cell: (r) => num(r.users),
                  sort: (r) => r.users,
                  width: "12%",
                },
                {
                  key: "daily",
                  head: "Per day",
                  align: "right",
                  cell: (r) => (r.daily.length ? <SparkBars data={r.daily} size="row" label={`${r.name} per day`} /> : DASH),
                  width: "16%",
                },
                {
                  key: "change",
                  head: "Change",
                  numeric: true,
                  cell: (r) => <Delta size="sm" value={r.count} previous={r.previous} />,
                  width: "12%",
                },
              ]}
            />
          </Expand>
        )}
      </Read>
    </Card>
  );
}

/* ---------- Clarity --------------------------------------------------------- */

function ClarityFigure({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="dk-traffic-cfig">
      <dt>{label}</dt>
      <dd className="dk-num">{value === null ? DASH : num(value)}</dd>
    </div>
  );
}

export function ClarityPanel({ reading, links, specimen = false }: { reading: Reading<TrafficClarity>; links: TrafficLinks["clarity"]; specimen?: boolean }) {
  return (
    <Card
      title="Behaviour per page"
      icon="eye"
      flush
      className="dk-traffic-clarity"
      sub="Microsoft Clarity, once a day: its API answers ten requests a day, so this can only ever be a daily snapshot."
      info="Clarity loads only for visitors who allowed session recording, a different switch from GA4's, so its figures will not agree with GA4's. Recordings and heatmaps exist only in Clarity itself: no API gives them."
      right={
        <>
          {specimen ? (
            <Chip tone="warn" caps icon="flask">
              Specimen
            </Chip>
          ) : (
            <Stamp reading={reading} />
          )}
          <LinkButton href={links.dashboard} size="sm" iconRight="external">
            Open Clarity
          </LinkButton>
        </>
      }
    >
      {reading.state !== "ok" ? (
        <div className="dk-traffic-pad dk-traffic-clarity-off">
          <Absent reading={reading} />
          <div className="dk-traffic-clarity-will">
            <p className="dk-traffic-sub-head">Once connected, for every address</p>
            <ul className="dk-traffic-clarity-measures">
              {["Sessions", "Scroll depth", "Active time", "Rage clicks", "Dead clicks", "Quick backs", "Script errors"].map((m) => (
                <li key={m}>
                  <Chip>{m}</Chip>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <ClarityBody v={reading.value} />
      )}
    </Card>
  );
}

function ClarityBody({ v }: { v: TrafficClarity }) {
  return (
    <>
      <dl className="dk-traffic-cfigs">
        <ClarityFigure label="Sessions" value={v.sessions} />
        <ClarityFigure label="Rage clicks" value={v.rageClicks} />
        <ClarityFigure label="Dead clicks" value={v.deadClicks} />
        <ClarityFigure label="Quick backs" value={v.quickBacks} />
        <ClarityFigure label="Script errors" value={v.scriptErrors} />
      </dl>
      <p className="dk-traffic-cnote">
        Snapshot of {fullDate(v.day)}, covering {v.span === 1 ? "the 24 hours before it" : `the ${v.span} days before it`}. {num(v.callsLeft)} of Clarity&apos;s ten requests are
        left today.
      </p>
      <Expand total={v.rows.length} shown={6} noun="addresses">
        <Table
          caption="Clarity's figures per address"
          rows={v.rows}
          rowKey={(r) => r.path}
          empty="The newest snapshot has no addresses."
          minWidth={760}
          columns={[
            {
              key: "page",
              head: "Page",
              cell: (r) => r.path,
              sort: (r) => r.path,
            },
            {
              key: "sessions",
              head: "Sessions",
              numeric: true,
              cell: (r) => num(r.sessions),
              sort: (r) => r.sessions,
            },
            {
              key: "scroll",
              head: "Scroll depth",
              numeric: true,
              cell: (r) => percent(r.scrollDepth, 0),
              sort: (r) => r.scrollDepth,
            },
            {
              key: "time",
              head: "Active time",
              numeric: true,
              cell: (r) => (r.activeTime === null ? DASH : duration(r.activeTime * 1000)),
              sort: (r) => r.activeTime,
            },
            {
              key: "rage",
              head: "Rage",
              numeric: true,
              cell: (r) => num(r.rageClicks),
              sort: (r) => r.rageClicks,
            },
            {
              key: "dead",
              head: "Dead",
              numeric: true,
              cell: (r) => num(r.deadClicks),
              sort: (r) => r.deadClicks,
            },
            {
              key: "quick",
              head: "Quick backs",
              numeric: true,
              cell: (r) => num(r.quickBacks),
              sort: (r) => r.quickBacks,
            },
            {
              key: "errors",
              head: "Script errors",
              numeric: true,
              cell: (r) => num(r.scriptErrors),
              sort: (r) => r.scriptErrors,
            },
          ]}
        />
      </Expand>
    </>
  );
}

/* ---------- what is not measured --------------------------------------------- */

function Unknown({ icon, head, children }: { icon: IconName; head: string; children: ReactNode }) {
  return (
    <li className="dk-traffic-unknown">
      <span className="dk-traffic-unknown-icon" aria-hidden>
        <Icon name={icon} size={16} />
      </span>
      <span className="dk-traffic-unknown-text">
        <b>{head}</b>
        <span>{children}</span>
      </span>
    </li>
  );
}

export function UnmeasuredPanel({ period }: { period: Reading<TrafficPeriod> }) {
  const since = period.state === "ok" ? fullDate(period.value.since) : null;
  return (
    <Card title="What is not measured" icon="help" tone="warn" className="dk-traffic-unmeasured">
      <ul className="dk-traffic-unknowns">
        <Unknown icon="lock" head="Visitors who decline cookies">
          They are not counted anywhere on this screen. GA4 and Clarity load only after the cookie banner is accepted, each with its own switch, so every figure is an undercount
          and the two will not agree.
        </Unknown>
        <Unknown icon="link" head="Which visit an enquiry came from">
          An enquiry in the engine cannot be matched to the visit it came from: the site records no referrer or campaign with an enquiry. Only GA4&apos;s generate_lead
          events (consenting visitors, no names) carry a landing page and source.
        </Unknown>
        <Unknown icon="pulse" head="Live visitors by address or source">
          GA4&apos;s realtime report gives page titles, countries and devices only, and it counts every site that sends to the same property.
        </Unknown>
        <Unknown icon="calendar" head={since ? `Anything before ${since}` : "Anything before measurement began"}>
          Days before the website&apos;s first GA4 data are not zero; they were not measured, so no range reaches back past them.
        </Unknown>
      </ul>
    </Card>
  );
}

/* ---------- quick actions ------------------------------------------------------ */

export function TrafficActions({ links }: { links: TrafficLinks }) {
  /* Recordings and heatmaps are pages of the website's Clarity project. Until
     its id is set every Clarity link is the list of projects, so there is one
     action that says where to go from there, not two that promise a page. */
  const clarity: ActionItem[] = links.clarity.project
    ? [
        {
          icon: "play",
          label: "Watch recordings in Clarity",
          description: "Sessions replayed, in Clarity itself",
          href: links.clarity.recordings,
        },
        {
          icon: "target",
          label: "Open heatmaps in Clarity",
          description: "Where visitors click and how far they scroll",
          href: links.clarity.heatmaps,
        },
      ]
    : [
        {
          icon: "eye",
          label: "Open Clarity",
          description: "Pick the website's project, then Recordings or Heatmaps",
          href: links.clarity.dashboard,
        },
      ];
  return (
    <Card title="Quick actions" icon="bolt" className="dk-traffic-actions">
      <ActionList
        label="Quick actions"
        items={[
          {
            icon: "bar-chart",
            label: "Open Google Analytics",
            description: "The property's own reports and explorations",
            href: links.analytics,
          },
          ...clarity,
          {
            icon: "funnel",
            label: "See what converts",
            description: "Enquiries and booked calls on Conversions",
            href: "/conversions",
          },
          {
            icon: "search",
            label: "See search performance",
            description: "Queries, clicks and positions on SEO",
            href: "/seo",
          },
        ]}
      />
    </Card>
  );
}
