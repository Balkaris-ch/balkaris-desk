"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { JobListed } from "@/contract/common";
import { useLive } from "@/lib/live";
import { num } from "@/lib/format";

/** How long the watch keeps asking before it gives up and says so. */
const PATIENCE = 10 * 60_000;

/**
 * While the asset job is asked for or running: what it is doing, read from
 * the desk's job list every three seconds, and a redraw of the screen when it
 * has finished. `since` is when it was asked for (or when the running job
 * started); a run that ends after that is the one being waited for. It stops
 * asking when that run ends, or after ten minutes whatever happens. `asked`:
 * whether this screen's Rescan asked for it; a scheduled run that was already
 * going when the screen opened is not said to have been asked for.
 */
export function ScanWatch({ since, asked }: { since: number; asked: boolean }) {
  const router = useRouter();
  const [stopped, setStopped] = useState(false);
  /* An empty path asks nothing (lib/live.ts): that is how the watch stops. */
  const live = useLive<JobListed[]>(stopped ? "" : "/api/v1/jobs", 3000);
  const job = live.data?.find((j) => j.name === "assets") ?? null;
  const done = Boolean(job && !job.running && job.lastEnd && Date.parse(job.lastEnd) >= since);
  const late = Date.now() - since > PATIENCE;

  useEffect(() => {
    if (stopped) return;
    if (done) {
      setStopped(true);
      router.refresh();
    } else if (late) {
      setStopped(true);
    }
  }, [done, late, stopped, router]);

  let words: string;
  if (done) words = job?.lastOk === false ? `The ${asked ? "rescan" : "scan"} failed: ${job.lastNote ?? "no reason was given"}.` : `${asked ? "Rescanned" : "Scanned"}: ${job?.lastNote ?? "done"}.`;
  else if (job?.running) words = job.progress ? `Measuring the files: ${num(job.progress.done)} of ${num(job.progress.of)}.` : "Listing the files on the website's branch…";
  else if (stopped) words = `No ${asked ? "rescan" : "scan"} has finished in ten minutes. The job list in Automations says what it is doing.`;
  else words = asked ? "Rescan asked for. It starts as soon as the job before it ends." : "A scan of the files is running.";

  return (
    <p className={`dk-assets-notice dk-assets-notice--${done && job?.lastOk === false ? "bad" : done ? "good" : "info"}`} role="status" aria-live="polite">
      <span className="dk-assets-notice-dot" aria-hidden />
      {words}
    </p>
  );
}
