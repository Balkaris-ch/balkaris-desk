import type { Reading, Stat } from "@/contract/common";
import type { SeoAutomationsPayload, SeoJobsDay } from "@/contract/seo/automations";
import { SparkBars } from "@/components/charts/SparkBars";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Stamp } from "@/components/ui/Stamp";
import { Tile, Tiles } from "@/components/ui/Tile";
import { Info } from "@/components/ui/Tooltip";
import { cx } from "@/lib/cx";
import { ago, num } from "@/lib/format";
import { when } from "./words";

/**
 * The row over the table. The board has two (Automations active, Next run)
 * and a "New automation" button; the button is left out, because the SEO
 * jobs are the desk's code and none can be made from a screen. In its place
 * two more true things: the last 24 hours of runs, and the request budgets
 * the jobs keep.
 */
export function AutomationTiles({ d }: { d: SeoAutomationsPayload }) {
  const on = d.jobs.filter((j) => j.enabled).length;
  const active: Reading<Stat> = d.jobs.length
    ? {
        state: "ok",
        value: { value: on, of: d.jobs.length, previous: null, unit: "count", series: [], sub: d.running ? `${num(d.running)} running now` : "None running now" },
        source: "desk",
        asOf: d.head.at,
        note: "The desk's own scheduler. It runs one job at a time.",
      }
    : { state: "off", source: "desk", reason: d.jobsWhy ?? "No SEO job is registered on this desk yet." };
  const day: Reading<Stat> = mapDay(d.day);
  const budgets = d.jobs.flatMap((j) => (j.budget ? [{ name: j.name, ...j.budget }] : []));
  const failing = d.day.state === "ok" ? d.day.value.failing.length : 0;
  const late = d.day.state === "ok" ? d.day.value.late : [];

  return (
    <Tiles count={4}>
      <Tile
        label="Automations on"
        icon="play"
        reading={active}
        delta="none"
        info="The SEO jobs switched on, of all the SEO section runs on. Only the owner can switch one off; a job waiting for its source is on and simply does not run yet."
        badge={d.running ? <Badge tone="info" dot>Running</Badge> : null}
      />
      <NextTile next={d.next} at={d.head.at} scheduler={d.scheduler} />
      <Tile
        label="Runs, last 24 hours"
        icon="check-circle"
        reading={day}
        delta="none"
        info="Runs of these jobs that finished in the last 24 hours. A run a restart of the desk cut off counts as neither finished nor failed. Failing: jobs whose newest run failed. Late: jobs more than ten minutes past their time that have not started."
        badge={
          failing || late.length ? (
            <span className="dk-seo-automations-badges">
              {failing ? (
                <Badge tone="bad" dot>
                  {num(failing)} failing
                </Badge>
              ) : null}
              {late.length ? (
                <span title={`Late: ${late.join("; ")}`}>
                  <Badge tone="warn" dot>
                    {num(late.length)} late
                  </Badge>
                </span>
              ) : null}
            </span>
          ) : null
        }
        chart={(s) => <SparkBars data={s.series} label="Runs started, hour by hour" />}
      />
      <article className="dk-tile dk-tile--icon">
        <span className="dk-tile-icon dk-tone-good" aria-hidden>
          <Icon name="gauge" size={18} />
        </span>
        <div className="dk-tile-main">
          <div className="dk-tile-top">
            <h3 className="dk-tile-label">
              <span className="dk-tile-label-text">Request budgets</span>
              <Info text="Limits the jobs keep on what they ask outside the desk: Google Autocomplete by the desk's own weekly cap, URL Inspection under Google's daily quota per property. A job stops before it passes its budget." />
            </h3>
          </div>
          {budgets.length ? (
            <ul className="dk-seo-automations-budgets">
              {budgets.map((b) => (
                <li key={b.name} title={b.line}>
                  <span className="dk-seo-automations-budget-line">
                    <span>{b.name === "seo-research" ? "Autocomplete" : b.name === "gsc-inspect" ? "URL Inspection" : b.name}</span>
                    <span className="dk-num">
                      {num(b.used)} / {num(b.cap)} {b.period === "week" ? "this week" : "today"}
                    </span>
                  </span>
                  <ProgressBar value={b.used} max={b.cap} tone={b.used >= b.cap ? "warn" : "good"} label={b.line} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="dk-seo-automations-quiet">No job with a request budget is registered.</p>
          )}
          <Stamp source="desk" asOf={d.head.at} />
        </div>
      </article>
    </Tiles>
  );
}

function mapDay(r: Reading<SeoJobsDay>): Reading<Stat> {
  if (r.state !== "ok") return r;
  const v = r.value;
  const parts = [`${num(v.failed)} failed`, ...(v.cut ? [`${num(v.cut)} cut off by a restart`] : [])];
  return { ...r, value: { value: v.ok, previous: null, unit: "count", series: v.series, sub: parts.join(" · ") } };
}

/**
 * "Next run": a time, not a number, so it is drawn in the tile's shape rather
 * than through `Tile`. The soonest start by the desk's rules; when that time
 * passed more than ten minutes ago it says "Late" and since when, with the
 * day, instead of a "Due now" that can stand for days.
 */
function NextTile({ next, at, scheduler }: { next: SeoAutomationsPayload["next"]; at: string; scheduler: SeoAutomationsPayload["scheduler"] }) {
  const due = next !== null && Date.parse(next.at) <= Date.parse(at);
  const info = scheduler.on
    ? "The next of these jobs the desk's scheduler will start. It wakes every thirty seconds and runs one job at a time, so a job may start a little after its time; more than ten minutes after, the job is late, and the SEO watch puts it at the front of the queue."
    : "The next of these jobs by their schedules. Nothing starts by itself on this desk (its scheduler is switched off), so every job past its time is late until somebody presses Run now.";
  return (
    <article className="dk-tile dk-tile--icon">
      <span className={cx("dk-tile-icon", next?.late ? "dk-tone-warn" : "dk-tone-good")} aria-hidden>
        <Icon name="clock" size={18} />
      </span>
      <div className="dk-tile-main">
        <div className="dk-tile-top">
          <h3 className="dk-tile-label">
            <span className="dk-tile-label-text">Next run</span>
            <Info text={info} />
          </h3>
        </div>
        {next ? (
          <>
            <p className="dk-tile-figure dk-num">
              <time dateTime={next.at} className={cx("dk-seo-automations-next", (due || next.late) && "dk-seo-automations-next--due", next.late && "dk-seo-automations-next--late")}>
                {next.late ? "Late" : due ? "Due now" : ago(next.at, at)}
              </time>
            </p>
            <p className="dk-tile-sub" title={next.title}>
              {next.title} · <span className="dk-num">{next.late ? `due since ${when(next.at, at)}` : when(next.at, at)}</span>
            </p>
            <Stamp source="desk" asOf={at} />
          </>
        ) : (
          <p className="dk-seo-automations-quiet">No job is scheduled: every one is off, running or waiting for its source.</p>
        )}
      </div>
    </article>
  );
}
