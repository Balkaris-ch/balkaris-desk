"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/ui/icons";

/**
 * "Search members…": writes `?q=` a moment after typing stops, and the server
 * draws the list again with only the people whose name or address holds the
 * words. The address keeps the search, so it can be shared.
 */
export function MemberSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const now = params.get("q") ?? "";
  const [text, setText] = useState(now);
  const [busy, go] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /* The address changed from elsewhere (back button, a tab): follow it. */
  useEffect(() => setText(now), [now]);
  useEffect(() => () => clearTimeout(timer.current), []);

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

  return (
    <label className={busy ? "dk-team-search dk-team-search--busy" : "dk-team-search"}>
      <Icon name="search" size={14} />
      <input
        type="search"
        value={text}
        placeholder="Search members…"
        aria-label="Search members"
        onChange={(e) => {
          setText(e.target.value);
          send(e.target.value);
        }}
      />
    </label>
  );
}
