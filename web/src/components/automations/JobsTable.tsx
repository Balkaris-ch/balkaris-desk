"use client";

import { useActionState, useEffect, useId, useState } from "react";
import type { AutomationJob } from "@/contract/automations";
import { SparkBars } from "@/components/charts/SparkBars";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icons";
import { StatusDot } from "@/components/ui/StatusDot";
import { cx } from "@/lib/cx";
import { ago, clock, feedTime, num } from "@/lib/format";
import { runJob, switchJob, type Said } from "./actions";
import { announceAsked } from "./Watch";
import { everyText, JOB_ICON, RUN_STATE, SOURCE_ICON, STATE, took } from "./words";

export interface JobsTableProps {
  jobs: AutomationJob[];
  /** Only the owner is shown the on/off switch; the desk refuses anybody else anyway. */
  owner: boolean;
  /** When the server read the jobs (ISO): every "ago" on the screen is counted from it, so the server and the browser print the same words. */
  at: string;
}

/**
 * Background jobs: one row per scheduled job, the way Site Health's panel
 * draws them, with what that panel leaves out: what each does, how often,
 * its source, its recent durations, Run now, the owner's switch, and its
 * last runs when the row is opened.
 *
 * The head and every row share one set of columns (a grid with subgrid
 * rows), so the controls column is only as wide as the widest row's
 * controls: a switch and a chevron when nothing can be run now.
 */
export function JobsTable({ jobs, owner, at }: JobsTableProps) {
  return (
    <div className="dk-automations-jobs">
      <div className="dk-automations-jobs-grid">
        <div className="dk-automations-jobs-head" aria-hidden>
          <span>Job</span>
          <span>How often</span>
          <span>Status</span>
          <span>Last run</span>
          <span>Next run</span>
          <span className="dk-automations-num">Runs, 24h</span>
          <span>Durations</span>
          <span />
        </div>
        <ol className="dk-automations-jobs-list" aria-label="Scheduled jobs">
          {jobs.map((j) => (
            <JobRow key={j.name} job={j} owner={owner} at={at} />
          ))}
        </ol>
      </div>
    </div>
  );
}

/** A label for a cell that only shows when the row is laid out as a card (narrow screens), and is read out always. */
function Label({ children }: { children: string }) {
  return <span className="dk-automations-cell-label">{children}</span>;
}

function nextText(j: AutomationJob, at: string): { text: string; title?: string } {
  if (j.running) return { text: "running now" };
  if (!j.enabled) return { text: "—", title: "Switched off: it has no next run until it is switched on." };
  if (j.state === "paused") {
    return j.nextRun
      ? {
          text: ago(j.nextRun, at),
          title: `Paused by its source${j.pausedUntil ? ` until ${when(j.pausedUntil, at)}` : ""}. It runs again by itself at ${when(j.nextRun, at)}, once the pause is over and a full interval has passed since its last start.`,
        }
      : { text: "—", title: "Paused by its source: it runs again by itself when the pause ends." };
  }
  if (!j.ready) {
    return j.state === "waiting"
      ? { text: "—", title: "It runs once what it reads is connected." }
      : { text: "—", title: "Not scheduled: it has nothing left to ask." };
  }
  if (!j.nextRun) return { text: "—" };
  return Date.parse(j.nextRun) <= Date.parse(at) ? { text: "due now", title: "Its time has come: it starts when the scheduler next wakes, within half a minute, or after the job running now." } : { text: ago(j.nextRun, at) };
}

/** "13:32" today, "Yesterday 13:32", "30 Sep 13:32". */
const when = (iso: string, at: string): string => {
  const day = feedTime(iso, at);
  return day === clock(iso) ? day : `${day} ${clock(iso)}`;
};

function JobRow({ job: j, owner, at }: { job: AutomationJob; owner: boolean; at: string }) {
  const [open, setOpen] = useState(false);
  const region = useId();
  const state = STATE[j.state];
  const icon = JOB_ICON[j.name] ?? (j.source ? SOURCE_ICON[j.source.id] : undefined) ?? "clock";
  const next = nextText(j, at);
  const askable = j.askableFrom !== null && Date.parse(j.askableFrom) <= Date.parse(at);
  const dayRuns = j.day.ok + j.day.failed;
  const sourceTrouble = j.source && j.source.state !== "connected" && j.state !== "waiting" && j.state !== "paused" ? j.source : null;
  /* The newest attempt was cut off by a restart, after the run "Last run" shows. */
  const cut = !j.running && j.recent[0]?.state === "cut" ? j.recent[0] : null;
  const last = j.last;

  const [ran, runAction, running] = useActionState<Said | null, FormData>(runJob, null);
  const [switched, switchAction, switching] = useActionState<Said | null, FormData>(switchJob, null);
  const said = latest(ran, switched);
  const shown = useFresh(said);

  useEffect(() => {
    if (ran?.ok) announceAsked();
  }, [ran]);

  return (
    <li className={cx("dk-automations-job", open && "dk-automations-job--open")} data-state={j.state}>
      <div className="dk-automations-job-row">
        <div className="dk-automations-job-name">
          <span className={cx("dk-automations-job-icon", `dk-tone-${state.tone}`)} aria-hidden>
            <Icon name={icon} size={16} />
          </span>
          <span className="dk-automations-job-titles">
            <b className="dk-automations-job-title" title={j.title}>
              {j.title}
            </b>
            <span className="dk-automations-job-does" title={j.does}>
              {j.does}
            </span>
          </span>
        </div>

        <div className="dk-automations-cell dk-automations-cell--every">
          <Label>How often</Label>
          <span>{everyText(j.every)}</span>
        </div>

        <div className="dk-automations-cell dk-automations-cell--status">
          <Label>Status</Label>
          <StatusDot tone={state.tone} pulse={j.running}>
            {state.label}
          </StatusDot>
          {j.running && j.progress ? (
            <small className="dk-num">
              {num(j.progress.done)} of {num(j.progress.of)}
              {j.progress.what ? ` · ${j.progress.what}` : ""}
            </small>
          ) : j.running && j.lastStart ? (
            <small className="dk-num">since {clock(j.lastStart)}</small>
          ) : (j.state === "waiting" || j.state === "paused") && j.source ? (
            <small className="dk-automations-wrap" title={j.source.reason}>
              {j.source.name}
            </small>
          ) : cut ? (
            <small className="dk-num" title="A restart of the desk cut that run off: it neither finished nor failed. Last run shows the run before it.">
              cut off at {when(cut.start, at)}
            </small>
          ) : sourceTrouble ? (
            <small className="dk-automations-warn dk-automations-wrap" title={sourceTrouble.reason}>
              {sourceTrouble.name}: {sourceTrouble.state === "off" ? "not connected" : sourceTrouble.state}
            </small>
          ) : null}
        </div>

        <div className="dk-automations-cell dk-automations-cell--last">
          <Label>Last run</Label>
          {last ? (
            <>
              <span className="dk-num">
                <time dateTime={last.start ?? last.end}>{ago(last.start ?? last.end, at)}</time>
                {last.ms !== null ? <span className="dk-automations-quiet"> · {took(last.ms)}</span> : null}
              </span>
              {last.note ? (
                <small className={cx(!last.ok && "dk-automations-bad")} title={last.note}>
                  {last.note}
                </small>
              ) : null}
            </>
          ) : (
            <span className="dk-automations-quiet">{j.running ? "none finished yet" : "never"}</span>
          )}
        </div>

        <div className="dk-automations-cell dk-automations-cell--next">
          <Label>Next run</Label>
          <span className="dk-num" title={next.title}>
            {j.nextRun && next.text !== "—" && next.text !== "running now" ? <time dateTime={j.nextRun}>{next.text}</time> : next.text}
          </span>
        </div>

        <div className="dk-automations-cell dk-automations-cell--runs">
          <Label>Runs, 24h</Label>
          <span className="dk-num">{num(dayRuns)}</span>
          <small className={cx("dk-num", j.day.failed > 0 && "dk-automations-bad")}>{j.day.failed > 0 ? `${num(j.day.failed)} failed` : dayRuns ? "none failed" : ""}</small>
        </div>

        <div className="dk-automations-cell dk-automations-cell--spark">
          <Label>Durations</Label>
          {j.durations.length > 1 ? (
            <SparkBars data={j.durations} size="row" tone={j.lastOk === false ? "bad" : "good"} label={`Durations of the last ${j.durations.length} runs, from ${took(Math.min(...j.durations))} to ${took(Math.max(...j.durations))}`} />
          ) : (
            <span className="dk-automations-quiet">—</span>
          )}
        </div>

        <div className="dk-automations-cell dk-automations-cell--controls">
          {askable ? (
            <form action={runAction}>
              <input type="hidden" name="name" value={j.name} />
              <Button type="submit" size="xs" icon="play" disabled={running} aria-label={`Run "${j.title}" now`}>
                {running ? "Asking…" : "Run now"}
              </Button>
            </form>
          ) : null}
          {owner ? (
            <form action={switchAction}>
              <input type="hidden" name="name" value={j.name} />
              <input type="hidden" name="enabled" value={j.enabled ? "0" : "1"} />
              <button
                type="submit"
                role="switch"
                aria-checked={j.enabled}
                aria-label={`"${j.title}" is ${j.enabled ? "on" : "off"}. Switch it ${j.enabled ? "off" : "on"}`}
                className={cx("dk-automations-switch", j.enabled && "dk-automations-switch--on")}
                disabled={switching}
              >
                <span className="dk-automations-switch-knob" />
              </button>
            </form>
          ) : null}
          <button
            type="button"
            className="dk-automations-open"
            aria-expanded={open}
            aria-controls={region}
            aria-label={`${open ? "Hide" : "Show"} what "${j.title}" does and its last runs`}
            onClick={() => setOpen((o) => !o)}
          >
            <Icon name="chevron-right" size={14} />
          </button>
        </div>
      </div>

      {shown ? (
        <p className={cx("dk-automations-said", !shown.ok && "dk-automations-said--bad")} role="status">
          <Icon name={shown.ok ? "check" : "alert"} size={14} />
          <span>{shown.message}</span>
        </p>
      ) : null}

      <div id={region} className="dk-automations-more" hidden={!open}>
        {open ? <JobMore job={j} owner={owner} at={at} /> : null}
      </div>
    </li>
  );
}

/** What opens under a row: what the job does, what it reads, and its last runs. */
function JobMore({ job: j, owner, at }: { job: AutomationJob; owner: boolean; at: string }) {
  const s = j.source;
  const sourceWord = !s
    ? null
    : s.state === "connected"
      ? "connected"
      : s.state === "off"
        ? "not connected"
        : s.state === "failing"
          ? "failing"
          : j.state === "paused"
            ? "paused"
            : "connected, nothing yet";
  return (
    <div className="dk-automations-more-grid">
      <div className="dk-automations-more-about">
        <p className="dk-automations-more-does">{j.does}</p>
        <dl className="dk-automations-facts">
          <dt>How often</dt>
          <dd>{everyText(j.every)}</dd>
          <dt>Reads</dt>
          <dd>
            {s ? (
              <>
                {s.name} ·{" "}
                <span className={cx(s.state === "connected" ? "dk-automations-good" : s.state === "failing" ? "dk-automations-bad" : "dk-automations-warn")}>{sourceWord}</span>
                {s.lastOk ? <span className="dk-automations-quiet"> · last answered {ago(s.lastOk, at)}</span> : null}
              </>
            ) : (
              <span className="dk-automations-quiet">Not named for this job.</span>
            )}
          </dd>
          {j.state === "paused" && j.nextRun ? (
            <>
              <dt>Paused</dt>
              <dd>
                {j.pausedUntil ? (
                  <>
                    Its source asked the desk to wait until <time dateTime={j.pausedUntil}>{when(j.pausedUntil, at)}</time>.{" "}
                  </>
                ) : (
                  "Its source asked the desk to wait. "
                )}
                It runs again by itself at <time dateTime={j.nextRun}>{when(j.nextRun, at)}</time>, once the pause is over and a full interval has passed since its last start. It cannot be run before.
              </dd>
            </>
          ) : null}
          <dt>Counted</dt>
          <dd className="dk-num">
            {num(j.runs)} run{j.runs === 1 ? "" : "s"}, {num(j.fails)} failed, since the desk began keeping them
          </dd>
          {!owner ? (
            <>
              <dt>Switch</dt>
              <dd className="dk-automations-quiet">{j.enabled ? "On" : "Off"}. Only the owner can switch a job off or on.</dd>
            </>
          ) : null}
        </dl>
        {s && s.state !== "connected" && (s.reason || s.step) ? (
          <div className="dk-automations-step">
            {s.reason ? <p>{s.reason}</p> : null}
            {s.step ? (
              <p className="dk-automations-step-do">
                <Icon name="arrow-right" size={14} />
                <span>{s.step}</span>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="dk-automations-more-runs">
        <p className="dk-automations-more-head">Last runs</p>
        {j.recent.length ? (
          <ol className="dk-automations-runs">
            {j.recent.map((r) => {
              const rs = RUN_STATE[r.state];
              return (
                <li key={r.start}>
                  <time className="dk-num" dateTime={r.start}>
                    {when(r.start, at)}
                  </time>
                  <StatusDot tone={rs.tone} title={rs.title} />
                  <span className="dk-num dk-automations-quiet">{r.ms !== null ? took(r.ms) : rs.word}</span>
                  <span className="dk-automations-run-note" title={r.note ?? (r.state === "cut" ? rs.title : undefined)}>
                    {r.note ?? (r.state === "ok" ? "Finished, and said nothing." : r.state === "cut" ? "A restart of the desk cut it off." : r.state === "running" && j.progress ? `${num(j.progress.done)} of ${num(j.progress.of)}${j.progress.what ? ` · ${j.progress.what}` : ""}` : "")}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="dk-automations-quiet">{j.state === "waiting" ? "It has never run: what it reads is not connected." : "It has not run yet."}</p>
        )}
      </div>
    </div>
  );
}

/** The newer of two answers. */
function latest(a: Said | null, b: Said | null): Said | null {
  if (!a) return b;
  if (!b) return a;
  return a.at >= b.at ? a : b;
}

/** An answer for twenty seconds after it came, then nothing: the row's state says the rest. */
function useFresh(said: Said | null): Said | null {
  const [shown, setShown] = useState<Said | null>(null);
  useEffect(() => {
    if (!said) return;
    setShown(said);
    const t = setTimeout(() => setShown(null), said.ok ? 12_000 : 20_000);
    return () => clearTimeout(t);
  }, [said]);
  return shown;
}
