"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { cx } from "@/lib/cx";
import { Icon } from "@/components/ui/icons";

/**
 * The list's search box. It writes `?q=` a moment after the typing stops (or
 * at once on Enter), so the server draws the list for it and the address can
 * be shared. An open enquiry is closed by a new search.
 */
export function LeadsSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(initial);
  const [busy, go] = useTransition();
  const box = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);

  /* The address changed from elsewhere (Clear filters, back): follow it, unless the person is typing. */
  const asked = params.get("q") ?? "";
  useEffect(() => {
    if (document.activeElement !== box.current) setValue(asked);
  }, [asked]);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const send = (v: string) => {
    if (timer.current) window.clearTimeout(timer.current);
    const next = new URLSearchParams(params.toString());
    const q = v.trim();
    if (q === (params.get("q") ?? "")) return;
    if (q) next.set("q", q);
    else next.delete("q");
    next.delete("open");
    const s = next.toString();
    go(() => router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false }));
  };

  return (
    <form
      role="search"
      className={cx("dk-leads-search", busy && "dk-leads-search--busy")}
      onSubmit={(e) => {
        e.preventDefault();
        send(value);
      }}
    >
      <Icon name="search" size={14} />
      <input
        ref={box}
        type="search"
        name="q"
        value={value}
        placeholder="Search name, company, reference, message…"
        aria-label="Search the enquiries"
        autoComplete="off"
        spellCheck={false}
        maxLength={100}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          if (timer.current) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => send(v), 380);
        }}
      />
    </form>
  );
}
