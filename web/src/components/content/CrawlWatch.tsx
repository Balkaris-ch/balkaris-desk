"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { JobListed } from "@/contract/common";
import { Icon } from "@/components/ui/icons";
import { useLive } from "@/lib/live";
import { clock } from "@/lib/format";
import type { CrawlSaid } from "./view";

/** An ask is news for ten minutes; after that the line goes, even if the address still carries it. */
const NEWS_MS = 10 * 60_000;

type Ended = { at: string; ok: boolean | null; note: string | null };

/**
 * The line under "Run the crawl now": what the desk server said when it was
 * asked, and, while the crawl runs, how far it has got. When the run ends the
 * screen is drawn again once from the new crawl and the polling stops. It
 * polls /api/v1/jobs only while there is something to watch: a crawl that is
 * running, or one asked for in the last ten minutes.
 */
export function CrawlWatch({ asked, running, finished }: { asked: { said: CrawlSaid; at: number } | null; running: boolean; finished: string | null }) {
  const [ended, setEnded] = useState<Ended | null>(null);
  const at = asked?.at ?? null;
  const said = asked?.said ?? null;
  const fresh = at !== null && Date.now() - at < NEWS_MS;

  if (ended) {
    return (
      <p className="dk-content-crawl dk-content-crawl--done" role="status">
        <Icon name={ended.ok === false ? "alert" : "check-circle"} size={14} />
        <span>{ended.ok === false ? `The crawl ended at ${clock(ended.at)} and failed: ${ended.note ?? "no reason given"}` : `The crawl finished at ${clock(ended.at)}; the figures are from it.`}</span>
      </p>
    );
  }
  if (running || (fresh && said === "asked")) return <Watching at={fresh ? at : null} finished={finished} onEnd={setEnded} />;
  if (fresh && said !== null && said !== "asked") {
    return (
      <p className="dk-content-crawl dk-content-crawl--refused" role="status">
        <Icon name="alert" size={14} />
        <span>{REFUSED[said]}</span>
      </p>
    );
  }
  return null;
}

/** What each refusal says. Written here, never taken from the address, so a link cannot put words in the desk server's mouth. */
const REFUSED: Record<Exclude<CrawlSaid, "asked">, string> = {
  recent: "Not started: the crawl is running, or ran or was asked for in the last ten minutes. The desk takes one ask at a time.",
  off: "Not started: the crawl is switched off, or what it reads is not connected. Automations shows why.",
  out: "Not started: you are signed out. Sign in again and ask once more.",
  down: "Not started: the desk server did not answer. Try again in a moment.",
  failed: "Not started: the desk server refused it. Automations shows the crawl job's state.",
};

/** Mounted only while there is a run to wait for; unmounting it stops the polling. */
function Watching({ at, finished, onEnd }: { at: number | null; finished: string | null; onEnd: (e: Ended) => void }) {
  const router = useRouter();
  const live = useLive<JobListed[]>("/api/v1/jobs", 4_000);
  const job = live.data?.find((j) => j.name === "crawl");
  const since = at ?? (finished ? Date.parse(finished) : 0);
  const end = job && !job.running && job.lastEnd && Date.parse(job.lastEnd) > since ? job.lastEnd : null;

  useEffect(() => {
    if (!end) return;
    onEnd({ at: end, ok: job?.lastOk ?? null, note: job?.lastNote ?? null });
    /* Draw the screen again from the new crawl, once. */
    router.refresh();
  }, [end]); // eslint-disable-line react-hooks/exhaustive-deps

  if (job?.running) {
    const p = job.progress;
    return (
      <p className="dk-content-crawl" role="status">
        <Icon name="refresh" size={14} className="dk-content-spin" />
        <span>{p ? `Reading the website: ${p.done} of ${p.of}${p.what ? `, ${p.what}` : ""}` : "The crawl is running."}</span>
      </p>
    );
  }
  return (
    <p className="dk-content-crawl" role="status">
      <Icon name="clock" size={14} />
      <span>{at !== null ? `Asked for at ${clock(at)}. It starts when the job before it ends and takes about a minute.` : "The crawl is running."}</span>
    </p>
  );
}
