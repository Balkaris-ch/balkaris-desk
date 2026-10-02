"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { JobListed } from "@/contract/common";
import { cx } from "@/lib/cx";
import { useLive } from "@/lib/live";
import { Icon } from "@/components/ui/icons";
import { runAudit } from "./actions";
import "./seo.css";

type Phase = { kind: "idle" } | { kind: "asking" } | { kind: "running" } | { kind: "done"; note: string | null; ok: boolean } | { kind: "refused"; message: string };

/**
 * Which run the row is waiting for, in the desk server's own times (never the
 * browser's clock, which on a laptop is not the server's):
 *
 *   asked   the job's last start when the desk accepted the request; the run
 *           asked for is the first with a different start.
 *   run     the start of the run already going when the screen was drawn.
 */
type Target = { asked: string | null } | { run: string };

/** Watches the crawl job every two seconds and says when the awaited run has finished. */
function Watch({ awaited, onProgress, onDone }: { awaited: Target; onProgress: (j: JobListed) => void; onDone: (j: JobListed) => void }) {
  const live = useLive<JobListed[]>("/api/v1/jobs", 2_000);
  const told = useRef(false);
  useEffect(() => {
    const job = live.data?.find((j) => j.name === "crawl");
    if (!job || told.current) return;
    const start = job.lastStart;
    const ours = "run" in awaited ? start === awaited.run : start !== null && start !== awaited.asked;
    if (!ours) {
      if ("run" in awaited && start !== null && start !== awaited.run && !job.running) {
        /* A later run has already started and ended: ours finished before it. */
        told.current = true;
        onDone(job);
      } else onProgress(job);
      return;
    }
    if (job.running) {
      onProgress(job);
      return;
    }
    told.current = true;
    const ended = job.lastEnd !== null && Date.parse(job.lastEnd) >= Date.parse(start!);
    /* It began and is no longer running, yet never ended: the desk server
       restarted under it (it does after every update). Say so; never wait forever. */
    onDone(ended ? job : { ...job, lastOk: false, lastNote: "it was cut off before it finished, because the desk server restarted. Run it again." });
  }, [live.data, awaited, onDone, onProgress]);
  return null;
}

/**
 * "Run SEO audit": runs the crawl now and shows how far it has got, then
 * draws the screen again with what it found. If the desk refuses (a crawl is
 * running, or ran a moment ago), its sentence is shown in the row.
 */
export function AuditAction({ job, rules }: { job: JobListed | null; rules: number | null }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(job?.running ? { kind: "running" } : { kind: "idle" });
  const [progress, setProgress] = useState<JobListed["progress"]>(job?.progress ?? null);
  const [awaited, setAwaited] = useState<Target | null>(() => (job?.running ? (job.lastStart ? { run: job.lastStart } : { asked: null }) : null));
  const [, start] = useTransition();

  const ask = () => {
    if (phase.kind === "asking" || phase.kind === "running") return;
    setPhase({ kind: "asking" });
    start(async () => {
      const answer = await runAudit();
      if (answer.ok) {
        setAwaited({ asked: answer.before });
        setProgress(null);
        setPhase({ kind: "running" });
      } else setPhase({ kind: "refused", message: answer.message });
    });
  };

  const busy = phase.kind === "asking" || phase.kind === "running";
  const desc =
    phase.kind === "asking"
      ? "Asking the desk to start…"
      : phase.kind === "running"
        ? progress && progress.of > 0
          ? `Reading page ${progress.done} of ${progress.of}${progress.what ? ` · ${progress.what}` : ""}`
          : "Starting: the crawl reads the sitemap first…"
        : phase.kind === "done"
          ? phase.ok
            ? `Finished: ${phase.note ?? "every page read again"}`
            : `The crawl failed: ${phase.note ?? "no reason given"}`
          : phase.kind === "refused"
            ? phase.message
            : rules
              ? `Read every page against the desk’s ${rules} rules`
              : "Read every page against the desk’s rules";

  return (
    <>
      <button type="button" className={cx("dk-seo-action", "dk-seo-audit", busy && "dk-seo-audit--busy")} onClick={ask} aria-busy={busy} disabled={phase.kind === "asking"}>
        <Icon name="refresh" size={16} className={cx("dk-seo-action-icon", busy && "dk-seo-spin")} />
        <span className="dk-seo-action-text">
          <span className="dk-seo-action-label">{phase.kind === "running" ? "Running SEO audit" : "Run SEO audit"}</span>
          <span className={cx("dk-seo-action-desc", (phase.kind === "refused" || phase.kind === "done") && "dk-seo-audit-said", phase.kind === "refused" && "dk-seo-audit-refused")} title={desc} aria-live="polite">
            {desc}
          </span>
        </span>
        {phase.kind === "running" && progress && progress.of > 0 ? (
          <span className="dk-seo-audit-bar" role="progressbar" aria-label="Pages read" aria-valuemin={0} aria-valuemax={progress.of} aria-valuenow={progress.done}>
            <i style={{ width: `${Math.round((progress.done / progress.of) * 100)}%` }} />
          </span>
        ) : (
          <Icon name="chevron-right" size={14} className="dk-seo-action-go" />
        )}
      </button>
      {phase.kind === "running" && awaited ? (
        <Watch
          awaited={awaited}
          onProgress={(j) => setProgress(j.progress)}
          onDone={(j) => {
            setPhase({ kind: "done", note: j.lastNote, ok: j.lastOk !== false });
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
