"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { JobAnswer, JobListed } from "@/contract/common";
import type { NewTask, TaskAnswer } from "@/contract/operator";
import type { OpportunityAnswer } from "@/contract/seo/common";
import type { OwnerStepAnswer } from "@/contract/seo/opportunities";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import type { IconName } from "@/components/ui/icons";
import { useSend } from "@/components/operator/send";
import { cx } from "@/lib/cx";
import { clock } from "@/lib/format";
import { useLive } from "@/lib/live";

/**
 * The Technical page's buttons. Each goes through a door the desk server
 * already has and decides on (who may, how often), and its answer or refusal
 * is printed beside the button. None changes the live website:
 *
 *   TaskButton    POST /api/v1/operator/tasks: the operator proposes titles,
 *                 descriptions or redirects; they wait in AI Operator ›
 *                 Approvals for a person
 *   RunJob        POST /api/v1/jobs/:name/run: a measurement now (PageSpeed)
 *   Submitted     POST /api/v1/seo/indexing/requested: a person says they
 *                 pressed "Request indexing" in Search Console, by hand
 *   ActButton     POST /api/v1/seo/opportunities/act { id }: one technical
 *                 opportunity's own action (an operator task, the to-do
 *                 list for the website's code, Request indexing marked)
 *   OwnerStepDone POST /api/v1/seo/opportunities/owner-task { task }: a step
 *                 from the audit marked done by the person who took it
 */

/** What the desk said after a press, in one line, under the button. */
function Said({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return (
    <p className={cx("dk-seo-technical-said", !message.ok && "dk-seo-technical-said--bad")} role={message.ok ? "status" : "alert"}>
      {message.text}
    </p>
  );
}

const queued = (v: TaskAnswer): string =>
  `Queued: ${v.task.title}${v.task.ahead ? `, behind ${v.task.ahead} other${v.task.ahead === 1 ? "" : "s"}` : ""}. The studio workstation answers when it is on; proposals wait for approval.`;

export function TaskButton({ task, label, variant = "quiet", size = "xs", icon }: { task: NewTask; label: string; variant?: ButtonVariant; size?: ButtonSize; icon?: IconName }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-technical-act">
      <Button variant={variant} size={size} icon={icon} disabled={busy} aria-busy={busy || undefined} onClick={() => void go<TaskAnswer>("/api/v1/operator/tasks", task, queued)}>
        {busy ? "Asking…" : label}
      </Button>
      <Said message={message} />
    </span>
  );
}

/**
 * Ask the scheduler to run one job now. Disabled, with the reason on hover,
 * while the job cannot run. Once asked (or while it is already running) it
 * watches the job, and draws the page again once when the run has ended: the
 * PageSpeed sweep takes about five minutes, and one refresh right after the
 * scheduler's 202 used to find it still running and leave "Running…" on the
 * button after it had finished.
 */
export function RunJob({ name, label, ready, running, why, size = "sm" }: { name: string; label: string; ready: boolean; running: boolean; why?: string; size?: ButtonSize }) {
  const { go, busy, message } = useSend();
  const [askedAt, setAskedAt] = useState<number | null>(null);
  const [ended, setEnded] = useState<{ at: string; ok: boolean | null; note: string | null } | null>(null);
  const watching = !ended && (askedAt !== null || running);
  const blocked = !ready || (running && !ended);
  return (
    <span className="dk-seo-technical-act">
      <Button
        variant="quiet"
        size={size}
        icon="refresh"
        disabled={busy || blocked || (askedAt !== null && !ended)}
        aria-busy={busy || watching || undefined}
        title={running && !ended ? "It is running now." : !ready ? why : undefined}
        onClick={async () => {
          setEnded(null);
          const r = await go<JobAnswer>(`/api/v1/jobs/${encodeURIComponent(name)}/run`, {}, () => "Asked to run now. This page is drawn again when it has finished.");
          if (r.ok) setAskedAt(Date.now());
        }}
      >
        {watching ? "Running…" : busy ? "Asking…" : label}
      </Button>
      {watching ? (
        <WatchJob
          name={name}
          since={askedAt}
          onEnd={(e) => {
            setEnded(e);
            setAskedAt(null);
          }}
        />
      ) : null}
      {ended ? <Said message={{ ok: ended.ok !== false, text: ended.ok === false ? `It ended ${clock(ended.at)} and failed: ${ended.note ?? "no reason given"}` : `Finished ${clock(ended.at)}${ended.note ? `: ${ended.note}` : "."}` }} /> : <Said message={message} />}
    </span>
  );
}

/**
 * Mounted only while there is a run to wait for (unmounting it stops the
 * polling): follows GET /api/v1/jobs every four seconds and, when the job's
 * last end is later than the ask (or than its start, for a run that was going
 * already), says so and draws the page again once.
 */
function WatchJob({ name, since, onEnd }: { name: string; since: number | null; onEnd: (e: { at: string; ok: boolean | null; note: string | null }) => void }) {
  const router = useRouter();
  const live = useLive<JobListed[]>("/api/v1/jobs", 4_000);
  const job = live.data?.find((j) => j.name === name);
  /* The run asked for started after the ask (by the server's clock, which may differ from this one by a little: a minute is allowed). */
  const started = job?.lastStart ? Date.parse(job.lastStart) : null;
  const ours = since === null || (started !== null && started >= since - 60_000);
  const end = job && !job.running && ours && job.lastEnd && job.lastStart && job.lastEnd >= job.lastStart ? job.lastEnd : null;
  useEffect(() => {
    if (!end) return;
    onEnd({ at: end, ok: job?.lastOk ?? null, note: job?.lastNote ?? null });
    router.refresh();
  }, [end]); // eslint-disable-line react-hooks/exhaustive-deps
  if (job?.running && job.progress) {
    return (
      <p className="dk-seo-technical-said" role="status">
        {job.progress.done} of {job.progress.of}
        {job.progress.what ? `, ${job.progress.what}` : ""}
      </p>
    );
  }
  return null;
}

/** Mark a page as submitted in Search Console's URL Inspection (by hand), or take the mark back. */
export function Submitted({ path, submitted }: { path: string; submitted: boolean }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-technical-act">
      <Button
        variant={submitted ? "ghost" : "good"}
        size="xs"
        icon={submitted ? "refresh" : "check"}
        disabled={busy}
        aria-busy={busy || undefined}
        aria-label={submitted ? `Take back the submitted mark for ${path}` : `Mark ${path} as submitted in Search Console`}
        onClick={() => void go<OpportunityAnswer>("/api/v1/seo/indexing/requested", { path, submitted: !submitted }, () => (submitted ? "Mark taken back." : "Marked as submitted."))}
      >
        {busy ? "Saving…" : submitted ? "Undo" : "Mark submitted"}
      </Button>
      <Said message={message} />
    </span>
  );
}

/**
 * Take one technical opportunity's own action, sent as one ({ id }), so the
 * server routes it by its kind: a proposal or a brief is queued for the
 * operator, a change to the website's code goes on the to-do list in AI
 * Operator, "Request indexing" is marked as pressed. A refusal (409) comes
 * back as the server's sentence, in red.
 */
export function ActButton({ id, label, title }: { id: string; label: string; title?: string }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-technical-act">
      <Button
        variant="good"
        size="xs"
        disabled={busy}
        aria-busy={busy || undefined}
        title={title}
        onClick={() =>
          void go<OpportunityAnswer>("/api/v1/seo/opportunities/act", { id }, (v) => {
            const t = v.opportunity.state.task;
            return t ? `Queued as operator task #${t.id}.` : (v.opportunity.state.note ?? "Done.");
          })
        }
      >
        {busy ? "Asking…" : label}
      </Button>
      <Said message={message} />
    </span>
  );
}

/**
 * "I have done it": a step from the audit (in the owner's browser, or the
 * owner's own login) marked done by the person who took it, with every
 * opportunity waiting on it (POST /api/v1/seo/opportunities/owner-task). The
 * server refuses the owner's own steps to anybody else; the page shows the
 * button for those to the owner only.
 */
export function OwnerStepDone({ task, label = "I have done it" }: { task: string; label?: string }) {
  const { go, busy, message } = useSend();
  return (
    <span className="dk-seo-technical-act">
      <Button
        variant="good"
        size="xs"
        icon="check"
        disabled={busy}
        aria-busy={busy || undefined}
        title="Records that the step is done: its task is marked done by you, and the opportunities waiting on it with it."
        onClick={() =>
          void go<OwnerStepAnswer>("/api/v1/seo/opportunities/owner-task", { task }, (v) =>
            `Marked done${v.opportunities.length ? `, with ${v.opportunities.length} opportunit${v.opportunities.length === 1 ? "y" : "ies"} waiting on it` : ""}.`,
          )
        }
      >
        {busy ? "Saving…" : label}
      </Button>
      <Said message={message} />
    </span>
  );
}
