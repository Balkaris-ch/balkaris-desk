"use client";

import { useActionState } from "react";
import { runJob } from "@/components/automations/actions";
import { Button } from "@/components/ui/Button";
import { cx } from "@/lib/cx";
import "./overview.css";

/**
 * "Run now" on one job of the Automations strip, through the Automations
 * screen's own server action (POST /api/v1/jobs/:name/run, which keeps its
 * floor between two asks and decides who may). Drawn only for a person the
 * server lets run the job (the payload's `can.run`). After a failed run it is
 * the strip's first move, in the warning tone: "run it again", right there.
 */
export function RunNow({ name, title, failed }: { name: string; title: string; failed: boolean }) {
  const [said, action, pending] = useActionState(runJob, null);
  return (
    <form action={action} className="dk-seo-overview-runnow">
      <input type="hidden" name="name" value={name} />
      <Button type="submit" size="xs" variant={failed ? "quiet" : "ghost"} className={cx(failed && "dk-seo-overview-runnow--failed")} icon="refresh" disabled={pending} aria-busy={pending || undefined} aria-label={`Run "${title}" now`} title={failed ? "The last run failed: run it again now." : "Run it now."}>
        {pending ? "Asking…" : failed ? "Retry" : "Run"}
      </Button>
      {said ? (
        <span className={cx("dk-seo-overview-said dk-seo-overview-runnow-said", !said.ok && "dk-seo-overview-said--bad")} role={said.ok ? "status" : "alert"}>
          {said.message}
        </span>
      ) : null}
    </form>
  );
}
