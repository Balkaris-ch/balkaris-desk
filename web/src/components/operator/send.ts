"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

/**
 * A change sent from the browser to the desk server, and its answer.
 *
 * The browser posts to its own origin under /api/v1 (on the box Caddy sends
 * that to the desk server; on a workstation next.config.ts rewrites it), so
 * the server sees the visitor's own cookie and Origin and decides as it
 * always does. Nothing is thrown: the caller gets the answer or the server's
 * sentence, and shows it beside the button that was pressed.
 */
export type Sent<T> = { ok: true; value: T } | { ok: false; message: string; status: number };

export async function send<T = unknown>(path: string, body: unknown = {}): Promise<Sent<T>> {
  try {
    const res = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (res.ok) return { ok: true, value: json as T };
    const said = json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string" ? (json as { error: string }).error : "";
    return {
      ok: false,
      status: res.status,
      message: said || (res.status === 401 ? "Signed out: sign in again." : `The desk server answered ${res.status}.`),
    };
  } catch {
    return { ok: false, status: 0, message: "The desk server is not answering." };
  }
}

/**
 * One button's worth of sending: busy while it goes, the server's sentence
 * when it refuses, and the screen drawn again from the server when it is done.
 */
export function useSend() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [, redraw] = useTransition();

  const go = useCallback(
    async <T>(path: string, body: unknown, done?: (value: T) => string | null): Promise<Sent<T>> => {
      setBusy(true);
      setMessage(null);
      const r = await send<T>(path, body);
      setBusy(false);
      if (r.ok) {
        const text = done ? done(r.value) : null;
        if (text) setMessage({ ok: true, text });
        redraw(() => router.refresh());
      } else {
        setMessage({ ok: false, text: r.message });
      }
      return r;
    },
    [router],
  );

  return { go, busy, message, setMessage };
}
