"use client";

import { useEffect, useRef } from "react";

/**
 * Brings the page summary into view when another page is opened in it, but
 * only where the summary lies under the list (screens narrower than the
 * board's three columns): there a row's click changes nothing on screen
 * otherwise. Beside the list, or already in view, it leaves the page alone.
 * Not on the first drawing: an address with ?open= keeps its own place.
 */
export function ShowOnOpen({ path }: { path: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef(path);
  useEffect(() => {
    if (last.current === path) return;
    last.current = path;
    const side = ref.current?.closest<HTMLElement>(".dk-seo-pages-side");
    const list = document.querySelector<HTMLElement>(".dk-seo-pages-list");
    if (!side || !list) return;
    const s = side.getBoundingClientRect();
    if (s.top < list.getBoundingClientRect().bottom - 1) return;
    if (s.top >= 0 && s.top < window.innerHeight * 0.6) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    side.scrollIntoView({ block: "start", behavior: calm ? "auto" : "smooth" });
  }, [path]);
  return <span ref={ref} hidden />;
}
