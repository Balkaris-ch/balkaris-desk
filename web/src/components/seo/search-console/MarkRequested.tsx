"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icons";
import { markRequested } from "./actions";

/**
 * Records in the desk's queue that a person pressed Request indexing for the
 * address in Search Console, or takes that mark back. The screen is drawn
 * again from the desk's answer; a refusal is printed beside the button in the
 * desk's own words.
 */
export function MarkRequested({ path, requested }: { path: string; requested: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [said, setSaid] = useState<string | null>(null);
  const press = () => {
    if (busy) return;
    setSaid(null);
    start(async () => {
      try {
        const got = await markRequested(path, !requested);
        if (got.ok) router.refresh();
        else setSaid(got.message);
      } catch {
        setSaid("The desk did not answer. Try again in a moment.");
      }
    });
  };
  return (
    <span className="dk-seo-gsc-mark">
      <button
        type="button"
        className={buttonClass({ variant: requested ? "ghost" : "good", size: "xs" })}
        onClick={press}
        disabled={busy}
        title={requested ? "Take back the mark: Request indexing was not pressed for this address after all." : "Record that you pressed Request indexing for this address in Search Console. It asks Google nothing by itself."}
      >
        {busy ? null : <Icon name={requested ? "x" : "check"} size={13} />}
        <span className="dk-btn-label">{busy ? "Saving…" : requested ? "Undo" : "Mark requested"}</span>
      </button>
      {said ? (
        <span className="dk-seo-gsc-mark-said" role="status">
          {said}
        </span>
      ) : null}
    </span>
  );
}
