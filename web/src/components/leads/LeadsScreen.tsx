import { Suspense, type ReactNode } from "react";
import type { Reading } from "@/contract/common";
import type { LeadsGroups, LeadsList, LeadsPayload, LeadsRow } from "@/contract/leads";
import { BarList, Legend, SparkBars, type BarListItem } from "@/components/charts";
import { Badge, Chip } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Go } from "@/components/ui/Go";
import { Grid } from "@/components/ui/Grid";
import { Icon, type IconName } from "@/components/ui/icons";
import { Absent, Read } from "@/components/ui/Read";
import { Select } from "@/components/ui/Select";
import { Stamp } from "@/components/ui/Stamp";
import { Table, type Column } from "@/components/ui/Table";
import { Tile, Tiles } from "@/components/ui/Tile";
import { ago, DASH, fullDate, num, rangeLabel } from "@/lib/format";
import { CopyLine } from "./CopyLine";
import { DayBars } from "./DayBars";
import { LeadSheet } from "./LeadSheet";
import { LeadsSearch } from "./LeadsSearch";
import { callTime, intentWords, leadsHref, pageHref, stageLabel, stageTone, stampTime, type LeadsQuery } from "./words";
import "./leads.css";

/**
 * The Leads screen under its head: the connect panel while the engine has no
 * key, the five tiles, the day chart beside By service, By page and By stage,
 * the list with its filters beside the facts every figure here carries, and
 * one enquiry in full when the address names one.
 */
export function LeadsScreen({ data, query }: { data: LeadsPayload; query: LeadsQuery }) {
  const { tiles } = data;
  const period = rangeLabel(data.range).toLowerCase();
  const closeHref = leadsHref(query, null);

  return (
    <div className="dk-leads">
      {data.specimen ? <SpecimenRibbon /> : null}
      {!data.specimen && data.engine.status.state === "off" ? <Connect data={data} /> : null}
      {!data.specimen && data.engine.status.state === "failing" ? <Failing data={data} /> : null}

      <Tiles count={5}>
        <Tile
          label="Enquiries"
          reading={tiles.enquiries}
          info="Enquiries sent through the website's form in this period, counted by the engine per Zurich day, beside the period before when the engine's record covers it."
          chart={(s) => <SparkBars data={s.series} label="Enquiries per day" />}
        />
        <Tile
          label="Booked calls"
          reading={tiles.booked}
          info="Of the enquiries in this period, how many hold a call that was booked and not cancelled. Counted on the day the enquiry came in."
          chart={(s) => <SparkBars data={s.series} tone="s2" label="Booked calls per day" />}
        />
        <Tile
          label="Awaiting a first reply"
          reading={tiles.awaiting}
          info="Of the enquiries in this period, how many nobody at Balkaris has moved on in the engine yet: no stage set by a founder and no update written to the visitor. A call the visitor books moves an enquiry to Meeting confirmed by itself, so that alone does not count as a reply. A reply by email or phone is recorded nowhere. As each stands today: no period before."
        />
        <Tile
          label="In conversation"
          reading={tiles.talking}
          info="Of the enquiries in this period, how many a founder has moved on in the engine: set a stage (processed, expert assigned, a proposal) or written the visitor an update. A call the visitor books by themselves does not count here."
        />
        <Tile
          label="Returning contacts"
          reading={tiles.returning}
          info="Leads with an enquiry in this period who had sent one before. Each lead counts once. The engine keeps a lead's current enquiry and the five before it."
        />
      </Tiles>

      <Grid cols="1.88fr 1fr 1fr 1fr">
        <Card
          title="Enquiries per day"
          icon="bar-chart"
          sub={
            data.perDay.state === "ok" && data.perDay.value.recordBegins
              ? `Enquiries and the calls they booked, ${period}, since ${fullDate(data.perDay.value.recordBegins)}, when the engine's record begins`
              : `Enquiries and the calls they booked, ${period}`
          }
          right={<Stamp reading={data.perDay} />}
        >
          <Read reading={data.perDay}>
            {(v) => (
              <div className="dk-leads-chart">
                <Legend items={[{ label: "Enquiries" }, { label: "Booked calls", color: "s2" }]} />
                <div className="dk-leads-plot">
                  <DayBars
                    label={`Enquiries and booked calls per day, ${period}`}
                    days={v.days}
                    emptyNote="No day of this period is in the engine's record yet."
                    zeroNote="No enquiry came in on any day of this period."
                  />
                </div>
              </div>
            )}
          </Read>
        </Card>
        <GroupCard
          title="By service"
          icon="layers"
          reading={data.byService}
          label="Enquiries by service"
          info="The services each enquiry named, as the website words them. One enquiry may name several, so the rows can add up to more than the enquiries."
        />
        <GroupCard
          title="By page"
          icon="pages"
          reading={data.byPage}
          label="Enquiries by the page the form was sent from"
          info="The page the form was sent from, not where the visitor came from: no traffic source is recorded with an enquiry. Each page links to its detail."
        />
        <GroupCard
          title="By stage"
          icon="funnel"
          reading={data.byStage}
          label="Enquiries by the stage they are in today"
          info="Where each enquiry of this period stands in the engine today, in the order of the engine's stages."
          keepAll
        />
      </Grid>

      <ListCard data={data} query={query} period={period} />

      {data.open ? <LeadSheet reading={data.open} query={query} closeHref={closeHref} /> : null}
    </div>
  );
}

/* ---------- the banners ------------------------------------------------------------ */

function SpecimenRibbon() {
  return (
    <div className="dk-leads-ribbon" role="note">
      <Badge tone="violet" icon="flask">
        Specimen data
      </Badge>
      <p>
        Every name, figure and enquiry on this screen is made up, to show the screen as it will look once the engine is connected. Remove <code>?specimen=1</code> from the
        address to see the real state.
      </p>
    </div>
  );
}

function Connect({ data }: { data: LeadsPayload }) {
  return (
    <Card title="Enquiries are not connected yet" icon="link" tone="warn" sub="This screen reads the website's enquiries from the engine. The desk has no key for that door yet.">
      <div className="dk-leads-connect">
        <div className="dk-leads-connect-what">
          <p className="dk-leads-connect-head">What this screen will show</p>
          <ul>
            <li>The enquiries the engine keeps from the form on balkaris.ch: who sent each, what they asked for, and the page it was sent from.</li>
            <li>Where each one stands in the engine: received, processed, expert assigned, meeting confirmed, proposal in preparation, proposal ready.</li>
            <li>The calls they booked, with whom, and whether a call was cancelled.</li>
            <li>Enquiries per day, per page, per service and per stage, for the period chosen above.</li>
          </ul>
          <p className="dk-leads-connect-note">
            Enquiries are read from the engine on the same server, never more than a minute old. Nothing about an enquiry is copied to the desk or kept here, so
            there is one place it lives and one place to delete it from.
            {data.viewer.seesLeads ? "" : " Once connected you will see the counts; names, contact details and messages are shown only to people the owner allows."}
          </p>
        </div>
        <div className="dk-leads-connect-step">
          <p className="dk-leads-connect-head">The one step</p>
          <p>Once the engine with its enquiry route is deployed, the owner runs this on the workstation:</p>
          <CopyLine line={data.engine.line} label="The command that connects the enquiries" />
          <p className="dk-leads-connect-note">
            It creates one key, puts it into the engine&apos;s settings as DESK_READ_KEY and into the desk&apos;s as ENGINE_READ_KEY, restarts both, and prints only those
            two names. Running it again replaces the key on both sides.
          </p>
        </div>
      </div>
    </Card>
  );
}

function Failing({ data }: { data: LeadsPayload }) {
  const s = data.engine.status;
  return (
    <Card title="The engine is not answering the desk" icon="alert" tone="bad" sub={s.error ?? "The last request for enquiries failed."}>
      {s.step ? (
        <div className="dk-leads-connect-step">
          <p>If the key is the trouble, the owner runs this on the workstation, which replaces it on both sides:</p>
          <CopyLine line={data.engine.line} label="The command that replaces the key" />
        </div>
      ) : (
        <p className="dk-leads-connect-note">Each panel below says what it could not read. A failed read is shown as unknown, never as no enquiries.</p>
      )}
    </Card>
  );
}

/* ---------- By service, By page, By stage ---------------------------------------------- */

const MOST_ROWS = 6;

function GroupCard({
  title,
  icon,
  reading,
  label,
  info,
  keepAll,
}: {
  title: string;
  icon: IconName;
  reading: Reading<LeadsGroups>;
  label: string;
  info: string;
  keepAll?: boolean;
}) {
  return (
    <Card title={title} icon={icon} info={info}>
      <Read reading={reading}>
        {(v) => (
          <div className="dk-leads-groups">
            <Groups value={v} label={label} keepAll={keepAll} />
            <p className="dk-leads-groups-foot">
              <Stamp reading={reading} />
              {v.of > 0 ? (
                <span>
                  of <span className="dk-num">{num(v.of)}</span> {v.of === 1 ? "enquiry" : "enquiries"}
                </span>
              ) : null}
            </p>
          </div>
        )}
      </Read>
    </Card>
  );
}

function Groups({ value, label, keepAll }: { value: LeadsGroups; label: string; keepAll?: boolean }) {
  const { groups, of } = value;
  /* A share of fewer than thirty enquiries is noise: the count alone is shown. */
  const shares = of >= 30;
  const shown = keepAll || groups.length <= MOST_ROWS ? groups : groups.slice(0, MOST_ROWS - 1);
  const rest = keepAll || groups.length <= MOST_ROWS ? [] : groups.slice(MOST_ROWS - 1);
  const items: BarListItem[] = shown.map((g) => ({
    key: g.key || "none",
    label: g.label,
    value: g.count,
    href: g.href,
    text: shares ? `${Math.round((g.count / of) * 100)}%` : num(g.count),
    ...(shares ? { second: num(g.count) } : {}),
  }));
  if (rest.length) {
    const n = rest.reduce((t, g) => t + g.count, 0);
    items.push({ key: "other", label: `Other (${rest.length})`, value: n, text: shares ? `${Math.round((n / of) * 100)}%` : num(n), ...(shares ? { second: num(n) } : {}), tone: "grey" });
  }
  return <BarList items={items} label={label} emptyNote="No enquiry came in during this period." />;
}

/* ---------- the list --------------------------------------------------------------- */

const CALL_OPTIONS = [
  { value: "", label: "Any call" },
  { value: "booked", label: "Call booked" },
  { value: "cancelled", label: "Call cancelled" },
  { value: "none", label: "No call" },
];

function ListCard({ data, query, period }: { data: LeadsPayload; query: LeadsQuery; period: string }) {
  const list = data.list;
  return (
    <Card
      title="Enquiries"
      icon="users"
      count={list.state === "ok" ? num(list.value.total) : undefined}
      sub={`Enquiries received in the ${period}, newest first. Open one to read it in full.`}
      right={<Stamp reading={list} />}
      flush
      footer={
        <div className="dk-leads-about">
          <p className="dk-leads-about-head">
            <Icon name="info" size={14} />
            About these figures
          </p>
          <ul className="dk-leads-facts">
            {data.facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      }
    >
      {list.state === "ok" ? (
        <ListBody list={list.value} query={query} />
      ) : (
        <div className="dk-leads-pad">
          <Absent reading={list} />
        </div>
      )}
    </Card>
  );
}

function ListBody({ list, query }: { list: LeadsList; query: LeadsQuery }) {
  const f = list.filters;
  const filtered = !!(f.q || f.stage || f.group || f.call);
  const clear = leadsHref({ ...query, q: "", stage: "", group: "", call: "" }, null);
  /* Seven columns, in this order: leads.css folds and stacks them by their
     place (Company is the second) when the panel is too narrow for all. */
  const columns: Column<LeadsRow>[] = [
    { key: "name", head: "Name", cell: (r) => <NameCell row={r} />, sort: (r) => r.name ?? r.email ?? "" },
    { key: "company", head: "Company", cell: (r) => <span className="dk-leads-cut">{r.company ?? DASH}</span>, sort: (r) => r.company },
    { key: "asked", head: "Asked for", cell: (r) => <AskedCell row={r} /> },
    { key: "page", head: "Page", cell: (r) => <PageCell row={r} />, sort: (r) => r.page.path },
    { key: "stage", head: "Stage", cell: (r) => <Chip tone={stageTone(r.stage)}>{stageLabel(r.stage)}</Chip>, sort: (r) => r.stage },
    { key: "call", head: "Call", cell: (r) => <CallCell row={r} />, sort: (r) => (r.call ? Date.parse(r.call.start) : null) },
    { key: "received", head: "Received", align: "right", cell: (r) => <ReceivedCell row={r} />, sort: (r) => (r.receivedAt ? Date.parse(r.receivedAt) : null) },
  ];

  return (
    <>
      <div className="dk-leads-filters">
        <Suspense fallback={<span className="dk-leads-search dk-leads-search--wait" />}>
          <LeadsSearch initial={f.q} />
          <Select label="Stage" param="stage" resets={["open"]} options={[{ value: "", label: "Every stage" }, ...list.options.stages]} />
          <Select label="Page group" param="group" resets={["open"]} options={[{ value: "", label: "Every page group" }, ...list.options.groups]} />
          <Select label="Call" param="call" resets={["open"]} options={CALL_OPTIONS} />
        </Suspense>
        <p className="dk-leads-filters-count">
          {filtered ? (
            <>
              <span className="dk-num">{num(list.matched)}</span> of <span className="dk-num">{num(list.total)}</span>
              <Go href={clear} scroll={false} className="dk-leads-clear">
                Clear
              </Go>
            </>
          ) : (
            <>
              <span className="dk-num">{num(list.total)}</span> {list.total === 1 ? "enquiry" : "enquiries"}
            </>
          )}
        </p>
      </div>
      <div className="dk-leads-list">
        <Table
          caption="Enquiries"
          rows={list.rows}
          columns={columns}
          rowKey={(r) => r.id}
          rowHref={(r) => leadsHref(query, r.id)}
          defaultSort={{ key: "received", dir: "desc" }}
          density="roomy"
          keepScroll
          empty={filtered ? "No enquiry in this period matches these filters." : "No enquiry came in during this period."}
        />
      </div>
      {list.cap ? (
        <p className="dk-leads-capnote">
          The newest {num(list.cap)} of {num(list.matched)} are listed. Search or filter to find an older one.
        </p>
      ) : null}
    </>
  );
}

/** Name and address; the company rides along under the name when its own column is folded away (leads.css). */
function NameCell({ row }: { row: LeadsRow }) {
  const email = row.name ? row.email : null;
  return (
    <span className="dk-leads-two dk-leads-who">
      <span className="dk-leads-name">
        <span className="dk-leads-cut">{row.name ?? row.email ?? "No name given"}</span>
        {row.returning ? (
          <Chip tone="info" className="dk-leads-tag">
            Returning
          </Chip>
        ) : null}
      </span>
      {email || row.company ? (
        <span className={email ? "dk-leads-sub dk-leads-cut" : "dk-leads-sub dk-leads-cut dk-leads-sub--fold"}>
          {row.company ? (
            <span className="dk-leads-fold">
              {row.company}
              {email ? " · " : ""}
            </span>
          ) : null}
          {email}
        </span>
      ) : null}
    </span>
  );
}

/** When it came in, and under it the reference the visitor was given. */
function ReceivedCell({ row }: { row: LeadsRow }) {
  return (
    <span className="dk-leads-two dk-leads-when">
      {row.receivedAt ? (
        <time dateTime={row.receivedAt} title={stampTime(row.receivedAt)} suppressHydrationWarning>
          {ago(row.receivedAt)}
        </time>
      ) : (
        <span>{DASH}</span>
      )}
      {row.ref ? <span className="dk-leads-refsub">{row.ref}</span> : null}
    </span>
  );
}

function AskedCell({ row }: { row: LeadsRow }) {
  const intent = intentWords(row.intent);
  const what = row.services.length ? row.services.join(", ") : "No service named";
  return (
    <span className="dk-leads-two dk-leads-what" title={[what, intent].filter(Boolean).join(" · ")}>
      <span className={row.services.length ? "dk-leads-asked" : "dk-leads-asked dk-leads-quiet"}>{what}</span>
      {intent ? <span className="dk-leads-sub dk-leads-cut">{intent}</span> : null}
    </span>
  );
}

function PageCell({ row }: { row: LeadsRow }) {
  if (!row.page.path) return <span className="dk-leads-quiet">Not recorded</span>;
  return (
    <Go href={pageHref(row.page.path)} className="dk-leads-page" title={`${row.page.path} · ${row.page.groupLabel}`}>
      {row.page.path}
    </Go>
  );
}

function CallCell({ row }: { row: LeadsRow }): ReactNode {
  const c = row.call;
  if (!c) return <span className="dk-leads-quiet dk-leads-nocall">{DASH}</span>;
  return (
    <span className={c.cancelled ? "dk-leads-two dk-leads-call dk-leads-call--off" : "dk-leads-two dk-leads-call"}>
      <time dateTime={c.start} className="dk-num">
        {callTime(c.start)}
      </time>
      <span className="dk-leads-sub dk-leads-cut" title={!c.cancelled && c.with ? `with ${c.with}` : undefined}>
        {c.cancelled ? "Cancelled" : c.cancelled === null ? "Cancellation not stated" : c.with ? `with ${c.with}` : "Zurich time"}
      </span>
    </span>
  );
}
