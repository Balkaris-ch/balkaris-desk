"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import { Button, type ButtonLook } from "./Button";
import { Icon } from "./icons";
import "./dialog.css";

export interface DialogProps {
  /** The dialog's heading: "Create insight". */
  title: string;
  /** One quiet sentence under the heading. */
  description?: ReactNode;
  /** The button that opens it: its label and how it looks. */
  trigger: ButtonLook & { label: string };
  /** The dialog's content: usually a <form>. */
  children: ReactNode;
  /** sm is a confirmation (420px), md a form (560px). */
  size?: "sm" | "md";
}

/**
 * A button and the dialog it opens, for a form such as "Create insight".
 *
 * It is the browser's own <dialog>, opened as a modal: the keyboard stays
 * inside it, Escape closes it, and what is behind is inert. It also closes on
 * a click outside, on its ✕, and on any `DialogClose` inside. The content is
 * only mounted while the dialog is open, so a form starts clean every time.
 *
 * A form inside that posts through a server action and then navigates takes
 * the dialog away with the screen; one that stays on the screen closes it with
 * a `<DialogClose>` or `method="dialog"`.
 */
export function Dialog({ title, description, trigger, children, size = "md" }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const heading = useId();
  const { label, ...look } = trigger;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <>
      <Button {...look} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <dialog
        ref={ref}
        className={cx("dk-dialog", `dk-dialog--${size}`)}
        aria-labelledby={heading}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          /* The dialog element itself is only hit on its backdrop: its box is filled by the panel. */
          if (e.target === e.currentTarget) setOpen(false);
        }}
      >
        {open ? (
          <div className="dk-dialog-panel">
            <header className="dk-dialog-head">
              <div>
                <h2 id={heading} className="dk-dialog-title">
                  {title}
                </h2>
                {description ? <p className="dk-dialog-desc">{description}</p> : null}
              </div>
              <button type="button" className="dk-dialog-x" aria-label="Close" onClick={() => setOpen(false)}>
                <Icon name="x" size={16} />
              </button>
            </header>
            <div className="dk-dialog-body">{children}</div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}

/** A button that closes the dialog it is inside: a form's "Cancel". */
export function DialogClose({ children = "Cancel", ...look }: ButtonLook & { children?: ReactNode }) {
  return (
    <Button {...look} onClick={(e) => e.currentTarget.closest("dialog")?.close()}>
      {children}
    </Button>
  );
}

/** The row of buttons at the bottom of a dialog's form, right-aligned. */
export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="dk-dialog-actions">{children}</div>;
}
