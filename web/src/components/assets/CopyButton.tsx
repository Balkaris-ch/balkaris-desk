"use client";

import { useEffect, useState } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";

/**
 * Copies a file's address to the clipboard, and says so for a moment. Where
 * the browser refuses (no permission, an insecure page), it says that instead
 * of pretending.
 */
export function CopyButton({ text, label = "Copy address", size = "xs", variant = "ghost", bare = true }: { text: string; label?: string; size?: ButtonSize; variant?: ButtonVariant; bare?: boolean }) {
  const [said, setSaid] = useState<"copied" | "refused" | null>(null);

  useEffect(() => {
    if (!said) return;
    const t = setTimeout(() => setSaid(null), 1600);
    return () => clearTimeout(t);
  }, [said]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setSaid("copied");
    } catch {
      setSaid("refused");
    }
  };

  const words = said === "copied" ? "Copied" : said === "refused" ? "The browser refused" : label;
  return (
    <>
      <Button size={size} variant={variant} icon={said === "copied" ? "check" : "copy"} aria-label={bare ? words : undefined} title={bare ? words : undefined} onClick={copy}>
        {bare ? null : words}
      </Button>
      <span className="dk-sr" aria-live="polite">
        {said === "copied" ? "Address copied" : said === "refused" ? "The browser refused to copy" : ""}
      </span>
    </>
  );
}
