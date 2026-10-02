"use client";

import type { Range } from "@/contract/common";
import type { TaskAnswer } from "@/contract/operator";
import { Button } from "@/components/ui/Button";
import { cx } from "@/lib/cx";
import { useSend } from "./send";

/**
 * Refresh for "Website context": re-reads what the tab shows. The pages and
 * the findings are the crawl's, so it asks for a crawl (the server's own
 * floor keeps a press from re-reading the site twice in ten minutes); the
 * traffic and the articles' views are GA4's, read again when the kept
 * answer is over a minute old.
 */
export function Refresh({ tab, range, specimen }: { tab: "pages" | "insights" | "traffic" | "issues"; range: Range; specimen: boolean }) {
  const { go, busy, message } = useSend();
  const crawl = tab === "issues";
  return (
    <span className="dk-operator-refresh">
      {message ? (
        <span className={cx("dk-operator-said-inline", !message.ok && "dk-operator-said--bad")} role={message.ok ? "status" : "alert"}>
          {message.text}
        </span>
      ) : null}
      <Button
        size="xs"
        icon="refresh"
        disabled={busy || specimen}
        onClick={() =>
          void (crawl
            ? go("/api/v1/jobs/crawl/run", {}, () => "The crawl started; this tab fills again when it finishes.")
            : go("/api/v1/operator/refresh", { tab, range }, () => "Read again."))
        }
        title={crawl ? "Read every page of the website again" : "Ask GA4 again"}
      >
        Refresh
      </Button>
    </span>
  );
}

/** "Propose fixes": metadata for the pages whose title or description breaks a rule, redirects for addresses that no longer answer. */
export function ProposeFixes({ metadata, redirect, range, specimen }: { metadata: number; redirect: number; range: Range; specimen: boolean }) {
  const { go, busy, message, setMessage } = useSend();
  if (!metadata && !redirect) return null;
  const run = async () => {
    if (specimen) return setMessage({ ok: false, text: "Specimen data is showing: nothing is queued from this view." });
    const done: string[] = [];
    if (metadata) {
      const r = await go<TaskAnswer>("/api/v1/operator/tasks", { kind: "metadata", range });
      if (!r.ok) return;
      done.push("metadata");
    }
    if (redirect) {
      const r = await go<TaskAnswer>("/api/v1/operator/tasks", { kind: "redirect", range });
      if (!r.ok) return;
      done.push("redirects");
    }
    setMessage({ ok: true, text: `Queued: proposals for ${done.join(" and ")}. They wait for approval once the workstation has answered.` });
  };
  /* One metadata task writes for five pages at most (the workstation's model writes five well). */
  const pages = metadata > 5 ? `5 of the ${metadata} pages that need it` : `${metadata} page${metadata === 1 ? "" : "s"}`;
  const what = [metadata ? `metadata for ${pages}` : "", redirect ? `${redirect} redirect${redirect === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
  return (
    <span className="dk-operator-fixes">
      <Button size="sm" variant="good" icon="wrench" disabled={busy} onClick={() => void run()} title={`Ask the workstation to propose ${what}`}>
        Propose fixes
      </Button>
      <span className="dk-operator-fixes-what">{message ? message.text : `Asks for ${what}.`}</span>
    </span>
  );
}
