"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import type { InsightsState } from "@/contract/insights";
import { Button, LinkButton } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Icon } from "@/components/ui/icons";
import { ago } from "@/lib/format";
import { useLive } from "@/lib/live";
import { createInsight, type CreateResult } from "./actions";
import "@/components/ui/dialog.css";

/**
 * "Create insight": a link and one of the four ways of writing, handed to the
 * desk exactly as a link sent to the Telegram bot is (intake.ts `takeLink`).
 *
 * THE DIALOG SAYS WHAT WILL HAPPEN, IN PLAIN WORDS, before anything is sent:
 * whether a written piece goes straight onto balkaris.ch (DESK_AUTOPUBLISH),
 * and when the workstation last asked for work, because nothing is written
 * while it is off. Both are read again from /api/v1/insights/state while the
 * dialog is open.
 *
 * It opens from its button, and from the address `?create=1` (the Quick
 * actions row "Create new insight" is that link). It is the browser's own
 * <dialog>, drawn as the Dialog primitive draws one; it is its own component
 * only because the primitive cannot be opened from outside its button.
 */
export function CreateInsight({ initial }: { initial: InsightsState }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const heading = useId();
  const params = useSearchParams();
  const pathname = usePathname();
  const asked = params.get("create") === "1";

  useEffect(() => {
    if (asked) setOpen(true);
  }, [asked]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      /* showModal puts the focus on the first thing it can (the close button), after React's
         autoFocus has run; the link field is what a person came to fill in. */
      d.querySelector<HTMLInputElement>('input[name="url"]')?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const shut = () => {
    setOpen(false);
    if (asked) {
      /* The address forgets ?create=1, so the back button and a reload do not open it again. The
         browser's own history call is enough (Next keeps useSearchParams in step with it), and
         unlike a router call it cannot arrive before the router is ready. */
      const next = new URLSearchParams(params.toString());
      next.delete("create");
      const q = next.toString();
      window.history.replaceState(null, "", q ? `${pathname}?${q}` : pathname);
    }
  };

  return (
    <>
      <Button variant="primary" icon="plus" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        Create insight
      </Button>
      <dialog
        ref={ref}
        className="dk-dialog dk-dialog--md"
        aria-labelledby={heading}
        onClose={() => {
          /* Escape closes the dialog by itself; a close this component made is already settled. */
          if (open) shut();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) shut();
        }}
      >
        {open ? (
          <div className="dk-dialog-panel">
            <header className="dk-dialog-head">
              <div>
                <h2 id={heading} className="dk-dialog-title">
                  Create insight
                </h2>
                <p className="dk-dialog-desc">Give the desk a link, the same as sending it to the Telegram bot. It is read, matched to a shelf and written on the workstation.</p>
              </div>
              <button type="button" className="dk-dialog-x" aria-label="Close" onClick={shut}>
                <Icon name="x" size={16} />
              </button>
            </header>
            <div className="dk-dialog-body">
              <CreateForm initial={initial} close={shut} />
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}

function CreateForm({ initial, close }: { initial: InsightsState; close: () => void }) {
  const live = useLive<InsightsState>("/api/v1/insights/state", 20_000, initial);
  const s = live.data ?? initial;
  const [result, act, busy] = useActionState<CreateResult, FormData>(createInsight, null);

  if (result?.ok) {
    return (
      <div className="dk-insights-made" role="status">
        <p className="dk-insights-made-head">
          <Icon name="check-circle" size={16} />
          {result.answer.already ? "Already on the desk" : "Created"}
        </p>
        <p className="dk-insights-made-text">{result.answer.said}</p>
        <div className="dk-dialog-actions">
          <Button variant="quiet" onClick={close}>
            Done
          </Button>
          <LinkButton variant="primary" href={result.answer.href} iconRight="arrow-right">
            Open it
          </LinkButton>
        </div>
      </div>
    );
  }

  return (
    <form action={act}>
      <div className={s.autopublish ? "dk-insights-truth dk-insights-truth--live" : "dk-insights-truth"}>
        <p>
          <Icon name={s.autopublish ? "alert" : "info"} size={14} />
          {s.autopublish ? (
            <span>
              <b>Autopublish is on.</b> When the workstation has written it and drawn its cover, it is published and listed on balkaris.ch: in the menu, on its shelf and in the
              sitemap, with no review step. The site shows it about two minutes later.
            </span>
          ) : (
            <span>
              <b>Autopublish is off.</b> When the workstation has written it, it waits here as a draft until somebody puts it on the site.
            </span>
          )}
        </p>
        <p>
          <Icon name="cpu" size={14} />
          <span>
            {s.runner.lastSeen === null ? (
              <>No workstation has ever asked for work. Nothing is written until one does; the link waits in the queue.</>
            ) : s.runner.awake ? (
              <>
                The workstation is on: it asked for work <time dateTime={s.runner.lastSeen}>{ago(s.runner.lastSeen)}</time>.
              </>
            ) : (
              <>
                The workstation last asked for work <time dateTime={s.runner.lastSeen}>{ago(s.runner.lastSeen)}</time>. Nothing is written while it is off; the link waits
                in the queue until it is back.
              </>
            )}
            {s.queued > 0 ? ` ${s.queued === 1 ? "One link is" : `${s.queued} links are`} queued before this one.` : ""}
          </span>
        </p>
      </div>

      <Field label="Link" hint="An article, a TikTok, a Reel, a carousel or a YouTube video.">
        <Input name="url" type="url" required placeholder="https://" autoComplete="off" inputMode="url" />
      </Field>

      <fieldset className="dk-insights-formats">
        <legend className="dk-field-label">How to write it</legend>
        {s.formats.map((f, i) => (
          <label key={f.key} className="dk-insights-format">
            <input type="radio" name="format" value={f.key} defaultChecked={i === 0} />
            <span>
              <b>{f.label}</b>
              <small>Written {f.as}.</small>
            </span>
          </label>
        ))}
      </fieldset>

      {result && !result.ok ? (
        <p className="dk-insights-made-error" role="alert">
          {result.message}
        </p>
      ) : null}

      <div className="dk-dialog-actions">
        <Button variant="quiet" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" icon="plus" disabled={busy}>
          {busy ? "Reading the link" : "Create insight"}
        </Button>
      </div>
    </form>
  );
}
