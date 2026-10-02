"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A figure that keeps itself current in the browser.
 *
 *   const live = useLive<LiveVisitors>("/api/v1/traffic/live", 30_000);
 *   live.data    the last good answer, or null before the first
 *   live.error   why the last ask failed, or null
 *   live.at      when `data` was received (ms), for "as of"
 *
 * It asks the page's own origin, and only under /api/v1: the browser never
 * talks to anything but the desk. While the tab is hidden it asks nothing, and
 * when the tab comes back it asks at once if its answer has gone stale. A
 * failed ask keeps the last good answer and sets `error`; nothing is thrown,
 * so a panel that polls can never take its screen down.
 */
export interface Live<T> {
  data: T | null;
  /** A sentence, or null. `data` may still hold the last good answer. */
  error: string | null;
  /** The last response's status: 401 means signed out. Null when no answer came. */
  status: number | null;
  /** When `data` arrived, in ms since the epoch. Null for the server's first value. */
  at: number | null;
  /** Ask now, without waiting for the next turn. */
  refresh: () => void;
}

const FLOOR = 2_000;
/* The server answers from its own cache, so an ask slower than this is stuck,
   not slow (the same patience as lib/api.ts). A poll also waits no longer
   than its own turn, since the next ask would be due by then, but always at
   least GRACE, so a fast poll on a slow line is not cut off every time. */
const PATIENCE = 20_000;
const GRACE = 5_000;

export function useLive<T>(path: string, everyMs: number, initial: T | null = null): Live<T> {
  const [data, setData] = useState<T | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [at, setAt] = useState<number | null>(null);

  /* What the timers need, kept out of render so a poll never re-subscribes. */
  const run = useRef<{ ask: () => void } | null>(null);

  useEffect(() => {
    if (!path.startsWith("/api/v1/")) {
      setError("Only the desk's own API can be polled.");
      return;
    }

    const every = Math.max(FLOOR, everyMs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: AbortController | undefined;
    let asked = 0;
    let gone = false;

    const wait = (ms: number) => {
      clearTimeout(timer);
      if (!gone && !document.hidden) timer = setTimeout(ask, ms);
    };

    async function ask() {
      clearTimeout(timer);
      abort?.abort();
      abort = new AbortController();
      const mine = abort;
      asked = Date.now();
      /* A server that takes the connection and never answers would otherwise
         hold this ask, and with it every later one, for minutes, while the
         last answer went on looking current. Cut it off and say so. */
      let late = false;
      const cutoff = setTimeout(() => {
        late = true;
        mine.abort();
      }, Math.min(Math.max(every, GRACE), PATIENCE));
      /* Stopped between two awaits: handled with the other failures below. */
      const stopped = () => {
        if (gone || mine.signal.aborted) throw new Error("stopped");
      };
      try {
        const res = await fetch(path, {
          credentials: "same-origin",
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: mine.signal,
        });
        stopped();
        setStatus(res.status);
        if (!res.ok) {
          setError(res.status === 401 ? "Signed out." : res.status === 403 ? "This account may not see this." : `The desk server answered ${res.status}.`);
        } else {
          const json = (await res.json()) as T;
          stopped();
          setData(json);
          setAt(Date.now());
          setError(null);
        }
      } catch {
        /* Unmounted, or replaced by a newer ask that schedules the next turn itself. */
        if (gone || (mine.signal.aborted && !late)) return;
        setStatus(null);
        setError(late ? "The desk server took too long to answer." : "The desk server is not answering.");
      } finally {
        clearTimeout(cutoff);
      }
      wait(every);
    }

    const seen = () => {
      if (document.hidden) {
        clearTimeout(timer);
        return;
      }
      const due = asked + every - Date.now();
      if (due <= 0) void ask();
      else wait(due);
    };

    run.current = { ask: () => void ask() };
    document.addEventListener("visibilitychange", seen);
    /* With a value from the server there is nothing to fetch yet. */
    if (initial === null) void ask();
    else {
      asked = Date.now();
      wait(every);
    }

    return () => {
      gone = true;
      run.current = null;
      clearTimeout(timer);
      abort?.abort();
      document.removeEventListener("visibilitychange", seen);
    };
    /* `initial` is the first value only; a new one from the server must not restart the poll. */
  }, [path, everyMs]);

  const refresh = useCallback(() => run.current?.ask(), []);

  return { data, error, status, at, refresh };
}
