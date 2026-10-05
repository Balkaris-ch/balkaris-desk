"use client";

import { useState, useTransition } from "react";
import type { NewTask } from "@/contract/operator";
import { buttonClass } from "@/components/ui/Button";
import { Go } from "@/components/ui/Go";
import { Icon } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import { queueBrief, readPagesNow, type Said } from "./actions";

/** What the server said, in place under the button. */
function Answer({ said }: { said: Said }) {
  return (
    <span className={cx("dk-seo-competitors-said", !said.ok && "dk-seo-competitors-said--bad")} role="status">
      <Icon name={said.ok ? "check-circle" : "alert"} size={12} />
      <span>
        {said.line}
        {said.ok && said.id !== null ? (
          <>
            {" "}
            {/* A queued brief has no answer yet: the operator shows its queue, where the task waits and then finishes. */}
            <Go href="/operator#current-tasks" className="dk-seo-competitors-said-link">
              See the queue
            </Go>
          </>
        ) : null}
      </span>
    </span>
  );
}

/**
 * "Brief a page": queues the brief the desk server wrote from the cluster's
 * facts for the AI Operator, and says what happened. The task waits for the
 * studio workstation; nothing on the website changes.
 */
export function BriefButton({ task, label, step }: { task: NewTask; label: string; step: string }) {
  const [said, setSaid] = useState<Said | null>(null);
  const [busy, start] = useTransition();
  const done = said?.ok === true;
  const press = () => {
    if (busy || done) return;
    start(async () => {
      try {
        setSaid(await queueBrief(task));
      } catch {
        setSaid({ ok: false, line: "The desk did not answer. Try again in a moment." });
      }
    });
  };
  return (
    <span className="dk-seo-competitors-act">
      <button type="button" className={buttonClass({ variant: "quiet", size: "xs" })} onClick={press} disabled={busy || done} title={step}>
        <Icon name="sparkles" size={13} />
        <span className="dk-btn-label">{busy ? "Queuing…" : done ? "Queued" : label}</span>
      </button>
      {said ? <Answer said={said} /> : null}
    </span>
  );
}

/** "Read due pages now": the weekly read of their pages, asked of the scheduler now. */
export function ReadNowButton({ disabled, why }: { disabled: boolean; why: string | null }) {
  const [said, setSaid] = useState<Said | null>(null);
  const [busy, start] = useTransition();
  const press = () => {
    if (busy || disabled) return;
    start(async () => {
      try {
        setSaid(await readPagesNow());
      } catch {
        setSaid({ ok: false, line: "The desk did not answer. Try again in a moment." });
      }
    });
  };
  return (
    <span className="dk-seo-competitors-act">
      <button
        type="button"
        className={buttonClass({ variant: "quiet", size: "sm" })}
        onClick={press}
        disabled={busy || disabled || said?.ok === true}
        title={why ?? "Reads every competitor page not read in the last six days: robots.txt first, two seconds between requests to a site, the desk's name on each."}
      >
        <Icon name="refresh" size={14} />
        <span className="dk-btn-label">{busy ? "Asking…" : "Read due pages now"}</span>
      </button>
      {said ? <Answer said={said} /> : why && disabled ? <span className="dk-seo-competitors-said">{why}</span> : null}
    </span>
  );
}
