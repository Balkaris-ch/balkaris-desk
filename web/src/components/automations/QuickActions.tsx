"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import type { AutomationJob } from "@/contract/automations";
import { Icon, type IconName } from "@/components/ui/icons";
import { StatusDot } from "@/components/ui/StatusDot";
import { cx } from "@/lib/cx";
import { ago, clock, num } from "@/lib/format";
import { runDue, runJob, type Said } from "./actions";
import { announceAsked } from "./Watch";

/** One line of the scheduler's order: a job running now, or the next start of one that is scheduled. */
export interface Upcoming {
  name: string;
  title: string;
  /** ISO: when it starts, or when the running one started. */
  at: string;
  running: boolean;
  /** Its source paused it; `at` is when the pause ends. */
  paused: boolean;
}

export interface QuickActionsProps {
  /** Titles of the jobs whose time has come. */
  due: string[];
  /** The next job the scheduler will start, when one is scheduled. */
  next: { title: string; at: string } | null;
  crawl: AutomationJob | null;
  speed: AutomationJob | null;
  /** The job running now and the next starts, in order. */
  upcoming: Upcoming[];
  /** When the server read all this (ISO). */
  at: string;
}

/**
 * Three things a person can ask for from here. Each row is a real button
 * while the desk would accept it; a row that cannot do anything right now
 * (nothing is due, a job running, switched off, paused, asked a moment ago)
 * says why in its place instead. Each row has its own answer, under it.
 * Under them, the order the scheduler will work in.
 */
export function QuickActions({ due, next, crawl, speed, upcoming, at }: QuickActionsProps) {
  return (
    <div className="dk-automations-qa">
      <ul className="dk-automations-qa-list" aria-label="Quick actions">
        <DueAction due={due} next={next} at={at} />
        <JobAction job={crawl} icon="file-text" label="Run the crawl" what="Reads every page of the website again" at={at} />
        <JobAction job={speed} icon="gauge" label="Run the speed test" what="PageSpeed Insights on six pages, phone and desktop" at={at} />
      </ul>
      <p className="dk-automations-qa-note">Jobs run one at a time, so what is asked for waits for the job running now.</p>
      <ComingUp list={upcoming} at={at} />
    </div>
  );
}

/** The server's answer to one row, shown under that row for twenty seconds. */
function useAnswer(ask: (prev: Said | null, form: FormData) => Promise<Said>) {
  const [said, action, pending] = useActionState<Said | null, FormData>(ask, null);
  const [shown, setShown] = useState<Said | null>(null);
  useEffect(() => {
    if (!said) return;
    setShown(said);
    if (said.ok) announceAsked();
    const t = setTimeout(() => setShown(null), 20_000);
    return () => clearTimeout(t);
  }, [said]);
  return { shown, action, pending };
}

function Answer({ said }: { said: Said | null }) {
  if (!said) return null;
  return (
    <p className={cx("dk-automations-said", "dk-automations-qa-said", !said.ok && "dk-automations-said--bad")} role="status">
      <Icon name={said.ok ? "check" : "alert"} size={14} />
      <span>{said.message}</span>
    </p>
  );
}

function DueAction({ due, next, at }: { due: string[]; next: { title: string; at: string } | null; at: string }) {
  const { shown, action, pending } = useAnswer(runDue);
  const label = "Run everything that is due";
  return (
    <li>
      {due.length ? (
        <form action={action}>
          <Row icon="refresh" label={label} desc={`${due.length === 1 ? "One job is" : `${num(due.length)} jobs are`} due now: ${due.join("; ")}`} pending={pending} />
        </form>
      ) : (
        /* Nothing is due: there is nothing for the button to do, so it is not one. */
        <div className="dk-automations-qa-row dk-automations-qa-row--still">
          <RowInside icon="refresh" label={label} desc={next ? `Nothing is due. Next: ${next.title}, ${ago(next.at, at)}` : "Nothing is due, and no job is scheduled."} />
        </div>
      )}
      <Answer said={shown} />
    </li>
  );
}

function JobAction({ job, icon, label, what, at }: { job: AutomationJob | null; icon: IconName; label: string; what: string; at: string }) {
  const { shown, action, pending } = useAnswer(runJob);
  if (!job) return null;
  const lastAt = job.last ? (job.last.start ?? job.last.end) : null;
  const last = lastAt ? `last ran ${ago(lastAt, at)}` : "it has not run yet";
  const askable = job.askableFrom !== null && Date.parse(job.askableFrom) <= Date.parse(at);
  /* Not a button: what stands in the way, in its place. */
  const why = job.running
    ? `Running now${job.progress ? `: ${num(job.progress.done)} of ${num(job.progress.of)}` : ""}`
    : !job.enabled
      ? "Switched off by the owner"
      : job.state === "paused"
        ? `Paused by Google; it runs again by itself ${job.nextRun ? ago(job.nextRun, at) : "when the pause ends"}`
        : !job.ready
          ? "Waiting for what it reads to be connected"
          : job.askableFrom
            ? `It started a moment ago; it can be asked for again ${ago(job.askableFrom, at)}`
            : "It cannot be asked for now";
  return (
    <li>
      {askable ? (
        <form action={action}>
          <input type="hidden" name="name" value={job.name} />
          <Row icon={icon} label={label} desc={`${what}; ${last}`} pending={pending} />
        </form>
      ) : (
        <div className="dk-automations-qa-row dk-automations-qa-row--still">
          <RowInside icon={icon} label={label} desc={why} />
        </div>
      )}
      <Answer said={shown} />
    </li>
  );
}

function Row({ icon, label, desc, pending }: { icon: IconName; label: string; desc: string; pending: boolean }) {
  return (
    <button type="submit" className="dk-automations-qa-row" disabled={pending} aria-busy={pending || undefined}>
      <RowInside icon={icon} label={label} desc={pending ? "Asking the desk…" : desc} go />
    </button>
  );
}

function RowInside({ icon, label, desc, go }: { icon: IconName; label: string; desc: ReactNode; go?: boolean }) {
  return (
    <>
      <span className="dk-automations-qa-icon" aria-hidden>
        <Icon name={icon} size={16} />
      </span>
      <span className="dk-automations-qa-text">
        <span className="dk-automations-qa-label">{label}</span>
        <span className="dk-automations-qa-desc">{desc}</span>
      </span>
      {go ? <Icon name="play" size={14} className="dk-automations-qa-go" /> : null}
    </>
  );
}

/** The scheduler's order: what runs now, then the next starts. */
function ComingUp({ list, at }: { list: Upcoming[]; at: string }) {
  if (!list.length) return null;
  const now = Date.parse(at);
  return (
    <div className="dk-automations-qa-next">
      <p className="dk-automations-more-head">In the scheduler&apos;s order</p>
      <ol className="dk-automations-qa-order">
        {list.map((u) => {
          const due = !u.running && Date.parse(u.at) <= now;
          return (
            <li key={u.name}>
              <time className="dk-num" dateTime={u.at}>
                {u.running ? "now" : clock(u.at)}
              </time>
              <StatusDot tone={u.running ? "info" : u.paused ? "warn" : due ? "good" : "quiet"} pulse={u.running} title={u.running ? "Running now" : u.paused ? "Paused by its source until then" : due ? "Due now" : "Scheduled"} />
              <span className="dk-automations-qa-order-title" title={u.title}>
                {u.title}
              </span>
              <span className="dk-num dk-automations-quiet">{u.running ? `since ${clock(u.at)}` : due ? "due now" : ago(u.at, at)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
