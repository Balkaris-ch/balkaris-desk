import { notFound, redirect } from "next/navigation";
import type { Reading, Stat } from "@/contract/common";
import { Spark, SparkBars } from "@/components/charts";
import { Frame } from "@/components/shell/Frame";
import { Gate } from "@/components/shell/Gate";
import { PageHead } from "@/components/shell/PageHead";
import { ActionList } from "@/components/ui/ActionList";
import { Avatar } from "@/components/ui/Avatar";
import { Badge, Chip, CONTENT_STATUSES, Count, StatusChip, TypeChip } from "@/components/ui/Badge";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card, CardFoot } from "@/components/ui/Card";
import { Delta } from "@/components/ui/Delta";
import { Dialog, DialogActions, DialogClose } from "@/components/ui/Dialog";
import { Empty } from "@/components/ui/Empty";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Grid, Stack } from "@/components/ui/Grid";
import { ICON_NAMES, Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Absent, Read } from "@/components/ui/Read";
import { Select } from "@/components/ui/Select";
import { Skeleton, SkeletonCard, SkeletonTile } from "@/components/ui/Skeleton";
import { Stamp } from "@/components/ui/Stamp";
import { StatusDot } from "@/components/ui/StatusDot";
import { Table } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { Thumb } from "@/components/ui/Thumb";
import { Tile, Tiles } from "@/components/ui/Tile";
import { Timeline } from "@/components/ui/Timeline";
import { Info, Tooltip } from "@/components/ui/Tooltip";
import { askPost } from "@/lib/api";
import { ago, bytes, compact, duration, fullDate, longDate, num, percent, rangeLabel, shortDate } from "@/lib/format";
import "./specimen.css";

/**
 * The primitives' specimen sheet: every one of them, in every state a screen
 * will hand it, inside the real frame.
 *
 * NOTHING HERE IS DATA. Every figure is a round specimen (1,234 or a sine
 * wave), every name is "Specimen A", and every reading says it comes from no
 * source. It exists to be photographed beside the boards and to show the
 * builder of a screen what each state looks like before a real source
 * produces it. The charts have their own sheet at /kit/charts.
 *
 * Development only: on the box this address is a 404.
 */
export const metadata = { title: "Kit" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/* ---------- specimen shapes --------------------------------------------- */

/** A sine wave riding a ramp, oldest first: the shape of something that grows unevenly. */
const wave = (n: number, from: number, to: number, swing: number, period = 5): number[] =>
  Array.from({ length: n }, (_, i) => Math.max(0, Math.round(from + ((to - from) * i) / Math.max(1, n - 1) + swing * Math.sin((i / period) * Math.PI * 2))));

/** A reading with no value: what the absent states are drawn from. */
type Absence = Exclude<Reading<Stat>, { state: "ok" }>;

const NOTE = "A specimen value, not a figure of the website";

/** A specimen reading: `ok`, from no source, read a moment ago. */
const ok = (value: Stat, minutesAgo = 12): Reading<Stat> => ({
  state: "ok",
  value,
  source: "none",
  asOf: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  note: NOTE,
});

const WAITING: Absence = {
  state: "waiting",
  source: "none",
  reason: "Specimen: the source is connected and has nothing to say yet.",
};

const OFF: Absence = {
  state: "off",
  source: "none",
  reason: "Specimen: this source is not connected.",
  step: "Specimen: the step that would connect it, in one sentence.",
};

const OFF_FOR_GOOD: Absence = {
  state: "off",
  source: "none",
  reason: "Specimen: no free source gives this figure.",
};

/**
 * A specimen picture: plainly a drawing, not a page of the website. White at
 * low opacity over a transparent ground, so it takes its colour from the
 * Thumb's own ground and names no colour of the palette (a picture in an
 * <img> cannot read the tokens).
 */
const PICTURE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 60"><rect width="88" height="60" fill="white" fill-opacity=".04"/><circle cx="62" cy="20" r="9" fill="white" fill-opacity=".22"/><path d="M0 60 30 30l18 16 12-10 28 24z" fill="white" fill-opacity=".12"/></svg>',
)}`;

/** A picture address that cannot be drawn, for the fallback. A data address, so the console shows no failed request. */
const BROKEN = "data:image/png;base64,bm90IGEgcGljdHVyZQ==";

interface Row {
  key: string;
  name: string;
  path: string;
  kind: string;
  count: number | null;
  rate: number;
  previous: number | null;
  on: string;
}

const ROWS: Row[] = [
  { key: "a", name: "Specimen A", path: "/specimen/a", kind: "Landing", count: 1234, rate: 2.5, previous: 1000, on: "2000-01-03" },
  { key: "b", name: "Specimen B", path: "/specimen/b", kind: "Service", count: 567, rate: 1.25, previous: 600, on: "2000-01-02" },
  { key: "c", name: "Specimen C", path: "/specimen/c", kind: "Industry", count: 89, rate: 0.5, previous: null, on: "2000-01-01" },
  { key: "d", name: "Specimen D", path: "/specimen/d", kind: "Blog", count: 3, rate: 0, previous: 5, on: "1999-12-31" },
  { key: "e", name: "Specimen E", path: "/specimen/e", kind: "Unknown type", count: null, rate: 0, previous: null, on: "1999-12-30" },
];

/* ---------- the dev-only actions ----------------------------------------- */

/**
 * The quick action's server action: asks the desk server, from this app's
 * server, to run the `repo` job (it reads a local clone and changes nothing).
 * The answer comes back in the address so the sheet can print it.
 */
async function runRepo() {
  "use server";
  if (process.env.NODE_ENV === "production") notFound();
  const a = await askPost("/api/v1/jobs/repo/run");
  const said = a.ok ? "202" : `${a.status} ${a.message}`.slice(0, 140);
  redirect(`/kit?posted=${encodeURIComponent(said)}#actions`);
}

/** The table's form: which rows were ticked, sent back in the address. */
async function pickRows(form: FormData) {
  "use server";
  if (process.env.NODE_ENV === "production") notFound();
  const picked = form.getAll("row").map(String).filter((k) => /^[a-e]$/.test(k));
  redirect(`/kit?picked=${picked.join(",") || "none"}#table`);
}

/* ---------- the sheet ----------------------------------------------------- */

export default async function KitPage({ searchParams }: { searchParams: Search }) {
  if (process.env.NODE_ENV === "production") notFound();

  const q = await searchParams;
  const tab = one(q.tab) ?? "all";
  const posted = one(q.posted);
  const picked = one(q.picked);
  const now = new Date();

  const series = wave(30, 40, 100, 12, 6);
  const bars = wave(24, 10, 30, 8, 4);

  return (
    <Frame>
      <PageHead
        eyebrow="Desk kit"
        title="Primitives"
        subtitle="Every primitive in every state it will be handed. Nothing on this sheet is a figure of the website: the values are specimens."
        ranges
        action={
          <Dialog title="Create specimen" description="A dialog holding a form. Nothing is sent: the form closes itself." trigger={{ label: "Create specimen", variant: "primary", icon: "plus" }}>
            <form method="dialog" className="dk-spec-form">
              <Field label="Title" hint="What a hint under a field looks like.">
                <Input name="title" placeholder="Specimen title" />
              </Field>
              <Field label="Kind">
                <Select
                  name="kind"
                  label="Kind"
                  size="md"
                  options={[
                    { value: "a", label: "Specimen kind A" },
                    { value: "b", label: "Specimen kind B" },
                  ]}
                />
              </Field>
              <Field label="Notes" hint="A hint drawn as an error." error>
                <Textarea name="notes" placeholder="A few lines" rows={3} />
              </Field>
              <DialogActions>
                <DialogClose variant="quiet" />
                <Button type="submit" variant="primary">
                  Close as if saved
                </Button>
              </DialogActions>
            </form>
          </Dialog>
        }
      />

      {/* ---- tiles ---- */}
      <Tiles count={5}>
        <Tile label="Ok, with a spark" info="A tile's (i): how the figure is defined." reading={ok({ value: 12345, previous: 10000, unit: "count", series })} chart={(s) => <Spark data={s.series} />} />
        <Tile label="Part of a whole" reading={ok({ value: 123, previous: 100, unit: "count", series: bars, of: 150, sub: "a small line under it" })} chart={(s) => <SparkBars data={s.series} />} />
        <Tile label="Both under twenty" reading={ok({ value: 5, previous: 3, unit: "count", series: [] })} />
        <Tile label="Down is good" downIsGood reading={ok({ value: 1300, previous: 1800, unit: "ms", series: wave(30, 1800, 1300, 90) })} chart={(s) => <Spark data={s.series} />} />
        <Tile label="No earlier figure" reading={ok({ value: 2.5, previous: null, unit: "percent", series: [] })} />
      </Tiles>

      <Tiles count={6}>
        <Tile label="Waiting" reading={WAITING} />
        <Tile label="Off, with a step" reading={OFF} />
        <Tile label="Off for good" reading={OFF_FOR_GOOD} />
        <Tile label="Icon, change inline" icon="file" delta="inline" noStamp reading={ok({ value: 48, previous: 38, unit: "count", series: bars, sub: "+10 this period" })} chart={(s) => <SparkBars data={s.series} />} />
        <Tile label="Badge, compact" icon="pencil" tone="warn" compact badge={<Badge tone="good" dot>Healthy</Badge>} reading={ok({ value: 123456, previous: 120000, unit: "count", series: [] })} />
        <Tile label="Icon, off" icon="alert" tone="bad" reading={OFF} />
      </Tiles>

      {/* ---- cards and the absent state ---- */}
      <Grid cols="1.6fr 1fr 1fr">
        <Card
          title="A panel with everything"
          icon="line-chart"
          info="A panel's (i): what it shows and where it comes from."
          right={
            <Select
              param="period"
              label="Period"
              options={[
                { value: "30d", label: rangeLabel("30d") },
                { value: "7d", label: rangeLabel("7d") },
                { value: "90d", label: rangeLabel("90d") },
              ]}
            />
          }
          footer={<CardFoot href="/kit">A footer link across the panel</CardFoot>}
        >
          <Read reading={ok({ value: 12345, previous: 10000, unit: "count", series })}>
            {(stat, r) => (
              <div className="dk-spec-figure">
                <p>
                  <b className="dk-num">{num(stat.value)}</b> specimens <Delta value={stat.value} previous={stat.previous} />
                </p>
                <Stamp reading={r} />
              </div>
            )}
          </Read>
        </Card>
        <Card title="Waiting, as a panel" icon="hourglass" tone="quiet" right={<LinkButton href="/kit" size="sm">View all</LinkButton>}>
          <Read reading={WAITING}>{() => null}</Read>
        </Card>
        <Card title="Off, as a panel" icon="alert" tone="bad" count={3} divided>
          <Read reading={OFF}>{() => null}</Read>
        </Card>
      </Grid>

      <Grid cols="1fr 1fr 1fr">
        <Card title="Inline, in a sentence" icon="info" sub="A second line under the title">
          <p className="dk-spec-text">
            A cell with no figure reads <Absent reading={OFF} form="inline" />, and its reason is on hover. A waiting one reads <Absent reading={WAITING} form="inline" />.
          </p>
          <div className="dk-spec-stamps">
            <Stamp source="none" asOf={new Date(now.getTime() - 12 * 60_000).toISOString()} note={NOTE} />
            <Stamp source="none" asOf={new Date(now.getTime() - 3 * 3_600_000).toISOString()} note="the note printed" showNote />
            <Stamp source="none" asOf={new Date(now.getTime() - 2 * 86_400_000).toISOString()} />
          </div>
        </Card>
        <Card title="Empty" icon="inbox" tone="quiet">
          <Empty title="No specimens yet" action={<Button size="sm" icon="plus">Add one</Button>}>
            The source answered and there is nothing in it. This says why, and what would put something here.
          </Empty>
        </Card>
        <Card title="Empty, compact" icon="inbox" tone="quiet">
          <Empty title="Nothing in this list" compact>
            A short panel's version.
          </Empty>
        </Card>
      </Grid>

      {/* ---- deltas, badges, chips ---- */}
      <Grid cols="1fr 1fr">
        <Card title="Delta" icon="trending-up">
          <dl className="dk-spec-pairs">
            <dt>Up</dt>
            <dd>
              <Delta value={1184} previous={1000} />
            </dd>
            <dt>Down</dt>
            <dd>
              <Delta value={800} previous={1000} />
            </dd>
            <dt>Down, down is good</dt>
            <dd>
              <Delta value={800} previous={1000} downIsGood />
            </dd>
            <dt>Both under 20</dt>
            <dd>
              <Delta value={5} previous={3} />
            </dd>
            <dt>From zero</dt>
            <dd>
              <Delta value={124} previous={0} />
            </dd>
            <dt>Unchanged</dt>
            <dd>
              <Delta value={1000} previous={1000} />
            </dd>
            <dt>No earlier figure</dt>
            <dd>
              <Delta value={1000} previous={null} />
            </dd>
            <dt>Given in percent, small</dt>
            <dd>
              <Delta percent={-2.1} size="sm" />
            </dd>
          </dl>
        </Card>
        <Card title="Badge, chip, dot, count" icon="tag">
          <div className="dk-spec-rows">
            <div className="dk-spec-row">
              <Badge tone="good" dot>
                Healthy
              </Badge>
              <Badge tone="warn" dot>
                Slow
              </Badge>
              <Badge tone="bad" dot>
                Down
              </Badge>
              <Badge tone="info">Info</Badge>
              <Badge tone="violet">Violet</Badge>
              <Badge tone="quiet">Quiet</Badge>
              <Badge tone="good" icon="arrow-up">
                12%
              </Badge>
            </div>
            <div className="dk-spec-row">
              <Chip caps>SEO</Chip>
              <Chip caps>Conversion</Chip>
              <Chip caps tone="bad">
                Health
              </Chip>
              <Chip pill>Category</Chip>
              <Chip pill tone="info">
                Pill
              </Chip>
            </div>
            <div className="dk-spec-row">
              {CONTENT_STATUSES.map((s) => (
                <StatusChip key={s} status={s} />
              ))}
            </div>
            <div className="dk-spec-row">
              {["Landing", "Service", "Industry", "Blog", "Standard", "Unknown type"].map((t) => (
                <TypeChip key={t} type={t} />
              ))}
            </div>
            <div className="dk-spec-row">
              <StatusDot tone="good" tint>
                Live
              </StatusDot>
              <StatusDot tone="good" pulse title="Pulsing" />
              <StatusDot tone="warn">Warning</StatusDot>
              <StatusDot tone="bad">Error</StatusDot>
              <StatusDot tone="info">Info</StatusDot>
              <StatusDot tone="quiet">Quiet</StatusDot>
              <Count>8</Count>
              <Count tone="bad">12</Count>
              <Count tone="good">0</Count>
            </div>
          </div>
        </Card>
      </Grid>

      {/* ---- buttons, tabs, selects, bars ---- */}
      <Grid cols="1fr 1fr">
        <Card title="Buttons" icon="bolt">
          <div className="dk-spec-rows">
            <div className="dk-spec-row">
              <Button variant="primary" icon="plus">
                Primary
              </Button>
              <Button>Quiet</Button>
              <Button variant="good">Good</Button>
              <Button variant="danger">Danger</Button>
              <Button variant="ghost" icon="more" aria-label="More" />
              <Button disabled>Disabled</Button>
            </div>
            <div className="dk-spec-row">
              <Button size="sm" variant="primary">
                Small
              </Button>
              <Button size="sm">View all</Button>
              <Button size="sm" variant="good">
                View
              </Button>
              <Button size="sm" variant="danger">
                Investigate
              </Button>
              <Button size="sm" icon="refresh" aria-label="Refresh" />
            </div>
            <div className="dk-spec-row">
              <Button size="xs">Stop</Button>
              <Button size="xs" variant="good">
                Approve
              </Button>
              <Button size="xs" variant="danger">
                Remove
              </Button>
              <LinkButton href="/kit" size="xs" iconRight="chevron-right">
                A link
              </LinkButton>
              <LinkButton href="https://www.balkaris.ch" size="xs" iconRight="external">
                Another site
              </LinkButton>
            </div>
          </div>
        </Card>
        <Card title="Tabs, select, progress" icon="sliders">
          <div className="dk-spec-rows">
            <Tabs
              label="Specimen views"
              active={tab}
              items={[
                { key: "all", label: "All", href: "/kit", count: 87 },
                { key: "b", label: "Second", href: "/kit?tab=b", count: 12, countTone: "bad" },
                { key: "c", label: "Third", href: "/kit?tab=c", count: 0 },
                { key: "d", label: "No count", href: "/kit?tab=d" },
              ]}
            />
            <Tabs
              label="Specimen small views"
              size="sm"
              active={tab}
              items={[
                { key: "all", label: "Pages", href: "/kit" },
                { key: "b", label: "Insights", href: "/kit?tab=b" },
                { key: "c", label: "Traffic", href: "/kit?tab=c" },
              ]}
            />
            <div className="dk-spec-row">
              <Select
                param="status"
                label="Status"
                options={[
                  { value: "all", label: "All status" },
                  { value: "a", label: "Specimen status A" },
                ]}
              />
              <Select
                param="kind"
                label="Kind"
                size="md"
                options={[
                  { value: "all", label: "All kinds" },
                  { value: "a", label: "Specimen kind A" },
                ]}
              />
            </div>
            <div className="dk-spec-bars">
              <ProgressBar value={0.68} label="Specimen share, green" />
              <ProgressBar value={0.4} tone="warn" label="Specimen share, amber" />
              <ProgressBar value={0.15} tone="bad" label="Specimen share, red" />
              <ProgressBar value={0.82} tone="info" size="md" label="Specimen task, blue" />
            </div>
          </div>
        </Card>
      </Grid>

      {/* ---- the table ---- */}
      <div id="table">
        <form action={pickRows}>
          <Card
            title="Table"
            icon="list"
            count={ROWS.length}
            flush
            right={
              <Button type="submit" size="sm" icon="check">
                Send ticked rows
              </Button>
            }
            sub={picked ? `The form sent: ${picked}` : "Tick rows and send them; the answer is printed here."}
          >
            <Table
              caption="Specimen rows"
              rows={ROWS}
              rowKey={(r) => r.key}
              rowHref={(r) => `/kit?row=${r.key}`}
              select={{ name: "row", label: (r) => r.name }}
              defaultSort={{ key: "count", dir: "desc" }}
              minWidth={720}
              density="roomy"
              columns={[
                {
                  key: "name",
                  head: "Page",
                  cell: (r) => (
                    <span className="dk-spec-cell">
                      <Thumb src={r.key === "a" ? PICTURE : r.key === "b" ? BROKEN : null} />
                      <span>
                        <b>{r.name}</b>
                        <small>{r.path}</small>
                      </span>
                    </span>
                  ),
                  sort: (r) => r.name,
                },
                { key: "kind", head: "Type", cell: (r) => <TypeChip type={r.kind} /> },
                {
                  key: "count",
                  head: "Specimens",
                  numeric: true,
                  cell: (r) => (r.count === null ? <Absent reading={OFF} form="inline" /> : num(r.count)),
                  sort: (r) => r.count,
                },
                {
                  key: "change",
                  head: "Change",
                  numeric: true,
                  cell: (r) => (r.count === null ? <Absent reading={WAITING} form="inline" /> : <Delta value={r.count} previous={r.previous} size="sm" />),
                },
                { key: "rate", head: "Rate", numeric: true, cell: (r) => percent(r.rate), sort: (r) => r.rate },
                { key: "on", head: "Date", cell: (r) => fullDate(r.on), sort: (r) => r.on },
              ]}
            />
          </Card>
        </form>
      </div>

      <Grid cols="1fr 1fr">
        <Card title="Table with no rows" icon="list" flush>
          <Table
            caption="No specimen rows"
            rows={[] as Row[]}
            rowKey={(r) => r.key}
            heads="plain"
            empty="No rows: the source answered with none. A screen says why here."
            columns={[
              { key: "name", head: "Page", cell: (r) => r.name },
              { key: "count", head: "Specimens", numeric: true, cell: (r) => num(r.count) },
            ]}
          />
        </Card>
        <Card title="Pictures and people" icon="image">
          <div className="dk-spec-rows">
            <div className="dk-spec-row">
              <Thumb src={PICTURE} size="lg" alt="A specimen drawing" />
              <Thumb src={PICTURE} size="md" />
              <Thumb src={PICTURE} />
              <Thumb src={null} size="lg" icon="file" />
              <Thumb src={BROKEN} size="md" icon="video" />
            </div>
            <div className="dk-spec-row">
              <Avatar name="Specimen Person" size="lg" />
              <Avatar name="Specimen" />
              <Avatar name="Specimen Person" size="sm" />
              <Tooltip text="A tooltip: the caveat that belongs to a figure.">
                <span className="dk-spec-hover" tabIndex={0}>
                  Hover or focus me
                </span>
              </Tooltip>
              <Info text="The (i) on its own." />
            </div>
          </div>
        </Card>
      </Grid>

      {/* ---- lists ---- */}
      <Grid cols="1fr 1fr" mid="minmax(0, 1fr)">
        <Card title="Recent activity" icon="clock" right={<LinkButton href="/kit" size="sm">View all</LinkButton>}>
          <Timeline
            label="Specimen activity"
            items={[
              { key: 1, time: "09:31", tone: "good", text: "Specimen event A", href: "/kit" },
              { key: 2, time: "08:52", tone: "info", text: "Specimen event B", detail: "with a second line · by Specimen" },
              { key: 3, time: "Yesterday", tone: "warn", text: "Specimen event C", href: "/kit" },
              { key: 4, time: "28 Sep", tone: "bad", text: "Specimen event D, which is long enough to show how a line that does not fit wraps under itself" },
              { key: 5, time: "27 Sep", text: "Specimen event E, quiet" },
            ]}
          />
        </Card>
        <div id="actions">
          <Card title="Quick actions" icon="bolt" sub={posted ? `The desk server answered: ${posted}` : "The first row posts to the desk server from this app's server."}>
            <ActionList
              label="Specimen actions"
              items={[
                { icon: "refresh", label: "Run “Read the website's git history” now", description: "A server action: POST /api/v1/jobs/repo/run with the visitor's Origin", action: runRepo },
                { icon: "file", label: "A link to a screen", href: "/kit" },
                { icon: "terminal", label: "A page the server draws", description: "The classic console", href: "/console" },
                { icon: "external", label: "Another site", href: "https://www.balkaris.ch" },
              ]}
            />
          </Card>
        </div>
      </Grid>

      <Card title="Quick actions in two columns" icon="bolt">
        <ActionList
          label="Specimen actions in two columns"
          columns={2}
          items={[
            { icon: "plus", label: "Specimen action A", description: "What it does", href: "/kit" },
            { icon: "pencil", label: "Specimen action B", description: "What it does", href: "/kit" },
            { icon: "send", label: "Specimen action C", description: "What it does", href: "/kit" },
            { icon: "users", label: "Specimen action D", description: "What it does", href: "/kit" },
          ]}
        />
      </Card>

      {/* ---- loading, gates ---- */}
      <Grid cols="1fr 1fr 1fr">
        <Stack>
          <SkeletonTile />
          <SkeletonCard lines={4} />
        </Stack>
        <Card title="Skeleton parts" icon="layout">
          <div className="dk-spec-rows">
            <Skeleton width={180} height={14} />
            <Skeleton height={11} />
            <Skeleton width="70%" height={11} />
            <Skeleton width={32} height={32} round />
          </div>
        </Card>
        <Card title="A gate, as a panel" icon="server" flush>
          <Gate kind="down">
            <Button variant="primary" icon="refresh">
              Try again
            </Button>
          </Gate>
        </Card>
      </Grid>

      {/* ---- how things are printed ---- */}
      <Card title="How figures and times are printed" icon="code" info="lib/format.ts, the same on the server and in the browser.">
        <dl className="dk-spec-pairs dk-spec-pairs--wide">
          <dt>num(1234567)</dt>
          <dd className="dk-num">{num(1234567)}</dd>
          <dt>compact(12345)</dt>
          <dd className="dk-num">{compact(12345)}</dd>
          <dt>percent(2.5)</dt>
          <dd className="dk-num">{percent(2.5)}</dd>
          <dt>duration(82), (1300), (134000)</dt>
          <dd className="dk-num">
            {duration(82)}, {duration(1300)}, {duration(134000)}
          </dd>
          <dt>bytes(1234567)</dt>
          <dd className="dk-num">{bytes(1234567)}</dd>
          <dt>ago(two days back), ago(22 hours on)</dt>
          <dd suppressHydrationWarning>
            {ago(now.getTime() - 2 * 86_400_000, now)}, {ago(now.getTime() + 22 * 3_600_000, now)}
          </dd>
          <dt>shortDate, fullDate, longDate of 2000-01-03</dt>
          <dd>
            {shortDate("2000-01-03")}, {fullDate("2000-01-03")}, {longDate("2000-01-03")}
          </dd>
          <dt>num(null)</dt>
          <dd>{num(null)}</dd>
        </dl>
      </Card>

      {/* ---- icons ---- */}
      <Card title="Icons" icon="grid" count={ICON_NAMES.length}>
        <ul className="dk-spec-icons">
          {ICON_NAMES.map((name) => (
            <li key={name}>
              <Icon name={name} size={20} />
              <span>{name}</span>
            </li>
          ))}
        </ul>
      </Card>
    </Frame>
  );
}
