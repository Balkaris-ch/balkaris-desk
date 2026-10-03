"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import type { TeamBeat } from "@/contract/team";

/** One beat a minute, and only for a minute that had somebody in it. */
const EVERY = 60_000;
const TOUCHED = 2 * 60_000;

/**
 * The page's part of the team's activity (src/presence.ts): which page this
 * is, the moment it is shown, and one beat a minute while its tab is visible
 * and the person touched it in the last two minutes. A minute of attention,
 * not a tab left open over lunch.
 *
 * Everything else the owner sees about the team is read by the server off
 * the requests themselves, so a beat that never arrives (a blocked request, a
 * tab the browser froze) costs minutes on a chart and nothing else. Nothing
 * here is shown and nothing it does can fail loudly.
 */
export function Beat() {
  const pathname = usePathname();
  const touched = useRef(Date.now());
  const where = useRef(pathname);
  where.current = pathname;

  /* Shown: say which page, at once. */
  useEffect(() => {
    send({ href: pathname, kind: "open" });
  }, [pathname]);

  useEffect(() => {
    const touch = () => {
      touched.current = Date.now();
    };
    const events = ["pointerdown", "keydown", "wheel", "pointermove", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true });
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - touched.current > TOUCHED) return;
      send({ href: where.current, kind: "beat" });
    }, EVERY);
    return () => {
      clearInterval(timer);
      for (const e of events) window.removeEventListener(e, touch);
    };
  }, []);

  return null;
}

function send(body: TeamBeat): void {
  fetch("/api/v1/team/beat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => {
    /* A lost beat is a lost minute on a chart, nothing more. */
  });
}
