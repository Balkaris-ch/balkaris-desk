"use client";

import type { JobAnswer } from "@/contract/common";
import { Button } from "@/components/ui/Button";
import { useSend } from "@/components/operator/send";
import { cx } from "@/lib/cx";

/**
 * "Check again now": asks the scheduler to run the daily index check (job
 * gsc-inspect) at once, through the desk's run-now door (POST
 * /api/v1/jobs/gsc-inspect/run), which decides who may and refuses a second
 * run while one is going. The check asks first for the addresses the day has
 * no result for, so after a check Google cut short it finishes the rest. Each
 * address counts against the day's inspection allowance; the screen is drawn
 * again from the desk when it has started, and the desk's refusal is printed
 * beside the button in its own words.
 */
export function CheckAgain({ ready, running, enabled }: { ready: boolean; running: boolean; enabled: boolean }) {
  const { go, busy, message } = useSend();
  const blocked = !ready || !enabled || running;
  return (
    <span className="dk-seo-gsc-again">
      <Button
        variant="quiet"
        size="sm"
        icon="refresh"
        disabled={busy || blocked}
        aria-busy={busy || running || undefined}
        title={
          running
            ? "The check is running now."
            : !enabled
              ? "The daily index check is switched off on Automations."
              : !ready
                ? "Search Console is not connected, so Google cannot be asked."
                : "Ask Google about every sitemap address again now, the ones the last check did not reach first."
        }
        onClick={() => void go<JobAnswer>("/api/v1/jobs/gsc-inspect/run", {}, () => "Asked. The check runs now, one address at a time; this table fills as Google answers.")}
      >
        {running ? "Checking…" : busy ? "Asking…" : "Check again now"}
      </Button>
      {message ? (
        <span className={cx("dk-seo-gsc-again-said", !message.ok && "dk-seo-gsc-again-said--bad")} role={message.ok ? "status" : "alert"}>
          {message.text}
        </span>
      ) : null}
    </span>
  );
}
