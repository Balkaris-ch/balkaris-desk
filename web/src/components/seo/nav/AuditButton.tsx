"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { JobListed } from "@/contract/common";
import type { AuditRun } from "@/contract/seo/common";
import { cx } from "@/lib/cx";
import { clock } from "@/lib/format";
import { useLive } from "@/lib/live";
import { buttonClass } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icons";
import { runFullAudit } from "./actions";

/** A job of the audit that was already running when the page was drawn: its start, on the desk server's clock. */
export interface RunningStep {
  name: string;
  title: string;
  start: string;
}

/**
 * One job the button follows to its end.
 *   before  asked for by this button: the run is the first with a different start
 *   run     already going when the page was drawn: the run with this start
 */
type Step = { name: string; title: string } & ({ before: string | null } | { run: string });

type Where = "queued" | "running" | "done" | "skipped" | "failed" | "cut";

/** Where one step of the audit has got, whichever source said so. */
interface StepView {
  title: string;
  where: Where;
  note: string | null;
  progress: { done: number; of: number; what?: string } | null;
  endedAt: string | null;
}

/**
 * What the button follows.
 *   run   the desk's own record of the audit (GET /api/v1/seo/audit), and the
 *         jobs to follow instead if the desk has no such address
 *   jobs  the scheduler's jobs, through GET /api/v1/jobs
 */
type Source = { kind: "run"; id: string; steps: Step[] } | { kind: "jobs"; steps: Step[] };

type Phase =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "watching"; source: Source; crawlOnly: boolean }
  | { kind: "over"; line: string; tone: "good" | "warn" }
  | { kind: "refused"; message: string };

const EVERY = 2_000;
/* A crawl of the whole site and Google's index checks take minutes. Past
   this the button stops watching and says so; the jobs carry on regardless. */
const PATIENCE = 30 * 60_000;
const ENDED: readonly Where[] = ["done", "skipped", "failed", "cut"];

/** Where one job has got, from the desk's job list. */
function whereIs(step: Step, job: JobListed | undefined): Where {
  if (!job) return "queued";
  const start = job.lastStart;
  if ("run" in step) {
    if (start !== step.run) return "done"; /* a later run has started: ours ended before it */
    if (job.running) return "running";
  } else {
    if (start === null || start === step.before) return "queued";
    if (job.running) return "running";
  }
  const ended = job.lastEnd !== null && start !== null && Date.parse(job.lastEnd) >= Date.parse(start);
  /* Began, no longer runs, never ended: the desk server restarted under it. */
  if (!ended) return "cut";
  return job.lastOk === false ? "failed" : "done";
}

/** Follows the jobs through GET /api/v1/jobs every two seconds. */
function WatchJobs({ steps, onSeen }: { steps: Step[]; onSeen: (seen: StepView[], over: boolean) => void }) {
  const live = useLive<JobListed[]>("/api/v1/jobs", EVERY);
  useEffect(() => {
    if (!Array.isArray(live.data)) return;
    const by = new Map(live.data.map((j) => [j.name, j]));
    const seen = steps.map((step): StepView => {
      const job = by.get(step.name);
      const where = whereIs(step, job);
      return { title: step.title, where, note: job?.lastNote ?? null, progress: where === "running" ? (job?.progress ?? null) : null, endedAt: job?.lastEnd ?? null };
    });
    onSeen(seen, seen.every((s) => ENDED.includes(s.where)));
  }, [live.data, steps, onSeen]);
  return null;
}

/** Follows the desk's own record of the audit; says so when the desk has no such address, so the jobs are followed instead. */
function WatchRun({ id, onSeen, onMissing }: { id: string; onSeen: (seen: StepView[], over: boolean) => void; onMissing: () => void }) {
  const live = useLive<unknown>("/api/v1/seo/audit", EVERY);
  useEffect(() => {
    if (live.status === 404 || live.status === 405) {
      onMissing();
      return;
    }
    const v = live.data as { audit?: AuditRun | null } | AuditRun | null;
    const run = v && typeof v === "object" ? ("audit" in v ? v.audit : "steps" in v ? v : null) : null;
    if (!run || run.id !== id || !Array.isArray(run.steps)) return;
    const seen = run.steps.map((s): StepView => ({ title: s.title, where: s.state, note: s.note, progress: s.state === "running" ? s.progress : null, endedAt: s.endedAt }));
    onSeen(seen, run.state !== "running");
  }, [live.data, live.status, id, onSeen, onMissing]);
  return null;
}

/** What the line under the button says while the audit runs, and how far the bar is. */
function progressLine(seen: StepView[] | null, crawlOnly: boolean): { line: string; share: number | null } {
  const waiting = crawlOnly ? "Only the crawl can run: the full audit is not on this desk yet. Waiting for it to start…" : "Asked for. Waiting for the desk to start it…";
  if (!seen || !seen.length) return { line: waiting, share: null };
  const over = seen.filter((s) => ENDED.includes(s.where)).length;
  const now = seen.find((s) => s.where === "running");
  const many = seen.length > 1 ? `Step ${Math.min(over + 1, seen.length)} of ${seen.length}, ` : "";
  if (!now) return { line: over ? `${many}waiting for the desk: it runs one job at a time.` : waiting, share: seen.length > 1 ? over / seen.length : null };
  const p = now.progress;
  const part = p && p.of > 0 ? Math.min(1, p.done / p.of) : 0;
  const how = p && p.of > 0 ? `: ${p.done} of ${p.of}${p.what ? ` · ${p.what}` : ""}` : "…";
  return { line: `${many}${now.title}${how}`, share: p && p.of > 0 ? (over + part) / seen.length : seen.length > 1 ? over / seen.length : null };
}

/** The sentence when the audit has come to an end. */
function endLine(seen: StepView[], crawlOnly: boolean): { line: string; tone: "good" | "warn" } {
  const bad = seen.find((s) => s.where === "failed" || s.where === "cut");
  if (bad) {
    const why = bad.where === "cut" ? "it was cut off because the desk server restarted. Run it again." : (bad.note ?? "no reason given.");
    return { line: `${bad.title} did not finish: ${why}`, tone: "warn" };
  }
  /* When the last step ended, on the desk server's clock. */
  const ends = seen.map((s) => s.endedAt).filter((t): t is string => typeof t === "string").sort();
  const at = clock(ends.at(-1) ?? new Date());
  /* That the crawl is all it ran was said when it started: here only what it found. */
  if (crawlOnly) {
    const note = seen.at(-1)?.note;
    return { line: `Crawl finished at ${at}${note ? `: ${note}` : "."}`, tone: "good" };
  }
  const done = seen.filter((s) => s.where === "done").length;
  const skipped = seen.length - done;
  return { line: `Audit finished at ${at}: ${done} ${done === 1 ? "step" : "steps"} run${skipped ? `, ${skipped} skipped as fresh enough` : ""}. The pages show what it found.`, tone: "good" };
}

/**
 * "Run full SEO audit" in the SEO head. Asks the desk for the audit (a server
 * action: actions.ts), follows it to its end with a line saying how far it
 * has got, then draws the page again with what it found. A page drawn while
 * the audit's jobs run starts out following them.
 */
export function AuditButton({ running }: { running: RunningStep[] }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(() =>
    running.length ? { kind: "watching", source: { kind: "jobs", steps: running.map((r) => ({ name: r.name, title: r.title, run: r.start })) }, crawlOnly: false } : { kind: "idle" },
  );
  const [seen, setSeen] = useState<{ steps: StepView[]; over: boolean } | null>(null);
  const [, start] = useTransition();
  const since = useRef(Date.now());

  const ask = () => {
    if (phase.kind === "asking" || phase.kind === "watching") return;
    setPhase({ kind: "asking" });
    setSeen(null);
    start(async () => {
      const answer = await runFullAudit().catch(() => ({ ok: false as const, message: "The desk server did not answer. Try again in a moment." }));
      if (!answer.ok) {
        setPhase({ kind: "refused", message: answer.message });
        return;
      }
      const steps: Step[] = answer.steps.map((s) => ({ name: s.name, title: s.title, before: s.before }));
      since.current = Date.now();
      if (answer.run) {
        setPhase({ kind: "watching", source: { kind: "run", id: answer.run.id, steps }, crawlOnly: false });
        return;
      }
      if (!steps.length) {
        setPhase({ kind: "over", line: "The audit was asked for. Its findings appear on these pages as each part finishes.", tone: "good" });
        return;
      }
      setPhase({ kind: "watching", source: { kind: "jobs", steps }, crawlOnly: answer.via === "crawl" });
    });
  };

  /* Stable for the watchers' effects: a new function each render would re-run them for nothing. */
  const onSeen = useRef((steps: StepView[], over: boolean) => setSeen({ steps, over })).current;
  /* The desk has no record of the run to read back: follow its jobs instead. */
  const onMissing = useRef(() =>
    setPhase((p) =>
      p.kind === "watching" && p.source.kind === "run"
        ? p.source.steps.length
          ? { ...p, source: { kind: "jobs", steps: p.source.steps } }
          : { kind: "over", line: "The audit was asked for. Its findings appear on these pages as each part finishes.", tone: "good" }
        : p,
    ),
  ).current;

  useEffect(() => {
    if (phase.kind !== "watching" || !seen) return;
    if (seen.over) {
      setPhase({ kind: "over", ...endLine(seen.steps, phase.crawlOnly) });
      router.refresh();
    } else if (Date.now() - since.current > PATIENCE) {
      setPhase({ kind: "over", line: "Still running after half an hour. It carries on; come back to this page later for what it found.", tone: "warn" });
    }
  }, [seen, phase, router]);

  const busy = phase.kind === "asking" || phase.kind === "watching";
  const shown = phase.kind === "watching" ? progressLine(seen?.steps ?? null, phase.crawlOnly) : null;
  const line =
    phase.kind === "asking"
      ? { text: "Asking the desk to start…", tone: "quiet" }
      : shown
        ? { text: shown.line, tone: "quiet" }
        : phase.kind === "over"
          ? { text: phase.line, tone: phase.tone }
          : phase.kind === "refused"
            ? { text: phase.message, tone: "warn" }
            : null;

  return (
    <div className="dk-seo-nav-audit">
      <button type="button" className={buttonClass({ variant: "quiet", size: "md" }, cx("dk-seo-nav-run", busy && "dk-seo-nav-run--busy"))} onClick={ask} aria-busy={busy} aria-describedby="dk-seo-nav-said">
        <Icon name={busy ? "refresh" : "play"} size={16} className={cx(busy && "dk-seo-nav-spin")} />
        {/* Both labels hold the width, so the button keeps its size as it changes. */}
        <span className="dk-btn-label dk-seo-nav-run-label">
          <span aria-hidden={busy || undefined}>Run full SEO audit</span>
          <span aria-hidden={!busy || undefined}>Auditing…</span>
        </span>
        {shown?.share != null ? (
          <span className="dk-seo-nav-run-bar" aria-hidden>
            <i style={{ width: `${Math.round(shown.share * 100)}%` }} />
          </span>
        ) : null}
      </button>
      <p id="dk-seo-nav-said" className={cx("dk-seo-nav-said", line && `dk-seo-nav-said--${line.tone}`)} role="status" title={line?.text}>
        {line?.text ?? ""}
      </p>
      {phase.kind === "watching" && phase.source.kind === "jobs" ? <WatchJobs steps={phase.source.steps} onSeen={onSeen} /> : null}
      {phase.kind === "watching" && phase.source.kind === "run" ? <WatchRun id={phase.source.id} onSeen={onSeen} onMissing={onMissing} /> : null}
    </div>
  );
}
