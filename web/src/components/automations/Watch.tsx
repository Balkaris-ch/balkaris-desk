"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** Sent by a button on this screen after it asked for something, so the screen watches closely for a while. */
export const ASKED_EVENT = "dk-automations-asked";

/** Tell the screen that something was just asked for. */
export function announceAsked(): void {
  window.dispatchEvent(new Event(ASKED_EVENT));
}

const CLOSE_MS = 4_000;
const IDLE_MS = 60_000;
const AFTER_ASK_MS = 90_000;

/**
 * Keeps the screen current without anybody pressing reload: the server draws
 * it again every four seconds while a job is running or was just asked for,
 * and once a minute otherwise, so "4 min ago" and "in 2 min" stay true. It
 * asks nothing while the tab is hidden. The desk answers this screen from its
 * own database, so a redraw costs no quota anywhere.
 */
export function Watch({ busy }: { busy: boolean }) {
  const router = useRouter();
  const askedAt = useRef(0);
  /* Bumped when a button asks, so the timer below is planned again at once. */
  const [asks, setAsks] = useState(0);

  useEffect(() => {
    const asked = () => {
      askedAt.current = Date.now();
      setAsks((n) => n + 1);
    };
    window.addEventListener(ASKED_EVENT, asked);
    return () => window.removeEventListener(ASKED_EVENT, asked);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const every = () => (busy || Date.now() - askedAt.current < AFTER_ASK_MS ? CLOSE_MS : IDLE_MS);
    const plan = () => {
      clearTimeout(timer);
      if (!document.hidden) timer = setTimeout(tick, every());
    };
    function tick() {
      router.refresh();
      plan();
    }
    const seen = () => (document.hidden ? clearTimeout(timer) : tick());
    document.addEventListener("visibilitychange", seen);
    plan();
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", seen);
    };
  }, [router, busy, asks]);

  return null;
}
