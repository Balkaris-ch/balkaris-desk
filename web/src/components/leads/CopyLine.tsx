"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/ui/icons";

/**
 * A command on one line with a button that copies it. Where the clipboard is
 * refused (an address that is not https, a browser setting), the line is
 * selected instead so that Ctrl+C takes it, and the button says so.
 */
export function CopyLine({ line, label }: { line: string; label: string }) {
  const code = useRef<HTMLElement>(null);
  const [said, setSaid] = useState<"" | "copied" | "selected">("");

  const select = () => {
    const el = code.current;
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (!el || !sel) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(line);
      setSaid("copied");
    } catch {
      select();
      setSaid("selected");
    }
    window.setTimeout(() => setSaid(""), 2400);
  };

  return (
    <div className="dk-leads-copy">
      <code ref={code} className="dk-leads-copy-line" aria-label={label} onClick={select}>
        {line}
      </code>
      <button type="button" className="dk-leads-copy-btn" onClick={copy} aria-live="polite">
        <Icon name={said === "copied" ? "check" : "copy"} size={14} />
        <span>{said === "copied" ? "Copied" : said === "selected" ? "Selected: press Ctrl+C" : "Copy"}</span>
      </button>
    </div>
  );
}
