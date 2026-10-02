"use client";

import { useEffect, useTransition } from "react";
import { failureOf } from "@/lib/failure";
import { Button, LinkButton } from "@/components/ui/Button";
import { Gate } from "./Gate";

export interface TroubleProps {
  /** What the error boundary caught. A `DeskError` from lib/api.ts carries its kind in `digest`. */
  error: Error & { digest?: string };
  /** Next's `retry`: ask the server again for what failed, and draw it if it now answers. */
  retry: () => void;
  /** `panel` inside the frame (app/(frame)/error.tsx), `page` when the frame itself failed (app/error.tsx). */
  form: "page" | "panel";
}

/**
 * What an error boundary shows: the calm gate for what went wrong, and the
 * buttons that do something about it. The desk server's own failures (down,
 * switched off, not allowed, nothing there) are told apart by the digest
 * lib/api.ts gave them; anything else is a fault in the interface, written to
 * the console for whoever is looking and shown as one plain sentence.
 *
 * In development the error's own message is printed under the sentence. In
 * production Next has already replaced it with a generic one, so the digest
 * is printed instead: it is the line to look for in the server's log.
 */
export function Trouble({ error, retry, form }: TroubleProps) {
  const desk = failureOf(error.digest);
  const kind = desk ?? "broken";
  const [busy, go] = useTransition();

  useEffect(() => {
    if (!desk) console.error(error);
  }, [error, desk]);

  const dev = process.env.NODE_ENV !== "production";
  const detail = dev ? error.message : !desk && error.digest ? `Reference ${error.digest}` : undefined;

  return (
    <Gate kind={kind} detail={detail || undefined} form={form}>
      {kind === "off" ? (
        <form method="post" action="/logout">
          <Button type="submit" variant="primary" icon="logout">
            Sign out
          </Button>
        </form>
      ) : (
        <Button variant="primary" icon="refresh" disabled={busy} onClick={() => go(() => retry())}>
          {busy ? "Asking…" : "Try again"}
        </Button>
      )}
      {kind === "forbidden" || kind === "missing" || (kind === "broken" && form === "panel") ? (
        <LinkButton href="/" icon="home">
          Command Center
        </LinkButton>
      ) : null}
    </Gate>
  );
}
