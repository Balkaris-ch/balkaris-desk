import type { JobListed, Reading } from "@/contract/common";
import type { SeoTechnicalPayload, TechVitals, VitalFigure } from "@/contract/seo/technical";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Stamp } from "@/components/ui/Stamp";
import { Tooltip } from "@/components/ui/Tooltip";
import { Absent } from "@/components/ui/Read";
import { PanelAbsent } from "@/components/seo/bits";
import { cx } from "@/lib/cx";
import { ago, duration, num } from "@/lib/format";
import { RunJob } from "./Act";
import { Body, PathLink, pageView, Quiet, ratingTone, ratingWord, vitalValue } from "./bits";

/**
 * The board's right column: Core Web Vitals (LCP, INP, CLS) and Page speed
 * issues. Every figure says whether it is the lab (one Lighthouse load on
 * Google's machine) or the field (real Chrome visits over 28 days); INP exists
 * only in the field, and Total Blocking Time stands in for it under its own
 * name.
 */

const kindLine = (v: VitalFigure): string =>
  v.kind === "field" ? `Field · ${v.scope === "origin" ? "the whole site" : "this page"}, ${v.window}` : `Lab · mobile${v.scope === "site" ? `, median of ${num(v.pages)} page${v.pages === 1 ? "" : "s"}` : ""}`;

function One({ label, reading, stand }: { label: string; reading: Reading<VitalFigure>; stand?: Reading<VitalFigure> }) {
  if (reading.state !== "ok") {
    /* INP has no lab version: the lab's stand-in is shown under its own name. */
    if (stand?.state === "ok") {
      const t = stand.value;
      return (
        <div className="dk-seo-technical-vital">
          <p className="dk-seo-technical-vital-label">
            {label}
            <Tooltip text={`${reading.reason}${reading.state === "off" && reading.step ? ` ${reading.step}` : ""}`}>
              <span className="dk-seo-technical-vital-none" tabIndex={0}>
                no field data
              </span>
            </Tooltip>
          </p>
          <p className="dk-seo-technical-vital-value dk-num">{vitalValue(t)}</p>
          <p className={cx("dk-seo-technical-vital-rating", `dk-seo-technical-ink-${ratingTone(t.rating)}`)}>{ratingWord(t.rating)}</p>
          <p className="dk-seo-technical-vital-kind">TBT, the lab’s stand-in · not INP</p>
        </div>
      );
    }
    return (
      <div className="dk-seo-technical-vital">
        <p className="dk-seo-technical-vital-label">{label}</p>
        <Absent reading={reading} form="tile" />
      </div>
    );
  }
  const v = reading.value;
  return (
    <div className="dk-seo-technical-vital">
      <p className="dk-seo-technical-vital-label">
        <Tooltip text={`${v.name}. ${ratingWord(v.rating)} at ${v.unit === "ms" ? duration(v.limits.good) : num(v.limits.good, 2)} or under, poor over ${v.unit === "ms" ? duration(v.limits.poor) : num(v.limits.poor, 2)}, by ${v.limits.by}.`}>
          <span tabIndex={0}>{label}</span>
        </Tooltip>
      </p>
      <p className="dk-seo-technical-vital-value dk-num">{vitalValue(v)}</p>
      <p className={cx("dk-seo-technical-vital-rating", `dk-seo-technical-ink-${ratingTone(v.rating)}`)}>{ratingWord(v.rating)}</p>
      <p className="dk-seo-technical-vital-kind">{kindLine(v)}</p>
    </div>
  );
}

export function VitalsCard({ vitals }: { vitals: TechVitals }) {
  const all = [vitals.lcp, vitals.inp, vitals.cls];
  const absent = all.filter((r): r is Exclude<Reading<VitalFigure>, { state: "ok" }> => r.state !== "ok");
  const first = absent[0];
  /* One reason for all three (no test has measured anything): said once, not three times. */
  const same = absent.length === 3 && first !== undefined && absent.every((r) => r.reason === first.reason) && vitals.tbt.state !== "ok";
  const shown = all.find((r) => r.state === "ok");
  return (
    <Card
      title="Core Web Vitals"
      icon="gauge"
      info="Largest Contentful Paint, Interaction to Next Paint and Cumulative Layout Shift. Field data (real Chrome visits, 75th percentile, 28 days) when Google has any for the site; otherwise PageSpeed’s lab run on a simulated phone, which is a measurement of the page, not of any visitor. INP exists only in the field."
      right={shown ? <Stamp reading={shown} /> : null}
      className="dk-seo-technical-vitals"
    >
      {same && first ? (
        <div className="dk-seo-technical-absent">
          <PanelAbsent reading={first} />
        </div>
      ) : (
        <div className="dk-seo-technical-vital-row">
          <One label="LCP" reading={vitals.lcp} />
          <One label="INP" reading={vitals.inp} stand={vitals.tbt} />
          <One label="CLS" reading={vitals.cls} />
        </div>
      )}
    </Card>
  );
}

/** Page speed issues: the newest PageSpeed lab runs, slowest first, and the test on demand. */
export function SpeedCard({ speed, job }: { speed: SeoTechnicalPayload["speed"]; job: JobListed | null }) {
  const why = job && !job.ready ? "The speed test cannot run now: Google answered 429 (quota) and the desk waits a day before asking again, or it has no key. The reason is under the panel." : undefined;
  return (
    <Card
      title="Page speed issues"
      icon="bolt"
      id="speed"
      info="PageSpeed Insights’ lab run of each page on the daily list (the home page, the insights index, the newest article, two services and one industry page) on a simulated phone. Slowest Largest Contentful Paint first. Lab: one load each on Google’s machine, not visitors."
      right={job ? <RunJob name={job.name} label="Run test" ready={job.ready && job.enabled} running={job.running} why={why ?? (!job.enabled ? "Switched off in Automations." : undefined)} /> : null}
      flush
      className="dk-seo-technical-speed"
    >
      <Body reading={speed}>
        {(s) => (
          <div>
            {s.lcpLimits ? (
              <Quiet className="dk-seo-technical-pad-x">
                {num(s.slow ?? 0)} of {num(s.measured ?? 0)} measured pages over {duration(s.lcpLimits.good)} LCP ({s.lcpLimits.by}){s.failed ? `; ${num(s.failed)} run${s.failed === 1 ? "" : "s"} failed` : ""}.
              </Quiet>
            ) : null}
            <ul className="dk-seo-technical-rows" aria-label="Page speed, slowest first">
              {s.rows.map((r) => (
                <li key={`${r.path}-${r.strategy ?? "m"}`} className="dk-seo-technical-speed-row">
                  <PathLink path={r.path} />
                  {r.lcpMs !== null ? (
                    <span className={cx("dk-num dk-seo-technical-speed-lcp", `dk-seo-technical-ink-${ratingTone(r.rating?.lcp)}`)} title={`Largest Contentful Paint, lab, ${ago(r.at)}`}>
                      {duration(r.lcpMs)}
                    </span>
                  ) : (
                    <span className="dk-seo-technical-speed-failed" title={r.failure ?? "The run measured nothing."}>
                      failed
                    </span>
                  )}
                  <span className="dk-seo-technical-speed-more dk-num">
                    {r.tbtMs !== null ? <span title="Total Blocking Time, lab">TBT {duration(r.tbtMs)}</span> : null}
                    {r.cls !== null ? <span title="Cumulative Layout Shift, lab">CLS {num(r.cls, 2)}</span> : null}
                  </span>
                  <LinkButton href={pageView(r.path)} size="xs" variant="quiet">
                    View
                  </LinkButton>
                </li>
              ))}
            </ul>
            <div className="dk-seo-technical-stampline">
              <Stamp reading={speed} />
            </div>
          </div>
        )}
      </Body>
      {job && speed.state !== "ok" && job.lastEnd ? (
        <Quiet className="dk-seo-technical-pad">
          The test last ran {ago(job.lastEnd)}
          {job.lastNote ? `: ${job.lastNote}` : "."}
        </Quiet>
      ) : null}
    </Card>
  );
}
