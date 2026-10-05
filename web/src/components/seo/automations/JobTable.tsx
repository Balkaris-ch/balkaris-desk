"use client";

import { useActionState, useCallback, useEffect, useId, useRef, useState } from "react";
import type { Reading } from "@/contract/common";
import type { SeoJobRuns, SeoJobState, SeoScheduler } from "@/contract/seo/automations";
import type { SeoJob } from "@/contract/seo/common";
import { switchJob, type Said } from "@/components/automations/actions";
import { announceAsked } from "@/components/automations/Watch";
import { RUN_STATE, took } from "@/components/automations/words";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { StatusDot } from "@/components/ui/StatusDot";
import { cx } from "@/lib/cx";
import { ago, clock, fullDate, num } from "@/lib/format";
import { askJob } from "./actions";
import { GROUPS, JOB_ICON, runs as runsText, scheduleText, SEO_STATE, SHOWN_ON, when } from "./words";

export interface JobTableProps {
  jobs: SeoJob[];
  /** Each job's standing and last runs, by name; when it is not ok the rows show what the job list itself says. */
  runs: Reading<Record<string, SeoJobRuns>>;
  /** Only the owner is shown the switches; the desk refuses anybody else anyway. */
  owner: boolean;
  /** When the desk made the payload (ISO): every "ago" is counted from it, so the server and the browser print the same words. */
  at: string;
  /** Whether anything starts by itself on this desk, for the words under a late or due job. */
  scheduler: SeoScheduler;
  /** The job whose row the address opens (?open=), when it is one of these. */
  open: string | null;
  /** The head's period, for the row's period counts ("in the last 30 days"). */
  periodLabel: string;
}

/**
 * The board's table (113, panel 9): one row per job, in two groups, with
 * its status, schedule, last run and next run, and its actions: Run now
 * (whoever the server lets run that job, src/grants.ts `mayRunJob`, through
 * the core API's floor), the owner's on/off switch, and View, which opens
 * what it reads, what it writes, what it found and its last runs under the
 * row.
 *
 * The opened row is in the address (?open=<job>), so the log's lines and the
 * other tabs can link straight to a job; opening and closing writes it there
 * without asking the server again (history.replaceState).
 *
 * The head and every row share one set of columns (a grid with subgrid
 * rows); narrower, each row becomes a card with its labels shown.
 */
export function JobTable({ jobs, runs, owner, at, scheduler, open: initial, periodLabel }: JobTableProps) {
  const byName = runs.state === "ok" ? runs.value : null;
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set(initial && jobs.some((j) => j.name === initial) ? [initial] : []));
  /* The job this table itself last wrote into the address, so a redraw that carries it back is not taken for a link. */
  const last = useRef<string | null>(null);

  /*
   * A link that lands here with ?open= (the log, the period's failures, the
   * watch's asks, another tab) opens that row and brings it into view, on
   * arrival and on every later link within the page alike.
   */
  useEffect(() => {
    if (!initial || initial === last.current || !jobs.some((j) => j.name === initial)) return;
    last.current = initial;
    setOpened((had) => (had.has(initial) ? had : new Set([...had, initial])));
    document.getElementById(rowId(initial))?.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const toggle = useCallback(
    (name: string) => {
      const next = new Set(opened);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      setOpened(next);
      /* The address names the row opened last; closing it names another open one, or none. */
      last.current = next.has(name) ? name : next.size ? [...next].at(-1)! : null;
      const params = new URLSearchParams(window.location.search);
      if (last.current) params.set("open", last.current);
      else params.delete("open");
      const qs = params.toString();
      const to = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
      if (to !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", to);
    },
    [opened],
  );

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
                  <JobRow
                    key={j.name}
                    job={j}
                    more={byName?.[j.name] ?? null}
                    owner={owner}
                    at={at}
                    scheduler={scheduler}
                    open={opened.has(j.name)}
                    onToggle={toggle}
                    periodLabel={periodLabel}
                  />
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}

const rowId = (name: string): string => `job-${name}`;

/** A label for a cell that only shows when the row is laid out as a card, and is read out always. */
function Label({ children }: { children: string }) {
  return <span className="dk-seo-automations-cell-label">{children}</span>;
}

/** Failed runs in a row, newest first: the run history's leading failures. */
function failsInRow(m: SeoJobRuns): number {
  let n = 0;
  while (n < m.recent.length && m.recent[n]!.state === "failed") n++;
  return n;
}

/** Without the run table, the job list's own facts still give its state. */
const stateOf = (j: SeoJob, m: SeoJobRuns | null): SeoJobState =>
  m?.state ?? (j.running ? "running" : !j.enabled ? "off" : !j.ready ? "waiting" : j.lastOk === null ? "new" : j.lastOk ? "ok" : "failed");

/**
 * What the Next run cell says, and its title: when the job starts next by the
 * desk's rules and why then. A time in the past is never "Due now" for long:
 * past ten minutes it is "Late since …", and the title says why nothing has
 * started it (no scheduler here, or one that is behind).
 */
function nextText(j: SeoJob, m: SeoJobRuns | null, at: string, sch: SeoScheduler): { text: string; title?: string; iso?: string; tone?: "warn" | "bad" } {
  const next = m ? m.nextRun : j.nextRun;
  if (j.running) return { text: "Running now" };
  if (!j.enabled) return { text: "—", title: "Switched off: it has no next run until the owner switches it on." };
  if (m?.state === "paused") {
    return next
      ? { text: ago(next, at), iso: next, title: `Paused by its source${m.pausedUntil ? ` until ${when(m.pausedUntil, at)}` : ""}. It runs again by itself at ${when(next, at)}.` }
      : { text: "—", title: "Paused by its source: it runs again by itself when the pause ends." };
  }
  if (!j.ready) return { text: "—", title: m?.state === "waiting" || !m ? "It runs once what it reads is connected." : "Not scheduled: it has nothing left to ask." };
  if (m?.queued) {
    return { text: "Queued", iso: m.queued.at, title: `The SEO watch put it at the front of the queue at ${when(m.queued.at, at)}: it starts after the job running now, one job at a time.` };
  }
  if (!next) {
    return { text: "—", title: sch.on ? "It has not run yet: it starts once the desk's start delay after a restart has passed." : "It has never run, and nothing starts by itself on this desk: press Run now." };
  }
  const nobody = sch.on
    ? sch.watch.on
      ? `The SEO watch puts a job at the front of the queue ${sch.watch.askAfterMin} minutes after its time, so it should start soon; if it does not, the scheduler is stuck behind another job.`
      : "The scheduler has not started it: it is behind, or stuck behind another job."
    : "Nothing starts by itself on this desk (its scheduler is switched off): Run now starts it.";
  if (m?.lateSince) return { text: `Late since ${when(m.lateSince, at)}`, iso: m.lateSince, tone: "warn", title: `Its time came ${ago(m.lateSince, at)} and it has not started. ${nobody}` };
  const why =
    m?.nextWhy === "retry"
      ? `Its last run failed: the desk tries it again half an hour later${m.retry ? ` (try ${m.retry.attempt} of ${m.retry.of})` : ""}.`
      : m?.nextWhy === "again"
        ? "A restart of the desk cut its last run off: it runs again two minutes after that run began."
        : null;
  if (Date.parse(next) <= Date.parse(at)) {
    return {
      text: m?.nextWhy === "retry" ? "Retry now" : m?.nextWhy === "again" ? "Again now" : "Due now",
      iso: next,
      title: `${why ? `${why} ` : ""}Its time came at ${when(next, at)}. ${sch.on ? "The scheduler starts it at its next wake (every thirty seconds), after the job running now: one job at a time." : nobody}`,
    };
  }
  return {
    text: m?.nextWhy === "retry" ? `Retry ${ago(next, at)}` : m?.nextWhy === "again" ? `Again ${ago(next, at)}` : ago(next, at),
    iso: next,
    title: `${why ? `${why} ` : ""}${when(next, at)}.`,
  };
}

function JobRow({
  job: j,
  more: m,
  owner,
  at,
  scheduler,
  open,
  onToggle,
  periodLabel,
}: {
  job: SeoJob;
  more: SeoJobRuns | null;
  owner: boolean;
  at: string;
  scheduler: SeoScheduler;
  open: boolean;
  onToggle: (name: string) => void;
  periodLabel: string;
}) {
  const region = useId();
  const stateKey = stateOf(j, m);
  const state = SEO_STATE[stateKey];
  const next = nextText(j, m, at, scheduler);
  const last = m?.last ?? (j.lastEnd && j.lastOk !== null ? { start: j.lastStart, end: j.lastEnd, ms: null, ok: j.lastOk, note: j.lastNote } : null);
  const cut = !j.running && m?.recent[0]?.state === "cut" ? m.recent[0] : null;

  const [ran, runAction, asking] = useActionState<Said | null, FormData>(askJob, null);
  const [switched, switchAction, switching] = useActionState<Said | null, FormData>(switchJob, null);
  const shown = useFresh(newer(ran, switched));

  /*
   * A person's own ask, until the job starts: the scheduler keeps its queue in
   * memory and does not say who is in it, so the row remembers its own press
   * and says "Asked for" instead of offering a Run now the desk would refuse.
   */
  const [askedAt, setAskedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!ran?.ok) return;
    setAskedAt(ran.at);
    announceAsked();
  }, [ran]);
  /*
   * Started: running, or a start from just before the answer came back on (the
   * scheduler may start it within milliseconds; the desk's floor refuses an ask
   * within ten minutes of a start, so a start that close is this one). Given
   * up after a quarter of an hour: a restart of the desk forgets its queue.
   */
  const started =
    askedAt !== null && (j.running || (j.lastStart !== null && Date.parse(j.lastStart) >= askedAt - 30_000) || Date.parse(at) - askedAt > 15 * 60_000);
  useEffect(() => {
    if (started) setAskedAt(null);
  }, [started]);
  const waitingTurn = askedAt !== null && !started;

  const askable = !waitingTurn && (m ? m.askableFrom !== null && Date.parse(m.askableFrom) <= Date.parse(at) : j.ready && j.enabled && !j.running);
  const later = !waitingTurn && m?.askableFrom && Date.parse(m.askableFrom) > Date.parse(at) ? m.askableFrom : null;

  return (
    <li id={rowId(j.name)} className={cx("dk-seo-automations-job", open && "dk-seo-automations-job--open")} data-state={stateKey}>
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
          ) : waitingTurn ? (
            <small title="You asked for it: it starts at the scheduler's next wake, after the job running now.">Asked for, waiting its turn</small>
          ) : m?.queued ? (
            <small title="The SEO watch put it at the front of the queue.">Queued by the watch</small>
          ) : (stateKey === "waiting" || stateKey === "paused") && m?.source ? (
            <small className="dk-seo-automations-wrap" title={m.source.reason}>
              {m.source.name}
            </small>
          ) : stateKey === "failed" && m?.gaveUp === "failed" ? (
            <small className="dk-seo-automations-bad" title="It failed more than three times in a row, so the desk stopped trying again early: it waits for its regular time.">
              failed {num(failsInRow(m))} times in a row
            </small>
          ) : stateKey === "failed" && m?.lateSince ? (
            <small className="dk-seo-automations-warn">and late</small>
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
          <small className={cx("dk-num dk-seo-automations-next-under", next.tone === "warn" && "dk-seo-automations-warn")} title={next.title}>
            Next: {next.text === "—" ? "none" : next.text.charAt(0).toLowerCase() + next.text.slice(1)}
          </small>
        </div>

        <div className="dk-seo-automations-cell dk-seo-automations-cell--last">
          <Label>Last run</Label>
          {last ? (
            <>
              <span className="dk-num">
                <time dateTime={last.start ?? last.end} title={when(last.start ?? last.end, at)}>
                  {ago(last.start ?? last.end, at)}
                </time>
                {last.ms !== null ? <span className="dk-seo-automations-quiet"> · {took(last.ms)}</span> : null}
              </span>
              {last.note ? (
                <small className={cx(!last.ok && "dk-seo-automations-bad")} title={last.note}>
                  {last.note}
                </small>
              ) : (
                <small className="dk-seo-automations-quiet">{last.ok ? "Finished, and said nothing." : "Failed, and said nothing."}</small>
              )}
            </>
          ) : (
            <span className="dk-seo-automations-quiet">{j.running ? "None finished yet" : "Never"}</span>
          )}
        </div>

        <div className="dk-seo-automations-cell dk-seo-automations-cell--next">
          <Label>Next run</Label>
          <span className={cx("dk-num", next.tone === "warn" && "dk-seo-automations-warn")} title={next.title}>
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
          ) : waitingTurn ? (
            <Button size="xs" icon="hourglass" disabled title="Asked for: it starts at the scheduler's next wake, after the job running now.">
              Asked for
            </Button>
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
            aria-label={`${open ? "Hide" : "View"} what "${j.title}" reads, writes and found, and its last runs`}
            onClick={() => onToggle(j.name)}
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
        {open ? <JobMore job={j} more={m} owner={owner} at={at} next={next} periodLabel={periodLabel} /> : null}
      </div>
    </li>
  );
}

/** What opens under a row: what the job does, reads and writes, when it runs next and why, where its results show, and its last runs. */
function JobMore({ job: j, more: m, owner, at, next, periodLabel }: { job: SeoJob; more: SeoJobRuns | null; owner: boolean; at: string; next: ReturnType<typeof nextText>; periodLabel: string }) {
  const s = m?.source ?? null;
  const sourceWord = !s ? null : s.state === "connected" ? "connected" : s.state === "off" ? "not connected" : s.state === "failing" ? "failing" : "connected, nothing yet";
  const shownOn = SHOWN_ON[j.name];
  return (
    <div className="dk-seo-automations-more-grid">
      <div>
        <p className="dk-seo-automations-more-what">{j.what}</p>
        <dl className="dk-seo-automations-facts">
          <dt>Schedule</dt>
          <dd>{scheduleText(j.every)}</dd>
          <dt>Next run</dt>
          <dd>
            <span className={cx(next.tone === "warn" && "dk-seo-automations-warn")}>{next.text === "—" ? "None" : next.text}</span>
            {next.iso && !next.text.includes(when(next.iso, at)) ? <span className="dk-num"> · {when(next.iso, at)}</span> : null}
            {next.title && next.iso && next.title !== `${when(next.iso, at)}.` ? <span className="dk-seo-automations-quiet"> {next.title}</span> : next.title && !next.iso ? <span className="dk-seo-automations-quiet"> {next.title}</span> : null}
          </dd>
          {m?.gaveUp ? (
            <>
              <dt>No early try</dt>
              <dd className="dk-seo-automations-quiet">
                {m.gaveUp === "failed"
                  ? "It failed more than three times in a row, so the desk stopped trying it again every half hour: it waits for its regular time, or for Run now."
                  : "A restart cut off its last two runs, so the desk does not run it again at once: it waits for its regular time, or for Run now."}
              </dd>
            </>
          ) : null}
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
          {shownOn ? (
            <>
              <dt>What it found</dt>
              <dd>
                <Go href={shownOn.href}>{shownOn.label}</Go>
              </dd>
            </>
          ) : null}
          {j.budget ? (
            <>
              <dt>Budget</dt>
              <dd className="dk-num">{j.budget.line}</dd>
            </>
          ) : null}
          <dt>Counted</dt>
          <dd className="dk-num">
            {runsText(j.runs)}, {num(j.fails)} failed, since the desk began keeping them
            {m ? `; ${runsText(m.day.ok + m.day.failed)} in the last 24 hours` : ""}
            {m ? `; ${periodLabel.toLowerCase()}: ${num(m.period.ok)} finished, ${num(m.period.failed)} failed${m.period.cut ? `, ${num(m.period.cut)} cut off by a restart` : ""}${m.period.lastFailed ? `, the newest failure ${fullDate(m.period.lastFailed)}` : ""}` : ""}.
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
          <p className="dk-seo-automations-quiet">{m.state === "waiting" ? "It has never run: what it reads is not connected." : "No run is kept yet."}</p>
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
