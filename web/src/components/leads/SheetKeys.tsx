"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * What the open enquiry needs from the browser: Escape closes it, and it
 * takes the keyboard's focus when it opens so a screen reader starts there.
 */
export function SheetKeys({ closeHref, focusId }: { closeHref: string; focusId: string }) {
  const router = useRouter();
  useEffect(() => {
    document.getElementById(focusId)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      /* A tooltip or a dialog of its own closes first. */
      if (document.querySelector("dialog[open]")) return;
      router.replace(closeHref, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeHref, focusId, router]);
  return null;
}
