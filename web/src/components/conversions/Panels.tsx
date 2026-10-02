import type { Reading } from "@/contract/common";
import type { ChannelData, ConversionsRange, FunnelData, GroupList, RecentLead, StartsData, TopPage, TopPages, TrendData } from "@/contract/conversions";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { LinkButton } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { Thumb } from "@/components/ui/Thumb";
import { Table } from "@/components/ui/Table";
import { Tooltip } from "@/components/ui/Tooltip";
import { Stamp } from "@/components/ui/Stamp";
import { ActionList } from "@/components/ui/ActionList";
import { Funnel } from "@/components/charts/Funnel";
import { Donut } from "@/components/charts/Donut";
import { Legend } from "@/components/charts/Legend";
import { slotColor } from "@/components/charts/series";
import { Bar, BarList } from "@/components/charts/BarList";
import { ComboChart } from "@/components/charts/ComboChart";
import { clock, DASH, fullDate, num, percent, shortDate, zurich } from "@/lib/format";
import { PanelAbsent, PanelBody, SMALL, groupItems, pathOf, shareOf, stageOf } from "./parts";
import { PanelRange } from "./PanelRange";
import "./conversions.css";

/* ---------- Conversion funnel ------------------------------------------------ */

/**
 * Straight column heights while the steps are close enough to compare by eye
 * (the largest at most ten times the smallest), so no caption about a
 * logarithmic scale is needed; past that the shared funnel's log scale, which
 * says so under the columns.
 */
function funnelScale(values: readonly number[]): "linear" | "log" {
  const drawn = values.filter((v) => v > 0);
  return drawn.length && Math.max(...drawn) <= 10 * Math.min(...drawn) ? "linear" : "log";
}

/** "Measured from Sep 21", when a period begins before GA4 measured the website. */
const measuredText = (since: string | null): string | null => (since ? `Measured from ${shortDate(since)}` : null);

export function FunnelPanel({ reading, page }: { reading: Reading<FunnelData>; page: ConversionsRange }) {
  const v = reading.state === "ok" ? reading.value : null;
  return (
    <Card
      title="Conversion funnel"
      icon="funnel"
      sub="Visitor to booked call conversion"
      info="Each step is a GA4 count in the period, named under its label by the event behind it. These are event counts from an open funnel, not one visitor followed from step to step, so a step can be larger than the one before it. While a step has fewer than thirty, no percentage is printed: the counts say it. Consenting visitors only."
      right={<PanelRange param="funnel" page={page} label="Period of the conversion funnel" />}
      className="dk-conversions-card"
    >
      {v && reading.state === "ok" ? (
        <PanelBody
          reading={reading}
          extra={
            <span className="dk-conversions-foot-note">
              Event counts, not one visitor&apos;s path{v.partial ? ` · measured from ${shortDate(v.since)}` : ""}
            </span>
          }
        >
          <div className="dk-conversions-funnel">
            <Funnel
              steps={v.steps.map((s) => ({ label: s.label, value: s.value, note: s.event }))}
              scale={funnelScale(v.steps.map((s) => s.value))}
              small={SMALL}
              label="Visitor to booked call conversion, GA4 event counts"
            />
          </div>
        </PanelBody>
      ) : (
        <PanelAbsent reading={reading} compact />
      )}
    </Card>
  );
}

/* ---------- Enquiries by channel (GA4) ------------------------------------------ */

export function ChannelsPanel({ reading, page }: { reading: Reading<ChannelData>; page: ConversionsRange }) {
  const v = reading.state === "ok" ? reading.value : null;
  /* Under thirty enquiries a share is printed as its two counts ("3 of 5"), in the legend and in the donut's middle alike. */
  const shares = v ? v.slices.map((s) => shareOf(s.value, v.total)) : [];
  const since = v ? measuredText(v.measuredFrom) : null;
  return (
    <Card
      title="Enquiries by channel (GA4)"
      icon="pie"
      info="generate_lead events by the channel of the session they were sent in, as GA4 groups channels, with LinkedIn as a group of its own. The engine's enquiries carry no source, so this is GA4's count only: consenting visitors. Under thirty enquiries a share is printed as its two counts."
      right={<PanelRange param="channels" page={page} label="Period of enquiries by channel" />}
      className="dk-conversions-card dk-conversions-card--wrap"
    >
      {v && reading.state === "ok" ? (
        <PanelBody reading={reading} extra={since ? <span className="dk-conversions-foot-note">{since}</span> : undefined}>
          {v.total > 0 ? (
            <div className="dk-conversions-donut">
              <Donut slices={v.slices} shares={shares} label="generate_lead events by channel" caption={v.total === 1 ? "Enquiry" : "Enquiries"} />
              <Legend
                layout="column"
                items={v.slices.map((s, i) => ({ label: s.label, color: slotColor(i), share: shares[i], value: v.total >= SMALL ? num(s.value) : undefined }))}
                className="dk-conversions-legend"
              />
            </div>
          ) : (
            <p className="dk-conversions-none">GA4 counted no generate_lead event in this period.</p>
          )}
        </PanelBody>
      ) : (
        <PanelAbsent reading={reading} compact />
      )}
    </Card>
  );
}

/* ---------- Top converting pages ---------------------------------------------- */

function PageRows({ rows, floor, all }: { rows: readonly TopPage[]; floor: number; all?: boolean }) {
  const top = Math.max(0, ...rows.map((r) => r.rate ?? 0));
  return (
    <div className="dk-conversions-pages" data-all={all ? "" : undefined} role="table" aria-label="Pages enquiries were sent from">
      <div className="dk-conversions-pages-head" role="row">
        <span role="columnheader">Page</span>
        <span role="columnheader">Enquiries</span>
        {all ? <span role="columnheader">Sessions</span> : null}
        <span role="columnheader">Rate</span>
      </div>
      {rows.map((r) => (
        <div key={r.path} className="dk-conversions-pages-row" role="row">
          <span className="dk-conversions-pages-page" role="cell">
            <Thumb src={r.picture} size="sm" icon="pages" />
            <span className="dk-conversions-pages-path" title={r.title ?? r.path}>
              {r.path}
            </span>
          </span>
          <span className="dk-num" role="cell">
            {num(r.enquiries)}
          </span>
          {all ? (
            <span className="dk-num" role="cell">
              {r.sessions === null ? DASH : num(r.sessions)}
            </span>
          ) : null}
          <span className="dk-conversions-pages-rate" role="cell">
            {r.rate !== null ? (
              <>
                <span className="dk-num">{percent(r.rate, r.rate < 10 ? 1 : 0)}</span>
                <Bar value={r.rate} max={top || 100} />
                {/* A rate from fewer than thirty enquiries is printed with the two counts it is made of. */}
                {r.enquiries < SMALL && r.sessions !== null ? (
                  <span className="dk-conversions-pages-counts dk-num">
                    {num(r.enquiries)} in {num(r.sessions)} sessions
                  </span>
                ) : null}
              </>
            ) : (
              <Tooltip text={`A rate is printed once a page has been seen in ${floor} sessions in the period. ${r.sessions === null ? "GA4 has no sessions for this page." : `This one has ${num(r.sessions)}.`}`}>
                <span className="dk-conversions-pages-few" tabIndex={0}>
                  {r.sessions === null ? "no sessions" : `${num(r.sessions)} ${r.sessions === 1 ? "session" : "sessions"}`}
                </span>
              </Tooltip>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/** How many rows a list panel shows before "View all" has more to open. */
const SHOWN = 5;

export function TopPagesPanel({ reading }: { reading: Reading<TopPages> }) {
  const rows = reading.state === "ok" ? reading.value.rows : [];
  const since = reading.state === "ok" ? measuredText(reading.value.measuredFrom) : null;
  return (
    <Card
      title="Top converting pages"
      icon="bolt"
      info="generate_lead events by the page they were sent from, from GA4. A rate (enquiries per session that saw the page) is printed only where the page was seen in enough sessions for one to mean something, and with its two counts while it rests on fewer than thirty enquiries."
      right={
        reading.state === "ok" && rows.length > SHOWN ? (
          <Dialog title="Pages enquiries were sent from" description="Every page with a generate_lead event in the period, from GA4. Consenting visitors only." trigger={{ label: "View all", variant: "quiet", size: "sm" }}>
            <PageRows rows={rows} floor={reading.value.floor} all />
          </Dialog>
        ) : undefined
      }
      className="dk-conversions-card"
    >
      {reading.state === "ok" ? (
        <PanelBody reading={reading} extra={since ? <span className="dk-conversions-foot-note">{since}</span> : undefined}>
          {rows.length ? <PageRows rows={rows.slice(0, SHOWN)} floor={reading.value.floor} /> : <p className="dk-conversions-none">GA4 counted no generate_lead event on any page in this period.</p>}
        </PanelBody>
      ) : (
        <PanelAbsent reading={reading} compact />
      )}
    </Card>
  );
}

/* ---------- Conversions over time ---------------------------------------------- */

export function TrendPanel({ reading, page }: { reading: Reading<TrendData>; page: ConversionsRange }) {
  const t = reading.state === "ok" ? reading.value : null;
  const provisional = t ? t.days.filter((d) => d.date >= t.provisionalFrom).length : 0;
  return (
    <Card
      title="Conversions over time"
      icon="check-circle"
      info="Per day, from GA4: form submissions (generate_lead) as the line, booked calls (book_meeting) as the bars. Days before GA4 measured the website are left empty, not drawn as zero. Consenting visitors only."
      right={<PanelRange param="trend" page={page} label="Period of conversions over time" />}
      className="dk-conversions-card"
    >
      {t && reading.state === "ok" ? (
        <PanelBody
          reading={reading}
          extra={t.days.some((d) => d.submissions === null) ? <span className="dk-conversions-foot-note">Measured from {shortDate(t.since)}</span> : undefined}
        >
          <Legend
            items={[
              { label: "Form submissions", color: "s1" },
              { label: "Booked calls", color: "s2" },
            ]}
            className="dk-conversions-trend-legend"
          />
          <div className="dk-conversions-trend-plot">
          <ComboChart
            label="Form submissions and booked calls per day, GA4"
            axes="shared"
            lineFill
            bars={{ label: "Booked calls", data: t.days.map((d) => ({ date: d.date, value: d.booked })), color: "s2" }}
            line={{ label: "Form submissions", data: t.days.map((d) => ({ date: d.date, value: d.submissions })), color: "s1" }}
            provisional={provisional}
            provisionalNote="GA4 may still change this day's figures."
            zeroNote="GA4 counted no form submission and no booked call in this period."
            height="fill"
          />
          </div>
        </PanelBody>
      ) : (
        <PanelAbsent reading={reading} compact />
      )}
    </Card>
  );
}

/* ---------- Leads by service, Enquiries by page group ---------------------------- */

/**
 * A list of the engine's groups. The panel is narrow on the board, so what it
 * counts and how is said in the source stamp's note at its foot rather than
 * in an (i) beside a title that would then lose its last word. For the same
 * reason "View all" sits at the foot, right of the stamp, as "Open Clarity"
 * does in the panel beside: "Enquiries by page group" is longer than the
 * board's heading and would otherwise break onto a second line at 1672.
 */
export function GroupPanel({ reading, title, icon, dialogTitle, empty }: { reading: Reading<GroupList>; title: string; icon: "bar-chart" | "layout"; dialogTitle: string; empty: string }) {
  const v = reading.state === "ok" ? reading.value : null;
  /* Only when the panel folds groups into "Other": with five or fewer the dialog would repeat the panel. */
  const all =
    v && v.rows.length > SHOWN ? (
      <Dialog title={dialogTitle} description="Every group in the period, from the engine. One enquiry can sit in several groups." trigger={{ label: "View all", variant: "quiet", size: "sm" }}>
        <BarList label={dialogTitle} items={groupItems(v.rows, v.total)} unit="count" />
      </Dialog>
    ) : undefined;
  return (
    <Card title={title} icon={icon} className="dk-conversions-card dk-conversions-card--wrap">
      {v && reading.state === "ok" ? (
        <PanelBody reading={reading} extra={all}>
          <BarList label={title} items={groupItems(v.rows, v.total, SHOWN)} unit="count" emptyNote={empty} className="dk-conversions-bars" />
        </PanelBody>
      ) : (
        <PanelAbsent reading={reading} compact />
      )}
    </Card>
  );
}

/* ---------- Where enquiries start ----------------------------------------------- */

export function StartsPanel({ reading, heatmaps, direct }: { reading: Reading<StartsData>; heatmaps: string; direct: boolean }) {
  const v = reading.state === "ok" ? reading.value : null;
  /* Without Clarity's project id the link is Clarity's list of projects, and is named so. */
  const clarity = (
    <LinkButton href={heatmaps} size="sm" variant="quiet" iconRight="external" className="dk-conversions-clarity">
      {direct ? "Heatmaps in Clarity" : "Open Clarity"}
    </LinkButton>
  );
  return (
    <Card
      title="Where enquiries start"
      icon="target"
      info={`GA4's generate_lead, book_meeting and invite_shown events by the method the website sends with them. The desk cannot draw a heatmap: Clarity's data export has none, so the button opens Clarity's own${direct ? "." : ": its list of projects, because the desk has no Clarity project id (CLARITY_PROJECT_ID) to open the heatmaps directly."}`}
      className="dk-conversions-card"
    >
      {v && reading.state === "ok" ? (
        <PanelBody reading={reading} extra={clarity}>
          {v.enquiryTotal > 0 ? (
            <BarList
              label="generate_lead events by where they were sent from"
              unit="count"
              className="dk-conversions-bars"
              items={v.enquiries.map((p) => ({ key: p.key, label: p.label, value: p.count, text: shareOf(p.count, v.enquiryTotal) }))}
            />
          ) : (
            <p className="dk-conversions-none">GA4 counted no generate_lead event in this period.</p>
          )}
          <dl className="dk-conversions-starts">
            <div>
              <dt>
                Calls booked <code>book_meeting</code>
              </dt>
              <dd className="dk-num">{num(v.callTotal)}</dd>
            </div>
            <div>
              <dt>
                Sheets shown <code>invite_shown</code>
              </dt>
              <dd className="dk-num">
                {num(v.sheetsShown)}
                {v.sheets > 0 ? <span className="dk-conversions-starts-of"> on {num(v.sheets)} {v.sheets === 1 ? "page" : "pages"}</span> : null}
              </dd>
            </div>
          </dl>
        </PanelBody>
      ) : (
        <div className="dk-conversions-body">
          <PanelAbsent reading={reading} compact />
          <p className="dk-conversions-foot">{clarity}</p>
        </div>
      )}
    </Card>
  );
}

/* ---------- Recent leads & enquiries ---------------------------------------------- */

/** "4 Oct", the table's day-month order; the year only when it is not this one ("4 Jan 2027"). */
function dayMonth(when: string): string {
  const d = fullDate(when);
  const year = zurich(when)?.year;
  return year !== undefined && year === zurich(new Date())?.year ? d.replace(/\s\d{4}$/, "") : d;
}

/** A cell's text cut to its column, whole on hover. A missing value is the dash. */
function Cut({ text, wide }: { text: string | null; wide?: boolean }) {
  if (!text) return <>{DASH}</>;
  return (
    <span className="dk-conversions-cut" data-wide={wide ? "" : undefined} title={text}>
      {text}
    </span>
  );
}

export function RecentPanel({ reading }: { reading: Reading<RecentLead[]> }) {
  const ok = reading.state === "ok";
  return (
    <Card
      title="Recent leads & enquiries"
      icon="users"
      info="The newest enquiries the engine stored, read live and never kept on the desk. Shown only to people the owner has allowed to see leads. The engine records no traffic source, value or assigned owner: the person under Call with is whoever holds the booked call."
      right={
        <LinkButton href="/leads" size="sm" variant="quiet">
          View all leads
        </LinkButton>
      }
      flush={ok}
      className="dk-conversions-card"
    >
      {ok ? (
        <div className="dk-conversions-recent">
          <Table
            caption="Recent enquiries"
            rows={reading.value}
            rowKey={(r) => r.id}
            rowHref={(r) => `/leads?open=${encodeURIComponent(r.id)}`}
            minWidth={880}
            empty="The engine holds no enquiry yet."
            columns={[
              { key: "name", head: "Name", cell: (r) => <Cut text={r.name} /> },
              { key: "company", head: "Company", cell: (r) => <Cut text={r.company} /> },
              { key: "services", head: "Services", cell: (r) => <Cut text={r.services.join(", ") || null} wide /> },
              { key: "page", head: "Page", cell: (r) => <Cut text={pathOf(r.page)} wide /> },
              {
                key: "stage",
                head: "Stage",
                cell: (r) => {
                  const s = stageOf(r.stage);
                  return <Chip tone={s.tone}>{s.label}</Chip>;
                },
              },
              {
                key: "call",
                head: "Booked call",
                cell: (r) =>
                  r.call ? (
                    r.call.cancelled ? (
                      <span className="dk-conversions-cancelled" title={`Booked for ${fullDate(r.call.start)}, ${clock(r.call.start)}, then cancelled`}>
                        Cancelled
                      </span>
                    ) : (
                      <span className="dk-num">
                        {dayMonth(r.call.start)}, {clock(r.call.start)}
                      </span>
                    )
                  ) : (
                    DASH
                  ),
                sort: (r) => r.call?.start ?? null,
              },
              {
                key: "with",
                head: "Call with",
                cell: (r) =>
                  r.call?.with && !r.call.cancelled ? (
                    <span className="dk-conversions-person">
                      <Avatar name={r.call.with} size="sm" />
                      <Cut text={r.call.with} />
                    </span>
                  ) : (
                    DASH
                  ),
              },
              { key: "date", head: "Date", cell: (r) => (r.capturedAt ? fullDate(r.capturedAt) : DASH), sort: (r) => r.capturedAt ?? null },
            ]}
          />
          <p className="dk-conversions-foot dk-conversions-foot--flush">
            <Stamp reading={reading} />
          </p>
        </div>
      ) : (
        <PanelAbsent reading={reading} />
      )}
    </Card>
  );
}

/* ---------- Quick actions ------------------------------------------------------- */

export function QuickActions() {
  return (
    <Card title="Quick actions" icon="bolt" className="dk-conversions-card">
      <ActionList
        label="Quick actions"
        items={[
          { icon: "user", label: "View lead details", description: "Stage, call and timeline", href: "/leads" },
          { icon: "shield-check", label: "Analyze conversion funnel", description: "The AI operator reads the traffic", href: "/operator?do=traffic" },
        ]}
      />
    </Card>
  );
}
