import type { HoverPoint } from "@/components/charts/ChartHover";
import { Frame } from "@/components/charts/Frame";
import { align, colorClass, r2, summarise, xAt, xLabel } from "@/components/charts/series";
import type { LeadsDay } from "@/contract/leads";
import { DASH, figure } from "@/lib/format";
import { linear, niceTicks } from "@/lib/scale";
import "@/components/charts/combo-chart.css";

/**
 * Enquiries per day as columns, and the booked calls among them as a
 * narrower column inside each: the Conversions board draws booked calls as
 * bars, and a day is a count, not a point on a line. A booked call is one of
 * that day's enquiries, so its column never stands taller than the day's.
 *
 * Composed here from the charts' own plot (Frame) and marks (the ComboChart's
 * column), because no shared chart draws two columns on one axis. It takes
 * the same notes as ComboChart and says the same things when it has nothing.
 */
export function DayBars({ label, days, emptyNote, zeroNote }: { label: string; days: readonly LeadsDay[]; emptyNote: string; zeroNote: string }) {
  const lined = align([days.map((d) => ({ date: d.date, value: d.enquiries })), days.map((d) => ({ date: d.date, value: d.booked }))]);
  const enquiries = lined.values[0]!;
  const booked = lined.values[1]!;
  const n = lined.x?.length ?? enquiries.length;
  const xs = Array.from({ length: n }, (_, i) => xAt(i, n, true));
  const names = lined.x ? lined.x.map(xLabel) : null;
  const xText = names ? names.map((d) => d.short) : null;
  const sum = summarise([enquiries, booked]);

  if (sum.count === 0) return <Frame label={label} height="fill" left={null} xs={xs} xText={xText} note={emptyNote} />;
  if (sum.allZero) return <Frame label={label} height="fill" left={{ ticks: { min: 0, max: 1, step: 1, ticks: [0] }, unit: "count" }} xs={xs} xText={xText} note={zeroNote} />;

  const left = { ticks: niceTicks(0, sum.hi, { integer: sum.whole }), unit: "count" as const };
  const y = linear(left.ticks.min, left.ticks.max, 100, 0);
  const slot = 100 / Math.max(1, n);
  const outer = r2(slot * 0.66);
  const inner = r2(slot * 0.3);
  const s1 = colorClass("s1");
  const s2 = colorClass("s2");

  const hover: HoverPoint[] = xs.map((px, i) => ({
    x: px,
    title: names ? names[i]!.long : `${i + 1} of ${n}`,
    rows: [
      { label: "Enquiries", text: enquiries[i] === null ? DASH : figure(enquiries[i], "count"), color: s1, y: enquiries[i] === null ? null : r2(y(enquiries[i]!)) },
      { label: "Booked calls", text: booked[i] === null ? DASH : figure(booked[i], "count"), color: s2, y: booked[i] === null ? null : r2(y(booked[i]!)) },
    ],
  }));

  const bar = (v: number | null, i: number, width: number, color: string, extra: string) =>
    v === null || v <= 0 ? null : (
      <i key={`${extra}${i}`} className={`dk-combo-bar ${color} ${extra}`} style={{ left: `${xs[i]}%`, width: `${width}%`, height: `${r2(100 - y(v))}%` }} />
    );

  return (
    <Frame label={label} height="fill" left={left} xs={xs} xText={xText} hover={hover} dots="last">
      {enquiries.map((v, i) => bar(v, i, outer, s1, "dk-leads-bar"))}
      {booked.map((v, i) => bar(v, i, inner, s2, "dk-leads-bar dk-leads-bar--in"))}
    </Frame>
  );
}
