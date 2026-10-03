"use client";

import { useActionState, useEffect, useId, useState } from "react";
import type { Reading } from "@/contract/common";
import type { SeoJobRuns } from "@/contract/seo/automations";
import type { SeoJob } from "@/contract/seo/common";
import { runJob, switchJob, type Said } from "@/components/automations/actions";
import { announceAsked } from "@/components/automations/Watch";
import { RUN_STATE, STATE, took } from "@/components/automations/words";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icons";
import { StatusDot } from "@/components/ui/StatusDot";
import { cx } from "@/lib/cx";
import { ago, clock, feedTime, num } from "@/lib/format";
import { GROUPS, JOB_ICON, runs as runsText, scheduleText } from "./words";

export interface JobTableProps {
  jobs: SeoJob[];
  /** Each job's standing and last runs, by name; when it is not ok the rows show what the job list itself says. */
  runs: Reading<Record<string, SeoJobRuns>>;
  /** Only the owner is shown the switches; the desk refuses anybody else anyway. */
  owner: boolean;
  /** When the desk made the payload (ISO): every "ago" is counted from it, so the server and the browser print the same words. */
  at: string;
}

/**
 * The board's table (113, panel 9): one row per job, in two groups, with
 * its status, schedule, last run and next run, and its actions: Run now
 * (whoever the server lets run that job, src/grants.ts `mayRunJob`, through
 * the core API's floor), the owner's on/off
 * switch, and View, which opens what it reads, what it writes and its last
 * runs under the row.
 *
 * The head and every row share one set of columns (a grid with subgrid
 * rows); narrower, each row becomes a card with its labels shown.
 */
export function JobTable({ jobs, runs, owner, at }: JobTableProps) {
  const byName = runs.state === "ok" ? runs.value : null;
  return (
    <div className="dk-seo-automations-jobs">
      <div className="dk-seo-automations-grid">
        <div className="dk-seo-automations-head" aria-hidden>
          <span>Automation</span>
          <span>Status</span>
          <span>Schedule</span>
          <span>Last run</span>
          <span>Next run</span>
          <span className="dk-seo-automations-head-actions">Actions</span>
        </div>
        {GROUPS.map((g) => {
          const mine = jobs.filter((j) => j.group === g.key);
          if (!mine.length) return null;
          return (
            <section key={g.key} className="dk-seo-automations-group" aria-label={g.title}>
              <p className="dk-seo-automations-group-head">
                <b>{g.title}</b>
                <span className="dk-num">{num(mine.length)}</span>
                <span className="dk-seo-automations-group-sub">{g.sub}</span>
              </p>
              <ol className="dk-seo-automations-list">
                {mine.map((j) => (
                  <JobRow key={j.name} job={j} more={byName?.[j.name] ?? null} owner={owner} at={at} />
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** A label for a cell that only shows when the row is laid out as a card, and is read out always. */
function Label({ children }: { children: string }) {
  return <span className="dk-seo-automations-cell-label">{children}</span>;
}

/** "13:32" today, "Yesterday 13:32", "30 Sep 13:32". */
const when = (iso: string, at: string): string => {
  const day = feedTime(iso, at);
  return day === clock(iso) ? day : `${day} ${clock(iso)}`;
};

function nextText(j: SeoJob, m: SeoJobRuns | null, at: string): { text: string; title?: string; iso?: string } {
  const next = m?.nextRun ?? j.nextRun;
  if (j.running) return { text: "Running now" };
  if (!j.enabled) return { text: "—", title: "Switched off: it has no next run until the owner switches it on." };
  if (m?.state === "paused") {
    return next
      ? { text: ago(next, at), iso: next, title: `Paused by its source${m.pausedUntil ? ` until ${when(m.pausedUntil, at)}` : ""}. It runs again by itself at ${when(next, at)}.` }
      : { text: "—", title: "Paused by its source: it runs again by itself when the pause ends." };
  }
  if (!j.ready) return { text: "—", title: m?.state === "waiting" || !m ? "It runs once what it reads is connected." : "Not scheduled: it has nothing left to ask." };
  if (!next) return { text: "—" };
  return Date.parse(next) <= Date.parse(at)
    ? { text: "Due now", iso: next, title: "Its time has come: it starts when the scheduler next wakes (within half a minute), or after the job running now." }
    : { text: ago(next, at), iso: next, title: when(next, at) };
}

function JobRow({ job: j, more: m, owner, at }: { job: SeoJob; more: SeoJobRuns | null; owner: boolean; at: string }) {
  const [open, setOpen] = useState(false);
  const region = useId();
  /* Without the run table, the job list's own facts still give its state. */
  const stateKey = m?.state ?? (j.running ? "running" : !j.enabled ? "off" : !j.ready ? "waiting" : j.lastOk === null ? "new" : j.lastOk ? "ok" : "failed");
  const state = STATE[stateKey];
  const next = nextText(j, m, at);
  const askable = m ? m.askableFrom !== null && Date.parse(m.askableFrom) <= Date.parse(at) : j.ready && j.enabled && !j.running;
  const later = m?.askableFrom && Date.parse(m.askableFrom) > Date.parse(at) ? m.askableFrom : null;
  const last = m?.last ?? (j.lastEnd && j.lastOk !== null ? { start: j.lastStart, end: j.lastEnd, ms: null, ok: j.lastOk, note: j.lastNote } : null);
  const cut = !j.running && m?.recent[0]?.state === "cut" ? m.recent[0] : null;

  const [ran, runAction, asking] = useActionState<Said | null, FormData>(runJob, null);
  const [switched, switchAction, switching] = useActionState<Said | null, FormData>(switchJob, null);
  const shown = useFresh(newer(ran, switched));

  useEffect(() => {
    if (ran?.ok) announceAsked();
  }, [ran]);

  return (
    <li className={cx("dk-seo-automations-job", open && "dk-seo-automations-job--open")} data-state={stateKey}>
      <div className="dk-seo-automations-row">
        <div className="dk-seo-automations-name">
          <span className={cx("dk-seo-automations-icon", `dk-tone-${state.tone}`)} aria-hidden>
            <Icon name={JOB_ICON[j.name] ?? "clock"} size={16} />
          </span>
          <span className="dk-seo-automations-titles">
            <b className="dk-seo-automations-title">{j.title}</b>
            <span className="dk-seo-automations-what" title={j.what}>
              {j.what}
            </span>
          </span>
        </div>

        <div className="dk-seo-automations-cell dk-seo-automations-cell--status">
          <Label>Status</Label>
          <span>
            <Badge tone={state.tone} dot>
              {state.label}
            </Badge>
          </span>
          {j.running && j.progress ? (
            <small className="dk-num">
              {num(j.progress.done)} of {num(j.progress.of)}
              {j.progress.what ? ` · ${j.progress.what}` : ""}
            </small>
          ) : j.running && j.lastStart ? (
            <small className="dk-num">since {clock(j.lastStart)}</small>
          ) : (stateKey === "waiting" || stateKey === "paused") && m?.source ? (
            <small className="dk-seo-automations-wrap" title={m.source.reason}>
              {m.source.name}
            </small>
          ) : cut ? (
            <small className="dk-num" title="A restart of the desk cut that run off: it neither finished nor failed. Last run shows the run before it.">
              cut off at {when(cut.start, at)}
            </small>
          ) : null}
        </div>

        <div className="dk-seo-automations-cell dk-seo-automations-cell--schedule">
          <Label>Schedule</Label>
          <span>{scheduleText(j.every)}</span>
          {j.budget ? (
            <small className="dk-num" title={j.budget.line}>
              {num(j.budget.used)} of {num(j.budget.cap)} {j.budget.period === "week" ? "this week" : "today"}
            </small>
          ) : null}
          {/* Shown only where the table has no room for its own Next run column. */}
          <small className="dk-num dk-seo-automations-next-under" title={next.title}>
            Next: {next.text === "—" ? "none" : next.text.charAt(0).toLowerCase() + next.text.slice(1)}
          </small>
        </div>

        <div className="dk-seo-automations-cell dk-seo-automations-cell--last">
          <Label>Last run</Label>
          {last ? (
            <>
              <span className="dk-num">
                <time dateTime={last.start ?? last.end}>{ago(last.start ?? last.end, at)}</time>
                {last.ms !== null ? <span className="dk-seo-automations-quiet"> · {took(last.ms)}</span> : null}
              </span>
              {last.note ? (
                <small className={cx(!last.ok && "dk-seo-automations-bad")} title={last.note}>
                  {last.note}
                </small>
              ) : null}
            </>
          ) : (
            <span className="dk-seo-automations-quiet">{j.running ? "None finished yet" : "Never"}</span>
          )}
        </div>

        <div className="dk-seo-automations-cell dk-seo-automations-cell--next">
          <Label>Next run</Label>
          <span className="dk-num" title={next.title}>
            {next.iso ? <time dateTime={next.iso}>{next.text}</time> : next.text}
          </span>
        </div>

        <div className="dk-seo-automations-cell dk-seo-automations-cell--actions">
          {askable ? (
            <form action={runAction}>
              <input type="hidden" name="name" value={j.name} />
              <Button type="submit" size="xs" icon="play" disabled={asking} aria-label={`Run "${j.title}" now`}>
                {asking ? "Asking…" : "Run now"}
              </Button>
            </form>
          ) : later ? (
            <Button size="xs" icon="play" disabled title={`It ran or was asked for a moment ago: it can be asked for again at ${clock(later)}.`}>
              Run now
            </Button>
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
                title={j.enabled ? "On: switch it off" : "Off: switch it on"}
                className={cx("dk-seo-automations-switch", j.enabled && "dk-seo-automations-switch--on")}
                disabled={switching}
              >
                <span className="dk-seo-automations-switch-knob" />
              </button>
            </form>
          ) : null}
          <button
            type="button"
            className="dk-seo-automations-view"
            aria-expanded={open}
            aria-controls={region}
            aria-label={`${open ? "Hide" : "View"} what "${j.title}" reads, writes and its last runs`}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Hide" : "View"}
          </button>
        </div>
      </div>

      {shown ? (
        <p className={cx("dk-seo-automations-said", !shown.ok && "dk-seo-automations-said--bad")} role="status">
          <Icon name={shown.ok ? "check" : "alert"} size={14} />
          <span>{shown.message}</span>
        </p>
      ) : null}

      <div id={region} className="dk-seo-automations-more" hidden={!open}>
        {open ? <JobMore job={j} more={m} owner={owner} at={at} /> : null}
      </div>
    </li>
  );
}

/** What opens under a row: what the job does, reads and writes, its budget, and its last runs. */
function JobMore({ job: j, more: m, owner, at }: { job: SeoJob; more: SeoJobRuns | null; owner: boolean; at: string }) {
  const s = m?.source ?? null;
  const sourceWord = !s ? null : s.state === "connected" ? "connected" : s.state === "off" ? "not connected" : s.state === "failing" ? "failing" : "connected, nothing yet";
  return (
    <div className="dk-seo-automations-more-grid">
      <div>
        <p className="dk-seo-automations-more-what">{j.what}</p>
        <dl className="dk-seo-automations-facts">
          <dt>Schedule</dt>
          <dd>{scheduleText(j.every)}</dd>
          {m ? (
            <>
              <dt>Reads</dt>
              <dd>
                {m.reads}
                {s ? (
                  <span className="dk-seo-automations-quiet">
                    {" "}
                    {s.name}:{" "}
                    <span className={cx(s.state === "connected" ? "dk-seo-automations-good" : s.state === "failing" ? "dk-seo-automations-bad" : "dk-seo-automations-warn")}>{sourceWord}</span>
                    {s.lastOk ? `, last answered ${ago(s.lastOk, at)}` : ""}.
                  </span>
                ) : null}
              </dd>
              <dt>Writes</dt>
              <dd>{m.writes}</dd>
            </>
          ) : null}
          <dt>The website</dt>
          <dd>Never changed by it.</dd>
          {j.budget ? (
            <>
              <dt>Budget</dt>
              <dd className="dk-num">{j.budget.line}</dd>
            </>
          ) : null}
          <dt>Counted</dt>
          <dd className="dk-num">
            {runsText(j.runs)}, {num(j.fails)} failed, since the desk began keeping them{m ? `; ${runsText(m.day.ok + m.day.failed)} in the last 24 hours` : ""}
          </dd>
          {!owner ? (
            <>
              <dt>Switch</dt>
              <dd className="dk-seo-automations-quiet">{j.enabled ? "On" : "Off"}. Only the owner can switch a job off or on.</dd>
            </>
          ) : null}
        </dl>
        {s && s.state !== "connected" && (s.reason || s.step) ? (
          <div className="dk-seo-automations-step">
            {s.reason ? <p>{s.reason}</p> : null}
            {s.step ? (
              <p className="dk-seo-automations-step-do">
                <Icon name="arrow-right" size={14} />
                <span>{s.step}</span>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div>
        <p className="dk-seo-automations-more-head">Last runs</p>
        {!m ? (
          <p className="dk-seo-automations-quiet">The run history could not be read just now.</p>
        ) : m.recent.length ? (
          <ol className="dk-seo-automations-runs">
            {m.recent.map((r) => {
              const rs = RUN_STATE[r.state];
              return (
                <li key={r.start}>
                  <time className="dk-num" dateTime={r.start}>
                    {when(r.start, at)}
                  </time>
                  <StatusDot tone={rs.tone} title={rs.title} />
                  <span className="dk-num dk-seo-automations-quiet">{r.ms !== null ? took(r.ms) : rs.word}</span>
                  <span className="dk-seo-automations-run-note" title={r.note ?? (r.state === "cut" ? rs.title : undefined)}>
                    {r.note ?? (r.state === "ok" ? "Finished, and said nothing." : r.state === "cut" ? "A restart of the desk cut it off." : r.state === "running" ? "Running now." : "")}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="dk-seo-automations-quiet">{m.state === "waiting" ? "It has never run: what it reads is not connected." : "No run in the last week."}</p>
        )}
      </div>
    </div>
  );
}

/** The newer of two answers. */
function newer(a: Said | null, b: Said | null): Said | null {
  if (!a) return b;
  if (!b) return a;
  return a.at >= b.at ? a : b;
}

/** An answer for a while after it came, then nothing: the row's state says the rest. */
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
