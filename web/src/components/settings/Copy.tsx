"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

/**
 * Puts a line on the clipboard: a step, a command, the service account's
 * address. Never a secret: nothing on Settings holds one.
 *
 * Says "Copied" for a moment when the browser took it, and "Select it" when
 * the browser would not (no clipboard outside a secure page), so the person
 * knows to copy it by hand.
 */
export function Copy({ text, label = "Copy", what }: { text: string; label?: string; what: string }) {
  const [said, setSaid] = useState<"idle" | "done" | "refused">("idle");

  useEffect(() => {
    if (said === "idle") return;
    const t = setTimeout(() => setSaid("idle"), 1800);
    return () => clearTimeout(t);
  }, [said]);

  return (
    <Button
      size="xs"
      variant="ghost"
      icon={said === "done" ? "check" : "copy"}
      aria-label={`${label}: ${what}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setSaid("done");
        } catch {
          setSaid("refused");
        }
      }}
    >
      <span aria-live="polite">{said === "done" ? "Copied" : said === "refused" ? "Select it" : label}</span>
    </Button>
  );
}
