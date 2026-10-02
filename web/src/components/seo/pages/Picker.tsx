"use client";

import { useCallback, useRef, useState, type FormEvent, type ReactNode } from "react";
import { buttonClass } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icons";
import { QueueButton } from "./QueueButton";

/** The operator writes metadata for at most this many pages in one task (src/cc/operator/packs.ts, META_MOST). */
const MOST = 5;

/**
 * The table's checkboxes and what can be done with the ticked rows: ask the
 * operator for new titles and descriptions for them (each becomes a proposal
 * waiting for approval), or download them as CSV. The boxes are drawn by the
 * server as plain fields; this only counts them.
 */
export function Picker({ exportBase, children }: { exportBase: string; children: ReactNode }) {
  const form = useRef<HTMLFormElement>(null);
  const [picked, setPicked] = useState<string[]>([]);

  const boxes = () => [...(form.current?.querySelectorAll<HTMLInputElement>('input[name="pick"]') ?? [])];
  const sync = useCallback(() => {
    const all = boxes();
    const on = all.filter((b) => b.checked).map((b) => b.value);
    setPicked(on);
    const head = form.current?.querySelector<HTMLInputElement>('input[name="pick-all"]');
    if (head) {
      head.checked = all.length > 0 && on.length === all.length;
      head.indeterminate = on.length > 0 && on.length < all.length;
    }
  }, []);

  const changed = (e: FormEvent<HTMLFormElement>) => {
    const t = e.target as HTMLInputElement;
    if (t.name === "pick-all") for (const b of boxes()) b.checked = t.checked;
    sync();
  };
  const clear = () => {
    for (const b of boxes()) b.checked = false;
    sync();
  };

  const exportHref = `${exportBase}&${picked.map((p) => `path=${encodeURIComponent(p)}`).join("&")}`;
  return (
    <form ref={form} onChange={changed} onSubmit={(e) => e.preventDefault()} className="dk-seo-pages-picker">
      {picked.length ? (
        <div className="dk-seo-pages-bulk" role="region" aria-label="Selected pages">
          <span className="dk-seo-pages-bulk-n dk-num">
            {picked.length} selected
          </span>
          <QueueButton
            key={picked.join("|")}
            task={{ kind: "metadata", paths: picked.slice(0, MOST), depth: "deep" }}
            label="Propose titles & descriptions"
            step="The operator (the studio workstation's model) writes a title and description for each selected page. They wait in AI Operator › Approvals; nothing on the live site changes until a person approves."
            blocked={picked.length > MOST ? `The operator writes metadata for at most ${MOST} pages at a time: tick ${MOST} or fewer.` : null}
          />
          <a href={exportHref} className={buttonClass({ variant: "quiet", size: "sm" })}>
            <Icon name="download" size={14} />
            <span className="dk-btn-label">Export selected</span>
          </a>
          <button type="button" className={buttonClass({ variant: "ghost", size: "sm" })} onClick={clear}>
            <span className="dk-btn-label">Clear</span>
          </button>
        </div>
      ) : null}
      {children}
    </form>
  );
}
