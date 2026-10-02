"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { JobListed } from "@/contract/common";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icons";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatusDot } from "@/components/ui/StatusDot";
import { useLive } from "@/lib/live";
import { runDiagnostics } from "./actions";
import "@/components/ui/dialog.css";

type Asks = Awaited<ReturnType<typeof runDiagnostics>>;

const JOBS = ["probe", "sitemap", "crawl"] as const;

/**
 * The quick action that checks the website now. It asks the desk server to
 * run the probes, the sitemap read and the crawl, and shows each job's
 * progress from GET /api/v1/jobs until all three have finished.
 */
export function Diagnostics() {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const [open, setOpen] = useState(false);
  const [asks, setAsks] = useState<Asks | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, go] = useTransition();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const start = () => {
    setOpen(true);
    setAsks(null);
    setFailed(null);
    go(async () => {
      try {
        setAsks(await runDiagnostics());
      } catch {
        setFailed("The desk server did not take the request. Try again in a moment.");
      }
    });
  };

  return (
    <>
      <button type="button" className="dk-health-qa" onClick={start} aria-haspopup="dialog">
        <Icon name="search" size={16} />
        <span className="dk-health-qa-text">
          <span className="dk-health-qa-label">Open diagnostics</span>
          <span className="dk-health-qa-desc">Check the site now</span>
        </span>
      </button>
      <dialog
        ref={ref}
        className="dk-dialog dk-dialog--sm"
        aria-labelledby={heading}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
      >
        {open ? (
          <div className="dk-dialog-panel">
            <header className="dk-dialog-head">
              <div>
                <h2 id={heading} className="dk-dialog-title">
                  Diagnostics
                </h2>
                <p className="dk-dialog-desc">The probes, the sitemap and a full crawl of the website, run now, one after the other.</p>
              </div>
              <button type="button" className="dk-dialog-x" aria-label="Close" onClick={() => setOpen(false)}>
                <Icon name="x" size={16} />
              </button>
            </header>
            <div className="dk-dialog-body">
              {failed ? <p className="dk-health-diag-error">{failed}</p> : asks ? <Progress asks={asks} /> : <p className="dk-health-quiet">{busy ? "Asking the desk server…" : ""}</p>}
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}

function Progress({ asks }: { asks: Asks }) {
  const router = useRouter();
  const live = useLive<JobListed[]>("/api/v1/jobs", 2_000);
  const jobs = live.data ?? [];

  const rows = JOBS.map((name) => {
    const ask = asks.asks.find((a) => a.job === name);
    const j = jobs.find((x) => x.name === name);
    const finished = !!j?.lastEnd && Date.parse(j.lastEnd) >= asks.at && !j.running;
    /* Started after the ask, not running, never ended: the desk restarted under it (every deploy does). */
    const cut = !!j?.lastStart && Date.parse(j.lastStart) >= asks.at && !j.running && !finished;
    return { name, ask, j, finished, cut };
  });
  const done = rows.every((r) => !r.ask?.ok || r.finished || r.cut);

  return (
    <div className="dk-health-diag">
      <ul className="dk-health-diag-list">
        {rows.map(({ name, ask, j, finished, cut }) => (
          <li key={name} className="dk-health-diag-row">
            <p className="dk-health-diag-title">{j?.title ?? name}</p>
            {!ask?.ok ? (
              <p className="dk-health-diag-said">
                <StatusDot tone="quiet">Not run</StatusDot>
                <span>{ask?.message ?? ""}</span>
              </p>
            ) : finished && j ? (
              <p className="dk-health-diag-said">
                <StatusDot tone={j.lastOk ? "good" : "bad"}>{j.lastOk ? "Done" : "Failed"}</StatusDot>
                <span>{j.lastNote ?? ""}</span>
              </p>
            ) : cut ? (
              <p className="dk-health-diag-said">
                <StatusDot tone="warn">Cut off</StatusDot>
                <span>The desk server restarted during the run. The job runs again on its own schedule.</span>
              </p>
            ) : j?.running ? (
              <div className="dk-health-diag-said dk-health-diag-said--run">
                <StatusDot tone="info" pulse>
                  {j.progress ? `Running ${j.progress.done} of ${j.progress.of}` : "Running"}
                </StatusDot>
                {j.progress ? <ProgressBar value={j.progress.done} max={j.progress.of} tone="info" size="md" label={`${j.title}: progress`} /> : null}
                {j.progress?.what ? <span className="dk-health-diag-what">{j.progress.what}</span> : null}
              </div>
            ) : (
              <p className="dk-health-diag-said">
                <StatusDot tone="quiet">Waiting its turn</StatusDot>
                <span>The desk runs one job at a time.</span>
              </p>
            )}
          </li>
        ))}
      </ul>
      {live.error ? <p className="dk-health-diag-error">{live.error}</p> : null}
      <div className="dk-health-diag-foot">
        {done ? (
          <Button variant="primary" size="sm" icon="refresh" onClick={() => router.refresh()}>
            Show the new figures
          </Button>
        ) : (
          <span className="dk-health-quiet">A crawl reads every page of the site and takes about a minute.</span>
        )}
      </div>
    </div>
  );
}
