import type { ReactNode } from "react";
import type { Reading, Tone } from "@/contract/common";
import type { PerformancePanel, UptimeCell, VitalCell } from "@/contract/overview";
import { SparkBars } from "@/components/charts";
import { Card } from "@/components/ui/Card";
import { Absent, type AbsentReading } from "@/components/ui/Read";
import { Stamp } from "@/components/ui/Stamp";
import { duration, fullDate, num } from "@/lib/format";
import { dayMonth } from "./greeting";

const RATING: Record<VitalCell["rating"], { word: string; tone: Tone }> = {
  good: { word: "Good", tone: "good" },
  "needs-improvement": { word: "Needs improvement", tone: "warn" },
  poor: { word: "Poor", tone: "bad" },
};

const vitalFigure = (v: VitalCell): string => (v.unit === "score" ? num(v.value, 2) : v.value >= 1000 ? duration(v.value) : `${num(Math.round(v.value))}ms`);

/** One cell: label, figure, rating, a small bar history, and whether it is lab or field. */
function Cell({ label, info, children }: { label: string; info: string; children: ReactNode }) {
  return (
    <div className="dk-overview-perfcell">
      <h3 className="dk-overview-perflabel" title={info}>
        {label}
      </h3>
      {children}
    </div>
  );
}

function Vital({ reading, under, said }: { reading: Reading<VitalCell>; under?: ReactNode; said?: boolean }) {
  if (reading.state !== "ok") {
    return (
      <>
        {/* `said`: the reason is printed once for the panel, under the cells; the cell keeps it for the pointer. */}
        <Absent reading={reading} form="tile" className={said ? "dk-overview-perfsaid" : undefined} />
        {under}
      </>
    );
  }
  const v = reading.value;
  const r = RATING[v.rating];
  return (
    <>
      <p className="dk-overview-perffig dk-num">
        {vitalFigure(v)}
        <span className="dk-overview-perfkind">{v.kind === "lab" ? "Lab" : "Field"}</span>
      </p>
      <p className={`dk-overview-perfrate dk-overview-${r.tone}`}>{r.word}</p>
      <span className="dk-overview-perfbars">
        <SparkBars data={v.history} tone={r.tone} size="row" label={`${v.kind === "lab" ? "Lab" : "Field"} history, one bar a day`} />
      </span>
      {under}
    </>
  );
}

/* Our own yardstick for the desk's probe: it is stated beside the figure. */
const uptimeRating = (p: number): { word: string; tone: Tone } => (p >= 99.9 ? { word: "Healthy", tone: "good" } : p >= 99 ? { word: "Degraded", tone: "warn" } : { word: "Poor", tone: "bad" });

/* 99.987 is "99.98%", never rounded up into a "100%" the checks did not show. */
const uptimeFigure = (p: number): string => `${num(Math.floor(p * 100) / 100, 2)}%`;

function Uptime({ reading }: { reading: Reading<UptimeCell> }) {
  if (reading.state !== "ok") return <Absent reading={reading} form="tile" />;
  const u = reading.value;
  const r = uptimeRating(u.percent);
  return (
    <>
      <p className="dk-overview-perffig dk-num" title={`${num(u.checks - u.failed)} of ${num(u.checks)} checks passed since ${fullDate(u.since)}`}>
        {uptimeFigure(u.percent)}
      </p>
      <p className={`dk-overview-perfrate dk-overview-${r.tone}`}>{r.word}</p>
      <span className="dk-overview-perfbars">
        <SparkBars data={u.history} tone={r.tone} size="row" label="Uptime per day" />
      </span>
      {/* A rate of fewer than 30 checks is shown with its two counts. */}
      {u.checks < 30 ? (
        <span className="dk-overview-perfcount">
          {num(u.checks - u.failed)} of {num(u.checks)} checks
        </span>
      ) : null}
    </>
  );
}

/** One stamp per source under the four cells: PageSpeed (lab) or the Chrome UX Report (field), and the desk's probe since its first check. */
function stamps(panel: PerformancePanel): ReactNode[] {
  const out: ReactNode[] = [];
  const seen = new Set<string>();
  for (const r of [panel.lcp, panel.cls, panel.inp, panel.tbt]) {
    if (r.state !== "ok" || seen.has(r.source)) continue;
    seen.add(r.source);
    out.push(<Stamp key={r.source} reading={r} />);
  }
  if (panel.uptime.state === "ok") {
    out.push(<Stamp key="probe" source="probe" asOf={panel.uptime.asOf} note={`uptime since ${dayMonth(panel.uptime.value.since)}`} showNote />);
  }
  return out;
}

/**
 * The one absent reading behind every speed cell, when LCP, INP and CLS are
 * all missing for the same reason (one speed test refused): said once under
 * the cells instead of three times cut short inside them.
 */
function sharedAbsence(panel: PerformancePanel): AbsentReading | null {
  const [a, ...rest] = [panel.lcp, panel.inp, panel.cls];
  if (!a || a.state === "ok") return null;
  const step = (r: AbsentReading) => (r.state === "off" ? r.step : undefined);
  return rest.every((r) => r.state === a.state && r.reason === a.reason && step(r) === step(a)) ? a : null;
}

/** "Performance overview": LCP, INP, CLS and uptime, each saying where it comes from. */
export function PerformanceCard({ panel }: { panel: PerformancePanel }) {
  const tbt = panel.tbt.state === "ok" ? panel.tbt.value : null;
  const shared = sharedAbsence(panel);
  return (
    <Card
      title="Performance overview"
      icon="bar-chart"
      className="dk-overview-performance"
      info="Page load and visual stability are lab values from PageSpeed (one Lighthouse load per tested page, mobile) unless Google has field data from real Chrome visits; each cell says which. Interaction (INP) exists only as field data. Uptime is the desk's own check of the home page every two minutes. Point at a heading for its definition."
    >
      <div className="dk-overview-perfwrap">
      <div className="dk-overview-perf">
        <Cell label="Page load (LCP)" info="Largest Contentful Paint on mobile: field data from real Chrome visits when Google has it, otherwise the lab (one Lighthouse load per page on Google's machines, the median of the tested pages). The cell says which.">
          <Vital reading={panel.lcp} said={shared !== null} />
        </Cell>
        <Cell label="Interaction (INP)" info="Interaction to Next Paint exists only as field data from real Chrome visits. A lab test cannot produce it; Total Blocking Time is the lab's stand-in, shown under its own name.">
          <Vital
            reading={panel.inp}
            said={shared !== null}
            under={
              tbt && panel.inp.state !== "ok" ? (
                <p className="dk-overview-perfstand">
                  Total Blocking Time (lab): <b className="dk-num">{vitalFigure(tbt)}</b>, {RATING[tbt.rating].word.toLowerCase()}
                </p>
              ) : null
            }
          />
        </Cell>
        <Cell label="Visual stability (CLS)" info="Cumulative Layout Shift on mobile: field data when Google has it, otherwise the lab. The cell says which.">
          <Vital reading={panel.cls} said={shared !== null} />
        </Cell>
        <Cell label="Uptime" info="Checks of the home page from the desk's own server, every two minutes, since the probe started. Healthy at 99.9% or more, degraded from 99%: the desk's own yardstick. When the desk itself is down there is a gap, not downtime.">
          <Uptime reading={panel.uptime} />
        </Cell>
      </div>
      </div>
      {shared ? <Absent reading={shared} className="dk-overview-perfabsent" /> : null}
      <p className="dk-overview-foot">
        {stamps(panel)}
      </p>
    </Card>
  );
}
