"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { dismissLink, type RetryResult } from "./actions";

/**
 * "Remove" for a stuck or unreadable link: it leaves the Inbox and is no
 * longer tried. The link is kept under Archive. Says what went wrong beside
 * itself, as the Retry button does.
 */
export function DismissButton({ linkId, compact }: { linkId: number; compact?: boolean }) {
  const [said, act, busy] = useActionState<RetryResult, FormData>(dismissLink, null);
  return (
    <form action={act} className="dk-insights-retry">
      <input type="hidden" name="link" value={linkId} />
      {compact ? (
        <Button type="submit" variant="ghost" size="xs" icon="x" aria-label="Remove from the Inbox" title="Remove from the Inbox" disabled={busy} />
      ) : (
        <Button type="submit" variant="quiet" size="xs" disabled={busy}>
          {busy ? "Removing" : "Remove"}
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
