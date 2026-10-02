import type { ReactNode } from "react";
import type { Reading } from "@/contract/common";
import type { PerfTrend, ResponseSeries, TrendRange, ResponseRange, VitalNow } from "@/contract/health";
import { AreaChart, Legend, LineChart, Meter } from "@/components/charts";
import { Badge, Chip } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Delta } from "@/components/ui/Delta";
import { Absent, Read } from "@/components/ui/Read";
import { Select } from "@/components/ui/Select";
import { Stamp } from "@/components/ui/Stamp";
import { change, duration, figure, fullDate, num, rangeLabel } from "@/lib/format";
import { sinceText, VITAL_WORDS, VITALS, vitalTone } from "./rules";

/** A headline figure over a chart: "1.3s", and under it its name and its change. */
function Fig({ value, name, delta }: { value: string; name: ReactNode; delta?: ReactNode }) {
  return (
    <div className="dk-health-fig">
      <p className="dk-health-fig-value dk-num">{value}</p>
      <p className="dk-health-fig-name">
        <span>{name}</span>
        {delta}
      </p>
    </div>
  );
}

/** The change of a figure where less is better, in percent; a dash when there is no earlier figure. */
const fall = (value: number, previous: number | null) => <Delta percent={change(value, previous)} downIsGood size="sm" />;

/** Under a chart: where the figures come from, and where their history begins. */
function Foot({ reading, since }: { reading: Reading<unknown>; since?: string | null }) {
  return (
    <p className="dk-health-foot dk-health-foot--chart">
      <Stamp reading={reading} />
      {since ? <span className="dk-health-since">{since}</span> : null}
    </p>
  );
}

/** A figure's name with its line's colour key before it, as a legend draws it. */
function Keyed({ color, children }: { color: "green" | "blue"; children: ReactNode }) {
  return (
    <>
      <i className={`dk-health-key dk-c-${color}`} aria-hidden />
      {children}
    </>
  );
}

/** The plot's height on the board: about 84px under the figures. */
const PLOT = 84;

/* ---------- Performance trend ------------------------------------------------- */

const TREND_OPTIONS = (["7d", "30d", "90d"] as const).map((r) => ({ value: r, label: rangeLabel(r) }));

/**
 * LCP (s), the responsiveness line and CLS (x10), one point a day from the
 * desk's own history. The responsiveness line is INP only when Google has
 * field data; otherwise it is Total Blocking Time and says so in the legend.
 * Both are plotted in seconds so the three share one honest axis.
 */
export function PerformanceTrend({ reading, range }: { reading: Reading<PerfTrend>; range: TrendRange }) {
  return (
    <Card
      title="Performance trend"
      icon="pulse"
      className="dk-health-card"
      right={<Select param="trend" label="Performance trend period" options={TREND_OPTIONS} fallback="30d" />}
    >
      <Read reading={reading}>
        {(t, r) => {
          const second = t.second.metric === "inp" ? "INP" : "TBT";
          const lcpS = t.lcpMs.map((v) => (v === null ? null : v / 1000));
          const secondS = t.second.values.map((v) => (v === null ? null : v / 1000));
          const cls10 = t.cls.map((v) => (v === null ? null : v * 10));
          return (
            <div className="dk-health-chartbox">
              <div className="dk-health-figs">
                {t.latest.lcpMs ? <Fig value={figure(t.latest.lcpMs.value / 1000, "s")} name="LCP" delta={fall(t.latest.lcpMs.value, t.latest.lcpMs.previous)} /> : null}
                {t.latest.second ? <Fig value={duration(t.latest.second.value)} name={second} delta={fall(t.latest.second.value, t.latest.second.previous)} /> : null}
                {t.latest.cls ? <Fig value={figure(t.latest.cls.value, "ratio")} name="CLS" delta={fall(t.latest.cls.value, t.latest.cls.previous)} /> : null}
                {/* The legend where the board draws it, beside the figures. */}
                <Legend
                  className="dk-health-legend"
                  items={[
                    { label: "LCP (s)", color: "green" },
                    { label: `${second} (s)`, color: "blue" },
                    { label: "CLS (x10)", color: "violet" },
                  ]}
                />
              </div>
              <AreaChart
                label={`Performance trend: LCP, ${second} and CLS, ${rangeLabel(range).toLowerCase()}`}
                x={t.days}
                unit="ratio"
                integer={false}
                height={PLOT}
                series={[
                  { label: "LCP (s)", data: lcpS, color: "green" },
                  { label: `${second} (s)${t.second.kind === "lab" ? ", lab" : ", field"}`, data: secondS, color: "blue" },
                  { label: "CLS (x10)", data: cls10, color: "violet" },
                ]}
                emptyNote="No speed test has recorded a day in this window yet."
              />
              <Foot reading={r} since={`mobile · ${sinceText(t.since)}`} />
            </div>
          );
        }}
      </Read>
    </Card>
  );
}

/* ---------- Response time -------------------------------------------------------- */

const RESPONSE_OPTIONS = (["1h", "24h", "7d"] as const).map((r) => ({ value: r, label: rangeLabel(r) }));

/**
 * The probes' time to first byte, split into what Vercel's cache answered and
 * what had to run. "Edge" and "origin" are the board's words; the split is by
 * Vercel's own x-vercel-cache header.
 */
export function ResponseTime({ reading, range }: { reading: Reading<ResponseSeries>; range: ResponseRange }) {
  return (
    <Card
      title="Response time (edge & origin)"
      icon="line-chart"
      className="dk-health-card"
      right={<Select param="rt" label="Response time period" options={RESPONSE_OPTIONS} fallback="24h" />}
    >
      <Read reading={reading}>
        {(s, r) => (
          <div className="dk-health-chartbox">
            <div className="dk-health-figs">
              <Fig value={`${num(s.average.value)}ms`} name="Average" delta={fall(s.average.value, s.average.previous)} />
              {/* The two lines' names carry the legend's keys: the board's legend line holds the stamp instead. */}
              {s.cachedAvg ? <Fig value={`${num(s.cachedAvg.value)}ms`} name={<Keyed color="green">Cached (edge)</Keyed>} delta={fall(s.cachedAvg.value, s.cachedAvg.previous)} /> : null}
              {s.renderedAvg ? <Fig value={`${num(s.renderedAvg.value)}ms`} name={<Keyed color="blue">Rendered (origin)</Keyed>} delta={fall(s.renderedAvg.value, s.renderedAvg.previous)} /> : null}
            </div>
            <LineChart
              label={`Response time, ${rangeLabel(range).toLowerCase()}: cached and rendered`}
              x={s.x}
              unit="ms"
              integer
              height={PLOT}
              series={[
                { label: "Cached (edge)", data: s.cached, color: "green" },
                { label: "Rendered (origin)", data: s.rendered, color: "blue" },
              ]}
              emptyNote="No answered check in this window yet."
            />
            <Foot reading={r} since={`${num(s.average.checks)} checks · ${sinceText(s.since)}`} />
          </div>
        )}
      </Read>
    </Card>
  );
}

/* ---------- Core Web Vitals ----------------------------------------------------------- */

function VitalRow({ metric, reading }: { metric: keyof typeof VITALS; reading: Reading<VitalNow> }) {
  const v = VITALS[metric];
  /* LCP is held in ms by the source and shown in seconds, as Google states its threshold. */
  const value = reading.state === "ok" ? (metric === "lcp" ? reading.value.value / 1000 : reading.value.value) : null;
  const unit = metric === "lcp" ? "s" : metric === "inp" ? "ms" : "ratio";
  const tone = value === null ? "quiet" : vitalTone(value, v.good, v.poor);
  return (
    <div className="dk-health-vital">
      <p className="dk-health-vital-name">
        <span>{v.name}</span>
        {reading.state === "ok" ? (
          <Chip tone={reading.value.kind === "field" ? "info" : "quiet"} className="dk-health-kind">
            {reading.value.kind === "field" ? "Field" : "Lab"}
          </Chip>
        ) : null}
      </p>
      <div className="dk-health-vital-row">
        <span className="dk-health-vital-value dk-num">{value === null ? <Absent reading={reading as Exclude<Reading<VitalNow>, { state: "ok" }>} form="inline" /> : figure(value, unit)}</span>
        <span className="dk-health-vital-chip">
          {value !== null ? (
            <Badge tone={tone} dot>
              {VITAL_WORDS[tone]}
            </Badge>
          ) : (
            <span className="dk-health-vital-none">{reading.state === "waiting" ? "Nothing yet" : "Not available"}</span>
          )}
        </span>
        <Meter className="dk-health-meter" label={v.name} value={value} good={v.good} poor={v.poor} unit={unit} ticks={false} />
        <span className="dk-health-vital-edge dk-num">{figure(v.good, unit)}</span>
      </div>
    </div>
  );
}

/**
 * LCP, INP and CLS against Google's published thresholds. Field values when
 * Google has data for the site, otherwise lab values labelled lab; INP has no
 * lab version and is absent with its reason.
 */
export function CoreWebVitals({ vitals }: { vitals: { lcp: Reading<VitalNow>; inp: Reading<VitalNow>; cls: Reading<VitalNow> } }) {
  const any = [vitals.lcp, vitals.inp, vitals.cls].find((r) => r.state === "ok");
  const label = !any || any.state !== "ok" ? null : any.value.kind === "field" ? `Field · ${any.value.window}` : `Lab · run ${fullDate(any.asOf)}`;
  return (
    <Card title="Core Web Vitals" icon="gauge" className="dk-health-card" right={label ? <span className="dk-health-window">{label}</span> : null}>
      {any && any.state === "ok" ? (
        <>
          <div className="dk-health-vitals">
            <VitalRow metric="lcp" reading={vitals.lcp} />
            <VitalRow metric="inp" reading={vitals.inp} />
            <VitalRow metric="cls" reading={vitals.cls} />
          </div>
          <p className="dk-health-foot">
            <Stamp reading={any} />
          </p>
        </>
      ) : (
        /* Nothing measured at all: the panel says what is missing and the step, in place. */
        <Absent reading={vitals.lcp as Exclude<Reading<VitalNow>, { state: "ok" }>} />
      )}
    </Card>
  );
}
