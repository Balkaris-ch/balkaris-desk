"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/ui/icons";

/**
 * "Search insights…": writes `?q=` a moment after typing stops, and the
 * server draws the table again with only the rows whose title, source or
 * shelf contains the words. The address keeps the search, so it can be shared.
 */
export function TableSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const now = params.get("q") ?? "";
  const [text, setText] = useState(now);
  const [busy, go] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /* The address changed from elsewhere (back button, a tab): follow it. */
  useEffect(() => setText(now), [now]);

  const send = (value: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set("q", value.trim());
      else next.delete("q");
      const q = next.toString();
      go(() => router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false }));
    }, 300);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <label className={busy ? "dk-insights-search dk-insights-search--busy" : "dk-insights-search"}>
      <Icon name="search" size={14} />
      <input
        type="search"
        value={text}
        placeholder="Search insights…"
        aria-label="Search insights"
        onChange={(e) => {
          setText(e.target.value);
          send(e.target.value);
        }}
      />
    </label>
  );
}
