import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import {
  AreaChart,
  Bar,
  BarList,
  CalendarMonth,
  ComboChart,
  Donut,
  Funnel,
  Legend,
  LineChart,
  Meter,
  Ring,
  Spark,
  SparkBars,
  WorldMap,
  sliceLegend,
  type DonutSlice,
} from "@/components/charts";
import { WORLD_DOTS, type WorldDots } from "@/components/charts/world-dots";
import "@/styles/tokens.css";
import "@/styles/base.css";
import "./kit-charts.css";

/**
 * The charts' specimen sheet: every chart in every state it has to survive.
 *
 * NOTHING HERE IS DATA. Every shape is a formula (a ramp, a sine wave, a
 * step) and every name is "Series A" or "Part B", so that nobody can take a
 * figure on this page for a figure of the website. It exists to be
 * photographed beside the boards (`node work/shot.mjs /kit/charts …`) and to
 * show the next builder what each state looks like before a real source
 * produces it.
 *
 * Development only: on the box this address is a 404.
 */
export const metadata = { title: "Charts · desk kit" };

/* ---------- specimen shapes ---------------------------------------------- */

const pad = (n: number) => String(n).padStart(2, "0");
/** `n` consecutive days of a specimen year, as the server would send them. */
const days = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2000, 0, 1 + i));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  });
/** `n` hours of one specimen day, written without a zone so they print as written. */
const hours = (n: number): string[] => Array.from({ length: n }, (_, i) => `2000-01-01T${pad(Math.floor((i * 24) / n))}:${pad(Math.round((((i * 24) / n) % 1) * 60))}`);
/** A sine wave riding a ramp: the shape of something that grows unevenly. */
const wave = (n: number, from: number, to: number, swing: number, period = 5, phase = 0): number[] =>
  Array.from({ length: n }, (_, i) => Math.round(from + ((to - from) * i) / Math.max(1, n - 1) + swing * Math.sin((i / period) * Math.PI * 2 + phase)));
/** The same, kept at or above zero. */
const waveUp = (...a: Parameters<typeof wave>) => wave(...a).map((v) => Math.max(0, v));

const D30 = days(30);
const A30 = waveUp(30, 4000, 17500, 1900, 6);
const B30 = waveUp(30, 900, 2300, 260, 7, 1);
const C30 = waveUp(30, 350, 1150, 90, 9, 2);
/* A previous period that only exists for its second half, as it will until two full periods have been measured. */
const PREV30 = waveUp(30, 3000, 12000, 1500, 6, 0.8).map((v, i) => (i < 14 ? null : v));

/* Each part half the one before: 64, 32, 16, 8, 4, 2. */
const PARTS: DonutSlice[] = ["A", "B", "C", "D", "E", "F"].map((k, i) => ({ label: `Part ${k}`, value: 64 / 2 ** i }));
/* Three parts, one large and two small, for the thin donut with a figure of its own. */
const THIN: DonutSlice[] = [
  { label: "Part A", value: 90, color: "green" },
  { label: "Part B", value: 6, color: "amber" },
  { label: "Part C", value: 4, color: "red" },
];
const THIN_SHARE = `${Math.round((THIN[0]!.value / THIN.reduce((a, s) => a + s.value, 0)) * 100)}%`;
/* A falling ramp for the bar lists: 50, 41, 32, 23, 14. */
const RAMP = Array.from({ length: 5 }, (_, i) => 50 - i * 9);
/* The thresholds the meters are drawn against, and values set relative to them. */
const GOOD = 2.5;
const POOR = 4;

/* A grid that is plainly not the world: two blocks and a lone dot, with made-up codes. */
const b36 = (n: number) => n.toString(36).padStart(2, "0");
const SPECIMEN_DOTS: WorldDots = {
  cols: 48,
  rows: 20,
  land: Array.from({ length: 20 }, (_, r) => {
    let line = "";
    if (r >= 3 && r <= 12) line += `${b36(4)}${b36(8)}AA${b36(12)}${b36(6)}BB`;
    if (r >= 6 && r <= 16) line += `${b36(26)}${b36(r % 2 ? 14 : 16)}CC`;
    return line;
  }),
  centres: `AA${b36(8)}${b36(7)}BB${b36(15)}${b36(8)}CC${b36(33)}${b36(11)}DD${b36(44)}${b36(4)}`,
};
/* A formula, not data: the codes the world's grid knows that begin with B, in
   alphabetical order, valued 1, 2, 3… by that order. They fall on every
   continent, so the glow can be seen at many sizes on the real grid. */
const B_CODES = (WORLD_DOTS.centres.match(/.{6}/g) ?? [])
  .map((c) => c.slice(0, 2))
  .filter((code) => code.startsWith("B"))
  .map((code, i) => ({ code, value: i + 1 }));

/* ---------- the sheet ---------------------------------------------------- */

function Panel({ title, state, span = 4, children }: { title: string; state?: string; span?: 3 | 4 | 6 | 8 | 12; children: ReactNode }) {
  return (
    <section className="dk-kit-panel" data-span={span}>
      <header className="dk-kit-head">
        <h3>{title}</h3>
        {state && <span className="dk-kit-state">{state}</span>}
      </header>
      {children}
    </section>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <>
      <div className="dk-kit-group">
        <h2>{title}</h2>
        {note && <p>{note}</p>}
      </div>
      {children}
    </>
  );
}

export default function ChartsKit() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="dk-kit">
      <header className="dk-kit-top">
        <p className="dk-kit-eyebrow">Kit</p>
        <h1>Charts</h1>
        <p>Specimens only. Every shape on this page is a formula and every name a placeholder; none of it is a figure of the website.</p>
      </header>

      <div className="dk-kit-grid">
        <Group title="Spark" note="The line beside a tile's figure, and the small one in a table row.">
          <Panel title="Spark" state="tile, the tones" span={6}>
            <div className="dk-kit-row">
              <Spark data={waveUp(24, 12, 60, 7, 5)} label="Specimen, rising" />
              <Spark data={waveUp(24, 50, 22, 6, 4)} tone="bad" label="Specimen, falling" />
              <Spark data={waveUp(24, 20, 40, 9, 6)} tone="warn" label="Specimen" />
              <Spark data={waveUp(24, 30, 34, 4, 3)} tone="quiet" label="Specimen" />
              <Spark data={waveUp(24, 12, 60, 7, 5)} area={false} tone="info" label="Specimen, no area" />
            </div>
          </Panel>
          <Panel title="Spark" state="the honest edges" span={6}>
            <div className="dk-kit-row">
              <Labelled text="9 points">
                <Spark data={waveUp(9, 1, 5, 1, 4)} label="Specimen, nine points" />
              </Labelled>
              <Labelled text="a gap">
                <Spark data={waveUp(20, 10, 40, 6, 5).map((v, i) => (i > 7 && i < 11 ? null : v))} label="Specimen with a gap" />
              </Labelled>
              <Labelled text="one reading">
                <Spark data={[7]} label="Specimen, one reading" />
              </Labelled>
              <Labelled text="all zero">
                <Spark data={Array(14).fill(0)} label="Specimen, all zero" />
              </Labelled>
              <Labelled text="no readings">
                <Spark data={[]} label="Specimen, no readings" />
              </Labelled>
              <Labelled text="floor: min">
                <Spark data={wave(24, 990, 998, 2, 5)} floor="min" label="Specimen, floor at the minimum" />
              </Labelled>
              <Labelled text="row size">
                <Spark data={waveUp(24, 10, 30, 4, 5)} size="row" label="Specimen, row size" />
              </Labelled>
            </div>
          </Panel>
          <Panel title="SparkBars" state="tile, the tones" span={6}>
            <div className="dk-kit-row">
              <SparkBars data={waveUp(18, 8, 30, 9, 4)} label="Specimen bars" />
              <SparkBars data={waveUp(18, 6, 28, 8, 5)} tone="bad" label="Specimen bars, red" />
              <SparkBars data={waveUp(18, 10, 26, 9, 3)} tone="violet" label="Specimen bars, violet" />
              <SparkBars data={waveUp(18, 14, 20, 8, 4)} tone="quiet" label="Specimen bars, grey" />
              <SparkBars data={waveUp(18, 8, 30, 9, 4)} fade={false} label="Specimen bars, no fade" />
            </div>
          </Panel>
          <Panel title="SparkBars" state="the honest edges" span={6}>
            <div className="dk-kit-row">
              <Labelled text="30 days">
                <SparkBars data={waveUp(30, 2, 9, 3, 5)} label="Specimen, thirty bars" />
              </Labelled>
              <Labelled text="0 to 3">
                <SparkBars data={[0, 1, 0, 0, 2, 1, 0, 3, 1]} label="Specimen, small counts" />
              </Labelled>
              <Labelled text="unread days">
                <SparkBars data={[2, 3, null, null, 4, 2, null, 5, 6, null, null, null]} label="Specimen with unread days" />
              </Labelled>
              <Labelled text="all zero">
                <SparkBars data={Array(14).fill(0)} label="Specimen, all zero" />
              </Labelled>
              <Labelled text="no readings">
                <SparkBars data={[]} label="Specimen, no readings" />
              </Labelled>
              <Labelled text="row size">
                <SparkBars data={waveUp(12, 4, 12, 4, 4)} size="row" label="Specimen, row size" />
              </Labelled>
            </div>
          </Panel>
          <Panel title="SparkBars" state="long series folded into buckets: 90 and 365 values, tile and row" span={6}>
            <div className="dk-kit-row">
              <Labelled text="90 → 30 bars">
                <SparkBars data={waveUp(90, 4, 20, 6, 20)} label="Specimen, ninety values" />
              </Labelled>
              <Labelled text="365 → 31 bars">
                <SparkBars data={waveUp(365, 4, 30, 8, 60)} label="Specimen, a year of values" />
              </Labelled>
              <Labelled text="365, unread start">
                <SparkBars data={waveUp(365, 4, 30, 8, 60).map((v, i) => (i < 200 ? null : v))} label="Specimen, a year with its first part unread" />
              </Labelled>
              <Labelled text="90, row">
                <SparkBars data={waveUp(90, 4, 20, 6, 20)} size="row" label="Specimen, ninety values, row size" />
              </Labelled>
              <Labelled text="365, row">
                <SparkBars data={waveUp(365, 4, 30, 8, 60)} size="row" label="Specimen, a year of values, row size" />
              </Labelled>
            </div>
          </Panel>
        </Group>

        <Group title="AreaChart" note="One to three series, a dashed previous period, provisional newest points. Move the pointer over a chart, or focus it and use the arrow keys.">
          <Panel title="One series" state="30 days · previous period (half of it missing) · last 2 provisional" span={6}>
            <Legend items={[{ label: "Series A" }, { label: "Previous period", color: "grey", mark: "dash" }]} />
            <AreaChart label="Specimen, one series" series={A30} x={D30} previous={PREV30} provisional={2} />
          </Panel>
          <Panel title="Three series" state="30 days" span={6}>
            <Legend items={[{ label: "Series A" }, { label: "Series B" }, { label: "Series C", color: "ink" }]} />
            <AreaChart
              label="Specimen, three series"
              x={D30}
              series={[
                { label: "Series A", data: waveUp(30, 1600, 3800, 240, 8) },
                { label: "Series B", data: B30 },
                { label: "Series C", data: C30, color: "ink" },
              ]}
            />
          </Panel>

          <Panel title="No readings" state="empty series">
            <AreaChart label="Specimen, empty" series={[]} x={days(9)} />
          </Panel>
          <Panel title="One reading" state="a single point">
            <AreaChart label="Specimen, one point" series={[{ date: "2000-01-01", value: 3 }]} />
          </Panel>
          <Panel title="Every reading zero" state="all zeros">
            <AreaChart label="Specimen, all zero" series={Array(9).fill(0)} x={days(9)} />
          </Panel>
          <Panel title="Small counts" state="9 days, values 0 to 3">
            <AreaChart label="Specimen, small counts" series={[0, 1, 0, 2, 1, 3, 0, 1, 2]} x={days(9)} />
          </Panel>
          <Panel title="As measurement begins" state="DayPoint[] · 12 days · previous never measured · last 2 provisional">
            <AreaChart
              label="Specimen, first days"
              series={days(12).map((date, i) => ({ date, value: i % 4 === 0 ? 0 : (i % 3) + 1, previous: null }))}
              provisional={2}
            />
          </Panel>
          <Panel title="Unread days" state="nulls in the series and in the previous period">
            <AreaChart
              label="Specimen with gaps"
              series={waveUp(16, 10, 40, 8, 5).map((v, i) => (i === 5 || i === 6 || i === 11 ? null : v))}
              x={days(16)}
              previous={waveUp(16, 8, 30, 6, 4).map((v, i) => (i < 4 || i === 9 ? null : v))}
            />
          </Panel>
          <Panel title="Fractions" state="a rate, 12 points">
            <AreaChart label="Specimen, a rate" unit="percent" series={Array.from({ length: 12 }, (_, i) => Math.round((1.2 + 0.9 * Math.sin(i / 2) + i * 0.08) * 100) / 100)} x={days(12)} />
          </Panel>
          <Panel title="A step of 2.5" state="a rate up to 10%: every tick prints where it stands">
            <AreaChart label="Specimen, a rate on a 2.5 step" unit="percent" series={Array.from({ length: 12 }, (_, i) => Math.round((5 + 4.6 * Math.sin(i / 2)) * 10) / 10)} x={days(12)} />
          </Panel>
          <Panel title="Dated, ending apart" state="DayPoint[]: A runs 20 days, B ends 3 days earlier; no x given">
            <Legend items={[{ label: "Series A" }, { label: "Series B" }]} />
            <AreaChart
              label="Specimen, dated series ending on different days"
              series={[
                { label: "Series A", data: days(20).map((date, i) => ({ date, value: waveUp(20, 20, 60, 8, 6)[i]! })) },
                { label: "Series B", data: days(17).map((date, i) => ({ date, value: waveUp(17, 10, 25, 4, 3)[i]! })) },
              ]}
            />
          </Panel>
          <Panel title="Unequal lengths" state="a 20-day and a 7-day series, lined up at the newest day">
            <AreaChart
              label="Specimen, unequal lengths"
              x={days(20)}
              series={[
                { label: "Series A", data: waveUp(20, 20, 60, 8, 6) },
                { label: "Series B", data: waveUp(7, 10, 25, 4, 3) },
              ]}
            />
          </Panel>
          <Panel title="Hours" state="24 points, timestamps without a zone">
            <AreaChart label="Specimen, hourly" series={waveUp(24, 2, 9, 3, 8)} x={hours(24)} />
          </Panel>
          <Panel title="A quarter" state="90 days: only the newest dot" span={6}>
            <AreaChart label="Specimen, ninety days" series={waveUp(90, 20, 140, 22, 14)} x={days(90)} />
          </Panel>
          <Panel title="A year" state="365 days" span={6}>
            <AreaChart label="Specimen, a year" series={waveUp(365, 10, 400, 60, 61)} x={days(365)} />
          </Panel>
        </Group>

        <Group title="LineChart" note="Lines compared with each other: a faint wash, or none.">
          <Panel title="Two series" state="hourly · ms" span={6}>
            <Legend items={[{ label: "Series A" }, { label: "Series B" }]} />
            <LineChart
              label="Specimen, two lines"
              unit="ms"
              x={hours(48)}
              series={[
                { label: "Series A", data: waveUp(48, 150, 170, 40, 9) },
                { label: "Series B", data: waveUp(48, 430, 470, 70, 7, 1) },
              ]}
            />
          </Panel>
          <Panel title="No wash" state="fill: none · three series" span={6}>
            <Legend items={[{ label: "Series A" }, { label: "Series B" }, { label: "Series C", color: "violet" }]} />
            <LineChart
              label="Specimen, three lines"
              fill="none"
              unit="ratio"
              x={D30}
              series={[
                { label: "Series A", data: Array.from({ length: 30 }, (_, i) => Math.round((2.2 - i * 0.03 + 0.15 * Math.sin(i / 2)) * 100) / 100) },
                { label: "Series B", data: Array.from({ length: 30 }, (_, i) => Math.round((1.1 - i * 0.015 + 0.12 * Math.sin(i / 3 + 1)) * 100) / 100) },
                { label: "Series C", color: "violet", data: Array.from({ length: 30 }, (_, i) => Math.round((0.5 - i * 0.006 + 0.08 * Math.sin(i / 2.5 + 2)) * 100) / 100) },
              ]}
            />
          </Panel>
        </Group>

        <Group title="ComboChart" note="Columns and a line: two quantities on two axes, or one quantity on one.">
          <Panel title="Two axes" state="columns left, line right · last 3 provisional" span={6}>
            <Legend items={[{ label: "Columns" }, { label: "Line", color: "ink" }]} />
            <ComboChart label="Specimen, two axes" x={D30} provisional={3} bars={{ label: "Columns", data: waveUp(30, 9000, 24000, 2600, 6) }} line={{ label: "Line", data: waveUp(30, 240000, 520000, 60000, 9, 1), color: "ink" }} />
          </Panel>
          <Panel title="One axis" state="line with its area, columns under it" span={6}>
            <Legend items={[{ label: "Line" }, { label: "Columns", color: "s2" }]} />
            <ComboChart label="Specimen, one axis" axes="shared" lineFill x={D30} line={{ label: "Line", data: waveUp(30, 3, 18, 2, 6) }} bars={{ label: "Columns", data: waveUp(30, 1, 6, 1.4, 5), color: "s2" }} />
          </Panel>
          <Panel title="Small counts" state="9 days, 0 to 3" span={4}>
            <ComboChart label="Specimen, small counts" axes="shared" x={days(9)} line={{ label: "Line", data: [1, 2, 1, 3, 2, 3, 1, 2, 3] }} bars={{ label: "Columns", data: [0, 1, 0, 1, 0, 2, 0, 1, 1], color: "s2" }} />
          </Panel>
          <Panel title="No readings" state="empty" span={4}>
            <ComboChart label="Specimen, empty" x={days(9)} bars={{ label: "Columns", data: [] }} line={{ label: "Line", data: [] }} />
          </Panel>
          <Panel title="Columns only" state="the line has no readings" span={4}>
            <ComboChart label="Specimen, columns only" x={days(9)} bars={{ label: "Columns", data: [4, 6, 3, 7, 9, 5, 8, 11, 10] }} line={{ label: "Line", data: Array(9).fill(null) }} />
          </Panel>
          <Panel title="Dated, ending apart" state="DayPoint[]: the columns end 3 days before the line; no x given" span={6}>
            <Legend items={[{ label: "Columns" }, { label: "Line", color: "ink" }]} />
            <ComboChart
              label="Specimen, dated columns and line ending on different days"
              provisional={2}
              bars={{ label: "Columns", data: days(11).map((date, i) => ({ date, value: waveUp(11, 9000, 24000, 2600, 6)[i]! })) }}
              line={{ label: "Line", color: "ink", data: days(14).map((date, i) => ({ date, value: waveUp(14, 240000, 520000, 60000, 9, 1)[i]! })) }}
            />
          </Panel>
        </Group>

        <Group title="Donut, Legend and Ring">
          <Panel title="Donut with its legend" state="bold · hover a slice" span={4}>
            <div className="dk-kit-pair">
              <Donut label="Specimen parts" slices={PARTS} caption="Whole" />
              <Legend layout="column" items={sliceLegend(PARTS)} />
            </div>
          </Panel>
          <Panel title="Donut" state="thin · a figure of its own · toned caption" span={4}>
            <div className="dk-kit-pair">
              <Donut label="Specimen parts, thin" weight="thin" size="small" figure={THIN_SHARE} caption="Fine" captionTone="good" slices={THIN} />
              <Legend layout="column" items={THIN.map((s) => ({ label: s.label, color: s.color, value: String(s.value) }))} />
            </div>
          </Panel>
          <Panel title="Donut" state="one part · total of zero · no parts" span={4}>
            <div className="dk-kit-row">
              <Donut label="Specimen, one part" size="small" slices={[{ label: "Part A", value: 3 }]} caption="Whole" />
              <Donut
                label="Specimen, zero"
                size="small"
                slices={[
                  { label: "Part A", value: 0 },
                  { label: "Part B", value: 0 },
                ]}
                caption="Whole"
              />
              <Donut label="Specimen, none" size="small" slices={[]} caption="Whole" />
            </div>
          </Panel>
          <Panel title="Ring" state="row size: either side of each threshold (80, 50), the ends, no score" span={4}>
            <div className="dk-kit-row">
              {[100, 80, 79, 50, 49, 0, null].map((v, i) => (
                <Ring key={i} value={v} label="Specimen score" />
              ))}
            </div>
          </Panel>
          <Panel title="Ring" state="panel size" span={4}>
            <div className="dk-kit-row">
              <Ring size="panel" value={90} percent caption="Fine" label="Specimen share" />
              <Ring size="panel" value={60} percent caption="Watch" label="Specimen share" />
              <Ring size="panel" value={null} caption="No reading" label="Specimen share" />
            </div>
          </Panel>
          <Panel title="Legend" state="row · marks" span={4}>
            <Legend
              items={[
                { label: "Series A" },
                { label: "Series B" },
                { label: "Series C" },
                { label: "Series D" },
                { label: "Series E" },
                { label: "Series F" },
                { label: "A line", color: "ink", mark: "line" },
                { label: "Previous period", color: "grey", mark: "dash" },
              ]}
            />
          </Panel>
        </Group>

        <Group title="Funnel" note="Columns on a logarithmic scale by default: the figures and rates are printed, the columns show the order of magnitude.">
          <Panel title="Five steps" state="log scale for the columns, and a caption saying so; narrow rows are always straight" span={6}>
            <Funnel
              label="Specimen funnel"
              steps={[
                { label: "Step 1", value: 10000 },
                { label: "Step 2", value: 1000 },
                { label: "Step 3", value: 100 },
                { label: "Step 4", value: 40 },
                { label: "Step 5", value: 10 },
              ]}
            />
          </Panel>
          <Panel title="Edges" state="linear · an unmeasured step · a step larger than the one before · a zero" span={6}>
            <Funnel
              label="Specimen funnel, edges"
              scale="linear"
              steps={[
                { label: "Step 1", value: 40 },
                { label: "Step 2", value: null },
                { label: "Step 3", value: 12 },
                { label: "Step 4", value: 15 },
                { label: "Step 5", value: 0 },
              ]}
            />
          </Panel>
          <Panel title="Narrow" state="under 520px the columns become rows, each bar as long as its share" span={4}>
            <div className="dk-kit-narrow">
              <Funnel
                label="Specimen funnel, narrow"
                steps={[
                  { label: "Step 1", value: 10000 },
                  { label: "Step 2", value: 1000 },
                  { label: "Step 3", value: 100 },
                ]}
              />
            </div>
          </Panel>
        </Group>

        <Group title="BarList, Bar and Meter">
          <Panel title="BarList" state="bar-first · a second figure" span={4}>
            <BarList
              label="Specimen list"
              items={RAMP.map((v, i) => ({ label: i === 1 ? "Row B, a longer name" : `Row ${"ABCDE"[i]}`, value: v, text: `${v}%`, second: String(RAMP.length - i) }))}
            />
          </Panel>
          <Panel title="BarList" state="value-first · divided · an unread row · a zero" span={4}>
            <BarList
              label="Specimen list, value first"
              order="value-first"
              divided
              items={RAMP.map((v, i) => ({ label: `Row ${"ABCDE"[i]}`, value: i === 3 ? null : i === 4 ? 0 : v * 200, second: String((RAMP.length - i) * 10) }))}
            />
          </Panel>
          <Panel title="Bar and an empty list" state="alone in a cell" span={4}>
            <div className="dk-kit-stack">
              <Bar value={25} label="Specimen, 25 of 100" />
              <Bar value={50} label="Specimen, 50 of 100" />
              <Bar value={1.5} max={2} tone="warn" label="Specimen, 1.5 of 2" />
              <Bar value={130} tone="bad" label="Specimen, past the end" />
              <Bar value={null} label="Specimen, not read" />
              <BarList label="Specimen, empty" items={[]} />
            </div>
          </Panel>
          <Panel title="Meter" state="half of good · between · just past poor · twice poor · not measured" span={6}>
            <div className="dk-kit-stack">
              {[GOOD * 0.5, (GOOD + POOR) / 2, POOR * 1.1, POOR * 2, null].map((v, i) => (
                <Meter key={i} label="Specimen metric" value={v} good={GOOD} poor={POOR} unit="s" />
              ))}
            </div>
          </Panel>
          <Panel title="Meter" state="other units · more is better · no tick labels" span={6}>
            <div className="dk-kit-stack">
              <Meter label="Specimen metric" value={100} good={200} poor={500} unit="ms" />
              <Meter label="Specimen metric" value={0.05} good={0.1} poor={0.25} unit="ratio" />
              <Meter label="Specimen score" value={95} good={90} poor={50} max={100} higherIsBetter unit="score" />
              <Meter label="Specimen score" value={70} good={90} poor={50} max={100} higherIsBetter unit="score" />
              <Meter label="Specimen metric" value={300} good={200} poor={500} unit="ms" ticks={false} />
            </div>
          </Panel>
        </Group>

        <Group title="CalendarMonth and WorldMap">
          <Panel title="CalendarMonth" state="marks of four kinds · today · a crowded day" span={4}>
            <CalendarMonth
              month="2000-10"
              today="2000-10-05"
              prevHref="/kit/charts?month=2000-09"
              nextHref="/kit/charts?month=2000-11"
              todayHref="/kit/charts"
              kinds={[
                { key: "a", label: "Kind A", color: "green" },
                { key: "b", label: "Kind B", color: "blue" },
                { key: "c", label: "Kind C", color: "amber" },
                { key: "d", label: "Kind D", color: "violet" },
              ]}
              marks={[
                { date: "2000-09-28", kind: "a", title: "Specimen" },
                { date: "2000-10-03", kind: "a", title: "Specimen" },
                { date: "2000-10-06", kind: "b", title: "Specimen" },
                { date: "2000-10-09", kind: "c", title: "Specimen" },
                { date: "2000-10-13", kind: "a", title: "Specimen" },
                { date: "2000-10-13", kind: "b", title: "Specimen" },
                { date: "2000-10-19", kind: "a", title: "Specimen" },
                { date: "2000-10-19", kind: "b", title: "Specimen" },
                { date: "2000-10-19", kind: "c", title: "Specimen" },
                { date: "2000-10-19", kind: "d", title: "Specimen" },
                { date: "2000-10-19", kind: "d", title: "Specimen" },
                { date: "2000-10-23", kind: "d", title: "Specimen" },
                { date: "2000-11-02", kind: "b", title: "Specimen" },
              ]}
            />
          </Panel>
          <Panel title="CalendarMonth" state="a month with nothing in it · six weeks · no controls" span={4}>
            <CalendarMonth
              month="2000-07"
              marks={[]}
              kinds={[
                { key: "a", label: "Kind A", color: "green" },
                { key: "b", label: "Kind B", color: "blue" },
              ]}
            />
          </Panel>
          <Panel title="CalendarMonth" state="a month that is not one: today's month instead, and a line saying so" span={4}>
            <CalendarMonth month="2000-13" today="2000-10-05" marks={[]} kinds={[{ key: "a", label: "Kind A", color: "green" }]} />
          </Panel>
          <Panel title="WorldMap" state="the world's own grid, as committed · nothing lit" span={6}>
            <WorldMap label="Specimen map, the world's grid, nothing lit" countries={[]} />
          </Panel>
          <Panel title="WorldMap" state="the world's own grid · a formula, not data: every code beginning with B, valued 1, 2, 3… in alphabetical order" span={6}>
            <WorldMap label="Specimen map, codes beginning with B valued by their order" countries={B_CODES} />
          </Panel>
          <Panel title="WorldMap" state="a specimen grid that is plainly not the world · one code it does not know" span={6}>
            <WorldMap
              label="Specimen map on a specimen grid"
              dots={SPECIMEN_DOTS}
              countries={[
                { code: "AA", value: 100, name: "Block A" },
                { code: "CC", value: 9, name: "Block C" },
                { code: "DD", value: 1, name: "Lone dot D" },
                { code: "ZZ", value: 4, name: "Unknown Z" },
                { code: null, value: 2 },
              ]}
            />
          </Panel>
          <Panel title="WorldMap" state="no country has a value" span={6}>
            <WorldMap label="Specimen map, nothing lit" dots={SPECIMEN_DOTS} countries={[]} />
          </Panel>
          <Panel title="WorldMap" state="no grid at all: the figures are still listed" span={6}>
            <WorldMap
              label="Specimen map with no grid"
              dots={{ cols: 0, rows: 0, land: [], centres: "" }}
              countries={[
                { code: "AA", value: 100, name: "Block A" },
                { code: "CC", value: 9, name: "Block C" },
              ]}
            />
          </Panel>
        </Group>
      </div>
    </main>
  );
}

function Labelled({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="dk-kit-labelled">
      {children}
      <small>{text}</small>
    </span>
  );
}
