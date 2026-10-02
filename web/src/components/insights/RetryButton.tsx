"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { retryLink, type RetryResult } from "./actions";

/**
 * "Try it again" for a stuck job or a link that could not be read: the
 * console's retry, from this screen. It says what happened beside itself.
 */
export function RetryButton({ linkId, label = "Retry", compact }: { linkId: number; label?: string; compact?: boolean }) {
  const [said, act, busy] = useActionState<RetryResult, FormData>(retryLink, null);
  return (
    <form action={act} className="dk-insights-retry">
      <input type="hidden" name="link" value={linkId} />
      {compact ? (
        <Button type="submit" variant="ghost" size="xs" icon="refresh" aria-label="Try it again" title="Try it again" disabled={busy} />
      ) : (
        <Button type="submit" variant="good" size="xs" icon="refresh" disabled={busy}>
          {busy ? "Queuing" : label}
        </Button>
      )}
      {said && !said.ok ? (
        <span className="dk-insights-retry-said" role="alert">
          {said.message}
        </span>
      ) : null}
    </form>
  );
}
